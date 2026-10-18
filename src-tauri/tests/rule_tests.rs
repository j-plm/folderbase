mod common;

use common::setup_db;
use folderbase_lib::commands::metadata::{rename_property_impl, CellEdit};
use folderbase_lib::commands::rules::{
    apply_rule_writes_impl, delete_rule_impl, forget_rule_writes_impl, get_rule_writes_impl, get_rules_impl,
    reorder_rules_impl, save_rule_impl,
};
use folderbase_lib::db::DbPool;
use folderbase_lib::models::{Rule, RuleWrite};
use serde_json::{json, Value};
use uuid::Uuid;

fn rule(name: &str, definition: Value) -> Rule {
    Rule {
        rule_id: String::new(),
        library: "docs".into(),
        name: name.into(),
        enabled: true,
        position: 0,
        definition: definition.to_string(),
        created_at: String::new(),
        updated_at: String::new(),
    }
}

async fn insert_file(pool: &DbPool) -> String {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO files (file_id, file_path, library, metadata) VALUES (?, ?, 'docs', '{}')")
        .bind(&id)
        .bind(format!("/fake/{id}.pdf"))
        .execute(pool)
        .await
        .unwrap();
    id
}

async fn metadata(pool: &DbPool, file_id: &str) -> Value {
    let raw: String = sqlx::query_scalar("SELECT metadata FROM files WHERE file_id = ?")
        .bind(file_id)
        .fetch_one(pool)
        .await
        .unwrap();
    serde_json::from_str(&raw).unwrap()
}

#[tokio::test]
async fn saves_lists_in_order_and_updates() {
    let pool = setup_db().await;
    let a = save_rule_impl(&pool, rule("A", json!({ "actions": [] }))).await.unwrap();
    let b = save_rule_impl(&pool, rule("B", json!({ "actions": [] }))).await.unwrap();
    assert!(!a.rule_id.is_empty());
    assert_eq!((a.position, b.position), (0, 1));

    reorder_rules_impl(&pool, &[b.rule_id.clone(), a.rule_id.clone()]).await.unwrap();
    let names: Vec<String> = get_rules_impl(&pool, "docs").await.unwrap().into_iter().map(|r| r.name).collect();
    assert_eq!(names, vec!["B", "A"]);

    let renamed = save_rule_impl(&pool, Rule { name: "A2".into(), enabled: false, ..a.clone() }).await.unwrap();
    let rules = get_rules_impl(&pool, "docs").await.unwrap();
    let stored = rules.iter().find(|r| r.rule_id == renamed.rule_id).unwrap();
    assert_eq!((stored.name.as_str(), stored.enabled), ("A2", false));
    assert!(get_rules_impl(&pool, "other").await.unwrap().is_empty());
}

#[tokio::test]
async fn refuses_a_nameless_or_malformed_rule() {
    let pool = setup_db().await;
    assert!(save_rule_impl(&pool, rule("  ", json!({}))).await.is_err());
    assert!(save_rule_impl(&pool, Rule { definition: "{not json".into(), ..rule("X", json!({})) }).await.is_err());
}

#[tokio::test]
async fn writes_values_and_remembers_them_until_forgotten_or_deleted() {
    let pool = setup_db().await;
    let r = save_rule_impl(&pool, rule("Person", json!({ "actions": [] }))).await.unwrap();
    let file = insert_file(&pool).await;
    let write = RuleWrite { rule_id: r.rule_id.clone(), file_id: file.clone(), key: "Person".into(), value: "\"Ruben\"".into() };
    let edit = CellEdit { file_id: file.clone(), key: "Person".into(), value: json!("Ruben") };

    apply_rule_writes_impl(&pool, &[edit], &[write.clone()]).await.unwrap();
    assert_eq!(metadata(&pool, &file).await["Person"], "Ruben");
    assert_eq!(get_rule_writes_impl(&pool, "docs").await.unwrap().len(), 1);

    forget_rule_writes_impl(&pool, &[write.clone()]).await.unwrap();
    assert!(get_rule_writes_impl(&pool, "docs").await.unwrap().is_empty());

    apply_rule_writes_impl(&pool, &[], &[write]).await.unwrap();
    delete_rule_impl(&pool, &r.rule_id).await.unwrap();
    assert!(get_rule_writes_impl(&pool, "docs").await.unwrap().is_empty());
    assert!(get_rules_impl(&pool, "docs").await.unwrap().is_empty());
    // The value it wrote stays
    assert_eq!(metadata(&pool, &file).await["Person"], "Ruben");
}

#[tokio::test]
async fn renaming_a_property_renames_it_in_rules_and_their_writes() {
    let pool = setup_db().await;
    let prop = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO properties (property_id, name, library, value_type) VALUES (?, 'Client', 'docs', 'enum')")
        .bind(&prop)
        .execute(&pool)
        .await
        .unwrap();
    let r = save_rule_impl(
        &pool,
        rule("C", json!({ "conditions": [{ "column": "prop:Client", "op": "has", "value": "Acme" }], "actions": [{ "property": "Client", "mode": "fixed", "value": "Acme" }] })),
    )
    .await
    .unwrap();
    let file = insert_file(&pool).await;
    apply_rule_writes_impl(&pool, &[], &[RuleWrite { rule_id: r.rule_id.clone(), file_id: file, key: "Client".into(), value: "\"Acme\"".into() }])
        .await
        .unwrap();

    rename_property_impl(&pool, &prop, "Customer").await.unwrap();
    let def: Value = serde_json::from_str(&get_rules_impl(&pool, "docs").await.unwrap()[0].definition).unwrap();
    assert_eq!(def["conditions"][0]["column"], "prop:Customer");
    assert_eq!(def["actions"][0]["property"], "Customer");
    assert_eq!(get_rule_writes_impl(&pool, "docs").await.unwrap()[0].key, "Customer");
}
