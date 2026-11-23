//! Refreshing a location: bringing its file records in line with the disk.
//!
//! - New files are added
//! - Edited files (size or modified time changed) have their file details and
//!   EXIF re-read; the user's own metadata is kept
//! - Moved or renamed files are recognised by a content fingerprint (or, for
//!   records made before fingerprints, by size and modified time) and keep
//!   their record, so custom metadata follows the file
//! - Files no longer on disk have their records removed
//! - Excluded folders (`location_exclusions`) are never scanned
//!
//! Only new and edited files are read; unchanged files cost one `stat` each.
//! Online-only cloud files are never read (that would download them): they're
//! indexed from `stat` alone, and their fingerprint and EXIF are read on a later
//! refresh once they've been downloaded.

use crate::commands::cloud::{streamed_drive, CloudState, DriveCheck};
use crate::commands::ingest::{bootstrap_properties, extract_file_data, extracted_keys, folder_tags, not_hidden, online_only};
use crate::db::DbPool;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

/// Files read and written per batch (one blocking read, one transaction).
const BATCH: usize = 500;

/// What a refresh is doing, for its progress bar (sent to the frontend as is).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum SyncProgress {
    /// Going through the location's folders: the total isn't known yet.
    Listing { found: usize },
    /// Reading new and edited files (EXIF, fingerprints).
    Reading { done: usize, total: usize },
    /// Writing the changes and applying the folder mapping.
    Saving,
}

/// Where a refresh reports its progress; called from the scanning thread too.
pub type Progress = std::sync::Arc<dyn Fn(SyncProgress) + Send + Sync>;

/// No progress reported (refreshes after a drop, a compress…).
pub fn quiet() -> Progress {
    std::sync::Arc::new(|_| {})
}

/// The error a refresh stopped by the user ends with. Nothing has changed then:
/// it stops before writing anything.
pub const STOPPED: &str = "Stopped";

/// Locations whose refresh has been asked to stop.
static STOPS: std::sync::Mutex<Option<HashSet<String>>> = std::sync::Mutex::new(None);

/// Asks the refresh of `location_id` to stop (Stop in its progress bar).
pub fn request_stop(location_id: &str) {
    if let Ok(mut stops) = STOPS.lock() {
        stops.get_or_insert_with(HashSet::new).insert(location_id.to_string());
    }
}

fn stop_requested(location_id: &str) -> bool {
    STOPS.lock().map(|s| s.as_ref().is_some_and(|s| s.contains(location_id))).unwrap_or(false)
}

fn clear_stop(location_id: &str) {
    if let Ok(mut stops) = STOPS.lock() {
        if let Some(stops) = stops.as_mut() {
            stops.remove(location_id);
        }
    }
}

/// How often the count of files found is reported while listing.
const LISTING_REPORT_EVERY: std::time::Duration = std::time::Duration::from_millis(150);
/// Bytes hashed from each end of a file for its fingerprint.
const FINGERPRINT_SPAN: u64 = 64 * 1024;

/// What a refresh changed.
#[derive(Debug, Default, Clone, Serialize, PartialEq)]
pub struct SyncSummary {
    pub added: usize,
    pub updated: usize,
    pub moved: usize,
    pub removed: usize,
}

/// A file found on disk: just what `stat` gives.
#[derive(Debug, Clone)]
struct DiskFile {
    path: String,
    relative_path: String,
    size: i64,
    modified: Option<String>,
    /// Not on this device, or not all of it: never read (see `cloud`).
    online_only: bool,
    /// On a streamed drive that can't say whether it's here: never read either.
    streamed: bool,
}

impl DiskFile {
    /// Takes what a streamed drive says about the file.
    fn set_cloud_state(&mut self, state: CloudState) {
        self.online_only = state == CloudState::OnlineOnly;
        self.streamed = state == CloudState::Unknown;
    }
}

/// A record already in the database for this location.
#[derive(Debug, Clone)]
struct Known {
    file_id: String,
    path: String,
    size: Option<i64>,
    modified: Option<String>,
    fingerprint: Option<String>,
    metadata: Option<String>,
    online_only: bool,
    streamed: bool,
}

/// A new or edited file, read (or, when online-only, just stat'ed).
struct ReadFile {
    disk: DiskFile,
    file_type: Option<String>,
    created_at: Option<String>,
    exif: Map<String, Value>,
    fingerprint: Option<String>,
    /// False for an online-only file: no fingerprint or EXIF were read.
    contents_read: bool,
}

fn rfc3339(t: std::time::SystemTime) -> String {
    Into::<DateTime<Utc>>::into(t).to_rfc3339()
}

/// Every visible file under `root`, outside the `excluded` folders (relative
/// paths), plus folders that couldn't be read (whose records must not be
/// treated as missing). Only `stat` is used, so cloud placeholders stay online-only.
/// Reports how many it's found as it goes, and gives up with [`STOPPED`] when asked.
fn scan_tree(
    root: &Path,
    excluded: &HashSet<String>,
    progress: &Progress,
    location_id: &str,
) -> Result<(Vec<DiskFile>, Vec<PathBuf>), String> {
    let mut last_report = std::time::Instant::now();
    // Checked once for the location: a streamed drive is mounted as a whole.
    // Its files start as Unknown; `sync_location` then asks the drive which are here
    let streamed = streamed_drive(root).is_some();
    let mut files = Vec::new();
    let mut unreadable = Vec::new();
    let is_excluded = |e: &walkdir::DirEntry| {
        e.file_type().is_dir()
            && e.path()
                .strip_prefix(root)
                .map(|p| excluded.contains(&p.to_string_lossy().replace('\\', "/")))
                .unwrap_or(false)
    };
    let walker = WalkDir::new(root).follow_links(false).into_iter();
    for entry in walker.filter_entry(|e| not_hidden(e) && !is_excluded(e)) {
        if last_report.elapsed() >= LISTING_REPORT_EVERY {
            if stop_requested(location_id) {
                return Err(STOPPED.into());
            }
            progress(SyncProgress::Listing { found: files.len() });
            last_report = std::time::Instant::now();
        }
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                if let Some(p) = e.path() {
                    unreadable.push(p.to_path_buf());
                }
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            unreadable.push(entry.path().to_path_buf());
            continue;
        };
        let Some(relative_path) = entry
            .path()
            .strip_prefix(root)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
        else {
            continue;
        };
        files.push(DiskFile {
            path: entry.path().to_string_lossy().into_owned(),
            relative_path,
            size: meta.len() as i64,
            modified: meta.modified().ok().map(rfc3339),
            online_only: online_only(&meta),
            streamed,
        });
    }
    progress(SyncProgress::Listing { found: files.len() });
    Ok((files, unreadable))
}

/// FNV-1a, a small stable hash (fingerprints are stored, so the hash must not
/// change between builds as std's does).
fn fnv1a(hash: u64, bytes: &[u8]) -> u64 {
    bytes.iter().fold(hash, |h, b| (h ^ *b as u64).wrapping_mul(0x100_0000_01b3))
}

/// A cheap content fingerprint: the size plus the first and last 64 KB. Enough
/// to recognise a file after a move or rename without reading all of it.
pub fn fingerprint(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let mut hash = fnv1a(0xcbf2_9ce4_8422_2325, &len.to_le_bytes());
    let mut buf = vec![0; FINGERPRINT_SPAN.min(len) as usize];
    file.read_exact(&mut buf).ok()?;
    hash = fnv1a(hash, &buf);
    if len > FINGERPRINT_SPAN {
        let tail = FINGERPRINT_SPAN.min(len - FINGERPRINT_SPAN);
        file.seek(SeekFrom::End(-(tail as i64))).ok()?;
        let mut buf = vec![0; tail as usize];
        file.read_exact(&mut buf).ok()?;
        hash = fnv1a(hash, &buf);
    }
    Some(format!("{hash:016x}"))
}

fn read_file(disk: DiskFile) -> Option<ReadFile> {
    let path = Path::new(&disk.path);
    // Reading an online-only file's contents, or any file on a streamed drive,
    // would make its cloud provider download it
    let contents_read = !disk.online_only && !disk.streamed;
    let (file_type, _, _, created_at, exif) = extract_file_data(path, contents_read)?;
    let fingerprint = if contents_read { fingerprint(path) } else { None };
    Some(ReadFile { disk, file_type, created_at, exif, fingerprint, contents_read })
}

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Pairs new files with missing records that are the same file moved or renamed.
/// Returns (index into `added`, index into `missing`).
///
/// A pair needs the same fingerprint, or, where either side has none (records
/// made before fingerprints, online-only files), the same size and modified time. When several candidates share a key (identical
/// copies), only a unique same-name pair is accepted; anything still ambiguous
/// is left as an addition plus a removal.
fn match_moves(added: &[ReadFile], missing: &[Known]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    let mut used_added = vec![false; added.len()];
    let mut used_missing = vec![false; missing.len()];

    type Key = (Option<String>, Option<(i64, String)>);
    let keys_added = |a: &ReadFile| -> Key { (a.fingerprint.clone(), a.disk.modified.clone().map(|m| (a.disk.size, m))) };

    // Pass 1: fingerprints; pass 2: size + modified time for records without one;
    // pass 3: size + modified time for online-only files (never fingerprinted)
    for pass in 0..3 {
        let mut groups: HashMap<String, (Vec<usize>, Vec<usize>)> = HashMap::new();
        for (i, a) in added.iter().enumerate() {
            if used_added[i] || (pass == 2 && a.fingerprint.is_some()) {
                continue;
            }
            let (fp, sm) = keys_added(a);
            let key = if pass == 0 { fp } else { sm.map(|(s, m)| format!("{s}|{m}")) };
            if let Some(k) = key {
                groups.entry(k).or_default().0.push(i);
            }
        }
        for (j, m) in missing.iter().enumerate() {
            if used_missing[j] {
                continue;
            }
            let key = if pass == 0 {
                m.fingerprint.clone()
            } else if (pass == 1) == m.fingerprint.is_none() {
                m.size.zip(m.modified.clone()).map(|(s, t)| format!("{s}|{t}"))
            } else {
                None
            };
            if let Some(k) = key {
                if let Some(g) = groups.get_mut(&k) {
                    g.1.push(j);
                }
            }
        }
        for (adds, misses) in groups.into_values() {
            if adds.len() == 1 && misses.len() == 1 {
                pairs.push((adds[0], misses[0]));
                used_added[adds[0]] = true;
                used_missing[misses[0]] = true;
                continue;
            }
            // Several copies: pair only names that match exactly one on each side
            for &a in &adds {
                let name = file_name(&added[a].disk.path);
                let same: Vec<usize> = misses
                    .iter()
                    .copied()
                    .filter(|&m| !used_missing[m] && file_name(&missing[m].path) == name)
                    .collect();
                let rivals = adds.iter().filter(|&&o| file_name(&added[o].disk.path) == name).count();
                if same.len() == 1 && rivals == 1 {
                    pairs.push((a, same[0]));
                    used_added[a] = true;
                    used_missing[same[0]] = true;
                }
            }
        }
    }
    pairs
}

/// The record's metadata with values read from the file replaced by `exif`; the
/// user's own keys are kept.
fn merge_metadata(existing: Option<&str>, exif: &Map<String, Value>) -> String {
    let mut meta: Map<String, Value> = existing
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    for key in extracted_keys() {
        meta.remove(key);
    }
    meta.extend(exif.clone());
    Value::Object(meta).to_string()
}

fn under_any(path: &str, dirs: &[PathBuf]) -> bool {
    let p = Path::new(path);
    dirs.iter().any(|d| p.starts_with(d))
}

/// Brings `location_id`'s records in line with its folder on disk, calling
/// Reports what it's doing to `progress`. Stops with [`STOPPED`] when asked to
/// ([`request_stop`]) while listing or reading, before anything is written.
pub async fn sync_location(location_id: &str, pool: &DbPool, progress: &Progress) -> Result<SyncSummary, String> {
    clear_stop(location_id);
    let result = sync_location_inner(location_id, pool, progress).await;
    clear_stop(location_id);
    result
}

async fn sync_location_inner(location_id: &str, pool: &DbPool, progress: &Progress) -> Result<SyncSummary, String> {
    let location = sqlx::query_as::<_, crate::models::Location>("SELECT * FROM locations WHERE location_id = ?")
        .bind(location_id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    crate::commands::properties::ensure_tags_property(pool, &location.library).await?;
    let root = PathBuf::from(&location.root_path);
    if !root.is_dir() {
        return Err(format!("{} isn't available. Is the drive connected?", location.root_path));
    }

    let known: Vec<Known> = sqlx::query(
        "SELECT file_id, file_path, file_size, modified_at, fingerprint, metadata, online_only, streamed FROM files WHERE location_id = ?",
    )
    .bind(location_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|r| Known {
        file_id: r.get("file_id"),
        path: r.get("file_path"),
        size: r.get("file_size"),
        modified: r.get("modified_at"),
        fingerprint: r.get("fingerprint"),
        metadata: r.get("metadata"),
        online_only: r.get("online_only"),
        streamed: r.get("streamed"),
    })
    .collect();

    let excluded: HashSet<String> =
        sqlx::query_scalar("SELECT folder_rel FROM location_exclusions WHERE location_id = ?")
            .bind(location_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .collect();
    let scan_root = root.clone();
    let (scan_progress, scan_location) = (progress.clone(), location_id.to_string());
    let (mut disk, unreadable) =
        tauri::async_runtime::spawn_blocking(move || scan_tree(&scan_root, &excluded, &scan_progress, &scan_location))
            .await
            .map_err(|e| e.to_string())??;
    // On a streamed drive, ask it which files are here (pCloud: its cache), so
    // those are read as usual and the rest left alone. Checked on every refresh,
    // so a file opened (and so downloaded) since is read then
    if let Some(drive) = streamed_drive(&root) {
        let mut check = DriveCheck::new(drive).await;
        for d in disk.iter_mut() {
            let state = check.state(Path::new(&d.path), d.size as u64).await;
            d.set_cloud_state(state);
        }
    }
    // An empty listing where there were files is far more likely an unmounted or
    // stuck drive than everything being deleted: don't remove anything
    if disk.is_empty() && !known.is_empty() {
        return Err(format!(
            "{} appears empty. Not removing its {} files in case the drive is unavailable.",
            location.root_path,
            known.len()
        ));
    }

    // Classify against the records
    let mut by_path: HashMap<&str, &Known> = known.iter().map(|k| (k.path.as_str(), k)).collect();
    let mut to_read: Vec<DiskFile> = Vec::new();
    for d in &disk {
        match by_path.remove(d.path.as_str()) {
            Some(k)
                if k.size == Some(d.size)
                    && k.modified == d.modified
                    && k.online_only == d.online_only
                    && k.streamed == d.streamed
                    && (k.fingerprint.is_some() || d.online_only || d.streamed) => {}
            // Unchanged legacy record: only needs its fingerprint, done below with the edits.
            // A file that's been downloaded (or freed up) is re-read to update its state.
            _ => to_read.push(d.clone()),
        }
    }
    let missing: Vec<Known> = by_path
        .into_values()
        .filter(|k| !under_any(&k.path, &unreadable))
        .cloned()
        .collect();
    let known_paths: HashMap<&str, &Known> = known.iter().map(|k| (k.path.as_str(), k)).collect();

    // Read new and edited files (blocking I/O), a batch at a time
    let total = to_read.len();
    progress(SyncProgress::Reading { done: 0, total });
    let mut read: Vec<ReadFile> = Vec::with_capacity(to_read.len());
    let mut remaining = to_read.into_iter();
    loop {
        if stop_requested(location_id) {
            return Err(STOPPED.into());
        }
        let batch: Vec<DiskFile> = remaining.by_ref().take(BATCH).collect();
        if batch.is_empty() {
            break;
        }
        let done = tauri::async_runtime::spawn_blocking(move || batch.into_iter().filter_map(read_file).collect::<Vec<_>>())
            .await
            .map_err(|e| e.to_string())?;
        read.extend(done);
        progress(SyncProgress::Reading { done: read.len(), total });
    }
    // Past here it finishes: the changes are written together
    progress(SyncProgress::Saving);

    let (existing, added): (Vec<ReadFile>, Vec<ReadFile>) =
        read.into_iter().partition(|r| known_paths.contains_key(r.disk.path.as_str()));
    let moves = match_moves(&added, &missing);
    let moved_added: HashMap<usize, usize> = moves.iter().copied().collect();
    let moved_missing: std::collections::HashSet<usize> = moves.iter().map(|(_, m)| *m).collect();

    let mut summary = SyncSummary::default();
    let mut new_metadata: Vec<Map<String, Value>> = Vec::new();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Edited files (and legacy records gaining a fingerprint): same record, fresh file details
    for r in &existing {
        let k = known_paths[r.disk.path.as_str()];
        let edited = k.size != Some(r.disk.size) || k.modified != r.disk.modified;
        update_record(&mut tx, k, r).await?;
        if edited {
            summary.updated += 1;
        }
    }
    // Moves: the old record follows the file to its new path
    for (i, r) in added.iter().enumerate() {
        if let Some(&m) = moved_added.get(&i) {
            update_record(&mut tx, &missing[m], r).await?;
            summary.moved += 1;
        }
    }
    // Gone from disk
    for (j, k) in missing.iter().enumerate() {
        if moved_missing.contains(&j) {
            continue;
        }
        sqlx::query("DELETE FROM files WHERE file_id = ?")
            .bind(&k.file_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        summary.removed += 1;
    }
    // New files
    for (i, r) in added.iter().enumerate() {
        if moved_added.contains_key(&i) {
            continue;
        }
        sqlx::query(
            "INSERT OR IGNORE INTO files \
             (file_id, file_path, file_type, timestamp, library, metadata, location_id, \
              relative_path, file_size, modified_at, created_at, tags, fingerprint, online_only, streamed) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&r.disk.path)
        .bind(&r.file_type)
        .bind(&r.disk.modified)
        .bind(&location.library)
        .bind(Value::Object(r.exif.clone()).to_string())
        .bind(location_id)
        .bind(&r.disk.relative_path)
        .bind(r.disk.size)
        .bind(&r.disk.modified)
        .bind(&r.created_at)
        .bind(folder_tags(&r.disk.relative_path))
        .bind(&r.fingerprint)
        .bind(r.disk.online_only)
        .bind(r.disk.streamed)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        summary.added += 1;
        new_metadata.push(r.exif.clone());
    }
    tx.commit().await.map_err(|e| e.to_string())?;

    bootstrap_properties(&location.library, &new_metadata, pool).await?;
    rebuild_tags(location_id, pool).await?;

    // Re-apply the folder mapping so new and moved files are classified (never overwriting edits)
    let mapping_nodes: Vec<crate::commands::path_mapping::PathMappingNode> =
        sqlx::query_as("SELECT * FROM path_mapping_nodes WHERE location_id = ?")
            .bind(location_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
    for node in &mapping_nodes {
        crate::commands::path_mapping::apply_mapping_to_files(
            location_id,
            &location.root_path,
            &node.folder_path,
            &node.property_name,
            pool,
        )
        .await?;
    }

    sqlx::query("UPDATE locations SET last_indexed = ? WHERE location_id = ?")
        .bind(Utc::now().to_rfc3339())
        .bind(location_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(summary)
}

/// Points record `k` at `r` (path, file details, EXIF), keeping the user's metadata.
/// When `r` wasn't read (online-only), the record keeps its EXIF, and its
/// fingerprint too unless the file has changed since it was taken.
async fn update_record(tx: &mut sqlx::SqliteConnection, k: &Known, r: &ReadFile) -> Result<(), String> {
    let (fingerprint, metadata) = if r.contents_read {
        (r.fingerprint.clone(), merge_metadata(k.metadata.as_deref(), &r.exif))
    } else {
        let unchanged = k.size == Some(r.disk.size) && k.modified == r.disk.modified;
        (
            if unchanged { k.fingerprint.clone() } else { None },
            k.metadata.clone().unwrap_or_else(|| "{}".to_string()),
        )
    };
    sqlx::query(
        "UPDATE files SET file_path = ?, relative_path = ?, file_type = ?, timestamp = ?, \
         file_size = ?, modified_at = ?, created_at = ?, fingerprint = ?, metadata = ?, online_only = ?, streamed = ? \
         WHERE file_id = ?",
    )
    .bind(&r.disk.path)
    .bind(&r.disk.relative_path)
    .bind(&r.file_type)
    .bind(&r.disk.modified)
    .bind(r.disk.size)
    .bind(&r.disk.modified)
    .bind(&r.created_at)
    .bind(&fingerprint)
    .bind(&metadata)
    .bind(r.disk.online_only)
    .bind(r.disk.streamed)
    .bind(&k.file_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Recomputes every file's source tags from its folder path: every folder on the
/// path, whether mapped or not (mapped ones show as covered in the table).
async fn rebuild_tags(location_id: &str, pool: &DbPool) -> Result<(), String> {
    let rows = sqlx::query("SELECT file_id, relative_path FROM files WHERE location_id = ? AND relative_path IS NOT NULL")
        .bind(location_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for row in &rows {
        let file_id: String = row.get("file_id");
        let rel_path: String = row.get("relative_path");
        sqlx::query("UPDATE files SET tags = ? WHERE file_id = ?")
            .bind(folder_tags(&rel_path))
            .bind(&file_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(path: &str, size: i64, modified: &str, fp: Option<&str>) -> ReadFile {
        ReadFile {
            disk: DiskFile {
                path: path.into(),
                relative_path: path.trim_start_matches('/').into(),
                size,
                modified: Some(modified.into()),
                online_only: fp.is_none(),
                streamed: false,
            },
            file_type: None,
            created_at: None,
            exif: Map::new(),
            fingerprint: fp.map(Into::into),
            contents_read: fp.is_some(),
        }
    }

    fn known(id: &str, path: &str, size: i64, modified: &str, fp: Option<&str>) -> Known {
        Known {
            file_id: id.into(),
            path: path.into(),
            size: Some(size),
            modified: Some(modified.into()),
            fingerprint: fp.map(Into::into),
            metadata: None,
            online_only: false,
            streamed: false,
        }
    }

    #[test]
    fn a_streamed_drive_decides_whether_a_file_is_read() {
        let mut d = read("/p/a.m4a", 10, "t1", Some("fa")).disk;
        d.set_cloud_state(CloudState::Local);
        assert!(!d.online_only && !d.streamed);
        d.set_cloud_state(CloudState::OnlineOnly);
        assert!(d.online_only && !d.streamed);
        d.set_cloud_state(CloudState::Unknown);
        assert!(!d.online_only && d.streamed);
    }

    #[test]
    fn matches_moves_by_fingerprint() {
        let added = [read("/new/a.pdf", 10, "t1", Some("fa")), read("/new/b.pdf", 20, "t2", Some("fb"))];
        let missing = [known("1", "/old/b-renamed.pdf", 20, "t2", Some("fb"))];
        assert_eq!(match_moves(&added, &missing), vec![(1, 0)]);
    }

    #[test]
    fn falls_back_to_size_and_time_for_records_without_a_fingerprint() {
        let added = [read("/new/a.pdf", 10, "t1", Some("fa"))];
        let missing = [known("1", "/old/a.pdf", 10, "t1", None)];
        assert_eq!(match_moves(&added, &missing), vec![(0, 0)]);
        // A fingerprinted record never matches on size and time alone
        let missing = [known("1", "/old/a.pdf", 10, "t1", Some("other"))];
        assert!(match_moves(&added, &missing).is_empty());
    }

    #[test]
    fn online_only_files_match_fingerprinted_records_by_size_and_time() {
        // Moved in the cloud while online-only: nothing read, so no fingerprint
        let added = [read("/new/report.pdf", 10, "t1", None)];
        let missing = [known("1", "/old/report.pdf", 10, "t1", Some("fa"))];
        assert_eq!(match_moves(&added, &missing), vec![(0, 0)]);
        let elsewhere = [known("1", "/old/report.pdf", 10, "t2", Some("fa"))];
        assert!(match_moves(&added, &elsewhere).is_empty());
    }

    #[test]
    fn identical_copies_pair_by_name_or_not_at_all() {
        let added = [read("/new/x.jpg", 5, "t", Some("same")), read("/new/y.jpg", 5, "t", Some("same"))];
        let missing = [known("1", "/old/y.jpg", 5, "t", Some("same")), known("2", "/old/z.jpg", 5, "t", Some("same"))];
        // y pairs by name; x and z are ambiguous, so x is added and z removed
        assert_eq!(match_moves(&added, &missing), vec![(1, 0)]);
    }

    #[test]
    fn merge_metadata_replaces_file_values_and_keeps_user_values() {
        let mut exif = Map::new();
        exif.insert("camera_make".into(), Value::from("Canon"));
        let merged = merge_metadata(Some(r#"{"camera_make":"Nikon","iso":"100","rig":"Rig-A"}"#), &exif);
        let v: Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(v["camera_make"], "Canon");
        assert!(v.get("iso").is_none());
        assert_eq!(v["rig"], "Rig-A");
    }

    #[test]
    fn fingerprint_is_stable_and_content_sensitive() {
        let dir = std::env::temp_dir().join(format!("fb-fp-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.bin");
        let b = dir.join("b.bin");
        std::fs::write(&a, vec![1u8; 200_000]).unwrap();
        std::fs::write(&b, vec![1u8; 200_000]).unwrap();
        assert_eq!(fingerprint(&a), fingerprint(&b));
        let mut changed = vec![1u8; 200_000];
        changed[199_999] = 2; // in the tail span
        std::fs::write(&b, changed).unwrap();
        assert_ne!(fingerprint(&a), fingerprint(&b));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
