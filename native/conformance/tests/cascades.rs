// spec: 12 §6.1, 12 §6.2, 12 §6.3, 12 §6.4, 12 §4.2, 12 §5.3, 12 §9.1, 30 §4, 30 §4.1, 22 §3.3
//
// G2 row "account event ordering and cascades (12 §6)". Every vector of
// vectors/cascades.json is a scripted strategy; C2 binds each to the testkit
// (30 §15: scripted inputs, inspection of intents per callback, account
// events, the canonical trace).

use pmb_conformance::vectors::{self, rows};
use serde_json::Value;

fn file() -> Value {
    vectors::load("cascades")
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
    let f = file();
    vectors::assert_well_formed(&f);
    for r in rows(&f) {
        assert!(r.get("script").is_some(), "{} has a script", vectors::id(r));
        assert!(
            r.get("expect").is_some(),
            "{} has expectations",
            vectors::id(r)
        );
        let profiles = r["profiles"].as_array().unwrap();
        assert!(!profiles.is_empty());
    }
}

// spec: 12 §6.2 — the literal ts-compat sequence of cs-01 is breadth-first
#[test]
fn cs01_literal_sequence_is_breadth_first() {
    let r = row("cs-01-breadth-first");
    let seq = r["expect"]["ts_compat_sequence"].as_array().unwrap();
    let cids: Vec<&str> = seq.iter().map(|e| e[1].as_str().unwrap()).collect();
    // every a/b event precedes every c event
    let last_ab = cids.iter().rposition(|c| *c == "a" || *c == "b").unwrap();
    let first_c = cids.iter().position(|c| *c == "c").unwrap();
    assert!(
        last_ab < first_c,
        "c's events are appended after all queued a/b events"
    );
    // per order: submitted, accepted, settlement_update, open (13 §5.1 step 2 + step 4)
    for cid in ["a", "b", "c"] {
        let kinds: Vec<&str> = seq
            .iter()
            .filter(|e| e[1] == cid)
            .map(|e| e[0].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            [
                "order_submitted",
                "order_accepted",
                "settlement_update",
                "order_open"
            ],
            "{cid}"
        );
    }
}

// spec: 12 §6.1 — cs-04's ts-compat callback kinds for a filled FOK (13 §5.1 step 3)
#[test]
fn cs04_fok_callback_kinds() {
    let r = row("cs-04-every-event-offered");
    let kinds: Vec<&str> = r["expect"]["ts_compat_callback_kinds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|k| k.as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        [
            "order_submitted",
            "order_accepted",
            "settlement_update(Matched)",
            "fill",
            "order_done(Filled)",
            "settlement_update(Confirmed)"
        ]
    );
}

macro_rules! skeleton {
    ($name:ident, $id:literal, $todo:literal) => {
        #[test]
        #[ignore = "C2: needs pmb-sdk testkit"]
        fn $name() {
            let r = row($id);
            let _script = r["script"].as_str().unwrap();
            todo!($todo);
        }
    };
}

// spec: 12 §6.2 (breadth-first FIFO), 30 §4 rule 6, 22 §3.3
// C2: scripted strategy: on_tick places a, b; on_event(OrderSubmitted a) places c.
// Assert the delivered (kind, cid) sequence equals expect.ts_compat_sequence in
// ts-compat and satisfies expect.realistic_invariant in realistic.
skeleton!(
    cs01_breadth_first,
    "cs-01-breadth-first",
    "C2: compare the callback sequence"
);
// spec: 12 §6.2 (second-level cascade), 60 §5.4 A1/A2
skeleton!(
    cs02_second_level_cascade,
    "cs-02-second-level-cascade",
    "C2: cancel from OrderOpen(c) lands after c's queued events"
);
// spec: 12 §6.2 (ledger → OM → trace → callback), 12 §9.1, 12 §9.2
skeleton!(
    cs03_ledger_applied_before_callback,
    "cs-03-delivery-pipeline-ledger-first",
    "C2: inspect portfolio() inside each callback"
);
// spec: 12 §6.1 (every delivered event is offered)
skeleton!(
    cs04_every_event_offered,
    "cs-04-every-event-offered",
    "C2: callbacks == trace event records"
);
// spec: 30 §4.1, 16 TF-3 (interests skip only the callback)
skeleton!(
    cs05_interests_skip_only_callback,
    "cs-05-interests-skip-only-the-callback",
    "C2: omit LIFECYCLE; identical trace, digest and stats"
);
// spec: 12 §6.3 (cascade budget → strategy_fault cascade_limit)
skeleton!(cs06_cascade_budget_fault, "cs-06-cascade-budget-fault", "C2: maxEventsPerDrain 8; candidate error class strategy_fault, cause cascade_limit, no MarketStats");
// spec: 12 §4.2 (event_clock), 30 §5 event_clock()
skeleton!(
    cs07_event_clock,
    "cs-07-event-clock",
    "C2: event_clock set by the first tick, advanced only by account events"
);
// spec: 12 §4.2 (decision stamp), 13 TC-C8
skeleton!(
    cs08_decision_stamp_ts_compat,
    "cs-08-decision-stamp-ts-compat",
    "C2 (D69): in tick N's execution-step callbacks tick().seq == N, now() == T1; g1 accepted, g2 and g3 rejected"
);
// spec: 12 §5.4, 60 INV-13, D23, 13 TC-C13
skeleton!(
    cs09_no_callbacks_outside_window,
    "cs-09-no-callbacks-outside-window",
    "C2: no callbacks after end; profile-specific terminal handling"
);
// spec: 12 §6.4, 12 §5.2, 14 P-4 (previous tick's plugin snapshot)
skeleton!(
    cs10_plugin_snapshot_previous_tick,
    "cs-10-plugin-snapshot-previous-tick",
    "C2 (D69): tick().seq == N, book N, plugins()/feeds() of tick N-1; needs a plugin through Requirements"
);
// spec: 12 §5.3 (synthetic ticks never run the execution step), 14 F-36
skeleton!(
    cs11_synthetic_tick_no_execution,
    "cs-11-synthetic-tick-no-execution",
    "C2: needs scripted feed updates"
);
// spec: 30 §4 rule 4 (fresh instance per market)
skeleton!(
    cs12_fresh_instance_per_market,
    "cs-12-fresh-instance-per-market",
    "C2: counter resets per market"
);
// spec: 12 §6.1 (engine-origin events offered), 60 §5.4 A1
skeleton!(
    cs13_engine_origin_events_offered,
    "cs-13-engine-origin-events-offered",
    "C2: intents from OrderSubmitted and OrderOpen callbacks"
);
