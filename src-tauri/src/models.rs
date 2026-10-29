use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct FileRecord {
    pub file_id: String,
    pub file_path: String,
    pub file_type: Option<String>,
    pub timestamp: Option<String>,
    pub library: Option<String>,
    pub metadata: Option<String>,
    pub location_id: Option<String>,
    pub relative_path: Option<String>,
    pub file_size: Option<i64>,
    pub modified_at: Option<String>,
    pub created_at: Option<String>,
    pub tags: String,
    /// A cloud file not downloaded to this device (see `ingest::online_only`).
    pub online_only: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Location {
    pub location_id: String,
    pub name: String,
    pub root_path: String,
    pub library: String,
    pub added_at: String,
    pub last_indexed: Option<String>,
    /// Where files dropped in from outside are copied, relative to the root (None: "Added Files").
    pub added_folder: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Property {
    pub property_id: String,
    pub name: String,
    pub library: Option<String>,
    pub value_type: String,
    /// JSON type options, e.g. {"format":"currency","currency":"GBP"}.
    pub config: Option<String>,
}

/// A rule: when its conditions hold, set its values. `definition` is JSON
/// (conditions, match, actions), read by src/lib/rules.ts.
#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct Rule {
    #[serde(default)]
    pub rule_id: String,
    pub library: String,
    pub name: String,
    pub enabled: bool,
    #[serde(default)]
    pub position: i64,
    pub definition: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// A saved view of a location's files. `definition` is JSON read by
/// src/lib/tableViews.ts: `{ "table": { filters, sorts, groups, columns… } }`,
/// with room for other presentations later. `draft` holds a named view's
/// unsaved edits; the default view has none (its edits save as they happen).
#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct LocationView {
    #[serde(default)]
    pub view_id: String,
    pub location_id: String,
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub position: i64,
    pub definition: String,
    #[serde(default)]
    pub draft: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

/// A value a rule wrote to a file (`value` is JSON: one value, or one item added to a list).
#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct RuleWrite {
    pub rule_id: String,
    pub file_id: String,
    pub key: String,
    pub value: String,
}

/// One condition on a scoped property: it applies where `condition_property_id` holds `value`.
#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct PropertyScope {
    pub property_id: String,
    pub condition_property_id: String,
    pub value: String,
}

/// A condition as the frontend sends it.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScopeCondition {
    pub property_id: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct PropertyValue {
    pub value_id: String,
    pub property_id: String,
    pub value: String,
    /// Folder names mapped to this value after it was renamed (e.g. "01 Apollo" for "Apollo").
    #[sqlx(skip)]
    #[serde(default)]
    pub sources: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct View {
    pub view_id: String,
    pub name: String,
    pub library: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct ViewNode {
    pub node_id: String,
    pub view_id: String,
    pub parent_node_id: Option<String>,
    pub property_id: String,
    pub property_name: String,
    pub fork_value: Option<String>,
    pub sort_order: i64,
}
