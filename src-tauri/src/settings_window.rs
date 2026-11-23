//! The Settings window (Folderbase ▸ Settings…, ⌘,; Ctrl+, elsewhere): a window
//! of its own, as native apps' settings are, running the same frontend as the
//! main window (it renders the Settings panes when its label is `settings`).
//! There's only ever one: opening it again brings it forward on the pane asked.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "settings";
/// Sent to the Settings window to show a pane ("general", "locations", …).
pub const PANE_EVENT: &str = "settings-pane";

/// The pane asked for while the window was opening, for its page to pick up
/// once loaded (`settings_initial_pane`), as an event could arrive before it listens.
#[derive(Default)]
pub struct PendingPane(Mutex<Option<String>>);

/// Panes as the frontend names them; anything else opens on the last pane shown.
const PANES: [&str; 5] = ["general", "locations", "new-views", "files", "advanced"];

fn known(pane: Option<String>) -> Option<String> {
    pane.filter(|p| PANES.contains(&p.as_str()))
}

pub fn open(app: &AppHandle, pane: Option<String>) -> Result<(), String> {
    let pane = known(pane);
    if let Some(window) = app.get_webview_window(LABEL) {
        if let Some(p) = &pane {
            let _ = app.emit_to(LABEL, PANE_EVENT, p);
        }
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    if let Some(pending) = app.try_state::<PendingPane>() {
        *pending.0.lock().unwrap() = pane;
    }
    // Sized by the page to fit each pane (`setSize`), as macOS settings windows are
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Settings")
        .inner_size(660.0, 420.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .theme(crate::appearance::current(app).theme())
        .center();
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(20.0, 22.0));
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_settings(pane: Option<String>, app: AppHandle) -> Result<(), String> {
    open(&app, pane)
}

/// The pane the window was opened on (once; null afterwards).
#[tauri::command]
pub fn settings_initial_pane(pending: tauri::State<'_, PendingPane>) -> Option<String> {
    pending.0.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_panes_are_opened() {
        assert_eq!(known(Some("files".into())).as_deref(), Some("files"));
        assert_eq!(known(Some("duplicates".into())), None);
        assert_eq!(known(None), None);
    }
}
