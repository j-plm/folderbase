mod common;

use common::setup_db;
use folderbase_lib::commands::ingest::ingest_directory_impl;
use std::path::PathBuf;

fn fixtures_dir() -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .to_string_lossy()
        .to_string()
}

/// Crawling the fixtures folder should insert exactly 4 records:
/// sample.jpg, sample.png, sample.txt, subdir/nested.txt.
/// The .hidden_file and the subdir entry itself must be excluded.
#[tokio::test]
async fn test_ingest_correct_count() {
    let pool = setup_db().await;
    let count = ingest_directory_impl(&fixtures_dir(), "test_lib", &pool)
        .await
        .unwrap();
    assert_eq!(count, 4, "expected 4 files; got {count}");
}

/// Running ingestion twice on the same folder must not duplicate records.
#[tokio::test]
async fn test_ingest_no_duplicates() {
    let pool = setup_db().await;
    let dir = fixtures_dir();
    let first = ingest_directory_impl(&dir, "test_lib", &pool).await.unwrap();
    let second = ingest_directory_impl(&dir, "test_lib", &pool).await.unwrap();
    assert_eq!(first, 4);
    assert_eq!(second, 0, "second pass should insert 0 new records");
}

/// The JPEG record must have EXIF fields (camera_make, date_taken) populated.
#[tokio::test]
async fn test_jpeg_has_exif_fields() {
    let pool = setup_db().await;
    ingest_directory_impl(&fixtures_dir(), "test_lib", &pool)
        .await
        .unwrap();

    let row: (Option<String>,) =
        sqlx::query_as("SELECT metadata FROM files WHERE file_path LIKE '%sample.jpg'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let meta: serde_json::Value =
        serde_json::from_str(&row.0.unwrap()).unwrap();

    assert!(
        meta.get("camera_make").is_some(),
        "expected camera_make in JPEG metadata; got: {meta}"
    );
    assert!(
        meta.get("date_taken").is_some(),
        "expected date_taken in JPEG metadata; got: {meta}"
    );
}

/// The PNG record must have an empty metadata blob — no filesystem duplicates, no EXIF.
#[tokio::test]
async fn test_png_basic_metadata_no_exif() {
    let pool = setup_db().await;
    ingest_directory_impl(&fixtures_dir(), "test_lib", &pool)
        .await
        .unwrap();

    let row: (Option<String>,) =
        sqlx::query_as("SELECT metadata FROM files WHERE file_path LIKE '%sample.png'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let meta: serde_json::Value =
        serde_json::from_str(&row.0.unwrap()).unwrap();

    // Filesystem fields belong in dedicated columns, not the metadata blob.
    assert!(meta.get("file_name").is_none(), "file_name should not be in metadata blob");
    assert!(meta.get("size_bytes").is_none(), "size_bytes should not be in metadata blob");
    assert!(meta.get("extension").is_none(), "extension should not be in metadata blob");
    assert!(meta.get("created_at").is_none(), "created_at should not be in metadata blob");
    assert!(
        meta.get("camera_make").is_none(),
        "PNG should not have camera_make"
    );
    assert!(
        meta.get("date_taken").is_none(),
        "PNG should not have date_taken"
    );
}

/// After ingestion, the properties table must contain rows for EXIF string fields
/// found across the ingested records. Filesystem fields (file_name, extension,
/// size_bytes, created_at) are stored in dedicated columns and must NOT appear
/// as bootstrapped properties.
#[tokio::test]
async fn test_properties_bootstrapped() {
    let pool = setup_db().await;
    ingest_directory_impl(&fixtures_dir(), "test_lib", &pool)
        .await
        .unwrap();

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM properties WHERE library = 'test_lib'")
            .fetch_one(&pool)
            .await
            .unwrap();

    // At minimum the JPEG fixture contributes camera_make and date_taken.
    assert!(
        count >= 2,
        "expected at least 2 bootstrapped properties (EXIF), got {count}"
    );

    // Every bootstrapped property must have a valid value_type.
    let bad: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM properties \
         WHERE library = 'test_lib' \
         AND value_type NOT IN ('enum', 'free_text', 'array', 'date')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(bad, 0, "all bootstrapped properties should have a valid value_type");

    // Filesystem fields must not appear as bootstrapped properties.
    for name in &["file_name", "extension", "size_bytes", "created_at"] {
        let exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM properties WHERE library = 'test_lib' AND name = ?",
        )
        .bind(name)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(exists, 0, "'{name}' should not be a bootstrapped property");
    }
}
