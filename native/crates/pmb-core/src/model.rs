//! Domain model shared by strategies, the order manager, the portfolio and
//! every execution adapter (backtest simulator, live dry-run, live CLOB).

use crate::fixed::{Price, Qty, Usdc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;

/// Milliseconds since the Unix epoch.
pub type TsMs = i64;

/// CLOB token id (outcome asset). Cheap to clone.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AssetId(pub Arc<str>);

impl AssetId {
    pub fn new(s: &str) -> Self {
        Self(Arc::from(s))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Market condition id.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConditionId(pub Arc<str>);

/// Client-side order id chosen by the strategy (unique per session).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ClientOrderId(pub Arc<str>);

impl ClientOrderId {
    pub fn new(s: &str) -> Self {
        Self(Arc::from(s))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Exchange-assigned order id.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OrderId(pub Arc<str>);

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Side {
    Buy,
    Sell,
}

impl Side {
    pub fn opposite(self) -> Side {
        match self {
            Side::Buy => Side::Sell,
            Side::Sell => Side::Buy,
        }
    }
}

/// Polymarket time-in-force.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OrderType {
    /// Good-til-cancelled limit order.
    Gtc,
    /// Good-til-date limit order (`expire_at_ms` required).
    Gtd,
    /// Fill-or-kill: fully fill immediately or cancel.
    Fok,
    /// Fill-and-kill: fill what is available immediately, cancel the rest.
    Fak,
}

impl OrderType {
    /// Resting order types (may sit on the book).
    pub fn can_rest(self) -> bool {
        matches!(self, OrderType::Gtc | OrderType::Gtd)
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Liquidity {
    Maker,
    Taker,
}

/// Free-form strategy metadata attached to an intent and echoed on fills.
pub type IntentMeta = BTreeMap<String, serde_json::Value>;

/// One order request.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OrderRequest {
    pub client_order_id: ClientOrderId,
    pub asset_id: AssetId,
    pub side: Side,
    pub price: Price,
    pub size: Qty,
    pub order_type: OrderType,
    #[serde(default)]
    pub post_only: bool,
    /// Required for GTD.
    #[serde(default)]
    pub expire_at_ms: Option<TsMs>,
    #[serde(default)]
    pub meta: Option<IntentMeta>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct OrderRef {
    #[serde(default)]
    pub client_order_id: Option<ClientOrderId>,
    #[serde(default)]
    pub order_id: Option<OrderId>,
}

/// What a strategy asks the engine to do.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Intent {
    PlaceLimit(OrderRequest),
    /// Up to 15 orders in one request.
    PlaceBatch {
        orders: Vec<OrderRequest>,
        #[serde(default)]
        reason: Option<String>,
    },
    CancelOrder {
        order: OrderRef,
        #[serde(default)]
        reason: Option<String>,
    },
    CancelBatch {
        orders: Vec<OrderRef>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// Cancel by market and/or asset filter (at least one filter required).
    CancelMarket {
        #[serde(default)]
        market: Option<ConditionId>,
        #[serde(default)]
        asset_id: Option<AssetId>,
        #[serde(default)]
        reason: Option<String>,
    },
    CancelAll {
        #[serde(default)]
        reason: Option<String>,
    },
    /// Split `size` collateral into `size` shares of each outcome.
    SplitPositions {
        asset_a: AssetId,
        asset_b: AssetId,
        size: Qty,
        /// Accounting cost per share (default 0.5).
        #[serde(default)]
        cost_per_share: Option<Price>,
        #[serde(default)]
        reason: Option<String>,
    },
    /// Merge `size` pairs back into collateral.
    MergePositions {
        asset_a: AssetId,
        asset_b: AssetId,
        size: Qty,
        #[serde(default)]
        reason: Option<String>,
    },
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderState {
    Requested,
    Open,
    PartiallyFilled,
    Filled,
    Canceled,
    Rejected,
    Expired,
    Killed,
}

impl OrderState {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            OrderState::Filled
                | OrderState::Canceled
                | OrderState::Rejected
                | OrderState::Expired
                | OrderState::Killed
        )
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Order {
    pub client_order_id: ClientOrderId,
    pub order_id: Option<OrderId>,
    pub market: Option<ConditionId>,
    pub asset_id: AssetId,
    pub side: Side,
    pub price: Price,
    pub size: Qty,
    pub remaining: Qty,
    pub filled: Qty,
    pub order_type: OrderType,
    pub post_only: bool,
    pub expire_at_ms: Option<TsMs>,
    pub meta: Option<IntentMeta>,
    pub state: OrderState,
    pub created_at_ms: TsMs,
    pub updated_at_ms: TsMs,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fill {
    pub id: Arc<str>,
    pub ts_ms: TsMs,
    pub market: Option<ConditionId>,
    pub asset_id: AssetId,
    pub side: Side,
    pub price: Price,
    pub size: Qty,
    /// Fee actually charged for this fill (USDC; 0 for makers).
    pub fee: Usdc,
    pub client_order_id: Option<ClientOrderId>,
    pub order_id: Option<OrderId>,
    pub liquidity: Option<Liquidity>,
    pub meta: Option<IntentMeta>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub qty: Qty,
    /// Average-cost basis of the remaining shares.
    pub cost_basis: Usdc,
}

impl Position {
    pub fn avg_entry_price(&self) -> Option<f64> {
        if self.qty.is_positive() {
            Some(self.cost_basis.to_f64() / self.qty.to_f64())
        } else {
            None
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DoneReason {
    Filled,
    Canceled,
    Expired,
    Killed,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelOp {
    CancelOrder,
    CancelBatch,
    CancelMarket,
    CancelAll,
}

/// Account-side event, identical in shape for live and backtest.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AccountEvent {
    OrderSubmitted {
        ts_ms: TsMs,
        order: Order,
    },
    OrderAccepted {
        ts_ms: TsMs,
        client_order_id: ClientOrderId,
        order_id: Option<OrderId>,
    },
    OrderRejected {
        ts_ms: TsMs,
        client_order_id: ClientOrderId,
        reason: String,
    },
    OrderOpen {
        ts_ms: TsMs,
        client_order_id: Option<ClientOrderId>,
        order_id: Option<OrderId>,
    },
    OrderDone {
        ts_ms: TsMs,
        client_order_id: Option<ClientOrderId>,
        order_id: Option<OrderId>,
        reason: DoneReason,
        /// Authoritative cumulative filled size at closure, when known.
        filled_size: Option<Qty>,
    },
    Fill(Fill),
    CancelFailed {
        ts_ms: TsMs,
        operation: CancelOp,
        client_order_id: Option<ClientOrderId>,
        order_id: Option<OrderId>,
        reason: String,
    },
    PositionsSplit {
        id: Arc<str>,
        ts_ms: TsMs,
        asset_a: AssetId,
        asset_b: AssetId,
        size: Qty,
        cost: Usdc,
    },
    SplitFailed {
        ts_ms: TsMs,
        asset_a: AssetId,
        asset_b: AssetId,
        requested: Qty,
        reason: String,
    },
    PositionsMerged {
        id: Arc<str>,
        ts_ms: TsMs,
        asset_a: AssetId,
        asset_b: AssetId,
        size: Qty,
    },
    MergeFailed {
        ts_ms: TsMs,
        asset_a: AssetId,
        asset_b: AssetId,
        requested: Qty,
        reason: String,
    },
    StreamStatus {
        ts_ms: TsMs,
        connected: bool,
        info: Option<String>,
    },
}

impl AccountEvent {
    pub fn ts_ms(&self) -> TsMs {
        match self {
            AccountEvent::OrderSubmitted { ts_ms, .. }
            | AccountEvent::OrderAccepted { ts_ms, .. }
            | AccountEvent::OrderRejected { ts_ms, .. }
            | AccountEvent::OrderOpen { ts_ms, .. }
            | AccountEvent::OrderDone { ts_ms, .. }
            | AccountEvent::CancelFailed { ts_ms, .. }
            | AccountEvent::PositionsSplit { ts_ms, .. }
            | AccountEvent::SplitFailed { ts_ms, .. }
            | AccountEvent::PositionsMerged { ts_ms, .. }
            | AccountEvent::MergeFailed { ts_ms, .. }
            | AccountEvent::StreamStatus { ts_ms, .. } => *ts_ms,
            AccountEvent::Fill(f) => f.ts_ms,
        }
    }
}

/// Static description of the market being traded.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MarketInfo {
    pub slug: Option<String>,
    pub condition_id: Option<ConditionId>,
    /// Outcome tokens, index 0 = UP/YES, index 1 = DOWN/NO.
    pub assets: [AssetId; 2],
    pub start_ms: Option<TsMs>,
    pub end_ms: Option<TsMs>,
}

/// Fee schedule: `fee = shares * rate * (p * (1 - p))^exponent`, taker only.
#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FeeSchedule {
    pub rate: f64,
    pub exponent: f64,
    pub taker_only: bool,
    /// Decimal places the fee is rounded to (Polymarket: 5).
    pub round_dp: u32,
}

/// Exchange rules that apply to one market at one point in time.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExchangeRules {
    pub tick_size: Price,
    pub min_order_size: Qty,
    pub max_batch: usize,
    pub fee: Option<FeeSchedule>,
    /// Marketable orders are held this long before matching (crypto up/down).
    pub taker_delay_ms: i64,
    /// GTD expiration must be at least this far in the future.
    pub gtd_min_lead_ms: i64,
    /// GTD orders actually expire this much before their stated expiration.
    pub gtd_early_expiry_ms: i64,
}
