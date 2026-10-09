//! spec: 16 §7.5 NT-4, NT-5, NT-6 (b); 15 I-55, I-V6 — CI proof on the
//! committed fixture `tests/fixtures/telonex-mini.parquet` (3,000 rows of
//! `btc-updown-15m-1785028500` plus crafted rows for every skip and anomaly
//! case; regenerate with `cargo test -p pmb-tape -- --ignored
//! regenerate_fixture`). The engine event stream read through the tape equals
//! the v1 reader's stream, and both match the pinned digest.

use pmb_replay::telonex::file_asset_ids;
use pmb_replay::{read_telonex_delta, TelonexInput};
use pmb_tape::codec::{Decoder, EncodeOptions};
use pmb_tape::compare::{digest, first_difference};
use pmb_tape::store::{self, hex, Budget, ConvertOptions, ConvertOutcome};
use pmb_tape::{read_market, InputPath, MarketStream};
use std::path::{Path, PathBuf};

/// Digest of the fixture's event stream (`pmb_tape::compare::digest`).
const STREAM_DIGEST: &str = "6f2be512d177e68f4680b089bb29a1e46d1ad213c70465a6789b0a1c19e073f5";

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/telonex-mini.parquet")
}

/// The tape root, removed on drop (also when an assertion fails).
struct Root(PathBuf);

impl Drop for Root {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Converts the fixture at `block_rows` and checks both paths against each
/// other and against the pinned digest.
fn check_fixture(block_rows: u32) {
    let v1 = fixture();
    let tokens = file_asset_ids(&v1).unwrap();
    let input = TelonexInput {
        format_version: 1,
        tokens: [tokens[0].as_str(), tokens[1].as_str()],
        condition_id: None,
    };
    let root = Root(Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "pmb-tape-fixture-{}-{block_rows}",
        std::process::id()
    )));
    let _ = std::fs::remove_dir_all(&root.0);
    let key = store::MarketKey {
        format: "telonex-delta-typed",
        format_version: 1,
        symbol: "btc",
        timeframe: "15m",
        slug: "telonex-mini",
    };
    let tape = store::tape_path(&root.0, &key).unwrap();
    let mut budget = Budget::new(&root.0, u64::MAX, 0).unwrap();
    let mut decoder = Decoder::new().unwrap();
    let opts = ConvertOptions {
        encode: EncodeOptions {
            block_rows,
            ..EncodeOptions::default()
        },
        tool_sha256: [0; 32],
    };
    let out = store::convert_one(&v1, &tape, None, &opts, &mut budget, &mut decoder).unwrap();
    let ConvertOutcome::Written {
        tape_bytes,
        v1_bytes,
        rows,
        ..
    } = out
    else {
        panic!("{out:?}")
    };
    assert_eq!(rows, 3007);
    assert!(tape_bytes < v1_bytes, "{tape_bytes} vs {v1_bytes}");
    let blocks = decoder
        .header(&std::fs::read(&tape).unwrap())
        .unwrap()
        .blocks
        .len();
    assert_eq!(blocks, 3007usize.div_ceil(block_rows as usize));

    // The executor path (block-streamed decode and replay).
    let (from_tape, path) = read_market(&v1, Some(&tape), None, &input, &mut decoder).unwrap();
    assert_eq!(path, InputPath::Tape);
    let from_v1 = MarketStream::V1(read_telonex_delta(&v1, &input).unwrap());
    assert_eq!(first_difference(&from_v1, &from_tape), None);

    let d = from_v1.diagnostics();
    assert_eq!(d.rows_read, 3007);
    assert_eq!(d.skipped.blank_market, 1);
    assert_eq!(d.skipped.no_exchange_ts, 2);
    assert_eq!(d.skipped.unresolved_book_asset, 1);
    assert_eq!(d.skipped.empty_price_change, 1);
    assert_eq!(d.dropped_changes, 2);
    assert_eq!(d.inexact_decimal, 3);
    assert!(d.ingest_seq_backwards >= 1);
    assert!(d.exchange_clock_backwards >= 1);
    assert!(d.local_behind_exchange >= 1);
    let dig = hex(&digest(&from_tape));
    assert_eq!(dig, hex(&digest(&from_v1)));
    assert_eq!(dig, STREAM_DIGEST);
}

#[test]
fn fixture_tape_stream_equals_v1_stream() {
    check_fixture(EncodeOptions::default().block_rows);
}

/// Real rows across block boundaries (4 blocks of at most 1,000 rows), the
/// streamed path real markets take when they exceed one 65,536-row block.
#[test]
fn fixture_tape_stream_equals_v1_stream_in_small_blocks() {
    check_fixture(1_000);
}
