use crate::db::DbPool;
use crate::models::Location;
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_locations(db: State<'_, DbPool>) -> Result<Vec<Location>, String> {
    sqlx::query_as::<_, Location>("SELECT * FROM locations ORDER BY name")
        .fetch_all(db.inner())
        .await
        .map_err(|e| e.to_string())
}

/// Adds a location. `excluded` folders (absolute paths under `root_path`) are
/// left out from the start, so the first index never scans them.
#[tauri::command]
pub async fn add_location(
    root_path: String,
    name: String,
    excluded: Option<Vec<String>>,
    db: State<'_, DbPool>,
) -> Result<Location, String> {
    let location_id = Uuid::new_v4().to_string();
    let library = name.to_lowercase().replace(' ', "_");
    let added_at = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO locations (location_id, name, root_path, library, added_at) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&location_id)
    .bind(&name)
    .bind(&root_path)
    .bind(&library)
    .bind(&added_at)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;
    crate::commands::properties::ensure_tags_property(db.inner(), &library).await?;
    for folder in excluded.unwrap_or_default() {
        exclude_folder_impl(&location_id, &folder, db.inner()).await?;
    }

    sqlx::query_as::<_, Location>("SELECT * FROM locations WHERE location_id = ?")
        .bind(&location_id)
        .fetch_one(db.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_location(
    location_id: String,
    db: State<'_, DbPool>,
) -> Result<(), String> {
    let mut tx = db.inner().begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM location_views WHERE location_id = ?")
        .bind(&location_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM location_exclusions WHERE location_id = ?")
        .bind(&location_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM path_mapping_nodes WHERE location_id = ?")
        .bind(&location_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM files WHERE location_id = ?")
        .bind(&location_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM locations WHERE location_id = ?")
        .bind(&location_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn exclusion_rel(location_id: &str, folder_path: &str, pool: &DbPool) -> Result<String, String> {
    let root: String = sqlx::query_scalar("SELECT root_path FROM locations WHERE location_id = ?")
        .bind(location_id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let rel = crate::commands::path_mapping::folder_rel_from_abs(&root, folder_path)?;
    if rel.is_empty() {
        return Err("the location's own folder can't be excluded".into());
    }
    Ok(rel)
}

/// Leaves a folder out of the location: it's no longer scanned, and its files'
/// records (with any properties set on them) are removed. Nothing on disk changes.
/// Returns how many records were removed.
#[tauri::command]
pub async fn exclude_folder(location_id: String, folder_path: String, db: State<'_, DbPool>) -> Result<u64, String> {
    exclude_folder_impl(&location_id, &folder_path, db.inner()).await
}

pub async fn exclude_folder_impl(location_id: &str, folder_path: &str, pool: &DbPool) -> Result<u64, String> {
    let rel = exclusion_rel(location_id, folder_path, pool).await?;
    let prefix = format!("{rel}/");
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("INSERT OR IGNORE INTO location_exclusions (location_id, folder_rel) VALUES (?, ?)")
        .bind(location_id)
        .bind(&rel)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    // Exclusions inside it are covered by this one
    sqlx::query("DELETE FROM location_exclusions WHERE location_id = ? AND substr(folder_rel, 1, length(?)) = ?")
        .bind(location_id)
        .bind(&prefix)
        .bind(&prefix)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let removed = sqlx::query("DELETE FROM files WHERE location_id = ? AND substr(relative_path, 1, length(?)) = ?")
        .bind(location_id)
        .bind(&prefix)
        .bind(&prefix)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .rows_affected();
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(removed)
}

/// Puts an excluded folder back; its files are indexed on the next refresh.
#[tauri::command]
pub async fn include_folder(location_id: String, folder_path: String, db: State<'_, DbPool>) -> Result<(), String> {
    include_folder_impl(&location_id, &folder_path, db.inner()).await
}

pub async fn include_folder_impl(location_id: &str, folder_path: &str, pool: &DbPool) -> Result<(), String> {
    let rel = exclusion_rel(location_id, folder_path, pool).await?;
    sqlx::query("DELETE FROM location_exclusions WHERE location_id = ? AND folder_rel = ?")
        .bind(location_id)
        .bind(&rel)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, serde::Serialize, PartialEq)]
pub struct Subfolder {
    pub name: String,
    pub path: String,
}

/// The visible folders directly inside `path`, by name. Only the folder's listing
/// is read (no files are opened), so a cloud folder downloads nothing.
#[tauri::command]
pub async fn list_subfolders(path: String) -> Result<Vec<Subfolder>, String> {
    tauri::async_runtime::spawn_blocking(move || list_subfolders_impl(std::path::Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

pub fn list_subfolders_impl(path: &std::path::Path) -> Result<Vec<Subfolder>, String> {
    let mut folders: Vec<Subfolder> = std::fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        // The entry's own type, without following symlinks (as indexing doesn't)
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            (!name.starts_with('.')).then(|| Subfolder {
                path: entry.path().to_string_lossy().into_owned(),
                name,
            })
        })
        .collect();
    folders.sort_by_key(|f| f.name.to_lowercase());
    Ok(folders)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_visible_folders_only_sorted_by_name() {
        let root = std::env::temp_dir().join(format!("fb-sub-{}", Uuid::new_v4()));
        for dir in ["beta", "Alpha", ".hidden", "beta/nested"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        std::fs::write(root.join("file.txt"), b"x").unwrap();

        let names: Vec<String> = list_subfolders_impl(&root).unwrap().into_iter().map(|f| f.name).collect();
        assert_eq!(names, vec!["Alpha", "beta"]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn missing_folder_is_an_error() {
        assert!(list_subfolders_impl(std::path::Path::new("/no/such/folder")).is_err());
    }
}
