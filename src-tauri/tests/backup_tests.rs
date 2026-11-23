mod common;

use folderbase_lib::commands::backup::{
    apply_staged_restore, inspect, make_backup, read_backup, restore_impl, snapshot, write_backup_zip, Maker, Manifest, RestorePlaces,
    DB_FILE, FORMAT_VERSION, STAGED_DB, STAGED_SETTINGS,
};
use folderbase_lib::commands::settings::{self, AppSettings, BackupSettings};
use folderbase_lib::db::DbPool;
use std::io::Write;
use std::path::Path;

fn maker() -> Maker {
    Maker { app_version: "0.1.0".into(), machine: "Test Mac".into() }
}

async fn add_location(pool: &DbPool, name: &str, root: &str) {
    sqlx::query("INSERT INTO locations (location_id, name, root_path, library, added_at) VALUES (?, ?, ?, ?, '2026-11-23T00:00:00Z')")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(name)
        .bind(root)
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
}

async fn location_names(path: &Path) -> Vec<String> {
    let pool = sqlx::SqlitePool::connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(path).read_only(true)).await.unwrap();
    let names: Vec<(String,)> = sqlx::query_as("SELECT name FROM locations ORDER BY name").fetch_all(&pool).await.unwrap();
    pool.close().await;
    names.into_iter().map(|(n,)| n).collect()
}

fn manifest(version: u32) -> Manifest {
    Manifest { format_version: version, app_version: "9.9.9".into(), created_at: "2026-11-23T14:05:00+00:00".into(), machine: "Sam’s Mac".into(), locations: vec![] }
}

#[tokio::test]
async fn a_backup_includes_changes_still_in_the_write_ahead_log() {
    let dir = common::temp_dir("backup-wal");
    let pool = common::setup_file_db(&dir.join(DB_FILE)).await;
    add_location(&pool, "Documents", "/Users/sam/Documents").await;
    add_location(&pool, "Photos", "/Users/sam/Pictures").await;

    // The pool stays open, so the rows are still in the log, not the .db
    let wal = std::fs::metadata(dir.join("folderbase.db-wal")).map(|m| m.len()).unwrap_or(0);
    assert!(wal > 0, "the changes should be in the log");
    let plain_copy = dir.join("plain copy.db");
    std::fs::copy(dir.join(DB_FILE), &plain_copy).unwrap();
    let in_plain_copy = sqlx::SqlitePool::connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&plain_copy).read_only(true))
        .await
        .ok();
    let plain_rows = match &in_plain_copy {
        Some(p) => sqlx::query_as::<_, (i64,)>("SELECT count(*) FROM locations").fetch_one(p).await.map(|r| r.0).unwrap_or(0),
        None => 0,
    };
    assert_eq!(plain_rows, 0, "copying the .db alone loses what's in the log");

    let copy = dir.join("snapshot.db");
    snapshot(&pool, &copy).await.unwrap();
    assert_eq!(location_names(&copy).await, ["Documents", "Photos"]);
}

#[tokio::test]
async fn a_backup_zip_round_trips() {
    let dir = common::temp_dir("backup-zip");
    let config = common::temp_dir("backup-zip-config");
    let pool = common::setup_file_db(&dir.join(DB_FILE)).await;
    add_location(&pool, "Documents", "/Users/sam/Documents").await;
    settings::save(&config, &AppSettings { show_hidden_files: true, ..AppSettings::default() }).unwrap();

    let target = dir.join("Folderbase Backup 2026-11-23 14.05.zip");
    make_backup(&pool, &config, &target, &maker()).await.unwrap();
    assert!(target.exists());
    assert!(!dir.join(".Folderbase Backup 2026-11-23 14.05.zip.part").exists());

    let restored = dir.join("restored.db");
    let (manifest, settings_json) = read_backup(&target, &restored).await.unwrap();
    assert_eq!(manifest.format_version, FORMAT_VERSION);
    assert_eq!(manifest.machine, "Test Mac");
    assert_eq!(manifest.app_version, "0.1.0");
    assert_eq!(manifest.locations.len(), 1);
    assert_eq!(manifest.locations[0].root_path, "/Users/sam/Documents");
    let settings: AppSettings = serde_json::from_slice(&settings_json.unwrap()).unwrap();
    assert!(settings.show_hidden_files);
    assert_eq!(location_names(&restored).await, ["Documents"]);

    // Inspect names the locations whose folder isn't here
    let info = inspect(&target).await.unwrap();
    assert_eq!(info.missing.len(), 1);
    assert_eq!(info.missing[0].name, "Documents");
}

#[tokio::test]
async fn things_that_arent_our_backups_are_refused() {
    let dir = common::temp_dir("backup-refuse");
    let dest = dir.join("out.db");

    // Not a zip at all
    std::fs::write(dir.join("random.zip"), b"this is not a zip").unwrap();
    let err = read_backup(&dir.join("random.zip"), &dest).await.unwrap_err();
    assert!(err.contains("isn’t a Folderbase backup"), "{err}");

    // A zip, but someone else's
    let other = dir.join("other.zip");
    {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&other).unwrap());
        zip.start_file("photo.jpg", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(b"jpeg").unwrap();
        zip.finish().unwrap();
    }
    assert!(read_backup(&other, &dest).await.unwrap_err().contains("isn’t a Folderbase backup"));

    // Ours, from a newer version
    let db = dir.join("source.db");
    let pool = common::setup_file_db(&db).await;
    let source = dir.join("snap.db");
    snapshot(&pool, &source).await.unwrap();
    let newer = dir.join("newer.zip");
    write_backup_zip(&newer, &source, None, &manifest(FORMAT_VERSION + 1)).unwrap();
    let err = read_backup(&newer, &dest).await.unwrap_err();
    assert!(err.contains("newer version"), "{err}");

    // Ours, with a database that isn't one
    let junk = dir.join("junk.db");
    std::fs::write(&junk, b"not sqlite").unwrap();
    let damaged = dir.join("damaged.zip");
    write_backup_zip(&damaged, &junk, None, &manifest(FORMAT_VERSION)).unwrap();
    assert!(read_backup(&damaged, &dest).await.unwrap_err().contains("damaged"));

    // A valid one reads; a failure never leaves a database behind
    let good = dir.join("good.zip");
    write_backup_zip(&good, &source, None, &manifest(FORMAT_VERSION)).unwrap();
    assert!(!dest.exists());
    assert!(read_backup(&good, &dest).await.is_ok());
}

#[tokio::test]
async fn restoring_backs_up_the_current_state_first_and_swaps_in_at_launch() {
    let data = common::temp_dir("restore-data");
    let config = common::temp_dir("restore-config");
    let backups = common::temp_dir("restore-backups");
    let elsewhere = common::temp_dir("restore-elsewhere");

    // The backup: made when there was only "Old"
    let then = common::setup_file_db(&elsewhere.join(DB_FILE)).await;
    add_location(&then, "Old", "/Users/sam/Old").await;
    let then_config = common::temp_dir("restore-then-config");
    settings::save(&then_config, &AppSettings { show_hidden_files: true, ..AppSettings::default() }).unwrap();
    let backup = elsewhere.join("Folderbase Backup 2026-11-01 09.00.zip");
    make_backup(&then, &then_config, &backup, &maker()).await.unwrap();

    // Now: "New", and this Mac's own backup folder
    let pool = common::setup_file_db(&data.join(DB_FILE)).await;
    add_location(&pool, "New", "/Users/sam/New").await;
    let mine = BackupSettings { folder: Some(backups.to_string_lossy().into_owned()), folder_asked: true, ..BackupSettings::default() };
    settings::save(&config, &AppSettings { backup: mine.clone(), ..AppSettings::default() }).unwrap();

    let places = RestorePlaces { data_dir: &data, config_dir: &config, backup_folder: &backups };
    let safety = restore_impl(&pool, &backup, &places, &maker()).await.unwrap();

    // The "Before Restore" backup holds how things were, and nothing live has changed yet
    assert!(safety.starts_with(&backups));
    assert!(safety.file_name().unwrap().to_string_lossy().starts_with("Folderbase Backup Before Restore "));
    let check = data.join("check.db");
    read_backup(&safety, &check).await.unwrap();
    assert_eq!(location_names(&check).await, ["New"]);
    std::fs::remove_file(&check).unwrap();
    assert!(data.join(STAGED_DB).exists());
    assert!(config.join(STAGED_SETTINGS).exists());
    assert!(!settings::load(&config).show_hidden_files);

    // The next launch swaps it in, keeping this Mac's backup choices
    pool.close().await;
    assert!(apply_staged_restore(&data, &config).unwrap());
    assert_eq!(location_names(&data.join(DB_FILE)).await, ["Old"]);
    let restored = settings::load(&config);
    assert!(restored.show_hidden_files);
    assert_eq!(restored.backup, mine);
}

#[tokio::test]
async fn a_bad_backup_is_refused_before_anything_is_made_or_staged() {
    let data = common::temp_dir("restore-bad-data");
    let config = common::temp_dir("restore-bad-config");
    let backups = common::temp_dir("restore-bad-backups");
    let pool = common::setup_file_db(&data.join(DB_FILE)).await;
    let bad = data.join("bad.zip");
    std::fs::write(&bad, b"nope").unwrap();

    let places = RestorePlaces { data_dir: &data, config_dir: &config, backup_folder: &backups };
    assert!(restore_impl(&pool, &bad, &places, &maker()).await.is_err());
    assert_eq!(std::fs::read_dir(&backups).unwrap().count(), 0);
    assert!(!data.join(STAGED_DB).exists());
    assert!(!config.join(STAGED_SETTINGS).exists());
}
