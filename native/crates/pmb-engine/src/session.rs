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
use crate::config::EngineConfig;
use crate::core_rules::CoreRules;
use crate::envelope::{Control, Envelope, OperatorCommand, Payload, SyntheticKind};
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
    let book = |o: Outcome| BookView {
        outcome: o,
        recorded: market.books.get(o),
        overlay,
        updated_at: market.book_updated_at[o].unwrap_or(TsMs(0)),
        stale: market.stale[o],
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
        let interests = guarded(|| S::interests(params)).map_err(fault)?;
        let strategy = guarded(|| S::new(params, &market.info)).map_err(fault)?;
        let rules = config.core_rules;
        let window = WindowGate {
            rule: WindowRule::select(rules, config.input_mode),
            window: market.window(),
        };
        let state = match rules {
            // ts-compat has no lifecycle beyond its window gate (TC-C9).
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
        self.strategy = None;
        f
    }

    pub(crate) fn strategy_fault(
        &mut self,
        cause: StrategyFaultCause,
        callback: &'static str,
    ) -> SessionFault {
        let f = SessionFault::Strategy {
            cause,
            callback,
            tick_seq: self.last_tick.map_or(0, |t| t.seq),
            at: self.clocks.now,
        };
        // 12 §11: after a fault the strategy object is never called again.
        self.fault = Some(f.clone());
        self.strategy = None;
        self.om.set_halt(Halt::StrategyHalted);
        f
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
            CoreRules::TsCompat if synthetic => env.at,
            CoreRules::TsCompat => env.exchange_ts.unwrap_or(env.at),
        }
    }

    /// The window gate of the profile (12 §5.4).
    fn passes_gate(&self, tick_ts: TsMs) -> bool {
        match self.config.core_rules {
            CoreRules::TsCompat => self.window.in_window(tick_ts, self.clocks.now),
            CoreRules::Realistic => {
                self.state == SessionState::Active
                    && self.window.in_window(tick_ts, self.clocks.now)
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
            self.begin_tick(c, false, env.exchange_ts, tick_ts);
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
        self.begin_tick(cause, true, env.exchange_ts, tick_ts);
        self.run_strategy_tick(market)
    }

    /// `begin_tick` (12 §5.3): tick seq, event clock, `TickStart`.
    fn begin_tick(
        &mut self,
        cause: TickCause,
        synthetic: bool,
        exchange_ts: Option<TsMs>,
        tick_ts: TsMs,
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
        if T::ENABLED {
            self.trace.record(&TraceEvent::TickStart {
                seq,
                cause,
                decision_ts: tick_ts,
                exchange_ts,
                visibility_ts: tick_ts,
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
        };
        let Some(strategy) = self.strategy.as_mut() else {
            return Ok(());
        };
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
                return Err(
                    self.strategy_fault(StrategyFaultCause::Panic { message }, "onMarketTick")
                )
            }
            Ok(Err(e)) => {
                return Err(self.strategy_fault(
                    StrategyFaultCause::Error {
                        message: e.message().to_string(),
                    },
                    "onMarketTick",
                ))
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
        match self.config.core_rules {
            CoreRules::TsCompat => ExchangeRules::ts_compat(),
            CoreRules::Realistic => market.rules,
        }
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
            // D-PENDING: adoption of read-only inventory is live-only (50,
            // M9); chose a no-op in the core until the runtime sends it.
            Control::AdoptPositions => {}
            Control::Guard(_) | Control::Operator(OperatorCommand::KillSwitch) => {
                self.om.set_halt(Halt::KillSwitch);
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
            Control::Operator(OperatorCommand::CancelOrder { cid }) => {
                if let Some(k) = self.ledger.current(cid) {
                    self.handle_engine(
                        EngineIntent::CancelKeys {
                            key: k,
                            cause: pmb_core::event::CancelCause::Operator,
                        },
                        market,
                    );
                }
            }
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
        if self.config.core_rules == CoreRules::TsCompat {
            return Ok(());
        }
        self.exec.on_end_of_input();
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
        _market: &SharedMarket,
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
        let bytes: usize = stats
            .intent_meta
            .iter()
            .map(|&m| self.metas.get(m).len())
            .sum();
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
        Ok(SessionOutput {
            stats,
            acc: self.stats,
            metas: self.metas,
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
            // No callback can precede the first strategy tick: every own
            // order comes from a tick or a later callback.
            return Ok(());
        };
        let rules = self.config.core_rules;
        let stamp = self.clocks.decision_stamp(rules, DecisionOrigin::Account);
        let rules_view = RulesView {
            rules: match rules {
                CoreRules::TsCompat => ExchangeRules::ts_compat(),
                CoreRules::Realistic => market.rules,
            },
            source: market.rules_source,
        };
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
                return Err(
                    self.strategy_fault(StrategyFaultCause::Panic { message }, "onAccountEvent")
                )
            }
            Ok(Err(e)) => {
                return Err(self.strategy_fault(
                    StrategyFaultCause::Error {
                        message: e.message().to_string(),
                    },
                    "onAccountEvent",
                ))
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
