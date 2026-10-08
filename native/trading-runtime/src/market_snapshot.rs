//! Immutable numeric snapshots retained by strategy ticks. JSON projection is
//! explicit and belongs to diagnostics, never to the native context hot path.
use super::{object, BookView, JsString, JsValue, Level};
use std::sync::Arc;

#[derive(Debug)]
pub struct BookSnapshot {
    pub market: Option<Arc<JsValue>>,
    pub asset_id: Option<Arc<JsValue>>,
    pub bids: Arc<[Level]>,
    pub asks: Arc<[Level]>,
    pub depth_levels: f64,
    pub bids_depth: Arc<[f64]>,
    pub asks_depth: Arc<[f64]>,
    pub timestamp: f64,
    pub best_bid: Option<f64>,
    pub best_ask: Option<f64>,
    pub mid: Option<f64>,
    pub spread: Option<f64>,
}
fn number_equal(left: f64, right: f64) -> bool {
    left.to_bits() == right.to_bits()
}
fn optional_equal(left: Option<f64>, right: Option<f64>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => number_equal(left, right),
        (None, None) => true,
        _ => false,
    }
}
fn levels_equal(left: &[Level], right: &[Level]) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(left, right)| {
            number_equal(left.price, right.price) && number_equal(left.size, right.size)
        })
}
fn numbers_equal(left: &[f64], right: &[f64]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .all(|(left, right)| number_equal(*left, *right))
}
impl BookSnapshot {
    pub(crate) fn initial(view: BookView<'_>) -> Arc<Self> {
        Arc::new(Self {
            market: view.market.map(|value| Arc::new(value.clone())),
            asset_id: view.asset_id.map(|value| Arc::new(value.clone())),
            bids: view.bids.to_vec().into(),
            asks: view.asks.to_vec().into(),
            depth_levels: view.depth_levels,
            bids_depth: view.bids_depth.to_vec().into(),
            asks_depth: view.asks_depth.to_vec().into(),
            timestamp: view.timestamp,
            best_bid: view.best_bid,
            best_ask: view.best_ask,
            mid: view.mid,
            spread: view.spread,
        })
    }
    /// Book identity metadata is fixed at construction. Changes affect numeric
    /// state only; compare bits so signed zero is never silently folded away.
    pub(crate) fn updated(view: BookView<'_>, previous: &Arc<Self>) -> Arc<Self> {
        let bids_same = levels_equal(view.bids, &previous.bids);
        let asks_same = levels_equal(view.asks, &previous.asks);
        let bids_depth_same = numbers_equal(view.bids_depth, &previous.bids_depth);
        let asks_depth_same = numbers_equal(view.asks_depth, &previous.asks_depth);
        if bids_same
            && asks_same
            && bids_depth_same
            && asks_depth_same
            && number_equal(view.timestamp, previous.timestamp)
            && number_equal(view.depth_levels, previous.depth_levels)
            && optional_equal(view.best_bid, previous.best_bid)
            && optional_equal(view.best_ask, previous.best_ask)
            && optional_equal(view.mid, previous.mid)
            && optional_equal(view.spread, previous.spread)
        {
            return Arc::clone(previous);
        }
        Arc::new(Self {
            market: previous.market.clone(),
            asset_id: previous.asset_id.clone(),
            bids: if bids_same {
                Arc::clone(&previous.bids)
            } else {
                view.bids.to_vec().into()
            },
            asks: if asks_same {
                Arc::clone(&previous.asks)
            } else {
                view.asks.to_vec().into()
            },
            depth_levels: view.depth_levels,
            bids_depth: if bids_depth_same {
                Arc::clone(&previous.bids_depth)
            } else {
                view.bids_depth.to_vec().into()
            },
            asks_depth: if asks_depth_same {
                Arc::clone(&previous.asks_depth)
            } else {
                view.asks_depth.to_vec().into()
            },
            timestamp: view.timestamp,
            best_bid: view.best_bid,
            best_ask: view.best_ask,
            mid: view.mid,
            spread: view.spread,
        })
    }
    pub fn view(&self) -> BookView<'_> {
        BookView {
            market: self.market.as_deref(),
            asset_id: self.asset_id.as_deref(),
            bids: &self.bids,
            asks: &self.asks,
            depth_levels: self.depth_levels,
            bids_depth: &self.bids_depth,
            asks_depth: &self.asks_depth,
            timestamp: self.timestamp,
            best_bid: self.best_bid,
            best_ask: self.best_ask,
            mid: self.mid,
            spread: self.spread,
        }
    }
    pub fn trace_value(&self) -> JsValue {
        fn optional(value: Option<f64>) -> JsValue {
            value.map(JsValue::Number).unwrap_or(JsValue::Null)
        }
        fn levels(values: &[Level]) -> JsValue {
            JsValue::array(
                values
                    .iter()
                    .map(|level| {
                        object([
                            ("price", JsValue::Number(level.price)),
                            ("size", JsValue::Number(level.size)),
                        ])
                    })
                    .collect(),
            )
        }
        let mut fields = vec![];
        if let Some(market) = &self.market {
            fields.push(("market", market.as_ref().clone()));
        }
        if let Some(asset) = &self.asset_id {
            fields.push(("assetId", asset.as_ref().clone()));
        }
        fields.extend([
            ("timestamp", JsValue::Number(self.timestamp)),
            ("bestBid", optional(self.best_bid)),
            ("bestAsk", optional(self.best_ask)),
            ("mid", optional(self.mid)),
            ("spread", optional(self.spread)),
            ("bids", levels(&self.bids)),
            ("asks", levels(&self.asks)),
            ("depthLevels", JsValue::Number(self.depth_levels)),
            (
                "bidsDepthByLevel",
                JsValue::array(
                    self.bids_depth
                        .iter()
                        .copied()
                        .map(JsValue::Number)
                        .collect(),
                ),
            ),
            (
                "asksDepthByLevel",
                JsValue::array(
                    self.asks_depth
                        .iter()
                        .copied()
                        .map(JsValue::Number)
                        .collect(),
                ),
            ),
        ]);
        object(fields)
    }
}
/// Entries follow Object.fromEntries property-key conversion, collisions and
/// JavaScript integer-index ordering, independently of book identity order.
#[derive(Debug, Clone)]
pub struct SnapshotEntry {
    pub key: Arc<JsString>,
    pub book: Arc<BookSnapshot>,
}
#[derive(Debug)]
pub struct MarketSnapshot {
    pub market: Arc<JsValue>,
    pub timestamp: f64,
    pub by_asset_id: Arc<[SnapshotEntry]>,
}
impl MarketSnapshot {
    pub fn book(&self, asset_id: &str) -> Option<&BookSnapshot> {
        self.by_asset_id
            .iter()
            .find(|entry| entry.key.matches(asset_id))
            .map(|entry| entry.book.as_ref())
    }
    pub fn book_key(&self, asset_id: &JsString) -> Option<&BookSnapshot> {
        self.by_asset_id
            .iter()
            .find(|entry| entry.key.as_ref() == asset_id)
            .map(|entry| entry.book.as_ref())
    }
    pub fn books(&self) -> impl Iterator<Item = &SnapshotEntry> {
        self.by_asset_id.iter()
    }
    pub fn trace_value(&self) -> JsValue {
        object([
            ("market", self.market.as_ref().clone()),
            ("timestamp", JsValue::Number(self.timestamp)),
            (
                "byAssetId",
                JsValue::object(
                    self.by_asset_id
                        .iter()
                        .map(|entry| (entry.key.as_ref().clone(), entry.book.trace_value()))
                        .collect(),
                ),
            ),
        ])
    }
}
