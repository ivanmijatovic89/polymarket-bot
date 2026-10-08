//! Portfolio: positions, orders, capital and realized PnL, driven only by
//! account events ([`Portfolio::apply`]).
//!
//! Port of `src/trading/Portfolio.ts` + `src/trading/capital.ts`. The state a
//! strategy reads is [`PortfolioView`]; it *is* the portfolio's own state
//! (no per-tick copy), handed out as `&PortfolioView`.
//!
//! Robust to live event ordering, like the TS original:
//! - fills are de-duplicated by id (splits / merges by operation id);
//! - a fill that arrives before its order's exchange id is known is buffered
//!   and attached once the id is acknowledged;
//! - a client id can be reused after its order closed: events carrying the
//!   older exchange id never touch the newer generation;
//! - cash obligations of BUY orders (reservations) are tracked separately from
//!   the strategy-facing order record, and are released only by authoritative
//!   final quantities (rejection, kill, fill, or a done event with `filled_size`).

use crate::fixed::{Price, Qty, Round, Usdc};
use crate::model::{
    AccountEvent, AssetId, ClientOrderId, DoneReason, Fill, Order, OrderId, OrderState, Position,
    Side, TsMs,
};
use crate::rules::{buy_commitment, FeeModel, ProfileKind};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;

/// TS `DEFAULT_STARTING_CAPITAL` (USDC per market).
pub const DEFAULT_STARTING_CAPITAL: Usdc = Usdc::from_micros(500_000_000);

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Capital {
    pub starting: Usdc,
    pub cash: Usdc,
    /// Unspent BUY commitments and matched BUYs awaiting fills, as applied
    /// to this portfolio.
    pub reserved: Usdc,
    /// Obligations the order manager emitted that the portfolio has not
    /// applied yet (submissions / splits still in the event queue).
    pub pending: Usdc,
}

impl Capital {
    /// `cash - reserved - pending` (TS `availableCash` of the decision snapshot).
    pub fn available(&self) -> Usdc {
        self.cash - self.reserved - self.pending
    }
    /// `reserved + pending` (TS `reservedCash` of the decision snapshot).
    pub fn reserved_total(&self) -> Usdc {
        self.reserved + self.pending
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SplitRecord {
    pub id: Arc<str>,
    pub ts_ms: TsMs,
    pub asset_a: AssetId,
    pub asset_b: AssetId,
    pub size: Qty,
    pub cost: Usdc,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MergeRecord {
    pub id: Arc<str>,
    pub ts_ms: TsMs,
    pub asset_a: AssetId,
    pub asset_b: AssetId,
    /// Pairs actually removed from the positions.
    pub size: Qty,
    /// Collateral credited (the reported size).
    pub proceeds: Usdc,
}

/// Read-only portfolio state handed to strategies.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PortfolioView {
    pub now_ms: TsMs,
    pub capital: Capital,
    pub realized_pnl: Usdc,
    /// Non-zero positions only.
    pub positions: BTreeMap<AssetId, Position>,
    /// Latest order generation per client id, including terminal ones.
    pub orders: BTreeMap<ClientOrderId, Order>,
    /// Fills in arrival order (bounded by `PortfolioConfig::max_recent_fills`).
    pub recent_fills: Vec<Fill>,
    pub splits: Vec<SplitRecord>,
    pub merges: Vec<MergeRecord>,
}

impl PortfolioView {
    pub fn position(&self, asset: &AssetId) -> Option<&Position> {
        self.positions.get(asset)
    }
    pub fn position_qty(&self, asset: &AssetId) -> Qty {
        self.positions.get(asset).map_or(Qty::ZERO, |p| p.qty)
    }
    /// Orders that are not terminal (TS `openOrdersByClientId`).
    pub fn open_orders(&self) -> impl Iterator<Item = &Order> {
        self.orders.values().filter(|o| !o.state.is_terminal())
    }
    pub fn open_order(&self, cid: &ClientOrderId) -> Option<&Order> {
        self.orders.get(cid).filter(|o| !o.state.is_terminal())
    }
    pub fn has_open_orders(&self) -> bool {
        self.open_orders().next().is_some()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PortfolioConfig {
    pub starting_capital: Usdc,
    /// Fee assumed when reserving cash for a non-post-only BUY.
    pub commitment_fee: FeeModel,
    /// TS quirk (true): shares minted by a split carry zero cost basis, so a
    /// later sale books the whole proceeds as realized PnL. False: each side
    /// carries half the split cost.
    pub split_zero_cost_basis: bool,
    /// TS quirk (true): a merge removes shares but keeps the full cost basis
    /// on the remaining shares and realizes nothing. False: the merged pairs'
    /// average cost is removed and `proceeds - cost` is realized.
    pub merge_keeps_cost_basis: bool,
    /// Bound on `recent_fills` (None = keep all; a session is one market).
    pub max_recent_fills: Option<usize>,
}

impl PortfolioConfig {
    pub fn for_profile(profile: ProfileKind, starting_capital: Usdc, fee: FeeModel) -> Self {
        let ts = profile == ProfileKind::TsCompat;
        PortfolioConfig {
            starting_capital,
            commitment_fee: if ts { FeeModel::ts_compat() } else { fee },
            split_zero_cost_basis: ts,
            merge_keeps_cost_basis: ts,
            max_recent_fills: None,
        }
    }
}

impl Default for PortfolioConfig {
    fn default() -> Self {
        Self::for_profile(
            ProfileKind::TsCompat,
            DEFAULT_STARTING_CAPITAL,
            FeeModel::ts_compat(),
        )
    }
}

/// Cash obligation of one submitted order (TS `CashOrder`).
#[derive(Clone, Debug)]
struct CashOrder {
    order_id: Option<OrderId>,
    side: Side,
    price: Price,
    size: Qty,
    post_only: bool,
    filled: Qty,
    /// Authoritative executed quantity once the order is terminal.
    final_filled: Option<Qty>,
}

impl CashOrder {
    fn outstanding(&self) -> Qty {
        (self.final_filled.unwrap_or(self.size) - self.filled).max(Qty::ZERO)
    }
    /// No further reservation possible: final quantity known and reached.
    fn settled(&self) -> bool {
        self.side == Side::Sell || (self.final_filled.is_some() && self.outstanding().is_zero())
    }
}

#[derive(Default, Debug)]
struct CashBook {
    orders: Vec<CashOrder>,
    by_client: HashMap<ClientOrderId, usize>,
    by_order: HashMap<OrderId, usize>,
    /// Indices of BUY orders that may still hold a reservation.
    active: BTreeSet<usize>,
    /// Fill sizes seen for an exchange id before it was linked to a submission.
    unlinked_fills: HashMap<OrderId, Qty>,
}

pub struct Portfolio {
    cfg: PortfolioConfig,
    view: PortfolioView,
    clock_initialized: bool,
    seen_fills: HashSet<Arc<str>>,
    seen_splits: HashSet<Arc<str>>,
    seen_merges: HashSet<Arc<str>>,
    /// Exchange id → client id while the order is open.
    open_by_order_id: HashMap<OrderId, ClientOrderId>,
    /// Exchange id → client id, kept after the order closes (late events).
    client_by_order_id: HashMap<OrderId, ClientOrderId>,
    terminal_order_ids: HashSet<OrderId>,
    /// Fill sizes for an exchange id whose order record does not know the id yet.
    pending_fills: HashMap<OrderId, Qty>,
    cash: CashBook,
}

impl Portfolio {
    pub fn new(cfg: PortfolioConfig) -> Self {
        let view = PortfolioView {
            capital: Capital {
                starting: cfg.starting_capital,
                cash: cfg.starting_capital,
                ..Capital::default()
            },
            ..PortfolioView::default()
        };
        Portfolio {
            cfg,
            view,
            clock_initialized: false,
            seen_fills: HashSet::new(),
            seen_splits: HashSet::new(),
            seen_merges: HashSet::new(),
            open_by_order_id: HashMap::new(),
            client_by_order_id: HashMap::new(),
            terminal_order_ids: HashSet::new(),
            pending_fills: HashMap::new(),
            cash: CashBook::default(),
        }
    }

    pub fn config(&self) -> &PortfolioConfig {
        &self.cfg
    }

    pub fn view(&self) -> &PortfolioView {
        &self.view
    }

    /// The first observed tick/event sets the clock.
    pub fn initialize_clock(&mut self, now_ms: TsMs) {
        if !self.clock_initialized {
            self.view.now_ms = now_ms;
            self.clock_initialized = true;
        }
    }

    /// Order-manager obligations not yet applied here (shown in the view).
    pub fn set_pending(&mut self, pending: Usdc) {
        self.view.capital.pending = pending;
    }

    /// True if an exchange id is known to belong to a closed order.
    pub fn is_terminal_order_id(&self, id: &OrderId) -> bool {
        self.terminal_order_ids.contains(id)
    }

    pub fn apply(&mut self, ev: &AccountEvent) {
        let ts = ev.ts_ms();
        self.initialize_clock(ts);
        self.view.now_ms = self.view.now_ms.max(ts);
        self.apply_cash_order_event(ev);
        match ev {
            AccountEvent::OrderSubmitted { order, .. } => self.on_submitted(order),
            AccountEvent::OrderAccepted {
                client_order_id,
                order_id,
                ..
            } => self.on_acknowledged(Some(client_order_id), order_id.as_ref(), false),
            AccountEvent::OrderOpen {
                client_order_id,
                order_id,
                ..
            } => self.on_acknowledged(client_order_id.as_ref(), order_id.as_ref(), true),
            AccountEvent::OrderRejected {
                client_order_id,
                reason,
                ..
            } => self.on_rejected(client_order_id, reason),
            AccountEvent::OrderDone {
                client_order_id,
                order_id,
                reason,
                ..
            } => self.on_done(client_order_id.as_ref(), order_id.as_ref(), *reason),
            AccountEvent::Fill(f) => self.on_fill(f),
            AccountEvent::PositionsSplit {
                id,
                ts_ms,
                asset_a,
                asset_b,
                size,
                cost,
            } => self.on_split(id, *ts_ms, asset_a, asset_b, *size, *cost),
            AccountEvent::PositionsMerged {
                id,
                ts_ms,
                asset_a,
                asset_b,
                size,
            } => self.on_merged(id, *ts_ms, asset_a, asset_b, *size),
            AccountEvent::CancelFailed { .. }
            | AccountEvent::SplitFailed { .. }
            | AccountEvent::MergeFailed { .. }
            | AccountEvent::StreamStatus { .. } => {}
        }
        self.recompute_reserved();
    }

    // ---- order records -------------------------------------------------

    /// An exchange id that differs from the open record's id belongs to an
    /// earlier generation of the same client id.
    fn belongs_to_earlier(&self, o: &Order, order_id: Option<&OrderId>) -> bool {
        match order_id {
            None => false,
            Some(id) if o.order_id.as_ref() == Some(id) => false,
            Some(id) => o.order_id.is_some() || self.client_by_order_id.contains_key(id),
        }
    }

    fn index_order_id(&mut self, cid: &ClientOrderId, oid: &OrderId) {
        self.open_by_order_id.insert(oid.clone(), cid.clone());
        self.client_by_order_id.insert(oid.clone(), cid.clone());
    }

    fn close_record(&mut self, cid: &ClientOrderId, state: OrderState, error: Option<&str>) {
        let now = self.view.now_ms;
        let Some(o) = self.view.orders.get_mut(cid) else {
            return;
        };
        o.state = state;
        o.remaining = Qty::ZERO;
        o.updated_at_ms = now;
        if let Some(e) = error {
            o.last_error = Some(e.to_string());
        }
        if let Some(oid) = o.order_id.clone() {
            self.open_by_order_id.remove(&oid);
            self.terminal_order_ids.insert(oid);
        }
    }

    fn on_submitted(&mut self, order: &Order) {
        let mut o = order.clone();
        o.updated_at_ms = self.view.now_ms;
        let cid = o.client_order_id.clone();
        let oid = o.order_id.clone();
        self.view.orders.insert(cid.clone(), o);
        if let Some(oid) = oid {
            self.index_order_id(&cid, &oid);
            self.apply_pending_fills(&oid);
        }
    }

    fn on_acknowledged(&mut self, cid: Option<&ClientOrderId>, oid: Option<&OrderId>, open: bool) {
        let cid = match (cid, oid) {
            (Some(c), _) => c.clone(),
            (None, Some(id)) => match self.open_by_order_id.get(id) {
                Some(c) => c.clone(),
                None => return,
            },
            (None, None) => return,
        };
        let Some(o) = self.view.open_order(&cid) else {
            return;
        };
        if self.belongs_to_earlier(o, oid) {
            return;
        }
        let now = self.view.now_ms;
        let o = self.view.orders.get_mut(&cid).expect("open order exists");
        if let Some(id) = oid {
            o.order_id = Some(id.clone());
        }
        if o.state == OrderState::Requested || (open && o.filled.is_zero()) {
            o.state = OrderState::Open;
        }
        o.updated_at_ms = now;
        if let Some(id) = o.order_id.clone() {
            self.index_order_id(&cid, &id);
            self.apply_pending_fills(&id);
        }
    }

    fn on_rejected(&mut self, cid: &ClientOrderId, reason: &str) {
        if self.view.open_order(cid).is_none() {
            return;
        }
        self.close_record(cid, OrderState::Rejected, Some(reason));
    }

    fn on_done(&mut self, cid: Option<&ClientOrderId>, oid: Option<&OrderId>, reason: DoneReason) {
        if let Some(id) = oid {
            self.terminal_order_ids.insert(id.clone());
        }
        let cid = match (cid, oid) {
            (Some(c), _) => c.clone(),
            (None, Some(id)) => match self
                .open_by_order_id
                .get(id)
                .or_else(|| self.client_by_order_id.get(id))
            {
                Some(c) => c.clone(),
                None => return,
            },
            (None, None) => return,
        };
        let Some(o) = self.view.open_order(&cid) else {
            return; // already terminal (e.g. fully filled by fills)
        };
        if self.belongs_to_earlier(o, oid) {
            return;
        }
        let state = match reason {
            DoneReason::Filled => OrderState::Filled,
            DoneReason::Canceled => OrderState::Canceled,
            DoneReason::Expired => OrderState::Expired,
            DoneReason::Killed => OrderState::Killed,
        };
        self.close_record(&cid, state, None);
    }

    fn apply_fill_to_record(&mut self, cid: &ClientOrderId, size: Qty) {
        let now = self.view.now_ms;
        let Some(o) = self.view.orders.get_mut(cid) else {
            return;
        };
        o.filled += size;
        o.remaining = (o.size - o.filled).max(Qty::ZERO);
        o.updated_at_ms = now;
        o.state = if o.remaining.is_positive() {
            OrderState::PartiallyFilled
        } else {
            OrderState::Filled
        };
        if o.state == OrderState::Filled {
            if let Some(oid) = o.order_id.clone() {
                self.open_by_order_id.remove(&oid);
            }
        }
    }

    fn apply_pending_fills(&mut self, oid: &OrderId) {
        let Some(cid) = self.open_by_order_id.get(oid).cloned() else {
            return;
        };
        if self.view.open_order(&cid).is_none() {
            return;
        }
        if let Some(size) = self.pending_fills.remove(oid) {
            if size.is_positive() {
                self.apply_fill_to_record(&cid, size);
            }
        }
    }

    fn apply_fill_to_orders(&mut self, f: &Fill) {
        let cid = f.client_order_id.clone().or_else(|| {
            f.order_id
                .as_ref()
                .and_then(|id| self.open_by_order_id.get(id).cloned())
        });
        let open = cid.as_ref().and_then(|c| self.view.open_order(c));
        if let Some(o) = open {
            if self.belongs_to_earlier(o, f.order_id.as_ref()) {
                return;
            }
        }
        let unknown_id = open.is_some_and(|o| o.order_id.is_none()) && f.order_id.is_some();
        if cid.is_none() || unknown_id {
            // Fill before we know/mapped the exchange id: buffer by exchange id.
            if let Some(id) = &f.order_id {
                *self.pending_fills.entry(id.clone()).or_default() += f.size;
            }
            return;
        }
        if open.is_none() {
            return;
        }
        let cid = cid.expect("checked above");
        self.apply_fill_to_record(&cid, f.size);
    }

    // ---- fills, positions ---------------------------------------------

    fn on_fill(&mut self, f: &Fill) {
        if !f.size.is_positive() || f.price.micros() < 0 {
            return;
        }
        if !self.seen_fills.insert(f.id.clone()) {
            return;
        }
        self.apply_cash_fill(f);
        self.view.recent_fills.push(f.clone());
        if let Some(max) = self.cfg.max_recent_fills {
            let len = self.view.recent_fills.len();
            if len > max {
                self.view.recent_fills.drain(0..len - max);
            }
        }
        self.apply_fill_to_orders(f);
        self.apply_fill_to_position(f);
    }

    fn apply_fill_to_position(&mut self, f: &Fill) {
        match f.side {
            Side::Buy => {
                let pos = self.view.positions.entry(f.asset_id.clone()).or_default();
                pos.qty += f.size;
                pos.cost_basis += f.price.notional(f.size, Round::Nearest) + f.fee;
            }
            Side::Sell => {
                let prev = self
                    .view
                    .positions
                    .get(&f.asset_id)
                    .cloned()
                    .unwrap_or_default();
                // Shares beyond the position are ignored for position/PnL
                // (cash still receives the full proceeds, as in TS).
                let sell_qty = f.size.min(prev.qty).max(Qty::ZERO);
                let cost_removed = proportional(prev.cost_basis, sell_qty, prev.qty);
                let proceeds = f.price.notional(sell_qty, Round::Nearest) - f.fee;
                self.view.realized_pnl += proceeds - cost_removed;
                let remaining = prev.qty - sell_qty;
                if remaining.is_positive() {
                    let pos = self.view.positions.entry(f.asset_id.clone()).or_default();
                    pos.qty = remaining;
                    pos.cost_basis = (prev.cost_basis - cost_removed).max(Usdc::ZERO);
                } else {
                    self.view.positions.remove(&f.asset_id);
                }
            }
        }
    }

    fn on_split(
        &mut self,
        id: &Arc<str>,
        ts_ms: TsMs,
        a: &AssetId,
        b: &AssetId,
        size: Qty,
        cost: Usdc,
    ) {
        if a == b || !size.is_positive() || cost.micros() < 0 {
            return;
        }
        if !self.seen_splits.insert(id.clone()) {
            return;
        }
        self.view.capital.cash -= cost;
        let basis_a = if self.cfg.split_zero_cost_basis {
            Usdc::ZERO
        } else {
            Usdc::from_micros(cost.micros() / 2)
        };
        let basis_b = if self.cfg.split_zero_cost_basis {
            Usdc::ZERO
        } else {
            cost - basis_a
        };
        for (asset, basis) in [(a, basis_a), (b, basis_b)] {
            let pos = self.view.positions.entry(asset.clone()).or_default();
            pos.qty += size;
            pos.cost_basis += basis;
        }
        self.view.splits.push(SplitRecord {
            id: id.clone(),
            ts_ms,
            asset_a: a.clone(),
            asset_b: b.clone(),
            size,
            cost,
        });
    }

    fn on_merged(&mut self, id: &Arc<str>, ts_ms: TsMs, a: &AssetId, b: &AssetId, size: Qty) {
        if a == b || !size.is_positive() {
            return;
        }
        if !self.seen_merges.insert(id.clone()) {
            return;
        }
        // The event reports confirmed collateral proceeds (1 USDC per pair).
        let proceeds = Usdc::from_micros(size.micros());
        self.view.capital.cash += proceeds;
        let qa = self.view.position_qty(a);
        let qb = self.view.position_qty(b);
        let actual = size.min(qa).min(qb);
        if !actual.is_positive() {
            return;
        }
        let mut cost_removed = Usdc::ZERO;
        for asset in [a, b] {
            let Some(pos) = self.view.positions.get_mut(asset) else {
                continue;
            };
            if !self.cfg.merge_keeps_cost_basis {
                let removed = proportional(pos.cost_basis, actual, pos.qty);
                pos.cost_basis -= removed;
                cost_removed += removed;
            }
            pos.qty -= actual;
            if !pos.qty.is_positive() {
                self.view.positions.remove(asset);
            }
        }
        if !self.cfg.merge_keeps_cost_basis {
            self.view.realized_pnl += Usdc::from_micros(actual.micros()) - cost_removed;
        }
        self.view.merges.push(MergeRecord {
            id: id.clone(),
            ts_ms,
            asset_a: a.clone(),
            asset_b: b.clone(),
            size: actual,
            proceeds,
        });
    }

    // ---- capital -------------------------------------------------------

    fn link_cash_order(&mut self, cid: &ClientOrderId, oid: &OrderId) {
        if let Some(o) = self.view.open_order(cid) {
            if self.belongs_to_earlier(o, Some(oid)) {
                return;
            }
        }
        let Some(&local) = self.cash.by_client.get(cid) else {
            return;
        };
        // A closed generation keeps its own exchange identity.
        match &self.cash.orders[local].order_id {
            Some(existing) if existing != oid => return,
            _ => {}
        }
        self.cash.orders[local].order_id = Some(oid.clone());
        if let Some(&exchange) = self.cash.by_order.get(oid) {
            if exchange != local {
                let ex = self.cash.orders[exchange].clone();
                let lo = &mut self.cash.orders[local];
                lo.filled = lo.filled.max(ex.filled);
                if ex.final_filled.is_some() {
                    lo.final_filled = ex.final_filled;
                }
                self.cash.active.remove(&exchange);
            }
        }
        if let Some(extra) = self.cash.unlinked_fills.remove(oid) {
            self.cash.orders[local].filled += extra;
        }
        self.cash.by_order.insert(oid.clone(), local);
    }

    fn apply_cash_order_event(&mut self, ev: &AccountEvent) {
        match ev {
            AccountEvent::OrderSubmitted { order, .. } => {
                let idx = self.cash.orders.len();
                self.cash.orders.push(CashOrder {
                    order_id: None,
                    side: order.side,
                    price: order.price,
                    size: order.size,
                    post_only: order.post_only,
                    filled: order.filled,
                    final_filled: None,
                });
                if order.side == Side::Buy {
                    self.cash.active.insert(idx);
                }
                self.cash
                    .by_client
                    .insert(order.client_order_id.clone(), idx);
                if let Some(oid) = &order.order_id {
                    self.link_cash_order(&order.client_order_id, oid);
                }
            }
            AccountEvent::OrderAccepted {
                client_order_id,
                order_id: Some(oid),
                ..
            }
            | AccountEvent::OrderOpen {
                client_order_id: Some(client_order_id),
                order_id: Some(oid),
                ..
            } => self.link_cash_order(client_order_id, oid),
            AccountEvent::OrderRejected {
                client_order_id, ..
            } => {
                // Only the currently submitted order can be released by a
                // rejection; an earlier closed generation may still await fills.
                if self.view.open_order(client_order_id).is_none() {
                    return;
                }
                if let Some(&idx) = self.cash.by_client.get(client_order_id) {
                    self.finalize_cash_order(idx, Qty::ZERO);
                }
            }
            AccountEvent::OrderDone {
                client_order_id,
                order_id,
                reason,
                filled_size,
                ..
            } => {
                let idx = match order_id {
                    Some(oid) => self.cash.by_order.get(oid).copied(),
                    None => client_order_id
                        .as_ref()
                        .and_then(|c| self.cash.by_client.get(c).copied()),
                };
                let Some(idx) = idx else { return };
                let filled = match reason {
                    DoneReason::Killed => Some(Qty::ZERO),
                    DoneReason::Filled => Some(self.cash.orders[idx].size),
                    _ => *filled_size,
                };
                // Without a final quantity, keep the obligation until one arrives.
                if let Some(f) = filled {
                    self.finalize_cash_order(idx, f);
                }
            }
            _ => {}
        }
    }

    fn finalize_cash_order(&mut self, idx: usize, filled: Qty) {
        let o = &mut self.cash.orders[idx];
        let fin = filled.max(o.filled).max(o.final_filled.unwrap_or(Qty::ZERO));
        o.final_filled = Some(fin);
    }

    fn apply_cash_fill(&mut self, f: &Fill) {
        let notional = f.price.notional(f.size, Round::Nearest);
        match f.side {
            Side::Buy => self.view.capital.cash -= notional + f.fee,
            Side::Sell => self.view.capital.cash += notional - f.fee,
        }
        if let (Some(oid), Some(cid)) = (&f.order_id, &f.client_order_id) {
            if !self.cash.by_order.contains_key(oid) {
                self.link_cash_order(cid, oid);
            }
        }
        let idx = match &f.order_id {
            Some(oid) => self.cash.by_order.get(oid).copied(),
            None => f
                .client_order_id
                .as_ref()
                .and_then(|c| self.cash.by_client.get(c).copied()),
        };
        match (idx, &f.order_id) {
            (Some(i), _) => self.cash.orders[i].filled += f.size,
            (None, Some(oid)) => *self.cash.unlinked_fills.entry(oid.clone()).or_default() += f.size,
            (None, None) => {}
        }
    }

    fn recompute_reserved(&mut self) {
        let mut reserved = Usdc::ZERO;
        let mut settled = Vec::new();
        for &i in &self.cash.active {
            let o = &self.cash.orders[i];
            if o.settled() {
                settled.push(i);
                continue;
            }
            reserved += buy_commitment(&self.cfg.commitment_fee, o.price, o.outstanding(), o.post_only);
        }
        for i in settled {
            self.cash.active.remove(&i);
        }
        self.view.capital.reserved = reserved;
    }
}

/// `total * part / whole`, rounded to the nearest micro (0 if `whole` is 0).
fn proportional(total: Usdc, part: Qty, whole: Qty) -> Usdc {
    if !whole.is_positive() {
        return Usdc::ZERO;
    }
    let num = total.micros() as i128 * part.micros() as i128;
    let den = whole.micros() as i128;
    let q = num.div_euclid(den);
    let r = num.rem_euclid(den);
    Usdc::from_micros((if r * 2 >= den { q + 1 } else { q }) as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Liquidity, OrderType};

    fn usd(v: f64) -> Usdc {
        Usdc::from_f64(v)
    }
    fn q(v: f64) -> Qty {
        Qty::from_f64(v)
    }
    fn up() -> AssetId {
        AssetId::new("101")
    }
    fn down() -> AssetId {
        AssetId::new("102")
    }
    fn cid(s: &str) -> ClientOrderId {
        ClientOrderId::new(s)
    }
    fn oid(s: &str) -> OrderId {
        OrderId(Arc::from(s))
    }

    fn order(id: &str, side: Side, size: f64, price: f64) -> Order {
        Order {
            client_order_id: cid(id),
            order_id: None,
            market: None,
            asset_id: up(),
            side,
            price: Price::from_f64(price),
            size: q(size),
            remaining: q(size),
            filled: Qty::ZERO,
            order_type: OrderType::Gtc,
            post_only: false,
            expire_at_ms: None,
            meta: None,
            state: OrderState::Requested,
            created_at_ms: 1000,
            updated_at_ms: 1000,
            last_error: None,
        }
    }

    fn submit(p: &mut Portfolio, id: &str, size: f64, price: f64) {
        p.apply(&AccountEvent::OrderSubmitted {
            ts_ms: 1000,
            order: order(id, Side::Buy, size, price),
        });
        p.apply(&AccountEvent::OrderAccepted {
            ts_ms: 1000,
            client_order_id: cid(id),
            order_id: Some(oid(&format!("ex-{id}"))),
        });
    }

    fn fill(id: &str, size: f64, side: Side, ex: &str, client: &str, price: f64) -> AccountEvent {
        let fee = FeeModel::ts_compat().taker_fee(Price::from_f64(price), q(size));
        AccountEvent::Fill(Fill {
            id: Arc::from(id),
            ts_ms: 1100,
            market: None,
            asset_id: up(),
            side,
            price: Price::from_f64(price),
            size: q(size),
            fee,
            client_order_id: Some(cid(client)),
            order_id: Some(oid(ex)),
            liquidity: Some(Liquidity::Taker),
            meta: None,
        })
    }

    fn buy_fill(id: &str, size: f64) -> AccountEvent {
        fill(id, size, Side::Buy, "ex-a", "a", 0.6)
    }

    fn done(ex: &str, reason: DoneReason, filled: Option<f64>) -> AccountEvent {
        AccountEvent::OrderDone {
            ts_ms: 1101,
            client_order_id: None,
            order_id: Some(oid(ex)),
            reason,
            filled_size: filled.map(q),
        }
    }

    fn new_portfolio(start: f64) -> Portfolio {
        Portfolio::new(PortfolioConfig {
            starting_capital: usd(start),
            ..PortfolioConfig::default()
        })
    }

    #[test]
    fn reservation_released_by_fills_and_unknown_cancel_keeps_hold() {
        // TS: "REST cancellation acknowledgement and failed cancellation cannot release unknown fills"
        let mut p = new_portfolio(500.0);
        submit(&mut p, "a", 800.0, 0.6);
        assert_eq!(p.view().capital.reserved, usd(493.44));
        p.apply(&AccountEvent::CancelFailed {
            ts_ms: 1100,
            operation: crate::model::CancelOp::CancelOrder,
            client_order_id: Some(cid("a")),
            order_id: None,
            reason: "offline".into(),
        });
        // done without filled size: obligation retained
        p.apply(&done("ex-a", DoneReason::Canceled, None));
        assert_eq!(p.view().capital.reserved, usd(493.44));
        // authoritative final quantity of 300 shares
        p.apply(&done("ex-a", DoneReason::Canceled, Some(300.0)));
        assert_eq!(p.view().capital.reserved, usd(185.04));
        p.apply(&buy_fill("late", 300.0));
        p.apply(&buy_fill("late", 300.0)); // duplicate ignored
        let c = &p.view().capital;
        assert_eq!(c.cash, usd(314.96));
        assert_eq!(c.reserved, Usdc::ZERO);
        assert_eq!(c.available(), usd(314.96));
    }

    #[test]
    fn filled_status_before_fills_preserves_committed_cash() {
        let mut p = new_portfolio(500.0);
        submit(&mut p, "a", 800.0, 0.6);
        p.apply(&done("ex-a", DoneReason::Filled, None));
        assert_eq!(p.view().capital.available(), usd(6.56));
        p.apply(&buy_fill("one", 300.0));
        assert_eq!(p.view().capital.available(), usd(6.56));
        p.apply(&buy_fill("two", 500.0));
        p.apply(&buy_fill("one", 300.0));
        p.apply(&done("ex-a", DoneReason::Filled, None));
        assert_eq!(p.view().capital.cash, usd(6.56));
        assert_eq!(p.view().capital.reserved, Usdc::ZERO);
        assert_eq!(p.view().position_qty(&up()), q(800.0));
    }

    #[test]
    fn fill_before_ack_and_client_id_reuse_keep_separate_obligations() {
        let mut p = new_portfolio(500.0);
        submit(&mut p, "a", 800.0, 0.6);
        p.apply(&done("ex-a", DoneReason::Canceled, Some(300.0)));
        p.apply(&AccountEvent::OrderSubmitted {
            ts_ms: 1200,
            order: order("a", Side::Buy, 100.0, 0.6),
        });
        p.apply(&buy_fill("old", 300.0));
        p.apply(&fill("new", 100.0, Side::Buy, "ex-new", "a", 0.6));
        // The replacement fill is buffered until its id is acknowledged.
        assert_eq!(p.view().orders[&cid("a")].filled, Qty::ZERO);
        p.apply(&AccountEvent::OrderAccepted {
            ts_ms: 1300,
            client_order_id: cid("a"),
            order_id: Some(oid("ex-new")),
        });
        assert_eq!(p.view().orders[&cid("a")].filled, q(100.0));
        // A late ack for the old generation cannot touch the replacement.
        p.apply(&AccountEvent::OrderOpen {
            ts_ms: 1301,
            client_order_id: Some(cid("a")),
            order_id: Some(oid("ex-a")),
        });
        assert_eq!(p.view().orders[&cid("a")].order_id, Some(oid("ex-new")));
        assert_eq!(p.view().capital.cash, usd(253.28));
        assert_eq!(p.view().capital.reserved, Usdc::ZERO);
    }

    #[test]
    fn late_ack_cannot_merge_closed_replacement_with_older_fill() {
        let mut p = new_portfolio(1000.0);
        submit(&mut p, "a", 500.0, 0.6);
        p.apply(&done("ex-a", DoneReason::Filled, None));
        p.apply(&AccountEvent::OrderSubmitted {
            ts_ms: 1200,
            order: order("a", Side::Buy, 100.0, 0.6),
        });
        p.apply(&AccountEvent::OrderAccepted {
            ts_ms: 1200,
            client_order_id: cid("a"),
            order_id: Some(oid("ex-new")),
        });
        p.apply(&fill("replacement", 100.0, Side::Buy, "ex-new", "a", 0.6));
        p.apply(&done("ex-new", DoneReason::Filled, None));
        let expected = p.view().capital.clone();
        assert_eq!(expected.reserved, usd(308.4));
        p.apply(&AccountEvent::OrderAccepted {
            ts_ms: 1300,
            client_order_id: cid("a"),
            order_id: Some(oid("ex-a")),
        });
        p.apply(&AccountEvent::OrderOpen {
            ts_ms: 1301,
            client_order_id: Some(cid("a")),
            order_id: Some(oid("ex-a")),
        });
        assert_eq!(p.view().capital, expected);
        p.apply(&fill("original", 500.0, Side::Buy, "ex-a", "a", 0.6));
        assert_eq!(p.view().capital.reserved, Usdc::ZERO);
        assert_eq!(p.view().capital.cash, usd(629.92));
    }

    #[test]
    fn taker_fee_capitalized_on_buy_and_deducted_on_sell() {
        let mut p = new_portfolio(500.0);
        submit(&mut p, "a", 10.0, 0.5);
        p.apply(&fill("b1", 10.0, Side::Buy, "ex-a", "a", 0.5));
        // 10*0.5 + fee(0.07*0.25*10=0.175)
        let pos = p.view().position(&up()).unwrap().clone();
        assert_eq!(pos.qty, q(10.0));
        assert_eq!(pos.cost_basis, usd(5.175));
        assert_eq!(p.view().capital.cash, usd(500.0 - 5.175));
        p.apply(&fill("s1", 4.0, Side::Sell, "ex-s", "s", 0.6));
        // proceeds 2.4 - fee(0.07*0.24*4 = 0.0672) ; cost removed 5.175*0.4 = 2.07
        assert_eq!(p.view().realized_pnl, usd(2.4 - 0.0672 - 2.07));
        assert_eq!(p.view().position(&up()).unwrap().qty, q(6.0));
        assert_eq!(p.view().position(&up()).unwrap().cost_basis, usd(3.105));
        p.apply(&fill("s2", 6.0, Side::Sell, "ex-s", "s", 0.6));
        assert!(p.view().position(&up()).is_none());
    }

    #[test]
    fn maker_fills_pay_no_fee() {
        let mut p = new_portfolio(500.0);
        submit(&mut p, "a", 10.0, 0.5);
        let mut ev = fill("m", 10.0, Side::Buy, "ex-a", "a", 0.5);
        if let AccountEvent::Fill(f) = &mut ev {
            f.fee = Usdc::ZERO;
            f.liquidity = Some(Liquidity::Maker);
        }
        p.apply(&ev);
        assert_eq!(p.view().capital.cash, usd(495.0));
        assert_eq!(p.view().orders[&cid("a")].state, OrderState::Filled);
        assert_eq!(p.view().capital.reserved, Usdc::ZERO);
    }

    #[test]
    fn rejection_and_kill_release_reservation() {
        let mut p = new_portfolio(500.0);
        p.apply(&AccountEvent::OrderSubmitted {
            ts_ms: 1000,
            order: order("r", Side::Buy, 100.0, 0.5),
        });
        assert!(p.view().capital.reserved.is_positive());
        p.apply(&AccountEvent::OrderRejected {
            ts_ms: 1000,
            client_order_id: cid("r"),
            reason: "post_only_would_cross".into(),
        });
        assert_eq!(p.view().capital.reserved, Usdc::ZERO);
        assert_eq!(p.view().orders[&cid("r")].state, OrderState::Rejected);
        submit(&mut p, "k", 100.0, 0.5);
        p.apply(&done("ex-k", DoneReason::Killed, None));
        assert_eq!(p.view().capital.reserved, Usdc::ZERO);
        assert_eq!(p.view().orders[&cid("k")].state, OrderState::Killed);
        assert_eq!(p.view().capital.available(), usd(500.0));
    }

    #[test]
    fn split_and_merge_ts_compat_accounting() {
        let mut p = new_portfolio(500.0);
        let split = AccountEvent::PositionsSplit {
            id: Arc::from("s1"),
            ts_ms: 1000,
            asset_a: up(),
            asset_b: down(),
            size: q(300.0),
            cost: usd(300.0),
        };
        p.apply(&split);
        p.apply(&split); // idempotent
        assert_eq!(p.view().capital.cash, usd(200.0));
        assert_eq!(p.view().position_qty(&up()), q(300.0));
        assert_eq!(p.view().position(&up()).unwrap().cost_basis, Usdc::ZERO);
        let merge = AccountEvent::PositionsMerged {
            id: Arc::from("m1"),
            ts_ms: 1100,
            asset_a: up(),
            asset_b: down(),
            size: q(100.0),
        };
        p.apply(&merge);
        p.apply(&merge);
        assert_eq!(p.view().capital.cash, usd(300.0));
        assert_eq!(p.view().position_qty(&down()), q(200.0));
        assert_eq!(p.view().realized_pnl, Usdc::ZERO);
        assert_eq!(p.view().splits.len(), 1);
        assert_eq!(p.view().merges.len(), 1);
    }

    #[test]
    fn split_and_merge_realistic_accounting() {
        let mut p = Portfolio::new(PortfolioConfig::for_profile(
            ProfileKind::Realistic,
            usd(500.0),
            FeeModel::None,
        ));
        p.apply(&AccountEvent::PositionsSplit {
            id: Arc::from("s1"),
            ts_ms: 1000,
            asset_a: up(),
            asset_b: down(),
            size: q(10.0),
            cost: usd(10.0),
        });
        assert_eq!(p.view().position(&up()).unwrap().cost_basis, usd(5.0));
        p.apply(&AccountEvent::PositionsMerged {
            id: Arc::from("m1"),
            ts_ms: 1100,
            asset_a: up(),
            asset_b: down(),
            size: q(4.0),
        });
        // proceeds 4, cost removed 2 + 2
        assert_eq!(p.view().realized_pnl, Usdc::ZERO);
        assert_eq!(p.view().position(&up()).unwrap().cost_basis, usd(3.0));
        assert_eq!(p.view().capital.cash, usd(494.0));
    }

    #[test]
    fn partial_fill_then_cancel_keeps_accounting() {
        let mut p = new_portfolio(500.0);
        submit(&mut p, "a", 10.0, 0.5);
        p.apply(&fill("f1", 2.0, Side::Buy, "ex-a", "a", 0.5));
        let o = &p.view().orders[&cid("a")];
        assert_eq!(o.state, OrderState::PartiallyFilled);
        assert_eq!(o.remaining, q(8.0));
        p.apply(&AccountEvent::OrderOpen {
            ts_ms: 1100,
            client_order_id: Some(cid("a")),
            order_id: Some(oid("ex-a")),
        });
        assert_eq!(p.view().orders[&cid("a")].state, OrderState::PartiallyFilled);
        p.apply(&AccountEvent::OrderDone {
            ts_ms: 1200,
            client_order_id: Some(cid("a")),
            order_id: Some(oid("ex-a")),
            reason: DoneReason::Canceled,
            filled_size: Some(q(2.0)),
        });
        let o = &p.view().orders[&cid("a")];
        assert_eq!(o.state, OrderState::Canceled);
        assert_eq!(o.filled, q(2.0));
        assert_eq!(p.view().capital.reserved, Usdc::ZERO);
        assert!(!p.view().has_open_orders());
        assert!(p.is_terminal_order_id(&oid("ex-a")));
    }

    #[test]
    fn clock_initialized_by_first_event() {
        let mut p = new_portfolio(500.0);
        assert_eq!(p.view().now_ms, 0);
        p.apply(&AccountEvent::StreamStatus {
            ts_ms: 5000,
            connected: true,
            info: None,
        });
        assert_eq!(p.view().now_ms, 5000);
        p.initialize_clock(9000);
        assert_eq!(p.view().now_ms, 5000);
        p.apply(&AccountEvent::StreamStatus {
            ts_ms: 4000,
            connected: true,
            info: None,
        });
        assert_eq!(p.view().now_ms, 5000);
    }
}
