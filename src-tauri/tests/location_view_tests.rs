mod common;

use common::setup_db;
use folderbase_lib::commands::location_views::{delete_location_view_impl, get_location_views_impl, save_location_view_impl};
use folderbase_lib::commands::metadata::rename_property_impl;
use folderbase_lib::db::DbPool;
use folderbase_lib::models::LocationView;
use serde_json::{json, Value};
use uuid::Uuid;

fn view(location_id: &str, name: &str, is_default: bool, definition: Value) -> LocationView {
    LocationView {
        view_id: String::new(),
        location_id: location_id.into(),
        name: name.into(),
        is_default,
        position: 0,
        definition: definition.to_string(),
        draft: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

async fn insert_location(pool: &DbPool, library: &str) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO locations (location_id, name, root_path, library, added_at) VALUES (?, ?, ?, ?, '')")
        .bind(&id)
        .bind(library)
        .bind(format!("/tmp/{library}"))
        .bind(library)
        .execute(pool)
        .await
        .unwrap();
    id
}

#[tokio::test]
async fn views_list_default_first_then_in_order() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    save_location_view_impl(&pool, view(&loc, "By Client", false, json!({ "table": {} }))).await.unwrap();
    save_location_view_impl(&pool, view(&loc, "Default", true, json!({ "table": {} }))).await.unwrap();
    save_location_view_impl(&pool, view(&loc, "Unbilled", false, json!({ "table": {} }))).await.unwrap();
    let names: Vec<String> = get_location_views_impl(&pool, &loc).await.unwrap().into_iter().map(|v| v.name).collect();
    assert_eq!(names, ["Default", "By Client", "Unbilled"]);
    // Other locations' views aren't included
    let other = insert_location(&pool, "photos").await;
    assert!(get_location_views_impl(&pool, &other).await.unwrap().is_empty());
}

#[tokio::test]
async fn saving_updates_in_place_and_keeps_a_draft() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    let mut v = save_location_view_impl(&pool, view(&loc, "By Client", false, json!({ "table": { "frozen": true } }))).await.unwrap();
    v.draft = Some(json!({ "table": { "frozen": false } }).to_string());
    v.name = "  Clients  ".into();
    save_location_view_impl(&pool, v.clone()).await.unwrap();
    let stored = get_location_views_impl(&pool, &loc).await.unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].view_id, v.view_id);
    assert_eq!(stored[0].name, "Clients");
    assert_eq!(stored[0].draft, v.draft);
}

#[tokio::test]
async fn default_view_never_keeps_a_draft_and_is_unique() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    let mut d = view(&loc, "Default", true, json!({ "table": {} }));
    d.draft = Some("{}".into());
    let d = save_location_view_impl(&pool, d).await.unwrap();
    assert_eq!(d.draft, None);
    assert!(save_location_view_impl(&pool, view(&loc, "Another", true, json!({ "table": {} }))).await.is_err());
}

#[tokio::test]
async fn rejects_empty_names_clashes_and_bad_json() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    assert!(save_location_view_impl(&pool, view(&loc, "  ", false, json!({}))).await.is_err());
    save_location_view_impl(&pool, view(&loc, "By Client", false, json!({}))).await.unwrap();
    let err = save_location_view_impl(&pool, view(&loc, "by client", false, json!({}))).await.unwrap_err();
    assert!(err.contains("already"), "{err}");
    let mut bad = view(&loc, "Bad", false, json!({}));
    bad.definition = "{not json".into();
    assert!(save_location_view_impl(&pool, bad).await.is_err());
    // The same name in another location is fine
    let other = insert_location(&pool, "photos").await;
    save_location_view_impl(&pool, view(&other, "By Client", false, json!({}))).await.unwrap();
}

#[tokio::test]
async fn deletes_named_views_but_not_the_default() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    let d = save_location_view_impl(&pool, view(&loc, "Default", true, json!({}))).await.unwrap();
    let n = save_location_view_impl(&pool, view(&loc, "By Client", false, json!({}))).await.unwrap();
    assert!(delete_location_view_impl(&pool, &d.view_id).await.is_err());
    delete_location_view_impl(&pool, &n.view_id).await.unwrap();
    let left = get_location_views_impl(&pool, &loc).await.unwrap();
    assert_eq!(left.len(), 1);
    assert!(left[0].is_default);
}

#[tokio::test]
async fn renaming_a_property_updates_views_and_drafts_in_its_library() {
    let pool = setup_db().await;
    let docs = insert_location(&pool, "docs").await;
    let photos = insert_location(&pool, "photos").await;
    let prop = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO properties (property_id, name, library, value_type) VALUES (?, 'Client', 'docs', 'enum')")
        .bind(&prop)
        .execute(&pool)
        .await
        .unwrap();
    let def = json!({ "table": { "visibleProperties": ["Client"], "sorts": [{ "key": "prop:Client", "direction": "asc" }] } });
    let mut v = view(&docs, "By Client", false, def.clone());
    v.draft = Some(json!({ "table": { "groups": [{ "key": "prop:Client" }] } }).to_string());
    save_location_view_impl(&pool, v).await.unwrap();
    save_location_view_impl(&pool, view(&photos, "Theirs", false, def.clone())).await.unwrap();

    rename_property_impl(&pool, &prop, "Customer").await.unwrap();

    let mine = &get_location_views_impl(&pool, &docs).await.unwrap()[0];
    let saved: Value = serde_json::from_str(&mine.definition).unwrap();
    assert_eq!(saved["table"]["visibleProperties"], json!(["Customer"]));
    assert_eq!(saved["table"]["sorts"][0]["key"], "prop:Customer");
    let draft: Value = serde_json::from_str(mine.draft.as_deref().unwrap()).unwrap();
    assert_eq!(draft["table"]["groups"][0]["key"], "prop:Customer");
    // Another library's "Client" is a different property
    let theirs: Value = serde_json::from_str(&get_location_views_impl(&pool, &photos).await.unwrap()[0].definition).unwrap();
    assert_eq!(theirs["table"]["visibleProperties"], json!(["Client"]));
}
