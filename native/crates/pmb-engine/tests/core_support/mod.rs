//! Test support for the core fixture suites (60 §7.3): a synchronous mock
//! `Execution` with the ts-compat behaviors the converted TS suites rely on
//! (13 §5.1: `NextRealTick` delay, `CompatTaker`, `WorstQueueCompat`, compat
//! cancels, synchronous split/merge), a scripted strategy, a recording trace
//! sink and a one-market harness. The real simulator lives in `exec/sim`
//! (simulator stream); this mock exists only so core rules can be tested
//! against observable events (R4).

#![allow(dead_code)]

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use pmb_contract::model_config::{CompatLatency, ExecutionModels};
use pmb_contract::vocab::InputMode;
use pmb_core::event::{AccountEvent, AccountEventKind, CancelCause, DoneReason, RejectReason};
use pmb_core::fill::{Fill, Liquidity, SettlementStatus};
use pmb_core::ids::{
    ClientOrderId, ConditionId, ExchangeOrderId, FillKey, Hash32, OrderKey, TokenId, TradeSeq,
};
use pmb_core::market::MarketVersion;
use pmb_core::order::{OrderRef, OrderRequest, OrderSize, OrderType, Side};
use pmb_core::rules::{FeeCurve, RulesSource, RulesTableVersion, RulesTimeline};
use pmb_core::seed::MarketSeed;
use pmb_core::{
    LevelUpdate, MarketEvent, MarketInfo, Outcome, PerOutcome, Price, PriceSize, Qty, QuoteSide,
    TsMs, Usdc,
};
use pmb_engine::config::RiskLimits;
use pmb_engine::envelope::{Control, Source, SyntheticKind};
use pmb_engine::exec::{CancelScope, ExecDiagnostics, TimerFired};
use pmb_engine::session::SessionFault;
use pmb_engine::strategy::{AccountEvent as AuthorEvent, CancelRef, Interests, Requirements};
use pmb_engine::trace::{TraceEvent, TraceSink};
use pmb_engine::{
    CoreRules, Ctx, EngineConfig, Envelope, EventQueue, ExecCommand, ExecCtx, Execution, Payload,
    Session, SharedMarket, Simulator, Strategy, StrategyResult,
};

pub const SLUG: &str = "btc-updown-15m-1780272000";
/// Window start of [`SLUG`] in ms.
pub const START: i64 = 1_780_272_000_000;

/// `START + ms`.
pub fn t(ms: i64) -> TsMs {
    TsMs(START + ms)
}

pub fn p(x: f64) -> Price {
    Price::from_micros((x * 1e6).round() as i64)
}
pub fn q(x: f64) -> Qty {
    Qty::from_micros((x * 1e6).round() as i64)
}
pub fn u(x: f64) -> Usdc {
    Usdc::from_micros((x * 1e6).round() as i64)
}

// ---------------------------------------------------------------------------
// Mock execution (compat behaviors of 13 §5.1)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
enum Action {
    Place(Vec<OrderKey>),
    Cancel(Vec<OrderKey>, CancelCause),
    Scope(CancelScope, CancelCause),
    All(CancelCause),
}

/// A synchronous compat-like execution adapter for core tests.
#[derive(Clone, Debug, Default)]
pub struct MockExec {
    /// `compatLatency.delayMs` (0 = synchronous, 13 X2).
    pub delay: i64,
    queued: Vec<(TsMs, u64, Action)>,
    seq: u64,
    /// Exchange truth: resting orders in rest order.
    resting: Vec<OrderKey>,
    /// Exchange truth: remaining size per key.
    remaining: Vec<Qty>,
    fill_seq: Vec<u32>,
    trade: u32,
    /// Scripted exact-time events (SelfTimed `next_due`, 13 §2.3).
    pub timed: Vec<(TsMs, AccountEventKind)>,
    /// One line per `submit` call.
    pub commands: Vec<String>,
    /// Number of `on_market_event` calls.
    pub market_events: u64,
    /// If set, placements are accepted and opened only (no matching).
    pub accept_only: bool,
    /// If set, every fill is followed by a per-fill `SettlementUpdate` with
    /// this status (realistic sell-gate tests, 12 §9.3).
    pub fill_status: Option<SettlementStatus>,
    diag: ExecDiagnostics,
}

impl MockExec {
    pub fn sync() -> MockExec {
        MockExec::default()
    }
    pub fn delayed(ms: i64) -> MockExec {
        MockExec {
            delay: ms,
            ..MockExec::default()
        }
    }

    fn rem(&mut self, k: OrderKey) -> &mut Qty {
        let i = k.index();
        if self.remaining.len() <= i {
            self.remaining.resize(i + 1, Qty::ZERO);
            self.fill_seq.resize(i + 1, 0);
        }
        &mut self.remaining[i]
    }

    #[allow(clippy::too_many_arguments)]
    fn fill(
        &mut self,
        k: OrderKey,
        req: &OrderRequest,
        price: Price,
        qty: Qty,
        liq: Liquidity,
        at: TsMs,
        out: &mut EventQueue,
    ) {
        self.rem(k);
        self.fill_seq[k.index()] += 1;
        self.trade += 1;
        let fee = match liq {
            Liquidity::Taker => FeeCurve::TS_COMPAT.taker_fee(price, qty).unwrap(),
            Liquidity::Maker => Usdc::ZERO,
        };
        *self.rem(k) -= qty;
        let key = FillKey {
            order: k,
            seq: self.fill_seq[k.index()],
        };
        out.push(AccountEvent {
            at,
            kind: AccountEventKind::Fill(Fill {
                key,
                trade: TradeSeq::new(self.trade),
                outcome: req.outcome,
                side: req.side,
                price,
                qty,
                fee,
                liquidity: liq,
                at,
                exchange_ts: Some(at),
                late: false,
            }),
        });
        if let Some(status) = self.fill_status {
            out.push(AccountEvent {
                at,
                kind: AccountEventKind::SettlementUpdate {
                    order: k,
                    fill: Some(key),
                    status,
                    size_matched: qty,
                },
            });
        }
    }

    fn place(&mut self, keys: &[OrderKey], at: TsMs, cx: &ExecCtx<'_>, out: &mut EventQueue) {
        for &k in keys {
            let req = *cx.order(k).request();
            let size = req.size.shares().expect("ts-compat sizes in shares");
            *self.rem(k) = size;
            let ev = |kind| AccountEvent { at, kind };
            if self.accept_only {
                out.push(ev(AccountEventKind::OrderAccepted { order: k }));
                out.push(ev(AccountEventKind::OrderOpen { order: k }));
                self.resting.push(k);
                continue;
            }
            let books = &cx.market.books;
            let opp: Vec<(Price, Qty)> = match req.side {
                Side::Buy => books
                    .get(req.outcome)
                    .map(|b| b.asks.levels().map(|l| (l.price, l.size)).collect())
                    .unwrap_or_default(),
                Side::Sell => books
                    .get(req.outcome)
                    .map(|b| b.bids.levels().map(|l| (l.price, l.size)).collect())
                    .unwrap_or_default(),
            };
            let crosses = |px: Price| match req.side {
                Side::Buy => px <= req.price,
                Side::Sell => px >= req.price,
            };
            // TC-E3 step 1: post-only that would cross is rejected.
            if req.post_only && opp.first().is_some_and(|l| crosses(l.0)) {
                out.push(ev(AccountEventKind::OrderRejected {
                    order: Some(k),
                    cid: req.cid,
                    reason: RejectReason::PostOnlyWouldCross,
                }));
                continue;
            }
            out.push(ev(AccountEventKind::OrderAccepted { order: k }));
            out.push(ev(AccountEventKind::SettlementUpdate {
                order: k,
                fill: None,
                status: SettlementStatus::Matched,
                size_matched: Qty::ZERO,
            }));
            let fillable: Qty = opp
                .iter()
                .filter(|l| crosses(l.0))
                .fold(Qty::ZERO, |a, l| a + l.1);
            if req.order_type == OrderType::Fok && fillable < size {
                out.push(ev(AccountEventKind::OrderDone {
                    order: k,
                    reason: DoneReason::Killed,
                    filled: Some(Qty::ZERO),
                }));
                continue;
            }
            for &(px, sz) in opp.iter().filter(|l| crosses(l.0)) {
                let left = *self.rem(k);
                if !left.is_positive() {
                    break;
                }
                self.fill(k, &req, px, left.min(sz), Liquidity::Taker, at, out);
            }
            let left = *self.rem(k);
            if !left.is_positive() {
                out.push(ev(AccountEventKind::OrderDone {
                    order: k,
                    reason: DoneReason::Filled,
                    filled: Some(size),
                }));
                if req.order_type == OrderType::Fok {
                    out.push(ev(AccountEventKind::SettlementUpdate {
                        order: k,
                        fill: None,
                        status: SettlementStatus::Confirmed,
                        size_matched: size,
                    }));
                }
            } else if req.order_type == OrderType::Fak {
                out.push(ev(AccountEventKind::OrderDone {
                    order: k,
                    reason: DoneReason::Killed,
                    filled: Some(size - left),
                }));
            } else {
                self.resting.push(k);
                out.push(ev(AccountEventKind::OrderOpen { order: k }));
            }
        }
    }

    fn cancel_one(
        &mut self,
        k: OrderKey,
        cause: CancelCause,
        at: TsMs,
        cx: &ExecCtx<'_>,
        out: &mut EventQueue,
    ) {
        // TC-C10: a target that is not resting gets no event.
        if let Some(i) = self.resting.iter().position(|&r| r == k) {
            self.resting.remove(i);
            let size = cx.order(k).request().size.shares().unwrap();
            let left = *self.rem(k);
            out.push(AccountEvent {
                at,
                kind: AccountEventKind::OrderDone {
                    order: k,
                    reason: DoneReason::Canceled(cause),
                    filled: Some(size - left),
                },
            });
        }
    }

    fn execute(&mut self, a: Action, at: TsMs, cx: &ExecCtx<'_>, out: &mut EventQueue) {
        match a {
            Action::Place(keys) => self.place(&keys, at, cx, out),
            Action::Cancel(keys, cause) => {
                for k in keys {
                    self.cancel_one(k, cause, at, cx, out);
                }
            }
            Action::Scope(scope, cause) => {
                let targets: Vec<_> = self
                    .resting
                    .iter()
                    .copied()
                    .filter(|&k| match scope {
                        CancelScope::Market => true,
                        CancelScope::Outcome(o) => cx.order(k).outcome() == o,
                    })
                    .collect();
                for k in targets {
                    self.cancel_one(k, cause, at, cx, out);
                }
            }
            Action::All(cause) => {
                for k in self.resting.clone() {
                    self.cancel_one(k, cause, at, cx, out);
                }
            }
        }
    }

    /// Maker scan (TC-E5): expiry first, then strict trade-through fills the
    /// whole remainder at the limit with fee 0.
    fn maker_scan(&mut self, at: TsMs, cx: &ExecCtx<'_>, out: &mut EventQueue) {
        for k in self.resting.clone() {
            let req = *cx.order(k).request();
            let size = req.size.shares().unwrap();
            let left = *self.rem(k);
            if let Some(e) = req.gtd_expiry() {
                if at >= e {
                    self.resting.retain(|&r| r != k);
                    out.push(AccountEvent {
                        at,
                        kind: AccountEventKind::OrderDone {
                            order: k,
                            reason: DoneReason::Expired,
                            filled: Some(size - left),
                        },
                    });
                    continue;
                }
            }
            let books = &cx.market.books;
            let through = match req.side {
                Side::Buy => books
                    .best_ask(req.outcome)
                    .is_some_and(|a| a.price < req.price),
                Side::Sell => books
                    .best_bid(req.outcome)
                    .is_some_and(|b| b.price > req.price),
            };
            if through {
                self.resting.retain(|&r| r != k);
                self.fill(k, &req, req.price, left, Liquidity::Maker, at, out);
                out.push(AccountEvent {
                    at,
                    kind: AccountEventKind::OrderDone {
                        order: k,
                        reason: DoneReason::Filled,
                        filled: Some(size),
                    },
                });
            }
        }
    }
}

impl Execution for MockExec {
    fn submit(
        &mut self,
        stamp: TsMs,
        cmd: ExecCommand<'_>,
        cx: &ExecCtx<'_>,
        out: &mut EventQueue,
    ) {
        self.commands.push(format!("{cmd:?}"));
        let action = match cmd {
            ExecCommand::Place { orders } => Action::Place(orders.to_vec()),
            ExecCommand::Cancel { keys, cause, .. } => Action::Cancel(keys.to_vec(), cause),
            ExecCommand::CancelScope { scope, cause, .. } => Action::Scope(scope, cause),
            ExecCommand::CancelAll { cause, .. } => Action::All(cause),
            ExecCommand::Split { op, size } => {
                out.push(AccountEvent {
                    at: stamp,
                    kind: AccountEventKind::PositionsSplit {
                        op,
                        size,
                        cost: Usdc::from_micros(size.micros()),
                    },
                });
                return;
            }
            ExecCommand::Merge { op, size } => {
                let actual = size
                    .min(cx.ledger.position(Outcome::Up).qty)
                    .min(cx.ledger.position(Outcome::Down).qty);
                if actual.is_positive() {
                    out.push(AccountEvent {
                        at: stamp,
                        kind: AccountEventKind::PositionsMerged { op, size: actual },
                    });
                }
                return;
            }
        };
        if self.delay <= 0 {
            self.execute(action, stamp, cx, out);
        } else {
            self.seq += 1;
            self.queued
                .push((TsMs(stamp.0 + self.delay), self.seq, action));
        }
    }
    fn next_due(&self) -> Option<TsMs> {
        self.timed.iter().map(|e| e.0).min()
    }
    fn run_next_due(&mut self, _cx: &ExecCtx<'_>, out: &mut EventQueue) {
        let Some(t) = self.next_due() else { return };
        let mut i = 0;
        while i < self.timed.len() {
            if self.timed[i].0 == t {
                let (at, kind) = self.timed.remove(i);
                out.push(AccountEvent { at, kind });
            } else {
                i += 1;
            }
        }
    }
    fn on_timer(&mut self, _t: &TimerFired, _cx: &ExecCtx<'_>, _out: &mut EventQueue) {}
    fn on_market_event(
        &mut self,
        now: TsMs,
        ev: &MarketEvent<'_>,
        cx: &ExecCtx<'_>,
        out: &mut EventQueue,
    ) {
        if !ev.produces_tick() {
            return;
        }
        self.market_events += 1;
        // Queued actions due at or before this tick, by (execute_at, seq).
        self.queued.sort_by_key(|a| (a.0, a.1));
        while let Some(pos) = self.queued.iter().position(|a| a.0 <= now) {
            let (_, _, a) = self.queued.remove(pos);
            self.execute(a, now, cx, out);
        }
        self.maker_scan(now, cx, out);
    }
    fn diagnostics(&self) -> &ExecDiagnostics {
        &self.diag
    }
}

// ---------------------------------------------------------------------------
// Scripted strategy
// ---------------------------------------------------------------------------

/// One order of a scripted placement.
#[derive(Clone, Debug)]
pub struct Ord {
    pub cid: String,
    pub outcome: Outcome,
    pub side: Side,
    pub price: Price,
    pub size: Qty,
    pub ty: OrderType,
    pub post_only: bool,
    pub expire: Option<TsMs>,
    /// One string meta entry `{"leg": <text>}` (30 §7.2).
    pub meta: Option<String>,
}

impl Ord {
    pub fn buy(cid: &str, size: f64, price: f64) -> Ord {
        Ord {
            cid: cid.into(),
            outcome: Outcome::Up,
            side: Side::Buy,
            price: p(price),
            size: q(size),
            ty: OrderType::Gtc,
            post_only: false,
            expire: None,
            meta: None,
        }
    }
    pub fn meta(mut self, leg: &str) -> Ord {
        self.meta = Some(leg.into());
        self
    }
    pub fn sell(cid: &str, size: f64, price: f64) -> Ord {
        Ord {
            side: Side::Sell,
            ..Ord::buy(cid, size, price)
        }
    }
    pub fn ty(mut self, ty: OrderType) -> Ord {
        self.ty = ty;
        self
    }
    pub fn post_only(mut self) -> Ord {
        self.post_only = true;
        self
    }
    pub fn gtd(mut self, expire: TsMs) -> Ord {
        self.ty = OrderType::Gtd;
        self.expire = Some(expire);
        self
    }
    pub fn outcome(mut self, o: Outcome) -> Ord {
        self.outcome = o;
        self
    }
    fn write(&self, out: &mut pmb_engine::Intents) {
        let meta = self.meta.as_ref().map(|leg| {
            let mut m = pmb_engine::strategy::Meta::new();
            m.push(
                "leg",
                pmb_engine::strategy::MetaValue::Str(leg.as_str().into()),
            );
            m
        });
        out.place_request(&ClientOrderId::new(&self.cid).unwrap(), self.req(), meta);
    }
    pub fn req(&self) -> OrderRequest {
        OrderRequest {
            cid: pmb_core::CidKey::new(0),
            outcome: self.outcome,
            side: self.side,
            price: self.price,
            size: OrderSize::Shares(self.size),
            order_type: self.ty,
            post_only: self.post_only,
            expire_at_ms: self.expire,
            meta: None,
            note: None,
        }
    }
}

/// A scripted intent.
#[derive(Clone, Debug)]
pub enum Cmd {
    Place(Ord),
    Batch(Vec<Ord>),
    Cancel(String),
    CancelEx(ExchangeOrderId),
    CancelBatch(Vec<Ref>),
    CancelMarket(Option<Outcome>),
    CancelAll,
    Split(Qty),
    Merge(Qty),
}

/// A cancel reference of a scripted `CancelBatch`.
#[derive(Clone, Debug)]
pub enum Ref {
    Cid(String),
    Ex(ExchangeOrderId),
    Both(String, ExchangeOrderId),
}

pub fn write_cmds(cmds: &[Cmd], out: &mut pmb_engine::Intents) {
    for c in cmds {
        match c {
            Cmd::Place(o) => o.write(out),
            Cmd::Batch(os) => {
                let cids: Vec<ClientOrderId> = os
                    .iter()
                    .map(|o| ClientOrderId::new(&o.cid).unwrap())
                    .collect();
                out.place_batch(os.iter().zip(&cids).map(|(o, c)| (c, o.req(), None)));
            }
            Cmd::Cancel(cid) => out.cancel(&ClientOrderId::new(cid).unwrap()),
            Cmd::CancelEx(id) => out.cancel_exchange_id(*id),
            Cmd::CancelBatch(refs) => {
                let cids: Vec<Option<ClientOrderId>> = refs
                    .iter()
                    .map(|r| match r {
                        Ref::Cid(c) | Ref::Both(c, _) => Some(ClientOrderId::new(c).unwrap()),
                        Ref::Ex(_) => None,
                    })
                    .collect();
                out.cancel_batch(refs.iter().zip(&cids).map(|(r, c)| match r {
                    Ref::Cid(_) => CancelRef::Cid(c.as_ref().unwrap()),
                    Ref::Ex(e) => CancelRef::Exchange(*e),
                    Ref::Both(_, e) => CancelRef::Both(c.as_ref().unwrap(), *e),
                }));
            }
            Cmd::CancelMarket(o) => out.cancel_market(*o),
            Cmd::CancelAll => out.cancel_all(),
            Cmd::Split(s) => out.split(*s),
            Cmd::Merge(s) => out.merge(*s),
        }
    }
}

pub type EventHook = dyn Fn(&Ctx, &AuthorEvent, &mut Vec<Cmd>, &Mutex<Vec<String>>) + Send + Sync;
pub type TickHook = dyn Fn(&Ctx, &mut Vec<Cmd>, &Mutex<Vec<String>>) + Send + Sync;

/// The script shared by the harness and the strategy instance.
#[derive(Default)]
pub struct Script {
    /// Intents written at the next strategy ticks, one batch per tick.
    pub outbox: Mutex<VecDeque<Vec<Cmd>>>,
    /// What the strategy observed.
    pub log: Mutex<Vec<String>>,
    pub on_event: Option<Box<EventHook>>,
    pub on_tick: Option<Box<TickHook>>,
    pub interests: Option<Interests>,
    /// Panics in `on_tick` at this tick seq.
    pub panic_at_tick: Option<u64>,
    /// Returns `Err(StrategyError)` from `on_tick` at this tick seq.
    pub error_at_tick: Option<u64>,
}

pub struct ScriptStrategy {
    script: Arc<Script>,
}

impl Strategy for ScriptStrategy {
    type Params = Arc<Script>;
    const ID: &'static str = "core-script.v1";

    fn requirements(_p: &Arc<Script>) -> Requirements {
        Requirements::new()
    }
    fn interests(p: &Arc<Script>) -> Interests {
        p.interests.unwrap_or(Interests::ALL)
    }
    fn new(p: &Arc<Script>, _market: &MarketInfo) -> Self {
        ScriptStrategy { script: p.clone() }
    }
    fn on_tick(&mut self, ctx: &Ctx, out: &mut pmb_engine::Intents) -> StrategyResult {
        let s = &self.script;
        if s.panic_at_tick == Some(ctx.tick().seq) {
            panic!("boom at tick {}", ctx.tick().seq);
        }
        if s.error_at_tick == Some(ctx.tick().seq) {
            return Err(pmb_engine::StrategyError::new("bad state"));
        }
        s.log.lock().unwrap().push(format!(
            "tick seq={} now={} ec={} cause={}",
            ctx.tick().seq,
            ctx.now().0 - START,
            ctx.event_clock().0 - START,
            ctx.tick().cause.as_str()
        ));
        let mut cmds = s.outbox.lock().unwrap().pop_front().unwrap_or_default();
        if let Some(h) = &s.on_tick {
            h(ctx, &mut cmds, &s.log);
        }
        write_cmds(&cmds, out);
        Ok(())
    }
    fn on_event(
        &mut self,
        ctx: &Ctx,
        event: &AuthorEvent,
        out: &mut pmb_engine::Intents,
    ) -> StrategyResult {
        let s = &self.script;
        s.log.lock().unwrap().push(format!(
            "event {} now={} ec={}",
            event.ts_kind(),
            ctx.now().0 - START,
            ctx.event_clock().0 - START
        ));
        if let Some(h) = &s.on_event {
            let mut cmds = Vec::new();
            h(ctx, event, &mut cmds, &s.log);
            write_cmds(&cmds, out);
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Recording trace sink
// ---------------------------------------------------------------------------

/// Records the engine event stream (22 §2) as account events plus one line
/// per trace event.
#[derive(Clone, Debug, Default)]
pub struct Rec {
    pub events: Vec<AccountEvent>,
    pub lines: Vec<String>,
}

impl TraceSink for Rec {
    fn wants_feed_view(&self) -> bool {
        true
    }
    fn record(&mut self, ev: &TraceEvent<'_>) {
        match ev {
            TraceEvent::TickStart {
                seq,
                cause,
                decision_ts,
                ..
            } => self.lines.push(format!(
                "tick_start {seq} {} {}",
                cause.as_str(),
                decision_ts.0 - START
            )),
            TraceEvent::FeedView { seq, .. } => self.lines.push(format!("feed_view {seq}")),
            TraceEvent::Decision {
                seq,
                origin,
                intents,
            } => self
                .lines
                .push(format!("decision {seq} {origin:?} {}", intents.len())),
            TraceEvent::AccountEvent { seq, event } => {
                self.events.push(**event);
                self.lines
                    .push(format!("account {seq} {}", event.kind.ts_kind()));
            }
            TraceEvent::Exec(_) => self.lines.push("exec".into()),
            TraceEvent::Final(_) => self.lines.push("final".into()),
        }
    }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

pub fn market() -> SharedMarket {
    let info = MarketInfo::new(
        SLUG,
        ConditionId(Hash32([7; 32])),
        PerOutcome::new(TokenId([1; 32]), TokenId([2; 32])),
        MarketVersion::V2,
        false,
    )
    .unwrap();
    let start = info.window.start_ms;
    let timeline = RulesTimeline::realistic_fallback(
        RulesTableVersion::V1,
        start,
        start,
        info.window.end_ms,
        [],
    );
    SharedMarket::new(Arc::new(info), Arc::new(timeline), RulesSource::Fallback)
}

pub fn config(rules: CoreRules) -> EngineConfig {
    EngineConfig {
        core_rules: rules,
        input_mode: InputMode::TelonexDelta,
        models: ExecutionModels::TS_COMPAT,
        compat_latency: CompatLatency {
            delay_ms: 0,
            jitter_ms: 0,
        },
        market_seed: MarketSeed(0),
        starting_capital: u(500.0),
        max_events_per_drain: 4_200,
        risk: RiskLimits::TS_DEFAULTS,
    }
}

pub type S<E = MockExec> = Session<ScriptStrategy, E, Rec>;

/// One-market harness over an execution adapter: the compat-like mock by
/// default, or the real ts-compat `Simulator` (M1 step 4 integration).
pub struct H<E: Execution = MockExec> {
    pub market: SharedMarket,
    pub s: S<E>,
    pub script: Arc<Script>,
    seq: u64,
    /// Last book per outcome, re-sent by [`H::send`].
    pub books: PerOutcome<(Vec<PriceSize>, Vec<PriceSize>)>,
}

pub fn lv(levels: &[(f64, f64)]) -> Vec<PriceSize> {
    levels
        .iter()
        .map(|&(px, sz)| PriceSize {
            price: p(px),
            size: q(sz),
        })
        .collect()
}

/// Mock internals for the converted suites; `None` on the real simulator,
/// whose observable behavior the suites assert instead.
pub trait MockView {
    fn mock(&self) -> Option<&MockExec>;
}

impl MockView for MockExec {
    fn mock(&self) -> Option<&MockExec> {
        Some(self)
    }
}

impl MockView for Simulator {
    fn mock(&self) -> Option<&MockExec> {
        None
    }
}

impl H<MockExec> {
    pub fn new(cfg: EngineConfig, exec: MockExec, script: Script) -> H {
        H::with_exec(cfg, exec, script)
    }

    pub fn ts_compat(exec: MockExec) -> H {
        H::new(config(CoreRules::TsCompat), exec, Script::default())
    }
}

impl H<Simulator> {
    /// A harness on the real ts-compat simulator with the mock's compat
    /// delay (`MockExec::sync` = 0 ms, `delayed(ms)`), jitter 0 (13 §5.1).
    pub fn sim(mut cfg: EngineConfig, mock: MockExec, script: Script) -> H<Simulator> {
        cfg.compat_latency.delay_ms = u32::try_from(mock.delay).expect("delay");
        cfg.compat_latency.jitter_ms = 0;
        let sim = Simulator::new(&cfg).expect("ts-compat simulator");
        H::with_exec(cfg, sim, script)
    }
}

impl<E: Execution> H<E> {
    pub fn with_exec(cfg: EngineConfig, exec: E, script: Script) -> H<E> {
        let market = market();
        let script = Arc::new(script);
        let s = S::new(&script, &market, cfg, exec, Rec::default()).expect("session");
        H {
            market,
            s,
            script,
            seq: 0,
            books: PerOutcome::default(),
        }
    }

    pub fn env_step(
        &mut self,
        at: TsMs,
        ex: Option<TsMs>,
        payload: Payload<'_>,
    ) -> Result<(), SessionFault> {
        self.seq += 1;
        let env = Envelope {
            seq: self.seq,
            at,
            exchange_ts: ex,
            recv_wall: None,
            recv_mono: None,
            source: Source::MarketWs,
            payload,
        };
        self.market.apply(&env);
        self.s.step(&env, &self.market)
    }

    /// A `book` for one outcome at `ms` after the window start.
    pub fn book(
        &mut self,
        ms: i64,
        o: Outcome,
        bids: &[(f64, f64)],
        asks: &[(f64, f64)],
    ) -> Result<(), SessionFault> {
        let (b, a) = (lv(bids), lv(asks));
        self.books[o] = (b.clone(), a.clone());
        let ev = MarketEvent::Book {
            outcome: o,
            bids: &b,
            asks: &a,
        };
        self.env_step(t(ms), Some(t(ms)), Payload::Market(ev))
    }

    /// Up book tick (the common case of the TS suites).
    pub fn tick(
        &mut self,
        ms: i64,
        bids: &[(f64, f64)],
        asks: &[(f64, f64)],
    ) -> Result<(), SessionFault> {
        self.book(ms, Outcome::Up, bids, asks)
    }

    /// Queues intents for the next strategy tick, then ticks.
    pub fn send(
        &mut self,
        cmds: Vec<Cmd>,
        ms: i64,
        bids: &[(f64, f64)],
        asks: &[(f64, f64)],
    ) -> Result<(), SessionFault> {
        self.script.outbox.lock().unwrap().push_back(cmds);
        self.tick(ms, bids, asks)
    }

    pub fn price_change(
        &mut self,
        ms: i64,
        changes: &[(Outcome, QuoteSide, f64, f64)],
    ) -> Result<(), SessionFault> {
        let c: Vec<LevelUpdate> = changes
            .iter()
            .map(|&(outcome, side, px, sz)| LevelUpdate {
                outcome,
                side,
                price: p(px),
                size: q(sz),
            })
            .collect();
        self.env_step(
            t(ms),
            Some(t(ms)),
            Payload::Market(MarketEvent::PriceChange { changes: &c }),
        )
    }

    pub fn synth(&mut self, at_ms: i64, kind: SyntheticKind) -> Result<(), SessionFault> {
        self.env_step(t(at_ms), None, Payload::SyntheticTick(kind))
    }

    pub fn control(&mut self, ms: i64, c: Control) -> Result<(), SessionFault> {
        self.env_step(t(ms), None, Payload::Control(c))
    }

    pub fn ledger(&self) -> &pmb_engine::ledger::Ledger {
        self.s.ledger()
    }

    /// Delivered account events in delivery order.
    pub fn events(&self) -> &[AccountEvent] {
        &self.s.trace().events
    }

    pub fn kinds(&self) -> Vec<&'static str> {
        self.events().iter().map(|e| e.kind.ts_kind()).collect()
    }

    /// Delivered events since index `from`.
    pub fn since(&self, from: usize) -> &[AccountEvent] {
        &self.events()[from..]
    }

    pub fn cid_of(&self, k: OrderKey) -> String {
        let r = self.ledger().order(k);
        self.s.cids().resolve(r.cid()).to_string()
    }

    /// Cids of delivered `OrderDone` events since `from`, sorted.
    pub fn done_cids(&self, from: usize) -> Vec<String> {
        let mut v: Vec<String> = self
            .since(from)
            .iter()
            .filter_map(|e| match e.kind {
                AccountEventKind::OrderDone { order, .. } => Some(self.cid_of(order)),
                _ => None,
            })
            .collect();
        v.sort();
        v
    }

    /// Open orders' cids (strategy view), sorted.
    pub fn open_cids(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .ledger()
            .open_orders()
            .map(|r| self.s.cids().resolve(r.cid()).to_string())
            .collect();
        v.sort();
        v
    }

    /// Reject reason strings of delivered `OrderRejected` events.
    pub fn rejections(&self) -> Vec<String> {
        self.events()
            .iter()
            .filter_map(|e| match e.kind {
                AccountEventKind::OrderRejected { reason, .. } => Some(reason.to_string()),
                _ => None,
            })
            .collect()
    }

    pub fn cancel_failures(&self, from: usize) -> Vec<&'static str> {
        self.since(from)
            .iter()
            .filter_map(|e| match e.kind {
                AccountEventKind::CancelFailed { reason, .. } => Some(reason.code()),
                _ => None,
            })
            .collect()
    }

    pub fn current(&self, cid: &str) -> Option<OrderKey> {
        let c = self.s.cids().get(cid)?;
        self.ledger().current(c)
    }

    pub fn log(&self) -> Vec<String> {
        self.script.log.lock().unwrap().clone()
    }

    pub fn n_events(&self) -> usize {
        self.events().len()
    }
}

/// An exchange id that resolves to nothing in any test session.
pub fn unknown_exchange_id() -> ExchangeOrderId {
    ExchangeOrderId::Clob(Hash32([9; 32]))
}

/// `OrderRef` helper for direct core use.
pub fn cid_ref(k: pmb_core::CidKey) -> OrderRef {
    OrderRef::Cid(k)
}
