use crate::db::DbPool;
use tauri::State;

#[tauri::command]
pub async fn clear_database(db: State<'_, DbPool>) -> Result<(), String> {
    let mut tx = db.inner().begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM files")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM view_nodes")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM property_values")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM path_mapping_nodes")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM location_views")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM locations")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM views")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM properties")
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    opener::open(&path).map_err(|e| e.to_string())
}

/// The start of `open_paths`' error for a file that's gone; the path follows.
pub const FILE_NOT_FOUND: &str = "file not found: ";
/// The start of `open_paths`' error for a file no app is set to open; the path follows.
pub const NO_APPLICATION: &str = "no application: ";

/// Fails on the first of `paths` that's no longer on disk.
pub fn check_exist(paths: &[String]) -> Result<(), String> {
    match paths.iter().find(|p| !std::path::Path::new(p).exists()) {
        Some(missing) => Err(format!("{FILE_NOT_FOUND}{missing}")),
        None => Ok(()),
    }
}

/// Opens several files at once, as Finder does when opening a multiple selection:
/// one `open` call hands every file to Launch Services together, so files sharing
/// an app arrive in one launch (e.g. several PDFs in one Preview window).
#[tauri::command]
pub async fn open_paths(paths: Vec<String>) -> Result<(), String> {
    check_exist(&paths)?;
    if paths.is_empty() {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        // As Finder does, say so rather than open nothing (the files can still go to an app chosen with Open With)
        if let Some(path) = paths.iter().find(|p| crate::commands::open_with::default_app(p).is_none()) {
            return Err(format!("{NO_APPLICATION}{path}"));
        }
        let status = std::process::Command::new("open")
            .args(&paths)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("open exited with {status}"));
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        for path in &paths {
            opener::open(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn open_paths_with_nothing_selected_is_a_no_op() {
        assert!(open_paths(vec![]).await.is_ok());
    }

    #[tokio::test]
    async fn open_paths_rejects_a_missing_file_before_opening_anything() {
        let err = open_paths(vec!["/definitely/not/here.pdf".to_string()]).await;
        assert_eq!(err.unwrap_err(), "file not found: /definitely/not/here.pdf");
    }
}
