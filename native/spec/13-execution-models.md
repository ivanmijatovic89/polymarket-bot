# 13 — Execution models

This document specifies everything between a validated command and the account
events the core receives back: the `Execution` trait and its contract, the
adapters (simulator, paper, CLOB V2, journal replay), the simulator's
architecture (exchange truth vs client knowledge, simulated book,
discrete-event scheduler, model traits, the fill unit), the **ts-compat**
profile as a small set of compat model implementations with every TS quirk
listed, the **realistic** profile derived from the current Polymarket rules
(arrival checks, taker delay, depletion, fill amounts, own orders in the book,
queue position, separate seeded latencies with market-data delay,
collateral-sized market BUYs, window end and market close, settlement reports,
async split/merge), the realistic fixes with their A/B report procedure, the
`ModelConfig.execution` sub-object, where its defaults and calibration sets
live, and the core-facing contract of the CLOB V2 adapter. The loop, ledger,
order manager and clocks that call these models are in
[12-engine-core.md](12-engine-core.md); event, state and reason types are in
[10-domain-model.md](10-domain-model.md).

## 1. Scope and references

| Topic | Owner |
|---|---|
| Loop, cascades, OM, risk, ledger, reservations, window gate, clocks (incl. receipt synthesis, skew, `ModelConfig.clock`), fault semantics | 12-engine-core.md |
| Order states, account events, reasons, fill struct, rounding table | 10-domain-model.md §3, §6–§10 |
| Rule values: tick, bounds, precision, amount rounding, fee eras and formula, taker delay table, GTD, caps, post-only, market close, verification registry | 11-exchange-rules.md |
| Recorded book, trade prints availability, decontamination transform | 15-inputs.md |
| `ModelConfig` layout and representation rules; candidate variants (C4) | 21-job-and-output-contract.md §6, §8 (`execution` is owned here, §7.3) |
| `OrderLifecycle` and `FillDetail` trace events, fill ledger | 22-trace-ledger-journal.md |
| Live transport, V2 signing, heartbeat, rate limits, reconnect, observation mapping, fill ids | 50-live-runtime.md §8 |
| Calibration probes, journal ↔ V4 join, thresholds | 51-calibration-plan.md |
| A/B verification rules, market sets, parity classification, property tests | 60-verification.md |

## 2. The `Execution` trait

### 2.1 Commands

```rust
pub enum ExecCommand<'a> {
    Place { orders: &'a [OrderKey] },                                 // PlaceLimit = batch of one (10 N2); one transport
    Cancel { op: CancelOp, cause: CancelCause, keys: &'a [OrderKey] }, // CancelOrder, resolved CancelBatch, released deferred cancels
    CancelScope { op: CancelOp, cause: CancelCause, scope: CancelScope }, // CancelMarket: Outcome(o) | Market
    CancelAll { op: CancelOp, cause: CancelCause },
    Split { op: OpKey, size: Qty },
    Merge { op: OpKey, size: Qty },
}
```

Order details (side, type, price, `OrderSize`, post-only, `expire_at_ms`,
signed amounts; 10 §7.2, 11 TK4) are read from the ledger's immutable order
records; commands carry keys only. `cause` is `Strategy(op)` for strategy
cancels and `WindowEnd`, `KillSwitch`, `StrategyPanic` or `Operator` for
engine-originated ones (10 §10.2; 12 §8.3). `CancelOp` (with its `CancelSeq`)
is defined in 10 §6; engine-originated cancels get one too, because they pass
through the OM. The WIP `ExecCommand::Split.cost_per_share`
(`native/crates/pmb-core/src/execution.rs:30-35`) is dropped (10 N3).

### 2.2 Trait

```rust
pub trait Execution: Send {
    /// Dispatch one command decided at `stamp`. Never blocks, never does I/O.
    fn submit(&mut self, stamp: TsMs, cmd: ExecCommand<'_>, cx: &ExecCtx<'_>, out: &mut EventQueue);
    /// Earliest scheduled action time (§2.3).
    fn next_due(&self) -> Option<TsMs>;
    /// Execute every action due at exactly `next_due()`, in (class, seq) order (§4.3).
    fn run_next_due(&mut self, cx: &ExecCtx<'_>, out: &mut EventQueue);
    /// Journaled mode: execute every action due at or before `t.due`.
    fn on_timer(&mut self, t: &TimerFired, cx: &ExecCtx<'_>, out: &mut EventQueue);
    /// After a real market event was applied to the shared book.
    fn on_market_event(&mut self, now: TsMs, ev: &MarketEvent, cx: &ExecCtx<'_>, out: &mut EventQueue);
    /// Live inputs: REST responses, user-WS frames, reconciliation and sidecar results.
    fn on_account_input(&mut self, _now: TsMs, _input: &AccountInput, _cx: &ExecCtx<'_>, _out: &mut EventQueue) {}
    /// Backtest end of input: from now on `next_due()` reports every pending action,
    /// so the loop can drain the scheduler (12 §5.1). No-op for exact-time models.
    fn on_end_of_input(&mut self) {}
    /// Strategy-visible adjustments to the recorded book (realistic, §6.11).
    fn book_overlay(&self) -> Option<&BookOverlay> { None }
    fn diagnostics(&self) -> &ExecDiagnostics;
}
```

`ExecCtx` borrows the `SharedMarket` (recorded books, rules in force, window,
`MarketInfo`, skew estimate, 12 §4.4), the ledger's order records and the
`ModelConfig`. The WIP `advance_to` hook (`execution.rs:61-64`) becomes
`next_due`/`run_next_due` with the tie rule of §4.3.

### 2.3 Scheduler modes

| Mode | Used by | When a due action runs |
|---|---|---|
| `SelfTimed` | Backtest (both profiles), candidate groups | In step (a) of 12 §5.1: every action due strictly before the next envelope's `at`, one cascade per due time; the scheduler is drained at end of stream in realistic |
| `Journaled` | Paper, CLOB V2 (its own deadlines), journal replay | Only on a `Timer(due)` envelope, produced as described below |

Journaled timer production (live and paper):

- **TS1. Synthesized before inputs.** Before the core applies an input envelope
  `e`, it checks `next_due()`. For every due time `t < e.at` it synthesizes
  `Timer(t)`, journals it as an input envelope with its own `seq`, and
  processes it before `e`. Live therefore follows the SelfTimed strict `<` rule
  up to ingress-stamp precision, and paper matches a V4 backtest of the same
  envelopes instead of differing by timer lateness, which would be largest in
  bursts, exactly when taker delays release.
- **TS2. OS timer when idle.** When no input arrives, the runtime's OS timer,
  armed at `next_due()`, injects `Timer(t)`. The fire lateness
  (`recv_mono − t`) is journaled and shown as a timer-lateness histogram in the
  latency report (50 §18, 16 §12.3); 50 §13.5 attributes divergences to it.
- **TS3. Event time.** A timer's actions run with event time `max(t, now)`
  (12 K2, 50 §5.3). The due time `t` stays the exchange-side time in
  `OrderLifecycle` and ledger records.
- **TS4. Replay.** Journal replay reads `Timer` envelopes back and synthesizes
  none. The core asserts that each replayed timer's `t` equals `next_due()`
  and that no action due before the next input was left unsynthesized; either
  mismatch is a determinism failure. Equality is proven on outputs (01 M8).
- A timer that finds no due action does nothing.

### 2.4 Contract rules

| # | Rule |
|---|---|
| X1 | Every method costs O(work done), never blocks, never performs I/O or syscalls, and does not allocate in steady state |
| X2 | Synchronous events (appended inside `submit`) are allowed only in ts-compat: placements and cancels with effective latency 0 (TC-E1) and split/merge (TC-E9). The realistic simulator (every axis value), paper and CLOB V2 never emit exchange events synchronously |
| X3 | Every emitted event names its `OrderKey` or `OpKey`. Fills carry their `fee`, computed once by the adapter's fee model (10 §9.1). Adapters never address orders by cid |
| X4 | The order of events emitted by one call is part of the output |
| X5 | Adapters never mutate the ledger and never see the strategy. The core never branches on adapter kind |
| X6 | `on_market_event` is never called for synthetic ticks, nor in ts-compat for out-of-window events (12 §5.2) |
| X7 | Exactly one terminal event per `OrderKey` (10 S1) |
| X8 | Randomness only from the market seed's counter-based component streams, keyed by entity (§6.8) |

## 3. Adapters

| Adapter | Used by | Inputs | Fills from | Scheduler | Sends orders |
|---|---|---|---|---|---|
| `Simulator` (ts-compat composition) | Backtest, ts-compat | Recorded | §5 | SelfTimed (compat latency releases at market events) | No |
| `Simulator` (realistic composition) | Backtest, realistic | Recorded | §6 | SelfTimed, exact time | No |
| `Paper` | Live paper (D28) | Live envelopes | Realistic simulator | Journaled | No |
| `Paper(DecisionsOnly)` | Diagnostics | Live envelopes | None: accept and open, never fill (TS dry-run, `src/trading/OrderManager.ts:508-521`) | — | No |
| `ClobV2` | Live real orders (user-launched after G4) | Live envelopes plus REST and user-WS inputs | The exchange | Journaled (adapter deadlines) | Yes |
| `JournalReplay` | Backtest path over a paper or live journal | Journal | Paper journal: realistic simulator with journaled timers. Live journal: `ClobV2` normalizer in replay mode (§9.4) | Journaled | No |

## 4. Simulator architecture

### 4.1 Exchange truth and client knowledge

The simulator keeps the **exchange truth**: the state of each own order at the
exchange and the book overlay. The ledger (12 §9) is the **client knowledge**,
updated only by delivered reports. In ts-compat both coincide because reports
are instant. In realistic they are separated by ack and report latencies, so a
cancel can race a fill and a fill can be reported after the cancel
acknowledgement, as live.

### 4.2 Simulated book

- The recorded book (15 §2.1) lives in `SharedMarket`, is shared by all
  candidates and is never mutated by a session (15 I-5).
- Each session keeps a sparse overlay: depletion deficits keyed by (outcome,
  side, price), and own resting orders keyed by (outcome, side, price) in rest
  order with their fill-model state.
- Effective opposite liquidity at a level = max(0, recorded size − deficit).
  With `depletion: none` (ts-compat, A/B arm) no deficit is kept.

### 4.3 Scheduler

| Action | Created by | Effect |
|---|---|---|
| `PlaceArrive{keys}` | `submit(Place)` | The exchange processes the orders in batch order (§6.2) |
| `CancelArrive{target}` | `submit(Cancel…)` | §6.6 |
| `DelayRelease{key}` | Arrival of a marketable order under a taker delay | §6.3 |
| `GtdExpire{key}` | A GTD order starts resting | §6.6 |
| `MarketClose` | `Control(WindowEnd)` (realistic), for exchange time `end` | §6.6 |
| `ChainComplete{op}` | `submit(Split \| Merge)` (realistic) | §6.10 |
| `Deliver{report}` | Any exchange-side change | Appends the report's events (§6.7) |

- Order: (time, class, seq). Class 0 = exchange-side actions, class 1 =
  `Deliver`, so a report never precedes its cause at equal time. `seq` is a
  per-session scheduling counter.
- **Tie with inputs:** envelopes stamped `T` are processed before actions due at
  `T` (12 §5.1). TS uses the same order (due actions run after the tick's event
  is applied, `src/trading/execution/BacktestExecution.ts:765-801`), and the
  rule is conservative for cancels racing fills and placements racing liquidity
  removal.
- Exchange-side times: an action for exchange time `X` is placed at loop time
  `max(now, X + skew)`, with `skew` read when the action is scheduled (12 §4.4
  XT3).
- Storage: a binary heap with reused capacity; O(log n) per action.
- Exchange-side transitions are reported to the trace as `OrderLifecycle` and
  fills as `FillDetail` (22 §2), stamped with the action's due time; delivered
  account events carry `max(due, now)` (§2.3 TS3).

### 4.4 Model traits and profile composition

| Trait | Decides |
|---|---|
| `LatencyModel` | When commands reach the exchange and when reports reach the client (§5.1, §6.8) |
| `FillModel` | Taker matching and depletion (§6.4); which resting orders fill, how much and when (§6.5) |
| `FeeModel` | Fee per fill, reservation fee, fee bound for collateral BUYs (§5.1, §6.9) |
| `ReportModel` | Which status events are produced and when (§5.1, §6.7) |

- A profile is a **fixed composition** (§7.1): ts-compat = the compat models of
  §5.1 + the compat taker + synchronous split/merge + `CoreRules::TsCompat`;
  realistic = the realistic models of §6 + `CoreRules::Realistic` (12 §2.3).
- Six model choices are runtime **axes** in `ModelConfig.execution.models`
  (§7.3). In ts-compat they are pinned to their compat values. In realistic each
  axis MAY take an alternative value, which is how A/B arms and calibration
  variants run from one binary (D14). Core rules are never switched at runtime.
- An axis's alternative value reuses an existing implementation (mostly the
  compat model, with the small adaptations stated in §5.1), so the axes add no
  code paths beyond the two profiles plus `trade_through` and
  `reset_on_update`.
- Whether model selection uses generics (monomorphized) or enum dispatch is a
  measured choice (16); behavior is identical either way.

### 4.5 Fills

The `Fill` struct is defined in 10 §9.1 (`FillKey`, `trade: TradeSeq`,
outcome, side, price, qty, fee, liquidity, `at`, `exchange_ts`, `late`). Its
unit is defined here, once, for every adapter (10 I3 states the same rule from
the identifier side):

- **F-U1. One `Fill` per (own order, trade, price level).** A trade is one
  exchange match: one taker order against one or more maker orders (live: one
  trade id). As taker, maker legs at the same price are aggregated into one
  `Fill` (qty = Σ leg amounts); legs at different prices are separate fills. As
  maker, one `Fill` per (own resting order, trade), at the order's price.
- **F-U2. Simulator.** One taker fill per (own order, effective level) of a
  walk, and one maker fill per (own resting order, match). That is the TS unit
  (one fill per book level, `BacktestExecution.ts:146-170`), so `tradeCount`,
  `tradeAsMaker` and `tradeAsTaker` (21 §11) mean the same in backtest and live.
- **F-U3. Live.** The CLOB V2 adapter keeps the raw legs
  (`{tradeId}:T:{makerOrderId}`, `{tradeId}:M:{ourOrderId}`, 50 §8.2.5) for
  dedupe, the journal sidecar and the ledger side tables (22 §4.2, §6.5), and
  emits the aggregated core `Fill`. Its fee is the sum of per-leg fees computed
  by `ExchangeRules` at the exchange's fee granularity (11 FC4: per maker match
  or per fill record; verified on day 0, §6.14).
- **F-U4. Rounding dust.** The simulator cannot know how many maker orders rest
  at a level, so it computes one fee per fill. If the exchange charges per leg,
  the live fee of a fill with `k` legs can differ by at most 0.000005 USDC ×
  (k − 1). The D35 fee check compares the live adapter's per-leg computation
  with charged amounts and is unaffected; the dust affects only
  backtest-vs-live comparisons, and its bound is recorded in the calibration
  validity envelope (51).
- The cash moved by a fill is defined in §6.4.1 (realistic) and 10 R5/R6
  (ts-compat). Exchange trade ids and per-leg details live in the ledger side
  tables (22), never in the core struct.

## 5. ts-compat profile

ts-compat exists only to prove the port (01 §1). It reproduces TS execution with
compat model implementations and the rule list below; it does not copy TS
structure (R4). Its rule values are fixed by 11 §4. Its composition is pinned in the
ts-compat object of the defaults file (§7.4).

### 5.1 Compat models

**Latency — `NextRealTick` (`models.latency = compat`; TC-E1, TC-E2).**

- One delay `d = execution.compatLatency.delayMs` for every placement and every
  cancel kind (`cancelLatency: true`, `src/backtest/runSingleMarket.ts:185-190`).
  Jitter `j = execution.compatLatency.jitterMs` applies only when `d > 0`
  (`runSingleMarket.ts:187`).
- `execute_at = max(stamp, stamp + d + jitter)`, jitter a seeded integer in
  `[−j, j]` from the `compat_jitter` stream keyed by `OrderKey` or `CancelSeq`.
  TS uses unseeded `Math.random` (`BacktestExecution.ts:239-242`), so parity
  runs MUST use `j = 0` (21 §6).
- ts-compat: `execute_at ≤ stamp` → executed inside `submit` (synchronous
  events). Otherwise queued by (`execute_at`, seq).
- Queued actions run only inside `on_market_event` of a real in-window tick with
  `tick.ts ≥ execute_at`, after that tick's book update, sorted by
  (`execute_at`, seq), stamped with the tick's ts, against the post-event book
  (`BacktestExecution.ts:765-801`). They never run on synthetic or out-of-window
  ticks and are discarded at end of stream. `next_due()` returns `None`.
- As a realistic A/B arm: no synchronous events (X2); every scheduled action
  (arrivals, delay releases, expiries, reports, chain completions) is released
  at the first real market event passed to the execution model (12 §5.2) at or
  after its due time; ack and fill-report latencies are 0; settlement and chain
  latencies come from `latency.components`. `next_due()` returns `None` while
  input remains; after `on_end_of_input` it reports the pending actions, which
  then run in time order when the loop drains the scheduler.

**Taker — `CompatTaker` (TC-E3, TC-E4).** Per order of a `Place`, in batch
order, at execution:

1. Post-only crosses the best opposite price (BUY: limit ≥ best ask; SELL:
   limit ≤ best bid; equality crosses; an empty side never crosses) →
   `OrderRejected(PostOnlyWouldCross)` (`BacktestExecution.ts:37-54`).
2. `OrderAccepted`, then `SettlementUpdate{fill: None, status: Matched,
   size_matched: 0}` (10 V1; `BacktestExecution.ts:526-551`).
3. FOK: `fillable` = Σ opposite level sizes within the limit. If `fillable <
   size` → `OrderDone(Killed, filled: 0)`. Else walk the levels: fills,
   `OrderDone(Filled)`, `SettlementUpdate{fill: None, status: Confirmed,
   size_matched: size}` (`BacktestExecution.ts:553-605`).
4. GTC/GTD: if `fillable > 0`, walk the levels; then `OrderDone(Filled)` if
   nothing remains, else rest and emit `OrderOpen` (`BacktestExecution.ts:607-627`).
5. FAK (no TS oracle, 10 §7.1): walk the levels; if anything remains,
   `OrderDone(Killed, filled)`; never rests.

Walk: opposite levels best first while the level price crosses the limit; one
TAKER fill per level of `min(remaining, level size)` at the level price. The
recorded book is never changed, so later orders in the same batch, tick or
latency window see the same liquidity (TC-E3). FOK BUY is sized in shares
(TC-E4, 10 O3).

**Maker — `WorstQueueCompat` (`models.maker = worst_queue`; TC-E5).** Inside
`on_market_event` of each real in-window tick, after queued actions, for each
resting order in rest order:

- GTD with `tick.ts ≥ expire_at` → `OrderDone(Expired, filled)`. Expiry is
  checked first, so it wins over a fill on the same tick, and happens exactly at
  `expire_at` (`BacktestExecution.ts:803-816`).
- BUY with best ask `<` limit, or SELL with best bid `>` limit (strictly
  through) → one MAKER fill of the **whole** remaining size at the limit, fee 0,
  then `OrderDone(Filled)` (`BacktestExecution.ts:73-137, 818-833`). No volume
  cap, no partial fills, no depletion.
- An early exit is allowed when no resting order can expire or fill on this
  tick, provided the emitted events are identical.
- As a realistic A/B arm only the fill rule is replaced; expiry stays the
  realistic `GtdExpire` action (§6.6).

**Cancels (TC-C5, TC-C10).** `CancelOrder` is bound to the cid's key current at
decision time (`BacktestExecution.ts:680-682`). At execution, if that key is
resting → `OrderDone(Canceled, filled = size − remaining)`; otherwise no event
(`BacktestExecution.ts:647-673`). `CancelBatch` applies the same to each
OM-resolved key; `CancelMarket` resolves its scope at execution over resting
orders (`BacktestExecution.ts:744-751`); `CancelAll` cancels every resting order
at execution (`BacktestExecution.ts:690-709`). All use delay `d`.

**Fee — `Fee700Bps4dp` (`models.fee = flat_700bps_4dp`; TC-E7).** `fee = 0.07 ×
p × (1 − p) × size` rounded per 10 §3.3 R8 (4 dp; `< 0.0001` → 0;
`src/trading/fees.ts:18-42`). Every TAKER fill is charged
(`BacktestExecution.ts:236`); MAKER fills pay 0. Reservations use the same fee
at the limit price (10 R9; `src/trading/capital.ts:16-28`). Integer arithmetic
only; JS float tie behavior is not emulated (R1).

**Reports — `CompatStatus` (`models.reports = compat`; TC-E8).** The status
events of the taker steps above; nothing for GTC/GTD fills; never `Mined`. They
are delivered to strategy callbacks, because TS delivers its `ws_order_update`
events (`src/trading/StrategyRunner.ts:628-675`); the parity trace omits them
(22 §3.2; `src/backtest/parity/trace.ts` `TRACED_EVENT_KINDS`). Accepts and
fills are delivered instantly.

**Split/merge (TC-E9).** Synchronous inside `submit`, no latency, never failing:
`PositionsSplit{op, size, cost = size}`; merge `actual = min(requested,
delivered Up, delivered Down)` → `PositionsMerged{actual}`, nothing when
`actual ≤ 0` (`BacktestExecution.ts:244-328`).

### 5.2 Rule list

Every ts-compat rule that differs from realistic. "Realistic" is the rule of the
realistic composition; "Fix" is the realistic fix of §7.1 whose report covers it.

| ID | ts-compat rule | Realistic rule | TS evidence | Spec | Fix |
|---|---|---|---|---|---|
| TC-C1 | Validation: size > 0, price > 0, post-only only GTC/GTD, GTD `expire_at ≥ stamp + 60 s`; no tick, bounds, minimum or precision checks (11 §4) | `ExchangeRules` validation at decision and at arrival | `OrderManager.ts:189, 756-780` | 12 §7.4 | RF02 |
| TC-C2 | TS risk pass and ordering: whole list first, delivered-submission view, counters include later-deduped intents, invalid sizes uncounted, risk rejections emitted first, rejections for active cids dropped; dedupe after risk | Per intent in order: guards → dedupe → validation → risk on the full ledger → funding (12 §7.2, §8.1) | `OrderManager.ts:143-223`; `riskLimits.ts:47-219` | 12 §7.2, §8.2 | RF14 |
| TC-C3 | Loss stop blocks every placement incl. SELL exits | Blocks BUYs and splits only | `riskLimits.ts:84-86, 165-170` | 12 §8 | RF14 |
| TC-C4 | No SELL inventory check; naked sells fill; quantity clamped at 0, `oversold_qty` counted | `sellable` check and share reservation | `capital.ts:30-40`; `Portfolio.ts:924-976` | 12 §7.5, §9.5 | RF14 |
| TC-C5 | `CancelOrder` skips OM resolution, bound to the decision-time key | Resolved like `CancelBatch` | `OrderManager.ts:538-562`; `BacktestExecution.ts:680-682` | 12 §7.3 | RF14 |
| TC-C6 | `CancelBatch` of an unacknowledged order → `CancelFailed(MissingExchangeOrderId)` | Deferred until the ack is delivered | `cancellation.ts:114-118` | 12 §7.3 | RF14 |
| TC-C7 | `MergePositions` with size ≤ 0 → no event | `MergeFailed(InvalidSize)` | `OrderManager.ts:411` | 12 §7.3 | RF14 |
| TC-C8 | Callback intents stamped with the last tick ts | Stamped with `now` | `StrategyRunner.ts:679` | 12 §4.2 | RF15 |
| TC-C9 | Window gate per TS input mode; out-of-window = books only | D23 on the receive clock | `runSingleMarket.ts:306-315` | 12 §5.4 | RF13 |
| TC-C10 | A cancel whose target is unknown or terminal at execution: no event | `CancelFailed(ExchangeNotCanceled)` | `BacktestExecution.ts:656-659` vs `LiveExecution.ts:415-430` | §6.6 | RF14 |
| TC-C11 | TS clocks: `tick.ts` = TS tick timestamp incl. synthetic clamp; Telonex loop clock `E`, feed clock `max(L, E)`; no `md`; `xnow` = decision stamp | Receive clock: synthesized `R` on Telonex, feed clock = `now`, `tick.ts` = `now`, `xnow = now − skew` | `src/market/syntheticTick.ts:61`; `wireBacktestExternalFeeds.ts:46-64` | 12 §4 | RF15 |
| TC-C12 | No batch cap; cancel-id cap 3000 | Batch cap 15, cancel-id cap 1000 (11 §9) | `cancellation.ts:69`; `LiveExecution.ts:166-178` (live only) | 12 §7.3 | RF02 |
| TC-C13 | No action at market end; undue actions discarded at end of stream | Window-end cancel at client `end`, exchange-side market close; scheduler drained | `runSingleMarket.ts:491-590` (stats from final positions; nothing cancels resting orders or runs pending actions) | 12 §5.1, §5.4; §6.6 | RF13 |
| TC-E1 | `NextRealTick` latency, one delay for place and cancel | Exact-time scheduler, separate seeded latencies with `md` | `BacktestExecution.ts:195-242, 765-801` | §5.1, §6.8 | RF05 |
| TC-E2 | Jitter only when delay > 0; parity requires 0 | Distributions per component | `runSingleMarket.ts:187`; `BacktestExecution.ts:240` | §5.1 | RF05 |
| TC-E3 | Taker walk without depletion | Depletion overlay | `BacktestExecution.ts:139-190, 367-368, 523-524` | §6.4 | RF07 |
| TC-E4 | FOK BUY sized in shares | FOK/FAK BUY sized in collateral, fee on top (10 O2) | `BacktestExecution.ts:395-396` | §6.4 | RF04 |
| TC-E5 | Worst-queue maker: whole remainder on strict trade-through, rest order, expiry first, expiry at `expire_at` | Queue model, partial fills; expiry 60 s early (RF03) | `BacktestExecution.ts:73-137, 803-834` | §6.5, §6.6 | RF08, RF09 |
| TC-E6 | Free remainder fill (emergent, §5.3) | Removed by depletion and sized maker fills | research/early-audits.md:34 | §5.3 | RF07, RF08 |
| TC-E7 | Fee 700 bps × p(1−p), 4 dp, floor 0.0001, all dates | Per-market `feeSchedule`, eras (11 §5) | `fees.ts:10-42` | §6.9 | RF01 |
| TC-E8 | Compat status events, instant reports, no `Mined` | Settlement reports with latencies, `Failed` reversal | `BacktestExecution.ts:378-443` | §6.7 | RF11 |
| TC-E9 | Split/merge synchronous, never failing | Async with latency and failure (D25) | `BacktestExecution.ts:244-328` | §6.10 | RF12 |
| TC-E10 | No taker delay, no arrival-time re-validation, no market-closed rejection | All three | 11 §4 | §6.2, §6.3 | RF02, RF03, RF06 |

### 5.3 Emergent quirk: the free remainder fill

A crossing GTC larger than the visible depth takes the depth and rests its
remainder at the limit. Because the recorded asks below the limit are not
depleted (TC-E3), `WorstQueueCompat` (TC-E5) fills the whole remainder at the
limit with zero fee on the next real tick, or on the same tick when the
placement was delayed, since queued actions run before the maker scan
(research/early-audits.md:34; `BacktestExecution.ts:447-469, 803-822`). It is
not coded separately. The exerciser's crossing order `x5` (60) covers it.

### 5.4 Not reproduced (classified in PARITY.md, 60)

| TS behavior | Reason | Parity effect |
|---|---|---|
| Merge proceeds missing from PnL; basis kept (`Portfolio.ts:553-586`; `src/backtest/stats/marketStats.ts:141-169`) | TS bug | `pnl`, `cost` and realized PnL differ in markets with merges |
| Oversell: cash credited in full, realized PnL on `min(size, qty)` (`Portfolio.ts:925`; `capital.ts:39`). Rust clamps the quantity as TS does but realizes the full proceeds (12 §9.5) | TS bug (identity break) | Realized PnL and possibly `pnl` differ in oversell markets |
| `round2`/`round8` float residues (`src/trading/utils/rounding.ts:6-12`) | R1; below tolerance (10 §3.3) | None at R5 tolerance |
| `1e-8` funding tolerance (`OrderManager.ts:153`) | R1 | Boundary flips classified |
| Silent queue drop on drain overflow (`StrategyRunner.ts:574-585`) | TS bug | The Rust candidate fails `cascade_limit` (12 §6.3); market classified |
| Unseeded jitter (`BacktestExecution.ts:240`) | Not deterministic | Parity runs use `j = 0` |
| `Date.now()` fallbacks (`StrategyRunner.ts:314, 328, 457, 541, 679`) | R7 | None (timestamps always present) |
| 500-fill ring and harvest filtered by market (`Portfolio.ts:140`; `runSingleMarket.ts:322-337`) | Lossy | Rust counts every fill |
| `ws_order_update(CANCELED)` callback after a FOK kill (`BacktestExecution.ts:553-569`) | No `SettlementStatus` for it (10 §9.2); it changes no rank | Intents returned from that callback in TS would be a mismatch, classified |
| Unbound delayed `cancel_order` resolving by cid at execution, which can hit a newer generation (`BacktestExecution.ts:652-654, 681-682`) | TS bug (the bound case is already guarded in `cancellation.test.ts`) | Classified if hit |
| Technical-indicator wall-clock wait (`StrategyRunner.ts:404-434`) | R7 | 14 §12.5 |

### 5.5 Parity-run constraints

- Jitter 0; delays per the M2 matrix (0 and one fixed non-zero value, 01 §6),
  applied as an override of `compatLatency.delayMs` on the pinned ts-compat default
  (§7.4).
- Identical, pinned `ModelConfig` on both sides, including feed latencies, PTB
  latency, Chainlink gap and resolved feed availability (21, 60).
- TS oracle pin per 01 §8.
- After gate 2, a change to any TC rule needs a 02-decisions entry, a new
  defaults file version and a parity re-run (00 §3.2).

## 6. Realistic profile

Values come from `ExchangeRules` (11). Behaviors that the docs do not settle are
verified by the day-0 probes (§6.14, 51) before realistic becomes default (G3).
Exchange-side times use the estimate of 12 §4.4.

### 6.1 Order lifecycle

| Step | Time (loop clock) | Exchange truth | Client knowledge (delivered) |
|---|---|---|---|
| Decide | `t0` | — | `OrderSubmitted`, reservation (12) |
| Arrive | `t1 = t0 + L_place` | Checks, then rest, delay, match or reject (§6.2) | — |
| Ack | `t1 + L_ack` | — | `OrderAccepted` (+ `OrderOpen` or `OrderDelayed`) or `OrderRejected` |
| Match | `tm` | Fills, depletion | — |
| Fill report | `tm + L_fill` | — | Fills, `SettlementUpdate{Matched}`, `OrderDone(Filled)` if complete |
| Settlement | `tm + L_mined`, `L_confirmed`, `L_failed` | — | `SettlementUpdate{Mined \| Confirmed \| Failed}` |

The `L_*` values are the effective latencies of §6.8.

### 6.2 Arrival

At `PlaceArrive` (loop time `τ`, exchange time `τ − skew`), for each order in
batch order:

1. Arrival at or after the exchange-side market close (§6.6) →
   `OrderRejected(MarketClosed)` (11 §11).
2. Re-validate against the rules in force at arrival (a `tick_size_change` may
   have landed in flight; 11 §7.5) → `OrderRejected(<reason>)`.
3. GTD lead at arrival (11 GT2): stated expiry ≥ arrival exchange time + 180 s,
   else `OrderRejected(GtdLeadTooShort)`.
4. Post-only: crossing the effective opposite best, own resting orders included
   (§6.12) → `OrderRejected(PostOnlyWouldCross)` (11 §11).
5. Marketable = it would match the effective opposite best, own orders excluded
   (11 TD1):
   - not marketable: GTC/GTD rest (§6.5); FOK/FAK are killed (§6.7, verify);
   - marketable on a market with the taker delay enabled (11 §6.3) and
     `models.takerDelay = on`: delayed (§6.3);
   - marketable otherwise: match now (§6.4); the remainder rests (GTC/GTD) or
     is killed (FAK, FOK).

### 6.3 Taker delay (RF06)

- The delay is the row of 11 §6.2 in force at the arrival's exchange time
  (keyed by exchange time, not market start; the WIP table is wrong, 11 TD7),
  on markets where `taker_delay_enabled` (11 §6.3).
- During the delay the order is not on the book. A cancel arriving then fails
  with `CancelFailed(NotCancelableDuringDelay)` in eras where the order is
  irrevocable, and succeeds in eras where it is cancellable (11 TD4, §6.2
  column "Cancellable in window").
- At release the exchange re-validates against the state at that moment (11
  TD3): failure → `OrderRejected`. Otherwise the order matches the book at that
  moment (§6.4); a resting type's remainder rests with queue position from the
  release time; a market type's remainder is killed; a FOK whose full size or
  amount is not fillable is killed with no fills.
- Post-only orders never enter the delay (11 TD1).

### 6.4 Taker matching, depletion, collateral-sized BUY

- Walk effective opposite levels best first while the price crosses the limit,
  skipping own resting orders (§6.12). One TAKER fill per level at the level
  price (§4.5); fee per §6.9.
- Shares-sized orders (GTC, GTD, SELL FOK/FAK): `min(remaining, effective level
  size)` per level.
- **Collateral-sized BUY (FOK/FAK, RF04; 10 O2).** Amount `A` = the order's
  `Collateral` size, or the conversion of a `Shares` size at the limit price
  (10 O2). Per level: §6.4.1. The walk stops when the remaining amount cannot
  buy one size unit. The fee is charged on top of `A`. FOK is killed without
  fills unless the walk spends `A` down to less than one size unit; FAK keeps
  the partial fill and kills the rest. Received shares may exceed a converted
  share size when prices are better than the limit, as live.
- **Depletion (RF07)**, `models.depletion`:
  - `persistent_deficit` (realistic): effective size = max(0, recorded −
    deficit); the deficit clears when the recorded level disappears (size 0, or
    absent from a replacing snapshot);
  - `reset_on_update` (A/B arm, optimistic): the deficit clears on any recorded
    update of that level;
  - `none` (ts-compat, A/B arm): no deficit.
  Maker fills against crossing liquidity (§6.5) add to the deficit too. Total
  fills against a level never exceed the size the recorded stream offered there
  (property test, 60).

#### 6.4.1 Fill amounts

How many USDC micros one fill moves (before the fee), for the realistic
simulator and for the ledger in realistic, paper and live. All products and
quotients are computed on `i128` in micros. `(makerAmount, takerAmount)` are the
order's signed amounts (11 TK4), computed once by `ExchangeRules` when the order
is accepted and stored on the record (12 §9.2).

| Role and order | Shares `q` | USDC moved |
|---|---|---|
| Maker SELL at its limit | Matched quantity | Received: `Floor(q × takerAmount / makerAmount)` (CTF `calculateTakingAmount`) |
| Maker BUY at its limit | Matched quantity | Paid: `Ceil(q × makerAmount / takerAmount)` (the smallest maker amount that yields `q` under the same truncation) |
| Taker, share-sized, at a maker level price `p` | `min(remaining, effective level size)` | BUY paid `Ceil(p × q)`, SELL received `Floor(p × q)` (10 R5/R6). The counterparty's signed amounts are unknown in backtests; live uses the same rule, and reconciliation (50 §14) counts per-fill differences as dust |
| Taker, collateral-sized BUY, at level `p` | `min(effective level size, Qty::for_collateral(remaining A, p, Floor))` at the size precision of 11 §7.3 (10 R7) | Paid `min(remaining A, Ceil(p × q))` |

- ts-compat keeps 10 R5/R6 with `HalfAwayFromZero` on `p × q` for every role.
- For a BUY order `makerAmount` is the collateral and `takerAmount` the shares;
  for a SELL order the reverse (11 TK4).
- This table is the single definition; 10 R5/R6 (realistic column) and 11 TK4
  are to point here (§12). The rules are verified on day 0 (§6.14 item 9; 51
  R7 for the collateral BUY, the maker probes of 51 §6.4 for maker partial
  fills).

### 6.5 Resting orders and fill models

State of an own resting order: outcome, side, price `P`, remaining `r`,
queue-ahead `q`, rest time. `S(P)` is the recorded size of others at (outcome,
side, `P`), decontaminated when applicable (§6.13). Several own orders at one
price queue among themselves by rest time; earlier own remaining counts as
ahead.

**`queue` (realistic maker model, RF09).** Prints mode is on when the input
carries `LastTrade` events (Recorder V4, journals; 15 §1) and
`makerQueue.prints = auto`, and off for telonex-delta, which has no trade
prints until follow-up F2 (research/early-audits.md:44).

| Rule | Behavior |
|---|---|
| Q1 Rest | `q = S(P)` when the order starts resting |
| Q2 Level update | From `s` to `s′`: if `s′ ≥ s`, `q` is unchanged (joiners queue behind). If `s′ < s`, the decrease is classified by Q4 into trade volume (handled at print time) and cancel volume `c`; `q ← max(0, q − α·c)`. Always `q ← min(q, s′)` |
| Q3 Crossing liquidity | When effective opposite size crosses `P` (BUY: asks ≤ `P`; SELL: bids ≥ `P`), own orders fill against it at `P` as MAKER, best own price first, then rest time, up to `min(r, size)`; the consumed opposite size is depleted (unless `depletion = none`). A crossing recorded level implies `S(P) = 0`, so `q = 0` by Q2 |
| Q4 Prints (prints mode) | Only prints whose aggressor hits our side count. Print at `P` of size `v`: `fill = min(r, max(0, v − q))`, then `q ← max(0, q − v)`. Print at a worse price for the aggressor than `P` (BUY: below `P`): price priority puts us first, `fill = min(r, v)` (`S(P)` is 0 there). Each unit of level decrease is classified once: as trade if matched by print volume at that level within `printMatchWindowMs` before or after the decrease, else as cancel. A decrease seen before its print is first booked as cancel and re-classified when the print arrives (undo `α·x`, then apply the trade rule); a print seen first consumes `q` at once and the later decrease is not counted again |
| Q5 No-prints mode | Q4 off; every decrease at our level reduces `q` by `α·d` (99.13% of top-of-book decrease volume is cancels, `protocols/pair-fable/memory/experiments/hf-fill-probe.md:209-213`); fills come only from Q3 |
| Q6 Approximation | The recorded book is not adjusted for other traders' orders that our fill would have shielded |

- `α = execution.makerQueue.cancelAheadShare ∈ [0, 1]`: the share of non-trade
  decreases at our level that happen ahead of us, the one explicitly calibrated
  queue parameter (research/requirements-sweep.json `maker-queue-parameter`).
  Default `0.5`, uncalibrated; fitted on V4 tape in M7 and on live maker
  episodes in M10 (51). Every A/B and calibration report shows α ∈ {0, 0.5, 1}.
- Partial maker fills are allowed; every fill carries the matched quantity.

**`trade_through` (RF08; also the conservative reference arm).** Fills only
from strictly-through opposite liquidity (BUY: asks `<` P), sized by that
liquidity, partial fills allowed, depleted; `q` is ignored. A/B reports show it
next to `queue`, because worst-queue is wrong in both directions: too
pessimistic for spread-improving orders, too optimistic on size
(research/approach-audit.json execution audit; hf-fill-probe E-025: worst-queue
filled 944 shares per market vs 610 at the trade-confirmed front of queue,
`hf-fill-probe.md:200-226`).

**`worst_queue`** (A/B arm): the fill rule of `WorstQueueCompat` (§5.1).

### 6.6 Cancels, GTD expiry, window end and market close

- **Departure.** The OM defers a cancel of an unacknowledged order until its ack
  is delivered (12 §7.3, `CancelState::Deferred`), so the simulator sends every
  cancel when it is submitted. Variant `execution.cancelBeforeAck: immediate`
  (simulator A/B only, §6.14 item 6) lets the OM dispatch at once.
- **`CancelArrive`** at `t`, per target: resting → removed and reported (§6.7)
  with `Canceled(cause)` from the command; delayed → per §6.3; terminal at the
  exchange, or not yet arrived (an `immediate` cancel that overtook its
  placement) → `CancelFailed(ExchangeNotCanceled)`; in the overtaking case the
  placement later arrives and rests, as it would live.
- `CancelScope` and `CancelAll` resolve their scope at arrival over orders
  resting or delayed at the exchange. An empty scope emits nothing, as live
  (`canceled: []`).
- **GTD (RF03):** `GtdExpire` at exchange time stated expiry − 60 s (11 GT3),
  scheduled when the order starts resting at loop time `max(now, that + skew)`
  (12 XT3) → `OrderDone(Expired, filled)`.
  TS expires at `expire_at` (TC-E5).
- **Window end (RF13, D23), client side.** At loop time `end` the core's
  `Control(WindowEnd)` makes the OM send `CancelMarket{Market}` with cause
  `WindowEnd` (12 §5.4, §10). It travels with `L_cancel` and resolves at
  arrival like any scope cancel; orders it cancels end `Canceled(WindowEnd)`.
  Live sends the same cancel as `DELETE /cancel-market-orders` at local `end`
  (50 §6.4).
- **Market close, exchange side.** `MarketClose` is scheduled when
  `Control(WindowEnd)` is processed, for exchange time `end` (loop time
  `max(now, end + skew)`): rule `market.closed` of 11 §11 and §14, assumed
  until the day-0 probe establishes the real close time and whether the
  exchange cancels resting orders (§6.14 item 8). From then on arrivals are
  rejected `MarketClosed`, resting and delayed orders end
  `OrderDone(Canceled(MarketClosed), filled)` (reported with `L_fill`), and
  matching stops. Under the assumed close at `end`, the window-end cancel
  reaches the exchange at about `end + cancel` exchange time and finds nothing;
  it decides the outcome only if the probe shows a later close. Every market
  output in which `market.closed` affected an order lists it in
  `unverifiedRules` (11 §14).
- The live adapter maps the same two causes (50 §8.2.4): the user-WS
  cancellation of our cancel → `Canceled(WindowEnd)`, a cancellation by the
  exchange's close → `Canceled(MarketClosed)`.

### 6.7 Reports (RF11)

The simulator reproduces what the live adapter will deliver for the same
exchange behavior (50 §8.2.4). Times are loop times; "arrival" and "change" are
the loop times of the exchange-side actions.

| Exchange change | Delivered events | Delivery time |
|---|---|---|
| Order rests at arrival | `OrderAccepted`, `OrderOpen` | arrival + `L_ack` |
| Delayed | `OrderAccepted`, `OrderDelayed{release_at}` | arrival + `L_ack` |
| Matched at arrival | `OrderAccepted`; fills by fill report | arrival + `L_ack` |
| FOK/FAK not marketable | `OrderAccepted` at arrival + `L_ack`; `OrderDone(Killed, filled: 0)` at arrival + `L_fill` (the user-WS order event; REST status `unmatched` is not terminal, 50 §8.2.4) | as stated |
| Rejected at arrival | `OrderRejected(reason)` | arrival + `L_ack` |
| Match | Fills per §4.5, `SettlementUpdate{Matched}` for the trade, `OrderDone(Filled)` when complete | match + `L_fill` |
| Cancel succeeded (strategy or window-end cancel) | `CancelAcked` at arrival + `L_cancelAck` (REST response); `OrderDone(Canceled(cause), filled)` at arrival + `L_fill` (user-WS cancellation) | as stated |
| Cancel failed | `CancelFailed(reason)` | arrival + `L_cancelAck` |
| GTD expiry, market-close cancel, kill or reject after delay release | `OrderDone` / `OrderRejected` with the exchange's filled quantity | change + `L_fill` |
| Settlement | `SettlementUpdate{Mined}` at match + `L_mined`, `{Confirmed}` at match + `L_confirmed`; with probability `failureRates.settlement` (default 0) `{Failed}` for the trade at match + `L_failed` instead, which reverses its fills (10 F1) | as stated |

- Exactly one terminal event per key; `OrderDone` always carries the exchange's
  filled quantity (10 S3), which is why the cancel acknowledgement is a separate,
  non-terminal event (`CancelAcked`, 10 §10.1 V1a).
- Reports of one key may arrive out of exchange order when their latencies
  differ (a fill after the ack, or after `CancelAcked`), as live; the ledger
  handles it (12 §9.8).
- Fills are delivered at `Matched`. Selling or merging them is gated by
  settlement status (12 §9.3), not by delaying the fill as TS live does
  (`src/polymarket/ws/userWsAccountSource.ts:42-49, 458`).

### 6.8 Latency model (RF05)

| Component (stream tag) | Meaning | Entity (10 RNG-4) |
|---|---|---|
| `place` | Decision → exchange arrival (signing, HTTP, ingress); one-way; one draw per `Place` (a batch shares it) | First `OrderKey` of the command |
| `cancel` | Submission → exchange arrival | `CancelSeq` of the command's `CancelOp` |
| `ack` | Exchange → REST placement response at the client | `OrderKey` |
| `cancelAck` | Exchange → REST cancel response at the client | `CancelSeq` |
| `fillReport` | Exchange change → user-WS message at the client | `TradeSeq` for fills of a trade; `OrderKey` for the order's terminal change without a trade (kill, expiry, cancel, market-close cancel) |
| `mined`, `confirmed`, `failed` | Match → status message at the client | `TradeSeq` |
| `chainSplit`, `chainMerge` | Request → completion, both at the client | `OpKey` |
| `md_cmd` | The `md` adjustment of the components above, from `ModelConfig.clock.marketData.delay` (12 §4.5) | The entity of the adjusted component; draw index 0 `place`/`cancel`, 1 `ack`/`cancelAck`, 2 `fillReport`, 3 `mined`, 4 `confirmed`, 5 `failed` |
| `md_row` | Receipt-time synthesis on Telonex (12 §4.3) | Input row index (entity kind 6) |
| `settlement_failure`, `chain_failure` | Bernoulli draws of `failureRates` (§6.7, §6.10) | `TradeSeq`, `OpKey` |
| `compat_jitter` | §5.1 | `OrderKey` or `CancelSeq` |

**Effective latencies (realistic, every input mode).** With `md_c` the
`md_cmd` draw for the component's entity:

- `L_place = md_c + place`, `L_cancel = md_c + cancel`;
- `L_r = max(0, r − md_c)` for `r` ∈ {`ack`, `cancelAck`, `fillReport`,
  `mined`, `confirmed`, `failed`};
- `L_chainSplit = chainSplit`, `L_chainMerge = chainMerge` (both ends at the
  client).

Derivation. In realistic every input mode is receive-clocked (12 §4.1; Telonex
through the synthesized receipt times of 12 §4.3), so the input book at loop
time `τ` shows the exchange at about `τ − md`. An order decided at loop time
`t` reaches the exchange about `place` later, at an exchange state the input
shows at `t + place + md`. A report sent when the exchange-side action runs at
loop time `x` (exchange time about `x − md`) reaches the client at
`x − md + r`. One timeline therefore suffices: no delayed book copies and no
second clock, on Telonex, V4, journals and paper alike. Host clock offsets of a
few ms are not separated (12 §4.5). Exchange-side rule times use the estimate
`τ − skew` of 12 §4.4; the difference to `τ − md` (tens of ms) is below the
resolution of every rule (12 XT2).

**Distributions:** `constant`, `uniform`, `empirical` (quantile table, inverse
CDF with linear interpolation), `lognormal` (pure-Rust math, 10 D-2); samples
are integer ms (10 R16).

**Calibration sets.** `execution.latency.calibrationId` and
`clock.marketData.calibrationId` name committed files (§7.4) that the producer
resolves into explicit distributions in the job (21: the binary applies no
defaults); provenance records the ids. Until M10 the default set is
`uncalibrated-2026-10`, flagged uncalibrated in the output:

| Component | Placeholder | Basis |
|---|---|---|
| `place`, `ack` | 58 ms each | Half of the measured placement round trip, avg 116 ms (range 71–379, `docs/other/MeasureLatency.md:68-93`) |
| `cancel`, `cancelAck` | 45 ms each | Half of the measured cancel round trip, avg 91 ms (range 65–210) |
| `fillReport` | 58 ms | Assumed equal to `ack` |
| `mined`, `confirmed`, `failed` | 2 s, 10 s, 2 s | Placeholders; MATCHED→MINED was never measured (research/early-audits.md:40) |
| `chainSplit`, `chainMerge` | 4 s | Placeholder near TS live waits (`src/trading/execution/LiveExecution.ts:614-705`) |
| `md` | Empirical, measured at the start of M3 | Worker-2 V4 packages, `receivedAtMs − exchange ts` of `book`/`price_change` frames (12 §4.5); worker-2 stands in for the live host until M10 |

**RNG streams.** Seeds, stream derivation, draws and mappings are 10 §6.1
(RNG-2 to RNG-6); this section owns the tags and entities above. A draw is a
pure function of (stream, entity, draw index), not of call order. A fix that
changes draws in one component therefore never shifts another, A/B arms keep
per-order latencies aligned, and every candidate sees the same draws for the
same entities.

### 6.9 Fee model (RF01)

- Fee per fill (§4.5) from the `feeSchedule` in force at the match's exchange
  time, with formula, rounding and minimum of 11 §5 and 10 R8; makers pay 0
  when the schedule is taker-only; the collateral-BUY fee is charged on top of
  the amount.
- Reservation fee and fee bound per 10 §9.4 C1 and R9.
- `rulesSource = fallback` markets are flagged (D21). Fee eras are verified
  against charged amounts before realistic becomes default (D22, D35).

### 6.10 Split and merge (RF12, D25)

- `Split{op, size}` → `ChainComplete` at `t + L_chainSplit` → `PositionsSplit{size,
  cost = size}`, or with probability `failureRates.chain` (default 0)
  `SplitFailed(TxFailed)`. Merge likewise with `L_chainMerge` and
  `PositionsMerged` / `MergeFailed(TxFailed)`.
- Reservations are held until completion (12 §9.4).
- Live executes them through the TS sidecar and reports completion as an
  `Account` envelope (50); paper and backtest use this model.

### 6.11 Strategy-visible book (RF10)

- The realistic `ctx.book()` is the recorded book minus depletion plus own
  resting orders at their levels; the SDK exposes own size per level so a
  strategy can subtract itself (30). Live WS books include own orders, so this
  aligns the strategy's view between backtest and live. Delayed orders are not
  shown.
- **Timing.** An overlay change (an own order starts resting, leaves the book,
  or depletes a level) becomes strategy-visible at the loop time of the
  exchange-side action that causes it. Because the loop clock is the receive
  clock (12 §4.1), that equals exchange time + `md`: the moment live sees the
  change in its WS book. No extra delay is added. The REST ack may be delivered
  before or after that moment (`L_ack`), as live.

### 6.12 Self-trade

Polymarket does not document self-trade prevention (research/early-audits.md:18;
11 §11). Default: own resting orders are never counterparties to own takers
(the walk skips them; a `self_cross` counter is reported), and post-only checks
treat own opposite resting orders as crossing. See open question 1.

### 6.13 Decontaminated inputs (D24)

Replays of markets we traded use inputs from which our own resting sizes and our
print amounts were removed (journal join and transform: 51, 15). The simulator
then inserts simulated own orders as usual; provenance records
`decontaminated = true`.

### 6.14 Exchange behaviors to verify (day-0 probes, 51)

1. Exact response to a cancel during the taker delay, per era (11 TD4).
2. Whether a FOK/FAK with no crossing liquidity is killed at once or only after
   the delay window.
3. Whether a GTC/GTD that crosses only part of its size is delayed as a whole.
4. Effective GTD expiry 60 s early and the 3-minute minimum lead (11 §8).
5. FOK/FAK BUY share truncation and fee on top of the amount (10 O2).
6. Whether a V2 cancel can be addressed before the exchange id is known; if yes,
   `cancelBeforeAck: immediate` becomes possible live.
7. The settlement status at which shares become sellable or mergeable (default
   gate `Mined`, 12 §9.3).
8. When the exchange stops accepting orders for a 5m/15m market and whether it
   cancels resting orders at that moment (`market.closed`, §6.6).
9. Fill amounts of partial maker and taker fills against the signed amounts
   (§6.4.1).
10. Fee granularity: per maker match or per fill record (11 FC4, §4.5 F-U4).

## 7. Realistic fixes, A/B reports, `ModelConfig.execution`

### 7.1 Composition and fix list

The realistic profile is a fixed composition. Each difference from ts-compat is
one fix with one report. A fix is either an **axis** (an execution-model choice
that stays switchable at runtime, so its alternative can be measured at any
time) or a **rule** (a fact about the exchange or a core rule from first
principles, never switched at runtime).

| ID | Fix | Kind | Realistic | Alternative arm | The report MUST show |
|---|---|---|---|---|---|
| RF01 | Fee from per-market `feeSchedule`, eras | axis `fee` | `schedule` (§6.9) | `flat_700bps_4dp` | Fees per market and per era; PnL delta; per-era sample vs charged amounts (D22) |
| RF02 | Tick, bounds, precision, minimums, caps, market closed, at decision and arrival; tick in force | rule | 11 §7–§11 | parent build | Rejects by reason; orders ts-compat accepted that realistic rejects |
| RF03 | GTD 3-minute lead and 60 s early expiry | rule | 11 §8, §6.6 | parent build | GTD rejects; resting-time change; fills lost to early expiry |
| RF04 | FAK; FOK/FAK BUY sized in collateral, fee on top | rule | §6.4, §6.4.1 | parent build | Shares received vs requested; kill rate |
| RF05 | Exact-time scheduler, separate seeded latencies, `md` adjustment | axis `latency` | `exact` (§6.8) | `compat` (§5.1) | Fills that moved in time; cancel/fill races; sensitivity at component latencies ×0.5 and ×2 and at `md` ×0.5 and ×2 |
| RF06 | Taker delay | axis `takerDelay` | `on` (§6.3) | `off` | Taker fill rate; price move during the delay; killed FOK/FAK share; `NotCancelableDuringDelay` count |
| RF07 | Liquidity depletion | axis `depletion` | `persistent_deficit` | `none`, `reset_on_update` | Taker VWAP change; same-tick double-consumption count; both policies |
| RF08 | Sized maker fills, no free remainder fill | axis `maker` | `trade_through` (M3 intermediate; RF09 makes `queue` the final value) | `worst_queue` | Maker fill count and size; remainder fills removed |
| RF09 | Queue-position maker model | axis `maker` | `queue` (§6.5) | `trade_through`, `worst_queue` | Fills vs RF08; α ∈ {0, 0.5, 1}; on V4, prints vs masked prints |
| RF10 | Own resting orders in the strategy-visible book | rule | §6.11 | parent build | Decisions changed; markets affected |
| RF11 | Settlement reports with latencies and statuses, `Failed` reversal, sellable gate | axis `reports` | `settlement` (§6.7) | `compat` (with `sellGate: Matched`) | Sells and merges delayed or rejected by the gate; ack/fill race effects |
| RF12 | Async split/merge | rule | §6.10 (D25) | parent build | Timing and capital effects for split/merge strategies |
| RF13 | D23 window rule, plugin warm-up, window-end cancel, market close | rule | 12 §5.4, §6.6 | parent build | Orders canceled at the end by cause; fills after `end`; warm-up effects |
| RF14 | Core rules: first-principles OM order and risk, dedupe position, SELL inventory, loss-stop exits, uniform cancel resolution, deferred cancels, explicit cancel and merge failures | rule | 12 §7, §8 | parent build | Rejects by reason; naked sells removed; risk decisions changed |
| RF15 | Receive clock: synthesized receipt time on Telonex, feed clock = `now`, `tick.ts = now`, `now`-stamped decisions, skew estimate | rule | 12 §4 | parent build | Feed age at decision (Binance, Chainlink) vs ts-compat; decisions changed; gate-edge effects; sensitivity at `md` ×0.5 and ×2 |

01 M3 also lists isolated per-market capital (D31). Backtest capital is already
an isolated per-market allowance in both profiles (12 §9.4), so it needs no
fix; the live `min()` cap applies only in paper and live.

Every TC rule of §5.2 is covered by exactly the fix in its "Fix" column.

### 7.2 A/B procedure and reports

- **Development order (M3).** The realistic profile is assembled one fix per
  commit. M3 starts with the realistic profile equal to the ts-compat
  composition; that and every intermediate state are transient development
  states, never supported or tested after M3, and no runtime switch is left
  behind for a rule fix. Recommended order: RF15, RF14, RF13 (so later fixes
  land on the final core), RF02, RF03, RF04, RF12, RF10, then the axes RF05,
  RF01, RF06, RF07, RF08, RF09, RF11. A rule fix MAY land together with fixes
  it cannot be separated from; the report then covers the group and lists each
  fix's attribution counters.
- **Arms.** An axis fix compares the full build with that axis at its
  alternative value against the realistic value, on the same build. A rule fix
  compares the realistic profile of the parent commit's build against the fix
  commit's build. Both arms use the same markets, run seed and per-market seeds.
- **Leave-one-out.** At the end of M3, and whenever a model changes later, each
  axis is reported as leave-one-out from full realistic (every alternative
  value), because the axes interact (RF05–RF11).
- **Profile pair.** At the end of M3, ts-compat vs full realistic on the M3 set:
  the overall per-market delta, attributed with the attribution counters.
- **Attribution counters.** Each realistic rule and model increments counters
  named by its fix (for example `rf02.reject.invalid_tick`,
  `rf13.cancel.window_end`, `rf14.sell.blocked`, `rf15.feed_age_ms` histogram)
  in `diagnostics` (21 §10). They are never part of the deterministic output.
- **Markets.** The M3 set of ≥200 markets (selection per 60 §11 AB-1); RF09
  prints mode and the masked-prints comparison use the V4 sets of M7.
- **Execution.** Arms run as separate `run`/`serve` invocations with 8 local
  workers. Once M4 lands, axis arms MAY run as one candidate group of
  `execution` variants with `--allow-model-variants` (21 §8, 41 §3.3); results
  MUST be identical either way (41 §10). Rule-fix arms always run as separate
  invocations of two binaries.
- **Command.** `scripts/native/ab.ts`, exposed as `npm run native:ab`:

```bash
npm run native:ab -- --fix RF07 --set m3 --preregister                 # AB-2 skeleton; commit it first
npm run native:ab -- --fix RF07 --set m3 --a axis:depletion=none --b base
npm run native:ab -- --fix RF14 --set m3 --a build:<parent-rev> --b build:HEAD
npm run native:ab -- --leave-one-out --set m3
npm run native:ab -- --profile-pair --set m3
```

  `base` is full realistic at HEAD; `axis:<name>=<value>` changes one axis of
  `base` through `src/native/modelConfig.ts` (§7.4); `build:<rev>` builds that
  commit in a clean worktree (31 §4) and uses that commit's realistic default. The
  command writes the manifest (arms, binaries' sha256, ModelConfig sources and
  hashes, market set id, seeds, exact commands; 60 VP-2) and
  `native/reports/ab/RFnn-<name>.json` plus `.md`. Numbers in the `.md` are
  generated; the session writes only expectations (before the run), the
  explanation and the verdict.
- **Report content.** The two `modelConfigSha256` values, the two engine
  commits (equal for axis arms), market set id; the per-market PnL delta
  distribution (mean, median, p5/p95, bootstrap 95% CI); count and share of
  markets changed; fills, maker/taker split, fees, rejects by reason, cancels;
  the fix-specific metrics of §7.1 and its attribution counters; the 10 markets
  with the largest |ΔPnL| with parity-trace diff excerpts (22); a determinism
  re-run check; and a short statement of what changed and why that is expected
  (pre-registered per 60 AB-2).
- A fix lands only together with its report (01 M3). The ts-compat parity matrix
  MUST still pass after every fix (60 AB-4).

### 7.3 `ModelConfig.execution` v1

Owned here (21 §6); representation rules of 21 §6 apply (decimal strings for
ratios, integers for ms, no floats, no defaults applied by the binary). The
object contains only execution-model choices; core rules follow the profile
(12 §2.3) and the market-data clock lives in `ModelConfig.clock` (12 §4.5).

```jsonc
"execution": {
  "models": {                                  // §7.1 axes; ts-compat requires the compat values
    "latency":    "exact",                     // exact | compat
    "fee":        "schedule",                  // schedule | flat_700bps_4dp
    "takerDelay": "on",                        // on | off
    "depletion":  "persistent_deficit",        // persistent_deficit | reset_on_update | none
    "maker":      "queue",                     // queue | trade_through | worst_queue
    "reports":    "settlement"                 // settlement | compat
  },
  "compatLatency": { "delayMs": 0, "jitterMs": 0 },   // used iff models.latency = compat
  "latency": {
    "calibrationId": "uncalibrated-2026-10",
    "components": {                                    // resolved by the producer from calibrationId
      "place":      { "kind": "constant", "ms": 58 },
      "cancel":     { "kind": "constant", "ms": 45 },
      "ack":        { "kind": "constant", "ms": 58 },
      "cancelAck":  { "kind": "constant", "ms": 45 },
      "fillReport": { "kind": "constant", "ms": 58 },
      "mined":      { "kind": "constant", "ms": 2000 },
      "confirmed":  { "kind": "constant", "ms": 10000 },
      "failed":     { "kind": "constant", "ms": 2000 },
      "chainSplit": { "kind": "constant", "ms": 4000 },
      "chainMerge": { "kind": "constant", "ms": 4000 }
    }
  },
  "cancelBeforeAck": "defer_until_ack",                // | "immediate" (simulator A/B only)
  "makerQueue": { "cancelAheadShare": "0.5", "printMatchWindowMs": 1000, "prints": "auto" },  // auto | off
  "sellGate": "Mined",                                 // Matched | Mined | Confirmed
  "failureRates": { "settlement": "0", "chain": "0" }
}
```

- ts-compat requires the compat values `latency: compat`,
  `fee: flat_700bps_4dp`, `takerDelay: off`, `depletion: none`,
  `maker: worst_queue`, `reports: compat`, plus `cancelBeforeAck:
  defer_until_ack`, `sellGate: Matched` and failure rates 0 (unused, pinned).
- Component use: `place`, `cancel`, `ack`, `cancelAck`, `fillReport` iff
  `models.latency = exact`; `mined`, `confirmed`, `failed` iff
  `models.reports = settlement`; `chainSplit`, `chainMerge` in realistic.
- Distribution kinds: `{"kind":"constant","ms"}`, `{"kind":"uniform","loMs","hiMs"}`,
  `{"kind":"empirical","quantilesMs":[q0,…,q100]}` (101 entries, non-decreasing),
  `{"kind":"lognormal","mu","sigma"}` (decimal strings, parameters of ln ms).
- Fields a choice does not use MUST still be present and are ignored. The binary
  rejects as `invalid_input`: ts-compat with any non-compat value above, and
  realistic with `reports: compat` unless `sellGate: Matched` (compat statuses
  never reach `Mined`). Every other combination of axis values is valid in
  realistic.
- 21 requires the legacy job `latency {delayMs, jitterMs}` to equal the model
  values; for native jobs that comparison uses `compatLatency`.
- **Variants (21 §8 C4 owns the rule; the fields are here).** A candidate MAY
  replace the whole `execution` object, and every field is variant-safe,
  because `execution` holds only execution-model choices. Variants require
  `--allow-model-variants` and serve calibration and A/B arms, not agent
  sweeps. ts-compat candidates cannot vary (pinned values). Run-level and never
  per candidate: `profile` (selects the core rules), `clock` (shapes the shared
  timeline), `seed`, `capital`, `feeds`, `runner`, `risk`, `rules`. This
  replaces the partial-override allowlist of 41 §3.3.

### 7.4 Defaults and calibration sets

The binary applies no defaults (21 §6), so the producer resolves every value
from committed files. The file layout and the resolution order are owned by
21 §6.3; this section fixes what 13 contributes to them:

| File (21 §6.3) | What 13 (and 12) put in it | Changes |
|---|---|---|
| `native/contract/defaults/model-config-v1.json` (one object per profile) | The complete `execution` object per profile: ts-compat with the compat values of §7.3 and `compatLatency` 0/0; realistic with the realistic axis values and parameters of §7.3. Also the `clock` object of 12 §4.5 (ts-compat `md` constant 0; realistic by calibration id) | A new file version per model change, landing with its A/B report; a TC change after gate 2 needs a 02 entry (§5.5) |
| `native/contract/calibrations/latency/<id>.json` | The component distributions of §6.8; the `md` distribution per host (`marketData.byHost.<host>`) with the per-market lower envelopes it was measured with; provenance (hosts, date range, source manifests, sample counts, method); the validity envelope (51 §13) | Immutable once any persisted run used it; a new measurement gets a new id (14 F-48 applies alike) |
| `native/contract/calibrations/feeds/<id>.json` | Owned by 14 §9 | — |

- **Resolver.** `src/native/modelConfig.ts` implements 21 §6.3:
  `resolveModelConfig({profile, inputMode, host?, flags, overrides?})` loads
  the defaults file, resolves each calibration id into explicit distributions
  (the `md` host per 12 §4.5: the recording host for recorder-v4 and journal,
  the live host for telonex-delta and paper), applies flags and overrides (the
  parity matrix delay, A/B axis values via `--model-config-override`),
  validates against the generated schema (21 §3) and §7.3, canonicalizes, and
  returns `{modelConfig, modelConfigSha256, sources: [{path, sha256}]}`.
- **Hash agreement.** Rust `pmb-contract` implements the same canonical form.
  Besides 21's CI item 6 (default configs), a fixture test resolves every
  committed calibration set with each profile in TS and asserts that Rust
  computes the same `modelConfigSha256`.
- **Provenance.** Every manifest (parity, A/B, gate, benchmark; 60 VP-2) records
  `sources` and `modelConfigSha256`. Persisted runs store the resolved
  ModelConfig (D09), so later file versions never change history.
- **Timing.** The ts-compat default and the resolver land in M1, because
  fixture jobs and the M2 harness need them. `uncalibrated-2026-10` (with the
  `md` measured from worker-2 V4 packages, 12 §4.5) and the realistic default
  land at the start of M3.

## 8. Paper adapter

- The realistic simulator in `Journaled` mode on live envelopes, with the same
  models and `ModelConfig` as a realistic backtest. The effective latencies use
  the live host's `md` distribution (`clock.marketData`, 12 §4.5), exactly as a
  V4 backtest uses worker-2's: paper is receive-clocked, so the order path still
  needs `L_place = md + place` (§6.8).
- Timers per §2.3: synthesized before inputs, OS timer when idle, all journaled.
- Sends nothing, never sends heartbeats (D30), loads no credentials (R10).
- `DecisionsOnly`: accept and `OrderOpen` at once, never fill or expire; a
  diagnostic mode, flagged in results.
- M8 identity proof: `JournalReplay` (the same simulator, timers from the
  journal) reproduces every decision and the per-market output byte for byte.

## 9. CLOB V2 adapter (core-facing contract)

Transport, V2 signing, heartbeat, rate limits, reconnect, the observation-to-event
mapping table, fill ids and reconciliation reads are owned by 50 §8.2. This
section fixes what the core relies on.

### 9.1 Submission

- `submit` builds the request (V2 order fields; amounts per 11 §7), checks the
  real-order gate (compile-time feature plus CLI flag, R10), hands it to the
  I/O worker through a lock-free queue, and returns. It emits no events.
- Cancels arrive already resolved and deferred by the OM (12 §7.3), with their
  `CancelSeq` and cause.
- Batches never exceed 15 orders (12 §7.3).

### 9.2 Normalization requirements

- Raw REST responses, user-WS frames, reconciliation results and sidecar
  results arrive as journaled `Account` envelopes and are normalized on the loop
  thread (50 §8.2.4), so a journal replay produces the same events.
- The normalized stream uses the event vocabulary of 10 §10.1 and the reasons of
  10 §10.2, the same as the simulator, and obeys X3 and X7: exactly one
  terminal event per key, `OrderDone` carrying the authoritative filled
  quantity whenever the exchange provides it, `CancelAcked` for REST cancel
  acknowledgements, and the cancel causes of §6.6.
- Fills are emitted at first sight (`Matched`), aggregated to the unit of §4.5
  (one per own order, trade and price level), with the fee summed over legs by
  `ExchangeRules` (never from WS `fee_rate_bps`; 50 §8.2.5); later statuses are
  `SettlementUpdate`s; `Failed` reverses the fills.
- Raw frames for an exchange id not yet mapped to a key are buffered by exchange
  id and applied once mapped (10 S5); foreign orders never reach the core (10
  S6).

### 9.3 Ambiguous outcomes

An ambiguous POST or cancel puts the order in `Unknown` (10 §8.1); there is no
blind retry of placements, and reconciliation reads on `Journaled` timers
resolve it (50 §8.2.6, §8.2.7). Reservations stay held while `Unknown`. The
same reconciliation runs when an expected terminal update is still missing
after a deadline, for example `CancelAcked` without a user-WS cancellation.

### 9.4 Replay of a real-money journal

In replay mode the adapter sends nothing: `submit` records the command, and
`Account` envelopes come from the journal. Normalization is identical, so
decisions are identical. A replayed command that differs from the journaled
request is a determinism failure (01 M9, M10).

## 10. Determinism and speed

- Every model is a pure function of inputs, `ModelConfig` and the market seed's
  counter-based streams; ties follow §4.3. Output is byte-identical across
  machines, thread counts and candidate groups (R7).
- No allocation per event in steady state: reused heap storage, small vectors
  for the fills of one match, a sparse overlay.
- Market events touch only affected own orders: a level update on our side at an
  own price → Q2; an update on the opposite side → crossing check against the
  best own price (tracked, O(1)); a replacing snapshot → full re-evaluation of
  own orders (Telonex sends one every 500 updates per asset,
  `src/telonex/converters/deltaTyped.ts:18`); a print → own orders at or through
  its price.
- Per-candidate fast path: a candidate with no resting orders and no pending
  actions skips market-event processing entirely (16 CG-4).
- Candidate sessions share the recorded book, the receipt timeline and the
  skew; only overlays are per session.
- Latency draws are counter-based (keyed hash → inverse CDF), cost a few ns,
  and need no per-session RNG state.
- `OrderLifecycle` and `FillDetail` trace events are built only when a sink
  requests them (22 §2); counters are always on.
- The ts-compat early exit of §5.1 is measured and must keep traces
  byte-identical (01 S6).

## 11. Tests

- **Compat goldens:** generated by running TS `BacktestExecution` in isolation
  on synthetic books (the pattern of `native/crates/pmb-core/tests/fixtures/stats_gen.ts`):
  post-only (`BacktestExecution.postOnly.test.ts`), FOK kill and fill, GTC
  partial and rest, worst-queue fill and expiry precedence, latency queue order,
  delayed cancel binding and `cancel_market` at execution (`cancellation.test.ts`),
  fee rounding vectors.
- **Composition checks:** ts-compat rejects every non-compat axis value;
  realistic accepts every axis combination of §7.3 except the documented
  invalid one; each combination is deterministic (re-run byte-identical).
- **Realistic:** rule tests citing the docs (11); scheduler tie tests; taker
  delay (cancel during the delay in both era kinds, release re-validation, FOK
  at release); queue model scenarios (print before and after its decrease,
  α = 0 and 1, level vanishes, crossing liquidity); depletion conservation
  (property); collateral BUY vectors and fill-amount vectors (§6.4.1); window
  end vs market close ordering and causes; report races (fill after ack, fill
  after `CancelAcked`); `Failed` reversal keeps the PnL identity; RNG stream
  isolation (property); `md` self-test (`md` +X ms → arrival +X ms, reports −X
  ms, floored at 0); neutrality (simulator vs itself) and sensitivity (+X ms
  injected → +X ms measured) self-tests (51); masked-prints evaluation on V4
  (M7).
- **Timers:** a paper journal re-run as SelfTimed backtest input over the same
  envelopes gives the same decisions (TS1); replay rejects a journal with a
  missing or altered timer (TS4).
- **CLOB V2:** recorded fixtures and a mock exchange (01 M9), including a taker
  order against several maker orders at one level (one core `Fill`, per-leg fee
  sum, F-U3).

## 12. Changes required in other documents

For the lead's consistency pass; this document does not edit them.

| Document | Change |
|---|---|
| 21 §8 (C4), 41 §3.3 | C4 stays "only `execution` may differ"; its reasons change: no `fixes` ladder exists, and `execution` holds only model choices (§7.3). Plugin sharing no longer depends on `fixes.windowEndRule` (the window rule is core, per profile). 41's "variant-safe keys listed in 13" becomes "every key under `execution`" |
| 21 §6, §6.3 | `execution` contents per §7.3 (`models` axes, `cancelAck`, no `fixes`, no `mdDelayMs`); the `execution.fixes` row of the §6.3 table becomes `execution.models` = the profile's defaults; add the `clock` sub-object (owner 12 §4.5) |
| 21 Open question 1 | "A realistic run with every fix off equals ts-compat" no longer holds; cross-profile comparisons are the profile pair of §7.2 (separate runs) |
| 20 §5.6 (flag table) | `--native-profile` sets the profile's default `execution`; `--latency-delay-ms`/`--latency-jitter-ms` are accepted iff the resolved `models.latency = compat` |
| 01 M3 | Fix list RF01–RF15; rule fixes reported as commit pairs, axes as arms, leave-one-out and profile pair at the end of M3 (§7.2) |
| 60 §11 AB-1, §15.2 | Same engine commit on both arms for axis fixes; parent and fix commit for rule fixes; add `npm run native:ab` next to `native:gate-report`; no "realistic all-off equals ts-compat" test; "cumulative ladder" becomes the procedure of §7.2 |
| 50 §1 | Calibration artifacts live at `native/contract/calibrations/latency/<id>.json` (21 §6.3), referenced by `execution.latency.calibrationId` and `clock.marketData.calibrationId` |
| 50 §8.1 | Paper uses the live host's `md` in effective latencies; timers per §2.3 |
| 50 §5.3, §13.5, §18 | Timer synthesis before inputs (TS1); timer-lateness histogram in the latency report |
| 50 §8.2.4, §8.2.5 | Aggregate legs into core fills per §4.5 (10 I3) with per-leg fee sums; cancel causes `WindowEnd` vs `MarketClosed` (§6.6) |
| 10 §6.1 RNG-3, RNG-4 | Tags of §6.8 (`cancelAck`, `md_cmd`, `md_row`, `settlement_failure`, `chain_failure`); entity kind 6 = input row index |
| 10 R5, 11 FC4, TK4, §14 | R5/R6 realistic amounts and TK4 point to §6.4.1; FC4 to §4.5 F-U4; registry entries for fill amounts and fee granularity |
| 51 §6.1, §13 | Day-0 items 8–10 of §6.14; the live host's `md` distribution as a fitted product; F-U4 dust in the validity envelope |

## Open questions

1. **Self-trade probe.** Polymarket does not document self-trade prevention, and
   the default (§6.12: own orders are never counterparties) is a guess. May the
   day-0 probe budget (D34, ~$5) include one deliberate $1 self-cross probe to
   settle it?
