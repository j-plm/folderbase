mod common;

use common::setup_db;
use folderbase_lib::commands::locations::{exclude_folder_impl, include_folder_impl};
use folderbase_lib::commands::sync::{sync_location, SyncSummary};
use folderbase_lib::db::DbPool;
use std::path::{Path, PathBuf};
use uuid::Uuid;

// ── helpers ──────────────────────────────────────────────────────────────────

fn temp_root() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fb-sync-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, bytes).unwrap();
}

async fn add_location(pool: &DbPool, root: &Path) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO locations (location_id, name, root_path, library, added_at) VALUES (?, 'Test', ?, ?, '2024-01-01')")
        .bind(&id)
        .bind(root.to_string_lossy().as_ref())
        .bind(format!("lib-{id}"))
        .execute(pool)
        .await
        .unwrap();
    id
}

async fn sync(pool: &DbPool, location: &str) -> SyncSummary {
    sync_location(location, pool, &|_| {}).await.unwrap()
}

async fn set_custom(pool: &DbPool, rel: &str, json: &str) {
    sqlx::query("UPDATE files SET metadata = json_patch(COALESCE(metadata, '{}'), ?) WHERE relative_path = ?")
        .bind(json)
        .bind(rel)
        .execute(pool)
        .await
        .unwrap();
}

async fn metadata_at(pool: &DbPool, rel: &str) -> Option<serde_json::Value> {
    let raw: Option<String> = sqlx::query_scalar("SELECT metadata FROM files WHERE relative_path = ?")
        .bind(rel)
        .fetch_optional(pool)
        .await
        .unwrap();
    raw.map(|s| serde_json::from_str(&s).unwrap())
}

async fn count(pool: &DbPool, location: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM files WHERE location_id = ?")
        .bind(location)
        .fetch_one(pool)
        .await
        .unwrap()
}

// ── tests ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn first_sync_adds_every_file() {
    let pool = setup_db().await;
    let root = temp_root();
    write(&root, "a.txt", b"alpha");
    write(&root, "Finance/b.txt", b"bravo");
    write(&root, ".hidden", b"skip");
    let loc = add_location(&pool, &root).await;

    let s = sync(&pool, &loc).await;
    assert_eq!(s, SyncSummary { added: 2, ..Default::default() });
    // A second run with nothing changed does nothing
    assert_eq!(sync(&pool, &loc).await, SyncSummary::default());
    std::fs::remove_dir_all(&root).unwrap();
}

#[tokio::test]
async fn moved_and_renamed_files_keep_their_metadata() {
    let pool = setup_db().await;
    let root = temp_root();
    write(&root, "Inbox/report.pdf", b"report contents");
    write(&root, "photo.jpg", b"not really a jpeg");
    let loc = add_location(&pool, &root).await;
    sync(&pool, &loc).await;
    set_custom(&pool, "Inbox/report.pdf", r#"{"client":"Acme"}"#).await;
    set_custom(&pool, "photo.jpg", r#"{"rig":"Rig-A"}"#).await;

    std::fs::create_dir_all(root.join("Archive")).unwrap();
    std::fs::rename(root.join("Inbox/report.pdf"), root.join("Archive/report.pdf")).unwrap();
    std::fs::rename(root.join("photo.jpg"), root.join("holiday.jpg")).unwrap();

    let s = sync(&pool, &loc).await;
    assert_eq!(s, SyncSummary { moved: 2, ..Default::default() });
    assert_eq!(metadata_at(&pool, "Archive/report.pdf").await.unwrap()["client"], "Acme");
    assert_eq!(metadata_at(&pool, "holiday.jpg").await.unwrap()["rig"], "Rig-A");
    assert!(metadata_at(&pool, "Inbox/report.pdf").await.is_none());
    assert_eq!(count(&pool, &loc).await, 2);
    std::fs::remove_dir_all(&root).unwrap();
}

#[tokio::test]
async fn edited_files_are_updated_and_deleted_files_removed() {
    let pool = setup_db().await;
    let root = temp_root();
    write(&root, "notes.txt", b"short");
    write(&root, "old.txt", b"to be deleted");
    let loc = add_location(&pool, &root).await;
    sync(&pool, &loc).await;
    set_custom(&pool, "notes.txt", r#"{"status":"draft"}"#).await;

    write(&root, "notes.txt", b"a much longer body of notes");
    std::fs::remove_file(root.join("old.txt")).unwrap();
    write(&root, "new.txt", b"brand new");

    let s = sync(&pool, &loc).await;
    assert_eq!(s, SyncSummary { added: 1, updated: 1, removed: 1, moved: 0 });
    let size: i64 = sqlx::query_scalar("SELECT file_size FROM files WHERE relative_path = 'notes.txt'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(size, 27);
    assert_eq!(metadata_at(&pool, "notes.txt").await.unwrap()["status"], "draft");
    std::fs::remove_dir_all(&root).unwrap();
}

#[tokio::test]
async fn an_empty_or_missing_folder_removes_nothing() {
    let pool = setup_db().await;
    let root = temp_root();
    write(&root, "a.txt", b"alpha");
    let loc = add_location(&pool, &root).await;
    sync(&pool, &loc).await;

    std::fs::remove_file(root.join("a.txt")).unwrap();
    assert!(sync_location(&loc, &pool, &|_| {}).await.is_err());
    std::fs::remove_dir_all(&root).unwrap();
    assert!(sync_location(&loc, &pool, &|_| {}).await.is_err());
    assert_eq!(count(&pool, &loc).await, 1);
}

#[tokio::test]
async fn excluded_folders_are_dropped_and_not_scanned_until_included() {
    let pool = setup_db().await;
    let root = temp_root();
    write(&root, "Keep/a.txt", b"alpha");
    write(&root, "Archive/2019/b.txt", b"bravo");
    write(&root, "Archive/2020/c.txt", b"charlie");
    let loc = add_location(&pool, &root).await;
    sync(&pool, &loc).await;
    let archive = root.join("Archive").to_string_lossy().into_owned();

    assert_eq!(exclude_folder_impl(&loc, &archive, &pool).await.unwrap(), 2);
    assert_eq!(count(&pool, &loc).await, 1);
    // A refresh leaves it out, rather than adding its files back
    assert_eq!(sync(&pool, &loc).await, SyncSummary::default());
    assert_eq!(count(&pool, &loc).await, 1);

    include_folder_impl(&loc, &archive, &pool).await.unwrap();
    assert_eq!(sync(&pool, &loc).await, SyncSummary { added: 2, ..Default::default() });
    std::fs::remove_dir_all(&root).unwrap();
}

#[tokio::test]
async fn the_location_root_cannot_be_excluded() {
    let pool = setup_db().await;
    let root = temp_root();
    write(&root, "a.txt", b"alpha");
    let loc = add_location(&pool, &root).await;
    assert!(exclude_folder_impl(&loc, &root.to_string_lossy(), &pool).await.is_err());
    assert!(exclude_folder_impl(&loc, "/somewhere/else", &pool).await.is_err());
    std::fs::remove_dir_all(&root).unwrap();
}

#[tokio::test]
async fn local_files_are_not_online_only() {
    let pool = setup_db().await;
    let root = temp_root();
    write(&root, "a.txt", b"alpha");
    let loc = add_location(&pool, &root).await;
    sync(&pool, &loc).await;
    let (online, fp): (bool, Option<String>) =
        sqlx::query_as("SELECT online_only, fingerprint FROM files WHERE relative_path = 'a.txt'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!online);
    assert!(fp.is_some());
    std::fs::remove_dir_all(&root).unwrap();
}

// ── files dropped in from outside ────────────────────────────────────────────

#[tokio::test]
async fn import_copies_outside_files_into_the_holding_folder_and_indexes_them() {
    use folderbase_lib::commands::import::import_files_impl;
    let pool = setup_db().await;
    let root = temp_root();
    write(&root, "Clients/a.txt", b"a");
    let location = add_location(&pool, &root).await;
    sync(&pool, &location).await;

    let outside = temp_root();
    write(&outside, "report.txt", b"report");
    write(&outside, "a.txt", b"another a");
    let paths = vec![
        outside.join("report.txt").to_string_lossy().into_owned(),
        root.join("Clients/a.txt").to_string_lossy().into_owned(),
    ];
    let imported = import_files_impl(&location, &paths, &pool).await.unwrap();
    let filed = imported.files;

    // The outside file is copied (the original kept); the one already inside stays put
    let copy = root.join("Added Files/report.txt");
    assert_eq!(filed, vec![copy.to_string_lossy().into_owned(), root.join("Clients/a.txt").to_string_lossy().into_owned()]);
    assert!(copy.exists() && outside.join("report.txt").exists());
    assert_eq!(count(&pool, &location).await, 2);
    assert!(metadata_at(&pool, "Added Files/report.txt").await.is_some());

    // Dropping the same name again keeps both
    let again = import_files_impl(&location, &paths[..1], &pool).await.unwrap();
    let second = root.join("Added Files/report 2.txt").to_string_lossy().into_owned();
    assert_eq!(again.files, vec![second.clone()]);
    assert_eq!(again.copies, vec![second.clone()]);
    assert_eq!(count(&pool, &location).await, 3);

    // Undone: the copy goes (deleted here, the Trash in the app) and so does its record
    use folderbase_lib::commands::import::trash_added_files_impl;
    trash_added_files_impl(&location, &again.folder, &again.copies, &pool, |p| std::fs::remove_file(p).map_err(|e| e.to_string())).await.unwrap();
    assert!(!Path::new(&second).exists());
    assert_eq!(count(&pool, &location).await, 2);
}

#[tokio::test]
async fn undoing_the_last_drop_takes_the_empty_added_files_folder_away() {
    use folderbase_lib::commands::import::{import_files_impl, trash_added_files_impl};
    let pool = setup_db().await;
    let root = temp_root();
    let location = add_location(&pool, &root).await;
    let outside = temp_root();
    write(&outside, "a.txt", b"a");
    let imported = import_files_impl(&location, &[outside.join("a.txt").to_string_lossy().into_owned()], &pool).await.unwrap();
    assert!(root.join("Added Files").is_dir());
    trash_added_files_impl(&location, &imported.folder, &imported.copies, &pool, |p| std::fs::remove_file(p).map_err(|e| e.to_string())).await.unwrap();
    assert!(!root.join("Added Files").exists());
    // Only an Added Files folder inside the location is accepted
    assert!(trash_added_files_impl(&location, &outside.to_string_lossy(), &[], &pool, |_| Ok(())).await.is_err());
}

#[tokio::test]
async fn changing_the_added_files_folder_can_move_what_is_there_keeping_values() {
    use folderbase_lib::commands::import::{import_files_impl, set_added_folder_impl};
    let pool = setup_db().await;
    let root = temp_root();
    let location = add_location(&pool, &root).await;
    let outside = temp_root();
    write(&outside, "report.txt", b"report");
    import_files_impl(&location, &[outside.join("report.txt").to_string_lossy().into_owned()], &pool).await.unwrap();
    set_custom(&pool, "Added Files/report.txt", r#"{"Client":"Acme"}"#).await;

    let loc = set_added_folder_impl(&location, "Inbox/New", true, &pool).await.unwrap();
    assert_eq!(loc.added_folder.as_deref(), Some("Inbox/New"));
    assert!(root.join("Inbox/New/report.txt").exists());
    assert!(!root.join("Added Files").exists());
    assert_eq!(metadata_at(&pool, "Inbox/New/report.txt").await.unwrap()["Client"], "Acme");

    // Later drops go there
    write(&outside, "b.txt", b"b");
    let next = import_files_impl(&location, &[outside.join("b.txt").to_string_lossy().into_owned()], &pool).await.unwrap();
    assert_eq!(next.folder, root.join("Inbox/New").to_string_lossy());

    // An absolute path inside the location is taken as relative; one outside it isn't
    let loc = set_added_folder_impl(&location, &root.join("Drops").to_string_lossy(), false, &pool).await.unwrap();
    assert_eq!(loc.added_folder.as_deref(), Some("Drops"));
    assert!(set_added_folder_impl(&location, &outside.to_string_lossy(), false, &pool).await.is_err());
    // Without moving, the files stay where they are
    assert!(root.join("Inbox/New/report.txt").exists());
}

#[tokio::test]
async fn import_into_a_missing_location_is_an_error() {
    use folderbase_lib::commands::import::import_files_impl;
    let pool = setup_db().await;
    assert!(import_files_impl("nope", &[], &pool).await.is_err());
}
