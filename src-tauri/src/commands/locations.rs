use crate::db::DbPool;
use crate::models::Location;
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_locations(db: State<'_, DbPool>) -> Result<Vec<Location>, String> {
    sqlx::query_as::<_, Location>("SELECT * FROM locations ORDER BY name")
        .fetch_all(db.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_location(
    root_path: String,
    name: String,
    db: State<'_, DbPool>,
) -> Result<Location, String> {
    let location_id = Uuid::new_v4().to_string();
    let library = name.to_lowercase().replace(' ', "_");
    let added_at = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO locations (location_id, name, root_path, library, added_at) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&location_id)
    .bind(&name)
    .bind(&root_path)
    .bind(&library)
    .bind(&added_at)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;
    crate::commands::properties::ensure_tags_property(db.inner(), &library).await?;

    sqlx::query_as::<_, Location>("SELECT * FROM locations WHERE location_id = ?")
        .bind(&location_id)
        .fetch_one(db.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_location(
    location_id: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let mut tx = db.inner().begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM path_mapping_nodes WHERE location_id = ?")
        .bind(&location_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM files WHERE location_id = ?")
        .bind(&location_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM locations WHERE location_id = ?")
        .bind(&location_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
