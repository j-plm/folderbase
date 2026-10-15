mod common;

use common::setup_db;
use folderbase_lib::commands::metadata::{
    change_property_type_impl, rename_property_impl, set_metadata_cells_impl, CellEdit,
};
use folderbase_lib::db::DbPool;
use serde_json::{json, Value};
use uuid::Uuid;

// ── helpers ──────────────────────────────────────────────────────────────────

async fn insert_file(pool: &DbPool, library: &str, metadata: &str) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO files (file_id, file_path, library, metadata) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(format!("/fake/{id}.txt"))
        .bind(library)
        .bind(metadata)
        .execute(pool)
        .await
        .unwrap();
    id
}

async fn insert_property(pool: &DbPool, name: &str, library: &str, value_type: &str) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO properties (property_id, name, library, value_type) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(library)
        .bind(value_type)
        .execute(pool)
        .await
        .unwrap();
    id
}

async fn metadata(pool: &DbPool, file_id: &str) -> Value {
    let raw: String = sqlx::query_scalar("SELECT metadata FROM files WHERE file_id = ?")
        .bind(file_id)
        .fetch_one(pool)
        .await
        .unwrap();
    serde_json::from_str(&raw).unwrap()
}

async fn registered_values(pool: &DbPool, property_id: &str) -> Vec<String> {
    sqlx::query_scalar("SELECT value FROM property_values WHERE property_id = ? ORDER BY value")
        .bind(property_id)
        .fetch_all(pool)
        .await
        .unwrap()
}

fn edit(file_id: &str, key: &str, value: Value) -> CellEdit {
    CellEdit { file_id: file_id.into(), key: key.into(), value }
}

// ── set_metadata_cells ───────────────────────────────────────────────────────

#[tokio::test]
async fn set_cells_writes_typed_values_and_keeps_other_keys() {
    let pool = setup_db().await;
    let a = insert_file(&pool, "photos", r#"{"rig":"Rig-A"}"#).await;
    let b = insert_file(&pool, "photos", "{}").await;

    set_metadata_cells_impl(
        &pool,
        &[
            edit(&a, "budget", json!(12.5)),
            edit(&a, "project", json!(["Apollo", "Hermes"])),
            edit(&b, "shoot date", json!("2024-03-01")),
        ],
    )
    .await
    .unwrap();

    let ma = metadata(&pool, &a).await;
    assert_eq!(ma["rig"], "Rig-A");
    assert_eq!(ma["budget"], 12.5);
    assert_eq!(ma["project"], json!(["Apollo", "Hermes"]));
    assert_eq!(metadata(&pool, &b).await["shoot date"], "2024-03-01");
}

#[tokio::test]
async fn set_cells_null_removes_the_key() {
    let pool = setup_db().await;
    let a = insert_file(&pool, "photos", r#"{"rig":"Rig-A","angle":"Front"}"#).await;

    set_metadata_cells_impl(&pool, &[edit(&a, "rig", Value::Null)]).await.unwrap();

    let m = metadata(&pool, &a).await;
    assert!(m.get("rig").is_none());
    assert_eq!(m["angle"], "Front");
}

#[tokio::test]
async fn set_cells_registers_new_list_values_only_for_list_types() {
    let pool = setup_db().await;
    let project = insert_property(&pool, "project", "photos", "array").await;
    let notes = insert_property(&pool, "notes", "photos", "free_text").await;
    let a = insert_file(&pool, "photos", "{}").await;
    let b = insert_file(&pool, "photos", "{}").await;

    set_metadata_cells_impl(
        &pool,
        &[
            edit(&a, "project", json!(["Apollo", "Hermes"])),
            edit(&b, "project", json!(["Apollo"])),
            edit(&a, "notes", json!("free words")),
        ],
    )
    .await
    .unwrap();

    assert_eq!(registered_values(&pool, &project).await, vec!["Apollo", "Hermes"]);
    assert!(registered_values(&pool, &notes).await.is_empty());
}

#[tokio::test]
async fn set_cells_empty_is_noop() {
    let pool = setup_db().await;
    set_metadata_cells_impl(&pool, &[]).await.unwrap();
}

// ── rename_property ──────────────────────────────────────────────────────────

#[tokio::test]
async fn rename_moves_values_within_the_library_only() {
    let pool = setup_db().await;
    let prop = insert_property(&pool, "rig", "photos", "enum").await;
    let photo = insert_file(&pool, "photos", r#"{"rig":"Rig-A"}"#).await;
    let doc = insert_file(&pool, "docs", r#"{"rig":"Other"}"#).await;

    let renamed = rename_property_impl(&pool, &prop, "camera rig").await.unwrap();

    assert_eq!(renamed.name, "camera rig");
    let m = metadata(&pool, &photo).await;
    assert!(m.get("rig").is_none());
    assert_eq!(m["camera rig"], "Rig-A");
    assert_eq!(metadata(&pool, &doc).await["rig"], "Other");
}

#[tokio::test]
async fn rename_rejects_clash_and_empty_name() {
    let pool = setup_db().await;
    let prop = insert_property(&pool, "rig", "photos", "enum").await;
    insert_property(&pool, "angle", "photos", "enum").await;

    assert!(rename_property_impl(&pool, &prop, "angle").await.is_err());
    assert!(rename_property_impl(&pool, &prop, "   ").await.is_err());
}

// ── change_property_type ─────────────────────────────────────────────────────

#[tokio::test]
async fn change_to_multiselect_wraps_values_and_registers_them() {
    let pool = setup_db().await;
    let prop = insert_property(&pool, "project", "photos", "free_text").await;
    let a = insert_file(&pool, "photos", r#"{"project":"Apollo"}"#).await;

    change_property_type_impl(&pool, &prop, "array", None).await.unwrap();

    assert_eq!(metadata(&pool, &a).await["project"], json!(["Apollo"]));
    assert_eq!(registered_values(&pool, &prop).await, vec!["Apollo"]);
}

#[tokio::test]
async fn change_to_number_converts_numeric_text_and_keeps_the_rest() {
    let pool = setup_db().await;
    let prop = insert_property(&pool, "budget", "photos", "free_text").await;
    let a = insert_file(&pool, "photos", r#"{"budget":"1,200"}"#).await;
    let b = insert_file(&pool, "photos", r#"{"budget":"tbc"}"#).await;

    change_property_type_impl(&pool, &prop, "number", Some(r#"{"format":"currency","currency":"GBP"}"#))
        .await
        .unwrap();

    assert_eq!(metadata(&pool, &a).await["budget"], 1200.0);
    assert_eq!(metadata(&pool, &b).await["budget"], "tbc");
    let config: Option<String> = sqlx::query_scalar("SELECT config FROM properties WHERE property_id = ?")
        .bind(&prop)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(config.unwrap().contains("currency"));
}

#[tokio::test]
async fn change_type_rejects_unknown_type() {
    let pool = setup_db().await;
    let prop = insert_property(&pool, "budget", "photos", "free_text").await;
    assert!(change_property_type_impl(&pool, &prop, "formula", None).await.is_err());
}
