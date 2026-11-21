//! Compress: a zip of files, laid out as the frontend planned it (`lib/compress.ts`),
//! for sharing: in Downloads, or the folder chosen in Settings (`settings::zip_folder`). Nothing in the database points at it; a
//! zip saved inside a location is indexed like any other file.
//!
//! - Written to a hidden file beside the target and renamed at the end, so a
//!   cancel or a failure never leaves half a zip behind
//! - Progress (bytes read) goes to the frontend as `compress_progress` events
//! - Media that's already compressed (photos, video, zips) is stored, not deflated
//! - A file the database has but the disk doesn't is an error naming it

use crate::commands::import::unique_path;
use crate::db::DbPool;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, Manager, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

/// One file in the zip: where it goes inside (folders split by "/"), and where it is on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveEntry {
    pub archive_path: String,
    pub disk_path: String,
}

/// What a cancelled compress returns, so the frontend can tell it apart from a failure.
pub const CANCELLED: &str = "cancelled";

/// Extensions whose files gain nothing from deflating.
const STORED: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "mp4", "mov", "m4v", "mkv", "avi", "webm", "mp3", "m4a", "aac",
    "ogg", "flac", "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "dmg", "pkg", "docx", "xlsx", "pptx", "pages", "numbers", "key",
];

fn method_for(path: &Path) -> CompressionMethod {
    let ext = path.extension().and_then(OsStr::to_str).map(str::to_ascii_lowercase).unwrap_or_default();
    if STORED.contains(&ext.as_str()) {
        CompressionMethod::Stored
    } else {
        CompressionMethod::Deflated
    }
}

/// Refuses a path that would unzip outside its folder: absolute, "..", or empty.
fn check_archive_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    let ok = !path.is_empty()
        && !path.contains('\\')
        && p.components().all(|c| matches!(c, Component::Normal(_)));
    if ok {
        Ok(())
    } else {
        Err(format!("“{path}” can't go in a zip"))
    }
}

/// A file's modification time as a zip timestamp (local time, as Archive Utility shows it).
fn zip_time(meta: &std::fs::Metadata) -> Option<DateTime> {
    use chrono::{Datelike, Timelike};
    let local: chrono::DateTime<chrono::Local> = meta.modified().ok()?.into();
    DateTime::from_date_and_time(
        local.year().try_into().ok()?,
        local.month() as u8,
        local.day() as u8,
        local.hour() as u8,
        local.minute() as u8,
        local.second() as u8,
    )
    .ok()
}

/// The hidden file a zip is written to before it takes its name.
fn partial_path(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    target.with_file_name(format!(".{name}.part"))
}

/// Writes `entries` into a zip at `target`. `progress` gets (bytes read, bytes in all).
/// Stops when `cancel` is set, leaving nothing behind.
pub fn write_zip(
    target: &Path,
    entries: &[ArchiveEntry],
    cancel: &AtomicBool,
    progress: &dyn Fn(u64, u64),
) -> Result<(), String> {
    if entries.is_empty() {
        return Err("There's nothing to compress".into());
    }
    let mut total = 0u64;
    let mut sources = Vec::with_capacity(entries.len());
    for entry in entries {
        check_archive_path(&entry.archive_path)?;
        let disk = PathBuf::from(&entry.disk_path);
        let meta = std::fs::metadata(&disk).map_err(|_| {
            format!("“{}” can't be found. It may have been moved or deleted; refresh the location.", entry.disk_path)
        })?;
        if !meta.is_file() {
            return Err(format!("“{}” isn't a file", entry.disk_path));
        }
        total += meta.len();
        sources.push((disk, meta));
    }

    let partial = partial_path(target);
    let result = (|| {
        let file = std::fs::File::create(&partial).map_err(|e| format!("{}: {e}", partial.display()))?;
        let mut zip = ZipWriter::new(std::io::BufWriter::new(file));
        let mut done = 0u64;
        let mut buf = vec![0u8; 1 << 20];
        for (entry, (disk, meta)) in entries.iter().zip(&sources) {
            let mut options = SimpleFileOptions::default()
                .compression_method(method_for(disk))
                .large_file(meta.len() >= u32::MAX as u64);
            if let Some(time) = zip_time(meta) {
                options = options.last_modified_time(time);
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                options = options.unix_permissions(meta.permissions().mode() & 0o777);
            }
            zip.start_file(entry.archive_path.as_str(), options).map_err(|e| format!("{}: {e}", entry.archive_path))?;
            let mut source = std::fs::File::open(disk).map_err(|e| format!("{}: {e}", disk.display()))?;
            loop {
                if cancel.load(Ordering::Relaxed) {
                    return Err(CANCELLED.to_string());
                }
                let n = source.read(&mut buf).map_err(|e| format!("{}: {e}", disk.display()))?;
                if n == 0 {
                    break;
                }
                zip.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                done += n as u64;
                progress(done, total);
            }
        }
        let mut out = zip.finish().map_err(|e| e.to_string())?;
        out.flush().map_err(|e| e.to_string())?;
        Ok(())
    })();

    match result {
        Ok(()) => std::fs::rename(&partial, target).map_err(|e| format!("{}: {e}", target.display())),
        Err(e) => {
            let _ = std::fs::remove_file(&partial);
            Err(e)
        }
    }
}

/// The zip's place: the path chosen in a save panel as it is, else `name` in
/// the zip folder, numbered when it's taken ("Acme 2.zip").
pub fn target_path(downloads: &Path, name: &str, chosen: Option<&str>) -> Result<PathBuf, String> {
    if let Some(chosen) = chosen {
        return Ok(PathBuf::from(chosen));
    }
    let name = Path::new(name).file_name().ok_or_else(|| format!("“{name}” isn't a file name"))?;
    std::fs::create_dir_all(downloads).map_err(|e| e.to_string())?;
    Ok(unique_path(downloads, name))
}

fn cancels() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static CANCELS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    CANCELS.get_or_init(Default::default)
}

/// Zips `entries` into `destination` (a path from a save panel), else `name` in
/// the zip folder (Downloads unless Settings says otherwise), and indexes it if that's inside a location. Resolves to the zip's
/// path; `job` identifies its progress events and `cancel_compress`.
#[tauri::command]
pub async fn compress_items(
    job: String,
    name: String,
    entries: Vec<ArchiveEntry>,
    destination: Option<String>,
    app: tauri::AppHandle,
    db: State<'_, DbPool>,
) -> Result<String, String> {
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let folder = crate::commands::settings::zip_folder(db.inner(), &downloads).await;
    let target = target_path(&folder, &name, destination.as_deref())?;

    let cancel = Arc::new(AtomicBool::new(false));
    cancels().lock().unwrap().insert(job.clone(), cancel.clone());
    let written = {
        let (target, job, app) = (target.clone(), job.clone(), app.clone());
        tauri::async_runtime::spawn_blocking(move || {
            let last = Mutex::new(std::time::Instant::now());
            write_zip(&target, &entries, &cancel, &|done, total| {
                // A few updates a second is plenty for a progress bar
                let mut last = last.lock().unwrap();
                if done < total && last.elapsed().as_millis() < 100 {
                    return;
                }
                *last = std::time::Instant::now();
                let _ = app.emit("compress_progress", serde_json::json!({ "job": job, "done": done, "total": total }));
            })
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r)
    };
    cancels().lock().unwrap().remove(&job);
    written?;

    // Saved inside a location: it shows there straight away
    let locations = crate::commands::locations::get_locations_impl(db.inner()).await.unwrap_or_default();
    let holding = locations
        .iter()
        .filter(|l| target.starts_with(&l.root_path))
        .max_by_key(|l| l.root_path.len());
    if let Some(location) = holding {
        crate::commands::sync::sync_location(&location.location_id, db.inner(), &|_| {}).await?;
    }
    Ok(target.to_string_lossy().into_owned())
}

/// Stops a compress in progress; its half-written zip is removed.
#[tauri::command]
pub fn cancel_compress(job: String) {
    if let Some(cancel) = cancels().lock().unwrap().get(&job) {
        cancel.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("folderbase-compress-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(archive: &str, disk: &Path) -> ArchiveEntry {
        ArchiveEntry { archive_path: archive.into(), disk_path: disk.to_string_lossy().into_owned() }
    }

    fn names_in(zip: &Path) -> Vec<String> {
        let archive = zip::ZipArchive::new(std::fs::File::open(zip).unwrap()).unwrap();
        archive.file_names().map(String::from).collect::<Vec<_>>()
    }

    #[test]
    fn writes_each_file_where_the_plan_puts_it() {
        let dir = scratch("happy");
        std::fs::write(dir.join("a.txt"), "hello").unwrap();
        std::fs::write(dir.join("b.jpg"), [1u8, 2, 3]).unwrap();
        let target = dir.join("Acme.zip");
        let seen = Mutex::new(Vec::new());
        write_zip(
            &target,
            &[entry("Acme/2024/a.txt", &dir.join("a.txt")), entry("Acme/b.jpg", &dir.join("b.jpg"))],
            &AtomicBool::new(false),
            &|done, total| seen.lock().unwrap().push((done, total)),
        )
        .unwrap();

        let mut names = names_in(&target);
        names.sort();
        assert_eq!(names, ["Acme/2024/a.txt", "Acme/b.jpg"]);
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&target).unwrap()).unwrap();
        let mut text = String::new();
        archive.by_name("Acme/2024/a.txt").unwrap().read_to_string(&mut text).unwrap();
        assert_eq!(text, "hello");
        assert_eq!(archive.by_name("Acme/2024/a.txt").unwrap().compression(), CompressionMethod::Deflated);
        assert_eq!(archive.by_name("Acme/b.jpg").unwrap().compression(), CompressionMethod::Stored);
        assert_eq!(seen.lock().unwrap().last(), Some(&(8, 8)));
        assert!(!partial_path(&target).exists());
    }

    #[test]
    fn a_missing_file_fails_naming_it_and_leaves_nothing() {
        let dir = scratch("missing");
        let target = dir.join("Archive.zip");
        let err = write_zip(&target, &[entry("gone.pdf", &dir.join("gone.pdf"))], &AtomicBool::new(false), &|_, _| {})
            .unwrap_err();
        assert!(err.contains("gone.pdf"), "{err}");
        assert!(!target.exists());
        assert!(!partial_path(&target).exists());
    }

    #[test]
    fn cancelling_leaves_nothing_behind() {
        let dir = scratch("cancel");
        std::fs::write(dir.join("a.txt"), "hello").unwrap();
        let target = dir.join("Archive.zip");
        let err = write_zip(&target, &[entry("a.txt", &dir.join("a.txt"))], &AtomicBool::new(true), &|_, _| {}).unwrap_err();
        assert_eq!(err, CANCELLED);
        assert!(!target.exists());
        assert!(!partial_path(&target).exists());
    }

    #[test]
    fn refuses_paths_that_would_unzip_elsewhere() {
        let dir = scratch("paths");
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        for bad in ["../a.txt", "/etc/a.txt", "", "a/../../b", "a\\b"] {
            let err = write_zip(&dir.join("x.zip"), &[entry(bad, &dir.join("a.txt"))], &AtomicBool::new(false), &|_, _| {});
            assert!(err.is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn nothing_to_compress_is_an_error() {
        let dir = scratch("empty");
        assert!(write_zip(&dir.join("x.zip"), &[], &AtomicBool::new(false), &|_, _| {}).is_err());
    }

    #[test]
    fn downloads_gets_a_free_name_and_a_chosen_path_is_kept() {
        let dir = scratch("target");
        std::fs::write(dir.join("Acme.zip"), "").unwrap();
        assert_eq!(target_path(&dir, "Acme.zip", None).unwrap(), dir.join("Acme 2.zip"));
        assert_eq!(target_path(&dir, "Globex.zip", None).unwrap(), dir.join("Globex.zip"));
        assert_eq!(target_path(&dir, "Acme.zip", Some("/x/y/Mine.zip")).unwrap(), PathBuf::from("/x/y/Mine.zip"));
        // A name with folders in it can't put the zip somewhere else
        assert_eq!(target_path(&dir, "../../evil.zip", None).unwrap(), dir.join("evil.zip"));
    }
}
