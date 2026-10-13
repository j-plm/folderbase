use crate::db::DbPool;
use crate::models::{View, ViewNode};
use serde::Deserialize;
use tauri::State;

const VIEW_NODE_SELECT: &str = "
    SELECT vn.node_id, vn.view_id, vn.parent_node_id, vn.property_id,
           p.name AS property_name, vn.fork_value, vn.sort_order
    FROM view_nodes vn
    JOIN properties p ON p.property_id = vn.property_id
    WHERE vn.view_id = ? ORDER BY vn.sort_order
";

#[tauri::command]
pub async fn get_views(db: State<'_, DbPool>) -> Result<Vec<View>, String> {
    sqlx::query_as::<_, View>("SELECT * FROM views ORDER BY created_at")
        .fetch_all(db.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_view_nodes(
    view_id: String,
    db: State<'_, DbPool>,
) -> Result<Vec<ViewNode>, String> {
    sqlx::query_as::<_, ViewNode>(VIEW_NODE_SELECT)
        .bind(view_id)
        .fetch_all(db.inner())
        .await
        .map_err(|e| e.to_string())
}

// ─── View CRUD ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_view(
    name: String,
    library: Option<String>,
    db: State<'_, DbPool>,
) -> Result<View, String> {
    let view_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO views (view_id, name, library, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&view_id)
    .bind(&name)
    .bind(&library)
    .bind(&now)
    .bind(&now)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query_as::<_, View>("SELECT * FROM views WHERE view_id = ?")
        .bind(&view_id)
        .fetch_one(db.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_view(
    view_id: String,
    name: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE views SET name = ?, updated_at = ? WHERE view_id = ?")
        .bind(&name)
        .bind(&now)
        .bind(&view_id)
        .execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_view(view_id: String, db: State<'_, DbPool>) -> Result<(), String> {
    sqlx::query("DELETE FROM view_nodes WHERE view_id = ?")
        .bind(&view_id)
        .execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM views WHERE view_id = ?")
        .bind(&view_id)
        .execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── ViewNode CRUD ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_view_node(
    view_id: String,
    parent_node_id: Option<String>,
    property_id: String,
    fork_value: Option<String>,
    sort_order: i64,
    db: State<'_, DbPool>,
) -> Result<ViewNode, String> {
    let node_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO view_nodes (node_id, view_id, parent_node_id, property_id, fork_value, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&node_id)
    .bind(&view_id)
    .bind(&parent_node_id)
    .bind(&property_id)
    .bind(&fork_value)
    .bind(sort_order)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query_as::<_, ViewNode>(
        "SELECT vn.node_id, vn.view_id, vn.parent_node_id, vn.property_id,
                p.name AS property_name, vn.fork_value, vn.sort_order
         FROM view_nodes vn
         JOIN properties p ON p.property_id = vn.property_id
         WHERE vn.node_id = ?",
    )
    .bind(&node_id)
    .fetch_one(db.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_view_node(
    node_id: String,
    property_id: String,
    fork_value: Option<String>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE view_nodes SET property_id = ?, fork_value = ? WHERE node_id = ?",
    )
    .bind(&property_id)
    .bind(&fork_value)
    .bind(&node_id)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_view_node(node_id: String, db: State<'_, DbPool>) -> Result<(), String> {
    // Collect all descendants iteratively before deleting.
    let mut to_delete: Vec<String> = vec![node_id.clone()];
    let mut frontier: Vec<String> = vec![node_id];

    while !frontier.is_empty() {
        let placeholders = frontier.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT node_id FROM view_nodes WHERE parent_node_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&sql);
        for id in &frontier {
            q = q.bind(id);
        }
        let rows = q
            .fetch_all(db.inner())
            .await
            .map_err(|e| e.to_string())?;

        frontier = rows
            .into_iter()
            .map(|r| {
                use sqlx::Row;
                r.get::<String, _>("node_id")
            })
            .collect();
        to_delete.extend(frontier.clone());
    }

    let placeholders = to_delete.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "DELETE FROM view_nodes WHERE node_id IN ({})",
        placeholders
    );
    let mut q = sqlx::query(&sql);
    for id in &to_delete {
        q = q.bind(id);
    }
    q.execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Batch reorder ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ReorderItem {
    pub node_id: String,
    pub sort_order: i64,
}

#[tauri::command]
pub async fn reorder_view_nodes(
    updates: Vec<ReorderItem>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let mut tx = db.inner().begin().await.map_err(|e| e.to_string())?;
    for item in &updates {
        sqlx::query("UPDATE view_nodes SET sort_order = ? WHERE node_id = ?")
            .bind(item.sort_order)
            .bind(&item.node_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
