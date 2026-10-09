//! Property tests of the core (60 §8.2): random intent scripts against
//! random event streams with anomalies (duplicate rows, exchange time going
//! backwards, `price_change` before the first book, crossed and locked
//! books, empty sides, mid-market `tick_size_change`, ticks before and after
//! the window), in both rule sets, with random compat latencies.
//!
//! ts-compat runs on the real `Simulator` (13 §5, the production backtest
//! path) and on the compat-like mock; realistic runs on the mock until the
//! realistic simulator arm lands (M3b, D57). Each case asserts 60 §8.1:
//! INV-1 (cash conservation), INV-2/INV-3 (reservations), INV-4 (fills within
//! size), INV-5 (one terminal per key), INV-6 (one non-terminal per cid),
//! INV-7/INV-8 (PnL identity, quantity ≥ 0), INV-10 (fees), INV-12 (`now`
//! monotone; event times non-decreasing), INV-13 (no callback outside the
//! window) and INV-14 (stats identities), plus DET-1 (the same inputs twice,
//! and a candidate group in both orders, give identical streams).

mod core_support;

use std::collections::BTreeMap;
use std::sync::Arc;

use core_support::*;
use pmb_core::event::AccountEventKind;
use pmb_core::fill::Liquidity;
use pmb_core::order::Side;
use pmb_core::rules::FeeCurve;
use pmb_core::{FinalOutcome, LevelUpdate, MarketEvent, OrderType, Outcome, Rounding, Usdc};
use pmb_engine::envelope::{Control, Source};
use pmb_engine::session::drive;
use pmb_engine::{CoreRules, Envelope, Execution, Payload, Simulator};
use proptest::prelude::*;

/// Window length of the harness market (`btc-updown-15m`).
const END: i64 = 900_000;

#[derive(Clone, Debug)]
enum G {
    Place {
        cid: u8,
        down: bool,
        sell: bool,
        cents: i64,
        size: i64,
        kind: u8,
        meta: bool,
    },
    Cancel(u8),
    CancelBatch(u8, u8),
    CancelAll,
    CancelMarket(bool),
    Split(i64),
    Merge(i64),
}

/// One input step: a book (with anomalies) carrying the intents of the tick.
#[derive(Clone, Debug)]
struct Step {
    dt: i64,
    down_book: bool,
    bid: i64,
    /// Ask − bid in cents; ≤ 0 is a crossed or locked book.
    spread: i64,
    bid_sz: i64,
    ask_sz: i64,
    /// 0: both sides; 1: empty bids; 2: empty asks.
    empty: u8,
    /// Exchange time this many ms before `at` (backwards anomaly).
    back: i64,
    /// The same book row again (duplicate anomaly).
    dup: bool,
    /// A `tick_size_change` to 0.001 before the book.
    tick_change: bool,
    cmds: Vec<G>,
}

/// A generated case: the steps plus where the stream starts and whether it
/// jumps past the window end.
#[derive(Clone, Debug)]
struct Case {
    /// First step time relative to the window start (pre-window ticks when
    /// negative).
    start: i64,
    /// A `price_change` before the first book.
    early_price_change: bool,
    /// Step index from which times jump past the window end.
    late_from: Option<usize>,
    steps: Vec<Step>,
}

fn g() -> impl Strategy<Value = G> {
    prop_oneof![
        6 => (0u8..6, any::<bool>(), any::<bool>(), 1i64..100, 5i64..60, 0u8..4, any::<bool>())
            .prop_map(|(cid, down, sell, cents, size, kind, meta)| G::Place {
                cid, down, sell, cents, size, kind, meta
            }),
        2 => (0u8..6).prop_map(G::Cancel),
        1 => (0u8..6, 0u8..6).prop_map(|(a, b)| G::CancelBatch(a, b)),
        1 => Just(G::CancelAll),
        1 => any::<bool>().prop_map(G::CancelMarket),
        1 => (1i64..40).prop_map(G::Split),
        1 => (1i64..40).prop_map(G::Merge),
    ]
}

fn step() -> impl Strategy<Value = Step> {
    (
        (
            1i64..400,
            any::<bool>(),
            1i64..95,
            -3i64..5,
            1i64..80,
            1i64..80,
        ),
        (
            prop_oneof![8 => Just(0u8), 1 => Just(1u8), 1 => Just(2u8)],
            prop_oneof![8 => Just(0i64), 2 => 1i64..300],
            prop::bool::weighted(0.1),
            prop::bool::weighted(0.05),
            prop::collection::vec(g(), 0..4),
        ),
    )
        .prop_map(
            |(
                (dt, down_book, bid, spread, bid_sz, ask_sz),
                (empty, back, dup, tick_change, cmds),
            )| {
                Step {
                    dt,
                    down_book,
                    bid,
                    spread,
                    bid_sz,
                    ask_sz,
                    empty,
                    back,
                    dup,
                    tick_change,
                    cmds,
                }
            },
        )
}

fn case() -> impl Strategy<Value = Case> {
    (
        prop_oneof![3 => Just(0i64), 1 => -2_000i64..0],
        prop::bool::weighted(0.2),
        prop::collection::vec(step(), 1..30),
        prop::option::weighted(0.2, 0usize..30),
    )
        .prop_map(|(start, early_price_change, steps, late)| Case {
            start,
            early_price_change,
            late_from: late.map(|i| i.min(steps.len() - 1)),
            steps,
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
            meta,
        } => {
            let price = cents as f64 / 100.0;
            let c = format!("c{cid}");
            let o = if sell {
                Ord::sell(&c, size as f64, price)
            } else {
                Ord::buy(&c, size as f64, price)
            };
            let o = if down { o.outcome(Outcome::Down) } else { o };
            let o = if meta { o.meta(&c) } else { o };
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
        G::CancelBatch(a, b) => {
            Cmd::CancelBatch(vec![Ref::Cid(format!("c{a}")), Ref::Cid(format!("c{b}"))])
        }
        G::CancelAll => Cmd::CancelAll,
        G::CancelMarket(up) => Cmd::CancelMarket(up.then_some(Outcome::Up)),
        G::Split(s) => Cmd::Split(q(s as f64)),
        G::Merge(s) => Cmd::Merge(q(s as f64)),
    }
}

/// One materialized market input (owned book levels, borrowed by envelopes).
#[derive(Clone, Debug)]
enum Input {
    Book {
        at: i64,
        ex: i64,
        o: Outcome,
        bids: Vec<(f64, f64)>,
        asks: Vec<(f64, f64)>,
    },
    PriceChange {
        at: i64,
        o: Outcome,
    },
    TickSize {
        at: i64,
        o: Outcome,
    },
    WindowEnd {
        at: i64,
    },
}

/// The inputs of a case, and per book input whether it carries a step's
/// intents (index into `steps`). `backwards` reports whether any exchange
/// time goes backwards.
fn inputs(c: &Case, rules: CoreRules) -> (Vec<(Input, Option<usize>)>, bool) {
    let mut out = Vec::new();
    let mut now = c.start;
    let mut last_ex = i64::MIN;
    let mut backwards = false;
    let mut ended = false;
    if c.early_price_change {
        out.push((
            Input::PriceChange {
                at: now,
                o: Outcome::Up,
            },
            None,
        ));
    }
    for (i, s) in c.steps.iter().enumerate() {
        now += s.dt;
        if c.late_from == Some(i) && now <= END {
            now = END + 1 + s.dt;
        }
        if now >= END && !ended && rules == CoreRules::Realistic {
            // 12 §3.2: realistic receives Control(WindowEnd) at `end`.
            out.push((Input::WindowEnd { at: END }, None));
            ended = true;
        }
        let o = if s.down_book {
            Outcome::Down
        } else {
            Outcome::Up
        };
        if s.tick_change {
            out.push((Input::TickSize { at: now, o }, None));
        }
        let bid = s.bid as f64 / 100.0;
        let ask = ((s.bid + s.spread).clamp(1, 99)) as f64 / 100.0;
        let bids = if s.empty == 1 {
            vec![]
        } else {
            vec![(bid, s.bid_sz as f64)]
        };
        let asks = if s.empty == 2 {
            vec![]
        } else {
            vec![(ask, s.ask_sz as f64)]
        };
        let ex = now - s.back;
        backwards |= ex < last_ex;
        last_ex = last_ex.max(ex);
        out.push((
            Input::Book {
                at: now,
                ex,
                o,
                bids: bids.clone(),
                asks: asks.clone(),
            },
            Some(i),
        ));
        if s.dup {
            out.push((
                Input::Book {
                    at: now,
                    ex,
                    o,
                    bids,
                    asks,
                },
                None,
            ));
        }
    }
    (out, backwards)
}

/// Builds the envelope of one input over borrowed level buffers.
fn envelope<'a>(
    seq: u64,
    input: &Input,
    levels: &'a (Vec<pmb_core::PriceSize>, Vec<pmb_core::PriceSize>),
    change: &'a [LevelUpdate],
) -> Envelope<'a> {
    let (at, ex, payload) = match *input {
        Input::Book { at, ex, o, .. } => (
            at,
            Some(t(ex)),
            Payload::Market(MarketEvent::Book {
                outcome: o,
                bids: &levels.0,
                asks: &levels.1,
            }),
        ),
        Input::PriceChange { at, .. } => (
            at,
            Some(t(at)),
            Payload::Market(MarketEvent::PriceChange { changes: change }),
        ),
        Input::TickSize { at, o } => (
            at,
            Some(t(at)),
            Payload::Market(MarketEvent::TickSizeChange {
                outcome: o,
                tick: p(0.001),
            }),
        ),
        Input::WindowEnd { at } => (at, None, Payload::Control(Control::WindowEnd)),
    };
    Envelope {
        seq,
        at: t(at),
        exchange_ts: ex,
        recv_wall: None,
        recv_mono: None,
        source: Source::MarketWs,
        payload,
    }
}

fn levels_of(input: &Input) -> (Vec<pmb_core::PriceSize>, Vec<pmb_core::PriceSize>) {
    match input {
        Input::Book { bids, asks, .. } => (lv(bids), lv(asks)),
        _ => (Vec::new(), Vec::new()),
    }
}

fn price_change_of(input: &Input) -> Vec<LevelUpdate> {
    match *input {
        Input::PriceChange { o, .. } => vec![LevelUpdate {
            outcome: o,
            side: pmb_core::QuoteSide::Bid,
            price: p(0.4),
            size: q(10.0),
        }],
        _ => Vec::new(),
    }
}

/// The ts-compat configuration of a case: random compat latency and seed
/// (13 §5.1, 10 RNG-2).
fn ts_config(delay: u32, jitter: u32, seed: u64) -> pmb_engine::EngineConfig {
    let mut cfg = config(CoreRules::TsCompat);
    cfg.compat_latency.delay_ms = delay;
    cfg.compat_latency.jitter_ms = jitter;
    cfg.market_seed = pmb_core::seed::MarketSeed(seed);
    cfg
}

/// Runs a case on one harness; returns it, the observable stream and
/// whether exchange time went backwards. INV-12 (`now` monotone) is checked
/// after every input.
fn run<E: Execution>(mut h: H<E>, c: &Case, rules: CoreRules) -> (H<E>, Vec<String>, bool) {
    let (ins, backwards) = inputs(c, rules);
    let mut last_now = None;
    for (input, carries) in &ins {
        if let Some(i) = carries {
            let at = match input {
                Input::Book { at, .. } => *at,
                _ => unreachable!(),
            };
            let cmds: Vec<Cmd> = c.steps[*i]
                .cmds
                .iter()
                .map(|g| to_cmd(g, at, rules))
                .collect();
            h.script.outbox.lock().unwrap().push_back(cmds);
        }
        let levels = levels_of(input);
        let change = price_change_of(input);
        let env = envelope(0, input, &levels, &change);
        h.env_step(env.at, env.exchange_ts, env.payload)
            .expect("no fault on generated scripts");
        let now = h.s.clocks().now;
        assert!(last_now.is_none_or(|l| now >= l), "INV-12 now monotone");
        last_now = Some(now);
    }
    let mut stream = h.s.trace().lines.clone();
    stream.extend(h.log());
    stream.extend(h.events().iter().map(|e| format!("{e:?}")));
    (h, stream, backwards)
}

fn check_invariants<E: Execution>(h: H<E>, rules: CoreRules, backwards: bool) {
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
                // INV-10: maker fee 0, fee ≥ 0; ts-compat taker fee is the
                // 11 §4 curve at the fill price.
                assert!(!f.fee.is_negative(), "INV-10 fee ≥ 0");
                match f.liquidity {
                    Liquidity::Maker => assert_eq!(f.fee, Usdc::ZERO, "INV-10 maker fee"),
                    Liquidity::Taker if rules == CoreRules::TsCompat => assert_eq!(
                        f.fee,
                        FeeCurve::TS_COMPAT.taker_fee(f.price, f.qty).unwrap(),
                        "INV-10 taker fee"
                    ),
                    Liquidity::Taker => {}
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
    // INV-6: at most one non-terminal order per cid.
    let mut open_per_cid: BTreeMap<u32, u32> = BTreeMap::new();
    for r in l.orders() {
        if !r.state().is_terminal() {
            *open_per_cid.entry(r.cid().get()).or_default() += 1;
        }
    }
    assert!(
        open_per_cid.values().all(|&n| n <= 1),
        "INV-6 {open_per_cid:?}"
    );
    // INV-7, INV-8.
    for o in Outcome::ALL {
        assert!(!l.position(o).qty.is_negative(), "INV-8");
        assert!(l.identity_holds(FinalOutcome::new(o)), "INV-7");
    }
    // INV-12: event times non-decreasing in delivery order. ts-compat stamps
    // events with the TS tick time, so this holds there only while exchange
    // time does not go backwards (TC-C11).
    if rules == CoreRules::Realistic || !backwards {
        let times: Vec<i64> = h.events().iter().map(|e| e.at.0).collect();
        assert!(
            times.windows(2).all(|w| w[0] <= w[1]),
            "INV-12 event times {times:?}"
        );
    }
    // INV-13: every callback (tick and event) ran inside the window rule.
    for line in h.log() {
        let now: i64 = line
            .split("now=")
            .nth(1)
            .and_then(|r| r.split(' ').next())
            .and_then(|v| v.parse().ok())
            .unwrap_or_else(|| panic!("log line without now: {line}"));
        assert!((0..=END).contains(&now), "INV-13 callback at {now}: {line}");
    }
    // INV-14: stats identities.
    let ticks = h.s.stats().ticks;
    assert_eq!(
        ticks.by_cause.iter().sum::<u64>(),
        ticks.events_processed(),
        "INV-14 eventsByType"
    );
    let mut cids_with_meta: Vec<u32> = Vec::new();
    for (i, f) in l.fills().iter().enumerate() {
        let r = l.order(f.key.order);
        if !l.fill_reversed(i)
            && r.request().meta.is_some()
            && !cids_with_meta.contains(&r.cid().get())
        {
            cids_with_meta.push(r.cid().get());
        }
    }
    let m = h.market.clone();
    let out =
        h.s.finalize(&m, FinalOutcome::new(Outcome::Up))
            .expect("finalize");
    assert_eq!(
        out.stats.trade_as_maker + out.stats.trade_as_taker,
        out.stats.trade_count,
        "INV-14 maker + taker"
    );
    assert_eq!(
        out.stats.intent_meta.len(),
        cids_with_meta.len(),
        "INV-14 intentMeta"
    );
}

/// DET-1 for groups (12 §13 item 4, 60 §8.2 "random candidate orders"): two
/// candidates of one market stepped by `drive` give the same per-candidate
/// streams in either order.
fn group_streams(c: &Case, a: &Case, b: &Case, swap: bool) -> Vec<Vec<String>> {
    let (ins, _) = inputs(c, CoreRules::TsCompat);
    let mut market = market();
    let cfg = ts_config(100, 30, 7);
    let fill = |case: &Case| {
        let s = Arc::new(Script::default());
        for st in &case.steps {
            s.outbox.lock().unwrap().push_back(
                st.cmds
                    .iter()
                    .map(|g| to_cmd(g, 0, CoreRules::TsCompat))
                    .collect(),
            );
        }
        s
    };
    let scripts = if swap {
        vec![fill(b), fill(a)]
    } else {
        vec![fill(a), fill(b)]
    };
    let mut sessions: Vec<S<Simulator>> = scripts
        .iter()
        .map(|s| {
            S::new(
                s,
                &market,
                cfg.clone(),
                Simulator::new(&cfg).unwrap(),
                Rec::default(),
            )
            .unwrap()
        })
        .collect();
    for (seq, (input, _)) in ins.iter().enumerate() {
        let levels = levels_of(input);
        let change = price_change_of(input);
        let env = envelope(seq as u64 + 1, input, &levels, &change);
        drive(&mut market, &mut sessions, std::slice::from_ref(&env));
    }
    let mut out: Vec<Vec<String>> = sessions
        .iter()
        .map(|s| {
            let mut v = s.trace().lines.clone();
            v.extend(s.trace().events.iter().map(|e| format!("{e:?}")));
            v.push(format!("{:?}", s.fault()));
            v
        })
        .collect();
    if swap {
        out.reverse();
    }
    out
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    #[test]
    fn ts_compat_simulator_invariants_and_determinism(
        c in case(),
        delay in prop_oneof![Just(0u32), Just(50u32), Just(100u32), Just(250u32)],
        jitter in prop_oneof![Just(0u32), Just(30u32)],
        seed in 0u64..1_000,
    ) {
        // spec: 60 §8.1, §8.2 (real ts-compat simulator, random compat
        // latencies), 12 §9.8, R7
        let mk = || {
            let cfg = ts_config(delay, jitter, seed);
            let sim = Simulator::new(&cfg).unwrap();
            H::with_exec(cfg, sim, Script::default())
        };
        let (h, a, backwards) = run(mk(), &c, CoreRules::TsCompat);
        check_invariants(h, CoreRules::TsCompat, backwards);
        let (_, b, _) = run(mk(), &c, CoreRules::TsCompat);
        prop_assert_eq!(a, b);
    }

    #[test]
    fn ts_compat_mock_invariants_and_determinism(
        c in case(),
        delayed in any::<bool>(),
    ) {
        // spec: 60 §8.1, §8.2, 12 §9.8, R7
        let delay = if delayed { 100 } else { 0 };
        let mk = || H::new(config(CoreRules::TsCompat), MockExec::delayed(delay), Script::default());
        let (h, a, backwards) = run(mk(), &c, CoreRules::TsCompat);
        check_invariants(h, CoreRules::TsCompat, backwards);
        let (_, b, _) = run(mk(), &c, CoreRules::TsCompat);
        prop_assert_eq!(a, b);
    }

    #[test]
    fn realistic_invariants_and_determinism(
        c in case(),
        delayed in any::<bool>(),
    ) {
        // spec: 60 §8.1, §8.2, 12 §9.8, R7 (realistic rules on the mock
        // until the realistic simulator arm, M3b)
        let delay = if delayed { 100 } else { 0 };
        let mk = || H::new(config(CoreRules::Realistic), MockExec::delayed(delay), Script::default());
        let (h, a, backwards) = run(mk(), &c, CoreRules::Realistic);
        check_invariants(h, CoreRules::Realistic, backwards);
        let (_, b, _) = run(mk(), &c, CoreRules::Realistic);
        prop_assert_eq!(a, b);
    }

    #[test]
    fn group_order_does_not_change_any_candidate(
        c in case(),
        a in case(),
        b in case(),
    ) {
        // spec: 60 §8.2 DET-1 with random candidate orders; 12 §13 item 4
        // (results never depend on group membership or candidate order)
        let ab = group_streams(&c, &a, &b, false);
        let ba = group_streams(&c, &a, &b, true);
        prop_assert_eq!(ab, ba);
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
        let c = case().new_tree(&mut runner).unwrap().current();
        for rules in [CoreRules::TsCompat, CoreRules::Realistic] {
            let (h, _, backwards) = run(
                H::new(config(rules), MockExec::sync(), Script::default()),
                &c,
                rules,
            );
            for k in h.kinds() {
                *kinds.entry(k).or_default() += 1;
            }
            check_invariants(h, rules, backwards);
        }
        let cfg = ts_config(100, 30, 1);
        let (h, _, backwards) = run(
            H::with_exec(
                cfg.clone(),
                Simulator::new(&cfg).unwrap(),
                Script::default(),
            ),
            &c,
            CoreRules::TsCompat,
        );
        for k in h.kinds() {
            *kinds.entry(k).or_default() += 1;
        }
        check_invariants(h, CoreRules::TsCompat, backwards);
    }
    for k in [
        "fill",
        "order_done",
        "order_rejected",
        "positions_split",
        "positions_merged",
        "order_open",
        "cancel_failed",
    ] {
        assert!(kinds.get(k).copied().unwrap_or(0) > 0, "{k}: {kinds:?}");
    }
}
