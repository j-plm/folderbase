use crate::commands::virtual_folder::{load_nodes_by_parent, FileRecord, NodeRow};
use crate::db::utils::{is_core, json_path_sql};
use crate::db::DbPool;
use crate::models::PropertyValue;
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use tauri::State;

// ─── Shared types ─────────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
pub struct DbFilter {
    pub property: String,
    pub value: String,
}

// ─── Row helper ───────────────────────────────────────────────────────────────

fn to_file_record(row: sqlx::sqlite::SqliteRow) -> FileRecord {
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
}

// ─── query_library_files ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn query_library_files(
    library: String,
    filters: Vec<DbFilter>,
    sort_col: Option<String>,
    sort_dir: Option<String>,
    pool: State<'_, DbPool>,
) -> Result<Vec<FileRecord>, String> {
    query_library_files_inner(
        pool.inner(),
        &library,
        &filters,
        sort_col.as_deref(),
        sort_dir.as_deref(),
    )
    .await
}

pub async fn query_library_files_inner(
    pool: &DbPool,
    library: &str,
    filters: &[DbFilter],
    sort_col: Option<&str>,
    sort_dir: Option<&str>,
) -> Result<Vec<FileRecord>, String> {
    // Build filter WHERE clause from DbFilter list using the shared constraint builder logic.
    let pairs: Vec<(String, String)> = filters
        .iter()
        .map(|f| (f.property.clone(), f.value.clone()))
        .collect();

    let (filter_sql, filter_bindings) = build_filter_sql(&pairs);

    let dir = match sort_dir {
        Some(d) if d.eq_ignore_ascii_case("desc") => "DESC",
        _ => "ASC",
    };
    let order_clause = match sort_col {
        None => "timestamp DESC, file_id ASC".to_string(),
        Some(col) => {
            if is_core(col) {
                format!("{} {} NULLS LAST, file_id ASC", col, dir)
            } else {
                format!(
                    "json_extract(metadata, {}) COLLATE NOCASE {} NULLS LAST, file_id ASC",
                    json_path_sql(col), dir
                )
            }
        }
    };

    let sql = format!(
        "SELECT file_id, file_path, file_type, timestamp, library, metadata \
         FROM files WHERE library = ? AND {} ORDER BY {}",
        filter_sql, order_clause
    );

    let mut q = sqlx::query(&sql).bind(library);
    for b in &filter_bindings {
        q = q.bind(b);
    }

    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(to_file_record).collect())
}

// Like build_constraints_sql in utils.rs but operates on the DbFilter pairs.
fn build_filter_sql(pairs: &[(String, String)]) -> (String, Vec<String>) {
    if pairs.is_empty() {
        return ("1=1".to_string(), vec![]);
    }
    let mut clauses = Vec::new();
    let mut bindings = Vec::new();
    for (prop, val) in pairs {
        if is_core(prop) {
            clauses.push(format!("{} = ?", prop));
            bindings.push(val.clone());
        } else {
            clauses.push(format!(
                "((json_type(metadata, {p}) != 'array' AND json_extract(metadata, {p}) = ?) \
                 OR (json_type(metadata, {p}) = 'array' AND EXISTS (\
                   SELECT 1 FROM json_each(metadata, {p}) je WHERE je.value = ?)))",
                p = json_path_sql(prop)
            ));
            bindings.push(val.clone());
            bindings.push(val.clone());
        }
    }
    (clauses.join(" AND "), bindings)
}

// ─── get_all_property_values ──────────────────────────────────────────────────

#[tauri::command]
pub async fn get_all_property_values(
    library: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<PropertyValue>, String> {
    sqlx::query_as::<_, PropertyValue>(
        "SELECT pv.value_id, pv.property_id, pv.value \
         FROM property_values pv \
         JOIN properties p ON p.property_id = pv.property_id \
         WHERE p.library = ? OR p.library IS NULL \
         ORDER BY p.name, pv.value",
    )
    .bind(library)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

// ─── set_file_metadata_array_add ─────────────────────────────────────────────

#[tauri::command]
pub async fn set_file_metadata_array_add(
    file_id: String,
    key: String,
    value: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    let meta_str: Option<String> =
        sqlx::query_scalar("SELECT metadata FROM files WHERE file_id = ?")
            .bind(&file_id)
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| e.to_string())?
            .flatten();

    let mut meta: serde_json::Map<String, serde_json::Value> = meta_str
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let current = meta.get(&key).cloned();
    match current {
        None => {
            meta.insert(key.clone(), serde_json::json!([value]));
        }
        Some(serde_json::Value::Array(arr)) => {
            if !arr.iter().any(|v| v.as_str() == Some(value.as_str())) {
                let mut new_arr = arr.clone();
                new_arr.push(serde_json::Value::String(value.clone()));
                meta.insert(key.clone(), serde_json::Value::Array(new_arr));
            }
        }
        Some(serde_json::Value::String(s)) if s != value => {
            meta.insert(key.clone(), serde_json::json!([s, value]));
        }
        Some(_) => {}
    }

    let updated = serde_json::to_string(&meta).map_err(|e| e.to_string())?;
    sqlx::query("UPDATE files SET metadata = ? WHERE file_id = ?")
        .bind(&updated)
        .bind(&file_id)
        .execute(pool.inner())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── set_file_metadata_array_remove ──────────────────────────────────────────

#[tauri::command]
pub async fn set_file_metadata_array_remove(
    file_id: String,
    key: String,
    value: String,
    pool: State<'_, DbPool>,
) -> Result<(), String> {
    let meta_str: Option<String> =
        sqlx::query_scalar("SELECT metadata FROM files WHERE file_id = ?")
            .bind(&file_id)
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| e.to_string())?
            .flatten();

    let mut meta: serde_json::Map<String, serde_json::Value> = meta_str
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let current = meta.get(&key).cloned();
    match current {
        Some(serde_json::Value::Array(arr)) => {
            let new_arr: Vec<serde_json::Value> = arr
                .into_iter()
                .filter(|v| v.as_str() != Some(value.as_str()))
                .collect();
            if new_arr.is_empty() {
                meta.remove(&key);
            } else {
                meta.insert(key.clone(), serde_json::Value::Array(new_arr));
            }
        }
        Some(serde_json::Value::String(s)) if s == value => {
            meta.remove(&key);
        }
        _ => {}
    }

    let updated = serde_json::to_string(&meta).map_err(|e| e.to_string())?;
    sqlx::query("UPDATE files SET metadata = ? WHERE file_id = ?")
        .bind(&updated)
        .bind(&file_id)
        .execute(pool.inner())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── get_incomplete_files ─────────────────────────────────────────────────────

// One step in a root-to-leaf path through the view tree.
// fork_filter = Some((parent_prop_name, required_value)) means this step's branch
// is only applicable to files where parent_prop_name equals required_value.
#[derive(Debug, Clone)]
struct PathStep {
    prop_name: String,
    fork_filter: Option<(String, String)>,
}

fn collect_leaf_paths(
    nodes_by_parent: &HashMap<Option<String>, Vec<NodeRow>>,
    parent_id: Option<&str>,
    parent_prop: Option<&str>,
    current: &mut Vec<PathStep>,
    paths: &mut Vec<Vec<PathStep>>,
) {
    let key = parent_id.map(|s| s.to_string());
    let children = nodes_by_parent.get(&key).map(|v| v.as_slice()).unwrap_or(&[]);

    if children.is_empty() {
        if !current.is_empty() {
            paths.push(current.clone());
        }
        return;
    }

    for child in children {
        let fork_filter = child
            .fork_value
            .as_ref()
            .and_then(|fv| parent_prop.map(|pp| (pp.to_string(), fv.clone())));
        current.push(PathStep {
            prop_name: child.property_name.clone(),
            fork_filter,
        });
        collect_leaf_paths(
            nodes_by_parent,
            Some(&child.node_id),
            Some(&child.property_name),
            current,
            paths,
        );
        current.pop();
    }
}

// For each root-to-leaf path and each incompleteness level, produces a
// (sql_fragment, bindings) pair for use in a UNION query.
// Level K means: file has steps 0..K-1 set, but is missing step K.
// Deduplicates by SQL string so shared path prefixes only appear once.
fn build_incomplete_subqueries(paths: &[Vec<PathStep>]) -> Vec<(String, Vec<String>)> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<(String, Vec<String>)> = Vec::new();

    for path in paths {
        let n = path.len();
        // K ranges from 1 to n-1: file must have at least step 0 to be "placed" in the view.
        for k in 1..n {
            let mut conditions: Vec<String> = Vec::new();
            let mut bindings: Vec<String> = Vec::new();

            // "Has" conditions: steps 0..k-1
            for i in 0..k {
                let step = &path[i];
                conditions.push(is_set_sql(&step.prop_name));
                if let Some((prev_prop, req_val)) = &step.fork_filter {
                    push_match_condition(prev_prop, req_val, &mut conditions, &mut bindings);
                }
            }

            // Fork constraint for the missing step (constrains the previous property's value)
            let missing = &path[k];
            if let Some((prev_prop, req_val)) = &missing.fork_filter {
                push_match_condition(prev_prop, req_val, &mut conditions, &mut bindings);
            }

            // "Missing" condition: step k is not set
            conditions.push(is_not_set_sql(&missing.prop_name));

            let sql = format!(
                "SELECT file_id FROM files WHERE {}",
                conditions.join(" AND ")
            );

            if seen.insert(sql.clone()) {
                result.push((sql, bindings));
            }
        }
    }

    result
}

fn is_set_sql(prop: &str) -> String {
    if is_core(prop) {
        format!("{} IS NOT NULL", prop)
    } else {
        format!("json_extract(metadata, {}) IS NOT NULL", json_path_sql(prop))
    }
}

fn is_not_set_sql(prop: &str) -> String {
    if is_core(prop) {
        format!("{} IS NULL", prop)
    } else {
        format!("json_extract(metadata, {}) IS NULL", json_path_sql(prop))
    }
}

fn push_match_condition(
    prop: &str,
    val: &str,
    conditions: &mut Vec<String>,
    bindings: &mut Vec<String>,
) {
    if is_core(prop) {
        conditions.push(format!("{} = ?", prop));
        bindings.push(val.to_string());
    } else {
        conditions.push(format!(
            "((json_type(metadata, {p}) != 'array' AND json_extract(metadata, {p}) = ?) \
             OR (json_type(metadata, {p}) = 'array' AND EXISTS (\
               SELECT 1 FROM json_each(metadata, {p}) je WHERE je.value = ?)))",
            p = json_path_sql(prop)
        ));
        bindings.push(val.to_string());
        bindings.push(val.to_string());
    }
}

#[tauri::command]
pub async fn get_incomplete_files(
    view_id: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<FileRecord>, String> {
    let library: Option<String> =
        sqlx::query_scalar("SELECT library FROM views WHERE view_id = ?")
            .bind(&view_id)
            .fetch_optional(pool.inner())
            .await
            .map_err(|e| e.to_string())?
            .flatten();

    let nodes_by_parent = load_nodes_by_parent(pool.inner(), &view_id).await?;
    let mut paths: Vec<Vec<PathStep>> = Vec::new();
    collect_leaf_paths(&nodes_by_parent, None, None, &mut Vec::new(), &mut paths);

    if paths.is_empty() {
        return Ok(vec![]);
    }

    let sub_queries = build_incomplete_subqueries(&paths);
    if sub_queries.is_empty() {
        return Ok(vec![]);
    }

    let union_sql: String = sub_queries
        .iter()
        .map(|(sql, _)| sql.as_str())
        .collect::<Vec<_>>()
        .join(" UNION ");

    let library_clause = if library.is_some() {
        "library = ? AND "
    } else {
        ""
    };

    let final_sql = format!(
        "SELECT DISTINCT file_id, file_path, file_type, timestamp, library, metadata \
         FROM files WHERE {}file_id IN ({}) ORDER BY file_id",
        library_clause, union_sql
    );

    let mut q = sqlx::query(&final_sql);
    if let Some(lib) = &library {
        q = q.bind(lib);
    }
    for (_, bindings) in &sub_queries {
        for b in bindings {
            q = q.bind(b);
        }
    }

    let rows = q.fetch_all(pool.inner()).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(to_file_record).collect())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

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

    async fn insert_file(pool: &SqlitePool, library: &str, metadata: &str) -> String {
        let file_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO files (file_id, file_path, library, metadata) VALUES (?, ?, ?, ?)",
        )
        .bind(&file_id)
        .bind(format!("/tmp/{}.jpg", &file_id))
        .bind(library)
        .bind(metadata)
        .execute(pool)
        .await
        .unwrap();
        file_id
    }

    // Seed a view with a linear chain of N property nodes.
    async fn seed_linear_view(
        pool: &SqlitePool,
        library: Option<&str>,
        prop_names: &[&str],
    ) -> String {
        let view_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO views (view_id, name, library, created_at, updated_at) \
             VALUES (?, 'Test', ?, datetime('now'), datetime('now'))",
        )
        .bind(&view_id)
        .bind(library)
        .execute(pool)
        .await
        .unwrap();

        let mut parent: Option<String> = None;
        for (i, name) in prop_names.iter().enumerate() {
            let prop_id = Uuid::new_v4().to_string();
            let node_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO properties (property_id, name, library, value_type) \
                 VALUES (?, ?, ?, 'enum')",
            )
            .bind(&prop_id)
            .bind(name)
            .bind(library)
            .execute(pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO view_nodes (node_id, view_id, parent_node_id, property_id, sort_order) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&node_id)
            .bind(&view_id)
            .bind(&parent)
            .bind(&prop_id)
            .bind(i as i64)
            .execute(pool)
            .await
            .unwrap();
            parent = Some(node_id);
        }
        view_id
    }

    // ── query_library_files ──────────────────────────────────────────────────

    #[tokio::test]
    async fn query_library_files_no_filters_returns_only_library() {
        let pool = setup_db().await;
        insert_file(&pool, "photos", r#"{"year":"2024"}"#).await;
        insert_file(&pool, "photos", r#"{"year":"2023"}"#).await;
        insert_file(&pool, "docs", r#"{"year":"2024"}"#).await;

        let result = query_library_files_inner(&pool, "photos", &[], None, None)
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|f| f.library.as_deref() == Some("photos")));
    }

    #[tokio::test]
    async fn query_library_files_with_json_filter() {
        let pool = setup_db().await;
        insert_file(&pool, "photos", r#"{"year":"2024","rig":"Rig-A"}"#).await;
        insert_file(&pool, "photos", r#"{"year":"2023","rig":"Rig-B"}"#).await;

        let filters = vec![DbFilter {
            property: "year".to_string(),
            value: "2024".to_string(),
        }];
        let result = query_library_files_inner(&pool, "photos", &filters, None, None)
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].metadata["year"], "2024");
    }

    #[tokio::test]
    async fn query_library_files_sort_desc() {
        let pool = setup_db().await;
        insert_file(&pool, "photos", r#"{"year":"2022"}"#).await;
        insert_file(&pool, "photos", r#"{"year":"2024"}"#).await;
        insert_file(&pool, "photos", r#"{"year":"2023"}"#).await;

        let result = query_library_files_inner(&pool, "photos", &[], Some("year"), Some("desc"))
            .await
            .unwrap();
        assert_eq!(result.len(), 3);
        let years: Vec<&str> = result
            .iter()
            .map(|f| f.metadata["year"].as_str().unwrap())
            .collect();
        assert_eq!(years, vec!["2024", "2023", "2022"]);
    }

    #[tokio::test]
    async fn query_library_files_array_filter() {
        let pool = setup_db().await;
        // File with array-valued project
        insert_file(&pool, "photos", r#"{"project":["Apollo","Hermes"]}"#).await;
        insert_file(&pool, "photos", r#"{"project":"Genesis"}"#).await;

        let filters = vec![DbFilter {
            property: "project".to_string(),
            value: "Apollo".to_string(),
        }];
        let result = query_library_files_inner(&pool, "photos", &filters, None, None)
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
    }

    // ── get_all_property_values ──────────────────────────────────────────────

    #[tokio::test]
    async fn get_all_property_values_scoped_and_global() {
        let pool = setup_db().await;
        let p1 = Uuid::new_v4().to_string();
        let p2 = Uuid::new_v4().to_string();
        let p3 = Uuid::new_v4().to_string();
        // scoped to "photos"
        sqlx::query(
            "INSERT INTO properties (property_id, name, library, value_type) VALUES (?, 'rig', 'photos', 'enum')",
        ).bind(&p1).execute(&pool).await.unwrap();
        // global
        sqlx::query(
            "INSERT INTO properties (property_id, name, library, value_type) VALUES (?, 'year', NULL, 'enum')",
        ).bind(&p2).execute(&pool).await.unwrap();
        // scoped to "docs" — should be excluded
        sqlx::query(
            "INSERT INTO properties (property_id, name, library, value_type) VALUES (?, 'author', 'docs', 'enum')",
        ).bind(&p3).execute(&pool).await.unwrap();

        let v1 = Uuid::new_v4().to_string();
        let v2 = Uuid::new_v4().to_string();
        let v3 = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO property_values (value_id, property_id, value) VALUES (?, ?, 'Rig-A')").bind(&v1).bind(&p1).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO property_values (value_id, property_id, value) VALUES (?, ?, '2024')").bind(&v2).bind(&p2).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO property_values (value_id, property_id, value) VALUES (?, ?, 'Alice')").bind(&v3).bind(&p3).execute(&pool).await.unwrap();

        // Simulate the command inline (no Tauri State in tests)
        let result = sqlx::query_as::<_, PropertyValue>(
            "SELECT pv.value_id, pv.property_id, pv.value \
             FROM property_values pv \
             JOIN properties p ON p.property_id = pv.property_id \
             WHERE p.library = ? OR p.library IS NULL \
             ORDER BY p.name, pv.value",
        )
        .bind("photos")
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(result.len(), 2);
        let values: Vec<&str> = result.iter().map(|v| v.value.as_str()).collect();
        assert!(values.contains(&"Rig-A"));
        assert!(values.contains(&"2024"));
        assert!(!values.contains(&"Alice"));
    }

    // ── array add ───────────────────────────────────────────────────────────

    async fn get_metadata(pool: &SqlitePool, file_id: &str) -> serde_json::Value {
        let s: String = sqlx::query_scalar("SELECT metadata FROM files WHERE file_id = ?")
            .bind(file_id)
            .fetch_one(pool)
            .await
            .unwrap();
        serde_json::from_str(&s).unwrap()
    }

    async fn array_add(pool: &SqlitePool, file_id: &str, key: &str, value: &str) {
        let meta_str: Option<String> =
            sqlx::query_scalar("SELECT metadata FROM files WHERE file_id = ?")
                .bind(file_id)
                .fetch_optional(pool)
                .await
                .unwrap()
                .flatten();
        let mut meta: serde_json::Map<String, serde_json::Value> = meta_str
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        let current = meta.get(key).cloned();
        match current {
            None => { meta.insert(key.to_string(), serde_json::json!([value])); }
            Some(serde_json::Value::Array(arr)) => {
                if !arr.iter().any(|v| v.as_str() == Some(value)) {
                    let mut new_arr = arr.clone();
                    new_arr.push(serde_json::Value::String(value.to_string()));
                    meta.insert(key.to_string(), serde_json::Value::Array(new_arr));
                }
            }
            Some(serde_json::Value::String(s)) if s != value => {
                meta.insert(key.to_string(), serde_json::json!([s, value]));
            }
            Some(_) => {}
        }
        let updated = serde_json::to_string(&meta).unwrap();
        sqlx::query("UPDATE files SET metadata = ? WHERE file_id = ?")
            .bind(&updated).bind(file_id).execute(pool).await.unwrap();
    }

    async fn array_remove(pool: &SqlitePool, file_id: &str, key: &str, value: &str) {
        let meta_str: Option<String> =
            sqlx::query_scalar("SELECT metadata FROM files WHERE file_id = ?")
                .bind(file_id)
                .fetch_optional(pool)
                .await
                .unwrap()
                .flatten();
        let mut meta: serde_json::Map<String, serde_json::Value> = meta_str
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        let current = meta.get(key).cloned();
        match current {
            Some(serde_json::Value::Array(arr)) => {
                let new_arr: Vec<serde_json::Value> = arr.into_iter()
                    .filter(|v| v.as_str() != Some(value))
                    .collect();
                if new_arr.is_empty() { meta.remove(key); }
                else { meta.insert(key.to_string(), serde_json::Value::Array(new_arr)); }
            }
            Some(serde_json::Value::String(s)) if s == value => { meta.remove(key); }
            _ => {}
        }
        let updated = serde_json::to_string(&meta).unwrap();
        sqlx::query("UPDATE files SET metadata = ? WHERE file_id = ?")
            .bind(&updated).bind(file_id).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn array_add_to_new_key_creates_array() {
        let pool = setup_db().await;
        let fid = insert_file(&pool, "photos", "{}").await;
        array_add(&pool, &fid, "project", "Apollo").await;
        let meta = get_metadata(&pool, &fid).await;
        assert_eq!(meta["project"], serde_json::json!(["Apollo"]));
    }

    #[tokio::test]
    async fn array_add_to_scalar_converts_to_array() {
        let pool = setup_db().await;
        let fid = insert_file(&pool, "photos", r#"{"project":"Apollo"}"#).await;
        array_add(&pool, &fid, "project", "Hermes").await;
        let meta = get_metadata(&pool, &fid).await;
        assert_eq!(meta["project"], serde_json::json!(["Apollo", "Hermes"]));
    }

    #[tokio::test]
    async fn array_add_idempotent() {
        let pool = setup_db().await;
        let fid = insert_file(&pool, "photos", r#"{"project":["Apollo"]}"#).await;
        array_add(&pool, &fid, "project", "Apollo").await;
        let meta = get_metadata(&pool, &fid).await;
        assert_eq!(meta["project"], serde_json::json!(["Apollo"]));
    }

    #[tokio::test]
    async fn array_remove_removes_one_value() {
        let pool = setup_db().await;
        let fid = insert_file(&pool, "photos", r#"{"project":["Apollo","Hermes"]}"#).await;
        array_remove(&pool, &fid, "project", "Apollo").await;
        let meta = get_metadata(&pool, &fid).await;
        assert_eq!(meta["project"], serde_json::json!(["Hermes"]));
    }

    #[tokio::test]
    async fn array_remove_last_value_clears_key() {
        let pool = setup_db().await;
        let fid = insert_file(&pool, "photos", r#"{"project":["Apollo"]}"#).await;
        array_remove(&pool, &fid, "project", "Apollo").await;
        let meta = get_metadata(&pool, &fid).await;
        assert!(meta.get("project").is_none());
    }

    // ── get_incomplete_files ─────────────────────────────────────────────────

    #[tokio::test]
    async fn get_incomplete_files_returns_only_partially_classified() {
        let pool = setup_db().await;
        // View: year → rig (2 levels, library="photos")
        let view_id = seed_linear_view(&pool, Some("photos"), &["year", "rig"]).await;

        // Complete: has both year and rig
        insert_file(&pool, "photos", r#"{"year":"2024","rig":"Rig-A"}"#).await;
        // Incomplete: has year but not rig
        let incomplete_id = insert_file(&pool, "photos", r#"{"year":"2024"}"#).await;
        // Unclassified: has neither
        insert_file(&pool, "photos", r#"{"angle":"Front"}"#).await;
        // Wrong library
        insert_file(&pool, "docs", r#"{"year":"2024"}"#).await;

        let nodes = load_nodes_by_parent(&pool, &view_id).await.unwrap();
        let mut paths: Vec<Vec<PathStep>> = Vec::new();
        collect_leaf_paths(&nodes, None, None, &mut Vec::new(), &mut paths);
        let sub_qs = build_incomplete_subqueries(&paths);

        assert!(!sub_qs.is_empty());

        let union_sql: String = sub_qs.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>().join(" UNION ");
        let final_sql = format!(
            "SELECT DISTINCT file_id FROM files WHERE library = ? AND file_id IN ({})",
            union_sql
        );
        let mut q = sqlx::query(&final_sql).bind("photos");
        for (_, binds) in &sub_qs {
            for b in binds { q = q.bind(b); }
        }
        let rows = q.fetch_all(&pool).await.unwrap();
        assert_eq!(rows.len(), 1);
        let returned_id: String = rows[0].get("file_id");
        assert_eq!(returned_id, incomplete_id);
    }

    #[tokio::test]
    async fn get_incomplete_files_forking_view() {
        let pool = setup_db().await;
        // View: year → type (fork) → Photos branch: rig; Videos branch: project
        let view_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO views (view_id, name, library, created_at, updated_at) \
             VALUES (?, 'Fork', 'media', datetime('now'), datetime('now'))",
        ).bind(&view_id).execute(&pool).await.unwrap();

        let p_year = Uuid::new_v4().to_string();
        let p_type = Uuid::new_v4().to_string();
        let p_rig = Uuid::new_v4().to_string();
        let p_project = Uuid::new_v4().to_string();
        for (pid, name) in [(&p_year, "year"), (&p_type, "type"), (&p_rig, "rig"), (&p_project, "project")] {
            sqlx::query("INSERT INTO properties (property_id, name, library, value_type) VALUES (?, ?, 'media', 'enum')")
                .bind(pid).bind(name).execute(&pool).await.unwrap();
        }

        let n_year = Uuid::new_v4().to_string();
        let n_type = Uuid::new_v4().to_string();
        let n_rig = Uuid::new_v4().to_string();
        let n_project = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO view_nodes (node_id, view_id, parent_node_id, property_id, fork_value, sort_order) VALUES (?, ?, NULL, ?, NULL, 0)")
            .bind(&n_year).bind(&view_id).bind(&p_year).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO view_nodes (node_id, view_id, parent_node_id, property_id, fork_value, sort_order) VALUES (?, ?, ?, ?, NULL, 0)")
            .bind(&n_type).bind(&view_id).bind(&n_year).bind(&p_type).execute(&pool).await.unwrap();
        // rig: fork_value="Photos"
        sqlx::query("INSERT INTO view_nodes (node_id, view_id, parent_node_id, property_id, fork_value, sort_order) VALUES (?, ?, ?, ?, 'Photos', 0)")
            .bind(&n_rig).bind(&view_id).bind(&n_type).bind(&p_rig).execute(&pool).await.unwrap();
        // project: fork_value="Videos"
        sqlx::query("INSERT INTO view_nodes (node_id, view_id, parent_node_id, property_id, fork_value, sort_order) VALUES (?, ?, ?, ?, 'Videos', 1)")
            .bind(&n_project).bind(&view_id).bind(&n_type).bind(&p_project).execute(&pool).await.unwrap();

        // Complete photo: has year, type=Photos, rig
        insert_file(&pool, "media", r#"{"year":"2024","type":"Photos","rig":"Rig-A"}"#).await;
        // Incomplete photo: has year, type=Photos but no rig
        let incomplete_photo = insert_file(&pool, "media", r#"{"year":"2024","type":"Photos"}"#).await;
        // Incomplete at fork: has year but no type
        let incomplete_at_fork = insert_file(&pool, "media", r#"{"year":"2024"}"#).await;
        // Complete video: has year, type=Videos, project
        insert_file(&pool, "media", r#"{"year":"2024","type":"Videos","project":"Apollo"}"#).await;
        // Unclassified: no year
        insert_file(&pool, "media", r#"{"rig":"Rig-B"}"#).await;

        let nodes = load_nodes_by_parent(&pool, &view_id).await.unwrap();
        let mut paths: Vec<Vec<PathStep>> = Vec::new();
        collect_leaf_paths(&nodes, None, None, &mut Vec::new(), &mut paths);
        let sub_qs = build_incomplete_subqueries(&paths);

        let union_sql: String = sub_qs.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>().join(" UNION ");
        let final_sql = format!(
            "SELECT DISTINCT file_id FROM files WHERE library = ? AND file_id IN ({})",
            union_sql
        );
        let mut q = sqlx::query(&final_sql).bind("media");
        for (_, binds) in &sub_qs {
            for b in binds { q = q.bind(b); }
        }
        let rows = q.fetch_all(&pool).await.unwrap();
        let ids: Vec<String> = rows.iter().map(|r| r.get("file_id")).collect();
        assert!(ids.contains(&incomplete_photo), "incomplete photo should be returned");
        assert!(ids.contains(&incomplete_at_fork), "incomplete at fork should be returned");
        assert_eq!(ids.len(), 2, "only 2 incomplete files");
    }
}
