mod common;

use folderbase_lib::commands::settings::{load, migrate_from_db, save, AppSettings};
use std::path::PathBuf;

fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("folderbase-settings-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

async fn table_exists(pool: &folderbase_lib::db::DbPool) -> bool {
    sqlx::query("SELECT 1 FROM app_settings").fetch_all(pool).await.is_ok()
}

#[tokio::test]
async fn settings_in_the_old_table_move_into_the_file() {
    let pool = common::setup_db().await;
    sqlx::query("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO app_settings VALUES ('zip_folder', '/Users/sam/Zips')").execute(&pool).await.unwrap();
    let dir = temp_dir();

    migrate_from_db(&pool, &dir).await.unwrap();
    assert_eq!(load(&dir).zip_folder.as_deref(), Some("/Users/sam/Zips"));
    assert!(!table_exists(&pool).await);

    // Once moved, running again changes nothing
    migrate_from_db(&pool, &dir).await.unwrap();
    assert_eq!(load(&dir).zip_folder.as_deref(), Some("/Users/sam/Zips"));
}

#[tokio::test]
async fn an_existing_file_wins_over_the_old_table() {
    let pool = common::setup_db().await;
    sqlx::query("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO app_settings VALUES ('zip_folder', '/old')").execute(&pool).await.unwrap();
    let dir = temp_dir();
    save(&dir, &AppSettings { zip_folder: Some("/new".into()), ..AppSettings::default() }).unwrap();

    migrate_from_db(&pool, &dir).await.unwrap();
    assert_eq!(load(&dir).zip_folder.as_deref(), Some("/new"));
    assert!(!table_exists(&pool).await);
}

#[tokio::test]
async fn a_new_database_has_no_settings_table_and_nothing_to_move() {
    let pool = common::setup_db().await;
    assert!(!table_exists(&pool).await);
    let dir = temp_dir();
    migrate_from_db(&pool, &dir).await.unwrap();
    assert_eq!(load(&dir), AppSettings::default());
    assert!(!dir.join("settings.json").exists());
}
