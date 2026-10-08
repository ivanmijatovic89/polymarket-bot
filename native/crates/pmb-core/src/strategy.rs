//! Strategy SDK surface. A strategy is plain Rust: it reads an immutable
//! context and returns intents. It never knows whether it runs live or in a
//! backtest.

use crate::feeds::FeedsSnapshot;
use crate::market::{MarketBooks, MarketTick};
use crate::model::{AccountEvent, Intent, MarketInfo, TsMs};
use crate::portfolio::PortfolioView;
use crate::plugins::PluginsSnapshot;

/// Everything a strategy may read during a callback.
pub struct Ctx<'a> {
    pub now_ms: TsMs,
    pub market: &'a MarketInfo,
    pub books: &'a MarketBooks,
    pub portfolio: &'a PortfolioView,
    pub feeds: &'a FeedsSnapshot,
    pub plugins: &'a PluginsSnapshot,
    /// Live only: false until per-token warmup completed. Always true in backtests.
    pub warmed: bool,
}

/// What the runtime must provide to a strategy for one market session.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Requirements {
    pub feeds: crate::feeds::FeedRequest,
    pub plugins: crate::plugins::PluginRequest,
}

pub trait Strategy: Send {
    fn name(&self) -> &str;

    /// Declares feeds / plugins this strategy needs. Called once per session.
    fn requirements(&self) -> Requirements {
        Requirements::default()
    }

    /// Fires on `book` / `price_change` and on opted-in synthetic feed ticks.
    fn on_market_tick(&mut self, ctx: &Ctx<'_>, tick: &MarketTick<'_>) -> Vec<Intent>;

    /// Fires for every account event (fills, order lifecycle, splits/merges).
    /// Intents returned here are processed within the same tick (cascading).
    fn on_account_event(&mut self, ctx: &Ctx<'_>, event: &AccountEvent) -> Vec<Intent>;
}

/// Builds a fresh strategy instance from JSON params (validated).
pub trait StrategyFactory: Send + Sync {
    fn id(&self) -> &str;
    fn create(&self, params: &serde_json::Value) -> anyhow::Result<Box<dyn Strategy>>;
}
