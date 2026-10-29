//! Dragging files out of the window into Finder or another app (Mail, a
//! browser upload). The frontend drags inside the window itself; when the
//! pointer leaves the window, the drag is handed to the system here.
//!
//! - Always a copy: a drop on Finder never moves a file out of its location
//! - The drag image carries on from the icon shown inside the window, at its
//!   size and place beside the pointer, so nothing jumps at the window's edge
//! - Each file shows its own icon, piled as Finder piles several

/// The first files that get their own icon; the rest reuse the last one (they're under the pile).
const OWN_ICONS: usize = 8;

/// Where the drag image goes: `size` points square, `offset` right of and below the
/// pointer. In window coordinates, which run up from the bottom: (x, y, width, height).
pub fn drag_frame(pointer: (f64, f64), size: f64, offset: f64) -> (f64, f64, f64, f64) {
    (pointer.0 + offset, pointer.1 - offset - size, size, size)
}

/// Hands the drag to the system with `paths` (absolute) as the files dragged, the
/// image `size` points square and `offset` points from the pointer, as the
/// window showed it.
#[tauri::command]
pub async fn drag_out(window: tauri::WebviewWindow, paths: Vec<String>, size: f64, offset: f64) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(macos::start(&target, &paths, size, offset));
            })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, size, offset);
        Err("Dragging files out isn't available on this platform yet".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{drag_frame, OWN_ICONS};
    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSApp, NSDragOperation, NSDraggingContext, NSDraggingFormation, NSDraggingItem, NSDraggingSession,
        NSDraggingSource, NSEvent, NSEventModifierFlags, NSEventType, NSImage, NSWindow, NSWorkspace,
    };
    use objc2_foundation::{NSMutableArray, NSPoint, NSRect, NSSize, NSString, NSURL};

    define_class!(
        // The drag's source: it offers only a copy
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "FolderbaseDragOutSource"]
        struct DragOutSource;

        unsafe impl NSObjectProtocol for DragOutSource {}

        unsafe impl NSDraggingSource for DragOutSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn operation_mask(&self, _session: &NSDraggingSession, _context: NSDraggingContext) -> NSDragOperation {
                NSDragOperation::Copy
            }
        }
    );

    impl DragOutSource {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(());
            unsafe { msg_send![super(this), init] }
        }
    }

    pub fn start(window: &tauri::WebviewWindow, paths: &[String], size: f64, offset: f64) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let ns_window = window.ns_window().map_err(|e| e.to_string())?;
        // SAFETY: Tauri hands back the window's NSWindow, alive while `window` is
        let ns_window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
        let view = ns_window.contentView().ok_or("the window has no content view")?;

        let pointer = ns_window.mouseLocationOutsideOfEventStream();
        let (x, y, w, h) = drag_frame((pointer.x, pointer.y), size, offset);
        let frame = NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));

        let workspace = NSWorkspace::sharedWorkspace();
        let items = NSMutableArray::<NSDraggingItem>::new();
        let mut icon: Option<Retained<NSImage>> = None;
        for (i, path) in paths.iter().enumerate() {
            let ns_path = NSString::from_str(path);
            if i < OWN_ICONS || icon.is_none() {
                let image = workspace.iconForFile(&ns_path);
                image.setSize(NSSize::new(size, size));
                icon = Some(image);
            }
            let url = NSURL::fileURLWithPath(&ns_path);
            let item = NSDraggingItem::initWithPasteboardWriter(NSDraggingItem::alloc(), &ProtocolObject::from_retained(url));
            unsafe { item.setDraggingFrame_contents(frame, icon.as_deref().map(|i| i as &objc2::runtime::AnyObject)) };
            items.addObject(&item);
        }

        // The drag goes on from the pointer, as if it had started there with the button down
        let timestamp = NSApp(mtm).currentEvent().map(|e| e.timestamp()).unwrap_or(0.0);
        let event = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
            NSEventType::LeftMouseDragged,
            pointer,
            NSEventModifierFlags::empty(),
            timestamp,
            ns_window.windowNumber(),
            None,
            0,
            1,
            1.0,
        )
        .ok_or("the drag couldn't be started")?;

        let source = DragOutSource::new(mtm);
        let session = view.beginDraggingSessionWithItems_event_source(&items, &event, ProtocolObject::from_ref(&*source));
        session.setDraggingFormation(NSDraggingFormation::Pile);
        // Cancelled, it would slide back to the window's edge, not to the file: it just ends
        session.setAnimatesToStartingPositionsOnCancelOrFail(false);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_sits_right_of_and_below_the_pointer() {
        // Window coordinates run up from the bottom, so "below" is a smaller y
        assert_eq!(drag_frame((100.0, 400.0), 32.0, 8.0), (108.0, 360.0, 32.0, 32.0));
    }

    #[test]
    fn frame_can_be_outside_the_window() {
        // The pointer has left the window when the drag is handed over
        assert_eq!(drag_frame((-20.0, 10.0), 32.0, 8.0), (-12.0, -30.0, 32.0, 32.0));
    }
}
