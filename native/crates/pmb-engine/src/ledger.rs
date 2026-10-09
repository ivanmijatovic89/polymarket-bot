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

use pmb_core::event::AccountEvent;
use pmb_core::fill::{Capital, Fill, Position, SettlementStatus};
use pmb_core::ids::{CidKey, OpKey, OrderKey};
use pmb_core::order::{OrderRequest, OrderSize, OrderType, Side};
use pmb_core::rules::ExchangeRules;
use pmb_core::state::{CancelState, OrderState};
use pmb_core::{FinalOutcome, Outcome, PerOutcome, Price, Qty, TsMs, Usdc};

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
    /// Remaining shares of a share-sized order: `max(0, size − filled)`
    /// (30 §5.2). Collateral-sized BUYs report 0 once anything filled.
    // D-PENDING: 30 §5.2 `remaining` of a collateral-sized BUY is unspecified;
    // chose remaining spend converted at the limit price, implemented by the
    // core agent with the realistic profile (M3b).
    pub fn remaining(&self) -> Qty {
        match self.req.size {
            OrderSize::Shares(q) => {
                let r = q - self.filled;
                if r.is_negative() {
                    Qty::ZERO
                } else {
                    r
                }
            }
            OrderSize::Collateral(_) => todo!("M3b: remaining of a collateral-sized BUY"),
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
    /// Strategy-view open order: `OrderSubmitted` delivered and non-terminal
    /// (12 §9.7).
    #[inline]
    pub fn is_open(&self) -> bool {
        self.submitted_delivered && !self.state.is_terminal()
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
    /// Pending splits and merges (12 §9.4).
    pub(crate) pending_ops: Vec<PendingOp>,
    /// Live and paper capital cap (12 §9.4, D31).
    pub(crate) cap: Option<Usdc>,
    /// Adopted read-only shares (12 §10, D29).
    pub(crate) adopted: PerOutcome<Qty>,
    pub(crate) counters: LedgerCounters,
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
            pending_ops: Vec::new(),
            cap: None,
            adopted: PerOutcome::default(),
            counters: LedgerCounters::default(),
        }
    }

    /// The record of a key (O(1), 12 §14 P8).
    #[inline]
    pub fn order(&self, k: OrderKey) -> &OrderRecord {
        &self.orders[k.index()]
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

    /// Realized PnL, one session total (12 §9.5).
    #[inline]
    pub fn realized_pnl(&self) -> Usdc {
        self.realized
    }

    /// Every session fill in delivery order (12 §9.7).
    #[inline]
    pub fn fills(&self) -> &[Fill] {
        &self.fills
    }

    /// Diagnostics counters.
    #[inline]
    pub fn counters(&self) -> LedgerCounters {
        self.counters
    }

    /// `sellable(o)` (12 §9.3): realistic settled, unreserved shares;
    /// ts-compat the delivered quantity (30 §5.2).
    pub fn sellable(&self, _o: Outcome) -> Qty {
        todo!("core agent: 12 §9.3 sellable")
    }

    /// `mergeable(o)` (12 §7.3): realistic `sellable(o)`; ts-compat delivered
    /// quantity minus pending merges.
    pub fn mergeable(&self, _o: Outcome) -> Qty {
        todo!("core agent: 12 §7.3 mergeable")
    }

    /// Writes a new `InFlight` record with its reservation at OM emission
    /// (12 §9.1, §9.4) and points the cid at it (12 §7.1). The reservation
    /// formula is 10 §9.4 C1 / R9 per rule set
    /// (`pmb_core::rules::buy_reservation`).
    pub fn submit(
        &mut self,
        _req: OrderRequest,
        _stamp: TsMs,
        _rules: &ExchangeRules,
        _signed: Option<SignedAmounts>,
    ) -> OrderKey {
        todo!("core agent: 12 §9.1 submission at emission")
    }

    /// Records a cancel request for a key at emission (12 §9.1, 10 §8.1
    /// `CancelState`).
    pub fn request_cancel(&mut self, _k: OrderKey, _state: CancelState) {
        todo!("core agent: 12 §7.3 cancel request")
    }

    /// Registers a pending split (cost reserved) or merge (shares of both
    /// outcomes reserved) at emission (12 §9.4).
    pub fn add_pending_op(&mut self, _op: PendingOp) {
        todo!("core agent: 12 §9.4 pending split/merge")
    }

    /// Marks a key `om_terminal` (12 §7.6).
    pub fn set_om_terminal(&mut self, k: OrderKey) {
        self.orders[k.index()].om_terminal = true;
    }

    /// Applies one delivered exchange-originated event (12 §9.2–§9.5).
    /// OM-level rejections (no key) do not touch the ledger.
    pub fn apply_delivered(&mut self, _ev: &AccountEvent) -> Delivered {
        todo!("core agent: 12 §9.2 delivered events")
    }

    /// Final PnL `cash_end − starting + Σ_o quantity_o × payout_o`
    /// (12 §9.6, 10 §9.4 C4).
    pub fn pnl(&self, _outcome: FinalOutcome) -> Usdc {
        todo!("core agent: 12 §9.6 pnl")
    }

    /// The identity of 12 §9.6; `false` is an `engine_fault` (12 §11).
    pub fn identity_holds(&self, _outcome: FinalOutcome) -> bool {
        todo!("core agent: 12 §9.6 identity")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        }
    }

    #[test]
    fn order_view_accessors() {
        // spec: 30 §5.2 OrderView, 12 §9.7
        let r = rec(5_000_000, 2_000_000);
        assert_eq!(r.remaining(), Qty::from_micros(3_000_000));
        assert_eq!(rec(5_000_000, 6_000_000).remaining(), Qty::ZERO);
        assert!(r.is_open());
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
}
