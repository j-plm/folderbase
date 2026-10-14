pub mod utils;

pub type DbPool = sqlx::SqlitePool;

pub async fn run_migrations(pool: &DbPool) -> Result<(), sqlx::Error> {
    sqlx::query("PRAGMA journal_mode=WAL").execute(pool).await?;
    sqlx::query("PRAGMA foreign_keys=ON").execute(pool).await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS files (
            file_id    TEXT PRIMARY KEY,
            file_path  TEXT NOT NULL,
            file_type  TEXT,
            timestamp  TEXT,
            library    TEXT,
            metadata   TEXT
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_files_file_path ON files(file_path)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS properties (
            property_id  TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            library      TEXT,
            value_type   TEXT NOT NULL
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS property_values (
            value_id     TEXT PRIMARY KEY,
            property_id  TEXT NOT NULL REFERENCES properties(property_id),
            value        TEXT NOT NULL
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS views (
            view_id     TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            library     TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS view_nodes (
            node_id        TEXT PRIMARY KEY,
            view_id        TEXT NOT NULL REFERENCES views(view_id),
            parent_node_id TEXT REFERENCES view_nodes(node_id),
            property_id    TEXT NOT NULL REFERENCES properties(property_id),
            fork_value     TEXT,
            sort_order     INTEGER NOT NULL DEFAULT 0
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS locations (
            location_id   TEXT PRIMARY KEY,
            name          TEXT NOT NULL,
            root_path     TEXT NOT NULL UNIQUE,
            library       TEXT NOT NULL UNIQUE,
            added_at      TEXT NOT NULL,
            last_indexed  TEXT
        )"#,
    )
    .execute(pool)
    .await?;

    // ADD COLUMN is idempotent-by-ignore: duplicate column name errors are expected on
    // repeat migrations and are intentionally swallowed.
    let _ = sqlx::query(
        "ALTER TABLE files ADD COLUMN location_id TEXT REFERENCES locations(location_id)",
    )
    .execute(pool)
    .await;

    let _ = sqlx::query("ALTER TABLE files ADD COLUMN relative_path TEXT")
        .execute(pool)
        .await;

    let _ = sqlx::query("ALTER TABLE files ADD COLUMN file_size INTEGER")
        .execute(pool)
        .await;

    let _ = sqlx::query("ALTER TABLE files ADD COLUMN modified_at TEXT")
        .execute(pool)
        .await;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_files_location_id ON files(location_id)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS path_mapping_nodes (
            node_id        TEXT PRIMARY KEY,
            location_id    TEXT NOT NULL REFERENCES locations(location_id),
            folder_path    TEXT NOT NULL,
            property_name  TEXT NOT NULL,
            depth          INTEGER NOT NULL,
            created_at     TEXT NOT NULL,
            updated_at     TEXT NOT NULL,
            UNIQUE(location_id, folder_path)
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_pmn_location ON path_mapping_nodes(location_id)",
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query("ALTER TABLE files ADD COLUMN created_at TEXT")
        .execute(pool)
        .await;

    let _ = sqlx::query("ALTER TABLE files ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
        .execute(pool)
        .await;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_files_tags ON files(tags)",
    )
    .execute(pool)
    .await?;

    // Backfill tags for existing files that have relative_path but still carry
    // the empty-array default (i.e. were indexed before the tags feature existed).
    {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT file_id, relative_path FROM files \
             WHERE tags = '[]' AND relative_path IS NOT NULL",
        )
        .fetch_all(pool)
        .await?;

        for row in rows {
            let file_id: String = row.try_get("file_id")?;
            let rel_path: String = row.try_get("relative_path")?;
            let parts: Vec<&str> = rel_path.split('/').collect();
            let folder_count = parts.len().saturating_sub(1);
            if folder_count == 0 {
                continue;
            }
            let tags_json =
                serde_json::to_string(&parts[..folder_count]).unwrap_or_else(|_| "[]".to_string());
            sqlx::query("UPDATE files SET tags = ? WHERE file_id = ?")
                .bind(&tags_json)
                .bind(&file_id)
                .execute(pool)
                .await?;
        }
    }

    // Remove filesystem-derived properties that were mistakenly bootstrapped from
    // the metadata blob in earlier builds. These belong in dedicated columns, not
    // the property registry. Cascade via DELETE on property_values FK.
    for name in &["file_name", "extension", "size_bytes", "created_at"] {
        // Collect property_ids to delete their values first (no ON DELETE CASCADE).
        let ids: Vec<(String,)> =
            sqlx::query_as("SELECT property_id FROM properties WHERE name = ?")
                .bind(name)
                .fetch_all(pool)
                .await?;
        for (pid,) in ids {
            sqlx::query("DELETE FROM property_values WHERE property_id = ?")
                .bind(&pid)
                .execute(pool)
                .await?;
        }
        sqlx::query("DELETE FROM properties WHERE name = ?")
            .bind(name)
            .execute(pool)
            .await?;

        // Strip the key from every existing metadata blob.
        sqlx::query(
            "UPDATE files SET metadata = json_remove(metadata, '$.' || ?) \
             WHERE json_extract(metadata, '$.' || ?) IS NOT NULL",
        )
        .bind(name)
        .bind(name)
        .execute(pool)
        .await?;
    }

    // Step 2: for each existing mapping node, remove its folder_name from tags
    // where the file's metadata already carries that value (handles the case where
    // set_folder_label ran before the tags backfill populated tags).
    {
        use sqlx::Row;
        let mapping_rows = sqlx::query(
            "SELECT pmn.location_id, pmn.folder_path, pmn.property_name, l.root_path \
             FROM path_mapping_nodes pmn \
             JOIN locations l USING (location_id)",
        )
        .fetch_all(pool)
        .await?;

        for mrow in mapping_rows {
            let location_id: String = mrow.try_get("location_id")?;
            let folder_path: String = mrow.try_get("folder_path")?;
            let property_name: String = mrow.try_get("property_name")?;
            let root_path: String = mrow.try_get("root_path")?;

            let folder_rel = folder_path
                .strip_prefix(&root_path)
                .map(|s| s.trim_start_matches('/').to_string())
                .unwrap_or_else(|| folder_path.clone());
            let folder_name = folder_rel.split('/').last().unwrap_or("").to_string();
            if folder_name.is_empty() {
                continue;
            }
            let prop_key = format!("$.{}", property_name);

            sqlx::query(
                "UPDATE files \
                 SET tags = COALESCE(\
                   (SELECT json_group_array(value) FROM json_each(tags) WHERE value != ?), \
                   '[]' \
                 ) \
                 WHERE location_id = ? \
                 AND (relative_path = ? OR relative_path LIKE ? || '/%') \
                 AND json_extract(metadata, ?) = ?",
            )
            .bind(&folder_name)
            .bind(&location_id)
            .bind(&folder_rel)
            .bind(&folder_rel)
            .bind(&prop_key)
            .bind(&folder_name)
            .execute(pool)
            .await?;
        }
    }

    prune_orphan_mapping_keys(pool).await?;

    Ok(())
}

/// Removes metadata keys left behind by earlier builds, which saved the folder
/// mapping name on every keystroke ("Ho", "Hom", "Home"). A key is an orphan when,
/// on a file under a mapped folder, it holds that folder's name alongside the
/// folder's current property, and no mapping in the location uses the key.
async fn prune_orphan_mapping_keys(pool: &DbPool) -> Result<(), sqlx::Error> {
    use sqlx::Row;
    use std::collections::{HashMap, HashSet};

    let mapping_rows = sqlx::query(
        "SELECT pmn.location_id, pmn.folder_path, pmn.property_name, l.root_path \
         FROM path_mapping_nodes pmn \
         JOIN locations l USING (location_id)",
    )
    .fetch_all(pool)
    .await?;

    let mut names_by_location: HashMap<String, HashSet<String>> = HashMap::new();
    for row in &mapping_rows {
        names_by_location
            .entry(row.try_get("location_id")?)
            .or_default()
            .insert(row.try_get("property_name")?);
    }

    for row in &mapping_rows {
        let location_id: String = row.try_get("location_id")?;
        let folder_path: String = row.try_get("folder_path")?;
        let property_name: String = row.try_get("property_name")?;
        let root_path: String = row.try_get("root_path")?;

        let folder_rel = folder_path
            .strip_prefix(&root_path)
            .map(|s| s.trim_start_matches('/').to_string())
            .unwrap_or_else(|| folder_path.clone());
        let folder_name = folder_rel.split('/').last().unwrap_or("").to_string();
        if folder_name.is_empty() {
            continue;
        }
        let mapped_names = &names_by_location[&location_id];

        let files = sqlx::query(
            "SELECT file_id, metadata FROM files \
             WHERE location_id = ? \
             AND (relative_path = ? OR relative_path LIKE ? || '/%') \
             AND json_extract(metadata, '$.' || ?) = ?",
        )
        .bind(&location_id)
        .bind(&folder_rel)
        .bind(&folder_rel)
        .bind(&property_name)
        .bind(&folder_name)
        .fetch_all(pool)
        .await?;

        for file in files {
            let file_id: String = file.try_get("file_id")?;
            let raw: String = file.try_get("metadata")?;
            let Ok(serde_json::Value::Object(mut meta)) = serde_json::from_str(&raw) else {
                continue;
            };
            let before = meta.len();
            meta.retain(|key, value| {
                key.starts_with('_')
                    || mapped_names.contains(key)
                    || value.as_str() != Some(folder_name.as_str())
            });
            if meta.len() == before {
                continue;
            }
            sqlx::query("UPDATE files SET metadata = ? WHERE file_id = ?")
                .bind(serde_json::Value::Object(meta).to_string())
                .bind(&file_id)
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}
