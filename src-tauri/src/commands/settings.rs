//! App-wide settings (the Settings window), kept in `settings.json` in the app's
//! config folder beside Appearance's file. They're this person's preferences on
//! this machine, so they live apart from the database: clearing or rebuilding the
//! library never touches them, and the file can be read or reset by hand.
//! Location and view settings live with those instead.
//!
//! - `zip_folder`: where Compress saves zips (absent: Downloads)
//!
//! Settings were briefly kept in an `app_settings` table; `migrate_from_db`
//! carries them into the file once and drops the table.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

const FILE_NAME: &str = "settings.json";

/// Every app-wide setting. Missing keys take their defaults, and a newer file's
/// unknown keys are ignored, so the file can grow without breaking older builds.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    /// Where Compress saves zips; None: Downloads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zip_folder: Option<String>,
}

/// The settings in `dir`: the defaults when there's no file or it can't be read.
pub fn load(dir: &Path) -> AppSettings {
    std::fs::read_to_string(dir.join(FILE_NAME))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Writes the settings to a hidden file beside the real one and renames it over,
/// so a crash mid-write never leaves a half-written file.
pub fn save(dir: &Path, settings: &AppSettings) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let temp = dir.join(format!(".{FILE_NAME}.tmp"));
    std::fs::write(&temp, text + "\n").map_err(|e| e.to_string())?;
    std::fs::rename(&temp, dir.join(FILE_NAME)).map_err(|e| e.to_string())
}

/// Sets where zips go: a folder that's there, or None for Downloads.
pub fn set_zip_folder_impl(dir: &Path, folder: Option<&str>) -> Result<AppSettings, String> {
    let folder = folder.map(str::trim).filter(|f| !f.is_empty());
    if let Some(f) = folder {
        let path = Path::new(f);
        if !path.is_absolute() || !path.is_dir() {
            return Err(format!("“{f}” isn't a folder"));
        }
    }
    let settings = AppSettings { zip_folder: folder.map(str::to_string), ..load(dir) };
    save(dir, &settings)?;
    Ok(settings)
}

/// The folder Compress saves into: the chosen one while it's there, else Downloads.
pub fn zip_folder(dir: &Path, downloads: &Path) -> PathBuf {
    match load(dir).zip_folder {
        Some(f) if Path::new(&f).is_dir() => f.into(),
        _ => downloads.to_path_buf(),
    }
}

/// Carries settings from the old `app_settings` table into the file (unless the
/// file already exists), then drops the table. Does nothing once it's gone.
pub async fn migrate_from_db(pool: &DbPool, dir: &Path) -> Result<(), String> {
    let rows: Vec<(String, String)> = match sqlx::query_as("SELECT key, value FROM app_settings").fetch_all(pool).await {
        Ok(rows) => rows,
        Err(_) => return Ok(()), // no table: already moved, or never made
    };
    if !dir.join(FILE_NAME).exists() {
        let mut settings = AppSettings::default();
        for (key, value) in rows {
            if key == "zip_folder" {
                settings.zip_folder = Some(value);
            }
        }
        save(dir, &settings)?;
    }
    sqlx::query("DROP TABLE IF EXISTS app_settings").execute(pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// The app's config folder, with any settings from the old table moved into it first.
pub async fn settings_dir(app: &tauri::AppHandle, pool: &DbPool) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    migrate_from_db(pool, &dir).await?;
    Ok(dir)
}

#[tauri::command]
pub async fn get_app_settings(app: tauri::AppHandle, db: State<'_, DbPool>) -> Result<AppSettings, String> {
    Ok(load(&settings_dir(&app, db.inner()).await?))
}

#[tauri::command]
pub async fn set_zip_folder(folder: Option<String>, app: tauri::AppHandle, db: State<'_, DbPool>) -> Result<AppSettings, String> {
    set_zip_folder_impl(&settings_dir(&app, db.inner()).await?, folder.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("folderbase-settings-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn no_file_gives_the_defaults() {
        let dir = temp_dir();
        assert_eq!(load(&dir), AppSettings::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = temp_dir();
        let settings = AppSettings { zip_folder: Some("/Users/sam/Zips".into()) };
        save(&dir, &settings).unwrap();
        assert_eq!(load(&dir), settings);
        assert!(!dir.join(".settings.json.tmp").exists());
    }

    #[test]
    fn an_unreadable_file_gives_the_defaults() {
        let dir = temp_dir();
        std::fs::write(dir.join(FILE_NAME), "{ not json").unwrap();
        assert_eq!(load(&dir), AppSettings::default());
    }

    #[test]
    fn unknown_keys_from_a_newer_version_are_ignored() {
        let dir = temp_dir();
        std::fs::write(dir.join(FILE_NAME), r#"{"zip_folder": "/z", "appearance_default": "system"}"#).unwrap();
        assert_eq!(load(&dir).zip_folder.as_deref(), Some("/z"));
    }

    #[test]
    fn zips_go_to_downloads_until_a_folder_is_chosen() {
        let dir = temp_dir();
        let downloads = Path::new("/nowhere/Downloads");
        assert_eq!(zip_folder(&dir, downloads), downloads);

        let chosen = temp_dir();
        let chosen_text = chosen.to_string_lossy().into_owned();
        let settings = set_zip_folder_impl(&dir, Some(&chosen_text)).unwrap();
        assert_eq!(settings.zip_folder.as_deref(), Some(chosen_text.as_str()));
        assert_eq!(zip_folder(&dir, downloads), chosen);

        // Back to Downloads
        assert_eq!(set_zip_folder_impl(&dir, None).unwrap().zip_folder, None);
        assert_eq!(zip_folder(&dir, downloads), downloads);
    }

    #[test]
    fn only_a_folder_that_exists_can_be_chosen() {
        let dir = temp_dir();
        assert!(set_zip_folder_impl(&dir, Some("/definitely/not/here")).is_err());
        assert!(set_zip_folder_impl(&dir, Some("relative/folder")).is_err());
        assert_eq!(load(&dir).zip_folder, None);
    }

    #[test]
    fn a_chosen_folder_that_has_gone_falls_back_to_downloads() {
        let dir = temp_dir();
        let gone = temp_dir();
        set_zip_folder_impl(&dir, Some(&gone.to_string_lossy())).unwrap();
        std::fs::remove_dir(&gone).unwrap();
        let downloads = Path::new("/nowhere/Downloads");
        assert_eq!(zip_folder(&dir, downloads), downloads);
    }
}
