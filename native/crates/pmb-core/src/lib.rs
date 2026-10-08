//! Shared trading core for live trading and backtests.
//!
//! Module map:
//! - [`fixed`]: fixed-point Price / Qty / Usdc (1e-6 units)
//! - [`model`]: intents, orders, fills, account events, exchange rules
//! - [`market`]: market events, order books, ticks
//! - [`feeds`], [`plugins`]: what strategies can read besides the book
//! - [`portfolio`]: positions, capital, PnL
//! - [`stats`]: per-market backtest result and market resolution
//! - [`execution`]: the adapter trait (backtest sim / live dry-run / live CLOB)
//! - [`strategy`]: the strategy SDK traits
//! - [`trace`]: optional engine trace

pub mod execution;
pub mod feeds;
pub mod fixed;
pub mod market;
pub mod model;
pub mod plugins;
pub mod portfolio;
pub mod stats;
pub mod strategy;
pub mod trace;
