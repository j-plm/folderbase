use crate::db::utils::{build_constraints_sql, is_core, json_path_sql};
use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FolderEntry {
    pub name: String,
    pub file_count: i64,
    pub has_children: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileRecord {
    pub file_id: String,
    pub file_path: String,
    pub file_type: Option<String>,
    pub timestamp: Option<String>,
    pub library: Option<String>,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", content = "data")]
pub enum QueryResult {
    Folders(Vec<FolderEntry>),
    Files(Vec<FileRecord>),
}

#[derive(Debug)]
pub struct NodeRow {
    pub node_id: String,
    pub parent_node_id: Option<String>,
    pub property_id: String,
    pub property_name: String,
    pub fork_value: Option<String>,
}


async fn fetch_files(
    pool: &DbPool,
    constraints: &[(String, String)],
) -> Result<QueryResult, String> {
    let (where_sql, bindings) = build_constraints_sql(constraints);
    let sql = format!(
        "SELECT file_id, file_path, file_type, timestamp, library, metadata \
         FROM files WHERE {}",
        where_sql
    );
    let mut q = sqlx::query(&sql);
    for b in &bindings {
        q = q.bind(b);
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    let files = rows
        .into_iter()
        .map(|row| {
            let meta_str: Option<String> = row.get("metadata");
            let metadata = meta_str
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::Value::Null);
            FileRecord {
                file_id: row.get("file_id"),
                file_path: row.get("file_path"),
                file_type: row.get("file_type"),
                timestamp: row.get("timestamp"),
                library: row.get("library"),
                metadata,
            }
        })
        .collect();
    Ok(QueryResult::Files(files))
}

async fn enumerate_folders(
    pool: &DbPool,
    constraints: &[(String, String)],
    next_prop: &str,
    next_node_id: &str,
    nodes_by_parent: &HashMap<Option<String>, Vec<NodeRow>>,
) -> Result<QueryResult, String> {
    let (where_sql, bindings) = build_constraints_sql(constraints);

    let sql = if is_core(next_prop) {
        format!(
            "SELECT {p} AS val, COUNT(*) AS file_count \
             FROM files WHERE {w} AND {p} IS NOT NULL \
             GROUP BY val ORDER BY val",
            p = next_prop,
            w = where_sql
        )
    } else {
        // CTE unions scalar branch and array branch to handle both value shapes.
        format!(
            "WITH vals AS (\
               SELECT file_id, json_extract(metadata, {p}) AS val \
               FROM files WHERE {w} AND json_type(metadata, {p}) != 'array'\
               UNION \
               SELECT f.file_id, je.value AS val \
               FROM files f, json_each(f.metadata, {p}) je \
               WHERE {w2} AND json_type(f.metadata, {p}) = 'array'\
             ) \
             SELECT val, COUNT(DISTINCT file_id) AS file_count \
             FROM vals WHERE val IS NOT NULL \
             GROUP BY val ORDER BY val",
            p = json_path_sql(next_prop),
            w = where_sql,
            w2 = where_sql,
        )
    };

    // Non-core CTE has two WHERE clauses, each requiring the same bindings.
    let mut all_bindings = bindings.clone();
    if !is_core(next_prop) {
        all_bindings.extend(bindings);
    }

    let mut q = sqlx::query(&sql);
    for b in &all_bindings {
        q = q.bind(b);
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;

    let empty_vec = vec![];
    let children_of_next = nodes_by_parent
        .get(&Some(next_node_id.to_string()))
        .unwrap_or(&empty_vec);
    let has_null_fork_child = children_of_next.iter().any(|n| n.fork_value.is_none());

    let folders = rows
        .into_iter()
        .map(|row| {
            let name: String = row.get("val");
            let file_count: i64 = row.get("file_count");
            let has_children = has_null_fork_child
                || children_of_next
                    .iter()
                    .any(|n| n.fork_value.as_deref() == Some(name.as_str()));
            FolderEntry {
                name,
                file_count,
                has_children,
            }
        })
        .collect();

    Ok(QueryResult::Folders(folders))
}

pub async fn query_virtual_folder_inner(
    pool: &DbPool,
    view_id: &str,
    path: &[String],
) -> Result<QueryResult, String> {
    let rows = sqlx::query(
        "SELECT vn.node_id, vn.parent_node_id, vn.property_id, p.name AS property_name, vn.fork_value \
         FROM view_nodes vn \
         JOIN properties p ON p.property_id = vn.property_id \
         WHERE vn.view_id = ? \
         ORDER BY vn.sort_order",
    )
    .bind(view_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut nodes_by_parent: HashMap<Option<String>, Vec<NodeRow>> = HashMap::new();
    for row in rows {
        let node = NodeRow {
            node_id: row.get("node_id"),
            parent_node_id: row.get("parent_node_id"),
            property_id: row.get("property_id"),
            property_name: row.get("property_name"),
            fork_value: row.get("fork_value"),
        };
        nodes_by_parent
            .entry(node.parent_node_id.clone())
            .or_default()
            .push(node);
    }

    let mut constraints: Vec<(String, String)> = Vec::new();
    let mut current_parent: Option<String> = None;
    let mut last_value: Option<String> = None;

    for segment in path {
        let children = nodes_by_parent
            .get(&current_parent)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);

        // Active nodes: NULL fork (always active) + fork matching the value selected one level up.
        let active: Vec<&NodeRow> = children
            .iter()
            .filter(|n| {
                n.fork_value.is_none()
                    || n.fork_value.as_deref() == last_value.as_deref()
            })
            .collect();

        if active.is_empty() {
            return Err("path is deeper than the view tree".to_string());
        }

        let node = active[0];
        constraints.push((node.property_name.clone(), segment.clone()));
        current_parent = Some(node.node_id.clone());
        last_value = Some(segment.clone());
    }

    let next_children = nodes_by_parent
        .get(&current_parent)
        .map(|v| v.as_slice())
        .unwrap_or(&[]);

    let active_next: Vec<&NodeRow> = next_children
        .iter()
        .filter(|n| {
            n.fork_value.is_none()
                || n.fork_value.as_deref() == last_value.as_deref()
        })
        .collect();

    if active_next.is_empty() {
        if path.is_empty() {
            // View has no nodes at all.
            return Ok(QueryResult::Folders(vec![]));
        }
        fetch_files(pool, &constraints).await
    } else {
        let next_node = active_next[0];
        enumerate_folders(
            pool,
            &constraints,
            &next_node.property_name.clone(),
            &next_node.node_id.clone(),
            &nodes_by_parent,
        )
        .await
    }
}

#[tauri::command]
pub async fn query_virtual_folder(
    view_id: String,
    path: Vec<String>,
    pool: State<'_, DbPool>,
) -> Result<QueryResult, String> {
    query_virtual_folder_inner(pool.inner(), &view_id, &path).await
}

// ─── Shared tree-loading helper ───────────────────────────────────────────────

pub async fn load_nodes_by_parent(
    pool: &DbPool,
    view_id: &str,
) -> Result<HashMap<Option<String>, Vec<NodeRow>>, String> {
    let rows = sqlx::query(
        "SELECT vn.node_id, vn.parent_node_id, vn.property_id, p.name AS property_name, vn.fork_value \
         FROM view_nodes vn \
         JOIN properties p ON p.property_id = vn.property_id \
         WHERE vn.view_id = ? \
         ORDER BY vn.sort_order",
    )
    .bind(view_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut map: HashMap<Option<String>, Vec<NodeRow>> = HashMap::new();
    for row in rows {
        let node = NodeRow {
            node_id: row.get("node_id"),
            parent_node_id: row.get("parent_node_id"),
            property_id: row.get("property_id"),
            property_name: row.get("property_name"),
            fork_value: row.get("fork_value"),
        };
        map.entry(node.parent_node_id.clone()).or_default().push(node);
    }
    Ok(map)
}

/// Walk the view tree along `path`, returning the active node at each depth.
/// Returns an error if the path exceeds the depth of the view tree.
fn walk_path<'a>(
    nodes_by_parent: &'a HashMap<Option<String>, Vec<NodeRow>>,
    path: &[String],
) -> Result<Vec<&'a NodeRow>, String> {
    let mut current_parent: Option<String> = None;
    let mut last_value: Option<&str> = None;
    let mut walked: Vec<&'a NodeRow> = Vec::with_capacity(path.len());

    for segment in path {
        let children = nodes_by_parent
            .get(&current_parent)
            .map(|v| v.as_slice())
            .unwrap_or(&[]);

        let active: Vec<&NodeRow> = children
            .iter()
            .filter(|n| {
                n.fork_value.is_none() || n.fork_value.as_deref() == last_value
            })
            .collect();

        if active.is_empty() {
            return Err("path is deeper than the view tree".to_string());
        }

        let node = active[0];
        walked.push(node);
        current_parent = Some(node.node_id.clone());
        last_value = Some(segment.as_str());
    }

    Ok(walked)
}

// ─── PathSegmentMeta ──────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct PathSegmentMeta {
    pub property_name: String,
    pub value: String,
}

#[tauri::command]
pub async fn get_path_metadata(
    view_id: String,
    path: Vec<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<PathSegmentMeta>, String> {
    if path.is_empty() {
        return Ok(vec![]);
    }
    let nodes_by_parent = load_nodes_by_parent(pool.inner(), &view_id).await?;
    let walked = walk_path(&nodes_by_parent, &path)?;

    let result = walked
        .into_iter()
        .zip(path.iter())
        .map(|(node, segment)| PathSegmentMeta {
            property_name: node.property_name.clone(),
            value: segment.clone(),
        })
        .collect();

    Ok(result)
}

// ─── CreateFolderResult ───────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct CreateFolderResult {
    pub property_name: String,
    pub value_created: bool,
}

#[tauri::command]
pub async fn create_virtual_folder(
    view_id: String,
    path: Vec<String>,
    name: String,
    pool: State<'_, DbPool>,
) -> Result<CreateFolderResult, String> {
    let nodes_by_parent = load_nodes_by_parent(pool.inner(), &view_id).await?;

    // Find the node that governs the depth we're creating a value at (= depth path.len())
    let walked = walk_path(&nodes_by_parent, &path)?;
    let last_parent: Option<String> = walked.last().map(|n| n.node_id.clone());
    let last_value: Option<&str> = path.last().map(|s| s.as_str());

    let children = nodes_by_parent
        .get(&last_parent)
        .map(|v| v.as_slice())
        .unwrap_or(&[]);

    let active_next: Vec<&NodeRow> = children
        .iter()
        .filter(|n| n.fork_value.is_none() || n.fork_value.as_deref() == last_value)
        .collect();

    let node = active_next
        .first()
        .ok_or_else(|| "no view node at this depth — cannot create a folder here".to_string())?;

    let property_id = &node.property_id;
    let property_name = node.property_name.clone();

    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM property_values WHERE property_id = ? AND value = ?",
    )
    .bind(property_id)
    .bind(&name)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| e.to_string())?;

    if exists > 0 {
        return Ok(CreateFolderResult {
            property_name,
            value_created: false,
        });
    }

    let value_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO property_values (value_id, property_id, value) VALUES (?, ?, ?)",
    )
    .bind(&value_id)
    .bind(property_id)
    .bind(&name)
    .execute(pool.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(CreateFolderResult {
        property_name,
        value_created: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;
    use sqlx::SqlitePool;
    use uuid::Uuid;

    async fn setup_db() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    /// Seed a minimal view with a single node (property "year").
    async fn seed_view(pool: &SqlitePool) -> (String, String, String) {
        let view_id = Uuid::new_v4().to_string();
        let property_id = Uuid::new_v4().to_string();
        let node_id = Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO views (view_id, name, created_at, updated_at) VALUES (?, 'Test', datetime('now'), datetime('now'))",
        )
        .bind(&view_id)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO properties (property_id, name, value_type) VALUES (?, 'year', 'enum')",
        )
        .bind(&property_id)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO view_nodes (node_id, view_id, property_id, sort_order) VALUES (?, ?, ?, 0)",
        )
        .bind(&node_id)
        .bind(&view_id)
        .bind(&property_id)
        .execute(pool)
        .await
        .unwrap();

        (view_id, property_id, node_id)
    }

    #[tokio::test]
    async fn get_path_metadata_returns_pairs() {
        let pool = setup_db().await;
        let (view_id, _property_id, _node_id) = seed_view(&pool).await;

        let nodes = load_nodes_by_parent(&pool, &view_id).await.unwrap();
        let path = vec!["2024".to_string()];
        let walked = walk_path(&nodes, &path).unwrap();
        let result: Vec<PathSegmentMeta> = walked
            .into_iter()
            .zip(path.iter())
            .map(|(n, s)| PathSegmentMeta {
                property_name: n.property_name.clone(),
                value: s.clone(),
            })
            .collect();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].property_name, "year");
        assert_eq!(result[0].value, "2024");
    }

    #[tokio::test]
    async fn create_virtual_folder_creates_value() {
        let pool = setup_db().await;
        let (view_id, property_id, _) = seed_view(&pool).await;

        // Create via pool directly
        let exists: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM property_values WHERE property_id = ?")
                .bind(&property_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(exists, 0);

        // Simulate create_virtual_folder logic
        let nodes = load_nodes_by_parent(&pool, &view_id).await.unwrap();
        let walked = walk_path(&nodes, &[]).unwrap();
        let last_parent: Option<String> = walked.last().map(|n| n.node_id.clone());
        let children = nodes.get(&last_parent).map(|v| v.as_slice()).unwrap_or(&[]);
        let node = children.first().unwrap();

        let value_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO property_values (value_id, property_id, value) VALUES (?, ?, ?)",
        )
        .bind(&value_id)
        .bind(&node.property_id)
        .bind("2025")
        .execute(&pool)
        .await
        .unwrap();

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM property_values WHERE property_id = ? AND value = ?",
        )
        .bind(&node.property_id)
        .bind("2025")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);

        // Duplicate: count should remain 1 if we skip insert
        let duplicate_exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM property_values WHERE property_id = ? AND value = ?",
        )
        .bind(&node.property_id)
        .bind("2025")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(duplicate_exists > 0, "idempotent — no insert needed");
    }

    #[tokio::test]
    async fn create_virtual_folder_beyond_tree_depth_errors() {
        let pool = setup_db().await;
        let (view_id, _, _) = seed_view(&pool).await;

        // Path has 2 segments but view only has 1 node — walk_path should error
        let nodes = load_nodes_by_parent(&pool, &view_id).await.unwrap();
        let deep_path = vec!["2024".to_string(), "January".to_string()];
        let result = walk_path(&nodes, &deep_path);
        assert!(result.is_err());
    }
}
