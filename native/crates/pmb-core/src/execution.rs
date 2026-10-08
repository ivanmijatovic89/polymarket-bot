//! Execution adapters. The order manager talks only to this trait, so the
//! same core runs on the backtest simulator, live dry-run and the live CLOB.
//!
//! Adapters append the account events they produce to `out` (no per-call
//! allocation on the hot path).

use crate::fixed::{Price, Qty};
use crate::market::{MarketBooks, MarketEvent};
use crate::model::{
    AccountEvent, AssetId, CancelOp, ClientOrderId, ConditionId, OrderId, OrderRequest, TsMs,
};

/// A validated command the order manager sends to an execution adapter.
#[derive(Clone, Debug, PartialEq)]
pub enum ExecCommand {
    /// One request (`place_limit`) or a batch (`place_batch`); a batch shares
    /// one transport latency.
    Place(Vec<OrderRequest>),
    /// Cancel selected orders (`cancel_order` / resolved `cancel_batch`).
    Cancel {
        op: CancelOp,
        targets: Vec<CancelTarget>,
    },
    /// Cancel by scope; resolved by the adapter when the cancel takes effect.
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

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CancelTarget {
    pub client_order_id: Option<ClientOrderId>,
    pub order_id: Option<OrderId>,
}

pub trait Execution {
    /// Submit a command at `now`. Appends events that are known immediately
    /// (e.g. accepted / rejected / immediate fills). Later effects arrive via
    /// [`Execution::on_market_event`], [`Execution::advance_to`] or [`Execution::poll`].
    fn submit(
        &mut self,
        now: TsMs,
        cmd: ExecCommand,
        books: &MarketBooks,
        out: &mut Vec<AccountEvent>,
    );

    /// Called before a market event (or synthetic tick) stamped `ts` is
    /// applied: an exact-time simulator runs actions due at or before `ts`
    /// against the current (pre-event) book. Default: nothing.
    fn advance_to(&mut self, _ts: TsMs, _books: &MarketBooks, _out: &mut Vec<AccountEvent>) {}

    /// Called after a real market event was applied to `books` and before
    /// the strategy sees the tick. Never called for synthetic feed ticks.
    /// Backtest: runs due actions, expiries and resting-order fills.
    fn on_market_event(
        &mut self,
        now: TsMs,
        event: &MarketEvent,
        books: &MarketBooks,
        out: &mut Vec<AccountEvent>,
    );

    /// Drain events that arrived asynchronously (live adapters).
    fn poll(&mut self, _now: TsMs, _out: &mut Vec<AccountEvent>) {}
}
