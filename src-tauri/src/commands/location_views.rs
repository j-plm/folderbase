//! Saved views of a location's files: the Database view's filters, sorts,
//! groups and columns, by name. Each location has one default view (the one it
//! opens with), which saves as it changes; the others keep unsaved edits as a
//! `draft` until they are saved or reverted. Any view can be made the default,
//! and the views are in the user's order, the default among them. The app reads the definitions
//! (src/lib/tableViews.ts); the database only stores them.

use crate::db::DbPool;
use crate::models::LocationView;
use serde_json::Value;
use sqlx::SqliteConnection;
use tauri::State;
use uuid::Uuid;

/// The location's views, in order (the default wherever it was put).
#[tauri::command]
pub async fn get_location_views(location_id: String, db: State<'_, DbPool>) -> Result<Vec<LocationView>, String> {
    get_location_views_impl(db.inner(), &location_id).await
}

pub async fn get_location_views_impl(pool: &DbPool, location_id: &str) -> Result<Vec<LocationView>, String> {
    sqlx::query_as::<_, LocationView>(
        "SELECT * FROM location_views WHERE location_id = ? ORDER BY position, is_default DESC, created_at",
    )
    .bind(location_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Creates (empty `view_id`) or updates a view. A new view goes last; a
/// location has only one default view, so a second is refused.
#[tauri::command]
pub async fn save_location_view(view: LocationView, db: State<'_, DbPool>) -> Result<LocationView, String> {
    save_location_view_impl(db.inner(), view).await
}

pub async fn save_location_view_impl(pool: &DbPool, mut view: LocationView) -> Result<LocationView, String> {
    let name = view.name.trim().to_string();
    if name.is_empty() {
        return Err("a view needs a name".into());
    }
    serde_json::from_str::<Value>(&view.definition).map_err(|e| format!("invalid view definition: {e}"))?;
    if let Some(draft) = &view.draft {
        serde_json::from_str::<Value>(draft).map_err(|e| format!("invalid view draft: {e}"))?;
    }
    // Names are unique within a location, ignoring case
    let clash: Option<String> = sqlx::query_scalar(
        "SELECT view_id FROM location_views WHERE location_id = ? AND lower(name) = lower(?) AND view_id != ?",
    )
    .bind(&view.location_id)
    .bind(&name)
    .bind(&view.view_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    if clash.is_some() {
        return Err(format!("There's already a view named “{name}”."));
    }
    view.name = name;
    let now = chrono::Utc::now().to_rfc3339();
    if view.view_id.is_empty() {
        view.view_id = Uuid::new_v4().to_string();
        let last: Option<i64> = sqlx::query_scalar("SELECT MAX(position) FROM location_views WHERE location_id = ?")
            .bind(&view.location_id)
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
        view.position = last.map_or(0, |p| p + 1);
        view.created_at = now.clone();
    }
    // The default view saves as it changes, so it never has a draft
    if view.is_default {
        view.draft = None;
    }
    view.updated_at = now;
    sqlx::query(
        "INSERT INTO location_views (view_id, location_id, name, is_default, position, definition, draft, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(view_id) DO UPDATE SET name = excluded.name, definition = excluded.definition, \
         draft = excluded.draft, updated_at = excluded.updated_at",
    )
    .bind(&view.view_id)
    .bind(&view.location_id)
    .bind(&view.name)
    .bind(view.is_default)
    .bind(view.position)
    .bind(&view.definition)
    .bind(&view.draft)
    .bind(&view.created_at)
    .bind(&view.updated_at)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(view)
}

/// Makes this view its location's default: the one it opens with, which saves
/// as it changes, so any unsaved edits it has are saved into it. The previous
/// default keeps edits as a draft from now on. Returns the location's views.
#[tauri::command]
pub async fn set_default_location_view(view_id: String, db: State<'_, DbPool>) -> Result<Vec<LocationView>, String> {
    set_default_location_view_impl(db.inner(), &view_id).await
}

pub async fn set_default_location_view_impl(pool: &DbPool, view_id: &str) -> Result<Vec<LocationView>, String> {
    let location_id: String = sqlx::query_scalar("SELECT location_id FROM location_views WHERE view_id = ?")
        .bind(view_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("no such view")?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    // One default per location (a unique index): clear the old one first
    sqlx::query("UPDATE location_views SET is_default = 0 WHERE location_id = ? AND is_default = 1")
        .bind(&location_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE location_views SET is_default = 1, definition = COALESCE(draft, definition), draft = NULL, \
         updated_at = ? WHERE view_id = ?",
    )
    .bind(&now)
    .bind(view_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    get_location_views_impl(pool, &location_id).await
}

/// Deletes a view. The default view can't be deleted (another is made default first).
#[tauri::command]
pub async fn delete_location_view(view_id: String, db: State<'_, DbPool>) -> Result<(), String> {
    delete_location_view_impl(db.inner(), &view_id).await
}

pub async fn delete_location_view_impl(pool: &DbPool, view_id: &str) -> Result<(), String> {
    let is_default: Option<bool> = sqlx::query_scalar("SELECT is_default FROM location_views WHERE view_id = ?")
        .bind(view_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    if is_default == Some(true) {
        return Err("the default view can't be deleted".into());
    }
    sqlx::query("DELETE FROM location_views WHERE view_id = ?")
        .bind(view_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Puts the location's views in this order, the default among them.
#[tauri::command]
pub async fn reorder_location_views(location_id: String, view_ids: Vec<String>, db: State<'_, DbPool>) -> Result<(), String> {
    reorder_location_views_impl(db.inner(), &location_id, &view_ids).await
}

pub async fn reorder_location_views_impl(pool: &DbPool, location_id: &str, view_ids: &[String]) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for (position, id) in view_ids.iter().enumerate() {
        sqlx::query("UPDATE location_views SET position = ? WHERE view_id = ? AND location_id = ?")
            .bind(position as i64)
            .bind(id)
            .bind(location_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

// ── Upkeep: views name properties, so they follow a rename ──────────────────

/// A property renamed: every view (saved and draft) of the library's locations
/// uses the new name.
pub async fn rename_property_in_views(
    conn: &mut SqliteConnection,
    library: Option<&str>,
    from: &str,
    to: &str,
) -> Result<(), String> {
    update_views(conn, library, |def| rename_in_view_definition(def, from, to)).await
}

/// A property's value renamed: folders that branch on the value keep their structure.
pub async fn rename_value_in_views(
    conn: &mut SqliteConnection,
    library: Option<&str>,
    property: &str,
    from: &str,
    to: &str,
) -> Result<(), String> {
    update_views(conn, library, |def| rename_value_in_view_definition(def, property, from, to)).await
}

/// Runs `change` over every view definition (saved and draft) of the library's
/// locations, writing back the ones it changed.
async fn update_views(
    conn: &mut SqliteConnection,
    library: Option<&str>,
    change: impl Fn(&mut Value) -> bool,
) -> Result<(), String> {
    let rows: Vec<(String, String, Option<String>)> = match library {
        Some(lib) => sqlx::query_as(
            "SELECT view_id, definition, draft FROM location_views \
             WHERE location_id IN (SELECT location_id FROM locations WHERE library = ?)",
        )
        .bind(lib)
        .fetch_all(&mut *conn)
        .await,
        None => sqlx::query_as("SELECT view_id, definition, draft FROM location_views").fetch_all(&mut *conn).await,
    }
    .map_err(|e| e.to_string())?;
    for (view_id, definition, draft) in rows {
        let changed = |json: &str| -> Option<String> {
            let mut value = serde_json::from_str::<Value>(json).ok()?;
            change(&mut value).then(|| value.to_string())
        };
        let new_definition = changed(&definition);
        let new_draft = draft.as_deref().and_then(changed);
        if new_definition.is_none() && new_draft.is_none() {
            continue;
        }
        sqlx::query("UPDATE location_views SET definition = ?, draft = ? WHERE view_id = ?")
            .bind(new_definition.unwrap_or(definition))
            .bind(new_draft.or(draft))
            .bind(&view_id)
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Renames a property inside a view definition; returns whether anything changed.
/// Columns are named "prop:<name>" (filters, sorts, groups, column order, folder
/// levels); the shown and unwrapped property lists hold bare names.
pub fn rename_in_view_definition(def: &mut Value, from: &str, to: &str) -> bool {
    let old_column = format!("prop:{from}");
    let new_column = format!("prop:{to}");
    let mut changed = false;
    if let Some(root) = def.get_mut("folders").and_then(|f| f.get_mut("root")) {
        for_each_folder_level(root, &mut |level| changed |= rename_item(level, &old_column, &new_column));
    }
    for_each_pin_step(def, &mut |step| changed |= rename_item(step, &old_column, &new_column));
    let Some(table) = def.get_mut("table").and_then(Value::as_object_mut) else { return changed };
    for (field, value) in table.iter_mut() {
        let bare = field == "visibleProperties" || field == "noWrap";
        match value {
            Value::Array(items) => {
                for item in items {
                    changed |= rename_item(item, &old_column, &new_column);
                    if bare && item.as_str() == Some(from) {
                        *item = Value::String(to.to_string());
                        changed = true;
                    }
                }
            }
            _ => continue,
        }
    }
    changed
}

/// Renames a property's value inside a view definition's folders: a branch kept
/// for folder `from` of that property becomes folder `to`'s. When `to` already
/// has a branch (two values merged), that one is kept.
pub fn rename_value_in_view_definition(def: &mut Value, property: &str, from: &str, to: &str) -> bool {
    let column = format!("prop:{property}");
    let mut changed = false;
    if let Some(root) = def.get_mut("folders").and_then(|f| f.get_mut("root")) {
        for_each_folder_level(root, &mut |level| {
            if level.get("column").and_then(Value::as_str) != Some(column.as_str()) {
                return;
            }
            let Some(branches) = level.get_mut("branches").and_then(Value::as_object_mut) else { return };
            if let Some(branch) = branches.remove(from) {
                branches.entry(to.to_string()).or_insert(branch);
                changed = true;
            }
        });
    }
    // New Folder's folders, and the folders they're inside, follow the value
    for_each_pin_step(def, &mut |step| {
        if step.get("column").and_then(Value::as_str) == Some(column.as_str()) && step.get("value").and_then(Value::as_str) == Some(from) {
            step["value"] = Value::String(to.to_string());
            changed = true;
        }
    });
    changed
}

/// Visits each folder made with New Folder (`folders.pins`, each a column and
/// value) and each folder on the way to it (its `at`).
fn for_each_pin_step(def: &mut Value, visit: &mut impl FnMut(&mut Value)) {
    let Some(pins) = def.get_mut("folders").and_then(|f| f.get_mut("pins")).and_then(Value::as_array_mut) else { return };
    for pin in pins.iter_mut().filter(|p| p.is_object()) {
        if let Some(at) = pin.get_mut("at").and_then(Value::as_array_mut) {
            for step in at.iter_mut().filter(|s| s.is_object()) {
                visit(step);
            }
        }
        visit(pin);
    }
}

/// Visits a folder level and every level below it (its `next` and its branches).
fn for_each_folder_level(level: &mut Value, visit: &mut impl FnMut(&mut Value)) {
    if !level.is_object() {
        return;
    }
    visit(level);
    if let Some(next) = level.get_mut("next") {
        for_each_folder_level(next, visit);
    }
    if let Some(branches) = level.get_mut("branches").and_then(Value::as_object_mut) {
        for branch in branches.values_mut() {
            for_each_folder_level(branch, visit);
        }
    }
}

/// A column id, or an object naming one (`column` in filters and folder levels, `key` in sorts and groups).
fn rename_item(item: &mut Value, old_column: &str, new_column: &str) -> bool {
    if item.as_str() == Some(old_column) {
        *item = Value::String(new_column.to_string());
        return true;
    }
    let mut changed = false;
    if let Some(obj) = item.as_object_mut() {
        for field in ["column", "key"] {
            if let Some(v) = obj.get_mut(field) {
                if v.as_str() == Some(old_column) {
                    *v = Value::String(new_column.to_string());
                    changed = true;
                }
            }
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::{rename_in_view_definition, rename_value_in_view_definition};
    use serde_json::json;

    #[test]
    fn renames_columns_and_property_lists() {
        let mut def = json!({ "table": {
            "filters": [{ "column": "prop:Client", "op": "is", "value": "prop:Client" }, { "column": "name" }],
            "sorts": [{ "key": "prop:Client", "direction": "asc" }],
            "groups": [{ "key": "prop:Client", "direction": "asc" }],
            "columnOrder": ["name", "prop:Client"],
            "visibleProperties": ["Client", "Project"],
            "noWrap": ["Client"],
            "frozen": true
        }});
        assert!(rename_in_view_definition(&mut def, "Client", "Customer"));
        let t = &def["table"];
        assert_eq!(t["filters"][0]["column"], "prop:Customer");
        // A filter's value is the user's text, not a column
        assert_eq!(t["filters"][0]["value"], "prop:Client");
        assert_eq!(t["filters"][1]["column"], "name");
        assert_eq!(t["sorts"][0]["key"], "prop:Customer");
        assert_eq!(t["groups"][0]["key"], "prop:Customer");
        assert_eq!(t["columnOrder"], json!(["name", "prop:Customer"]));
        assert_eq!(t["visibleProperties"], json!(["Customer", "Project"]));
        assert_eq!(t["noWrap"], json!(["Customer"]));
    }

    #[test]
    fn leaves_other_properties_and_shapes_alone() {
        let mut def = json!({ "table": { "visibleProperties": ["Project"], "sorts": [{ "key": "prop:Project" }] } });
        assert!(!rename_in_view_definition(&mut def, "Client", "Customer"));
        assert!(!rename_in_view_definition(&mut json!({ "folders": [] }), "Client", "Customer"));
        assert!(!rename_in_view_definition(&mut json!("not an object"), "Client", "Customer"));
    }

    fn level(column: &str, next: serde_json::Value, branches: serde_json::Value) -> serde_json::Value {
        json!({ "column": column, "direction": "asc", "next": next, "branches": branches })
    }

    #[test]
    fn renames_folder_levels_at_every_depth() {
        let mut def = json!({
            "table": {},
            "folders": { "root": level(
                "prop:Client",
                level("prop:Project", json!(null), json!({})),
                json!({ "Acme": level("prop:Client", json!(null), json!({})), "Globex": null })
            )}
        });
        assert!(rename_in_view_definition(&mut def, "Client", "Customer"));
        let root = &def["folders"]["root"];
        assert_eq!(root["column"], "prop:Customer");
        assert_eq!(root["next"]["column"], "prop:Project");
        assert_eq!(root["branches"]["Acme"]["column"], "prop:Customer");
        // Branches are keyed by value, not by property
        assert!(root["branches"].get("Acme").is_some());
    }

    #[test]
    fn renames_new_folders_and_the_folders_they_are_in() {
        let mut def = json!({ "folders": { "root": null, "pins": [
            { "at": [{ "column": "prop:Client", "value": "Acme" }], "column": "prop:Project", "value": "Pension" }
        ] } });
        assert!(rename_in_view_definition(&mut def, "Client", "Customer"));
        assert_eq!(def["folders"]["pins"][0]["at"][0]["column"], "prop:Customer");
        assert!(rename_in_view_definition(&mut def, "Project", "Job"));
        assert_eq!(def["folders"]["pins"][0]["column"], "prop:Job");
        assert!(rename_value_in_view_definition(&mut def, "Customer", "Acme", "Acme Ltd"));
        assert_eq!(def["folders"]["pins"][0]["at"][0]["value"], "Acme Ltd");
        assert!(rename_value_in_view_definition(&mut def, "Job", "Pension", "Pensions"));
        assert_eq!(def["folders"]["pins"][0]["value"], "Pensions");
        // Another property's value of the same name is left alone
        assert!(!rename_value_in_view_definition(&mut def, "Other", "Pensions", "X"));
    }

    #[test]
    fn renames_folders_even_without_a_table() {
        let mut def = json!({ "folders": { "root": level("prop:Client", json!(null), json!({})) } });
        assert!(rename_in_view_definition(&mut def, "Client", "Customer"));
        assert_eq!(def["folders"]["root"]["column"], "prop:Customer");
    }

    #[test]
    fn renames_branch_keys_of_the_property_only() {
        let below = level("prop:Year", json!(null), json!({}));
        let mut def = json!({ "folders": { "root": level(
            "prop:Client",
            level("prop:Project", json!(null), json!({ "Acme": null })),
            json!({ "Acme": below.clone() })
        )}});
        assert!(rename_value_in_view_definition(&mut def, "Client", "Acme", "Acme Ltd"));
        let root = &def["folders"]["root"];
        assert_eq!(root["branches"]["Acme Ltd"], below);
        assert!(root["branches"].get("Acme").is_none());
        // A Project folder called Acme is a different value
        assert!(root["next"]["branches"].get("Acme").is_some());
        assert!(!rename_value_in_view_definition(&mut def, "Client", "Nobody", "Else"));
    }

    #[test]
    fn a_merged_value_keeps_the_existing_branch() {
        let mut def = json!({ "folders": { "root": level(
            "prop:Client",
            json!(null),
            json!({ "Acme": null, "Acme Ltd": level("prop:Year", json!(null), json!({})) })
        )}});
        assert!(rename_value_in_view_definition(&mut def, "Client", "Acme", "Acme Ltd"));
        let branches = &def["folders"]["root"]["branches"];
        assert_eq!(branches["Acme Ltd"]["column"], "prop:Year");
        assert!(branches.get("Acme").is_none());
    }
}
