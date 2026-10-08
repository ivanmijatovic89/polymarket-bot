//! Historical inputs and the single-market backtest executor.
//!
//! Module map:
//! - [`telonex`]: Telonex `delta-typed` market Parquet → ordered market events
//! - [`feeds`]: Binance aggTrades, Chainlink rounds, price-to-beat, their
//!   visibility clocks ([`feeds::FeedState`]) and the synthetic tick schedule
//! - [`input`]: one market's merged replay stream ([`input::open_market`])
//! - [`slug`]: market windows and UTC day-file dates

pub mod feeds;
pub mod input;
mod pq;
pub mod slug;
pub mod telonex;
