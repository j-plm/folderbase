use crate::db::DbPool;
use crate::models::{Property, PropertyValue};
use tauri::State;
use uuid::Uuid;

const VALID_VALUE_TYPES: &[&str] = &["enum", "free_text", "array", "date", "number"];

/// Config marking a library's built-in Tags property: a Multi-select for tags
/// added by hand. It can be renamed, but not deleted or changed to another type.
pub const TAGS_CONFIG: &str = r#"{"system":"tags"}"#;
const TAGS_NAME: &str = "Tags";

pub fn is_system(prop: &Property) -> bool {
    prop.config
        .as_deref()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
        .and_then(|c| c.get("system").and_then(|s| s.as_str()).map(|s| s == "tags"))
        .unwrap_or(false)
}

/// Gives the library its Tags property, adopting an existing property called
/// "Tags" (converted to a Multi-select) if there is one.
pub async fn ensure_tags_property(pool: &DbPool, library: &str) -> Result<(), String> {
    let props: Vec<Property> = sqlx::query_as("SELECT * FROM properties WHERE library = ?")
        .bind(library)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    if props.iter().any(is_system) {
        return Ok(());
    }
    if let Some(existing) = props.iter().find(|p| p.name == TAGS_NAME) {
        return crate::commands::metadata::change_property_type_impl(
            pool,
            &existing.property_id,
            "array",
            Some(TAGS_CONFIG),
        )
        .await;
    }
    sqlx::query("INSERT INTO properties (property_id, name, library, value_type, config) VALUES (?, ?, ?, 'array', ?)")
        .bind(Uuid::new_v4().to_string())
        .bind(TAGS_NAME)
        .bind(library)
        .bind(TAGS_CONFIG)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn validate_value_type(value_type: &str) -> Result<(), String> {
    if VALID_VALUE_TYPES.contains(&value_type) {
        Ok(())
    } else {
        Err(format!(
            "invalid value_type '{value_type}'; must be one of: {}",
            VALID_VALUE_TYPES.join(", ")
        ))
    }
}

#[tauri::command]
pub async fn get_properties(
    library: Option<String>,
    db: State<'_, DbPool>,
) -> Result<Vec<Property>, String> {
    let props = match library {
        Some(lib) => {
            sqlx::query_as::<_, Property>(
                "SELECT * FROM properties WHERE library = ? OR library IS NULL",
            )
            .bind(lib)
            .fetch_all(db.inner())
            .await
        }
        None => {
            sqlx::query_as::<_, Property>("SELECT * FROM properties")
                .fetch_all(db.inner())
                .await
        }
    }
    .map_err(|e| e.to_string())?;
    Ok(props)
}

#[tauri::command]
pub async fn get_property_values(
    property_id: String,
    db: State<'_, DbPool>,
) -> Result<Vec<PropertyValue>, String> {
    get_property_values_impl(db.inner(), &property_id).await
}

/// A property's registered values, each with the folder names that map to it.
pub async fn get_property_values_impl(pool: &DbPool, property_id: &str) -> Result<Vec<PropertyValue>, String> {
    let mut values = sqlx::query_as::<_, PropertyValue>("SELECT * FROM property_values WHERE property_id = ?")
        .bind(property_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let aliases: Vec<(String, String)> =
        sqlx::query_as("SELECT source, value FROM value_aliases WHERE property_id = ? ORDER BY source")
            .bind(property_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
    for v in &mut values {
        v.sources = aliases.iter().filter(|(_, to)| *to == v.value).map(|(from, _)| from.clone()).collect();
    }
    Ok(values)
}

#[tauri::command]
pub async fn create_property(
    name: String,
    library: Option<String>,
    value_type: String,
    config: Option<String>,
    db: State<'_, DbPool>,
) -> Result<Property, String> {
    validate_value_type(&value_type)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("property name cannot be empty".into());
    }

    let existing: i64 = match &library {
        Some(lib) => sqlx::query_scalar(
            "SELECT COUNT(*) FROM properties WHERE name = ? AND library = ?",
        )
        .bind(&name)
        .bind(lib)
        .fetch_one(db.inner())
        .await
        .map_err(|e| e.to_string())?,
        None => sqlx::query_scalar(
            "SELECT COUNT(*) FROM properties WHERE name = ? AND library IS NULL",
        )
        .bind(&name)
        .fetch_one(db.inner())
        .await
        .map_err(|e| e.to_string())?,
    };

    if existing > 0 {
        return Err(format!(
            "property '{name}' already exists in this library"
        ));
    }

    let property_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO properties (property_id, name, library, value_type, config) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&property_id)
    .bind(&name)
    .bind(&library)
    .bind(&value_type)
    .bind(&config)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(Property {
        property_id,
        name,
        library,
        value_type,
        config,
    })
}

/// Changes a property's type and options, converting the values files already hold.
#[tauri::command]
pub async fn update_property_type(
    property_id: String,
    value_type: String,
    config: Option<String>,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    crate::commands::metadata::change_property_type_impl(
        db.inner(),
        &property_id,
        &value_type,
        config.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn create_property_value(
    property_id: String,
    value: String,
    db: State<'_, DbPool>,
) -> Result<PropertyValue, String> {
    let existing: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM property_values WHERE property_id = ? AND value = ?",
    )
    .bind(&property_id)
    .bind(&value)
    .fetch_one(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    if existing > 0 {
        return Err(format!("value '{value}' already exists for this property"));
    }

    let value_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO property_values (value_id, property_id, value) VALUES (?, ?, ?)",
    )
    .bind(&value_id)
    .bind(&property_id)
    .bind(&value)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(PropertyValue {
        value_id,
        property_id,
        value,
        sources: vec![],
    })
}

#[tauri::command]
pub async fn delete_property_value(
    value_id: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let row: (String, String) = sqlx::query_as(
        "SELECT property_id, value FROM property_values WHERE value_id = ?",
    )
    .bind(&value_id)
    .fetch_one(db.inner())
    .await
    .map_err(|e| format!("value not found: {e}"))?;

    let (property_id, value_str) = row;

    let prop: Property =
        sqlx::query_as::<_, Property>("SELECT * FROM properties WHERE property_id = ?")
            .bind(&property_id)
            .fetch_one(db.inner())
            .await
            .map_err(|e| format!("property not found: {e}"))?;

    sqlx::query("DELETE FROM property_values WHERE value_id = ?")
        .bind(&value_id)
        .execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;
    // Its folders map to their own names again
    sqlx::query("DELETE FROM value_aliases WHERE property_id = ? AND value = ?")
        .bind(&property_id)
        .bind(&value_str)
        .execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;
    // Properties scoped to it no longer have that condition
    {
        let mut conn = db.inner().acquire().await.map_err(|e| e.to_string())?;
        crate::commands::scopes::drop_condition_value(&mut conn, &property_id, &value_str).await?;
    }

    scrub_value_from_files(db.inner(), &prop.name, &value_str, prop.library.as_deref()).await
}

#[tauri::command]
pub async fn delete_property(
    property_id: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let prop: Property =
        sqlx::query_as::<_, Property>("SELECT * FROM properties WHERE property_id = ?")
            .bind(&property_id)
            .fetch_one(db.inner())
            .await
            .map_err(|e| format!("property not found: {e}"))?;
    if is_system(&prop) {
        return Err(format!("“{}” is built in and can't be deleted", prop.name));
    }

    sqlx::query("DELETE FROM property_values WHERE property_id = ?")
        .bind(&property_id)
        .execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM value_aliases WHERE property_id = ?")
        .bind(&property_id)
        .execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;
    {
        let mut conn = db.inner().acquire().await.map_err(|e| e.to_string())?;
        crate::commands::scopes::drop_property_scopes(&mut conn, &property_id).await?;
    }

    // Folder mappings to it go too, or the next refresh would bring its values back
    match &prop.library {
        Some(lib) => sqlx::query(
            "DELETE FROM path_mapping_nodes WHERE property_name = ? \
             AND location_id IN (SELECT location_id FROM locations WHERE library = ?)",
        )
        .bind(&prop.name)
        .bind(lib),
        None => sqlx::query("DELETE FROM path_mapping_nodes WHERE property_name = ?").bind(&prop.name),
    }
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("DELETE FROM properties WHERE property_id = ?")
        .bind(&property_id)
        .execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;

    scrub_key_from_files(db.inner(), &prop.name, prop.library.as_deref()).await
}

async fn scrub_value_from_files(
    pool: &DbPool,
    key: &str,
    value_str: &str,
    library: Option<&str>,
) -> Result<(), String> {
    let files: Vec<(String, Option<String>)> = match library {
        Some(lib) => sqlx::query_as("SELECT file_id, metadata FROM files WHERE library = ?")
            .bind(lib)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?,
        None => sqlx::query_as("SELECT file_id, metadata FROM files")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?,
    };

    for (file_id, maybe_meta) in files {
        let Some(meta_str) = maybe_meta else {
            continue;
        };
        let Ok(mut meta) =
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&meta_str)
        else {
            continue;
        };

        let changed = match meta.get(key) {
            Some(serde_json::Value::String(s)) if s == value_str => {
                meta.remove(key);
                true
            }
            Some(serde_json::Value::Array(arr)) => {
                let new_arr: Vec<serde_json::Value> = arr
                    .iter()
                    .filter(|item| item.as_str() != Some(value_str))
                    .cloned()
                    .collect();
                if new_arr.len() != arr.len() {
                    if new_arr.is_empty() {
                        meta.remove(key);
                    } else {
                        meta.insert(key.to_string(), serde_json::Value::Array(new_arr));
                    }
                    true
                } else {
                    false
                }
            }
            _ => false,
        };

        if changed {
            let updated = serde_json::to_string(&meta).unwrap_or(meta_str);
            sqlx::query("UPDATE files SET metadata = ? WHERE file_id = ?")
                .bind(&updated)
                .bind(&file_id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

async fn scrub_key_from_files(
    pool: &DbPool,
    key: &str,
    library: Option<&str>,
) -> Result<(), String> {
    let files: Vec<(String, Option<String>)> = match library {
        Some(lib) => sqlx::query_as("SELECT file_id, metadata FROM files WHERE library = ?")
            .bind(lib)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?,
        None => sqlx::query_as("SELECT file_id, metadata FROM files")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?,
    };

    for (file_id, maybe_meta) in files {
        let Some(meta_str) = maybe_meta else {
            continue;
        };
        let Ok(mut meta) =
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&meta_str)
        else {
            continue;
        };

        if meta.remove(key).is_some() {
            let updated = serde_json::to_string(&meta).unwrap_or(meta_str);
            sqlx::query("UPDATE files SET metadata = ? WHERE file_id = ?")
                .bind(&updated)
                .bind(&file_id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}
