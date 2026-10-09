//! The market session (12 §2.1, §5, §10): the unit of determinism.
//!
//! `Session<S, E, T>` is generic over the strategy, the execution adapter
//! and the trace sink (12 §14 P6, 30 §4 rule 1): the hot loop is
//! monomorphized in the strategy's bin crate. A session owns all its state
//! and is `Send`; it holds no references into `SharedMarket` across steps
//! (12 §2.1).

use std::panic::{catch_unwind, AssertUnwindSafe};

use pmb_core::ids::CidInterner;
use pmb_core::order::MetaStore;
use pmb_core::rules::ExchangeRules;
use pmb_core::{FinalOutcome, MarketEvent, Outcome, PerOutcome, TsMs};

use crate::clock::{Clocks, DecisionOrigin};
use crate::config::{EngineConfig, RunMode};
use crate::core_rules::CoreRules;
use crate::envelope::{Control, Envelope, GuardTrip, OperatorCommand, Payload, SyntheticKind};
use crate::exec::{CancelScope, EventQueue, ExecCtx, Execution};
use crate::feeds_view::FeedsView;
use crate::ledger::Ledger;
use crate::om::{EngineIntent, Halt, OmIo, OrderManager};
use crate::plugins_view::PluginSet;
use crate::shared::SharedMarket;
use crate::stats::{FinalStats, MarketStatsAcc};
use crate::strategy::{
    BookView, Ctx, Intents, Interests, PortfolioView, RulesView, Strategy, TickCause, TickInfo,
    TickInterest,
};
use crate::trace::{TraceEvent, TraceSink};
use crate::window::{SessionState, WindowGate, WindowRule};

/// Cause of a candidate failure (20 §4.1, 30 §12, 12 §6.3, §11).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StrategyFaultCause {
    /// A panic in a callback or `new` (12 §11); message captured by the hook.
    Panic {
        /// Panic message.
        message: String,
    },
    /// `Err(StrategyError)` returned (30 §12).
    Error {
        /// Error message.
        message: String,
    },
    /// Cascade budget exceeded (12 §6.3).
    CascadeLimit {
        /// Envelope seq.
        seq: u64,
        /// Strategy-tick seq.
        tick: u64,
        /// Deliveries in the drain.
        deliveries: u32,
    },
    /// `intentMeta` over its per-market caps (21 §16).
    IntentMetaLimit,
}

/// Why a session stopped (12 §11): a candidate failure or an engine fault.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SessionFault {
    /// `strategy_fault`: this candidate stops and emits no `MarketStats`;
    /// other candidates continue (12 §6.3, §11, 21 §13).
    Strategy {
        /// Cause.
        cause: StrategyFaultCause,
        /// Callback kind (`onMarketTick`, `onAccountEvent`, `new`).
        callback: &'static str,
        /// Strategy-tick seq at the fault.
        tick_seq: u64,
        /// Loop time at the fault.
        at: TsMs,
    },
    /// `engine_fault`: overflow in engine code or a ledger invariant
    /// violation; never continue silently (12 §11).
    Engine {
        /// One line naming the violated rule.
        message: String,
    },
}

/// The per-market result of a session (21 §11, D11).
#[derive(Clone, Debug)]
pub struct SessionOutput {
    /// Unrounded final values.
    pub stats: FinalStats,
    /// Tick counters and capital-aware counters.
    pub acc: MarketStatsAcc,
    /// The session meta store; `stats.intent_meta` ids index it (21 §16).
    pub metas: MetaStore,
    /// Engine and adapter diagnostics for `diagnostics.anomalies` (21 §10;
    /// 12 §14 P12); never part of the deterministic section.
    pub diagnostics: SessionDiagnostics,
}

/// The always-on engine counters of one session that 21 §10 places under
/// `diagnostics.anomalies` (12 §7.6, §9.3–§9.5, §14 P12; 13 §2.2), plus the
/// final exchange-time skew (21 §10 `skewMs`, 12 §4.4 XT4).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionDiagnostics {
    /// Ledger counters (`oversold_qty`, `reservation_dust`,
    /// `reversal_deficit`).
    pub ledger: crate::ledger::LedgerCounters,
    /// Placements dropped as duplicates of an active cid (12 §7.6).
    pub duplicate_active_cid: u64,
    /// The execution adapter's diagnostics.
    pub exec: crate::exec::ExecDiagnostics,
    /// Final exchange-time skew (12 §4.4), if one was observed.
    pub skew_ms: Option<i64>,
}

/// Per-market `intentMeta` caps (21 §16): 10,000 entries, 1 MiB.
const INTENT_META_MAX_ENTRIES: usize = 10_000;
const INTENT_META_MAX_BYTES: usize = 1024 * 1024;

/// One (market, candidate, profile, seed) session (12 §2.1).
pub struct Session<S: Strategy, E: Execution, T: TraceSink> {
    /// `None` after a fault: the strategy is never called again (12 §11).
    pub(crate) strategy: Option<S>,
    pub(crate) interests: Interests,
    pub(crate) exec: E,
    pub(crate) trace: T,
    pub(crate) config: EngineConfig,
    pub(crate) om: OrderManager,
    pub(crate) ledger: Ledger,
    pub(crate) cids: CidInterner,
    pub(crate) metas: MetaStore,
    pub(crate) queue: EventQueue,
    /// Engine-owned, reused intent buffer (12 §6.1).
    pub(crate) intents: Intents,
    pub(crate) clocks: Clocks,
    pub(crate) window: WindowGate,
    pub(crate) state: SessionState,
    /// `SessionStart{observe_only}` (12 §10).
    pub(crate) observe_only: bool,
    /// Last dispatched strategy tick (12 §6.5).
    pub(crate) last_tick: Option<TickInfo>,
    /// Next 0-based strategy-tick index (22 §3.3).
    pub(crate) next_tick_seq: u64,
    /// Seq of the envelope being stepped (12 §6.3 `cascade_limit` detail).
    pub(crate) env_seq: u64,
    /// Plugin set (14 P-3). Stand-in until `pmb-plugins` lands.
    pub(crate) plugins: PluginSet,
    /// Feed view of the last dispatched tick (12 §6.4). Stand-in until
    /// `pmb-feeds` lands.
    pub(crate) feeds_view: FeedsView,
    /// An account event was delivered since the last `on_tick` (16 TF-2 (c)).
    pub(crate) delivered_since_tick: bool,
    /// `on_tick` was called at least once (16 TF-2 (a)).
    pub(crate) woke_once: bool,
    /// Feed and plugin generations seen by the last `on_tick` (16 TF-2 (d),
    /// (e); 14 P-13).
    pub(crate) seen_generations: (u64, u64),
    pub(crate) stats: MarketStatsAcc,
    pub(crate) fault: Option<SessionFault>,
    /// Strategy calls stopped by a kill switch (12 §8.3, 50 §10.4): events
    /// are still applied, the strategy is never called again.
    pub(crate) calls_stopped: bool,
    /// Paper strategy faults (12 §11, D32).
    pub(crate) strategy_halts: Vec<SessionFault>,
    /// Feed high-water `H` (14 F-7).
    pub(crate) feed_hw: Option<TsMs>,
}

/// Runs strategy code inside `catch_unwind` (12 §11, 30 §12); the panic
/// message is returned as text.
fn guarded<R>(f: impl FnOnce() -> R) -> Result<R, String> {
    catch_unwind(AssertUnwindSafe(f)).map_err(|payload| {
        if let Some(s) = payload.downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
        } else if let Some(o) = payload.downcast_ref::<pmb_core::Overflow>() {
            o.to_string()
        } else {
            "non-string panic payload".to_string()
        }
    })
}

/// The rules the strategy and the OM see (12 §6.5 `rules()`): the fixed
/// ts-compat rules of 11 §4 (TC-C1) or the rules in force.
fn effective_rules(rules: CoreRules, market: &SharedMarket) -> ExchangeRules {
    match rules {
        CoreRules::TsCompat => ExchangeRules::ts_compat(),
        CoreRules::Realistic => market.rules,
    }
}

/// Builds the callback context: borrows only (12 §6.1, §6.5; 30 §5).
#[allow(clippy::too_many_arguments)]
fn make_ctx<'a>(
    now: TsMs,
    tick: &'a TickInfo,
    event_clock: TsMs,
    market: &'a SharedMarket,
    overlay: Option<&'a crate::exec::BookOverlay>,
    portfolio: PortfolioView<'a>,
    feeds: &'a FeedsView,
    plugins: &'a crate::plugins_view::PluginsView,
    rules: &'a RulesView,
) -> Ctx<'a> {
    let ts_compat = rules.ts_compat;
    let book = |o: Outcome| BookView {
        outcome: o,
        recorded: market.books.get(o),
        overlay,
        updated_at: market.book_updated_at[o].unwrap_or(TsMs(0)),
        // 12 §5.2: ts-compat follows TS and has no stale state.
        stale: !ts_compat && market.stale[o],
    };
    Ctx::new(
        now,
        tick,
        event_clock,
        &market.info,
        PerOutcome::new(book(Outcome::Up), book(Outcome::Down)),
        portfolio,
        feeds,
        plugins,
        rules,
    )
}

impl<S: Strategy, E: Execution, T: TraceSink> Session<S, E, T> {
    /// Creates the session and the strategy instance, exactly once, inside
    /// `catch_unwind` (12 §6.1, §11; 30 §4 rule 4).
    pub fn new(
        params: &S::Params,
        market: &SharedMarket,
        config: EngineConfig,
        exec: E,
        trace: T,
    ) -> Result<Self, SessionFault> {
        let fault = |message: String| SessionFault::Strategy {
            cause: StrategyFaultCause::Panic { message },
            callback: "new",
            tick_seq: 0,
            at: TsMs(0),
        };
        // 30 §4 rule 3: requirements are evaluated once, before the
        // instance. STAND-IN: `Requirements` carries nothing until pmb-feeds
        // and pmb-plugins land; a panic in it fails this candidate only.
        let _requirements = guarded(|| S::requirements(params)).map_err(fault)?;
        let interests = guarded(|| S::interests(params)).map_err(fault)?;
        let strategy = guarded(|| S::new(params, &market.info)).map_err(fault)?;
        let rules = config.core_rules;
        if config.run_mode == RunMode::Paper && rules != CoreRules::Realistic {
            // D28: paper runs the realistic rules (R14: never a silent mix).
            return Err(SessionFault::Engine {
                message: "paper run mode with the ts-compat rules (D28)".into(),
            });
        }
        let window = WindowGate {
            rule: WindowRule::select(rules, config.input_mode),
            window: market.window(),
        };
        let state = match rules {
            // TC-C9: ts-compat has no lifecycle beyond its window gate.
            CoreRules::TsCompat => SessionState::Active,
            CoreRules::Realistic => SessionState::Warming,
        };
        let queue = EventQueue::new(T::ENABLED && trace.wants_exec_records());
        Ok(Session {
            strategy: Some(strategy),
            interests,
            exec,
            trace,
            ledger: Ledger::new(rules, config.starting_capital),
            config,
            om: OrderManager::new(),
            cids: CidInterner::new(),
            metas: MetaStore::new(),
            queue,
            intents: Intents::new(),
            clocks: Clocks::new(TsMs(0)),
            window,
            state,
            observe_only: false,
            last_tick: None,
            next_tick_seq: 0,
            env_seq: 0,
            plugins: PluginSet::default(),
            feeds_view: FeedsView::default(),
            delivered_since_tick: false,
            woke_once: false,
            seen_generations: (0, 0),
            stats: MarketStatsAcc::default(),
            fault: None,
            calls_stopped: false,
            strategy_halts: Vec::new(),
            feed_hw: None,
        })
    }

    /// The ledger (read-only; tests and the binary's output stage).
    pub fn ledger(&self) -> &Ledger {
        &self.ledger
    }

    /// The execution adapter (read-only).
    pub fn exec(&self) -> &E {
        &self.exec
    }

    /// The trace sink.
    pub fn trace(&self) -> &T {
        &self.trace
    }

    /// The session cid interner (resolves `CidKey`s at I/O).
    pub fn cids(&self) -> &CidInterner {
        &self.cids
    }

    /// Per-market accumulation so far.
    pub fn stats(&self) -> &MarketStatsAcc {
        &self.stats
    }

    /// The order manager (counters, halt state).
    pub fn om(&self) -> &OrderManager {
        &self.om
    }

    /// The session clocks.
    pub fn clocks(&self) -> &Clocks {
        &self.clocks
    }

    pub(crate) fn engine_fault(&mut self, message: String) -> SessionFault {
        let f = SessionFault::Engine { message };
        self.fault = Some(f.clone());
        self.drop_strategy();
        f
    }

    /// Drops the strategy instance inside `catch_unwind` (30 §12: the
    /// instance is poisoned and dropped there), so a panicking `Drop` in
    /// strategy code fails only this candidate, never the driver.
    fn drop_strategy(&mut self) {
        if let Some(s) = self.strategy.take() {
            // A panic from the drop is ignored: the fault that caused the
            // drop is already recorded.
            let _ = guarded(move || drop(s));
        }
    }

    /// A strategy fault (12 §6.3, §11). The strategy object is never called
    /// again and placements are rejected `StrategyHalted`.
    ///
    /// - Backtest: the candidate stops; the fault is returned and kept.
    /// - Paper (D32): an engine-originated `CancelMarket{Market}` with cause
    ///   `StrategyPanic` goes through the OM, the fault is recorded as an
    ///   alert ([`Session::strategy_halts`]) and the session keeps stepping:
    ///   queued and later events are applied without callbacks (10 S5).
    pub(crate) fn strategy_fault(
        &mut self,
        cause: StrategyFaultCause,
        callback: &'static str,
        market: &SharedMarket,
    ) -> Result<(), SessionFault> {
        let f = SessionFault::Strategy {
            cause,
            callback,
            tick_seq: self.last_tick.map_or(0, |t| t.seq),
            at: self.clocks.now,
        };
        self.drop_strategy();
        self.om.set_halt(Halt::StrategyHalted);
        // Intents of the faulted callback are never handled.
        self.intents.clear();
        match self.config.run_mode {
            RunMode::Backtest => {
                self.fault = Some(f.clone());
                Err(f)
            }
            RunMode::Paper => {
                self.strategy_halts.push(f);
                self.handle_engine(
                    EngineIntent::CancelMarket {
                        scope: CancelScope::Market,
                        cause: pmb_core::event::CancelCause::StrategyPanic,
                    },
                    market,
                );
                Ok(())
            }
        }
    }

    /// Paper strategy faults recorded as alerts (12 §11 paper column, D32);
    /// always empty in backtest, where a fault stops the candidate.
    pub fn strategy_halts(&self) -> &[SessionFault] {
        &self.strategy_halts
    }

    /// Forwards the adapter's lifecycle records to the sink (22 §2, 13 §4.3).
    pub(crate) fn forward_exec_trace(&mut self) {
        if T::ENABLED && self.queue.wants_trace() {
            let trace = &mut self.trace;
            for rec in self.queue.drain_trace() {
                trace.record(&TraceEvent::Exec(&rec));
            }
        }
    }

    /// Whether strategy callbacks may run by rule (12 §5.4, §10, §8.3): the
    /// session is `Active` and no kill switch stopped strategy calls.
    /// Deliveries with no callback by rule do not count against the cascade
    /// budget (D69 A-08).
    #[inline]
    pub(crate) fn callbacks_allowed(&self) -> bool {
        self.state.callbacks_enabled() && !self.calls_stopped
    }

    #[inline]
    fn tick_seq(&self) -> u64 {
        self.last_tick.map_or(0, |t| t.seq)
    }

    /// Processes one envelope after the driver applied it to `market`
    /// (12 §5.1): (a) scheduled actions due strictly before `env.at`, one
    /// cascade per due time; then the payload.
    pub fn step(&mut self, env: &Envelope<'_>, market: &SharedMarket) -> Result<(), SessionFault> {
        if let Some(f) = &self.fault {
            return Err(f.clone());
        }
        self.env_seq = env.seq;
        // (a) Inputs stamped T run before actions due at T (strict "<").
        while let Some(t) = self.exec.next_due() {
            if t >= env.at {
                break;
            }
            self.run_due(t, market)?;
        }
        self.clocks.advance(env.at);
        self.update_lifecycle();
        match env.payload {
            Payload::Market(ev) => self.on_market(env, &ev, market),
            Payload::SyntheticTick(k) => self.on_synthetic(env, k, market),
            // Feed state was updated by the driver; no tick (12 §3.2).
            Payload::Feed(_) => Ok(()),
            Payload::Account(input) => {
                let cx = ExecCtx {
                    market,
                    ledger: &self.ledger,
                    config: &self.config,
                };
                self.exec
                    .on_account_input(self.clocks.now, input, &cx, &mut self.queue);
                self.forward_exec_trace();
                self.drain(market)
            }
            Payload::Timer(t) => {
                let cx = ExecCtx {
                    market,
                    ledger: &self.ledger,
                    config: &self.config,
                };
                self.exec.on_timer(&t, &cx, &mut self.queue);
                self.forward_exec_trace();
                self.drain(market)
            }
            Payload::Control(c) => self.on_control(c, market),
        }
    }

    /// Runs every scheduled action due at `t` as one cascade (12 §5.1, K2).
    fn run_due(&mut self, t: TsMs, market: &SharedMarket) -> Result<(), SessionFault> {
        self.clocks.advance(t);
        let cx = ExecCtx {
            market,
            ledger: &self.ledger,
            config: &self.config,
        };
        self.exec.run_next_due(&cx, &mut self.queue);
        self.forward_exec_trace();
        if self.exec.next_due() == Some(t) {
            // 13 §2.2: `run_next_due` executes every action due at `t`.
            return Err(self.engine_fault(format!(
                "execution left actions due at {t} after run_next_due"
            )));
        }
        self.drain(market)
    }

    /// Realistic lifecycle (12 §10): `Warming` becomes `Active` at
    /// `now ≥ start` unless the session is observe-only.
    fn update_lifecycle(&mut self) {
        if self.state == SessionState::Warming
            && !self.observe_only
            && self.clocks.now >= self.window.window.start_ms
            && self.clocks.now < self.window.window.end_ms
        {
            self.state = SessionState::Active;
        }
    }

    /// Strategy-visible tick time of an input (12 §4.1, §4.2): realistic
    /// `now`; ts-compat the TS tick timestamp — the exchange ts of a real
    /// event, the envelope stamp `S` of a synthetic tick (TC-C11).
    fn tick_time(&self, env: &Envelope<'_>, synthetic: bool) -> TsMs {
        match self.config.core_rules {
            CoreRules::Realistic => self.clocks.now,
            // TC-C11: the TS tick timestamp (synthetic clamp `S`, real `E`).
            CoreRules::TsCompat if synthetic => env.at,
            CoreRules::TsCompat => env.exchange_ts.unwrap_or(env.at),
        }
    }

    /// The window gate of the profile (12 §5.4).
    fn passes_gate(&self, tick_ts: TsMs) -> bool {
        match self.config.core_rules {
            // TC-C9: the TS gate per input mode, on the TS tick time.
            CoreRules::TsCompat => self.window.in_window(tick_ts, self.clocks.now),
            CoreRules::Realistic => {
                self.callbacks_allowed() && self.window.in_window(tick_ts, self.clocks.now)
            }
        }
    }

    /// Market events (12 §5.2).
    fn on_market(
        &mut self,
        env: &Envelope<'_>,
        ev: &MarketEvent<'_>,
        market: &SharedMarket,
    ) -> Result<(), SessionFault> {
        let cause = match ev {
            MarketEvent::Book { .. } => Some(TickCause::Book),
            MarketEvent::PriceChange { .. } => Some(TickCause::PriceChange),
            _ => None,
        };
        // Counted BEFORE the gate (21 §15).
        if let Some(c) = cause {
            self.stats.ticks.record(c);
        }
        let rules = self.config.core_rules;
        let tick_ts = self.tick_time(env, false);
        let stale = rules == CoreRules::Realistic && market.last_apply.stale_book;
        let dispatch = cause.is_some() && !stale && self.passes_gate(tick_ts);
        if let (true, Some(c)) = (dispatch, cause) {
            let vts = self.feed_clock_of(env, false, tick_ts);
            self.begin_tick(c, false, env.exchange_ts, tick_ts, vts);
        }
        match rules {
            CoreRules::TsCompat => {
                // TC-C9: out of window the execution model is frozen.
                if !dispatch {
                    return Ok(());
                }
                let cx = ExecCtx {
                    market,
                    ledger: &self.ledger,
                    config: &self.config,
                };
                // ARCHITECTURE.md D-PENDING (time argument): the TS tick ts.
                self.exec.on_market_event(tick_ts, ev, &cx, &mut self.queue);
            }
            CoreRules::Realistic => {
                if let (Some(c), SessionState::Warming) = (cause, self.state) {
                    // D23, 14 P-5: plugins observe pre-window ticks.
                    let warm = TickInfo {
                        seq: self.next_tick_seq,
                        cause: c,
                        synthetic: false,
                        exchange_ts: env.exchange_ts,
                    };
                    self.plugins.on_tick(&warm, market);
                }
                let cx = ExecCtx {
                    market,
                    ledger: &self.ledger,
                    config: &self.config,
                };
                self.exec
                    .on_market_event(self.clocks.now, ev, &cx, &mut self.queue);
            }
        }
        self.forward_exec_trace();
        self.drain(market)?;
        if dispatch {
            self.run_strategy_tick(market)?;
        }
        Ok(())
    }

    /// Synthetic feed ticks (12 §5.3): counted, gated, never run the
    /// execution model (14 F-36).
    fn on_synthetic(
        &mut self,
        env: &Envelope<'_>,
        k: SyntheticKind,
        market: &SharedMarket,
    ) -> Result<(), SessionFault> {
        let cause = match k {
            SyntheticKind::BinanceAggTrade => TickCause::BinanceAggTrade,
            SyntheticKind::ChainlinkRound => TickCause::ChainlinkRound,
        };
        self.stats.ticks.record(cause);
        let tick_ts = self.tick_time(env, true);
        if !self.passes_gate(tick_ts) {
            return Ok(());
        }
        let vts = self.feed_clock_of(env, true, tick_ts);
        self.begin_tick(cause, true, env.exchange_ts, tick_ts, vts);
        self.run_strategy_tick(market)
    }

    /// The feed clock `C(t)` of a dispatched tick (12 §4.1 column "Feed
    /// clock", K5; 14 §3.1): ts-compat telonex-delta real tick `max(L, E)`
    /// with the Telonex local time `L > 0`, else `E`; ts-compat synthetic
    /// tick its stamp `S`; ts-compat recorder-v4 the receipt order (`at`);
    /// realistic `now`.
    fn feed_clock_of(&self, env: &Envelope<'_>, synthetic: bool, tick_ts: TsMs) -> TsMs {
        match self.config.core_rules {
            CoreRules::Realistic => self.clocks.now,
            CoreRules::TsCompat if synthetic => tick_ts,
            CoreRules::TsCompat => match self.config.input_mode {
                pmb_contract::vocab::InputMode::TelonexDelta => match env.recv_wall {
                    Some(l) if l.0 > 0 => l.max(tick_ts),
                    _ => tick_ts,
                },
                _ => env.at,
            },
        }
    }

    /// The feed high-water `H` (14 F-7): the max of the feed clocks of every
    /// dispatched tick so far; `None` before the first. Feed state seen by a
    /// tick is evaluated at `H` (the pmb-feeds view reads it).
    pub fn feed_clock(&self) -> Option<TsMs> {
        self.feed_hw
    }

    /// `begin_tick` (12 §5.3): tick seq, event clock, feed high-water
    /// (14 F-7: advanced on every dispatched tick, whether or not the
    /// strategy reads feeds), `TickStart` with the visibility time `H`.
    fn begin_tick(
        &mut self,
        cause: TickCause,
        synthetic: bool,
        exchange_ts: Option<TsMs>,
        tick_ts: TsMs,
        feed_clock: TsMs,
    ) {
        let seq = self.next_tick_seq;
        self.next_tick_seq += 1;
        self.stats.ticks.strategy_ticks += 1;
        self.last_tick = Some(TickInfo {
            seq,
            cause,
            synthetic,
            exchange_ts,
        });
        self.clocks.tick_ts = tick_ts;
        self.clocks.event_clock.init_if_unset(tick_ts);
        let hw = self.feed_hw.map_or(feed_clock, |h| h.max(feed_clock));
        self.feed_hw = Some(hw);
        if T::ENABLED {
            self.trace.record(&TraceEvent::TickStart {
                seq,
                cause,
                decision_ts: tick_ts,
                exchange_ts,
                visibility_ts: hw,
            });
        }
    }

    /// The tick interest filter (16 §9.4 TF-1, TF-2): `true` unless the
    /// strategy declared a tick interest other than `All` and no wake
    /// condition holds.
    fn wake(&self, tick: &TickInfo, market: &SharedMarket) -> bool {
        let top = market.last_apply.top;
        match self.interests.ticks {
            TickInterest::All => true,
            _ if tick.synthetic || !self.woke_once || self.delivered_since_tick => true,
            _ if (
                self.feeds_view.generation,
                self.plugins.snapshot().generation,
            ) != self.seen_generations =>
            {
                true
            }
            TickInterest::TopOfBook => top.price,
            TickInterest::TopOfBookAndSize => top.any(),
        }
    }

    /// `run_strategy_tick` (12 §5.3, §6.4): plugins update after the tick's
    /// execution step and cascade; the snapshot is then fixed for every
    /// account callback until the next dispatched tick.
    fn run_strategy_tick(&mut self, market: &SharedMarket) -> Result<(), SessionFault> {
        let tick = self.last_tick.expect("begin_tick ran");
        self.plugins.on_tick(&tick, market);
        if self.calls_stopped {
            // 12 §8.3: a kill switch stops strategy calls; plugins observe.
            return Ok(());
        }
        if !self.wake(&tick, market) {
            self.stats.ticks.strategy_ticks_skipped += 1;
            if T::ENABLED {
                self.intents.clear();
                if self.trace.wants_feed_view() {
                    self.trace.record(&TraceEvent::FeedView {
                        seq: tick.seq,
                        view: &self.feeds_view,
                    });
                }
                self.trace.record(&TraceEvent::Decision {
                    seq: tick.seq,
                    origin: DecisionOrigin::Tick,
                    intents: &self.intents,
                });
            }
            return Ok(());
        }
        if T::ENABLED && self.trace.wants_feed_view() {
            self.trace.record(&TraceEvent::FeedView {
                seq: tick.seq,
                view: &self.feeds_view,
            });
        }
        let rules_view = RulesView {
            rules: self.effective_rules(market),
            source: market.rules_source,
            ts_compat: self.config.core_rules == CoreRules::TsCompat,
        };
        let Some(strategy) = self.strategy.as_mut() else {
            return Ok(());
        };
        // 12 §6.5 book(o): ts-compat shows the recorded book only.
        let overlay = match self.config.core_rules {
            CoreRules::Realistic => self.exec.book_overlay(),
            CoreRules::TsCompat => None,
        };
        let ctx = make_ctx(
            self.clocks.tick_ts,
            self.last_tick.as_ref().expect("begin_tick ran"),
            self.clocks.event_clock.get().unwrap_or(self.clocks.now),
            market,
            overlay,
            PortfolioView {
                ledger: &self.ledger,
                cids: &self.cids,
            },
            &self.feeds_view,
            self.plugins.snapshot(),
            &rules_view,
        );
        self.intents.clear();
        let out = &mut self.intents;
        let res = guarded(|| strategy.on_tick(&ctx, out));
        self.delivered_since_tick = false;
        self.woke_once = true;
        self.seen_generations = (
            self.feeds_view.generation,
            self.plugins.snapshot().generation,
        );
        match res {
            Err(message) => {
                self.strategy_fault(
                    StrategyFaultCause::Panic { message },
                    "onMarketTick",
                    market,
                )?;
                return self.drain(market);
            }
            Ok(Err(e)) => {
                self.strategy_fault(
                    StrategyFaultCause::Error {
                        message: e.message().to_string(),
                    },
                    "onMarketTick",
                    market,
                )?;
                return self.drain(market);
            }
            Ok(Ok(())) => {}
        }
        if T::ENABLED {
            self.trace.record(&TraceEvent::Decision {
                seq: tick.seq,
                origin: DecisionOrigin::Tick,
                intents: &self.intents,
            });
        }
        let stamp = self
            .clocks
            .decision_stamp(self.config.core_rules, DecisionOrigin::Tick);
        self.handle_intents(stamp, market);
        self.drain(market)
    }

    /// The rules the strategy and the OM see (12 §6.5 `rules()`, 11 §4):
    /// the fixed ts-compat rules in ts-compat, the rules in force otherwise.
    pub(crate) fn effective_rules(&self, market: &SharedMarket) -> ExchangeRules {
        effective_rules(self.config.core_rules, market)
    }

    /// The OM handles the buffer written by the last callback (12 §7.2).
    pub(crate) fn handle_intents(&mut self, stamp: TsMs, market: &SharedMarket) {
        if self.intents.is_empty() {
            return;
        }
        let io = OmIo {
            ledger: &mut self.ledger,
            cids: &mut self.cids,
            metas: &mut self.metas,
            exec: &mut self.exec,
            queue: &mut self.queue,
            market,
            config: &self.config,
        };
        self.om.handle(&self.intents, stamp, io);
        self.stats
            .counters
            .observe_reserved(self.ledger.capital().reserved);
        self.forward_exec_trace();
    }

    /// One engine-originated intent (12 §8.3).
    fn handle_engine(&mut self, intent: EngineIntent, market: &SharedMarket) {
        let io = OmIo {
            ledger: &mut self.ledger,
            cids: &mut self.cids,
            metas: &mut self.metas,
            exec: &mut self.exec,
            queue: &mut self.queue,
            market,
            config: &self.config,
        };
        self.om.handle_engine(intent, self.clocks.now, io);
        self.forward_exec_trace();
    }

    /// Controls (12 §3.2, §8, §10).
    fn on_control(&mut self, c: Control, market: &SharedMarket) -> Result<(), SessionFault> {
        let realistic = self.config.core_rules == CoreRules::Realistic;
        match c {
            Control::SessionStart { observe_only } => {
                if observe_only && !realistic {
                    // D28: ts-compat is backtest-only; observe-only windows
                    // exist only in paper and live (12 §10).
                    return Err(self.engine_fault(
                        "observe-only SessionStart delivered to a ts-compat session (D28)".into(),
                    ));
                }
                self.observe_only = observe_only;
                if observe_only && self.state == SessionState::Active {
                    self.state = SessionState::Warming;
                }
                self.update_lifecycle();
            }
            Control::WindowEnd => {
                if !realistic {
                    // TC-C13: ts-compat has no window-end envelope.
                    return Err(self.engine_fault(
                        "Control(WindowEnd) delivered to a ts-compat session (TC-C13)".into(),
                    ));
                }
                if self.state != SessionState::Done {
                    self.state = SessionState::Closing;
                    self.handle_engine(
                        EngineIntent::CancelMarket {
                            scope: CancelScope::Market,
                            cause: pmb_core::event::CancelCause::WindowEnd,
                        },
                        market,
                    );
                }
            }
            Control::CapitalCap(cap) => self.ledger.set_cap(cap),
            // The driver applied rules changes and data gaps to SharedMarket.
            Control::RulesUpdate | Control::DataGap(_) => {}
            Control::AdoptPositions => {
                // R14: adopted inventory must be excluded from `sellable` and
                // from the result (12 §10, D29); the core cannot honor it yet
                // (the envelope carries no positions before the M8 runtime),
                // so it is refused, never ignored.
                return Err(self.engine_fault(
                    "Control(AdoptPositions) is not supported before the M8 runtime (12 §10, D29; R14)"
                        .into(),
                ));
            }
            Control::Guard(_) | Control::Operator(OperatorCommand::KillSwitch) if !realistic => {
                // D28: guards and the kill switch are paper/live; ts-compat
                // is backtest-only.
                return Err(self.engine_fault(
                    "session guard or kill switch delivered to a ts-compat session (D28)".into(),
                ));
            }
            // 50 §10.2: `reject_burst` rejects new placements locally
            // (`StrategyHalted`) until rotation; the strategy keeps receiving
            // events and cancels stay allowed.
            Control::Guard(GuardTrip::RejectBurst) => self.om.set_halt(Halt::StrategyHalted),
            Control::Guard(GuardTrip::WalletExposure | GuardTrip::OrderRate) => {
                self.om.set_halt(Halt::Guard)
            }
            // 12 §8.3, 50 §10.2 `max_session_loss_usdc`, §10.4: stop strategy
            // calls, reject placements `KillSwitch`, engine-originated
            // `CancelAll` with cause `KillSwitch`; events keep being applied.
            Control::Guard(GuardTrip::SessionLoss)
            | Control::Operator(OperatorCommand::KillSwitch) => {
                self.om.set_halt(Halt::KillSwitch);
                self.calls_stopped = true;
                self.handle_engine(
                    EngineIntent::CancelAll {
                        cause: pmb_core::event::CancelCause::KillSwitch,
                    },
                    market,
                );
            }
            Control::Operator(OperatorCommand::CancelAll) => self.handle_engine(
                EngineIntent::CancelAll {
                    cause: pmb_core::event::CancelCause::Operator,
                },
                market,
            ),
            Control::Operator(OperatorCommand::CancelOrder { cid }) => self.handle_engine(
                EngineIntent::CancelCid {
                    cid,
                    cause: pmb_core::event::CancelCause::Operator,
                },
                market,
            ),
            Control::Shutdown => {
                if self.state != SessionState::Done {
                    self.state = SessionState::Closing;
                }
            }
        }
        self.drain(market)
    }

    /// Backtest end of input (12 §5.1): realistic drains the scheduler in
    /// time order without strategy callbacks (Closing); ts-compat discards
    /// undue actions (TC-C13).
    pub fn end_of_stream(&mut self, market: &SharedMarket) -> Result<(), SessionFault> {
        if let Some(f) = &self.fault {
            return Err(f.clone());
        }
        self.exec.on_end_of_input();
        // TC-C13: ts-compat discards undue actions (the adapter counts them,
        // 12 §14 P12); there is nothing left to drain.
        if self.config.core_rules == CoreRules::TsCompat {
            return Ok(());
        }
        self.state = SessionState::Closing;
        while let Some(t) = self.exec.next_due() {
            self.run_due(t, market)?;
        }
        Ok(())
    }

    /// Settlement and the per-market result (12 §9.5, §9.6; 21 §11, §13).
    /// Checks the PnL identity; a violation is an `engine_fault` (12 §9.6).
    pub fn finalize(
        mut self,
        market: &SharedMarket,
        outcome: FinalOutcome,
    ) -> Result<SessionOutput, SessionFault> {
        if let Some(f) = self.fault.take() {
            return Err(f);
        }
        if !self.ledger.identity_holds(outcome) {
            return Err(SessionFault::Engine {
                message: "PnL identity violated at finalize (12 §9.6)".into(),
            });
        }
        let stats = self.stats.finalize(&self.ledger, outcome);
        // D-PENDING: 21 §16 caps `intentMeta` at 1 MiB without naming the
        // byte measure; chose the compact JSON array (brackets and commas
        // included). `output::market_output` re-checks the materialized
        // array with the contract's `check_intent_meta_caps`.
        let bytes: usize = stats
            .intent_meta
            .iter()
            .map(|&m| self.metas.get(m).len() + 1)
            .sum::<usize>()
            + 1;
        if stats.intent_meta.len() > INTENT_META_MAX_ENTRIES || bytes > INTENT_META_MAX_BYTES {
            return Err(SessionFault::Strategy {
                cause: StrategyFaultCause::IntentMetaLimit,
                callback: "finalize",
                tick_seq: self.tick_seq(),
                at: self.clocks.now,
            });
        }
        self.stats.counters.duplicate_active_cid = self.om.counters().duplicate_active_cid;
        if T::ENABLED {
            self.trace.record(&TraceEvent::Final(&stats));
        }
        self.state = SessionState::Done;
        let diagnostics = SessionDiagnostics {
            ledger: self.ledger.counters(),
            duplicate_active_cid: self.om.counters().duplicate_active_cid,
            exec: *self.exec.diagnostics(),
            skew_ms: market.skew_ms,
        };
        Ok(SessionOutput {
            stats,
            acc: self.stats,
            metas: self.metas,
            diagnostics,
        })
    }

    /// The fault that stopped this session, if any.
    pub fn fault(&self) -> Option<&SessionFault> {
        self.fault.as_ref()
    }

    /// Lifecycle state (12 §10).
    pub fn state(&self) -> SessionState {
        self.state
    }

    /// Strategy event callback (12 §6.2): the decision stamp of §4.2, the
    /// last dispatched tick, the tick-scoped snapshot (12 §6.4).
    pub(crate) fn call_event(
        &mut self,
        ev: &pmb_core::event::AccountEvent,
        market: &SharedMarket,
    ) -> Result<(), SessionFault> {
        let Some(strategy) = self.strategy.as_mut() else {
            return Ok(());
        };
        let Some(tick) = self.last_tick.as_ref() else {
            // D-PENDING: 30 §5 `tick()` has no value before the first strategy
            // tick; only a live StreamStatus can be delivered then (every own
            // order comes from a tick or a later callback); chose to apply it
            // without a callback.
            return Ok(());
        };
        let rules = self.config.core_rules;
        let stamp = self.clocks.decision_stamp(rules, DecisionOrigin::Account);
        let rules_view = RulesView {
            rules: effective_rules(rules, market),
            source: market.rules_source,
            ts_compat: rules == CoreRules::TsCompat,
        };
        // 12 §6.5 book(o): ts-compat shows the recorded book only.
        let overlay = match rules {
            CoreRules::Realistic => self.exec.book_overlay(),
            CoreRules::TsCompat => None,
        };
        let ctx = make_ctx(
            stamp,
            tick,
            self.clocks.event_clock.get().unwrap_or(self.clocks.now),
            market,
            overlay,
            PortfolioView {
                ledger: &self.ledger,
                cids: &self.cids,
            },
            &self.feeds_view,
            self.plugins.snapshot(),
            &rules_view,
        );
        let author = crate::strategy::AccountEvent::resolve(ev, &self.ledger);
        self.intents.clear();
        let out = &mut self.intents;
        let res = guarded(|| strategy.on_event(&ctx, &author, out));
        match res {
            Err(message) => {
                return self.strategy_fault(
                    StrategyFaultCause::Panic { message },
                    "onAccountEvent",
                    market,
                )
            }
            Ok(Err(e)) => {
                return self.strategy_fault(
                    StrategyFaultCause::Error {
                        message: e.message().to_string(),
                    },
                    "onAccountEvent",
                    market,
                )
            }
            Ok(Ok(())) => {}
        }
        if T::ENABLED {
            self.trace.record(&TraceEvent::Decision {
                seq: self.tick_seq(),
                origin: DecisionOrigin::Account,
                intents: &self.intents,
            });
        }
        self.handle_intents(stamp, market);
        Ok(())
    }
}

/// The driver for one market (12 §2.1, §14 P10): for each envelope of a
/// decoded batch, apply it to `market`, then step every session that has
/// not faulted. Faulted sessions stop at once and keep their fault
/// (12 §6.3, §11).
pub fn drive<S: Strategy, E: Execution, T: TraceSink>(
    market: &mut SharedMarket,
    sessions: &mut [Session<S, E, T>],
    batch: &[Envelope<'_>],
) {
    for env in batch {
        market.apply(env);
        for s in sessions.iter_mut() {
            if s.fault.is_none() {
                // A fault is kept in the session (12 §11); the others continue.
                let _ = s.step(env, market);
            }
        }
    }
}
