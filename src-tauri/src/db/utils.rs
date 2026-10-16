use chrono::{DateTime, NaiveDate};

const CORE_COLS: &[&str] = &["library", "file_type", "timestamp"];

pub fn is_core(prop: &str) -> bool {
    CORE_COLS.contains(&prop)
}

/// SQLite JSON path for a top-level metadata key, quoted so names with spaces,
/// dots or other punctuation ("shoot date", "v1.2") address the right key.
pub fn json_path(key: &str) -> String {
    format!("$.\"{}\"", key.replace('\\', "\\\\").replace('"', "\\\""))
}

/// `json_path(key)` as an SQL string literal, for paths written into the query text.
pub fn json_path_sql(key: &str) -> String {
    format!("'{}'", json_path(key).replace('\'', "''"))
}

/// Returns (WHERE clause string, ordered bind values).
/// Caller must bind all values in order to a sqlx query.
pub fn build_constraints_sql(constraints: &[(String, String)]) -> (String, Vec<String>) {
    if constraints.is_empty() {
        return ("1=1".to_string(), vec![]);
    }
    let mut clauses = Vec::new();
    let mut bindings = Vec::new();
    for (prop, val) in constraints {
        if is_core(prop) {
            clauses.push(format!("{} = ?", prop));
            bindings.push(val.clone());
        } else {
            clauses.push(format!(
                "((json_type(metadata, {p}) != 'array' AND json_extract(metadata, {p}) = ?) \
                 OR (json_type(metadata, {p}) = 'array' AND EXISTS (\
                   SELECT 1 FROM json_each(metadata, {p}) je WHERE je.value = ?)))",
                p = json_path_sql(prop)
            ));
            bindings.push(val.clone());
            bindings.push(val.clone());
        }
    }
    (clauses.join(" AND "), bindings)
}

pub fn infer_value_type(values: &[String]) -> String {
    if values.is_empty() {
        return "enum".to_string();
    }

    let all_dates = values.iter().all(|v| {
        DateTime::parse_from_rfc3339(v).is_ok()
            || NaiveDate::parse_from_str(v, "%Y-%m-%d").is_ok()
    });

    if all_dates {
        return "date".to_string();
    }

    if values.len() > 20 {
        return "free_text".to_string();
    }

    "enum".to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn json_path_sql_quotes_for_json_and_sql() {
        assert_eq!(json_path("shoot date"), "$.\"shoot date\"");
        assert_eq!(json_path_sql("client's"), "'$.\"client''s\"'");
    }

    use super::*;

    #[test]
    fn empty_slice_is_enum() {
        assert_eq!(infer_value_type(&[]), "enum");
    }

    #[test]
    fn rfc3339_values_are_date() {
        let values = vec![
            "2024-01-15T10:23:45+00:00".to_string(),
            "2024-02-20T08:00:00Z".to_string(),
        ];
        assert_eq!(infer_value_type(&values), "date");
    }

    #[test]
    fn naive_date_values_are_date() {
        let values = vec!["2024-01-15".to_string(), "2024-06-01".to_string()];
        assert_eq!(infer_value_type(&values), "date");
    }

    #[test]
    fn mixed_date_and_non_date_is_not_date() {
        let values = vec!["2024-01-15".to_string(), "not-a-date".to_string()];
        assert_eq!(infer_value_type(&values), "enum");
    }

    #[test]
    fn large_set_is_free_text() {
        let values: Vec<String> = (0..21).map(|i| format!("value_{i}")).collect();
        assert_eq!(infer_value_type(&values), "free_text");
    }

    #[test]
    fn small_non_date_set_is_enum() {
        let values = vec!["red".to_string(), "blue".to_string(), "green".to_string()];
        assert_eq!(infer_value_type(&values), "enum");
    }

    #[test]
    fn exactly_20_values_is_enum() {
        let values: Vec<String> = (0..20).map(|i| format!("value_{i}")).collect();
        assert_eq!(infer_value_type(&values), "enum");
    }
}
