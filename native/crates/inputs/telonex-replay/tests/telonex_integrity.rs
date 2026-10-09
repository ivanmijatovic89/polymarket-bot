//! spec: 15 I-8, I-9, §9, I-V3; 20 §4.1 — the binary verifies every input
//! file again (`bytes` always, `sha256` when present), memoizes hashes per
//! process, and classifies decode failures by whether the sha256 was
//! verified. Flipped bytes, wrong sizes and truncated files each yield the
//! documented class and cause.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use telonex_replay::integrity::hash_memoized;
use telonex_replay::{read_telonex_delta, InputError, InputFile, InputFormat, TelonexInput};

const V1: InputFormat<'static> = InputFormat {
    name: "telonex-delta-typed",
    version: 1,
};
const TOKENS: [&str; 2] = ["111111", "222222"];

fn crafted(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/golden/telonex/crafted")
        .join(format!("{name}.parquet"))
        .canonicalize()
        .unwrap()
}

fn sha_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A scratch copy of `bytes` under the system temp dir.
fn scratch(name: &str, bytes: &[u8]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("telonex-replay-integrity-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join(name);
    std::fs::write(&p, bytes).unwrap();
    p
}

fn read(path: &Path, bytes: u64, sha256: Option<&str>) -> Result<usize, InputError> {
    read_telonex_delta(
        &InputFile {
            path,
            bytes,
            sha256,
            format: V1,
        },
        TelonexInput {
            tokens: TOKENS,
            condition_id: None,
        },
    )
    .map(|t| t.len())
}

fn class(r: Result<usize, InputError>) -> (&'static str, &'static str) {
    let e = r.expect_err("an error");
    (e.class.as_str(), e.cause)
}

#[test]
fn bytes_are_always_checked() {
    let path = crafted("asset_order");
    let len = std::fs::metadata(&path).unwrap().len();
    assert_eq!(read(&path, len, None).unwrap(), 3);
    for wrong in [len - 1, len + 1, 0] {
        assert_eq!(
            class(read(&path, wrong, None)),
            ("data_defect", "integrity_mismatch")
        );
    }
}

#[test]
fn sha256_is_checked_when_present_and_memoized() {
    let bytes = std::fs::read(crafted("skip_rows")).unwrap();
    let path = scratch("memo.parquet", &bytes);
    let len = bytes.len() as u64;
    let good = sha_hex(&bytes);
    assert!(!hash_memoized(&path));
    let tape = read_telonex_delta(
        &InputFile {
            path: &path,
            bytes: len,
            sha256: Some(&good),
            format: V1,
        },
        TelonexInput {
            tokens: TOKENS,
            condition_id: None,
        },
    )
    .unwrap();
    assert!(tape.meta.sha256_verified);
    assert!(hash_memoized(&path), "I-9: the hash is memoized");
    assert_eq!(read(&path, len, Some(&good)).unwrap(), tape.len());

    let mut wrong = good.clone();
    wrong.replace_range(0..1, if &good[0..1] == "0" { "1" } else { "0" });
    assert_eq!(
        class(read(&path, len, Some(&wrong))),
        ("data_defect", "integrity_mismatch")
    );
    assert_eq!(
        class(read(&path, len, Some(&good.to_uppercase()))),
        ("invalid_input", "schema")
    );
}

#[test]
fn decode_failures_are_classified_by_verification() {
    // spec: 15 I-8, §9 — `runtime: decode_unverified` while the sha256 is
    // unknown (retried on another host), `data_defect: corrupt` once verified.
    let path = crafted("bad_decimal");
    let bytes = std::fs::read(&path).unwrap();
    let len = bytes.len() as u64;
    assert_eq!(
        class(read(&path, len, None)),
        ("runtime", "decode_unverified")
    );
    assert_eq!(
        class(read(&path, len, Some(&sha_hex(&bytes)))),
        ("data_defect", "corrupt")
    );
}

#[test]
fn truncated_files() {
    // spec: I-V3 — a truncated file is a size mismatch against the job; a
    // file that was truncated before the job was made (size and sha256 of
    // the truncated bytes) is a decode failure.
    let bytes = std::fs::read(crafted("skip_rows")).unwrap();
    for cut in [bytes.len() - 1, bytes.len() - 8, bytes.len() / 2, 12, 0] {
        let part = &bytes[..cut];
        let path = scratch(&format!("truncated-{cut}.parquet"), part);
        assert_eq!(
            class(read(&path, bytes.len() as u64, None)),
            ("data_defect", "integrity_mismatch"),
            "cut {cut}"
        );
        assert_eq!(
            class(read(&path, cut as u64, None)),
            ("runtime", "decode_unverified"),
            "cut {cut}"
        );
        assert_eq!(
            class(read(&path, cut as u64, Some(&sha_hex(part)))),
            ("data_defect", "corrupt"),
            "cut {cut}"
        );
    }
}

#[test]
fn flipped_bytes() {
    // spec: I-V3 — a flipped byte is an integrity mismatch when the job has
    // the sha256 of the original; without it, a flip in the footer or in a
    // compressed data page is a decode failure.
    let bytes = std::fs::read(crafted("skip_rows")).unwrap();
    let len = bytes.len() as u64;
    let good = sha_hex(&bytes);
    let footer_len =
        u32::from_le_bytes(bytes[bytes.len() - 8..bytes.len() - 4].try_into().unwrap());
    let footer_start = bytes.len() - 8 - footer_len as usize;
    // The first GZIP member of a data page (magic 1f 8b), the footer length
    // and the trailing magic. (The leading magic is not read by the decoder:
    // a flip there is caught only by the sha256.)
    let gzip = bytes
        .windows(2)
        .position(|w| w == [0x1f, 0x8b])
        .expect("a GZIP page");
    assert!(gzip < footer_start);
    for (what, at) in [
        ("page", gzip + 1),
        ("footer length", bytes.len() - 8),
        ("tail magic", bytes.len() - 1),
    ] {
        let mut b = bytes.clone();
        b[at] ^= 0x5a;
        let path = scratch(&format!("flipped-{at}.parquet"), &b);
        assert_eq!(
            class(read(&path, len, Some(&good))),
            ("data_defect", "integrity_mismatch"),
            "{what}"
        );
        assert_eq!(
            class(read(&path, len, None)),
            ("runtime", "decode_unverified"),
            "{what} at {at}"
        );
        assert_eq!(
            class(read(&path, len, Some(&sha_hex(&b)))),
            ("data_defect", "corrupt"),
            "{what} at {at}"
        );
    }
}
