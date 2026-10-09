//! Engine identity compiled into the binary (20 §3, 31 §4.2, §5.3).
//!
//! Strategy packages have no build script (31 §2.2), so the identity comes
//! from `option_env!` of the variables the canonical builder sets in its
//! `[env]` table (`PMB_ENGINE_SOURCE_HASH`, `PMB_ENGINE_COMMIT`,
//! `PMB_ENGINE_DIRTY`, `PMB_RUSTC`; 31 §4.2). A build outside the builder
//! records the fallbacks honestly: commit unknown and `engineDirty = true`,
//! which live refuses (20 §3).

use std::sync::OnceLock;

use pmb_contract::num::Sha256Hex;

/// Protocol version of 20 §1.
pub const PROTOCOL_VERSION: u32 = 2;

/// Engine commit reported when the builder did not set `PMB_ENGINE_COMMIT`.
// D-PENDING: 31 §5.3 gives no fallback value; the contract's `echo`
// requires 40 lowercase hex digits, so the "unknown" commit is the all-zero
// sha, always paired with `engineDirty = true`.
pub const UNKNOWN_COMMIT: &str = "0000000000000000000000000000000000000000";

/// Text reported for identity fields the builder did not set.
pub const UNKNOWN: &str = "unknown";

/// Parity trace format id (22 §3).
pub const TRACE_FORMAT: &str = "pmb-parity-trace/2";
/// Ledger format id (22 §4); reported, not written before M3b.
pub const LEDGER_FORMAT: &str = "pmb-ledger/1";
/// Live journal format id (22 §6); reported, not written before M8.
pub const JOURNAL_FORMAT: &str = "pmb-live-journal/1";

/// The engine identity of this binary (20 §3).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineIdentity {
    /// Engine crate version (semver).
    pub engine_version: &'static str,
    /// Last commit of the engine source set (31 §5.3).
    pub engine_commit: &'static str,
    /// Whether the engine source set differs from that commit.
    pub engine_dirty: bool,
    /// `PMB_ENGINE_SOURCE_HASH` (31 §5.3), or [`UNKNOWN`].
    pub engine_source_hash: &'static str,
    /// rustc release, or [`UNKNOWN`].
    pub rustc: &'static str,
    /// Target triple.
    pub target: &'static str,
    /// Cargo profile name, or [`UNKNOWN`].
    pub build_profile: &'static str,
}

fn is_commit(s: &str) -> bool {
    s.len() == 40
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The identity compiled into this binary.
pub fn engine_identity() -> EngineIdentity {
    let commit = option_env!("PMB_ENGINE_COMMIT").filter(|c| is_commit(c));
    // Dirty unless the builder stated `false` together with a valid commit.
    let dirty = !matches!(
        (commit, option_env!("PMB_ENGINE_DIRTY")),
        (Some(_), Some("false"))
    );
    EngineIdentity {
        engine_version: env!("CARGO_PKG_VERSION"),
        engine_commit: commit.unwrap_or(UNKNOWN_COMMIT),
        engine_dirty: dirty,
        engine_source_hash: option_env!("PMB_ENGINE_SOURCE_HASH").unwrap_or(UNKNOWN),
        rustc: option_env!("PMB_RUSTC").unwrap_or(UNKNOWN),
        target: target_triple(),
        // D-PENDING: 31 §4.2 lists the profile name among the embedded
        // values but names no variable; the builder is asked to set
        // `PMB_BUILD_PROFILE` (crossStreamNeeds).
        build_profile: option_env!("PMB_BUILD_PROFILE").unwrap_or(UNKNOWN),
    }
}

/// The target triple from `cfg` (no build script, 31 §2.2).
pub const fn target_triple() -> &'static str {
    if cfg!(all(target_arch = "aarch64", target_os = "macos")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_arch = "x86_64", target_os = "macos")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(
        target_arch = "x86_64",
        target_os = "linux",
        target_env = "gnu"
    )) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(
        target_arch = "aarch64",
        target_os = "linux",
        target_env = "gnu"
    )) {
        "aarch64-unknown-linux-gnu"
    } else {
        UNKNOWN
    }
}

/// `contractSha256` of the schema bundle compiled into this binary
/// (20 §3, 21 §3), computed once with [`bundle_sha256`].
///
/// D-PENDING: `native/contract/schema/v1/` is not committed on this branch
/// (the contract stream exports it), so there is nothing to `include_str!`.
/// The bundle is generated from the very `pmb-contract` types this binary
/// is compiled with, which by 21 §3 CI item 1 equals the committed files.
///
/// # Panics
///
/// When the compiled bundle has no canonical form (a float or an unsafe
/// integer, a non-ASCII key): a build defect, reported as `engine_fault`
/// by the dispatcher's catch boundary. Tests hash the bundle, so CI fails
/// first.
pub fn contract_sha256() -> &'static Sha256Hex {
    static SHA: OnceLock<Sha256Hex> = OnceLock::new();
    SHA.get_or_init(|| {
        bundle_sha256(&pmb_contract::schema::bundle())
            .unwrap_or_else(|e| panic!("the compiled schema bundle has no contractSha256: {e}"))
    })
}

/// 21 §3 `contractSha256`: the files sorted by name, each in canonical JSON,
/// joined by `\n`, hashed with sha256. Canonical JSON here: keys sorted
/// bytewise at every level (by this function, whatever the map type), no
/// whitespace, safe integers only (no floats), ASCII keys, and strings
/// escaped as `serde_json` and `JSON.stringify` do, non-ASCII kept as raw
/// UTF-8. This is the only algorithm the binary uses (no fallback).
// D-PENDING: 21 §6.1 canonical JSON admits ASCII strings only, and the
// pmb-contract canonicalizer on this branch refuses the bundle's non-ASCII
// descriptions (`§`). Chose the contract stream's proposed definition (raw
// UTF-8 strings, ASCII keys) until a 02 decision records it (spec question).
pub fn bundle_sha256(files: &[(&str, serde_json::Value)]) -> Result<Sha256Hex, String> {
    use sha2::{Digest, Sha256};
    let mut named: Vec<(String, &serde_json::Value)> = files
        .iter()
        .map(|(stem, v)| (pmb_contract::schema::file_name(stem), v))
        .collect();
    named.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut text = String::new();
    for (i, (name, v)) in named.iter().enumerate() {
        if i > 0 {
            text.push('\n');
        }
        write_canonical(v, &mut text).map_err(|e| format!("{name}: {e}"))?;
    }
    let digest: [u8; 32] = Sha256::digest(text.as_bytes()).into();
    Ok(Sha256Hex::from_digest(&digest))
}

fn write_json_str(s: &str, out: &mut String) {
    // serde_json escapes `"`, `\` and control characters exactly as
    // JSON.stringify does and keeps every other character as UTF-8.
    out.push_str(&serde_json::to_string(s).expect("a string serializes"));
}

fn write_canonical(v: &serde_json::Value, out: &mut String) -> Result<(), String> {
    use serde_json::Value;
    const MAX_SAFE: u64 = (1 << 53) - 1;
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => match (n.as_u64(), n.as_i64()) {
            (Some(u), _) if u <= MAX_SAFE => out.push_str(&u.to_string()),
            (None, Some(i)) if i.unsigned_abs() <= MAX_SAFE => out.push_str(&i.to_string()),
            _ => return Err(format!("number {n} is not a safe integer (21 §6.1)")),
        },
        Value::String(s) => write_json_str(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
            out.push('{');
            for (i, (k, item)) in entries.into_iter().enumerate() {
                if !k.is_ascii() {
                    return Err(format!("key {k:?} is not ASCII"));
                }
                if i > 0 {
                    out.push(',');
                }
                write_json_str(k, out);
                out.push(':');
                write_canonical(item, out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// Golden vector of [`bundle_sha256`]: two files given out of order.
pub fn bundle_sha256_golden() -> (Vec<(&'static str, serde_json::Value)>, &'static str) {
    (
        vec![
            ("zeta", serde_json::json!({"x": true})),
            (
                "alpha",
                serde_json::json!({"b": "§", "a": [1, {"d": 2, "c": "\n"}]}),
            ),
        ],
        // sha256 of `{"a":[1,{"c":"\n","d":2}],"b":"§"}` + "\n" + `{"x":true}`
        "9a612515ae1a392809936a3faa5aa00a1116718da8526f4d3664d803ef2572bf",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_fallbacks_are_honest() {
        // spec: 31 §5.3 (engine identity), 20 §3 (live refuses engineDirty=true)
        let id = engine_identity();
        assert_eq!(id.engine_version, env!("CARGO_PKG_VERSION"));
        assert!(is_commit(id.engine_commit));
        if option_env!("PMB_ENGINE_COMMIT").is_none() {
            assert_eq!(id.engine_commit, UNKNOWN_COMMIT);
            assert!(id.engine_dirty);
        }
        assert!(!id.target.is_empty());
    }

    #[test]
    fn contract_sha_is_stable_hex() {
        // spec: 21 §3 (contractSha256 over the bundle)
        let a = contract_sha256().as_str().to_string();
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(contract_sha256().as_str(), a);
    }

    #[test]
    fn bundle_hash_sorts_files_and_keys_and_keeps_utf8() {
        // spec: 21 §3 (files sorted by name, canonical JSON, joined by \n)
        let (files, want) = bundle_sha256_golden();
        assert_eq!(bundle_sha256(&files).unwrap().as_str(), want);
        let mut reversed = files.clone();
        reversed.reverse();
        assert_eq!(bundle_sha256(&reversed).unwrap().as_str(), want);
    }

    #[test]
    fn bundle_hash_refuses_what_has_no_canonical_form() {
        // spec: 21 §6.1 (no floats, safe integers, ASCII keys), R14
        for bad in [
            serde_json::json!({"a": 1.5}),
            serde_json::json!({"a": 9_007_199_254_740_992_u64}),
            serde_json::json!({"a": -9_007_199_254_740_992_i64}),
            serde_json::json!({"é": 1}),
        ] {
            assert!(bundle_sha256(&[("x", bad.clone())]).is_err(), "{bad}");
        }
        assert!(
            bundle_sha256(&[("x", serde_json::json!({"a": -9_007_199_254_740_991_i64}))]).is_ok()
        );
    }

    #[test]
    fn compiled_bundle_has_a_hash() {
        // spec: 21 §3 (the binary reports contractSha256 of its bundle)
        let bundle = pmb_contract::schema::bundle();
        assert_eq!(&bundle_sha256(&bundle).unwrap(), contract_sha256());
    }

    #[test]
    #[ignore = "native/contract/schema/v1 is not committed on this branch (the contract stream exports it); run with --ignored once it is"]
    fn committed_bundle_matches() {
        // spec: 21 §3 CI item 1, 20 §8 item 9 (schema contractSha256 equals the checked-in bundle)
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../contract/schema/v1");
        let mut files: Vec<(String, serde_json::Value)> = Vec::new();
        for e in std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display())) {
            let e = e.unwrap();
            let name = e.file_name().to_string_lossy().into_owned();
            if let Some(stem) = name.strip_suffix(".schema.json") {
                let v = serde_json::from_slice(&std::fs::read(e.path()).unwrap()).unwrap();
                files.push((stem.to_string(), v));
            }
        }
        assert!(!files.is_empty(), "{} has no schema file", dir.display());
        let named: Vec<(&str, serde_json::Value)> =
            files.iter().map(|(s, v)| (s.as_str(), v.clone())).collect();
        assert_eq!(&bundle_sha256(&named).unwrap(), contract_sha256());
    }
}
