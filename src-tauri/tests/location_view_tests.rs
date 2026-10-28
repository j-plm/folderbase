mod common;

use common::setup_db;
use folderbase_lib::commands::location_views::{
    delete_location_view_impl, get_location_views_impl, reorder_location_views_impl, save_location_view_impl,
    set_default_location_view_impl,
};
use folderbase_lib::commands::metadata::{rename_property_impl, rename_property_value_impl};
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

async fn names(pool: &DbPool, loc: &str) -> Vec<String> {
    get_location_views_impl(pool, loc).await.unwrap().into_iter().map(|v| v.name).collect()
}

#[tokio::test]
async fn views_list_in_order_wherever_the_default_is() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    save_location_view_impl(&pool, view(&loc, "By Client", false, json!({ "table": {} }))).await.unwrap();
    save_location_view_impl(&pool, view(&loc, "Default", true, json!({ "table": {} }))).await.unwrap();
    save_location_view_impl(&pool, view(&loc, "Unbilled", false, json!({ "table": {} }))).await.unwrap();
    assert_eq!(names(&pool, &loc).await, ["By Client", "Default", "Unbilled"]);
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

#[tokio::test]
async fn renaming_a_value_moves_its_folder_branch() {
    let pool = setup_db().await;
    let docs = insert_location(&pool, "docs").await;
    let prop = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO properties (property_id, name, library, value_type) VALUES (?, 'Client', 'docs', 'enum')")
        .bind(&prop)
        .execute(&pool)
        .await
        .unwrap();
    let below = json!({ "column": "prop:Year", "direction": "asc", "next": null, "branches": {} });
    let def = json!({
        "table": {},
        "folders": { "root": { "column": "prop:Client", "direction": "asc", "next": null, "branches": { "Acme": below } } }
    });
    save_location_view_impl(&pool, view(&docs, "Folders", false, def)).await.unwrap();

    rename_property_value_impl(&pool, &prop, "Acme", "Acme Ltd").await.unwrap();

    let saved: Value = serde_json::from_str(&get_location_views_impl(&pool, &docs).await.unwrap()[0].definition).unwrap();
    let branches = &saved["folders"]["root"]["branches"];
    assert_eq!(branches["Acme Ltd"], below);
    assert!(branches.get("Acme").is_none());
}

#[tokio::test]
async fn reordering_named_views_leaves_the_default_and_other_locations_alone() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    let other = insert_location(&pool, "photos").await;
    save_location_view_impl(&pool, view(&loc, "Default", true, json!({ "table": {} }))).await.unwrap();
    let a = save_location_view_impl(&pool, view(&loc, "A", false, json!({ "table": {} }))).await.unwrap();
    let b = save_location_view_impl(&pool, view(&loc, "B", false, json!({ "table": {} }))).await.unwrap();
    let c = save_location_view_impl(&pool, view(&loc, "C", false, json!({ "table": {} }))).await.unwrap();
    let elsewhere = save_location_view_impl(&pool, view(&other, "X", false, json!({ "table": {} }))).await.unwrap();

    reorder_location_views_impl(&pool, &loc, &[c.view_id.clone(), a.view_id.clone(), b.view_id.clone()]).await.unwrap();
    let names: Vec<String> = get_location_views_impl(&pool, &loc).await.unwrap().into_iter().map(|v| v.name).collect();
    assert_eq!(names, ["Default", "C", "A", "B"]);

    // A view of another location isn't moved by this one's order
    reorder_location_views_impl(&pool, &loc, &[elsewhere.view_id.clone()]).await.unwrap();
    assert_eq!(get_location_views_impl(&pool, &other).await.unwrap()[0].position, elsewhere.position);

    // Saving a view (a rename, an edit) keeps its place
    save_location_view_impl(&pool, LocationView { name: "Alpha".into(), ..a }).await.unwrap();
    let names: Vec<String> = get_location_views_impl(&pool, &loc).await.unwrap().into_iter().map(|v| v.name).collect();
    assert_eq!(names, ["Default", "C", "Alpha", "B"]);
}

#[tokio::test]
async fn views_made_before_reordering_the_default_list_it_first() {
    // The default was made at position 0, and reordering named views numbered them from 0
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    save_location_view_impl(&pool, view(&loc, "Default", true, json!({}))).await.unwrap();
    let a = save_location_view_impl(&pool, view(&loc, "A", false, json!({}))).await.unwrap();
    let b = save_location_view_impl(&pool, view(&loc, "B", false, json!({}))).await.unwrap();
    reorder_location_views_impl(&pool, &loc, &[b.view_id, a.view_id]).await.unwrap();
    assert_eq!(names(&pool, &loc).await, ["Default", "B", "A"]);
}

#[tokio::test]
async fn the_default_view_reorders_with_the_rest() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    let d = save_location_view_impl(&pool, view(&loc, "Default", true, json!({}))).await.unwrap();
    let a = save_location_view_impl(&pool, view(&loc, "A", false, json!({}))).await.unwrap();
    reorder_location_views_impl(&pool, &loc, &[a.view_id, d.view_id]).await.unwrap();
    assert_eq!(names(&pool, &loc).await, ["A", "Default"]);
}

#[tokio::test]
async fn the_default_view_can_be_renamed() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    let mut d = save_location_view_impl(&pool, view(&loc, "Default", true, json!({}))).await.unwrap();
    d.name = "Everything".into();
    save_location_view_impl(&pool, d).await.unwrap();
    let stored = get_location_views_impl(&pool, &loc).await.unwrap();
    assert_eq!(stored[0].name, "Everything");
    assert!(stored[0].is_default);
}

#[tokio::test]
async fn setting_the_default_moves_it_and_saves_its_edits() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    let d = save_location_view_impl(&pool, view(&loc, "Default", true, json!({ "table": { "frozen": true } }))).await.unwrap();
    let mut n = view(&loc, "By Client", false, json!({ "table": { "frozen": false } }));
    n.draft = Some(json!({ "table": { "frozen": true, "noWrap": ["Client"] } }).to_string());
    let n = save_location_view_impl(&pool, n).await.unwrap();

    let views = set_default_location_view_impl(&pool, &n.view_id).await.unwrap();
    let made = views.iter().find(|v| v.view_id == n.view_id).unwrap();
    assert!(made.is_default);
    // The default saves as it changes: what it showed is now what it is
    assert_eq!(made.draft, None);
    let def: Value = serde_json::from_str(&made.definition).unwrap();
    assert_eq!(def["table"]["noWrap"], json!(["Client"]));
    let old = views.iter().find(|v| v.view_id == d.view_id).unwrap();
    assert!(!old.is_default);
    // The order is unchanged, and the old default can now be deleted
    assert_eq!(names(&pool, &loc).await, ["Default", "By Client"]);
    assert!(delete_location_view_impl(&pool, &n.view_id).await.is_err());
    delete_location_view_impl(&pool, &d.view_id).await.unwrap();
}

#[tokio::test]
async fn setting_the_default_of_a_missing_view_fails_and_leaves_others_alone() {
    let pool = setup_db().await;
    let loc = insert_location(&pool, "docs").await;
    let other = insert_location(&pool, "photos").await;
    let d = save_location_view_impl(&pool, view(&loc, "Default", true, json!({}))).await.unwrap();
    let theirs = save_location_view_impl(&pool, view(&other, "Default", true, json!({}))).await.unwrap();
    assert!(set_default_location_view_impl(&pool, "nope").await.is_err());
    // Making the default again is harmless; another location's default is untouched
    set_default_location_view_impl(&pool, &d.view_id).await.unwrap();
    assert!(get_location_views_impl(&pool, &other).await.unwrap()[0].is_default);
    assert_eq!(get_location_views_impl(&pool, &other).await.unwrap()[0].view_id, theirs.view_id);
}
