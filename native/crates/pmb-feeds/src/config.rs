//! Engine constants (14 F-47) and the feed model the engine resolves from
//! `ModelConfig.feeds` (14 §9). The binary reads no environment (14 F-3):
//! every value here comes from the job or is a constant.

use crate::error::{FeedCause, FeedError};
use pmb_core::DurMs;

/// Pre-window lookback for Binance and Chainlink series (14 §4.3, F-47).
/// Not result-affecting given the seed rule; exported by `describe`.
pub const LOOKBACK_MS: i64 = 300_000;
/// Binance post-window tail (14 F-13).
pub const BINANCE_TAIL_MS: i64 = 2_000;
/// Chainlink post-window tail (14 F-21).
pub const CHAINLINK_TAIL_MS: i64 = 5_000;
/// First covered Chainlink day, 2026-04-02T00:00:00Z (14 F-19).
pub const CHAINLINK_COVERAGE_FROM_MS: i64 = 1_775_088_000_000;
/// Largest Binance / Chainlink latency (14 §9).
pub const SPOT_LATENCY_MAX_MS: i64 = 10_000;
/// Largest price-to-beat latency (14 §9).
pub const PRICE_TO_BEAT_LATENCY_MAX_MS: i64 = 60_000;

/// Profile as far as feeds are concerned (14 §3.1, §9.1).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum FeedProfile {
    /// TS oracle rules: feed clock `max(L, E)` with a high-water mark,
    /// unclamped visibility `T + L` (14 F-7, F-52).
    TsCompat,
    /// Receive-clocked: feed clock `now`, monotone delivery in series order
    /// (12 RS3, 14 F-52).
    Realistic,
}

/// One feed leg latency (14 §9).
///
/// Only `constant` is implemented. Realistic per-element draws (14 §9.1
/// F-51) are M3b; the seam is this enum plus the per-series visibility
/// vector of 14 PF-8 (`BinanceSeries` already carries one for the monotone
/// clamp).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Latency {
    Constant(DurMs),
}

impl Latency {
    /// The constant offset added to the feed's own time.
    #[inline]
    pub fn constant_ms(self) -> i64 {
        match self {
            Latency::Constant(d) => d.0,
        }
    }

    fn validate(self, name: &str, max: i64) -> Result<(), FeedError> {
        let ms = self.constant_ms();
        if !(0..=max).contains(&ms) {
            return Err(FeedError::new(
                FeedCause::ModelConfig,
                format!("feeds.{name}.latency {ms} ms is outside 0..={max} (14 §9)"),
            ));
        }
        Ok(())
    }
}

/// `ModelConfig.feeds` as the feed layer uses it (14 §9). The engine maps
/// the contract object into this; `calibrationId` is provenance only.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct FeedsModel {
    /// `L_b` (14 F-15).
    pub binance: Latency,
    /// `L_c`, broadcast-to-bot leg only (14 F-23).
    pub chainlink: Latency,
    /// 0 disables the gap check (14 F-26).
    pub chainlink_max_gap_ms: i64,
    /// `L_p` (14 F-28).
    pub price_to_beat: Latency,
}

impl FeedsModel {
    /// The `feeds-2026-07-21` defaults (14 §9, F-48).
    pub const DEFAULTS_2026_07_21: FeedsModel = FeedsModel {
        binance: Latency::Constant(DurMs(110)),
        chainlink: Latency::Constant(DurMs(320)),
        chainlink_max_gap_ms: 300_000,
        price_to_beat: Latency::Constant(DurMs(2_700)),
    };

    /// Range checks of 14 §9; violations are `invalid_input: model_config`
    /// with no fallback (14 F-46).
    pub fn validate(&self) -> Result<(), FeedError> {
        self.binance.validate("binance", SPOT_LATENCY_MAX_MS)?;
        self.chainlink.validate("chainlink", SPOT_LATENCY_MAX_MS)?;
        self.price_to_beat
            .validate("priceToBeat", PRICE_TO_BEAT_LATENCY_MAX_MS)?;
        let g = self.chainlink_max_gap_ms;
        if g != 0 && g < 1_000 {
            return Err(FeedError::new(
                FeedCause::ModelConfig,
                format!("feeds.chainlink.maxGapMs {g} must be 0 or >= 1000 (14 §9)"),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 14 §9 field table, F-46 (no silent fallback)
    #[test]
    fn model_validation() {
        let mut m = FeedsModel::DEFAULTS_2026_07_21;
        assert!(m.validate().is_ok());
        m.chainlink_max_gap_ms = 0;
        assert!(m.validate().is_ok());
        m.chainlink_max_gap_ms = 999;
        assert_eq!(m.validate().unwrap_err().cause, FeedCause::ModelConfig);
        let mut m = FeedsModel::DEFAULTS_2026_07_21;
        m.binance = Latency::Constant(DurMs(10_001));
        assert_eq!(m.validate().unwrap_err().cause, FeedCause::ModelConfig);
        let mut m = FeedsModel::DEFAULTS_2026_07_21;
        m.price_to_beat = Latency::Constant(DurMs(60_000));
        assert!(m.validate().is_ok());
        m.price_to_beat = Latency::Constant(DurMs(-1));
        assert!(m.validate().is_err());
    }

    // spec: 14 F-19 (coverage floor value from src/telonex/cryptoPrices/paths.ts)
    #[test]
    fn coverage_floor_is_2026_04_02() {
        assert_eq!(
            crate::time::UtcDay::of_ms(CHAINLINK_COVERAGE_FROM_MS).to_string(),
            "2026-04-02"
        );
        assert_eq!(CHAINLINK_COVERAGE_FROM_MS % crate::time::DAY_MS, 0);
    }
}
