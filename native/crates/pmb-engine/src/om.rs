//! The order manager (12 §7–§8): turns intents into commands through halt
//! and guards, dedupe, validation (`ExchangeRules`), risk, funding, ledger
//! command entries and dispatch.
//!
//! Realistic handles intents one at a time in list order (12 §7.2); ts-compat
//! runs the TS risk pass over the whole list first and emits its rejections
//! first (TC-C2, 12 §8.2). Engine-originated intents (window end, kill
//! switch, panic handling, operator, rotation) go through the same pipeline
//! (12 §8.3).

use pmb_core::event::{
    AccountEvent, AccountEventKind, CancelCause, CancelFailReason, MergeFailReason, RejectReason,
    SplitFailReason,
};
use pmb_core::ids::{
    CancelKind, CancelOp, CancelSeq, CidInterner, CidKey, ExchangeOrderId, OpKey, OrderKey,
};
use pmb_core::order::{Intent, MetaStore, OrderRef, OrderRequest, OrderSize, Side};
use pmb_core::rules::{tick_decimals, ExchangeRules, RuleViolation};
use pmb_core::state::CancelState;
use pmb_core::{Outcome, PerOutcome, Price, Qty, TsMs, Usdc};

use crate::config::EngineConfig;
use crate::core_rules::CoreRules;
use crate::exec::{CancelScope, EventQueue, ExecCommand, ExecCtx, Execution};
use crate::ledger::{insufficient_capital, Delivered, Ledger, PendingOp};
use crate::shared::SharedMarket;
use crate::strategy::Intents;

/// OM counters (12 §14 P12, 21 §10): plain integers, always on.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OmCounters {
    /// Placements dropped as duplicates of an active cid (12 §7.6); a counter
    /// key, never an emitted reject reason.
    pub duplicate_active_cid: u64,
    /// Intents handled by kind, indexed by `IntentKind as usize`.
    pub intents_by_kind: [u64; 8],
    /// Commands dispatched.
    pub commands: u64,
}

/// Best own price per (outcome, side) over own orders that could still match
/// (10 N6), updated at emission, `CancelAcked` delivery and terminal delivery
/// (12 §7.4 self-cross block). Realistic only (TC-C14). Each entry keeps the
/// key of the order holding the best price, for `SelfCross{resting}`.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct SelfCrossIndex {
    /// Highest own BUY price per outcome.
    pub best_buy: PerOutcome<Option<(Price, OrderKey)>>,
    /// Lowest own SELL price per outcome.
    pub best_sell: PerOutcome<Option<(Price, OrderKey)>>,
}

impl SelfCrossIndex {
    /// Whether a placement could match an own order, directly or through
    /// complementary matching (10 N6, 12 §7.4): four comparisons. Returns the
    /// own order it could meet.
    pub fn would_cross(&self, outcome: Outcome, side: Side, price: Price) -> Option<OrderKey> {
        let one = Price::ONE.micros();
        let other = outcome.other();
        match side {
            Side::Buy => {
                if let Some((q, k)) = self.best_sell[outcome] {
                    if price >= q {
                        return Some(k);
                    }
                }
                if let Some((q, k)) = self.best_buy[other] {
                    if price.micros() + q.micros() >= one {
                        return Some(k);
                    }
                }
            }
            Side::Sell => {
                if let Some((q, k)) = self.best_buy[outcome] {
                    if price <= q {
                        return Some(k);
                    }
                }
                if let Some((q, k)) = self.best_sell[other] {
                    if price.micros() + q.micros() <= one {
                        return Some(k);
                    }
                }
            }
        }
        None
    }

    /// Adds an own order at emission.
    fn add(&mut self, outcome: Outcome, side: Side, price: Price, k: OrderKey) {
        match side {
            Side::Buy => {
                if self.best_buy[outcome].is_none_or(|(q, _)| price > q) {
                    self.best_buy[outcome] = Some((price, k));
                }
            }
            Side::Sell => {
                if self.best_sell[outcome].is_none_or(|(q, _)| price < q) {
                    self.best_sell[outcome] = Some((price, k));
                }
            }
        }
    }

    /// Recomputes the index over the non-terminal records whose cancel is not
    /// acknowledged (10 N6); O(open orders), run only on removals.
    fn rebuild(&mut self, ledger: &Ledger) {
        *self = SelfCrossIndex::default();
        for &k in ledger.active_keys() {
            let r = ledger.order(k);
            if r.cancel_state() != CancelState::Acked {
                self.add(r.outcome(), r.side(), r.price(), k);
            }
        }
    }
}

/// An engine-originated intent (12 §8.3, §10).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum EngineIntent {
    /// `CancelMarket{scope}` with an engine cause (`WindowEnd`, `Rotation`,
    /// `StrategyPanic`, `Operator`).
    CancelMarket {
        /// Scope.
        scope: CancelScope,
        /// Engine cause.
        cause: CancelCause,
    },
    /// `CancelAll` with an engine cause (`KillSwitch`, `Operator`).
    CancelAll {
        /// Engine cause.
        cause: CancelCause,
    },
    /// Cancel the current generation of a cid (operator `cancel_order{cid}`,
    /// 50 §16), resolved like a realistic `CancelOrder` (12 §7.3): a known
    /// terminal target is skipped, an unacknowledged one is deferred until
    /// its `OrderAccepted` is delivered.
    CancelCid {
        /// The interned cid (session interner).
        cid: CidKey,
        /// Engine cause.
        cause: CancelCause,
    },
}

/// Halt state of the strategy (12 §11, §8.3; 50 §10.2). Checked first for
/// every placement (12 §7.2 step 1) and split (12 §7.3); cancels and merges
/// always pass, so a halted session can still clean up.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum Halt {
    /// Placements allowed.
    #[default]
    Running,
    /// Strategy halted (paper panic, error or cascade limit; guard
    /// `reject_burst`): placements rejected `StrategyHalted`.
    StrategyHalted,
    /// Session guard `max_wallet_exposure_usdc` or `max_orders_per_minute`
    /// tripped (50 §10.2): placements rejected.
    // D-PENDING: 10 §10.2 has no guard reason and the core has no clock for
    // the per-minute window before M8; chose `KillSwitch` as the reason and
    // a halt that lasts until rotation.
    Guard,
    /// Kill switch tripped (12 §8.3, 50 §10.4): placements rejected
    /// `KillSwitch`; strategy calls stop.
    KillSwitch,
}

impl Halt {
    /// The placement reject reason of a halt (12 §7.2 step 1).
    pub const fn reject_reason(self) -> Option<RejectReason> {
        match self {
            Halt::Running => None,
            Halt::StrategyHalted => Some(RejectReason::StrategyHalted),
            Halt::Guard | Halt::KillSwitch => Some(RejectReason::KillSwitch),
        }
    }

    /// The split failure reason of a halt (12 §7.3 SplitPositions row).
    pub const fn split_reason(self) -> Option<SplitFailReason> {
        match self {
            Halt::Running => None,
            Halt::StrategyHalted => Some(SplitFailReason::StrategyHalted),
            Halt::Guard | Halt::KillSwitch => Some(SplitFailReason::KillSwitch),
        }
    }

    /// Severity order: a halt never downgrades (a kill switch stays).
    const fn rank(self) -> u8 {
        match self {
            Halt::Running => 0,
            Halt::StrategyHalted => 1,
            Halt::Guard => 2,
            Halt::KillSwitch => 3,
        }
    }
}

/// Mutable session parts the OM works on, borrowed disjointly from the
/// session for one `handle` call.
pub struct OmIo<'s, E: Execution> {
    /// The ledger (commands apply at emission, 12 §9.1).
    pub ledger: &'s mut Ledger,
    /// The session cid interner (local cids of the buffer are interned here).
    pub cids: &'s mut CidInterner,
    /// The session meta store (10 §7.5).
    pub metas: &'s mut MetaStore,
    /// The execution adapter.
    pub exec: &'s mut E,
    /// The cascade queue (`OrderSubmitted`, OM rejections and synchronous
    /// adapter events are appended here).
    pub queue: &'s mut EventQueue,
    /// Shared market (rules in force, window, skew).
    pub market: &'s SharedMarket,
    /// Resolved config.
    pub config: &'s EngineConfig,
}

impl<E: Execution> OmIo<'_, E> {
    #[inline]
    fn push(&mut self, at: TsMs, kind: AccountEventKind) {
        self.queue.push(AccountEvent { at, kind });
    }

    /// The rules the OM validates and reserves with (12 §7.4): the rules in
    /// force in realistic; the fixed ts-compat rules of 11 §4 in ts-compat.
    #[inline]
    fn rules(&self) -> ExchangeRules {
        match self.config.core_rules {
            // TC-C1, TC-E7: the fixed ts-compat rules of 11 §4.
            CoreRules::TsCompat => ExchangeRules::ts_compat(),
            CoreRules::Realistic => self.market.rules,
        }
    }

    fn dispatch(&mut self, stamp: TsMs, cmd: ExecCommand<'_>) {
        let cx = ExecCtx {
            market: self.market,
            ledger: self.ledger,
            config: self.config,
        };
        self.exec.submit(stamp, cmd, &cx, self.queue);
    }
}

/// Per-call ts-compat bookkeeping (TC-C2 step 4; `OrderManager.ts:311-334`).
#[derive(Clone, Debug, Default)]
struct CallScratch {
    /// Keys emitted in this call.
    emitted: Vec<OrderKey>,
    /// Keys whose terminal event was returned synchronously in this call.
    terminal: Vec<OrderKey>,
    /// Keys acknowledged synchronously in this call.
    accepted: Vec<OrderKey>,
    /// Risk-pass verdict per placement order, in buffer order.
    risk_ok: Vec<bool>,
    /// Resolved cancel targets of one intent.
    targets: Vec<OrderKey>,
}

impl CallScratch {
    fn clear(&mut self) {
        self.emitted.clear();
        self.terminal.clear();
        self.accepted.clear();
        self.risk_ok.clear();
        self.targets.clear();
    }
}

/// The order manager of one session (12 §7–§8).
#[derive(Clone, Debug)]
pub struct OrderManager {
    /// Reused key scratch for `ExecCommand::Place` (12 §14 P1).
    pub(crate) scratch: Vec<OrderKey>,
    /// Deferred cancels waiting for an `OrderAccepted` delivery (12 §7.3),
    /// with their cancel operation and cause.
    pub(crate) deferred: Vec<(OrderKey, CancelOp, CancelCause)>,
    /// Self-cross index (realistic).
    pub(crate) self_cross: SelfCrossIndex,
    /// Next `CancelSeq` (10 §6).
    pub(crate) next_cancel: CancelSeq,
    /// Next `OpKey` (10 §6).
    pub(crate) next_op: OpKey,
    /// Halt state.
    pub(crate) halt: Halt,
    /// Counters.
    pub(crate) counters: OmCounters,
    call: CallScratch,
}

impl Default for OrderManager {
    fn default() -> Self {
        OrderManager::new()
    }
}

/// Maps an exchange-rule violation to its reject reason (10 §10.2).
fn violation_reason(v: RuleViolation) -> RejectReason {
    match v {
        RuleViolation::InvalidTick { price, tick } => RejectReason::InvalidTick { price, tick },
        RuleViolation::PriceOutOfBounds { min, max } => RejectReason::PriceOutOfBounds { min, max },
        RuleViolation::SizeBelowMinimum { min } => RejectReason::SizeBelowMinimum { min },
        RuleViolation::NotionalBelowMinimum { min } => RejectReason::NotionalBelowMinimum { min },
        RuleViolation::SizePrecision => RejectReason::SizePrecision,
        RuleViolation::AmountPrecision => RejectReason::AmountPrecision,
        RuleViolation::PostOnlyWouldCross => RejectReason::PostOnlyWouldCross,
        RuleViolation::GtdLeadTooShort { min_lead_ms } => RejectReason::GtdLeadTooShort {
            min_lead_ms: min_lead_ms.0,
        },
        RuleViolation::MarketClosed => RejectReason::MarketClosed,
        RuleViolation::BatchTooLarge { max } => RejectReason::BatchTooLarge { max: max as u32 },
    }
}

/// Size of a share-sized request; collateral sizes have no share size.
#[inline]
fn shares_of(req: &OrderRequest) -> Option<Qty> {
    req.size.shares()
}

impl OrderManager {
    /// A fresh OM: no active cids (12 §7.6, `OrderManager.ts:143-149`).
    pub fn new() -> OrderManager {
        OrderManager {
            scratch: Vec::new(),
            deferred: Vec::new(),
            self_cross: SelfCrossIndex::default(),
            next_cancel: CancelSeq::new(0),
            next_op: OpKey::new(0),
            halt: Halt::Running,
            counters: OmCounters::default(),
            call: CallScratch::default(),
        }
    }

    fn cancel_op(&mut self, kind: CancelKind) -> CancelOp {
        let seq = self.next_cancel;
        self.next_cancel = seq.next().expect("cancel seq exhausted");
        CancelOp { seq, kind }
    }

    fn op_key(&mut self) -> OpKey {
        let k = self.next_op;
        self.next_op = k.next().expect("op key exhausted");
        k
    }

    /// The session form of a buffer request: the cid interned into the
    /// session interner (30 §6). Meta is converted only after dedupe.
    fn session_request<E: Execution>(
        intents: &Intents,
        req: &OrderRequest,
        io: &mut OmIo<'_, E>,
    ) -> OrderRequest {
        let cid = io
            .cids
            .intern_str(intents.cid_text(req.cid))
            .expect("cid validated at construction (10 §6)");
        OrderRequest {
            cid,
            meta: None,
            ..*req
        }
    }

    /// Serializes the buffer meta of `local` into the session meta store
    /// (10 §7.5 E1); `MetaTooLarge` above 16 KiB (21 §16).
    fn store_meta<E: Execution>(
        intents: &Intents,
        local: &OrderRequest,
        io: &mut OmIo<'_, E>,
    ) -> Result<Option<pmb_core::MetaId>, RejectReason> {
        match local.meta {
            None => Ok(None),
            Some(id) => {
                let json = intents.meta(id).to_json();
                io.metas
                    .insert(&json)
                    .map(Some)
                    .map_err(|_| RejectReason::MetaTooLarge)
            }
        }
    }

    fn reject<E: Execution>(io: &mut OmIo<'_, E>, stamp: TsMs, cid: CidKey, reason: RejectReason) {
        io.push(
            stamp,
            AccountEventKind::OrderRejected {
                order: None,
                cid,
                reason,
            },
        );
    }

    /// Handles one strategy intent list decided at `stamp` (12 §7.2): ts-compat
    /// per TC-C2, realistic per intent in list order. Events go to the back
    /// of the queue (12 §6.2).
    pub fn handle<E: Execution>(&mut self, intents: &Intents, stamp: TsMs, io: OmIo<'_, E>) {
        if intents.is_empty() {
            return;
        }
        let mut io = io;
        self.call.clear();
        for intent in intents.core().iter() {
            self.counters.intents_by_kind[intent.kind() as usize] += 1;
        }
        match io.config.core_rules {
            CoreRules::TsCompat => self.handle_ts_compat(intents, stamp, &mut io),
            CoreRules::Realistic => self.handle_realistic(intents, stamp, &mut io),
        }
    }

    // ------------------------------------------------------------------
    // ts-compat (TC-C2 … TC-C7, TC-C12, TC-C14)
    // ------------------------------------------------------------------

    /// The TS risk pass (12 §8.2, TC-C2, TC-C3; `riskLimits.ts:70-219`): walks
    /// the whole list before any handler, counters incremental within the
    /// list (later-deduped intents included), invalid sizes pass uncounted,
    /// the loss stop blocks every placement, the view counts only delivered
    /// submissions. Rejections are emitted first in list order; a rejection
    /// whose cid has an active generation is dropped (`OrderManager.ts:176-184`).
    fn ts_risk_pass<E: Execution>(&mut self, intents: &Intents, stamp: TsMs, io: &mut OmIo<'_, E>) {
        let lim = io.config.risk;
        let realized = io.ledger.realized_pnl();
        let loss_stop = realized.micros() <= -lim.max_loss_stop.micros().abs();
        let (mut open, mut buys, mut sells) = io.ledger.delivered_open_exposure();
        for intent in intents.core().iter() {
            for local in intent.orders() {
                let req = Self::session_request(intents, local, io);
                let size = match req.size {
                    OrderSize::Shares(q) => q,
                    OrderSize::Collateral(_) => Qty::ZERO,
                };
                let verdict = if loss_stop {
                    Err(RejectReason::RiskLossStop { realized })
                } else if !size.is_positive() {
                    Ok(false)
                } else if size > lim.max_order_size {
                    Err(RejectReason::RiskMaxOrderSize {
                        max: lim.max_order_size,
                    })
                } else if open + 1 > lim.max_open_orders {
                    Err(RejectReason::RiskMaxOpenOrders {
                        max: lim.max_open_orders,
                    })
                } else {
                    let pos = io.ledger.position(req.outcome).qty;
                    let projected = match req.side {
                        Side::Buy => pos + buys[req.outcome] + size,
                        Side::Sell => pos - (sells[req.outcome] + size),
                    };
                    if projected.micros().abs() > lim.max_abs_position.micros() {
                        Err(RejectReason::RiskMaxAbsPosition {
                            max: lim.max_abs_position,
                        })
                    } else {
                        Ok(true)
                    }
                };
                match verdict {
                    Ok(counted) => {
                        if counted {
                            open += 1;
                            match req.side {
                                Side::Buy => buys[req.outcome] += size,
                                Side::Sell => sells[req.outcome] += size,
                            }
                        }
                        self.call.risk_ok.push(true);
                    }
                    Err(reason) => {
                        self.call.risk_ok.push(false);
                        if !io.ledger.cid_active(req.cid) {
                            Self::reject(io, stamp, req.cid, reason);
                        }
                    }
                }
            }
        }
    }

    /// ts-compat validation (TC-C1; `OrderManager.ts:756-780`): price > 0,
    /// size > 0, post-only only on GTC/GTD, GTD needs an expiry at least
    /// 60 s after the decision stamp.
    fn validate_ts_compat(req: &OrderRequest, stamp: TsMs) -> Result<(), RejectReason> {
        if !req.price.is_positive() {
            return Err(RejectReason::InvalidPrice);
        }
        // D-PENDING: collateral-sized orders do not exist in TS (10 O3);
        // chose to reject them in ts-compat as `InvalidSize`.
        match req.size {
            OrderSize::Shares(q) if q.is_positive() => {}
            _ => return Err(RejectReason::InvalidSize),
        }
        if req.post_only && !req.order_type.allows_post_only() {
            return Err(RejectReason::PostOnlyRequiresResting);
        }
        if req.order_type == pmb_core::OrderType::Gtd {
            let Some(e) = req.expire_at_ms else {
                return Err(RejectReason::GtdRequiresExpiry);
            };
            let min = ExchangeRules::ts_compat().gtd.min_lead.0;
            if (e.0 as i128) < stamp.0 as i128 + min as i128 {
                return Err(RejectReason::GtdExpiryTooSoon { min_offset_ms: min });
            }
        }
        Ok(())
    }

    /// One ts-compat placement after the risk pass: dedupe → validate → fund
    /// → `OrderSubmitted` (TC-C2 step 3). Returns the accepted key.
    fn place_ts_compat<E: Execution>(
        &mut self,
        intents: &Intents,
        local: &OrderRequest,
        stamp: TsMs,
        io: &mut OmIo<'_, E>,
    ) -> Option<OrderKey> {
        let mut req = Self::session_request(intents, local, io);
        if io.ledger.cid_active(req.cid) {
            self.counters.duplicate_active_cid += 1;
            return None;
        }
        let rules = io.rules();
        let checked = Self::validate_ts_compat(&req, stamp)
            .and_then(|()| Self::store_meta(intents, local, io))
            .and_then(|meta| {
                req.meta = meta;
                if req.side == Side::Buy {
                    let required = io
                        .ledger
                        .reservation_for(&req, &rules)
                        .expect("reservation overflow (10 T3)");
                    let available = io.ledger.available();
                    if required > available {
                        return Err(insufficient_capital(required, available));
                    }
                }
                Ok(())
            });
        if let Err(reason) = checked {
            Self::reject(io, stamp, req.cid, reason);
            return None;
        }
        Some(self.accept(req, stamp, &rules, io))
    }

    /// Writes the record and emits `OrderSubmitted` (12 §7.2 step 6).
    fn accept<E: Execution>(
        &mut self,
        req: OrderRequest,
        stamp: TsMs,
        rules: &ExchangeRules,
        io: &mut OmIo<'_, E>,
    ) -> OrderKey {
        let k = io.ledger.submit(req, stamp, rules, None);
        io.push(stamp, AccountEventKind::OrderSubmitted { order: k });
        self.call.emitted.push(k);
        if io.config.core_rules == CoreRules::Realistic {
            self.self_cross.add(req.outcome, req.side, req.price, k);
        }
        k
    }

    /// Dispatches one command and, in ts-compat, scans the synchronous events
    /// it appended (13 X2; 12 §7.2 TC-C2 step 4, §7.6 item 1): a terminal
    /// event sets `om_terminal`, an `OrderAccepted` acknowledges the key for
    /// cancel resolution later in this call.
    fn dispatch<E: Execution>(&mut self, stamp: TsMs, cmd: ExecCommand<'_>, io: &mut OmIo<'_, E>) {
        let mark = io.queue.len();
        io.dispatch(stamp, cmd);
        self.counters.commands += 1;
        // TC-C2 step 4: only ts-compat emits synchronously (13 X2).
        if io.config.core_rules != CoreRules::TsCompat {
            return;
        }
        for i in mark..io.queue.len() {
            let ev = *io.queue.since(i).next().expect("index in range");
            match ev.kind {
                k if k.is_terminal() => {
                    let key = k.order().expect("terminal events are keyed");
                    if io.ledger.get(key).is_some() {
                        io.ledger.set_om_terminal(key);
                        self.call.terminal.push(key);
                    }
                }
                AccountEventKind::OrderAccepted { order } => self.call.accepted.push(order),
                _ => {}
            }
        }
    }

    fn dispatch_place<E: Execution>(&mut self, stamp: TsMs, io: &mut OmIo<'_, E>) {
        if self.scratch.is_empty() {
            return;
        }
        let keys = std::mem::take(&mut self.scratch);
        self.dispatch(stamp, ExecCommand::Place { orders: &keys }, io);
        self.scratch = keys;
        self.scratch.clear();
    }

    fn handle_ts_compat<E: Execution>(
        &mut self,
        intents: &Intents,
        stamp: TsMs,
        io: &mut OmIo<'_, E>,
    ) {
        self.ts_risk_pass(intents, stamp, io);
        let mut order_ix = 0usize;
        for intent in intents.core().iter() {
            match intent {
                Intent::PlaceLimit(_) | Intent::PlaceBatch(_) => {
                    self.scratch.clear();
                    for local in intent.orders() {
                        let ok = self.call.risk_ok[order_ix];
                        order_ix += 1;
                        if !ok {
                            continue;
                        }
                        if let Some(k) = self.place_ts_compat(intents, local, stamp, io) {
                            self.scratch.push(k);
                        }
                    }
                    self.dispatch_place(stamp, io);
                }
                Intent::CancelOrder(r) => {
                    // TC-C5: no OM resolution; bound to the cid's key current at
                    // decision time (`BacktestExecution.ts:680-682`). TS schedules
                    // the cancel even when nothing is bound, so it is dispatched
                    // with no key to keep the per-submit draw count.
                    let op = self.cancel_op(CancelKind::Order);
                    let key = self.bound_key(intents, r, io);
                    self.call.targets.clear();
                    if let Some(k) = key {
                        io.ledger.request_cancel(k, CancelState::InFlight);
                        self.call.targets.push(k);
                    }
                    let keys = std::mem::take(&mut self.call.targets);
                    self.dispatch(
                        stamp,
                        ExecCommand::Cancel {
                            op,
                            cause: CancelCause::Strategy(op),
                            keys: &keys,
                        },
                        io,
                    );
                    self.call.targets = keys;
                }
                Intent::CancelBatch(refs) => self.cancel_batch(intents, refs, stamp, io),
                Intent::CancelMarket(o) => self.cancel_scope(o, stamp, io),
                Intent::CancelAll => {
                    let op = self.cancel_op(CancelKind::All);
                    self.dispatch(
                        stamp,
                        ExecCommand::CancelAll {
                            op,
                            cause: CancelCause::Strategy(op),
                        },
                        io,
                    );
                }
                Intent::SplitPositions { size } => self.split(size, stamp, io),
                Intent::MergePositions { size } => self.merge(size, stamp, io),
            }
        }
    }

    /// The key a ts-compat `CancelOrder` binds to (TC-C5).
    fn bound_key<E: Execution>(
        &self,
        intents: &Intents,
        r: OrderRef,
        io: &mut OmIo<'_, E>,
    ) -> Option<OrderKey> {
        match r {
            OrderRef::Cid(c) => {
                let cid = io.cids.get(intents.cid_text(c))?;
                io.ledger.current(cid)
            }
            // TS keeps the given exchange id and cancels only when it names
            // the cid's resting order (`BacktestExecution.ts:647-686`): bind
            // the current key only when the id is that key.
            OrderRef::Both(c, x) => {
                let cid = io.cids.get(intents.cid_text(c))?;
                let k = io.ledger.current(cid)?;
                (x == ExchangeOrderId::Sim(k)).then_some(k)
            }
            OrderRef::Exchange(ExchangeOrderId::Sim(k)) => io.ledger.get(k).map(|r| r.key()),
            OrderRef::Exchange(ExchangeOrderId::Clob(_)) => None,
        }
    }

    // ------------------------------------------------------------------
    // Cancels (12 §7.3; `cancellation.ts:61-127`)
    // ------------------------------------------------------------------

    /// What realistic cancel resolution sees of a key (12 §7.3): the ledger
    /// record itself.
    fn visible_realistic(k: OrderKey, ledger: &Ledger) -> Visibility {
        let r = ledger.order(k);
        if r.state().is_terminal() {
            Visibility::Terminal
        } else {
            Visibility::Open {
                acked: r.acknowledged,
            }
        }
    }

    /// The TS portfolio view of one cid during this OM call (TC-C2 step 4;
    /// `OrderManager.ts:262-334`, `Portfolio.ts:593-878`), which ts-compat
    /// cancel resolution reads (12 §7.3, §15 "Cancel reference resolution";
    /// R5):
    ///
    /// - `open` (TS `openOrdersByClientId[cid]`): the generation emitted in
    ///   this call unless a synchronous terminal moved it to the history;
    ///   otherwise the latest delivered generation, unless it is terminal
    ///   (delivered or in this call) or its delivered fills reached its size
    ///   (12 §9.2, `Portfolio.ts:865-873`). `acked` when its exchange id is
    ///   known (delivered or in-call `OrderAccepted`).
    /// - `history` (TS `ordersByClientId[cid]`): the latest delivered
    ///   generation (or the in-call terminal one) and whether its lifecycle
    ///   is terminal there. A full fill never updates it, so a delivered,
    ///   fully filled, not yet terminal order is neither open nor known
    ///   terminal.
    fn ts_cid_view(&self, cid: Option<CidKey>, ledger: &Ledger) -> TsCidView {
        let Some(cid) = cid else {
            return TsCidView::default();
        };
        let call_terminal = |k: OrderKey| self.call.terminal.contains(&k);
        let acked = |k: OrderKey| ledger.order(k).acknowledged || self.call.accepted.contains(&k);
        let history = ledger.delivered_generation(cid).map(|d| TsHistory {
            key: d,
            terminal: ledger.order(d).state().is_terminal() || call_terminal(d),
            has_id: acked(d),
        });
        if let Some(cur) = ledger
            .current(cid)
            .filter(|k| self.call.emitted.contains(k))
        {
            if call_terminal(cur) {
                return TsCidView {
                    open: None,
                    history: Some(TsHistory {
                        key: cur,
                        terminal: true,
                        has_id: acked(cur),
                    }),
                };
            }
            return TsCidView {
                open: Some((cur, acked(cur))),
                history,
            };
        }
        let open = history
            .filter(|h| !h.terminal && !ledger.order(h.key).fully_filled())
            .map(|h| (h.key, h.has_id));
        TsCidView { open, history }
    }

    /// One ts-compat cancel reference resolved against the TS view, in the
    /// order of `resolveCancelBatch` (`cancellation.ts:61-127`; 12 §7.3,
    /// TC-C6, TC-C10; R5).
    fn resolve_ts_compat_ref<E: Execution>(
        &self,
        intents: &Intents,
        r: OrderRef,
        io: &OmIo<'_, E>,
    ) -> RefResolution {
        // `Some(None)`: a cid the session never interned (unknown).
        let cid: Option<Option<CidKey>> = r.cid().map(|c| io.cids.get(intents.cid_text(c)));
        // `Some(None)`: an exchange id naming no order of this session.
        let xk: Option<Option<OrderKey>> = r.exchange_id().map(|e| match e {
            ExchangeOrderId::Sim(k) => io.ledger.get(k).map(|r| r.key()),
            ExchangeOrderId::Clob(_) => None,
        });
        let ledger = &*io.ledger;
        let cid_view = self.ts_cid_view(cid.flatten(), ledger);
        let x_view = xk
            .flatten()
            .map(|k| (k, self.ts_cid_view(Some(ledger.order(k).cid()), ledger)));
        // `byExchange`: an open order of the view with that exchange id.
        let by_exchange = x_view.and_then(|(k, v)| (v.open == Some((k, true))).then_some(k));
        if let (Some(c), Some(bx)) = (cid, by_exchange) {
            if c != Some(ledger.order(bx).cid()) {
                return RefResolution::Fail(Some(bx), CancelFailReason::ConflictingRefs);
            }
        }
        let bot = cid_view.open.or(by_exchange.map(|k| (k, true)));
        let previous = match cid {
            Some(_) => cid_view.history,
            None => x_view.and_then(|(k, v)| v.history.filter(|h| h.key == k && h.has_id)),
        };
        let known_id = bot
            .filter(|b| b.1)
            .map(|b| b.0)
            .or(previous.filter(|h| h.has_id).map(|h| h.key));
        if let (Some(x), Some(kid)) = (xk, known_id) {
            if x != Some(kid) {
                return RefResolution::Fail(Some(kid), CancelFailReason::ConflictingRefs);
            }
        }
        if bot.is_none() && previous.is_some_and(|h| h.terminal) {
            // A known terminal order has no remainder to cancel.
            return RefResolution::Skip;
        }
        match bot {
            None if xk.is_none() => RefResolution::Fail(None, CancelFailReason::UnknownClientOrder),
            // TC-C6 (`cancellation.ts:114-118`).
            Some((k, false)) => {
                RefResolution::Fail(Some(k), CancelFailReason::MissingExchangeOrderId)
            }
            Some((k, true)) => RefResolution::Target(k),
            None => match (xk.flatten(), cid.map(|c| c.zip(xk.flatten()))) {
                // TS forwards the exchange id; its simulator cancels only the
                // cid's resting order with that id (`BacktestExecution.ts:647-660`).
                (Some(k), None) => RefResolution::Target(k),
                (Some(k), Some(Some((c, _)))) if ledger.order(k).cid() == c => {
                    RefResolution::Target(k)
                }
                // TC-C10: TS sends it and the simulator finds nothing.
                _ => RefResolution::Skip,
            },
        }
    }

    /// `CancelBatch` (and realistic `CancelOrder`) resolution (12 §7.3): cap,
    /// conflicting refs, known terminal skipped silently, unknown cid,
    /// unacknowledged target (realistic deferred, ts-compat
    /// `MissingExchangeOrderId`, TC-C6), duplicates removed.
    fn resolve_cancels<E: Execution>(
        &mut self,
        intents: &Intents,
        refs: &[OrderRef],
        op: CancelOp,
        stamp: TsMs,
        io: &mut OmIo<'_, E>,
    ) {
        let rules = io.config.core_rules;
        self.call.targets.clear();
        if refs.len() > rules.max_cancel_ids() as usize {
            io.push(
                stamp,
                AccountEventKind::CancelFailed {
                    op,
                    order: None,
                    reason: CancelFailReason::TooManyIds,
                },
            );
            return;
        }
        for &r in refs {
            let resolution = match rules {
                CoreRules::TsCompat => self.resolve_ts_compat_ref(intents, r, io),
                CoreRules::Realistic => self.resolve_realistic_ref(intents, r, op, io),
            };
            match resolution {
                RefResolution::Skip => {}
                RefResolution::Fail(order, reason) => {
                    io.push(stamp, AccountEventKind::CancelFailed { op, order, reason })
                }
                RefResolution::Target(k) => {
                    if !self.call.targets.contains(&k) {
                        self.call.targets.push(k);
                    }
                }
            }
        }
        if self.call.targets.is_empty() {
            return;
        }
        let keys = std::mem::take(&mut self.call.targets);
        for &k in &keys {
            io.ledger.request_cancel(k, CancelState::InFlight);
        }
        self.dispatch(
            stamp,
            ExecCommand::Cancel {
                op,
                cause: CancelCause::Strategy(op),
                keys: &keys,
            },
            io,
        );
        self.call.targets = keys;
    }

    /// One realistic cancel reference (12 §7.3): both refs must agree
    /// (10 N1); known terminal skipped silently; unknown cid; an
    /// unacknowledged target is deferred until its `OrderAccepted` is
    /// delivered ("never guess an unacknowledged exchange id").
    fn resolve_realistic_ref<E: Execution>(
        &mut self,
        intents: &Intents,
        r: OrderRef,
        op: CancelOp,
        io: &mut OmIo<'_, E>,
    ) -> RefResolution {
        let by_cid = r.cid().map(|c| {
            io.cids
                .get(intents.cid_text(c))
                .and_then(|c| io.ledger.current(c))
        });
        let by_exchange = r.exchange_id().map(|e| match e {
            ExchangeOrderId::Sim(k) => io.ledger.get(k).map(|r| r.key()),
            // D-PENDING: the core keeps no exchange-id side table before
            // the live adapter (M9); chose: a CLOB id resolves to nothing.
            ExchangeOrderId::Clob(_) => None,
        });
        let key = match (by_cid, by_exchange) {
            (Some(c), Some(x)) => {
                // 10 N1: both refs must agree.
                if c != x {
                    return RefResolution::Fail(c.or(x), CancelFailReason::ConflictingRefs);
                }
                c
            }
            (Some(c), None) => c,
            (None, Some(x)) => x,
            (None, None) => None,
        };
        let Some(k) = key else {
            if by_cid.is_some() {
                return RefResolution::Fail(None, CancelFailReason::UnknownClientOrder);
            }
            // D-PENDING: an exchange id with no known order cannot be
            // dispatched (commands carry keys, 13 §2.1); chose the answer
            // the exchange would give, `ExchangeNotCanceled`.
            return RefResolution::Fail(None, CancelFailReason::ExchangeNotCanceled { code: 0 });
        };
        self.target_realistic(k, op, CancelCause::Strategy(op), io)
    }

    /// A resolved realistic target (12 §7.3): terminal → skipped silently;
    /// unacknowledged → `CancelState::Deferred` with its cause, dispatched
    /// when the ack is delivered; acknowledged → dispatched.
    fn target_realistic<E: Execution>(
        &mut self,
        k: OrderKey,
        op: CancelOp,
        cause: CancelCause,
        io: &mut OmIo<'_, E>,
    ) -> RefResolution {
        match Self::visible_realistic(k, io.ledger) {
            Visibility::Terminal => RefResolution::Skip,
            Visibility::Open { acked: false } => {
                if !self.deferred.iter().any(|d| d.0 == k) {
                    io.ledger.request_cancel(k, CancelState::Deferred);
                    self.deferred.push((k, op, cause));
                }
                RefResolution::Skip
            }
            Visibility::Open { acked: true } => RefResolution::Target(k),
        }
    }

    fn cancel_batch<E: Execution>(
        &mut self,
        intents: &Intents,
        refs: &[OrderRef],
        stamp: TsMs,
        io: &mut OmIo<'_, E>,
    ) {
        let op = self.cancel_op(CancelKind::Batch);
        self.resolve_cancels(intents, refs, op, stamp, io);
    }

    fn cancel_scope<E: Execution>(
        &mut self,
        outcome: Option<Outcome>,
        stamp: TsMs,
        io: &mut OmIo<'_, E>,
    ) {
        let op = self.cancel_op(CancelKind::Market);
        let scope = match outcome {
            Some(o) => CancelScope::Outcome(o),
            None => CancelScope::Market,
        };
        self.dispatch(
            stamp,
            ExecCommand::CancelScope {
                op,
                cause: CancelCause::Strategy(op),
                scope,
            },
            io,
        );
    }

    // ------------------------------------------------------------------
    // Splits and merges (12 §7.3)
    // ------------------------------------------------------------------

    fn split<E: Execution>(&mut self, size: Qty, stamp: TsMs, io: &mut OmIo<'_, E>) {
        let op = self.op_key();
        let fail = |io: &mut OmIo<'_, E>, reason| {
            io.push(
                stamp,
                AccountEventKind::SplitFailed {
                    op,
                    requested: size,
                    reason,
                },
            );
        };
        // 12 §7.3: halt and guards first (12 §8.3: a kill switch blocks new
        // risk).
        if let Some(reason) = self.halt.split_reason() {
            fail(io, reason);
            return;
        }
        if !size.is_positive() {
            fail(io, SplitFailReason::InvalidSize);
            return;
        }
        if io.config.core_rules == CoreRules::Realistic
            && io.ledger.realized_pnl().micros() <= -io.config.risk.max_loss_stop.micros().abs()
        {
            // D-PENDING: 12 §7.3 blocks splits under the realistic loss stop,
            // but SplitFailReason has no risk variant; chose
            // `InsufficientCollateral`.
            fail(io, SplitFailReason::InsufficientCollateral);
            return;
        }
        let cost = Usdc::from_micros(size.micros());
        if cost > io.ledger.available() {
            fail(io, SplitFailReason::InsufficientCollateral);
            return;
        }
        io.ledger.add_pending_op(PendingOp {
            op,
            merge: false,
            size,
        });
        self.dispatch(stamp, ExecCommand::Split { op, size }, io);
    }

    fn merge<E: Execution>(&mut self, size: Qty, stamp: TsMs, io: &mut OmIo<'_, E>) {
        if !size.is_positive() {
            // TC-C7: ts-compat drops it silently (`OrderManager.ts:411`).
            if io.config.core_rules == CoreRules::Realistic {
                let op = self.op_key();
                io.push(
                    stamp,
                    AccountEventKind::MergeFailed {
                        op,
                        requested: size,
                        reason: MergeFailReason::InvalidSize,
                    },
                );
            }
            return;
        }
        let op = self.op_key();
        let clamped = size
            .min(io.ledger.mergeable(Outcome::Up))
            .min(io.ledger.mergeable(Outcome::Down));
        if !clamped.is_positive() {
            io.push(
                stamp,
                AccountEventKind::MergeFailed {
                    op,
                    requested: size,
                    reason: MergeFailReason::InsufficientPairs,
                },
            );
            return;
        }
        io.ledger.add_pending_op(PendingOp {
            op,
            merge: true,
            size: clamped,
        });
        self.dispatch(stamp, ExecCommand::Merge { op, size: clamped }, io);
    }

    // ------------------------------------------------------------------
    // Realistic (12 §7.2 first principles, §7.4, §7.5, §8.1)
    // ------------------------------------------------------------------

    fn handle_realistic<E: Execution>(
        &mut self,
        intents: &Intents,
        stamp: TsMs,
        io: &mut OmIo<'_, E>,
    ) {
        for intent in intents.core().iter() {
            match intent {
                Intent::PlaceLimit(_) | Intent::PlaceBatch(_) => {
                    self.scratch.clear();
                    let orders = intent.orders();
                    let rules = io.rules();
                    if let Err(v) = rules.check_batch_len(orders.len()) {
                        // 12 §7.3: over the cap every order is rejected and
                        // nothing is dispatched.
                        for local in orders {
                            let req = Self::session_request(intents, local, io);
                            Self::reject(io, stamp, req.cid, violation_reason(v));
                        }
                        continue;
                    }
                    for local in orders {
                        if let Some(k) = self.place_realistic(intents, local, stamp, io) {
                            self.scratch.push(k);
                        }
                    }
                    self.dispatch_place(stamp, io);
                }
                Intent::CancelOrder(r) => {
                    let op = self.cancel_op(CancelKind::Order);
                    self.resolve_cancels(intents, &[r], op, stamp, io);
                }
                Intent::CancelBatch(refs) => self.cancel_batch(intents, refs, stamp, io),
                Intent::CancelMarket(o) => self.cancel_scope(o, stamp, io),
                Intent::CancelAll => {
                    let op = self.cancel_op(CancelKind::All);
                    self.dispatch(
                        stamp,
                        ExecCommand::CancelAll {
                            op,
                            cause: CancelCause::Strategy(op),
                        },
                        io,
                    );
                }
                Intent::SplitPositions { size } => self.split(size, stamp, io),
                Intent::MergePositions { size } => self.merge(size, stamp, io),
            }
        }
    }

    /// One realistic placement (12 §7.2): halt → dedupe → validation → risk →
    /// funding → accept.
    fn place_realistic<E: Execution>(
        &mut self,
        intents: &Intents,
        local: &OrderRequest,
        stamp: TsMs,
        io: &mut OmIo<'_, E>,
    ) -> Option<OrderKey> {
        let mut req = Self::session_request(intents, local, io);
        if let Some(reason) = self.halt.reject_reason() {
            Self::reject(io, stamp, req.cid, reason);
            return None;
        }
        if io.ledger.cid_active(req.cid) {
            self.counters.duplicate_active_cid += 1;
            return None;
        }
        let rules = io.rules();
        // 10 §7.2 O2: a share-sized market BUY becomes collateral-sized.
        let amount_dp = tick_decimals(rules.tick[req.outcome]).map_or(6, |d| d.amount_dp as u32);
        req = req
            .to_collateral_sized(amount_dp)
            .expect("collateral conversion overflow (10 T3)");
        let checked = self
            .validate(&req, stamp, io.market, io.config)
            .and_then(|()| Self::store_meta(intents, local, io))
            .and_then(|meta| {
                req.meta = meta;
                Self::risk_realistic(&req, io)
            })
            .and_then(|()| Self::fund_realistic(&req, &rules, io));
        if let Err(reason) = checked {
            Self::reject(io, stamp, req.cid, reason);
            return None;
        }
        Some(self.accept(req, stamp, &rules, io))
    }

    /// Realistic risk limits (12 §8.1), against the ledger as it stands.
    fn risk_realistic<E: Execution>(
        req: &OrderRequest,
        io: &mut OmIo<'_, E>,
    ) -> Result<(), RejectReason> {
        let lim = io.config.risk;
        let realized = io.ledger.realized_pnl();
        if req.side == Side::Buy && realized.micros() <= -lim.max_loss_stop.micros().abs() {
            return Err(RejectReason::RiskLossStop { realized });
        }
        let shares = match req.size {
            OrderSize::Shares(q) => q,
            OrderSize::Collateral(a) => Qty::for_collateral(a, req.price, pmb_core::Rounding::Ceil)
                .map_err(|_| RejectReason::InvalidSize)?,
        };
        if shares > lim.max_order_size {
            return Err(RejectReason::RiskMaxOrderSize {
                max: lim.max_order_size,
            });
        }
        let (open, buys) = io.ledger.nonterminal_exposure();
        if open + 1 > lim.max_open_orders {
            return Err(RejectReason::RiskMaxOpenOrders {
                max: lim.max_open_orders,
            });
        }
        if req.side == Side::Buy {
            let projected = io.ledger.position(req.outcome).qty + buys[req.outcome] + shares;
            if projected > lim.max_abs_position {
                return Err(RejectReason::RiskMaxAbsPosition {
                    max: lim.max_abs_position,
                });
            }
        }
        Ok(())
    }

    /// Realistic funding (12 §7.5): BUY reservation ≤ available; SELL size ≤
    /// sellable.
    fn fund_realistic<E: Execution>(
        req: &OrderRequest,
        rules: &ExchangeRules,
        io: &mut OmIo<'_, E>,
    ) -> Result<(), RejectReason> {
        match req.side {
            Side::Buy => {
                let required = io
                    .ledger
                    .reservation_for(req, rules)
                    .map_err(|_| RejectReason::InvalidSize)?;
                let available = io.ledger.available();
                if required > available {
                    return Err(insufficient_capital(required, available));
                }
            }
            Side::Sell => {
                let need = shares_of(req).unwrap_or(Qty::ZERO);
                let have = io.ledger.sellable(req.outcome);
                if need > have {
                    return Err(RejectReason::InsufficientInventory {
                        required: need,
                        available: have,
                    });
                }
            }
        }
        Ok(())
    }

    /// Validation of one placement (12 §7.4) against the rules in force and
    /// `xnow` (12 §4.4); `Err` is the reject reason. Order meta size is
    /// checked separately when the meta is stored.
    pub fn validate(
        &self,
        req: &OrderRequest,
        stamp: TsMs,
        market: &SharedMarket,
        config: &EngineConfig,
    ) -> Result<(), RejectReason> {
        // TC-C1: the ts-compat validation subset.
        if config.core_rules == CoreRules::TsCompat {
            return Self::validate_ts_compat(req, stamp);
        }
        let rules = market.rules;
        if !req.size.is_positive() {
            return Err(RejectReason::InvalidSize);
        }
        if req.post_only && !req.order_type.allows_post_only() {
            return Err(RejectReason::PostOnlyRequiresResting);
        }
        if req.order_type == pmb_core::OrderType::Gtd && req.expire_at_ms.is_none() {
            return Err(RejectReason::GtdRequiresExpiry);
        }
        rules
            .check_gtd_lead(req, market.exchange_time(stamp))
            .map_err(violation_reason)?;
        rules.check_order(req).map_err(violation_reason)?;
        if stamp >= market.window().end_ms {
            return Err(RejectReason::MarketClosed);
        }
        if let Some(resting) = self
            .self_cross
            .would_cross(req.outcome, req.side, req.price)
        {
            return Err(RejectReason::SelfCross { resting });
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Engine intents and delivery processing
    // ------------------------------------------------------------------

    /// Handles one engine-originated intent (12 §8.3, §10).
    pub fn handle_engine<E: Execution>(
        &mut self,
        intent: EngineIntent,
        stamp: TsMs,
        io: OmIo<'_, E>,
    ) {
        let mut io = io;
        self.call.clear();
        match intent {
            EngineIntent::CancelMarket { scope, cause } => {
                let op = self.cancel_op(CancelKind::Market);
                self.dispatch(
                    stamp,
                    ExecCommand::CancelScope { op, cause, scope },
                    &mut io,
                );
            }
            EngineIntent::CancelAll { cause } => {
                let op = self.cancel_op(CancelKind::All);
                self.dispatch(stamp, ExecCommand::CancelAll { op, cause }, &mut io);
            }
            EngineIntent::CancelCid { cid, cause } => {
                let Some(key) = io.ledger.current(cid) else {
                    return;
                };
                let op = self.cancel_op(CancelKind::Order);
                if let RefResolution::Target(k) = self.target_realistic(key, op, cause, &mut io) {
                    io.ledger.request_cancel(k, CancelState::InFlight);
                    self.dispatch(
                        stamp,
                        ExecCommand::Cancel {
                            op,
                            cause,
                            keys: &[k],
                        },
                        &mut io,
                    );
                }
            }
        }
    }

    /// Post-delivery processing of one event, after the ledger applied it
    /// (12 §6.2): cid release (12 §7.6), deferred cancel release on
    /// `OrderAccepted` (12 §7.3), self-cross index maintenance (12 §7.4).
    pub fn on_delivered<E: Execution>(
        &mut self,
        ev: &AccountEvent,
        effect: Delivered,
        now: TsMs,
        io: OmIo<'_, E>,
    ) {
        let mut io = io;
        let realistic = io.config.core_rules == CoreRules::Realistic;
        if let Some(k) = effect.terminal {
            // A deferred cancel whose target became terminal resolves silently.
            self.deferred.retain(|d| d.0 != k);
        }
        if effect.releases_cid {
            if let Some(k) = effect.terminal.or(ev.kind.order()) {
                io.ledger.set_om_terminal(k);
            }
        }
        if realistic && (effect.terminal.is_some() || effect.cancel_acked.is_some()) {
            self.self_cross.rebuild(io.ledger);
        }
        if let Some(k) = effect.acknowledged {
            if let Some(i) = self.deferred.iter().position(|d| d.0 == k) {
                let (k, op, cause) = self.deferred.remove(i);
                io.ledger.request_cancel(k, CancelState::InFlight);
                self.call.clear();
                self.dispatch(
                    now,
                    ExecCommand::Cancel {
                        op,
                        cause,
                        keys: &[k],
                    },
                    &mut io,
                );
            }
        }
    }

    /// Raises the halt state (12 §11, §8.3); a halt never downgrades.
    pub fn set_halt(&mut self, h: Halt) {
        if h.rank() > self.halt.rank() {
            self.halt = h;
        }
    }

    /// The halt state.
    pub fn halt(&self) -> Halt {
        self.halt
    }

    /// Counters.
    pub fn counters(&self) -> &OmCounters {
        &self.counters
    }
}

/// What realistic cancel resolution can see of a key (12 §7.3).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Visibility {
    /// Open; `acked` when its exchange id is known.
    Open { acked: bool },
    /// Terminal.
    Terminal,
}

/// The outcome of resolving one cancel reference (12 §7.3).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum RefResolution {
    /// No event, no target (known terminal, deferred, or TC-C10).
    Skip,
    /// `CancelFailed` with this order and reason.
    Fail(Option<OrderKey>, CancelFailReason),
    /// A key to dispatch.
    Target(OrderKey),
}

/// The TS history entry of a cid (`ordersByClientId[cid]`).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
struct TsHistory {
    key: OrderKey,
    /// Lifecycle terminal in the TS history.
    terminal: bool,
    /// Its exchange id is known (`orderId` present).
    has_id: bool,
}

/// The TS view of one cid during an OM call (see `ts_cid_view`).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
struct TsCidView {
    /// `openOrdersByClientId[cid]`: key and whether its exchange id is known.
    open: Option<(OrderKey, bool)>,
    /// `ordersByClientId[cid]`.
    history: Option<TsHistory>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_om_is_running_with_zero_counters() {
        // spec: 12 §7.6 (a new session starts with no active cids), 12 §14 P12
        let mut om = OrderManager::new();
        assert_eq!(om.halt, Halt::Running);
        assert_eq!(om.counters().duplicate_active_cid, 0);
        om.set_halt(Halt::KillSwitch);
        assert_eq!(om.halt, Halt::KillSwitch);
    }

    #[test]
    fn self_cross_index_four_comparisons() {
        // spec: 12 §7.4 self-cross block, 10 N6
        let p = Price::from_micros;
        let mut ix = SelfCrossIndex::default();
        ix.add(Outcome::Up, Side::Sell, p(550_000), OrderKey::new(1));
        ix.add(Outcome::Down, Side::Buy, p(400_000), OrderKey::new(2));
        // Direct: BUY Up at ≥ own SELL Up.
        assert_eq!(
            ix.would_cross(Outcome::Up, Side::Buy, p(550_000)),
            Some(OrderKey::new(1))
        );
        // Mint: BUY Up + own BUY Down ≥ 1 (checked after the direct case).
        assert_eq!(ix.would_cross(Outcome::Up, Side::Buy, p(540_000)), None);
        let mut ix2 = SelfCrossIndex::default();
        ix2.add(Outcome::Down, Side::Buy, p(400_000), OrderKey::new(2));
        assert_eq!(
            ix2.would_cross(Outcome::Up, Side::Buy, p(600_000)),
            Some(OrderKey::new(2))
        );
        // Direct SELL vs own BUY on the same outcome.
        assert_eq!(
            ix2.would_cross(Outcome::Down, Side::Sell, p(400_000)),
            Some(OrderKey::new(2))
        );
        assert_eq!(ix2.would_cross(Outcome::Down, Side::Sell, p(410_000)), None);
        // Merge: SELL Up + own SELL Down ≤ 1.
        let mut ix3 = SelfCrossIndex::default();
        ix3.add(Outcome::Down, Side::Sell, p(450_000), OrderKey::new(3));
        assert_eq!(
            ix3.would_cross(Outcome::Up, Side::Sell, p(550_000)),
            Some(OrderKey::new(3))
        );
        assert_eq!(ix3.would_cross(Outcome::Up, Side::Sell, p(560_000)), None);
    }

    #[test]
    fn ts_compat_validation_order_and_reasons() {
        // spec: 12 §7.4 ts-compat column (TC-C1; `OrderManager.ts:756-780`)
        let base = OrderRequest::gtc(
            CidKey::new(0),
            Outcome::Up,
            Side::Buy,
            Price::from_micros(500_000),
            Qty::from_micros(1_000_000),
        );
        let v = |r: OrderRequest| OrderManager::validate_ts_compat(&r, TsMs(1_000));
        assert_eq!(v(base), Ok(()));
        let mut r = base;
        r.price = Price::ZERO;
        r.size = OrderSize::Shares(Qty::ZERO);
        assert_eq!(v(r), Err(RejectReason::InvalidPrice));
        r.price = base.price;
        assert_eq!(v(r), Err(RejectReason::InvalidSize));
        let mut r = base;
        r.order_type = pmb_core::OrderType::Fok;
        r.post_only = true;
        assert_eq!(v(r), Err(RejectReason::PostOnlyRequiresResting));
        let mut r = base;
        r.order_type = pmb_core::OrderType::Gtd;
        assert_eq!(v(r), Err(RejectReason::GtdRequiresExpiry));
        r.expire_at_ms = Some(TsMs(60_999));
        assert_eq!(
            v(r),
            Err(RejectReason::GtdExpiryTooSoon {
                min_offset_ms: 60_000
            })
        );
        r.expire_at_ms = Some(TsMs(61_000));
        assert_eq!(v(r), Ok(()));
        // `expire_at` on a non-GTD order is ignored.
        let mut r = base;
        r.expire_at_ms = Some(TsMs(0));
        assert_eq!(v(r), Ok(()));
    }
}
