//! Quick Look: Space previews the selected files in the system's Quick Look
//! panel (`QLPreviewPanel`), as in Finder. Every type the OS can preview works,
//! with the panel's own controls (full screen, open, share, markup).
//!
//! - With several files, the panel's arrow keys step through them
//! - With one file, the arrow keys go back to the view (`quick_look_key`), which
//!   moves its selection and sends the new file (`quick_look_update`), so the
//!   panel follows the selection as Finder's does
//! - Space closes it; the frontend hears `quick_look_closed` however it closes
//! - It zooms out of the file's icon and back into it, as Finder's does: the
//!   frontend sends where each file's icon is on the page (`frames`), turned
//!   into screen positions when the panel asks
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

/// Where a file's icon is on the page (CSS pixels from the webview's top left),
/// for the panel to zoom out of; None when it isn't showing.
pub type IconFrame = Option<crate::commands::preview_view::PreviewRect>;

/// What the panel shows: the files, where it starts, and where their icons are.
pub struct Showing {
    pub paths: Vec<String>,
    pub index: usize,
    /// One per path (missing ones count as not showing).
    pub frames: Vec<IconFrame>,
}

/// Opens the panel on `paths` (absolute), at `index`; closes it instead when it's
/// already showing exactly these files, so Space toggles. True when it's open afterwards.
/// `frames`: where each file's icon is on the page, to zoom from.
#[tauri::command]
pub async fn quick_look(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
    index: usize,
    frames: Option<Vec<IconFrame>>,
) -> Result<bool, String> {
    if paths.is_empty() {
        return Ok(false);
    }
    let showing = Showing { paths, index, frames: frames.unwrap_or_default() };
    on_main(&window, move |app, webview| platform::toggle(app, webview, showing))
}

/// Shows `paths` in the panel if it's open (the selection moved). False when it's closed, and nothing opens.
#[tauri::command]
pub async fn quick_look_update(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
    index: usize,
    frames: Option<Vec<IconFrame>>,
) -> Result<bool, String> {
    if paths.is_empty() {
        return Ok(false);
    }
    let showing = Showing { paths, index, frames: frames.unwrap_or_default() };
    on_main(&window, move |app, webview| platform::update(app, webview, showing))
}

/// Closes the panel if it's open.
#[tauri::command]
pub async fn quick_look_close(window: tauri::WebviewWindow) -> Result<(), String> {
    on_main(&window, |_, _| platform::close())
}

/// Runs `f` on the main thread (AppKit's panels live there) with the window's
/// webview (macOS: its WKWebView; elsewhere null), and waits for its result.
fn on_main<T: Send + 'static>(
    window: &tauri::WebviewWindow,
    f: impl FnOnce(tauri::AppHandle, *mut std::ffi::c_void) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    use tauri::Manager;
    let (tx, rx) = std::sync::mpsc::channel();
    let app = window.app_handle().clone();
    #[cfg(target_os = "macos")]
    window
        .with_webview(move |webview| {
            let _ = tx.send(f(app, webview.inner()));
        })
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    window
        .run_on_main_thread(move || {
            let _ = tx.send(f(app, std::ptr::null_mut()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

/// The frame of the icon of item `index`, for the zoom: None when it isn't showing.
pub fn frame_for(frames: &[IconFrame], index: usize) -> IconFrame {
    frames.get(index).copied().flatten().filter(|r| r.width > 0.0 && r.height > 0.0)
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::Showing;
    const UNAVAILABLE: &str = "Preview isn't available on this platform yet";
    pub fn toggle(_: tauri::AppHandle, _: *mut std::ffi::c_void, _: Showing) -> Result<bool, String> {
        Err(UNAVAILABLE.into())
    }
    pub fn update(_: tauri::AppHandle, _: *mut std::ffi::c_void, _: Showing) -> Result<bool, String> {
        Ok(false)
    }
    pub fn close() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{frame_for, route_key, start_index, IconFrame, PanelKey, Showing, CLOSED_EVENT, KEY_EVENT};
    use crate::commands::preview_view::view_frame;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly, Message};
    use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType, NSView, NSWindowDelegate, NSWorkspace};
    use objc2_foundation::{NSInteger, NSNotification, NSPoint, NSRect, NSSize, NSString, NSURL};
    use objc2_quick_look_ui::{QLPreviewItem, QLPreviewPanel, QLPreviewPanelDataSource, QLPreviewPanelDelegate};
    use std::cell::RefCell;
    use tauri::Emitter;

    pub struct Ivars {
        paths: RefCell<Vec<String>>,
        urls: RefCell<Vec<Retained<NSURL>>>,
        /// Where each file's icon is on the page, and the page's view, for the zoom.
        frames: RefCell<Vec<IconFrame>>,
        webview: RefCell<Option<Retained<NSView>>>,
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

            // Where the panel zooms out of as it opens, and back into as it closes
            #[unsafe(method(previewPanel:sourceFrameOnScreenForPreviewItem:))]
            fn source_frame(&self, _panel: Option<&QLPreviewPanel>, item: Option<&ProtocolObject<dyn QLPreviewItem>>) -> NSRect {
                self.index_of(item).and_then(|i| self.screen_frame(i)).unwrap_or(NSRect::ZERO)
            }

            // What it zooms: the file's icon, as Finder's does
            #[unsafe(method_id(previewPanel:transitionImageForPreviewItem:contentRect:))]
            fn transition_image(
                &self,
                _panel: Option<&QLPreviewPanel>,
                item: Option<&ProtocolObject<dyn QLPreviewItem>>,
                _content_rect: *mut NSRect,
            ) -> Option<Retained<AnyObject>> {
                self.icon(item)
            }
        }
    );

    impl Source {
        fn new(mtm: MainThreadMarker, app: tauri::AppHandle) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Ivars {
                paths: RefCell::default(),
                urls: RefCell::default(),
                frames: RefCell::default(),
                webview: RefCell::default(),
                app,
            });
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

        /// The file's icon (by its type: nothing is read, so a cloud file isn't downloaded).
        fn icon(&self, item: Option<&ProtocolObject<dyn QLPreviewItem>>) -> Option<Retained<AnyObject>> {
            let i = self.index_of(item)?;
            let path = self.ivars().paths.borrow().get(i)?.clone();
            let icon = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(&path));
            Some(Retained::into_super(Retained::into_super(icon)))
        }

        /// Which of the files `item` is (the panel hands back the URLs it was given).
        fn index_of(&self, item: Option<&ProtocolObject<dyn QLPreviewItem>>) -> Option<usize> {
            let item = item? as *const ProtocolObject<dyn QLPreviewItem> as *const NSURL;
            self.ivars().urls.borrow().iter().position(|url| std::ptr::eq(Retained::as_ptr(url), item))
        }

        /// The icon of file `index` on screen (AppKit's screen coordinates), or None
        /// when it isn't showing, so the panel fades instead.
        fn screen_frame(&self, index: usize) -> Option<NSRect> {
            let rect = frame_for(&self.ivars().frames.borrow(), index)?;
            let webview = self.ivars().webview.borrow().clone()?;
            let window = webview.window()?;
            let (x, y, w, h) = view_frame(rect, webview.bounds().size.height, webview.isFlipped());
            let in_window = webview.convertRect_toView(NSRect::new(NSPoint::new(x, y), NSSize::new(w, h)), None);
            Some(window.convertRectToScreen(in_window))
        }

        /// Keeps where the icons are on the page, for the zoom.
        fn set_frames(&self, webview: *mut std::ffi::c_void, frames: Vec<IconFrame>) {
            *self.ivars().frames.borrow_mut() = frames;
            if !webview.is_null() {
                // SAFETY: Tauri hands back its WKWebView, an NSView, on the main thread
                let view: &NSView = unsafe { &*(webview as *const NSView) };
                *self.ivars().webview.borrow_mut() = Some(view.retain());
            }
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

    pub fn toggle(app: tauri::AppHandle, webview: *mut std::ffi::c_void, showing: Showing) -> Result<bool, String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let panel = panel(mtm)?;
        let source = source(mtm, app);
        // Taken before closing too, so it shrinks back into where the icon is now
        source.set_frames(webview, showing.frames);
        if panel.isVisible() && *source.ivars().paths.borrow() == showing.paths {
            panel.close();
            return Ok(false);
        }
        show_files(&panel, &source, showing.paths, showing.index);
        panel.makeKeyAndOrderFront(None);
        Ok(true)
    }

    pub fn update(app: tauri::AppHandle, webview: *mut std::ffi::c_void, showing: Showing) -> Result<bool, String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        if !unsafe { QLPreviewPanel::sharedPreviewPanelExists(mtm) } {
            return Ok(false);
        }
        let panel = panel(mtm)?;
        if !panel.isVisible() {
            return Ok(false);
        }
        let source = source(mtm, app);
        source.set_frames(webview, showing.frames);
        if *source.ivars().paths.borrow() != showing.paths {
            show_files(&panel, &source, showing.paths, showing.index);
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
    fn zooms_only_from_icons_that_are_showing() {
        use crate::commands::preview_view::PreviewRect;
        let icon = PreviewRect { x: 10.0, y: 20.0, width: 16.0, height: 16.0 };
        let collapsed = PreviewRect { width: 0.0, ..icon };
        let frames = [Some(icon), None, Some(collapsed)];
        assert_eq!(frame_for(&frames, 0), Some(icon));
        assert_eq!(frame_for(&frames, 1), None); // scrolled away
        assert_eq!(frame_for(&frames, 2), None); // no size
        assert_eq!(frame_for(&frames, 7), None); // not sent
    }

    #[test]
    fn start_index_stays_inside_the_list() {
        assert_eq!(start_index(2, 5), 2);
        assert_eq!(start_index(9, 3), 2);
        assert_eq!(start_index(0, 0), 0);
    }
}
