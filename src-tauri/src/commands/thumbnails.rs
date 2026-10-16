//! File thumbnails, rendered by Quick Look as Finder's icon view does (first
//! frame of a GIF, first page of a PDF, a document's preview). They're small
//! PNGs cached on disk, so a folder of large images costs a few kilobytes per
//! tile instead of decoding every full-size original in the webview.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Largest thumbnail edge, in points.
const MAX_THUMBNAIL_PT: u32 = 512;
/// Empty marker cached for files Quick Look can't thumbnail, so they aren't retried.
const NO_THUMBNAIL: &str = "none";

/// Cache file name for `path` at `size`: changes whenever the file does (size or
/// modified time), so an edited file gets a fresh thumbnail.
fn cache_key(path: &Path, size: u32, scale: u32) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    meta.len().hash(&mut hasher);
    meta.modified().ok().hash(&mut hasher);
    (size, scale).hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

/// Path of a cached PNG thumbnail of `path`, `size` points square at `scale`×,
/// rendering it on first request. `None` when there's no thumbnail for the file
/// (the frontend shows the file's icon instead).
#[tauri::command]
pub async fn get_thumbnail(path: String, size: u32, scale: u32, app: AppHandle) -> Result<Option<String>, String> {
    if size == 0 || size > MAX_THUMBNAIL_PT || !(1..=3).contains(&scale) {
        return Err(format!("thumbnail size must be 1–{MAX_THUMBNAIL_PT}pt at 1–3×"));
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("thumbnails");
    tauri::async_runtime::spawn_blocking(move || thumbnail(Path::new(&path), size, scale, &dir))
        .await
        .map_err(|e| e.to_string())?
}

fn thumbnail(path: &Path, size: u32, scale: u32, dir: &Path) -> Result<Option<String>, String> {
    let key = cache_key(path, size, scale)?;
    let png = dir.join(format!("{key}.png"));
    let none = dir.join(format!("{key}.{NO_THUMBNAIL}"));
    if png.exists() {
        return Ok(Some(png.to_string_lossy().into_owned()));
    }
    if none.exists() {
        return Ok(None);
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    match render(path, size, scale)? {
        Some(bytes) => {
            write_atomically(&png, &bytes)?;
            Ok(Some(png.to_string_lossy().into_owned()))
        }
        None => {
            let _ = std::fs::write(&none, b"");
            Ok(None)
        }
    }
}

/// Writes via a temporary file so a half-written PNG is never served.
fn write_atomically(target: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let tmp = target.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, target).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn render(path: &Path, size: u32, scale: u32) -> Result<Option<Vec<u8>>, String> {
    use block2::RcBlock;
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSSize as CGSize;
    use objc2_foundation::{NSDictionary, NSError, NSString, NSURL};
    use objc2_quick_look_thumbnailing::{
        QLThumbnailGenerationRequest, QLThumbnailGenerationRequestRepresentationTypes, QLThumbnailGenerator,
        QLThumbnailRepresentation,
    };
    use std::sync::mpsc;
    use std::time::Duration;

    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let request = unsafe {
        QLThumbnailGenerationRequest::initWithFileAtURL_size_scale_representationTypes(
            QLThumbnailGenerationRequest::alloc(),
            &url,
            CGSize::new(size as f64, size as f64),
            scale as f64,
            QLThumbnailGenerationRequestRepresentationTypes::Thumbnail,
        )
    };

    let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();
    let handler = RcBlock::new(move |rep: *mut QLThumbnailRepresentation, _error: *mut NSError| {
        // SAFETY: Quick Look passes a valid representation or null
        let png = unsafe { rep.as_ref() }.and_then(|rep| {
            let cg_image = unsafe { rep.CGImage() };
            let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg_image);
            unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }
                .map(|data| data.to_vec())
        });
        let _ = tx.send(png);
    });
    unsafe {
        QLThumbnailGenerator::sharedGenerator().generateBestRepresentationForRequest_completionHandler(&request, &handler);
    }
    // A stuck provider (e.g. an unreachable cloud file) shouldn't hold a thread forever
    match rx.recv_timeout(Duration::from_secs(20)) {
        Ok(png) => Ok(png),
        Err(_) => {
            unsafe { QLThumbnailGenerator::sharedGenerator().cancelRequest(&request) };
            Err("thumbnail timed out".into())
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn render(_path: &Path, _size: u32, _scale: u32) -> Result<Option<Vec<u8>>, String> {
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
    }

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("folderbase-thumbs-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn cache_key_depends_on_size() {
        let file = fixtures().join("sample.png");
        assert_ne!(cache_key(&file, 64, 2).unwrap(), cache_key(&file, 128, 2).unwrap());
        assert_eq!(cache_key(&file, 64, 2).unwrap(), cache_key(&file, 64, 2).unwrap());
    }

    #[test]
    fn missing_file_is_an_error() {
        assert!(thumbnail(&fixtures().join("no-such-file.png"), 64, 2, &temp_dir()).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn renders_and_caches_an_image_thumbnail() {
        let dir = temp_dir();
        let file = fixtures().join("sample.png");
        let first = thumbnail(&file, 64, 2, &dir).unwrap().expect("Quick Look thumbnails a PNG");
        assert!(std::fs::read(&first).unwrap().starts_with(b"\x89PNG"));
        // Second request is served from the cache
        assert_eq!(thumbnail(&file, 64, 2, &dir).unwrap(), Some(first));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
