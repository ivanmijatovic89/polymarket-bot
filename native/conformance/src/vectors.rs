//! Loading of the table-driven vectors under `vectors/`.

use serde_json::Value;
use std::path::PathBuf;

/// Directory holding the committed vector files.
pub fn dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/vectors"))
}

/// Loads `vectors/<name>.json` and returns its root object.
///
/// Every vector file has the shape
/// `{ "spec": ..., "source": ..., "vectors": [ { "id", "spec", ... } ] }`
/// (plus optional `notes`). Panics with a readable message when the file is
/// missing or is not valid JSON, so a broken vector never passes silently.
pub fn load(name: &str) -> Value {
    let path = dir().join(format!("{name}.json"));
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read vector file {}: {e}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("vector file {} is not valid JSON: {e}", path.display()))
}

/// The `vectors` array of a loaded file.
pub fn rows(file: &Value) -> &Vec<Value> {
    file.get("vectors")
        .and_then(Value::as_array)
        .expect("vector file has a `vectors` array")
}

/// Every vector carries its clause id (`spec`) and a unique `id` (60 CF-3).
pub fn assert_well_formed(file: &Value) {
    let mut ids = std::collections::BTreeSet::new();
    for row in rows(file) {
        let id = row
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("vector without `id`: {row}"));
        assert!(ids.insert(id.to_string()), "duplicate vector id {id}");
        let spec = row
            .get("spec")
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("vector {id} has no `spec` clause"));
        assert!(!spec.trim().is_empty(), "vector {id} has an empty `spec`");
    }
}

/// String field accessor that panics with the vector id in the message.
pub fn s<'a>(row: &'a Value, key: &str) -> &'a str {
    row.get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("vector {} has no string field `{key}`", id(row)))
}

/// Integer field accessor (i64) that panics with the vector id in the message.
pub fn i(row: &Value, key: &str) -> i64 {
    row.get(key)
        .and_then(Value::as_i64)
        .unwrap_or_else(|| panic!("vector {} has no integer field `{key}`", id(row)))
}

pub fn id(row: &Value) -> &str {
    row.get("id").and_then(Value::as_str).unwrap_or("<no id>")
}
