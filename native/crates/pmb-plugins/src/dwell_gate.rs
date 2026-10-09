//! DwellGate (14 §12.2): per outcome, the gate opens once the tracked best
//! price (bid or ask) has stayed inside `[min(from,to), max(from,to)]` for
//! `requiredMs`. Oracle: `src/strategy/plugins/DwellGatePlugin.ts:170-273`.
//!
//! Observes synthetic ticks (14 §12.4): its output depends only on time and
//! the current book. A non-monotone decision time behaves as TS: elapsed is
//! `now - since`, which can be negative after a backward step.

use crate::{ConfigError, Plugin, PluginId, PluginTick};
use pmb_core::{Outcome, PerOutcome, Price, TsMs};
use serde::Serialize;

/// Book side a gate tracks.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BidOrAsk {
    Bid,
    Ask,
}

/// Config (14 §12.2): band bounds (order does not matter), dwell and side.
///
/// Bounds are fixed-point prices (00 R2). The TS comparison `price >= lo`
/// on doubles equals the fixed-point comparison for bounds with at most 6
/// decimals, because the decimal-to-double rounding is monotone.
// D-PENDING: TS takes `from`/`to` as arbitrary doubles; chose fixed-point Price (bounds with more than 6 decimals are not representable).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DwellGateConfig {
    #[serde(serialize_with = "crate::ts_shape::ser_price")]
    pub from: Price,
    #[serde(serialize_with = "crate::ts_shape::ser_price")]
    pub to: Price,
    pub required_ms: i64,
    pub track_price: BidOrAsk,
}

impl DwellGateConfig {
    /// `requiredMs` from a TS-port double (for example
    /// `dwellSecondsRequired * 1000`): the smallest integer ms at or above
    /// it, so `dwellUpOk`/`dwellDownOk` (`elapsed >= requiredMs`) are those
    /// of TS on every tick (14 §12.4). TS's snapshot then shows the
    /// fractional `requiredMs` and `remainingMs`; no strategy reads them.
    // D-PENDING: 30 §10 states no conversion rule for TS-port double thresholds and TS-shape snapshots differ by the fraction in requiredMs/remainingMs; chose ceil (decision-identical for integer times) and left the field difference to a PARITY note.
    pub fn required_ms_from_f64(required_ms: f64) -> Result<i64, ConfigError> {
        crate::set::ms_threshold(required_ms, true, "dwellGate requiredMs")
    }

    // D-PENDING: TS accepts a negative requiredMs (gate opens on entry); chose to reject it as invalid config (00 R14).
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.required_ms < 0 {
            return Err(ConfigError::DwellRequiredMs(self.required_ms));
        }
        Ok(())
    }
}

/// Dwell state of one outcome (TS `up` / `down` plus `dwellUpOk` / `dwellDownOk`).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct DwellSide {
    /// `remaining_ms == 0` while in range.
    pub ok: bool,
    pub in_range: bool,
    pub elapsed_in_range_ms: Option<i64>,
    pub remaining_ms: Option<i64>,
}

/// Typed snapshot (TS `DwellGateSnapshot`).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct DwellGateSnapshot {
    pub config: DwellGateConfig,
    pub sides: PerOutcome<DwellSide>,
}

impl DwellGateSnapshot {
    #[inline]
    pub fn ok(&self, o: Outcome) -> bool {
        self.sides[o].ok
    }

    #[inline]
    pub fn side(&self, o: Outcome) -> &DwellSide {
        &self.sides[o]
    }
}

/// The plugin.
#[derive(Clone, Debug)]
pub struct DwellGate {
    lo: Price,
    hi: Price,
    since: PerOutcome<Option<TsMs>>,
    snap: DwellGateSnapshot,
}

impl DwellGate {
    pub fn new(cfg: &DwellGateConfig) -> Result<DwellGate, ConfigError> {
        cfg.validate()?;
        Ok(DwellGate {
            lo: cfg.from.min(cfg.to),
            hi: cfg.from.max(cfg.to),
            since: PerOutcome::new(None, None),
            snap: DwellGateSnapshot {
                config: *cfg,
                sides: PerOutcome::default(),
            },
        })
    }

    /// Per-market reset (14 P-3).
    pub fn start_market(&mut self) {
        self.since = PerOutcome::new(None, None);
        self.snap.sides = PerOutcome::default();
    }

    fn side(&mut self, o: Outcome, now: TsMs, price: Option<Price>) -> DwellSide {
        let in_range = price.is_some_and(|p| p >= self.lo && p <= self.hi);
        if !in_range {
            self.since[o] = None;
            return DwellSide::default();
        }
        let since = *self.since[o].get_or_insert(now);
        let elapsed = now.0.saturating_sub(since.0);
        let remaining = self.snap.config.required_ms.saturating_sub(elapsed).max(0);
        DwellSide {
            ok: remaining == 0,
            in_range: true,
            elapsed_in_range_ms: Some(elapsed),
            remaining_ms: Some(remaining),
        }
    }
}

impl Plugin for DwellGate {
    const ID: PluginId = PluginId::DwellGate;
    const HANDLES_SYNTHETIC_TICKS: bool = true;
    type Snapshot = DwellGateSnapshot;

    fn on_tick(&mut self, tick: &PluginTick) -> bool {
        let mut sides = PerOutcome::<DwellSide>::default();
        for o in Outcome::ALL {
            let top = &tick.tops[o];
            let price = match self.snap.config.track_price {
                BidOrAsk::Bid => top.bid,
                BidOrAsk::Ask => top.ask,
            };
            sides[o] = self.side(o, tick.ts, price);
        }
        let changed = sides != self.snap.sides;
        self.snap.sides = sides;
        changed
    }

    fn snapshot(&self) -> &DwellGateSnapshot {
        &self.snap
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::BookTop;

    fn cfg(from: i64, to: i64, required_ms: i64, track: BidOrAsk) -> DwellGateConfig {
        DwellGateConfig {
            from: Price::from_micros(from),
            to: Price::from_micros(to),
            required_ms,
            track_price: track,
        }
    }

    fn tick(ts: i64, up_bid: Option<i64>, down_bid: Option<i64>) -> PluginTick {
        let p = |m: Option<i64>| m.map(Price::from_micros);
        PluginTick::new(
            TsMs(ts),
            false,
            PerOutcome::new(
                BookTop::new(p(up_bid), None),
                BookTop::new(p(down_bid), None),
            ),
        )
    }

    // spec: 14 §12.4 (a TS-port requiredMs such as 16.1 * 1000 opens the
    // gate on the same tick as TS), 00 R14
    #[test]
    fn required_ms_from_ts_double() {
        let x = 16.1 * 1000.0; // 16100.000000000002
        let r = DwellGateConfig::required_ms_from_f64(x).unwrap();
        assert_eq!(r, 16_101);
        for e in 16_000..16_200_i64 {
            // TS: ok iff max(0, x - e) === 0
            assert_eq!((x - e as f64).max(0.0) == 0.0, e >= r, "e = {e}");
        }
        assert_eq!(DwellGateConfig::required_ms_from_f64(1500.0), Ok(1500));
        assert_eq!(
            DwellGateConfig::required_ms_from_f64(f64::NAN),
            Err(ConfigError::MsNotFinite {
                field: "dwellGate requiredMs"
            })
        );
    }

    // spec: 14 §12.2 dwellGate (inclusive band, order of bounds irrelevant)
    #[test]
    fn band_is_inclusive_and_unordered() {
        let mut g = DwellGate::new(&cfg(600_000, 400_000, 1000, BidOrAsk::Bid)).unwrap();
        g.on_tick(&tick(0, Some(400_000), Some(600_000)));
        assert!(g.snapshot().side(Outcome::Up).in_range);
        assert!(g.snapshot().side(Outcome::Down).in_range);
        g.on_tick(&tick(10, Some(399_999), Some(600_001)));
        assert_eq!(g.snapshot().sides, PerOutcome::default());
    }

    // spec: 14 §12.2 dwellGate (elapsed and remaining; ok at remaining 0)
    #[test]
    fn opens_after_required_dwell() {
        let mut g = DwellGate::new(&cfg(400_000, 600_000, 1000, BidOrAsk::Bid)).unwrap();
        g.on_tick(&tick(100, Some(500_000), None));
        let s = *g.snapshot().side(Outcome::Up);
        assert_eq!(
            (s.elapsed_in_range_ms, s.remaining_ms, s.ok),
            (Some(0), Some(1000), false)
        );
        g.on_tick(&tick(1099, Some(500_000), None));
        assert!(!g.snapshot().ok(Outcome::Up));
        g.on_tick(&tick(1100, Some(500_000), None));
        assert!(g.snapshot().ok(Outcome::Up));
        assert!(!g.snapshot().ok(Outcome::Down));
        // leaving the band resets the dwell
        g.on_tick(&tick(1200, None, None));
        g.on_tick(&tick(1300, Some(500_000), None));
        assert_eq!(g.snapshot().side(Outcome::Up).remaining_ms, Some(1000));
    }

    // spec: 14 §12.4 (non-monotone decision time behaves as TS)
    #[test]
    fn backward_time_gives_negative_elapsed() {
        let mut g = DwellGate::new(&cfg(400_000, 600_000, 1000, BidOrAsk::Bid)).unwrap();
        g.on_tick(&tick(5000, Some(500_000), None));
        g.on_tick(&tick(4800, Some(500_000), None));
        let s = *g.snapshot().side(Outcome::Up);
        assert_eq!(s.elapsed_in_range_ms, Some(-200));
        assert_eq!(s.remaining_ms, Some(1200));
    }

    // spec: 14 P-13 (change flag)
    #[test]
    fn change_flag() {
        let mut g = DwellGate::new(&cfg(400_000, 600_000, 1000, BidOrAsk::Ask)).unwrap();
        assert!(!g.on_tick(&tick(0, Some(500_000), None))); // tracks ask: nothing in range
        let ask = PluginTick::new(
            TsMs(10),
            true,
            PerOutcome::new(
                BookTop::new(None, Some(Price::from_micros(500_000))),
                BookTop::EMPTY,
            ),
        );
        assert!(g.on_tick(&ask));
        assert!(!g.on_tick(&ask)); // same time, same state
    }

    // spec: 00 R14
    #[test]
    fn negative_dwell_is_rejected() {
        assert_eq!(
            DwellGate::new(&cfg(0, 1, -1, BidOrAsk::Bid)).unwrap_err(),
            ConfigError::DwellRequiredMs(-1)
        );
    }
}
