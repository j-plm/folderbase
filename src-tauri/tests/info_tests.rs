mod common;

use folderbase_lib::commands::files::files_by_paths_impl;

async fn insert(pool: &sqlx::SqlitePool, id: &str, path: &str) {
    sqlx::query("INSERT INTO files (file_id, file_path, library, metadata) VALUES (?, ?, 'lib', '{}')")
        .bind(id)
        .bind(path)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn files_are_found_by_path_in_the_order_asked() {
    let pool = common::setup_db().await;
    insert(&pool, "a", "/x/a.pdf").await;
    insert(&pool, "b", "/x/b.pdf").await;
    let found = files_by_paths_impl(&pool, &["/x/b.pdf".into(), "/x/a.pdf".into()]).await.unwrap();
    let ids: Vec<_> = found.iter().map(|f| f.file_id.as_str()).collect();
    assert_eq!(ids, vec!["b", "a"]);
}

#[tokio::test]
async fn paths_not_indexed_are_left_out() {
    let pool = common::setup_db().await;
    insert(&pool, "a", "/x/a.pdf").await;
    let found = files_by_paths_impl(&pool, &["/x/gone.pdf".into(), "/x/a.pdf".into()]).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].file_id, "a");
    assert!(files_by_paths_impl(&pool, &[]).await.unwrap().is_empty());
}
