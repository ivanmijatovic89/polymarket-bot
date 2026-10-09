//! The plugin contract (14 §12.1) and the per-strategy-instance container.
//!
//! A [`PluginSet`] is created once per strategy instance (candidate) from its
//! [`PluginRequest`], reset per market by [`PluginSet::start_market`]
//! (14 P-3), updated once per tick by [`PluginSet::on_tick`] (14 P-4, P-5:
//! the engine decides which ticks reach it), and read through
//! [`PluginSet::view`], which stays fixed until the next `on_tick`
//! (tick-scoped snapshot, 12 §6.4). Each plugin carries a change generation
//! (14 P-13).

use crate::dwell_gate::{DwellGate, DwellGateConfig, DwellGateSnapshot};
use crate::technical_indicators::{
    TaInput, TaOutput, TechnicalIndicators, TechnicalIndicatorsConfig,
};
use crate::time_window_gate::{TimeWindowGate, TimeWindowGateConfig, TimeWindowGateSnapshot};
use crate::volatility::{TimeWindowVolatility, TimeWindowVolatilityConfig, VolatilitySnapshot};
use crate::{CandleInterval, PluginMarket, PluginTick};
use serde::Serialize;

/// Plugin ids (the TS ids, snapshot keys at the TS-shape boundary, 12 §6.4).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum PluginId {
    TimeWindowVolatility,
    TechnicalIndicators,
    DwellGate,
    TimeWindowGate,
}

impl PluginId {
    pub const ALL: [PluginId; 4] = [
        PluginId::TimeWindowVolatility,
        PluginId::TechnicalIndicators,
        PluginId::DwellGate,
        PluginId::TimeWindowGate,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            PluginId::TimeWindowVolatility => "timeWindowVolatility",
            PluginId::TechnicalIndicators => "technicalIndicators",
            PluginId::DwellGate => "dwellGate",
            PluginId::TimeWindowGate => "timeWindowGate",
        }
    }
}

/// The plugin contract (14 §12.1).
///
/// - P-1: a deterministic tick observer with a typed snapshot; no I/O, no
///   clock other than [`PluginTick::ts`], no env, no hash-order dependence.
/// - P-4: `on_tick` runs once per observed tick; the snapshot is then fixed
///   until the next observed tick.
/// - §12.4: synthetic ticks reach a plugin only if
///   [`Plugin::HANDLES_SYNTHETIC_TICKS`].
/// - P-13: `on_tick` returns `true` exactly when the strategy-visible
///   snapshot changed (field-wise, `f64` by bit pattern, availability
///   included).
pub trait Plugin {
    const ID: PluginId;
    const HANDLES_SYNTHETIC_TICKS: bool;
    type Snapshot;

    /// Observes one tick; `true` iff the snapshot changed (P-13).
    fn on_tick(&mut self, tick: &PluginTick) -> bool;

    /// The current snapshot.
    fn snapshot(&self) -> &Self::Snapshot;
}

/// Invalid plugin config (00 R14).
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    #[error("timeWindowVolatility needs at least one window")]
    VolatilityNoWindows,
    #[error("timeWindowVolatility window `{label}` has length {ms} ms; it must be > 0")]
    VolatilityWindowMs { label: String, ms: i64 },
    #[error("dwellGate requiredMs is {0}; it must be >= 0")]
    DwellRequiredMs(i64),
}

/// Engine-side misuse of the plugin set or malformed engine input. These are
/// engine faults, never data-driven absence (which is a typed unavailable
/// state, 14 P-7).
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum PluginError {
    #[error("technicalIndicators is requested but no candles were supplied at market start")]
    MissingTaInput,
    #[error("TA candles were supplied but technicalIndicators is not requested")]
    UnexpectedTaInput,
    #[error("on_tick before start_market")]
    NotStarted,
    #[error("{} candle {index} is not a whole aligned interval", interval.as_str())]
    CandleShape {
        interval: CandleInterval,
        index: usize,
    },
    #[error("{} candles are not strictly ascending at index {index}", interval.as_str())]
    CandleOrder {
        interval: CandleInterval,
        index: usize,
    },
}

/// Which plugins a strategy requests, with their configs (30 §10 builders).
/// Plain data, canonical (`Eq + Ord + Hash`), so candidates with equal
/// requests can share one computation (14 P-6).
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_window_volatility: Option<TimeWindowVolatilityConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technical_indicators: Option<TechnicalIndicatorsConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dwell_gate: Option<DwellGateConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
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

/// Read-only access to the tick-scoped snapshots (30 §5 `plugins()`).
/// Unrequested plugins are `None`.
#[derive(Clone, Debug)]
pub struct PluginsView {
    volatility: Option<TimeWindowVolatility>,
    ta: Option<TechnicalIndicators>,
    dwell: Option<DwellGate>,
    gate: Option<TimeWindowGate>,
}

impl PluginsView {
    pub fn time_window_volatility(&self) -> Option<&VolatilitySnapshot> {
        self.volatility.as_ref().map(Plugin::snapshot)
    }

    pub fn technical_indicators(&self) -> Option<&TaOutput> {
        self.ta.as_ref().map(Plugin::snapshot)
    }

    pub fn dwell_gate(&self) -> Option<&DwellGateSnapshot> {
        self.dwell.as_ref().map(Plugin::snapshot)
    }

    pub fn time_window_gate(&self) -> Option<&TimeWindowGateSnapshot> {
        self.gate.as_ref().map(Plugin::snapshot)
    }
}

/// Generation of each plugin slot, indexed like [`PluginId::ALL`].
type Generations = [u64; 4];

#[inline]
fn observe<P: Plugin>(p: &mut Option<P>, tick: &PluginTick, gen: &mut u64) -> bool {
    match p {
        Some(p) if !tick.synthetic || P::HANDLES_SYNTHETIC_TICKS => {
            let changed = p.on_tick(tick);
            *gen += changed as u64;
            changed
        }
        _ => false,
    }
}

/// The plugins of one strategy instance.
#[derive(Clone, Debug)]
pub struct PluginSet {
    view: PluginsView,
    generations: Generations,
    combined: u64,
    started: bool,
}

impl PluginSet {
    /// Builds the requested plugins; every buffer is allocated here, so
    /// `on_tick` is allocation-free in steady state (14 §14).
    pub fn new(req: &PluginRequest) -> Result<PluginSet, ConfigError> {
        Ok(PluginSet {
            view: PluginsView {
                volatility: req
                    .time_window_volatility
                    .as_ref()
                    .map(TimeWindowVolatility::new)
                    .transpose()?,
                ta: req
                    .technical_indicators
                    .as_ref()
                    .map(TechnicalIndicators::new),
                dwell: req.dwell_gate.as_ref().map(DwellGate::new).transpose()?,
                gate: req.time_window_gate.as_ref().map(TimeWindowGate::new),
            },
            generations: [0; 4],
            combined: 0,
            started: false,
        })
    }

    /// No plugin requested: the snapshot step costs nothing (12 §6.4).
    pub fn is_empty(&self) -> bool {
        self.view.volatility.is_none()
            && self.view.ta.is_none()
            && self.view.dwell.is_none()
            && self.view.gate.is_none()
    }

    /// Whether `start_market` needs TA candles.
    pub fn needs_ta_input(&self) -> bool {
        self.view.ta.is_some()
    }

    /// Resets every plugin for a new market (14 P-3) and computes TA from
    /// the supplied candles (14 P-10). Generations restart at 0.
    pub fn start_market(
        &mut self,
        market: &PluginMarket,
        ta: Option<TaInput<'_>>,
    ) -> Result<(), PluginError> {
        match (&mut self.view.ta, ta) {
            (Some(p), Some(input)) => p.start_market(market, input)?,
            (Some(_), None) => return Err(PluginError::MissingTaInput),
            (None, Some(_)) => return Err(PluginError::UnexpectedTaInput),
            (None, None) => {}
        }
        if let Some(p) = &mut self.view.volatility {
            p.start_market();
        }
        if let Some(p) = &mut self.view.dwell {
            p.start_market();
        }
        if let Some(p) = &mut self.view.gate {
            p.start_market(market);
        }
        self.generations = [0; 4];
        self.combined = 0;
        self.started = true;
        Ok(())
    }

    /// Observes one tick (14 P-4); synthetic ticks reach only the plugins
    /// that declare them (14 §12.4). Returns `true` iff any snapshot changed.
    pub fn on_tick(&mut self, tick: &PluginTick) -> Result<bool, PluginError> {
        if !self.started {
            return Err(PluginError::NotStarted);
        }
        let g = &mut self.generations;
        let v = &mut self.view;
        let mut changed = observe(&mut v.volatility, tick, &mut g[0]);
        changed |= observe(&mut v.ta, tick, &mut g[1]);
        changed |= observe(&mut v.dwell, tick, &mut g[2]);
        changed |= observe(&mut v.gate, tick, &mut g[3]);
        self.combined += changed as u64;
        Ok(changed)
    }

    /// The tick-scoped snapshots (12 §6.4).
    #[inline]
    pub fn view(&self) -> &PluginsView {
        &self.view
    }

    /// Change generation of one requested plugin (14 P-13); `None` if not
    /// requested.
    pub fn generation(&self, id: PluginId) -> Option<u64> {
        let (present, i) = match id {
            PluginId::TimeWindowVolatility => (self.view.volatility.is_some(), 0),
            PluginId::TechnicalIndicators => (self.view.ta.is_some(), 1),
            PluginId::DwellGate => (self.view.dwell.is_some(), 2),
            PluginId::TimeWindowGate => (self.view.gate.is_some(), 3),
        };
        present.then_some(self.generations[i])
    }

    /// Increments once per tick on which any plugin output changed: the
    /// single dirty counter of the tick interest filter (16 TF-2 (e), TF-7).
    #[inline]
    pub fn combined_generation(&self) -> u64 {
        self.combined
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BidOrAsk, BookTop, Candle, VolPrice};
    use pmb_core::{Outcome, PerOutcome, Price, TsMs};

    const START: i64 = 1_760_140_800_000;

    fn market() -> PluginMarket {
        PluginMarket::from_slug("btc-updown-15m-1760140800").unwrap()
    }

    fn request() -> PluginRequest {
        PluginRequest {
            time_window_volatility: Some(TimeWindowVolatilityConfig::new(
                [("1s", 1000)],
                VolPrice::Mid,
            )),
            technical_indicators: None,
            dwell_gate: Some(DwellGateConfig {
                from: Price::from_micros(400_000),
                to: Price::from_micros(600_000),
                required_ms: 500,
                track_price: BidOrAsk::Bid,
            }),
            time_window_gate: Some(TimeWindowGateConfig {
                allow_after_ms: 0,
                disable_after_ms: 1000,
            }),
        }
    }

    fn tick(ts: i64, synthetic: bool, bid: i64) -> PluginTick {
        let top = BookTop::new(
            Some(Price::from_micros(bid)),
            Some(Price::from_micros(bid + 20_000)),
        );
        PluginTick::new(TsMs(START + ts), synthetic, PerOutcome::new(top, top))
    }

    // spec: 14 §12.4 (synthetic ticks reach only plugins that declare them)
    #[test]
    fn synthetic_ticks_skip_volatility() {
        let mut set = PluginSet::new(&request()).unwrap();
        set.start_market(&market(), None).unwrap();
        set.on_tick(&tick(10, false, 500_000)).unwrap();
        let vol = set.view().time_window_volatility().unwrap().clone();
        let gen_vol = set.generation(PluginId::TimeWindowVolatility);
        assert!(set.on_tick(&tick(600, true, 500_000)).unwrap());
        assert_eq!(set.view().time_window_volatility().unwrap(), &vol);
        assert_eq!(set.generation(PluginId::TimeWindowVolatility), gen_vol);
        assert_eq!(
            set.view().time_window_gate().unwrap().now_ms,
            Some(TsMs(START + 600))
        );
        assert!(set.view().dwell_gate().unwrap().ok(Outcome::Up));
    }

    // spec: 14 P-13 (generations count visible changes only)
    #[test]
    fn generations_count_changes() {
        let mut set = PluginSet::new(&request()).unwrap();
        set.start_market(&market(), None).unwrap();
        assert_eq!(set.generation(PluginId::DwellGate), Some(0));
        assert_eq!(set.generation(PluginId::TechnicalIndicators), None);
        assert!(set.on_tick(&tick(10, false, 500_000)).unwrap());
        assert_eq!(set.combined_generation(), 1);
        // a synthetic tick at the same time and book: nothing visible changes
        // (a real one would add a volatility sample, n + 1)
        assert!(!set.on_tick(&tick(10, true, 500_000)).unwrap());
        assert_eq!(set.combined_generation(), 1);
        assert_eq!(set.generation(PluginId::DwellGate), Some(1));
        // same time, price leaves the dwell band; mid changes too
        assert!(set.on_tick(&tick(10, false, 700_000)).unwrap());
        assert_eq!(set.generation(PluginId::DwellGate), Some(2));
        assert_eq!(set.generation(PluginId::TimeWindowGate), Some(1));
        assert_eq!(set.generation(PluginId::TimeWindowVolatility), Some(2));
        assert_eq!(set.combined_generation(), 2);
        // a new market restarts generations
        set.start_market(&market(), None).unwrap();
        assert_eq!(set.combined_generation(), 0);
        assert_eq!(set.generation(PluginId::TimeWindowVolatility), Some(0));
        assert!(set
            .view()
            .time_window_volatility()
            .unwrap()
            .as_of_ts()
            .is_none());
    }

    // spec: 14 P-3, P-10 (TA input at market start; misuse is an engine error)
    #[test]
    fn start_market_contract() {
        let mut set = PluginSet::new(&request()).unwrap();
        assert_eq!(
            set.on_tick(&tick(0, false, 1)),
            Err(PluginError::NotStarted)
        );
        let input = TaInput { h1: &[], m15: &[] };
        assert_eq!(
            set.start_market(&market(), Some(input)),
            Err(PluginError::UnexpectedTaInput)
        );
        let mut ta = PluginSet::new(&PluginRequest {
            technical_indicators: Some(TechnicalIndicatorsConfig {}),
            ..PluginRequest::default()
        })
        .unwrap();
        assert!(ta.needs_ta_input());
        assert_eq!(
            ta.start_market(&market(), None),
            Err(PluginError::MissingTaInput)
        );
        let none: [Candle; 0] = [];
        ta.start_market(
            &market(),
            Some(TaInput {
                h1: &none,
                m15: &none,
            }),
        )
        .unwrap();
        assert!(matches!(
            ta.view().technical_indicators(),
            Some(TaOutput::Unavailable(
                crate::TaUnavailable::NotEnoughCandles { .. }
            ))
        ));
        // TA never changes on ticks
        assert!(!ta.on_tick(&tick(0, false, 500_000)).unwrap());
        assert_eq!(ta.generation(PluginId::TechnicalIndicators), Some(0));
    }

    // spec: 12 §6.4 (no plugins: empty set)
    #[test]
    fn empty_request() {
        let mut set = PluginSet::new(&PluginRequest::default()).unwrap();
        assert!(set.is_empty());
        set.start_market(&market(), None).unwrap();
        assert!(!set.on_tick(&tick(0, false, 500_000)).unwrap());
        assert!(set.view().dwell_gate().is_none());
    }

    // spec: 30 §10 (canonical config: window order does not matter)
    #[test]
    fn canonical_request_equality() {
        let a = TimeWindowVolatilityConfig::new([("5s", 5000), ("1s", 1000)], VolPrice::Mid);
        let b = TimeWindowVolatilityConfig::new([("1s", 1000), ("5s", 5000)], VolPrice::Mid);
        assert_eq!(a, b);
        let json = serde_json::to_string(&request()).unwrap();
        assert_eq!(
            json,
            r#"{"timeWindowVolatility":{"windows":{"1s":1000},"trackPrice":"mid"},"dwellGate":{"from":0.4,"to":0.6,"requiredMs":500,"trackPrice":"bid"},"timeWindowGate":{"allowAfterMs":0,"disableAfterMs":1000}}"#
        );
    }
}
