use crate::db::{utils::infer_value_type, DbPool};
use chrono::{DateTime, Utc};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use tauri::{Emitter, State};
use uuid::Uuid;
use walkdir::WalkDir;

/// Extracts (file_type, timestamp, file_size, created_at, metadata) for a single file path.
/// Returns None if the path is not a regular file or cannot be read. Without
/// `read_contents` only `stat` is used (no EXIF), so an online-only file isn't downloaded.
pub(crate) fn extract_file_data(
    path: &std::path::Path,
    read_contents: bool,
) -> Option<(Option<String>, Option<String>, i64, Option<String>, Map<String, Value>)> {
    let fs_meta = std::fs::metadata(path).ok()?;
    if !fs_meta.is_file() {
        return None;
    }

    let image_exts = ["jpg", "jpeg", "png", "tiff", "tif", "heic"];

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    let file_type = if extension.is_empty() {
        None
    } else {
        mime_guess::from_ext(&extension)
            .first()
            .map(|m| m.to_string())
    };

    let timestamp = fs_meta
        .modified()
        .ok()
        .map(|t| Into::<DateTime<Utc>>::into(t).to_rfc3339());

    let created_at = fs_meta
        .created()
        .ok()
        .map(|t| Into::<DateTime<Utc>>::into(t).to_rfc3339());

    let file_size = fs_meta.len() as i64;

    let mut metadata: Map<String, Value> = Map::new();

    if read_contents && image_exts.contains(&extension.as_str()) {
        if let Ok(file) = std::fs::File::open(path) {
            let mut buf = std::io::BufReader::new(&file);
            if let Ok(exif) = exif::Reader::new().read_from_container(&mut buf) {
                extract_exif(&exif, &mut metadata);
            }
        }
    }

    Some((file_type, timestamp, file_size, created_at, metadata))
}

/// Hidden files and folders (dot-names) are skipped, as Finder hides them.
pub(crate) fn not_hidden(entry: &walkdir::DirEntry) -> bool {
    !entry
        .file_name()
        .to_str()
        .map(|s| s.starts_with('.'))
        .unwrap_or(false)
}

/// Whether a file is an online-only cloud placeholder (OneDrive, Dropbox, Google
/// Drive, iCloud Drive…). Its details come from `stat` like any file, but reading
/// its contents makes the provider download it, so indexing doesn't.
/// macOS: the APFS "dataless" flag set by File Provider. Windows: the Cloud Files
/// recall attributes.
pub(crate) fn online_only(meta: &std::fs::Metadata) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        const SF_DATALESS: u32 = 0x4000_0000;
        meta.st_flags() & SF_DATALESS != 0
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
        const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x4_0000;
        const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;
        meta.file_attributes()
            & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
            != 0
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = meta;
        false
    }
}

/// Whether the file at `path` is online-only (false if it can't be read).
pub(crate) fn path_online_only(path: &std::path::Path) -> bool {
    std::fs::symlink_metadata(path).map(|m| online_only(&m)).unwrap_or(false)
}

/// A file's folder names, as the JSON tags array.
pub(crate) fn folder_tags(relative_path: &str) -> String {
    let parts: Vec<&str> = relative_path.split('/').collect();
    serde_json::to_string(&parts[..parts.len().saturating_sub(1)]).unwrap_or_else(|_| "[]".to_string())
}

#[tauri::command]
pub async fn ingest_directory(
    location_id: String,
    app: tauri::AppHandle,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    ingest_location(&location_id, db.inner(), &app).await
}

/// Indexes or refreshes a location, reporting progress to the frontend as
/// `indexing_progress` events (the last one with `done` and what changed).
async fn ingest_location(
    location_id: &str,
    pool: &DbPool,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let emit = |processed: usize| {
        app.emit(
            "indexing_progress",
            serde_json::json!({ "location_id": location_id, "files_scanned": processed, "done": false }),
        )
        .ok();
    };
    let result = crate::commands::sync::sync_location(location_id, pool, &emit).await;
    let summary = result.as_ref().ok();
    app.emit(
        "indexing_progress",
        serde_json::json!({
            "location_id": location_id,
            "files_scanned": summary.map(|s| s.added + s.updated + s.moved).unwrap_or(0),
            "done": true,
            "summary": summary,
            "error": result.as_ref().err(),
        }),
    )
    .ok();
    result.map(|_| ())
}

pub async fn ingest_directory_impl(
    path: &str,
    library: &str,
    pool: &DbPool,
) -> Result<usize, String> {
    let mut inserted_count: usize = 0;
    let mut new_records: Vec<Map<String, Value>> = Vec::new();

    for entry in WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            !e.file_name()
                .to_str()
                .map(|s| s.starts_with('.'))
                .unwrap_or(false)
        })
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let file_path = entry.path().to_string_lossy().to_string();

        let (file_type, timestamp, _file_size, _created_at, metadata) = match extract_file_data(entry.path(), !path_online_only(entry.path())) {
            Some(data) => data,
            None => continue,
        };

        let metadata_json = serde_json::to_string(&metadata).unwrap_or_default();
        let file_id = Uuid::new_v4().to_string();

        let result = sqlx::query(
            "INSERT OR IGNORE INTO files \
             (file_id, file_path, file_type, timestamp, library, metadata) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&file_id)
        .bind(&file_path)
        .bind(&file_type)
        .bind(&timestamp)
        .bind(library)
        .bind(&metadata_json)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        if result.rows_affected() > 0 {
            inserted_count += 1;
            new_records.push(metadata);
        }
    }

    bootstrap_properties(library, &new_records, pool).await?;

    Ok(inserted_count)
}

/// EXIF fields copied into metadata, and the keys they're stored under. These
/// keys come from the file, so a refresh replaces them; every other key is the
/// user's. Keep in step with EXTRACTED_KEYS in src/lib/propertyTypes.ts.
const EXIF_FIELDS: &[(exif::Tag, &str)] = &[
    (exif::Tag::DateTime, "date_taken"),
    (exif::Tag::Make, "camera_make"),
    (exif::Tag::Model, "camera_model"),
    (exif::Tag::PixelXDimension, "width"),
    (exif::Tag::PixelYDimension, "height"),
    (exif::Tag::PhotographicSensitivity, "iso"),
    (exif::Tag::FocalLength, "focal_length"),
    (exif::Tag::GPSLatitude, "latitude"),
    (exif::Tag::GPSLongitude, "longitude"),
];

/// Metadata keys whose values are read from the file itself (see EXIF_FIELDS).
pub(crate) fn extracted_keys() -> impl Iterator<Item = &'static str> {
    EXIF_FIELDS.iter().map(|(_, key)| *key)
}

fn extract_exif(exif: &exif::Exif, metadata: &mut Map<String, Value>) {
    use exif::In;

    for (tag, key) in EXIF_FIELDS {
        if let Some(field) = exif.get_field(*tag, In::PRIMARY) {
            metadata.insert(
                key.to_string(),
                Value::String(field.display_value().to_string()),
            );
        }
    }
}

pub(crate) async fn bootstrap_properties(
    library: &str,
    records: &[Map<String, Value>],
    pool: &DbPool,
) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }

    let mut key_values: HashMap<String, HashSet<String>> = HashMap::new();
    for record in records {
        for (key, value) in record {
            let entry = key_values.entry(key.clone()).or_default();
            if let Value::String(s) = value {
                entry.insert(s.clone());
            }
        }
    }

    for (key, values) in key_values {
        let existing: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM properties WHERE name = ? AND library = ?",
        )
        .bind(&key)
        .bind(library)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;

        if existing > 0 {
            continue;
        }

        let values_vec: Vec<String> = values.iter().cloned().collect();
        let inferred_type = infer_value_type(&values_vec);

        let property_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO properties (property_id, name, library, value_type) VALUES (?, ?, ?, ?)",
        )
        .bind(&property_id)
        .bind(&key)
        .bind(library)
        .bind(&inferred_type)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        for value in values {
            let value_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT OR IGNORE INTO property_values (value_id, property_id, value) \
                 VALUES (?, ?, ?)",
            )
            .bind(&value_id)
            .bind(&property_id)
            .bind(&value)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_tags_lists_parent_folders() {
        assert_eq!(folder_tags("Finance/Receipts/a.pdf"), r#"["Finance","Receipts"]"#);
        assert_eq!(folder_tags("a.pdf"), "[]");
    }

    #[test]
    fn extracted_keys_are_the_exif_fields() {
        let keys: Vec<_> = extracted_keys().collect();
        assert!(keys.contains(&"date_taken") && keys.contains(&"longitude"));
        assert_eq!(keys.len(), EXIF_FIELDS.len());
    }
}
