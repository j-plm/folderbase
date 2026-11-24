//! View ▸ as Icons … as Database (Cmd-1 … Cmd-5) and Show Preview / Hide
//! Preview (Shift-Cmd-P), as in Finder's View menu. The items tell the main
//! window (`menu-view-mode` with the mode, `menu-toggle-preview`), which
//! switches; it then reports back what's showing (`set_view_menu_state`) so the
//! checkmarks and the Show / Hide title follow every change, from the toolbar too.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::{App, AppHandle, Emitter, Manager, Wry};

/// The view modes as the frontend names them, in Finder's menu order, with
/// their titles and shortcuts.
const MODES: [(&str, &str, &str); 5] = [
    ("tiles", "as Icons", "CmdOrCtrl+1"),
    ("list", "as List", "CmdOrCtrl+2"),
    ("columns", "as Columns", "CmdOrCtrl+3"),
    ("gallery", "as Gallery", "CmdOrCtrl+4"),
    ("database", "as Database", "CmdOrCtrl+5"),
];

const PREVIEW_ID: &str = "view-preview";

fn mode_id(mode: &str) -> String {
    format!("view-as-{mode}")
}

/// The mode a menu item switches to, if it's one of ours.
fn mode_of(id: &str) -> Option<&'static str> {
    let mode = id.strip_prefix("view-as-")?;
    MODES.iter().map(|(m, _, _)| *m).find(|m| *m == mode)
}

/// The preview item's title, and whether it's enabled: Columns keeps its preview column instead.
fn preview_item(mode: &str, shown: bool) -> (&'static str, bool) {
    (if shown { "Hide Preview" } else { "Show Preview" }, mode != "columns")
}

/// The items, kept so their checkmarks and title can follow the main window.
pub struct ViewMenu {
    modes: Vec<(&'static str, CheckMenuItem<Wry>)>,
    preview: MenuItem<Wry>,
}

/// Adds the view mode items and Show Preview at the top of `menu`'s View submenu.
pub fn install(app: &App, menu: &Menu<Wry>) -> tauri::Result<()> {
    let handle = app.handle();
    let view = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(s) if s.text().ok().as_deref() == Some("View") => Some(s),
        _ => None,
    });
    let Some(view) = view else { return Ok(()) };

    let mut modes = Vec::new();
    for (i, (mode, title, accelerator)) in MODES.iter().enumerate() {
        let item = CheckMenuItem::with_id(handle, mode_id(mode), *title, true, false, Some(*accelerator))?;
        view.insert(&item, i)?;
        modes.push((*mode, item));
    }
    view.insert(&PredefinedMenuItem::separator(handle)?, MODES.len())?;
    let preview = MenuItem::with_id(handle, PREVIEW_ID, "Show Preview", true, Some("CmdOrCtrl+Shift+P"))?;
    view.insert(&preview, MODES.len() + 1)?;
    view.insert(&PredefinedMenuItem::separator(handle)?, MODES.len() + 2)?;
    app.manage(ViewMenu { modes, preview });

    handle.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if id == PREVIEW_ID {
            let _ = app.emit_to("main", "menu-toggle-preview", ());
        } else if let Some(mode) = mode_of(id) {
            // A check item ticks itself when chosen; the main window's report puts the right one back
            let _ = app.emit_to("main", "menu-view-mode", mode);
        }
    });
    Ok(())
}

/// What the main window is showing: its view mode, and whether the Preview pane is shown.
#[tauri::command]
pub fn set_view_menu_state(mode: String, preview: bool, app: AppHandle) -> Result<(), String> {
    let Some(menu) = app.try_state::<ViewMenu>() else { return Ok(()) };
    for (m, item) in &menu.modes {
        item.set_checked(*m == mode).map_err(|e| e.to_string())?;
    }
    let (title, enabled) = preview_item(&mode, preview);
    menu.preview.set_text(title).map_err(|e| e.to_string())?;
    menu.preview.set_enabled(enabled).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_ids_round_trip() {
        for (mode, _, _) in MODES {
            assert_eq!(mode_of(&mode_id(mode)), Some(mode));
        }
        assert_eq!(mode_of("view-as-coverflow"), None);
        assert_eq!(mode_of("appearance-dark"), None);
    }

    #[test]
    fn shortcuts_follow_finder_order() {
        let order: Vec<_> = MODES.iter().map(|(m, _, _)| *m).collect();
        assert_eq!(order, ["tiles", "list", "columns", "gallery", "database"]);
        assert!(MODES.iter().enumerate().all(|(i, (_, _, a))| a.ends_with(&(i + 1).to_string())));
    }

    #[test]
    fn preview_item_says_what_it_will_do() {
        assert_eq!(preview_item("list", false), ("Show Preview", true));
        assert_eq!(preview_item("tiles", true), ("Hide Preview", true));
        assert_eq!(preview_item("columns", false).1, false);
    }
}
