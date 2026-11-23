//! Whether a cloud file is on this Mac, so Folderbase never downloads one by
//! accident: indexing, thumbnails and the live preview only read files that are
//! here, and anything else waits until it's opened or previewed with Quick Look.
//!
//! Three kinds of drive:
//! - **File Provider** (OneDrive, Google Drive, Dropbox, Box, iCloud Drive) and
//!   Windows' Cloud Files (OneDrive, Dropbox, iCloud): the OS marks each file that
//!   isn't downloaded (`ingest::online_only`), so every file has a known state
//! - **Streamed drives** (pCloud Drive, other macFUSE drives, WebDAV mounts): the
//!   drive downloads whatever's read and nothing marks what's here. Where the
//!   drive's own records can be read (pCloud's cache), each file has a known
//!   state; otherwise it's [`CloudState::Unknown`] and treated as not here
//! - Anything else (internal disks, USB drives, network shares): always here

use crate::commands::ingest::online_only;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

/// Whether a file's contents are on this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudState {
    /// On this device: reading it downloads nothing.
    Local,
    /// Known not to be (all or part of it): reading it would download it.
    OnlineOnly,
    /// On a streamed drive that can't say: treated as not here.
    Unknown,
}

impl CloudState {
    /// Whether its contents can be read without downloading anything.
    pub fn readable(self) -> bool {
        self == CloudState::Local
    }
}

/// A drive that streams from the cloud as it's read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamedDrive {
    /// Filesystem type, as `mount` shows it ("pcloudfs").
    pub fs_type: String,
    /// Where it's mounted ("/Users/me/pCloud Drive").
    pub mount: PathBuf,
}

impl StreamedDrive {
    fn is_pcloud(&self) -> bool {
        self.fs_type.eq_ignore_ascii_case("pcloudfs")
    }
}

/// The streamed drive `path` is on, if it's on one. macOS only for now; elsewhere None
/// (pCloud's and Google Drive's own drive letters on Windows come with Windows parity).
pub fn streamed_drive(path: &Path) -> Option<StreamedDrive> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CStr;
        use std::os::unix::ffi::OsStrExt;
        let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
        let mut fs: libc::statfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statfs(c_path.as_ptr(), &mut fs) } != 0 {
            return None;
        }
        // SAFETY: statfs fills both with NUL-terminated strings
        let fs_type = unsafe { CStr::from_ptr(fs.f_fstypename.as_ptr()) }.to_string_lossy().into_owned();
        let mount = unsafe { CStr::from_ptr(fs.f_mntonname.as_ptr()) }.to_string_lossy().into_owned();
        is_streamed_fs_type(&fs_type).then(|| StreamedDrive { fs_type, mount: PathBuf::from(mount) })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        None
    }
}

/// Filesystem type names (as `mount` shows them) of drives that stream from the cloud.
/// Network shares (smbfs, nfs, afpfs) aren't included: their files are really there.
pub fn is_streamed_fs_type(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name == "pcloudfs" || name == "webdav" || name.contains("fuse")
}

/// The state of the file at `path`, asked on its own (a thumbnail, a file added).
/// A file that can't be looked at counts as here: reading it will fail anyway.
pub async fn state_of(path: &Path) -> CloudState {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return CloudState::Local;
    };
    if online_only(&meta) {
        return CloudState::OnlineOnly;
    }
    match streamed_drive(path) {
        None => CloudState::Local,
        Some(drive) => {
            let mut check = DriveCheck::new(drive).await;
            check.state(path, meta.len()).await
        }
    }
}

/// Whether reading the file at `path` could download it.
pub async fn reading_downloads(path: &Path) -> bool {
    !state_of(path).await.readable()
}

/// Checks the files of one streamed drive, remembering what it's looked up, for a
/// whole location at a time (a refresh).
pub struct DriveCheck {
    pcloud: Option<PCloud>,
    mount: PathBuf,
}

impl DriveCheck {
    pub async fn new(drive: StreamedDrive) -> Self {
        let pcloud = if drive.is_pcloud() { pcloud_records().await.map(PCloud::new) } else { None };
        DriveCheck { pcloud, mount: drive.mount }
    }

    /// The state of the file at `path` on this drive, `size` bytes as `stat` says.
    pub async fn state(&mut self, path: &Path, size: u64) -> CloudState {
        let Some(pcloud) = self.pcloud.as_mut() else {
            return CloudState::Unknown;
        };
        let Ok(relative) = path.strip_prefix(&self.mount) else {
            return CloudState::Unknown;
        };
        pcloud.state(relative, size).await
    }
}

/// How often pCloud's database is copied again at most, while it keeps changing.
const SNAPSHOT_EVERY: Duration = Duration::from_secs(15);

/// A copy of pCloud's database, and the state of the original it was taken from.
struct Snapshot {
    pool: SqlitePool,
    /// The copy's file, removed when it's replaced.
    file: PathBuf,
    /// Size and modified time of the database and its WAL when copied.
    stamp: Vec<Option<(u64, SystemTime)>>,
    taken: Instant,
}

static SNAPSHOT: tauri::async_runtime::Mutex<Option<Snapshot>> = tauri::async_runtime::Mutex::const_new(None);

/// pCloud Drive's own database (`~/.pcloud/data.db`). pCloud keeps it locked for
/// itself (SQLite's exclusive locking), so it can't be opened, even read-only, but
/// its files can be read: it's copied into Folderbase's temporary folder and the
/// copy is read. Copied again when the original has changed, at most every
/// [`SNAPSHOT_EVERY`]. A copy caught mid-write that can't be read makes files
/// `Unknown` (treated as not here), never wrongly here for long.
async fn pcloud_records() -> Option<SqlitePool> {
    let db = dirs_home()?.join(".pcloud").join("data.db");
    let mut snapshot = SNAPSHOT.lock().await;
    let stamp = stamps(&db);
    stamp.first()?.as_ref()?; // no pCloud database
    if let Some(current) = snapshot.as_ref() {
        if current.stamp == stamp || current.taken.elapsed() < SNAPSHOT_EVERY {
            return Some(current.pool.clone());
        }
    }
    static TAKEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = TAKEN.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join("folderbase-pcloud");
    let copy = dir.join(format!("data-{}-{n}.db", std::process::id()));
    let (from, to) = (db.clone(), copy.clone());
    let copied = tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir)?;
        copy_database(&from, &to)
    })
    .await;
    if !matches!(copied, Ok(Ok(()))) {
        return snapshot.as_ref().map(|s| s.pool.clone());
    }
    // Read-write, as SQLite brings the copied WAL in on opening; it's only ever read
    let options = SqliteConnectOptions::new().filename(&copy).busy_timeout(Duration::from_millis(500));
    let pool = SqlitePoolOptions::new().max_connections(2).connect_lazy_with(options);
    if let Some(old) = snapshot.replace(Snapshot { pool: pool.clone(), file: copy, stamp, taken: Instant::now() }) {
        old.pool.close().await;
        remove_database(&old.file);
    }
    Some(pool)
}

/// Size and modified time of a database and its WAL (None for one that's missing).
fn stamps(db: &Path) -> Vec<Option<(u64, SystemTime)>> {
    [db.to_path_buf(), with_suffix(db, "-wal")]
        .iter()
        .map(|p| std::fs::metadata(p).ok().and_then(|m| Some((m.len(), m.modified().ok()?))))
        .collect()
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// Copies a SQLite database with its WAL (the changes not yet written into it).
/// The shared-memory index isn't copied: SQLite rebuilds it from the WAL.
fn copy_database(from: &Path, to: &Path) -> std::io::Result<()> {
    remove_database(to);
    std::fs::copy(from, to)?;
    let wal = with_suffix(from, "-wal");
    if wal.exists() {
        std::fs::copy(&wal, with_suffix(to, "-wal"))?;
    }
    Ok(())
}

fn remove_database(db: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(with_suffix(db, suffix));
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// What pCloud's records say about one file: its size and how much of it is cached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CachedFile {
    size: i64,
    cached: i64,
}

/// pCloud Drive keeps the files it's downloaded in a block cache, listed in its
/// database: `folder` and `file` mirror the drive (the top folder is 0), and
/// `pagecache` has a row per cached block of a file's contents (by content hash;
/// `type` 1 for a block in use, 0 for a free one). A file is here when the blocks
/// cached add up to its size. This is pCloud's own format, not a published one:
/// if it can't be read, or doesn't look as expected, files are `Unknown`, so the
/// worst case is treating them as not here.
struct PCloud {
    pool: SqlitePool,
    /// Folder ids by path from the drive's top ("" is 0); None: not in pCloud's records.
    folders: HashMap<String, Option<i64>>,
    /// Each folder's files, looked up once: name → what's cached.
    files: HashMap<i64, HashMap<String, CachedFile>>,
}

impl PCloud {
    fn new(pool: SqlitePool) -> Self {
        PCloud { pool, folders: HashMap::from([(String::new(), Some(0))]), files: HashMap::new() }
    }

    async fn state(&mut self, relative: &Path, size: u64) -> CloudState {
        let Some(name) = relative.file_name().and_then(|n| n.to_str()) else {
            return CloudState::Unknown;
        };
        let folder = relative.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let Some(folder_id) = self.folder_id(&folder).await else {
            // Not in pCloud's records: an encrypted (Crypto) folder, or not uploaded yet
            return CloudState::Unknown;
        };
        if !self.files.contains_key(&folder_id) {
            let listed = folder_files(&self.pool, folder_id).await.unwrap_or_default();
            self.files.insert(folder_id, listed);
        }
        match self.files.get(&folder_id).and_then(|files| files.get(name)) {
            Some(file) => cache_state(*file, size),
            None => CloudState::Unknown,
        }
    }

    /// The id of the folder at `path` (folder names joined by "/"), walking down from the top.
    async fn folder_id(&mut self, path: &str) -> Option<i64> {
        if let Some(id) = self.folders.get(path) {
            return *id;
        }
        let (parent, name) = match path.rsplit_once('/') {
            Some((parent, name)) => (parent.to_string(), name.to_string()),
            None => (String::new(), path.to_string()),
        };
        let parent_id = Box::pin(self.folder_id(&parent)).await;
        let id = match parent_id {
            Some(parent_id) => child_folder(&self.pool, parent_id, &name).await,
            None => None,
        };
        self.folders.insert(path.to_string(), id);
        id
    }
}

/// Here when every byte is cached and the records agree with the disk on its size
/// (a file changed here and not uploaded yet doesn't match, so it can't be told).
fn cache_state(file: CachedFile, disk_size: u64) -> CloudState {
    if file.size != disk_size as i64 {
        CloudState::Unknown
    } else if file.cached >= file.size {
        CloudState::Local
    } else {
        CloudState::OnlineOnly
    }
}

async fn child_folder(pool: &SqlitePool, parent: i64, name: &str) -> Option<i64> {
    sqlx::query_scalar("SELECT id FROM folder WHERE parentfolderid = ? AND name = ?")
        .bind(parent)
        .bind(name)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

/// A folder's files with how many bytes of each are cached. `+p.type` keeps SQLite
/// off the index on `type` (a million rows are in use), so it finds each file's
/// blocks by hash instead: milliseconds rather than seconds a file.
async fn folder_files(pool: &SqlitePool, folder: i64) -> Result<HashMap<String, CachedFile>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT f.name, f.size, \
           (SELECT COALESCE(SUM(p.size), 0) FROM pagecache p WHERE p.hash = f.hash AND +p.type = 1) AS cached \
         FROM file f WHERE f.parentfolderid = ?",
    )
    .bind(folder)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.get::<String, _>("name"), CachedFile { size: r.get("size"), cached: r.get("cached") }))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streamed_drives_are_recognised_by_filesystem_type() {
        assert!(is_streamed_fs_type("pcloudfs"));
        assert!(is_streamed_fs_type("macfuse"));
        assert!(is_streamed_fs_type("osxfuse"));
        assert!(is_streamed_fs_type("webdav"));
        assert!(!is_streamed_fs_type("apfs"));
        assert!(!is_streamed_fs_type("smbfs"));
        assert!(!is_streamed_fs_type("nfs"));
    }

    #[tokio::test]
    async fn local_files_are_here() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        assert_eq!(streamed_drive(&fixtures), None);
        assert_eq!(state_of(&fixtures.join("sample.jpg")).await, CloudState::Local);
        assert!(!reading_downloads(&fixtures.join("sample.jpg")).await);
        // Can't be looked at: reading it fails anyway, so nothing to protect
        assert_eq!(state_of(&fixtures.join("no-such-file")).await, CloudState::Local);
    }

    #[tokio::test]
    async fn a_copied_database_includes_changes_still_in_its_wal() {
        let dir = std::env::temp_dir().join(format!("fb-cloud-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let original = dir.join("data.db");
        // The original stays open, as pCloud keeps it, with its last change only in the WAL
        let options = SqliteConnectOptions::new()
            .filename(&original)
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
        let writer = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
        sqlx::query("PRAGMA wal_autocheckpoint = 0").execute(&writer).await.unwrap();
        sqlx::query("CREATE TABLE folder (id INTEGER PRIMARY KEY, parentfolderid INTEGER, name TEXT)").execute(&writer).await.unwrap();
        sqlx::query("INSERT INTO folder VALUES (10, 0, 'Documents')").execute(&writer).await.unwrap();
        assert!(with_suffix(&original, "-wal").exists());

        let copy = dir.join("copy.db");
        copy_database(&original, &copy).unwrap();
        let reader = SqlitePoolOptions::new().connect_with(SqliteConnectOptions::new().filename(&copy)).await.unwrap();
        assert_eq!(child_folder(&reader, 0, "Documents").await, Some(10));
        reader.close().await;
        writer.close().await;
        remove_database(&copy);
        assert!(!copy.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_is_here_when_all_of_it_is_cached() {
        assert_eq!(cache_state(CachedFile { size: 27_327_641, cached: 27_327_641 }, 27_327_641), CloudState::Local);
        // The start and end only: what playing the first seconds leaves
        assert_eq!(cache_state(CachedFile { size: 27_327_641, cached: 1_347_225 }, 27_327_641), CloudState::OnlineOnly);
        assert_eq!(cache_state(CachedFile { size: 500, cached: 0 }, 500), CloudState::OnlineOnly);
        assert_eq!(cache_state(CachedFile { size: 0, cached: 0 }, 0), CloudState::Local);
        // Changed here and not uploaded yet: the records are behind
        assert_eq!(cache_state(CachedFile { size: 500, cached: 500 }, 900), CloudState::Unknown);
    }

    /// pCloud's tables, as far as they're read.
    async fn pcloud_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE folder (id INTEGER PRIMARY KEY, parentfolderid INTEGER, name TEXT)",
            "CREATE TABLE file (id INTEGER PRIMARY KEY, parentfolderid INTEGER, size INTEGER, hash INTEGER, name TEXT)",
            "CREATE TABLE pagecache (id INTEGER PRIMARY KEY, hash INTEGER, pageid INTEGER, type INTEGER, size INTEGER)",
            "INSERT INTO folder VALUES (10, 0, 'Documents'), (11, 10, 'Church')",
            "INSERT INTO file VALUES (1, 11, 10000, 77, 'Hope.m4a'), (2, 11, 5000, 88, 'Notes.pdf'), (3, 0, 4096, 77, 'Top.txt')",
            // Hope.m4a: its first block and its last; Notes.pdf: both of its blocks; a free block
            "INSERT INTO pagecache VALUES (1, 77, 0, 1, 4096), (2, 77, 2, 1, 1808), (3, 88, 0, 1, 4096), (4, 88, 1, 1, 904), (5, 0, 0, 0, 4096)",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }
        pool
    }

    #[tokio::test]
    async fn pcloud_files_are_looked_up_by_path_from_the_top() {
        let mut pcloud = PCloud::new(pcloud_db().await);
        assert_eq!(pcloud.state(Path::new("Documents/Church/Notes.pdf"), 5000).await, CloudState::Local);
        assert_eq!(pcloud.state(Path::new("Documents/Church/Hope.m4a"), 10000).await, CloudState::OnlineOnly);
        assert_eq!(pcloud.state(Path::new("Top.txt"), 4096).await, CloudState::Local);
    }

    #[tokio::test]
    async fn files_pcloud_has_no_record_of_are_unknown() {
        let mut pcloud = PCloud::new(pcloud_db().await);
        // Not uploaded yet, or in an encrypted folder whose names are scrambled
        assert_eq!(pcloud.state(Path::new("Documents/Church/New.docx"), 10).await, CloudState::Unknown);
        assert_eq!(pcloud.state(Path::new("Crypto Folder/a.txt"), 10).await, CloudState::Unknown);
    }

    #[tokio::test]
    async fn unreadable_records_make_every_file_unknown() {
        // A pCloud update changed its tables: nothing is treated as here
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let mut pcloud = PCloud::new(pool);
        assert_eq!(pcloud.state(Path::new("Top.txt"), 4096).await, CloudState::Unknown);
    }
}
