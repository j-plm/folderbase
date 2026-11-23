use folderbase_lib::db::{run_migrations, DbPool};
use sqlx::SqlitePool;

#[allow(dead_code)]
pub async fn setup_db() -> DbPool {
    let pool = SqlitePool::connect(":memory:").await.unwrap();
    run_migrations(&pool).await.unwrap();
    pool
}

/// A database in a file at `path`, migrated (so in WAL mode, as the app's is).
/// For tests that need a real file: backups, and anything reading the log.
#[allow(dead_code)]
pub async fn setup_file_db(path: &std::path::Path) -> DbPool {
    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(path).create_if_missing(true);
    let pool = sqlx::sqlite::SqlitePoolOptions::new().connect_with(options).await.unwrap();
    run_migrations(&pool).await.unwrap();
    pool
}

/// A new, empty folder in the system's temporary folder.
#[allow(dead_code)]
pub fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("folderbase-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
