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

#[cfg(test)]
mod tests {
    use super::*;

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
