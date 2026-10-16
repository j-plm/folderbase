//! Folder mapping: a folder's name becomes a value of a property for every file
//! under it. Mappings are stored per folder (`path_mapping_nodes`), re-applied on
//! every sync, and never move files or touch their source tags (the folder names
//! on each file's path, which stay as they are on disk).

use crate::db::DbPool;
use crate::models::Property;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::FromRow;
use std::collections::BTreeSet;
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
    /// Left out of the location: not scanned, its files not indexed.
    pub excluded: bool,
}

fn build_tree_node(
    folder_rel: &str,
    depth: i64,
    root_path: &str,
    file_counts: &std::collections::HashMap<String, i64>,
    children_map: &std::collections::HashMap<String, Vec<String>>,
    mapping_map: &std::collections::HashMap<String, PathMappingNode>,
    excluded: &BTreeSet<String>,
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
        .map(|c| build_tree_node(c, depth + 1, root_path, file_counts, children_map, mapping_map, excluded))
        .collect();

    FolderTreeNode {
        folder_path,
        folder_name,
        depth,
        file_count,
        children,
        mapping,
        excluded: excluded.contains(folder_rel),
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

    // Excluded folders have no indexed files, but still show (so they can be included again)
    let excluded: BTreeSet<String> =
        sqlx::query_scalar("SELECT folder_rel FROM location_exclusions WHERE location_id = ?")
            .bind(&location_id)
            .fetch_all(db.inner())
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .collect();
    for rel in &excluded {
        let parts: Vec<&str> = rel.split('/').collect();
        for i in 1..=parts.len() {
            file_counts.entry(parts[..i].join("/")).or_insert(0);
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
        .map(|c| build_tree_node(c, 1, root_path, &file_counts, &children_map, &mapping_map, &excluded))
        .collect();

    Ok(FolderTreeNode {
        folder_path: root_path.to_string(),
        folder_name: root_name,
        depth: 0,
        file_count: total_files,
        children,
        mapping: None,
        excluded: false,
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

/// Labels one folder, keeping values the files already hold in a Select property.
pub async fn set_folder_label_impl(
    location_id: &str,
    folder_path: &str,
    property_name: &str,
    pool: &DbPool,
) -> Result<(), String> {
    label_folder(location_id, folder_path, property_name, false, pool).await
}

/// Labels several folders with one property. With `overwrite`, a Select property
/// takes the folder's name even where a file already has another value.
#[tauri::command]
pub async fn set_folder_labels(
    location_id: String,
    folder_paths: Vec<String>,
    property_name: String,
    overwrite: bool,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    set_folder_labels_impl(&location_id, &folder_paths, &property_name, overwrite, db.inner()).await
}

pub async fn set_folder_labels_impl(
    location_id: &str,
    folder_paths: &[String],
    property_name: &str,
    overwrite: bool,
    pool: &DbPool,
) -> Result<(), String> {
    for folder_path in folder_paths {
        label_folder(location_id, folder_path, property_name, overwrite, pool).await?;
    }
    Ok(())
}

/// Labels one folder. Relabelling replaces the previous property: the folder's
/// value is taken out of it before the new one is written, so no stale values remain.
async fn label_folder(
    location_id: &str,
    folder_path: &str,
    property_name: &str,
    overwrite: bool,
    pool: &DbPool,
) -> Result<(), String> {
    let property_name = property_name.trim();
    if property_name.is_empty() {
        return Err("property name must not be empty".to_string());
    }

    let root_path = location_root(location_id, pool).await?;
    let folder_rel = folder_rel_from_abs(&root_path, folder_path)?;
    let depth = folder_rel.split('/').filter(|s| !s.is_empty()).count() as i64;

    let previous: Option<String> = sqlx::query_scalar(
        "SELECT property_name FROM path_mapping_nodes WHERE location_id = ? AND folder_path = ?",
    )
    .bind(location_id)
    .bind(folder_path)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some(old) = previous.as_deref().filter(|old| *old != property_name) {
        unapply_mapping_from_files(location_id, &root_path, folder_path, old, pool).await?;
    }

    if previous.as_deref() != Some(property_name) {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO path_mapping_nodes \
             (node_id, location_id, folder_path, property_name, depth, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(location_id, folder_path) DO UPDATE SET \
             property_name = excluded.property_name, \
             depth = excluded.depth, \
             updated_at = excluded.updated_at",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(location_id)
        .bind(folder_path)
        .bind(property_name)
        .bind(depth)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    apply_mapping(location_id, &root_path, folder_path, property_name, overwrite, pool).await
}

#[tauri::command]
pub async fn clear_folder_label(
    location_id: String,
    folder_path: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    clear_folder_label_impl(&location_id, &folder_path, db.inner()).await
}

#[tauri::command]
pub async fn clear_folder_labels(
    location_id: String,
    folder_paths: Vec<String>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    for folder_path in &folder_paths {
        clear_folder_label_impl(&location_id, folder_path, db.inner()).await?;
    }
    Ok(())
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
        let root_path = location_root(location_id, pool).await?;
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

/// Every folder in the location with this name, at any depth (absolute paths).
/// A source tag is a folder name, so these are the folders it stands for.
#[tauri::command]
pub async fn folders_named(
    location_id: String,
    name: String,
    db: State<'_, DbPool>,
) -> Result<Vec<String>, String> {
    folders_named_impl(&location_id, &name, db.inner()).await
}

pub async fn folders_named_impl(
    location_id: &str,
    name: &str,
    pool: &DbPool,
) -> Result<Vec<String>, String> {
    let root_path = location_root(location_id, pool).await?;
    let rel_paths: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT relative_path FROM files WHERE location_id = ? AND relative_path IS NOT NULL",
    )
    .bind(location_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let root = root_path.replace('\\', "/");
    Ok(folders_with_name(&rel_paths, name)
        .into_iter()
        .map(|rel| format!("{}/{}", root.trim_end_matches('/'), rel))
        .collect())
}

/// Relative paths of the folders, among the parents of `rel_paths`, whose name is `name`.
fn folders_with_name(rel_paths: &[String], name: &str) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    for rel in rel_paths {
        let normalized = rel.replace('\\', "/");
        let parts: Vec<&str> = normalized.split('/').collect();
        for i in 0..parts.len().saturating_sub(1) {
            if parts[i] == name {
                found.insert(parts[..=i].join("/"));
            }
        }
    }
    found
}

/// How many files under these folders already hold a different value in
/// `property_name` that mapping would replace. Always 0 for a Multi-select
/// (or a property that doesn't exist yet, which mapping creates as one).
#[tauri::command]
pub async fn count_mapping_conflicts(
    location_id: String,
    folder_paths: Vec<String>,
    property_name: String,
    db: State<'_, DbPool>,
) -> Result<i64, String> {
    count_mapping_conflicts_impl(&location_id, &folder_paths, &property_name, db.inner()).await
}

pub async fn count_mapping_conflicts_impl(
    location_id: &str,
    folder_paths: &[String],
    property_name: &str,
    pool: &DbPool,
) -> Result<i64, String> {
    let library = location_library(location_id, pool).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let prop = crate::commands::metadata::property_for(&mut conn, property_name, Some(&library)).await?;
    if prop.as_ref().map_or(true, |p| p.value_type == "array") {
        return Ok(0);
    }
    let prop = prop.expect("checked above");
    let root_path = location_root(location_id, pool).await?;
    let mut conflicting = BTreeSet::new();
    for folder_path in folder_paths {
        let folder_rel = folder_rel_from_abs(&root_path, folder_path)?;
        let name = crate::commands::metadata::mapped_value(&mut conn, &prop.property_id, &folder_name_of(folder_path)).await?;
        for (file_id, meta) in files_under(location_id, &folder_rel, pool).await? {
            match meta.get(property_name) {
                None | Some(Value::Null) => {}
                Some(Value::String(s)) if *s == name => {}
                Some(_) => {
                    conflicting.insert(file_id);
                }
            }
        }
    }
    Ok(conflicting.len() as i64)
}

/// Moves a Select / Multi-select value from one property to another on every
/// file in the location that has it. Folders whose mapping gives `from` this
/// value are remapped to `to` (with any rename link), so refreshes keep it there.
/// A Select target takes the value only where empty unless `overwrite`.
#[tauri::command]
pub async fn move_property_value(
    location_id: String,
    value: String,
    from: String,
    to: String,
    overwrite: bool,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    move_property_value_impl(&location_id, &value, &from, &to, overwrite, db.inner()).await
}

pub async fn move_property_value_impl(
    location_id: &str,
    value: &str,
    from: &str,
    to: &str,
    overwrite: bool,
    pool: &DbPool,
) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    let library = location_library(location_id, pool).await?;
    let to_prop = mapping_property(location_id, to, pool).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let from_prop = crate::commands::metadata::property_for(&mut conn, from, Some(&library)).await?;

    // Folders mapped to `from` that give it this value: their names, and any renamed from
    let mut folders = Vec::new();
    let nodes: Vec<PathMappingNode> =
        sqlx::query_as("SELECT * FROM path_mapping_nodes WHERE location_id = ? AND property_name = ?")
            .bind(location_id)
            .bind(from)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    for node in nodes {
        let name = folder_name_of(&node.folder_path);
        let mapped = match &from_prop {
            Some(p) => crate::commands::metadata::mapped_value(&mut conn, &p.property_id, &name).await?,
            None => name.clone(),
        };
        if mapped == value {
            folders.push((node.folder_path, name));
        }
    }
    // The rename link goes with them ("01 Apollo" → "Apollo" in the new property too)
    if let Some(p) = &from_prop {
        for (_, name) in folders.iter().filter(|(_, name)| name != value) {
            sqlx::query("INSERT OR REPLACE INTO value_aliases (property_id, source, value) VALUES (?, ?, ?)")
                .bind(&to_prop.property_id)
                .bind(name)
                .bind(value)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        }
        drop(conn);
        for (folder_path, _) in &folders {
            label_folder(location_id, folder_path, to, overwrite, pool).await?;
        }
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        for (_, name) in &folders {
            sqlx::query("DELETE FROM value_aliases WHERE property_id = ? AND source = ?")
                .bind(&p.property_id)
                .bind(name)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        }
    } else {
        drop(conn);
    }

    // Every other file with the value (set by hand, or under folders mapped elsewhere)
    let list = to_prop.value_type == "array";
    let rows: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT file_id, metadata FROM files WHERE location_id = ?")
            .bind(location_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for (file_id, raw) in rows {
        let Some(mut meta) = raw.and_then(|m| serde_json::from_str::<Map<String, Value>>(&m).ok()) else {
            continue;
        };
        if !remove_mapped_value(&mut meta, from, value) {
            continue;
        }
        add_mapped_value(&mut meta, to, value, list, overwrite);
        save_metadata(&mut tx, &file_id, &meta).await?;
    }
    if list || to_prop.value_type == "enum" {
        crate::commands::metadata::register_values(&mut tx, &to_prop.property_id, [value.to_string()]).await?;
    }
    // `from` stops offering the value once no file in the library has it
    if let Some(p) = &from_prop {
        let still_used: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM files WHERE library = ? AND EXISTS \
             (SELECT 1 FROM json_each(metadata, ?) WHERE value = ?)",
        )
        .bind(&library)
        .bind(crate::db::utils::json_path(from))
        .bind(value)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        if still_used == 0 {
            sqlx::query("DELETE FROM property_values WHERE property_id = ? AND value = ?")
                .bind(&p.property_id)
                .bind(value)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}

async fn location_root(location_id: &str, pool: &DbPool) -> Result<String, String> {
    sqlx::query_scalar("SELECT root_path FROM locations WHERE location_id = ?")
        .bind(location_id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}

async fn location_library(location_id: &str, pool: &DbPool) -> Result<String, String> {
    sqlx::query_scalar("SELECT library FROM locations WHERE location_id = ?")
        .bind(location_id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}

// Strips root_path prefix from folder_path to get the relative folder path.
pub(crate) fn folder_rel_from_abs(root_path: &str, folder_path: &str) -> Result<String, String> {
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

fn folder_name_of(folder_path: &str) -> String {
    folder_path
        .replace('\\', "/")
        .trim_end_matches('/')
        .split('/')
        .last()
        .unwrap_or("")
        .to_string()
}

/// Files anywhere under a folder (relative to the location root), with their metadata.
async fn files_under(
    location_id: &str,
    folder_rel: &str,
    pool: &DbPool,
) -> Result<Vec<(String, Map<String, Value>)>, String> {
    // A prefix match rather than LIKE, so "_" and "%" in folder names match literally
    let prefix = format!("{folder_rel}/");
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT file_id, metadata FROM files \
         WHERE location_id = ? AND substr(relative_path, 1, length(?)) = ?",
    )
    .bind(location_id)
    .bind(&prefix)
    .bind(&prefix)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(id, meta)| {
            let parsed = meta
                .as_deref()
                .and_then(|m| serde_json::from_str::<Map<String, Value>>(m).ok())
                .unwrap_or_default();
            (id, parsed)
        })
        .collect())
}

/// Adds a folder's name to a file's value for `key`. A Multi-select (`list`)
/// gains it alongside what's there; a Select only takes it when empty, unless
/// `overwrite`. Returns whether the metadata changed.
pub fn add_mapped_value(meta: &mut Map<String, Value>, key: &str, value: &str, list: bool, overwrite: bool) -> bool {
    let new = Value::String(value.to_string());
    match (list, meta.get(key)) {
        (true, None | Some(Value::Null)) => {
            meta.insert(key.to_string(), Value::Array(vec![new]));
            true
        }
        (true, Some(Value::Array(items))) => {
            if items.contains(&new) {
                return false;
            }
            let mut items = items.clone();
            items.push(new);
            meta.insert(key.to_string(), Value::Array(items));
            true
        }
        // A single value left from before the property became a Multi-select
        (true, Some(other)) => {
            let old = match other {
                Value::String(s) => Value::String(s.clone()),
                v => Value::String(v.to_string()),
            };
            let items = if old == new { vec![new] } else { vec![old, new] };
            meta.insert(key.to_string(), Value::Array(items));
            true
        }
        (false, None | Some(Value::Null)) => {
            meta.insert(key.to_string(), new);
            true
        }
        (false, Some(existing)) => {
            if *existing == new || !overwrite {
                return false;
            }
            meta.insert(key.to_string(), new);
            true
        }
    }
}

/// Takes a folder's name back out of a file's value for `key`, removing the key
/// when nothing is left. Returns whether the metadata changed.
pub fn remove_mapped_value(meta: &mut Map<String, Value>, key: &str, value: &str) -> bool {
    match meta.get(key) {
        Some(Value::Array(items)) => {
            let kept: Vec<Value> = items.iter().filter(|v| v.as_str() != Some(value)).cloned().collect();
            if kept.len() == items.len() {
                return false;
            }
            if kept.is_empty() {
                meta.remove(key);
            } else {
                meta.insert(key.to_string(), Value::Array(kept));
            }
            true
        }
        Some(Value::String(s)) if s == value => {
            meta.remove(key);
            true
        }
        _ => false,
    }
}

/// The property a mapping writes to, created as a Multi-select if it doesn't exist.
async fn mapping_property(location_id: &str, property_name: &str, pool: &DbPool) -> Result<Property, String> {
    let library = location_library(location_id, pool).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    if let Some(prop) = crate::commands::metadata::property_for(&mut conn, property_name, Some(&library)).await? {
        return Ok(prop);
    }
    let prop = Property {
        property_id: Uuid::new_v4().to_string(),
        name: property_name.to_string(),
        library: Some(library),
        value_type: "array".to_string(),
        config: None,
    };
    sqlx::query("INSERT INTO properties (property_id, name, library, value_type, config) VALUES (?, ?, ?, ?, NULL)")
        .bind(&prop.property_id)
        .bind(&prop.name)
        .bind(&prop.library)
        .bind(&prop.value_type)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(prop)
}

/// Reverses `apply_mapping`: takes the folder's name out of the property on every
/// file under the folder. Source tags are untouched.
async fn unapply_mapping_from_files(
    location_id: &str,
    root_path: &str,
    folder_path: &str,
    property_name: &str,
    pool: &DbPool,
) -> Result<(), String> {
    let folder_rel = folder_rel_from_abs(root_path, folder_path)?;
    let library = location_library(location_id, pool).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let value = match crate::commands::metadata::property_for(&mut conn, property_name, Some(&library)).await? {
        Some(prop) => crate::commands::metadata::mapped_value(&mut conn, &prop.property_id, &folder_name_of(folder_path)).await?,
        None => folder_name_of(folder_path),
    };
    drop(conn);
    let files = files_under(location_id, &folder_rel, pool).await?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for (file_id, mut meta) in files {
        if remove_mapped_value(&mut meta, property_name, &value) {
            save_metadata(&mut tx, &file_id, &meta).await?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}

/// Applies a single mapping node's label to all matching files, never replacing
/// values already there (see `add_mapped_value`). Sync calls this after every refresh.
pub async fn apply_mapping_to_files(
    location_id: &str,
    root_path: &str,
    folder_path: &str,
    property_name: &str,
    pool: &DbPool,
) -> Result<(), String> {
    apply_mapping(location_id, root_path, folder_path, property_name, false, pool).await
}

async fn apply_mapping(
    location_id: &str,
    root_path: &str,
    folder_path: &str,
    property_name: &str,
    overwrite: bool,
    pool: &DbPool,
) -> Result<(), String> {
    let folder_rel = folder_rel_from_abs(root_path, folder_path)?;
    let prop = mapping_property(location_id, property_name, pool).await?;
    let list = prop.value_type == "array";
    let files = files_under(location_id, &folder_rel, pool).await?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    // The folder's name, or what that value was renamed to
    let value = crate::commands::metadata::mapped_value(&mut tx, &prop.property_id, &folder_name_of(folder_path)).await?;
    for (file_id, mut meta) in files {
        if add_mapped_value(&mut meta, property_name, &value, list, overwrite) {
            save_metadata(&mut tx, &file_id, &meta).await?;
        }
    }
    if prop.value_type == "array" || prop.value_type == "enum" {
        crate::commands::metadata::register_values(&mut tx, &prop.property_id, [value]).await?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

async fn save_metadata(conn: &mut sqlx::SqliteConnection, file_id: &str, meta: &Map<String, Value>) -> Result<(), String> {
    sqlx::query("UPDATE files SET metadata = ? WHERE file_id = ?")
        .bind(Value::Object(meta.clone()).to_string())
        .bind(file_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn meta(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn multi_select_gains_the_value_alongside_others() {
        let mut m = meta(json!({ "Client": ["Beta"] }));
        assert!(add_mapped_value(&mut m, "Client", "Acme", true, false));
        assert_eq!(m["Client"], json!(["Beta", "Acme"]));
        // Already there: nothing to do
        assert!(!add_mapped_value(&mut m, "Client", "Acme", true, false));
    }

    #[test]
    fn multi_select_absorbs_a_legacy_single_value() {
        let mut m = meta(json!({ "Client": "Beta" }));
        assert!(add_mapped_value(&mut m, "Client", "Acme", true, false));
        assert_eq!(m["Client"], json!(["Beta", "Acme"]));
        let mut same = meta(json!({ "Client": "Acme" }));
        assert!(add_mapped_value(&mut same, "Client", "Acme", true, false));
        assert_eq!(same["Client"], json!(["Acme"]));
    }

    #[test]
    fn select_keeps_existing_value_unless_overwriting() {
        let mut m = meta(json!({ "Client": "Beta" }));
        assert!(!add_mapped_value(&mut m, "Client", "Acme", false, false));
        assert_eq!(m["Client"], json!("Beta"));
        assert!(add_mapped_value(&mut m, "Client", "Acme", false, true));
        assert_eq!(m["Client"], json!("Acme"));
        let mut empty = Map::new();
        assert!(add_mapped_value(&mut empty, "Client", "Acme", false, false));
        assert_eq!(empty["Client"], json!("Acme"));
    }

    #[test]
    fn remove_drops_value_and_empty_key() {
        let mut m = meta(json!({ "Client": ["Acme", "Beta"], "Owner": "Acme" }));
        assert!(remove_mapped_value(&mut m, "Client", "Acme"));
        assert_eq!(m["Client"], json!(["Beta"]));
        assert!(remove_mapped_value(&mut m, "Client", "Beta"));
        assert!(!m.contains_key("Client"));
        assert!(remove_mapped_value(&mut m, "Owner", "Acme"));
        assert!(!remove_mapped_value(&mut m, "Owner", "Acme"));
    }

    #[test]
    fn finds_same_named_folders_at_any_depth() {
        let rels = vec![
            "Clients/Acme/brief.pdf".to_string(),
            "Archive/2023/Acme/old.pdf".to_string(),
            "Acme.pdf".to_string(),
            "Acme Ltd/x.pdf".to_string(),
        ];
        let found: Vec<String> = folders_with_name(&rels, "Acme").into_iter().collect();
        assert_eq!(found, vec!["Archive/2023/Acme", "Clients/Acme"]);
        assert!(folders_with_name(&rels, "Nope").is_empty());
    }
}
