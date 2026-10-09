//! JSON Schema bundle (21 §3): generation, file layout, `contractSha256`,
//! and the drift check of CI item 1.
//!
//! Schemas describe the wire form, which is the same in both directions:
//! every required-but-nullable field is marked with
//! [`crate::support::nullable`], so the serialize contract (a field is
//! optional iff it is skipped when `None`) is also what deserialization
//! accepts.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

use schemars::generate::SchemaSettings;
use schemars::JsonSchema;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::canonical::{canonical_json_escaped, CanonicalError};
use crate::model_config::ModelConfig;
use crate::num::{Sha256Hex, MAX_SAFE_INTEGER};

/// Bundle version directory: `native/contract/schema/v<N>/`.
pub const BUNDLE_VERSION: u32 = 1;

/// Bundle directory relative to the contract root (`native/contract`).
pub const BUNDLE_SUBDIR: &str = "schema/v1";

/// Cross-language hash fixture relative to the contract root: the bundle's
/// `contractSha256` and the `modelConfigSha256` of every committed default
/// config (21 §3 CI item 6; read by the TS tests).
pub const HASHES_FILE: &str = "fixtures/hashes.json";

/// Committed default ModelConfigs relative to the contract root (D57: only
/// `ts-compat-default.json` until M3b).
pub const MODEL_CONFIGS_SUBDIR: &str = "model-configs";

/// The contract root of this checkout (`native/contract`).
pub fn default_contract_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../contract")
}

fn schema_of<T: JsonSchema>(id: &str) -> Value {
    let generator = SchemaSettings::draft2020_12()
        .for_serialize()
        .into_generator();
    let mut v = generator.into_root_schema_for::<T>().to_value();
    normalize_integer_formats(&mut v);
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

/// Replaces schemars' non-standard integer `format` annotations (`uint32`,
/// `int64`, ...) by explicit `minimum`/`maximum` bounds, so a 2020-12
/// validator (Ajv, strict mode) rejects exactly what serde rejects, and no
/// unknown format reaches TS (21 §3, §18 N2).
fn normalize_integer_formats(v: &mut Value) {
    match v {
        Value::Object(m) => {
            let bounds = match m.get("format").and_then(Value::as_str) {
                Some("uint8") => Some((0, 255)),
                Some("uint16") => Some((0, 65_535)),
                Some("uint32") | Some("uint") => Some((0, 4_294_967_295)),
                Some("uint64") => Some((0, MAX_SAFE_INTEGER as i64)),
                Some("int8") => Some((-128, 127)),
                Some("int16") => Some((-32_768, 32_767)),
                Some("int32") | Some("int") => Some((-2_147_483_648, 2_147_483_647)),
                Some("int64") => Some((-(MAX_SAFE_INTEGER as i64), MAX_SAFE_INTEGER as i64)),
                _ => None,
            };
            if let Some((lo, hi)) = bounds {
                m.remove("format");
                tighten(m, "minimum", lo, i64::max);
                tighten(m, "maximum", hi, i64::min);
            }
            for child in m.values_mut() {
                normalize_integer_formats(child);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(normalize_integer_formats),
        _ => {}
    }
}

fn tighten(m: &mut Map<String, Value>, key: &str, bound: i64, pick: fn(i64, i64) -> i64) {
    let v = match m.get(key).and_then(Value::as_i64) {
        Some(existing) => pick(existing, bound),
        None => bound,
    };
    m.insert(key.into(), Value::from(v));
}

/// The bundle: `(file stem, schema)` sorted by file name. File stems are
/// the keys of the `schema` subcommand (20 §5.2).
// D-PENDING: 20 §5.2 also lists liveConfig, traceRecord and ledgerRecord
// (and the per-strategy params); their shapes are owned by 50 and 22 and
// land with those milestones, each adding a file here (a bundle change, so
// contractSha256 changes).
pub fn bundle() -> Vec<(&'static str, Value)> {
    let mut files = vec![
        ("engineJob", schema_of::<crate::job::EngineJob>("engineJob")),
        (
            "engineResult",
            schema_of::<crate::result::EngineResult>("engineResult"),
        ),
        ("modelConfig", schema_of::<ModelConfig>("modelConfig")),
        ("serveIn", schema_of::<crate::serve::ServeIn>("serveIn")),
        ("serveOut", schema_of::<crate::serve::ServeOut>("serveOut")),
    ];
    files.sort_by(|a, b| file_name(a.0).as_bytes().cmp(file_name(b.0).as_bytes()));
    files
}

pub fn file_name(stem: &str) -> String {
    format!("{stem}.schema.json")
}

/// File bytes as written by `export-schema`: pretty JSON with sorted keys
/// and a trailing newline. `npm run native:contract:export` then formats the
/// files with Prettier, so committed bytes may differ in whitespace only;
/// the drift check compares parsed documents, and `contractSha256` hashes
/// canonical forms.
pub fn file_text(doc: &Value) -> String {
    let mut s = serde_json::to_string_pretty(doc).expect("JSON serializes");
    s.push('\n');
    s
}

/// `contractSha256` = sha256 over the bundle: files sorted by name, each in
/// canonical JSON (§6.1, strings escaped as serde_json and JSON.stringify
/// do), joined by `\n` (21 §3).
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

/// The `schema` subcommand document (20 §5.2):
/// `{type: "schema", contractSha256, schemas: {<stem>: <schema>}}` over the
/// compiled bundle. Stems the bundle does not hold yet (liveConfig,
/// traceRecord, ledgerRecord, params) are absent until their owners land.
pub fn schema_document() -> Result<Value, CanonicalError> {
    let files = bundle();
    let sha = contract_sha256(&files)?;
    let mut schemas = Map::new();
    for (stem, schema) in files {
        schemas.insert(stem.to_owned(), schema);
    }
    let mut out = Map::new();
    out.insert("type".into(), Value::String("schema".into()));
    out.insert("contractSha256".into(), Value::String(sha.to_string()));
    out.insert("schemas".into(), Value::Object(schemas));
    Ok(Value::Object(out))
}

/// The hash fixture: `contractSha256` of [`bundle`] and the
/// `modelConfigSha256` of every committed default config, by file name.
pub fn hashes(contract_dir: &Path) -> Result<Value, String> {
    let contract = contract_sha256(&bundle()).map_err(|e| e.to_string())?;
    let mut configs = Map::new();
    let dir = contract_dir.join(MODEL_CONFIGS_SUBDIR);
    for path in sorted_json_files(&dir)? {
        let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let mc: ModelConfig =
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        mc.validate()
            .map_err(|e| format!("{}: {e}", path.display()))?;
        let sha = mc.sha256().map_err(|e| e.to_string())?;
        configs.insert(file_stem_name(&path), Value::String(sha.to_string()));
    }
    let mut out = Map::new();
    out.insert(
        "description".into(),
        Value::String(
            "Generated by `npm run native:contract:export` (21 §3 CI item 6): TS and Rust must both reproduce these hashes."
                .into(),
        ),
    );
    out.insert("contractSha256".into(), Value::String(contract.to_string()));
    out.insert("modelConfigSha256".into(), Value::Object(configs));
    Ok(Value::Object(out))
}

fn file_stem_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_owned()
}

fn sorted_json_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().is_some_and(|x| x == "json") {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

/// Every generated file under the contract root: the schema bundle and the
/// hash fixture, as (relative path, document).
pub fn generated_files(contract_dir: &Path) -> Result<Vec<(String, Value)>, String> {
    let mut out: Vec<(String, Value)> = bundle()
        .into_iter()
        .map(|(stem, v)| (format!("{BUNDLE_SUBDIR}/{}", file_name(stem)), v))
        .collect();
    out.push((HASHES_FILE.to_owned(), hashes(contract_dir)?));
    Ok(out)
}

/// Writes every generated file (21 §3 "generated ... and committed").
pub fn write(contract_dir: &Path) -> Result<(), String> {
    let schema_dir = contract_dir.join(BUNDLE_SUBDIR);
    fs::create_dir_all(&schema_dir).map_err(|e| e.to_string())?;
    // Stale bundle files would silently stay in the bundle (R14).
    for path in sorted_json_files(&schema_dir)? {
        fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    for (rel, doc) in generated_files(contract_dir)? {
        let path = contract_dir.join(&rel);
        fs::write(&path, file_text(&doc)).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(())
}

/// CI item 1: the committed files equal the generated ones (as parsed JSON;
/// whitespace is Prettier's), and the bundle directory holds nothing else.
/// Returns one line per difference.
pub fn check(contract_dir: &Path) -> Result<(), String> {
    let mut problems = String::new();
    let generated = generated_files(contract_dir)?;
    for (rel, doc) in &generated {
        let path = contract_dir.join(rel);
        match fs::read_to_string(&path) {
            Err(e) => writeln!(problems, "{rel}: missing ({e})").unwrap(),
            Ok(text) => match serde_json::from_str::<Value>(&text) {
                Err(e) => writeln!(problems, "{rel}: not JSON ({e})").unwrap(),
                Ok(committed) if &committed != doc => {
                    writeln!(problems, "{rel}: differs from the generated file").unwrap()
                }
                Ok(_) => {}
            },
        }
    }
    let schema_dir = contract_dir.join(BUNDLE_SUBDIR);
    for path in sorted_json_files(&schema_dir).unwrap_or_default() {
        let rel = format!("{BUNDLE_SUBDIR}/{}", file_stem_name(&path));
        if !generated.iter().any(|(r, _)| *r == rel) {
            writeln!(problems, "{rel}: not part of the generated bundle").unwrap();
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        problems.push_str("fix: npm run native:contract:export (then commit)\n");
        Err(problems)
    }
}
