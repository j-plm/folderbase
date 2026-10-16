//! Edit ▸ Undo and Redo. The default items send AppKit's `undo:` to the focused
//! view, which only reaches text fields; these items instead tell the frontend,
//! which undoes typing in a focused field or else the app's own change history.
//! The frontend names the change ("Undo Paste") via `set_edit_menu_labels`.

use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{App, Emitter, Manager, Wry};

pub const UNDO_ID: &str = "edit-undo";
pub const REDO_ID: &str = "edit-redo";

/// The Undo and Redo items, kept so their titles can change.
pub struct EditMenu {
    pub undo: MenuItem<Wry>,
    pub redo: MenuItem<Wry>,
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
    let edit = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(s) if s.text().ok().as_deref() == Some("Edit") => Some(s),
        _ => None,
    });
    let Some(edit) = edit else { return Ok(()) };

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
    app.manage(EditMenu { undo, redo });

    handle.on_menu_event(|app, event| {
        let name = match event.id().as_ref() {
            UNDO_ID => "menu-undo",
            REDO_ID => "menu-redo",
            _ => return,
        };
        let _ = app.emit(name, ());
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
