//! The `Simulator` adapter: implements `crate::exec::Execution` over the
//! model traits and the scheduler (13 §3, §4).
//!
//! The simulator keeps the **exchange truth** (13 §4.1): resting orders and
//! their remaining sizes, fill-model state, scheduled actions, per-order
//! `FillKey.seq` counters and the `TradeSeq` counter. The ledger is client
//! knowledge only and is never written here (13 X5).
//!
//! Model selection is enum dispatch (13 §4.4): each axis enum has exactly the
//! implementations that exist, so the ts-compat composition compiles to
//! direct calls. The realistic composition (13 §6) is added in M3b; until
//! then [`Simulator::new`] rejects it (R14).

use pmb_contract::model_config::ExecutionModels;
use pmb_core::event::CancelCause;
use pmb_core::ids::OrderKey;
use pmb_core::{MarketEvent, TsMs};

use super::book_overlay::{Deficits, RestingOrder, RestingSet};
use super::compat::{self, lifecycle, CompatFill, Stamp};
use super::fee::{Fee700Bps4dp, Fees};
use super::fill::{Fills, TradeCounter};
use super::latency::{
    Arrival, CommandKind, CommandRef, Latency, LatencyModel, NextRealTick, Release,
};
use super::report::{CompatStatus, Reports};
use super::scheduler::{ActionClass, Scheduler, SchedulerMode};
use crate::config::{ConfigError, EngineConfig};
use crate::core_rules::CoreRules;
use crate::exec::{
    CancelScope, EventQueue, ExecCommand, ExecCtx, ExecDiagnostics, Execution, TimerFired,
};
use crate::trace::LifecycleTransition;

/// The simulator's exchange truth (13 §4.1) and its per-session overlay
/// (13 §4.2).
#[derive(Clone, Debug, Default)]
pub struct ExchangeTruth {
    /// Own resting orders in rest order.
    pub resting: RestingSet,
    /// Depletion deficits (empty under `depletion: none`).
    pub deficits: Deficits,
    /// `TradeSeq` counter (10 §6).
    pub trades: TradeCounter,
}

/// The model axes of one composition (13 §4.4).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Models {
    /// `models.latency`.
    pub latency: Latency,
    /// `models.depletion` and `models.maker` (with the composition's taker).
    pub fill: Fills,
    /// `models.fee`.
    pub fee: Fees,
    /// `models.reports`.
    pub reports: Reports,
}

impl Models {
    /// The ts-compat composition of 13 §5.1 for one market: `NextRealTick`
    /// with `execution.compatLatency` and the market seed's `compat_jitter`
    /// stream, `CompatTaker` + `WorstQueueCompat` without depletion,
    /// `Fee700Bps4dp`, `CompatStatus`.
    pub fn ts_compat(cfg: &EngineConfig) -> Models {
        Models {
            latency: Latency::Compat(NextRealTick::new(
                cfg.compat_latency.delay_ms,
                cfg.compat_latency.jitter_ms,
                cfg.market_seed,
                true,
            )),
            fill: Fills::Compat(CompatFill),
            fee: Fees::Flat700Bps4Dp(Fee700Bps4dp),
            reports: Reports::Compat(CompatStatus),
        }
    }
}

/// A fixed profile composition (13 §4.4, §7.1).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Composition {
    /// Compat models + compat taker + synchronous split/merge (13 §5).
    TsCompat,
}

/// A range of the simulator's key arena.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
struct KeyRange {
    start: usize,
    len: usize,
}

/// A scheduled exchange-side action (13 §4.3). Commands borrow their keys;
/// a scheduled one copies them into the simulator's key arena.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Action {
    /// `PlaceArrive{keys}`.
    Place { keys: KeyRange },
    /// `CancelArrive` of bound keys.
    Cancel { cause: CancelCause, keys: KeyRange },
    /// `CancelArrive` of a scope resolved at arrival; `None` = `CancelAll`.
    Scope {
        cause: CancelCause,
        scope: Option<CancelScope>,
    },
}

impl Action {
    #[inline]
    fn keys_mut(&mut self) -> Option<&mut KeyRange> {
        match self {
            Action::Place { keys } | Action::Cancel { keys, .. } => Some(keys),
            Action::Scope { .. } => None,
        }
    }

    #[inline]
    fn key_len(&self) -> usize {
        match self {
            Action::Place { keys } | Action::Cancel { keys, .. } => keys.len,
            Action::Scope { .. } => 0,
        }
    }
}

/// Slack of the key arena before compaction (amortized; 13 §10).
const ARENA_SLACK: usize = 1_024;

/// The simulator adapter (13 §3, §4).
#[derive(Clone, Debug)]
pub struct Simulator {
    composition: Composition,
    models: Models,
    mode: SchedulerMode,
    sched: Scheduler<Action>,
    /// Keys of scheduled commands; cleared whenever the scheduler empties,
    /// compacted into `spare` when mostly dead (both keep capacity).
    keys: Vec<OrderKey>,
    spare: Vec<OrderKey>,
    live_keys: usize,
    truth: ExchangeTruth,
    /// 0-based count of `submit` calls (13 §5.1 `compat_jitter` entity).
    submits: u32,
    input_ended: bool,
    /// Highest loop time seen in a call, for `max(due, now)` stamps of
    /// `run_next_due` (13 §2.3 TS3).
    now_hint: TsMs,
    diag: ExecDiagnostics,
}

impl Simulator {
    /// Builds the simulator of `cfg`'s composition (13 §4.4, §7.3).
    /// ts-compat with any non-compat axis value is an error (13 §7.3); the
    /// realistic composition is an error until M3b (D57). Never a silent
    /// fallback (R14).
    pub fn new(cfg: &EngineConfig) -> Result<Simulator, ConfigError> {
        match cfg.core_rules {
            CoreRules::TsCompat => {
                if cfg.models != ExecutionModels::TS_COMPAT {
                    return Err(ConfigError {
                        message: format!(
                            "execution.models: ts-compat requires the compat values (13 §7.3), \
                             got latency={} fee={} takerDelay={} depletion={} maker={} reports={}",
                            cfg.models.latency,
                            cfg.models.fee,
                            cfg.models.taker_delay,
                            cfg.models.depletion,
                            cfg.models.maker,
                            cfg.models.reports
                        ),
                    });
                }
                Ok(Simulator::with_models(
                    Composition::TsCompat,
                    Models::ts_compat(cfg),
                ))
            }
            CoreRules::Realistic => Err(ConfigError {
                message: "execution: the realistic composition (13 §6) lands in M3b (D57); \
                          only ts-compat is available"
                    .to_owned(),
            }),
        }
    }

    fn with_models(composition: Composition, models: Models) -> Simulator {
        Simulator {
            composition,
            models,
            mode: SchedulerMode::SelfTimed,
            sched: Scheduler::new(),
            keys: Vec::new(),
            spare: Vec::new(),
            live_keys: 0,
            truth: ExchangeTruth::default(),
            submits: 0,
            input_ended: false,
            now_hint: TsMs(i64::MIN),
            diag: ExecDiagnostics::default(),
        }
    }

    /// The parity-run constraints of 13 §5.5 that a configuration can show:
    /// the ts-compat composition with jitter 0 (TS jitter is unseeded,
    /// `BacktestExecution.ts:239-242`). Delays and the pinned `ModelConfig`
    /// are checked by the parity harness (60).
    pub fn check_parity_run(cfg: &EngineConfig) -> Result<(), ConfigError> {
        if cfg.core_rules != CoreRules::TsCompat || cfg.models != ExecutionModels::TS_COMPAT {
            return Err(ConfigError {
                message: "parity runs use the ts-compat composition (13 §5.5)".to_owned(),
            });
        }
        if cfg.compat_latency.jitter_ms != 0 {
            return Err(ConfigError {
                message: format!(
                    "execution.compatLatency.jitterMs: parity runs require 0 (13 §5.5), got {}",
                    cfg.compat_latency.jitter_ms
                ),
            });
        }
        Ok(())
    }

    /// The composition this simulator runs.
    #[inline]
    pub fn composition(&self) -> Composition {
        self.composition
    }

    /// Scheduler mode (13 §2.3); backtests are `SelfTimed`.
    #[inline]
    pub fn mode(&self) -> SchedulerMode {
        self.mode
    }

    /// Own resting orders at the simulated exchange, in rest order (13 §4.1).
    #[inline]
    pub fn resting(&self) -> &[RestingOrder] {
        self.truth.resting.as_slice()
    }

    /// Number of scheduled actions.
    #[inline]
    pub fn pending_actions(&self) -> usize {
        self.sched.len()
    }

    /// Length of the key arena (tests of 13 §10 bounded storage).
    #[cfg(test)]
    pub(crate) fn arena_len(&self) -> usize {
        self.keys.len()
    }

    fn store_keys(&mut self, keys: &[OrderKey]) -> KeyRange {
        let start = self.keys.len();
        self.keys.extend_from_slice(keys);
        self.live_keys += keys.len();
        KeyRange {
            start,
            len: keys.len(),
        }
    }

    /// Clears the key arena when nothing is scheduled; compacts it when
    /// mostly dead. Both buffers keep their capacity (13 X1).
    fn maintain_arena(&mut self) {
        if self.sched.is_empty() {
            self.keys.clear();
            self.live_keys = 0;
            return;
        }
        if self.keys.len() <= 2 * self.live_keys + ARENA_SLACK {
            return;
        }
        let Simulator {
            sched, keys, spare, ..
        } = self;
        spare.clear();
        sched.rewrite(|a| {
            if let Some(r) = a.keys_mut() {
                let start = spare.len();
                spare.extend_from_slice(&keys[r.start..r.start + r.len]);
                r.start = start;
            }
        });
        std::mem::swap(keys, spare);
        spare.clear();
    }

    /// Runs one scheduled action (13 §4.3).
    fn run(&mut self, action: Action, cx: &ExecCtx<'_>, s: Stamp, out: &mut EventQueue) {
        let Simulator {
            models,
            truth,
            keys,
            live_keys,
            diag,
            ..
        } = self;
        diag.actions_run += 1;
        *live_keys -= action.key_len();
        match action {
            Action::Place { keys: r } => {
                compat::place(models, truth, &keys[r.start..r.start + r.len], cx, s, out)
            }
            Action::Cancel { cause, keys: r } => {
                compat::cancel_keys(truth, &keys[r.start..r.start + r.len], cause, s, out)
            }
            Action::Scope { cause, scope } => compat::cancel_scope(truth, scope, cause, s, out),
        }
    }

    /// Runs a command now (synchronous events, 13 X2; ts-compat only).
    fn run_now(&mut self, cmd: ExecCommand<'_>, cx: &ExecCtx<'_>, s: Stamp, out: &mut EventQueue) {
        match cmd {
            ExecCommand::Place { orders } => {
                compat::place(&self.models, &mut self.truth, orders, cx, s, out)
            }
            ExecCommand::Cancel { cause, keys, .. } => {
                compat::cancel_keys(&mut self.truth, keys, cause, s, out)
            }
            ExecCommand::CancelScope { cause, scope, .. } => {
                compat::cancel_scope(&mut self.truth, Some(scope), cause, s, out)
            }
            ExecCommand::CancelAll { cause, .. } => {
                compat::cancel_scope(&mut self.truth, None, cause, s, out)
            }
            ExecCommand::Split { .. } | ExecCommand::Merge { .. } => {
                unreachable!("split/merge never reach the latency path in ts-compat (TC-E9)")
            }
        }
    }

    /// Schedules a command for exchange arrival at `t` (13 §4.3).
    fn schedule(&mut self, t: TsMs, cmd: ExecCommand<'_>, out: &mut EventQueue) {
        let action = match cmd {
            ExecCommand::Place { orders } => {
                for &k in orders {
                    lifecycle(out, k, LifecycleTransition::Scheduled, t);
                }
                Action::Place {
                    keys: self.store_keys(orders),
                }
            }
            ExecCommand::Cancel { cause, keys, .. } => Action::Cancel {
                cause,
                keys: self.store_keys(keys),
            },
            ExecCommand::CancelScope { cause, scope, .. } => Action::Scope {
                cause,
                scope: Some(scope),
            },
            ExecCommand::CancelAll { cause, .. } => Action::Scope { cause, scope: None },
            ExecCommand::Split { .. } | ExecCommand::Merge { .. } => {
                unreachable!("split/merge never reach the latency path in ts-compat (TC-E9)")
            }
        };
        self.sched.push(t, ActionClass::Exchange, action);
        self.diag.actions_scheduled += 1;
    }

    #[inline]
    fn see(&mut self, t: TsMs) {
        if t > self.now_hint {
            self.now_hint = t;
        }
    }
}

impl Execution for Simulator {
    /// 13 §5.1: split/merge are synchronous (TC-E9); placements and cancels
    /// get one `NextRealTick` arrival per command (one `compat_jitter` draw,
    /// entity = 0-based `submit` count) and run inside `submit` when
    /// `execute_at ≤ stamp` (TC-E1), else are queued by (`execute_at`, seq).
    fn submit(
        &mut self,
        stamp: TsMs,
        cmd: ExecCommand<'_>,
        cx: &ExecCtx<'_>,
        out: &mut EventQueue,
    ) {
        self.see(stamp);
        let submit_index = self.submits;
        self.submits = self
            .submits
            .checked_add(1)
            .expect("fewer than 2^32 execution commands per session");
        let kind = match cmd {
            ExecCommand::Split { op, size } => {
                compat::split(op, size, stamp, out);
                return;
            }
            ExecCommand::Merge { op, size } => {
                compat::merge(op, size, cx, stamp, out);
                return;
            }
            ExecCommand::Place { orders } => match orders.first() {
                Some(&first) => CommandKind::Place { first },
                // The OM never dispatches an empty batch (12 §7.3).
                None => return,
            },
            ExecCommand::Cancel { op, .. }
            | ExecCommand::CancelScope { op, .. }
            | ExecCommand::CancelAll { op, .. } => CommandKind::Cancel { seq: op.seq },
        };
        match self
            .models
            .latency
            .command_arrival(stamp, CommandRef { submit_index, kind })
        {
            Arrival::Now => self.run_now(
                cmd,
                cx,
                Stamp {
                    at: stamp,
                    due: stamp,
                },
                out,
            ),
            Arrival::At(t) => self.schedule(t, cmd, out),
        }
    }

    /// `None` while compat latency releases at market events (13 §5.1);
    /// after `on_end_of_input` the ts-compat composition has discarded its
    /// actions (TC-C13), so this stays `None`.
    fn next_due(&self) -> Option<TsMs> {
        match self.models.latency.release() {
            Release::ExactTime => self.sched.peek_time(),
            Release::AtMarketEvent if self.input_ended => self.sched.peek_time(),
            Release::AtMarketEvent => None,
        }
    }

    /// Runs every action due at exactly `next_due()` in (class, seq) order
    /// (13 §4.3); events carry `max(due, now)` (13 §2.3 TS3).
    fn run_next_due(&mut self, cx: &ExecCtx<'_>, out: &mut EventQueue) {
        let Some(t) = self.next_due() else {
            return;
        };
        let at = t.max(self.now_hint);
        while let Some(d) = self.sched.pop_at(t) {
            self.run(d.action, cx, Stamp { at, due: d.time }, out);
        }
        self.see(t);
        self.maintain_arena();
    }

    /// Journaled mode (13 §2.3): every action due at or before `t.due`, in
    /// (time, class, seq) order; delivered events carry the fire time
    /// (TS3). Unused by ts-compat, which is backtest-only (D28).
    fn on_timer(&mut self, t: &TimerFired, cx: &ExecCtx<'_>, out: &mut EventQueue) {
        self.see(t.at);
        while let Some(d) = self.sched.pop_due(t.due) {
            self.run(
                d.action,
                cx,
                Stamp {
                    at: t.at,
                    due: d.time,
                },
                out,
            );
        }
        self.maintain_arena();
    }

    /// ts-compat (13 §5.1): only real in-window ticks arrive here (13 X6).
    /// Queued actions with `execute_at ≤ tick.ts` run first, sorted by
    /// (`execute_at`, seq), stamped with the tick's ts, against the post-event
    /// book; then the worst-queue maker scan. A session with no resting
    /// orders and no queued actions skips the event (16 CG-4).
    fn on_market_event(
        &mut self,
        now: TsMs,
        ev: &MarketEvent<'_>,
        cx: &ExecCtx<'_>,
        out: &mut EventQueue,
    ) {
        self.see(now);
        if !ev.produces_tick() {
            // Prints and tick-size changes feed realistic models only
            // (12 §5.2); compat models ignore them.
            return;
        }
        if self.sched.is_empty() && self.truth.resting.is_empty() {
            self.diag.fast_path_skips += 1;
            return;
        }
        if self.models.latency.release() == Release::AtMarketEvent {
            while let Some(d) = self.sched.pop_due(now) {
                self.run(
                    d.action,
                    cx,
                    Stamp {
                        at: now,
                        due: d.time,
                    },
                    out,
                );
            }
            self.maintain_arena();
        }
        compat::maker_scan(&self.models, &mut self.truth, cx, now, out);
    }

    /// ts-compat: undue actions are discarded (TC-C13; TS never executes
    /// them). A realistic arm would instead report them through `next_due`.
    fn on_end_of_input(&mut self) {
        self.input_ended = true;
        match self.composition {
            Composition::TsCompat => {
                self.diag.actions_discarded += self.sched.discard_all() as u64;
                self.maintain_arena();
            }
        }
    }

    fn diagnostics(&self) -> &ExecDiagnostics {
        &self.diag
    }
}
