//! TimeWindowGate (14 §12.2): `withinWindow` iff
//! `allowAfterMs <= now - start <= disableAfterMs` (both inclusive), with
//! `start` the market window start from the job (10 §5). Oracle:
//! `src/strategy/plugins/TimeWindowGatePlugin.ts:90-150`.
//!
//! Observes synthetic ticks (14 §12.4); computed from the tick time alone, so
//! a non-monotone decision time behaves as TS.

use crate::{Plugin, PluginId, PluginMarket, PluginTick};
use pmb_core::TsMs;
use serde::Serialize;

/// Config (14 §12.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeWindowGateConfig {
    pub allow_after_ms: i64,
    pub disable_after_ms: i64,
}

impl TimeWindowGateConfig {
    /// The config from TS-port doubles (for example `seconds * 1000`):
    /// `allowAfterMs` rounds up and `disableAfterMs` rounds down, so
    /// `withinWindow` (`allowAfterMs <= elapsed <= disableAfterMs`) is that
    /// of TS for every integer elapsed time (14 §12.4); TS's snapshot echoes
    /// the unrounded doubles.
    // D-PENDING: 30 §10 states no conversion rule for TS-port double thresholds; chose ceil/floor (decision-identical for integer times).
    pub fn from_f64_ms(
        allow_after_ms: f64,
        disable_after_ms: f64,
    ) -> Result<TimeWindowGateConfig, crate::ConfigError> {
        Ok(TimeWindowGateConfig {
            allow_after_ms: crate::set::ms_threshold(
                allow_after_ms,
                true,
                "timeWindowGate allowAfterMs",
            )?,
            disable_after_ms: crate::set::ms_threshold(
                disable_after_ms,
                false,
                "timeWindowGate disableAfterMs",
            )?,
        })
    }
}

/// Typed snapshot (TS `TimeWindowGateSnapshot`). `start_ms`, `now_ms` and
/// `elapsed_ms` are `None` only before the first observed tick.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct TimeWindowGateSnapshot {
    pub config: TimeWindowGateConfig,
    pub within_window: bool,
    pub start_ms: Option<TsMs>,
    pub now_ms: Option<TsMs>,
    pub elapsed_ms: Option<i64>,
}

/// The plugin.
#[derive(Clone, Debug)]
pub struct TimeWindowGate {
    start: TsMs,
    snap: TimeWindowGateSnapshot,
}

impl TimeWindowGate {
    pub fn new(cfg: &TimeWindowGateConfig) -> TimeWindowGate {
        TimeWindowGate {
            start: TsMs(0),
            snap: TimeWindowGateSnapshot {
                config: *cfg,
                within_window: false,
                start_ms: None,
                now_ms: None,
                elapsed_ms: None,
            },
        }
    }

    /// Per-market reset (14 P-3); the start comes from the market window.
    pub fn start_market(&mut self, market: &PluginMarket) {
        self.start = market.window.start_ms;
        self.snap.within_window = false;
        self.snap.start_ms = None;
        self.snap.now_ms = None;
        self.snap.elapsed_ms = None;
    }
}

impl Plugin for TimeWindowGate {
    const ID: PluginId = PluginId::TimeWindowGate;
    const HANDLES_SYNTHETIC_TICKS: bool = true;
    type Snapshot = TimeWindowGateSnapshot;

    fn on_tick(&mut self, tick: &PluginTick) -> bool {
        let elapsed = tick.ts.0.saturating_sub(self.start.0);
        let c = self.snap.config;
        let next = TimeWindowGateSnapshot {
            config: c,
            within_window: elapsed >= c.allow_after_ms && elapsed <= c.disable_after_ms,
            start_ms: Some(self.start),
            now_ms: Some(tick.ts),
            elapsed_ms: Some(elapsed),
        };
        let changed = next != self.snap;
        self.snap = next;
        changed
    }

    fn snapshot(&self) -> &TimeWindowGateSnapshot {
        &self.snap
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::BookTop;
    use pmb_core::PerOutcome;

    fn at(ts: i64) -> PluginTick {
        PluginTick::new(
            TsMs(ts),
            true,
            PerOutcome::new(BookTop::EMPTY, BookTop::EMPTY),
        )
    }

    // spec: 14 §12.2 timeWindowGate (inclusive bounds on elapsed time)
    #[test]
    fn inclusive_bounds() {
        let mut g = TimeWindowGate::new(&TimeWindowGateConfig {
            allow_after_ms: 10_000,
            disable_after_ms: 20_000,
        });
        g.start_market(&PluginMarket::from_slug("btc-updown-15m-1760140800").unwrap());
        let start = 1_760_140_800_000;
        let within = |g: &mut TimeWindowGate, e: i64| {
            g.on_tick(&at(start + e));
            g.snapshot().within_window
        };
        assert!(!within(&mut g, -5));
        assert!(!within(&mut g, 9_999));
        assert!(within(&mut g, 10_000));
        assert!(within(&mut g, 20_000));
        assert!(!within(&mut g, 20_001));
        // sawtooth: stepping back re-enters the window exactly as TS
        assert!(within(&mut g, 19_999));
        let s = g.snapshot();
        assert_eq!(s.start_ms, Some(TsMs(start)));
        assert_eq!(s.now_ms, Some(TsMs(start + 19_999)));
        assert_eq!(s.elapsed_ms, Some(19_999));
    }

    // spec: 14 §12.4 (non-integer TS-port thresholds: same decision as TS
    // for every integer elapsed time), 00 R14 (non-finite is an error)
    #[test]
    fn thresholds_from_ts_doubles() {
        let c = TimeWindowGateConfig::from_f64_ms(16.1 * 1000.0, 32.3 * 1000.0).unwrap();
        assert_eq!(16.1 * 1000.0, 16_100.000_000_000_002);
        assert_eq!(32.3 * 1000.0, 32_299.999_999_999_996);
        assert_eq!((c.allow_after_ms, c.disable_after_ms), (16_101, 32_299));
        for (allow, disable) in [
            (16.1 * 1000.0, 32.3 * 1000.0),
            (-0.5, 0.0),
            (1000.0, 1000.0),
        ] {
            let c = TimeWindowGateConfig::from_f64_ms(allow, disable).unwrap();
            for e in -3..40_000_i64 {
                let ts = e as f64;
                assert_eq!(
                    e >= c.allow_after_ms && e <= c.disable_after_ms,
                    ts >= allow && ts <= disable,
                    "e = {e}"
                );
            }
        }
        for bad in [f64::NAN, f64::INFINITY, 1e300] {
            assert_eq!(
                TimeWindowGateConfig::from_f64_ms(bad, 1.0),
                Err(crate::ConfigError::MsNotFinite {
                    field: "timeWindowGate allowAfterMs"
                })
            );
        }
    }

    // spec: 14 P-13 (every new time is a visible change)
    #[test]
    fn change_flag() {
        let mut g = TimeWindowGate::new(&TimeWindowGateConfig {
            allow_after_ms: 0,
            disable_after_ms: 1,
        });
        g.start_market(&PluginMarket::from_slug("btc-updown-5m-1760140800").unwrap());
        assert!(g.on_tick(&at(5)));
        assert!(!g.on_tick(&at(5)));
        assert!(g.on_tick(&at(6)));
    }
}
