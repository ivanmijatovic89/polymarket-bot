//! Property tests of the core (60 §8.2): random intent scripts against
//! random books, in both rule sets, with synchronous and delayed execution.
//! Each case checks cash conservation (INV-1), reservation consistency and
//! release on every terminal path (INV-2, INV-3), fills within the order
//! size (INV-4), one terminal event per key (INV-5), quantity ≥ 0 and the
//! PnL identity (INV-7, INV-8), and determinism (DET-1: the same inputs twice
//! give an identical event stream).

mod core_support;

use std::collections::BTreeMap;

use core_support::*;
use pmb_core::event::AccountEventKind;
use pmb_core::order::Side;
use pmb_core::{FinalOutcome, OrderType, Outcome, Rounding, Usdc};
use pmb_engine::CoreRules;
use proptest::prelude::*;

#[derive(Clone, Debug)]
enum G {
    Place {
        cid: u8,
        down: bool,
        sell: bool,
        cents: i64,
        size: i64,
        kind: u8,
    },
    Cancel(u8),
    CancelAll,
    CancelMarket(bool),
    Split(i64),
    Merge(i64),
}

#[derive(Clone, Debug)]
struct Step {
    dt: i64,
    down_book: bool,
    bid: i64,
    spread: i64,
    bid_sz: i64,
    ask_sz: i64,
    cmds: Vec<G>,
}

fn g() -> impl Strategy<Value = G> {
    prop_oneof![
        6 => (0u8..6, any::<bool>(), any::<bool>(), 1i64..100, 5i64..60, 0u8..4).prop_map(
            |(cid, down, sell, cents, size, kind)| G::Place { cid, down, sell, cents, size, kind }
        ),
        2 => (0u8..6).prop_map(G::Cancel),
        1 => Just(G::CancelAll),
        1 => any::<bool>().prop_map(G::CancelMarket),
        1 => (1i64..40).prop_map(G::Split),
        1 => (1i64..40).prop_map(G::Merge),
    ]
}

fn step() -> impl Strategy<Value = Step> {
    (
        1i64..400,
        any::<bool>(),
        1i64..95,
        1i64..5,
        1i64..80,
        1i64..80,
        prop::collection::vec(g(), 0..4),
    )
        .prop_map(|(dt, down_book, bid, spread, bid_sz, ask_sz, cmds)| Step {
            dt,
            down_book,
            bid,
            spread,
            bid_sz,
            ask_sz,
            cmds,
        })
}

fn to_cmd(gc: &G, now: i64, rules: CoreRules) -> Cmd {
    match *gc {
        G::Place {
            cid,
            down,
            sell,
            cents,
            size,
            kind,
        } => {
            let price = cents as f64 / 100.0;
            let o = if sell {
                Ord::sell(&format!("c{cid}"), size as f64, price)
            } else {
                Ord::buy(&format!("c{cid}"), size as f64, price)
            };
            let o = if down { o.outcome(Outcome::Down) } else { o };
            let o = match (kind, rules) {
                (0, _) => o,
                (1, _) => o.post_only(),
                // Collateral-sized market BUYs are realistic-only (10 O2) and
                // outside the mock; realistic uses FOK SELLs only.
                (2, CoreRules::TsCompat) => o.ty(OrderType::Fok),
                (2, CoreRules::Realistic) if sell => o.ty(OrderType::Fok),
                (2, CoreRules::Realistic) => o,
                _ => o.gtd(t(now + 200_000)),
            };
            Cmd::Place(o)
        }
        G::Cancel(c) => Cmd::Cancel(format!("c{c}")),
        G::CancelAll => Cmd::CancelAll,
        G::CancelMarket(up) => Cmd::CancelMarket(up.then_some(Outcome::Up)),
        G::Split(s) => Cmd::Split(q(s as f64)),
        G::Merge(s) => Cmd::Merge(q(s as f64)),
    }
}

/// Runs a script; returns the harness and the observable stream.
fn run(steps: &[Step], rules: CoreRules, delay: i64) -> (H, Vec<String>) {
    let mut h = H::new(config(rules), MockExec::delayed(delay), Script::default());
    let mut now = 0i64;
    for s in steps {
        now += s.dt;
        let cmds: Vec<Cmd> = s.cmds.iter().map(|c| to_cmd(c, now, rules)).collect();
        h.script.outbox.lock().unwrap().push_back(cmds);
        let bid = s.bid as f64 / 100.0;
        let ask = (s.bid + s.spread) as f64 / 100.0;
        let o = if s.down_book {
            Outcome::Down
        } else {
            Outcome::Up
        };
        h.book(now, o, &[(bid, s.bid_sz as f64)], &[(ask, s.ask_sz as f64)])
            .expect("no fault on generated scripts");
    }
    let mut stream = h.s.trace().lines.clone();
    stream.extend(h.log());
    stream.extend(h.events().iter().map(|e| format!("{e:?}")));
    (h, stream)
}

fn check_invariants(h: &H, rules: CoreRules) {
    let l = h.ledger();
    // INV-1 cash conservation, recomputed from delivered events.
    let mut cash = l.capital().starting;
    for e in h.events() {
        match e.kind {
            AccountEventKind::Fill(f) => {
                let mode = match (rules, f.side) {
                    (CoreRules::TsCompat, _) => Rounding::HalfAwayFromZero,
                    (CoreRules::Realistic, Side::Buy) => Rounding::Ceil,
                    (CoreRules::Realistic, Side::Sell) => Rounding::Floor,
                };
                let n = f.price.notional(f.qty, mode).unwrap();
                match f.side {
                    Side::Buy => cash -= n + f.fee,
                    Side::Sell => cash += n - f.fee,
                }
            }
            AccountEventKind::PositionsSplit { cost, .. } => cash -= cost,
            AccountEventKind::PositionsMerged { size, .. } => {
                cash += Usdc::from_micros(size.micros())
            }
            _ => {}
        }
    }
    assert_eq!(l.capital().cash, cash, "INV-1");
    // INV-2, INV-3.
    assert!(l.reservations_consistent(), "INV-2");
    for r in l.orders() {
        if r.state().is_terminal() {
            assert_eq!(r.reserved(), Usdc::ZERO, "INV-3 {r:?}");
        }
    }
    // INV-4 and INV-5.
    let mut filled: BTreeMap<u32, i64> = BTreeMap::new();
    let mut terminals: BTreeMap<u32, u32> = BTreeMap::new();
    for e in h.events() {
        if let AccountEventKind::Fill(f) = e.kind {
            *filled.entry(f.key.order.get()).or_default() += f.qty.micros();
        }
        if e.kind.is_terminal() {
            *terminals.entry(e.kind.order().unwrap().get()).or_default() += 1;
        }
    }
    for (k, f) in filled {
        let size = l.order(pmb_core::OrderKey::new(k)).size().shares().unwrap();
        assert!(f <= size.micros(), "INV-4");
    }
    assert!(terminals.values().all(|&n| n == 1), "INV-5");
    // INV-7, INV-8.
    for o in Outcome::ALL {
        assert!(!l.position(o).qty.is_negative(), "INV-8");
        assert!(l.identity_holds(FinalOutcome::new(o)), "INV-7");
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 96, ..ProptestConfig::default() })]

    #[test]
    fn ts_compat_invariants_and_determinism(
        steps in prop::collection::vec(step(), 1..30),
        delayed in any::<bool>(),
    ) {
        // spec: 60 §8.2, 12 §9.8, R7
        let delay = if delayed { 100 } else { 0 };
        let (h, a) = run(&steps, CoreRules::TsCompat, delay);
        check_invariants(&h, CoreRules::TsCompat);
        let (_, b) = run(&steps, CoreRules::TsCompat, delay);
        prop_assert_eq!(a, b);
    }

    #[test]
    fn realistic_invariants_and_determinism(
        steps in prop::collection::vec(step(), 1..30),
        delayed in any::<bool>(),
    ) {
        // spec: 60 §8.2, 12 §9.8, R7
        let delay = if delayed { 100 } else { 0 };
        let (h, a) = run(&steps, CoreRules::Realistic, delay);
        check_invariants(&h, CoreRules::Realistic);
        let (_, b) = run(&steps, CoreRules::Realistic, delay);
        prop_assert_eq!(a, b);
    }
}

#[test]
fn generated_scripts_exercise_fills_cancels_splits_and_merges() {
    // spec: 60 §8.2 (generators must reach the paths the invariants guard)
    use proptest::strategy::ValueTree;
    use proptest::test_runner::TestRunner;
    let mut runner = TestRunner::deterministic();
    let mut kinds: BTreeMap<&'static str, usize> = BTreeMap::new();
    for _ in 0..64 {
        let steps = prop::collection::vec(step(), 1..30)
            .new_tree(&mut runner)
            .unwrap()
            .current();
        for rules in [CoreRules::TsCompat, CoreRules::Realistic] {
            let (h, _) = run(&steps, rules, 0);
            check_invariants(&h, rules);
            for k in h.kinds() {
                *kinds.entry(k).or_default() += 1;
            }
        }
    }
    for k in [
        "fill",
        "order_done",
        "order_rejected",
        "positions_split",
        "positions_merged",
        "order_open",
    ] {
        assert!(kinds.get(k).copied().unwrap_or(0) > 0, "{k}: {kinds:?}");
    }
}
