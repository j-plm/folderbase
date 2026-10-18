//! Saved views of a location's files: the Database view's filters, sorts,
//! groups and columns, by name. Each location has one default view, which
//! saves as it changes; named views keep unsaved edits as a `draft` until
//! they are saved or reverted. The app reads the definitions
//! (src/lib/tableViews.ts); the database only stores them.

use crate::db::DbPool;
use crate::models::LocationView;
use serde_json::Value;
use sqlx::SqliteConnection;
use tauri::State;
use uuid::Uuid;

/// The location's views: the default first, then the rest in order.
#[tauri::command]
pub async fn get_location_views(location_id: String, db: State<'_, DbPool>) -> Result<Vec<LocationView>, String> {
    get_location_views_impl(db.inner(), &location_id).await
}

pub async fn get_location_views_impl(pool: &DbPool, location_id: &str) -> Result<Vec<LocationView>, String> {
    sqlx::query_as::<_, LocationView>(
        "SELECT * FROM location_views WHERE location_id = ? ORDER BY is_default DESC, position, created_at",
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

/// Deletes a named view. The default view can't be deleted.
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

// ── Upkeep: views name properties, so they follow a rename ──────────────────

/// A property renamed: every view (saved and draft) of the library's locations
/// uses the new name.
pub async fn rename_property_in_views(
    conn: &mut SqliteConnection,
    library: Option<&str>,
    from: &str,
    to: &str,
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
        let renamed = |json: &str| -> Option<String> {
            let mut value = serde_json::from_str::<Value>(json).ok()?;
            rename_in_view_definition(&mut value, from, to).then(|| value.to_string())
        };
        let new_definition = renamed(&definition);
        let new_draft = draft.as_deref().and_then(renamed);
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
/// Columns are named "prop:<name>" (filters, sorts, groups, column order);
/// the shown and unwrapped property lists hold bare names.
pub fn rename_in_view_definition(def: &mut Value, from: &str, to: &str) -> bool {
    let old_column = format!("prop:{from}");
    let new_column = format!("prop:{to}");
    let Some(table) = def.get_mut("table").and_then(Value::as_object_mut) else { return false };
    let mut changed = false;
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

/// A column id, or an object naming one (`column` in filters, `key` in sorts and groups).
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
    use super::rename_in_view_definition;
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
}
