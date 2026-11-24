//! Finder's Open With and Show in Finder, for files picked in any view.

use std::collections::BTreeMap;

/// An app that can open the files asked about, as Finder's Open With lists it.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct OpenWithApp {
    /// The app bundle's path, handed back to `open_paths_with`.
    pub path: String,
    pub name: String,
    /// The app the files open in on a double-click.
    pub is_default: bool,
}

/// One path per kind of file (by extension): the apps offered depend only on
/// the kind, so a large selection asks the system once per kind.
fn one_per_kind(paths: &[String]) -> Vec<&str> {
    let mut by_kind: BTreeMap<String, &str> = BTreeMap::new();
    for path in paths {
        let ext = std::path::Path::new(path)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        by_kind.entry(ext).or_insert(path);
    }
    by_kind.into_values().collect()
}

/// The apps every kind can open in (the first kind's order kept), the default
/// first when all kinds share it, then the rest by name.
fn common_apps(per_kind: Vec<(Option<String>, Vec<(String, String)>)>) -> Vec<OpenWithApp> {
    let mut kinds = per_kind.into_iter();
    let Some((first_default, first_apps)) = kinds.next() else {
        return Vec::new();
    };
    let mut default = first_default;
    let mut apps = first_apps;
    for (kind_default, kind_apps) in kinds {
        if default != kind_default {
            default = None;
        }
        apps.retain(|(path, _)| kind_apps.iter().any(|(p, _)| p == path));
    }
    let mut seen = std::collections::HashSet::new();
    apps.retain(|(path, _)| seen.insert(path.clone()));
    let mut list: Vec<OpenWithApp> = apps
        .into_iter()
        .map(|(path, name)| OpenWithApp { is_default: default.as_deref() == Some(path.as_str()), path, name })
        .collect();
    list.sort_by(|a, b| b.is_default.cmp(&a.is_default).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    list
}

/// The apps that can open all of `paths`, the default first (see `OpenWithApp`).
#[tauri::command]
pub async fn apps_for_paths(paths: Vec<String>) -> Result<Vec<OpenWithApp>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let per_kind = one_per_kind(&paths).into_iter().map(apps_for_path).collect();
        common_apps(per_kind)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Opens `paths` together in the app at `app`, as choosing it under Open With does.
#[tauri::command]
pub async fn open_paths_with(paths: Vec<String>, app: String) -> Result<(), String> {
    crate::commands::admin::check_exist(&paths)?;
    if paths.is_empty() {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-a")
            .arg(&app)
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
            std::process::Command::new(&app).arg(path).spawn().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// Makes `app` the app `paths` open in, as Get Info's Open With and *Always Open With* do.
/// With `all_of_kind` (Change All…), every file of each one's kind opens in it.
/// Either way it's the system's own setting (Launch Services), so Finder and
/// every other app follow it.
#[tauri::command]
pub async fn set_default_app(paths: Vec<String>, app: String, all_of_kind: bool) -> Result<(), String> {
    crate::commands::admin::check_exist(&paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let targets: Vec<String> = if all_of_kind {
            one_per_kind(&paths).into_iter().map(str::to_string).collect()
        } else {
            paths
        };
        for path in &targets {
            set_default_for(path, &app, all_of_kind)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// macOS 12 and later; asks Launch Services and waits for its answer (it may
/// ask the user to confirm a change for a whole kind first).
#[cfg(target_os = "macos")]
fn set_default_for(path: &str, app: &str, all_of_kind: bool) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSError, NSString, NSURL};
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel::<Option<String>>();
    objc2::rc::autoreleasepool(|_| {
        let file = NSURL::fileURLWithPath(&NSString::from_str(path));
        let app_url = NSURL::fileURLWithPath(&NSString::from_str(app));
        let done = RcBlock::new(move |error: *mut NSError| {
            // SAFETY: Launch Services passes either null or a valid NSError for the call's duration
            let message = unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string());
            let _ = tx.send(message);
        });
        let workspace = NSWorkspace::sharedWorkspace();
        if all_of_kind {
            workspace.setDefaultApplicationAtURL_toOpenContentTypeOfFileAtURL_completionHandler(&app_url, &file, Some(&done));
        } else {
            workspace.setDefaultApplicationAtURL_toOpenFileAtURL_completionHandler(&app_url, &file, Some(&done));
        }
    });
    // A confirmation the system shows for a whole kind waits on the user
    match rx.recv_timeout(std::time::Duration::from_secs(300)) {
        Ok(None) => Ok(()),
        Ok(Some(message)) => Err(message),
        Err(_) => Err("The system didn’t answer.".into()),
    }
}

#[cfg(not(target_os = "macos"))]
fn set_default_for(_path: &str, _app: &str, _all_of_kind: bool) -> Result<(), String> {
    Err("Changing the default app isn’t available on this system yet.".into())
}

/// Shows `paths` selected in the file manager (Finder's Show in Enclosing Folder).
#[tauri::command]
pub async fn reveal_paths(paths: Vec<String>) -> Result<(), String> {
    crate::commands::admin::check_exist(&paths)?;
    if paths.is_empty() {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || reveal(&paths))
        .await
        .map_err(|e| e.to_string())?
}

/// The app `path` opens in on a double-click (macOS; None elsewhere, or when none is set).
#[cfg(target_os = "macos")]
pub fn default_app(path: &str) -> Option<String> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSString, NSURL};

    objc2::rc::autoreleasepool(|_| {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let app = NSWorkspace::sharedWorkspace().URLForApplicationToOpenURL(&url)?;
        app.path().map(|p| p.to_string())
    })
}

#[cfg(not(target_os = "macos"))]
pub fn default_app(_path: &str) -> Option<String> {
    None
}

/// The default app for `path`, and every app that can open it as (path, name).
#[cfg(target_os = "macos")]
fn apps_for_path(path: &str) -> (Option<String>, Vec<(String, String)>) {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    let apps = objc2::rc::autoreleasepool(|_| {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let files = NSFileManager::defaultManager();
        NSWorkspace::sharedWorkspace()
            .URLsForApplicationsToOpenURL(&url)
            .to_vec()
            .into_iter()
            .filter_map(|app| app.path())
            .map(|app| {
                let name = files.displayNameAtPath(&app).to_string();
                let name = name.strip_suffix(".app").map(str::to_string).unwrap_or(name);
                (app.to_string(), name)
            })
            .collect()
    });
    (default_app(path), apps)
}

#[cfg(not(target_os = "macos"))]
fn apps_for_path(_path: &str) -> (Option<String>, Vec<(String, String)>) {
    (None, Vec::new())
}

#[cfg(target_os = "macos")]
fn reveal(paths: &[String]) -> Result<(), String> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSArray, NSString, NSURL};

    objc2::rc::autoreleasepool(|_| {
        let urls: Vec<_> = paths.iter().map(|p| NSURL::fileURLWithPath(&NSString::from_str(p))).collect();
        NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&NSArray::from_retained_slice(&urls));
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn reveal(paths: &[String]) -> Result<(), String> {
    // The folder holding the first file; Explorer and file managers have no common way to select several
    let parent = std::path::Path::new(&paths[0]).parent().ok_or("no enclosing folder")?;
    opener::open(parent).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(path: &str) -> (String, String) {
        let name = path.trim_start_matches("/Applications/").trim_end_matches(".app");
        (path.to_string(), name.to_string())
    }

    #[test]
    fn one_path_is_asked_about_per_extension() {
        let paths = ["/a/1.TIF", "/a/2.tif", "/b/3.dxf", "/c/README"].map(String::from);
        assert_eq!(one_per_kind(&paths), vec!["/c/README", "/b/3.dxf", "/a/1.TIF"]);
    }

    #[test]
    fn the_default_comes_first_then_the_rest_by_name() {
        let apps = common_apps(vec![(
            Some("/Applications/Preview.app".into()),
            vec![app("/Applications/Safari.app"), app("/Applications/Preview.app"), app("/Applications/Affinity.app")],
        )]);
        let names: Vec<_> = apps.iter().map(|a| (a.name.as_str(), a.is_default)).collect();
        assert_eq!(names, vec![("Preview", true), ("Affinity", false), ("Safari", false)]);
    }

    #[test]
    fn several_kinds_share_only_the_apps_all_can_open_in() {
        let apps = common_apps(vec![
            (Some("/Applications/Preview.app".into()), vec![app("/Applications/Preview.app"), app("/Applications/Safari.app")]),
            (Some("/Applications/LibreCAD.app".into()), vec![app("/Applications/LibreCAD.app"), app("/Applications/Safari.app")]),
        ]);
        assert_eq!(apps, vec![OpenWithApp { path: "/Applications/Safari.app".into(), name: "Safari".into(), is_default: false }]);
    }

    #[test]
    fn nothing_asked_about_offers_nothing() {
        assert!(common_apps(vec![]).is_empty());
    }

    #[tokio::test]
    async fn setting_the_default_for_a_missing_file_is_an_error() {
        let err = set_default_app(vec!["/definitely/not/here.dxf".into()], "/Applications/Preview.app".into(), false)
            .await
            .unwrap_err();
        assert_eq!(err, "file not found: /definitely/not/here.dxf");
    }

    #[tokio::test]
    async fn setting_the_default_for_nothing_does_nothing() {
        assert!(set_default_app(vec![], "/Applications/Preview.app".into(), true).await.is_ok());
    }

    #[tokio::test]
    async fn revealing_a_missing_file_is_an_error() {
        let err = reveal_paths(vec!["/definitely/not/here.dxf".into()]).await.unwrap_err();
        assert_eq!(err, "file not found: /definitely/not/here.dxf");
    }
}
