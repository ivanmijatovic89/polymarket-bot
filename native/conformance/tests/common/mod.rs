//! Shared harness of the executable G2 tests (60 §10.0 C2): a scripted
//! strategy driven through `pmb_sdk::testkit` and observed through the
//! public API only (callback arguments, `PortfolioView`, the trace records
//! of `TestRun`). Nothing here reads engine internals (CF-2).
#![allow(dead_code)]

use pmb_sdk::prelude::*;
use pmb_sdk::testkit::{Profile, TestMarket, TestRun};
use serde_json::Value;
use std::any::Any;
use std::sync::{Arc, Mutex, MutexGuard};

/// Window start used by every scripted market: 2025-10-11T00:00:00Z, a
/// 15-minute boundary (`TestMarket::btc_15m` panics otherwise).
pub const START: TsMs = TsMs(1_760_140_800_000);
pub const END: TsMs = TsMs(START.0 + 15 * 60 * 1000);

pub fn t(offset_ms: i64) -> TsMs {
    TsMs(START.0 + offset_ms)
}

#[derive(Params, Clone, Debug)]
pub struct NoParams;

/// One scripted strategy: what to do in each callback. Observations are kept
/// in the script's own fields and read back after the run.
pub trait Script: Send + 'static {
    fn on_tick(&mut self, _ctx: &Ctx, _out: &mut Intents) {}
    fn on_event(&mut self, _ctx: &Ctx, _ev: &AccountEvent, _out: &mut Intents) {}
    /// Callback interests (30 §4.1); default all.
    fn interests(&self) -> Interests {
        Interests::ALL
    }
}

/// The engine builds the strategy from params and market only (30 §4 rule
/// 4), so the script travels through a process-wide slot: `run` installs it,
/// `Scripted::new` takes it. One run at a time (the slot is guarded by
/// `RUN_LOCK`), which also keeps parallel test threads apart.
static SLOT: Mutex<Option<Box<dyn Any + Send>>> = Mutex::new(None);
static INTERESTS: Mutex<Option<Interests>> = Mutex::new(None);
static RUN_LOCK: Mutex<()> = Mutex::new(());
/// `Strategy::new` calls of the current run (30 §4 rule 4: exactly one per
/// (candidate, market)).
static NEW_CALLS: Mutex<u32> = Mutex::new(0);

pub struct Scripted<S: Script> {
    s: Arc<Mutex<S>>,
}

impl<S: Script> Strategy for Scripted<S> {
    type Params = NoParams;
    const ID: &'static str = "conformance-scripted.v1";
    fn requirements(_p: &NoParams) -> Requirements {
        Requirements::new()
    }
    fn interests(_p: &NoParams) -> Interests {
        INTERESTS.lock().unwrap().unwrap_or(Interests::ALL)
    }
    fn new(_p: &NoParams, _m: &MarketInfo) -> Self {
        *NEW_CALLS.lock().unwrap() += 1;
        let any = SLOT
            .lock()
            .unwrap()
            .take()
            .expect("Scripted::new: no script installed (use common::run)");
        let s = any
            .downcast::<Arc<Mutex<S>>>()
            .expect("Scripted::new: script type mismatch");
        Scripted { s: *s }
    }
    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult {
        self.s.lock().unwrap().on_tick(ctx, out);
        Ok(())
    }
    fn on_event(&mut self, ctx: &Ctx, ev: &AccountEvent, out: &mut Intents) -> StrategyResult {
        self.s.lock().unwrap().on_event(ctx, ev, out);
        Ok(())
    }
}

/// Runs `script` over `m` and returns the trace plus the script with its
/// observations. Panics when the run fails (see `try_run`).
pub fn run<S: Script>(m: &TestMarket, script: S) -> (TestRun, S) {
    match try_run(m, script) {
        (Ok(run), s) => (run, s),
        (Err(e), _) => panic!("run failed: {e}"),
    }
}

/// As `run`, but hands back the run's reason line (20 §4) on failure.
pub fn try_run<S: Script>(m: &TestMarket, script: S) -> (Result<TestRun, String>, S) {
    let _guard: MutexGuard<()> = RUN_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let interests = script.interests();
    let shared = Arc::new(Mutex::new(script));
    *SLOT.lock().unwrap() = Some(Box::new(shared.clone()));
    *INTERESTS.lock().unwrap() = Some(interests);
    *NEW_CALLS.lock().unwrap() = 0;
    let res = m.try_run::<Scripted<S>>(&NoParams);
    let new_calls = *NEW_CALLS.lock().unwrap();
    *SLOT.lock().unwrap() = None;
    *INTERESTS.lock().unwrap() = None;
    if res.is_ok() {
        assert_eq!(
            new_calls, 1,
            "Strategy::new is called exactly once per market (30 §4 rule 4)"
        );
    }
    let script = Arc::try_unwrap(shared)
        .ok()
        .expect("the engine must drop the strategy instance when the market ends (30 §4 rule 4)")
        .into_inner()
        .unwrap();
    (res, script)
}

/// A ts-compat BTC 15m market starting at `START` with 500 USDC.
pub fn market() -> TestMarket {
    TestMarket::btc_15m(START).profile(Profile::TsCompat)
}

/// Full books of both outcomes at `at`: UP `bid/ask`, DOWN the complements.
/// Each book event is one strategy tick (DOWN first, then UP, so the UP book
/// is the tick a test usually acts on).
pub fn books(m: &mut TestMarket, at: TsMs, bid: Price, ask: Price, size: Qty) {
    m.book(
        at,
        Outcome::Down,
        &[(ask.complement(), size)],
        &[(bid.complement(), size)],
    );
    m.book(at, Outcome::Up, &[(bid, size)], &[(ask, size)]);
}

/// One UP book with explicit ladders (best first) and a flat DOWN book.
pub fn up_book(m: &mut TestMarket, at: TsMs, bids: &[(Price, Qty)], asks: &[(Price, Qty)]) {
    m.book(
        at,
        Outcome::Down,
        &[(price!(0.40), qty!(100))],
        &[(price!(0.60), qty!(100))],
    );
    m.book(at, Outcome::Up, bids, asks);
}

/// The trace records of one type, in trace order.
pub fn recs<'a>(run: &'a TestRun, t: &'a str) -> Vec<&'a Value> {
    run.records(t).collect()
}

/// Event records of one kind.
pub fn events_of<'a>(run: &'a TestRun, kind: &str) -> Vec<&'a Value> {
    run.records("event").filter(|e| e["kind"] == kind).collect()
}

/// `(kind, order key)` of every event record, in trace order.
pub fn event_kinds(run: &TestRun) -> Vec<(String, Option<i64>)> {
    run.records("event")
        .map(|e| {
            (
                e["kind"].as_str().unwrap_or("?").to_string(),
                e["order"].as_i64(),
            )
        })
        .collect()
}

/// One observed callback, as the strategy saw it.
#[derive(Clone, Debug)]
pub struct Seen {
    /// TS kind string of the event (`AccountEvent::ts_kind`).
    pub kind: String,
    /// Client order id when the event carries an order record.
    pub cid: Option<String>,
    /// Debug text of the whole event (reason, status, filled, ...).
    pub debug: String,
    pub at: i64,
    pub seq: u64,
    pub now: i64,
    pub event_clock: i64,
    /// Order state (Debug) of the event's order, when any.
    pub state: Option<String>,
    pub filled: Option<i64>,
    pub remaining: Option<i64>,
    pub cash: i64,
    pub reserved: i64,
    pub pos_up: i64,
    pub pos_down: i64,
}

impl Seen {
    pub fn capture(ctx: &Ctx, ev: &AccountEvent) -> Seen {
        let p = ctx.portfolio();
        let cap = p.capital();
        let order = order_of(ev);
        Seen {
            kind: ev.ts_kind().to_string(),
            cid: order.map(|o| p.cid_str(o).to_string()),
            debug: format!("{ev:?}"),
            at: ev.at().0,
            seq: ctx.tick().seq,
            now: ctx.now().0,
            event_clock: ctx.event_clock().0,
            state: order.map(|o| format!("{:?}", o.state())),
            filled: order.map(|o| o.filled().micros()),
            remaining: order.map(|o| o.remaining().micros()),
            cash: cap.cash.micros(),
            reserved: cap.reserved.micros(),
            pos_up: p.position(Outcome::Up).qty.micros(),
            pos_down: p.position(Outcome::Down).qty.micros(),
        }
    }

    /// `kind(cid)` for compact sequence assertions.
    pub fn tag(&self) -> String {
        match &self.cid {
            Some(c) => format!("{}({c})", self.kind),
            None => self.kind.clone(),
        }
    }
}

/// The order record an event is about, when it carries one.
pub fn order_of<'a>(ev: &AccountEvent<'a>) -> Option<&'a OrderView> {
    match ev {
        AccountEvent::OrderSubmitted { order, .. }
        | AccountEvent::OrderAccepted { order, .. }
        | AccountEvent::OrderDelayed { order, .. }
        | AccountEvent::OrderOpen { order, .. }
        | AccountEvent::Fill { order, .. }
        | AccountEvent::SettlementUpdate { order, .. }
        | AccountEvent::OrderDone { order, .. }
        | AccountEvent::CancelAcked { order, .. } => Some(order),
        AccountEvent::OrderRejected { order, .. } | AccountEvent::CancelFailed { order, .. } => {
            *order
        }
        _ => None,
    }
}

/// Default recorder: keeps every callback and the ticks, places nothing.
#[derive(Default)]
pub struct Recorder {
    pub seen: Vec<Seen>,
    pub ticks: Vec<(u64, i64, String)>,
}

impl Recorder {
    pub fn tick(&mut self, ctx: &Ctx) {
        self.ticks.push((
            ctx.tick().seq,
            ctx.now().0,
            format!("{:?}", ctx.tick().cause),
        ));
    }
    pub fn event(&mut self, ctx: &Ctx, ev: &AccountEvent) {
        self.seen.push(Seen::capture(ctx, ev));
    }
    pub fn tags(&self) -> Vec<String> {
        self.seen.iter().map(Seen::tag).collect()
    }
    pub fn of(&self, cid: &str) -> Vec<&Seen> {
        self.seen
            .iter()
            .filter(|s| s.cid.as_deref() == Some(cid))
            .collect()
    }
    pub fn kinds_of(&self, cid: &str) -> Vec<String> {
        self.of(cid).iter().map(|s| s.kind.clone()).collect()
    }
}

/// ts-compat BUY reservation (10 R9, 11 §4 row 2): notional
/// (HalfAwayFromZero) + round4(0.07 × p × (1 − p) × q) unless post-only.
pub fn ts_compat_reservation(limit: Price, size: Qty, post_only: bool) -> Usdc {
    let notional = limit.notional(size, Rounding::HalfAwayFromZero).unwrap();
    if post_only {
        return notional;
    }
    notional.checked_add(ts_compat_fee(limit, size)).unwrap()
}

/// `round4(0.07 × p × (1 − p) × q)`, exact (10 R8; `src/trading/fees.ts`).
pub fn ts_compat_fee(p: Price, q: Qty) -> Usdc {
    // 0.07 × p × (1 − p) × q in 1e-18 units, then one rounding to 4 dp.
    let p = p.micros() as i128;
    let q = q.micros() as i128;
    let raw = 70_000 * p * (1_000_000 - p) * q; // units: 1e-24
    let unit = 1_000_000_000_000_000_000i128; // 1e-4 USDC = 1e20 of 1e-24
    let unit = unit * 100; // 1e-4 USDC in 1e-24 units
    let rounded = (raw + unit / 2) / unit; // half away from zero (raw ≥ 0)
    Usdc::from_micros((rounded * 100) as i64)
}

/// A field of the testkit's `final` record. The record carries `stats` as a
/// Debug string (`FinalStats { pnl: Usdc(2.5), ... }`), not the 22 §3.2 shape,
/// so values are read back textually: `final_field(run, "pnl")` → `"2.5"`.
/// Only the unrounded session totals are visible this way (C2-gap: the
/// rounded `MarketStats`, `skipReason`, `eventsProcessed`, `eventsByType`).
pub fn final_field(run: &TestRun, name: &str) -> Option<String> {
    let rec = run.records("final").next()?;
    let stats = rec["stats"].as_str()?;
    let key = format!("{name}: ");
    let i = stats.find(&key)? + key.len();
    let rest = &stats[i..];
    let open = rest.find('(')?;
    let close = rest.find(')')?;
    if open < close && rest[..open].chars().all(|c| c.is_ascii_alphanumeric()) {
        return Some(rest[open + 1..close].to_string());
    }
    let end = rest.find(|c: char| c == ',' || c == ' ' || c == '}')?;
    Some(rest[..end].to_string())
}

/// Parses `"2.5"` / `"-0.1744"` (≤ 6 dp) into micros.
pub fn micros(text: &str) -> i64 {
    let (neg, t) = match text.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, text),
    };
    let (int, frac) = t.split_once('.').unwrap_or((t, ""));
    let mut f = frac.to_string();
    while f.len() < 6 {
        f.push('0');
    }
    let v: i64 = int.parse::<i64>().unwrap() * 1_000_000 + f[..6].parse::<i64>().unwrap();
    if neg {
        -v
    } else {
        v
    }
}
