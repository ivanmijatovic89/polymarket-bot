// spec: 10 §6.1 RNG-1 … RNG-7, 14 F-51, 13 §5.1 (compat_jitter entity), 60 DET-13
//
// G2 row "seed vectors (10 RNG-7)". The whole RNG-7 table is checked today
// against the independent implementation in src/rng.rs; C2 adds the
// black-box `selftest` run (20 §5.3) and, where the testkit exposes draws,
// the engine's own values.

use pmb_conformance::rng;
use pmb_conformance::vectors::{self, rows, s};
use serde_json::Value;

fn file() -> Value {
    vectors::load("seed_vectors")
}

fn hex(v: &Value) -> u64 {
    let t = v.as_str().expect("hex string");
    u64::from_str_radix(t.trim_start_matches("0x"), 16).unwrap_or_else(|e| panic!("{t}: {e}"))
}

fn slug(f: &Value) -> &str {
    f["constants"]["slug"].as_str().unwrap()
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 10 RNG-7 (SplitMix64 reference outputs from state 0)
#[test]
fn splitmix64_reference_outputs() {
    let f = file();
    let row = rows(&f)
        .iter()
        .find(|r| vectors::id(r) == "splitmix-reference")
        .unwrap();
    let want: Vec<u64> = row["expected"]
        .as_array()
        .unwrap()
        .iter()
        .map(hex)
        .collect();
    assert_eq!(rng::splitmix64_reference(2), want);
}

// spec: 10 RNG-2, RNG-7 rows 1–3
#[test]
fn market_seeds() {
    let f = file();
    for row in rows(&f).iter().filter(|r| r["kind"] == "market_seed") {
        let run_seed = row["run_seed"].as_u64().unwrap();
        assert!(run_seed <= (1u64 << 53) - 1, "RNG-1 range");
        let got = rng::market_seed(run_seed, slug(&f));
        assert_eq!(got, hex(&row["expected"]), "{}", vectors::id(row));
    }
}

// spec: 10 RNG-3 (a), RNG-7 rows 4–5
#[test]
fn stream_seeds() {
    let f = file();
    for row in rows(&f).iter().filter(|r| r["kind"] == "stream_seed") {
        let ms = rng::market_seed(row["run_seed"].as_u64().unwrap(), slug(&f));
        let got = rng::stream_seed(ms, s(row, "tag"));
        assert_eq!(got, hex(&row["expected"]), "{}", vectors::id(row));
    }
}

// spec: 10 RNG-3 (b), RNG-7 row 11
#[test]
fn feed_stream_seeds() {
    let f = file();
    for row in rows(&f).iter().filter(|r| r["kind"] == "feed_stream_seed") {
        let got = rng::feed_stream_seed(row["run_seed"].as_u64().unwrap(), s(row, "tag"));
        assert_eq!(got, hex(&row["expected"]), "{}", vectors::id(row));
    }
}

// spec: 10 RNG-4, RNG-5, RNG-7 rows 6, 8, 10, 14
#[test]
fn per_market_draws() {
    let f = file();
    for row in rows(&f).iter().filter(|r| r["kind"] == "draws") {
        let ms = rng::market_seed(row["run_seed"].as_u64().unwrap(), slug(&f));
        let ss = rng::stream_seed(ms, s(row, "tag"));
        let entity = match row.get("entity_raw") {
            Some(e) => e.as_u64().unwrap(),
            None => rng::entity(
                row["entity_kind"].as_u64().unwrap(),
                row["entity_id"].as_u64().unwrap(),
            ),
        };
        if let Some(packed) = row.get("entity") {
            assert_eq!(entity, hex(packed), "{} entity packing", vectors::id(row));
        }
        for (i, want) in row["expected"].as_array().unwrap().iter().enumerate() {
            assert_eq!(
                rng::draw(ss, entity, i as u64),
                hex(want),
                "{} draw({i})",
                vectors::id(row)
            );
        }
    }
}

// spec: 10 RNG-6 (open unit interval), RNG-7 row 7
#[test]
fn open_unit_interval() {
    let f = file();
    for row in rows(&f).iter().filter(|r| r["kind"] == "open_unit") {
        let ms = rng::market_seed(row["run_seed"].as_u64().unwrap(), slug(&f));
        let ss = rng::stream_seed(ms, s(row, "tag"));
        let entity = rng::entity(
            row["entity_kind"].as_u64().unwrap(),
            row["entity_id"].as_u64().unwrap(),
        );
        let d = rng::draw(ss, entity, row["draw_index"].as_u64().unwrap());
        let u = rng::open_unit(d);
        assert_eq!(u, row["expected"].as_f64().unwrap(), "{}", vectors::id(row));
        assert!(u > 0.0 && u < 1.0);
    }
}

// spec: 10 RNG-6 (integer uniform in [−j, j]), RNG-7 row 9, 13 §5.1 (entity = command seq, kind 5)
#[test]
fn compat_jitter_mapping() {
    let f = file();
    for row in rows(&f).iter().filter(|r| r["kind"] == "jitter") {
        let ms = rng::market_seed(row["run_seed"].as_u64().unwrap(), slug(&f));
        let ss = rng::stream_seed(ms, s(row, "tag"));
        let j = row["j"].as_i64().unwrap();
        let kind = row["entity_kind"].as_u64().unwrap();
        let want: Vec<i64> = row["expected"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap())
            .collect();
        let got: Vec<i64> = row["commands"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| rng::uniform_in(ss, rng::entity(kind, c.as_u64().unwrap()), -j, j))
            .collect();
        assert_eq!(got, want, "{}", vectors::id(row));
    }
}

// spec: 14 F-51 (feed entities, run-level streams), RNG-7 rows 12–13
#[test]
fn feed_draws_and_chainlink_entity() {
    let f = file();
    for row in rows(&f).iter().filter(|r| r["kind"] == "feed_draws") {
        let fss = rng::feed_stream_seed(row["run_seed"].as_u64().unwrap(), s(row, "tag"));
        let entity = row["entity"].as_u64().unwrap();
        for (i, want) in row["expected"].as_array().unwrap().iter().enumerate() {
            assert_eq!(
                rng::draw(fss, entity, i as u64),
                hex(want),
                "{} draw({i})",
                vectors::id(row)
            );
        }
    }
    for row in rows(&f).iter().filter(|r| r["kind"] == "chainlink") {
        let entity = rng::chainlink_entity(
            row["timestamp_us"].as_u64().unwrap(),
            row["server_timestamp_us"].as_u64().unwrap(),
        );
        assert_eq!(
            entity,
            hex(&row["expected_entity"]),
            "{} entity",
            vectors::id(row)
        );
        let fss = rng::feed_stream_seed(row["run_seed"].as_u64().unwrap(), s(row, "tag"));
        assert_eq!(
            rng::draw(fss, entity, 0),
            hex(&row["expected_draw0"]),
            "{} draw(0)",
            vectors::id(row)
        );
    }
}

// spec: 10 RNG-6 open unit interval at the top of the range (D68)
#[test]
fn open_unit_top_of_range_stays_below_one() {
    let top = u64::MAX; // draw >> 11 == 2^53 - 1
    let u = rng::open_unit(top);
    assert!(u < 1.0 && u > 0.0);
    assert_eq!(u, 1.0 - 2f64.powi(-53));
    assert_eq!(rng::open_unit(0), 0.5 * 2f64.powi(-53));
}

// spec: 10 RNG-6 (rejection sampling is unbiased: n × floor(2^64 / n) bound)
#[test]
fn uniform_below_respects_bound() {
    let ss = rng::stream_seed(rng::market_seed(0, "btc-updown-15m-1780272000"), "place");
    for n in [1u64, 2, 3, 201, 1_000_000, u64::MAX] {
        let (v, _) = rng::uniform_below(ss, rng::entity(1, 7), n);
        assert!(v < n);
    }
}

// spec: 60 DET-13, 21 §3 CI item 7 — the RNG-7 vectors pass in `selftest`
// C2: run `<artifact> selftest` (20 §5.3) and assert the seed-derivation check
// is listed and ok; `describe` is pure so this is a black-box binary run.
#[test]
#[ignore = "C2-gap: needs the canonical artifact binary (20 §5.3)"]
fn det13_selftest_reports_seed_vectors_ok() {
    todo!("C2: spawn `selftest`, parse {{type:\"selftest\", ok, checks[]}}, find the RNG-7 check");
}

// spec: 10 I1, 21 §8 C5, 60 DET-10 — seeds never depend on idx, candidate index or worker
// C2: run the same market as candidate 0 and as candidate 3 of a 4-candidate
// group and standalone; realistic profile with a non-constant latency model so
// draws matter; assert identical resultDigest.
#[test]
#[ignore = "C2-gap: needs the artifact binary (run-group, realistic latency draws; C4 scope)"]
fn i1_streams_independent_of_candidate_index() {
    todo!("C2");
}
