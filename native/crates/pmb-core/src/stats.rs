//! Per-market backtest result (port of `src/backtest/stats/marketStats.ts`)
//! and market resolution (`marketResolution.ts`, `telonexMarketResolution.ts`).
//!
//! [`MarketStats`] serializes to exactly the JSON of the TS `MarketStats`
//! type, so the TypeScript aggregator / MySQL writer consume it unchanged.
//! All money is computed in fixed point; only the final, rounded values
//! become JSON numbers.

use crate::fixed::{Qty, Round, Usdc, SCALE};
use crate::model::{AccountEvent, AssetId, Fill, Liquidity, Position, Side, TsMs};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

/// Winning outcome of a binary up/down market.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Outcome {
    Up,
    Down,
}

/// `{ "UP": tokenId, "DOWN": tokenId }` (other outcome keys are kept as-is).
pub type TokenMap = BTreeMap<String, String>;

/// TS `MarketResolution`: token map + resolved outcome (null = not resolved yet).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketResolution {
    pub token_map: TokenMap,
    pub outcome: Option<Outcome>,
}

impl MarketResolution {
    pub fn up_asset(&self) -> Option<&str> {
        self.token_map.get("UP").map(String::as_str)
    }
    pub fn down_asset(&self) -> Option<&str> {
        self.token_map.get("DOWN").map(String::as_str)
    }

    /// Resolution from a `telonex_markets` row: outcome 0 = UP, 1 = DOWN;
    /// resolved only when `telonex_status == "resolved"` and `result_id` is
    /// `"0"` / `"1"`. None when an asset id is missing.
    pub fn from_telonex(
        asset_id0: Option<&str>,
        asset_id1: Option<&str>,
        telonex_status: Option<&str>,
        result_id: Option<&str>,
    ) -> Option<MarketResolution> {
        let (up, down) = (asset_id0.filter(|s| !s.is_empty())?, asset_id1.filter(|s| !s.is_empty())?);
        let outcome = match (telonex_status, result_id) {
            (Some("resolved"), Some("0")) => Some(Outcome::Up),
            (Some("resolved"), Some("1")) => Some(Outcome::Down),
            _ => None,
        };
        Some(MarketResolution {
            token_map: TokenMap::from([("UP".to_owned(), up.to_owned()), ("DOWN".to_owned(), down.to_owned())]),
            outcome,
        })
    }

    /// Resolution from Gamma/DB market fields (`outcomes`, `clobTokenIds`,
    /// `resolvedOutcome`). None unless both an UP and a DOWN token exist.
    pub fn from_gamma(
        outcomes: &[String],
        clob_token_ids: &[String],
        resolved_outcome: Option<&str>,
    ) -> Option<MarketResolution> {
        let token_map: TokenMap = outcomes
            .iter()
            .zip(clob_token_ids)
            .map(|(o, t)| (o.to_uppercase(), t.clone()))
            .collect();
        if !token_map.contains_key("UP") || !token_map.contains_key("DOWN") {
            return None;
        }
        Some(MarketResolution {
            token_map,
            outcome: resolved_outcome.and_then(normalize_outcome),
        })
    }
}

/// Gamma resolved-outcome text → UP / DOWN ("Up", "UP", "up-ish" labels).
/// The TS fallback loop over the market's outcomes can only ever return what
/// the substring checks already returned, so it is not ported.
pub fn normalize_outcome(resolved: &str) -> Option<Outcome> {
    let r = resolved.to_uppercase();
    if r.contains("UP") {
        Some(Outcome::Up)
    } else if r.contains("DOWN") {
        Some(Outcome::Down)
    } else {
        None
    }
}

/// Execution metadata of one market run (TS `MarketExecutionMeta`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketExecutionMeta {
    pub machine_id: String,
    /// Forked worker child id; null for sequential runs.
    #[serde(default)]
    pub worker_child_id: Option<i64>,
    pub started_at_ms: TsMs,
    pub finished_at_ms: TsMs,
    pub duration_ms: i64,
    pub events_processed: u64,
    pub events_by_type: BTreeMap<String, u64>,
    pub commit_sha: String,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatsSkipReason {
    NoInWindowActivity,
}

/// TS `MarketStats`, field for field.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketStats {
    /// Recorder V4 provenance (opaque here; produced by the V4 input path).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recorder_v4_capture: Option<serde_json::Value>,
    pub slug: String,
    pub market_id: String,
    pub final_outcome: Outcome,
    pub pnl: f64,
    pub trade_count: usize,
    pub trade_as_maker: usize,
    pub trade_as_taker: usize,
    pub fees_paid: f64,
    pub avg_entry_price_up: Option<f64>,
    pub avg_entry_price_down: Option<f64>,
    pub up_shares: f64,
    pub down_shares: f64,
    pub mergable_shares: f64,
    pub cost: f64,
    pub split_cost: f64,
    pub intent_meta: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<StatsSkipReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution: Option<MarketExecutionMeta>,
}

/// One position split (full-set mint) and the collateral it cost.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct SplitRecord {
    pub size: Qty,
    pub cost: Usdc,
}

impl SplitRecord {
    pub fn from_event(ev: &AccountEvent) -> Option<SplitRecord> {
        match ev {
            AccountEvent::PositionsSplit { size, cost, .. } => Some(SplitRecord {
                size: *size,
                cost: *cost,
            }),
            _ => None,
        }
    }
}

/// Inputs of [`compute_market_stats`]: the final portfolio state of one
/// market (before settlement) plus its resolution.
pub struct MarketStatsInput<'a> {
    pub market_id: &'a str,
    pub slug: &'a str,
    /// Every fill of this market, in order. `meta` is the placing intent's meta.
    pub trades: &'a [Fill],
    pub splits: &'a [SplitRecord],
    pub positions: &'a BTreeMap<AssetId, Position>,
    /// Cumulative realized PnL from trading (excludes settlement).
    pub realized_pnl: Usdc,
    pub final_outcome: Outcome,
    pub up_asset: &'a AssetId,
    pub down_asset: &'a AssetId,
}

fn round_usdc(v: Usdc, dp: u32) -> f64 {
    v.round_dp(dp, Round::Nearest).to_f64()
}

fn round_f64(v: f64, dp: i32) -> f64 {
    let m = 10f64.powi(dp);
    (v * m).round() / m
}

/// Settles the final positions at the resolved outcome and summarizes the
/// market:
/// - min(UP, DOWN) pairs are worth 1 USDC (mergeable);
/// - the remaining winning shares redeem at 1, losing ones at 0;
/// - `pnl = realized + merge + redeem − remaining cost basis − split cost`.
///
/// `fees_paid` sums the fee charged on TAKER fills (fees are already inside
/// the portfolio's cost basis / proceeds, so they are not subtracted again).
pub fn compute_market_stats(input: &MarketStatsInput<'_>) -> MarketStats {
    let pos = |a: &AssetId| input.positions.get(a).cloned().unwrap_or_default();
    let (up, down) = (pos(input.up_asset), pos(input.down_asset));
    let mergable = up.qty.min(down.qty);

    // BUY volume and notional per side (notional in 1e-12 units, exact).
    let (mut up_size, mut up_notional, mut down_size, mut down_notional) = (0i128, 0i128, 0i128, 0i128);
    let mut fees = Usdc::ZERO;
    let (mut makers, mut takers) = (0, 0);
    for t in input.trades {
        if t.side == Side::Buy {
            let notional = t.price.micros() as i128 * t.size.micros() as i128;
            if &t.asset_id == input.up_asset {
                up_size += t.size.micros() as i128;
                up_notional += notional;
            } else if &t.asset_id == input.down_asset {
                down_size += t.size.micros() as i128;
                down_notional += notional;
            }
        }
        match t.liquidity {
            Some(Liquidity::Taker) => {
                takers += 1;
                fees += t.fee;
            }
            Some(Liquidity::Maker) => makers += 1,
            None => {}
        }
    }
    let avg = |notional: i128, size: i128| {
        (size > 0).then(|| round_f64(notional as f64 / size as f64 / SCALE as f64, 4))
    };

    // Shares settle 1:1 into USDC, so share micros are USDC micros.
    let shares_usdc = |q: Qty| Usdc::from_micros(q.micros());
    let merge_value = shares_usdc(mergable);
    let redeem_value = match input.final_outcome {
        Outcome::Up => shares_usdc(up.qty - mergable),
        Outcome::Down => shares_usdc(down.qty - mergable),
    };
    let split_cost = input
        .splits
        .iter()
        .fold(Usdc::ZERO, |acc, s| acc + s.cost);
    let remaining_cost = up.cost_basis + down.cost_basis;
    let pnl = input.realized_pnl + merge_value + redeem_value - remaining_cost - split_cost;

    // First intent meta per client order id (fills without a cid always count).
    let mut seen = HashSet::new();
    let mut intent_meta = Vec::new();
    for t in input.trades {
        let Some(meta) = &t.meta else { continue };
        if let Some(cid) = &t.client_order_id {
            if !seen.insert(cid) {
                continue;
            }
        }
        intent_meta.push(serde_json::Value::Object(
            meta.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        ));
    }

    MarketStats {
        recorder_v4_capture: None,
        slug: input.slug.to_owned(),
        market_id: input.market_id.to_owned(),
        final_outcome: input.final_outcome,
        pnl: round_usdc(pnl, 2),
        trade_count: input.trades.len(),
        trade_as_maker: makers,
        trade_as_taker: takers,
        fees_paid: round_usdc(fees, 2),
        avg_entry_price_up: avg(up_notional, up_size),
        avg_entry_price_down: avg(down_notional, down_size),
        up_shares: round_usdc(shares_usdc(up.qty), 2),
        down_shares: round_usdc(shares_usdc(down.qty), 2),
        mergable_shares: round_usdc(shares_usdc(mergable), 2),
        cost: round_usdc(remaining_cost, 2),
        split_cost: round_usdc(split_cost, 2),
        intent_meta,
        skip_reason: None,
        execution: None,
    }
}

#[cfg(test)]
mod tests;
