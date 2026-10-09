//! External feeds for the native engine (14-feeds-and-plugins.md): Binance
//! aggTrades (§4), Chainlink two-clock rounds (§5) and price to beat (§6) for
//! historical inputs, the feed timeline with its visibility and cursor rules
//! (§3), the synthetic feed tick schedule and flush (§8), classified missing
//! data errors (§10), symbol resolution (§11) and shared day caches (§14).
//!
//! The strategy-facing [`pmb_core::FeedsView`] replaces the TS
//! `ExternalFeedsRequestPlugin` (14 P-4): [`FeedState::advance`] updates it in
//! place on every tick delivered to the runner. Nothing here reads the
//! environment, the wall clock or the network (14 F-3); every parameter comes
//! from the job (`ModelConfig.feeds`, `feedFiles`, `feedAvailability`).
//!
//! Captured feeds (14 §7) and plugins (§12) are not in this crate yet.

pub mod binance;
pub mod cache;
pub mod chainlink;
pub mod config;
pub mod error;
pub mod market;
mod pq;
pub mod price_to_beat;
pub mod request;
pub mod schedule;
pub mod state;
pub mod time;

pub use binance::{BinanceDay, BinanceSeries};
pub use cache::{CacheStats, DayCache};
pub use chainlink::{ChainlinkDay, ChainlinkSeries};
pub use config::{
    FeedProfile, FeedsModel, Latency, BINANCE_TAIL_MS, CHAINLINK_COVERAGE_FROM_MS,
    CHAINLINK_TAIL_MS, LOOKBACK_MS,
};
pub use error::{ErrorClass, FeedCause, FeedError};
pub use market::{
    load_market_feeds, required_days, BinanceFeed, ChainlinkFeed, DiagLevel, FeedDataset,
    FeedDiagnostic, FeedFile, FeedLoadStats, LoadedFeeds, MarketFeeds, MarketFeedsInput,
};
pub use price_to_beat::{GammaStrike, PriceToBeatSource, PtbAvailability, PtbStatus};
pub use request::{FeedOptions, FeedRequest};
pub use schedule::{
    synthetic_stamp, ts_compat_feed_clock, ScheduleEntry, SyntheticFlusher, SyntheticSchedule,
};
pub use state::FeedState;
pub use time::UtcDay;
