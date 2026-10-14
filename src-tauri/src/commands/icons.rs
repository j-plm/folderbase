//! Native file and folder icons.
//!
//! Icons are rendered by the operating system itself so they match the
//! platform file manager exactly (Finder on macOS). The frontend caches the
//! result per kind + size, so each icon is rendered once per session.
//!
//! Kinds: "folder", a file extension, or "symbol:<name>" for an SF Symbol
//! (Finder's sidebar line icons). Symbols render black on transparent so the
//! frontend can use them as a mask and tint them with CSS.

use base64::Engine;

const MAX_ICON_PX: u32 = 1024;

#[derive(Debug, PartialEq)]
enum IconKind {
    Folder,
    /// Lowercase file extension without the leading dot ("" for none).
    Extension(String),
    /// SF Symbol name, e.g. "folder" or "clock".
    Symbol(String),
}

fn parse_kind(kind: &str) -> Result<IconKind, String> {
    if kind == "folder" {
        return Ok(IconKind::Folder);
    }
    if let Some(name) = kind.strip_prefix("symbol:") {
        let valid = !name.is_empty()
            && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.');
        return if valid {
            Ok(IconKind::Symbol(name.to_string()))
        } else {
            Err(format!("invalid symbol name: {name}"))
        };
    }
    Ok(IconKind::Extension(kind.trim_start_matches('.').to_lowercase()))
}

/// Returns a `data:image/png;base64,...` URL for the native icon of `kind`
/// ("folder", a file extension, or "symbol:<SF Symbol name>"), fitted within `size` × `size` pixels.
#[tauri::command]
pub async fn get_native_icon(kind: String, size: u32) -> Result<String, String> {
    let png = tauri::async_runtime::spawn_blocking(move || render_icon(&kind, size))
        .await
        .map_err(|e| e.to_string())??;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

fn render_icon(kind: &str, size: u32) -> Result<Vec<u8>, String> {
    if size == 0 || size > MAX_ICON_PX {
        return Err(format!("icon size must be between 1 and {MAX_ICON_PX}"));
    }
    render_icon_png(&parse_kind(kind)?, size)
}

#[cfg(target_os = "macos")]
fn render_icon_png(kind: &IconKind, px: u32) -> Result<Vec<u8>, String> {
    use objc2::rc::autoreleasepool;
    use objc2::AllocAnyThread;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSFontWeightRegular, NSImage, NSImageNameFolder,
        NSImageSymbolConfiguration, NSWorkspace,
    };
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

    autoreleasepool(|_| {
        let image = match kind {
            IconKind::Folder => NSImage::imageNamed(unsafe { NSImageNameFolder })
                .ok_or("folder icon unavailable")?,
            #[allow(deprecated)] // iconForContentType needs a UTType; this takes the extension directly
            IconKind::Extension(ext) => {
                NSWorkspace::sharedWorkspace().iconForFileType(&NSString::from_str(ext))
            }
            IconKind::Symbol(name) => {
                let symbol = NSImage::imageWithSystemSymbolName_accessibilityDescription(
                    &NSString::from_str(name),
                    None,
                )
                .ok_or_else(|| format!("unknown symbol: {name}"))?;
                let config = NSImageSymbolConfiguration::configurationWithPointSize_weight(
                    px as f64,
                    unsafe { NSFontWeightRegular },
                );
                symbol.imageWithSymbolConfiguration(&config).unwrap_or(symbol)
            }
        };

        // Fit within px × px, keeping the image's aspect ratio (symbols aren't square).
        let natural = image.size();
        let scale = px as f64 / natural.width.max(natural.height).max(1.0);
        let mut rect = NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new((natural.width * scale).round(), (natural.height * scale).round()),
        );
        let cg_image = unsafe { image.CGImageForProposedRect_context_hints(&mut rect, None, None) }
            .ok_or("could not rasterise icon")?;
        let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg_image);
        let png = unsafe {
            bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        }
        .ok_or("could not encode icon as PNG")?;
        Ok(png.to_vec())
    })
}

#[cfg(not(target_os = "macos"))]
fn render_icon_png(_kind: &IconKind, _px: u32) -> Result<Vec<u8>, String> {
    Err("native icons are not yet supported on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_kind_folder() {
        assert_eq!(parse_kind("folder"), Ok(IconKind::Folder));
    }

    #[test]
    fn parse_kind_normalises_extension() {
        assert_eq!(parse_kind(".PDF"), Ok(IconKind::Extension("pdf".into())));
        assert_eq!(parse_kind(""), Ok(IconKind::Extension(String::new())));
    }

    #[test]
    fn parse_kind_symbols() {
        assert_eq!(parse_kind("symbol:folder"), Ok(IconKind::Symbol("folder".into())));
        assert_eq!(parse_kind("symbol:arrow.down.circle"), Ok(IconKind::Symbol("arrow.down.circle".into())));
        assert!(parse_kind("symbol:").is_err());
        assert!(parse_kind("symbol:../etc").is_err());
    }

    #[test]
    fn render_icon_rejects_bad_sizes() {
        assert!(render_icon("pdf", 0).is_err());
        assert!(render_icon("pdf", MAX_ICON_PX + 1).is_err());
    }

    #[cfg(target_os = "macos")]
    const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

    #[cfg(target_os = "macos")]
    #[test]
    fn unknown_symbol_is_an_error() {
        assert!(render_icon("symbol:not.a.real.symbol.name", 32).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn renders_folder_and_file_icons_as_png() {
        for kind in ["folder", "pdf", "jpg", "", "no-such-extension", "symbol:folder", "symbol:clock"] {
            let png = render_icon(kind, 64).unwrap_or_else(|e| panic!("{kind}: {e}"));
            assert!(png.starts_with(PNG_MAGIC), "{kind} did not render a PNG");
        }
    }
}
