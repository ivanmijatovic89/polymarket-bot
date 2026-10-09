# pmb-engine architecture (M1 steps 3–4 skeleton)

`pmb-engine` is the deterministic core shared by backtest, paper and live
(spec 12) plus the execution trait and the simulator (spec 13). This file maps
the modules, splits ownership between the two agents that implement the
skeleton in parallel, and fixes the interfaces between them. The normative
spec is `native/spec/` (frozen at gate 1); clause references below point
there.

## Module map

| Module | Spec | Contents |
|---|---|---|
| `strategy` (`mod.rs`) | 30 §4, §4.1, §10, §12 | `Strategy` trait (`Params`, `ID`, `requirements`, `interests`, `new`, `on_tick`, `on_event`, `status`), `Interests`, `EventFlags`, `TickInterest`, `StrategyResult`, `StrategyError`, stand-in `Requirements` |
| `strategy::ctx` | 30 §5, 12 §6.5 | `Ctx`: stack value of borrows, built once per callback |
| `strategy::views` | 30 §5.1–§5.2, 12 §9.7 | `TickInfo`, `TickCause`, `BookView`, `Level`, `PortfolioView`, `OrderView` (= `ledger::OrderRecord`), `RulesView` |
| `strategy::event` | 30 §8 | Author `AccountEvent<'a>` view, `FillView` |
| `strategy::intents` | 10 §11 P3, 12 §6.1, 30 §7 | Engine-owned reused `Intents` buffer (buffer-local cids, interned by the OM), `Meta` |
| `config` | 21 §6 | `EngineConfig` (resolved `ModelConfig`), `RiskLimits` |
| `core_rules` | 12 §2.3 | `CoreRules::{TsCompat, Realistic}` |
| `envelope` | 12 §3 | `Envelope`, `Payload`, `Source`, `Control`, `SyntheticKind` |
| `shared` | 12 §2.1, §4.4 | `SharedMarket` (recorded books, rules in force, feed state, window, skew), driver `apply` |
| `clock` | 12 §4 | `Clocks` (`now`, `tick_ts`), `EventClock`, decision stamp, `xnow`, `loop_time_of` |
| `window` | 12 §5.4, §10 | `WindowRule`, `WindowGate`, `SessionState` |
| `session` | 12 §2.1, §5.1, §10, §11 | `Session<S, E, T>`, `step`, `end_of_stream`, `finalize`, `drive`, `SessionFault` |
| `cascade` | 12 §6.2–§6.3 | `Session::drain`, `CascadeBudget` |
| `om` | 12 §7–§8 | `OrderManager`, `OmIo`, `EngineIntent`, `SelfCrossIndex`, `Halt` |
| `ledger` | 12 §9 | `Ledger`, `OrderRecord`, `PendingOp`, `Delivered`, `LedgerCounters` |
| `trace` | 22 §2, 12 §12 | `TraceSink`, `NoTrace`, `TraceEvent`, `OrderLifecycle`, `FillDetail`, `ExecTraceRecord` |
| `stats` | 21 §10–§11, §13, §15–§16 | `TickCounters`, `CandidateCounters`, `MarketStatsAcc`, `FinalStats` |
| `exec` (`mod.rs`) | 13 §2.1–§2.4 | `Execution`, `ExecCommand`, `CancelScope`, `ExecCtx`, `EventQueue`, `TimerFired`, `AccountInput`, `BookOverlay`, `ExecDiagnostics` |
| `exec::sim::*` | 13 §3–§5 | `scheduler`, `book_overlay`, `fill`, `latency`, `fee`, `report`, `compat`, `simulator` (empty) |
| `feeds_view`, `plugins_view` | 14 §2, §12.1 | STAND-INS for `pmb-feeds` / `pmb-plugins` (`FeedsView`, `FeedState`, `FeedObservation`, `PluginsView`, `PluginSet`) |

`#![allow(dead_code)]` in `lib.rs` exists only for the skeleton; remove it
when the bodies land.

## Ownership for the next two agents

| Agent | Files (create and edit only these) |
|---|---|
| CORE | `src/{lib,config,core_rules,envelope,shared,clock,window,session,cascade,om,ledger,trace,stats,feeds_view,plugins_view}.rs`, `src/strategy/**`, `src/exec/mod.rs` (frozen interface, see below), `Cargo.toml`, `tests/core_*.rs`, `tests/skeleton.rs`, this file |
| SIMULATOR | `src/exec/sim/**` only, plus `tests/sim_*.rs` |

- `src/exec/mod.rs` is the contract between the two agents. It is owned by
  CORE but frozen: either agent asks the lead for a change (crossStreamNeeds),
  and the change lands on both branches.
- The SIMULATOR agent needs no other file. New dev-dependencies are requested
  from CORE (Cargo.toml) through the lead.
- `pmb-core` stays owned by the core stream (except `feed_value.rs`).

## Interfaces between CORE and SIMULATOR

### What the simulator implements

`exec::sim::simulator::Simulator` implements `exec::Execution` (13 §2.2) for
both compositions (13 §4.4): ts-compat = compat models of 13 §5.1 +
`CompatTaker` + synchronous split/merge; realistic = models of 13 §6 (M3b).
Suggested constructor: `Simulator::new(cfg: &EngineConfig) -> Result<Simulator,
ConfigError>`, selecting models from `cfg.models` (13 §7.3) and
`cfg.core_rules`; unknown or unsupported axis combinations are errors (R14).
Whether models are generics or enums is the simulator's choice (13 §4.4,
measured in 16).

### What the simulator reads (never writes, 13 X5)

| Source | Read through | Used for |
|---|---|---|
| Order request of a key | `cx.order(k).request()` (`OrderRequest`: cid, outcome, side, price, `OrderSize`, type, post-only, `expire_at_ms`) | Matching, post-only, GTD expiry (13 §2.1) |
| Signed amounts (realistic) | `cx.order(k).signed_amounts()` | Exchange arithmetic (11 TK4, 13 §6.4.1) |
| Cid of a key | `cx.order(k).cid()` | `OrderRejected { order: Some(k), cid, .. }` |
| Delivered positions | `cx.ledger.position(o).qty` | ts-compat merge `min(requested, Up, Down)` (TC-E9) |
| Recorded books | `cx.market.books` (`pmb_book::MarketBooks`), already updated for the current market event | Taker walks, maker trade-through (13 §5.1) |
| Rules in force | `cx.market.rules` (`ExchangeRules`, `Copy`) | Fee curve, tick, arrival checks, taker delay (11) |
| Window, market | `cx.market.window()`, `cx.market.info` | Market close (13 §6.6) |
| Skew | `cx.market.skew_ms`, `cx.market.loop_time_of(now, x)`, `cx.market.exchange_time(now)` | Exchange-side times (12 §4.4 XT3, 13 §4.3) |
| Config and seed | `cx.config` (`models`, `compat_latency`, `market_seed`) | Model choice, counter-based draws (13 X8) |

The simulator keeps its own **exchange truth** (13 §4.1): resting orders,
remaining sizes, fill-model state, scheduled actions, per-order `FillKey.seq`
counters and the `TradeSeq` counter. The ledger is client knowledge only.
`FillKey.seq` is assigned when the fill is pushed into the `EventQueue`
(push order = delivery order); the ledger asserts it strictly increases.

### What the simulator emits

- Core `AccountEvent { at, kind }` values pushed to the `EventQueue` in
  emission order (13 X4), each naming its `OrderKey` or `OpKey` (X3); fills
  carry their fee from the fee model (12 §9.5), computed once.
- `at`: the loop clock at delivery, `max(due, now)` (13 §2.3 TS3, 12 K2); in
  ts-compat the tick's ts.
- Synchronous events inside `submit` only in ts-compat (13 X2: effective
  latency 0, split/merge). After each dispatch the OM scans
  `queue.since(mark)` for terminal events and `OrderAccepted` of keys it just
  dispatched (12 §7.2 TC-C2 step 4, §7.6 item 1).
- Exactly one terminal event per key (X7); OM-level rejections are the OM's,
  not the simulator's.
- Trace records: when `out.wants_trace()`, `out.record(ExecTraceRecord::…)`
  with `OrderLifecycle`/`FillDetail` stamped at the action's due time
  (13 §4.3, 22 §2). Build them only when wanted (13 §10).
- `diagnostics()` returns plain counters (`ExecDiagnostics`); attribution
  counters of 13 §7.2 are added there.

### Calls the core makes, and when (12 §5)

| Call | When |
|---|---|
| `submit(stamp, cmd, cx, out)` | OM dispatch; `stamp` = decision stamp (12 §4.2: realistic `now`; ts-compat tick ts, TC-C8) |
| `next_due()` / `run_next_due` | Step (a) of 12 §5.1: every due time strictly before the next envelope's `at`, one cascade per time; at end of stream (realistic) until empty |
| `on_market_event(now, ev, cx, out)` | After the driver applied a real market event. ts-compat: only for in-window ticks (`book`/`price_change`), never out of window (TC-C9, X6). Realistic: every market event incl. prints and `TickSizeChange`, also while Warming/Closing; the simulator stops matching at the market close (13 §6.6). Never for synthetic ticks |
| `on_timer` | Journaled mode only (paper, live, journal replay; 13 §2.3) |
| `on_end_of_input()` | Backtest end of input, before the realistic scheduler drain; ts-compat discards undue actions (TC-C13) |
| `book_overlay()` | Each `Ctx` build in realistic (12 §6.5 `book(o)`, 13 §6.11) |

### Compat latency releases at market events (13 §5.1)

`latency = compat` (`NextRealTick`): `execute_at = max(stamp, stamp + d +
jitter)`, jitter only when `d > 0`, one `compat_jitter` draw per `submit`
(entity = 0-based submit count). `execute_at ≤ stamp` executes inside
`submit` (synchronous events). Otherwise the action is queued by
(`execute_at`, seq) and `next_due()` returns `None`: queued actions run only
inside `on_market_event` of a real in-window tick with tick ts ≥ `execute_at`,
after that tick's book update, sorted by (`execute_at`, seq), stamped with the
tick's ts, before the maker scan (`WorstQueueCompat`, TC-E5). They are
discarded at end of stream (TC-C13). As a realistic A/B arm the same release
rule applies to every scheduled action, `next_due()` is `None` while input
remains and reports pending actions after `on_end_of_input`.

D-PENDING (time argument): 13 §2.2 passes `now` to `on_market_event`; in
ts-compat on recorder-v4 the loop clock (`receivedAtMs`) differs from the TS
tick ts the compat models need (TC-C11). Chose: the core passes the TS tick
ts as `now` in ts-compat and the loop clock in realistic. On telonex-delta the
two are equal for real ticks.

### Profile branching

The core branches only on `CoreRules` (12 §2.3); the simulator branches only
on its composition. Neither branches on adapter kind (13 X5).

## Deferred

- Realistic models (latency components with `md`, depletion, queue model,
  taker delay, arrival re-validation, settlement reports and reversal,
  async split/merge, market close, overlay merge into `BookView`): M3b
  (D57; 13 §6). Realistic `ModelConfig` sections are not yet resolved into
  `EngineConfig`.
- Live adapters (`Paper`, `ClobV2`, `JournalReplay`, journaled timers,
  `AccountInput` variants, session guards, `CapitalCap`): M8/M9 (13 §8–§9,
  50). `AccountInput` is uninhabited until then.
- Real `FeedsView`/`FeedState` (pmb-feeds) and plugins (pmb-plugins):
  integration replaces `feeds_view` and `plugins_view`; `Requirements` moves
  with them.
- Author order builders (`Order::buy`, `.gtd`, `.fok`, `buy_spend`, `cid!`)
  and the `Params` derive: pmb-sdk, on top of `Intents::place_request`.
