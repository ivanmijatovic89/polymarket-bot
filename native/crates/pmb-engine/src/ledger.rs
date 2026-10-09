//! The session ledger (12 §9): the only store of orders, fills, positions,
//! cash and reservations.
//!
//! Engine commands (submission, cancel request, split and merge requests)
//! apply when the OM emits them; exchange-originated events apply when they
//! are delivered from the cascade queue (12 §9.1). There is no second cash
//! book, no pending-capital overlay and no set of unapplied submissions (R4).
//!
//! Order records are the author-facing `OrderView` of 30 §5.2: their fields
//! are crate-private and the author sees accessor methods only (30 P1). The
//! simulator reads the immutable request of a record (13 §2.1) through
//! [`OrderRecord::request`].

use pmb_core::event::{AccountEvent, AccountEventKind, DoneReason, RejectReason};
use pmb_core::fill::{Capital, Fill, Position, SettlementStatus};
use pmb_core::fixed::{mul_div, Overflow};
use pmb_core::ids::{CidKey, FillKey, OpKey, OrderKey};
use pmb_core::order::{OrderRequest, OrderSize, OrderType, Side};
use pmb_core::rules::{buy_reservation, ExchangeRules, FeeCurve};
use pmb_core::state::{transition, CancelState, IllegalTransition, OrderState, StateInput};
use pmb_core::{FinalOutcome, Outcome, PerOutcome, Price, Qty, Rounding, TsMs, Usdc};

use crate::core_rules::CoreRules;

/// Signed exchange amounts of an order (realistic, 11 TK4), fixed at
/// emission: maker and taker amounts in base units.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct SignedAmounts {
    /// `makerAmount` in 1e-6 units.
    pub maker: i64,
    /// `takerAmount` in 1e-6 units.
    pub taker: i64,
}

/// One submission (one `OrderKey`, 12 §9.2): the immutable request plus the
/// client knowledge built from delivered events. This is the author-facing
/// `OrderView` (30 §5.2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrderRecord {
    pub(crate) key: OrderKey,
    /// Immutable request; the simulator reads details from here (13 §2.1).
    pub(crate) req: OrderRequest,
    /// Decision stamp (12 §4.2).
    pub(crate) created_at: TsMs,
    /// Realistic signed amounts (11 TK4); `None` in ts-compat.
    pub(crate) signed: Option<SignedAmounts>,
    pub(crate) state: OrderState,
    pub(crate) cancel: CancelState,
    /// `OrderSubmitted` delivered: the order is in the strategy's open orders
    /// (12 §9.2).
    pub(crate) submitted_delivered: bool,
    /// `OrderAccepted` delivered (12 §7.3 deferred cancels).
    pub(crate) acknowledged: bool,
    /// Cid released for dedupe (12 §7.6).
    pub(crate) om_terminal: bool,
    /// Delivered filled quantity (shares).
    pub(crate) filled: Qty,
    /// Delivered spend of a collateral-sized BUY (realistic, 12 §9.4).
    pub(crate) spent: Usdc,
    /// Authoritative final quantity, once known (12 §9.4).
    pub(crate) final_qty: Option<Qty>,
    /// Highest settlement status delivered (10 §9.2 rank; `Retrying` keeps
    /// the rank).
    pub(crate) settlement: Option<SettlementStatus>,
    /// BUY cash reservation currently held (12 §9.4).
    pub(crate) reserved: Usdc,
    /// SELL shares currently reserved (realistic, 12 §9.3).
    pub(crate) reserved_shares: Qty,
    /// Last `FillKey.seq` used (starts at 1 per order, 10 §6).
    pub(crate) fill_seq: u32,
    /// Fee curve of the reservation formula, fixed at emission (10 §9.4 C1).
    pub(crate) res_fee: FeeCurve,
    /// Lowest reachable fill price of the reservation formula: the tick in
    /// force at emission (10 §9.4 C1).
    pub(crate) res_lo: Price,
}

impl OrderRecord {
    /// Engine key of this submission (10 §6).
    #[inline]
    pub fn key(&self) -> OrderKey {
        self.key
    }
    /// Interned client order id; resolve it with
    /// [`crate::strategy::PortfolioView::cid_str`] (30 §5.2).
    #[inline]
    pub fn cid(&self) -> CidKey {
        self.req.cid
    }
    /// Outcome (30 §5.2).
    #[inline]
    pub fn outcome(&self) -> Outcome {
        self.req.outcome
    }
    /// Side (30 §5.2).
    #[inline]
    pub fn side(&self) -> Side {
        self.req.side
    }
    /// Limit price, or the worst price of a market order (30 §5.2).
    #[inline]
    pub fn price(&self) -> Price {
        self.req.price
    }
    /// Requested size (30 §5.2, 10 §7.2).
    #[inline]
    pub fn size(&self) -> OrderSize {
        self.req.size
    }
    /// Delivered filled quantity (30 §5.2).
    #[inline]
    pub fn filled(&self) -> Qty {
        self.filled
    }
    /// Remaining shares (30 §5.2): `max(0, size − filled)` for a share-sized
    /// order; for a collateral-sized BUY the unspent amount converted at the
    /// limit price, rounded down.
    // D-PENDING: 30 §5.2 `remaining` of a collateral-sized BUY is unspecified;
    // chose the unspent amount converted at the limit price (`Floor`).
    pub fn remaining(&self) -> Qty {
        match self.req.size {
            OrderSize::Shares(q) => (q - self.filled).max(Qty::ZERO),
            OrderSize::Collateral(a) => {
                let left = (a - self.spent).max(Usdc::ZERO);
                Qty::for_collateral(left, self.req.price, Rounding::Floor).unwrap_or(Qty::ZERO)
            }
        }
    }
    /// Order type (30 §5.2).
    #[inline]
    pub fn order_type(&self) -> OrderType {
        self.req.order_type
    }
    /// Post-only flag (30 §5.2).
    #[inline]
    pub fn post_only(&self) -> bool {
        self.req.post_only
    }
    /// Lifecycle state (10 §8, 30 §5.2).
    #[inline]
    pub fn state(&self) -> OrderState {
        self.state
    }
    /// Cancel state, orthogonal to the lifecycle (10 §8.1).
    #[inline]
    pub fn cancel_state(&self) -> CancelState {
        self.cancel
    }
    /// Highest delivered settlement status (30 §5.2).
    #[inline]
    pub fn settlement(&self) -> Option<SettlementStatus> {
        self.settlement
    }
    /// Decision stamp (30 §5.2 `created_at`).
    #[inline]
    pub fn created_at(&self) -> TsMs {
        self.created_at
    }
    /// Stated GTD expiry (30 §5.2 `expire_at`); `None` for other types.
    #[inline]
    pub fn expire_at(&self) -> Option<TsMs> {
        self.req.gtd_expiry()
    }
    /// Whether the delivered settlement rank reaches `s` (30 §5.2, replaces
    /// TS `isOrderTradeStatusAtLeast`). `Retrying` and `Failed` have no rank
    /// and are never reached.
    pub fn settled_at_least(&self, s: SettlementStatus) -> bool {
        match (self.settlement.and_then(SettlementStatus::rank), s.rank()) {
            (Some(have), Some(want)) => have >= want,
            _ => false,
        }
    }
    /// TS lifecycle string (10 §8.4, 30 §5.2).
    #[inline]
    pub fn ts_state(&self) -> &'static str {
        self.state.ts_state(self.filled.is_positive())
    }
    /// The immutable request (13 §2.1: the simulator reads side, type, price,
    /// size, post-only and expiry from here).
    #[inline]
    pub fn request(&self) -> &OrderRequest {
        &self.req
    }
    /// Realistic signed amounts (11 TK4).
    #[inline]
    pub fn signed_amounts(&self) -> Option<SignedAmounts> {
        self.signed
    }
    /// Delivered fills reached the order size (12 §7.6 item 3, §9.2): the
    /// order leaves the open orders (`Portfolio.ts:844-878`).
    #[inline]
    pub fn fully_filled(&self) -> bool {
        match self.req.size {
            OrderSize::Shares(q) => self.filled >= q,
            OrderSize::Collateral(a) => self.spent >= a,
        }
    }
    /// BUY cash reservation currently held by this order (12 §9.4).
    #[inline]
    pub fn reserved(&self) -> Usdc {
        self.reserved
    }
    /// Strategy-view open order: `OrderSubmitted` delivered, non-terminal and
    /// not fully filled (12 §9.2, §9.7).
    #[inline]
    pub fn is_open(&self) -> bool {
        self.submitted_delivered && !self.state.is_terminal() && !self.fully_filled()
    }
}

/// A pending split or merge (12 §9.4).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct PendingOp {
    /// Operation key (10 §6).
    pub op: OpKey,
    /// `true` for a merge, `false` for a split.
    pub merge: bool,
    /// Full sets.
    pub size: Qty,
}

/// Ledger diagnostics (21 §10 `anomalies`; 12 §9.3, §9.4, §9.5).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct LedgerCounters {
    /// ts-compat naked-sell excess in micros (12 §9.5, TC-C4).
    pub oversold_qty: i64,
    /// Per-fill fee dust charged beyond the reservation, micros (10 §9.4 C1).
    pub reservation_dust: i64,
    /// Reversal excess clamped at zero, micros (12 §9.3).
    pub reversal_deficit: i64,
}

/// What a delivered event did, for the OM's post-delivery processing
/// (12 §6.2: ledger → OM → trace → strategy).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct Delivered {
    /// The event is the order's terminal event, or its delivered fills
    /// reached the order size (cid release, 12 §7.6 items 2–3).
    pub releases_cid: bool,
    /// The event acknowledged the order (deferred cancel release, 12 §7.3).
    pub acknowledged: Option<OrderKey>,
    /// The order became terminal (self-cross index, deferred cancels;
    /// 12 §7.3, §7.4).
    pub terminal: Option<OrderKey>,
    /// The exchange acknowledged a cancel of this order (12 §7.4).
    pub cancel_acked: Option<OrderKey>,
    /// The event was a `CancelAcked` for an order already terminal: recorded,
    /// not delivered to the strategy (10 §8.2).
    pub suppress_callback: bool,
}

/// A delivered event the ledger cannot apply: an adapter contract violation
/// or a ledger invariant violation, i.e. an `engine_fault` (12 §9.8, §11).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LedgerError {
    /// The event names an order key the ledger never issued (13 X3).
    UnknownOrder(OrderKey),
    /// The event names an operation key with no pending operation.
    UnknownOp(OpKey),
    /// The lifecycle input is not allowed from the current state (10 §8.2).
    Transition(IllegalTransition),
    /// `FillKey.seq` did not strictly increase (10 §6).
    FillSeq(FillKey),
    /// Delivered filled exceeds the size or the authoritative final quantity
    /// (12 §9.8 item 3).
    Overfill(OrderKey),
    /// A second terminal event for one key (10 S1).
    SecondTerminal(OrderKey),
    /// Fixed-point overflow in engine arithmetic (10 T3).
    Overflow,
}

impl From<Overflow> for LedgerError {
    fn from(_: Overflow) -> Self {
        LedgerError::Overflow
    }
}

impl std::fmt::Display for LedgerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LedgerError::UnknownOrder(k) => write!(f, "delivered event for unknown order {k}"),
            LedgerError::UnknownOp(k) => write!(f, "delivered event for unknown op {k}"),
            LedgerError::Transition(t) => write!(f, "{t}"),
            LedgerError::FillSeq(k) => {
                write!(f, "fill seq {} of order {} not increasing", k.seq, k.order)
            }
            LedgerError::Overfill(k) => write!(f, "order {k} filled beyond its size"),
            LedgerError::SecondTerminal(k) => write!(f, "second terminal event for order {k}"),
            LedgerError::Overflow => f.write_str("fixed-point overflow in the ledger"),
        }
    }
}

/// What one delivered fill did to the ledger, kept so a `Failed` settlement
/// can reverse it exactly (10 F1, 12 §9.3).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
struct FillEffect {
    /// Signed cash delta, fee included.
    cash: Usdc,
    /// Signed position delta applied (after the TC-C4 clamp).
    qty: Qty,
    /// Signed basis delta.
    basis: Usdc,
    /// Realized PnL delta.
    realized: Usdc,
    /// Notional moved (spend of a collateral-sized BUY).
    notional: Usdc,
    /// Per-fill settlement status (10 §9.2); a delivered fill starts MATCHED.
    status: SettlementStatus,
    reversed: bool,
}

/// The session ledger (12 §9).
#[derive(Clone, Debug)]
pub struct Ledger {
    pub(crate) rules: CoreRules,
    /// Order slab indexed by `OrderKey` (10 P2), in submission order.
    pub(crate) orders: Vec<OrderRecord>,
    /// Non-terminal keys in submission order (12 §13 item 1).
    pub(crate) active: Vec<OrderKey>,
    /// cid → current generation; lookup only, never iterated (12 §7.1).
    pub(crate) current: Vec<Option<OrderKey>>,
    pub(crate) positions: PerOutcome<Position>,
    pub(crate) starting: Usdc,
    pub(crate) cash: Usdc,
    pub(crate) reserved: Usdc,
    pub(crate) realized: Usdc,
    pub(crate) split_cost: Usdc,
    pub(crate) fees_paid: Usdc,
    /// Every session fill in delivery order, lossless (12 §9.7).
    pub(crate) fills: Vec<Fill>,
    /// Parallel to `fills`.
    effects: Vec<FillEffect>,
    /// Pending splits and merges (12 §9.4).
    pub(crate) pending_ops: Vec<PendingOp>,
    /// Shares of each outcome reserved by pending merges (12 §9.4).
    pending_merge: Qty,
    /// Realistic: delivered BUY shares whose fill status is below the sell
    /// gate (12 §9.3).
    unsettled: PerOutcome<Qty>,
    /// Realistic: shares reserved by open SELL orders (10 §9.4 C2).
    reserved_sell: PerOutcome<Qty>,
    /// Realistic sell gate (13 §7.3 `sellGate`).
    sell_gate: SettlementStatus,
    /// Live and paper capital cap (12 §9.4, D31).
    pub(crate) cap: Option<Usdc>,
    /// Adopted read-only shares (12 §10, D29).
    pub(crate) adopted: PerOutcome<Qty>,
    pub(crate) counters: LedgerCounters,
}

#[inline]
fn notional_mode(rules: CoreRules, side: Side) -> Rounding {
    // 10 §3.3 R5, R6: realistic BUY Ceil, SELL Floor; ts-compat HalfAwayFromZero.
    match (rules, side) {
        (CoreRules::TsCompat, _) => Rounding::HalfAwayFromZero,
        (CoreRules::Realistic, Side::Buy) => Rounding::Ceil,
        (CoreRules::Realistic, Side::Sell) => Rounding::Floor,
    }
}

impl Ledger {
    /// An empty ledger with the per-market allowance (12 §9.4).
    pub fn new(rules: CoreRules, starting: Usdc) -> Ledger {
        Ledger {
            rules,
            orders: Vec::new(),
            active: Vec::new(),
            current: Vec::new(),
            positions: PerOutcome::default(),
            starting,
            cash: starting,
            reserved: Usdc::ZERO,
            realized: Usdc::ZERO,
            split_cost: Usdc::ZERO,
            fees_paid: Usdc::ZERO,
            fills: Vec::new(),
            effects: Vec::new(),
            pending_ops: Vec::new(),
            pending_merge: Qty::ZERO,
            unsettled: PerOutcome::default(),
            reserved_sell: PerOutcome::default(),
            // D-PENDING: the realistic `execution.sellGate` is resolved in M3b
            // (D57); chose its documented default `Mined` (12 §9.3) until then.
            sell_gate: SettlementStatus::Mined,
            cap: None,
            adopted: PerOutcome::default(),
            counters: LedgerCounters::default(),
        }
    }

    /// Sets the realistic sell gate (13 §7.3 `sellGate`; 12 §9.3).
    pub fn with_sell_gate(mut self, gate: SettlementStatus) -> Ledger {
        self.sell_gate = gate;
        self
    }

    /// The rule set of this ledger.
    #[inline]
    pub fn core_rules(&self) -> CoreRules {
        self.rules
    }

    /// The record of a key (O(1), 12 §14 P8).
    #[inline]
    pub fn order(&self, k: OrderKey) -> &OrderRecord {
        &self.orders[k.index()]
    }

    /// The record of a key, if it was issued.
    #[inline]
    pub fn get(&self, k: OrderKey) -> Option<&OrderRecord> {
        self.orders.get(k.index())
    }

    /// Every record in submission order (30 §5.2 `orders()`).
    #[inline]
    pub fn orders(&self) -> &[OrderRecord] {
        &self.orders
    }

    /// Strategy-view open orders in submission order (12 §9.7).
    pub fn open_orders(&self) -> impl Iterator<Item = &OrderRecord> + '_ {
        self.active
            .iter()
            .map(|k| &self.orders[k.index()])
            .filter(|o| o.is_open())
    }

    /// Non-terminal keys in submission order (12 §13 item 1); the simulator's
    /// scope resolution reads its own exchange truth instead (13 §4.1).
    #[inline]
    pub fn active_keys(&self) -> &[OrderKey] {
        &self.active
    }

    /// Current generation of a cid (12 §7.1).
    #[inline]
    pub fn current(&self, cid: CidKey) -> Option<OrderKey> {
        self.current.get(cid.index()).copied().flatten()
    }

    /// A cid is active iff its current key exists and is not `om_terminal`
    /// (12 §7.6).
    #[inline]
    pub fn cid_active(&self, cid: CidKey) -> bool {
        self.current(cid)
            .is_some_and(|k| !self.orders[k.index()].om_terminal)
    }

    /// Position of an outcome (12 §9.5).
    #[inline]
    pub fn position(&self, o: Outcome) -> Position {
        self.positions[o]
    }

    /// Capital view `{starting, cash, reserved}` (12 §9.7).
    #[inline]
    pub fn capital(&self) -> Capital {
        Capital {
            starting: self.starting,
            cash: self.cash,
            reserved: self.reserved,
        }
    }

    /// `available = cash − reservations`, capped by the live `CapitalCap`
    /// (12 §9.4).
    pub fn available(&self) -> Usdc {
        let a = self.cash - self.reserved;
        match self.cap {
            Some(c) if c < a => c,
            _ => a,
        }
    }

    /// Sets the live and paper capital cap (12 §9.4, `Control(CapitalCap)`).
    pub fn set_cap(&mut self, cap: Usdc) {
        self.cap = Some(cap);
    }

    /// Realized PnL, one session total (12 §9.5).
    #[inline]
    pub fn realized_pnl(&self) -> Usdc {
        self.realized
    }

    /// Σ split collateral (12 §9.5).
    #[inline]
    pub fn split_cost(&self) -> Usdc {
        self.split_cost
    }

    /// Σ `fill.fee` of non-reversed fills (12 §9.5).
    #[inline]
    pub fn fees_paid(&self) -> Usdc {
        self.fees_paid
    }

    /// Every session fill in delivery order (12 §9.7).
    #[inline]
    pub fn fills(&self) -> &[Fill] {
        &self.fills
    }

    /// Whether the `i`-th fill was reversed by a `Failed` settlement (10 F1).
    #[inline]
    pub fn fill_reversed(&self, i: usize) -> bool {
        self.effects[i].reversed
    }

    /// Diagnostics counters.
    #[inline]
    pub fn counters(&self) -> LedgerCounters {
        self.counters
    }

    /// Pending splits and merges (12 §9.4).
    #[inline]
    pub fn pending_ops(&self) -> &[PendingOp] {
        &self.pending_ops
    }

    /// `sellable(o)` (12 §9.3): realistic settled, unreserved shares;
    /// ts-compat the delivered quantity (30 §5.2).
    pub fn sellable(&self, o: Outcome) -> Qty {
        let q = self.positions[o].qty;
        match self.rules {
            CoreRules::TsCompat => q,
            CoreRules::Realistic => (q
                - self.unsettled[o]
                - self.reserved_sell[o]
                - self.pending_merge
                - self.adopted[o])
                .max(Qty::ZERO),
        }
    }

    /// `mergeable(o)` (12 §7.3): realistic `sellable(o)`; ts-compat delivered
    /// quantity minus pending merges (`OrderManager.ts:412-431`).
    pub fn mergeable(&self, o: Outcome) -> Qty {
        match self.rules {
            CoreRules::TsCompat => (self.positions[o].qty - self.pending_merge).max(Qty::ZERO),
            CoreRules::Realistic => self.sellable(o),
        }
    }

    /// The BUY reservation of 10 §9.4 C1 / R9 for an outstanding size
    /// (`buy_reservation` with the profile's notional rounding).
    fn reservation(
        &self,
        fee: &FeeCurve,
        lo: Price,
        req: &OrderRequest,
        outstanding: OrderSize,
    ) -> Result<Usdc, Overflow> {
        if req.side != Side::Buy {
            return Ok(Usdc::ZERO);
        }
        buy_reservation(
            fee,
            req.order_type,
            req.price,
            outstanding,
            req.post_only,
            lo,
            notional_mode(self.rules, Side::Buy),
        )
    }

    /// Reservation a new order would take at emission (12 §7.5 funding):
    /// equal to the reservation [`Ledger::submit`] writes.
    pub fn reservation_for(
        &self,
        req: &OrderRequest,
        rules: &ExchangeRules,
    ) -> Result<Usdc, Overflow> {
        self.reservation(&rules.fee, rules.tick[req.outcome], req, req.size)
    }

    /// Writes a new `InFlight` record with its reservation at OM emission
    /// (12 §9.1, §9.4) and points the cid at it (12 §7.1). The reservation
    /// formula is 10 §9.4 C1 / R9 per rule set
    /// (`pmb_core::rules::buy_reservation`).
    pub fn submit(
        &mut self,
        req: OrderRequest,
        stamp: TsMs,
        rules: &ExchangeRules,
        signed: Option<SignedAmounts>,
    ) -> OrderKey {
        let key = OrderKey::new(u32::try_from(self.orders.len()).expect("order slab exhausted"));
        let fee = rules.fee;
        let lo = rules.tick[req.outcome];
        let reserved = self
            .reservation(&fee, lo, &req, req.size)
            .expect("reservation overflow (10 T3)");
        let reserved_shares = match (self.rules, req.side, req.size) {
            (CoreRules::Realistic, Side::Sell, OrderSize::Shares(q)) => q,
            _ => Qty::ZERO,
        };
        self.reserved += reserved;
        self.reserved_sell[req.outcome] += reserved_shares;
        self.orders.push(OrderRecord {
            key,
            req,
            created_at: stamp,
            signed,
            state: OrderState::InFlight,
            cancel: CancelState::None,
            submitted_delivered: false,
            acknowledged: false,
            om_terminal: false,
            filled: Qty::ZERO,
            spent: Usdc::ZERO,
            final_qty: None,
            settlement: None,
            reserved,
            reserved_shares,
            fill_seq: 0,
            res_fee: fee,
            res_lo: lo,
        });
        self.active.push(key);
        let ci = req.cid.index();
        if self.current.len() <= ci {
            self.current.resize(ci + 1, None);
        }
        self.current[ci] = Some(key);
        key
    }

    /// Records a cancel request for a key at emission (12 §9.1, 10 §8.1
    /// `CancelState`).
    pub fn request_cancel(&mut self, k: OrderKey, state: CancelState) {
        let r = &mut self.orders[k.index()];
        if !r.state.is_terminal() {
            r.cancel = state;
        }
    }

    /// Registers a pending split (cost reserved) or merge (shares of both
    /// outcomes reserved) at emission (12 §9.4).
    pub fn add_pending_op(&mut self, op: PendingOp) {
        if op.merge {
            self.pending_merge += op.size;
        } else {
            // Split cost = size USDC (1 per full set, `BacktestExecution.ts:294`).
            self.reserved += Usdc::from_micros(op.size.micros());
        }
        self.pending_ops.push(op);
    }

    /// Marks a key `om_terminal` (12 §7.6).
    pub fn set_om_terminal(&mut self, k: OrderKey) {
        self.orders[k.index()].om_terminal = true;
    }

    fn take_pending(&mut self, op: OpKey) -> Result<PendingOp, LedgerError> {
        let i = self
            .pending_ops
            .iter()
            .position(|p| p.op == op)
            .ok_or(LedgerError::UnknownOp(op))?;
        let p = self.pending_ops.remove(i);
        if p.merge {
            self.pending_merge -= p.size;
        } else {
            self.reserved -= Usdc::from_micros(p.size.micros());
        }
        Ok(p)
    }

    /// Recomputes the reservations of one record from its delivered state
    /// (12 §9.4): BUY cash for the outstanding quantity
    /// `max(0, final.unwrap_or(size) − filled)`; realistic SELL shares.
    fn rereserve(&mut self, k: OrderKey) -> Result<(), LedgerError> {
        let r = &self.orders[k.index()];
        let terminal = r.state.is_terminal();
        let outstanding = match r.req.size {
            OrderSize::Shares(q) => {
                let target = r.final_qty.unwrap_or(q);
                OrderSize::Shares((target - r.filled).max(Qty::ZERO))
            }
            OrderSize::Collateral(a) => {
                if terminal && r.final_qty.is_some() {
                    OrderSize::Collateral(Usdc::ZERO)
                } else {
                    OrderSize::Collateral((a - r.spent).max(Usdc::ZERO))
                }
            }
        };
        let new_res = self.reservation(&r.res_fee, r.res_lo, &r.req, outstanding)?;
        let new_shares = match (self.rules, r.req.side, r.req.size) {
            (CoreRules::Realistic, Side::Sell, OrderSize::Shares(q)) if !terminal => {
                (q - r.filled).max(Qty::ZERO)
            }
            _ => Qty::ZERO,
        };
        let (old_res, old_shares, o) = (r.reserved, r.reserved_shares, r.req.outcome);
        let r = &mut self.orders[k.index()];
        r.reserved = new_res;
        r.reserved_shares = new_shares;
        self.reserved = self.reserved.checked_add(new_res)?.checked_sub(old_res)?;
        self.reserved_sell[o] = self.reserved_sell[o]
            .checked_add(new_shares)?
            .checked_sub(old_shares)?;
        Ok(())
    }

    fn record_mut(&mut self, k: OrderKey) -> Result<&mut OrderRecord, LedgerError> {
        self.orders
            .get_mut(k.index())
            .ok_or(LedgerError::UnknownOrder(k))
    }

    fn step_state(&mut self, k: OrderKey, input: StateInput) -> Result<(), LedgerError> {
        let r = self.record_mut(k)?;
        r.state = transition(r.state, input).map_err(LedgerError::Transition)?;
        Ok(())
    }

    /// Terminal delivery: state, authoritative final quantity (12 §9.4
    /// table), active-list removal, reservation release.
    fn terminate(
        &mut self,
        k: OrderKey,
        input: StateInput,
        final_qty: Option<Qty>,
    ) -> Result<Delivered, LedgerError> {
        let r = self.record_mut(k)?;
        if r.state.is_terminal() {
            return Err(LedgerError::SecondTerminal(k));
        }
        r.state = transition(r.state, input).map_err(LedgerError::Transition)?;
        r.final_qty = final_qty;
        if let (Some(f), OrderSize::Shares(_)) = (final_qty, r.req.size) {
            if r.filled > f {
                return Err(LedgerError::Overfill(k));
            }
        }
        if let Some(i) = self.active.iter().position(|&a| a == k) {
            self.active.remove(i);
        }
        self.rereserve(k)?;
        Ok(Delivered {
            releases_cid: true,
            terminal: Some(k),
            ..Delivered::default()
        })
    }

    /// Applies one delivered exchange-originated event (12 §9.2–§9.5).
    /// OM-level rejections (no key) do not touch the ledger. An error is an
    /// adapter contract or ledger invariant violation (`engine_fault`).
    pub fn apply_delivered(&mut self, ev: &AccountEvent) -> Result<Delivered, LedgerError> {
        use AccountEventKind as K;
        match ev.kind {
            K::OrderSubmitted { order } => {
                self.record_mut(order)?.submitted_delivered = true;
                Ok(Delivered::default())
            }
            K::OrderRejected {
                order: Some(k),
                reason,
                ..
            } => self.terminate(k, StateInput::Rejected(reason), Some(Qty::ZERO)),
            K::OrderRejected { order: None, .. } => Ok(Delivered::default()),
            K::OrderAccepted { order } => {
                let r = self.record_mut(order)?;
                if r.state.is_terminal() {
                    // A late ack of an order already terminal changes nothing.
                    return Ok(Delivered::default());
                }
                self.step_state(order, StateInput::Accepted)?;
                self.record_mut(order)?.acknowledged = true;
                Ok(Delivered {
                    acknowledged: Some(order),
                    ..Delivered::default()
                })
            }
            K::OrderDelayed { order, .. } => {
                self.step_state(order, StateInput::Delayed)?;
                Ok(Delivered::default())
            }
            K::OrderOpen { order } => {
                self.step_state(order, StateInput::Open)?;
                Ok(Delivered::default())
            }
            K::Fill(f) => self.apply_fill(&f),
            K::SettlementUpdate {
                order,
                fill,
                status,
                ..
            } => self.apply_settlement(order, fill, status),
            K::OrderDone {
                order,
                reason,
                filled,
            } => {
                let r = self.record_mut(order)?;
                let size = r.req.size.shares();
                let delivered = r.filled;
                // 12 §9.4 authoritative final quantity.
                let final_qty = match (reason, filled) {
                    (_, Some(f)) => Some(f.max(delivered)),
                    (DoneReason::Filled, None) => size.or(Some(delivered)),
                    (DoneReason::Killed, None) => Some(delivered.max(Qty::ZERO)),
                    (DoneReason::Canceled(_) | DoneReason::Expired, None) => None,
                };
                self.terminate(order, StateInput::Done(reason), final_qty)
            }
            K::CancelAcked { order, .. } => {
                let r = self.record_mut(order)?;
                if r.state.is_terminal() {
                    // 10 §8.2: recorded, not delivered to the strategy.
                    return Ok(Delivered {
                        suppress_callback: true,
                        ..Delivered::default()
                    });
                }
                r.cancel = CancelState::Acked;
                Ok(Delivered {
                    cancel_acked: Some(order),
                    ..Delivered::default()
                })
            }
            K::CancelFailed { order, .. } => {
                if let Some(k) = order {
                    let r = self.record_mut(k)?;
                    if !r.state.is_terminal() {
                        r.cancel = CancelState::Failed;
                    }
                }
                Ok(Delivered::default())
            }
            K::PositionsSplit { op, size, cost } => {
                self.take_pending(op)?;
                // 12 §9.5: cash −= cost; both outcomes += size at zero basis.
                self.cash = self.cash.checked_sub(cost)?;
                self.split_cost = self.split_cost.checked_add(cost)?;
                for o in Outcome::ALL {
                    self.positions[o].qty = self.positions[o].qty.checked_add(size)?;
                }
                Ok(Delivered::default())
            }
            K::SplitFailed { op, .. } | K::MergeFailed { op, .. } => {
                // Engine-origin failures (12 §7.3) never registered a pending
                // operation and, like OM rejections, do not touch the ledger.
                if self.pending_ops.iter().any(|p| p.op == op) {
                    self.take_pending(op)?;
                }
                Ok(Delivered::default())
            }
            K::PositionsMerged { op, size } => {
                self.take_pending(op)?;
                self.apply_merge(size)?;
                Ok(Delivered::default())
            }
            K::StreamStatus { .. } => Ok(Delivered::default()),
        }
    }

    /// Average-cost basis removal (10 §3.3 R10): a full close removes the
    /// whole basis, otherwise `basis × sold / qty` half away from zero.
    fn removed_basis(p: Position, sold: Qty) -> Result<Usdc, Overflow> {
        if sold >= p.qty {
            Ok(p.cost_basis)
        } else if sold.is_zero() || p.qty.is_zero() {
            Ok(Usdc::ZERO)
        } else {
            mul_div(
                p.cost_basis.micros(),
                sold.micros(),
                p.qty.micros(),
                Rounding::HalfAwayFromZero,
            )
            .map(Usdc::from_micros)
        }
    }

    /// Delivered `PositionsMerged` (12 §9.5): cash += size; each outcome
    /// removes basis at average cost; realized += size − removed(Up) −
    /// removed(Down). TS realizes nothing here (`Portfolio.ts:553-586`), a
    /// classified TS bug (13 §5.4) that is not reproduced.
    fn apply_merge(&mut self, size: Qty) -> Result<(), LedgerError> {
        let proceeds = Usdc::from_micros(size.micros());
        let mut removed_total = Usdc::ZERO;
        for o in Outcome::ALL {
            let p = self.positions[o];
            let sold = size.min(p.qty).max(Qty::ZERO);
            let removed = Self::removed_basis(p, sold)?;
            removed_total = removed_total.checked_add(removed)?;
            self.positions[o] = Position {
                qty: p.qty.checked_sub(sold)?,
                cost_basis: p.cost_basis.checked_sub(removed)?,
            };
        }
        self.cash = self.cash.checked_add(proceeds)?;
        self.realized = self
            .realized
            .checked_add(proceeds)?
            .checked_sub(removed_total)?;
        Ok(())
    }

    /// Delivered `Fill` (12 §9.2, §9.5).
    fn apply_fill(&mut self, f: &Fill) -> Result<Delivered, LedgerError> {
        let k = f.key.order;
        let rules = self.rules;
        let gate_rank = self.sell_gate.rank().unwrap_or(0);
        let r = self.record_mut(k)?;
        if f.key.seq <= r.fill_seq {
            return Err(LedgerError::FillSeq(f.key));
        }
        r.fill_seq = f.key.seq;
        let mode = notional_mode(rules, f.side);
        let notional = f.price.notional(f.qty, mode)?;
        // Order record: delivered filled (and spend), S2 checks.
        r.filled = r.filled.checked_add(f.qty)?;
        if matches!(r.req.size, OrderSize::Collateral(_)) {
            r.spent = r.spent.checked_add(notional)?;
        }
        let over = match (r.req.size, r.final_qty) {
            (OrderSize::Shares(q), fin) => r.filled > fin.unwrap_or(q).max(Qty::ZERO).min(q),
            (OrderSize::Collateral(a), _) => r.spent > a,
        };
        if over {
            return Err(LedgerError::Overfill(k));
        }
        if !r.state.is_terminal() {
            r.state = transition(r.state, StateInput::Fill).map_err(LedgerError::Transition)?;
        }
        let full = r.fully_filled();
        let res_before = r.reserved;
        // Position, cash and realized PnL (12 §9.5).
        let p = self.positions[f.outcome];
        let effect = match f.side {
            Side::Buy => {
                let cost = notional.checked_add(f.fee)?;
                self.positions[f.outcome] = Position {
                    qty: p.qty.checked_add(f.qty)?,
                    cost_basis: p.cost_basis.checked_add(cost)?,
                };
                self.cash = self.cash.checked_sub(cost)?;
                if rules == CoreRules::Realistic && gate_rank > 1 {
                    self.unsettled[f.outcome] = self.unsettled[f.outcome].checked_add(f.qty)?;
                }
                FillEffect {
                    cash: -cost,
                    qty: f.qty,
                    basis: cost,
                    realized: Usdc::ZERO,
                    notional,
                    status: SettlementStatus::Matched,
                    reversed: false,
                }
            }
            Side::Sell => {
                // TC-C4: a SELL beyond the position fills, the quantity clamps
                // at zero and the excess is counted; the full proceeds are
                // credited to cash and realized PnL (12 §9.5).
                let sold = f.qty.min(p.qty).max(Qty::ZERO);
                let removed = Self::removed_basis(p, sold)?;
                let net = notional.checked_sub(f.fee)?;
                let realized = net.checked_sub(removed)?;
                self.positions[f.outcome] = Position {
                    qty: p.qty.checked_sub(sold)?,
                    cost_basis: p.cost_basis.checked_sub(removed)?,
                };
                self.cash = self.cash.checked_add(net)?;
                self.realized = self.realized.checked_add(realized)?;
                let excess = f.qty.checked_sub(sold)?;
                self.counters.oversold_qty += excess.micros();
                FillEffect {
                    cash: net,
                    qty: -sold,
                    basis: -removed,
                    realized,
                    notional,
                    status: SettlementStatus::Matched,
                    reversed: false,
                }
            }
        };
        self.fees_paid = self.fees_paid.checked_add(f.fee)?;
        // Per-fill fee dust beyond the reservation is charged and counted
        // (10 §9.4 C1): a BUY fill whose cost exceeds the reservation it
        // consumed.
        self.rereserve(k)?;
        if f.side == Side::Buy {
            let consumed = res_before - self.orders[k.index()].reserved;
            let cost = -effect.cash;
            if cost > consumed && consumed.is_positive() {
                self.counters.reservation_dust += (cost - consumed).micros();
            }
        }
        let mut fill = *f;
        fill.late = self.orders[k.index()].state.is_terminal();
        self.fills.push(fill);
        self.effects.push(effect);
        Ok(Delivered {
            releases_cid: full,
            ..Delivered::default()
        })
    }

    /// Delivered `SettlementUpdate` (12 §9.2, §9.3): rank update; per-fill
    /// status for the realistic sell gate; `Failed` reverses the fill.
    fn apply_settlement(
        &mut self,
        order: OrderKey,
        fill: Option<FillKey>,
        status: SettlementStatus,
    ) -> Result<Delivered, LedgerError> {
        let r = self.record_mut(order)?;
        if let Some(new) = status.rank() {
            let have = r.settlement.and_then(SettlementStatus::rank).unwrap_or(0);
            if new > have {
                r.settlement = Some(status);
            }
        }
        let Some(fk) = fill else {
            return Ok(Delivered::default());
        };
        let Some(i) = self.fills.iter().rposition(|x| x.key == fk) else {
            return Err(LedgerError::UnknownOrder(fk.order));
        };
        if status == SettlementStatus::Failed {
            self.reverse_fill(i)?;
            return Ok(Delivered::default());
        }
        let gate = self.sell_gate.rank().unwrap_or(0);
        let e = &mut self.effects[i];
        let old = e.status.rank().unwrap_or(0);
        if let Some(new) = status.rank() {
            if new > old {
                e.status = status;
                let f = self.fills[i];
                if self.rules == CoreRules::Realistic
                    && f.side == Side::Buy
                    && !e.reversed
                    && old < gate
                    && new >= gate
                {
                    self.unsettled[f.outcome] = self.unsettled[f.outcome].checked_sub(f.qty)?;
                }
            }
        }
        Ok(Delivered::default())
    }

    /// `SettlementUpdate{Failed}` (10 F1, 12 §9.3): cash, quantity, basis, fee
    /// and realized PnL return to their pre-fill values and the order's
    /// filled quantity drops; a quantity that would become negative clamps
    /// at zero and counts `reversal_deficit`.
    fn reverse_fill(&mut self, i: usize) -> Result<(), LedgerError> {
        let e = self.effects[i];
        if e.reversed {
            return Ok(());
        }
        let f = self.fills[i];
        let gate = self.sell_gate.rank().unwrap_or(0);
        self.cash = self.cash.checked_sub(e.cash)?;
        self.realized = self.realized.checked_sub(e.realized)?;
        self.fees_paid = self.fees_paid.checked_sub(f.fee)?;
        let p = self.positions[f.outcome];
        let mut qty = p.qty.checked_sub(e.qty)?;
        if qty.is_negative() {
            self.counters.reversal_deficit += -qty.micros();
            qty = Qty::ZERO;
        }
        self.positions[f.outcome] = Position {
            qty,
            cost_basis: p.cost_basis.checked_sub(e.basis)?,
        };
        if self.rules == CoreRules::Realistic
            && f.side == Side::Buy
            && e.status.rank().unwrap_or(0) < gate
        {
            self.unsettled[f.outcome] = (self.unsettled[f.outcome] - f.qty).max(Qty::ZERO);
        }
        let k = f.key.order;
        let r = &mut self.orders[k.index()];
        r.filled = r.filled.checked_sub(f.qty)?;
        if matches!(r.req.size, OrderSize::Collateral(_)) {
            r.spent = r.spent.checked_sub(e.notional)?;
        }
        if !r.state.is_terminal() {
            self.rereserve(k)?;
        }
        self.effects[i].reversed = true;
        Ok(())
    }

    /// Final PnL `cash_end − starting + Σ_o quantity_o × payout_o`
    /// (12 §9.6, 10 §9.4 C4).
    pub fn pnl(&self, outcome: FinalOutcome) -> Usdc {
        let mut v = self.cash - self.starting;
        for o in Outcome::ALL {
            v += self.settlement_value(o, outcome);
        }
        v
    }

    /// `quantity_o × payout_o`, exact (10 §3.3 R12).
    fn settlement_value(&self, o: Outcome, outcome: FinalOutcome) -> Usdc {
        let q = self.positions[o].qty.micros() as i128;
        let v = q * outcome.payout_micros(o) as i128 / pmb_core::SCALE as i128;
        Usdc::from_micros(i64::try_from(v).expect("settlement value overflow (10 T3)"))
    }

    /// The identity of 12 §9.6:
    /// `pnl == realized + Σ_o qty_o × payout_o − Σ_o basis_o − split_cost`,
    /// exact in micros; `false` is an `engine_fault` (12 §11).
    pub fn identity_holds(&self, outcome: FinalOutcome) -> bool {
        let mut rhs = self.realized - self.split_cost;
        for o in Outcome::ALL {
            rhs += self.settlement_value(o, outcome) - self.positions[o].cost_basis;
        }
        self.pnl(outcome) == rhs
    }

    /// The reservation invariants of 12 §9.8 item 2: every record and pending
    /// operation holds a reservation ≥ 0 and `reserved` is their sum.
    pub fn reservations_consistent(&self) -> bool {
        let mut sum = Usdc::ZERO;
        for r in &self.orders {
            if r.reserved.is_negative() || r.reserved_shares.is_negative() {
                return false;
            }
            sum += r.reserved;
        }
        for p in &self.pending_ops {
            if !p.merge {
                sum += Usdc::from_micros(p.size.micros());
            }
        }
        sum == self.reserved
    }

    /// Records with `submitted_delivered` and a non-terminal, not fully filled
    /// state (12 §8.2: the TS risk view counts only delivered submissions):
    /// their count and remaining BUY and SELL shares per outcome.
    pub(crate) fn delivered_open_exposure(&self) -> (u32, PerOutcome<Qty>, PerOutcome<Qty>) {
        let mut n = 0u32;
        let mut buys = PerOutcome::<Qty>::default();
        let mut sells = PerOutcome::<Qty>::default();
        for r in self.open_orders() {
            n += 1;
            let rem = r.remaining();
            match r.req.side {
                Side::Buy => buys[r.req.outcome] += rem,
                Side::Sell => sells[r.req.outcome] += rem,
            }
        }
        (n, buys, sells)
    }

    /// Non-terminal own records that are not fully filled, and their
    /// remaining BUY shares per outcome (12 §8.1: undelivered submissions
    /// count at once).
    pub(crate) fn nonterminal_exposure(&self) -> (u32, PerOutcome<Qty>) {
        let mut n = 0u32;
        let mut buys = PerOutcome::<Qty>::default();
        for &k in &self.active {
            let r = &self.orders[k.index()];
            if r.fully_filled() {
                continue;
            }
            n += 1;
            if r.req.side == Side::Buy {
                buys[r.req.outcome] += r.remaining();
            }
        }
        (n, buys)
    }
}

/// Reject reason of a failed BUY funding check (12 §7.5).
pub(crate) fn insufficient_capital(required: Usdc, available: Usdc) -> RejectReason {
    RejectReason::InsufficientCapital {
        required,
        available,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_core::fill::Liquidity;
    use pmb_core::ids::TradeSeq;

    fn rec(size: i64, filled: i64) -> OrderRecord {
        let req = OrderRequest::gtc(
            CidKey::new(0),
            Outcome::Up,
            Side::Buy,
            Price::from_micros(500_000),
            Qty::from_micros(size),
        );
        OrderRecord {
            key: OrderKey::new(0),
            req,
            created_at: TsMs(0),
            signed: None,
            state: OrderState::Live,
            cancel: CancelState::None,
            submitted_delivered: true,
            acknowledged: true,
            om_terminal: false,
            filled: Qty::from_micros(filled),
            spent: Usdc::ZERO,
            final_qty: None,
            settlement: Some(SettlementStatus::Mined),
            reserved: Usdc::ZERO,
            reserved_shares: Qty::ZERO,
            fill_seq: 0,
            res_fee: FeeCurve::TS_COMPAT,
            res_lo: Price::from_micros(10_000),
        }
    }

    #[test]
    fn order_view_accessors() {
        // spec: 30 §5.2 OrderView, 12 §9.7
        let r = rec(5_000_000, 2_000_000);
        assert_eq!(r.remaining(), Qty::from_micros(3_000_000));
        assert_eq!(rec(5_000_000, 6_000_000).remaining(), Qty::ZERO);
        assert!(r.is_open());
        assert!(!rec(5_000_000, 5_000_000).is_open());
        assert_eq!(r.ts_state(), "partially_filled");
        assert!(r.settled_at_least(SettlementStatus::Matched));
        assert!(r.settled_at_least(SettlementStatus::Mined));
        assert!(!r.settled_at_least(SettlementStatus::Confirmed));
        assert!(!r.settled_at_least(SettlementStatus::Retrying));
        assert_eq!(r.expire_at(), None);
    }

    #[test]
    fn empty_ledger_capital_and_cap() {
        // spec: 12 §9.4 available = min(cash − reservations, cap)
        let mut l = Ledger::new(CoreRules::TsCompat, Usdc::from_micros(500_000_000));
        assert_eq!(l.available(), Usdc::from_micros(500_000_000));
        l.cap = Some(Usdc::from_micros(100_000_000));
        assert_eq!(l.available(), Usdc::from_micros(100_000_000));
        assert_eq!(l.capital().cash, Usdc::from_micros(500_000_000));
        assert_eq!(l.open_orders().count(), 0);
        assert!(!l.cid_active(CidKey::new(3)));
    }

    fn u(m: i64) -> Usdc {
        Usdc::from_micros(m)
    }
    fn q(m: i64) -> Qty {
        Qty::from_micros(m)
    }
    fn p(m: i64) -> Price {
        Price::from_micros(m)
    }

    fn ev(kind: AccountEventKind) -> AccountEvent {
        AccountEvent { at: TsMs(1), kind }
    }

    fn fill(k: OrderKey, seq: u32, side: Side, price: i64, qty: i64, fee: i64) -> AccountEvent {
        ev(AccountEventKind::Fill(Fill {
            key: FillKey { order: k, seq },
            trade: TradeSeq::new(seq),
            outcome: Outcome::Up,
            side,
            price: p(price),
            qty: q(qty),
            fee: u(fee),
            liquidity: Liquidity::Taker,
            at: TsMs(1),
            exchange_ts: None,
            late: false,
        }))
    }

    #[test]
    fn ts_compat_reservation_is_notional_plus_700bps_fee_at_limit() {
        // spec: 10 §9.4 C1 / §3.3 R9 ts-compat (`capital.ts:16-28`)
        let mut l = Ledger::new(CoreRules::TsCompat, u(500_000_000));
        let rules = ExchangeRules::ts_compat();
        let req = OrderRequest::gtc(
            CidKey::new(0),
            Outcome::Up,
            Side::Buy,
            p(500_000),
            q(10_000_000),
        );
        // 0.5 × 10 = 5; fee 0.07 × 0.25 × 10 = 0.175
        assert_eq!(l.reservation_for(&req, &rules).unwrap(), u(5_175_000));
        let k = l.submit(req, TsMs(0), &rules, None);
        assert_eq!(l.capital().reserved, u(5_175_000));
        assert_eq!(l.available(), u(494_825_000));
        let mut po = req;
        po.post_only = true;
        assert_eq!(l.reservation_for(&po, &rules).unwrap(), u(5_000_000));
        // Partial fill reduces the reservation to the outstanding quantity.
        l.apply_delivered(&ev(AccountEventKind::OrderSubmitted { order: k }))
            .unwrap();
        l.apply_delivered(&fill(k, 1, Side::Buy, 500_000, 4_000_000, 70_000))
            .unwrap();
        // outstanding 6 → 3 + 0.105
        assert_eq!(l.capital().reserved, u(3_105_000));
        assert_eq!(l.capital().cash, u(500_000_000 - 2_070_000));
        // Cancel without an authoritative quantity keeps the reservation.
        l.apply_delivered(&ev(AccountEventKind::OrderDone {
            order: k,
            reason: DoneReason::Expired,
            filled: None,
        }))
        .unwrap();
        assert_eq!(l.capital().reserved, u(3_105_000));
        assert!(l.reservations_consistent());
    }

    #[test]
    fn terminal_with_final_quantity_releases_reservation() {
        // spec: 12 §9.4 authoritative final quantity table
        let rules = ExchangeRules::ts_compat();
        for (reason, filled, want_final) in [
            (DoneReason::Filled, None, Some(10_000_000)),
            (DoneReason::Killed, None, Some(0)),
            (
                DoneReason::Canceled(pmb_core::event::CancelCause::Operator),
                Some(q(0)),
                Some(0),
            ),
            (DoneReason::Expired, None, None),
        ] {
            let mut l = Ledger::new(CoreRules::TsCompat, u(500_000_000));
            let req = OrderRequest::gtc(
                CidKey::new(0),
                Outcome::Up,
                Side::Buy,
                p(500_000),
                q(10_000_000),
            );
            let k = l.submit(req, TsMs(0), &rules, None);
            let d = l
                .apply_delivered(&ev(AccountEventKind::OrderDone {
                    order: k,
                    reason,
                    filled,
                }))
                .unwrap();
            assert!(d.releases_cid);
            assert_eq!(l.order(k).final_qty.map(|x| x.micros()), want_final);
            let released = want_final == Some(0);
            assert_eq!(l.capital().reserved.is_zero(), released, "{reason:?}");
            assert!(l.active_keys().is_empty());
        }
    }

    #[test]
    fn rejected_is_terminal_and_second_terminal_is_a_fault() {
        // spec: 12 §9.2 (OrderRejected keyed → Rejected, final 0), 10 S1
        let rules = ExchangeRules::ts_compat();
        let mut l = Ledger::new(CoreRules::TsCompat, u(500_000_000));
        let req = OrderRequest::gtc(
            CidKey::new(2),
            Outcome::Up,
            Side::Buy,
            p(500_000),
            q(1_000_000),
        );
        let k = l.submit(req, TsMs(0), &rules, None);
        assert!(l.cid_active(CidKey::new(2)));
        l.apply_delivered(&ev(AccountEventKind::OrderRejected {
            order: Some(k),
            cid: CidKey::new(2),
            reason: RejectReason::PostOnlyWouldCross,
        }))
        .unwrap();
        assert!(l.capital().reserved.is_zero());
        assert!(matches!(l.order(k).state(), OrderState::Rejected(_)));
        let e = l.apply_delivered(&ev(AccountEventKind::OrderDone {
            order: k,
            reason: DoneReason::Filled,
            filled: None,
        }));
        assert_eq!(e, Err(LedgerError::SecondTerminal(k)));
    }

    #[test]
    fn sell_realizes_average_cost_and_identity_holds() {
        // spec: 12 §9.5 BUY/SELL fills, §9.6 identity, 10 §3.3 R10
        let rules = ExchangeRules::ts_compat();
        let mut l = Ledger::new(CoreRules::TsCompat, u(100_000_000));
        let b = l.submit(
            OrderRequest::gtc(
                CidKey::new(0),
                Outcome::Up,
                Side::Buy,
                p(400_000),
                q(3_000_000),
            ),
            TsMs(0),
            &rules,
            None,
        );
        l.apply_delivered(&fill(b, 1, Side::Buy, 400_000, 3_000_000, 50_400))
            .unwrap();
        // basis = 1.2 + 0.0504
        assert_eq!(l.position(Outcome::Up).cost_basis, u(1_250_400));
        let s = l.submit(
            OrderRequest::gtc(
                CidKey::new(1),
                Outcome::Up,
                Side::Sell,
                p(600_000),
                q(1_000_000),
            ),
            TsMs(0),
            &rules,
            None,
        );
        l.apply_delivered(&fill(s, 1, Side::Sell, 600_000, 1_000_000, 16_800))
            .unwrap();
        // removed = 1.2504 / 3 = 0.4168; realized = 0.6 − 0.0168 − 0.4168
        assert_eq!(l.realized_pnl(), u(166_400));
        assert_eq!(l.position(Outcome::Up).qty, q(2_000_000));
        assert_eq!(l.position(Outcome::Up).cost_basis, u(833_600));
        for w in Outcome::ALL {
            assert!(l.identity_holds(FinalOutcome::new(w)));
        }
        // Winner Up: pnl = cash − start + 2.
        assert_eq!(
            l.pnl(FinalOutcome::new(Outcome::Up)),
            u(-1_250_400 + 583_200 + 2_000_000)
        );
    }

    #[test]
    fn naked_sell_clamps_and_counts_oversold() {
        // spec: 12 §9.5 TC-C4 (quantity clamped at 0, oversold_qty counted,
        // full proceeds realized)
        let rules = ExchangeRules::ts_compat();
        let mut l = Ledger::new(CoreRules::TsCompat, u(100_000_000));
        let s = l.submit(
            OrderRequest::gtc(
                CidKey::new(0),
                Outcome::Down,
                Side::Sell,
                p(300_000),
                q(2_000_000),
            ),
            TsMs(0),
            &rules,
            None,
        );
        let mut e = fill(s, 1, Side::Sell, 300_000, 2_000_000, 0);
        if let AccountEventKind::Fill(f) = &mut e.kind {
            f.outcome = Outcome::Down;
        }
        l.apply_delivered(&e).unwrap();
        assert_eq!(l.position(Outcome::Down).qty, Qty::ZERO);
        assert_eq!(l.counters().oversold_qty, 2_000_000);
        assert_eq!(l.realized_pnl(), u(600_000));
        assert!(l.identity_holds(FinalOutcome::new(Outcome::Down)));
    }

    #[test]
    fn split_and_merge_move_cash_and_realize_merge_pnl() {
        // spec: 12 §9.5 split (zero basis), merge (realized = size − removed);
        // TS keeps the basis and realizes nothing (13 §5.4, TS bug)
        let rules = ExchangeRules::ts_compat();
        let mut l = Ledger::new(CoreRules::TsCompat, u(100_000_000));
        l.add_pending_op(PendingOp {
            op: OpKey::new(0),
            merge: false,
            size: q(10_000_000),
        });
        assert_eq!(l.available(), u(90_000_000));
        l.apply_delivered(&ev(AccountEventKind::PositionsSplit {
            op: OpKey::new(0),
            size: q(10_000_000),
            cost: u(10_000_000),
        }))
        .unwrap();
        assert_eq!(l.capital().reserved, Usdc::ZERO);
        assert_eq!(l.capital().cash, u(90_000_000));
        assert_eq!(l.split_cost(), u(10_000_000));
        assert_eq!(l.position(Outcome::Up).cost_basis, Usdc::ZERO);
        // Buy 2 more Up at 0.5 so the merge removes some basis.
        let b = l.submit(
            OrderRequest::gtc(
                CidKey::new(0),
                Outcome::Up,
                Side::Buy,
                p(500_000),
                q(2_000_000),
            ),
            TsMs(0),
            &rules,
            None,
        );
        l.apply_delivered(&fill(b, 1, Side::Buy, 500_000, 2_000_000, 0))
            .unwrap();
        l.add_pending_op(PendingOp {
            op: OpKey::new(1),
            merge: true,
            size: q(6_000_000),
        });
        assert_eq!(l.mergeable(Outcome::Up), q(6_000_000));
        assert_eq!(l.mergeable(Outcome::Down), q(4_000_000));
        l.apply_delivered(&ev(AccountEventKind::PositionsMerged {
            op: OpKey::new(1),
            size: q(6_000_000),
        }))
        .unwrap();
        // Up: qty 12, basis 1 → removed 0.5; Down: basis 0.
        assert_eq!(l.realized_pnl(), u(5_500_000));
        assert_eq!(l.position(Outcome::Up).qty, q(6_000_000));
        assert_eq!(l.position(Outcome::Up).cost_basis, u(500_000));
        assert_eq!(l.capital().cash, u(90_000_000 - 1_000_000 + 6_000_000));
        for w in Outcome::ALL {
            assert!(l.identity_holds(FinalOutcome::new(w)));
        }
    }

    #[test]
    fn failed_settlement_reverses_a_fill_exactly() {
        // spec: 10 F1, 12 §9.3 reversal; INV-11
        let rules = ExchangeRules::realistic_fallback(
            pmb_core::rules::RulesTableVersion::V1,
            TsMs(1_780_272_000_000),
            TsMs(1_780_272_000_000),
        );
        let mut l = Ledger::new(CoreRules::Realistic, u(100_000_000));
        let b = l.submit(
            OrderRequest::gtc(
                CidKey::new(0),
                Outcome::Up,
                Side::Buy,
                p(500_000),
                q(10_000_000),
            ),
            TsMs(0),
            &rules,
            None,
        );
        let before = (l.capital(), l.position(Outcome::Up), l.realized_pnl());
        l.apply_delivered(&fill(b, 1, Side::Buy, 500_000, 4_000_000, 70_000))
            .unwrap();
        // Unsettled shares are not sellable under the Mined gate.
        assert_eq!(l.sellable(Outcome::Up), Qty::ZERO);
        l.apply_delivered(&ev(AccountEventKind::SettlementUpdate {
            order: b,
            fill: Some(FillKey { order: b, seq: 1 }),
            status: SettlementStatus::Mined,
            size_matched: q(4_000_000),
        }))
        .unwrap();
        assert_eq!(l.sellable(Outcome::Up), q(4_000_000));
        l.apply_delivered(&ev(AccountEventKind::SettlementUpdate {
            order: b,
            fill: Some(FillKey { order: b, seq: 1 }),
            status: SettlementStatus::Failed,
            size_matched: q(4_000_000),
        }))
        .unwrap();
        assert_eq!(
            (l.capital(), l.position(Outcome::Up), l.realized_pnl()),
            before
        );
        assert_eq!(l.order(b).filled(), Qty::ZERO);
        assert!(l.fill_reversed(0));
        assert!(l.identity_holds(FinalOutcome::new(Outcome::Up)));
    }

    #[test]
    fn realistic_sell_reserves_shares() {
        // spec: 12 §9.3 sellable, 10 §9.4 C2
        let rules = ExchangeRules::realistic_fallback(
            pmb_core::rules::RulesTableVersion::V1,
            TsMs(1_780_272_000_000),
            TsMs(1_780_272_000_000),
        );
        let mut l = Ledger::new(CoreRules::Realistic, u(100_000_000))
            .with_sell_gate(SettlementStatus::Matched);
        l.add_pending_op(PendingOp {
            op: OpKey::new(0),
            merge: false,
            size: q(10_000_000),
        });
        l.apply_delivered(&ev(AccountEventKind::PositionsSplit {
            op: OpKey::new(0),
            size: q(10_000_000),
            cost: u(10_000_000),
        }))
        .unwrap();
        assert_eq!(l.sellable(Outcome::Up), q(10_000_000));
        let s = l.submit(
            OrderRequest::gtc(
                CidKey::new(0),
                Outcome::Up,
                Side::Sell,
                p(600_000),
                q(6_000_000),
            ),
            TsMs(0),
            &rules,
            None,
        );
        assert_eq!(l.sellable(Outcome::Up), q(4_000_000));
        l.apply_delivered(&ev(AccountEventKind::OrderDone {
            order: s,
            reason: DoneReason::Canceled(pmb_core::event::CancelCause::Operator),
            filled: Some(Qty::ZERO),
        }))
        .unwrap();
        assert_eq!(l.sellable(Outcome::Up), q(10_000_000));
    }
}
