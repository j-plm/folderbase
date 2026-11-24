//! Get Info (⌘I) and the Inspector (⌥⌘I): small floating windows of their own,
//! as Finder's are, running the same frontend as the main window (it renders
//! the Info page when the window's label starts with `info-` or is `inspector`).
//!
//! An Info window stays on its file: one per file, keyed by the file's path, so
//! asking again for a file already shown brings its window forward. The
//! Inspector is a single window following the main window's selection; asking
//! for it again closes it, as Finder's Show/Hide Inspector does.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const INSPECTOR: &str = "inspector";
const INFO_PREFIX: &str = "info-";
/// Finder asks before opening this many Info windows at once.
pub const ASK_ABOVE: usize = 10;

/// Which file each open Info window shows (label → path), and the next label's number.
#[derive(Default)]
pub struct InfoWindows(Mutex<(HashMap<String, String>, u64)>);

impl InfoWindows {
    fn label_for(&self, path: &str) -> Option<String> {
        let map = self.0.lock().unwrap();
        map.0.iter().find(|(_, p)| p.as_str() == path).map(|(l, _)| l.clone())
    }

    fn insert(&self, path: &str) -> String {
        let mut map = self.0.lock().unwrap();
        map.1 += 1;
        let label = format!("{INFO_PREFIX}{}", map.1);
        map.0.insert(label.clone(), path.to_string());
        label
    }

    pub fn path_of(&self, label: &str) -> Option<String> {
        self.0.lock().unwrap().0.get(label).cloned()
    }

    pub fn forget(&self, label: &str) {
        self.0.lock().unwrap().0.remove(label);
    }
}

/// Whether a window label is one of these windows (an Info window or the Inspector).
pub fn is_info_label(label: &str) -> bool {
    label == INSPECTOR || label.starts_with(INFO_PREFIX)
}

/// Where a new Info window goes: cascaded down and right from the last, as Finder does.
fn cascade(index: usize) -> (f64, f64) {
    let step = 22.0 * (index % 12) as f64;
    (80.0 + step, 80.0 + step)
}

fn build(app: &AppHandle, label: &str, title: &str, position: (f64, f64)) -> Result<(), String> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(280.0, 560.0)
        .min_inner_size(260.0, 240.0)
        .max_inner_size(420.0, 4000.0)
        .maximizable(false)
        .minimizable(true)
        .position(position.0, position.1)
        .theme(crate::appearance::current(app).theme());
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// Opens an Info window for each of `paths` (or brings forward the one already showing it).
pub fn open_info(app: &AppHandle, paths: &[String]) -> Result<(), String> {
    let state = app.state::<InfoWindows>();
    let open_now = app.webview_windows().keys().filter(|l| l.starts_with(INFO_PREFIX)).count();
    for (i, path) in paths.iter().enumerate() {
        if let Some(window) = state.label_for(path).and_then(|l| app.get_webview_window(&l)) {
            let _ = window.unminimize();
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            continue;
        }
        let label = state.insert(path);
        let title = format!("{} Info", file_name(path));
        if let Err(e) = build(app, &label, &title, cascade(open_now + i)) {
            state.forget(&label);
            return Err(e);
        }
    }
    Ok(())
}

/// Shows the Inspector, or closes it when it's already open.
pub fn toggle_inspector(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(INSPECTOR) {
        return window.close().map_err(|e| e.to_string());
    }
    build(app, INSPECTOR, "Inspector", (120.0, 120.0))
}

#[tauri::command]
pub fn open_info_windows(paths: Vec<String>, app: AppHandle) -> Result<(), String> {
    open_info(&app, &paths)
}

#[tauri::command]
pub fn toggle_inspector_window(app: AppHandle) -> Result<(), String> {
    toggle_inspector(&app)
}

/// The file an Info window shows (null for the Inspector, which is told the selection).
#[tauri::command]
pub fn info_window_path(window: tauri::WebviewWindow, state: tauri::State<'_, InfoWindows>) -> Option<String> {
    state.path_of(window.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_file_gets_its_own_label_and_is_found_again() {
        let windows = InfoWindows::default();
        let a = windows.insert("/x/a.pdf");
        let b = windows.insert("/x/b.pdf");
        assert_ne!(a, b);
        assert_eq!(windows.label_for("/x/a.pdf").as_deref(), Some(a.as_str()));
        assert_eq!(windows.path_of(&b).as_deref(), Some("/x/b.pdf"));
        windows.forget(&a);
        assert_eq!(windows.label_for("/x/a.pdf"), None);
    }

    #[test]
    fn info_labels_are_recognised() {
        assert!(is_info_label("inspector"));
        assert!(is_info_label("info-3"));
        assert!(!is_info_label("main"));
        assert!(!is_info_label("settings"));
    }

    #[test]
    fn windows_cascade_and_wrap() {
        assert_eq!(cascade(0), (80.0, 80.0));
        assert_eq!(cascade(1), (102.0, 102.0));
        assert_eq!(cascade(12), cascade(0));
    }

    #[test]
    fn titles_use_the_file_name() {
        assert_eq!(file_name("/Users/me/Report.pdf"), "Report.pdf");
        assert_eq!(file_name("C:\\a\\b.txt"), "b.txt");
    }
}
