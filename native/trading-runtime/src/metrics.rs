//! Shared typed strategy context metrics; adapters resolve market asset IDs.
use serde::Serialize;

#[derive(Clone, Copy, Debug)]
pub struct PositionAmounts {
    pub qty: f64,
    pub cost_basis: f64,
}
#[derive(Debug, Serialize)]
pub struct PositionMetrics {
    pub shares_mergeable: f64,
    pub pair_avg: Option<f64>,
    pub total_cost: f64,
    pub pnl_merge: f64,
    pub pnl_if_up_wins: f64,
    pub pnl_if_down_wins: f64,
    pub imbalance: f64,
}
fn finite_or_zero(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}
fn js_min(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() {
        f64::NAN
    } else if left == 0.0 && right == 0.0 && (left.is_sign_negative() || right.is_sign_negative()) {
        -0.0
    } else {
        left.min(right)
    }
}
pub fn compute_position_metrics(
    up_asset_id: Option<&str>,
    down_asset_id: Option<&str>,
    lookup: impl Fn(&str) -> Option<PositionAmounts>,
) -> Option<PositionMetrics> {
    let up_id = up_asset_id.filter(|id| !id.is_empty())?;
    let down_id = down_asset_id.filter(|id| !id.is_empty())?;
    let up = lookup(up_id);
    let down = lookup(down_id);
    let up_shares = finite_or_zero(up.map_or(0.0, |p| p.qty));
    let down_shares = finite_or_zero(down.map_or(0.0, |p| p.qty));
    let up_cost = finite_or_zero(up.map_or(0.0, |p| p.cost_basis));
    let down_cost = finite_or_zero(down.map_or(0.0, |p| p.cost_basis));
    let total_cost = up_cost + down_cost;
    let up_avg = if up_shares > 0.0 {
        Some(up_cost / up_shares)
    } else {
        None
    };
    let down_avg = if down_shares > 0.0 {
        Some(down_cost / down_shares)
    } else {
        None
    };
    let shares_mergeable = js_min(up_shares, down_shares);
    Some(PositionMetrics {
        shares_mergeable,
        pair_avg: up_avg.zip(down_avg).map(|(u, d)| u + d),
        total_cost,
        pnl_merge: shares_mergeable - total_cost,
        pnl_if_up_wins: up_shares - total_cost,
        pnl_if_down_wins: down_shares - total_cost,
        imbalance: up_shares - down_shares,
    })
}
#[derive(Clone, Copy, Debug)]
pub struct BookDepthView<'a> {
    pub depth_levels: f64,
    pub bids: &'a [f64],
    pub asks: &'a [f64],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum WeakSide {
    UP,
    DOWN,
    NONE,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderbookMetrics {
    pub depth_levels: usize,
    pub weak_bid_side_by_level: Vec<WeakSide>,
    pub weak_bid_ratio_by_level: Vec<f64>,
    pub weak_ask_side_by_level: Vec<WeakSide>,
    pub weak_ask_ratio_by_level: Vec<f64>,
}
fn weak_side(up: f64, down: f64) -> (WeakSide, f64) {
    let up = finite_or_zero(up).max(0.0);
    let down = finite_or_zero(down).max(0.0);
    if up == down {
        (WeakSide::NONE, 1.0)
    } else {
        (
            if up < down {
                WeakSide::UP
            } else {
                WeakSide::DOWN
            },
            up.min(down) / up.max(down),
        )
    }
}
pub fn compute_orderbook_metrics(
    up: BookDepthView<'_>,
    down: BookDepthView<'_>,
) -> OrderbookMetrics {
    let array_bound = up
        .bids
        .len()
        .min(down.bids.len())
        .min(up.asks.len())
        .min(down.asks.len());
    let levels = finite_or_zero(up.depth_levels)
        .floor()
        .min(finite_or_zero(down.depth_levels).floor())
        .min(array_bound as f64)
        .max(0.0) as usize;
    let mut result = OrderbookMetrics {
        depth_levels: levels,
        weak_bid_side_by_level: Vec::with_capacity(levels),
        weak_bid_ratio_by_level: Vec::with_capacity(levels),
        weak_ask_side_by_level: Vec::with_capacity(levels),
        weak_ask_ratio_by_level: Vec::with_capacity(levels),
    };
    for i in 0..levels {
        let (side, ratio) = weak_side(up.bids[i], down.bids[i]);
        result.weak_bid_side_by_level.push(side);
        result.weak_bid_ratio_by_level.push(ratio);
        let (side, ratio) = weak_side(up.asks[i], down.asks[i]);
        result.weak_ask_side_by_level.push(side);
        result.weak_ask_ratio_by_level.push(ratio);
    }
    result
}
