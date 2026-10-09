//! JSON Schema bundle (21 §3): generation, file layout and `contractSha256`.

use schemars::generate::SchemaSettings;
use schemars::JsonSchema;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::canonical::{canonical_json_escaped, CanonicalError};
use crate::num::Sha256Hex;

/// Bundle version directory: `native/contract/schema/v<N>/`.
pub const BUNDLE_VERSION: u32 = 1;

/// Workspace-relative directory of the committed bundle.
pub const BUNDLE_DIR: &str = "contract/schema/v1";

fn schema_of<T: JsonSchema>(id: &str) -> Value {
    let generator = SchemaSettings::draft2020_12().into_generator();
    let schema = generator.into_root_schema_for::<T>();
    let mut v = schema.to_value();
    if let Value::Object(m) = &mut v {
        m.insert(
            "$id".into(),
            Value::String(format!(
                "https://pmb.invalid/contract/v{BUNDLE_VERSION}/{id}.schema.json"
            )),
        );
    }
    v
}

/// The bundle: `(file stem, schema)` sorted by file name. File stems are
/// the keys of the `schema` subcommand (20 §5.2).
pub fn bundle() -> Vec<(&'static str, Value)> {
    let mut files = vec![
        ("engineJob", schema_of::<crate::job::EngineJob>("engineJob")),
        (
            "engineResult",
            schema_of::<crate::result::EngineResult>("engineResult"),
        ),
        (
            "modelConfig",
            schema_of::<crate::model_config::ModelConfig>("modelConfig"),
        ),
    ];
    files.sort_by(|a, b| file_name(a.0).cmp(&file_name(b.0)));
    files
}

pub fn file_name(stem: &str) -> String {
    format!("{stem}.schema.json")
}

/// File bytes as committed: pretty JSON (2-space indent, keys sorted by
/// `serde_json`'s ordered map) plus a trailing newline. Formatting does not
/// enter `contractSha256`, which hashes canonical forms.
pub fn file_text(schema: &Value) -> String {
    let mut s = serde_json::to_string_pretty(&sorted(schema)).expect("schema serializes");
    s.push('\n');
    s
}

fn sorted(v: &Value) -> Value {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            let mut out = serde_json::Map::new();
            for k in keys {
                out.insert(k.clone(), sorted(&m[k]));
            }
            Value::Object(out)
        }
        Value::Array(a) => Value::Array(a.iter().map(sorted).collect()),
        other => other.clone(),
    }
}

/// `contractSha256` = sha256 over the bundle: files sorted by name, each in
/// canonical JSON, joined by `\n` (21 §3).
pub fn contract_sha256(files: &[(&str, Value)]) -> Result<Sha256Hex, CanonicalError> {
    let mut named: Vec<(String, &Value)> = files.iter().map(|(s, v)| (file_name(s), v)).collect();
    named.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut parts = Vec::with_capacity(named.len());
    for (_, v) in named {
        parts.push(canonical_json_escaped(v)?);
    }
    let digest: [u8; 32] = Sha256::digest(parts.join("\n").as_bytes()).into();
    Ok(Sha256Hex::from_digest(&digest))
}
