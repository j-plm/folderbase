//! Files dropped in from outside the app (Finder, Mail, a browser): copied into
//! the location's Added Files folder, then indexed. The originals stay where they
//! are, and where the copies sit on disk doesn't matter: the folder they were
//! dropped on gives them their values (the frontend's `planDrop`).
//!
//! - Files already inside the location aren't copied; they're filed as they are
//! - A name already taken gets a number, as Finder's Keep Both does ("report 2.pdf")
//! - A dropped folder is copied whole, hidden files and links left out
//! - Undoing the drop moves the copies to the Trash (`trash_added_files`)
//! - The Added Files folder is made when the first file arrives, and goes when
//!   an undo leaves it empty; each location can choose its own (`set_added_folder`)

use crate::commands::ingest::not_hidden;
use crate::db::DbPool;
use crate::models::Location;
use serde::Serialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use tauri::State;
use walkdir::WalkDir;

/// The folder at the top of a location that files dropped in from outside are copied into, unless it chooses another.
pub const HOLDING_FOLDER: &str = "Added Files";

/// A location's Added Files folder: `added_folder` (relative to the root) or the default.
pub fn added_folder_path(root: &Path, added_folder: Option<&str>) -> PathBuf {
    root.join(added_folder.filter(|f| !f.trim().is_empty()).unwrap_or(HOLDING_FOLDER))
}

/// An Added Files folder as stored: relative to the root, "/" between folders,
/// None for the default. Refuses anything that would leave the location.
pub fn added_folder_setting(folder: Option<&str>) -> Result<Option<String>, String> {
    let Some(folder) = folder.map(str::trim).filter(|f| !f.is_empty()) else {
        return Ok(None);
    };
    let parts: Vec<&str> = folder.split(['/', '\\']).filter(|p| !p.is_empty() && *p != ".").collect();
    if parts.iter().any(|p| *p == "..") || Path::new(folder).is_absolute() {
        return Err("The Added Files folder has to be inside the location".into());
    }
    if parts.is_empty() {
        return Err("The Added Files folder can't be the location itself".into());
    }
    let rel = parts.join("/");
    Ok(if rel == HOLDING_FOLDER { None } else { Some(rel) })
}

/// `name` in `dir`, numbered when it's taken: "report.pdf", "report 2.pdf", "report 3.pdf".
pub fn unique_path(dir: &Path, name: &OsStr) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let as_path = Path::new(name);
    let stem = as_path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = as_path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|n| dir.join(format!("{stem} {n}{ext}")))
        .find(|p| !p.exists())
        .expect("some number is free")
}

/// Copies a file or folder into `dest` under a free name. Returns the copy, and the files copied.
pub fn copy_into(dest: &Path, source: &Path) -> Result<(PathBuf, Vec<PathBuf>), String> {
    let name = source.file_name().ok_or_else(|| format!("{} has no name", source.display()))?;
    let meta = std::fs::symlink_metadata(source).map_err(|e| format!("{}: {e}", source.display()))?;
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let target = unique_path(dest, name);
    if meta.is_file() {
        std::fs::copy(source, &target).map_err(|e| format!("{}: {e}", source.display()))?;
        return Ok((target.clone(), vec![target]));
    }
    if !meta.is_dir() {
        return Ok((target, vec![]));
    }
    let mut copied = Vec::new();
    for entry in WalkDir::new(source).follow_links(false).into_iter().filter_entry(not_hidden) {
        let entry = entry.map_err(|e| e.to_string())?;
        let rel = entry.path().strip_prefix(source).map_err(|e| e.to_string())?;
        let to = target.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
        } else if entry.file_type().is_file() {
            std::fs::copy(entry.path(), &to).map_err(|e| format!("{}: {e}", entry.path().display()))?;
            copied.push(to);
        }
    }
    Ok((target, copied))
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Imported {
    /// Every dropped file's path in the location.
    pub files: Vec<String>,
    /// The Added Files folder they were copied into.
    pub folder: String,
    /// What was copied in (files and folders directly in `folder`), to put in the Trash on undo.
    pub copies: Vec<String>,
}

/// Copies `paths` into the location's holding folder (those already inside it
/// stay put) and indexes them.
pub async fn import_files_impl(location_id: &str, paths: &[String], pool: &DbPool) -> Result<Imported, String> {
    let (root, holding) = location_folders(location_id, pool).await?;

    let mut files = Vec::new();
    let mut copies = Vec::new();
    for path in paths {
        let source = PathBuf::from(path);
        if source.starts_with(&root) {
            if source.is_dir() {
                files.extend(
                    WalkDir::new(&source)
                        .into_iter()
                        .filter_entry(not_hidden)
                        .filter_map(Result::ok)
                        .filter(|e| e.file_type().is_file())
                        .map(|e| e.into_path()),
                );
            } else {
                files.push(source);
            }
            continue;
        }
        let (copy, copied) = copy_into(&holding, &source)?;
        copies.push(copy);
        files.extend(copied);
    }

    crate::commands::sync::sync_location(location_id, pool, &|_| {}).await?;
    let text = |ps: Vec<PathBuf>| ps.into_iter().map(|p| p.to_string_lossy().into_owned()).collect();
    Ok(Imported { files: text(files), folder: holding.to_string_lossy().into_owned(), copies: text(copies) })
}

#[tauri::command]
pub async fn import_files(location_id: String, paths: Vec<String>, db: State<'_, DbPool>) -> Result<Imported, String> {
    import_files_impl(&location_id, &paths, db.inner()).await
}

async fn location(location_id: &str, pool: &DbPool) -> Result<Location, String> {
    sqlx::query_as::<_, Location>("SELECT * FROM locations WHERE location_id = ?")
        .bind(location_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "That location no longer exists".to_string())
}

/// A location's root, and its Added Files folder.
async fn location_folders(location_id: &str, pool: &DbPool) -> Result<(PathBuf, PathBuf), String> {
    let loc = location(location_id, pool).await?;
    let root = PathBuf::from(&loc.root_path);
    let holding = added_folder_path(&root, loc.added_folder.as_deref());
    Ok((root, holding))
}

/// Puts `copies` in the Trash with `trash`, refusing anything not directly in
/// `holding`: only what a drop copied in is ever taken away. Missing ones are skipped.
pub fn trash_copies(holding: &Path, copies: &[String], trash: impl Fn(&Path) -> Result<(), String>) -> Result<(), String> {
    for copy in copies {
        let path = Path::new(copy);
        if path.parent() != Some(holding) {
            return Err(format!("{copy} wasn't added by a drop"));
        }
        if std::fs::symlink_metadata(path).is_ok() {
            trash(path)?;
        }
    }
    Ok(())
}

/// Removes a folder left with nothing in it but Finder's hidden `.DS_Store`.
pub fn remove_if_empty(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let names: Vec<_> = entries.filter_map(Result::ok).map(|e| e.file_name()).collect();
    if names.iter().all(|n| n == ".DS_Store") {
        let _ = std::fs::remove_file(dir.join(".DS_Store"));
        let _ = std::fs::remove_dir(dir);
    }
}

/// Moves a file or folder to the Trash, where it can be put back.
fn move_to_trash(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSFileManager, NSString, NSURL};
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, None)
            .map_err(|e| format!("{}: {}", path.display(), e.localizedDescription()))
    }
    #[cfg(not(target_os = "macos"))]
    Err(format!("{} couldn't be moved to the Trash on this platform", path.display()))
}

/// Undoes a drop from outside: its copies (directly in `folder`, the Added Files
/// folder they went into) go to the Trash, and their records are removed.
pub async fn trash_added_files_impl(
    location_id: &str,
    folder: &str,
    copies: &[String],
    pool: &DbPool,
    trash: impl Fn(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let (root, _) = location_folders(location_id, pool).await?;
    let holding = PathBuf::from(folder);
    if !holding.starts_with(&root) || holding == root {
        return Err(format!("{folder} isn't an Added Files folder of this location"));
    }
    trash_copies(&holding, copies, trash)?;
    remove_if_empty(&holding);
    // Their records go with them: just those, not a refresh (which won't empty a location that looks unavailable)
    for copy in copies {
        sqlx::query("DELETE FROM files WHERE location_id = ? AND (file_path = ? OR substr(file_path, 1, length(?) + 1) = ? || '/')")
            .bind(location_id)
            .bind(copy)
            .bind(copy)
            .bind(copy)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn trash_added_files(location_id: String, folder: String, copies: Vec<String>, db: State<'_, DbPool>) -> Result<(), String> {
    trash_added_files_impl(&location_id, &folder, &copies, db.inner(), move_to_trash).await
}

/// Chooses a location's Added Files folder (`folder`: absolute, or relative to
/// the root; empty for the default). With `move_files`, what's in the old one is
/// moved into the new one (their values follow: moves are recognised by
/// fingerprint), and the old one goes if that leaves it empty.
pub async fn set_added_folder_impl(location_id: &str, folder: &str, move_files: bool, pool: &DbPool) -> Result<Location, String> {
    let (root, old) = location_folders(location_id, pool).await?;
    let given = Path::new(folder.trim());
    let relative = if given.is_absolute() {
        let rel = given.strip_prefix(&root).map_err(|_| "The Added Files folder has to be inside the location".to_string())?;
        rel.to_string_lossy().into_owned()
    } else {
        folder.to_string()
    };
    let setting = added_folder_setting(Some(&relative))?;
    let new = added_folder_path(&root, setting.as_deref());
    let rel = new.strip_prefix(&root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
    let excluded: Vec<String> = sqlx::query_scalar("SELECT folder_rel FROM location_exclusions WHERE location_id = ?")
        .bind(location_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    if excluded.iter().any(|x| rel == *x || rel.starts_with(&format!("{x}/"))) {
        return Err(format!("“{rel}” is in an excluded folder, so files copied there wouldn't show"));
    }

    if move_files && new != old && old.is_dir() {
        if new.starts_with(&old) {
            return Err("The files can't be moved into a folder inside the one they're in".into());
        }
        std::fs::create_dir_all(&new).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(&old).map_err(|e| e.to_string())?.filter_map(Result::ok) {
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let target = unique_path(&new, &entry.file_name());
            std::fs::rename(entry.path(), &target).map_err(|e| format!("{}: {e}", entry.path().display()))?;
        }
        remove_if_empty(&old);
    }

    sqlx::query("UPDATE locations SET added_folder = ? WHERE location_id = ?")
        .bind(&setting)
        .bind(location_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    if move_files {
        crate::commands::sync::sync_location(location_id, pool, &|_| {}).await?;
    }
    location(location_id, pool).await
}

#[tauri::command]
pub async fn set_added_folder(location_id: String, folder: String, move_files: bool, db: State<'_, DbPool>) -> Result<Location, String> {
    set_added_folder_impl(&location_id, &folder, move_files, db.inner()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fb-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn added_folder_defaults_to_added_files() {
        let root = Path::new("/w");
        assert_eq!(added_folder_path(root, None), root.join("Added Files"));
        assert_eq!(added_folder_path(root, Some("Inbox/New")), root.join("Inbox/New"));
    }

    #[test]
    fn added_folder_setting_keeps_it_inside_the_location() {
        assert_eq!(added_folder_setting(Some(" Inbox/New/ ")), Ok(Some("Inbox/New".into())));
        assert_eq!(added_folder_setting(Some("./Inbox")), Ok(Some("Inbox".into())));
        // The default is stored as none, so it follows any change to the default
        assert_eq!(added_folder_setting(Some("Added Files")), Ok(None));
        assert_eq!(added_folder_setting(Some("")), Ok(None));
        assert!(added_folder_setting(Some("../Elsewhere")).is_err());
        assert!(added_folder_setting(Some("/Users/x")).is_err());
        assert!(added_folder_setting(Some(".")).is_err());
    }

    #[test]
    fn remove_if_empty_leaves_a_folder_with_files() {
        let dir = temp_dir();
        std::fs::write(dir.join(".DS_Store"), b"x").unwrap();
        std::fs::write(dir.join("a.txt"), b"a").unwrap();
        remove_if_empty(&dir);
        assert!(dir.join("a.txt").exists());
        std::fs::remove_file(dir.join("a.txt")).unwrap();
        remove_if_empty(&dir);
        assert!(!dir.exists());
    }

    #[test]
    fn unique_path_numbers_a_taken_name() {
        let dir = temp_dir();
        assert_eq!(unique_path(&dir, OsStr::new("report.pdf")), dir.join("report.pdf"));
        std::fs::write(dir.join("report.pdf"), b"a").unwrap();
        assert_eq!(unique_path(&dir, OsStr::new("report.pdf")), dir.join("report 2.pdf"));
        std::fs::write(dir.join("report 2.pdf"), b"b").unwrap();
        assert_eq!(unique_path(&dir, OsStr::new("report.pdf")), dir.join("report 3.pdf"));
    }

    #[test]
    fn unique_path_numbers_a_name_without_extension() {
        let dir = temp_dir();
        std::fs::write(dir.join("Notes"), b"a").unwrap();
        assert_eq!(unique_path(&dir, OsStr::new("Notes")), dir.join("Notes 2"));
    }

    #[test]
    fn copy_into_copies_a_file_and_keeps_the_original() {
        let (src, dest) = (temp_dir(), temp_dir().join("Added Files"));
        std::fs::write(src.join("a.txt"), b"hello").unwrap();
        let (copy, copied) = copy_into(&dest, &src.join("a.txt")).unwrap();
        assert_eq!(copy, dest.join("a.txt"));
        assert_eq!(copied, vec![dest.join("a.txt")]);
        assert_eq!(std::fs::read(dest.join("a.txt")).unwrap(), b"hello");
        assert!(src.join("a.txt").exists());
    }

    #[test]
    fn copy_into_copies_a_folder_without_hidden_files() {
        let (src, dest) = (temp_dir(), temp_dir());
        let folder = src.join("Photos");
        std::fs::create_dir_all(folder.join("2024")).unwrap();
        std::fs::write(folder.join("2024/a.jpg"), b"a").unwrap();
        std::fs::write(folder.join(".DS_Store"), b"x").unwrap();
        let (copy, mut copied) = copy_into(&dest, &folder).unwrap();
        assert_eq!(copy, dest.join("Photos"));
        copied.sort();
        assert_eq!(copied, vec![dest.join("Photos/2024/a.jpg")]);
        assert!(!dest.join("Photos/.DS_Store").exists());
    }

    #[test]
    fn copy_into_a_missing_source_is_an_error() {
        assert!(copy_into(&temp_dir(), &temp_dir().join("gone.txt")).is_err());
    }

    /// Stands in for the Trash: deletes, so tests leave nothing in the real one.
    fn delete(path: &Path) -> Result<(), String> {
        if path.is_dir() { std::fs::remove_dir_all(path) } else { std::fs::remove_file(path) }.map_err(|e| e.to_string())
    }

    #[test]
    fn trash_copies_takes_away_what_was_copied_in() {
        let holding = temp_dir().join("Added Files");
        std::fs::create_dir_all(holding.join("Photos")).unwrap();
        std::fs::write(holding.join("a.txt"), b"a").unwrap();
        let copies = [holding.join("a.txt"), holding.join("Photos"), holding.join("gone.txt")].map(|p| p.to_string_lossy().into_owned());
        trash_copies(&holding, &copies, delete).unwrap();
        assert!(!holding.join("a.txt").exists() && !holding.join("Photos").exists());
    }

    #[test]
    fn trash_copies_refuses_anything_outside_the_holding_folder() {
        let root = temp_dir();
        std::fs::write(root.join("mine.txt"), b"keep").unwrap();
        let outside = [root.join("mine.txt").to_string_lossy().into_owned()];
        assert!(trash_copies(&root.join("Added Files"), &outside, delete).is_err());
        assert!(root.join("mine.txt").exists());
    }
}
