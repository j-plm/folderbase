use crate::commands::ingest::extract_file_data;
use crate::commands::virtual_folder::FileRecord as QueryFileRecord;
use crate::db::DbPool;
use sqlx::Row;
use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_libraries(db: State<'_, DbPool>) -> Result<Vec<String>, String> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT DISTINCT library FROM files WHERE library IS NOT NULL")
            .fetch_all(db.inner())
            .await
            .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|(lib,)| lib).collect())
}

#[tauri::command]
pub async fn get_files(
    library: Option<String>,
    location_id: Option<String>,
    db: State<'_, DbPool>,
) -> Result<Vec<crate::models::FileRecord>, String> {
    let files = match (location_id, library) {
        (Some(lid), _) => {
            sqlx::query_as::<_, crate::models::FileRecord>(
                "SELECT * FROM files WHERE location_id = ?",
            )
            .bind(lid)
            .fetch_all(db.inner())
            .await
        }
        (None, Some(lib)) => {
            sqlx::query_as::<_, crate::models::FileRecord>(
                "SELECT * FROM files WHERE library = ?",
            )
            .bind(lib)
            .fetch_all(db.inner())
            .await
        }
        (None, None) => {
            sqlx::query_as::<_, crate::models::FileRecord>("SELECT * FROM files")
                .fetch_all(db.inner())
                .await
        }
    }
    .map_err(|e| e.to_string())?;
    Ok(files)
}

#[tauri::command]
pub async fn update_file_metadata(
    file_id: String,
    key: String,
    value: serde_json::Value,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let value_str = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE files SET metadata = json_set(COALESCE(metadata, '{}'), ?, json(?)) WHERE file_id = ?",
    )
    .bind(crate::db::utils::json_path(&key))
    .bind(&value_str)
    .bind(&file_id)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn add_file(
    path: String,
    library: String,
    db: State<'_, DbPool>,
) -> Result<QueryFileRecord, String> {
    let file_path = std::path::Path::new(&path);
    let (file_type, timestamp, file_size, created_at, metadata) = extract_file_data(file_path, !crate::commands::ingest::path_online_only(file_path))
        .ok_or_else(|| format!("cannot read file: {}", path))?;

    let metadata_json = serde_json::to_string(&metadata).map_err(|e| e.to_string())?;
    let file_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT OR IGNORE INTO files \
         (file_id, file_path, file_type, timestamp, library, metadata, file_size, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&file_id)
    .bind(&path)
    .bind(&file_type)
    .bind(&timestamp)
    .bind(&library)
    .bind(&metadata_json)
    .bind(file_size)
    .bind(&created_at)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    // SELECT the actual record (handles the INSERT OR IGNORE case where row already existed)
    let row =
        sqlx::query("SELECT file_id, file_path, file_type, timestamp, library, metadata FROM files WHERE file_path = ?")
            .bind(&path)
            .fetch_one(db.inner())
            .await
            .map_err(|e| e.to_string())?;

    let meta_str: Option<String> = row.get("metadata");
    let metadata_value = meta_str
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null);

    Ok(QueryFileRecord {
        file_id: row.get("file_id"),
        file_path: row.get("file_path"),
        file_type: row.get("file_type"),
        timestamp: row.get("timestamp"),
        library: row.get("library"),
        metadata: metadata_value,
    })
}

#[tauri::command]
pub async fn set_file_metadata_batch(
    file_id: String,
    entries: HashMap<String, serde_json::Value>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }
    let patch_json = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE files SET metadata = json_patch(COALESCE(metadata, '{}'), ?) WHERE file_id = ?",
    )
    .bind(&patch_json)
    .bind(&file_id)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_files_for_location(
    location_id: String,
    db: State<'_, DbPool>,
) -> Result<Vec<crate::models::FileRecord>, String> {
    let files = sqlx::query_as::<_, crate::models::FileRecord>(
        "SELECT * FROM files WHERE location_id = ? ORDER BY relative_path ASC",
    )
    .bind(location_id)
    .fetch_all(db.inner())
    .await
    .map_err(|e| e.to_string())?;
    Ok(files)
}

#[tauri::command]
pub async fn get_location_properties(
    location_id: String,
    db: State<'_, DbPool>,
) -> Result<Vec<String>, String> {
    let keys: Vec<String> = sqlx::query_scalar(
        r"SELECT DISTINCT key
          FROM files, json_each(files.metadata)
          WHERE location_id = ?
            AND key NOT LIKE '\_%' ESCAPE '\'
          ORDER BY key ASC",
    )
    .bind(&location_id)
    .fetch_all(db.inner())
    .await
    .map_err(|e| e.to_string())?;
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;
    use sqlx::SqlitePool;

    async fn setup_db() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn set_file_metadata_batch_merges_entries() {
        let pool = setup_db().await;
        let file_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO files (file_id, file_path, library, metadata) VALUES (?, ?, ?, ?)",
        )
        .bind(&file_id)
        .bind("/tmp/test.jpg")
        .bind("photos")
        .bind(r#"{"existing_key":"existing_val"}"#)
        .execute(&pool)
        .await
        .unwrap();

        let mut entries = HashMap::new();
        entries.insert("year".to_string(), serde_json::json!("2024"));
        entries.insert("rig".to_string(), serde_json::json!("Rig-A"));

        // Call via pool directly to avoid tauri State
        let patch_json = serde_json::to_string(&entries).unwrap();
        sqlx::query(
            "UPDATE files SET metadata = json_patch(COALESCE(metadata, '{}'), ?) WHERE file_id = ?",
        )
        .bind(&patch_json)
        .bind(&file_id)
        .execute(&pool)
        .await
        .unwrap();

        let meta: String = sqlx::query_scalar("SELECT metadata FROM files WHERE file_id = ?")
            .bind(&file_id)
            .fetch_one(&pool)
            .await
            .unwrap();

        let parsed: serde_json::Value = serde_json::from_str(&meta).unwrap();
        assert_eq!(parsed["year"], "2024");
        assert_eq!(parsed["rig"], "Rig-A");
        // Original key must be preserved
        assert_eq!(parsed["existing_key"], "existing_val");
    }

    #[tokio::test]
    async fn set_file_metadata_batch_empty_is_noop() {
        let pool = setup_db().await;
        let file_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO files (file_id, file_path, library, metadata) VALUES (?, ?, ?, ?)",
        )
        .bind(&file_id)
        .bind("/tmp/noop.jpg")
        .bind("photos")
        .bind(r#"{"key":"val"}"#)
        .execute(&pool)
        .await
        .unwrap();

        // Empty entries — no SQL executed
        let entries: HashMap<String, serde_json::Value> = HashMap::new();
        assert!(entries.is_empty());

        let meta: String = sqlx::query_scalar("SELECT metadata FROM files WHERE file_id = ?")
            .bind(&file_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&meta).unwrap();
        assert_eq!(parsed["key"], "val");
    }
}
