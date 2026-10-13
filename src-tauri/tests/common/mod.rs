use folderbase_lib::db::{run_migrations, DbPool};
use sqlx::SqlitePool;

pub async fn setup_db() -> DbPool {
    let pool = SqlitePool::connect(":memory:").await.unwrap();
    run_migrations(&pool).await.unwrap();
    pool
}
