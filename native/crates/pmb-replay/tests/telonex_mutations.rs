//! spec: 15 I-8, I-V3; 20 §4 — no corrupt input makes the reader panic. A
//! panic would be an `engine_fault` (no retry on another host); every
//! mutation of a crafted file must instead decode or fail with an input
//! class. Lives alone in its own test binary because it silences the panic
//! hook for the whole process while the Parquet decoder's internal panics
//! are caught.

use pmb_replay::{read_telonex_delta, InputFile, InputFormat, TelonexInput};
use std::path::PathBuf;

#[test]
fn mutated_files_never_panic() {
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/golden/telonex/crafted/asset_order.parquet");
    let bytes = std::fs::read(src).unwrap();
    let dir = std::env::temp_dir().join(format!("pmb-replay-mutations-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("m.parquet");
    std::panic::set_hook(Box::new(|_| {}));
    let mut outcomes = std::collections::BTreeMap::<String, u32>::new();
    // Deterministic mutations: every byte XOR one of two masks, plus
    // truncations, plus 32-bit "length" overwrites across the footer.
    let mut cases: Vec<Vec<u8>> = Vec::new();
    for at in 0..bytes.len() {
        for mask in [0x01u8, 0xff] {
            let mut b = bytes.clone();
            b[at] ^= mask;
            cases.push(b);
        }
    }
    for cut in (0..bytes.len()).step_by(97) {
        cases.push(bytes[..cut].to_vec());
    }
    let footer = bytes.len().saturating_sub(600);
    for at in footer..bytes.len().saturating_sub(4) {
        let mut b = bytes.clone();
        b[at..at + 4].copy_from_slice(&0x7fff_fff0u32.to_le_bytes());
        cases.push(b);
    }
    for b in &cases {
        std::fs::write(&path, b).unwrap();
        let res = std::panic::catch_unwind(|| {
            read_telonex_delta(
                &InputFile {
                    path: &path,
                    bytes: b.len() as u64,
                    sha256: None,
                    format: InputFormat {
                        name: "telonex-delta-typed",
                        version: 1,
                    },
                },
                TelonexInput {
                    tokens: ["111111", "222222"],
                    condition_id: None,
                },
            )
            .map(|t| t.len())
        });
        let key = match res {
            Err(_) => "PANIC".to_string(),
            Ok(Ok(_)) => "ok".to_string(),
            Ok(Err(e)) if e.detail.contains("decoder panic") => {
                format!("{}: {} (caught decoder panic)", e.class.as_str(), e.cause)
            }
            Ok(Err(e)) => format!("{}: {}", e.class.as_str(), e.cause),
        };
        *outcomes.entry(key).or_default() += 1;
    }
    let _ = std::panic::take_hook();
    eprintln!("{} cases: {outcomes:?}", cases.len());
    let allowed = [
        "ok",
        "runtime: decode_unverified",
        "runtime: decode_unverified (caught decoder panic)",
        "data_defect: format_version",
        "data_defect: foreign_file",
    ];
    assert!(
        outcomes.keys().all(|k| allowed.contains(&k.as_str())),
        "{} cases: {outcomes:?}",
        cases.len()
    );
}
