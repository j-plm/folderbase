//! Rules: "when these conditions hold, set these values". The app evaluates
//! them (src/lib/rules.ts, so they match the Filter panel exactly); the
//! database stores them, and records every value a rule writes in
//! `rule_writes`, so a rule never writes a file's value twice and hand edits stick.

use crate::commands::metadata::{set_metadata_cells_impl, CellEdit};
use crate::db::DbPool;
use crate::models::{Rule, RuleWrite};
use serde_json::Value;
use sqlx::SqliteConnection;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_rules(library: String, db: State<'_, DbPool>) -> Result<Vec<Rule>, String> {
    get_rules_impl(db.inner(), &library).await
}

pub async fn get_rules_impl(pool: &DbPool, library: &str) -> Result<Vec<Rule>, String> {
    sqlx::query_as::<_, Rule>("SELECT * FROM rules WHERE library = ? ORDER BY position, created_at")
        .bind(library)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Creates (empty `rule_id`) or updates a rule. A new rule goes last.
#[tauri::command]
pub async fn save_rule(rule: Rule, db: State<'_, DbPool>) -> Result<Rule, String> {
    save_rule_impl(db.inner(), rule).await
}

pub async fn save_rule_impl(pool: &DbPool, mut rule: Rule) -> Result<Rule, String> {
    if rule.name.trim().is_empty() {
        return Err("a rule needs a name".into());
    }
    serde_json::from_str::<Value>(&rule.definition).map_err(|e| format!("invalid rule definition: {e}"))?;
    let now = chrono::Utc::now().to_rfc3339();
    if rule.rule_id.is_empty() {
        rule.rule_id = Uuid::new_v4().to_string();
        let last: Option<i64> = sqlx::query_scalar("SELECT MAX(position) FROM rules WHERE library = ?")
            .bind(&rule.library)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
        rule.position = last.map_or(0, |p| p + 1);
        rule.created_at = now.clone();
    }
    rule.updated_at = now;
    sqlx::query(
        "INSERT INTO rules (rule_id, library, name, enabled, position, definition, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(rule_id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled, \
         definition = excluded.definition, updated_at = excluded.updated_at",
    )
    .bind(&rule.rule_id)
    .bind(&rule.library)
    .bind(rule.name.trim())
    .bind(rule.enabled)
    .bind(rule.position)
    .bind(&rule.definition)
    .bind(&rule.created_at)
    .bind(&rule.updated_at)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rule)
}

/// Deletes a rule and its record of writes (the values it wrote stay on the files).
#[tauri::command]
pub async fn delete_rule(rule_id: String, db: State<'_, DbPool>) -> Result<(), String> {
    delete_rule_impl(db.inner(), &rule_id).await
}

pub async fn delete_rule_impl(pool: &DbPool, rule_id: &str) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for sql in ["DELETE FROM rule_writes WHERE rule_id = ?", "DELETE FROM rules WHERE rule_id = ?"] {
        sqlx::query(sql).bind(rule_id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

/// Sets the rules' order (earlier rules win when two fill the same empty value).
#[tauri::command]
pub async fn reorder_rules(rule_ids: Vec<String>, db: State<'_, DbPool>) -> Result<(), String> {
    reorder_rules_impl(db.inner(), &rule_ids).await
}

pub async fn reorder_rules_impl(pool: &DbPool, rule_ids: &[String]) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for (i, id) in rule_ids.iter().enumerate() {
        sqlx::query("UPDATE rules SET position = ? WHERE rule_id = ?")
            .bind(i as i64)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

/// Every value the library's rules have written.
#[tauri::command]
pub async fn get_rule_writes(library: String, db: State<'_, DbPool>) -> Result<Vec<RuleWrite>, String> {
    get_rule_writes_impl(db.inner(), &library).await
}

pub async fn get_rule_writes_impl(pool: &DbPool, library: &str) -> Result<Vec<RuleWrite>, String> {
    sqlx::query_as::<_, RuleWrite>(
        "SELECT w.* FROM rule_writes w JOIN rules r USING (rule_id) WHERE r.library = ?",
    )
    .bind(library)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Writes a rule run's values and records them as the rule's.
#[tauri::command]
pub async fn apply_rule_writes(edits: Vec<CellEdit>, writes: Vec<RuleWrite>, db: State<'_, DbPool>) -> Result<(), String> {
    apply_rule_writes_impl(db.inner(), &edits, &writes).await
}

pub async fn apply_rule_writes_impl(pool: &DbPool, edits: &[CellEdit], writes: &[RuleWrite]) -> Result<(), String> {
    set_metadata_cells_impl(pool, edits).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    record_writes(&mut conn, writes).await
}

async fn record_writes(conn: &mut SqliteConnection, writes: &[RuleWrite]) -> Result<(), String> {
    for w in writes {
        sqlx::query("INSERT OR IGNORE INTO rule_writes (rule_id, file_id, key, value) VALUES (?, ?, ?, ?)")
            .bind(&w.rule_id)
            .bind(&w.file_id)
            .bind(&w.key)
            .bind(&w.value)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Forgets recorded writes (undoing Apply Now), so the rule may write those values again.
#[tauri::command]
pub async fn forget_rule_writes(writes: Vec<RuleWrite>, db: State<'_, DbPool>) -> Result<(), String> {
    forget_rule_writes_impl(db.inner(), &writes).await
}

pub async fn forget_rule_writes_impl(pool: &DbPool, writes: &[RuleWrite]) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for w in writes {
        sqlx::query("DELETE FROM rule_writes WHERE rule_id = ? AND file_id = ? AND key = ? AND value = ?")
            .bind(&w.rule_id)
            .bind(&w.file_id)
            .bind(&w.key)
            .bind(&w.value)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

// ── Upkeep: rules name properties, so they follow a rename ──────────────────

/// A property renamed: every rule in the library uses the new name, in its
/// conditions ("prop:<name>" columns), actions and formulas, and in its record of writes.
pub async fn rename_property_in_rules(
    conn: &mut SqliteConnection,
    library: Option<&str>,
    from: &str,
    to: &str,
) -> Result<(), String> {
    let rows: Vec<(String, String)> = match library {
        Some(lib) => sqlx::query_as("SELECT rule_id, definition FROM rules WHERE library = ?")
            .bind(lib)
            .fetch_all(&mut *conn)
            .await,
        None => sqlx::query_as("SELECT rule_id, definition FROM rules").fetch_all(&mut *conn).await,
    }
    .map_err(|e| e.to_string())?;
    for (rule_id, definition) in rows {
        let Ok(mut def) = serde_json::from_str::<Value>(&definition) else { continue };
        if rename_in_definition(&mut def, from, to) {
            sqlx::query("UPDATE rules SET definition = ? WHERE rule_id = ?")
                .bind(def.to_string())
                .bind(&rule_id)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        }
        sqlx::query("UPDATE OR IGNORE rule_writes SET key = ? WHERE rule_id = ? AND key = ?")
            .bind(to)
            .bind(&rule_id)
            .bind(from)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Renames a property inside a rule definition; returns whether anything changed.
pub fn rename_in_definition(def: &mut Value, from: &str, to: &str) -> bool {
    let mut changed = false;
    let old_column = format!("prop:{from}");
    if let Some(conditions) = def.get_mut("conditions").and_then(Value::as_array_mut) {
        for c in conditions {
            if c.get("column").and_then(Value::as_str) == Some(old_column.as_str()) {
                c["column"] = Value::String(format!("prop:{to}"));
                changed = true;
            }
        }
    }
    if let Some(actions) = def.get_mut("actions").and_then(Value::as_array_mut) {
        for a in actions {
            if a.get("property").and_then(Value::as_str) == Some(from) {
                a["property"] = Value::String(to.to_string());
                changed = true;
            }
            // A "from property" action reading it
            if a.get("value").and_then(Value::as_str) == Some(old_column.as_str()) {
                a["value"] = Value::String(format!("prop:{to}"));
                changed = true;
                continue;
            }
            // prop("From") inside a formula
            if let Some(text) = a.get("value").and_then(Value::as_str) {
                let renamed = text
                    .replace(&format!("prop(\"{from}\")"), &format!("prop(\"{to}\")"))
                    .replace(&format!("prop('{from}')"), &format!("prop('{to}')"));
                if renamed != text {
                    a["value"] = Value::String(renamed);
                    changed = true;
                }
            }
        }
    }
    // The column an example was picked from
    if let Some(example) = def.get_mut("example") {
        if example.get("column").and_then(Value::as_str) == Some(old_column.as_str()) {
            example["column"] = Value::String(format!("prop:{to}"));
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::rename_in_definition;
    use serde_json::json;

    #[test]
    fn renames_conditions_actions_and_formulas() {
        let mut def = json!({
            "match": "all",
            "conditions": [{ "column": "prop:Client", "op": "has", "value": "Acme" }, { "column": "name", "op": "contains", "value": "x" }],
            "actions": [
                { "property": "Client", "mode": "fixed", "value": "Acme" },
                { "property": "Code", "mode": "formula", "value": "upper(prop(\"Client\"))" }
            ]
        });
        assert!(rename_in_definition(&mut def, "Client", "Customer"));
        assert_eq!(def["conditions"][0]["column"], "prop:Customer");
        assert_eq!(def["conditions"][1]["column"], "name");
        assert_eq!(def["actions"][0]["property"], "Customer");
        assert_eq!(def["actions"][1]["value"], "upper(prop(\"Customer\"))");
    }

    #[test]
    fn renames_columns_read_from_and_example_sources() {
        let mut def = json!({
            "actions": [{ "property": "Year", "mode": "column", "value": "prop:Client" }],
            "example": { "name": "Acme", "slots": [], "column": "prop:Client" }
        });
        assert!(rename_in_definition(&mut def, "Client", "Customer"));
        assert_eq!(def["actions"][0]["value"], "prop:Customer");
        assert_eq!(def["example"]["column"], "prop:Customer");
    }

    #[test]
    fn leaves_other_properties_alone() {
        let mut def = json!({ "conditions": [{ "column": "prop:Clients" }], "actions": [{ "property": "Clientele", "value": "Client" }] });
        assert!(!rename_in_definition(&mut def, "Client", "Customer"));
        assert_eq!(def["actions"][0]["value"], "Client");
    }
}
