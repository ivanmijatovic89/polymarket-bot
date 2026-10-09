// spec: 10 §8.1, 10 §8.2 (one test per row), 10 §8.3 S1–S6, 10 §8.4, 13 §5.1, 13 §6.7
//
// G2 row "Order state machine (one test per row of 10 §8.2)". The row tests
// are skeletons bound in C2 to pmb_sdk::testkit: each drives the row's input
// and asserts the row's event list (ts-compat: the `ts_compat_events`
// sequence) and the resulting OrderView.state. The forbidden list is asserted
// over every trace the G2 scenarios produce.

use pmb_conformance::vectors::{self, rows};
use serde_json::Value;
use std::collections::BTreeSet;

fn file() -> Value {
    vectors::load("order_state_machine")
}

fn row(id: &str) -> Value {
    rows(&file())
        .iter()
        .find(|r| vectors::id(r) == id)
        .cloned()
        .unwrap_or_else(|| panic!("row {id} missing"))
}

fn strs(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().map(|x| x.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}

#[test]
fn vectors_well_formed() {
    vectors::assert_well_formed(&file());
}

// spec: 10 §8.1 — the state sets and the TS lifecycle mapping (10 §8.4)
#[test]
fn state_sets_and_ts_mapping() {
    let f = file();
    let non_terminal = strs(&f["states"]["non_terminal"]);
    let terminal = strs(&f["states"]["terminal"]);
    assert_eq!(non_terminal, ["InFlight", "Delayed", "Live", "Unknown"]);
    assert_eq!(
        terminal,
        ["Filled", "Canceled", "Expired", "Killed", "Rejected"]
    );
    let m = f["states"]["ts_lifecycle_mapping"].as_object().unwrap();
    for s in ["InFlight", "Delayed", "Unknown"] {
        assert_eq!(m[s], "requested");
    }
    assert_eq!(m["Live(filled=0)"], "open");
    assert_eq!(m["Live(filled>0)"], "partially_filled");
    for t in &terminal {
        assert_eq!(
            m[t.as_str()],
            t.to_lowercase(),
            "{t} maps to its lower-case name"
        );
    }
}

// spec: 10 §8.2 — every row's target state is a known state (or a match/no-order marker)
#[test]
fn rows_reference_known_states() {
    let f = file();
    let known: BTreeSet<String> = strs(&f["states"]["non_terminal"])
        .into_iter()
        .chain(strs(&f["states"]["terminal"]))
        .collect();
    let mut ids = Vec::new();
    for r in rows(&f) {
        ids.push(vectors::id(r).to_string());
        let to = r["to"].as_str();
        if let Some(to) = to {
            let states: Vec<&str> = to
                .split(['|', '/', '+', '('])
                .map(|t| t.trim())
                .filter(|t| !t.is_empty())
                .collect();
            let head = states[0].split_whitespace().next().unwrap();
            assert!(
                known.contains(head) || head == "match" || head == "unchanged",
                "{}: unknown target state {head:?}",
                vectors::id(r)
            );
        }
        for p in strs(&r["profiles"]) {
            assert!(
                ["ts-compat", "realistic", "live"].contains(&p.as_str()),
                "{}: profile {p}",
                vectors::id(r)
            );
        }
    }
    // 21 rows of 10 §8.2, in order.
    let want: Vec<String> = (1..=21).map(|n| format!("r{n:02}")).collect();
    assert_eq!(ids, want);
}

// spec: 10 S1 — each terminal row names exactly one terminal event
#[test]
fn terminal_rows_name_one_terminal_event() {
    let f = file();
    let terminal = strs(&f["states"]["terminal"]);
    for r in rows(&f) {
        let Some(to) = r["to"].as_str() else { continue };
        let head = to
            .split(|c| c == ' ' || c == '(' || c == '|')
            .next()
            .unwrap();
        if terminal.iter().any(|t| t == head) && !to.contains('|') {
            let events = strs(&r["events"]);
            let terminal_events = events
                .iter()
                .filter(|e| e.starts_with("OrderDone") || e.starts_with("OrderRejected"))
                .count();
            assert_eq!(terminal_events, 1, "{}: events {events:?}", vectors::id(r));
            assert!(
                events.last().unwrap().starts_with("OrderDone")
                    || events.last().unwrap().starts_with("OrderRejected"),
                "{}: the terminal event comes last",
                vectors::id(r)
            );
        }
    }
}

// spec: 10 §8.2 forbidden patterns — each cites a clause and a profile set
#[test]
fn forbidden_list_well_formed() {
    let f = file();
    let mut ids = BTreeSet::new();
    for fb in f["forbidden"].as_array().unwrap() {
        assert!(ids.insert(fb["id"].as_str().unwrap().to_string()));
        assert!(fb["spec"].as_str().map_or(false, |s| !s.is_empty()));
        assert!(fb["pattern"].as_str().map_or(false, |s| !s.is_empty()));
        assert!(!strs(&fb["profiles"]).is_empty());
    }
    assert!(ids.contains("f-s1-absorbing"));
    assert!(ids.contains("f-ts-compat-cancel-acked"));
}

macro_rules! row_skeleton {
    ($name:ident, $id:literal, $todo:literal) => {
        #[test]
        #[ignore = "C2: needs pmb-sdk testkit"]
        fn $name() {
            let r = row($id);
            let _events = strs(&r["events"]);
            let _profiles = strs(&r["profiles"]);
            todo!($todo);
        }
    };
}

// spec: 10 §8.2 row 1
// C2: out.place(Order::buy(Up, bid - 0.01, qty!(5)).cid(cid!("a"))); first event
// for cid a is OrderSubmitted; inside that callback portfolio().order(&a).state == InFlight.
row_skeleton!(
    r01_submitted,
    "r01",
    "C2: assert OrderSubmitted first and state InFlight"
);
// spec: 10 §8.2 row 2 — engine rejection, no OrderSubmitted, no record
row_skeleton!(
    r02_engine_reject,
    "r02",
    "C2: size 0 / price 0 / post-only FOK / no capital -> OrderRejected{{Engine}} only"
);
// spec: 10 §8.2 row 3 — exchange rejection at arrival (post-only cross in ts-compat)
row_skeleton!(
    r03_exchange_reject,
    "r03",
    "C2: post-only at best ask -> OrderSubmitted, OrderRejected(PostOnlyWouldCross)"
);
// spec: 10 §8.2 row 4 — rests: OrderAccepted, (ts-compat: SettlementUpdate Matched), OrderOpen
row_skeleton!(
    r04_rests,
    "r04",
    "C2: assert ts_compat_events and state Live"
);
// spec: 10 §8.2 row 5 — marketable with delay 0: fills then OrderOpen or OrderDone
row_skeleton!(
    r05_marketable_no_delay,
    "r05",
    "C2: size <= depth -> Fill x n, OrderDone(Filled); size > depth -> Fill x n, OrderOpen"
);
// spec: 10 §8.2 row 6 — Delayed (realistic, taker delay > 0; G3)
row_skeleton!(
    r06_delayed,
    "r06",
    "C2/G3: OrderAccepted, OrderDelayed{{release_at}}"
);
// spec: 10 §8.2 row 7 — re-validation fails at release (G3)
row_skeleton!(
    r07_delayed_reject,
    "r07",
    "C2/G3: tick change during delay -> OrderRejected(InvalidTick)"
);
// spec: 10 §8.2 row 8 — still marketable at release (G3)
row_skeleton!(
    r08_delayed_match,
    "r08",
    "C2/G3: Fill x n then OrderOpen or OrderDone"
);
// spec: 10 §8.2 row 9 — no longer marketable at release (G3)
row_skeleton!(
    r09_delayed_rest_or_kill,
    "r09",
    "C2/G3: GTC -> OrderOpen; FOK -> OrderDone(Killed, 0)"
);
// spec: 10 §8.2 row 10 — cancel inside a non-cancellable delay window (G3)
row_skeleton!(
    r10_delayed_cancel_fails,
    "r10",
    "C2/G3: CancelFailed(NotCancelableDuringDelay), order stays Delayed"
);
// spec: 10 §8.2 row 11 — partial maker fill (realistic queue model; G3)
row_skeleton!(
    r11_partial_maker_fill,
    "r11",
    "C2/G3: Fill with remainder > 0 keeps Live; ts-compat: never"
);
// spec: 10 §8.2 row 12 — maker fill completes the size
row_skeleton!(
    r12_maker_fill_completes,
    "r12",
    "C2: Fill(MAKER, fee 0) then OrderDone(Filled)"
);
// spec: 10 §8.2 row 13 — ts-compat cancel: OrderDone(Canceled, filled), no CancelAcked
row_skeleton!(
    r13_cancel_ts_compat,
    "r13",
    "C2: OrderDone(Canceled(Strategy(op)), filled); no CancelAcked in the trace"
);
// spec: 10 §8.2 row 14 — realistic cancel: CancelAcked then OrderDone (either order; G3)
row_skeleton!(
    r14_cancel_realistic,
    "r14",
    "C2/G3: CancelAcked and OrderDone(Canceled, filled) in either order; CancelState Acked"
);
// spec: 10 §8.2 row 15 — GTD expiry (ts-compat at expire_at; realistic at stated − 60 s)
row_skeleton!(
    r15_gtd_expiry,
    "r15",
    "C2: OrderDone(Expired, filled) at the profile's effective expiry"
);
// spec: 10 §8.2 row 16 — window end / market close cancels (realistic; ts-compat: nothing)
row_skeleton!(
    r16_window_end,
    "r16",
    "C2/G3: Canceled(WindowEnd) or Canceled(MarketClosed); ts-compat leaves the order Live"
);
// spec: 10 §8.2 row 17 — market order fill complete
row_skeleton!(
    r17_market_order_filled,
    "r17",
    "C2: FOK fills: ts_compat_events incl. SettlementUpdate{{Confirmed}}"
);
// spec: 10 §8.2 row 18 — FOK killed, no fills
row_skeleton!(
    r18_fok_killed,
    "r18",
    "C2: OrderDone(Killed, filled: 0), zero Fill events"
);
// spec: 10 §8.2 row 19 — FAK partial fill then killed
row_skeleton!(
    r19_fak_killed,
    "r19",
    "C2: Fill x k then OrderDone(Killed, filled = k's total); never OrderOpen"
);
// spec: 10 §8.2 row 20 — Unknown resolved by reconciliation (live; G4)
row_skeleton!(
    r20_unknown_reconciled,
    "r20",
    "G4: mock exchange ambiguous POST then reconciliation"
);
// spec: 10 §8.2 row 21 — late fill after terminal (live; realistic when latencies differ)
row_skeleton!(
    r21_late_fill,
    "r21",
    "G4/G3: Fill flagged late; state unchanged; cash and position updated"
);

// spec: 10 S1, S2, S4, S6; 10 §8.2 forbidden patterns (see vectors `forbidden`)
// C2: run every G2 scenario of this crate with a trace sink and assert that
// no forbidden pattern appears: two terminal events per key, events after a
// terminal event (other than late fills), OrderOpen for FOK/FAK, Killed for
// GTC/GTD, Expired for non-GTD, OrderDelayed / CancelAcked / Mined / SelfCross
// in ts-compat, OrderDelayed for post-only, a Fill for a Rejected order,
// fill sums over size, two active orders per cid.
#[test]
#[ignore = "C2: needs pmb-sdk testkit"]
fn forbidden_patterns_absent_from_all_traces() {
    let f = file();
    assert!(f["forbidden"].as_array().unwrap().len() >= 15);
    todo!("C2: scan traces of every G2 scenario for the forbidden patterns");
}

// spec: 10 S3, 12 §9.4 (authoritative final quantity table)
#[test]
#[ignore = "C2: needs pmb-sdk testkit"]
fn s3_final_quantity_table() {
    let f = file();
    let inv = f["invariants"].as_array().unwrap();
    assert!(inv.iter().any(|i| i["id"] == "s3-filled-authoritative"));
    todo!("C2: Rejected -> 0; Killed without filled -> delivered; Filled -> size; OrderDone with filled -> max(filled, delivered)");
}
