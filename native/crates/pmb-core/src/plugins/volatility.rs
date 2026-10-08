//! Rolling time-window volatility of one book-derived price per asset
//! (port of `TimeWindowVolatility`). One sample per real book tick.

use crate::market::{Book, MarketBooks};
use crate::model::{AssetId, TsMs};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

/// Which book price a window tracks.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VolPrice {
    Bid,
    Ask,
    #[default]
    Mid,
}

impl VolPrice {
    fn read(self, book: &Book) -> Option<f64> {
        match self {
            VolPrice::Bid => book.best_bid().map(|l| l.price.to_f64()),
            VolPrice::Ask => book.best_ask().map(|l| l.price.to_f64()),
            VolPrice::Mid => book.mid(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimeWindowVolatilityConfig {
    /// Label -> window length in ms, e.g. `{"1s": 1000, "2s": 2000}`.
    pub windows: BTreeMap<String, i64>,
    #[serde(default)]
    pub track_price: VolPrice,
}

/// Statistics of one window. Metrics are only recomputed while the window is
/// `ready` (>= 93% coverage and >= 6 samples); otherwise the last ready values
/// are kept and `stale_ms` says how old they are.
#[derive(Copy, Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolatilityWindowStats {
    pub window_ms: i64,
    pub n: usize,
    pub start_ts_ms: Option<TsMs>,
    pub end_ts_ms: Option<TsMs>,
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

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolatilitySnapshot {
    pub as_of_ts_ms: Option<TsMs>,
    /// asset id -> window label -> stats. An asset appears once it had a price.
    pub by_asset_id: BTreeMap<AssetId, BTreeMap<String, VolatilityWindowStats>>,
}

impl VolatilitySnapshot {
    pub fn window(&self, asset: &AssetId, label: &str) -> Option<&VolatilityWindowStats> {
        self.by_asset_id.get(asset)?.get(label)
    }
}

#[derive(Copy, Clone, Debug)]
struct Sample {
    ts_ms: TsMs,
    price: f64,
}

#[derive(Copy, Clone, Debug)]
struct Computed {
    at_ts_ms: TsMs,
    start_price: f64,
    end_price: f64,
    net_change: f64,
    low: Option<f64>,
    high: Option<f64>,
    stddev: f64,
    high_low_range: Option<f64>,
    avg_abs_change: f64,
}

/// O(1) amortized rolling window: running sums for the variance and the mean
/// absolute step, monotonic deques for min / max.
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
    fn new(window_ms: i64) -> Self {
        Self {
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

    fn update(&mut self, ts_ms: TsMs, price: f64) {
        let cutoff = ts_ms - self.window_ms;
        while self.samples.front().is_some_and(|s| s.ts_ms < cutoff) {
            if self.samples.len() >= 2 {
                self.sum_abs_diff -= (self.samples[1].price - self.samples[0].price).abs();
            }
            if let Some(old) = self.samples.pop_front() {
                self.sum -= old.price;
                self.sum_sq -= old.price * old.price;
            }
        }
        while self.min_q.front().is_some_and(|s| s.ts_ms < cutoff) {
            self.min_q.pop_front();
        }
        while self.max_q.front().is_some_and(|s| s.ts_ms < cutoff) {
            self.max_q.pop_front();
        }

        if let Some(last) = self.samples.back() {
            self.sum_abs_diff += (price - last.price).abs();
        }
        let s = Sample { ts_ms, price };
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

    fn stats(&mut self) -> VolatilityWindowStats {
        let n = self.samples.len();
        let (Some(first), Some(last)) = (self.samples.front(), self.samples.back()) else {
            return VolatilityWindowStats {
                window_ms: self.window_ms,
                n: 0,
                start_ts_ms: None,
                end_ts_ms: None,
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
            };
        };
        let (first, last) = (*first, *last);
        let coverage_ms = (last.ts_ms - first.ts_ms).max(0);
        let ready = coverage_ms as f64 >= self.window_ms as f64 * 0.93 && n >= 6;

        if !ready {
            let lc = self.last_computed;
            return VolatilityWindowStats {
                window_ms: self.window_ms,
                n,
                start_ts_ms: Some(first.ts_ms),
                end_ts_ms: Some(last.ts_ms),
                coverage_ms: Some(coverage_ms),
                ready,
                stale_ms: lc
                    .filter(|c| last.ts_ms >= c.at_ts_ms)
                    .map(|c| last.ts_ms - c.at_ts_ms),
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
        let variance = (self.sum_sq / nf - mean * mean).max(0.0);
        let low = self.min_q.front().map(|s| s.price);
        let high = self.max_q.front().map(|s| s.price);
        let c = Computed {
            at_ts_ms: last.ts_ms,
            start_price: first.price,
            end_price: last.price,
            net_change: last.price - first.price,
            low,
            high,
            stddev: variance.sqrt(),
            high_low_range: low.zip(high).map(|(l, h)| h - l),
            avg_abs_change: if n >= 2 {
                self.sum_abs_diff / (nf - 1.0)
            } else {
                0.0
            },
        };
        self.last_computed = Some(c);
        VolatilityWindowStats {
            window_ms: self.window_ms,
            n,
            start_ts_ms: Some(first.ts_ms),
            end_ts_ms: Some(last.ts_ms),
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

/// Per-asset rolling windows. Does not handle synthetic ticks (one sample per
/// real book event, so opting into feed ticks cannot change its statistics).
#[derive(Clone, Debug)]
pub(crate) struct TimeWindowVolatility {
    cfg: TimeWindowVolatilityConfig,
    windows: [Option<Vec<(String, RollingWindow)>>; 2],
}

impl TimeWindowVolatility {
    pub(crate) fn new(cfg: TimeWindowVolatilityConfig) -> Self {
        Self {
            cfg,
            windows: [None, None],
        }
    }

    pub(crate) fn reset(&mut self) {
        self.windows = [None, None];
    }

    /// Adds one sample per asset with a price and refreshes `out` in place.
    pub(crate) fn on_tick(&mut self, books: &MarketBooks, ts_ms: TsMs, out: &mut VolatilitySnapshot) {
        out.as_of_ts_ms = Some(ts_ms);
        for (i, book) in books.books.iter().enumerate() {
            let Some(price) = self.cfg.track_price.read(book) else {
                continue;
            };
            let windows = self.windows[i].get_or_insert_with(|| {
                self.cfg
                    .windows
                    .iter()
                    .map(|(label, ms)| (label.clone(), RollingWindow::new(*ms)))
                    .collect()
            });
            let per_label = out.by_asset_id.entry(books.assets[i].clone()).or_default();
            for (label, w) in windows.iter_mut() {
                w.update(ts_ms, price);
                let stats = w.stats();
                match per_label.get_mut(label) {
                    Some(slot) => *slot = stats,
                    None => {
                        per_label.insert(label.clone(), stats);
                    }
                }
            }
        }
    }
}
