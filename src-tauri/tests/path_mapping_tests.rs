mod common;

use common::setup_db;
use folderbase_lib::commands::path_mapping::{clear_folder_label_impl, set_folder_label_impl};
use folderbase_lib::db::{run_migrations, DbPool};
use serde_json::Value;

const LOC: &str = "loc1";
const ROOT: &str = "/scanned";

/// Seeds a location with files in Houses/42 Burton Rd and Scans/Cars.
async fn seed(pool: &DbPool) {
    sqlx::query(
        "INSERT INTO locations (location_id, name, root_path, library, added_at) \
         VALUES (?, 'Scanned', ?, 'lib1', '2026-01-01')",
    )
    .bind(LOC)
    .bind(ROOT)
    .execute(pool)
    .await
    .unwrap();

    for (id, rel, tags) in [
        ("f1", "Houses/42 Burton Rd/kitchen.pdf", r#"["Houses","42 Burton Rd"]"#),
        ("f2", "Scans/Cars/mot.pdf", r#"["Scans","Cars"]"#),
    ] {
        sqlx::query(
            "INSERT INTO files (file_id, file_path, location_id, relative_path, metadata, tags) \
             VALUES (?, ?, ?, ?, '{}', ?)",
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

#[tokio::test]
async fn relabel_replaces_previous_key() {
    let pool = setup_db().await;
    seed(&pool).await;
    let folder = format!("{ROOT}/Houses/42 Burton Rd");

    for name in ["Ho", "Hom", "Home"] {
        set_folder_label_impl(LOC, &folder, name, &pool).await.unwrap();
    }

    let (meta, tags) = file(&pool, "f1").await;
    assert_eq!(meta, serde_json::json!({ "Home": "42 Burton Rd" }));
    assert_eq!(tags, vec!["Houses"]);
}

#[tokio::test]
async fn label_only_touches_its_own_folder() {
    let pool = setup_db().await;
    seed(&pool).await;

    set_folder_label_impl(LOC, &format!("{ROOT}/Houses/42 Burton Rd"), "Home", &pool)
        .await
        .unwrap();

    let (meta, tags) = file(&pool, "f2").await;
    assert_eq!(meta, serde_json::json!({}));
    assert_eq!(tags, vec!["Scans", "Cars"]);
}

#[tokio::test]
async fn clear_restores_tag_and_removes_key() {
    let pool = setup_db().await;
    seed(&pool).await;
    let folder = format!("{ROOT}/Scans/Cars");

    set_folder_label_impl(LOC, &folder, "Category", &pool).await.unwrap();
    clear_folder_label_impl(LOC, &folder, &pool).await.unwrap();

    let (meta, tags) = file(&pool, "f2").await;
    assert_eq!(meta, serde_json::json!({}));
    assert!(tags.contains(&"Cars".to_string()));
    let nodes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM path_mapping_nodes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(nodes, 0);
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
    assert_eq!(
        meta,
        serde_json::json!({ "Home": "42 Burton Rd", "camera_make": "Canon" })
    );
}
