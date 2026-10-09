//! The plugin contract (14 §12.1) and the per-strategy-instance container.
//!
//! A [`PluginPool`] holds one instance per distinct canonical plugin config
//! of the candidates of a market read (14 P-6, 16 CG-3, 30 §16 S4); each
//! candidate reads its instances through a [`PluginHandle`]. A [`PluginSet`]
//! is the pool of a single strategy instance (candidate). Instances are
//! reset per market by `start_market` (14 P-3), updated once per tick by
//! `on_tick` (14 P-4, P-5: the engine decides which ticks reach them), and
//! read through `view`, which stays fixed until the next `on_tick`
//! (tick-scoped snapshot, 12 §6.4). Each instance carries a change
//! generation (14 P-13).

use crate::dwell_gate::{DwellGate, DwellGateConfig, DwellGateSnapshot};
use crate::technical_indicators::{
    ta_supported, TaInput, TaOutput, TaUnavailable, TechnicalIndicators, TechnicalIndicatorsConfig,
};
use crate::time_window_gate::{TimeWindowGate, TimeWindowGateConfig, TimeWindowGateSnapshot};
use crate::volatility::{TimeWindowVolatility, TimeWindowVolatilityConfig, VolatilitySnapshot};
use crate::{CandleInterval, PluginMarket, PluginTick};
use serde::Serialize;
use std::collections::BTreeMap;

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
    #[error("{field} is not a finite number of milliseconds within the i64 range")]
    MsNotFinite { field: &'static str },
}

/// Converts a TS-port millisecond threshold `x` (a double such as
/// `seconds * 1000`, which is often not an integer: `16.1 * 1000` is
/// 16100.000000000002) to the integer threshold that gives the same
/// decision for every integer elapsed time `e` (decision times are integer
/// ms, 12 §4.2): `e >= x` iff `e >= ceil(x)`, and `e <= x` iff
/// `e <= floor(x)`. Exact for |x| < 2^53.
pub(crate) fn ms_threshold(
    x: f64,
    round_up: bool,
    field: &'static str,
) -> Result<i64, ConfigError> {
    let r = if round_up { x.ceil() } else { x.floor() };
    // i64::MAX as f64 rounds up to 2^63, which is out of range.
    if !r.is_finite() || r < i64::MIN as f64 || r >= i64::MAX as f64 {
        return Err(ConfigError::MsNotFinite { field });
    }
    Ok(r as i64)
}

/// Engine-side misuse of the plugin set or malformed engine input. These are
/// engine faults, never data-driven absence (which is a typed unavailable
/// state, 14 P-7).
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum PluginError {
    #[error("technicalIndicators is requested for a BTC 15m market but no candles were supplied at market start")]
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

/// Read-only access to one candidate's tick-scoped snapshots (30 §5
/// `plugins()`). Unrequested plugins are `None`. A view borrows the
/// instances, which may be shared by several candidates (14 P-6, 16 CG-3).
#[derive(Copy, Clone, Debug)]
pub struct PluginsView<'a> {
    volatility: Option<&'a TimeWindowVolatility>,
    ta: Option<&'a TechnicalIndicators>,
    dwell: Option<&'a DwellGate>,
    gate: Option<&'a TimeWindowGate>,
}

impl<'a> PluginsView<'a> {
    pub fn time_window_volatility(&self) -> Option<&'a VolatilitySnapshot> {
        self.volatility.map(Plugin::snapshot)
    }

    pub fn technical_indicators(&self) -> Option<&'a TaOutput> {
        self.ta.map(Plugin::snapshot)
    }

    pub fn dwell_gate(&self) -> Option<&'a DwellGateSnapshot> {
        self.dwell.map(Plugin::snapshot)
    }

    pub fn time_window_gate(&self) -> Option<&'a TimeWindowGateSnapshot> {
        self.gate.map(Plugin::snapshot)
    }
}

/// Per-market plugin diagnostics for the engine's per-market report
/// (14 P-7, PF-7; 21 diagnostics).
///
/// Plugin time (PF-7) is measured by the engine around
/// [`PluginPool::start_market`] and [`PluginPool::on_tick`]: plugins read no
/// clock but the tick time (14 P-1), so this crate does not time itself.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct PluginDiagnostics {
    /// Why TA has no values for this market, when TA is requested and
    /// unavailable (14 P-7); count it under [`TaUnavailable::as_str`].
    pub ta_unavailable: Option<TaUnavailable>,
}

/// One plugin instance with its change generation (14 P-13).
#[derive(Clone, Debug)]
struct Instance<P> {
    plugin: P,
    generation: u64,
}

/// The distinct instances of one plugin kind, deduplicated by canonical
/// config (16 CG-3). Indices are stable for the pool's lifetime.
#[derive(Clone, Debug)]
struct Slots<C, P> {
    index: BTreeMap<C, u32>,
    items: Vec<Instance<P>>,
}

impl<C: Ord + Clone, P> Slots<C, P> {
    fn new() -> Self {
        Slots {
            index: BTreeMap::new(),
            items: Vec::new(),
        }
    }

    /// The slot of `cfg`, creating the instance on first use; `created` is
    /// set when a new instance was built.
    fn slot<E>(
        &mut self,
        cfg: &C,
        build: impl FnOnce(&C) -> Result<P, E>,
        created: &mut bool,
    ) -> Result<u32, E> {
        if let Some(&i) = self.index.get(cfg) {
            return Ok(i);
        }
        let i = u32::try_from(self.items.len()).expect("fewer than 2^32 plugin instances");
        self.items.push(Instance {
            plugin: build(cfg)?,
            generation: 0,
        });
        self.index.insert(cfg.clone(), i);
        *created = true;
        Ok(i)
    }

    #[inline]
    fn get(&self, i: Option<u32>) -> Option<&Instance<P>> {
        i.map(|i| &self.items[i as usize])
    }

    fn reset_generations(&mut self) {
        for it in &mut self.items {
            it.generation = 0;
        }
    }
}

impl<C, P: Plugin> Slots<C, P> {
    /// Observes one tick on every instance (14 P-4, §12.4).
    #[inline]
    fn observe(&mut self, tick: &PluginTick) -> bool {
        if tick.synthetic && !P::HANDLES_SYNTHETIC_TICKS {
            return false;
        }
        let mut any = false;
        for it in &mut self.items {
            let changed = it.plugin.on_tick(tick);
            it.generation += changed as u64;
            any |= changed;
        }
        any
    }
}

/// One candidate's plugins inside a [`PluginPool`]: an index per requested
/// plugin kind. Candidates with equal canonical configs get equal indices
/// and read the same instance (14 P-6).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct PluginHandle {
    vol: Option<u32>,
    ta: Option<u32>,
    dwell: Option<u32>,
    gate: Option<u32>,
}

impl PluginHandle {
    /// No plugin requested (12 §6.4).
    pub fn is_empty(&self) -> bool {
        self.vol.is_none() && self.ta.is_none() && self.dwell.is_none() && self.gate.is_none()
    }
}

/// The plugin instances of one market read, shared by the candidates that
/// request them (14 P-6, 16 CG-3, 30 §16 S4): one instance per distinct
/// canonical config, updated once per tick, read by every candidate through
/// its [`PluginHandle`]. A single candidate is the pool of a [`PluginSet`].
#[derive(Clone, Debug)]
pub struct PluginPool {
    vol: Slots<TimeWindowVolatilityConfig, TimeWindowVolatility>,
    ta: Slots<TechnicalIndicatorsConfig, TechnicalIndicators>,
    dwell: Slots<DwellGateConfig, DwellGate>,
    gate: Slots<TimeWindowGateConfig, TimeWindowGate>,
    diagnostics: PluginDiagnostics,
    started: bool,
}

impl Default for PluginPool {
    fn default() -> Self {
        PluginPool::new()
    }
}

impl PluginPool {
    pub fn new() -> PluginPool {
        PluginPool {
            vol: Slots::new(),
            ta: Slots::new(),
            dwell: Slots::new(),
            gate: Slots::new(),
            diagnostics: PluginDiagnostics::default(),
            started: false,
        }
    }

    /// Registers a candidate's request and returns its handle; equal configs
    /// reuse one instance. Every buffer is allocated here, so `on_tick` is
    /// allocation-free in steady state (14 §14). A request that creates a
    /// new instance requires a [`PluginPool::start_market`] before the next
    /// `on_tick` (14 P-3: instances start at market start).
    pub fn add(&mut self, req: &PluginRequest) -> Result<PluginHandle, ConfigError> {
        let mut created = false;
        let handle = PluginHandle {
            vol: req
                .time_window_volatility
                .as_ref()
                .map(|c| self.vol.slot(c, TimeWindowVolatility::new, &mut created))
                .transpose()?,
            ta: req
                .technical_indicators
                .as_ref()
                .map(|c| {
                    self.ta.slot(
                        c,
                        |c| Ok::<_, ConfigError>(TechnicalIndicators::new(c)),
                        &mut created,
                    )
                })
                .transpose()?,
            dwell: req
                .dwell_gate
                .as_ref()
                .map(|c| self.dwell.slot(c, DwellGate::new, &mut created))
                .transpose()?,
            gate: req
                .time_window_gate
                .as_ref()
                .map(|c| {
                    self.gate.slot(
                        c,
                        |c| Ok::<_, ConfigError>(TimeWindowGate::new(c)),
                        &mut created,
                    )
                })
                .transpose()?,
        };
        if created {
            self.started = false;
        }
        Ok(handle)
    }

    /// Number of distinct instances (computed once per tick each, CG-3).
    pub fn instance_count(&self) -> usize {
        self.vol.items.len() + self.ta.items.len() + self.dwell.items.len() + self.gate.items.len()
    }

    /// Whether `start_market` needs TA candles for this market: TA is
    /// requested and the market is supported (14 P-11, P-12).
    pub fn needs_ta_input(&self, market: &PluginMarket) -> bool {
        !self.ta.items.is_empty() && ta_supported(market)
    }

    /// Resets every instance for a new market (14 P-3) and computes TA once
    /// per distinct config from the supplied candles (14 P-10). Generations
    /// restart at 0.
    ///
    /// `ta` is required iff [`PluginPool::needs_ta_input`]; candles for an
    /// unsupported market are ignored. On error nothing of the previous
    /// market survives: the pool stays unstarted, so `on_tick` fails
    /// (00 R14) until a successful `start_market`.
    pub fn start_market(
        &mut self,
        market: &PluginMarket,
        ta: Option<TaInput<'_>>,
    ) -> Result<PluginDiagnostics, PluginError> {
        self.started = false;
        self.diagnostics = PluginDiagnostics::default();
        for it in &mut self.vol.items {
            it.plugin.start_market();
        }
        for it in &mut self.dwell.items {
            it.plugin.start_market();
        }
        for it in &mut self.gate.items {
            it.plugin.start_market(market);
        }
        self.vol.reset_generations();
        self.ta.reset_generations();
        self.dwell.reset_generations();
        self.gate.reset_generations();
        if self.ta.items.is_empty() {
            if ta.is_some() {
                return Err(PluginError::UnexpectedTaInput);
            }
        } else {
            for it in &mut self.ta.items {
                it.plugin.start_market(market, ta)?;
                if let TaOutput::Unavailable(reason) = it.plugin.snapshot() {
                    self.diagnostics.ta_unavailable = Some(*reason);
                }
            }
        }
        self.started = true;
        Ok(self.diagnostics)
    }

    /// Observes one tick (14 P-4) on every distinct instance once; synthetic
    /// ticks reach only the plugins that declare them (14 §12.4). Returns
    /// `true` iff any instance's snapshot changed.
    pub fn on_tick(&mut self, tick: &PluginTick) -> Result<bool, PluginError> {
        if !self.started {
            return Err(PluginError::NotStarted);
        }
        let mut changed = self.vol.observe(tick);
        changed |= self.ta.observe(tick);
        changed |= self.dwell.observe(tick);
        changed |= self.gate.observe(tick);
        Ok(changed)
    }

    /// One candidate's tick-scoped snapshots (12 §6.4).
    #[inline]
    pub fn view(&self, h: PluginHandle) -> PluginsView<'_> {
        PluginsView {
            volatility: self.vol.get(h.vol).map(|i| &i.plugin),
            ta: self.ta.get(h.ta).map(|i| &i.plugin),
            dwell: self.dwell.get(h.dwell).map(|i| &i.plugin),
            gate: self.gate.get(h.gate).map(|i| &i.plugin),
        }
    }

    /// Change generation of one of the candidate's plugins (14 P-13); `None`
    /// if not requested.
    pub fn generation(&self, h: PluginHandle, id: PluginId) -> Option<u64> {
        match id {
            PluginId::TimeWindowVolatility => self.vol.get(h.vol).map(|i| i.generation),
            PluginId::TechnicalIndicators => self.ta.get(h.ta).map(|i| i.generation),
            PluginId::DwellGate => self.dwell.get(h.dwell).map(|i| i.generation),
            PluginId::TimeWindowGate => self.gate.get(h.gate).map(|i| i.generation),
        }
    }

    /// The candidate's single dirty counter (16 TF-2 (e), TF-7): the sum of
    /// its plugins' generations, which changes exactly when one of its
    /// plugins' outputs changed.
    #[inline]
    pub fn combined_generation(&self, h: PluginHandle) -> u64 {
        PluginId::ALL
            .iter()
            .filter_map(|&id| self.generation(h, id))
            .sum()
    }

    /// Diagnostics of the current market (14 P-7).
    pub fn diagnostics(&self) -> PluginDiagnostics {
        self.diagnostics
    }
}

/// The plugins of one strategy instance (14 P-3): a [`PluginPool`] with a
/// single candidate.
#[derive(Clone, Debug)]
pub struct PluginSet {
    pool: PluginPool,
    handle: PluginHandle,
}

impl PluginSet {
    /// Builds the requested plugins (see [`PluginPool::add`]).
    pub fn new(req: &PluginRequest) -> Result<PluginSet, ConfigError> {
        let mut pool = PluginPool::new();
        let handle = pool.add(req)?;
        Ok(PluginSet { pool, handle })
    }

    /// No plugin requested: the snapshot step costs nothing (12 §6.4).
    pub fn is_empty(&self) -> bool {
        self.handle.is_empty()
    }

    /// See [`PluginPool::needs_ta_input`].
    pub fn needs_ta_input(&self, market: &PluginMarket) -> bool {
        self.pool.needs_ta_input(market)
    }

    /// See [`PluginPool::start_market`].
    pub fn start_market(
        &mut self,
        market: &PluginMarket,
        ta: Option<TaInput<'_>>,
    ) -> Result<PluginDiagnostics, PluginError> {
        self.pool.start_market(market, ta)
    }

    /// See [`PluginPool::on_tick`].
    pub fn on_tick(&mut self, tick: &PluginTick) -> Result<bool, PluginError> {
        self.pool.on_tick(tick)
    }

    /// The tick-scoped snapshots (12 §6.4).
    #[inline]
    pub fn view(&self) -> PluginsView<'_> {
        self.pool.view(self.handle)
    }

    /// See [`PluginPool::generation`].
    pub fn generation(&self, id: PluginId) -> Option<u64> {
        self.pool.generation(self.handle, id)
    }

    /// See [`PluginPool::combined_generation`].
    #[inline]
    pub fn combined_generation(&self) -> u64 {
        self.pool.combined_generation(self.handle)
    }

    /// See [`PluginPool::diagnostics`].
    pub fn diagnostics(&self) -> PluginDiagnostics {
        self.pool.diagnostics()
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

    // spec: 14 P-13 (generations count visible changes only); 16 TF-2 (e),
    // TF-7 (the combined counter changes iff any requested plugin changed)
    #[test]
    fn generations_count_changes() {
        let mut set = PluginSet::new(&request()).unwrap();
        set.start_market(&market(), None).unwrap();
        assert_eq!(set.generation(PluginId::DwellGate), Some(0));
        assert_eq!(set.generation(PluginId::TechnicalIndicators), None);
        assert!(set.on_tick(&tick(10, false, 500_000)).unwrap());
        let c1 = set.combined_generation();
        assert!(c1 > 0);
        // a synthetic tick at the same time and book: nothing visible changes
        // (a real one would add a volatility sample, n + 1)
        assert!(!set.on_tick(&tick(10, true, 500_000)).unwrap());
        assert_eq!(set.combined_generation(), c1);
        assert_eq!(set.generation(PluginId::DwellGate), Some(1));
        // same time, price leaves the dwell band; mid changes too
        assert!(set.on_tick(&tick(10, false, 700_000)).unwrap());
        assert_eq!(set.generation(PluginId::DwellGate), Some(2));
        assert_eq!(set.generation(PluginId::TimeWindowGate), Some(1));
        assert_eq!(set.generation(PluginId::TimeWindowVolatility), Some(2));
        assert_eq!(set.combined_generation(), 2 + 1 + 2);
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

    fn ta_request() -> PluginRequest {
        PluginRequest {
            technical_indicators: Some(TechnicalIndicatorsConfig {}),
            ..PluginRequest::default()
        }
    }

    // spec: 14 P-3, P-10, P-11 (TA input at market start; misuse is an
    // engine error, 00 R14), P-7 (the unavailable reason is reported)
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
        let mut ta = PluginSet::new(&ta_request()).unwrap();
        assert!(ta.needs_ta_input(&market()));
        assert_eq!(
            ta.start_market(&market(), None),
            Err(PluginError::MissingTaInput)
        );
        let none: [Candle; 0] = [];
        let diag = ta
            .start_market(
                &market(),
                Some(TaInput {
                    h1: &none,
                    m15: &none,
                }),
            )
            .unwrap();
        let reason = crate::TaUnavailable::NotEnoughCandles {
            interval: CandleInterval::H1,
            have: 0,
            need: 160,
        };
        assert_eq!(diag.ta_unavailable, Some(reason));
        assert_eq!(ta.diagnostics().ta_unavailable, Some(reason));
        assert_eq!(
            ta.view().technical_indicators(),
            Some(&TaOutput::Unavailable(reason))
        );
        // TA never changes on ticks
        assert!(!ta.on_tick(&tick(0, false, 500_000)).unwrap());
        assert_eq!(ta.generation(PluginId::TechnicalIndicators), Some(0));
    }

    // spec: 14 P-11, P-12 (a 5m market needs no TA candles)
    #[test]
    fn unsupported_market_needs_no_candles() {
        let m5 = PluginMarket::from_slug("btc-updown-5m-1760140800").unwrap();
        let mut ta = PluginSet::new(&ta_request()).unwrap();
        assert!(!ta.needs_ta_input(&m5));
        let diag = ta.start_market(&m5, None).unwrap();
        assert_eq!(
            diag.ta_unavailable,
            Some(crate::TaUnavailable::UnsupportedMarket)
        );
        assert!(!ta.on_tick(&tick(0, false, 500_000)).unwrap());
    }

    // spec: 14 P-3, 00 R14 (a failed market start keeps nothing of the
    // previous market: the set is unstarted until a successful start)
    #[test]
    fn failed_start_leaves_no_previous_market_state() {
        let mut req = request();
        req.technical_indicators = Some(TechnicalIndicatorsConfig {});
        let mut set = PluginSet::new(&req).unwrap();
        let m5 = PluginMarket::from_slug("btc-updown-5m-1760140800").unwrap();
        set.start_market(&m5, None).unwrap();
        set.on_tick(&tick(10, false, 500_000)).unwrap();
        assert!(set.view().dwell_gate().unwrap().side(Outcome::Up).in_range);
        // the next market fails to start (no candles for a BTC 15m market)
        assert_eq!(
            set.start_market(&market(), None),
            Err(PluginError::MissingTaInput)
        );
        assert_eq!(
            set.on_tick(&tick(20, false, 500_000)),
            Err(PluginError::NotStarted)
        );
        let v = set.view();
        assert!(v.time_window_volatility().unwrap().as_of_ts().is_none());
        assert!(!v.dwell_gate().unwrap().side(Outcome::Up).in_range);
        assert_eq!(v.time_window_gate().unwrap().now_ms, None);
        assert_eq!(
            v.technical_indicators(),
            Some(&TaOutput::Unavailable(crate::TaUnavailable::NotStarted))
        );
        // malformed candles fail the same way
        let mut bad = vec![
            Candle {
                open_time: TsMs(0),
                close_time: TsMs(3_599_999),
                open: 1.0,
                high: 1.0,
                low: 1.0,
                close: 1.0,
                volume: 1.0,
            };
            2
        ];
        bad[1].open_time = TsMs(0);
        assert_eq!(
            set.start_market(&market(), Some(TaInput { h1: &bad, m15: &[] })),
            Err(PluginError::CandleOrder {
                interval: CandleInterval::H1,
                index: 1
            })
        );
        assert_eq!(
            set.on_tick(&tick(20, false, 500_000)),
            Err(PluginError::NotStarted)
        );
    }

    // spec: 16 CG-3, 30 §16 S4, 14 P-6 (one instance per distinct canonical
    // config; candidates with equal configs share it)
    #[test]
    fn pool_deduplicates_by_canonical_config() {
        let mut pool = PluginPool::new();
        let a = pool.add(&request()).unwrap();
        let mut other = request();
        other.dwell_gate.as_mut().unwrap().required_ms = 900;
        let b = pool.add(&other).unwrap();
        let c = pool.add(&request()).unwrap();
        assert_eq!(a, c);
        assert_ne!(a, b);
        // volatility and gate shared, two dwell instances
        assert_eq!(pool.instance_count(), 4);
        assert!(pool.add(&PluginRequest::default()).unwrap().is_empty());
        pool.start_market(&market(), None).unwrap();
        pool.on_tick(&tick(10, false, 500_000)).unwrap();
        assert!(std::ptr::eq(
            pool.view(a).time_window_volatility().unwrap(),
            pool.view(b).time_window_volatility().unwrap()
        ));
        // a new distinct config after the start needs a new market start
        let mut third = request();
        third.time_window_gate = None;
        third.dwell_gate.as_mut().unwrap().required_ms = 1;
        pool.add(&third).unwrap();
        assert_eq!(
            pool.on_tick(&tick(20, false, 500_000)),
            Err(PluginError::NotStarted)
        );
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
