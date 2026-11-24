//! App-wide settings (the Settings window), kept in `settings.json` in the app's
//! config folder beside Appearance's file. They're this person's preferences on
//! this machine, so they live apart from the database: clearing or rebuilding the
//! library never touches them, and the file can be read or reset by hand.
//! Location settings live in the `locations` table; Appearance in its own file
//! (`appearance.rs`), as the View menu owns it.
//!
//! Every change goes through `set_app_settings` (or `set_zip_folder`), which
//! saves the file and tells every window (`app-settings-changed`), so the
//! Settings window and the main window always show the same values.
//!
//! Settings were briefly kept in an `app_settings` table; `migrate_from_db`
//! carries them into the file once and drops the table.

use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, State};

const FILE_NAME: &str = "settings.json";
/// Sent to every window, with the settings as they now are.
pub const CHANGED_EVENT: &str = "app-settings-changed";

/// The view mode a location opens in the first time (afterwards, the one it was left in).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    #[default]
    Database,
    Tiles,
    List,
    Columns,
    Gallery,
}

/// Which location shows when Folderbase opens.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OnLaunch {
    /// The location (and its view) open when Folderbase was last quit.
    #[default]
    Last,
    /// The first location in the sidebar, at its Default view.
    First,
}

/// When locations' folders are checked for being on disk.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MissingCheck {
    /// Every 30 seconds, and when the window comes forward.
    #[default]
    Periodic,
    /// Only when the window comes forward.
    Focus,
}

/// Where a new Hierarchy level puts files with no value in it.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoValue {
    /// In a "No …" folder (conditional properties still start loose).
    #[default]
    Folder,
    /// Loose in the folder above.
    Loose,
}

/// What a new view starts with (Settings ▸ New Views); existing views keep their own.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct NewViewDefaults {
    pub group_by_hierarchy: bool,
    pub non_empty_columns: bool,
    pub wrap_multi_select: bool,
    pub freeze_name: bool,
    pub no_value: NoValue,
    pub skip_single: bool,
    pub show_all_values: bool,
}

impl Default for NewViewDefaults {
    fn default() -> Self {
        Self {
            // As the table has always started: off until switched on in the Group popover
            group_by_hierarchy: false,
            non_empty_columns: true,
            wrap_multi_select: true,
            freeze_name: true,
            no_value: NoValue::Folder,
            skip_single: false,
            show_all_values: false,
        }
    }
}

/// How often a backup of the database is made by itself (Settings ▸ Advanced).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackupSchedule {
    /// Every day, keeping the last 7.
    #[default]
    Daily,
    /// Every week, keeping the last 4.
    Weekly,
    Never,
}

impl BackupSchedule {
    /// How long after the last backup the next is made; None: never.
    pub fn interval(self) -> Option<chrono::Duration> {
        match self {
            Self::Daily => Some(chrono::Duration::days(1)),
            Self::Weekly => Some(chrono::Duration::weeks(1)),
            Self::Never => None,
        }
    }

    /// How many automatic backups the folder keeps.
    pub fn keep(self) -> usize {
        match self {
            Self::Weekly => 4,
            _ => 7,
        }
    }
}

/// Backups of the database (`commands/backup.rs`).
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct BackupSettings {
    pub schedule: BackupSchedule,
    /// Where backups go; None: a Backups folder in the app data folder, on this Mac.
    /// Set with `set_backup_folder`.
    pub folder: Option<String>,
    /// When the last backup was made (RFC 3339), by hand or by itself. Set by Rust.
    pub last_backup: Option<String>,
    /// Whether Folderbase has asked where to keep backups (it asks once).
    pub folder_asked: bool,
}

/// Every app-wide setting. Missing keys take their defaults, and a newer file's
/// unknown keys are ignored, so the file can grow without breaking older builds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    /// Where Compress saves zips; None: Downloads.
    pub zip_folder: Option<String>,
    pub first_view_mode: ViewMode,
    pub on_launch: OnLaunch,
    /// Index and show files and folders whose names start with "." (.DS_Store never).
    pub show_hidden_files: bool,
    pub missing_check: MissingCheck,
    pub new_views: NewViewDefaults,
    pub backup: BackupSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            zip_folder: None,
            first_view_mode: ViewMode::default(),
            on_launch: OnLaunch::default(),
            show_hidden_files: false,
            missing_check: MissingCheck::default(),
            new_views: NewViewDefaults::default(),
            backup: BackupSettings::default(),
        }
    }
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

/// Sets where backups go: a folder that's there, or None for the app data
/// folder. Either way Folderbase has now asked.
pub fn set_backup_folder_impl(dir: &Path, folder: Option<&str>) -> Result<AppSettings, String> {
    let folder = folder.map(str::trim).filter(|f| !f.is_empty());
    if let Some(f) = folder {
        let path = Path::new(f);
        if !path.is_absolute() || !path.is_dir() {
            return Err(format!("“{f}” isn't a folder"));
        }
    }
    let mut settings = load(dir);
    settings.backup.folder = folder.map(str::to_string);
    settings.backup.folder_asked = true;
    save(dir, &settings)?;
    Ok(settings)
}

/// Notes that a backup was made at `when`.
pub fn record_backup(dir: &Path, when: chrono::DateTime<chrono::Utc>) -> Result<AppSettings, String> {
    let mut settings = load(dir);
    settings.backup.last_backup = Some(when.to_rfc3339());
    save(dir, &settings)?;
    Ok(settings)
}

/// The folder backups go to: the chosen one while it's there, else Backups in the app data folder.
pub fn backup_folder(dir: &Path, data_dir: &Path) -> PathBuf {
    match load(dir).backup.folder {
        Some(f) if Path::new(&f).is_dir() => f.into(),
        _ => data_dir.join("Backups"),
    }
}

/// Applies `patch` (an object of settings, nested for `new_views`) over the
/// settings in `dir` and saves them. A key set to null goes back to its default,
/// so Restore Defaults sends a pane's keys as null. A value of the wrong kind is
/// refused and nothing is saved. `zip_folder` and `backup.folder` aren't changed
/// here (they're checked by `set_zip_folder_impl` and `set_backup_folder_impl`),
/// nor `backup.last_backup`, which only Rust records.
pub fn update_impl(dir: &Path, patch: &Value) -> Result<AppSettings, String> {
    let Value::Object(changes) = patch else { return Err("settings must be an object".into()) };
    if changes.contains_key("zip_folder") {
        return Err("zip_folder is set with set_zip_folder".into());
    }
    if let Some(Value::Object(backup)) = changes.get("backup") {
        if backup.contains_key("folder") {
            return Err("backup.folder is set with set_backup_folder".into());
        }
        if backup.contains_key("last_backup") {
            return Err("backup.last_backup is recorded by Folderbase".into());
        }
    }
    let mut current = serde_json::to_value(load(dir)).map_err(|e| e.to_string())?;
    merge(&mut current, patch);
    let settings: AppSettings = serde_json::from_value(current).map_err(|e| format!("not a setting: {e}"))?;
    save(dir, &settings)?;
    Ok(settings)
}

/// Every setting back to its default (Reset All Settings).
pub fn reset_impl(dir: &Path) -> Result<AppSettings, String> {
    let settings = AppSettings::default();
    save(dir, &settings)?;
    Ok(settings)
}

/// `patch` laid over `target`: objects merge key by key, null removes the key
/// (so it takes its default when read back), anything else replaces.
fn merge(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(t), Value::Object(p)) => {
            for (key, value) in p {
                if value.is_null() {
                    t.remove(key);
                } else {
                    merge(t.entry(key.clone()).or_insert(Value::Null), value);
                }
            }
        }
        (t, p) => *t = p.clone(),
    }
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

/// Settings ▸ Advanced and Files: where the database is and how big, and how
/// much the thumbnail cache takes.
#[derive(Debug, Serialize, PartialEq)]
pub struct StorageInfo {
    pub database_path: String,
    /// The database with its write-ahead log.
    pub database_bytes: u64,
    pub thumbnail_bytes: u64,
}

/// The database file's size with its `-wal` and `-shm` companions.
pub fn database_bytes(db: &Path) -> u64 {
    ["", "-wal", "-shm"]
        .iter()
        .filter_map(|suffix| std::fs::metadata(format!("{}{suffix}", db.display())).ok())
        .map(|m| m.len())
        .sum()
}

/// Bytes in the files directly inside `dir` (the thumbnail cache is flat); 0 when it's not there.
pub fn folder_bytes(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .map(|entries| entries.filter_map(Result::ok).filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum())
        .unwrap_or(0)
}

/// Empties the thumbnail cache; thumbnails are made again as they're needed.
pub fn clear_folder(dir: &Path) -> Result<(), String> {
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn thumbnail_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbnails"))
}

#[tauri::command]
pub async fn get_storage_info(app: tauri::AppHandle) -> Result<StorageInfo, String> {
    let db = app.path().app_data_dir().map_err(|e| e.to_string())?.join("folderbase.db");
    let thumbnails = thumbnail_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || StorageInfo {
        database_bytes: database_bytes(&db),
        database_path: db.to_string_lossy().into_owned(),
        thumbnail_bytes: folder_bytes(&thumbnails),
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_thumbnail_cache(app: tauri::AppHandle) -> Result<(), String> {
    let dir = thumbnail_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || clear_folder(&dir)).await.map_err(|e| e.to_string())?
}

/// Puts the settings that take effect in Rust in place (at launch, and after each change).
pub fn apply(settings: &AppSettings) {
    crate::commands::ingest::set_show_hidden(settings.show_hidden_files);
}

/// Tells every window the settings changed, after putting them in place.
pub fn changed(app: &tauri::AppHandle, settings: AppSettings) -> AppSettings {
    apply(&settings);
    let _ = app.emit(CHANGED_EVENT, &settings);
    settings
}

#[tauri::command]
pub async fn get_app_settings(app: tauri::AppHandle, db: State<'_, DbPool>) -> Result<AppSettings, String> {
    Ok(load(&settings_dir(&app, db.inner()).await?))
}

#[tauri::command]
pub async fn set_zip_folder(folder: Option<String>, app: tauri::AppHandle, db: State<'_, DbPool>) -> Result<AppSettings, String> {
    let settings = set_zip_folder_impl(&settings_dir(&app, db.inner()).await?, folder.as_deref())?;
    Ok(changed(&app, settings))
}

#[tauri::command]
pub async fn set_backup_folder(folder: Option<String>, app: tauri::AppHandle, db: State<'_, DbPool>) -> Result<AppSettings, String> {
    let settings = set_backup_folder_impl(&settings_dir(&app, db.inner()).await?, folder.as_deref())?;
    Ok(changed(&app, settings))
}

/// Changes some settings (see `update_impl`); resolves to all of them as they now are.
#[tauri::command]
pub async fn set_app_settings(patch: Value, app: tauri::AppHandle, db: State<'_, DbPool>) -> Result<AppSettings, String> {
    let settings = update_impl(&settings_dir(&app, db.inner()).await?, &patch)?;
    Ok(changed(&app, settings))
}

/// Reset All Settings: every setting here, and Appearance, back to its default.
/// Locations and views are untouched.
#[tauri::command]
pub async fn reset_app_settings(app: tauri::AppHandle, db: State<'_, DbPool>) -> Result<AppSettings, String> {
    let settings = reset_impl(&settings_dir(&app, db.inner()).await?)?;
    crate::appearance::set(&app, crate::appearance::Appearance::DEFAULT)?;
    Ok(changed(&app, settings))
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
        let settings = AppSettings { zip_folder: Some("/Users/sam/Zips".into()), show_hidden_files: true, ..AppSettings::default() };
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

    #[test]
    fn an_older_file_gets_the_new_settings_at_their_defaults() {
        let dir = temp_dir();
        std::fs::write(dir.join(FILE_NAME), r#"{"zip_folder": "/z"}"#).unwrap();
        let settings = load(&dir);
        assert_eq!(settings.zip_folder.as_deref(), Some("/z"));
        assert_eq!(settings.first_view_mode, ViewMode::Database);
        assert_eq!(settings.on_launch, OnLaunch::Last);
        assert_eq!(settings.new_views, NewViewDefaults::default());
    }

    #[test]
    fn a_patch_changes_only_what_it_names() {
        let dir = temp_dir();
        set_zip_folder_impl(&dir, Some(&dir.to_string_lossy())).unwrap();
        let settings = update_impl(&dir, &serde_json::json!({ "first_view_mode": "columns", "new_views": { "freeze_name": false } })).unwrap();
        assert_eq!(settings.first_view_mode, ViewMode::Columns);
        assert!(!settings.new_views.freeze_name);
        // Untouched: the rest of New Views, and the zip folder
        assert!(settings.new_views.non_empty_columns);
        assert_eq!(settings.zip_folder.as_deref(), Some(dir.to_string_lossy().as_ref()));
        assert_eq!(load(&dir), settings);
    }

    #[test]
    fn null_restores_a_default() {
        let dir = temp_dir();
        update_impl(&dir, &serde_json::json!({ "missing_check": "focus", "new_views": { "skip_single": true, "no_value": "loose" } })).unwrap();
        let settings = update_impl(&dir, &serde_json::json!({ "missing_check": null, "new_views": { "skip_single": null } })).unwrap();
        assert_eq!(settings.missing_check, MissingCheck::Periodic);
        assert!(!settings.new_views.skip_single);
        assert_eq!(settings.new_views.no_value, NoValue::Loose);
    }

    #[test]
    fn gallery_can_be_the_first_view_mode() {
        let dir = temp_dir();
        let settings = update_impl(&dir, &serde_json::json!({ "first_view_mode": "gallery" })).unwrap();
        assert_eq!(settings.first_view_mode, ViewMode::Gallery);
    }

    #[test]
    fn a_wrong_value_is_refused_and_nothing_saved() {
        let dir = temp_dir();
        assert!(update_impl(&dir, &serde_json::json!({ "first_view_mode": "coverflow" })).is_err());
        assert!(update_impl(&dir, &serde_json::json!({ "show_hidden_files": "yes" })).is_err());
        assert!(update_impl(&dir, &serde_json::json!(["not", "an", "object"])).is_err());
        assert!(update_impl(&dir, &serde_json::json!({ "zip_folder": "/elsewhere" })).is_err());
        assert!(!dir.join(FILE_NAME).exists());
    }

    #[test]
    fn reset_puts_everything_back() {
        let dir = temp_dir();
        update_impl(&dir, &serde_json::json!({ "on_launch": "first", "show_hidden_files": true })).unwrap();
        assert_eq!(reset_impl(&dir).unwrap(), AppSettings::default());
        assert_eq!(load(&dir), AppSettings::default());
    }

    #[test]
    fn backups_default_to_daily_in_the_app_data_folder() {
        let dir = temp_dir();
        let data = Path::new("/nowhere/Application Support/app");
        let settings = load(&dir);
        assert_eq!(settings.backup.schedule, BackupSchedule::Daily);
        assert_eq!(settings.backup.schedule.keep(), 7);
        assert_eq!(BackupSchedule::Weekly.keep(), 4);
        assert_eq!(BackupSchedule::Never.interval(), None);
        assert_eq!(backup_folder(&dir, data), data.join("Backups"));
    }

    #[test]
    fn choosing_a_backup_folder_counts_as_asked_and_falls_back_when_gone() {
        let dir = temp_dir();
        let data = Path::new("/nowhere/app");
        let chosen = temp_dir();
        let settings = set_backup_folder_impl(&dir, Some(&chosen.to_string_lossy())).unwrap();
        assert!(settings.backup.folder_asked);
        assert_eq!(backup_folder(&dir, data), chosen);
        assert!(set_backup_folder_impl(&dir, Some("/definitely/not/here")).is_err());
        std::fs::remove_dir(&chosen).unwrap();
        assert_eq!(backup_folder(&dir, data), data.join("Backups"));
        // "Not now": no folder, but asked
        let settings = set_backup_folder_impl(&dir, None).unwrap();
        assert_eq!(settings.backup.folder, None);
        assert!(settings.backup.folder_asked);
    }

    #[test]
    fn a_patch_sets_the_schedule_but_not_the_folder_or_the_last_backup() {
        let dir = temp_dir();
        let settings = update_impl(&dir, &serde_json::json!({ "backup": { "schedule": "weekly" } })).unwrap();
        assert_eq!(settings.backup.schedule, BackupSchedule::Weekly);
        assert!(update_impl(&dir, &serde_json::json!({ "backup": { "folder": "/x" } })).is_err());
        assert!(update_impl(&dir, &serde_json::json!({ "backup": { "last_backup": "2026-01-01T00:00:00Z" } })).is_err());
        let when = chrono::Utc::now();
        assert_eq!(record_backup(&dir, when).unwrap().backup.last_backup, Some(when.to_rfc3339()));
        assert_eq!(load(&dir).backup.schedule, BackupSchedule::Weekly);
    }

    #[test]
    fn sizes_add_up_the_database_and_its_log_and_the_cache() {
        let dir = temp_dir();
        let db = dir.join("folderbase.db");
        std::fs::write(&db, vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("folderbase.db-wal"), vec![0u8; 20]).unwrap();
        assert_eq!(database_bytes(&db), 120);
        assert_eq!(database_bytes(&dir.join("nothing.db")), 0);

        let cache = dir.join("thumbnails");
        assert_eq!(folder_bytes(&cache), 0);
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::write(cache.join("a.png"), vec![0u8; 7]).unwrap();
        std::fs::write(cache.join("b.none"), b"").unwrap();
        assert_eq!(folder_bytes(&cache), 7);
        clear_folder(&cache).unwrap();
        assert_eq!(folder_bytes(&cache), 0);
        // Clearing what's already gone is fine
        clear_folder(&cache).unwrap();
    }
}
