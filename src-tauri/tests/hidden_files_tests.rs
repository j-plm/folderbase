//! Settings ▸ General ▸ Show hidden files. In a test binary of its own, as the
//! setting is process-wide and other tests expect hidden files left out.

mod common;

use common::setup_db;
use folderbase_lib::commands::ingest::set_show_hidden;
use folderbase_lib::commands::locations::list_subfolders_impl;
use folderbase_lib::commands::sync::{quiet, sync_location};
use folderbase_lib::db::DbPool;
use std::path::Path;
use uuid::Uuid;

fn write(root: &Path, rel: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, b"x").unwrap();
}

async fn paths(pool: &DbPool, location: &str) -> Vec<String> {
    sqlx::query_scalar("SELECT relative_path FROM files WHERE location_id = ? ORDER BY relative_path")
        .bind(location)
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn hidden_files_are_indexed_only_while_shown_and_ds_store_never() {
    let pool = setup_db().await;
    let root = std::env::temp_dir().join(format!("fb-hidden-{}", Uuid::new_v4()));
    for rel in ["a.txt", ".env", ".config/settings.txt", ".DS_Store", "Sub/.DS_Store"] {
        write(&root, rel);
    }
    let loc = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO locations (location_id, name, root_path, library, added_at) VALUES (?, 'Test', ?, 'lib-hidden', '2024-01-01')")
        .bind(&loc)
        .bind(root.to_string_lossy().as_ref())
        .execute(&pool)
        .await
        .unwrap();

    set_show_hidden(false);
    sync_location(&loc, &pool, &quiet()).await.unwrap();
    assert_eq!(paths(&pool, &loc).await, vec!["a.txt"]);
    let folders: Vec<String> = list_subfolders_impl(&root).unwrap().into_iter().map(|f| f.name).collect();
    assert_eq!(folders, vec!["Sub"]);

    set_show_hidden(true);
    sync_location(&loc, &pool, &quiet()).await.unwrap();
    assert_eq!(paths(&pool, &loc).await, vec![".config/settings.txt", ".env", "a.txt"]);
    let folders: Vec<String> = list_subfolders_impl(&root).unwrap().into_iter().map(|f| f.name).collect();
    assert_eq!(folders, vec![".config", "Sub"]);

    // Hidden again: the next refresh takes them out
    set_show_hidden(false);
    sync_location(&loc, &pool, &quiet()).await.unwrap();
    assert_eq!(paths(&pool, &loc).await, vec!["a.txt"]);
    std::fs::remove_dir_all(&root).unwrap();
}
