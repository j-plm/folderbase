use serde::Deserialize;

/// Trackpad haptic patterns, as AppKit uses them: `Alignment` when something
/// snaps to a guide or limit, `LevelChange` when an action crosses into a new state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HapticPattern {
    Alignment,
    LevelChange,
}

/// Plays a Force Touch trackpad haptic. A no-op on other platforms, and on Macs
/// without a Force Touch trackpad (AppKit ignores the request).
#[tauri::command]
pub fn haptic_feedback(pattern: HapticPattern) {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{
            NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
            NSHapticFeedbackPerformer,
        };
        let native = match pattern {
            HapticPattern::Alignment => NSHapticFeedbackPattern::Alignment,
            HapticPattern::LevelChange => NSHapticFeedbackPattern::LevelChange,
        };
        NSHapticFeedbackManager::defaultPerformer()
            .performFeedbackPattern_performanceTime(native, NSHapticFeedbackPerformanceTime::Now);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = pattern;
}

/// Converts a point in the webview (top-left origin, logical px) to AppKit
/// window coordinates (bottom-left origin) for a content view `height` tall.
fn to_window_point(x: f64, y: f64, height: f64) -> (f64, f64) {
    (x, height - y)
}

/// Plays AppKit's "poof" at a point in the window: the puff of smoke shown when
/// an item is dragged off the Dock or a toolbar and removed. `x`/`y` are in the
/// webview's coordinates. A no-op on other platforms.
// NSShowAnimationEffect is deprecated in favour of a cursor, which the webview
// would override; the effect itself still plays.
#[allow(deprecated)]
#[tauri::command]
pub fn poof_at(window: tauri::WebviewWindow, x: f64, y: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSAnimationEffect, NSShowAnimationEffect, NSWindow};
        use objc2_foundation::{NSPoint, NSSize};

        let ptr = window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;
        // SAFETY: Tauri returns this window's live NSWindow; commands without
        // `async` run on the main thread, where AppKit must be used.
        let ns_window = unsafe { ptr.as_ref() }.ok_or("no native window")?;
        let height = ns_window
            .contentView()
            .map(|v| v.frame().size.height)
            .ok_or("no content view")?;
        let (wx, wy) = to_window_point(x, y, height);
        let screen = ns_window.convertPointToScreen(NSPoint::new(wx, wy));
        // A zero size means the default size
        unsafe {
            NSShowAnimationEffect(
                NSAnimationEffect::Poof,
                screen,
                NSSize::new(0.0, 0.0),
                None,
                None,
                std::ptr::null_mut(),
            );
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, x, y);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webview_points_flip_to_bottom_left_origin() {
        assert_eq!(to_window_point(120.0, 30.0, 800.0), (120.0, 770.0));
    }

    #[test]
    fn bottom_edge_maps_to_zero() {
        assert_eq!(to_window_point(0.0, 800.0, 800.0), (0.0, 0.0));
    }

    #[test]
    fn patterns_deserialize_from_camel_case() {
        let p: HapticPattern = serde_json::from_str("\"levelChange\"").unwrap();
        assert_eq!(p, HapticPattern::LevelChange);
    }

    #[test]
    fn unknown_pattern_is_rejected() {
        assert!(serde_json::from_str::<HapticPattern>("\"buzz\"").is_err());
    }
}
