// spec: 21 §13, 21 §1.1, 21 §11, 21 §14, 21 §15, 21 §17, 12 §6.3, 12 §11, 20 §4.1
//
// G2 row "skip taxonomy (21 §13)". Rows decided by the engine are black-box
// binary runs (EngineJob in, EngineResult out) or testkit sessions; rows
// decided by the TS shim are documented as unreachable through the binary.

use pmb_conformance::vectors::{self, rows};
use serde_json::Value;

fn file() -> Value {
    vectors::load("skip_taxonomy")
}

fn row(id: &str) -> Value {
    rows(&file())
        .iter()
        .find(|r| vectors::id(r) == id)
        .cloned()
        .unwrap_or_else(|| panic!("{id} missing"))
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 21 §17 (skipReason vocabularies) — every value the table uses is in the closed sets
#[test]
fn skip_reasons_are_in_the_closed_vocabularies() {
    let voc = vectors::load("vocabularies");
    let top: Vec<&str> = rows(&voc)
        .iter()
        .find(|r| vectors::id(r) == "voc-top-skip-reason")
        .unwrap()["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    let stats: Vec<&str> = rows(&voc)
        .iter()
        .find(|r| vectors::id(r) == "voc-stats-skip-reason")
        .unwrap()["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(
        top,
        [
            "no_slug",
            "no_resolution",
            "unresolved_outcome",
            "no_activity",
            "incomplete_capture"
        ]
    );
    assert_eq!(stats, ["no_in_window_activity"]);
    for r in rows(&file()) {
        if let Some(t) = r.get("top_level_skip_reason").and_then(Value::as_str) {
            assert!(top.contains(&t), "{}: {t}", vectors::id(r));
        }
        if let Some(m) = r.get("market_stats_skip_reason").and_then(Value::as_str) {
            assert!(stats.contains(&m), "{}: {m}", vectors::id(r));
        }
    }
}

// spec: 21 §13 — denominators: only rows with a market row count
#[test]
fn denominator_rule() {
    for r in rows(&file()) {
        let Some(counts) = r.get("counts_in_denominators").and_then(Value::as_bool) else {
            continue;
        };
        let persisted = r.get("persisted").and_then(Value::as_str).unwrap_or("");
        assert_eq!(
            counts,
            persisted.starts_with("market row"),
            "{}",
            vectors::id(r)
        );
    }
}

// spec: 21 §13 row 2 — the zero row's fields
#[test]
fn zero_row_shape() {
    let r = row("sk-02-no-in-window-activity");
    let z = &r["zero_row_expectations"];
    assert_eq!(z["pnl"], "0.00");
    assert_eq!(z["tradeCount"], 0);
    assert!(z["avgEntryPriceUp"].is_null() && z["avgEntryPriceDown"].is_null());
    assert_eq!(z["intentMeta"].as_array().unwrap().len(), 0);
}

macro_rules! skeleton {
    ($name:ident, $id:literal, $todo:literal) => {
        #[test]
        #[ignore = "C2-gap: skipReason, eventsProcessed and eventsByType are not in the testkit final record (Debug FinalStats only); needs the artifact binary"]
        fn $name() {
            let r = row($id);
            let _ = &r;
            todo!($todo);
        }
    };
}

// spec: 21 §13 row 1
skeleton!(
    sk01_activity_full_stats,
    "sk-01-activity",
    "C2: a filled session has full stats and no skipReason"
);
// spec: 21 §13 row 2
skeleton!(
    sk02_no_in_window_activity_zero_row,
    "sk-02-no-in-window-activity",
    "C2: never-placing strategy -> zero row + no_in_window_activity + top-level no_activity"
);
// spec: 21 §13 row 2 (no tick passed the gate), 12 §5.4
skeleton!(
    sk02b_all_ticks_outside_window,
    "sk-02b-all-ticks-outside-window",
    "C2: input entirely before start; eventsProcessed > 0; zero row; marketId set"
);
// spec: 21 §13 (split/merge-only money), 13 §5.4
skeleton!(
    sk02c_split_merge_only,
    "sk-02c-split-merge-only",
    "C2: splitCost 5.00, pnl 0.00, zero row"
);
// spec: 21 §13 row 1 (positions count as activity)
skeleton!(
    sk02d_split_only_is_activity,
    "sk-02d-split-only-is-activity",
    "C2: full row with upShares 5.00 / downShares 5.00"
);
// spec: 21 §13 row 3
skeleton!(
    sk03_no_counted_tick_null_stats,
    "sk-03-no-counted-tick",
    "C2: input with no book/price_change -> marketStats null, eventsProcessed 0, conditionId null"
);
// spec: 21 §13 rows 4–6 (TS shim) — unreachable through the binary (21 §5.1)
skeleton!(
    sk04_06_shim_rows_unreachable,
    "sk-05-no-resolution",
    "C2: job without tokenIds / with outcome null -> exit 2 invalid_input: market (never a skip)"
);
// spec: 21 §13 row 7 (V4 coverage gate; M7)
skeleton!(
    sk07_incomplete_capture,
    "sk-07-incomplete-capture",
    "G2 outline; executable from M7 with V4 fixture packages"
);
// spec: 21 §13 row 8, 12 §11, 20 §4.1
skeleton!(sk08_strategy_fault_candidate, "sk-08-strategy-fault-candidate", "C2: panicking test strategy in a group: status error, class strategy_fault, no output; others ok; run exit 7, run-group exit 0");
// spec: 21 §15 — eventsProcessed and eventsByType
skeleton!(
    sk11_events_processed,
    "sk-11-events-processed-definition",
    "C2: eventsByType sums to eventsProcessed; keys closed; strategyTicksSkipped excluded"
);
