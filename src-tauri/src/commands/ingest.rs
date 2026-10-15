use crate::db::{utils::infer_value_type, DbPool};
use chrono::{DateTime, Utc};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use tauri::{Emitter, State};
use uuid::Uuid;
use walkdir::WalkDir;

/// Extracts (file_type, timestamp, file_size, created_at, metadata) for a single file path.
/// Returns None if the path is not a regular file or cannot be read.
pub(crate) fn extract_file_data(
    path: &std::path::Path,
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

    if image_exts.contains(&extension.as_str()) {
        if let Ok(file) = std::fs::File::open(path) {
            let mut buf = std::io::BufReader::new(&file);
            if let Ok(exif) = exif::Reader::new().read_from_container(&mut buf) {
                extract_exif(&exif, &mut metadata);
            }
        }
    }

    Some((file_type, timestamp, file_size, created_at, metadata))
}

/// Files per indexing batch: one blocking scan and one database transaction each.
const INGEST_BATCH: usize = 500;

type Walker = walkdir::FilterEntry<walkdir::IntoIter, fn(&walkdir::DirEntry) -> bool>;

/// A file found while indexing, ready to insert.
struct ScannedFile {
    file_path: String,
    relative_path: Option<String>,
    file_type: Option<String>,
    timestamp: Option<String>,
    created_at: Option<String>,
    file_size: i64,
    metadata: Map<String, Value>,
    tags_json: String,
}

/// Hidden files and folders (dot-names) are skipped, as Finder hides them.
fn not_hidden(entry: &walkdir::DirEntry) -> bool {
    !entry
        .file_name()
        .to_str()
        .map(|s| s.starts_with('.'))
        .unwrap_or(false)
}

/// A file's folder names, as the JSON tags array.
fn folder_tags(relative_path: &str) -> String {
    let parts: Vec<&str> = relative_path.split('/').collect();
    serde_json::to_string(&parts[..parts.len().saturating_sub(1)]).unwrap_or_else(|_| "[]".to_string())
}

/// Reads up to INGEST_BATCH files from the walk (blocking I/O). An empty batch means the walk is done.
fn scan_batch(mut iter: Walker, root: &std::path::Path) -> (Walker, Vec<ScannedFile>) {
    let mut batch = Vec::with_capacity(INGEST_BATCH);
    while batch.len() < INGEST_BATCH {
        let Some(entry) = iter.next() else { break };
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let Some((file_type, timestamp, file_size, created_at, metadata)) = extract_file_data(entry.path()) else {
            continue;
        };
        let relative_path = entry
            .path()
            .strip_prefix(root)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"));
        let tags_json = relative_path.as_deref().map(folder_tags).unwrap_or_else(|| "[]".to_string());
        batch.push(ScannedFile {
            file_path: entry.path().to_string_lossy().to_string(),
            relative_path,
            file_type,
            timestamp,
            created_at,
            file_size,
            metadata,
            tags_json,
        });
    }
    (iter, batch)
}

#[tauri::command]
pub async fn ingest_directory(
    location_id: String,
    app: tauri::AppHandle,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    ingest_location(&location_id, db.inner(), &app).await
}

async fn ingest_location(
    location_id: &str,
    pool: &DbPool,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let location = sqlx::query_as::<_, crate::models::Location>(
        "SELECT * FROM locations WHERE location_id = ?",
    )
    .bind(location_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut files_scanned: u64 = 0;
    let mut new_records: Vec<Map<String, Value>> = Vec::new();

    // Walking a drive and reading EXIF is slow, blocking I/O: it runs on a
    // blocking thread, a batch at a time, and each batch is written in one
    // transaction rather than one commit per file.
    let root = std::path::PathBuf::from(&location.root_path);
    let mut walker = Some(
        WalkDir::new(&location.root_path)
            .follow_links(false)
            .into_iter()
            .filter_entry(not_hidden as fn(&walkdir::DirEntry) -> bool),
    );

    while let Some(iter) = walker.take() {
        let batch_root = root.clone();
        let (iter, batch) = tauri::async_runtime::spawn_blocking(move || scan_batch(iter, &batch_root))
            .await
            .map_err(|e| e.to_string())?;
        if batch.is_empty() {
            break;
        }
        walker = Some(iter);

        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
        for file in batch {
            let result = sqlx::query(
                "INSERT OR IGNORE INTO files \
                 (file_id, file_path, file_type, timestamp, library, metadata, \
                  location_id, relative_path, file_size, modified_at, created_at, tags) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&file.file_path)
            .bind(&file.file_type)
            .bind(&file.timestamp)
            .bind(&location.library)
            .bind(serde_json::to_string(&file.metadata).unwrap_or_default())
            .bind(location_id)
            .bind(&file.relative_path)
            .bind(file.file_size)
            .bind(&file.timestamp)
            .bind(&file.created_at)
            .bind(&file.tags_json)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

            if result.rows_affected() > 0 {
                files_scanned += 1;
                new_records.push(file.metadata);
            }
        }
        tx.commit().await.map_err(|e| e.to_string())?;

        app.emit(
            "indexing_progress",
            serde_json::json!({
                "location_id": location_id,
                "files_scanned": files_scanned,
                "done": false
            }),
        )
        .ok();
    }

    bootstrap_properties(&location.library, &new_records, pool).await?;

    // Recompute tags for every file in this location from its relative_path.
    // This treats tags as a fresh derivation, undoing any prior promotions before
    // the mapping nodes are re-applied below.
    {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT file_id, relative_path FROM files \
             WHERE location_id = ? AND relative_path IS NOT NULL",
        )
        .bind(location_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
        for row in &rows {
            let file_id: String = row.get("file_id");
            let rel_path: String = row.get("relative_path");
            sqlx::query("UPDATE files SET tags = ? WHERE file_id = ?")
                .bind(folder_tags(&rel_path))
                .bind(&file_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
        tx.commit().await.map_err(|e| e.to_string())?;
    }

    // Re-apply any existing path mapping nodes so newly ingested files are classified.
    let mapping_nodes: Vec<crate::commands::path_mapping::PathMappingNode> =
        sqlx::query_as("SELECT * FROM path_mapping_nodes WHERE location_id = ?")
            .bind(location_id)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

    for node in &mapping_nodes {
        crate::commands::path_mapping::apply_mapping_to_files(
            location_id,
            &location.root_path,
            &node.folder_path,
            &node.property_name,
            pool,
        )
        .await?;
    }

    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE locations SET last_indexed = ? WHERE location_id = ?")
        .bind(&now)
        .bind(location_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    app.emit(
        "indexing_progress",
        serde_json::json!({
            "location_id": location_id,
            "files_scanned": files_scanned,
            "done": true
        }),
    )
    .ok();

    Ok(())
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

        let (file_type, timestamp, _file_size, _created_at, metadata) = match extract_file_data(entry.path()) {
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

fn extract_exif(exif: &exif::Exif, metadata: &mut Map<String, Value>) {
    use exif::{In, Tag};

    let tags: &[(Tag, &str)] = &[
        (Tag::DateTime, "date_taken"),
        (Tag::Make, "camera_make"),
        (Tag::Model, "camera_model"),
        (Tag::PixelXDimension, "width"),
        (Tag::PixelYDimension, "height"),
        (Tag::PhotographicSensitivity, "iso"),
        (Tag::FocalLength, "focal_length"),
        (Tag::GPSLatitude, "latitude"),
        (Tag::GPSLongitude, "longitude"),
    ];

    for (tag, key) in tags {
        if let Some(field) = exif.get_field(*tag, In::PRIMARY) {
            metadata.insert(
                key.to_string(),
                Value::String(field.display_value().to_string()),
            );
        }
    }
}

async fn bootstrap_properties(
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

    fn walker(root: &std::path::Path) -> Walker {
        WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(not_hidden as fn(&walkdir::DirEntry) -> bool)
    }

    fn fixtures() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
    }

    #[test]
    fn folder_tags_lists_parent_folders() {
        assert_eq!(folder_tags("Finance/Receipts/a.pdf"), r#"["Finance","Receipts"]"#);
        assert_eq!(folder_tags("a.pdf"), "[]");
    }

    #[test]
    fn scan_batch_finds_every_file_with_relative_paths() {
        let root = fixtures();
        let (iter, batch) = scan_batch(walker(&root), &root);
        let expected = WalkDir::new(&root)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file() && !e.file_name().to_string_lossy().starts_with('.'))
            .count();
        assert_eq!(batch.len(), expected);
        assert!(batch.iter().all(|f| f.relative_path.as_deref().is_some_and(|p| !p.starts_with('/'))));
        // The walk is exhausted: the next batch is empty
        let (_, rest) = scan_batch(iter, &root);
        assert!(rest.is_empty());
    }
}
