//! Order manager: validates intents, applies risk and capital gates,
//! de-duplicates client ids, resolves cancel references and dispatches
//! commands to an [`Execution`] adapter (or simulates them in dry-run).
//!
//! Port of `src/trading/OrderManager.ts`, `riskLimits.ts` and
//! `cancellation.ts` in "immediate" mode (the mode used by backtests and the
//! live default). Synthesized events (`order_submitted`, risk/validation
//! `order_rejected`, `cancel_failed`, `split_failed`, `merge_failed`) are
//! appended to the caller's queue in the same order as the TS engine.

use crate::execution::{CancelTarget, ExecCommand, Execution};
use crate::fixed::{Price, Qty, Usdc};
use crate::market::MarketBooks;
use crate::model::{
    AccountEvent, AssetId, CancelOp, ClientOrderId, ConditionId, DoneReason, ExchangeRules,
    Intent, MarketInfo, Order, OrderId, OrderRef, OrderRequest, OrderState, OrderType, Side, TsMs,
};
use crate::portfolio::PortfolioView;
use crate::rules::{buy_commitment, validate_against_rules, FeeModel, ProfileKind};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// TS `DEFAULT_RISK_LIMITS`.
#[derive(Clone, Debug, PartialEq)]
pub struct RiskLimits {
    /// Maximum open orders (global).
    pub max_open_orders: usize,
    /// Maximum shares per single order.
    pub max_order_size: Qty,
    /// Maximum absolute projected position per asset (shares).
    pub max_abs_position: Qty,
    /// New placements are blocked once realized PnL <= -max_loss_stop.
    pub max_loss_stop: Usdc,
}

impl Default for RiskLimits {
    fn default() -> Self {
        RiskLimits {
            max_open_orders: 100,
            max_order_size: Qty::from_micros(2_000_000_000),
            max_abs_position: Qty::from_micros(2_000_000_000),
            max_loss_stop: Usdc::from_micros(500_000_000),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct OrderManagerConfig {
    /// Simulate acceptance / cancellation locally; nothing reaches the adapter.
    pub dry_run: bool,
    pub risk: RiskLimits,
    /// Fee assumed when reserving cash for a non-post-only BUY (TS: 700 bps).
    pub commitment_fee: FeeModel,
    /// TS quirk (false): no tick-size / price-bound / min-size validation.
    pub validate_exchange_rules: bool,
    /// TS quirk (false): the backtest accepts batches of any size (only the
    /// live adapter rejects > 15). True: reject the whole batch up front.
    pub enforce_batch_cap: bool,
    /// TS quirk (false): a SELL is not checked against held shares, so a
    /// naked sale fills and credits cash. True: reject SELL size above the
    /// uncommitted position.
    pub require_sell_inventory: bool,
    /// Maximum references in one cancel batch (TS: 3000).
    pub max_cancel_batch: usize,
}

impl OrderManagerConfig {
    pub fn for_profile(profile: ProfileKind, fee: FeeModel) -> Self {
        let ts = profile == ProfileKind::TsCompat;
        OrderManagerConfig {
            dry_run: false,
            risk: RiskLimits::default(),
            commitment_fee: if ts { FeeModel::ts_compat() } else { fee },
            validate_exchange_rules: !ts,
            enforce_batch_cap: !ts,
            require_sell_inventory: !ts,
            max_cancel_batch: 3000,
        }
    }
}

impl Default for OrderManagerConfig {
    fn default() -> Self {
        Self::for_profile(ProfileKind::TsCompat, FeeModel::ts_compat())
    }
}

/// What the order manager reads while handling one intent list.
pub struct OmCtx<'a> {
    pub now: TsMs,
    pub books: &'a MarketBooks,
    pub portfolio: &'a PortfolioView,
    pub market: &'a MarketInfo,
    pub rules: &'a ExchangeRules,
}

#[derive(Clone, Debug)]
struct Unapplied {
    side: Side,
    asset: AssetId,
    size: Qty,
    commitment: Usdc,
}

/// Local copy of order references kept current within one intent list
/// (TS `executeIntentsNow` trackReferences): e.g. place then cancel the
/// acknowledged order, or cancel then re-place the same client id.
#[derive(Clone, Debug)]
struct RefOrder {
    order_id: Option<OrderId>,
    state: OrderState,
    filled: Qty,
    asset: AssetId,
    market: Option<ConditionId>,
}

impl RefOrder {
    fn open(&self) -> bool {
        !self.state.is_terminal()
    }
}

struct Refs {
    orders: Vec<(ClientOrderId, RefOrder)>,
}

impl Refs {
    fn from_view(v: &PortfolioView) -> Refs {
        Refs {
            orders: v
                .orders
                .iter()
                .map(|(cid, o)| {
                    (
                        cid.clone(),
                        RefOrder {
                            order_id: o.order_id.clone(),
                            state: o.state,
                            filled: o.filled,
                            asset: o.asset_id.clone(),
                            market: o.market.clone(),
                        },
                    )
                })
                .collect(),
        }
    }
    fn get(&self, cid: &ClientOrderId) -> Option<&RefOrder> {
        self.orders.iter().find(|(c, _)| c == cid).map(|(_, o)| o)
    }
    fn get_mut(&mut self, cid: &ClientOrderId) -> Option<&mut RefOrder> {
        self.orders.iter_mut().find(|(c, _)| c == cid).map(|(_, o)| o)
    }
    fn open(&self, cid: &ClientOrderId) -> Option<&RefOrder> {
        self.get(cid).filter(|o| o.open())
    }
    fn open_by_order_id(&self, oid: &OrderId) -> Option<(&ClientOrderId, &RefOrder)> {
        self.orders
            .iter()
            .find(|(_, o)| o.open() && o.order_id.as_ref() == Some(oid))
            .map(|(c, o)| (c, o))
    }
    fn any_by_order_id(&self, oid: &OrderId) -> Option<&RefOrder> {
        self.orders
            .iter()
            .find(|(_, o)| o.order_id.as_ref() == Some(oid))
            .map(|(_, o)| o)
    }
    fn upsert(&mut self, cid: &ClientOrderId, o: RefOrder) {
        match self.get_mut(cid) {
            Some(slot) => *slot = o,
            None => self.orders.push((cid.clone(), o)),
        }
    }
}

pub struct OrderManager {
    cfg: OrderManagerConfig,
    /// Client ids with a live submission (dedupe: a repeat is silently dropped).
    active: HashSet<ClientOrderId>,
    /// Submissions emitted but not yet applied by the portfolio.
    unapplied_submissions: HashMap<ClientOrderId, Unapplied>,
    unapplied_splits: HashMap<Arc<str>, Usdc>,
    unapplied_merges: HashMap<Arc<str>, (AssetId, AssetId, Qty)>,
    op_seq: u64,
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.trim() == s
}

fn is_condition_id(s: &str) -> bool {
    s.len() == 66 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_token_id(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// TS `validateCancelScope`.
pub fn validate_cancel_scope(
    market: Option<&ConditionId>,
    asset: Option<&AssetId>,
) -> Result<(), &'static str> {
    if market.is_none() && asset.is_none() {
        return Err("missing_cancel_scope");
    }
    if market.is_some_and(|m| !is_condition_id(&m.0)) {
        return Err("invalid_cancel_market");
    }
    if asset.is_some_and(|a| !is_token_id(a.as_str())) {
        return Err("invalid_cancel_assetId");
    }
    Ok(())
}

/// TS `matchesCancelScope` (market compared case-insensitively).
pub fn matches_cancel_scope(
    order_market: Option<&ConditionId>,
    order_asset: &AssetId,
    market: Option<&ConditionId>,
    asset: Option<&AssetId>,
) -> bool {
    let market_ok = match market {
        None => true,
        Some(m) => order_market.is_some_and(|om| om.0.eq_ignore_ascii_case(&m.0)),
    };
    market_ok && asset.is_none_or(|a| a == order_asset)
}

fn cancel_failed(
    op: CancelOp,
    now: TsMs,
    reason: &str,
    target: Option<&OrderRef>,
) -> AccountEvent {
    AccountEvent::CancelFailed {
        ts_ms: now,
        operation: op,
        client_order_id: target.and_then(|t| t.client_order_id.clone()),
        order_id: target.and_then(|t| t.order_id.clone()),
        reason: reason.to_string(),
    }
}

fn rejected(now: TsMs, cid: &ClientOrderId, reason: String) -> AccountEvent {
    AccountEvent::OrderRejected {
        ts_ms: now,
        client_order_id: cid.clone(),
        reason,
    }
}

impl OrderManager {
    pub fn new(cfg: OrderManagerConfig) -> Self {
        OrderManager {
            cfg,
            active: HashSet::new(),
            unapplied_submissions: HashMap::new(),
            unapplied_splits: HashMap::new(),
            unapplied_merges: HashMap::new(),
            op_seq: 0,
        }
    }

    pub fn config(&self) -> &OrderManagerConfig {
        &self.cfg
    }

    /// Obligations emitted by this manager that the portfolio has not applied
    /// yet (BUY submissions + splits). Added to the strategy's capital view.
    pub fn pending_reserved(&self) -> Usdc {
        let subs: i64 = self
            .unapplied_submissions
            .values()
            .map(|u| u.commitment.micros())
            .sum();
        let splits: i64 = self.unapplied_splits.values().map(|c| c.micros()).sum();
        Usdc::from_micros(subs + splits)
    }

    pub fn is_active(&self, cid: &ClientOrderId) -> bool {
        self.active.contains(cid)
    }

    /// Undispatched decisions belong to the old market, never to the next one.
    pub fn begin_market(&mut self) {
        self.active.clear();
        self.unapplied_submissions.clear();
        self.unapplied_splits.clear();
        self.unapplied_merges.clear();
    }

    /// Must be called after the portfolio applied `ev` (TS `reconcileActiveOrders`).
    pub fn on_event_applied(&mut self, ev: &AccountEvent, portfolio: &PortfolioView) {
        match ev {
            AccountEvent::OrderSubmitted { order, .. } => {
                self.unapplied_submissions.remove(&order.client_order_id);
            }
            AccountEvent::PositionsSplit { id, .. } => {
                self.unapplied_splits.remove(id);
            }
            AccountEvent::PositionsMerged { id, .. } => {
                self.unapplied_merges.remove(id);
            }
            _ => {}
        }
        let unapplied = &self.unapplied_submissions;
        self.active.retain(|cid| {
            unapplied.contains_key(cid)
                || portfolio
                    .orders
                    .get(cid)
                    .is_none_or(|o| !o.state.is_terminal())
        });
    }

    fn available(&self, ctx: &OmCtx<'_>) -> Usdc {
        ctx.portfolio.capital.cash - ctx.portfolio.capital.reserved - self.pending_reserved()
    }

    fn funding_error(&self, cost: Usdc, ctx: &OmCtx<'_>) -> Option<String> {
        let available = self.available(ctx);
        (cost > available).then(|| format!("insufficient_capital(required={cost},available={available})"))
    }

    /// Handle one intent list returned by a strategy callback. Events are
    /// appended to `out` in processing order.
    pub fn handle_intents<E: Execution>(
        &mut self,
        intents: Vec<Intent>,
        ctx: &OmCtx<'_>,
        exec: &mut E,
        out: &mut Vec<AccountEvent>,
    ) {
        if intents.is_empty() {
            return;
        }
        let allowed = self.enforce_risk_limits(intents, ctx, out);
        self.execute_now(allowed, ctx, exec, out);
    }

    // ---- risk ----------------------------------------------------------

    fn enforce_risk_limits(
        &self,
        intents: Vec<Intent>,
        ctx: &OmCtx<'_>,
        out: &mut Vec<AccountEvent>,
    ) -> Vec<Intent> {
        let limits = &self.cfg.risk;
        let p = ctx.portfolio;
        let realized = p.realized_pnl;
        let loss_stop = realized <= -limits.max_loss_stop.abs();
        let mut open_count = 0usize;
        let mut open_buys: HashMap<AssetId, Qty> = HashMap::new();
        let mut open_sells: HashMap<AssetId, Qty> = HashMap::new();
        for o in p.open_orders() {
            open_count += 1;
            let m = if o.side == Side::Buy {
                &mut open_buys
            } else {
                &mut open_sells
            };
            *m.entry(o.asset_id.clone()).or_default() += o.remaining.max(Qty::ZERO);
        }
        let mut allowed = Vec::with_capacity(intents.len());
        // A blocked retry of an active order is not a rejection of the live one.
        let mut reject = |cid: &ClientOrderId, reason: String, out: &mut Vec<AccountEvent>| {
            if !self.active.contains(cid) {
                out.push(rejected(ctx.now, cid, reason));
            }
        };
        let mut check = |o: &OrderRequest,
                         open_count: &mut usize,
                         out: &mut Vec<AccountEvent>|
         -> bool {
            if !o.size.is_positive() {
                return true; // invalid sizes are validation errors, not risk
            }
            if o.size > limits.max_order_size {
                reject(
                    &o.client_order_id,
                    format!("risk_max_order_size(max={})", limits.max_order_size),
                    out,
                );
                return false;
            }
            if *open_count + 1 > limits.max_open_orders {
                reject(
                    &o.client_order_id,
                    format!("risk_max_open_orders(max={})", limits.max_open_orders),
                    out,
                );
                return false;
            }
            let pos = p.position_qty(&o.asset_id);
            let buys = open_buys.get(&o.asset_id).copied().unwrap_or_default();
            let sells = open_sells.get(&o.asset_id).copied().unwrap_or_default();
            let projected = match o.side {
                Side::Buy => pos + buys + o.size,
                Side::Sell => pos - (sells + o.size),
            };
            if projected.abs() > limits.max_abs_position {
                reject(
                    &o.client_order_id,
                    format!("risk_max_abs_position(max={})", limits.max_abs_position),
                    out,
                );
                return false;
            }
            *open_count += 1;
            match o.side {
                Side::Buy => open_buys.insert(o.asset_id.clone(), buys + o.size),
                Side::Sell => open_sells.insert(o.asset_id.clone(), sells + o.size),
            };
            true
        };
        for intent in intents {
            match intent {
                Intent::PlaceBatch { orders, reason } => {
                    if loss_stop {
                        for o in &orders {
                            out.push(rejected(
                                ctx.now,
                                &o.client_order_id,
                                format!("risk_loss_stop(realized={realized})"),
                            ));
                        }
                        continue;
                    }
                    let valid: Vec<OrderRequest> = orders
                        .into_iter()
                        .filter(|o| check(o, &mut open_count, out))
                        .collect();
                    if !valid.is_empty() {
                        allowed.push(Intent::PlaceBatch {
                            orders: valid,
                            reason,
                        });
                    }
                }
                Intent::PlaceLimit(o) => {
                    if loss_stop {
                        let reason = format!("risk_loss_stop(realized={realized})");
                        if !self.active.contains(&o.client_order_id) {
                            out.push(rejected(ctx.now, &o.client_order_id, reason));
                        }
                        continue;
                    }
                    if check(&o, &mut open_count, out) {
                        allowed.push(Intent::PlaceLimit(o));
                    }
                }
                // Cancels never release capacity before confirmed events.
                other => allowed.push(other),
            }
        }
        allowed
    }

    // ---- dispatch ------------------------------------------------------

    fn execute_now<E: Execution>(
        &mut self,
        intents: Vec<Intent>,
        ctx: &OmCtx<'_>,
        exec: &mut E,
        out: &mut Vec<AccountEvent>,
    ) {
        let track = intents.iter().any(|i| {
            matches!(
                i,
                Intent::CancelOrder { .. }
                    | Intent::CancelBatch { .. }
                    | Intent::CancelMarket { .. }
                    | Intent::CancelAll { .. }
            )
        });
        let mut refs = track.then(|| Refs::from_view(ctx.portfolio));
        for intent in intents {
            let start = out.len();
            match intent {
                Intent::PlaceLimit(req) => self.place_limit(req, ctx, exec, out),
                Intent::PlaceBatch { orders, .. } => self.place_batch(orders, ctx, exec, out),
                Intent::CancelOrder { order, .. } => {
                    let refs = refs.as_ref().expect("tracked");
                    self.cancel_order(order, refs, ctx, exec, out)
                }
                Intent::CancelBatch { orders, .. } => {
                    let refs = refs.as_ref().expect("tracked");
                    self.cancel_batch(&orders, refs, ctx, exec, out)
                }
                Intent::CancelMarket {
                    market, asset_id, ..
                } => {
                    let refs = refs.as_ref().expect("tracked");
                    self.cancel_market(market, asset_id, refs, ctx, exec, out)
                }
                Intent::CancelAll { .. } => {
                    let refs = refs.as_ref().expect("tracked");
                    self.cancel_all(refs, ctx, exec, out)
                }
                Intent::SplitPositions {
                    asset_a,
                    asset_b,
                    size,
                    cost_per_share,
                    ..
                } => self.split(asset_a, asset_b, size, cost_per_share, ctx, exec, out),
                Intent::MergePositions {
                    asset_a,
                    asset_b,
                    size,
                    ..
                } => self.merge(asset_a, asset_b, size, ctx, exec, out),
            }
            if let Some(refs) = refs.as_mut() {
                self.track_references(refs, &out[start..]);
            }
        }
    }

    fn track_references(&mut self, refs: &mut Refs, events: &[AccountEvent]) {
        for ev in events {
            match ev {
                AccountEvent::OrderSubmitted { order, .. } => refs.upsert(
                    &order.client_order_id,
                    RefOrder {
                        order_id: order.order_id.clone(),
                        state: order.state,
                        filled: order.filled,
                        asset: order.asset_id.clone(),
                        market: order.market.clone(),
                    },
                ),
                AccountEvent::OrderAccepted {
                    client_order_id,
                    order_id: Some(oid),
                    ..
                } => {
                    if let Some(o) = refs.get_mut(client_order_id).filter(|o| o.open()) {
                        o.order_id = Some(oid.clone());
                    }
                }
                AccountEvent::OrderDone {
                    client_order_id,
                    order_id,
                    reason,
                    ..
                } => {
                    let cid = client_order_id.clone().or_else(|| {
                        order_id
                            .as_ref()
                            .and_then(|id| refs.open_by_order_id(id).map(|(c, _)| c.clone()))
                    });
                    if let Some(cid) = cid {
                        self.close_ref(refs, &cid, done_state(*reason));
                    }
                }
                AccountEvent::OrderRejected {
                    client_order_id, ..
                } => self.close_ref(refs, client_order_id, OrderState::Rejected),
                _ => {}
            }
        }
    }

    fn close_ref(&mut self, refs: &mut Refs, cid: &ClientOrderId, state: OrderState) {
        if let Some(o) = refs.get_mut(cid).filter(|o| o.open()) {
            o.state = state;
        }
        self.active.remove(cid);
    }

    fn validate(&self, req: &OrderRequest, ctx: &OmCtx<'_>) -> Option<String> {
        if !req.price.is_positive() {
            return Some("invalid_price".into());
        }
        if !req.size.is_positive() {
            return Some("invalid_size".into());
        }
        if req.asset_id.as_str().is_empty() {
            return Some("missing_assetId".into());
        }
        if req.post_only && !req.order_type.can_rest() {
            return Some("post_only_requires_gtc_or_gtd".into());
        }
        if req.order_type == OrderType::Gtd {
            let min = ctx.rules.gtd_min_lead_ms.max(0);
            match req.expire_at_ms {
                None => return Some("gtd_requires_expireAtMs".into()),
                Some(t) if t < ctx.now + min => {
                    return Some(format!("gtd_expireAtMs_too_soon(min_offset_ms={min})"))
                }
                Some(_) => {}
            }
        }
        if self.cfg.validate_exchange_rules {
            if let Err(e) = validate_against_rules(ctx.rules, req) {
                return Some(e);
            }
        }
        match req.side {
            Side::Buy => self.funding_error(
                buy_commitment(&self.cfg.commitment_fee, req.price, req.size, req.post_only),
                ctx,
            ),
            Side::Sell if self.cfg.require_sell_inventory => {
                let committed: Qty = ctx
                    .portfolio
                    .open_orders()
                    .filter(|o| o.side == Side::Sell && o.asset_id == req.asset_id)
                    .map(|o| o.remaining)
                    .chain(
                        self.unapplied_submissions
                            .values()
                            .filter(|u| u.side == Side::Sell && u.asset == req.asset_id)
                            .map(|u| u.size),
                    )
                    .fold(Qty::ZERO, |a, b| a + b);
                let free = ctx.portfolio.position_qty(&req.asset_id) - committed;
                (req.size > free)
                    .then(|| format!("insufficient_position(required={},available={free})", req.size))
            }
            Side::Sell => None,
        }
    }

    fn submitted_order(&self, req: &OrderRequest, ctx: &OmCtx<'_>) -> Order {
        Order {
            client_order_id: req.client_order_id.clone(),
            order_id: None,
            market: ctx.market.condition_id.clone(),
            asset_id: req.asset_id.clone(),
            side: req.side,
            price: req.price,
            size: req.size,
            remaining: req.size,
            filled: Qty::ZERO,
            order_type: req.order_type,
            post_only: req.post_only,
            expire_at_ms: if req.order_type == OrderType::Gtd {
                req.expire_at_ms
            } else {
                None
            },
            meta: req.meta.clone(),
            state: OrderState::Requested,
            created_at_ms: ctx.now,
            updated_at_ms: ctx.now,
            last_error: None,
        }
    }

    fn record_submission(&mut self, req: &OrderRequest, ctx: &OmCtx<'_>, out: &mut Vec<AccountEvent>) {
        out.push(AccountEvent::OrderSubmitted {
            ts_ms: ctx.now,
            order: self.submitted_order(req, ctx),
        });
        let commitment = match req.side {
            Side::Buy => buy_commitment(&self.cfg.commitment_fee, req.price, req.size, req.post_only),
            Side::Sell => Usdc::ZERO,
        };
        self.unapplied_submissions.insert(
            req.client_order_id.clone(),
            Unapplied {
                side: req.side,
                asset: req.asset_id.clone(),
                size: req.size,
                commitment,
            },
        );
    }

    fn dry_run_accept(cid: &ClientOrderId, now: TsMs, out: &mut Vec<AccountEvent>) {
        out.push(AccountEvent::OrderAccepted {
            ts_ms: now,
            client_order_id: cid.clone(),
            order_id: None,
        });
        out.push(AccountEvent::OrderOpen {
            ts_ms: now,
            client_order_id: Some(cid.clone()),
            order_id: None,
        });
    }

    fn release_closed(&mut self, events: &[AccountEvent], only: Option<&ClientOrderId>) {
        for ev in events {
            let cid = match ev {
                AccountEvent::OrderRejected {
                    client_order_id, ..
                } => Some(client_order_id),
                AccountEvent::OrderDone {
                    client_order_id: Some(c),
                    ..
                } => Some(c),
                _ => None,
            };
            if let Some(c) = cid {
                if only.is_none_or(|o| o == c) {
                    self.active.remove(c);
                }
            }
        }
    }

    fn place_limit<E: Execution>(
        &mut self,
        req: OrderRequest,
        ctx: &OmCtx<'_>,
        exec: &mut E,
        out: &mut Vec<AccountEvent>,
    ) {
        if !self.active.insert(req.client_order_id.clone()) {
            return; // dedupe: an order with this client id is live
        }
        if let Some(err) = self.validate(&req, ctx) {
            self.active.remove(&req.client_order_id);
            out.push(rejected(ctx.now, &req.client_order_id, err));
            return;
        }
        self.record_submission(&req, ctx, out);
        if self.cfg.dry_run {
            Self::dry_run_accept(&req.client_order_id, ctx.now, out);
            return;
        }
        let cid = req.client_order_id.clone();
        let start = out.len();
        exec.submit(ctx.now, ExecCommand::Place(vec![req]), ctx.books, out);
        // Immediately finalized (FOK kill/fill, post-only reject): reusable id.
        let new: Vec<AccountEvent> = out[start..].to_vec();
        self.release_closed(&new, Some(&cid));
    }

    fn place_batch<E: Execution>(
        &mut self,
        orders: Vec<OrderRequest>,
        ctx: &OmCtx<'_>,
        exec: &mut E,
        out: &mut Vec<AccountEvent>,
    ) {
        if orders.is_empty() {
            return;
        }
        if self.cfg.enforce_batch_cap && orders.len() > ctx.rules.max_batch {
            for o in &orders {
                if !self.active.contains(&o.client_order_id) {
                    let reason = format!("batch_too_large(max_{}_orders)", ctx.rules.max_batch);
                    out.push(rejected(ctx.now, &o.client_order_id, reason));
                }
            }
            return;
        }
        let mut valid = Vec::with_capacity(orders.len());
        for req in orders {
            if self.active.contains(&req.client_order_id) {
                continue;
            }
            if let Some(err) = self.validate(&req, ctx) {
                out.push(rejected(ctx.now, &req.client_order_id, err));
                continue;
            }
            self.active.insert(req.client_order_id.clone());
            self.record_submission(&req, ctx, out);
            valid.push(req);
        }
        if valid.is_empty() {
            return;
        }
        if self.cfg.dry_run {
            for req in &valid {
                Self::dry_run_accept(&req.client_order_id, ctx.now, out);
            }
            return;
        }
        let start = out.len();
        exec.submit(ctx.now, ExecCommand::Place(valid), ctx.books, out);
        let new: Vec<AccountEvent> = out[start..].to_vec();
        self.release_closed(&new, None);
    }

    // ---- cancels -------------------------------------------------------

    /// TS `resolveCancelBatch`: never guess an unacknowledged exchange id.
    fn resolve_cancel_refs(
        &self,
        op: CancelOp,
        orders: &[OrderRef],
        refs: &Refs,
        now: TsMs,
        out: &mut Vec<AccountEvent>,
    ) -> Vec<CancelTarget> {
        let mut targets = Vec::new();
        if orders.len() > self.cfg.max_cancel_batch {
            out.push(cancel_failed(op, now, "invalid_cancel_batch_size", None));
            return targets;
        }
        let mut seen: HashSet<(bool, Arc<str>)> = HashSet::new();
        for r in orders {
            let bad_cid = r.client_order_id.as_ref().is_some_and(|c| !valid_id(c.as_str()));
            let bad_oid = r.order_id.as_ref().is_some_and(|o| !valid_id(&o.0));
            if (r.client_order_id.is_none() && r.order_id.is_none()) || bad_cid || bad_oid {
                out.push(cancel_failed(op, now, "invalid_order_reference", None));
                continue;
            }
            let by_client = r.client_order_id.as_ref().and_then(|c| refs.open(c));
            let by_exchange = r.order_id.as_ref().and_then(|o| refs.open_by_order_id(o));
            if let (Some(c), Some((ec, _))) = (&r.client_order_id, by_exchange) {
                if ec != c {
                    out.push(cancel_failed(op, now, "conflicting_order_reference", Some(r)));
                    continue;
                }
            }
            let bot: Option<(ClientOrderId, &RefOrder)> = match (by_client, by_exchange) {
                (Some(o), _) => Some((r.client_order_id.clone().expect("by client"), o)),
                (None, Some((c, o))) => Some((c.clone(), o)),
                (None, None) => None,
            };
            let previous = match (&r.client_order_id, &r.order_id) {
                (Some(c), _) => refs.get(c),
                (None, Some(o)) => refs.any_by_order_id(o),
                (None, None) => None,
            };
            let known_id = bot
                .as_ref()
                .and_then(|(_, o)| o.order_id.clone())
                .or_else(|| previous.and_then(|p| p.order_id.clone()));
            if let (Some(given), Some(known)) = (&r.order_id, &known_id) {
                if given != known {
                    out.push(cancel_failed(op, now, "conflicting_order_reference", Some(r)));
                    continue;
                }
            }
            if bot.is_none() && previous.is_some_and(|p| p.state.is_terminal()) {
                continue; // a known terminal order has nothing left to cancel
            }
            if r.client_order_id.is_some() && bot.is_none() && r.order_id.is_none() {
                out.push(cancel_failed(op, now, "unknown_client_order", Some(r)));
                continue;
            }
            if let Some((_, o)) = &bot {
                if o.order_id.is_none() && !self.cfg.dry_run {
                    out.push(cancel_failed(op, now, "missing_exchange_order_id", Some(r)));
                    continue;
                }
            }
            let order_id = bot
                .as_ref()
                .and_then(|(_, o)| o.order_id.clone())
                .or_else(|| r.order_id.clone());
            let client_order_id = bot.map(|(c, _)| c).or_else(|| r.client_order_id.clone());
            let key = match (&order_id, &client_order_id) {
                (Some(o), _) => (true, o.0.clone()),
                (None, Some(c)) => (false, c.0.clone()),
                (None, None) => continue,
            };
            if !seen.insert(key) {
                continue;
            }
            targets.push(CancelTarget {
                client_order_id,
                order_id,
            });
        }
        targets
    }

    fn dry_run_cancel(
        &self,
        targets: &[CancelTarget],
        refs: &Refs,
        now: TsMs,
        out: &mut Vec<AccountEvent>,
    ) {
        for t in targets {
            let filled = t
                .client_order_id
                .as_ref()
                .and_then(|c| refs.open(c))
                .map_or(Qty::ZERO, |o| o.filled);
            out.push(AccountEvent::OrderDone {
                ts_ms: now,
                client_order_id: t.client_order_id.clone(),
                order_id: t.order_id.clone(),
                reason: DoneReason::Canceled,
                filled_size: Some(filled),
            });
        }
    }

    fn is_known_target(t: &CancelTarget, refs: &Refs) -> bool {
        t.client_order_id
            .as_ref()
            .is_some_and(|c| refs.open(c).is_some())
    }

    fn dry_run_cancel_known(
        &self,
        op: CancelOp,
        targets: &[CancelTarget],
        refs: &Refs,
        now: TsMs,
        out: &mut Vec<AccountEvent>,
    ) {
        for t in targets {
            if Self::is_known_target(t, refs) {
                self.dry_run_cancel(std::slice::from_ref(t), refs, now, out);
            } else {
                let r = OrderRef {
                    client_order_id: t.client_order_id.clone(),
                    order_id: t.order_id.clone(),
                };
                out.push(cancel_failed(op, now, "unknown_order", Some(&r)));
            }
        }
    }

    fn open_targets<'r>(
        refs: &'r Refs,
        filter: impl Fn(&RefOrder) -> bool + 'r,
    ) -> impl Iterator<Item = CancelTarget> + 'r {
        refs.orders
            .iter()
            .filter(move |(_, o)| o.open() && filter(o))
            .map(|(c, o)| CancelTarget {
                client_order_id: Some(c.clone()),
                order_id: o.order_id.clone(),
            })
    }

    fn cancel_order<E: Execution>(
        &mut self,
        order: OrderRef,
        refs: &Refs,
        ctx: &OmCtx<'_>,
        exec: &mut E,
        out: &mut Vec<AccountEvent>,
    ) {
        if self.cfg.dry_run {
            let targets = self.resolve_cancel_refs(
                CancelOp::CancelOrder,
                std::slice::from_ref(&order),
                refs,
                ctx.now,
                out,
            );
            self.dry_run_cancel_known(CancelOp::CancelOrder, &targets, refs, ctx.now, out);
            return;
        }
        // TS: a single cancel goes straight to the adapter, which binds it to
        // the current submission of that client id.
        let target = CancelTarget {
            client_order_id: order.client_order_id,
            order_id: order.order_id,
        };
        exec.submit(
            ctx.now,
            ExecCommand::Cancel {
                op: CancelOp::CancelOrder,
                targets: vec![target],
            },
            ctx.books,
            out,
        );
    }

    fn cancel_batch<E: Execution>(
        &mut self,
        orders: &[OrderRef],
        refs: &Refs,
        ctx: &OmCtx<'_>,
        exec: &mut E,
        out: &mut Vec<AccountEvent>,
    ) {
        let targets = self.resolve_cancel_refs(CancelOp::CancelBatch, orders, refs, ctx.now, out);
        if targets.is_empty() {
            return;
        }
        if self.cfg.dry_run {
            self.dry_run_cancel_known(CancelOp::CancelBatch, &targets, refs, ctx.now, out);
            return;
        }
        exec.submit(
            ctx.now,
            ExecCommand::Cancel {
                op: CancelOp::CancelBatch,
                targets,
            },
            ctx.books,
            out,
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn cancel_market<E: Execution>(
        &mut self,
        market: Option<ConditionId>,
        asset_id: Option<AssetId>,
        refs: &Refs,
        ctx: &OmCtx<'_>,
        exec: &mut E,
        out: &mut Vec<AccountEvent>,
    ) {
        if let Err(e) = validate_cancel_scope(market.as_ref(), asset_id.as_ref()) {
            out.push(cancel_failed(CancelOp::CancelMarket, ctx.now, e, None));
            return;
        }
        if self.cfg.dry_run {
            let targets: Vec<CancelTarget> = Self::open_targets(refs, |o| {
                matches_cancel_scope(o.market.as_ref(), &o.asset, market.as_ref(), asset_id.as_ref())
            })
            .collect();
            self.dry_run_cancel(&targets, refs, ctx.now, out);
            return;
        }
        exec.submit(
            ctx.now,
            ExecCommand::CancelMarket { market, asset_id },
            ctx.books,
            out,
        );
    }

    fn cancel_all<E: Execution>(
        &mut self,
        refs: &Refs,
        ctx: &OmCtx<'_>,
        exec: &mut E,
        out: &mut Vec<AccountEvent>,
    ) {
        if self.cfg.dry_run {
            let targets: Vec<CancelTarget> = Self::open_targets(refs, |_| true).collect();
            self.dry_run_cancel(&targets, refs, ctx.now, out);
            return;
        }
        exec.submit(ctx.now, ExecCommand::CancelAll, ctx.books, out);
    }

    // ---- split / merge -------------------------------------------------

    #[allow(clippy::too_many_arguments)]
    fn split<E: Execution>(
        &mut self,
        asset_a: AssetId,
        asset_b: AssetId,
        size: Qty,
        cost_per_share: Option<Price>,
        ctx: &OmCtx<'_>,
        exec: &mut E,
        out: &mut Vec<AccountEvent>,
    ) {
        let fail = |reason: String| AccountEvent::SplitFailed {
            ts_ms: ctx.now,
            asset_a: asset_a.clone(),
            asset_b: asset_b.clone(),
            requested: size,
            reason,
        };
        if asset_a.as_str().is_empty() || asset_b.as_str().is_empty() || asset_a == asset_b {
            out.push(fail("invalid asset ids".into()));
            return;
        }
        if !size.is_positive() {
            out.push(fail("invalid size".into()));
            return;
        }
        // One full set costs one USDC.
        let cost = Usdc::from_micros(size.micros());
        if let Some(err) = self.funding_error(cost, ctx) {
            out.push(fail(err));
            return;
        }
        let start = out.len();
        if self.cfg.dry_run {
            self.op_seq += 1;
            out.push(AccountEvent::PositionsSplit {
                id: Arc::from(format!("dry-split:{}", self.op_seq)),
                ts_ms: ctx.now,
                asset_a,
                asset_b,
                size,
                cost,
            });
        } else {
            exec.submit(
                ctx.now,
                ExecCommand::Split {
                    asset_a,
                    asset_b,
                    size,
                    cost_per_share: cost_per_share.unwrap_or(Price::from_micros(500_000)),
                },
                ctx.books,
                out,
            );
        }
        for ev in &out[start..] {
            if let AccountEvent::PositionsSplit { id, cost, .. } = ev {
                self.unapplied_splits.insert(id.clone(), *cost);
            }
        }
    }

    fn merge<E: Execution>(
        &mut self,
        asset_a: AssetId,
        asset_b: AssetId,
        size: Qty,
        ctx: &OmCtx<'_>,
        exec: &mut E,
        out: &mut Vec<AccountEvent>,
    ) {
        let fail = |reason: &str| AccountEvent::MergeFailed {
            ts_ms: ctx.now,
            asset_a: asset_a.clone(),
            asset_b: asset_b.clone(),
            requested: size,
            reason: reason.to_string(),
        };
        if asset_a.as_str().is_empty() || asset_b.as_str().is_empty() || asset_a == asset_b {
            out.push(fail("invalid asset ids"));
            return;
        }
        if !size.is_positive() {
            return;
        }
        let available = |asset: &AssetId| {
            let pending: Qty = self
                .unapplied_merges
                .values()
                .filter(|(a, b, _)| a == asset || b == asset)
                .fold(Qty::ZERO, |acc, (_, _, s)| acc + *s);
            (ctx.portfolio.position_qty(asset) - pending).max(Qty::ZERO)
        };
        let actual = size.min(available(&asset_a)).min(available(&asset_b));
        if !actual.is_positive() {
            out.push(fail("insufficient_uncommitted_positions"));
            return;
        }
        let start = out.len();
        if self.cfg.dry_run {
            self.op_seq += 1;
            out.push(AccountEvent::PositionsMerged {
                id: Arc::from(format!("dry-merge:{}", self.op_seq)),
                ts_ms: ctx.now,
                asset_a,
                asset_b,
                size: actual,
            });
        } else {
            exec.submit(
                ctx.now,
                ExecCommand::Merge {
                    asset_a,
                    asset_b,
                    size: actual,
                },
                ctx.books,
                out,
            );
        }
        for ev in &out[start..] {
            if let AccountEvent::PositionsMerged {
                id,
                asset_a,
                asset_b,
                size,
                ..
            } = ev
            {
                self.unapplied_merges
                    .insert(id.clone(), (asset_a.clone(), asset_b.clone(), *size));
            }
        }
    }
}

fn done_state(r: DoneReason) -> OrderState {
    match r {
        DoneReason::Filled => OrderState::Filled,
        DoneReason::Canceled => OrderState::Canceled,
        DoneReason::Expired => OrderState::Expired,
        DoneReason::Killed => OrderState::Killed,
    }
}
