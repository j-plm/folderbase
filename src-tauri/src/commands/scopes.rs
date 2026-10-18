use std::collections::{HashMap, HashSet};

use crate::db::DbPool;
use crate::models::{PropertyScope, ScopeCondition};
use sqlx::SqliteConnection;
use tauri::State;

// Scoped properties: a property can apply only where other properties hold
// certain values ("Housing applies when Tags has housing"). Conditions are
// combined with *any*. Stored in `property_scopes`, one row per condition; a
// property with no rows applies to every file.

/// Every condition on the library's properties (and global ones).
#[tauri::command]
pub async fn get_property_scopes(library: Option<String>, db: State<'_, DbPool>) -> Result<Vec<PropertyScope>, String> {
    get_property_scopes_impl(db.inner(), library.as_deref()).await
}

pub async fn get_property_scopes_impl(pool: &DbPool, library: Option<&str>) -> Result<Vec<PropertyScope>, String> {
    match library {
        Some(lib) => sqlx::query_as::<_, PropertyScope>(
            "SELECT s.* FROM property_scopes s JOIN properties p USING (property_id) \
             WHERE p.library = ? OR p.library IS NULL ORDER BY s.property_id, s.value",
        )
        .bind(lib)
        .fetch_all(pool)
        .await,
        None => sqlx::query_as::<_, PropertyScope>("SELECT * FROM property_scopes ORDER BY property_id, value")
            .fetch_all(pool)
            .await,
    }
    .map_err(|e| e.to_string())
}

/// Replaces a property's conditions; an empty list makes it apply to every file.
#[tauri::command]
pub async fn set_property_scope(
    property_id: String,
    conditions: Vec<ScopeCondition>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    set_property_scope_impl(db.inner(), &property_id, &conditions).await
}

pub async fn set_property_scope_impl(pool: &DbPool, property_id: &str, conditions: &[ScopeCondition]) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM properties WHERE property_id = ?")
        .bind(property_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err("property not found".into());
    }
    for c in conditions {
        if c.value.trim().is_empty() {
            return Err("a condition needs a value".into());
        }
        let found: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM properties WHERE property_id = ?")
            .bind(&c.property_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        if found == 0 {
            return Err("condition property not found".into());
        }
    }

    // Would the new conditions make the property depend on itself?
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT property_id, condition_property_id FROM property_scopes")
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let mut edges: Vec<(String, String)> = rows.into_iter().filter(|(p, _)| p != property_id).collect();
    edges.extend(conditions.iter().map(|c| (property_id.to_string(), c.property_id.clone())));
    if creates_cycle(&edges, property_id) {
        return Err("A property can't depend on itself, directly or through other properties".into());
    }

    sqlx::query("DELETE FROM property_scopes WHERE property_id = ?")
        .bind(property_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    for c in conditions {
        sqlx::query(
            "INSERT OR IGNORE INTO property_scopes (property_id, condition_property_id, value) VALUES (?, ?, ?)",
        )
        .bind(property_id)
        .bind(&c.property_id)
        .bind(c.value.trim())
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

/// Whether following "depends on" edges (property → condition property) from `start` leads back to it.
pub fn creates_cycle(edges: &[(String, String)], start: &str) -> bool {
    let mut next: HashMap<&str, Vec<&str>> = HashMap::new();
    for (from, to) in edges {
        next.entry(from.as_str()).or_default().push(to.as_str());
    }
    let mut seen = HashSet::new();
    let mut stack: Vec<&str> = next.get(start).cloned().unwrap_or_default();
    while let Some(node) = stack.pop() {
        if node == start {
            return true;
        }
        if seen.insert(node) {
            stack.extend(next.get(node).into_iter().flatten());
        }
    }
    false
}

// ── Upkeep: conditions follow their values ──────────────────────────────────

/// A value renamed (or moved to another property): conditions on it follow, merging with any already there.
pub async fn move_condition_value(
    conn: &mut SqliteConnection,
    from_property: &str,
    from: &str,
    to_property: &str,
    to: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR IGNORE INTO property_scopes (property_id, condition_property_id, value) \
         SELECT property_id, ?, ? FROM property_scopes WHERE condition_property_id = ? AND value = ?",
    )
    .bind(to_property)
    .bind(to)
    .bind(from_property)
    .bind(from)
    .execute(&mut *conn)
    .await
    .map_err(|e| e.to_string())?;
    if from_property != to_property || from != to {
        drop_condition_value(conn, from_property, from).await?;
    }
    Ok(())
}

/// A value deleted: conditions on it go (the properties they scoped stay, with any other conditions).
pub async fn drop_condition_value(conn: &mut SqliteConnection, property_id: &str, value: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM property_scopes WHERE condition_property_id = ? AND value = ?")
        .bind(property_id)
        .bind(value)
        .execute(conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// A property deleted: its own conditions, and conditions on its values.
pub async fn drop_property_scopes(conn: &mut SqliteConnection, property_id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM property_scopes WHERE property_id = ? OR condition_property_id = ?")
        .bind(property_id)
        .bind(property_id)
        .execute(conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::creates_cycle;

    fn edges(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }

    #[test]
    fn a_chain_is_not_a_cycle() {
        // Insurance Type → Housing → Tags
        assert!(!creates_cycle(&edges(&[("ins", "housing"), ("housing", "tags")]), "ins"));
    }

    #[test]
    fn several_parents_are_allowed() {
        assert!(!creates_cycle(&edges(&[("ins", "housing"), ("ins", "car"), ("housing", "tags"), ("car", "tags")]), "ins"));
    }

    #[test]
    fn a_loop_back_is_a_cycle() {
        assert!(creates_cycle(&edges(&[("a", "b"), ("b", "c"), ("c", "a")]), "a"));
    }

    #[test]
    fn depending_on_itself_is_a_cycle() {
        assert!(creates_cycle(&edges(&[("a", "a")]), "a"));
    }

    #[test]
    fn a_cycle_elsewhere_does_not_count() {
        assert!(!creates_cycle(&edges(&[("a", "b"), ("c", "d"), ("d", "c")]), "a"));
    }
}
