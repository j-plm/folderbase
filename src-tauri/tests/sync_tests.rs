mod common;

use common::setup_db;
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
