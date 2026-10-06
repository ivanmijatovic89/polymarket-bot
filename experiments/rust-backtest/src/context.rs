//! Snapshots and tick-scoped derived metrics are computed even if a strategy ignores them.
use crate::{
    portfolio::{n, Ledger},
    types::{Book, Digest},
};
use serde_json::{json, Value};
#[derive(Clone)]
pub struct BookSnapshot {
    pub exists: bool,
    pub bids: Vec<crate::types::Level>,
    pub asks: Vec<crate::types::Level>,
    pub bid: Option<f64>,
    pub ask: Option<f64>,
    pub mid: Option<f64>,
    pub spread: Option<f64>,
    pub bid_depth: Vec<f64>,
    pub ask_depth: Vec<f64>,
}
impl BookSnapshot {
    pub fn top(&self) -> Option<(f64, f64)> {
        let b = self.bid?;
        let a = self.ask?;
        if a <= 0.0 || a >= 1.0 || b <= 0.0 || b >= 1.0 {
            None
        } else {
            Some((b, a))
        }
    }
    pub fn new(b: &Book, depth: usize) -> Self {
        let bid = b.bids.first().map(|l| l.price);
        let ask = b.asks.first().map(|l| l.price);
        let cumulative = |ls: &[crate::types::Level]| {
            let mut total = 0.0;
            ls.iter()
                .take(depth)
                .map(|l| {
                    total += l.size;
                    total
                })
                .collect()
        };
        Self {
            exists: b.exists,
            bids: b.bids.clone(),
            asks: b.asks.clone(),
            bid,
            ask,
            mid: bid.zip(ask).map(|(b, a)| (b + a) / 2.0),
            spread: bid.zip(ask).map(|(b, a)| a - b),
            bid_depth: cumulative(&b.bids),
            ask_depth: cumulative(&b.asks),
        }
    }
}
pub struct Metrics {
    pub position: [Option<f64>; 7],
    pub orderbook: Option<Vec<(u8, f64, u8, f64)>>,
}
impl Metrics {
    pub fn new(p: &Ledger, assets: &[String; 2], books: &[BookSnapshot; 2], depth: usize) -> Self {
        let up = p.positions.get(&assets[0]);
        let down = p.positions.get(&assets[1]);
        let number = |p: Option<&Value>, k| p.map(|p| n(p, k)).unwrap_or(0.0);
        let uq = number(up, "qty");
        let dq = number(down, "qty");
        let uc = number(up, "costBasis");
        let dc = number(down, "costBasis");
        let cost = uc + dc;
        let merge = uq.min(dq);
        let pair = if uq > 0.0 && dq > 0.0 {
            Some(uc / uq + dc / dq)
        } else {
            None
        };
        let weak = |u: f64, d: f64| {
            let u = if u.is_finite() { u.max(0.0) } else { 0.0 };
            let d = if d.is_finite() { d.max(0.0) } else { 0.0 };
            if u == d {
                (0, 1.0)
            } else {
                (if u < d { 1 } else { 2 }, u.min(d) / u.max(d))
            }
        };
        let orderbook = if books.iter().all(|b| b.exists) {
            let levels = depth
                .min(books[0].bid_depth.len())
                .min(books[0].ask_depth.len())
                .min(books[1].bid_depth.len())
                .min(books[1].ask_depth.len());
            Some(
                (0..levels)
                    .map(|i| {
                        let (b, br) = weak(books[0].bid_depth[i], books[1].bid_depth[i]);
                        let (a, ar) = weak(books[0].ask_depth[i], books[1].ask_depth[i]);
                        (b, br, a, ar)
                    })
                    .collect(),
            )
        } else {
            None
        };
        Self {
            position: [
                Some(merge),
                pair,
                Some(cost),
                Some(merge - cost),
                Some(uq - cost),
                Some(dq - cost),
                Some(uq - dq),
            ],
            orderbook,
        }
    }
    pub fn digest(&self, d: &mut Digest) {
        for p in self.position {
            d.number(p.unwrap_or(f64::NAN));
        }
        d.number(if self.orderbook.is_some() { 1.0 } else { 0.0 });
        if let Some(book) = &self.orderbook {
            d.number(book.len() as f64);
            for &(bid, br, ask, ar) in book {
                d.number(bid as f64);
                d.number(br);
                d.number(ask as f64);
                d.number(ar);
            }
        }
    }
    pub fn value(&self) -> Value {
        let keys = [
            "shares_mergeable",
            "pair_avg",
            "total_cost",
            "pnl_merge",
            "pnl_if_up_wins",
            "pnl_if_down_wins",
            "imbalance",
        ];
        let mut position = json!({});
        for (k, v) in keys.iter().zip(self.position) {
            position[*k] = json!(v);
        }
        let mut out = json!({"position":position});
        if let Some(book) = &self.orderbook {
            let side = |v: u8| ["NONE", "UP", "DOWN"][v as usize];
            out["orderbook"] = json!({"depthLevels":book.len(),"weakBidSideByLevel":book.iter().map(|b|side(b.0)).collect::<Vec<_>>(),"weakBidRatioByLevel":book.iter().map(|b|b.1).collect::<Vec<_>>(),"weakAskSideByLevel":book.iter().map(|b|side(b.2)).collect::<Vec<_>>(),"weakAskRatioByLevel":book.iter().map(|b|b.3).collect::<Vec<_>>()});
        }
        out
    }
}

pub fn iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}
pub fn market_meta(m: &crate::types::Market) -> Value {
    json!({"slug":m.slug,"conditionId":m.market_id,"outcomes":["UP","DOWN"],"clobTokenIds":[m.up_id,m.down_id],"upAssetId":m.up_id,"downAssetId":m.down_id,"outcomeTokenMap":{"up":m.up_id,"down":m.down_id},"eventStartTime":iso(m.start_ms),"endDate":iso(m.end_ms)})
}
