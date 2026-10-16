mod common;

use common::setup_db;
use folderbase_lib::commands::virtual_folder::{query_virtual_folder_inner, QueryResult};
use uuid::Uuid;

// ── helpers ───────────────────────────────────────────────────────────────────

async fn insert_property(
    pool: &folderbase_lib::db::DbPool,
    name: &str,
    value_type: &str,
) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO properties (property_id, name, library, value_type) VALUES (?, ?, NULL, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(value_type)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_view(pool: &folderbase_lib::db::DbPool, name: &str) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO views (view_id, name, library, created_at, updated_at) \
         VALUES (?, ?, NULL, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
    )
    .bind(&id)
    .bind(name)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_view_node(
    pool: &folderbase_lib::db::DbPool,
    view_id: &str,
    parent_node_id: Option<&str>,
    property_id: &str,
    fork_value: Option<&str>,
    sort_order: i64,
) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO view_nodes (node_id, view_id, parent_node_id, property_id, fork_value, sort_order) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(view_id)
    .bind(parent_node_id)
    .bind(property_id)
    .bind(fork_value)
    .bind(sort_order)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_file(
    pool: &folderbase_lib::db::DbPool,
    file_path: &str,
    file_type: Option<&str>,
    library: Option<&str>,
    metadata: &str,
) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO files (file_id, file_path, file_type, timestamp, library, metadata) \
         VALUES (?, ?, ?, NULL, ?, ?)",
    )
    .bind(&id)
    .bind(file_path)
    .bind(file_type)
    .bind(library)
    .bind(metadata)
    .execute(pool)
    .await
    .unwrap();
    id
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_root_level_returns_year_folders() {
    let pool = setup_db().await;
    let prop_year = insert_property(&pool, "year", "enum").await;
    let view_id = insert_view(&pool, "By Year").await;
    insert_view_node(&pool, &view_id, None, &prop_year, None, 0).await;

    insert_file(&pool, "/a/1.jpg", None, None, r#"{"year":"2022"}"#).await;
    insert_file(&pool, "/a/2.jpg", None, None, r#"{"year":"2022"}"#).await;
    insert_file(&pool, "/a/3.jpg", None, None, r#"{"year":"2023"}"#).await;

    let result = query_virtual_folder_inner(&pool, &view_id, &[]).await.unwrap();
    let folders = match result {
        QueryResult::Folders(f) => f,
        _ => panic!("expected Folders"),
    };
    assert_eq!(folders.len(), 2);
    let f2022 = folders.iter().find(|f| f.name == "2022").unwrap();
    assert_eq!(f2022.file_count, 2);
    assert!(!f2022.has_children);
    let f2023 = folders.iter().find(|f| f.name == "2023").unwrap();
    assert_eq!(f2023.file_count, 1);
}

#[tokio::test]
async fn test_second_level_filters_by_first_segment() {
    let pool = setup_db().await;
    let prop_year = insert_property(&pool, "year", "enum").await;
    let prop_month = insert_property(&pool, "month", "enum").await;
    let view_id = insert_view(&pool, "By Year Month").await;
    let node_year = insert_view_node(&pool, &view_id, None, &prop_year, None, 0).await;
    insert_view_node(&pool, &view_id, Some(&node_year), &prop_month, None, 0).await;

    insert_file(&pool, "/a/1.jpg", None, None, r#"{"year":"2023","month":"01"}"#).await;
    insert_file(&pool, "/a/2.jpg", None, None, r#"{"year":"2023","month":"03"}"#).await;
    insert_file(&pool, "/a/3.jpg", None, None, r#"{"year":"2022","month":"06"}"#).await;

    let path = vec!["2023".to_string()];
    let result = query_virtual_folder_inner(&pool, &view_id, &path).await.unwrap();
    let folders = match result {
        QueryResult::Folders(f) => f,
        _ => panic!("expected Folders"),
    };
    // Only months belonging to 2023 files
    assert_eq!(folders.len(), 2);
    assert!(folders.iter().any(|f| f.name == "01"));
    assert!(folders.iter().any(|f| f.name == "03"));
    assert!(!folders.iter().any(|f| f.name == "06"));
}

#[tokio::test]
async fn test_file_counts_per_folder_are_accurate() {
    let pool = setup_db().await;
    let prop_year = insert_property(&pool, "year", "enum").await;
    let view_id = insert_view(&pool, "Counts").await;
    insert_view_node(&pool, &view_id, None, &prop_year, None, 0).await;

    for _ in 0..5 {
        insert_file(&pool, &format!("/x/{}.jpg", Uuid::new_v4()), None, None, r#"{"year":"2020"}"#).await;
    }
    insert_file(&pool, "/x/other.jpg", None, None, r#"{"year":"2021"}"#).await;

    let result = query_virtual_folder_inner(&pool, &view_id, &[]).await.unwrap();
    let folders = match result {
        QueryResult::Folders(f) => f,
        _ => panic!("expected Folders"),
    };
    let f2020 = folders.iter().find(|f| f.name == "2020").unwrap();
    assert_eq!(f2020.file_count, 5);
    let f2021 = folders.iter().find(|f| f.name == "2021").unwrap();
    assert_eq!(f2021.file_count, 1);
}

#[tokio::test]
async fn test_full_path_to_leaf_returns_files() {
    let pool = setup_db().await;
    let prop_year = insert_property(&pool, "year", "enum").await;
    let prop_month = insert_property(&pool, "month", "enum").await;
    let view_id = insert_view(&pool, "Leaf").await;
    let node_year = insert_view_node(&pool, &view_id, None, &prop_year, None, 0).await;
    insert_view_node(&pool, &view_id, Some(&node_year), &prop_month, None, 0).await;

    let file_id = insert_file(&pool, "/leaf/a.jpg", None, None, r#"{"year":"2023","month":"05"}"#).await;
    insert_file(&pool, "/leaf/b.jpg", None, None, r#"{"year":"2023","month":"06"}"#).await;

    let path = vec!["2023".to_string(), "05".to_string()];
    let result = query_virtual_folder_inner(&pool, &view_id, &path).await.unwrap();
    let files = match result {
        QueryResult::Files(f) => f,
        _ => panic!("expected Files"),
    };
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].file_id, file_id);
}

#[tokio::test]
async fn test_array_property_appears_in_multiple_folders() {
    let pool = setup_db().await;
    let prop_project = insert_property(&pool, "project", "enum").await;
    let view_id = insert_view(&pool, "By Project").await;
    insert_view_node(&pool, &view_id, None, &prop_project, None, 0).await;

    let shared_id = insert_file(
        &pool,
        "/shared/file.jpg",
        None,
        None,
        r#"{"project":["Apollo","Hermes"]}"#,
    )
    .await;
    insert_file(&pool, "/solo/other.jpg", None, None, r#"{"project":["Apollo"]}"#).await;

    // Both Apollo and Hermes folders should exist at root level
    let root = query_virtual_folder_inner(&pool, &view_id, &[]).await.unwrap();
    let folders = match root {
        QueryResult::Folders(f) => f,
        _ => panic!("expected Folders"),
    };
    assert!(folders.iter().any(|f| f.name == "Apollo"));
    assert!(folders.iter().any(|f| f.name == "Hermes"));

    // Apollo contains both files
    let apollo_path = vec!["Apollo".to_string()];
    let apollo_result = query_virtual_folder_inner(&pool, &view_id, &apollo_path).await.unwrap();
    let apollo_files = match apollo_result {
        QueryResult::Files(f) => f,
        _ => panic!("expected Files"),
    };
    assert_eq!(apollo_files.len(), 2);

    // Hermes contains only the shared file
    let hermes_path = vec!["Hermes".to_string()];
    let hermes_result = query_virtual_folder_inner(&pool, &view_id, &hermes_path).await.unwrap();
    let hermes_files = match hermes_result {
        QueryResult::Files(f) => f,
        _ => panic!("expected Files"),
    };
    assert_eq!(hermes_files.len(), 1);
    assert_eq!(hermes_files[0].file_id, shared_id);
}

#[tokio::test]
async fn test_forking_view() {
    let pool = setup_db().await;
    // file_type is a core column; camera_make lives in metadata
    let prop_file_type = insert_property(&pool, "file_type", "enum").await;
    let prop_camera = insert_property(&pool, "camera_make", "enum").await;
    let view_id = insert_view(&pool, "Forking").await;
    let node_type = insert_view_node(&pool, &view_id, None, &prop_file_type, None, 0).await;
    // camera_make sub-folder only active under the "image/jpeg" branch
    insert_view_node(
        &pool,
        &view_id,
        Some(&node_type),
        &prop_camera,
        Some("image/jpeg"),
        0,
    )
    .await;

    let photo1 = insert_file(&pool, "/p/a.jpg", Some("image/jpeg"), None, r#"{"camera_make":"Canon"}"#).await;
    let photo2 = insert_file(&pool, "/p/b.jpg", Some("image/jpeg"), None, r#"{"camera_make":"Nikon"}"#).await;
    let video = insert_file(&pool, "/v/c.mp4", Some("video/mp4"), None, r#"{}"#).await;
    let _ = (photo1, photo2, video);

    // Root: two distinct file_type values
    let root = query_virtual_folder_inner(&pool, &view_id, &[]).await.unwrap();
    let root_folders = match root {
        QueryResult::Folders(f) => f,
        _ => panic!("expected Folders"),
    };
    let jpeg_entry = root_folders.iter().find(|f| f.name == "image/jpeg").unwrap();
    assert_eq!(jpeg_entry.file_count, 2);
    assert!(jpeg_entry.has_children, "jpeg branch should have children");
    let mp4_entry = root_folders.iter().find(|f| f.name == "video/mp4").unwrap();
    assert_eq!(mp4_entry.file_count, 1);
    assert!(!mp4_entry.has_children, "video branch should be a leaf");

    // photos branch: shows camera sub-folders
    let photo_path = vec!["image/jpeg".to_string()];
    let photo_result = query_virtual_folder_inner(&pool, &view_id, &photo_path).await.unwrap();
    let camera_folders = match photo_result {
        QueryResult::Folders(f) => f,
        _ => panic!("expected Folders for photos branch"),
    };
    assert_eq!(camera_folders.len(), 2);
    assert!(camera_folders.iter().any(|f| f.name == "Canon"));
    assert!(camera_folders.iter().any(|f| f.name == "Nikon"));

    // videos branch: no children → returns files directly
    let video_path = vec!["video/mp4".to_string()];
    let video_result = query_virtual_folder_inner(&pool, &view_id, &video_path).await.unwrap();
    let video_files = match video_result {
        QueryResult::Files(f) => f,
        _ => panic!("expected Files for videos branch"),
    };
    assert_eq!(video_files.len(), 1);
    assert_eq!(video_files[0].file_type.as_deref(), Some("video/mp4"));
}

#[tokio::test]
async fn test_empty_view_nodes_returns_empty_folder_list() {
    let pool = setup_db().await;
    let view_id = insert_view(&pool, "Empty").await;
    // No nodes added
    insert_file(&pool, "/a/file.txt", None, None, r#"{}"#).await;

    let result = query_virtual_folder_inner(&pool, &view_id, &[]).await.unwrap();
    let folders = match result {
        QueryResult::Folders(f) => f,
        _ => panic!("expected Folders"),
    };
    assert!(folders.is_empty());
}

#[tokio::test]
async fn test_path_deeper_than_tree_returns_err() {
    let pool = setup_db().await;
    let prop_year = insert_property(&pool, "year", "enum").await;
    let view_id = insert_view(&pool, "Single Level").await;
    insert_view_node(&pool, &view_id, None, &prop_year, None, 0).await;

    insert_file(&pool, "/a/file.jpg", None, None, r#"{"year":"2023"}"#).await;

    // path has 2 segments but tree only has 1 level → Err
    let path = vec!["2023".to_string(), "extra".to_string()];
    let result = query_virtual_folder_inner(&pool, &view_id, &path).await;
    assert!(result.is_err(), "expected Err for path deeper than tree");
    assert!(result.unwrap_err().contains("deeper"));
}

#[tokio::test]
async fn test_property_names_with_spaces_and_punctuation() {
    let pool = setup_db().await;
    // A space, an apostrophe and a dot: each broke the old unquoted '$.name' paths
    let prop_date = insert_property(&pool, "shoot date", "enum").await;
    let prop_client = insert_property(&pool, "client's name", "array").await;
    let prop_ver = insert_property(&pool, "v1.2", "enum").await;
    let view_id = insert_view(&pool, "Awkward names").await;
    let n1 = insert_view_node(&pool, &view_id, None, &prop_date, None, 0).await;
    let n2 = insert_view_node(&pool, &view_id, Some(&n1), &prop_client, None, 0).await;
    insert_view_node(&pool, &view_id, Some(&n2), &prop_ver, None, 0).await;

    insert_file(
        &pool,
        "/a/1.jpg",
        None,
        None,
        r#"{"shoot date":"2024-03-01","client's name":["Acme","Globex"],"v1.2":"final"}"#,
    )
    .await;
    insert_file(&pool, "/a/2.jpg", None, None, r#"{"shoot date":"2024-04-01"}"#).await;

    let root = query_virtual_folder_inner(&pool, &view_id, &[]).await.unwrap();
    let QueryResult::Folders(dates) = root else { panic!("expected Folders") };
    assert_eq!(dates.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["2024-03-01", "2024-04-01"]);

    let path = vec!["2024-03-01".to_string()];
    let QueryResult::Folders(clients) = query_virtual_folder_inner(&pool, &view_id, &path).await.unwrap() else {
        panic!("expected Folders")
    };
    assert_eq!(clients.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["Acme", "Globex"]);

    let path = vec!["2024-03-01".to_string(), "Globex".to_string()];
    let QueryResult::Folders(versions) = query_virtual_folder_inner(&pool, &view_id, &path).await.unwrap() else {
        panic!("expected Folders")
    };
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].name, "final");
}
