//! Typed Portfolio record slots in the session-owned metadata graph.
//! Schemas select direct slots; allocation order determines own-property order.
use crate::{
    market_json::JsString,
    metadata::{MetadataError, MetadataGraph, MetadataValue},
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
