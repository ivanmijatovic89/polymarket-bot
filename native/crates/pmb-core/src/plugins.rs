//! Tick-scoped strategy plugins (computed once per tick, cached for the
//! cascading account callbacks of that tick).
//!
//! A strategy declares what it wants in [`PluginRequest`] (via
//! `Requirements::plugins`); the runtime builds one [`PluginSet`] per market
//! session, calls [`PluginSet::on_tick`] before every strategy tick and hands
//! [`PluginSet::snapshot`] to every callback of that tick.
//!
//! External feeds are not a plugin here: they live in `FeedsSnapshot` and are
//! requested through `Requirements::feeds`. Deribit is out of scope.

mod dwell_gate;
mod technical_indicators;
mod time_window_gate;
mod volatility;

pub use dwell_gate::{BidOrAsk, DwellGateConfig, DwellGateSnapshot, DwellSideState};
pub use technical_indicators::{
    Candle, CandleSource, KlineInterval, MemoryCandleSource, Session, TaMeta, TechnicalIndicatorsConfig,
    TechnicalIndicatorsSnapshot, Tf15m, Tf1h,
};
pub use time_window_gate::{TimeWindowGateConfig, TimeWindowGateSnapshot};
pub use volatility::{
    TimeWindowVolatilityConfig, VolPrice, VolatilitySnapshot, VolatilityWindowStats,
};

use crate::feeds::FeedsSnapshot;
use crate::market::MarketBooks;
use crate::model::{MarketInfo, TsMs};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Which plugins a strategy wants, with their configuration.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_window_volatility: Option<TimeWindowVolatilityConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technical_indicators: Option<TechnicalIndicatorsConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dwell_gate: Option<DwellGateConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_window_gate: Option<TimeWindowGateConfig>,
}

impl PluginRequest {
    pub fn is_empty(&self) -> bool {
        self.time_window_volatility.is_none()
            && self.technical_indicators.is_none()
            && self.dwell_gate.is_none()
            && self.time_window_gate.is_none()
    }
}

/// Latest plugin outputs (JSON keys = the TypeScript plugin ids).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginsSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_window_volatility: Option<VolatilitySnapshot>,
    /// None until computed, and when it could not be computed for this market.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technical_indicators: Option<TechnicalIndicatorsSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dwell_gate: Option<DwellGateSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_window_gate: Option<TimeWindowGateSnapshot>,
}

/// External inputs some plugins need. The core does no I/O itself.
#[derive(Clone, Default)]
pub struct PluginDeps {
    /// Required when `technical_indicators` is requested.
    pub candles: Option<Arc<dyn CandleSource>>,
}

struct TaState {
    cfg: TechnicalIndicatorsConfig,
    source: Arc<dyn CandleSource>,
    slug: Option<String>,
    done: bool,
}

/// The plugins of one market session.
pub struct PluginSet {
    volatility: Option<volatility::TimeWindowVolatility>,
    ta: Option<TaState>,
    dwell: Option<dwell_gate::DwellGate>,
    gate: Option<time_window_gate::TimeWindowGate>,
    snapshot: PluginsSnapshot,
}

impl PluginSet {
    /// Builds the requested plugins. Fails when a plugin's input is missing
    /// (no silent substitution).
    pub fn new(req: &PluginRequest, market: &MarketInfo, deps: &PluginDeps) -> anyhow::Result<Self> {
        let ta = match &req.technical_indicators {
            None => None,
            Some(cfg) => {
                let source = deps.candles.clone().ok_or_else(|| {
                    anyhow::anyhow!("technicalIndicators plugin requested but no candle source is configured")
                })?;
                Some(TaState {
                    cfg: cfg.clone(),
                    source,
                    slug: market.slug.clone(),
                    done: false,
                })
            }
        };
        let mut set = Self {
            volatility: req
                .time_window_volatility
                .clone()
                .map(volatility::TimeWindowVolatility::new),
            ta,
            dwell: req.dwell_gate.clone().map(dwell_gate::DwellGate::new),
            gate: req
                .time_window_gate
                .clone()
                .map(|c| time_window_gate::TimeWindowGate::new(c, market.start_ms)),
            snapshot: PluginsSnapshot::default(),
        };
        set.reset();
        Ok(set)
    }

    pub fn is_empty(&self) -> bool {
        self.volatility.is_none() && self.ta.is_none() && self.dwell.is_none() && self.gate.is_none()
    }

    /// Back to the freshly-built state.
    pub fn reset(&mut self) {
        if let Some(v) = &mut self.volatility {
            v.reset();
        }
        if let Some(ta) = &mut self.ta {
            ta.done = false;
        }
        if let Some(d) = &mut self.dwell {
            d.reset();
        }
        self.snapshot = PluginsSnapshot {
            time_window_volatility: self.volatility.as_ref().map(|_| VolatilitySnapshot::default()),
            technical_indicators: None,
            dwell_gate: self.dwell.as_ref().map(|d| d.initial_snapshot()),
            time_window_gate: self.gate.as_ref().map(|g| g.initial_snapshot()),
        };
    }

    /// Updates every plugin for one strategy tick (after the book event was
    /// applied) and returns the snapshot to pass to the callbacks of this tick.
    /// On synthetic feed ticks only plugins that are pure functions of time
    /// (dwell gate, time-window gate) run; the others keep their last output.
    pub fn on_tick(
        &mut self,
        books: &MarketBooks,
        ts_ms: TsMs,
        is_synthetic: bool,
        _feeds: &FeedsSnapshot,
    ) -> &PluginsSnapshot {
        if !is_synthetic {
            if let (Some(v), Some(out)) = (&mut self.volatility, &mut self.snapshot.time_window_volatility) {
                v.on_tick(books, ts_ms, out);
            }
            if let Some(ta) = &mut self.ta {
                if !ta.done {
                    if let Some(slug) = &ta.slug {
                        ta.done = true;
                        self.snapshot.technical_indicators =
                            technical_indicators::compute_snapshot(&ta.cfg, ta.source.as_ref(), slug);
                    }
                }
            }
        }
        if let Some(d) = &mut self.dwell {
            self.snapshot.dwell_gate = Some(d.on_tick(books, ts_ms));
        }
        if let Some(g) = &self.gate {
            self.snapshot.time_window_gate = Some(g.on_tick(ts_ms));
        }
        &self.snapshot
    }

    /// Output of the last `on_tick` (reused by cascading account callbacks).
    pub fn snapshot(&self) -> &PluginsSnapshot {
        &self.snapshot
    }
}

#[cfg(test)]
mod tests;
