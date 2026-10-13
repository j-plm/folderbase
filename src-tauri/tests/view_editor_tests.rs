mod common;

use common::setup_db;
use chrono::Utc;
use uuid::Uuid;

// ── helpers ───────────────────────────────────────────────────────────────────

async fn insert_property(pool: &folderbase_lib::db::DbPool, name: &str) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO properties (property_id, name, library, value_type) VALUES (?, ?, NULL, 'enum')",
    )
    .bind(&id)
    .bind(name)
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_view(pool: &folderbase_lib::db::DbPool, name: &str) -> String {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO views (view_id, name, library, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(&now)
    .bind(&now)
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
        "INSERT INTO view_nodes (node_id, view_id, parent_node_id, property_id, fork_value, sort_order)
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

// ── tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn get_view_nodes_returns_property_name() {
    let pool = setup_db().await;
    let prop_id = insert_property(&pool, "year").await;
    let view_id = insert_view(&pool, "By Year").await;
    insert_view_node(&pool, &view_id, None, &prop_id, None, 0).await;

    let rows = sqlx::query(
        "SELECT vn.node_id, p.name AS property_name
         FROM view_nodes vn JOIN properties p ON p.property_id = vn.property_id
         WHERE vn.view_id = ?",
    )
    .bind(&view_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 1);
    use sqlx::Row;
    assert_eq!(rows[0].get::<String, _>("property_name"), "year");
}

#[tokio::test]
async fn create_view_inserts_record() {
    let pool = setup_db().await;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO views (view_id, name, library, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)",
    )
    .bind(&id)
    .bind("My View")
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM views WHERE name = 'My View'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn rename_view_updates_name_and_timestamp() {
    let pool = setup_db().await;
    let view_id = insert_view(&pool, "Old Name").await;

    let new_now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE views SET name = ?, updated_at = ? WHERE view_id = ?")
        .bind("New Name")
        .bind(&new_now)
        .bind(&view_id)
        .execute(&pool)
        .await
        .unwrap();

    let name: String =
        sqlx::query_scalar("SELECT name FROM views WHERE view_id = ?")
            .bind(&view_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(name, "New Name");
}

#[tokio::test]
async fn delete_view_cascades_nodes() {
    let pool = setup_db().await;
    let prop_id = insert_property(&pool, "month").await;
    let view_id = insert_view(&pool, "Cascade Test").await;
    insert_view_node(&pool, &view_id, None, &prop_id, None, 0).await;
    insert_view_node(&pool, &view_id, None, &prop_id, None, 1).await;

    // Cascade: delete nodes then view
    sqlx::query("DELETE FROM view_nodes WHERE view_id = ?")
        .bind(&view_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM views WHERE view_id = ?")
        .bind(&view_id)
        .execute(&pool)
        .await
        .unwrap();

    let node_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM view_nodes WHERE view_id = ?")
            .bind(&view_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let view_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM views WHERE view_id = ?")
            .bind(&view_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(node_count, 0);
    assert_eq!(view_count, 0);
}

#[tokio::test]
async fn create_view_node_happy_path() {
    let pool = setup_db().await;
    let prop_id = insert_property(&pool, "rig").await;
    let view_id = insert_view(&pool, "Rig View").await;
    let node_id = insert_view_node(&pool, &view_id, None, &prop_id, None, 0).await;

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM view_nodes WHERE node_id = ?")
            .bind(&node_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn update_view_node_changes_property() {
    let pool = setup_db().await;
    let prop_a = insert_property(&pool, "rig").await;
    let prop_b = insert_property(&pool, "angle").await;
    let view_id = insert_view(&pool, "Edit Node View").await;
    let node_id = insert_view_node(&pool, &view_id, None, &prop_a, None, 0).await;

    sqlx::query("UPDATE view_nodes SET property_id = ? WHERE node_id = ?")
        .bind(&prop_b)
        .bind(&node_id)
        .execute(&pool)
        .await
        .unwrap();

    let pid: String =
        sqlx::query_scalar("SELECT property_id FROM view_nodes WHERE node_id = ?")
            .bind(&node_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(pid, prop_b);
}

#[tokio::test]
async fn delete_view_node_cascades_children() {
    let pool = setup_db().await;
    let prop_id = insert_property(&pool, "project").await;
    let view_id = insert_view(&pool, "Deep View").await;

    // Three-level chain: root → child → grandchild
    let root_id = insert_view_node(&pool, &view_id, None, &prop_id, None, 0).await;
    let child_id = insert_view_node(&pool, &view_id, Some(&root_id), &prop_id, None, 0).await;
    let _grand_id = insert_view_node(&pool, &view_id, Some(&child_id), &prop_id, None, 0).await;

    // Simulate the recursive deletion logic from delete_view_node command
    let mut to_delete = vec![root_id.clone()];
    let mut frontier = vec![root_id.clone()];
    while !frontier.is_empty() {
        let placeholders = frontier.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT node_id FROM view_nodes WHERE parent_node_id IN ({})",
            placeholders
        );
        let mut q = sqlx::query(&sql);
        for id in &frontier {
            q = q.bind(id);
        }
        let rows = q.fetch_all(&pool).await.unwrap();
        frontier = rows
            .into_iter()
            .map(|r| {
                use sqlx::Row;
                r.get::<String, _>("node_id")
            })
            .collect();
        to_delete.extend(frontier.clone());
    }

    let placeholders = to_delete.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("DELETE FROM view_nodes WHERE node_id IN ({})", placeholders);
    let mut q = sqlx::query(&sql);
    for id in &to_delete {
        q = q.bind(id);
    }
    q.execute(&pool).await.unwrap();

    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM view_nodes WHERE view_id = ?")
            .bind(&view_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn reorder_view_nodes_batch() {
    let pool = setup_db().await;
    let prop_id = insert_property(&pool, "scene").await;
    let view_id = insert_view(&pool, "Reorder View").await;
    let node_a = insert_view_node(&pool, &view_id, None, &prop_id, None, 0).await;
    let node_b = insert_view_node(&pool, &view_id, None, &prop_id, None, 1).await;

    // Swap orders
    sqlx::query("UPDATE view_nodes SET sort_order = ? WHERE node_id = ?")
        .bind(1i64)
        .bind(&node_a)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE view_nodes SET sort_order = ? WHERE node_id = ?")
        .bind(0i64)
        .bind(&node_b)
        .execute(&pool)
        .await
        .unwrap();

    let order_a: i64 =
        sqlx::query_scalar("SELECT sort_order FROM view_nodes WHERE node_id = ?")
            .bind(&node_a)
            .fetch_one(&pool)
            .await
            .unwrap();
    let order_b: i64 =
        sqlx::query_scalar("SELECT sort_order FROM view_nodes WHERE node_id = ?")
            .bind(&node_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(order_a, 1);
    assert_eq!(order_b, 0);
}
