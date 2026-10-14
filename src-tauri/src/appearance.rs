//! Light / dark appearance, chosen from View ▸ Appearance in the native menu bar
//! and persisted across launches. The webview's `prefers-color-scheme` follows
//! the window theme, so the frontend only needs CSS media queries.

use std::path::{Path, PathBuf};

use tauri::menu::{CheckMenuItem, Menu, MenuItemKind, Submenu};
use tauri::{App, AppHandle, Manager, Theme, Wry};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Appearance {
    System,
    Light,
    Dark,
}

impl Appearance {
    const ALL: [Appearance; 3] = [Appearance::System, Appearance::Light, Appearance::Dark];
    const DEFAULT: Appearance = Appearance::Light;

    fn as_str(self) -> &'static str {
        match self {
            Appearance::System => "system",
            Appearance::Light => "light",
            Appearance::Dark => "dark",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|a| a.as_str() == s)
    }

    fn menu_id(self) -> String {
        format!("appearance-{}", self.as_str())
    }

    fn from_menu_id(id: &str) -> Option<Self> {
        id.strip_prefix("appearance-").and_then(Self::parse)
    }

    fn menu_label(self) -> &'static str {
        match self {
            Appearance::System => "Use System Setting",
            Appearance::Light => "Light",
            Appearance::Dark => "Dark",
        }
    }

    fn theme(self) -> Option<Theme> {
        match self {
            Appearance::System => None,
            Appearance::Light => Some(Theme::Light),
            Appearance::Dark => Some(Theme::Dark),
        }
    }
}

const FILE_NAME: &str = "appearance";

fn load(dir: &Path) -> Appearance {
    std::fs::read_to_string(dir.join(FILE_NAME))
        .ok()
        .and_then(|s| Appearance::parse(s.trim()))
        .unwrap_or(Appearance::DEFAULT)
}

fn save(dir: &Path, appearance: Appearance) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(FILE_NAME), appearance.as_str())
}

fn apply(app: &AppHandle, appearance: Appearance) {
    for window in app.webview_windows().values() {
        let _ = window.set_theme(appearance.theme());
    }
}

/// Applies the saved appearance and installs the default menu bar with a
/// View ▸ Appearance submenu.
pub fn setup(app: &App) -> tauri::Result<()> {
    let handle = app.handle();
    let config_dir: PathBuf = app.path().app_config_dir()?;
    let current = load(&config_dir);

    let items = Appearance::ALL
        .into_iter()
        .map(|a| {
            CheckMenuItem::with_id(handle, a.menu_id(), a.menu_label(), true, a == current, None::<&str>)
        })
        .collect::<tauri::Result<Vec<CheckMenuItem<Wry>>>>()?;
    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
        items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>).collect();
    let submenu = Submenu::with_items(handle, "Appearance", true, &item_refs)?;

    let menu = Menu::default(handle)?;
    let view_menu = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(s) if s.text().ok().as_deref() == Some("View") => Some(s),
        _ => None,
    });
    match view_menu {
        Some(view) => view.append(&submenu)?,
        None => menu.append(&submenu)?,
    }
    app.set_menu(menu)?;
    apply(handle, current);

    handle.on_menu_event(move |app, event| {
        let Some(chosen) = Appearance::from_menu_id(event.id().as_ref()) else {
            return;
        };
        apply(app, chosen);
        for (item, a) in items.iter().zip(Appearance::ALL) {
            let _ = item.set_checked(a == chosen);
        }
        if let Err(e) = save(&config_dir, chosen) {
            eprintln!("failed to save appearance: {e}");
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("folderbase-appearance-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn menu_ids_round_trip() {
        for a in Appearance::ALL {
            assert_eq!(Appearance::from_menu_id(&a.menu_id()), Some(a));
        }
        assert_eq!(Appearance::from_menu_id("quit"), None);
        assert_eq!(Appearance::from_menu_id("appearance-sepia"), None);
    }

    #[test]
    fn load_defaults_to_light_when_missing_or_invalid() {
        let dir = temp_dir();
        assert_eq!(load(&dir), Appearance::Light);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE_NAME), "sepia").unwrap();
        assert_eq!(load(&dir), Appearance::Light);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = temp_dir();
        for a in Appearance::ALL {
            save(&dir, a).unwrap();
            assert_eq!(load(&dir), a);
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn system_appearance_has_no_fixed_theme() {
        assert_eq!(Appearance::System.theme(), None);
        assert_eq!(Appearance::Dark.theme(), Some(Theme::Dark));
    }
}
