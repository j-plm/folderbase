mod common;

use common::setup_db;
use folderbase_lib::commands::locations::{get_locations_impl, rename_location_impl, reorder_locations_impl};
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

async fn add_named(pool: &DbPool, id: &str, name: &str) {
    sqlx::query("INSERT INTO locations (location_id, name, root_path, library, added_at) VALUES (?, ?, ?, ?, '2024-01-01')")
        .bind(id)
        .bind(name)
        .bind(format!("/tmp/{id}"))
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

async fn names(pool: &DbPool) -> Vec<String> {
    get_locations_impl(pool).await.unwrap().into_iter().map(|l| l.name).collect()
}

#[tokio::test]
async fn locations_list_by_name_until_reordered() {
    let pool = setup_db().await;
    add_named(&pool, "b", "Bravo").await;
    add_named(&pool, "a", "Alpha").await;
    add_named(&pool, "c", "Charlie").await;
    assert_eq!(names(&pool).await, ["Alpha", "Bravo", "Charlie"]);

    reorder_locations_impl(&["c".into(), "a".into(), "b".into()], &pool).await.unwrap();
    assert_eq!(names(&pool).await, ["Charlie", "Alpha", "Bravo"]);
    // A rename keeps the order
    rename_location_impl("c", "Zulu", &pool).await.unwrap();
    assert_eq!(names(&pool).await, ["Zulu", "Alpha", "Bravo"]);
}

#[tokio::test]
async fn reordering_ignores_unknown_locations() {
    let pool = setup_db().await;
    add_named(&pool, "a", "Alpha").await;
    add_named(&pool, "b", "Bravo").await;
    reorder_locations_impl(&["gone".into(), "b".into(), "a".into()], &pool).await.unwrap();
    assert_eq!(names(&pool).await, ["Bravo", "Alpha"]);
}
