mod common;

use common::setup_db;
use folderbase_lib::commands::locations::{get_locations_impl, relocate_location_impl, rename_location_impl, reorder_locations_impl};
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

/// A location at `root` with one file (at `rel`) and one mapped folder ("Clients").
async fn add_at(pool: &DbPool, id: &str, root: &str, rel: &str) {
    sqlx::query("INSERT INTO locations (location_id, name, root_path, library, added_at) VALUES (?, ?, ?, ?, '2024-01-01')")
        .bind(id)
        .bind(id)
        .bind(root)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO files (file_id, file_path, location_id, relative_path, metadata) VALUES (?, ?, ?, ?, '{\"Client\":\"Acme\"}')")
        .bind(format!("{id}-file"))
        .bind(format!("{root}/{rel}"))
        .bind(id)
        .bind(rel)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO path_mapping_nodes (node_id, location_id, folder_path, property_name, depth, created_at, updated_at) VALUES (?, ?, ?, 'Client', 1, '', '')")
        .bind(format!("{id}-node"))
        .bind(id)
        .bind(format!("{root}/Clients"))
        .execute(pool)
        .await
        .unwrap();
}

async fn scalar(pool: &DbPool, sql: &str, id: &str) -> String {
    sqlx::query_scalar(sql).bind(id).fetch_one(pool).await.unwrap()
}

fn temp_dirs(dirs: &[&str]) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("fb-relocate-{}", uuid::Uuid::new_v4()));
    for dir in dirs {
        std::fs::create_dir_all(root.join(dir)).unwrap();
    }
    root
}

#[tokio::test]
async fn relocating_rewrites_every_stored_path_and_keeps_the_values() {
    let pool = setup_db().await;
    let disk = temp_dirs(&["New/Testing"]);
    let old = disk.join("Old/Testing").to_string_lossy().into_owned();
    let new = disk.join("New/Testing").to_string_lossy().into_owned();
    add_at(&pool, "t", &old, "Scans/a.tif").await;

    let moved = relocate_location_impl("t", &format!("{new}/"), &pool).await.unwrap();
    assert_eq!(moved.len(), 1);
    assert_eq!(moved[0].root_path, new);
    assert_eq!(scalar(&pool, "SELECT file_path FROM files WHERE location_id = ?", "t").await, format!("{new}/Scans/a.tif"));
    assert_eq!(scalar(&pool, "SELECT metadata FROM files WHERE location_id = ?", "t").await, r#"{"Client":"Acme"}"#);
    assert_eq!(scalar(&pool, "SELECT folder_path FROM path_mapping_nodes WHERE location_id = ?", "t").await, format!("{new}/Clients"));
    std::fs::remove_dir_all(&disk).unwrap();
}

#[tokio::test]
async fn relocating_takes_along_missing_locations_that_moved_with_it() {
    let pool = setup_db().await;
    let disk = temp_dirs(&["New/Testing", "New/Products/Gears", "Here"]);
    let old = |p: &str| disk.join("Old").join(p).to_string_lossy().into_owned();
    let new = |p: &str| disk.join("New").join(p).to_string_lossy().into_owned();
    add_at(&pool, "testing", &old("Testing"), "a.tif").await;
    add_at(&pool, "gears", &old("Products/Gears"), "b.dxf").await;
    // Not under the folder that moved, and one that isn't missing, stay put
    let elsewhere = disk.join("Elsewhere").to_string_lossy().into_owned();
    add_at(&pool, "elsewhere", &elsewhere, "c.pdf").await;

    let moved = relocate_location_impl("testing", &new("Testing"), &pool).await.unwrap();
    let ids: Vec<_> = moved.iter().map(|l| l.location_id.as_str()).collect();
    assert_eq!(ids, ["testing", "gears"]);
    assert_eq!(scalar(&pool, "SELECT file_path FROM files WHERE location_id = ?", "gears").await, new("Products/Gears/b.dxf"));
    assert_eq!(scalar(&pool, "SELECT root_path FROM locations WHERE location_id = ?", "elsewhere").await, elsewhere);
    std::fs::remove_dir_all(&disk).unwrap();
}

#[tokio::test]
async fn relocating_leaves_files_of_a_folder_sharing_the_name_start_alone() {
    let pool = setup_db().await;
    let disk = temp_dirs(&["New"]);
    let old = disk.join("Scans").to_string_lossy().into_owned();
    add_at(&pool, "s", &old, "a.tif").await;
    // "Scans 2" starts like "Scans" but isn't inside it
    sqlx::query("UPDATE files SET file_path = ? WHERE location_id = 's'")
        .bind(format!("{old} 2/a.tif"))
        .execute(&pool)
        .await
        .unwrap();

    relocate_location_impl("s", &disk.join("New").to_string_lossy(), &pool).await.unwrap();
    assert_eq!(scalar(&pool, "SELECT file_path FROM files WHERE location_id = ?", "s").await, format!("{old} 2/a.tif"));
    std::fs::remove_dir_all(&disk).unwrap();
}

#[tokio::test]
async fn relocating_to_a_folder_that_isnt_there_changes_nothing() {
    let pool = setup_db().await;
    add_at(&pool, "s", "/tmp/old-scans", "a.tif").await;

    assert!(relocate_location_impl("s", "/definitely/not/here", &pool).await.is_err());
    assert_eq!(scalar(&pool, "SELECT root_path FROM locations WHERE location_id = ?", "s").await, "/tmp/old-scans");
}

#[tokio::test]
async fn relocating_onto_another_locations_folder_is_refused() {
    let pool = setup_db().await;
    let disk = temp_dirs(&["Taken"]);
    let taken = disk.join("Taken").to_string_lossy().into_owned();
    add_at(&pool, "a", "/tmp/gone", "a.tif").await;
    add_at(&pool, "b", &taken, "b.tif").await;

    let err = relocate_location_impl("a", &taken, &pool).await.unwrap_err();
    assert_eq!(err, "“b” already uses that folder");
    std::fs::remove_dir_all(&disk).unwrap();
}
