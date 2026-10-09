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
//!
//! # Use from the engine loop (12 §4.1, §5.3)
//!
//! Per market read: [`load_market_feeds`] once, with a process-wide
//! [`DayCache`]; the resulting `Arc<MarketFeeds>` is shared by every
//! candidate (14 F-42). Per session: one [`FeedState`] and one
//! [`SyntheticFlusher`]. For each real tick `t` with feed clock `C(t)`
//! (ts-compat: [`ts_compat_feed_clock`]`(E, L)`; realistic: `R_t`):
//!
//! 1. `flusher.take_before(feeds.schedule(), C(t), has_book)` returns the
//!    synthetic entries to dispatch first, in order (14 F-40). Each is
//!    stamped [`synthetic_stamp`]`(v, base)` with `base` the exchange time of
//!    the last real tick in ts-compat or `now` in realistic (F-41), counted
//!    under its kind (§8.4), passed through the window gate and, when
//!    delivered, `state.advance(&feeds, stamp)` before the strategy call.
//! 2. The real tick is counted, gated and, when delivered,
//!    `state.advance(&feeds, C(t))` (F-7: on every delivered tick, whether or
//!    not the strategy reads feeds).
//!
//! After the input ends, `flusher.take_rest(..)` dispatches the remainder.
//! `state.view()` is the tick-scoped [`pmb_core::FeedsView`] (12 §6.4). The
//! test driver in `tests/feeds_golden.rs` is this loop, proven against the TS
//! oracle.

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
