//! Tick-scoped strategy plugins (14-feeds-and-plugins.md §12): the plugin
//! contract (§12.1), the v1 set (§12.2: TimeWindowVolatility,
//! TechnicalIndicators, DwellGate, TimeWindowGate), the clock rule (§12.3),
//! synthetic-tick semantics (§12.4) and offline TA candles from local
//! aggTrades (§12.5, D19).
//!
//! Inputs are deliberately narrow ([`PluginTick`], [`PluginMarket`],
//! [`AggTrade`]): this crate depends on `pmb-core` only, never on the feed
//! or engine crates. Plugins do no I/O, read no clock but the tick time, no
//! env, and use the pure-Rust `libm` for transcendental math (14 P-1, P-2;
//! 10 D-2). Feeds are not a plugin in Rust (14 P-4).

mod candles;
mod dwell_gate;
mod set;
mod technical_indicators;
mod tick;
mod time_window_gate;
pub mod ts_shape;
mod volatility;

pub use candles::{
    build_candles, build_day_candles, AggTrade, Candle, CandleError, CandleInterval, DAY_MS,
};
pub use dwell_gate::{BidOrAsk, DwellGate, DwellGateConfig, DwellGateSnapshot, DwellSide};
pub use set::{
    ConfigError, Plugin, PluginDiagnostics, PluginError, PluginHandle, PluginId, PluginPool,
    PluginRequest, PluginSet, PluginsView,
};
pub use technical_indicators::{
    compute as compute_technical_indicators, ta_supported, ta_trades_range, Session, TaInput,
    TaMeta, TaOutput, TaUnavailable, TechnicalIndicators, TechnicalIndicatorsConfig,
    TechnicalIndicatorsSnapshot, Tf15m, Tf1h, TA_LOOKBACK_15M, TA_LOOKBACK_1H, TA_SYMBOL,
};
pub use tick::{BookTop, PluginMarket, PluginTick};
pub use time_window_gate::{TimeWindowGate, TimeWindowGateConfig, TimeWindowGateSnapshot};
pub use volatility::{
    TimeWindowVolatility, TimeWindowVolatilityConfig, VolPrice, VolatilitySnapshot, WindowStats,
};
