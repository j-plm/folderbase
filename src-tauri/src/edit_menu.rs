//! Edit ▸ Undo and Redo. The default items send AppKit's `undo:` to the focused
//! view, which only reaches text fields; these items instead tell the frontend,
//! which undoes typing in a focused field or else the app's own change history.
//! The frontend names the change ("Undo Paste") via `set_edit_menu_labels`.
//! Also File ▸ Save View (Cmd-S), enabled by the frontend while a view has
//! unsaved edits (`set_save_view_enabled`), File ▸ Back Up Database… and
//! Restore from Backup… (`commands/backup.rs`; the window in front runs them,
//! so their panels open over it), and Folderbase ▸ Settings… (Cmd-,),
//! which opens the Settings window (`settings_window`), and File ▸ Get Info
//! (Cmd-I) and Show Inspector (Opt-Cmd-I) (`info_window`).

use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::{App, Emitter, Manager, Wry};

pub const UNDO_ID: &str = "edit-undo";
pub const REDO_ID: &str = "edit-redo";
pub const SAVE_VIEW_ID: &str = "file-save-view";
pub const SETTINGS_ID: &str = "app-settings";
pub const BACK_UP_ID: &str = "file-back-up";
pub const RESTORE_ID: &str = "file-restore";
pub const GET_INFO_ID: &str = "file-get-info";
pub const INSPECTOR_ID: &str = "file-inspector";

/// The Undo and Redo items, kept so their titles can change.
pub struct EditMenu {
    pub undo: MenuItem<Wry>,
    pub redo: MenuItem<Wry>,
    /// File ▸ Save View, when the menu has a File submenu.
    pub save_view: Option<MenuItem<Wry>>,
}

/// Menu titles for a change name: "Undo" alone when there's nothing named.
pub fn titles(undo: Option<&str>, redo: Option<&str>) -> (String, String) {
    let title = |verb: &str, label: Option<&str>| match label {
        Some(l) if !l.is_empty() => format!("{verb} {l}"),
        _ => verb.to_string(),
    };
    (title("Undo", undo), title("Redo", redo))
}

/// Swaps the default Undo / Redo in `menu`'s Edit submenu for app-handled ones.
pub fn install(app: &App, menu: &Menu<Wry>) -> tauri::Result<()> {
    let handle = app.handle();
    let submenu = |title: &str| -> tauri::Result<_> {
        Ok(menu.items()?.into_iter().find_map(|item| match item {
            MenuItemKind::Submenu(s) if s.text().ok().as_deref() == Some(title) => Some(s),
            _ => None,
        }))
    };
    let Some(edit) = submenu("Edit")? else { return Ok(()) };

    for item in edit.items()? {
        if let MenuItemKind::Predefined(p) = &item {
            if matches!(p.text().ok().as_deref(), Some("Undo") | Some("Redo")) {
                edit.remove(&item)?;
            }
        }
    }
    let undo = MenuItem::with_id(handle, UNDO_ID, "Undo", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(handle, REDO_ID, "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;
    edit.insert(&undo, 0)?;
    edit.insert(&redo, 1)?;
    // Disabled until a view has edits to save
    let save_view = match submenu("File")? {
        Some(file) => {
            let item = MenuItem::with_id(handle, SAVE_VIEW_ID, "Save View", false, Some("CmdOrCtrl+S"))?;
            file.insert(&item, 0)?;
            let back_up = MenuItem::with_id(handle, BACK_UP_ID, "Back Up Database…", true, None::<&str>)?;
            let restore = MenuItem::with_id(handle, RESTORE_ID, "Restore from Backup…", true, None::<&str>)?;
            file.insert(&PredefinedMenuItem::separator(handle)?, 1)?;
            file.insert(&back_up, 2)?;
            file.insert(&restore, 3)?;
            file.insert(&PredefinedMenuItem::separator(handle)?, 4)?;
            // Get Info (the selection, which the main window knows) and Show Inspector, as in Finder's File menu
            let get_info = MenuItem::with_id(handle, GET_INFO_ID, "Get Info", true, Some("CmdOrCtrl+I"))?;
            let inspector = MenuItem::with_id(handle, INSPECTOR_ID, "Show Inspector", true, Some("CmdOrCtrl+Alt+I"))?;
            file.insert(&get_info, 5)?;
            file.insert(&inspector, 6)?;
            file.insert(&PredefinedMenuItem::separator(handle)?, 7)?;
            Some(item)
        }
        None => None,
    };
    // Settings… under About in the app menu (the first one), as every Mac app has it
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let settings = MenuItem::with_id(handle, SETTINGS_ID, "Settings…", true, Some("CmdOrCtrl+,"))?;
        let at = app_menu.items()?.len().min(2);
        app_menu.insert(&settings, at)?;
    }
    app.manage(EditMenu { undo, redo, save_view });

    handle.on_menu_event(|app, event| {
        let name = match event.id().as_ref() {
            UNDO_ID => "menu-undo",
            REDO_ID => "menu-redo",
            SAVE_VIEW_ID => "menu-save-view",
            BACK_UP_ID => "menu-back-up",
            RESTORE_ID => "menu-restore",
            GET_INFO_ID => {
                // Whichever window is in front, Get Info is about the main window's selection
                let _ = app.emit_to("main", "menu-get-info", ());
                return;
            }
            INSPECTOR_ID => {
                if let Err(e) = crate::info_window::toggle_inspector(app) {
                    eprintln!("couldn't open the Inspector: {e}");
                }
                return;
            }
            SETTINGS_ID => {
                if let Err(e) = crate::settings_window::open(app, None) {
                    eprintln!("couldn't open Settings: {e}");
                }
                return;
            }
            _ => return,
        };
        // To the window in front only: Undo while typing in Settings mustn't undo a change in the main window
        let focused = app.webview_windows().into_iter().find(|(_, w)| w.is_focused().unwrap_or(false));
        let label = focused.map(|(label, _)| label).unwrap_or_else(|| "main".into());
        let _ = app.emit_to(label.as_str(), name, ());
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_name_the_change() {
        assert_eq!(titles(Some("Paste"), None), ("Undo Paste".into(), "Redo".into()));
        assert_eq!(titles(Some(""), Some("Fill")), ("Undo".into(), "Redo Fill".into()));
    }
}
