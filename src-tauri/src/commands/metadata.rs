//! Writing property values into files' metadata from the database view: single
//! cells, fills and pastes (`set_metadata_cells`), and the conversions applied
//! when a property is renamed or changes type.

use crate::db::DbPool;
use crate::models::Property;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::SqliteConnection;
use std::collections::{BTreeSet, HashMap};
use tauri::State;
use uuid::Uuid;

/// One cell write. A `null` value removes the key from the file's metadata.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CellEdit {
    pub file_id: String,
    pub key: String,
    pub value: Value,
}

pub use crate::db::utils::json_path;

/// Converts a stored value to `to_type` without losing what the user entered:
/// lists join into text, text that reads as a number becomes one, and anything
/// that can't be converted is kept as it is. `None` means the key should be removed.
pub fn convert_value(value: &Value, to_type: &str) -> Option<Value> {
    match (to_type, value) {
        (_, Value::Null) => None,
        ("array", Value::Array(_)) => Some(value.clone()),
        ("array", other) => Some(Value::Array(vec![Value::String(scalar_text(other))])),
        (_, Value::Array(items)) => {
            let texts: Vec<String> = items.iter().map(scalar_text).filter(|s| !s.is_empty()).collect();
            if texts.is_empty() {
                return None;
            }
            let joined = Value::String(texts.join(", "));
            if to_type == "number" && texts.len() == 1 {
                return convert_value(&joined, "number");
            }
            Some(joined)
        }
        ("number", Value::String(s)) => Some(parse_number(s).map(Value::from).unwrap_or_else(|| value.clone())),
        ("number", _) => Some(value.clone()),
        (_, Value::String(_)) => Some(value.clone()),
        (_, other) => Some(Value::String(scalar_text(other))),
    }
}

fn scalar_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Reads "1,200", "£12.50" or "25%" (as 0.25) as a number.
pub fn parse_number(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    let (body, scale) = match trimmed.strip_suffix('%') {
        Some(rest) => (rest, 0.01),
        None => (trimmed, 1.0),
    };
    let cleaned: String = body
        .chars()
        .filter(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | 'e' | 'E' | '+'))
        .collect();
    if cleaned.is_empty() || !body.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    // Reject text that merely contains digits ("Rig-A 2")
    let stray = body.chars().any(|c| c.is_alphabetic() && !matches!(c, 'e' | 'E'));
    if stray {
        return None;
    }
    cleaned.parse::<f64>().ok().map(|n| n * scale)
}

/// The string values a Dropdown or Multi-select value contributes to the registry.
fn registry_values(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items.iter().map(scalar_text).filter(|s| !s.is_empty()).collect(),
        Value::Null => vec![],
        other => {
            let s = scalar_text(other);
            if s.is_empty() { vec![] } else { vec![s] }
        }
    }
}

/// Adds any of `values` the property doesn't have yet.
pub async fn register_values(
    conn: &mut SqliteConnection,
    property_id: &str,
    values: impl IntoIterator<Item = String>,
) -> Result<(), String> {
    for value in values {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM property_values WHERE property_id = ? AND value = ?",
        )
        .bind(property_id)
        .bind(&value)
        .fetch_one(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
        if exists == 0 {
            sqlx::query("INSERT INTO property_values (value_id, property_id, value) VALUES (?, ?, ?)")
                .bind(Uuid::new_v4().to_string())
                .bind(property_id)
                .bind(&value)
                .execute(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// The property governing `key` for files in `library`: library-scoped first, then global.
async fn property_for(
    conn: &mut SqliteConnection,
    key: &str,
    library: Option<&str>,
) -> Result<Option<Property>, String> {
    sqlx::query_as::<_, Property>(
        "SELECT * FROM properties WHERE name = ? AND (library = ? OR library IS NULL) \
         ORDER BY library IS NULL LIMIT 1",
    )
    .bind(key)
    .bind(library)
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| e.to_string())
}

pub async fn set_metadata_cells_impl(pool: &DbPool, edits: &[CellEdit]) -> Result<(), String> {
    if edits.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // (library, key) → values written, for registry upkeep afterwards
    let mut written: HashMap<(Option<String>, String), BTreeSet<String>> = HashMap::new();
    let mut libraries: HashMap<String, Option<String>> = HashMap::new();

    for edit in edits {
        let path = json_path(&edit.key);
        if edit.value.is_null() {
            sqlx::query("UPDATE files SET metadata = json_remove(metadata, ?) WHERE file_id = ?")
                .bind(&path)
                .bind(&edit.file_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            continue;
        }
        sqlx::query(
            "UPDATE files SET metadata = json_set(COALESCE(metadata, '{}'), ?, json(?)) WHERE file_id = ?",
        )
        .bind(&path)
        .bind(edit.value.to_string())
        .bind(&edit.file_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        if !libraries.contains_key(&edit.file_id) {
            let library: Option<Option<String>> =
                sqlx::query_scalar("SELECT library FROM files WHERE file_id = ?")
                    .bind(&edit.file_id)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
            libraries.insert(edit.file_id.clone(), library.flatten());
        }
        let library = libraries[&edit.file_id].clone();
        written
            .entry((library, edit.key.clone()))
            .or_default()
            .extend(registry_values(&edit.value));
    }

    for ((library, key), values) in written {
        if let Some(prop) = property_for(&mut tx, &key, library.as_deref()).await? {
            if prop.value_type == "enum" || prop.value_type == "array" {
                register_values(&mut tx, &prop.property_id, values).await?;
            }
        }
    }

    tx.commit().await.map_err(|e| e.to_string())
}

/// Writes many cells at once (an edit, a fill or a paste) in one transaction.
/// New Dropdown and Multi-select values are added to the registry.
#[tauri::command]
pub async fn set_metadata_cells(edits: Vec<CellEdit>, db: State<'_, DbPool>) -> Result<(), String> {
    set_metadata_cells_impl(db.inner(), &edits).await
}

/// Files a property applies to, with their parsed metadata.
async fn files_in_scope(
    conn: &mut SqliteConnection,
    library: Option<&str>,
) -> Result<Vec<(String, Map<String, Value>)>, String> {
    let rows: Vec<(String, Option<String>)> = match library {
        Some(lib) => sqlx::query_as("SELECT file_id, metadata FROM files WHERE library = ?")
            .bind(lib)
            .fetch_all(&mut *conn)
            .await,
        None => sqlx::query_as("SELECT file_id, metadata FROM files")
            .fetch_all(&mut *conn)
            .await,
    }
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, meta)| {
            let parsed = serde_json::from_str::<Map<String, Value>>(meta.as_deref()?).ok()?;
            Some((id, parsed))
        })
        .collect())
}

async fn save_metadata(conn: &mut SqliteConnection, file_id: &str, meta: &Map<String, Value>) -> Result<(), String> {
    sqlx::query("UPDATE files SET metadata = ? WHERE file_id = ?")
        .bind(serde_json::to_string(meta).map_err(|e| e.to_string())?)
        .bind(file_id)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Renames a property and moves its values to the new key in every file it applies to.
pub async fn rename_property_impl(pool: &DbPool, property_id: &str, new_name: &str) -> Result<Property, String> {
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err("property name cannot be empty".into());
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let prop = sqlx::query_as::<_, Property>("SELECT * FROM properties WHERE property_id = ?")
        .bind(property_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("property not found: {e}"))?;
    if prop.name == new_name {
        return Ok(prop);
    }

    let clash: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM properties WHERE name = ? AND library IS ? AND property_id != ?",
    )
    .bind(new_name)
    .bind(&prop.library)
    .bind(property_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    if clash > 0 {
        return Err(format!("property '{new_name}' already exists in this library"));
    }

    sqlx::query("UPDATE properties SET name = ? WHERE property_id = ?")
        .bind(new_name)
        .bind(property_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    for (file_id, mut meta) in files_in_scope(&mut tx, prop.library.as_deref()).await? {
        if let Some(value) = meta.remove(&prop.name) {
            meta.insert(new_name.to_string(), value);
            save_metadata(&mut tx, &file_id, &meta).await?;
        }
    }

    // Folder mappings name the property they assign, so they follow the rename
    match &prop.library {
        Some(lib) => sqlx::query(
            "UPDATE path_mapping_nodes SET property_name = ? WHERE property_name = ? \
             AND location_id IN (SELECT location_id FROM locations WHERE library = ?)",
        )
        .bind(new_name)
        .bind(&prop.name)
        .bind(lib),
        None => sqlx::query("UPDATE path_mapping_nodes SET property_name = ? WHERE property_name = ?")
            .bind(new_name)
            .bind(&prop.name),
    }
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(Property { name: new_name.to_string(), ..prop })
}

#[tauri::command]
pub async fn rename_property(
    property_id: String,
    name: String,
    db: State<'_, DbPool>,
) -> Result<Property, String> {
    rename_property_impl(db.inner(), &property_id, &name).await
}

/// Sets a property's type and options, converting the values already stored
/// (see `convert_value`) and registering them when the new type is a list.
pub async fn change_property_type_impl(
    pool: &DbPool,
    property_id: &str,
    value_type: &str,
    config: Option<&str>,
) -> Result<(), String> {
    crate::commands::properties::validate_value_type(value_type)?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let prop = sqlx::query_as::<_, Property>("SELECT * FROM properties WHERE property_id = ?")
        .bind(property_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| format!("property not found: {e}"))?;

    sqlx::query("UPDATE properties SET value_type = ?, config = ? WHERE property_id = ?")
        .bind(value_type)
        .bind(config)
        .bind(property_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let mut seen = BTreeSet::new();
    if prop.value_type != value_type {
        for (file_id, mut meta) in files_in_scope(&mut tx, prop.library.as_deref()).await? {
            let Some(old) = meta.get(&prop.name).cloned() else { continue };
            let converted = convert_value(&old, value_type);
            if let Some(v) = &converted {
                seen.extend(registry_values(v));
            }
            if converted.as_ref() == Some(&old) {
                continue;
            }
            match converted {
                Some(v) => meta.insert(prop.name.clone(), v),
                None => meta.remove(&prop.name),
            };
            save_metadata(&mut tx, &file_id, &meta).await?;
        }
    }
    if value_type == "enum" || value_type == "array" {
        register_values(&mut tx, property_id, seen).await?;
    }

    tx.commit().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_path_quotes_keys() {
        assert_eq!(json_path("rig"), "$.\"rig\"");
        assert_eq!(json_path("shoot date"), "$.\"shoot date\"");
        assert_eq!(json_path("a\"b"), "$.\"a\\\"b\"");
    }

    #[test]
    fn converts_scalars_to_lists_and_back() {
        assert_eq!(convert_value(&json!("Apollo"), "array"), Some(json!(["Apollo"])));
        assert_eq!(convert_value(&json!(["Apollo", "Hermes"]), "enum"), Some(json!("Apollo, Hermes")));
        assert_eq!(convert_value(&json!([]), "free_text"), None);
        assert_eq!(convert_value(&json!(12), "free_text"), Some(json!("12")));
    }

    #[test]
    fn converts_numeric_text_and_keeps_the_rest() {
        assert_eq!(convert_value(&json!("1,200"), "number"), Some(json!(1200.0)));
        assert_eq!(convert_value(&json!("25%"), "number"), Some(json!(0.25)));
        assert_eq!(convert_value(&json!(["7"]), "number"), Some(json!(7.0)));
        assert_eq!(convert_value(&json!("Rig-A"), "number"), Some(json!("Rig-A")));
        assert_eq!(convert_value(&Value::Null, "number"), None);
    }

    #[test]
    fn parse_number_rejects_words_with_digits() {
        assert_eq!(parse_number("£12.50"), Some(12.5));
        assert_eq!(parse_number("-3"), Some(-3.0));
        assert_eq!(parse_number("Rig 2"), None);
        assert_eq!(parse_number(""), None);
    }
}
