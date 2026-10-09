//! Feed and plugin requirements (30 §10).
//!
//! `Requirements` is the engine's (`pmb_engine::strategy::Requirements`),
//! re-exported by name. The feed and plugin configs are re-exported from
//! the crates that define them: `FeedOptions` from `pmb-feeds`, the four
//! plugin configs, `BidOrAsk` and `VolPrice` from `pmb-plugins`.
//!
//! TODO(feeds-merge): the engine's `Requirements` is still a stand-in with
//! no state (its own STAND-IN note); the feed-wiring stream replaces it on
//! its branch. After that merge:
//! 1. delete [`RequirementsExt`] (the engine's inherent builders take
//!    precedence anyway, so a missed deletion cannot change behavior);
//! 2. re-export `Requirements` from wherever the merged engine defines it,
//!    and `FeedsView`, `PricePoint`, `PriceToBeat`, `PluginsView` and the
//!    four plugin snapshot types (30 §3 "Feeds / plugins") from
//!    `pmb-feeds`/`pmb-plugins`/`pmb-engine` as merged;
//! 3. keep `FeedOptionsExt::tick_on_update` unless `pmb-feeds` gains an
//!    inherent by-value builder of that name;
//! 4. un-ignore the feed-exerciser tests in `native/strategies`.

pub use pmb_engine::strategy::Requirements;
pub use pmb_feeds::FeedOptions;
pub use pmb_plugins::{
    BidOrAsk, DwellGateConfig, TechnicalIndicatorsConfig, TimeWindowGateConfig,
    TimeWindowVolatilityConfig, VolPrice,
};

/// The by-value builder of 30 §10 on `FeedOptions` (in scope through the
/// prelude; the trait name is not part of the SDK surface).
///
/// ```
/// use pmb_sdk::prelude::*;
///
/// let o = FeedOptions::default().tick_on_update(true);
/// assert!(o.tick_on_update);
/// assert_eq!(o.symbol, None);
/// ```
// D-PENDING: 30 §10 describes the fields `symbol` and `tick_on_update`
// without saying how they are set; chose a by-value builder next to the
// public fields `pmb-feeds` already has.
pub trait FeedOptionsExt {
    /// Opts into (or out of) synthetic strategy ticks for this feed
    /// (30 §10, 14 F-35).
    fn tick_on_update(self, on: bool) -> FeedOptions;
}

impl FeedOptionsExt for FeedOptions {
    #[inline]
    fn tick_on_update(mut self, on: bool) -> FeedOptions {
        self.tick_on_update = on;
        self
    }
}

/// The feed and plugin builders of 30 §10 while the engine's
/// `Requirements` is a stand-in (see the module TODO). Each builder fails
/// loud: a strategy that requests a feed or a plugin panics in
/// `requirements`, so `describe` refuses it before any job runs (30 §12
/// "a panic in requirements"), instead of silently running without the
/// feed (R14).
pub trait RequirementsExt: Sized {
    /// Binance aggTrades last price (30 §10).
    fn binance_spot(self, opts: FeedOptions) -> Self;
    /// Chainlink rounds, two-clock visibility (30 §10).
    fn chainlink(self, opts: FeedOptions) -> Self;
    /// Price to beat (30 §10).
    fn price_to_beat(self) -> Self;
    /// TimeWindowVolatility (30 §10).
    fn time_window_volatility(self, cfg: TimeWindowVolatilityConfig) -> Self;
    /// TechnicalIndicators (30 §10).
    fn technical_indicators(self, cfg: TechnicalIndicatorsConfig) -> Self;
    /// DwellGate (30 §10).
    fn dwell_gate(self, cfg: DwellGateConfig) -> Self;
    /// TimeWindowGate (30 §10).
    fn time_window_gate(self, cfg: TimeWindowGateConfig) -> Self;
}

#[track_caller]
fn not_wired(what: &str) -> ! {
    panic!(
        "Requirements::{what}: feeds and plugins are not wired into this engine build yet \
         (pmb-engine Requirements is a stand-in); a strategy that requests them cannot run here"
    )
}

impl RequirementsExt for Requirements {
    #[track_caller]
    fn binance_spot(self, _opts: FeedOptions) -> Self {
        not_wired("binance_spot")
    }
    #[track_caller]
    fn chainlink(self, _opts: FeedOptions) -> Self {
        not_wired("chainlink")
    }
    #[track_caller]
    fn price_to_beat(self) -> Self {
        not_wired("price_to_beat")
    }
    #[track_caller]
    fn time_window_volatility(self, _cfg: TimeWindowVolatilityConfig) -> Self {
        not_wired("time_window_volatility")
    }
    #[track_caller]
    fn technical_indicators(self, _cfg: TechnicalIndicatorsConfig) -> Self {
        not_wired("technical_indicators")
    }
    #[track_caller]
    fn dwell_gate(self, _cfg: DwellGateConfig) -> Self {
        not_wired("dwell_gate")
    }
    #[track_caller]
    fn time_window_gate(self, _cfg: TimeWindowGateConfig) -> Self {
        not_wired("time_window_gate")
    }
}

#[cfg(test)]
mod tests {
    use crate::prelude::*;

    #[test]
    fn stand_in_builders_fail_loud() {
        // spec: R14 (no silent substitution), 30 §12 (panic in requirements)
        assert_eq!(Requirements::new(), Requirements::default());
        let r = std::panic::catch_unwind(|| Requirements::new().price_to_beat());
        let msg = *r.unwrap_err().downcast::<String>().unwrap();
        assert!(msg.contains("price_to_beat"), "{msg}");
        assert!(std::panic::catch_unwind(|| {
            Requirements::new().binance_spot(FeedOptions::default())
        })
        .is_err());
    }
}
