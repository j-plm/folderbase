//! Backups of the database (Settings ▸ Advanced, File ▸ Back Up Database… and
//! Restore from Backup…), and the automatic ones.
//!
//! A backup is one zip ("Folderbase Backup 2026-11-23 14.05.zip") holding:
//! - `folderbase.db`: made by SQLite (`VACUUM INTO`) on the app's own pool, so
//!   changes still in the write-ahead log are in it. Copying the `.db` file
//!   alone would silently lose them
//! - `settings.json`: as it is on disk
//! - `manifest.json`: format version, app version, when, which machine, and
//!   each location's name and folder, so a restore can say which it expects
//!
//! A zip is written under a hidden name and renamed at the end, so a half-written
//! backup never shows. Automatic backups prune the folder to the newest 7 (or 4
//! weekly), touching only files named by our own pattern.
//!
//! Restoring can't swap the database under the open pool, so `restore_impl`
//! checks the backup, makes a "Before Restore" backup of how things are now,
//! and puts the backup's files beside the real ones (`*.restore`). The app then
//! restarts, and `apply_staged_restore` swaps them in before the pool opens;
//! the usual migrations bring an older backup up to date.

use crate::commands::settings::{self, AppSettings, BackupSettings};
use crate::db::DbPool;
use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// The backup format this build writes; it restores this one and any before it.
pub const FORMAT_VERSION: u32 = 1;
pub const DB_FILE: &str = "folderbase.db";
const SETTINGS_ENTRY: &str = "settings.json";
const MANIFEST_ENTRY: &str = "manifest.json";
/// Every backup's name starts so; automatic ones continue with the date only.
const PREFIX: &str = "Folderbase Backup ";
const BEFORE_RESTORE: &str = "Before Restore ";
/// A restored database and settings waiting for the next launch.
pub const STAGED_DB: &str = "folderbase.db.restore";
pub const STAGED_SETTINGS: &str = "settings.json.restore";

/// Sent to every window as a backup starts and ends (the main window shows it as a notice).
pub const STATUS_EVENT: &str = "backup-status";
/// Sent to the main window when an automatic backup went to the app data folder
/// and Folderbase hasn't yet asked where backups should go.
pub const FOLDER_WANTED_EVENT: &str = "backup-folder-wanted";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManifestLocation {
    pub name: String,
    pub root_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub format_version: u32,
    pub app_version: String,
    /// RFC 3339, with this machine's offset.
    pub created_at: String,
    pub machine: String,
    pub locations: Vec<ManifestLocation>,
}

/// What Restore from Backup… shows before asking.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BackupInfo {
    pub manifest: Manifest,
    /// Locations whose folder isn't on this Mac.
    pub missing: Vec<ManifestLocation>,
}

// ---------------------------------------------------------------------------
// Names and pruning

/// "Folderbase Backup 2026-11-23 14.05.zip"
pub fn backup_file_name(now: DateTime<Local>) -> String {
    format!("{PREFIX}{}.zip", now.format("%Y-%m-%d %H.%M"))
}

/// "Folderbase Backup Before Restore 2026-11-23 14.05.zip": never pruned.
pub fn before_restore_file_name(now: DateTime<Local>) -> String {
    format!("{PREFIX}{BEFORE_RESTORE}{}.zip", now.format("%Y-%m-%d %H.%M"))
}

/// For a name `backup_file_name` made (numbered "… 2.zip" when taken): its
/// date and number, for ordering. None for anything else.
fn automatic_name_key(name: &str) -> Option<(String, u32)> {
    let rest = name.strip_prefix(PREFIX)?.strip_suffix(".zip")?;
    let stamp = rest.get(..16)?;
    let shape_ok = stamp.chars().enumerate().all(|(i, c)| match i {
        4 | 7 => c == '-',
        10 => c == ' ',
        13 => c == '.',
        _ => c.is_ascii_digit(),
    });
    if !shape_ok {
        return None;
    }
    let number = match &rest[16..] {
        "" => 1,
        tail => {
            let digits = tail.strip_prefix(' ')?;
            if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            digits.parse().ok()?
        }
    };
    Some((stamp.to_string(), number))
}

/// Removes all but the newest `keep` automatic backups in `folder` (by our own
/// file names only; nothing else there is touched). Resolves to what it removed.
pub fn prune(folder: &Path, keep: usize) -> Result<Vec<PathBuf>, String> {
    let mut ours: Vec<((String, u32), PathBuf)> = std::fs::read_dir(folder)
        .map_err(|e| format!("{}: {e}", folder.display()))?
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| automatic_name_key(&e.file_name().to_string_lossy()).map(|key| (key, e.path())))
        .collect();
    ours.sort_by(|a, b| b.0.cmp(&a.0));
    let mut removed = Vec::new();
    for (_, path) in ours.into_iter().skip(keep) {
        std::fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        removed.push(path);
    }
    Ok(removed)
}

/// Whether an automatic backup is due: never when switched off, else when the
/// last one is older than the interval (an hour early is fine, as it's checked hourly).
pub fn is_due(backup: &BackupSettings, now: DateTime<Utc>) -> bool {
    let Some(interval) = backup.schedule.interval() else { return false };
    let last = backup.last_backup.as_deref().and_then(|t| DateTime::parse_from_rfc3339(t).ok());
    match last {
        None => true,
        Some(last) => now.signed_duration_since(last.with_timezone(&Utc)) >= interval - chrono::Duration::hours(1),
    }
}

// ---------------------------------------------------------------------------
// Making a backup

/// The database as it is now, changes in the write-ahead log included, as one
/// file at `dest` (which mustn't exist).
pub async fn snapshot(pool: &DbPool, dest: &Path) -> Result<(), String> {
    sqlx::query("VACUUM INTO ?")
        .bind(dest.to_string_lossy().into_owned())
        .execute(pool)
        .await
        .map_err(|e| format!("Couldn’t copy the database: {e}"))?;
    Ok(())
}

/// The hidden file a zip is written to before it takes its name.
fn partial_path(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    target.with_file_name(format!(".{name}.part"))
}

/// Writes the backup zip at `target` from a database file, the settings file's
/// bytes (when there is one) and the manifest.
pub fn write_backup_zip(target: &Path, db_file: &Path, settings_json: Option<&[u8]>, manifest: &Manifest) -> Result<(), String> {
    let partial = partial_path(target);
    let result = (|| {
        let file = std::fs::File::create(&partial).map_err(|e| format!("{}: {e}", partial.display()))?;
        let mut zip = ZipWriter::new(std::io::BufWriter::new(file));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        zip.start_file(MANIFEST_ENTRY, options).map_err(|e| e.to_string())?;
        let manifest_json = serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?;
        zip.write_all(&manifest_json).map_err(|e| e.to_string())?;

        if let Some(bytes) = settings_json {
            zip.start_file(SETTINGS_ENTRY, options).map_err(|e| e.to_string())?;
            zip.write_all(bytes).map_err(|e| e.to_string())?;
        }

        let size = std::fs::metadata(db_file).map_err(|e| e.to_string())?.len();
        zip.start_file(DB_FILE, options.large_file(size >= u32::MAX as u64)).map_err(|e| e.to_string())?;
        let mut source = std::fs::File::open(db_file).map_err(|e| format!("{}: {e}", db_file.display()))?;
        std::io::copy(&mut source, &mut zip).map_err(|e| e.to_string())?;

        let mut out = zip.finish().map_err(|e| e.to_string())?;
        out.flush().map_err(|e| e.to_string())?;
        out.get_ref().sync_all().map_err(|e| e.to_string())?;
        Ok(())
    })();
    match result {
        Ok(()) => std::fs::rename(&partial, target).map_err(|e| format!("{}: {e}", target.display())),
        Err(e) => {
            let _ = std::fs::remove_file(&partial);
            Err(e)
        }
    }
}

/// A folder of its own in the system's temporary folder, removed when dropped.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Result<Self, String> {
        let dir = std::env::temp_dir().join(format!("folderbase-backup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(Self(dir))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Who and what made a backup, for its manifest.
#[derive(Debug, Clone)]
pub struct Maker {
    pub app_version: String,
    pub machine: String,
}

/// Backs up the database in `pool` and the settings in `settings_dir` into a zip at `target`.
pub async fn make_backup(pool: &DbPool, settings_dir: &Path, target: &Path, maker: &Maker) -> Result<(), String> {
    let locations = crate::commands::locations::get_locations_impl(pool)
        .await?
        .into_iter()
        .map(|l| ManifestLocation { name: l.name, root_path: l.root_path })
        .collect();
    let manifest = Manifest {
        format_version: FORMAT_VERSION,
        app_version: maker.app_version.clone(),
        created_at: Local::now().to_rfc3339(),
        machine: maker.machine.clone(),
        locations,
    };
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let scratch = Scratch::new()?;
    let db_copy = scratch.0.join(DB_FILE);
    snapshot(pool, &db_copy).await?;
    let settings_json = std::fs::read(settings_dir.join("settings.json")).ok();
    let target = target.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let written = write_backup_zip(&target, &db_copy, settings_json.as_deref(), &manifest);
        drop(scratch);
        written
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Checking and restoring

fn not_a_backup(path: &Path) -> String {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    format!("“{name}” isn’t a Folderbase backup.")
}

/// Checks a backup zip and copies its database to `db_dest`: a zip, with our
/// manifest in a format this build knows, and a database that opens and has
/// Folderbase's tables. Resolves to the manifest and the settings file's bytes.
/// Nothing is left at `db_dest` when it fails.
pub async fn read_backup(zip_path: &Path, db_dest: &Path) -> Result<(Manifest, Option<Vec<u8>>), String> {
    let result = read_backup_inner(zip_path, db_dest).await;
    if result.is_err() {
        let _ = std::fs::remove_file(db_dest);
    }
    result
}

async fn read_backup_inner(zip_path: &Path, db_dest: &Path) -> Result<(Manifest, Option<Vec<u8>>), String> {
    let (manifest, settings_json) = {
        let file = std::fs::File::open(zip_path).map_err(|e| format!("{}: {e}", zip_path.display()))?;
        let mut archive = ZipArchive::new(file).map_err(|_| not_a_backup(zip_path))?;

        let manifest: Manifest = {
            let mut entry = archive.by_name(MANIFEST_ENTRY).map_err(|_| not_a_backup(zip_path))?;
            let mut text = String::new();
            entry.read_to_string(&mut text).map_err(|_| not_a_backup(zip_path))?;
            serde_json::from_str(&text).map_err(|_| not_a_backup(zip_path))?
        };
        if manifest.format_version == 0 {
            return Err(not_a_backup(zip_path));
        }
        if manifest.format_version > FORMAT_VERSION {
            return Err(format!(
                "This backup was made by a newer version of Folderbase ({}). Update Folderbase to restore it.",
                manifest.app_version
            ));
        }

        let settings_json = match archive.by_name(SETTINGS_ENTRY) {
            Ok(mut entry) => {
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
                Some(bytes)
            }
            Err(_) => None,
        };

        let mut entry = archive.by_name(DB_FILE).map_err(|_| "This backup has no database in it.".to_string())?;
        let mut out = std::fs::File::create(db_dest).map_err(|e| format!("{}: {e}", db_dest.display()))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        out.sync_all().map_err(|e| e.to_string())?;
        (manifest, settings_json)
    };
    check_database(db_dest).await?;
    Ok((manifest, settings_json))
}

/// The database at `path` opens, passes SQLite's quick check, and has locations in it.
async fn check_database(path: &Path) -> Result<(), String> {
    const DAMAGED: &str = "The database in this backup is damaged, so it can’t be restored.";
    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(path).read_only(true);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|_| DAMAGED.to_string())?;
    let checked = async {
        let (check,): (String,) = sqlx::query_as("PRAGMA quick_check").fetch_one(&pool).await.ok()?;
        let (tables,): (i64,) = sqlx::query_as("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('files', 'locations')")
            .fetch_one(&pool)
            .await
            .ok()?;
        Some(check == "ok" && tables == 2)
    }
    .await;
    pool.close().await;
    match checked {
        Some(true) => Ok(()),
        _ => Err(DAMAGED.to_string()),
    }
}

/// The manifest's locations whose folder isn't on this machine.
pub fn missing_locations(manifest: &Manifest) -> Vec<ManifestLocation> {
    manifest.locations.iter().filter(|l| !Path::new(&l.root_path).is_dir()).cloned().collect()
}

/// Checks a backup and says what's in it (Restore from Backup… asks with this).
pub async fn inspect(zip_path: &Path) -> Result<BackupInfo, String> {
    let scratch = Scratch::new()?;
    let (manifest, _) = read_backup(zip_path, &scratch.0.join(DB_FILE)).await?;
    Ok(BackupInfo { missing: missing_locations(&manifest), manifest })
}

/// Where things are, for a restore.
pub struct RestorePlaces<'a> {
    /// The app data folder, holding `folderbase.db`.
    pub data_dir: &'a Path,
    /// The config folder, holding `settings.json`.
    pub config_dir: &'a Path,
    /// Where the "Before Restore" backup goes.
    pub backup_folder: &'a Path,
}

/// Restore, up to the restart: checks the backup, backs up how things are now
/// into the backup folder (before anything is replaced), then puts the backup's
/// database and settings beside the real ones for `apply_staged_restore`. The
/// settings keep this Mac's backup choices. Resolves to the "Before Restore" backup.
pub async fn restore_impl(pool: &DbPool, zip_path: &Path, places: &RestorePlaces<'_>, maker: &Maker) -> Result<PathBuf, String> {
    let staged_db = places.data_dir.join(STAGED_DB);
    let partial_db = partial_path(&staged_db);
    let (_, settings_json) = read_backup(zip_path, &partial_db).await?;

    let safety = (|| {
        std::fs::create_dir_all(places.backup_folder).map_err(|e| format!("{}: {e}", places.backup_folder.display()))?;
        let name = before_restore_file_name(Local::now());
        Ok::<_, String>(crate::commands::import::unique_path(places.backup_folder, name.as_ref()))
    })();
    let safety = match safety {
        Ok(path) => path,
        Err(e) => {
            let _ = std::fs::remove_file(&partial_db);
            return Err(e);
        }
    };
    if let Err(e) = make_backup(pool, places.config_dir, &safety, maker).await {
        let _ = std::fs::remove_file(&partial_db);
        return Err(format!("Nothing was restored, as the current database couldn’t be backed up first. {e}"));
    }

    // Settings first; the database's rename is what makes the restore happen at the next launch
    if let Some(bytes) = settings_json {
        let current: BackupSettings = settings::load(places.config_dir).backup;
        let staged = merged_settings(&bytes, &current)?;
        std::fs::create_dir_all(places.config_dir).map_err(|e| e.to_string())?;
        std::fs::write(places.config_dir.join(STAGED_SETTINGS), staged).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&partial_db, &staged_db).map_err(|e| e.to_string())?;
    Ok(safety)
}

/// A backup's settings file with this Mac's backup choices in place of its own
/// (where backups go is about this Mac, and the backup just made went there).
fn merged_settings(bytes: &[u8], current: &BackupSettings) -> Result<Vec<u8>, String> {
    let mut value: serde_json::Value = serde_json::from_slice(bytes).unwrap_or_else(|_| serde_json::json!({}));
    if !value.is_object() {
        value = serde_json::json!({});
    }
    value["backup"] = serde_json::to_value(current).map_err(|e| e.to_string())?;
    // Read back as settings, so a backup's odd values fall to their defaults rather than fail the launch
    let settings: AppSettings = serde_json::from_value(value).unwrap_or_else(|_| AppSettings { backup: current.clone(), ..AppSettings::default() });
    let mut text = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    text.push(b'\n');
    Ok(text)
}

/// At launch, before the database opens: swaps in a restored database (dropping
/// the old one's write-ahead log) and settings, if a restore left them. True if it did.
pub fn apply_staged_restore(data_dir: &Path, config_dir: &Path) -> Result<bool, String> {
    let staged_db = data_dir.join(STAGED_DB);
    let staged_settings = config_dir.join(STAGED_SETTINGS);
    if !staged_db.exists() {
        // Settings without a database: a restore that didn't finish
        let _ = std::fs::remove_file(&staged_settings);
        return Ok(false);
    }
    let db = data_dir.join(DB_FILE);
    for suffix in ["-wal", "-shm"] {
        match std::fs::remove_file(format!("{}{suffix}", db.display())) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    std::fs::rename(&staged_db, &db).map_err(|e| e.to_string())?;
    if staged_settings.exists() {
        std::fs::rename(&staged_settings, config_dir.join("settings.json")).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

// ---------------------------------------------------------------------------
// Commands

/// This computer's name as the Sharing settings show it ("Sam’s MacBook Pro").
pub fn machine_name() -> String {
    let run = |cmd: &str, args: &[&str]| {
        std::process::Command::new(cmd)
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    };
    #[cfg(target_os = "macos")]
    if let Some(name) = run("scutil", &["--get", "ComputerName"]) {
        return name;
    }
    std::env::var("COMPUTERNAME").ok().or_else(|| run("hostname", &[])).unwrap_or_else(|| "this computer".into())
}

fn maker(app: &tauri::AppHandle) -> Maker {
    Maker { app_version: app.package_info().version.to_string(), machine: machine_name() }
}

struct Dirs {
    data: PathBuf,
    config: PathBuf,
    folder: PathBuf,
}

async fn dirs(app: &tauri::AppHandle, pool: &DbPool) -> Result<Dirs, String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let config = settings::settings_dir(app, pool).await?;
    let folder = settings::backup_folder(&config, &data);
    Ok(Dirs { data, config, folder })
}

/// A backup starting or ending, for the main window's notice.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum BackupStatus {
    Running { job: String, before_restore: bool },
    Done { job: String, path: String },
    Failed { job: String, error: String },
}

/// Makes a backup at `target` and records it, telling every window as it goes
/// (when `notify`). Automatic backups then prune the folder.
async fn run_backup(app: &tauri::AppHandle, pool: &DbPool, config: &Path, target: &Path, notify: bool) -> Result<(), String> {
    let job = uuid::Uuid::new_v4().to_string();
    if notify {
        let _ = app.emit(STATUS_EVENT, BackupStatus::Running { job: job.clone(), before_restore: false });
    }
    let made = make_backup(pool, config, target, &maker(app)).await;
    match &made {
        Ok(()) => {
            if let Ok(s) = settings::record_backup(config, Utc::now()) {
                settings::changed(app, s);
            }
            if notify {
                let _ = app.emit(STATUS_EVENT, BackupStatus::Done { job, path: target.to_string_lossy().into_owned() });
            }
        }
        Err(e) => {
            if notify {
                let _ = app.emit(STATUS_EVENT, BackupStatus::Failed { job, error: e.clone() });
            }
        }
    }
    made
}

/// Where Back Up Database…'s save panel starts: a new backup's name in the backup folder.
#[tauri::command]
pub async fn backup_suggestion(app: tauri::AppHandle, db: State<'_, DbPool>) -> Result<String, String> {
    let dirs = dirs(&app, db.inner()).await?;
    Ok(dirs.folder.join(backup_file_name(Local::now())).to_string_lossy().into_owned())
}

/// Back Up Database…: a backup at `destination` (from a save panel), else in the
/// backup folder. Resolves to its path.
#[tauri::command]
pub async fn back_up_database(destination: Option<String>, app: tauri::AppHandle, db: State<'_, DbPool>) -> Result<String, String> {
    let dirs = dirs(&app, db.inner()).await?;
    let target = match destination {
        Some(d) => PathBuf::from(d),
        None => {
            std::fs::create_dir_all(&dirs.folder).map_err(|e| e.to_string())?;
            crate::commands::import::unique_path(&dirs.folder, backup_file_name(Local::now()).as_ref())
        }
    };
    run_backup(&app, db.inner(), &dirs.config, &target, true).await?;
    Ok(target.to_string_lossy().into_owned())
}

/// Checks a backup for Restore from Backup…, saying when and where it was made
/// and which of its locations' folders aren't here.
#[tauri::command]
pub async fn inspect_backup(path: String) -> Result<BackupInfo, String> {
    inspect(Path::new(&path)).await
}

/// Restore from Backup…, once confirmed: backs up how things are now, puts the
/// backup in place and restarts Folderbase, which finishes the swap as it opens.
#[tauri::command]
pub async fn restore_from_backup(path: String, app: tauri::AppHandle, db: State<'_, DbPool>) -> Result<(), String> {
    let dirs = dirs(&app, db.inner()).await?;
    let job = uuid::Uuid::new_v4().to_string();
    let _ = app.emit(STATUS_EVENT, BackupStatus::Running { job: job.clone(), before_restore: true });
    let places = RestorePlaces { data_dir: &dirs.data, config_dir: &dirs.config, backup_folder: &dirs.folder };
    match restore_impl(db.inner(), Path::new(&path), &places, &maker(&app)).await {
        Ok(_) => {
            db.inner().close().await;
            app.restart();
        }
        Err(e) => {
            let _ = app.emit(STATUS_EVENT, BackupStatus::Failed { job, error: e.clone() });
            Err(e)
        }
    }
}

/// One automatic check: makes a backup if one is due and there's something to
/// back up, prunes the folder, and asks (once) where backups should go.
async fn scheduled_check(app: &tauri::AppHandle) -> Result<(), String> {
    let pool = app.state::<DbPool>().inner().clone();
    let dirs = dirs(app, &pool).await?;
    let current = settings::load(&dirs.config);
    if !is_due(&current.backup, Utc::now()) {
        return Ok(());
    }
    if crate::commands::locations::get_locations_impl(&pool).await?.is_empty() {
        return Ok(());
    }
    std::fs::create_dir_all(&dirs.folder).map_err(|e| e.to_string())?;
    let target = crate::commands::import::unique_path(&dirs.folder, backup_file_name(Local::now()).as_ref());
    run_backup(app, &pool, &dirs.config, &target, false).await?;
    prune(&dirs.folder, current.backup.schedule.keep())?;
    if current.backup.folder.is_none() && !current.backup.folder_asked {
        let _ = app.emit_to("main", FOLDER_WANTED_EVENT, ());
    }
    Ok(())
}

/// Automatic backups: checked a minute after launch, then every hour.
pub fn start_schedule(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(60));
        loop {
            if let Err(e) = tauri::async_runtime::block_on(scheduled_check(&app)) {
                eprintln!("automatic backup: {e}");
            }
            std::thread::sleep(std::time::Duration::from_secs(60 * 60));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("folderbase-backup-test-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn names_carry_the_date_and_minute() {
        let at = Local.with_ymd_and_hms(2026, 11, 23, 14, 5, 9).unwrap();
        assert_eq!(backup_file_name(at), "Folderbase Backup 2026-11-23 14.05.zip");
        assert_eq!(before_restore_file_name(at), "Folderbase Backup Before Restore 2026-11-23 14.05.zip");
    }

    #[test]
    fn only_our_own_automatic_names_are_recognised() {
        assert_eq!(automatic_name_key("Folderbase Backup 2026-11-23 14.05.zip"), Some(("2026-11-23 14.05".into(), 1)));
        assert_eq!(automatic_name_key("Folderbase Backup 2026-11-23 14.05 3.zip"), Some(("2026-11-23 14.05".into(), 3)));
        for other in [
            "Folderbase Backup Before Restore 2026-11-23 14.05.zip",
            "Folderbase Backup 2026-11-23 14.05 copy.zip",
            "Folderbase Backup 2026-11-23 14.05.zip.part",
            "Folderbase Backup 2026-11-23.zip",
            "Folderbase Backup 2026-1x-23 14.05.zip",
            "Folderbase Backup 2026-11-23 14.05 .zip",
            "Holiday photos.zip",
            "",
        ] {
            assert_eq!(automatic_name_key(other), None, "{other:?}");
        }
    }

    #[test]
    fn pruning_keeps_the_newest_and_leaves_everything_else_alone() {
        let dir = scratch("prune");
        let ours = [
            "Folderbase Backup 2026-11-20 09.00.zip",
            "Folderbase Backup 2026-11-21 09.00.zip",
            "Folderbase Backup 2026-11-22 09.00.zip",
            "Folderbase Backup 2026-11-22 09.00 2.zip",
            "Folderbase Backup 2026-11-23 09.00.zip",
        ];
        let others = ["Folderbase Backup Before Restore 2026-11-01 10.00.zip", "Notes.txt", "Folderbase Backup mine.zip"];
        for name in ours.iter().chain(&others) {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        std::fs::create_dir(dir.join("Folderbase Backup 2026-01-01 00.00.zip")).unwrap(); // a folder, oddly named

        let mut removed: Vec<String> = prune(&dir, 3).unwrap().iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        removed.sort();
        assert_eq!(removed, ["Folderbase Backup 2026-11-20 09.00.zip", "Folderbase Backup 2026-11-21 09.00.zip"]);
        for kept in ours[2..].iter().chain(&others) {
            assert!(dir.join(kept).exists(), "{kept} should be kept");
        }
        assert!(dir.join("Folderbase Backup 2026-01-01 00.00.zip").is_dir());
        // Fewer than `keep`: nothing goes
        assert!(prune(&dir, 7).unwrap().is_empty());
    }

    #[test]
    fn a_backup_is_due_once_the_interval_has_passed() {
        let now = Utc.with_ymd_and_hms(2026, 11, 23, 12, 0, 0).unwrap();
        let with = |schedule, last: Option<DateTime<Utc>>| BackupSettings {
            schedule,
            last_backup: last.map(|l| l.to_rfc3339()),
            ..BackupSettings::default()
        };
        use crate::commands::settings::BackupSchedule::*;
        assert!(is_due(&with(Daily, None), now));
        assert!(!is_due(&with(Never, None), now));
        assert!(!is_due(&with(Daily, Some(now - chrono::Duration::hours(3))), now));
        assert!(is_due(&with(Daily, Some(now - chrono::Duration::hours(23))), now)); // an hour early is fine
        assert!(is_due(&with(Daily, Some(now - chrono::Duration::days(2))), now));
        assert!(!is_due(&with(Weekly, Some(now - chrono::Duration::days(3))), now));
        assert!(is_due(&with(Weekly, Some(now - chrono::Duration::days(7))), now));
        // A time that can't be read: back up rather than never
        let odd = BackupSettings { last_backup: Some("yesterday".into()), ..BackupSettings::default() };
        assert!(is_due(&odd, now));
    }

    #[test]
    fn restored_settings_keep_this_macs_backup_choices() {
        let current = BackupSettings { folder: Some("/Users/sam/pCloud".into()), folder_asked: true, ..BackupSettings::default() };
        let theirs = br#"{"zip_folder": "/Users/old/Zips", "show_hidden_files": true, "backup": {"folder": "/elsewhere", "schedule": "never"}}"#;
        let merged: AppSettings = serde_json::from_slice(&merged_settings(theirs, &current).unwrap()).unwrap();
        assert!(merged.show_hidden_files);
        assert_eq!(merged.zip_folder.as_deref(), Some("/Users/old/Zips"));
        assert_eq!(merged.backup, current);
        // Unreadable settings in a backup: defaults, with this Mac's backups
        let merged: AppSettings = serde_json::from_slice(&merged_settings(b"nonsense", &current).unwrap()).unwrap();
        assert_eq!(merged, AppSettings { backup: current, ..AppSettings::default() });
    }

    #[test]
    fn a_staged_restore_replaces_the_database_and_drops_its_log() {
        let data = scratch("apply-data");
        let config = scratch("apply-config");
        std::fs::write(data.join(DB_FILE), b"old").unwrap();
        std::fs::write(data.join("folderbase.db-wal"), b"old log").unwrap();
        std::fs::write(data.join("folderbase.db-shm"), b"old shm").unwrap();
        std::fs::write(config.join("settings.json"), b"{}").unwrap();
        // Nothing staged: nothing happens
        assert!(!apply_staged_restore(&data, &config).unwrap());
        assert_eq!(std::fs::read(data.join(DB_FILE)).unwrap(), b"old");

        std::fs::write(data.join(STAGED_DB), b"restored").unwrap();
        std::fs::write(config.join(STAGED_SETTINGS), b"{\"on_launch\":\"first\"}").unwrap();
        assert!(apply_staged_restore(&data, &config).unwrap());
        assert_eq!(std::fs::read(data.join(DB_FILE)).unwrap(), b"restored");
        assert!(!data.join("folderbase.db-wal").exists());
        assert!(!data.join("folderbase.db-shm").exists());
        assert!(!data.join(STAGED_DB).exists());
        assert_eq!(std::fs::read_to_string(config.join("settings.json")).unwrap(), "{\"on_launch\":\"first\"}");
    }

    #[test]
    fn staged_settings_without_a_database_are_thrown_away() {
        let data = scratch("apply-half-data");
        let config = scratch("apply-half-config");
        std::fs::write(config.join("settings.json"), b"{}").unwrap();
        std::fs::write(config.join(STAGED_SETTINGS), b"{\"on_launch\":\"first\"}").unwrap();
        assert!(!apply_staged_restore(&data, &config).unwrap());
        assert!(!config.join(STAGED_SETTINGS).exists());
        assert_eq!(std::fs::read(config.join("settings.json")).unwrap(), b"{}");
    }
}
