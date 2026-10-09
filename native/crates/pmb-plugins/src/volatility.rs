//! TimeWindowVolatility (14 §12.2): per outcome, rolling time windows over one
//! book-derived price with running sums and monotonic min/max deques; a window
//! is ready iff its coverage is at least 0.93 x its length and it holds at
//! least 6 samples, otherwise the last ready values are kept with `staleMs`.
//!
//! Math salvaged from the WIP (`plugins/volatility.rs:94-247`) after review
//! against the oracle `src/strategy/plugins/TimeWindowVolatility.ts:199,295-347`.
//! One sample per real tick: synthetic ticks are not observed (14 §12.2).

use crate::{BookTop, ConfigError, Plugin, PluginId, PluginTick};
use pmb_core::{Outcome, PerOutcome, TsMs};
use serde::Serialize;
use std::collections::{BTreeMap, VecDeque};

/// Which book price a window tracks (TS `trackPrice`, default `mid`).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VolPrice {
    Bid,
    Ask,
    #[default]
    Mid,
}

impl VolPrice {
    #[inline]
    fn read(self, top: &BookTop) -> Option<f64> {
        match self {
            VolPrice::Bid => top.bid_f64(),
            VolPrice::Ask => top.ask_f64(),
            VolPrice::Mid => top.mid_f64(),
        }
    }
}

/// Config (14 §12.2): `windows {label: ms}` and `trackPrice`.
///
/// Labels are kept in a `BTreeMap`, so equal configs compare equal regardless
/// of declaration order (canonical form for sharing, 14 P-6, 30 §10).
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeWindowVolatilityConfig {
    pub windows: BTreeMap<String, i64>,
    pub track_price: VolPrice,
}

impl TimeWindowVolatilityConfig {
    pub fn new<I, S>(windows: I, track_price: VolPrice) -> TimeWindowVolatilityConfig
    where
        I: IntoIterator<Item = (S, i64)>,
        S: Into<String>,
    {
        TimeWindowVolatilityConfig {
            windows: windows.into_iter().map(|(k, v)| (k.into(), v)).collect(),
            track_price,
        }
    }

    /// Fail loud on configs without a meaning (00 R14).
    // D-PENDING: TS accepts an empty window map and window lengths <= 0; chose to reject both as invalid config.
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.windows.is_empty() {
            return Err(ConfigError::VolatilityNoWindows);
        }
        for (label, &ms) in &self.windows {
            if ms <= 0 {
                return Err(ConfigError::VolatilityWindowMs {
                    label: label.clone(),
                    ms,
                });
            }
        }
        Ok(())
    }
}

/// Statistics of one window (TS `VolatilityWindowStats`).
///
/// Metrics are recomputed only while `ready`; otherwise the last ready values
/// are kept and `stale_ms` says how old they are (`None` when never ready).
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct WindowStats {
    pub window_ms: i64,
    pub n: usize,
    pub start_ts: Option<TsMs>,
    pub end_ts: Option<TsMs>,
    pub coverage_ms: Option<i64>,
    pub ready: bool,
    pub stale_ms: Option<i64>,
    pub start_price: Option<f64>,
    pub end_price: Option<f64>,
    pub net_change: Option<f64>,
    pub low: Option<f64>,
    pub high: Option<f64>,
    pub stddev: Option<f64>,
    pub high_low_range: Option<f64>,
    pub avg_abs_change: Option<f64>,
}

#[inline]
fn same_f64(a: Option<f64>, b: Option<f64>) -> bool {
    match (a, b) {
        (Some(x), Some(y)) => x.to_bits() == y.to_bits(),
        (None, None) => true,
        _ => false,
    }
}

impl WindowStats {
    const fn empty(window_ms: i64) -> WindowStats {
        WindowStats {
            window_ms,
            n: 0,
            start_ts: None,
            end_ts: None,
            coverage_ms: None,
            ready: false,
            stale_ms: None,
            start_price: None,
            end_price: None,
            net_change: None,
            low: None,
            high: None,
            stddev: None,
            high_low_range: None,
            avg_abs_change: None,
        }
    }

    /// Field-wise identity with `f64` compared by bit pattern (14 P-13).
    pub fn same_bits(&self, o: &WindowStats) -> bool {
        self.window_ms == o.window_ms
            && self.n == o.n
            && self.start_ts == o.start_ts
            && self.end_ts == o.end_ts
            && self.coverage_ms == o.coverage_ms
            && self.ready == o.ready
            && self.stale_ms == o.stale_ms
            && same_f64(self.start_price, o.start_price)
            && same_f64(self.end_price, o.end_price)
            && same_f64(self.net_change, o.net_change)
            && same_f64(self.low, o.low)
            && same_f64(self.high, o.high)
            && same_f64(self.stddev, o.stddev)
            && same_f64(self.high_low_range, o.high_low_range)
            && same_f64(self.avg_abs_change, o.avg_abs_change)
    }
}

/// Typed snapshot (TS `VolatilitySnapshot`). An outcome appears once it had a
/// price (TS `byAssetId` key presence).
#[derive(Clone, Debug, PartialEq)]
pub struct VolatilitySnapshot {
    as_of_ts: Option<TsMs>,
    labels: Box<[Box<str>]>,
    present: PerOutcome<bool>,
    stats: PerOutcome<Box<[WindowStats]>>,
}

impl VolatilitySnapshot {
    /// Time of the last observed tick (TS `asOfTsMs`).
    pub fn as_of_ts(&self) -> Option<TsMs> {
        self.as_of_ts
    }

    /// Window labels in canonical (byte) order; index-aligned with [`Self::windows`].
    pub fn labels(&self) -> impl ExactSizeIterator<Item = &str> + '_ {
        self.labels.iter().map(|l| &**l)
    }

    pub fn label_index(&self, label: &str) -> Option<usize> {
        self.labels.iter().position(|l| &**l == label)
    }

    /// All windows of an outcome, `None` until it had a price.
    pub fn windows(&self, o: Outcome) -> Option<&[WindowStats]> {
        self.present[o].then(|| &*self.stats[o])
    }

    /// One window by label.
    pub fn window(&self, o: Outcome, label: &str) -> Option<&WindowStats> {
        let i = self.label_index(label)?;
        self.windows(o).map(|w| &w[i])
    }
}

#[derive(Copy, Clone, Debug)]
struct Sample {
    ts: i64,
    price: f64,
}

#[derive(Copy, Clone, Debug)]
struct Computed {
    at_ts: i64,
    start_price: f64,
    end_price: f64,
    net_change: f64,
    low: Option<f64>,
    high: Option<f64>,
    stddev: f64,
    high_low_range: Option<f64>,
    avg_abs_change: f64,
}

/// Rolling window with running sums and monotonic min/max deques; amortized
/// O(1) per sample and allocation-free once the deques reached their
/// steady-state capacity (14 §14).
#[derive(Clone, Debug)]
struct RollingWindow {
    window_ms: i64,
    samples: VecDeque<Sample>,
    sum: f64,
    sum_sq: f64,
    sum_abs_diff: f64,
    /// Increasing prices (front = window minimum).
    min_q: VecDeque<Sample>,
    /// Decreasing prices (front = window maximum).
    max_q: VecDeque<Sample>,
    last_computed: Option<Computed>,
}

impl RollingWindow {
    fn new(window_ms: i64) -> RollingWindow {
        RollingWindow {
            window_ms,
            samples: VecDeque::new(),
            sum: 0.0,
            sum_sq: 0.0,
            sum_abs_diff: 0.0,
            min_q: VecDeque::new(),
            max_q: VecDeque::new(),
            last_computed: None,
        }
    }

    /// Back to empty, keeping capacity (per-market reset, 14 P-3).
    fn reset(&mut self) {
        self.samples.clear();
        self.min_q.clear();
        self.max_q.clear();
        self.sum = 0.0;
        self.sum_sq = 0.0;
        self.sum_abs_diff = 0.0;
        self.last_computed = None;
    }

    fn update(&mut self, ts: i64, price: f64) {
        let cutoff = ts - self.window_ms;
        while self.samples.front().is_some_and(|s| s.ts < cutoff) {
            if self.samples.len() >= 2 {
                self.sum_abs_diff -= (self.samples[1].price - self.samples[0].price).abs();
            }
            if let Some(old) = self.samples.pop_front() {
                self.sum -= old.price;
                self.sum_sq -= old.price * old.price;
            }
        }
        while self.min_q.front().is_some_and(|s| s.ts < cutoff) {
            self.min_q.pop_front();
        }
        while self.max_q.front().is_some_and(|s| s.ts < cutoff) {
            self.max_q.pop_front();
        }
        if let Some(last) = self.samples.back() {
            self.sum_abs_diff += (price - last.price).abs();
        }
        let s = Sample { ts, price };
        self.samples.push_back(s);
        self.sum += price;
        self.sum_sq += price * price;
        while self.min_q.back().is_some_and(|b| b.price >= price) {
            self.min_q.pop_back();
        }
        self.min_q.push_back(s);
        while self.max_q.back().is_some_and(|b| b.price <= price) {
            self.max_q.pop_back();
        }
        self.max_q.push_back(s);
    }

    /// Current statistics; records the computed metrics while ready, so the
    /// call is idempotent between updates (TS calls it on every snapshot).
    fn stats(&mut self) -> WindowStats {
        let n = self.samples.len();
        let (Some(&first), Some(&last)) = (self.samples.front(), self.samples.back()) else {
            return WindowStats::empty(self.window_ms);
        };
        let coverage_ms = (last.ts - first.ts).max(0);
        let ready = coverage_ms as f64 >= self.window_ms as f64 * 0.93 && n >= 6;
        if !ready {
            let lc = self.last_computed;
            return WindowStats {
                window_ms: self.window_ms,
                n,
                start_ts: Some(TsMs(first.ts)),
                end_ts: Some(TsMs(last.ts)),
                coverage_ms: Some(coverage_ms),
                ready,
                stale_ms: lc.filter(|c| last.ts >= c.at_ts).map(|c| last.ts - c.at_ts),
                start_price: lc.map(|c| c.start_price),
                end_price: lc.map(|c| c.end_price),
                net_change: lc.map(|c| c.net_change),
                low: lc.and_then(|c| c.low),
                high: lc.and_then(|c| c.high),
                stddev: lc.map(|c| c.stddev),
                high_low_range: lc.and_then(|c| c.high_low_range),
                avg_abs_change: lc.map(|c| c.avg_abs_change),
            };
        }
        let nf = n as f64;
        let mean = self.sum / nf;
        let raw_var = self.sum_sq / nf - mean * mean;
        // max(0, v) with +0.0 for any non-positive value (TS `Math.max(0, v)`).
        let variance = if raw_var > 0.0 { raw_var } else { 0.0 };
        let low = self.min_q.front().map(|s| s.price);
        let high = self.max_q.front().map(|s| s.price);
        let c = Computed {
            at_ts: last.ts,
            start_price: first.price,
            end_price: last.price,
            net_change: last.price - first.price,
            low,
            high,
            stddev: variance.sqrt(),
            high_low_range: match (low, high) {
                (Some(l), Some(h)) => Some(h - l),
                _ => None,
            },
            avg_abs_change: if n >= 2 {
                self.sum_abs_diff / (nf - 1.0)
            } else {
                0.0
            },
        };
        self.last_computed = Some(c);
        WindowStats {
            window_ms: self.window_ms,
            n,
            start_ts: Some(TsMs(first.ts)),
            end_ts: Some(TsMs(last.ts)),
            coverage_ms: Some(coverage_ms),
            ready,
            stale_ms: Some(0),
            start_price: Some(c.start_price),
            end_price: Some(c.end_price),
            net_change: Some(c.net_change),
            low: c.low,
            high: c.high,
            stddev: Some(c.stddev),
            high_low_range: c.high_low_range,
            avg_abs_change: Some(c.avg_abs_change),
        }
    }
}

/// The plugin: per outcome, one rolling window per configured label.
#[derive(Clone, Debug)]
pub struct TimeWindowVolatility {
    track: VolPrice,
    windows: PerOutcome<Box<[RollingWindow]>>,
    snap: VolatilitySnapshot,
}

impl TimeWindowVolatility {
    /// Builds the plugin (all buffers allocated here, never per tick).
    pub fn new(cfg: &TimeWindowVolatilityConfig) -> Result<TimeWindowVolatility, ConfigError> {
        cfg.validate()?;
        let labels: Box<[Box<str>]> = cfg.windows.keys().map(|k| k.as_str().into()).collect();
        let mk_windows = || -> Box<[RollingWindow]> {
            cfg.windows
                .values()
                .map(|&ms| RollingWindow::new(ms))
                .collect()
        };
        let mk_stats = || -> Box<[WindowStats]> {
            cfg.windows
                .values()
                .map(|&ms| WindowStats::empty(ms))
                .collect()
        };
        Ok(TimeWindowVolatility {
            track: cfg.track_price,
            windows: PerOutcome::new(mk_windows(), mk_windows()),
            snap: VolatilitySnapshot {
                as_of_ts: None,
                labels,
                present: PerOutcome::new(false, false),
                stats: PerOutcome::new(mk_stats(), mk_stats()),
            },
        })
    }

    /// Per-market reset (14 P-3); keeps buffer capacity.
    pub fn start_market(&mut self) {
        self.snap.as_of_ts = None;
        for o in Outcome::ALL {
            self.snap.present[o] = false;
            for (w, s) in self.windows[o]
                .iter_mut()
                .zip(self.snap.stats[o].iter_mut())
            {
                w.reset();
                *s = WindowStats::empty(w.window_ms);
            }
        }
    }
}

impl Plugin for TimeWindowVolatility {
    const ID: PluginId = PluginId::TimeWindowVolatility;
    const HANDLES_SYNTHETIC_TICKS: bool = false;
    type Snapshot = VolatilitySnapshot;

    fn on_tick(&mut self, tick: &PluginTick) -> bool {
        let ts = tick.ts;
        let mut changed = false;
        if self.snap.as_of_ts != Some(ts) {
            self.snap.as_of_ts = Some(ts);
            changed = true;
        }
        for o in Outcome::ALL {
            let Some(price) = self.track.read(&tick.tops[o]) else {
                continue;
            };
            if !self.snap.present[o] {
                self.snap.present[o] = true;
                changed = true;
            }
            for (w, slot) in self.windows[o]
                .iter_mut()
                .zip(self.snap.stats[o].iter_mut())
            {
                w.update(ts.0, price);
                let s = w.stats();
                if !s.same_bits(slot) {
                    *slot = s;
                    changed = true;
                }
            }
        }
        changed
    }

    fn snapshot(&self) -> &VolatilitySnapshot {
        &self.snap
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_core::Price;

    fn tick(ts: i64, up_bid: Option<i64>, up_ask: Option<i64>) -> PluginTick {
        let p = |c: Option<i64>| c.map(|c| Price::from_micros(c * 10_000));
        PluginTick::new(
            TsMs(ts),
            false,
            PerOutcome::new(BookTop::new(p(up_bid), p(up_ask)), BookTop::EMPTY),
        )
    }

    fn plugin(windows: &[(&str, i64)], track: VolPrice) -> TimeWindowVolatility {
        TimeWindowVolatility::new(&TimeWindowVolatilityConfig::new(
            windows.iter().map(|(l, m)| (*l, *m)),
            track,
        ))
        .unwrap()
    }

    // spec: 14 §12.2 (ready iff coverage >= 0.93 x window and n >= 6)
    #[test]
    fn ready_needs_coverage_and_six_samples() {
        let mut v = plugin(&[("1s", 1000)], VolPrice::Bid);
        for (i, ts) in [0, 200, 400, 600, 800].into_iter().enumerate() {
            v.on_tick(&tick(ts, Some(50 + i as i64), None));
        }
        let w = *v.snapshot().window(Outcome::Up, "1s").unwrap();
        assert_eq!(w.n, 5);
        assert!(!w.ready);
        assert_eq!(w.stale_ms, None);
        assert_eq!(w.stddev, None);
        // sixth sample but coverage 920 < 930
        v.on_tick(&tick(920, Some(55), None));
        assert!(!v.snapshot().window(Outcome::Up, "1s").unwrap().ready);
        v.on_tick(&tick(930, Some(56), None));
        let w = *v.snapshot().window(Outcome::Up, "1s").unwrap();
        assert!(w.ready);
        assert_eq!(w.n, 7);
        assert_eq!(w.stale_ms, Some(0));
        assert_eq!(w.low, Some(0.5));
        assert_eq!(w.high, Some(0.56));
        assert_eq!(w.start_price, Some(0.5));
        assert_eq!(w.end_price, Some(0.56));
        assert_eq!(w.high_low_range, Some(0.56 - 0.5));
    }

    // spec: 14 §12.2 (last ready values kept with staleMs)
    #[test]
    fn not_ready_keeps_last_values_with_stale_ms() {
        let mut v = plugin(&[("1s", 1000)], VolPrice::Bid);
        for ts in (0..=1000).step_by(100) {
            v.on_tick(&tick(ts, Some(50), None));
        }
        let ready = *v.snapshot().window(Outcome::Up, "1s").unwrap();
        assert!(ready.ready);
        // a gap evicts all but the new sample -> not ready, stale values
        v.on_tick(&tick(5000, Some(60), None));
        let w = *v.snapshot().window(Outcome::Up, "1s").unwrap();
        assert!(!w.ready);
        assert_eq!(w.n, 1);
        assert_eq!(w.stale_ms, Some(4000));
        assert_eq!(w.end_price, ready.end_price);
        assert_eq!(w.stddev, Some(0.0));
    }

    // spec: 14 §12.2 (outcome key appears once it had a price; missing sides skip the sample)
    #[test]
    fn outcomes_appear_with_their_first_price() {
        let mut v = plugin(&[("1s", 1000)], VolPrice::Mid);
        assert!(v.on_tick(&tick(10, Some(50), None)));
        assert!(v.snapshot().windows(Outcome::Up).is_none());
        assert_eq!(v.snapshot().as_of_ts(), Some(TsMs(10)));
        v.on_tick(&tick(20, Some(50), Some(52)));
        let w = v.snapshot().window(Outcome::Up, "1s").unwrap();
        assert_eq!(w.n, 1);
        assert!(v.snapshot().windows(Outcome::Down).is_none());
    }

    // spec: 14 P-13 (generation-relevant change flag)
    #[test]
    fn change_flag_tracks_visible_changes() {
        let mut v = plugin(&[("1s", 1000)], VolPrice::Bid);
        assert!(v.on_tick(&tick(10, None, None))); // asOf changes
        assert!(!v.on_tick(&tick(10, None, None))); // nothing visible changed
        assert!(v.on_tick(&tick(10, Some(50), None)));
    }

    // spec: 14 P-3 (reset per market keeps nothing)
    #[test]
    fn start_market_resets_state() {
        let mut v = plugin(&[("1s", 1000), ("5s", 5000)], VolPrice::Bid);
        let fresh = v.snapshot().clone();
        for ts in (0..2000).step_by(50) {
            v.on_tick(&tick(ts, Some(40 + (ts / 50) % 7), None));
        }
        v.start_market();
        assert_eq!(v.snapshot(), &fresh);
    }

    // spec: 00 R14 (fail loud on invalid config)
    #[test]
    fn invalid_configs_are_rejected() {
        let empty = TimeWindowVolatilityConfig::default();
        assert_eq!(
            TimeWindowVolatility::new(&empty).unwrap_err(),
            ConfigError::VolatilityNoWindows
        );
        let zero = TimeWindowVolatilityConfig::new([("a", 0)], VolPrice::Mid);
        assert!(matches!(
            TimeWindowVolatility::new(&zero).unwrap_err(),
            ConfigError::VolatilityWindowMs { ms: 0, .. }
        ));
    }

    // spec: 14 §14 (allocation-free steady state: capacities stop growing)
    #[test]
    fn steady_state_does_not_grow_buffers() {
        let mut v = plugin(&[("1s", 1000)], VolPrice::Bid);
        for ts in (0..20_000).step_by(10) {
            v.on_tick(&tick(ts, Some(30 + (ts / 10) % 40), None));
        }
        let caps = |v: &TimeWindowVolatility| {
            let w = &v.windows[Outcome::Up][0];
            (w.samples.capacity(), w.min_q.capacity(), w.max_q.capacity())
        };
        let before = caps(&v);
        for ts in (20_000..200_000).step_by(10) {
            v.on_tick(&tick(ts, Some(30 + (ts / 10) % 40), None));
        }
        assert_eq!(caps(&v), before);
    }
}
