use crate::edit_menu::{titles, EditMenu};
use tauri::{AppHandle, Manager};

/// Names the changes Edit ▸ Undo and Redo would act on, e.g. "Undo Paste";
/// `None` leaves the plain "Undo" / "Redo".
#[tauri::command]
pub async fn set_edit_menu_labels(
    undo: Option<String>,
    redo: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    // No custom Edit menu (e.g. it wasn't found): nothing to label
    let Some(menu) = app.try_state::<EditMenu>() else { return Ok(()) };
    let (undo_title, redo_title) = titles(undo.as_deref(), redo.as_deref());
    menu.undo.set_text(undo_title).map_err(|e| e.to_string())?;
    menu.redo.set_text(redo_title).map_err(|e| e.to_string())?;
    Ok(())
}
