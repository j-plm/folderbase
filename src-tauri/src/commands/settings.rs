//! App-wide settings (the Settings window), kept in `app_settings`, one row per
//! setting. Location and view settings live with those instead.
//!
//! - `zip_folder`: where Compress saves zips (absent: Downloads)

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

const ZIP_FOLDER: &str = "zip_folder";

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    /// Where Compress saves zips; None: Downloads.
    pub zip_folder: Option<String>,
}

async fn read(pool: &DbPool, key: &str) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT value FROM app_settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

async fn write(pool: &DbPool, key: &str, value: Option<&str>) -> Result<(), String> {
    let query = match value {
        Some(v) => sqlx::query("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .bind(key)
            .bind(v),
        None => sqlx::query("DELETE FROM app_settings WHERE key = ?").bind(key),
    };
    query.execute(pool).await.map(|_| ()).map_err(|e| e.to_string())
}

pub async fn get_app_settings_impl(pool: &DbPool) -> Result<AppSettings, String> {
    Ok(AppSettings { zip_folder: read(pool, ZIP_FOLDER).await? })
}

/// Sets where zips go: a folder that's there, or None for Downloads.
pub async fn set_zip_folder_impl(pool: &DbPool, folder: Option<&str>) -> Result<AppSettings, String> {
    let folder = folder.map(str::trim).filter(|f| !f.is_empty());
    if let Some(f) = folder {
        let path = Path::new(f);
        if !path.is_absolute() || !path.is_dir() {
            return Err(format!("“{f}” isn't a folder"));
        }
    }
    write(pool, ZIP_FOLDER, folder).await?;
    get_app_settings_impl(pool).await
}

/// The folder Compress saves into: the chosen one while it's there, else Downloads.
pub async fn zip_folder(pool: &DbPool, downloads: &Path) -> std::path::PathBuf {
    match read(pool, ZIP_FOLDER).await.ok().flatten() {
        Some(f) if Path::new(&f).is_dir() => f.into(),
        _ => downloads.to_path_buf(),
    }
}

#[tauri::command]
pub async fn get_app_settings(db: State<'_, DbPool>) -> Result<AppSettings, String> {
    get_app_settings_impl(db.inner()).await
}

#[tauri::command]
pub async fn set_zip_folder(folder: Option<String>, db: State<'_, DbPool>) -> Result<AppSettings, String> {
    set_zip_folder_impl(db.inner(), folder.as_deref()).await
}
