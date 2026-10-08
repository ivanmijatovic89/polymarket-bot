//! Typed Portfolio record slots in the session-owned metadata graph.
//! Schemas select direct slots; allocation order determines own-property order.
use crate::{
    market_json::JsString,
    metadata::{MetadataError, MetadataGraph, MetadataHandle, MetadataValue},
    record::{FieldId, RecordHandle, RecordSchema},
};
use std::marker::PhantomData;

pub trait PortfolioRecordKind {
    const SCHEMA: &'static RecordSchema;
}

#[derive(Debug)]
pub struct PortfolioRecord<K: PortfolioRecordKind> {
    handle: RecordHandle,
    kind: PhantomData<K>,
}
impl<K: PortfolioRecordKind> Clone for PortfolioRecord<K> {
    fn clone(&self) -> Self {
        Self {
            handle: self.handle.clone(),
            kind: PhantomData,
        }
    }
}
impl<K: PortfolioRecordKind> PortfolioRecord<K> {
    pub fn new(
        graph: &MetadataGraph,
        properties: Vec<(JsString, MetadataValue)>,
    ) -> Result<Self, MetadataError> {
        Self::try_from_handle(graph.record(K::SCHEMA, properties)?)
    }
    pub fn try_from_handle(handle: RecordHandle) -> Result<Self, MetadataError> {
        if !std::ptr::eq(handle.schema(), K::SCHEMA) {
            return Err(MetadataError::WrongKind);
        }
        Ok(Self {
            handle,
            kind: PhantomData,
        })
    }
    pub fn handle(&self) -> &RecordHandle {
        &self.handle
    }
    pub fn get(&self, field: FieldId) -> Result<MetadataValue, MetadataError> {
        self.handle.get_field(field)
    }
    pub fn number(&self, field: FieldId) -> Result<Option<f64>, MetadataError> {
        self.handle.number(field)
    }
    pub fn set(&self, field: FieldId, value: MetadataValue) -> Result<(), MetadataError> {
        self.handle.set_field(field, value)
    }
    pub fn delete(&self, field: FieldId) -> Result<bool, MetadataError> {
        self.handle.delete_field(field)
    }
    pub fn has(&self, field: FieldId) -> Result<bool, MetadataError> {
        self.handle.has_field(field)
    }
}

pub mod position {
    use super::*;
    pub static SCHEMA: RecordSchema = RecordSchema::new(
        "Position",
        &["assetId", "qty", "avgEntryPrice", "costBasis"],
    );
    pub const ASSET_ID: FieldId = SCHEMA.field(0);
    pub const QTY: FieldId = SCHEMA.field(1);
    pub const AVG_ENTRY_PRICE: FieldId = SCHEMA.field(2);
    pub const COST_BASIS: FieldId = SCHEMA.field(3);
}
#[derive(Debug)]
pub struct PositionKind;
impl PortfolioRecordKind for PositionKind {
    const SCHEMA: &'static RecordSchema = &position::SCHEMA;
}
pub type PositionRecord = PortfolioRecord<PositionKind>;

pub mod open_order {
    use super::*;
    pub static SCHEMA: RecordSchema = RecordSchema::new(
        "OpenOrder",
        &[
            "clientOrderId",
            "orderId",
            "market",
            "assetId",
            "side",
            "price",
            "size",
            "remaining",
            "filled",
            "orderType",
            "postOnly",
            "meta",
            "expireAtMs",
            "state",
            "createdAtMs",
            "updatedAtMs",
            "lastError",
        ],
    );
    pub const CLIENT_ORDER_ID: FieldId = SCHEMA.field(0);
    pub const ORDER_ID: FieldId = SCHEMA.field(1);
    pub const MARKET: FieldId = SCHEMA.field(2);
    pub const ASSET_ID: FieldId = SCHEMA.field(3);
    pub const SIDE: FieldId = SCHEMA.field(4);
    pub const PRICE: FieldId = SCHEMA.field(5);
    pub const SIZE: FieldId = SCHEMA.field(6);
    pub const REMAINING: FieldId = SCHEMA.field(7);
    pub const FILLED: FieldId = SCHEMA.field(8);
    pub const ORDER_TYPE: FieldId = SCHEMA.field(9);
    pub const POST_ONLY: FieldId = SCHEMA.field(10);
    pub const META: FieldId = SCHEMA.field(11);
    pub const EXPIRE_AT_MS: FieldId = SCHEMA.field(12);
    pub const STATE: FieldId = SCHEMA.field(13);
    pub const CREATED_AT_MS: FieldId = SCHEMA.field(14);
    pub const UPDATED_AT_MS: FieldId = SCHEMA.field(15);
    pub const LAST_ERROR: FieldId = SCHEMA.field(16);
}
#[derive(Debug)]
pub struct OpenOrderKind;
impl PortfolioRecordKind for OpenOrderKind {
    const SCHEMA: &'static RecordSchema = &open_order::SCHEMA;
}
pub type OpenOrderRecord = PortfolioRecord<OpenOrderKind>;

pub mod fill {
    use super::*;
    pub static SCHEMA: RecordSchema = RecordSchema::new(
        "Fill",
        &[
            "id",
            "tsMs",
            "market",
            "assetId",
            "side",
            "price",
            "size",
            "feeRateBps",
            "clientOrderId",
            "orderId",
            "liquidity",
            "intentMeta",
        ],
    );
    pub const ID: FieldId = SCHEMA.field(0);
    pub const TS_MS: FieldId = SCHEMA.field(1);
    pub const MARKET: FieldId = SCHEMA.field(2);
    pub const ASSET_ID: FieldId = SCHEMA.field(3);
    pub const SIDE: FieldId = SCHEMA.field(4);
    pub const PRICE: FieldId = SCHEMA.field(5);
    pub const SIZE: FieldId = SCHEMA.field(6);
    pub const FEE_RATE_BPS: FieldId = SCHEMA.field(7);
    pub const CLIENT_ORDER_ID: FieldId = SCHEMA.field(8);
    pub const ORDER_ID: FieldId = SCHEMA.field(9);
    pub const LIQUIDITY: FieldId = SCHEMA.field(10);
    pub const INTENT_META: FieldId = SCHEMA.field(11);
}
#[derive(Debug)]
pub struct FillKind;
impl PortfolioRecordKind for FillKind {
    const SCHEMA: &'static RecordSchema = &fill::SCHEMA;
}
pub type FillRecord = PortfolioRecord<FillKind>;

pub mod positions_split {
    use super::*;
    pub static SCHEMA: RecordSchema = RecordSchema::new(
        "PositionsSplit",
        &[
            "id",
            "tsMs",
            "market",
            "assetIdA",
            "assetIdB",
            "size",
            "splitCost",
            "reason",
        ],
    );
    pub const ID: FieldId = SCHEMA.field(0);
    pub const TS_MS: FieldId = SCHEMA.field(1);
    pub const MARKET: FieldId = SCHEMA.field(2);
    pub const ASSET_ID_A: FieldId = SCHEMA.field(3);
    pub const ASSET_ID_B: FieldId = SCHEMA.field(4);
    pub const SIZE: FieldId = SCHEMA.field(5);
    pub const SPLIT_COST: FieldId = SCHEMA.field(6);
    pub const REASON: FieldId = SCHEMA.field(7);
}
#[derive(Debug)]
pub struct PositionsSplitKind;
impl PortfolioRecordKind for PositionsSplitKind {
    const SCHEMA: &'static RecordSchema = &positions_split::SCHEMA;
}
pub type PositionsSplitRecord = PortfolioRecord<PositionsSplitKind>;

pub mod ws_open_order {
    use super::*;
    pub static SCHEMA: RecordSchema = RecordSchema::new(
        "WsOpenOrder",
        &[
            "orderId",
            "owner",
            "market",
            "assetId",
            "side",
            "price",
            "originalSize",
            "sizeMatched",
            "status",
            "orderType",
            "outcome",
            "updatedAtMs",
        ],
    );
    pub const ORDER_ID: FieldId = SCHEMA.field(0);
    pub const OWNER: FieldId = SCHEMA.field(1);
    pub const MARKET: FieldId = SCHEMA.field(2);
    pub const ASSET_ID: FieldId = SCHEMA.field(3);
    pub const SIDE: FieldId = SCHEMA.field(4);
    pub const PRICE: FieldId = SCHEMA.field(5);
    pub const ORIGINAL_SIZE: FieldId = SCHEMA.field(6);
    pub const SIZE_MATCHED: FieldId = SCHEMA.field(7);
    pub const STATUS: FieldId = SCHEMA.field(8);
    pub const ORDER_TYPE: FieldId = SCHEMA.field(9);
    pub const OUTCOME: FieldId = SCHEMA.field(10);
    pub const UPDATED_AT_MS: FieldId = SCHEMA.field(11);
}
#[derive(Debug)]
pub struct WsOpenOrderKind;
impl PortfolioRecordKind for WsOpenOrderKind {
    const SCHEMA: &'static RecordSchema = &ws_open_order::SCHEMA;
}
pub type WsOpenOrderRecord = PortfolioRecord<WsOpenOrderKind>;

pub mod order_snapshot {
    use super::*;
    pub static SCHEMA: RecordSchema = RecordSchema::new(
        "OrderSnapshot",
        &[
            "clientOrderId",
            "orderId",
            "assetId",
            "side",
            "price",
            "originalSize",
            "sizeMatched",
            "remaining",
            "lifecycleState",
            "postOnly",
            "meta",
            "tradeStatusRaw",
            "tradeStatusRank",
            "updatedAtMs",
        ],
    );
    pub const CLIENT_ORDER_ID: FieldId = SCHEMA.field(0);
    pub const ORDER_ID: FieldId = SCHEMA.field(1);
    pub const ASSET_ID: FieldId = SCHEMA.field(2);
    pub const SIDE: FieldId = SCHEMA.field(3);
    pub const PRICE: FieldId = SCHEMA.field(4);
    pub const ORIGINAL_SIZE: FieldId = SCHEMA.field(5);
    pub const SIZE_MATCHED: FieldId = SCHEMA.field(6);
    pub const REMAINING: FieldId = SCHEMA.field(7);
    pub const LIFECYCLE_STATE: FieldId = SCHEMA.field(8);
    pub const POST_ONLY: FieldId = SCHEMA.field(9);
    pub const META: FieldId = SCHEMA.field(10);
    pub const TRADE_STATUS_RAW: FieldId = SCHEMA.field(11);
    pub const TRADE_STATUS_RANK: FieldId = SCHEMA.field(12);
    pub const UPDATED_AT_MS: FieldId = SCHEMA.field(13);
}
#[derive(Debug)]
pub struct OrderSnapshotKind;
impl PortfolioRecordKind for OrderSnapshotKind {
    const SCHEMA: &'static RecordSchema = &order_snapshot::SCHEMA;
}
pub type OrderSnapshotRecord = PortfolioRecord<OrderSnapshotKind>;

/// Fixture/control ingress only. A production adapter supplies existing graph
/// values; importing JSON cannot create shared references or JavaScript holes.
pub fn import_control_value(
    graph: &MetadataGraph,
    value: &serde_json::Value,
) -> Result<MetadataValue, MetadataError> {
    use serde_json::Value;
    enum Work<'a> {
        Value(&'a Value),
        Object(Vec<&'a str>),
        Array(usize),
    }
    let mut work = vec![Work::Value(value)];
    let mut results = Vec::new();
    while let Some(item) = work.pop() {
        match item {
            Work::Value(value) => match value {
                Value::Null => results.push(MetadataValue::Null),
                Value::Bool(value) => results.push(MetadataValue::Bool(*value)),
                Value::Number(value) => {
                    results.push(MetadataValue::Number(value.as_f64().expect("JSON number")))
                }
                Value::String(value) => results.push(MetadataValue::String(value.as_str().into())),
                Value::Array(values) => {
                    work.push(Work::Array(values.len()));
                    work.extend(values.iter().rev().map(Work::Value));
                }
                Value::Object(values) => {
                    work.push(Work::Object(values.keys().map(String::as_str).collect()));
                    work.extend(values.values().rev().map(Work::Value));
                }
            },
            Work::Array(count) => {
                let values = results.split_off(results.len() - count);
                let array = graph.array()?;
                for value in values {
                    array.push(value)?;
                }
                results.push(array.into());
            }
            Work::Object(keys) => {
                let values = results.split_off(results.len() - keys.len());
                let object = graph.object()?;
                for (key, value) in keys.into_iter().zip(values) {
                    object.set(key, value)?;
                }
                results.push(object.into());
            }
        }
    }
    Ok(results.pop().expect("one imported value"))
}

/// Observation boundary only; accounting never serializes a graph record.
impl<K: PortfolioRecordKind> serde::Serialize for PortfolioRecord<K> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::Error;
        let text = self
            .handle
            .as_handle()
            .stringify()
            .map_err(S::Error::custom)?
            .expect("a record is a JSON object");
        let value: serde_json::Value = serde_json::from_str(&text).map_err(S::Error::custom)?;
        value.serialize(serializer)
    }
}

impl FillRecord {
    /// Typed fixture ingress. Scalar IEEE values are never projected through JSON.
    pub fn from_fill(
        graph: &MetadataGraph,
        value: &crate::portfolio::Fill,
    ) -> Result<Self, MetadataError> {
        let mut properties = vec![
            ("id".into(), value.id.as_str().into()),
            ("tsMs".into(), value.ts_ms.into()),
        ];
        if let Some(x) = &value.market {
            properties.push(("market".into(), x.as_str().into()));
        }
        properties.extend([
            ("assetId".into(), value.asset_id.as_str().into()),
            (
                "side".into(),
                if value.side == crate::portfolio::Side::Buy {
                    "BUY"
                } else {
                    "SELL"
                }
                .into(),
            ),
            ("price".into(), value.price.into()),
            ("size".into(), value.size.into()),
        ]);
        if let Some(x) = value.fee_rate_bps {
            properties.push(("feeRateBps".into(), x.into()));
        }
        if let Some(x) = &value.client_order_id {
            properties.push(("clientOrderId".into(), x.as_str().into()));
        }
        if let Some(x) = &value.order_id {
            properties.push(("orderId".into(), x.as_str().into()));
        }
        if let Some(x) = value.liquidity {
            properties.push((
                "liquidity".into(),
                if x == crate::portfolio::Liquidity::Taker {
                    "TAKER"
                } else {
                    "MAKER"
                }
                .into(),
            ));
        }
        if let Some(x) = &value.intent_meta {
            properties.push(("intentMeta".into(), import_control_value(graph, x)?));
        }
        for (key, value) in &value.extensions {
            properties.push((key.as_str().into(), import_control_value(graph, value)?));
        }
        Self::new(graph, properties)
    }
}
impl PositionsSplitRecord {
    pub fn from_split(
        graph: &MetadataGraph,
        value: &crate::portfolio::PositionsSplit,
    ) -> Result<Self, MetadataError> {
        let mut properties = vec![
            ("id".into(), value.id.as_str().into()),
            ("tsMs".into(), value.ts_ms.into()),
        ];
        if let Some(x) = &value.market {
            properties.push(("market".into(), x.as_str().into()));
        }
        properties.extend([
            ("assetIdA".into(), value.asset_id_a.as_str().into()),
            ("assetIdB".into(), value.asset_id_b.as_str().into()),
            ("size".into(), value.size.into()),
            ("splitCost".into(), value.split_cost.into()),
        ]);
        if let Some(x) = &value.reason {
            properties.push(("reason".into(), x.as_str().into()));
        }
        for (key, value) in &value.extensions {
            properties.push((key.as_str().into(), import_control_value(graph, value)?));
        }
        Self::new(graph, properties)
    }
}

/// Field slots never prescribe insertion order of original account envelopes.
pub mod account_event {
    use super::*;
    pub static SCHEMA: RecordSchema = RecordSchema::new(
        "AccountEvent",
        &[
            "kind",
            "tsMs",
            "order",
            "fill",
            "split",
            "clientOrderId",
            "orderId",
            "market",
            "reason",
            "filledSize",
            "id",
            "assetIdA",
            "assetIdB",
            "size",
            "operation",
            "assetId",
            "requestedSize",
            "source",
            "status",
            "info",
        ],
    );
}
pub mod ws_order_update {
    use super::*;
    pub static SCHEMA: RecordSchema = RecordSchema::new(
        "WsOrderUpdate",
        &[
            "orderId",
            "owner",
            "market",
            "assetId",
            "side",
            "price",
            "originalSize",
            "sizeMatched",
            "status",
            "orderType",
            "outcome",
            "expirationSec",
            "createdAtSec",
            "event",
        ],
    );
}
#[derive(Debug)]
pub struct WsOrderUpdateKind;
impl PortfolioRecordKind for WsOrderUpdateKind {
    const SCHEMA: &'static RecordSchema = &ws_order_update::SCHEMA;
}
pub type WsOrderUpdateRecord = PortfolioRecord<WsOrderUpdateKind>;

/// One original envelope identity allocated before account queue admission.
/// Processing resolves its current payload rather than a detached scalar copy.
#[derive(Clone, Debug)]
pub struct ManagedAccountEvent {
    envelope: MetadataHandle,
}
impl ManagedAccountEvent {
    pub fn from_envelope(envelope: MetadataHandle) -> Self {
        Self { envelope }
    }
    pub fn envelope(&self) -> &MetadataHandle {
        &self.envelope
    }
    /// Read the original envelope at processing time, preserving mutable identity.
    pub fn kind(&self) -> Result<JsString, MetadataError> {
        match self.envelope.get("kind")? {
            MetadataValue::String(kind) => Ok(kind),
            _ => Err(MetadataError::WrongKind),
        }
    }
    pub fn payload(&self, key: &str) -> Result<MetadataValue, MetadataError> {
        self.envelope.get(key)
    }
    /// Typed-number seam; arbitrary JS coercion remains the SDK boundary's job.
    pub fn timestamp_ms(&self) -> Result<f64, MetadataError> {
        let kind = self.kind()?;
        let value = if kind.matches("fill") || kind.matches("positions_split") {
            let key = if kind.matches("fill") {
                "fill"
            } else {
                "split"
            };
            match self.envelope.get(key)? {
                MetadataValue::Reference(payload) => payload.get("tsMs")?,
                _ => return Err(MetadataError::WrongKind),
            }
        } else {
            self.envelope.get("tsMs")?
        };
        match value {
            MetadataValue::Number(value) => Ok(value),
            _ => Err(MetadataError::WrongKind),
        }
    }
    pub fn fill(graph: &MetadataGraph, payload: FillRecord) -> Result<Self, MetadataError> {
        let envelope = graph.object()?;
        envelope.set("kind", "fill".into())?;
        envelope.set("fill", payload.handle.into())?;
        Ok(Self { envelope })
    }
    pub fn positions_split(
        graph: &MetadataGraph,
        payload: PositionsSplitRecord,
    ) -> Result<Self, MetadataError> {
        let envelope = graph.object()?;
        envelope.set("kind", "positions_split".into())?;
        envelope.set("split", payload.handle.into())?;
        Ok(Self { envelope })
    }
}

impl PositionRecord {
    /// A new position value replaces the prior record on a trade fill.
    pub fn from_position(
        graph: &MetadataGraph,
        value: &crate::portfolio::Position,
    ) -> Result<Self, MetadataError> {
        Self::new(
            graph,
            vec![
                ("assetId".into(), value.asset_id.as_str().into()),
                ("qty".into(), value.qty.into()),
                (
                    "avgEntryPrice".into(),
                    value
                        .avg_entry_price
                        .map_or(MetadataValue::Null, MetadataValue::Number),
                ),
                ("costBasis".into(), value.cost_basis.into()),
            ],
        )
    }
    /// Spread retains every current own property and shared nested reference;
    /// only the quantity is replaced, as in split/merge accounting.
    pub fn with_quantity(&self, graph: &MetadataGraph, qty: f64) -> Result<Self, MetadataError> {
        let handle = self.handle().as_handle();
        let properties = handle
            .keys()?
            .into_iter()
            .map(|key| handle.get(key.clone()).map(|value| (key, value)))
            .collect::<Result<Vec<_>, _>>()?;
        let record = Self::new(graph, properties)?;
        record.set(position::QTY, qty.into())?;
        Ok(record)
    }
}

impl OpenOrderRecord {
    /// Compatibility input only; managed admission supplies the original record.
    pub fn from_order(
        graph: &MetadataGraph,
        value: &crate::portfolio::OpenOrder,
    ) -> Result<Self, MetadataError> {
        use crate::portfolio::{OrderState, OrderType, Side};
        let mut p = vec![(
            "clientOrderId".into(),
            value.client_order_id.as_str().into(),
        )];
        if let Some(v) = &value.order_id {
            p.push(("orderId".into(), v.as_str().into()));
        }
        if let Some(v) = &value.market {
            p.push(("market".into(), v.as_str().into()));
        }
        p.extend([
            ("assetId".into(), value.asset_id.as_str().into()),
            (
                "side".into(),
                if value.side == Side::Buy {
                    "BUY"
                } else {
                    "SELL"
                }
                .into(),
            ),
            ("price".into(), value.price.into()),
            ("size".into(), value.size.into()),
            ("remaining".into(), value.remaining.into()),
            ("filled".into(), value.filled.into()),
        ]);
        if let Some(v) = value.order_type {
            p.push((
                "orderType".into(),
                match v {
                    OrderType::Fok => "FOK",
                    OrderType::Gtc => "GTC",
                    OrderType::Gtd => "GTD",
                }
                .into(),
            ));
        }
        if let Some(v) = value.post_only {
            p.push(("postOnly".into(), MetadataValue::Bool(v)));
        }
        if let Some(v) = &value.meta {
            p.push(("meta".into(), import_control_value(graph, v)?));
        }
        if let Some(v) = value.expire_at_ms {
            p.push(("expireAtMs".into(), v.into()));
        }
        p.extend([
            (
                "state".into(),
                match value.state {
                    OrderState::Requested => "requested",
                    OrderState::Open => "open",
                    OrderState::PartiallyFilled => "partially_filled",
                    OrderState::Filled => "filled",
                    OrderState::Canceled => "canceled",
                    OrderState::Rejected => "rejected",
                    OrderState::Expired => "expired",
                    OrderState::Killed => "killed",
                }
                .into(),
            ),
            ("createdAtMs".into(), value.created_at_ms.into()),
            ("updatedAtMs".into(), value.updated_at_ms.into()),
        ]);
        if let Some(v) = &value.last_error {
            p.push(("lastError".into(), v.as_str().into()));
        }
        for (k, v) in &value.extensions {
            p.push((k.as_str().into(), import_control_value(graph, v)?));
        }
        Self::new(graph, p)
    }
}
impl OrderSnapshotRecord {
    pub fn spread(&self, graph: &MetadataGraph) -> Result<Self, MetadataError> {
        let h = self.handle().as_handle();
        Self::new(
            graph,
            h.keys()?
                .into_iter()
                .map(|k| h.get(k.clone()).map(|v| (k, v)))
                .collect::<Result<Vec<_>, _>>()?,
        )
    }
    pub fn from_snapshot(
        graph: &MetadataGraph,
        value: &crate::portfolio::OrderSnapshot,
        meta: MetadataValue,
    ) -> Result<Self, MetadataError> {
        use crate::portfolio::{OrderState, Side};
        let mut p = vec![(
            "clientOrderId".into(),
            value.client_order_id.as_str().into(),
        )];
        if let Some(v) = &value.order_id {
            p.push(("orderId".into(), v.as_str().into()));
        }
        p.extend([
            ("assetId".into(), value.asset_id.as_str().into()),
            (
                "side".into(),
                if value.side == Side::Buy {
                    "BUY"
                } else {
                    "SELL"
                }
                .into(),
            ),
        ]);
        for (k, v) in [
            ("price", value.price),
            ("originalSize", value.original_size),
            ("sizeMatched", value.size_matched),
            ("remaining", value.remaining),
        ] {
            if let Some(v) = v {
                p.push((k.into(), v.into()));
            }
        }
        if let Some(v) = value.lifecycle_state {
            p.push((
                "lifecycleState".into(),
                match v {
                    OrderState::Requested => "requested",
                    OrderState::Open => "open",
                    OrderState::PartiallyFilled => "partially_filled",
                    OrderState::Filled => "filled",
                    OrderState::Canceled => "canceled",
                    OrderState::Rejected => "rejected",
                    OrderState::Expired => "expired",
                    OrderState::Killed => "killed",
                }
                .into(),
            ));
        }
        if let Some(v) = value.post_only {
            p.push(("postOnly".into(), MetadataValue::Bool(v)));
        }
        if meta.is_truthy() {
            p.push(("meta".into(), meta));
        }
        if let Some(v) = &value.trade_status_raw {
            p.push(("tradeStatusRaw".into(), v.as_str().into()));
        }
        p.extend([
            ("tradeStatusRank".into(), value.trade_status_rank.into()),
            ("updatedAtMs".into(), value.updated_at_ms.into()),
        ]);
        Self::new(graph, p)
    }
}

impl WsOpenOrderRecord {
    /// WS observations replace this value; retained snapshots keep prior records.
    pub fn from_order(
        graph: &MetadataGraph,
        value: &crate::portfolio::WsOpenOrder,
    ) -> Result<Self, MetadataError> {
        let mut p = vec![("orderId".into(), value.order_id.as_str().into())];
        for (key, value) in [
            ("owner", &value.owner),
            ("market", &value.market),
            ("assetId", &value.asset_id),
        ] {
            if let Some(value) = value {
                p.push((key.into(), value.as_str().into()));
            }
        }
        if let Some(side) = value.side {
            p.push((
                "side".into(),
                if side == crate::portfolio::Side::Buy {
                    "BUY"
                } else {
                    "SELL"
                }
                .into(),
            ));
        }
        for (key, value) in [
            ("price", value.price),
            ("originalSize", value.original_size),
            ("sizeMatched", value.size_matched),
        ] {
            if let Some(value) = value {
                p.push((key.into(), value.into()));
            }
        }
        for (key, value) in [
            ("status", &value.status),
            ("orderType", &value.order_type),
            ("outcome", &value.outcome),
        ] {
            if let Some(value) = value {
                p.push((key.into(), value.as_str().into()));
            }
        }
        p.push(("updatedAtMs".into(), value.updated_at_ms.into()));
        Self::new(graph, p)
    }
}

pub mod capital {
    use super::*;
    pub static SCHEMA: RecordSchema = RecordSchema::new(
        "Capital",
        &["startingCapital", "cash", "reservedCash", "availableCash"],
    );
    pub const STARTING_CAPITAL: FieldId = SCHEMA.field(0);
    pub const CASH: FieldId = SCHEMA.field(1);
    pub const RESERVED_CASH: FieldId = SCHEMA.field(2);
    pub const AVAILABLE_CASH: FieldId = SCHEMA.field(3);
}
#[derive(Debug)]
pub struct CapitalKind;
impl PortfolioRecordKind for CapitalKind {
    const SCHEMA: &'static RecordSchema = &capital::SCHEMA;
}
pub type CapitalRecord = PortfolioRecord<CapitalKind>;
impl CapitalRecord {
    pub fn new_capital(
        graph: &MetadataGraph,
        value: &crate::portfolio::CapitalSnapshot,
    ) -> Result<Self, MetadataError> {
        Self::new(
            graph,
            vec![
                ("startingCapital".into(), value.starting_capital.into()),
                ("cash".into(), value.cash.into()),
                ("reservedCash".into(), value.reserved_cash.into()),
                ("availableCash".into(), value.available_cash.into()),
            ],
        )
    }
}
pub mod portfolio_snapshot {
    use super::*;
    pub static SCHEMA: RecordSchema = RecordSchema::new(
        "PortfolioSnapshot",
        &[
            "capital",
            "nowMs",
            "realizedPnlTotal",
            "positionsByAssetId",
            "openOrdersByClientId",
            "wsOpenOrdersByOrderId",
            "ordersByClientId",
            "recentFills",
            "recentSplits",
            "marketByAssetId",
        ],
    );
    pub const CAPITAL: FieldId = SCHEMA.field(0);
    pub const NOW_MS: FieldId = SCHEMA.field(1);
    pub const REALIZED_PNL_TOTAL: FieldId = SCHEMA.field(2);
    pub const POSITIONS_BY_ASSET_ID: FieldId = SCHEMA.field(3);
    pub const OPEN_ORDERS_BY_CLIENT_ID: FieldId = SCHEMA.field(4);
    pub const WS_OPEN_ORDERS_BY_ORDER_ID: FieldId = SCHEMA.field(5);
    pub const ORDERS_BY_CLIENT_ID: FieldId = SCHEMA.field(6);
    pub const RECENT_FILLS: FieldId = SCHEMA.field(7);
    pub const RECENT_SPLITS: FieldId = SCHEMA.field(8);
    pub const MARKET_BY_ASSET_ID: FieldId = SCHEMA.field(9);
}
#[derive(Debug)]
pub struct PortfolioSnapshotKind;
impl PortfolioRecordKind for PortfolioSnapshotKind {
    const SCHEMA: &'static RecordSchema = &portfolio_snapshot::SCHEMA;
}
pub type PortfolioSnapshotRecord = PortfolioRecord<PortfolioSnapshotKind>;
