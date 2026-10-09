// spec: 11 §6.1 TD1–TD5, 11 §6.2 D0–D5 (TD6, TD7), 11 §6.3, 13 §6.3, D52
//
// G3 data table (60 §10.2 "taker delay (11 §6)"). The data tests check the
// dated table and the lookup rule (keyed by exchange arrival time); the
// behaviors are realistic-profile skeletons.

use pmb_conformance::time::parse_iso_utc;
use pmb_conformance::vectors::{self, rows};
use serde_json::Value;

fn file() -> Value {
    vectors::load("taker_delay")
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 11 §6.2 — six rows, contiguous, epochs match ISO labels, delays as listed
#[test]
fn delay_table_contiguous_and_dated() {
    let f = file();
    let rs = rows(&f);
    let ids: Vec<&str> = rs.iter().map(vectors::id).collect();
    assert_eq!(ids, ["D0", "D1", "D2", "D3", "D4", "D5"]);
    let delays: Vec<i64> = rs.iter().map(|r| r["delay_ms"].as_i64().unwrap()).collect();
    assert_eq!(delays, [500, 0, 250, 250, 50, 150]);
    let cancelable: Vec<Option<bool>> = rs
        .iter()
        .map(|r| r["cancelable_in_window"].as_bool())
        .collect();
    assert_eq!(
        cancelable,
        [
            None,
            None,
            Some(true),
            Some(false),
            Some(false),
            Some(false)
        ]
    );
    for (i, r) in rs.iter().enumerate() {
        if let Some(from) = r["from_iso"].as_str() {
            assert_eq!(
                parse_iso_utc(from),
                r["from_ms"].as_i64().unwrap(),
                "{} from",
                vectors::id(r)
            );
        }
        if let Some(to) = r["to_iso"].as_str() {
            assert_eq!(
                parse_iso_utc(to),
                r["to_ms"].as_i64().unwrap(),
                "{} to",
                vectors::id(r)
            );
        }
        if i + 1 < rs.len() {
            assert_eq!(
                r["to_ms"],
                rs[i + 1]["from_ms"],
                "{} contiguous",
                vectors::id(r)
            );
        }
    }
    assert!(rs[0]["from_ms"].is_null() && rs[5]["to_ms"].is_null());
    // Only D4 and D5 are changelog rows (TD6).
    for r in &rs[..4] {
        assert!(
            r["status"].as_str().unwrap().starts_with("ThirdParty"),
            "{}",
            vectors::id(r)
        );
    }
    for r in &rs[4..] {
        assert!(
            r["status"].as_str().unwrap().starts_with("Changelog"),
            "{}",
            vectors::id(r)
        );
    }
}

fn lookup(f: &Value, arrival_ms: i64) -> (String, i64, Option<bool>) {
    for r in rows(f) {
        let from = r["from_ms"].as_i64().unwrap_or(i64::MIN);
        let to = r["to_ms"].as_i64().unwrap_or(i64::MAX);
        if from <= arrival_ms && arrival_ms < to {
            return (
                vectors::id(r).to_string(),
                r["delay_ms"].as_i64().unwrap(),
                r["cancelable_in_window"].as_bool(),
            );
        }
    }
    panic!("no row for {arrival_ms}")
}

// spec: 11 TD5, 13 §6.3 (keyed by exchange arrival time, [from, to))
#[test]
fn lookups_by_arrival_time() {
    let f = file();
    for l in f["lookups"].as_array().unwrap() {
        let Some(arrival) = l["arrival_exchange_ms"].as_i64() else {
            continue;
        };
        let (row, delay, cancelable) = lookup(&f, arrival);
        let e = &l["expected"];
        assert_eq!(row, e["row"].as_str().unwrap(), "{}", l["id"]);
        assert_eq!(delay, e["delay_ms"].as_i64().unwrap(), "{}", l["id"]);
        if let Some(c) = e["cancelable"].as_bool() {
            assert_eq!(cancelable, Some(c), "{}", l["id"]);
        }
    }
    // TD7: market start never selects the row
    let l = f["lookups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == "lookup-market-start-vs-arrival")
        .unwrap();
    let (by_start, ..) = lookup(&f, l["market_start_ms"].as_i64().unwrap());
    let (by_arrival, ..) = lookup(&f, l["arrival_exchange_ms"].as_i64().unwrap());
    assert_eq!(by_start, "D4");
    assert_eq!(by_arrival, "D5");
}

// spec: 11 TD6, D52 — gate-3 evidence cutoff
#[test]
fn gate3_cutoff() {
    let f = file();
    let l = f["lookups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["id"] == "gate3-evidence-cutoff")
        .unwrap();
    assert_eq!(
        l["market_start_ms_min_for_gate3"].as_i64().unwrap(),
        parse_iso_utc("2026-08-17T11:00:00Z")
    );
    let (row, ..) = lookup(&f, l["market_start_ms_min_for_gate3"].as_i64().unwrap());
    assert_eq!(row, "D4");
}

// spec: 11 TD1 — only marketable orders are delayed; post-only never
#[test]
#[ignore = "G3: needs pmb-sdk testkit (realistic profile)"]
fn td1_marketable_only() {
    todo!("G3: marketable GTC -> OrderDelayed; non-marketable -> OrderOpen; post-only marketable -> PostOnlyWouldCross, never Delayed");
}

// spec: 11 TD2, TD3, 10 §8.2 rows 6–9 — release semantics
#[test]
#[ignore = "G3: needs pmb-sdk testkit (realistic profile)"]
fn td3_release_revalidates_and_matches() {
    todo!("G3: release after delay_ms; re-validation; FOK killed without fills when not fully fillable");
}

// spec: 11 TD4 — cancel inside an irrevocable window fails; cancellable row succeeds
#[test]
#[ignore = "G3: needs pmb-sdk testkit (realistic profile)"]
fn td4_cancel_in_window_per_row() {
    todo!("G3: D3/D4/D5 -> CancelFailed(NotCancelableDuringDelay); D2 -> canceled");
}

// spec: 11 TD6 — markets hitting D0–D3 list the rule id in unverifiedRules
#[test]
#[ignore = "G3: needs the artifact binary"]
fn td6_unverified_rules_listed() {
    todo!("G3: MarketStats.rules.unverifiedRules contains delay.d2 for an order arriving under D2");
}

// spec: 11 §6.3 — Gamma secondsDelay > 0 overrides the dated value, flagged
#[test]
#[ignore = "G3: needs the artifact binary"]
fn seconds_delay_override() {
    todo!("G3: captured secondsDelay 3 -> delay 3000 ms, diagnostic unexpected_seconds_delay");
}
