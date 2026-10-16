use crate::db::DbPool;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PathMappingNode {
    pub node_id: String,
    pub location_id: String,
    pub folder_path: String,
    pub property_name: String,
    pub depth: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderTreeNode {
    pub folder_path: String,
    pub folder_name: String,
    pub depth: i64,
    pub file_count: i64,
    pub children: Vec<FolderTreeNode>,
    pub mapping: Option<PathMappingNode>,
}

fn build_tree_node(
    folder_rel: &str,
    depth: i64,
    root_path: &str,
    file_counts: &std::collections::HashMap<String, i64>,
    children_map: &std::collections::HashMap<String, Vec<String>>,
    mapping_map: &std::collections::HashMap<String, PathMappingNode>,
) -> FolderTreeNode {
    let folder_path = format!("{}/{}", root_path.trim_end_matches('/'), folder_rel);
    let folder_name = folder_rel.split('/').last().unwrap_or(folder_rel).to_string();
    let file_count = *file_counts.get(folder_rel).unwrap_or(&0);
    let mapping = mapping_map.get(&folder_path).cloned();

    let empty = Vec::new();
    let children: Vec<FolderTreeNode> = children_map
        .get(folder_rel)
        .unwrap_or(&empty)
        .iter()
        .map(|c| build_tree_node(c, depth + 1, root_path, file_counts, children_map, mapping_map))
        .collect();

    FolderTreeNode {
        folder_path,
        folder_name,
        depth,
        file_count,
        children,
        mapping,
    }
}

#[tauri::command]
pub async fn get_folder_tree(
    location_id: String,
    db: State<'_, DbPool>,
) -> Result<FolderTreeNode, String> {
    let location =
        sqlx::query_as::<_, crate::models::Location>("SELECT * FROM locations WHERE location_id = ?")
            .bind(&location_id)
            .fetch_one(db.inner())
            .await
            .map_err(|e| e.to_string())?;

    let rel_paths: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT relative_path FROM files WHERE location_id = ? AND relative_path IS NOT NULL",
    )
    .bind(&location_id)
    .fetch_all(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    let mapping_nodes: Vec<PathMappingNode> =
        sqlx::query_as("SELECT * FROM path_mapping_nodes WHERE location_id = ?")
            .bind(&location_id)
            .fetch_all(db.inner())
            .await
            .map_err(|e| e.to_string())?;

    let mapping_map: std::collections::HashMap<String, PathMappingNode> = mapping_nodes
        .into_iter()
        .map(|m| (m.folder_path.clone(), m))
        .collect();

    // Count files per ancestor folder
    let mut file_counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for rel in &rel_paths {
        let normalized = rel.replace('\\', "/");
        let parts: Vec<&str> = normalized.split('/').collect();
        for i in 1..parts.len() {
            let folder_rel = parts[..i].join("/");
            *file_counts.entry(folder_rel).or_insert(0) += 1;
        }
    }

    // Build parent→children map
    let mut children_map: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let mut root_children: Vec<String> = Vec::new();

    for folder_rel in file_counts.keys() {
        let parts: Vec<&str> = folder_rel.split('/').collect();
        if parts.len() == 1 {
            root_children.push(folder_rel.clone());
        } else {
            let parent = parts[..parts.len() - 1].join("/");
            children_map.entry(parent).or_default().push(folder_rel.clone());
        }
    }

    root_children.sort();
    for v in children_map.values_mut() {
        v.sort();
    }

    let root_path = location.root_path.trim_end_matches('/');
    let root_name = root_path.split('/').last().unwrap_or(root_path).to_string();
    let total_files = rel_paths.len() as i64;

    let children: Vec<FolderTreeNode> = root_children
        .iter()
        .map(|c| build_tree_node(c, 1, root_path, &file_counts, &children_map, &mapping_map))
        .collect();

    Ok(FolderTreeNode {
        folder_path: root_path.to_string(),
        folder_name: root_name,
        depth: 0,
        file_count: total_files,
        children,
        mapping: None,
    })
}

#[tauri::command]
pub async fn set_folder_label(
    location_id: String,
    folder_path: String,
    property_name: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    set_folder_label_impl(&location_id, &folder_path, &property_name, db.inner()).await
}

/// Labels one folder. Relabelling replaces the previous property: its key is
/// stripped from the files before the new one is written, so no stale keys remain.
pub async fn set_folder_label_impl(
    location_id: &str,
    folder_path: &str,
    property_name: &str,
    pool: &DbPool,
) -> Result<(), String> {
    let property_name = property_name.trim();
    if property_name.is_empty() {
        return Err("property name must not be empty".to_string());
    }

    let root_path: String =
        sqlx::query_scalar("SELECT root_path FROM locations WHERE location_id = ?")
            .bind(location_id)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;

    let folder_rel = folder_rel_from_abs(&root_path, folder_path)?;
    let depth = if folder_rel.is_empty() {
        0i64
    } else {
        folder_rel.split('/').filter(|s| !s.is_empty()).count() as i64
    };

    let previous: Option<String> = sqlx::query_scalar(
        "SELECT property_name FROM path_mapping_nodes WHERE location_id = ? AND folder_path = ?",
    )
    .bind(location_id)
    .bind(folder_path)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if previous.as_deref() == Some(property_name) {
        return Ok(());
    }
    if let Some(old) = &previous {
        unapply_mapping_from_files(location_id, &root_path, folder_path, old, pool).await?;
    }

    let now = Utc::now().to_rfc3339();
    let node_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO path_mapping_nodes \
         (node_id, location_id, folder_path, property_name, depth, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(location_id, folder_path) DO UPDATE SET \
         property_name = excluded.property_name, \
         depth = excluded.depth, \
         updated_at = excluded.updated_at",
    )
    .bind(&node_id)
    .bind(location_id)
    .bind(folder_path)
    .bind(property_name)
    .bind(depth)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    apply_mapping_to_files(location_id, &root_path, folder_path, property_name, pool).await
}

#[tauri::command]
pub async fn clear_folder_label(
    location_id: String,
    folder_path: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    clear_folder_label_impl(&location_id, &folder_path, db.inner()).await
}

pub async fn clear_folder_label_impl(
    location_id: &str,
    folder_path: &str,
    pool: &DbPool,
) -> Result<(), String> {
    let row: Option<String> = sqlx::query_scalar(
        "SELECT property_name FROM path_mapping_nodes WHERE location_id = ? AND folder_path = ?",
    )
    .bind(location_id)
    .bind(folder_path)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(property_name) = row {
        let root_path: String =
            sqlx::query_scalar("SELECT root_path FROM locations WHERE location_id = ?")
                .bind(location_id)
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?;
        unapply_mapping_from_files(location_id, &root_path, folder_path, &property_name, pool)
            .await?;
    }

    sqlx::query(
        "DELETE FROM path_mapping_nodes WHERE location_id = ? AND folder_path = ?",
    )
    .bind(location_id)
    .bind(folder_path)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_mapping_nodes(
    location_id: String,
    db: State<'_, DbPool>,
) -> Result<Vec<PathMappingNode>, String> {
    let nodes: Vec<PathMappingNode> =
        sqlx::query_as("SELECT * FROM path_mapping_nodes WHERE location_id = ?")
            .bind(&location_id)
            .fetch_all(db.inner())
            .await
            .map_err(|e| e.to_string())?;
    Ok(nodes)
}

// Strips root_path prefix from folder_path to get the relative folder path.
fn folder_rel_from_abs(root_path: &str, folder_path: &str) -> Result<String, String> {
    let root = root_path.replace('\\', "/");
    let root = root.trim_end_matches('/');
    let folder = folder_path.replace('\\', "/");
    let folder = folder.trim_end_matches('/');
    if folder == root {
        return Ok(String::new());
    }
    if folder.starts_with(&format!("{}/", root)) {
        Ok(folder[root.len() + 1..].to_string())
    } else {
        Err(format!(
            "folder_path '{}' is not under location root '{}'",
            folder_path, root_path
        ))
    }
}

/// Reverses `apply_mapping_to_files`: removes the property key from files whose value
/// came from this folder, and restores the folder name to their tags.
async fn unapply_mapping_from_files(
    location_id: &str,
    root_path: &str,
    folder_path: &str,
    property_name: &str,
    pool: &DbPool,
) -> Result<(), String> {
    let folder_rel = folder_rel_from_abs(root_path, folder_path)?;
    let folder_name = folder_path
        .replace('\\', "/")
        .split('/')
        .last()
        .unwrap_or("")
        .to_string();
    let prop_key = crate::db::utils::json_path(&property_name);

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE files \
         SET tags = json_insert(tags, '$[#]', ?) \
         WHERE location_id = ? \
         AND (relative_path = ? OR relative_path LIKE ? || '/%') \
         AND json_extract(metadata, ?) = ?",
    )
    .bind(&folder_name)
    .bind(location_id)
    .bind(&folder_rel)
    .bind(&folder_rel)
    .bind(&prop_key)
    .bind(&folder_name)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE files SET metadata = json_remove(metadata, ?) \
         WHERE location_id = ? \
         AND (relative_path = ? OR relative_path LIKE ? || '/%') \
         AND json_extract(metadata, ?) = ?",
    )
    .bind(&prop_key)
    .bind(location_id)
    .bind(&folder_rel)
    .bind(&folder_rel)
    .bind(&prop_key)
    .bind(&folder_name)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())
}

/// Applies a single mapping node's label to all matching files (merge semantics).
/// Only writes the value when the property key is currently absent from metadata.
/// A named folder is never also a tag: its name is removed from the tags of every
/// file that takes its value, including files that already carry it (re-indexing
/// rebuilds tags from paths, so the name comes back and must be stripped again).
pub async fn apply_mapping_to_files(
    location_id: &str,
    root_path: &str,
    folder_path: &str,
    property_name: &str,
    pool: &DbPool,
) -> Result<(), String> {
    let folder_rel = folder_rel_from_abs(root_path, folder_path)?;
    let folder_name = folder_path
        .replace('\\', "/")
        .split('/')
        .last()
        .unwrap_or("")
        .to_string();
    let prop_key = crate::db::utils::json_path(&property_name);

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE files \
         SET tags = COALESCE(\
           (SELECT json_group_array(value) FROM json_each(tags) WHERE value != ?),\
           '[]'\
         ) \
         WHERE location_id = ? \
         AND (relative_path = ? OR relative_path LIKE ? || '/%') \
         AND (json_extract(metadata, ?) IS NULL OR json_extract(metadata, ?) = ?)",
    )
    .bind(&folder_name)
    .bind(location_id)
    .bind(&folder_rel)
    .bind(&folder_rel)
    .bind(&prop_key)
    .bind(&prop_key)
    .bind(&folder_name)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE files SET metadata = json_set(metadata, ?, ?) \
         WHERE location_id = ? \
         AND (relative_path = ? OR relative_path LIKE ? || '/%') \
         AND json_extract(metadata, ?) IS NULL",
    )
    .bind(&prop_key)
    .bind(&folder_name)
    .bind(location_id)
    .bind(&folder_rel)
    .bind(&folder_rel)
    .bind(&prop_key)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(())
}
