mod common;

use common::setup_db;
use folderbase_lib::commands::metadata::rename_property_value_impl;
use folderbase_lib::commands::scopes::{
    drop_condition_value, drop_property_scopes, get_property_scopes_impl, set_property_scope_impl,
};
use folderbase_lib::db::DbPool;
use folderbase_lib::models::ScopeCondition;
use uuid::Uuid;

async fn property(pool: &DbPool, name: &str, value_type: &str) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO properties (property_id, name, library, value_type) VALUES (?, ?, 'docs', ?)")
        .bind(&id)
        .bind(name)
        .bind(value_type)
        .execute(pool)
        .await
        .unwrap();
    id
}

fn when(property_id: &str, value: &str) -> ScopeCondition {
    ScopeCondition { property_id: property_id.to_string(), value: value.to_string() }
}

async fn conditions_of(pool: &DbPool, property_id: &str) -> Vec<(String, String)> {
    get_property_scopes_impl(pool, Some("docs"))
        .await
        .unwrap()
        .into_iter()
        .filter(|s| s.property_id == property_id)
        .map(|s| (s.condition_property_id, s.value))
        .collect()
}

#[tokio::test]
async fn sets_replaces_and_clears_a_scope() {
    let pool = setup_db().await;
    let tags = property(&pool, "Tags", "array").await;
    let housing = property(&pool, "Housing", "enum").await;

    set_property_scope_impl(&pool, &housing, &[when(&tags, "housing")]).await.unwrap();
    assert_eq!(conditions_of(&pool, &housing).await, vec![(tags.clone(), "housing".to_string())]);

    // Several conditions (any of them) replace the old ones
    set_property_scope_impl(&pool, &housing, &[when(&tags, "home"), when(&tags, "flat")]).await.unwrap();
    let mut values: Vec<String> = conditions_of(&pool, &housing).await.into_iter().map(|(_, v)| v).collect();
    values.sort();
    assert_eq!(values, vec!["flat", "home"]);

    set_property_scope_impl(&pool, &housing, &[]).await.unwrap();
    assert!(conditions_of(&pool, &housing).await.is_empty());
}

#[tokio::test]
async fn refuses_a_cycle() {
    let pool = setup_db().await;
    let tags = property(&pool, "Tags", "array").await;
    let housing = property(&pool, "Housing", "enum").await;
    let kind = property(&pool, "Insurance Type", "enum").await;

    set_property_scope_impl(&pool, &housing, &[when(&tags, "housing")]).await.unwrap();
    set_property_scope_impl(&pool, &kind, &[when(&housing, "House Insurance")]).await.unwrap();
    // Tags depending on Insurance Type would loop back round
    let err = set_property_scope_impl(&pool, &tags, &[when(&kind, "Buildings")]).await.unwrap_err();
    assert!(err.contains("depend on itself"));
    assert!(conditions_of(&pool, &tags).await.is_empty());
}

#[tokio::test]
async fn refuses_an_unknown_property_or_empty_value() {
    let pool = setup_db().await;
    let housing = property(&pool, "Housing", "enum").await;
    assert!(set_property_scope_impl(&pool, &housing, &[when("missing", "x")]).await.is_err());
    let tags = property(&pool, "Tags", "array").await;
    assert!(set_property_scope_impl(&pool, &housing, &[when(&tags, "  ")]).await.is_err());
    assert!(set_property_scope_impl(&pool, "missing", &[when(&tags, "x")]).await.is_err());
}

#[tokio::test]
async fn conditions_follow_a_renamed_value() {
    let pool = setup_db().await;
    let tags = property(&pool, "Tags", "array").await;
    let housing = property(&pool, "Housing", "enum").await;
    set_property_scope_impl(&pool, &housing, &[when(&tags, "housing")]).await.unwrap();

    rename_property_value_impl(&pool, &tags, "housing", "home").await.unwrap();
    assert_eq!(conditions_of(&pool, &housing).await, vec![(tags.clone(), "home".to_string())]);
}

#[tokio::test]
async fn deleting_values_and_properties_removes_their_conditions() {
    let pool = setup_db().await;
    let tags = property(&pool, "Tags", "array").await;
    let housing = property(&pool, "Housing", "enum").await;
    let kind = property(&pool, "Insurance Type", "enum").await;
    set_property_scope_impl(&pool, &housing, &[when(&tags, "housing"), when(&tags, "home")]).await.unwrap();
    set_property_scope_impl(&pool, &kind, &[when(&housing, "House Insurance")]).await.unwrap();

    let mut conn = pool.acquire().await.unwrap();
    drop_condition_value(&mut conn, &tags, "home").await.unwrap();
    assert_eq!(conditions_of(&pool, &housing).await, vec![(tags.clone(), "housing".to_string())]);

    // Housing goes: its own conditions, and Insurance Type's condition on it
    drop_property_scopes(&mut conn, &housing).await.unwrap();
    assert!(conditions_of(&pool, &housing).await.is_empty());
    assert!(conditions_of(&pool, &kind).await.is_empty());
}
