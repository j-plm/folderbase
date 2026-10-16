mod common;

use common::setup_db;
use folderbase_lib::commands::metadata::change_property_type_impl;
use folderbase_lib::commands::path_mapping::{
    apply_mapping_to_files, clear_folder_label_impl, count_mapping_conflicts_impl,
    folders_named_impl, set_folder_label_impl, set_folder_labels_impl,
};
use folderbase_lib::commands::properties::{ensure_tags_property, TAGS_CONFIG};
use folderbase_lib::db::{run_migrations, DbPool};
use serde_json::{json, Value};

const LOC: &str = "loc1";
const ROOT: &str = "/scanned";

/// Seeds a location with files in Houses/42 Burton Rd and Scans/Cars.
async fn seed(pool: &DbPool) {
    seed_files(
        pool,
        &[
            ("f1", "Houses/42 Burton Rd/kitchen.pdf"),
            ("f2", "Scans/Cars/mot.pdf"),
        ],
    )
    .await;
}

async fn seed_files(pool: &DbPool, files: &[(&str, &str)]) {
    sqlx::query(
        "INSERT OR IGNORE INTO locations (location_id, name, root_path, library, added_at) \
         VALUES (?, 'Scanned', ?, 'lib1', '2026-01-01')",
    )
    .bind(LOC)
    .bind(ROOT)
    .execute(pool)
    .await
    .unwrap();

    for (id, rel) in files {
        let parts: Vec<&str> = rel.split('/').collect();
        let tags = serde_json::to_string(&parts[..parts.len() - 1]).unwrap();
        sqlx::query(
            "INSERT INTO files (file_id, file_path, location_id, relative_path, metadata, tags, library) \
             VALUES (?, ?, ?, ?, '{}', ?, 'lib1')",
        )
        .bind(id)
        .bind(format!("{ROOT}/{rel}"))
        .bind(LOC)
        .bind(rel)
        .bind(tags)
        .execute(pool)
        .await
        .unwrap();
    }
}

async fn file(pool: &DbPool, id: &str) -> (Value, Vec<String>) {
    let (meta, tags): (String, String) =
        sqlx::query_as("SELECT metadata, tags FROM files WHERE file_id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap();
    (
        serde_json::from_str(&meta).unwrap(),
        serde_json::from_str(&tags).unwrap(),
    )
}

async fn property_type(pool: &DbPool, name: &str) -> Option<String> {
    sqlx::query_scalar("SELECT value_type FROM properties WHERE name = ? AND library = 'lib1'")
        .bind(name)
        .fetch_optional(pool)
        .await
        .unwrap()
}

async fn add_property(pool: &DbPool, name: &str, value_type: &str) {
    sqlx::query("INSERT INTO properties (property_id, name, library, value_type) VALUES (?, ?, 'lib1', ?)")
        .bind(format!("p-{name}"))
        .bind(name)
        .bind(value_type)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn relabel_replaces_previous_key() {
    let pool = setup_db().await;
    seed(&pool).await;
    let folder = format!("{ROOT}/Houses/42 Burton Rd");

    for name in ["Ho", "Hom", "Home"] {
        set_folder_label_impl(LOC, &folder, name, &pool).await.unwrap();
    }

    let (meta, tags) = file(&pool, "f1").await;
    assert_eq!(meta, json!({ "Home": ["42 Burton Rd"] }));
    // Source tags always keep every folder on the path
    assert_eq!(tags, vec!["Houses", "42 Burton Rd"]);
}

#[tokio::test]
async fn new_mapping_creates_a_multi_select_with_the_value_registered() {
    let pool = setup_db().await;
    seed(&pool).await;

    set_folder_label_impl(LOC, &format!("{ROOT}/Scans/Cars"), "Category", &pool)
        .await
        .unwrap();

    assert_eq!(property_type(&pool, "Category").await.as_deref(), Some("array"));
    let values: Vec<String> = sqlx::query_scalar(
        "SELECT v.value FROM property_values v JOIN properties p USING (property_id) WHERE p.name = 'Category'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(values, vec!["Cars"]);
}

#[tokio::test]
async fn file_in_two_mapped_folders_gets_both_values() {
    let pool = setup_db().await;
    seed(&pool).await;

    set_folder_labels_impl(
        LOC,
        &[format!("{ROOT}/Houses"), format!("{ROOT}/Houses/42 Burton Rd")],
        "Place",
        false,
        &pool,
    )
    .await
    .unwrap();

    let (meta, _) = file(&pool, "f1").await;
    assert_eq!(meta, json!({ "Place": ["Houses", "42 Burton Rd"] }));
}

#[tokio::test]
async fn label_only_touches_its_own_folder() {
    let pool = setup_db().await;
    seed(&pool).await;

    set_folder_label_impl(LOC, &format!("{ROOT}/Houses/42 Burton Rd"), "Home", &pool)
        .await
        .unwrap();

    let (meta, tags) = file(&pool, "f2").await;
    assert_eq!(meta, json!({}));
    assert_eq!(tags, vec!["Scans", "Cars"]);
}

#[tokio::test]
async fn folder_names_match_literally_not_as_wildcards() {
    let pool = setup_db().await;
    seed_files(&pool, &[("a", "A_B/one.pdf"), ("b", "AxB/two.pdf")]).await;

    set_folder_label_impl(LOC, &format!("{ROOT}/A_B"), "Group", &pool).await.unwrap();

    assert_eq!(file(&pool, "a").await.0, json!({ "Group": ["A_B"] }));
    assert_eq!(file(&pool, "b").await.0, json!({}));
}

#[tokio::test]
async fn clear_removes_value_and_keeps_tags() {
    let pool = setup_db().await;
    seed(&pool).await;
    let folder = format!("{ROOT}/Scans/Cars");

    set_folder_label_impl(LOC, &folder, "Category", &pool).await.unwrap();
    clear_folder_label_impl(LOC, &folder, &pool).await.unwrap();

    let (meta, tags) = file(&pool, "f2").await;
    assert_eq!(meta, json!({}));
    assert_eq!(tags, vec!["Scans", "Cars"]);
    let nodes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM path_mapping_nodes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(nodes, 0);
}

#[tokio::test]
async fn clear_keeps_other_values_in_the_list() {
    let pool = setup_db().await;
    seed(&pool).await;
    sqlx::query("UPDATE files SET metadata = '{\"Category\":[\"Vehicles\"]}' WHERE file_id = 'f2'")
        .execute(&pool)
        .await
        .unwrap();
    let folder = format!("{ROOT}/Scans/Cars");

    set_folder_label_impl(LOC, &folder, "Category", &pool).await.unwrap();
    assert_eq!(file(&pool, "f2").await.0, json!({ "Category": ["Vehicles", "Cars"] }));
    clear_folder_label_impl(LOC, &folder, &pool).await.unwrap();
    assert_eq!(file(&pool, "f2").await.0, json!({ "Category": ["Vehicles"] }));
}

#[tokio::test]
async fn reapplying_is_idempotent() {
    let pool = setup_db().await;
    seed(&pool).await;
    let folder = format!("{ROOT}/Houses/42 Burton Rd");
    set_folder_label_impl(LOC, &folder, "Home", &pool).await.unwrap();

    // A refresh re-applies each mapping
    apply_mapping_to_files(LOC, ROOT, &folder, "Home", &pool).await.unwrap();

    let (meta, tags) = file(&pool, "f1").await;
    assert_eq!(meta, json!({ "Home": ["42 Burton Rd"] }));
    assert_eq!(tags, vec!["Houses", "42 Burton Rd"]);
}

#[tokio::test]
async fn select_conflicts_are_counted_and_only_replaced_on_request() {
    let pool = setup_db().await;
    seed(&pool).await;
    add_property(&pool, "Kind", "enum").await;
    sqlx::query("UPDATE files SET metadata = '{\"Kind\":\"Paperwork\"}' WHERE file_id = 'f2'")
        .execute(&pool)
        .await
        .unwrap();
    let folders = vec![format!("{ROOT}/Scans/Cars")];

    assert_eq!(count_mapping_conflicts_impl(LOC, &folders, "Kind", &pool).await.unwrap(), 1);
    set_folder_labels_impl(LOC, &folders, "Kind", false, &pool).await.unwrap();
    assert_eq!(file(&pool, "f2").await.0, json!({ "Kind": "Paperwork" }));

    set_folder_labels_impl(LOC, &folders, "Kind", true, &pool).await.unwrap();
    assert_eq!(file(&pool, "f2").await.0, json!({ "Kind": "Cars" }));
    assert_eq!(count_mapping_conflicts_impl(LOC, &folders, "Kind", &pool).await.unwrap(), 0);
}

#[tokio::test]
async fn multi_select_never_conflicts() {
    let pool = setup_db().await;
    seed(&pool).await;
    sqlx::query("UPDATE files SET metadata = '{\"Kind\":[\"Paperwork\"]}' WHERE file_id = 'f2'")
        .execute(&pool)
        .await
        .unwrap();
    let folders = vec![format!("{ROOT}/Scans/Cars")];
    // Doesn't exist yet: mapping will create it as a Multi-select
    assert_eq!(count_mapping_conflicts_impl(LOC, &folders, "Kind", &pool).await.unwrap(), 0);
    add_property(&pool, "Kind", "array").await;
    assert_eq!(count_mapping_conflicts_impl(LOC, &folders, "Kind", &pool).await.unwrap(), 0);
}

#[tokio::test]
async fn a_tag_maps_every_folder_with_that_name() {
    let pool = setup_db().await;
    seed_files(
        &pool,
        &[
            ("a", "Clients/Acme/brief.pdf"),
            ("b", "Archive/2023/Acme/old.pdf"),
            ("c", "Clients/Beta/note.pdf"),
        ],
    )
    .await;

    let folders = folders_named_impl(LOC, "Acme", &pool).await.unwrap();
    assert_eq!(
        folders,
        vec![format!("{ROOT}/Archive/2023/Acme"), format!("{ROOT}/Clients/Acme")]
    );
    set_folder_labels_impl(LOC, &folders, "Client", false, &pool).await.unwrap();

    assert_eq!(file(&pool, "a").await.0, json!({ "Client": ["Acme"] }));
    assert_eq!(file(&pool, "b").await.0, json!({ "Client": ["Acme"] }));
    assert_eq!(file(&pool, "c").await.0, json!({}));
}

#[tokio::test]
async fn empty_label_is_rejected() {
    let pool = setup_db().await;
    seed(&pool).await;

    let err = set_folder_label_impl(LOC, &format!("{ROOT}/Scans"), "   ", &pool).await;
    assert!(err.is_err());
}

#[tokio::test]
async fn migration_prunes_keystroke_orphans() {
    let pool = setup_db().await;
    seed(&pool).await;
    let folder = format!("{ROOT}/Houses/42 Burton Rd");
    set_folder_label_impl(LOC, &folder, "Home", &pool).await.unwrap();

    // Simulate the old per-keystroke saves plus an unrelated key that must survive.
    sqlx::query(
        "UPDATE files SET metadata = json_set(metadata, '$.Ho', '42 Burton Rd', \
         '$.Hom', '42 Burton Rd', '$.camera_make', 'Canon') WHERE file_id = 'f1'",
    )
    .execute(&pool)
    .await
    .unwrap();

    run_migrations(&pool).await.unwrap();

    let (meta, _) = file(&pool, "f1").await;
    assert_eq!(meta, json!({ "Home": ["42 Burton Rd"], "camera_make": "Canon" }));
}

#[tokio::test]
async fn migration_restores_source_tags_and_makes_mappings_multi_select() {
    let pool = setup_db().await;
    seed(&pool).await;
    // State left by earlier builds: a Select mapping with its folder stripped from tags
    add_property(&pool, "Home", "enum").await;
    sqlx::query(
        "INSERT INTO path_mapping_nodes (node_id, location_id, folder_path, property_name, depth, created_at, updated_at) \
         VALUES ('n1', ?, ?, 'Home', 2, '', '')",
    )
    .bind(LOC)
    .bind(format!("{ROOT}/Houses/42 Burton Rd"))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE files SET metadata = '{\"Home\":\"42 Burton Rd\"}', tags = '[\"Houses\"]' WHERE file_id = 'f1'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("PRAGMA user_version = 0").execute(&pool).await.unwrap();

    run_migrations(&pool).await.unwrap();

    let (meta, tags) = file(&pool, "f1").await;
    assert_eq!(meta, json!({ "Home": ["42 Burton Rd"] }));
    assert_eq!(tags, vec!["Houses", "42 Burton Rd"]);
    assert_eq!(property_type(&pool, "Home").await.as_deref(), Some("array"));
}

#[tokio::test]
async fn every_library_gets_one_tags_property() {
    let pool = setup_db().await;
    seed(&pool).await;

    ensure_tags_property(&pool, "lib1").await.unwrap();
    ensure_tags_property(&pool, "lib1").await.unwrap();

    let rows: Vec<(String, String, Option<String>)> =
        sqlx::query_as("SELECT property_id, value_type, config FROM properties WHERE library = 'lib1'")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].1, "array");
    assert_eq!(rows[0].2.as_deref(), Some(TAGS_CONFIG));

    // Built in: its type can't change
    assert!(change_property_type_impl(&pool, &rows[0].0, "free_text", None).await.is_err());
}

#[tokio::test]
async fn tags_property_adopts_an_existing_tags_column() {
    let pool = setup_db().await;
    seed(&pool).await;
    add_property(&pool, "Tags", "free_text").await;
    sqlx::query("UPDATE files SET metadata = '{\"Tags\":\"urgent\"}' WHERE file_id = 'f1'")
        .execute(&pool)
        .await
        .unwrap();

    ensure_tags_property(&pool, "lib1").await.unwrap();

    assert_eq!(property_type(&pool, "Tags").await.as_deref(), Some("array"));
    assert_eq!(file(&pool, "f1").await.0, json!({ "Tags": ["urgent"] }));
}
