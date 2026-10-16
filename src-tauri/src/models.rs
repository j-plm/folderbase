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

#[derive(Debug, Serialize, Deserialize, Clone, FromRow)]
pub struct PropertyValue {
    pub value_id: String,
    pub property_id: String,
    pub value: String,
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
