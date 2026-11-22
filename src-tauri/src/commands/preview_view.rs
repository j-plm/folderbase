//! The live preview in Columns' preview column (and later the Preview pane and
//! Gallery): the system's Quick Look view (`QLPreviewView`) laid over the page,
//! as Finder's, so a PDF scrolls through its pages, video plays and documents
//! page. The frontend keeps a placeholder where it goes and reports its place;
//! a native view always draws above the page, so the frontend hides it while
//! something covers the placeholder.
//!
//! One view, reused: showing another file swaps its item, a new place moves it.
//!
//! Show and hide are separate async commands, and Tauri doesn't keep them in
//! order on their way to the main thread. Each carries a `Ticket` (the page's
//! session and a count that only rises), and anything older than what's been
//! applied is ignored, so a show sent just before a hide can't bring the view
//! back after it. A new page (a reload) starts a new session, whose first hide
//! takes away a view the old page left behind.

use serde::Deserialize;
use std::sync::Mutex;

/// Which page sent a show or hide, and in what order.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Ticket {
    pub session: String,
    pub seq: u64,
}

/// The latest ticket applied, and the pages before it.
#[derive(Debug, Default)]
pub struct Gate {
    last: Option<Ticket>,
    /// Sessions a reload replaced: their late commands are dropped.
    retired: Vec<String>,
}

/// How many replaced sessions are remembered (a few reloads' worth is plenty).
const RETIRED_KEPT: usize = 16;

impl Gate {
    /// Whether to apply a command with `ticket`: a later one from the same page,
    /// or the first from a new page. Older ones arrived late and are dropped, as
    /// is anything from a page that's been replaced.
    pub fn accept(&mut self, ticket: &Ticket) -> bool {
        if self.retired.contains(&ticket.session) {
            return false;
        }
        match &self.last {
            Some(last) if last.session == ticket.session && ticket.seq <= last.seq => return false,
            Some(last) if last.session != ticket.session => {
                self.retired.push(last.session.clone());
                if self.retired.len() > RETIRED_KEPT {
                    self.retired.remove(0);
                }
            }
            _ => {}
        }
        self.last = Some(ticket.clone());
        true
    }
}

static GATE: Mutex<Gate> = Mutex::new(Gate { last: None, retired: Vec::new() });

/// Checked on the main thread, where the commands take effect in turn.
fn accept(ticket: &Ticket) -> bool {
    GATE.lock().map(|mut gate| gate.accept(ticket)).unwrap_or(true)
}

/// Where the preview goes, in CSS pixels from the webview's top left (the same as
/// points while the page isn't zoomed).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct PreviewRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The view's frame inside the webview: (x, y, width, height). AppKit views that
/// aren't flipped count y up from the bottom, so the rect turns over in `height`.
pub fn view_frame(rect: PreviewRect, webview_height: f64, flipped: bool) -> (f64, f64, f64, f64) {
    let width = rect.width.max(0.0);
    let height = rect.height.max(0.0);
    let y = if flipped { rect.y } else { webview_height - rect.y - height };
    (rect.x, y, width, height)
}

/// Shows `path` live in `rect`, or moves the preview there if it's showing `path` already.
#[tauri::command]
pub async fn preview_view_show(
    window: tauri::WebviewWindow,
    path: String,
    rect: PreviewRect,
    ticket: Ticket,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        window
            .with_webview(move |webview| {
                if accept(&ticket) {
                    macos::show(webview.inner(), &path, rect)
                }
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, path, rect, accept(&ticket));
        Err("The live preview isn't available on this platform yet".into())
    }
}

/// Takes the preview away (the column closed, or something covers it).
#[tauri::command]
pub async fn preview_view_hide(window: tauri::WebviewWindow, ticket: Ticket) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        window
            .with_webview(move |_| {
                if accept(&ticket) {
                    macos::hide()
                }
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, accept(&ticket));
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{view_frame, PreviewRect};
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::NSView;
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSURL};
    use objc2_quick_look_ui::{QLPreviewView, QLPreviewViewStyle};
    use std::cell::RefCell;
    use std::ffi::c_void;

    struct Live {
        view: Retained<QLPreviewView>,
        path: String,
    }

    thread_local! {
        static LIVE: RefCell<Option<Live>> = const { RefCell::new(None) };
    }

    /// `webview`: the window's WKWebView, from Tauri (alive while the window is).
    pub fn show(webview: *mut c_void, path: &str, rect: PreviewRect) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        if webview.is_null() {
            return;
        }
        // SAFETY: Tauri hands back its WKWebView, an NSView, on the main thread
        let webview: &NSView = unsafe { &*(webview as *const NSView) };
        let (x, y, w, h) = view_frame(rect, webview.bounds().size.height, webview.isFlipped());
        let frame = NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));

        LIVE.with(|live| {
            let mut live = live.borrow_mut();
            if live.is_none() {
                // Compact, as Finder's preview column: a page with arrows over it,
                // not the full Quick Look preview Space opens
                let Some(view) = (unsafe { QLPreviewView::initWithFrame_style(QLPreviewView::alloc(mtm), frame, QLPreviewViewStyle::Compact) }) else {
                    return;
                };
                // Finder doesn't start video or audio until it's played
                unsafe { view.setAutostarts(false) };
                *live = Some(Live { view, path: String::new() });
            }
            let Some(live) = live.as_mut() else { return };
            if unsafe { live.view.superview() }.as_deref() != Some(webview) {
                webview.addSubview(&live.view);
            }
            live.view.setFrame(frame);
            live.view.setHidden(false);
            if live.path != path {
                let url = NSURL::fileURLWithPath(&NSString::from_str(path));
                unsafe { live.view.setPreviewItem(Some(ProtocolObject::from_ref(&*url))) };
                live.path = path.to_string();
            }
        });
    }

    pub fn hide() {
        LIVE.with(|live| {
            if let Some(live) = live.borrow_mut().take() {
                // Let go of the file (a video stops), then the view
                unsafe {
                    live.view.setPreviewItem(None);
                    live.view.close();
                }
                live.view.removeFromSuperview();
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RECT: PreviewRect = PreviewRect { x: 600.0, y: 100.0, width: 300.0, height: 200.0 };

    fn ticket(session: &str, seq: u64) -> Ticket {
        Ticket { session: session.into(), seq }
    }

    #[test]
    fn a_show_arriving_after_a_later_hide_is_dropped() {
        let mut gate = Gate::default();
        // Sent show #1 then hide #2, but the hide reached the main thread first
        assert!(gate.accept(&ticket("page", 2)));
        assert!(!gate.accept(&ticket("page", 1)));
    }

    #[test]
    fn commands_in_order_all_apply() {
        let mut gate = Gate::default();
        assert!(gate.accept(&ticket("page", 1)));
        assert!(gate.accept(&ticket("page", 2)));
        assert!(!gate.accept(&ticket("page", 2)));
    }

    #[test]
    fn a_reloaded_page_starts_again_from_its_own_count() {
        let mut gate = Gate::default();
        assert!(gate.accept(&ticket("old", 40)));
        // The new page counts from 1; its first hide clears what the old page left
        assert!(gate.accept(&ticket("new", 1)));
        assert!(!gate.accept(&ticket("old", 41)));
    }

    #[test]
    fn flipped_views_count_from_the_top_as_the_page_does() {
        assert_eq!(view_frame(RECT, 800.0, true), (600.0, 100.0, 300.0, 200.0));
    }

    #[test]
    fn other_views_count_up_from_the_bottom() {
        // 800 high: the top edge at 100 from the top is 700 from the bottom, less its 200
        assert_eq!(view_frame(RECT, 800.0, false), (600.0, 500.0, 300.0, 200.0));
    }

    #[test]
    fn a_collapsed_placeholder_gives_an_empty_frame() {
        let rect = PreviewRect { width: -4.0, height: -1.0, ..RECT };
        assert_eq!(view_frame(rect, 800.0, true), (600.0, 100.0, 0.0, 0.0));
    }
}
