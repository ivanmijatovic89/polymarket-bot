//! Shared, typed account ledger, ported from the pinned TypeScript Portfolio.
//! JSON decoding belongs to adapters; applying an event does not inspect JSON.
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, VecDeque};

pub use crate::math::{
    buy_commitment, round8, validate_starting_capital, DEFAULT_STARTING_CAPITAL,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Side {
    Buy,
    Sell,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Liquidity {
    Maker,
    Taker,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OrderType {
    Fok,
    Gtc,
    Gtd,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
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
/// Terminal lifecycle event reasons are narrower than stored order states.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderDoneReason {
    Filled,
    Canceled,
    Expired,
    Killed,
}
impl From<OrderDoneReason> for OrderState {
    fn from(reason: OrderDoneReason) -> Self {
        match reason {
            OrderDoneReason::Filled => Self::Filled,
            OrderDoneReason::Canceled => Self::Canceled,
            OrderDoneReason::Expired => Self::Expired,
            OrderDoneReason::Killed => Self::Killed,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum WsOrderEvent {
    Placement,
    Update,
    Cancellation,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum CancelOperation {
    #[serde(rename = "cancel_order")]
    Order,
    #[serde(rename = "cancel_batch")]
    Batch,
    #[serde(rename = "cancel_market")]
    Market,
    #[serde(rename = "cancel_all")]
    All,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountStreamSource {
    UserWs,
    RestPoll,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountStreamStatus {
    Connected,
    Disconnected,
}
fn present_json<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer)
        .map(crate::market_json::normalize_control_value)
        .map(Some)
}
fn extensions_json<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<serde_json::Map<String, Value>, D::Error> {
    let raw = serde_json::Map::<String, Value>::deserialize(deserializer)?;
    match crate::market_json::normalize_control_value(Value::Object(raw)) {
        Value::Object(normalized) => Ok(normalized),
        _ => unreachable!("object normalization preserves its type"),
    }
}
fn json_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::Number(v) => v.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(v) => !v.is_empty(),
        _ => true,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fill {
    pub id: String,
    pub ts_ms: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub market: Option<String>,
    pub asset_id: String,
    pub side: Side,
    pub price: f64,
    pub size: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee_rate_bps: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_order_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liquidity: Option<Liquidity>,
    #[serde(
        default,
        deserialize_with = "present_json",
        skip_serializing_if = "Option::is_none"
    )]
    pub intent_meta: Option<Value>,
    /// Extra raw adapter fields are retained because the TS ledger stores this payload.
    #[serde(default, flatten, deserialize_with = "extensions_json")]
    pub extensions: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionsSplit {
    pub id: String,
    pub ts_ms: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub market: Option<String>,
    pub asset_id_a: String,
    pub asset_id_b: String,
    pub size: f64,
    pub split_cost: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Extra raw adapter fields are retained because the TS ledger stores this payload.
    #[serde(default, flatten, deserialize_with = "extensions_json")]
    pub extensions: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub asset_id: String,
    pub qty: f64,
    pub avg_entry_price: Option<f64>,
    pub cost_basis: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOrder {
    pub client_order_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub market: Option<String>,
    pub asset_id: String,
    pub side: Side,
    pub price: f64,
    pub size: f64,
    pub remaining: f64,
    pub filled: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_type: Option<OrderType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_only: Option<bool>,
    #[serde(
        default,
        deserialize_with = "present_json",
        skip_serializing_if = "Option::is_none"
    )]
    pub meta: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expire_at_ms: Option<f64>,
    pub state: OrderState,
    pub created_at_ms: f64,
    pub updated_at_ms: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// Extra raw adapter fields are retained because the TS ledger stores this payload.
    #[serde(default, flatten, deserialize_with = "extensions_json")]
    pub extensions: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsOrderUpdate {
    pub order_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub market: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<Side>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_matched: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expiration_sec: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at_sec: Option<f64>,
    pub event: WsOrderEvent,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WsOpenOrder {
    pub order_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub market: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<Side>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_matched: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    pub updated_at_ms: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderSnapshot {
    pub client_order_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order_id: Option<String>,
    pub asset_id: String,
    pub side: Side,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_matched: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lifecycle_state: Option<OrderState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_only: Option<bool>,
    #[serde(
        default,
        deserialize_with = "present_json",
        skip_serializing_if = "Option::is_none"
    )]
    pub meta: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trade_status_raw: Option<String>,
    pub trade_status_rank: u8,
    pub updated_at_ms: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapitalSnapshot {
    pub starting_capital: f64,
    pub cash: f64,
    pub reserved_cash: f64,
    pub available_cash: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AccountEvent {
    OrderSubmitted {
        ts_ms: f64,
        order: OpenOrder,
    },
    OrderAccepted {
        ts_ms: f64,
        client_order_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        order_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        market: Option<String>,
    },
    OrderOpen {
        ts_ms: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        client_order_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        order_id: Option<String>,
    },
    OrderRejected {
        ts_ms: f64,
        client_order_id: String,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        market: Option<String>,
    },
    OrderDone {
        ts_ms: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        client_order_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        order_id: Option<String>,
        reason: OrderDoneReason,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        filled_size: Option<f64>,
    },
    Fill {
        fill: Fill,
    },
    PositionsSplit {
        split: PositionsSplit,
    },
    PositionsMerged {
        id: String,
        ts_ms: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        market: Option<String>,
        asset_id_a: String,
        asset_id_b: String,
        size: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    WsOrderUpdate {
        ts_ms: f64,
        order: WsOrderUpdate,
    },
    CancelFailed {
        ts_ms: f64,
        operation: CancelOperation,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        client_order_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        order_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        market: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        asset_id: Option<String>,
        reason: String,
    },
    MergeFailed {
        ts_ms: f64,
        asset_id_a: String,
        asset_id_b: String,
        requested_size: f64,
        reason: String,
    },
    SplitFailed {
        ts_ms: f64,
        asset_id_a: String,
        asset_id_b: String,
        requested_size: f64,
        reason: String,
    },
    AccountStreamStatus {
        ts_ms: f64,
        source: AccountStreamSource,
        status: AccountStreamStatus,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        info: Option<String>,
    },
}
impl AccountEvent {
    pub fn timestamp_ms(&self) -> f64 {
        match self {
            Self::Fill { fill } => fill.ts_ms,
            Self::PositionsSplit { split } => split.ts_ms,
            Self::OrderSubmitted { ts_ms, .. }
            | Self::OrderAccepted { ts_ms, .. }
            | Self::OrderOpen { ts_ms, .. }
            | Self::OrderRejected { ts_ms, .. }
            | Self::OrderDone { ts_ms, .. }
            | Self::PositionsMerged { ts_ms, .. }
            | Self::WsOrderUpdate { ts_ms, .. }
            | Self::CancelFailed { ts_ms, .. }
            | Self::MergeFailed { ts_ms, .. }
            | Self::SplitFailed { ts_ms, .. }
            | Self::AccountStreamStatus { ts_ms, .. } => *ts_ms,
        }
    }
}

// Map.set updates retain insertion order; delete+set refreshes it. Tombstones
// are compacted to bound memory without turning every account update into O(n).
#[derive(Clone, Debug)]
pub struct OrderedMap<T> {
    entries: HashMap<String, (u64, T)>,
    order: VecDeque<(String, u64)>,
    sequence: u64,
    numeric_keys: BTreeMap<u32, String>,
}
impl<T> Default for OrderedMap<T> {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            sequence: 0,
            numeric_keys: BTreeMap::new(),
        }
    }
}
impl<T> OrderedMap<T> {
    pub fn get(&self, key: &str) -> Option<&T> {
        self.entries.get(key).map(|(_, v)| v)
    }
    pub fn contains_key(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    fn insert(&mut self, key: String, value: T) {
        if let Some((_, old)) = self.entries.get_mut(&key) {
            *old = value;
            return;
        }
        if let Some(index) = array_index(&key) {
            self.numeric_keys.insert(index, key.clone());
        }
        self.sequence += 1;
        self.order.push_back((key.clone(), self.sequence));
        self.entries.insert(key, (self.sequence, value));
        self.compact();
    }
    fn remove(&mut self, key: &str) -> Option<T> {
        if let Some(index) = array_index(key) {
            self.numeric_keys.remove(&index);
        }
        let out = self.entries.remove(key).map(|(_, value)| value);
        self.compact();
        out
    }
    fn compact(&mut self) {
        if self.order.len() > self.entries.len().saturating_mul(2) + 512 {
            self.order.retain(|(key, generation)| {
                self.entries.get(key).is_some_and(|(g, _)| g == generation)
            });
        }
    }
    fn prune_oldest(&mut self, count: usize) {
        let mut remaining = count;
        while remaining > 0 {
            let Some((key, generation)) = self.order.pop_front() else {
                break;
            };
            if self
                .entries
                .get(&key)
                .is_some_and(|(g, _)| *g == generation)
            {
                self.entries.remove(&key);
                if let Some(index) = array_index(&key) {
                    self.numeric_keys.remove(&index);
                }
                remaining -= 1;
            }
        }
    }
    pub fn iter(&self) -> impl Iterator<Item = (&str, &T)> {
        self.order.iter().filter_map(|(key, generation)| {
            self.entries
                .get(key)
                .filter(|(g, _)| g == generation)
                .map(|(_, value)| (key.as_str(), value))
        })
    }
    /// Snapshot Object.entries/Object.values order differs from Map insertion
    /// order for canonical numeric keys. No allocation or sorting per tick.
    pub fn object_iter(&self) -> impl Iterator<Item = (&str, &T)> {
        self.numeric_keys
            .values()
            .filter_map(|key| self.get(key).map(|v| (key.as_str(), v)))
            .chain(self.iter().filter(|(key, _)| array_index(key).is_none()))
    }
}
fn array_index(key: &str) -> Option<u32> {
    let n = key.parse::<u32>().ok()?;
    (n != u32::MAX && n.to_string() == key).then_some(n)
}
impl<T: Serialize> Serialize for OrderedMap<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.len()))?;
        for (key, value) in self.object_iter() {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSnapshot {
    pub capital: CapitalSnapshot,
    pub now_ms: f64,
    pub realized_pnl_total: f64,
    pub positions_by_asset_id: OrderedMap<Position>,
    pub open_orders_by_client_id: OrderedMap<OpenOrder>,
    pub ws_open_orders_by_order_id: OrderedMap<WsOpenOrder>,
    pub orders_by_client_id: OrderedMap<OrderSnapshot>,
    pub recent_fills: VecDeque<Fill>,
    #[serde(skip_serializing_if = "VecDeque::is_empty")]
    pub recent_splits: VecDeque<PositionsSplit>,
    pub market_by_asset_id: OrderedMap<String>,
}

#[derive(Clone, Debug)]
pub struct PortfolioOptions {
    pub starting_capital: f64,
    /// Like TypeScript, zero means retain all fills; fractional limits are valid.
    pub max_recent_fills: f64,
}
impl Default for PortfolioOptions {
    fn default() -> Self {
        Self {
            starting_capital: DEFAULT_STARTING_CAPITAL,
            max_recent_fills: 500.0,
        }
    }
}
fn finite(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}
fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}
fn truthy(value: &Option<String>) -> Option<&str> {
    value.as_deref().filter(|s| !s.is_empty())
}
fn nonempty(value: &Option<String>) -> Option<String> {
    truthy(value).map(str::to_owned)
}
fn compute_taker_fee(price: f64, size: f64, fee_rate_bps: f64) -> f64 {
    crate::math::compute_taker_fee(fee_rate_bps, price, size)
}
pub fn fill_cash_delta(fill: &Fill) -> f64 {
    crate::math::fill_cash_delta(
        fill.price,
        fill.size,
        fill.side == Side::Buy,
        fill.liquidity == Some(Liquidity::Taker),
        fill.fee_rate_bps,
    )
}
fn trade_rank(raw: Option<&str>) -> u8 {
    match raw {
        Some("MATCHED") => 1,
        Some("MINED") => 2,
        Some("CONFIRMED") => 3,
        _ => 0,
    }
}

#[derive(Clone, Debug)]
struct CashOrder {
    active: bool,
    order_id: Option<String>,
    side: Side,
    price: f64,
    size: f64,
    post_only: bool,
    filled: f64,
    matched: f64,
    final_filled: Option<f64>,
}
#[derive(Clone, Debug)]
struct TradeStatus {
    raw: Option<String>,
    rank: u8,
    updated_at_ms: f64,
}

pub struct Portfolio {
    now_ms: f64,
    clock_initialized: bool,
    starting_capital: f64,
    cash: f64,
    realized_pnl_total: f64,
    positions: OrderedMap<Position>,
    open: OrderedMap<OpenOrder>,
    history: OrderedMap<OrderSnapshot>,
    ws: OrderedMap<WsOpenOrder>,
    markets: OrderedMap<String>,
    index: HashMap<String, String>,
    persistent: OrderedMap<String>,
    terminal: OrderedMap<()>,
    pending_fills: HashMap<String, f64>,
    pending_status: OrderedMap<TradeStatus>,
    seen: OrderedMap<f64>,
    fills: VecDeque<Fill>,
    splits: VecDeque<PositionsSplit>,
    max_recent_fills: f64,
    cash_orders: Vec<CashOrder>,
    cash_client: HashMap<String, usize>,
    cash_exchange: HashMap<String, usize>,
    unlinked: HashMap<String, f64>,
    cached: Option<PortfolioSnapshot>,
    snapshot_rebuilds: u64,
}
impl Portfolio {
    /// initial_now_ms is the construction-time display clock, replaced once by observations.
    pub fn new(options: PortfolioOptions, initial_now_ms: f64) -> Result<Self, &'static str> {
        let starting = validate_starting_capital(options.starting_capital)?;
        Ok(Self {
            now_ms: initial_now_ms,
            clock_initialized: false,
            starting_capital: starting,
            cash: starting,
            realized_pnl_total: 0.0,
            positions: OrderedMap::default(),
            open: OrderedMap::default(),
            history: OrderedMap::default(),
            ws: OrderedMap::default(),
            markets: OrderedMap::default(),
            index: HashMap::new(),
            persistent: OrderedMap::default(),
            terminal: OrderedMap::default(),
            pending_fills: HashMap::new(),
            pending_status: OrderedMap::default(),
            seen: OrderedMap::default(),
            fills: VecDeque::new(),
            splits: VecDeque::new(),
            max_recent_fills: max(0.0, options.max_recent_fills),
            cash_orders: Vec::new(),
            cash_client: HashMap::new(),
            cash_exchange: HashMap::new(),
            unlinked: HashMap::new(),
            cached: None,
            snapshot_rebuilds: 0,
        })
    }
    pub fn initialize_clock(&mut self, now_ms: f64) {
        if self.clock_initialized || !now_ms.is_finite() {
            return;
        }
        self.now_ms = now_ms;
        self.clock_initialized = true;
        self.cached = None;
    }
    pub fn get_open_order(&self, client_order_id: &str) -> Option<&OpenOrder> {
        self.open.get(client_order_id)
    }
    pub fn reserved_cash(&self) -> f64 {
        let mut sum = 0.0;
        for order in &self.cash_orders {
            if order.active && order.side == Side::Buy {
                sum += buy_commitment(
                    order.price,
                    max(0.0, order.final_filled.unwrap_or(order.size) - order.filled),
                    order.post_only,
                );
            }
        }
        round8(sum)
    }
    pub fn available_cash(&self) -> f64 {
        self.cached
            .as_ref()
            .map(|s| s.capital.available_cash)
            .unwrap_or_else(|| round8(self.cash - self.reserved_cash()))
    }
    pub fn snapshot_rebuilds(&self) -> u64 {
        self.snapshot_rebuilds
    }
    /// The borrow prevents mutation while a snapshot is in use. Clone explicitly
    /// when retaining a historical snapshot; no stale mutable-object aliases exist.
    pub fn snapshot(&mut self) -> &PortfolioSnapshot {
        if self.cached.is_none() {
            let reserved = self.reserved_cash();
            self.cached = Some(PortfolioSnapshot {
                capital: CapitalSnapshot {
                    starting_capital: self.starting_capital,
                    cash: self.cash,
                    reserved_cash: reserved,
                    available_cash: round8(self.cash - reserved),
                },
                now_ms: self.now_ms,
                realized_pnl_total: self.realized_pnl_total,
                positions_by_asset_id: self.positions.clone(),
                open_orders_by_client_id: self.open.clone(),
                ws_open_orders_by_order_id: self.ws.clone(),
                orders_by_client_id: self.history.clone(),
                recent_fills: self.fills.clone(),
                recent_splits: self.splits.clone(),
                market_by_asset_id: self.markets.clone(),
            });
            self.snapshot_rebuilds += 1;
        }
        self.cached.as_ref().unwrap()
    }
    fn earlier(&self, order: &OpenOrder, order_id: Option<&str>) -> bool {
        let Some(id) = order_id.filter(|id| !id.is_empty()) else {
            return false;
        };
        order.order_id.as_deref() != Some(id)
            && (order.order_id.is_some() || self.persistent.contains_key(id))
    }
    fn index_order(&mut self, order: &OpenOrder) {
        if let Some(id) = truthy(&order.order_id) {
            self.index
                .insert(id.to_owned(), order.client_order_id.clone());
        }
    }
    fn unindex_order(&mut self, order: &OpenOrder) {
        if let Some(id) = truthy(&order.order_id) {
            self.index.remove(id);
        }
    }
    fn mark_terminal(&mut self, id: &str) {
        self.terminal.insert(id.to_owned(), ());
        self.ws.remove(id);
        if self.terminal.len() > 50000 {
            self.terminal.prune_oldest(1);
        }
    }
    fn once(&mut self, id: &str, timestamp: f64) -> bool {
        if self.seen.contains_key(id) {
            return false;
        }
        self.seen.insert(id.to_owned(), timestamp);
        if self.seen.len() > 50000 {
            self.seen.prune_oldest(5000);
        }
        true
    }
    fn upsert(&mut self, client_id: &str, next: OrderSnapshot) {
        if let Some(id) = truthy(&next.order_id) {
            self.persistent.remove(id);
            self.persistent.insert(id.to_owned(), client_id.to_owned());
            if self.persistent.len() > 50000 {
                self.persistent.prune_oldest(5000);
            }
        }
        self.history.remove(client_id);
        self.history.insert(client_id.to_owned(), next);
        if self.history.len() > 10000 {
            self.history.prune_oldest(1000);
        }
    }
    fn order_snapshot(&self, order: &OpenOrder, keep_status: bool) -> OrderSnapshot {
        let previous = keep_status
            .then(|| self.history.get(&order.client_order_id))
            .flatten();
        OrderSnapshot {
            client_order_id: order.client_order_id.clone(),
            order_id: nonempty(&order.order_id),
            asset_id: order.asset_id.clone(),
            side: order.side,
            price: Some(order.price),
            original_size: Some(order.size),
            size_matched: Some(order.filled),
            remaining: Some(order.remaining),
            lifecycle_state: Some(order.state),
            post_only: order.post_only,
            meta: order.meta.clone().filter(json_truthy),
            trade_status_raw: previous.and_then(|p| p.trade_status_raw.clone()),
            trade_status_rank: previous.map(|p| p.trade_status_rank).unwrap_or(0),
            updated_at_ms: self.now_ms,
        }
    }
    fn merge_status(&mut self, client_id: &str, order_id: Option<&str>) {
        let Some(order_id) = order_id.filter(|id| !id.is_empty()) else {
            return;
        };
        if let (Some(pending), Some(previous)) = (
            self.pending_status.get(order_id),
            self.history.get(client_id),
        ) {
            let mut next = previous.clone();
            next.trade_status_raw = pending.raw.clone().or(next.trade_status_raw);
            next.trade_status_rank = next.trade_status_rank.max(pending.rank);
            next.updated_at_ms = max(next.updated_at_ms, pending.updated_at_ms);
            self.upsert(client_id, next);
        }
    }
    fn link_cash(&mut self, client_id: &str, order_id: &str) {
        if self
            .open
            .get(client_id)
            .is_some_and(|o| self.earlier(o, Some(order_id)))
        {
            return;
        }
        let Some(&local) = self.cash_client.get(client_id) else {
            return;
        };
        if truthy(&self.cash_orders[local].order_id).is_some_and(|id| id != order_id) {
            return;
        }
        self.cash_orders[local].order_id = Some(order_id.to_owned());
        if let Some(&exchange) = self.cash_exchange.get(order_id) {
            if local != exchange {
                let other = self.cash_orders[exchange].clone();
                let order = &mut self.cash_orders[local];
                order.filled = max(order.filled, other.filled);
                order.matched = max(order.matched, other.matched);
                if other.final_filled.is_some() {
                    order.final_filled = other.final_filled;
                }
                self.cash_orders[exchange].active = false;
            }
        }
        self.cash_orders[local].filled =
            round8(self.cash_orders[local].filled + self.unlinked.remove(order_id).unwrap_or(0.0));
        self.cash_exchange.insert(order_id.to_owned(), local);
    }
    fn cash_event(&mut self, event: &AccountEvent) {
        match event {
            AccountEvent::OrderSubmitted { order, .. } => {
                let index = self.cash_orders.len();
                self.cash_orders.push(CashOrder {
                    active: true,
                    order_id: None,
                    side: order.side,
                    price: order.price,
                    size: order.size,
                    post_only: order.post_only == Some(true),
                    filled: order.filled,
                    matched: order.filled,
                    final_filled: None,
                });
                self.cash_client
                    .insert(order.client_order_id.clone(), index);
                if let Some(id) = truthy(&order.order_id) {
                    self.link_cash(&order.client_order_id, id);
                }
            }
            AccountEvent::OrderAccepted {
                client_order_id,
                order_id,
                ..
            } => {
                if !client_order_id.is_empty() {
                    if let Some(id) = truthy(order_id) {
                        self.link_cash(client_order_id, id);
                    }
                }
            }
            AccountEvent::OrderOpen {
                client_order_id,
                order_id,
                ..
            } => {
                if let (Some(client), Some(id)) = (truthy(client_order_id), truthy(order_id)) {
                    self.link_cash(client, id);
                }
            }
            AccountEvent::WsOrderUpdate { order, .. } => {
                if matches!(
                    order.status.as_deref(),
                    Some("MATCHED" | "MINED" | "CONFIRMED" | "RETRYING" | "FAILED")
                ) {
                    return;
                }
                let index = if let Some(&i) = self.cash_exchange.get(&order.order_id) {
                    i
                } else {
                    let (Some(side), Some(price), Some(size)) = (
                        order.side,
                        order.price.filter(|p| p.is_finite()),
                        order.original_size.filter(|p| p.is_finite()),
                    ) else {
                        return;
                    };
                    let i = self.cash_orders.len();
                    self.cash_orders.push(CashOrder {
                        active: true,
                        order_id: Some(order.order_id.clone()),
                        side,
                        price,
                        size,
                        post_only: false,
                        filled: self.unlinked.remove(&order.order_id).unwrap_or(0.0),
                        matched: 0.0,
                        final_filled: None,
                    });
                    self.cash_exchange.insert(order.order_id.clone(), i);
                    i
                };
                let cash = &mut self.cash_orders[index];
                if let Some(matched) = order.size_matched.filter(|p| p.is_finite()) {
                    cash.matched = max(cash.matched, matched);
                }
                let terminal = order.event == WsOrderEvent::Cancellation
                    || matches!(
                        order.status.as_deref(),
                        Some("CANCELED" | "CANCELLED" | "EXPIRED")
                    )
                    || cash.matched >= cash.size;
                if terminal && order.size_matched.is_some_and(|p| p.is_finite()) {
                    cash.final_filled = Some(max(
                        max(cash.final_filled.unwrap_or(0.0), cash.matched),
                        cash.filled,
                    ));
                }
            }
            AccountEvent::OrderDone {
                client_order_id,
                order_id,
                reason,
                filled_size,
                ..
            } => {
                let index = if let Some(id) = truthy(order_id) {
                    self.cash_exchange.get(id)
                } else {
                    truthy(client_order_id).and_then(|client| self.cash_client.get(client))
                }
                .copied();
                if let Some(index) = index {
                    let cash = &mut self.cash_orders[index];
                    let filled = if *reason == OrderDoneReason::Killed {
                        Some(0.0)
                    } else if *reason == OrderDoneReason::Filled {
                        Some(cash.size)
                    } else {
                        *filled_size
                    };
                    if let Some(filled) = filled.filter(|p| p.is_finite()) {
                        cash.final_filled = Some(max(
                            max(max(filled, cash.matched), cash.filled),
                            cash.final_filled.unwrap_or(0.0),
                        ));
                    }
                }
            }
            AccountEvent::OrderRejected {
                client_order_id, ..
            } => {
                if !self.open.contains_key(client_order_id) || client_order_id.is_empty() {
                    return;
                }
                if let Some(&index) = self.cash_client.get(client_order_id) {
                    let cash = &mut self.cash_orders[index];
                    cash.final_filled = Some(max(
                        max(max(0.0, cash.matched), cash.filled),
                        cash.final_filled.unwrap_or(0.0),
                    ));
                }
            }
            _ => {}
        }
    }
    fn cash_fill(&mut self, fill: &Fill) {
        self.cash = round8(self.cash + fill_cash_delta(fill));
        if let (Some(order), Some(client)) = (truthy(&fill.order_id), truthy(&fill.client_order_id))
        {
            if !self.cash_exchange.contains_key(order) {
                self.link_cash(client, order);
            }
        }
        let index = if let Some(id) = truthy(&fill.order_id) {
            self.cash_exchange.get(id)
        } else {
            truthy(&fill.client_order_id).and_then(|client| self.cash_client.get(client))
        }
        .copied();
        if let Some(index) = index {
            self.cash_orders[index].filled = round8(self.cash_orders[index].filled + fill.size);
        } else if let Some(id) = truthy(&fill.order_id) {
            let n = round8(self.unlinked.get(id).copied().unwrap_or(0.0) + fill.size);
            self.unlinked.insert(id.to_owned(), n);
        }
    }
    fn update_order_fill(&mut self, mut order: OpenOrder, size: f64) {
        order.filled = round8(order.filled + size);
        order.remaining = round8(max(0.0, order.size - order.filled));
        order.updated_at_ms = self.now_ms;
        order.state = if order.remaining > 0.0 {
            OrderState::PartiallyFilled
        } else {
            OrderState::Filled
        };
        if order.state == OrderState::Filled {
            self.open.remove(&order.client_order_id);
            self.unindex_order(&order);
        } else {
            self.open.insert(order.client_order_id.clone(), order);
        }
        // Reference history deliberately updates on lifecycle/WS, not on every fill.
    }
    fn pending_order_fill(&mut self, id: &str) {
        let Some(pending) = self.pending_fills.get(id).copied() else {
            return;
        };
        let Some(client) = self.index.get(id).filter(|s| !s.is_empty()) else {
            return;
        };
        let Some(order) = self.open.get(client).cloned() else {
            return;
        };
        let size = max(0.0, finite(pending));
        self.pending_fills.remove(id);
        if size > 0.0 {
            self.update_order_fill(order, size);
        }
    }
    fn fill_order(&mut self, fill: &Fill) {
        let client = fill
            .client_order_id
            .clone()
            .or_else(|| truthy(&fill.order_id).and_then(|id| self.index.get(id).cloned()));
        let order = client
            .as_deref()
            .filter(|s| !s.is_empty())
            .and_then(|client| self.open.get(client))
            .cloned();
        if order
            .as_ref()
            .is_some_and(|o| self.earlier(o, fill.order_id.as_deref()))
        {
            return;
        }
        if client.as_deref().is_none_or(|s| s.is_empty())
            || order
                .as_ref()
                .is_some_and(|o| truthy(&o.order_id).is_none() && truthy(&fill.order_id).is_some())
        {
            if let Some(id) = truthy(&fill.order_id) {
                let size = max(0.0, finite(fill.size));
                if size > 0.0 {
                    let next = round8(self.pending_fills.get(id).copied().unwrap_or(0.0) + size);
                    self.pending_fills.insert(id.to_owned(), next);
                }
            }
            return;
        }
        if let Some(order) = order {
            self.update_order_fill(order, fill.size);
        }
    }
    fn fill_position(&mut self, fill: &Fill) {
        let previous = self
            .positions
            .get(&fill.asset_id)
            .cloned()
            .unwrap_or(Position {
                asset_id: fill.asset_id.clone(),
                qty: 0.0,
                avg_entry_price: None,
                cost_basis: 0.0,
            });
        let size = max(0.0, finite(fill.size));
        let price = finite(fill.price);
        if size <= 0.0 {
            return;
        }
        let fee = if fill.liquidity == Some(Liquidity::Taker) {
            compute_taker_fee(price, size, fill.fee_rate_bps.unwrap_or(0.0))
        } else {
            0.0
        };
        if fill.side == Side::Buy {
            let qty = previous.qty + size;
            let cost = previous.cost_basis + price * size + fee;
            self.positions.insert(
                fill.asset_id.clone(),
                Position {
                    asset_id: fill.asset_id.clone(),
                    qty: round8(qty),
                    avg_entry_price: if qty > 0.0 {
                        Some(round8(cost / qty))
                    } else {
                        None
                    },
                    cost_basis: round8(cost),
                },
            );
        } else {
            let sold = size.min(previous.qty);
            let qty = previous.qty - sold;
            let average = if previous.qty > 0.0 {
                previous.cost_basis / previous.qty
            } else {
                0.0
            };
            let basis = max(0.0, previous.cost_basis - average * sold);
            let delta = round8(price * sold - fee - average * sold);
            if delta.is_finite() {
                self.realized_pnl_total = round8(self.realized_pnl_total + delta);
            }
            if qty > 0.0 {
                self.positions.insert(
                    fill.asset_id.clone(),
                    Position {
                        asset_id: fill.asset_id.clone(),
                        qty: round8(qty),
                        avg_entry_price: Some(round8(basis / qty)),
                        cost_basis: round8(basis),
                    },
                );
            } else {
                self.positions.remove(&fill.asset_id);
                if !self.open.iter().any(|(_, o)| o.asset_id == fill.asset_id) {
                    self.markets.remove(&fill.asset_id);
                }
            }
        }
    }
    fn ws_update(&mut self, order: &WsOrderUpdate) {
        let id = &order.order_id;
        let next = WsOpenOrder {
            order_id: id.clone(),
            owner: nonempty(&order.owner),
            market: nonempty(&order.market),
            asset_id: nonempty(&order.asset_id),
            side: order.side,
            price: order.price,
            original_size: order.original_size,
            size_matched: order.size_matched,
            status: nonempty(&order.status),
            order_type: nonempty(&order.order_type),
            outcome: nonempty(&order.outcome),
            updated_at_ms: self.now_ms,
        };
        let filled = matches!((order.original_size,order.size_matched),(Some(original),Some(matched)) if original.is_finite() && matched.is_finite() && original > 0.0 && matched >= original);
        let canceled = order.event == WsOrderEvent::Cancellation
            || order.status.as_deref() == Some("CANCELED");
        if filled || canceled || self.terminal.contains_key(id) {
            self.mark_terminal(id);
        } else {
            self.ws.insert(id.clone(), next);
        }
        let rank = trade_rank(order.status.as_deref());
        if truthy(&order.status).is_some() || rank > 0 {
            self.pending_status.insert(
                id.clone(),
                TradeStatus {
                    raw: order.status.clone(),
                    rank,
                    updated_at_ms: self.now_ms,
                },
            );
            if self.pending_status.len() > 10000 {
                self.pending_status.prune_oldest(1000);
            }
        }
        let client = self
            .index
            .get(id)
            .cloned()
            .or_else(|| self.persistent.get(id).cloned());
        let Some(client) = client.filter(|s| !s.is_empty()) else {
            return;
        };
        let previous = self.history.get(&client);
        let bot = self.open.get(&client);
        let current_id = bot
            .and_then(|o| o.order_id.as_deref())
            .or_else(|| previous.and_then(|o| o.order_id.as_deref()));
        if current_id != Some(id) {
            return;
        }
        let mut next = if let Some(previous) = previous {
            previous.clone()
        } else if let Some(bot) = bot {
            let mut base = self.order_snapshot(bot, false);
            base.meta = None;
            base.order_id = Some(truthy(&bot.order_id).unwrap_or(id).to_owned());
            base
        } else {
            return;
        };
        let old_matched = next.size_matched.unwrap_or(0.0);
        if !id.is_empty() {
            next.order_id = Some(id.clone());
        }
        if let Some(asset) = nonempty(&order.asset_id) {
            next.asset_id = asset;
        }
        if let Some(side) = order.side {
            next.side = side;
        }
        if order.price.is_some() {
            next.price = order.price;
        }
        if order.original_size.is_some() {
            next.original_size = order.original_size;
        }
        if let (Some(original), Some(matched)) = (order.original_size, order.size_matched) {
            next.remaining = Some(round8(max(0.0, original - matched)));
        }
        if order.status.is_some() {
            next.trade_status_raw = order.status.clone();
        }
        next.trade_status_rank = next.trade_status_rank.max(rank);
        next.updated_at_ms = self.now_ms;
        next.size_matched = Some(max(old_matched, order.size_matched.unwrap_or(0.0)));
        if self.terminal.contains_key(id) {
            next.remaining = Some(0.0);
        }
        self.upsert(&client, next);
    }
    pub fn apply(&mut self, event: &AccountEvent) {
        self.cached = None;
        let timestamp = event.timestamp_ms();
        self.initialize_clock(timestamp);
        self.now_ms = max(self.now_ms, timestamp);
        self.cash_event(event);
        match event {
            AccountEvent::WsOrderUpdate { order, .. } => self.ws_update(order),
            AccountEvent::OrderSubmitted { order, .. } => {
                self.open
                    .insert(order.client_order_id.clone(), order.clone());
                self.index_order(order);
                if let Some(market) = nonempty(&order.market) {
                    self.markets.insert(order.asset_id.clone(), market);
                }
                self.upsert(&order.client_order_id, self.order_snapshot(order, false));
                self.merge_status(&order.client_order_id, order.order_id.as_deref());
            }
            AccountEvent::OrderAccepted {
                client_order_id,
                order_id,
                ..
            } => self.accept_order(client_order_id, order_id, false),
            AccountEvent::OrderOpen {
                client_order_id,
                order_id,
                ..
            } => {
                let client = client_order_id
                    .clone()
                    .or_else(|| truthy(order_id).and_then(|id| self.index.get(id).cloned()));
                if let Some(client) = client.filter(|s| !s.is_empty()) {
                    self.accept_order(&client, order_id, true);
                }
            }
            AccountEvent::OrderRejected {
                client_order_id,
                reason,
                ..
            } => {
                let Some(mut order) = self.open.remove(client_order_id) else {
                    return;
                };
                order.state = OrderState::Rejected;
                order.last_error = Some(reason.clone());
                order.remaining = 0.0;
                order.updated_at_ms = self.now_ms;
                self.unindex_order(&order);
                self.upsert(client_order_id, self.order_snapshot(&order, true));
                self.merge_status(client_order_id, order.order_id.as_deref());
            }
            AccountEvent::OrderDone {
                client_order_id,
                order_id,
                reason,
                ..
            } => self.done_order(client_order_id, order_id, (*reason).into()),
            AccountEvent::Fill { fill } => {
                if !fill.size.is_finite()
                    || fill.size <= 0.0
                    || !fill.price.is_finite()
                    || fill.price < 0.0
                    || !self.once(&fill.id, fill.ts_ms)
                {
                    return;
                }
                self.cash_fill(fill);
                self.fills.push_back(fill.clone());
                if self.max_recent_fills > 0.0 && self.fills.len() as f64 > self.max_recent_fills {
                    // Array.splice truncates its deleteCount toward zero, retaining ceil(limit).
                    let drop = (self.fills.len() as f64 - self.max_recent_fills).trunc() as usize;
                    self.fills.drain(..drop);
                }
                self.fill_order(fill);
                self.fill_position(fill);
                if let Some(market) = nonempty(&fill.market) {
                    self.markets.insert(fill.asset_id.clone(), market);
                }
            }
            AccountEvent::PositionsSplit { split } => {
                let size = max(0.0, finite(split.size));
                if split.asset_id_a.is_empty()
                    || split.asset_id_b.is_empty()
                    || split.asset_id_a == split.asset_id_b
                    || size <= 0.0
                    || !split.split_cost.is_finite()
                    || split.split_cost < 0.0
                    || !self.once(&format!("split:{}", split.id), split.ts_ms)
                {
                    return;
                }
                self.cash = round8(self.cash - split.split_cost);
                for asset in [&split.asset_id_a, &split.asset_id_b] {
                    let mut position = self.positions.get(asset).cloned().unwrap_or(Position {
                        asset_id: asset.clone(),
                        qty: 0.0,
                        avg_entry_price: None,
                        cost_basis: 0.0,
                    });
                    position.qty = round8(position.qty + size);
                    self.positions.insert(asset.clone(), position);
                    if let Some(market) = nonempty(&split.market) {
                        self.markets.insert(asset.clone(), market);
                    }
                }
                self.splits.push_back(split.clone());
                if self.splits.len() > 500 {
                    self.splits.pop_front();
                }
            }
            AccountEvent::PositionsMerged {
                id,
                ts_ms,
                asset_id_a,
                asset_id_b,
                size,
                ..
            } => {
                if !self.once(&format!("merge:{id}"), *ts_ms) {
                    return;
                }
                let requested = finite(*size);
                if asset_id_a.is_empty()
                    || asset_id_b.is_empty()
                    || asset_id_a == asset_id_b
                    || requested <= 0.0
                {
                    return;
                }
                self.cash = round8(self.cash + requested);
                let qa = finite(self.positions.get(asset_id_a).map(|p| p.qty).unwrap_or(0.0));
                let qb = finite(self.positions.get(asset_id_b).map(|p| p.qty).unwrap_or(0.0));
                let actual = requested.min(qa).min(qb);
                if !actual.is_finite() || actual <= 0.0 {
                    return;
                }
                for asset in [asset_id_a, asset_id_b] {
                    if let Some(mut position) = self.positions.get(asset).cloned() {
                        position.qty = round8(position.qty - actual);
                        if position.qty > 0.0 {
                            self.positions.insert(asset.clone(), position);
                        } else {
                            self.positions.remove(asset);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    fn accept_order(&mut self, client_id: &str, order_id: &Option<String>, force_open: bool) {
        let Some(mut order) = self.open.get(client_id).cloned() else {
            return;
        };
        if self.earlier(&order, order_id.as_deref()) {
            return;
        }
        if order_id.is_some() {
            order.order_id = order_id.clone();
        }
        self.index_order(&order);
        if force_open || order.state == OrderState::Requested {
            order.state = OrderState::Open;
        }
        order.updated_at_ms = self.now_ms;
        self.open
            .insert(order.client_order_id.clone(), order.clone());
        self.upsert(&order.client_order_id, self.order_snapshot(&order, true));
        self.merge_status(&order.client_order_id, order.order_id.as_deref());
        if let Some(id) = truthy(order_id) {
            self.pending_order_fill(id);
        }
    }
    fn done_order(
        &mut self,
        client_id: &Option<String>,
        order_id: &Option<String>,
        reason: OrderState,
    ) {
        if let Some(id) = truthy(order_id) {
            self.mark_terminal(id);
        }
        let client = client_id.clone().or_else(|| {
            truthy(order_id).and_then(|id| {
                self.index
                    .get(id)
                    .cloned()
                    .or_else(|| self.persistent.get(id).cloned())
            })
        });
        let Some(client) = client.filter(|s| !s.is_empty()) else {
            return;
        };
        let previous = self.history.get(&client).cloned();
        let Some(mut order) = self.open.get(&client).cloned() else {
            if let Some(mut previous) = previous {
                if (truthy(order_id).is_none() || previous.order_id == *order_id)
                    && matches!(
                        previous.lifecycle_state,
                        None | Some(
                            OrderState::Requested | OrderState::Open | OrderState::PartiallyFilled
                        )
                    )
                {
                    previous.lifecycle_state = Some(reason);
                    previous.remaining = Some(0.0);
                    if reason == OrderState::Filled && previous.original_size.is_some() {
                        previous.size_matched = previous.original_size;
                    }
                    previous.updated_at_ms = self.now_ms;
                    self.upsert(&client, previous);
                }
            }
            return;
        };
        if self.earlier(&order, order_id.as_deref()) {
            return;
        }
        if let Some(id) = truthy(&order.order_id) {
            self.mark_terminal(id);
        }
        order.state = reason;
        order.remaining = 0.0;
        order.updated_at_ms = self.now_ms;
        self.open.remove(&client);
        self.unindex_order(&order);
        let mut next = self.order_snapshot(&order, true);
        next.size_matched = Some(max(
            order.filled,
            previous.and_then(|p| p.size_matched).unwrap_or(0.0),
        ));
        self.upsert(&client, next);
        self.merge_status(&client, order.order_id.as_deref());
    }
}
