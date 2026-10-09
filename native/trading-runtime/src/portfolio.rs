//! Shared, typed account ledger, ported from the pinned TypeScript Portfolio.
//! JSON decoding belongs to adapters; applying an event does not inspect JSON.
use crate::{
    metadata::{MetadataError, MetadataGraph, MetadataValue},
    portfolio_records::{
        fill as fill_fields, positions_split as split_fields, CapitalRecord, FillRecord,
        ManagedAccountEvent, OpenOrderRecord, OrderSnapshotRecord, PortfolioSnapshotRecord,
        PositionRecord, PositionsSplitRecord, WsOpenOrderRecord,
    },
    record::{FieldId, RecordHandle},
};
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
    pub trade_status_rank: f64,
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
    pub positions_by_asset_id: OrderedMap<PositionRecord>,
    pub open_orders_by_client_id: OrderedMap<OpenOrderRecord>,
    pub ws_open_orders_by_order_id: OrderedMap<WsOpenOrderRecord>,
    pub orders_by_client_id: OrderedMap<OrderSnapshotRecord>,
    pub recent_fills: VecDeque<FillRecord>,
    #[serde(skip_serializing_if = "VecDeque::is_empty")]
    pub recent_splits: VecDeque<PositionsSplitRecord>,
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
    crate::math::js_max(a, b)
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortfolioIngressError {
    Graph(MetadataError),
    UnsupportedKind,
    UnsupportedField(&'static str),
}
impl From<MetadataError> for PortfolioIngressError {
    fn from(error: MetadataError) -> Self {
        Self::Graph(error)
    }
}
impl std::fmt::Display for PortfolioIngressError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Graph(error) => std::fmt::Display::fmt(error, f),
            Self::UnsupportedKind => {
                f.write_str("managed account event kind is outside the integrated stage")
            }
            Self::UnsupportedField(field) => write!(
                f,
                "managed account field {field} requires pending generic SDK coercion"
            ),
        }
    }
}
impl std::error::Error for PortfolioIngressError {}
enum RetainedPayload {
    Order(OpenOrderRecord),
    Fill(FillRecord),
    Split(PositionsSplitRecord),
}
fn payload_record(
    event: &ManagedAccountEvent,
    key: &str,
) -> Result<RecordHandle, PortfolioIngressError> {
    let MetadataValue::Reference(handle) = event.envelope().get(key)? else {
        return Err(PortfolioIngressError::UnsupportedKind);
    };
    Ok(RecordHandle::try_from_handle(handle)?)
}
fn required_string(record: &RecordHandle, field: FieldId) -> Result<String, PortfolioIngressError> {
    match record.get_field(field)? {
        MetadataValue::String(value) => value
            .as_str()
            .map(str::to_owned)
            .ok_or(PortfolioIngressError::UnsupportedField(field.name())),
        _ => Err(PortfolioIngressError::UnsupportedField(field.name())),
    }
}
fn optional_string(
    record: &RecordHandle,
    field: FieldId,
) -> Result<Option<String>, PortfolioIngressError> {
    match record.get_field(field)? {
        MetadataValue::Missing | MetadataValue::Null => Ok(None),
        MetadataValue::String(value) => value
            .as_str()
            .map(|x| Some(x.to_owned()))
            .ok_or(PortfolioIngressError::UnsupportedField(field.name())),
        _ => Err(PortfolioIngressError::UnsupportedField(field.name())),
    }
}
fn required_number(record: &RecordHandle, field: FieldId) -> Result<f64, PortfolioIngressError> {
    record
        .number(field)?
        .ok_or(PortfolioIngressError::UnsupportedField(field.name()))
}
fn fill_view(raw: &FillRecord) -> Result<Fill, PortfolioIngressError> {
    let record = raw.handle();
    let side = match required_string(record, fill_fields::SIDE)?.as_str() {
        "BUY" => Side::Buy,
        "SELL" => Side::Sell,
        _ => return Err(PortfolioIngressError::UnsupportedField("side")),
    };
    let liquidity = match optional_string(record, fill_fields::LIQUIDITY)?.as_deref() {
        Some("MAKER") => Some(Liquidity::Maker),
        Some("TAKER") => Some(Liquidity::Taker),
        None => None,
        _ => return Err(PortfolioIngressError::UnsupportedField("liquidity")),
    };
    Ok(Fill {
        id: required_string(record, fill_fields::ID)?,
        ts_ms: required_number(record, fill_fields::TS_MS)?,
        market: optional_string(record, fill_fields::MARKET)?,
        asset_id: required_string(record, fill_fields::ASSET_ID)?,
        side,
        price: required_number(record, fill_fields::PRICE)?,
        size: required_number(record, fill_fields::SIZE)?,
        fee_rate_bps: record.number(fill_fields::FEE_RATE_BPS)?,
        client_order_id: optional_string(record, fill_fields::CLIENT_ORDER_ID)?,
        order_id: optional_string(record, fill_fields::ORDER_ID)?,
        liquidity,
        intent_meta: None,
        extensions: serde_json::Map::new(),
    })
}
fn split_view(raw: &PositionsSplitRecord) -> Result<PositionsSplit, PortfolioIngressError> {
    let record = raw.handle();
    Ok(PositionsSplit {
        id: required_string(record, split_fields::ID)?,
        ts_ms: required_number(record, split_fields::TS_MS)?,
        market: optional_string(record, split_fields::MARKET)?,
        asset_id_a: required_string(record, split_fields::ASSET_ID_A)?,
        asset_id_b: required_string(record, split_fields::ASSET_ID_B)?,
        size: required_number(record, split_fields::SIZE)?,
        split_cost: required_number(record, split_fields::SPLIT_COST)?,
        reason: None,
        extensions: serde_json::Map::new(),
    })
}

/// Typed numeric reads from the one current graph record, never a retained mirror.
/// Arbitrary JavaScript coercion/throw behavior remains the generic SDK boundary.
pub fn position_view(raw: &PositionRecord) -> Result<Position, PortfolioIngressError> {
    let h = raw.handle().as_handle();
    let qty = handle_number(h, "qty")?;
    let avg_entry_price = handle_optional_number(h, "avgEntryPrice")?;
    let cost_basis = match h.get("costBasis")? {
        MetadataValue::Number(value) => value,
        _ => avg_entry_price.map_or(0.0, |avg| avg * qty),
    };
    Ok(Position {
        asset_id: handle_string(h, "assetId")?,
        qty,
        avg_entry_price,
        cost_basis,
    })
}
fn handle_string(
    handle: &crate::metadata::MetadataHandle,
    key: &'static str,
) -> Result<String, PortfolioIngressError> {
    match handle.get(key)? {
        MetadataValue::String(value) => value
            .as_str()
            .map(str::to_owned)
            .ok_or(PortfolioIngressError::UnsupportedField(key)),
        _ => Err(PortfolioIngressError::UnsupportedField(key)),
    }
}
fn handle_optional_string(
    handle: &crate::metadata::MetadataHandle,
    key: &'static str,
) -> Result<Option<String>, PortfolioIngressError> {
    match handle.get(key)? {
        MetadataValue::Missing | MetadataValue::Null => Ok(None),
        MetadataValue::String(value) => value
            .as_str()
            .map(|v| Some(v.to_owned()))
            .ok_or(PortfolioIngressError::UnsupportedField(key)),
        _ => Err(PortfolioIngressError::UnsupportedField(key)),
    }
}
fn handle_number(
    handle: &crate::metadata::MetadataHandle,
    key: &'static str,
) -> Result<f64, PortfolioIngressError> {
    match handle.get(key)? {
        MetadataValue::Number(value) => Ok(value),
        _ => Err(PortfolioIngressError::UnsupportedField(key)),
    }
}
fn handle_optional_number(
    handle: &crate::metadata::MetadataHandle,
    key: &'static str,
) -> Result<Option<f64>, PortfolioIngressError> {
    match handle.get(key)? {
        MetadataValue::Missing | MetadataValue::Null => Ok(None),
        MetadataValue::Number(value) => Ok(Some(value)),
        _ => Err(PortfolioIngressError::UnsupportedField(key)),
    }
}
fn handle_optional_bool(
    handle: &crate::metadata::MetadataHandle,
    key: &'static str,
) -> Result<Option<bool>, PortfolioIngressError> {
    match handle.get(key)? {
        MetadataValue::Missing | MetadataValue::Null => Ok(None),
        MetadataValue::Bool(value) => Ok(Some(value)),
        _ => Err(PortfolioIngressError::UnsupportedField(key)),
    }
}
fn read_side(value: &str) -> Result<Side, PortfolioIngressError> {
    match value {
        "BUY" => Ok(Side::Buy),
        "SELL" => Ok(Side::Sell),
        _ => Err(PortfolioIngressError::UnsupportedField("side")),
    }
}
fn read_state(value: &str) -> Result<OrderState, PortfolioIngressError> {
    match value {
        "requested" => Ok(OrderState::Requested),
        "open" => Ok(OrderState::Open),
        "partially_filled" => Ok(OrderState::PartiallyFilled),
        "filled" => Ok(OrderState::Filled),
        "canceled" => Ok(OrderState::Canceled),
        "rejected" => Ok(OrderState::Rejected),
        "expired" => Ok(OrderState::Expired),
        "killed" => Ok(OrderState::Killed),
        _ => Err(PortfolioIngressError::UnsupportedField("state")),
    }
}
pub fn open_order_view(
    raw: &crate::portfolio_records::OpenOrderRecord,
) -> Result<OpenOrder, PortfolioIngressError> {
    let h = raw.handle().as_handle();
    let order_type = handle_optional_string(h, "orderType")?
        .map(|v| match v.as_str() {
            "FOK" => Ok(OrderType::Fok),
            "GTC" => Ok(OrderType::Gtc),
            "GTD" => Ok(OrderType::Gtd),
            _ => Err(PortfolioIngressError::UnsupportedField("orderType")),
        })
        .transpose()?;
    Ok(OpenOrder {
        client_order_id: handle_string(h, "clientOrderId")?,
        order_id: handle_optional_string(h, "orderId")?,
        market: handle_optional_string(h, "market")?,
        asset_id: handle_string(h, "assetId")?,
        side: read_side(&handle_string(h, "side")?)?,
        price: handle_number(h, "price")?,
        size: handle_number(h, "size")?,
        remaining: handle_number(h, "remaining")?,
        filled: handle_number(h, "filled")?,
        order_type,
        post_only: handle_optional_bool(h, "postOnly")?,
        meta: None,
        expire_at_ms: handle_optional_number(h, "expireAtMs")?,
        state: read_state(&handle_string(h, "state")?)?,
        created_at_ms: handle_number(h, "createdAtMs")?,
        updated_at_ms: handle_number(h, "updatedAtMs")?,
        last_error: handle_optional_string(h, "lastError")?,
        extensions: serde_json::Map::new(),
    })
}
pub fn order_history_view(
    raw: &OrderSnapshotRecord,
) -> Result<OrderSnapshot, PortfolioIngressError> {
    let h = raw.handle().as_handle();
    Ok(OrderSnapshot {
        client_order_id: handle_string(h, "clientOrderId")?,
        order_id: handle_optional_string(h, "orderId")?,
        asset_id: handle_string(h, "assetId")?,
        side: read_side(&handle_string(h, "side")?)?,
        price: handle_optional_number(h, "price")?,
        original_size: handle_optional_number(h, "originalSize")?,
        size_matched: handle_optional_number(h, "sizeMatched")?,
        remaining: handle_optional_number(h, "remaining")?,
        lifecycle_state: handle_optional_string(h, "lifecycleState")?
            .map(|v| read_state(&v))
            .transpose()?,
        post_only: handle_optional_bool(h, "postOnly")?,
        meta: None,
        trade_status_raw: handle_optional_string(h, "tradeStatusRaw")?,
        trade_status_rank: handle_number(h, "tradeStatusRank")?,
        updated_at_ms: handle_number(h, "updatedAtMs")?,
    })
}
fn state_wire(state: OrderState) -> &'static str {
    match state {
        OrderState::Requested => "requested",
        OrderState::Open => "open",
        OrderState::PartiallyFilled => "partially_filled",
        OrderState::Filled => "filled",
        OrderState::Canceled => "canceled",
        OrderState::Rejected => "rejected",
        OrderState::Expired => "expired",
        OrderState::Killed => "killed",
    }
}
fn ws_order_view(
    raw: &crate::portfolio_records::WsOrderUpdateRecord,
) -> Result<WsOrderUpdate, PortfolioIngressError> {
    let h = raw.handle().as_handle();
    let side = handle_optional_string(h, "side")?
        .map(|v| read_side(&v))
        .transpose()?;
    let event = match handle_string(h, "event")?.as_str() {
        "PLACEMENT" => WsOrderEvent::Placement,
        "UPDATE" => WsOrderEvent::Update,
        "CANCELLATION" => WsOrderEvent::Cancellation,
        _ => return Err(PortfolioIngressError::UnsupportedField("event")),
    };
    Ok(WsOrderUpdate {
        order_id: handle_string(h, "orderId")?,
        owner: handle_optional_string(h, "owner")?,
        market: handle_optional_string(h, "market")?,
        asset_id: handle_optional_string(h, "assetId")?,
        side,
        price: handle_optional_number(h, "price")?,
        original_size: handle_optional_number(h, "originalSize")?,
        size_matched: handle_optional_number(h, "sizeMatched")?,
        status: handle_optional_string(h, "status")?,
        order_type: handle_optional_string(h, "orderType")?,
        outcome: handle_optional_string(h, "outcome")?,
        expiration_sec: handle_optional_number(h, "expirationSec")?,
        created_at_sec: handle_optional_number(h, "createdAtSec")?,
        event,
    })
}
/// One ephemeral scalar view, built from CURRENT original-envelope fields.
/// Opaque graph payloads remain on the admitted event; they are never JSON-decoded here.
fn managed_event_view(
    event: &ManagedAccountEvent,
) -> Result<(AccountEvent, Option<RetainedPayload>), PortfolioIngressError> {
    let h = event.envelope();
    let kind = event.kind()?;
    if kind.matches("fill") {
        let raw = FillRecord::try_from_handle(payload_record(event, "fill")?)?;
        return Ok((
            AccountEvent::Fill {
                fill: fill_view(&raw)?,
            },
            Some(RetainedPayload::Fill(raw)),
        ));
    }
    if kind.matches("positions_split") {
        let raw = PositionsSplitRecord::try_from_handle(payload_record(event, "split")?)?;
        return Ok((
            AccountEvent::PositionsSplit {
                split: split_view(&raw)?,
            },
            Some(RetainedPayload::Split(raw)),
        ));
    }
    let ts_ms = handle_number(h, "tsMs")?;
    let decoded = if kind.matches("order_submitted") {
        let raw = crate::portfolio_records::OpenOrderRecord::try_from_handle(payload_record(
            event, "order",
        )?)?;
        return Ok((
            AccountEvent::OrderSubmitted {
                ts_ms,
                order: open_order_view(&raw)?,
            },
            Some(RetainedPayload::Order(raw)),
        ));
    } else if kind.matches("order_accepted") {
        AccountEvent::OrderAccepted {
            ts_ms,
            client_order_id: handle_string(h, "clientOrderId")?,
            order_id: handle_optional_string(h, "orderId")?,
            market: handle_optional_string(h, "market")?,
        }
    } else if kind.matches("order_open") {
        AccountEvent::OrderOpen {
            ts_ms,
            client_order_id: handle_optional_string(h, "clientOrderId")?,
            order_id: handle_optional_string(h, "orderId")?,
        }
    } else if kind.matches("order_rejected") {
        AccountEvent::OrderRejected {
            ts_ms,
            client_order_id: handle_string(h, "clientOrderId")?,
            reason: handle_string(h, "reason")?,
            market: handle_optional_string(h, "market")?,
        }
    } else if kind.matches("order_done") {
        let reason = match handle_string(h, "reason")?.as_str() {
            "filled" => OrderDoneReason::Filled,
            "canceled" => OrderDoneReason::Canceled,
            "expired" => OrderDoneReason::Expired,
            "killed" => OrderDoneReason::Killed,
            _ => return Err(PortfolioIngressError::UnsupportedField("reason")),
        };
        AccountEvent::OrderDone {
            ts_ms,
            client_order_id: handle_optional_string(h, "clientOrderId")?,
            order_id: handle_optional_string(h, "orderId")?,
            reason,
            filled_size: handle_optional_number(h, "filledSize")?,
        }
    } else if kind.matches("positions_merged") {
        AccountEvent::PositionsMerged {
            ts_ms,
            id: handle_string(h, "id")?,
            market: handle_optional_string(h, "market")?,
            asset_id_a: handle_string(h, "assetIdA")?,
            asset_id_b: handle_string(h, "assetIdB")?,
            size: handle_number(h, "size")?,
            reason: handle_optional_string(h, "reason")?,
        }
    } else if kind.matches("ws_order_update") {
        let raw = crate::portfolio_records::WsOrderUpdateRecord::try_from_handle(payload_record(
            event, "order",
        )?)?;
        AccountEvent::WsOrderUpdate {
            ts_ms,
            order: ws_order_view(&raw)?,
        }
    } else if kind.matches("cancel_failed") {
        let operation = match handle_string(h, "operation")?.as_str() {
            "cancel_order" => CancelOperation::Order,
            "cancel_batch" => CancelOperation::Batch,
            "cancel_market" => CancelOperation::Market,
            "cancel_all" => CancelOperation::All,
            _ => return Err(PortfolioIngressError::UnsupportedField("operation")),
        };
        AccountEvent::CancelFailed {
            ts_ms,
            operation,
            client_order_id: handle_optional_string(h, "clientOrderId")?,
            order_id: handle_optional_string(h, "orderId")?,
            market: handle_optional_string(h, "market")?,
            asset_id: handle_optional_string(h, "assetId")?,
            reason: handle_string(h, "reason")?,
        }
    } else if kind.matches("merge_failed") {
        AccountEvent::MergeFailed {
            ts_ms,
            asset_id_a: handle_string(h, "assetIdA")?,
            asset_id_b: handle_string(h, "assetIdB")?,
            requested_size: handle_number(h, "requestedSize")?,
            reason: handle_string(h, "reason")?,
        }
    } else if kind.matches("split_failed") {
        AccountEvent::SplitFailed {
            ts_ms,
            asset_id_a: handle_string(h, "assetIdA")?,
            asset_id_b: handle_string(h, "assetIdB")?,
            requested_size: handle_number(h, "requestedSize")?,
            reason: handle_string(h, "reason")?,
        }
    } else if kind.matches("account_stream_status") {
        let source = match handle_string(h, "source")?.as_str() {
            "user_ws" => AccountStreamSource::UserWs,
            "rest_poll" => AccountStreamSource::RestPoll,
            _ => return Err(PortfolioIngressError::UnsupportedField("source")),
        };
        let status = match handle_string(h, "status")?.as_str() {
            "connected" => AccountStreamStatus::Connected,
            "disconnected" => AccountStreamStatus::Disconnected,
            _ => return Err(PortfolioIngressError::UnsupportedField("status")),
        };
        AccountEvent::AccountStreamStatus {
            ts_ms,
            source,
            status,
            info: handle_optional_string(h, "info")?,
        }
    } else {
        return Err(PortfolioIngressError::UnsupportedKind);
    };
    Ok((decoded, None))
}

fn snapshot_member(
    root: &PortfolioSnapshotRecord,
    key: &'static str,
) -> Result<crate::metadata::MetadataHandle, PortfolioIngressError> {
    match root.handle().as_handle().get(key)? {
        MetadataValue::Reference(handle) => Ok(handle),
        _ => Err(PortfolioIngressError::UnsupportedField(key)),
    }
}
fn snapshot_map<K: crate::portfolio_records::PortfolioRecordKind>(
    handle: crate::metadata::MetadataHandle,
) -> Result<OrderedMap<crate::portfolio_records::PortfolioRecord<K>>, PortfolioIngressError> {
    let mut map = OrderedMap::default();
    for key in handle.keys()? {
        let name = key
            .as_str()
            .ok_or(PortfolioIngressError::UnsupportedField("snapshot map key"))?
            .to_owned();
        let MetadataValue::Reference(value) = handle.get(key)? else {
            return Err(PortfolioIngressError::UnsupportedField(
                "snapshot map value",
            ));
        };
        map.insert(
            name,
            crate::portfolio_records::PortfolioRecord::try_from_handle(
                RecordHandle::try_from_handle(value)?,
            )?,
        );
    }
    Ok(map)
}
fn snapshot_array<K: crate::portfolio_records::PortfolioRecordKind>(
    handle: crate::metadata::MetadataHandle,
) -> Result<VecDeque<crate::portfolio_records::PortfolioRecord<K>>, PortfolioIngressError> {
    let mut array = VecDeque::new();
    for index in 0..handle.length()? {
        let MetadataValue::Reference(value) = handle.get_index(index)? else {
            return Err(PortfolioIngressError::UnsupportedField(
                "snapshot array value",
            ));
        };
        array.push_back(crate::portfolio_records::PortfolioRecord::try_from_handle(
            RecordHandle::try_from_handle(value)?,
        )?);
    }
    Ok(array)
}
/// Observational typed fixture view. The graph root, not this value, owns cache
/// identity, mutable membership, property presence and shallow-freeze semantics.
pub fn snapshot_view(
    root: &PortfolioSnapshotRecord,
) -> Result<PortfolioSnapshot, PortfolioIngressError> {
    let h = root.handle().as_handle();
    let capital = snapshot_member(root, "capital")?;
    let mut markets = OrderedMap::default();
    let market_map = snapshot_member(root, "marketByAssetId")?;
    for key in market_map.keys()? {
        let name = key
            .as_str()
            .ok_or(PortfolioIngressError::UnsupportedField(
                "snapshot market key",
            ))?
            .to_owned();
        let MetadataValue::String(value) = market_map.get(key)? else {
            return Err(PortfolioIngressError::UnsupportedField(
                "snapshot market value",
            ));
        };
        let value = value
            .as_str()
            .ok_or(PortfolioIngressError::UnsupportedField(
                "snapshot market value",
            ))?
            .to_owned();
        markets.insert(name, value);
    }
    let recent_splits = if root.has(crate::portfolio_records::portfolio_snapshot::RECENT_SPLITS)? {
        snapshot_array(snapshot_member(root, "recentSplits")?)?
    } else {
        VecDeque::new()
    };
    Ok(PortfolioSnapshot {
        capital: CapitalSnapshot {
            starting_capital: handle_number(&capital, "startingCapital")?,
            cash: handle_number(&capital, "cash")?,
            reserved_cash: handle_number(&capital, "reservedCash")?,
            available_cash: handle_number(&capital, "availableCash")?,
        },
        now_ms: handle_number(h, "nowMs")?,
        realized_pnl_total: handle_number(h, "realizedPnlTotal")?,
        positions_by_asset_id: snapshot_map(snapshot_member(root, "positionsByAssetId")?)?,
        open_orders_by_client_id: snapshot_map(snapshot_member(root, "openOrdersByClientId")?)?,
        ws_open_orders_by_order_id: snapshot_map(snapshot_member(root, "wsOpenOrdersByOrderId")?)?,
        orders_by_client_id: snapshot_map(snapshot_member(root, "ordersByClientId")?)?,
        recent_fills: snapshot_array(snapshot_member(root, "recentFills")?)?,
        recent_splits,
        market_by_asset_id: markets,
    })
}
fn graph_map<K: crate::portfolio_records::PortfolioRecordKind>(
    graph: &MetadataGraph,
    map: &OrderedMap<crate::portfolio_records::PortfolioRecord<K>>,
) -> Result<crate::metadata::MetadataHandle, MetadataError> {
    let object = graph.object()?;
    for (key, value) in map.iter() {
        object.set(key, value.handle().as_handle().clone().into())?;
    }
    Ok(object)
}
fn graph_array<K: crate::portfolio_records::PortfolioRecordKind>(
    graph: &MetadataGraph,
    values: &VecDeque<crate::portfolio_records::PortfolioRecord<K>>,
) -> Result<crate::metadata::MetadataHandle, MetadataError> {
    let array = graph.array()?;
    for value in values {
        array.push(value.handle().as_handle().clone().into())?;
    }
    Ok(array)
}

pub struct Portfolio {
    graph: MetadataGraph,
    now_ms: f64,
    clock_initialized: bool,
    starting_capital: f64,
    cash: f64,
    realized_pnl_total: f64,
    positions: OrderedMap<PositionRecord>,
    open: OrderedMap<OpenOrderRecord>,
    history: OrderedMap<OrderSnapshotRecord>,
    ws: OrderedMap<WsOpenOrderRecord>,
    markets: OrderedMap<String>,
    index: HashMap<String, String>,
    persistent: OrderedMap<String>,
    terminal: OrderedMap<()>,
    pending_fills: HashMap<String, f64>,
    pending_status: OrderedMap<TradeStatus>,
    seen: OrderedMap<f64>,
    fills: VecDeque<FillRecord>,
    splits: VecDeque<PositionsSplitRecord>,
    max_recent_fills: f64,
    cash_orders: Vec<CashOrder>,
    cash_client: HashMap<String, usize>,
    cash_exchange: HashMap<String, usize>,
    unlinked: HashMap<String, f64>,
    cached: Option<PortfolioSnapshotRecord>,
    snapshot_rebuilds: u64,
}
impl Portfolio {
    /// initial_now_ms is the construction-time display clock, replaced once by observations.
    pub fn new(options: PortfolioOptions, initial_now_ms: f64) -> Result<Self, &'static str> {
        Self::new_in_graph(&MetadataGraph::new(), options, initial_now_ms)
    }
    /// Production sessions supply the same graph used by account admission,
    /// strategy metadata and retained records. No per-event graph is created.
    pub fn new_in_graph(
        graph: &MetadataGraph,
        options: PortfolioOptions,
        initial_now_ms: f64,
    ) -> Result<Self, &'static str> {
        let starting = validate_starting_capital(options.starting_capital)?;
        Ok(Self {
            graph: graph.clone(),
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
    pub fn get_open_order(&self, client_order_id: &str) -> Option<OpenOrder> {
        self.open
            .get(client_order_id)
            .map(|record| open_order_view(record).expect("typed open-order slots"))
    }
    pub fn get_open_order_record(&self, client_order_id: &str) -> Option<&OpenOrderRecord> {
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
            .map(|root| {
                let capital = snapshot_member(root, "capital").expect("frozen capital");
                handle_number(&capital, "availableCash").expect("frozen numeric capital")
            })
            .unwrap_or_else(|| round8(self.cash - self.reserved_cash()))
    }
    pub fn snapshot_rebuilds(&self) -> u64 {
        self.snapshot_rebuilds
    }
    /// The single authoritative cached root. Membership objects and arrays
    /// capture this epoch; all contained record handles retain original identity.
    pub fn snapshot_record(&mut self) -> Result<PortfolioSnapshotRecord, MetadataError> {
        if let Some(root) = &self.cached {
            return Ok(root.clone());
        }
        let reserved = self.reserved_cash();
        let capital = CapitalRecord::new_capital(
            &self.graph,
            &CapitalSnapshot {
                starting_capital: self.starting_capital,
                cash: self.cash,
                reserved_cash: reserved,
                available_cash: round8(self.cash - reserved),
            },
        )?;
        capital.handle().as_handle().freeze()?;
        let mut properties = vec![
            (
                "capital".into(),
                capital.handle().as_handle().clone().into(),
            ),
            ("nowMs".into(), self.now_ms.into()),
            ("realizedPnlTotal".into(), self.realized_pnl_total.into()),
            (
                "positionsByAssetId".into(),
                graph_map(&self.graph, &self.positions)?.into(),
            ),
            (
                "openOrdersByClientId".into(),
                graph_map(&self.graph, &self.open)?.into(),
            ),
            (
                "wsOpenOrdersByOrderId".into(),
                graph_map(&self.graph, &self.ws)?.into(),
            ),
            (
                "ordersByClientId".into(),
                graph_map(&self.graph, &self.history)?.into(),
            ),
            (
                "recentFills".into(),
                graph_array(&self.graph, &self.fills)?.into(),
            ),
        ];
        if !self.splits.is_empty() {
            properties.push((
                "recentSplits".into(),
                graph_array(&self.graph, &self.splits)?.into(),
            ));
        }
        let markets = self.graph.object()?;
        for (key, value) in self.markets.iter() {
            markets.set(key, value.as_str().into())?;
        }
        properties.push(("marketByAssetId".into(), markets.into()));
        let root = PortfolioSnapshotRecord::new(&self.graph, properties)?;
        root.handle().as_handle().freeze()?;
        self.cached = Some(root.clone());
        self.snapshot_rebuilds += 1;
        Ok(root)
    }
    /// Compatibility diagnostics only. No typed DTO is cached or authoritative.
    /// Production strategy/OrderManager adapters use snapshot_record directly.
    pub fn snapshot(&mut self) -> PortfolioSnapshot {
        snapshot_view(&self.snapshot_record().expect("snapshot allocation"))
            .expect("typed fixture snapshot domain")
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
    fn upsert(&mut self, client_id: &str, next: OrderSnapshotRecord) {
        let view = order_history_view(&next).expect("typed history slots");
        if let Some(id) = truthy(&view.order_id) {
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
    fn order_snapshot(
        &self,
        history_client_id: &str,
        order: &OpenOrder,
        raw: &OpenOrderRecord,
        keep_status: bool,
    ) -> OrderSnapshotRecord {
        let previous = keep_status
            .then(|| self.history.get(history_client_id))
            .flatten()
            .map(|record| order_history_view(record).expect("typed history slots"));
        let view = OrderSnapshot {
            client_order_id: history_client_id.to_owned(),
            order_id: nonempty(&order.order_id),
            asset_id: order.asset_id.clone(),
            side: order.side,
            price: Some(order.price),
            original_size: Some(order.size),
            size_matched: Some(order.filled),
            remaining: Some(order.remaining),
            lifecycle_state: Some(order.state),
            post_only: order.post_only,
            meta: None,
            trade_status_raw: previous.as_ref().and_then(|p| p.trade_status_raw.clone()),
            trade_status_rank: previous
                .as_ref()
                .map(|p| p.trade_status_rank)
                .unwrap_or(0.0),
            updated_at_ms: self.now_ms,
        };
        OrderSnapshotRecord::from_snapshot(
            &self.graph,
            &view,
            raw.handle()
                .as_handle()
                .get("meta")
                .expect("record metadata"),
        )
        .expect("history allocation")
    }
    fn merge_status(&mut self, client_id: &str, order_id: Option<&str>) {
        let Some(order_id) = order_id.filter(|id| !id.is_empty()) else {
            return;
        };
        if let (Some(pending), Some(previous)) = (
            self.pending_status.get(order_id),
            self.history.get(client_id),
        ) {
            let view = order_history_view(previous).expect("typed history slots");
            let next = previous.spread(&self.graph).expect("history spread");
            if let Some(status) = pending.raw.as_ref().or(view.trade_status_raw.as_ref()) {
                next.handle()
                    .as_handle()
                    .set("tradeStatusRaw", status.as_str().into())
                    .expect("history patch");
            }
            next.handle()
                .as_handle()
                .set(
                    "tradeStatusRank",
                    max(view.trade_status_rank, f64::from(pending.rank)).into(),
                )
                .expect("history patch");
            next.handle()
                .as_handle()
                .set(
                    "updatedAtMs",
                    max(view.updated_at_ms, pending.updated_at_ms).into(),
                )
                .expect("history patch");
            self.upsert(client_id, next);
        }
    }
    fn link_cash(&mut self, client_id: &str, order_id: &str) {
        if self.open.get(client_id).is_some_and(|o| {
            self.earlier(
                &open_order_view(o).expect("typed open-order slots"),
                Some(order_id),
            )
        }) {
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
    fn update_order_fill(&mut self, raw: OpenOrderRecord, resolved_client_id: &str, size: f64) {
        let mut order = open_order_view(&raw).expect("typed open-order slots");
        order.filled = round8(order.filled + size);
        order.remaining = round8(max(0.0, order.size - order.filled));
        order.updated_at_ms = self.now_ms;
        order.state = if order.remaining > 0.0 {
            OrderState::PartiallyFilled
        } else {
            OrderState::Filled
        };
        let h = raw.handle().as_handle();
        h.set("filled", order.filled.into()).expect("order patch");
        h.set("remaining", order.remaining.into())
            .expect("order patch");
        h.set("updatedAtMs", order.updated_at_ms.into())
            .expect("order patch");
        h.set("state", state_wire(order.state).into())
            .expect("order patch");
        if order.state == OrderState::Filled {
            self.open.remove(resolved_client_id);
            self.unindex_order(&order);
        } else {
            self.open.insert(resolved_client_id.to_owned(), raw);
        }
        // History updates on lifecycle/WS, not on every fill.
    }
    fn pending_order_fill(&mut self, id: &str) {
        let Some(pending) = self.pending_fills.get(id).copied() else {
            return;
        };
        let Some(client) = self.index.get(id).filter(|s| !s.is_empty()).cloned() else {
            return;
        };
        let Some(order) = self.open.get(&client).cloned() else {
            return;
        };
        let size = max(0.0, finite(pending));
        self.pending_fills.remove(id);
        if size > 0.0 {
            self.update_order_fill(order, &client, size);
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
        if order.as_ref().is_some_and(|o| {
            self.earlier(
                &open_order_view(o).expect("typed open-order slots"),
                fill.order_id.as_deref(),
            )
        }) {
            return;
        }
        if client.as_deref().is_none_or(|s| s.is_empty())
            || order.as_ref().is_some_and(|o| {
                truthy(&open_order_view(o).expect("typed open-order slots").order_id).is_none()
                    && truthy(&fill.order_id).is_some()
            })
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
            self.update_order_fill(
                order,
                client.as_deref().expect("resolved fill client"),
                fill.size,
            );
        }
    }
    fn fill_position(&mut self, fill: &Fill) {
        let previous = self
            .positions
            .get(&fill.asset_id)
            .map(|record| position_view(record).expect("typed numeric position slots"))
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
                PositionRecord::from_position(
                    &self.graph,
                    &Position {
                        asset_id: fill.asset_id.clone(),
                        qty: round8(qty),
                        avg_entry_price: if qty > 0.0 {
                            Some(round8(cost / qty))
                        } else {
                            None
                        },
                        cost_basis: round8(cost),
                    },
                )
                .expect("position allocation"),
            );
        } else {
            let sold = crate::math::js_min(size, previous.qty);
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
                    PositionRecord::from_position(
                        &self.graph,
                        &Position {
                            asset_id: fill.asset_id.clone(),
                            qty: round8(qty),
                            avg_entry_price: Some(round8(basis / qty)),
                            cost_basis: round8(basis),
                        },
                    )
                    .expect("position allocation"),
                );
            } else {
                self.positions.remove(&fill.asset_id);
                if !self.open.iter().any(|(_, o)| {
                    open_order_view(o).expect("typed open-order slots").asset_id == fill.asset_id
                }) {
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
            self.ws.insert(
                id.clone(),
                WsOpenOrderRecord::from_order(&self.graph, &next).expect("WS record allocation"),
            );
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
        let previous = self.history.get(&client).cloned();
        let bot = self.open.get(&client).cloned();
        let previous_view = previous
            .as_ref()
            .map(|p| order_history_view(p).expect("typed history slots"));
        let bot_view = bot
            .as_ref()
            .map(|p| open_order_view(p).expect("typed open-order slots"));
        let current_id = bot_view
            .as_ref()
            .and_then(|o| o.order_id.as_deref())
            .or_else(|| previous_view.as_ref().and_then(|o| o.order_id.as_deref()));
        if current_id != Some(id) {
            return;
        }
        let next = if let Some(previous) = &previous {
            previous.spread(&self.graph).expect("history spread")
        } else if let (Some(raw), Some(view)) = (&bot, &bot_view) {
            let base = self.order_snapshot(&view.client_order_id, view, raw, false);
            base.handle()
                .as_handle()
                .delete("meta")
                .expect("history patch");
            base.handle()
                .as_handle()
                .set("orderId", truthy(&view.order_id).unwrap_or(id).into())
                .expect("history patch");
            base
        } else {
            return;
        };
        let view = order_history_view(&next).expect("typed history slots");
        let h = next.handle().as_handle();
        if !id.is_empty() {
            h.set("orderId", id.as_str().into()).expect("history patch");
        }
        if let Some(asset) = nonempty(&order.asset_id) {
            h.set("assetId", asset.as_str().into())
                .expect("history patch");
        }
        if let Some(side) = order.side {
            h.set(
                "side",
                if side == Side::Buy { "BUY" } else { "SELL" }.into(),
            )
            .expect("history patch");
        }
        if let Some(price) = order.price {
            h.set("price", price.into()).expect("history patch");
        }
        if let Some(original) = order.original_size {
            h.set("originalSize", original.into())
                .expect("history patch");
        }
        if let (Some(original), Some(matched)) = (order.original_size, order.size_matched) {
            h.set("remaining", round8(max(0.0, original - matched)).into())
                .expect("history patch");
        }
        if let Some(status) = &order.status {
            h.set("tradeStatusRaw", status.as_str().into())
                .expect("history patch");
        }
        h.set(
            "tradeStatusRank",
            max(view.trade_status_rank, f64::from(rank)).into(),
        )
        .expect("history patch");
        h.set("updatedAtMs", self.now_ms.into())
            .expect("history patch");
        h.set(
            "sizeMatched",
            max(
                view.size_matched.unwrap_or(0.0),
                order.size_matched.unwrap_or(0.0),
            )
            .into(),
        )
        .expect("history patch");
        if self.terminal.contains_key(id) {
            h.set("remaining", 0.0.into()).expect("history patch");
        }
        self.upsert(&client, next);
    }
    /// Typed compatibility ingress for fixtures/adapters. Each invocation creates
    /// a fresh fill/split identity; queued production events use apply_managed.
    pub fn apply(&mut self, event: &AccountEvent) {
        let payload = match event {
            AccountEvent::OrderSubmitted { order, .. } => Some(RetainedPayload::Order(
                OpenOrderRecord::from_order(&self.graph, order).expect("typed order ingress"),
            )),
            AccountEvent::Fill { fill } => Some(RetainedPayload::Fill(
                FillRecord::from_fill(&self.graph, fill).expect("typed fill ingress"),
            )),
            AccountEvent::PositionsSplit { split } => Some(RetainedPayload::Split(
                PositionsSplitRecord::from_split(&self.graph, split).expect("typed split ingress"),
            )),
            _ => None,
        };
        self.apply_core(event, payload);
    }
    pub fn graph(&self) -> &MetadataGraph {
        &self.graph
    }
    /// Resolve current slots from the original admitted envelope. The temporary
    /// scalar view feeds the same transition as typed compatibility callers.
    /// All known lifecycle kinds use typed current-field views; generic coercion
    /// and prototype behavior remain separate SDK requirements.
    pub fn apply_managed(
        &mut self,
        event: &ManagedAccountEvent,
    ) -> Result<(), PortfolioIngressError> {
        if !self.graph.owns(event.envelope()) {
            return Err(MetadataError::WrongGraph.into());
        }
        let (view, payload) = managed_event_view(event)?;
        self.apply_core(&view, payload);
        Ok(())
    }
    fn apply_core(&mut self, event: &AccountEvent, payload: Option<RetainedPayload>) {
        self.cached = None;
        let timestamp = event.timestamp_ms();
        self.initialize_clock(timestamp);
        self.now_ms = max(self.now_ms, timestamp);
        self.cash_event(event);
        match event {
            AccountEvent::WsOrderUpdate { order, .. } => self.ws_update(order),
            AccountEvent::OrderSubmitted { order, .. } => {
                let Some(RetainedPayload::Order(raw)) = payload else {
                    unreachable!("order ingress identity")
                };
                self.open.insert(order.client_order_id.clone(), raw.clone());
                self.index_order(order);
                if let Some(market) = nonempty(&order.market) {
                    self.markets.insert(order.asset_id.clone(), market);
                }
                self.upsert(
                    &order.client_order_id,
                    self.order_snapshot(&order.client_order_id, order, &raw, false),
                );
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
                let Some(raw) = self.open.remove(client_order_id) else {
                    return;
                };
                let h = raw.handle().as_handle();
                h.set("state", "rejected".into()).expect("order patch");
                h.set("lastError", reason.as_str().into())
                    .expect("order patch");
                h.set("remaining", 0.0.into()).expect("order patch");
                h.set("updatedAtMs", self.now_ms.into())
                    .expect("order patch");
                let order = open_order_view(&raw).expect("typed open-order slots");
                self.unindex_order(&order);
                self.upsert(
                    client_order_id,
                    self.order_snapshot(client_order_id, &order, &raw, true),
                );
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
                let Some(RetainedPayload::Fill(raw)) = payload else {
                    unreachable!("fill ingress identity")
                };
                self.fills.push_back(raw);
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
                    let next = if let Some(previous) = self.positions.get(asset) {
                        let position =
                            position_view(previous).expect("typed numeric position slots");
                        previous
                            .with_quantity(&self.graph, round8(position.qty + size))
                            .expect("spread position")
                    } else {
                        PositionRecord::from_position(
                            &self.graph,
                            &Position {
                                asset_id: asset.clone(),
                                qty: round8(size),
                                avg_entry_price: None,
                                cost_basis: 0.0,
                            },
                        )
                        .expect("position allocation")
                    };
                    self.positions.insert(asset.clone(), next);
                    if let Some(market) = nonempty(&split.market) {
                        self.markets.insert(asset.clone(), market);
                    }
                }
                let Some(RetainedPayload::Split(raw)) = payload else {
                    unreachable!("split ingress identity")
                };
                self.splits.push_back(raw);
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
                let qa = finite(
                    self.positions
                        .get(asset_id_a)
                        .map(|p| position_view(p).expect("typed numeric position slots").qty)
                        .unwrap_or(0.0),
                );
                let qb = finite(
                    self.positions
                        .get(asset_id_b)
                        .map(|p| position_view(p).expect("typed numeric position slots").qty)
                        .unwrap_or(0.0),
                );
                let actual = crate::math::js_min(crate::math::js_min(requested, qa), qb);
                if !actual.is_finite() || actual <= 0.0 {
                    return;
                }
                for asset in [asset_id_a, asset_id_b] {
                    if let Some(previous) = self.positions.get(asset) {
                        let qty = round8(
                            position_view(previous)
                                .expect("typed numeric position slots")
                                .qty
                                - actual,
                        );
                        if qty > 0.0 {
                            let next = previous
                                .with_quantity(&self.graph, qty)
                                .expect("spread position");
                            self.positions.insert(asset.clone(), next);
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
        let Some(raw) = self.open.get(client_id).cloned() else {
            return;
        };
        let mut order = open_order_view(&raw).expect("typed open-order slots");
        if self.earlier(&order, order_id.as_deref()) {
            return;
        }
        if let Some(id) = order_id {
            raw.handle()
                .as_handle()
                .set("orderId", id.as_str().into())
                .expect("order patch");
            order.order_id = Some(id.clone());
        }
        self.index_order(&order);
        if force_open || order.state == OrderState::Requested {
            order.state = OrderState::Open;
        }
        raw.handle()
            .as_handle()
            .set("state", state_wire(order.state).into())
            .expect("order patch");
        raw.handle()
            .as_handle()
            .set("updatedAtMs", self.now_ms.into())
            .expect("order patch");
        order.updated_at_ms = self.now_ms;
        self.open.insert(order.client_order_id.clone(), raw.clone());
        self.upsert(
            &order.client_order_id,
            self.order_snapshot(&order.client_order_id, &order, &raw, true),
        );
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
        let Some(raw) = self.open.get(&client).cloned() else {
            if let Some(previous) = previous {
                let view = order_history_view(&previous).expect("typed history slots");
                if (truthy(order_id).is_none() || view.order_id == *order_id)
                    && matches!(
                        view.lifecycle_state,
                        None | Some(
                            OrderState::Requested | OrderState::Open | OrderState::PartiallyFilled
                        )
                    )
                {
                    let next = previous.spread(&self.graph).expect("history spread");
                    let h = next.handle().as_handle();
                    h.set("lifecycleState", state_wire(reason).into())
                        .expect("history patch");
                    h.set("remaining", 0.0.into()).expect("history patch");
                    if reason == OrderState::Filled {
                        if let Some(original) = view.original_size {
                            h.set("sizeMatched", original.into())
                                .expect("history patch");
                        }
                    }
                    h.set("updatedAtMs", self.now_ms.into())
                        .expect("history patch");
                    self.upsert(&client, next);
                }
            }
            return;
        };
        let mut order = open_order_view(&raw).expect("typed open-order slots");
        if self.earlier(&order, order_id.as_deref()) {
            return;
        }
        if let Some(id) = truthy(&order.order_id) {
            self.mark_terminal(id);
        }
        let h = raw.handle().as_handle();
        h.set("state", state_wire(reason).into())
            .expect("order patch");
        h.set("remaining", 0.0.into()).expect("order patch");
        h.set("updatedAtMs", self.now_ms.into())
            .expect("order patch");
        order.state = reason;
        order.remaining = 0.0;
        order.updated_at_ms = self.now_ms;
        self.open.remove(&client);
        self.unindex_order(&order);
        let next = self.order_snapshot(&client, &order, &raw, true);
        let previous_matched = previous
            .as_ref()
            .map(|p| order_history_view(p).expect("typed history slots"))
            .and_then(|p| p.size_matched)
            .unwrap_or(0.0);
        next.handle()
            .as_handle()
            .set("sizeMatched", max(order.filled, previous_matched).into())
            .expect("history patch");
        self.upsert(&client, next);
        self.merge_status(&client, order.order_id.as_deref());
    }
}
