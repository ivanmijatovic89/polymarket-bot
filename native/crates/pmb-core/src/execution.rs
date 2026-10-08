//! Execution adapters. The order manager talks only to this trait, so the
//! same core runs on the backtest simulator, live dry-run and the live CLOB.

use crate::fixed::{Price, Qty};
use crate::market::{MarketBooks, MarketEvent};
use crate::model::{AccountEvent, AssetId, ConditionId, OrderId, OrderRequest, TsMs};

/// A validated command the order manager sends to an execution adapter.
#[derive(Clone, Debug, PartialEq)]
pub enum ExecCommand {
    Place(Vec<OrderRequest>),
    Cancel(Vec<CancelTarget>),
    CancelMarket {
        market: Option<ConditionId>,
        asset_id: Option<AssetId>,
    },
    CancelAll,
    Split {
        asset_a: AssetId,
        asset_b: AssetId,
        size: Qty,
        cost_per_share: Price,
    },
    Merge {
        asset_a: AssetId,
        asset_b: AssetId,
        size: Qty,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct CancelTarget {
    pub client_order_id: Option<crate::model::ClientOrderId>,
    pub order_id: Option<OrderId>,
}

pub trait Execution {
    /// Submit a command at `now`. Returns events that are known immediately
    /// (e.g. submitted/accepted/rejected). Fills may come later.
    fn submit(&mut self, now: TsMs, cmd: ExecCommand, books: &MarketBooks) -> Vec<AccountEvent>;

    /// Called after a market event was applied to `books` and before the
    /// strategy sees the tick. Backtest: runs due actions and matches orders.
    fn on_market_event(
        &mut self,
        now: TsMs,
        event: &MarketEvent,
        books: &MarketBooks,
    ) -> Vec<AccountEvent>;

    /// Drain events that arrived asynchronously (live adapters).
    fn poll(&mut self, _now: TsMs) -> Vec<AccountEvent> {
        Vec::new()
    }
}
