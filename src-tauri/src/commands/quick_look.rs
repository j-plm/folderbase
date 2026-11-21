//! Quick Look: Space previews the selected files in the system's Quick Look
//! panel (`QLPreviewPanel`), as in Finder. Every type the OS can preview works,
//! with the panel's own controls (full screen, open, share, markup).
//!
//! - With several files, the panel's arrow keys step through them
//! - With one file, the arrow keys go back to the view (`quick_look_key`), which
//!   moves its selection and sends the new file (`quick_look_update`), so the
//!   panel follows the selection as Finder's does
//! - Space closes it; the frontend hears `quick_look_closed` however it closes
//!
//! Windows and Linux have no system panel; Folderbase's own preview window comes
//! with Windows parity, and until then these commands say so.

/// Emitted with the arrow key's name ("ArrowDown") when it's pressed in the panel previewing one file.
pub const KEY_EVENT: &str = "quick_look_key";
/// Emitted when the panel closes, however it was closed.
pub const CLOSED_EVENT: &str = "quick_look_closed";

/// What a key pressed in the panel does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PanelKey {
    /// Space: closes the panel, as Space opened it.
    Close,
    /// An arrow, previewing one file: goes back to the view to move its selection.
    ToView(&'static str),
    /// Anything else, and arrows when stepping through several files: the panel's own.
    Panel,
}

/// macOS virtual key codes.
const SPACE: u16 = 49;
const LEFT: u16 = 123;
const RIGHT: u16 = 124;
const DOWN: u16 = 125;
const UP: u16 = 126;

/// Decides what a key down in the panel does. `modified`: ⌘, ⌥ or ⌃ held (those are the panel's).
pub fn route_key(key_code: u16, modified: bool, items: usize) -> PanelKey {
    if modified {
        return PanelKey::Panel;
    }
    let arrow = match key_code {
        SPACE => return PanelKey::Close,
        LEFT => "ArrowLeft",
        RIGHT => "ArrowRight",
        DOWN => "ArrowDown",
        UP => "ArrowUp",
        _ => return PanelKey::Panel,
    };
    if items > 1 {
        PanelKey::Panel
    } else {
        PanelKey::ToView(arrow)
    }
}

/// Where the panel starts among `count` files: `index`, kept inside the list.
pub fn start_index(index: usize, count: usize) -> usize {
    index.min(count.saturating_sub(1))
}

/// Opens the panel on `paths` (absolute), at `index`; closes it instead when it's
/// already showing exactly these files, so Space toggles. True when it's open afterwards.
#[tauri::command]
pub async fn quick_look(window: tauri::WebviewWindow, paths: Vec<String>, index: usize) -> Result<bool, String> {
    if paths.is_empty() {
        return Ok(false);
    }
    on_main(&window, move |app| platform::toggle(app, paths, index))
}

/// Shows `paths` in the panel if it's open (the selection moved). False when it's closed, and nothing opens.
#[tauri::command]
pub async fn quick_look_update(window: tauri::WebviewWindow, paths: Vec<String>, index: usize) -> Result<bool, String> {
    if paths.is_empty() {
        return Ok(false);
    }
    on_main(&window, move |app| platform::update(app, paths, index))
}

/// Closes the panel if it's open.
#[tauri::command]
pub async fn quick_look_close(window: tauri::WebviewWindow) -> Result<(), String> {
    on_main(&window, |_| platform::close())
}

/// Runs `f` on the main thread (AppKit's panels live there) and waits for its result.
fn on_main<T: Send + 'static>(
    window: &tauri::WebviewWindow,
    f: impl FnOnce(tauri::AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    use tauri::Manager;
    let (tx, rx) = std::sync::mpsc::channel();
    let app = window.app_handle().clone();
    window.run_on_main_thread(move || {
        let _ = tx.send(f(app));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "macos"))]
mod platform {
    const UNAVAILABLE: &str = "Preview isn't available on this platform yet";
    pub fn toggle(_: tauri::AppHandle, _: Vec<String>, _: usize) -> Result<bool, String> {
        Err(UNAVAILABLE.into())
    }
    pub fn update(_: tauri::AppHandle, _: Vec<String>, _: usize) -> Result<bool, String> {
        Ok(false)
    }
    pub fn close() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{route_key, start_index, PanelKey, CLOSED_EVENT, KEY_EVENT};
    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType, NSWindowDelegate};
    use objc2_foundation::{NSInteger, NSNotification, NSString, NSURL};
    use objc2_quick_look_ui::{QLPreviewItem, QLPreviewPanel, QLPreviewPanelDataSource, QLPreviewPanelDelegate};
    use std::cell::RefCell;
    use tauri::Emitter;

    pub struct Ivars {
        paths: RefCell<Vec<String>>,
        urls: RefCell<Vec<Retained<NSURL>>>,
        app: tauri::AppHandle,
    }

    define_class!(
        // The panel's data source (the files) and delegate (its keys, its closing)
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "FolderbaseQuickLookSource"]
        #[ivars = Ivars]
        struct Source;

        unsafe impl NSObjectProtocol for Source {}

        unsafe impl QLPreviewPanelDataSource for Source {
            #[unsafe(method(numberOfPreviewItemsInPreviewPanel:))]
            fn count(&self, _panel: Option<&QLPreviewPanel>) -> NSInteger {
                self.ivars().urls.borrow().len() as NSInteger
            }

            #[unsafe(method_id(previewPanel:previewItemAtIndex:))]
            fn item(&self, _panel: Option<&QLPreviewPanel>, index: NSInteger) -> Option<Retained<ProtocolObject<dyn QLPreviewItem>>> {
                let urls = self.ivars().urls.borrow();
                usize::try_from(index)
                    .ok()
                    .and_then(|i| urls.get(i).cloned())
                    .map(ProtocolObject::from_retained)
            }
        }

        unsafe impl NSWindowDelegate for Source {
            #[unsafe(method(windowWillClose:))]
            fn will_close(&self, _notification: &NSNotification) {
                let _ = self.ivars().app.emit(CLOSED_EVENT, ());
            }
        }

        unsafe impl QLPreviewPanelDelegate for Source {
            #[unsafe(method(previewPanel:handleEvent:))]
            fn handle_event(&self, panel: Option<&QLPreviewPanel>, event: Option<&NSEvent>) -> bool {
                self.key_down(panel, event)
            }
        }
    );

    impl Source {
        fn new(mtm: MainThreadMarker, app: tauri::AppHandle) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Ivars { paths: RefCell::default(), urls: RefCell::default(), app });
            unsafe { msg_send![super(this), init] }
        }

        /// The panel's key presses: true when handled here (see `route_key`).
        fn key_down(&self, panel: Option<&QLPreviewPanel>, event: Option<&NSEvent>) -> bool {
            let (Some(panel), Some(event)) = (panel, event) else { return false };
            if event.r#type() != NSEventType::KeyDown {
                return false;
            }
            let modified = event
                .modifierFlags()
                .intersects(NSEventModifierFlags::Command | NSEventModifierFlags::Option | NSEventModifierFlags::Control);
            match route_key(event.keyCode(), modified, self.ivars().urls.borrow().len()) {
                PanelKey::Close => {
                    panel.close();
                    true
                }
                PanelKey::ToView(key) => {
                    let _ = self.ivars().app.emit(KEY_EVENT, key);
                    true
                }
                PanelKey::Panel => false,
            }
        }

        fn set(&self, paths: Vec<String>) {
            *self.ivars().urls.borrow_mut() = paths.iter().map(|p| NSURL::fileURLWithPath(&NSString::from_str(p))).collect();
            *self.ivars().paths.borrow_mut() = paths;
        }
    }

    thread_local! {
        // Made on first use and kept: the panel only holds weak references to its data source
        static SOURCE: RefCell<Option<Retained<Source>>> = const { RefCell::new(None) };
    }

    fn panel(mtm: MainThreadMarker) -> Result<Retained<QLPreviewPanel>, String> {
        unsafe { QLPreviewPanel::sharedPreviewPanel(mtm) }.ok_or_else(|| "Quick Look isn't available".to_string())
    }

    fn source(mtm: MainThreadMarker, app: tauri::AppHandle) -> Retained<Source> {
        SOURCE.with(|s| s.borrow_mut().get_or_insert_with(|| Source::new(mtm, app)).clone())
    }

    /// Points the panel at the files, at `index`. Set each time: without a
    /// controller in the responder chain, the panel can let go of its data source
    /// when the key window changes.
    fn show_files(panel: &QLPreviewPanel, source: &Source, paths: Vec<String>, index: usize) {
        let start = start_index(index, paths.len());
        source.set(paths);
        unsafe {
            panel.setDataSource(Some(ProtocolObject::from_ref(source)));
            panel.setDelegate(Some(source));
            panel.reloadData();
            panel.setCurrentPreviewItemIndex(start as NSInteger);
        }
    }

    pub fn toggle(app: tauri::AppHandle, paths: Vec<String>, index: usize) -> Result<bool, String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let panel = panel(mtm)?;
        let source = source(mtm, app);
        if panel.isVisible() && *source.ivars().paths.borrow() == paths {
            panel.close();
            return Ok(false);
        }
        show_files(&panel, &source, paths, index);
        panel.makeKeyAndOrderFront(None);
        Ok(true)
    }

    pub fn update(app: tauri::AppHandle, paths: Vec<String>, index: usize) -> Result<bool, String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        if !unsafe { QLPreviewPanel::sharedPreviewPanelExists(mtm) } {
            return Ok(false);
        }
        let panel = panel(mtm)?;
        if !panel.isVisible() {
            return Ok(false);
        }
        let source = source(mtm, app);
        if *source.ivars().paths.borrow() != paths {
            show_files(&panel, &source, paths, index);
        }
        Ok(true)
    }

    pub fn close() -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        if unsafe { QLPreviewPanel::sharedPreviewPanelExists(mtm) } {
            let panel = panel(mtm)?;
            if panel.isVisible() {
                panel.close();
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn space_closes_whatever_is_showing() {
        assert_eq!(route_key(SPACE, false, 1), PanelKey::Close);
        assert_eq!(route_key(SPACE, false, 5), PanelKey::Close);
    }

    #[test]
    fn arrows_go_to_the_view_when_previewing_one_file() {
        assert_eq!(route_key(DOWN, false, 1), PanelKey::ToView("ArrowDown"));
        assert_eq!(route_key(LEFT, false, 1), PanelKey::ToView("ArrowLeft"));
    }

    #[test]
    fn arrows_step_through_several_files_in_the_panel() {
        assert_eq!(route_key(RIGHT, false, 3), PanelKey::Panel);
        assert_eq!(route_key(UP, false, 2), PanelKey::Panel);
    }

    #[test]
    fn modified_and_other_keys_are_the_panels() {
        assert_eq!(route_key(SPACE, true, 1), PanelKey::Panel);
        assert_eq!(route_key(DOWN, true, 1), PanelKey::Panel);
        assert_eq!(route_key(53, false, 1), PanelKey::Panel); // Escape
    }

    #[test]
    fn start_index_stays_inside_the_list() {
        assert_eq!(start_index(2, 5), 2);
        assert_eq!(start_index(9, 3), 2);
        assert_eq!(start_index(0, 0), 0);
    }
}
