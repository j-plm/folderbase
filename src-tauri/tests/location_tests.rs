mod common;

use common::setup_db;
use folderbase_lib::commands::locations::rename_location_impl;
use folderbase_lib::db::DbPool;

async fn add_location(pool: &DbPool, id: &str) {
    sqlx::query("INSERT INTO locations (location_id, name, root_path, library, added_at) VALUES (?, 'Scans', '/tmp/scans', 'scans', '2024-01-01')")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn rename_changes_only_the_name() {
    let pool = setup_db().await;
    add_location(&pool, "loc-1").await;

    let loc = rename_location_impl("loc-1", "  Sprocket Scans ", &pool).await.unwrap();
    assert_eq!(loc.name, "Sprocket Scans");
    assert_eq!(loc.root_path, "/tmp/scans");
    assert_eq!(loc.library, "scans");
}

#[tokio::test]
async fn rename_rejects_a_blank_name() {
    let pool = setup_db().await;
    add_location(&pool, "loc-1").await;

    assert!(rename_location_impl("loc-1", "   ", &pool).await.is_err());
    let name: String = sqlx::query_scalar("SELECT name FROM locations WHERE location_id = 'loc-1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name, "Scans");
}

#[tokio::test]
async fn rename_of_a_missing_location_is_an_error() {
    let pool = setup_db().await;
    assert!(rename_location_impl("nope", "Anything", &pool).await.is_err());
}
