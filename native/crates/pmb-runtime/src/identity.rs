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
/// (20 §3, 21 §3).
///
/// D-PENDING: `native/contract/schema/v1/` is not committed on this branch
/// (the contract stream exports it), so there is nothing to `include_str!`.
/// The bundle is generated from the very `pmb-contract` types this binary
/// is compiled with, which by 21 §3 CI item 1 equals the committed files;
/// a test compares against the committed files when they exist.
pub fn contract_sha256() -> &'static Sha256Hex {
    static SHA: OnceLock<Sha256Hex> = OnceLock::new();
    SHA.get_or_init(|| {
        let bundle = pmb_contract::schema::bundle();
        pmb_contract::schema::contract_sha256(&bundle)
            .unwrap_or_else(|_| bundle_sha256_raw_utf8(&bundle))
    })
}

/// 21 §3 `contractSha256` with strings escaped exactly as `serde_json`
/// and `JSON.stringify` do and kept as raw UTF-8: files sorted by name,
/// each in canonical JSON (keys sorted bytewise, no whitespace), joined by
/// `\n`.
// D-PENDING: the pmb-contract canonicalizer on this branch refuses
// non-ASCII strings, and the generated schemas carry `§` in descriptions;
// the contract stream's fix (raw UTF-8 strings, ASCII keys) is this exact
// definition. Remove this fallback once that fix is merged.
pub fn bundle_sha256_raw_utf8(files: &[(&str, serde_json::Value)]) -> Sha256Hex {
    use sha2::{Digest, Sha256};
    let mut named: Vec<(String, &serde_json::Value)> = files
        .iter()
        .map(|(stem, v)| (pmb_contract::schema::file_name(stem), v))
        .collect();
    named.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    // serde_json's map is a BTreeMap (no `preserve_order`), so compact
    // serialization sorts keys bytewise.
    let parts: Vec<String> = named
        .iter()
        .map(|(_, v)| serde_json::to_string(v).expect("schema serializes"))
        .collect();
    let digest: [u8; 32] = Sha256::digest(parts.join("\n").as_bytes()).into();
    Sha256Hex::from_digest(&digest)
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
    fn raw_utf8_canonical_form_sorts_and_keeps_utf8() {
        // spec: 21 §3 (files sorted by name, canonical JSON, joined by \n)
        let a = serde_json::json!({"b": "§", "a": [1, {"d": 2, "c": "\n"}]});
        let b = serde_json::json!({"x": true});
        let one = bundle_sha256_raw_utf8(&[("zeta", b.clone()), ("alpha", a.clone())]);
        let two = bundle_sha256_raw_utf8(&[("alpha", a), ("zeta", b)]);
        assert_eq!(one, two);
        use sha2::{Digest, Sha256};
        let text = "{\"a\":[1,{\"c\":\"\\n\",\"d\":2}],\"b\":\"§\"}\n{\"x\":true}";
        let want: [u8; 32] = Sha256::digest(text.as_bytes()).into();
        assert_eq!(one, Sha256Hex::from_digest(&want));
    }

    #[test]
    fn committed_bundle_matches_when_present() {
        // spec: 21 §3 CI item 1, 20 §8 item 9 (schema contractSha256 equals the checked-in bundle)
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../contract/schema/v1");
        let Ok(rd) = std::fs::read_dir(&dir) else {
            eprintln!("skip: {} not committed on this branch", dir.display());
            return;
        };
        let mut files: Vec<(String, serde_json::Value)> = Vec::new();
        for e in rd {
            let e = e.unwrap();
            let name = e.file_name().to_string_lossy().into_owned();
            if let Some(stem) = name.strip_suffix(".schema.json") {
                let v = serde_json::from_slice(&std::fs::read(e.path()).unwrap()).unwrap();
                files.push((stem.to_string(), v));
            }
        }
        if files.is_empty() {
            eprintln!("skip: {} is empty", dir.display());
            return;
        }
        let named: Vec<(&str, serde_json::Value)> =
            files.iter().map(|(s, v)| (s.as_str(), v.clone())).collect();
        let committed = pmb_contract::schema::contract_sha256(&named)
            .unwrap_or_else(|_| bundle_sha256_raw_utf8(&named));
        assert_eq!(&committed, contract_sha256());
    }
}
