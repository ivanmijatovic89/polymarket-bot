# 12 — Engine core

This document specifies the deterministic core that backtest, paper and live
share: the unit of execution (a market session), the input envelope, the clock
model per input mode and profile (D27), including receipt-time synthesis for
Telonex inputs and the exchange-time estimate, the serial event loop and the
exact order of operations for each input, strategy callbacks with breadth-first
cascades and the tick-scoped plugin and feed snapshot, intent handling by the
order manager (identities, dedupe, validation through `ExchangeRules`,
funding, risk limits), the single ledger (what each account event does to
orders, settlement, reservations, positions, fees and cash-based PnL),
sessions, rotation and the window end, fault semantics, `TraceSink` emission
points, and the core's own determinism and speed rules. Execution adapters and
the simulator are specified in [13-execution-models.md](13-execution-models.md);
ts-compat rules are cited here as `TC-…` and listed in full in 13 §5.2.

## 1. Scope and references

| Topic | Owner |
|---|---|
| Fixed-point types, rounding table, outcomes, id types, order states and transitions, account event and reason enums | 10-domain-model.md (§3, §5–§10) |
| **Clock model per input mode and profile (D27)**, `ModelConfig.clock` | this document, §4 (10, 14 and 15 defer here) |
| `ExchangeRules` values, sources, fee eras, taker delay table, tick in force | 11-exchange-rules.md |
| `Execution` trait, simulator, scheduler, ts-compat rule list, realistic composition, `ModelConfig.execution`, fill arithmetic | 13-execution-models.md |
| Feed visibility, synthetic tick schedule, plugin math | 14-feeds-and-plugins.md |
| Readers, book reconstruction, merged timeline order, data anomalies | 15-inputs.md |
| Executor, threading, shared caches, benchmark set, measurement register | 16-performance-and-parallelism.md |
| Error classes and exit codes | 20-binary-protocol.md §4 |
| `MarketJobData`, `ModelConfig` layout, output fields, event counting, meta caps | 21-job-and-output-contract.md |
| `TraceSink` event variants and formats | 22-trace-ledger-journal.md |
| Strategy-facing API (`Ctx`, `PortfolioView`, interests) | 30-strategy-sdk.md |
| Live runtime: routing across sessions, session guards, adapter normalization | 50-live-runtime.md |

Types are owned by 10. This document defines **processing semantics**: when
things happen and what they do to session state.

## 2. Architecture

### 2.1 Units

| Unit | Contents | Mutated by | Shared |
|---|---|---|---|
| `SharedMarket` | Recorded books of both outcomes (15 §2.1), feed state, rules in force, `MarketInfo` (10 §5), window, the receipt timeline (§4.3) and the skew estimate (§4.4) | The driver, between steps | Read-only during session steps; one per market, shared by every candidate of that market (41) |
| `Session` | Strategy instance, plugin set, order manager, ledger, execution adapter, cascade queue, clocks, counters | Only its own step | Never shared |
| Driver | Applies each envelope to `SharedMarket`, then calls `step` on every session of that market | — | Backtest: executor task (16); live: runtime (50) |

- A session is one (market, candidate, profile, seed). It is the unit of
  determinism: its output is a pure function of the envelope stream, the job
  (incl. `ModelConfig`) and the strategy binary (R7).
- Session state MUST be `Send` and own all its data (no `Rc`, no global or
  thread-local mutable state, no references into `SharedMarket` held across
  steps), so the executor can move sessions between threads (16).
- The strategy never learns which execution adapter it runs on. The core never
  branches on adapter kind; it branches only on the profile's rule set
  (`CoreRules::TsCompat` or `CoreRules::Realistic`, §2.3).
- ts-compat is a backtest-only profile. Paper and live always run the realistic
  rules (D28).

### 2.2 Components

| Component | Responsibility |
|---|---|
| Loop | Processes envelopes in order, runs due scheduled actions, dispatches ticks, drains cascades (§5, §6) |
| Plugin set and feed view | Updated on dispatched ticks; one snapshot per tick (§6.4, 14) |
| Strategy | User code; writes intents in tick and event callbacks (§6.1, 30) |
| Order manager (OM) | Turns intents into commands: dedupe, validation, risk, funding, ledger command entries, dispatch (§7, §8) |
| Ledger | The only store of orders, fills, positions, cash and reservations (§9) |
| Execution | Simulator, paper or CLOB V2 adapter (13) |
| TraceSink | Optional observer (§12, 22) |

The WIP seam in `native/crates/pmb-core/src/execution.rs:49-79` and
`trace.rs:1-15` is the starting point for the `Execution` and `TraceSink`
traits; `order_manager.rs` and the two-ledger `portfolio.rs` are not
(research/early-audits.md:57-61).

### 2.3 Rule sets

The core has exactly two rule sets, selected by `ModelConfig.profile` and
never mixed at runtime:

| Rule set | Profile | Design basis |
|---|---|---|
| `CoreRules::Realistic` | realistic, paper, live | First principles and the current Polymarket rules (11). Every rule in §4–§10 that is not marked TC is this set |
| `CoreRules::TsCompat` | ts-compat | Reproduces TS where TS is the oracle (00 R3). Each deviation from the realistic set is a `TC-C…` row of 13 §5.2 and is implemented as one small, named branch; since D71 only the rows still reproduced (TC-C2, C3, C5, C6 and C10 use the realistic rule) |

There are no per-rule runtime switches. The realistic profile's model choices
that remain switchable for A/B reports are execution models, not core rules
(13 §7).

## 3. Input envelope

### 3.1 Fields

| Field | Type | Meaning |
|---|---|---|
| `seq` | `u64` | Position in the session's input stream; strictly increasing |
| `at` | `TsMs` | Effect time on the loop clock, per §4 |
| `exchange_ts` | `Option<TsMs>` | Exchange timestamp of the payload, when the source has one |
| `recv_wall` | `Option<TsMs>` | Local wall-clock receive time (live, Recorder V4, journal) |
| `recv_mono` | `Option<u64>` ns | Local monotonic receive time (live, journal) |
| `source` | enum | Market WS, Binance, Chainlink, PTB, user WS, REST, timer, operator, control |
| `payload` | enum | §3.2 |

### 3.2 Payload kinds

| Payload | Backtest producer | Live producer | Effect in the session |
|---|---|---|---|
| `Market` — `Book`, `PriceChange`, `LastTrade`, `TickSizeChange`, outcome-indexed | Reader (15 §2) | Market WS (50) | §5.2 |
| `Feed` — Binance aggTrade, Chainlink round, PTB | Feed series with visibility stamps (14) | Feed clients (50) | Updates feed state in `SharedMarket`; no tick |
| `SyntheticTick(kind)` | Synthetic schedule (14 §8.2) | Feed clients when opted in (14 §8.3) | §5.3 |
| `Account` — REST response, user-WS frame, reconciliation result, sidecar result | — | CLOB V2 adapter I/O, TS sidecar (50) | `execution.on_account_input`, then drain |
| `Timer(due)` | — (journal replay only) | Synthesized by the core before an input, or fired by the runtime's OS timer when idle (13 §2.3); stamps per E5 | §5.1 |
| `Control` — `SessionStart{observe_only}`, `WindowEnd`, `CapitalCap(usdc)`, `RulesUpdate`, `DataGap`, `AdoptPositions`, `Guard(trip)`, `Operator(cancel_order{cid} \| cancel_all \| kill_switch)`, `Shutdown` | Driver | Runtime (50) | §8, §10 |

Operator commands map to these payloads as in 50 §16: `kill` →
`Operator(kill_switch)`; `pause` and `resume` take effect at the next window
as `SessionStart{observe_only: true | false}`; `refresh_balance` and
`heartbeat_pause` are runtime or adapter actions with no core payload (their
effects arrive as later `CapitalCap` or `Account` envelopes). `Guard(trip)`
carries a session-guard trip computed by the runtime across sessions (50
§10.2; §8.3).

`Control(WindowEnd)` is inserted at `at = window.end` in realistic only: by the
driver into the merged backtest timeline (before data envelopes stamped
`end`), and by the live runtime's timer (journaled). ts-compat has no such
envelope (TC-C13).

### 3.3 Ordering rules

- **E1.** The loop processes envelopes strictly in `seq` order. It never
  reorders, merges or drops an envelope.
- **E2.** Producers define `seq`. Backtest readers emit one deterministic merged
  timeline of market, feed, synthetic and control envelopes (14 §8.2 F-40, 15).
  Live, `seq` is the order in which the core dequeues envelopes, and the journal
  records it (D26, 22 §6). The ingress stamp is taken at socket read (50 §5.2).
  If the runtime uses several ingress rings (16 LL-1), the core merges them by
  ascending ingress monotonic stamp, ties broken by a fixed source rank (market
  WS, user WS, REST, feeds, timer, control), considering only envelopes already
  available (it never waits for a ring). A single MPSC queue with the stamp
  taken at enqueue is an equivalent implementation. The `at` of a live envelope
  is its ingress stamp; `now` stays monotone by K2.
- **E3.** Every influence from outside a session (capital cap, operator command,
  window end, rotation, rules change, timers) enters as an envelope. Nothing
  else may change a session's behavior, so replaying a session's envelopes
  reproduces it.
- **E4.** Envelopes are borrowed from decoded batches; the loop never copies
  payloads (§14).
- **E5. Timer stamps.** A `Timer` envelope carries two times, kept apart
  (50 §5.3): `due`, the scheduled time, which stays the exchange-side time of
  the actions it runs and their `OrderLifecycle` and ledger stamps; and `at`,
  its fire time: `max(due, now)` when the core synthesizes it before an input
  (13 §2.3 TS1), the ingress stamp of the OS fire when idle (TS2). Delivered
  events carry the loop clock (K2).

## 4. Clock model (D27)

### 4.1 Clocks per input mode and profile

| Input mode | Profile | `at` of real market envelopes | `at` of synthetic ticks | `tick.ts` | Feed clock (14 F-7) | Exchange-time estimate `xnow` |
|---|---|---|---|---|---|---|
| `telonex-delta` | ts-compat | Row exchange ts `E` (`ts_exchange_ms`) | `S = max(v, E(last real tick))` (14 F-41) | TS `snapshot.timestamp`: last applied message's exchange ts (15 I-6d); synthetic `S` (TC-C11) | `max(L, E)` with Telonex local time `L` (14 F-7) | Decision stamp (TC-C1) |
| `telonex-delta` | realistic | Synthesized receipt time `R` (§4.3) | `max(v, now)` | `now` | `now` | `now − skew` (§4.4) |
| `recorder-v4` | ts-compat | `receivedAtMs` (receipt order) | `max(receivedAtMs, snapshot.timestamp)` (14 F-44) | TS V4 semantics: last applied message's exchange ts (15 §1) | Receipt order (14 §7) | Decision stamp (TC-C1) |
| `recorder-v4` | realistic | `receivedAtMs` | Receipt time of the feed envelope (14 F-44) | `now` | `now` | `now − skew` (§4.4) |
| `journal`, paper, live | realistic only | Bot receive time (wall ms; intervals from `recv_mono`) | Receipt time | `now` | `now` | `now − skew` from journaled clock samples (50 §5.3) |

In realistic every input mode is **receive-clocked**: the loop clock is the
time at which the trading host would have received the input. One timeline
then serves the window gate, plugins, feed visibility, rule lookups and the
latency model (13 §6.8), and no delayed book copies are needed.

### 4.2 Clocks used by the loop

| Clock | Definition | Used for |
|---|---|---|
| `now` (loop clock) | High-water: `now = max(now, env.at)`, and `max(now, t)` for each executed scheduled action at `t` | Scheduler, latency start, realistic window gate and decision stamp |
| `tick.ts` | Strategy-visible tick time. Realistic: `now` at dispatch. ts-compat: the TS timestamp of §4.1, which can step backwards after a synthetic tick (`src/market/syntheticTick.ts:61`; 14 §12.3) | `ctx.now()` and plugins (14 §12.3), trace `ts` |
| `xnow` | §4.1, §4.4 | GTD validation at decision (11 §8); the simulator's exchange-side times (13 §6.2, §6.6) |
| `event_clock` | TS `portfolio.nowMs`: set by the first dispatched strategy tick, then the max over timestamps of delivered account events; ticks do not advance it (`src/trading/Portfolio.ts:148-153, 434-437`; `StrategyRunner.clock.test.ts`) | `ctx.event_clock()` in both profiles (30 §5) |
| Decision stamp | Time attached to intents (created-at, GTD check, latency start). Realistic: `now`. ts-compat: `tick.ts` for tick intents, the last tick's ts for callback intents (`StrategyRunner.ts:455-458, 679`) — TC-C8 | OM, execution |

Rules:

- **K1.** The core never reads the wall clock or the environment (R7). Every
  time value comes from an envelope, the job, or a scheduled action.
- **K2.** `now` is monotone. A scheduled action or timer is never executed at a
  time below `now`; its event time is `max(due, now)` (13 §2.3). The due time
  stays the exchange-side time in `OrderLifecycle` and ledger records.
- **K3.** `exchange_ts`, `recv_wall` and `recv_mono` are exposed raw (30) and
  drive nothing in the core except as defined here.
- **K4. Market-data delay `md`.** In realistic, `md` (exchange event → receipt
  at the trading host) is part of the timeline: real for receive-clocked
  inputs, synthesized for Telonex (§4.3). It enters the order path once more
  through the latency model: an order decided at loop time `t` meets the book
  the input shows at `t + md + place`, and a report sent at exchange-side loop
  time `x` arrives at `x + report − md` (13 §6.8). Own orders and depletion
  become strategy-visible at the loop time of the exchange-side action that
  causes them, which on the receive timeline equals exchange time + `md`: the
  moment live sees its own order in the WS book (13 §6.11). ts-compat has no
  `md` anywhere.
- **K5.** The TS `feedClockMs` (`max(L, E)`,
  `src/backtest/feeds/wireBacktestExternalFeeds.ts:46-64`) exists only in
  ts-compat.

### 4.3 Receipt-time synthesis (realistic, telonex-delta)

Telonex local time `L` is Telonex's recorder clock, not the bot's: on
`btc-updown-15m-1789570800` it trails the exchange stamp by p50 +8 ms, p90
+14 ms, p99 +48 ms (review measurement, 2026-10-09; 14 F-8 measured p50 7 ms on
another market). TS assumes `L` includes the 50–150 ms delivery leg to the bot
(`wireBacktestExternalFeeds.ts:46-56`), and the feed latencies of 14 §9 were
calibrated against the bot's receive clock. Evaluating feeds, gates and
plugins at `max(L, E)` therefore shows external feeds about `md` older relative
to the book than live does, which is the edge lag-trading strategies trade on.
Realistic replaces `L` with a synthesized receipt time:

- **RS1.** For row `i` of the market file, in reader order:
  `R_i = max(R_{i−1}, E_i + d_i)`, with `R_{−1} = −∞` and `d_i` a sample of
  `ModelConfig.clock.marketData.delay` (§4.5): stream tag `md_row`, entity =
  input row index `i` (entity kind 6 of 10 §6.1 RNG-4, §16), draw 0, mapped
  per 10 RNG-6. The stream derives from the market seed, i.e. from (run seed,
  slug) (10 RNG-2, 21 C5), so `R` is identical for every candidate. It is
  computed once per market read into the decoded in-memory tape (16 §7.3) and
  never stored on disk: the derived native tape (16 §7.5) is seed-independent.
- **RS2.** Rows keep reader order; the clamp keeps `R` monotone, as frames
  arrive in order on one socket. All messages of one row share its `R`.
- **RS3.** `now = R` drives the window gate (§5.4), plugins, feed visibility
  (feed clock = `now`, replacing 14 F-7's `max(L, E)`), the synthetic flush
  rule (14 F-40 with `C(t) = R_t`), the skew estimate (§4.4) and the latency
  start.
- **RS4.** Cost: one counter-based draw per row (no state, no allocation);
  measured in M5a (16).

### 4.4 Exchange-time estimate

- **XT1.** `xnow = now − skew`. For backtest inputs, `skew` is the causal lower
  envelope over the market-data envelopes processed so far:
  `skew = min(at − exchange_ts)`, starting at the first market envelope of the
  input (pre-window rows included). On V4 this is `receivedAtMs − exchange ts`;
  on realistic Telonex it is `R − E`. It is a pure function of the input, so
  no job field carries it (21 §4). Journal, paper and live use the journaled
  clock samples of 50 §5.3, which apply the same lower envelope plus
  `GET /time`.
- **XT2.** The lower envelope estimates clock offset plus the minimum one-way
  delay. Its error is at most the spread of `md` (tens of ms), which is below
  the resolution of every rule it feeds: GTD lead 180 s and early expiry 60 s
  (11 §8), fee and taker-delay eras keyed by date (11 §5, §6), and the market
  close, which is itself unverified (11 §11).
- **XT3.** Uses: the GTD lead at decision (11 §8); in the simulator, an
  exchange-side action executed at loop time `τ` has exchange time `τ − skew`,
  and an exchange-side event due at exchange time `X` (GTD expiry, market
  close) is scheduled at loop time `max(now, X + skew)`, with `skew` read when
  it is scheduled (13 §4.3, §6.6).
- **XT4.** The final `skew` is reported in diagnostics.

### 4.5 `ModelConfig.clock`

Owned here; it shapes the shared input timeline, so it is run-level and MUST
NOT vary between candidates of a group (21 §8). Representation rules of 21 §6
apply; distribution kinds are those of 13 §7.3.

```jsonc
"clock": {
  "marketData": {
    "calibrationId": "uncalibrated-2026-10",          // resolved by the producer (13 §7.4)
    "delay": { "kind": "empirical", "quantilesMs": [ /* 101 entries */ ] }
  }
}
```

- realistic: `delay` is the `md` distribution of the trading host being
  emulated. For recorder-v4 and journal inputs the producer resolves the
  distribution of the host that recorded them (it is then used only by the
  latency model, 13 §6.8); for telonex-delta and paper, the live host's.
  Until the live host is chosen (01 §12.1 item 3) and measured (M10),
  worker-2's distribution stands in, and outputs are flagged uncalibrated.
- `md` samples are `receivedAtMs − exchange ts` of `book` and `price_change`
  frames on NTP-synced hosts. Host clock offsets of a few ms are not separated;
  they stay inside the calibration tolerance (D35). The first M3b step measures
  worker-2's distribution on at least 50 recent V4 packages and commits it with
  the per-market lower envelopes (13 §7.4).
- ts-compat: `{"kind":"constant","ms":0}`, required and unused.

## 5. The step

### 5.1 Order of operations

Pseudocode, normative for both profiles; profile differences are marked.

```text
step(env):
  // (a) Scheduled actions before this input. Inputs stamped T run BEFORE
  //     actions due at T (strict "<"). SelfTimed (backtest) runs them here.
  //     Journaled (paper, live) gets the same order because the core synthesizes
  //     and journals a Timer(t) envelope before env for every t < env.at (13 §2.3),
  //     so in that mode this loop finds nothing due.
  while let Some(t) = execution.next_due() where t < env.at:
      now = max(now, t)
      execution.run_next_due(market, queue)        // all actions sharing time t
      drain()
  now = max(now, env.at)
  match env.payload:
      Market(ev)          => on_market(ev)           // §5.2
      SyntheticTick(k)    => on_synthetic(k)         // §5.3
      Feed(_)             => {}                      // feed state already updated by the driver
      Account(input)      => execution.on_account_input(now, input, market, queue); drain()
      Timer(t)            => execution.on_timer(t, market, queue); drain()   // Journaled mode
      Control(c)          => on_control(c); drain()  // §8, §10

end_of_stream():
  realistic: execution.on_end_of_input()
             run the scheduler to empty in time order, one cascade per time,
             without strategy callbacks (the session is Closing, §10)
  ts-compat: nothing; undue actions are discarded (TS never executes them) — TC-C13
  finalize()                                                // 21
```

Each executed scheduled time is its own cascade: actions due at different times
never share a drain, and callbacks run with `now` equal to that time. With the
`latency: compat` model (13 §5.1), `next_due()` is `None` while input remains
and queued actions are released inside `on_market_event` instead.

### 5.2 Market events

```text
on_market(ev):
  produces_tick = ev is Book | PriceChange
  if produces_tick: counters.record(cause(ev))      // counted BEFORE the gate (21 §15)
  dispatch = produces_tick && in_window(ev)          // §5.4, per profile
  if dispatch: begin_tick(cause(ev))                 // §5.3
  ts-compat (TC-C9):
      if !dispatch: return                           // books only
      execution.on_market_event(now, ev, market, queue); drain()
  realistic:
      if produces_tick && session is Warming: plugins.observe(tick)   // warm-up, no strategy (D23)
      execution.on_market_event(now, ev, market, queue); drain()       // the simulator stops matching at the market close (13 §6.6)
  if dispatch: run_strategy_tick()                   // §5.3
```

- A tick that reaches `counters.record` is a **counted tick**; a counted tick
  that passes the window gate (`dispatch`) is a **strategy tick** (21 §1.1).
- `TickSizeChange` updates the rules in force in `SharedMarket` (11 §7.5); it
  never produces a tick.
- **Stale books (realistic, paper, live).** After a `BookReset` (15 I-6f, 50
  §7) an outcome book is stale until its next `book` message: its events are
  applied and counted (`produces_tick` and `counters.record` as usual) but
  `dispatch` is false, so no strategy tick runs, and the simulator does not
  match against that book (13 §6.5). ts-compat follows TS and has no stale
  state.
- `LastTrade` (trade prints) reaches the execution model in realistic (queue
  model, 13 §6.5). Prints never produce strategy ticks in v1, in either
  profile (30 §5 `TickCause` has no print cause; 21 §15 keys stay unchanged).
  A print-tick opt-in is a possible SDK minor release later.
- Callbacks drained after `on_market_event` see the new book and the plugin
  and feed snapshot of the **previous** dispatched tick (`StrategyRunner.ts:313,
  326-334, 436-437`), in both profiles (14 P-4).

### 5.3 Strategy ticks

```text
on_synthetic(k):
  counters.record(k)                                 // 21 §15, 14 §8.4
  if !in_window(per profile): return
  begin_tick(k)
  run_strategy_tick()                                // never calls execution.on_market_event

begin_tick(cause):                                   // before the execution step of this tick
  tick.seq = next 0-based strategy-tick index (22 §3.3)
  event_clock.init_if_unset(tick.ts)                 // StrategyRunner.ts:314
  trace(TickStart)                                   // TS onTickStart, runSingleMarket.ts:317

run_strategy_tick():
  feeds.advance(tick)                                // high-water feed clock, 14 F-7 (clock per §4.1)
  plugins.on_tick(tick, market)      // synthetic: only plugins that declare it (14 F-37)
  if !wake(tick):                                    // tick interest filter, below
      counters.strategy_ticks_skipped += 1
      trace(FeedView); trace(Decision{origin: Tick, intents: []})  // built only if a sink asks
      return
  snapshot = plugins.snapshot(); feed_view = feeds.view()   // once per dispatched tick
  trace(FeedView)
  intents.clear()
  guarded(strategy tick callback writes into intents)        // §11
  trace(Decision{origin: Tick})
  om.handle(&intents, decision_stamp, queue)         // §7
  drain()
```

- Events delivered by the execution step of a dispatched tick belong to that
  tick in the trace, as in TS. Events produced by inputs that are not dispatched
  ticks (feeds, prints, timers, account inputs, controls) belong to the last
  dispatched tick.
- Synthetic ticks never run the execution model's market-event processing: a
  resting order must not be re-tested against an unchanged book
  (`StrategyRunner.ts:316-334`; 14 F-36). In realistic SelfTimed mode, actions
  due before the synthetic tick's time have already run in step (a); that is
  exact-time execution, not re-matching.
- **Tick causes** (closed vocabulary; the `eventsByType` keys of 21 §15 and the
  trace `cause`): `book`, `price_change`, `binance_agg_trade`,
  `chainlink_round`. Identical in both profiles.
- **Tick interest filter** (opt-in, D41; declaration 30 §4.1,
  wake rule 16 §9.4 TF-1/TF-2). `wake(tick)` is true unless the strategy
  declared a tick interest other than `All` and no TF-2 condition holds.
  Only the strategy callback is skipped (TF-3): counting, book apply,
  execution, feed advance and plugin `on_tick` run on every event, and the
  plugin snapshot and feed view are not built. For a conforming strategy
  (TF-5) the trace is byte-identical with and without the filter, because a
  skipped tick still emits its `TickStart`, `FeedView` (built only when a
  sink requests it) and an empty tick `Decision`. Skips are counted in
  diagnostics (`strategyTicksSkipped`, 21 §10), never in `eventsProcessed`.
  The rule runs here, so backtest, paper and live behave identically (TF-4).
  The ts-compat ports MUST NOT declare it (TF-1).

### 5.4 Window gate

| Aspect | ts-compat, telonex-delta (TC-C9) | ts-compat, recorder-v4 | Realistic (all input modes), paper, live (D23) |
|---|---|---|---|
| Strategy ticks | `tick.ts ∈ [start, end]`, inclusive (`src/backtest/runSingleMarket.ts:306-315`) | No strategy gate; the V4 replay drops envelopes outside `[start, end)` on receipt time (15 §1) | `now ∈ [start, end)` on the receive clock (§4.1) |
| Plugins on out-of-window ticks | Never called (14 P-5) | n/a | Observe while Warming (before `start`); not after `end` |
| Execution on out-of-window events | Frozen: no due actions, no expiry, no matching | n/a | Matching and scheduled actions continue until the exchange-side market close. At client time `end` (`Control(WindowEnd)`) the OM sends an engine-originated `CancelMarket{Market}` with cause `WindowEnd`, which travels with the cancel latency like any cancel. Orders still resting at the close end `Canceled(MarketClosed)` (13 §6.6) |
| Account callbacks | Only inside the window (events occur only there) | n/a | Strategy called only while the session is `Active`; later events are applied to the ledger without callbacks |
| Counting | Before the gate (21 §15) | Before the gate | Before the gate |

`start` and `end` come from the slug (`MarketInfo.window`, 10 §5). Live sends
the same `DELETE /cancel-market-orders` at local `end` (50 §6.4), so the
simulator and live share one window-end model.

## 6. Strategy callbacks and cascades

### 6.1 Callback contract

- The tick and event callbacks write intents into the engine-owned, reused
  `Intents` buffer (30 §7) and never allocate a fresh `Vec` per call (10 §11
  P3; WIP `strategy.rs:39-43` returned one). Signatures: 30 §4.
- `ctx` is a stack value of borrows into session and shared state (30 §5).
  Reading it never allocates or copies; derived values are lazy and cached per
  tick.
- A fresh strategy instance is created per session from the factory, exactly
  once (TS creates one per market, `StrategyRunner.ts:294`).
- Every delivered account event is offered to the strategy, including the
  engine's own `OrderSubmitted` and every `SettlementUpdate`
  (`StrategyRunner.ts:628-675`), except kinds the strategy excluded through
  its declared interests (30 §4.1); a skipped callback is equivalent to one that
  returned no intents. The number and order of callbacks are part of parity.

### 6.2 Cascade queue

- One FIFO queue per session. The OM and the execution adapter append events in
  emission order; `drain` pops from the front.
- Intents written in the callback for event *k* are handled immediately and
  their events are appended to the **back** of the queue, after events already
  queued. Siblings already in the queue are delivered before the strategy sees
  results of its own new intents (breadth-first, `StrategyRunner.ts:551, 568-595,
  689`).
- Delivery of one event, in order: the ledger applies it (§9) → the OM
  processes it (cid release, deferred cancels, §7.6) → `trace(AccountEvent)` →
  strategy callback (if enabled, interested and allowed by §5.4) →
  `trace(Decision{origin: Account})` → the OM handles the intents (appending to
  the queue).
- `drain` is not re-entrant: only the loop calls it, at the points of §5.

### 6.3 Cascade budget

- `ModelConfig.runner.maxEventsPerDrain` (21 §6; default 4200,
  `src/trading/runnerConfig.ts:2`; never read from env) bounds deliveries with
  callbacks in one drain.
- **Backtest (both profiles):** when exceeded, that candidate stops at once: no
  further callbacks and no further replay for it. Its result is the error
  `strategy_fault` with detail `cascade_limit` (seq, tick, deliveries in the
  drain), and it emits no `MarketStats` (21 §14: other candidates of a group
  continue). TS instead clears the queue silently, including fills and
  `order_submitted`, and keeps going (`StrategyRunner.ts:574-585`); a TS bug,
  not reproduced. A parity market that hits the limit is classified as that
  TS bug (60 §3) and excluded from money comparisons.
- **Paper and live:** as a strategy panic (§11, D32). Every remaining queued
  event is still applied to the ledger without callbacks; events are never
  dropped (10 S5).

### 6.4 Plugin and feed snapshot timing

- Plugins update once per dispatched strategy tick, after the tick's execution
  step and cascade and before the tick callback; the plugin snapshot and the
  feed view are then fixed for every account callback until the next
  dispatched tick (`StrategyRunner.ts:326-459`, cache at `:436-437, 655`;
  `src/strategy/plugins/PluginSet.ts:72-79`; 14 P-4).
- Consequence kept in both profiles: callbacks for events produced by
  `execution.on_market_event` at tick *N* see tick *N*'s book and tick *N−1*'s
  plugin snapshot and feed view.
- Snapshot keys are plugin ids; absent values are omitted; with duplicate ids
  the last registered plugin wins (`PluginSet.ts:90-101`). Snapshots are
  borrowed, never cloned per tick (TS `structuredClone`s the feed snapshot,
  `ExternalFeedsRequestPlugin.ts:81-87`; 14 P-4).
- With no plugins and no feeds requested, the snapshot step costs nothing.

### 6.5 Context semantics

The accessor names are owned by 30 §5. Semantics fixed here:

| Accessor | Semantics |
|---|---|
| `now()` | `tick.ts` (§4.2): the loop clock in realistic, the TS tick timestamp in ts-compat. Inside event callbacks, the decision stamp of §4.2 |
| `tick()` | The current tick (`seq`, cause, synthetic flag, `exchange_ts`); inside event callbacks the last dispatched tick |
| `book(o)` | ts-compat: recorded book. Realistic: recorded book minus depletion plus own resting orders (13 §6.11) |
| `feeds()`, `plugins()` | Tick-scoped snapshots (§6.4) |
| `rules()` | `ExchangeRules` in force (11) |
| `portfolio()` | The strategy view of the ledger (§9.7) |
| `warmed()` | Always true: a session starts only after its rules are loaded, which replaces the TS lazy warmup (`src/strategy/strategyToolkit.ts:51-56`; research/requirements-sweep.json `exchange-rules-fetched-and-journaled`) |

Orderbook and position metrics (TS `ctx.metrics`) are not engine state; if a
port needs them they are pure toolkit functions over `book()` and `portfolio()`
(30 §5), with depth levels as an argument, never from
`WEB_UI_ORDERBOOK_LEVELS` (`src/market/orderbook/utils.ts:3-12`).

## 7. Order manager

### 7.1 Identities

`OrderKey`, `CidKey`, `FillKey`, `TradeSeq`, `CancelOp` (with its
`CancelSeq`), `OpKey` and exchange order ids are defined in 10 §6. Processing
rules:

- Every execution event about an order carries its `OrderKey`; about a split or
  merge, its `OpKey`. Adapters never address orders by cid.
- `cid → current OrderKey` points at the latest submission of that cid; earlier
  keys stay in the ledger. A late event for an older generation updates only
  that generation's record. This replaces TS object-identity maps
  (`src/trading/OrderManager.ts:106-118`) and the cid-reuse guard
  (`Portfolio.ts:189-197, 307-312`); the WIP keyed unapplied submissions by cid
  (`order_manager.rs:183, 665`), which breaks cancel-and-replace dedupe.

### 7.2 Pipeline for one intent list

`om.handle(intents, stamp, queue)`.

**Realistic, paper and live (first principles).** Intents are handled one at a
time, in list order, and each intent's events are emitted before the next
intent is looked at. There is no separate risk pass and no reordering. For a
placement (each order of a batch separately):

1. **Halt and guards.** A halted strategy (§11) or a tripped session guard
   (§8.3) → `OrderRejected{StrategyHalted | KillSwitch | guard reason}`.
2. **Dedupe** (§7.6). A placement of an active cid is dropped: no event, no
   record, counted in diagnostics as `duplicate_active_cid`.
3. **Validation** (§7.4) → `OrderRejected{reason}` with no record.
4. **Risk** (§8.1), against the ledger as it stands, which already includes
   every record emitted earlier in this list (§9.1) → `OrderRejected{Risk…}`.
5. **Funding** (§7.5) → `OrderRejected{InsufficientCapital | InsufficientInventory}`.
6. **Accept.** Write the order record with its reservation, emit
   `OrderSubmitted`, dispatch (`execution.submit`).

Cancels, splits and merges follow §7.3. An intent rejected at any step consumes
no risk capacity and no capital.

**ts-compat (TC-C2), superseded by D71: ts-compat follows the realistic order
above, and this paragraph is kept as the TS reference for classification.**
TS order (`OrderManager.ts:143-223`): (1) the TS risk
pass runs over the whole list first (§8.2); (2) its rejections are emitted
first, in list order, and a rejection whose cid has an active generation is
dropped silently (`OrderManager.ts:176-184`); (3) each allowed intent then runs
its handler in list order: dedupe → validate → fund → `OrderSubmitted` →
dispatch; (4) after each dispatch the OM scans the synchronous events just
appended (13 §2.4 X2): a terminal event for a key dispatched in this call sets
`om_terminal` (§7.6), and an `OrderAccepted` marks the key acknowledged for
cancel resolution later in this call.

### 7.3 Intent semantics

| Intent | OM checks, in order | Ledger at emission | Dispatch |
|---|---|---|---|
| `PlaceLimit` | §7.2 | New order record (`InFlight`) with reservation; emit `OrderSubmitted` | `Place{[key]}` |
| `PlaceBatch` | Realistic: more than the batch cap (11 §9) → every order rejected `BatchTooLarge`, nothing dispatched (TC-C12). Then per order in batch order, §7.2 | One record per accepted order | One `Place{keys}` for the accepted orders (one transport latency sample, 13 §6.8); none accepted → no dispatch. Rejected orders get no `OrderSubmitted` (`OrderManager.ts:649-750`) |
| `CancelOrder` | Realistic: resolved like `CancelBatch`. ts-compat: the same since D71 (TC-C5 not reproduced) | `CancelState` updated (10 §8.1) | `Cancel{[key]}` |
| `CancelBatch` | Resolve refs (`src/trading/cancellation.ts:61-127`): cap exceeded (realistic 1000, 11 §9; ts-compat 3000, `cancellation.ts:69`) → `CancelFailed` for the whole intent; invalid ref; conflicting cid and exchange id → `ConflictingRefs` (10 N1); known terminal → skipped silently; unknown cid → `UnknownClientOrder`; target `InFlight` without ack → realistic `CancelState::Deferred` (below), ts-compat `MissingExchangeOrderId` (TC-C6); duplicates removed | `CancelState` updated | `Cancel{keys}` for targets not deferred |
| `CancelMarket` | Scope = one outcome or the whole market (10 §7.3) | — | `CancelScope{scope}`; resolved when the cancel takes effect, so it includes orders opened meanwhile (`BacktestExecution.ts:744-751`) |
| `CancelAll` | — | — | `CancelAll` |
| `SplitPositions` | Halt and guards; size ≤ 0 → `SplitFailed(InvalidSize)`; realistic loss stop (§8.1); fund cost = size → else `SplitFailed(InsufficientCollateral)` | Pending split, reserved cost | `Split{op, size}` |
| `MergePositions` | size ≤ 0 → realistic `MergeFailed(InvalidSize)` (10 N4), ts-compat no event (TC-C7); clamp to `min(size, mergeable(Up), mergeable(Down))`; result ≤ 0 → `MergeFailed(InsufficientPairs)` (`OrderManager.ts:393-431`) | Pending merge reserves shares of both outcomes | `Merge{op, size}` |

- **Deferred cancels (realistic, live).** A cancel whose target is `InFlight`
  without a delivered ack sets `CancelState::Deferred`. The OM dispatches it
  when the target's `OrderAccepted` is delivered. If the target becomes
  terminal first, the deferred cancel resolves silently (10 §8.1). This is the
  live constraint: cancels are addressed by exchange order id
  (`cancellation.ts:114-118`). The model variant `cancelBeforeAck: immediate`
  (13 §7.3) dispatches at once instead.
- Cancels always pass: they are never deduped, risk-checked or blocked by a
  halt, so a halted session can still clean up.
- Splits and merges are not deduped and have no cid.
- `mergeable(o)`: realistic = `sellable(o)` (§9.3); ts-compat = delivered
  quantity minus pending merges.

### 7.4 Validation

| Check | Realistic (11 §7–§11) | ts-compat (TC-C1, `OrderManager.ts:756-780`) | Reason (10 §10.2) |
|---|---|---|---|
| size > 0 | yes | yes | `InvalidSize` |
| price > 0 | covered by bounds | yes | `InvalidPrice` |
| Post-only only on GTC/GTD | yes | yes | `PostOnlyRequiresResting` |
| GTD has `expire_at` | yes | yes | `GtdRequiresExpiry` |
| GTD lead | `expire_at ≥ xnow + gtd_min_lead` (11 §8, §4.4) | `expire_at ≥ stamp + 60 000 ms` (`OrderManager.ts:189`) | `GtdLeadTooShort` / `GtdExpiryTooSoon` |
| `expire_at` on non-GTD | ignored | ignored | — |
| Tick in force, price bounds, size and amount precision, minimum size and notional | yes | no | `InvalidTick`, `PriceOutOfBounds`, `SizePrecision`, `AmountPrecision`, `SizeBelowMinimum`, `NotionalBelowMinimum` |
| Market open (`stamp < end`) | yes | no | `MarketClosed` |
| No self-cross (below) | yes | no (TC-C14) | `SelfCross` |
| Order meta ≤ 16 KiB (21 §16) | yes | yes | `MetaTooLarge` |

- **Self-cross block (realistic, paper, live; D54, 10 N6).** A
  placement is rejected if it could match an own order of the same market as
  10 N6 defines it (non-terminal, any type, cancel not acknowledged, earlier
  entries of the same batch included): directly
  (same outcome, opposite side, BUY limit ≥ own SELL price or SELL limit ≤ own
  BUY price), or through the exchange's complementary matching (other
  outcome, same side: two BUY prices summing to ≥ 1, two SELL prices summing
  to ≤ 1). Polymarket documents no self-trade prevention (11 §11), so the
  engine never lets the exchange decide; no self-trade probe is run. The OM
  keeps the best own price per (outcome, side) over those orders, updated at
  emission, at `CancelAcked` delivery and at terminal delivery, so the check
  is four comparisons. Because every order at the exchange has such a record
  from emission until its terminal event or cancel acknowledgement is
  delivered, no own taker can ever meet an own resting order (13 §6.12).
- In live and paper the same realistic checks run before sending; the exchange
  remains final (11 §12).
- The simulator re-applies exchange-side checks at arrival, because rules can
  change in flight (13 §6.2).
- FAK has natural semantics in both profiles; TS has no FAK, so there is
  nothing to reproduce (10 §7.1).

### 7.5 Funding

- BUY: `reservation(order) ≤ available` (§9.4), compared exactly in fixed
  point. TS adds a `1e-8` float tolerance (`OrderManager.ts:153`); not emulated
  (R1); a boundary flip is classified.
- The reservation formula is 10 §9.4 C1 and §3.3 R9 per profile: realistic =
  `Ceil` notional + the maximum fee over reachable fill prices, and for
  collateral-sized FOK/FAK BUYs the amount plus its fee bound; ts-compat =
  limit × size + 700-bps fee at the limit unless post-only
  (`src/trading/capital.ts:16-28`).
- SELL: realistic `size ≤ sellable(outcome)` else `InsufficientInventory`;
  ts-compat none (TC-C4).
- Split: `size ≤ available`.

### 7.6 Dedupe and cid release

- **Rule (both profiles).** Placing a cid that has an active generation is
  dropped idempotently: no event, no record. Strategies re-send the same intent
  every tick on purpose (`OrderManager.ts:105`), so an emitted rejection would
  flood callbacks and traces. The drop is counted in diagnostics as
  `duplicate_active_cid`; it is a counter key, never an emitted reject reason.
  Since D71 the position of dedupe is the same in both rule sets: before
  validation and risk (§7.2).
- A cid is **active** iff its current key exists and is not `om_terminal`.
- `om_terminal` is set when any of these happens:
  1. A terminal event (`OrderDone`, `OrderRejected`) for the key is returned
     synchronously by a dispatch in the same OM call (ts-compat only, since
     only ts-compat emits synchronously; `OrderManager.ts:311-334, 526-534,
     739-747`).
  2. A terminal event for the key is delivered.
  3. Delivered fills reach the order size (TS removes the open order on full
     fill, then reconcile releases the cid, `Portfolio.ts:865-873`,
     `OrderManager.ts:161-174`).
- A new session starts with no active cids (`OrderManager.ts:143-149`).
- Asynchronous terminal events (from scheduled actions or market events)
  release a cid only when delivered. A strategy that re-places a cid from the
  fill callback of a fully filled order is therefore deduped until the fill is
  delivered, as in TS.

### 7.7 Reject and failure reasons

Reasons are the enums of 10 §10.2; the TS strings they serialize to (trace,
simulator, tests) are listed there. This document adds where each class is
produced: guards, validation and funding by the OM (§7.2, §7.4, §7.5); risk by
the risk step (§8); exchange classes by the execution adapter (13 §6.2, §9.2);
cancel failures by the OM's resolution (§7.3) or the adapter.

## 8. Risk limits and guards

`ModelConfig.risk` (21 §6). Defaults equal TS (`src/trading/riskLimits.ts:24-29`):
`maxOpenOrders` 100, `maxOrderSize` 2000 shares, `maxAbsPosition` 2000 shares,
`maxLossStopUsdc` 500.

### 8.1 Realistic, paper and live

Per placement that passed dedupe and validation (§7.2 step 4), in this order:

| Check | Rule | Reason |
|---|---|---|
| Loss stop | Realized PnL (§9.5) ≤ −`maxLossStopUsdc` blocks BUY placements and splits. SELLs (bounded by `sellable`), merges and cancels stay allowed, so the strategy can exit | `RiskLossStop` |
| Order size | Shares > `maxOrderSize`; a collateral-sized BUY counts `Ceil(amount / limit)` shares | `RiskMaxOrderSize` |
| Open orders | Non-terminal own records (`InFlight`, `Delayed`, `Live`, `Unknown`) + 1 > `maxOpenOrders` | `RiskMaxOpenOrders` |
| Position | BUY only: quantity + remaining quantity of non-terminal BUY records of that outcome + size > `maxAbsPosition`. A SELL cannot raise the absolute position, because `sellable` bounds it | `RiskMaxAbsPosition` |

- The view is the ledger itself (§9.1): records emitted earlier in the same
  list or cascade count at once, so orders placed from callbacks cannot exceed
  a limit.
- Capacity is freed only when a terminal event or fill is delivered; a cancel
  in flight frees nothing.

### 8.2 ts-compat (TC-C2, TC-C3): superseded by D71

**Not reproduced since D71.** ts-compat applies §8.1; this section is kept as
the TS reference for PARITY.md classification.

The TS risk pass (`src/trading/riskLimits.ts:70-219`), reproduced as one
function:

- It walks the whole intent list before any handler runs. Counters are
  incremental within the list, including intents the OM later dedupes
  (`riskLimits.ts:141-148`). Intents with invalid size pass to validation
  uncounted (`riskLimits.ts:108-112, 173-177`). Cancels, splits and merges pass
  through (`riskLimits.ts:158-162`).
- Per placement (each batch order separately), in order: loss stop → size >
  max → open orders + 1 > max → |projected| > max, with projected = position +
  open buys + size (BUY) or position − (open sells + size) (SELL)
  (`riskLimits.ts:93-216`).
- The view counts only orders whose `OrderSubmitted` was delivered (TS reads the
  delivered portfolio, `riskLimits.ts:47-54`).
- Loss stop on realized PnL blocks every placement, including SELL exits
  (`riskLimits.ts:84-86, 165-170`) — TC-C3.
- Emission order and the silent drop of rejections for active cids: §7.2.

### 8.3 Session guards (paper, live)

- Kill switch, session loss including settlement, wallet exposure, order-rate
  cap, reject burst (D31, 50 §10.2). Checked at §7.2 step 1; they persist
  across market rotation and are fed by `Control(Guard)` and
  `Control(Operator(kill_switch))` envelopes. A tripped kill switch rejects all
  placements (`KillSwitch`), issues an engine-originated `CancelAll` through
  the OM, and halts the strategy.
- Engine-originated intents (kill switch, panic handling, operator commands,
  window-end cancel, rotation teardown) go through the same OM pipeline and
  ledger as strategy intents, so they are journaled, validated and visible in
  the view. Their cancels carry their cause (`CancelCause`, 10 §10.2; 50
  §8.2.4 records the same causes live).

## 9. Ledger

### 9.1 One ledger, applied immediately

Each session has exactly one ledger: the only store of orders, fills, positions,
cash and reservations. There is no second cash book, no pending-capital overlay
and no set of unapplied submissions (`OrderManager.ts:106-140` and WIP
`portfolio.rs:174-200` are not reproduced, R4). Every fact is applied exactly
once, at the moment the loop processes it:

| Fact | Applied when |
|---|---|
| Engine commands: submission, cancel request, split request, merge request | When the OM emits them. The engine knows its own decisions at once, so reservations exist from decision time |
| Exchange-originated events: accept, delay, open, fill, settlement update, done, reject, cancel ack, cancel failure, split/merge result | When they are delivered from the cascade queue (§6.2), the instant the strategy is told. In paper and live, delivery happens when the input arrives |

Rationale (normative; confirmed at gate 1): the strategy's view in the
callback for event *k* reflects exactly the events delivered so far. That is
what live does (an
exchange event cannot be known before it arrives) and what TS does (Portfolio
applies at dequeue, `StrategyRunner.ts:597-629`). Applying simulator output at
emission instead would let the callback for `OrderSubmitted` see that order's
fill before the fill is delivered, would release cids on fill callbacks earlier
than TS, and would change funding decisions inside cascades; it is rejected.
Because commands are applied at emission, funding, dedupe, risk and merge
clamping need no overlay: available cash equals TS's `withPendingCapital` by
construction, since an undelivered submission has no delivered fills and keeps
its full reservation (`OrderManager.ts:121-140`, `Portfolio.ts:157-163`).

### 9.2 Order records and delivered events

Order states and their transitions are defined in 10 §8 (`InFlight`, `Delayed`,
`Live`, `Unknown`, terminal `Filled`, `Canceled(cause)`, `Expired`, `Killed`,
`Rejected(reason)`, orthogonal `CancelState`). The record adds: decision stamp,
meta id, signed amounts (realistic, 11 TK4), delivered filled quantity,
authoritative final quantity (optional), trade-status rank, per-fill
settlement status, and the flags `submitted_delivered` and `om_terminal`.
Ledger effects of each delivered event:

| Delivered event (10 §10.1) | Ledger effect |
|---|---|
| `OrderSubmitted` | `submitted_delivered = true`: the order appears in the strategy's open orders |
| `OrderAccepted` | Acknowledged; exchange id stored in the side table (10 §6); deferred cancel released (§7.3) |
| `OrderDelayed` | `→ Delayed` |
| `OrderOpen` | `→ Live` |
| `Fill` | Cash moves by the fill's counter-amount (13 §6.4.1: realistic exchange arithmetic; ts-compat 10 R5/R6) and `fill.fee`; delivered filled += qty; position and realized PnL updated (§9.5); the order leaves the open orders when filled reaches its size (`Portfolio.ts:844-878`). A record already terminal keeps its state; the late fill still updates cash, position and filled (10 §8.2, `late`) |
| `SettlementUpdate` | Rank = max(rank, MATCHED 1, MINED 2, CONFIRMED 3) (10 §9.2); `Retrying` keeps the rank; never sets the final quantity (`Portfolio.ts:228-230`); `Failed` reverses the fill (§9.3) |
| `CancelAcked` | `CancelState` acknowledged; no lifecycle change (13 §6.7) |
| `OrderDone{reason, filled}` | Terminal state; final quantity per §9.4; removed from open orders |
| `OrderRejected` (keyed, exchange origin) | `→ Rejected`; final quantity 0 |
| `CancelFailed` | `CancelState::Failed`; the order stays active |
| `PositionsSplit`, `PositionsMerged`, `SplitFailed`, `MergeFailed` | §9.5; pending reservations released |

OM-level rejections carry no key and do not touch the ledger (TS ignores them,
`Portfolio.ts:259, 682-684`).

### 9.3 Settlement, sellable inventory, reversal

- Realistic and live track a status per trade (10 §9.2). ts-compat produces only
  the TS order-level statuses (13 TC-E8).
- `sellable(o)` (realistic) = quantity from fills whose status ≥
  `ModelConfig.execution.sellGate` (13 §7.3; default `Mined`, the CLAUDE.md
  gotcha; verified by the day-0 probes, 51) + shares from completed splits −
  shares sold − shares reserved by open SELL orders − shares reserved by
  pending merges − adopted read-only shares (§10) (10 F2, C2). SELL validation
  and merge clamping use it.
- `SettlementUpdate{status: Failed}` reverses the fill (10 F1): cash, quantity,
  basis, fee and realized PnL return to their pre-fill values and the order's
  filled quantity drops. With the gate at `Mined` or later the reversed shares
  cannot have been sold. If the gate is `Matched` and the quantity would become
  negative, it is clamped at 0, the diagnostic `reversal_deficit` counts the
  excess, and live raises an alert (50).

### 9.4 Capital

Reservation rules kept from TS (research/approach-audit.json portfolio audit;
`capital.test.ts`):

| Obligation | Created | Amount | Reduced by | Released by |
|---|---|---|---|---|
| BUY order | At OM emission | Reservation of 10 §9.4 C1 for the outstanding quantity, outstanding = max(0, final.unwrap_or(size) − delivered filled) | Delivered fills | Delivered terminal with an authoritative final quantity |
| Collateral-sized BUY (FOK/FAK, realistic) | At emission | Amount + fee bound (10 §9.4 C1) − delivered spend | Delivered fills | Delivered terminal |
| Split | At emission | Size (1 USDC per full set, `BacktestExecution.ts:294`) | — | Delivered `PositionsSplit` (cash moves) or `SplitFailed` |
| SELL order | — | No cash; realistic reserves shares (§9.3) | Delivered fills | Delivered terminal |
| Merge | At emission | Shares of both outcomes | — | Delivered `PositionsMerged` or `MergeFailed` |

Authoritative final quantity (`Portfolio.ts:255-278`; 10 S3):

| Terminal | Final quantity |
|---|---|
| `OrderRejected` | 0 |
| `OrderDone(Killed)` without `filled` | max(0, delivered filled) |
| `OrderDone(Filled)` | size |
| `OrderDone` with `filled` | max(filled, delivered filled) |
| `OrderDone(Canceled \| Expired)` without `filled` | Unresolved: the reservation stays until an authoritative quantity arrives (`Portfolio.ts:276-277`) |

- `cash = starting + Σ delivered cash movements` (fills, split costs, merge
  proceeds).
- `available = cash − Σ reservations`. Backtest capital is an isolated
  per-market allowance, `ModelConfig.capital.startingCapitalUsdc` (default 500,
  `capital.ts:6`), independent of the aggregate `INITIAL_CAPITAL` of batch stats
  (21 §6, 42).
- Live and paper: `available = min(cash − reservations, cap)`, with `cap` from
  `CapitalCap` envelopes that the runtime computes from the CLOB collateral
  balance minus reservations across all open markets (D31, 50).
- Sale proceeds are available immediately; turnover may exceed capital
  (`capital.test.ts:395`). Per-fill fee rounding dust beyond the reservation is
  charged to cash and counted, never rejected (10 §9.4 C1).

### 9.5 Positions, fees, splits, merges

- Position per outcome (10 §9.3): quantity ≥ 0 and cost basis, in both
  profiles; realized PnL is one session total.
- **Fees:** `fill.fee` is the only fee source. It is computed once by the
  execution model's fee model (13 §5.1, §6.9) and summed by the ledger, stats
  and traces; nothing recomputes it from a rate (TS recomputes in four places,
  `Portfolio.ts:894-899`, `capital.ts:30-38`, `src/backtest/stats/marketStats.ts:128-134`,
  `StrategyRunner.ts:612-623`; not reproduced).
- **BUY fill:** quantity += qty; basis += counter-amount + fee.
- **SELL fill:** removed basis per 10 §3.3 R10 for `min(qty, quantity)` (a full
  close removes the whole basis); realized += proceeds − fee − removed; basis
  −= removed; quantity −= `min(qty, quantity)`. Realistic never sells beyond
  `sellable`, so the minimum is always `qty`.
- **ts-compat naked sells (TC-C4).** TS lets a SELL fill without inventory and
  clamps the position at zero (`Portfolio.ts:924-976`, `sellQty = min(size,
  qty)`). Rust keeps the fill for sequence parity, clamps the quantity at 0 as
  TS does, credits the full proceeds to cash and realized PnL (the fill
  happened), and counts the excess in the diagnostic `oversold_qty`. No
  signed short position exists in the ledger. The PnL identity (§9.6) holds.
  TS realizes PnL only on `min(size, qty)`; that difference is the classified
  TS bug of 13 §5.4. A signed quantity is added only if a parity market proves
  that a TS decision depends on it, and then as a narrowly scoped TC rule.
- **Split** (delivered `PositionsSplit`): cash −= cost; both outcomes' quantity
  += size with **zero basis** in both profiles (`Portfolio.ts:790-825`); the
  session's split-cost total += cost. Zero basis keeps `MarketStats.cost` and
  `splitCost` semantics unchanged (21).
- **Merge** (delivered `PositionsMerged{size}`): cash += size; each outcome
  removes basis at average cost; realized += size − removed(Up) − removed(Down).
  TS credits the cash but realizes nothing and keeps the basis
  (`Portfolio.ts:553-586`): a TS bug, classified, not reproduced (13 §5.4).
- **Settlement** at finalize: payout per outcome from the job's resolution, 1
  for the winner and 0 for the loser (10 M6, 21).

### 9.6 PnL and identity

- `pnl = cash_end − starting + Σ_o quantity_o × payout_o` is the source of truth
  (10 §9.4 C4).
- Identity: `pnl == realized + Σ_o quantity_o × payout_o − Σ_o basis_o − split_cost`.
  It MUST hold exactly in fixed-point units: the same rounded removed basis enters
  both realized PnL and the remaining basis, so rounding cancels. Debug builds
  check it after every delivered event; release builds check it at finalize;
  property tests check it on fuzzed streams (60). A violation is an
  `engine_fault` (§11).
- Output rounding and the mapping to `MarketStats` are owned by 10 §4 and 21.

### 9.7 Strategy view

The view is a borrow of the ledger; reading it never allocates (30 §5.2).

| Item | Semantics |
|---|---|
| Capital | `{starting, cash, reserved}`, `available()`; `reserved` includes undelivered submissions (TS decision portfolio, `StrategyRunner.ts:451, 668`) |
| Position | Quantity (≥ 0), basis, average entry = basis / quantity when both are > 0 |
| Open orders | Records with `submitted_delivered` and a non-terminal state, in submission order, keyed by cid (current generation) |
| Order by cid | The cid's latest generation: state, settlement rank, filled, remaining, price, size, meta |
| Fills | All session fills in delivery order, lossless (replaces TS's 500-entry ring, `Portfolio.ts:140`) |
| Realized PnL, event clock, sellable | §9.5, §4.2, §9.3 |

Foreign orders seen on the user WS are not part of the view (10 S6, 50).

### 9.8 Invariants

Checked by debug assertions and property tests (60):

1. Cash conservation: `cash == starting + Σ cash movements`.
2. Every reservation is ≥ 0 and is released on every terminal path.
3. Delivered filled ≤ size (or spend ≤ amount) and ≤ the authoritative final
   quantity once known (10 S2). Fills delivered after the terminal event are
   allowed (report latencies are independent, 13 §6.7) and must fit within it.
4. Quantity ≥ 0 in both profiles. Realistic: SELL fills never exceed sellable
   at decision time (10 §9.3).
5. The PnL identity (§9.6).
6. Exactly one terminal event (`OrderDone` or `OrderRejected`) per key (10 S1).
7. `now` is monotone.

## 10. Sessions, rotation and lifecycle

- **Backtest:** one session per (market, candidate) per job. A group is N
  sessions plus one `SharedMarket` (41, 16).
- **Live and paper:** the runtime creates a session when it pre-subscribes a
  market, before the window starts (50).

| State | Strategy | Execution | Ends when |
|---|---|---|---|
| `Warming` | Not called; plugins observe ticks (D23) | Idle | `now ≥ start` |
| `Active` | Called inside the window | Normal | `Control(WindowEnd)` at `end` |
| `Closing` | Not called | The OM sends the engine-originated `CancelMarket{Market}` with cause `WindowEnd` (cancel latency applies); matching continues until the exchange-side market close, which cancels what is still resting with `Canceled(MarketClosed)` (13 §6.6). Live sends the same cancel as `DELETE /cancel-market-orders` (50 §6.4). Late events are applied | All orders terminal and resolution received |
| `Done` | — | — | Emits the per-market result (21, D11) |

- Events of an old market route to its own session by `OrderKey` or market and
  never reach a newer session or its allowance (`StrategyRunner.ts:597-608`;
  `capital.test.ts:531-596`). TS's cancel of old orders at the first tick of
  the next market (`StrategyRunner.ts:266-306`) is replaced by the window-end
  rule.
- **Startup (D29):** before any session starts, the runtime cancels open orders
  in the current markets. An `AdoptPositions` control envelope records adopted
  inventory in the ledger, flagged read-only: excluded from `sellable` and from
  the per-market result (50).
- **Observe-only (live, paper):** `SessionStart{observe_only: true}` keeps the
  session from ever becoming `Active`: it goes from `Warming` to `Closing` at
  `end` with no strategy callbacks, while plugins observe. The runtime sets it
  for a late start (process started after `start + late_start_skip`, default
  15 s, `src/cli/trading-bot.ts:582-585`; 50 §6.4) and for windows after an
  operator `pause` (50 §16). TS still ran the simulator path and account
  callbacks for skipped markets (`StrategyRunner.ts:363-369`); not reproduced.
- **Early teardown (live, paper):** a session the runtime ends before `end`
  (a market refused after a `RulesUpdate`, 50 §6.2) gets an engine-originated
  `CancelMarket{Market}` with cause `Rotation` and enters `Closing`.

## 11. Fault semantics

Strategy callbacks run inside `catch_unwind` (artifacts use `panic=unwind`,
D18). After a panic the strategy object is never called again. Error classes
are those of 20 §4.

| Fault | Backtest (standalone or group) | Paper and live |
|---|---|---|
| Strategy panic or overflow in strategy code | The candidate stops; it fails with `strategy_fault` (detail `panic: <message>`) and emits no `MarketStats`; other candidates continue; not retried | D32: engine-originated `CancelMarket{Market}` with cause `StrategyPanic` (50 §11), strategy halted until rotation, alert; exchange events keep being applied |
| Cascade budget exceeded (§6.3) | The candidate stops; `strategy_fault` (detail `cascade_limit`), no `MarketStats` | As a panic; remaining events applied without callbacks |
| Overflow in engine code (10 T3; both build profiles keep overflow checks, 31 §4.2) or ledger invariant violation | `engine_fault`; never continue silently | Kill switch on every session: `CancelAll`, runtime halts, alert |
| Data anomaly | Per 15 §8 (counted diagnostics or `data_defect`) | Per 15 and 50 |
| Adapter or network error | n/a | Mapped to events (13 §9); never a panic |

TS rejects the awaiting backtest caller on an exception and lets live continue
after logging (`StrategyRunner.ts:211-246`); both are replaced by this table.

## 12. TraceSink emission points

The event variants and formats are owned by 22 §2. The session is generic over
its sink (static dispatch); the default `NoTrace` compiles to nothing; sinks
receive borrows and never change engine state, so output is byte-identical with
any sink or none (22 §2, tested in 60).

| 22 event | Emitted |
|---|---|
| `TickStart` | In `begin_tick`, before the tick's execution step (§5.3) — TS `onTickStart` (`src/backtest/runSingleMarket.ts:317`) |
| `FeedView` | After the feed view is built for a dispatched tick (§5.3) |
| `Decision` | After every tick or event callback, with its origin, including empty intent lists — TS `onDecision` |
| `AccountEvent` | At delivery, after the ledger applied the event and before the strategy callback (§6.2) — TS `onAccountEvent` |
| `OrderLifecycle`, `FillDetail` | From the execution adapter at the exchange-side times they occur (13 §4.3) |
| `Final` | At finalize, with unrounded values and the cash summary |

## 13. Determinism (core-specific)

General rules are in 10 §12 and R7. In addition:

1. Iterated collections in decision paths are ordered: open orders iterate in
   submission order (a `Vec` of active keys); cid maps are lookup-only.
2. `f64` appears only in plugin and feed analytics (14 P-2); OM, ledger and
   execution decisions use fixed point. Strategy-to-fixed-point conversions use
   explicit rounding (30 §6).
3. Randomness exists only in execution models and in receipt synthesis (§4.3),
   from per-component counter-based streams keyed by entity and derived from
   the market seed (10 §6.1; tags and entities in 13 §6.8).
4. Results never depend on the trace sink, thread, executor scheduling, group
   membership or candidate order.

## 14. Speed (core-specific)

The loop is the innermost hot path of every backtest and of the live decision
path (01 §2). Requirements:

| # | Requirement |
|---|---|
| P1 | No heap allocation per envelope in steady state: reused intent sink, reused cascade queue, `Copy` events that reference keys (10 §10.1 V3), interned cids |
| P2 | Integer identities in the hot path: `Outcome` (u8), `OrderKey` (u32 index into the order slab, 10 §11 P2), interned cids. Strings exist only at I/O and in traces |
| P3 | `ctx` and the strategy view are borrows; no snapshot copies per tick (TS rebuilt frozen snapshots per tick, `Portfolio.ts:129-137`) |
| P4 | Plugin snapshot and feed view built once per dispatched tick; zero cost when nothing is requested |
| P5 | `SharedMarket` (books, feeds, receipt timeline, skew) is immutable during session steps, so candidates of one market can step in lockstep on one thread (cache reuse) or on several threads; the choice and its measurement belong to 16 |
| P6 | **Dispatch boundary.** Default: `Session<S: Strategy, E: Execution, T: TraceSink>` is generic over all three (30 §4 rule 1, §16 S9; 16 CG-2 keeps a group's candidates in one `Vec<S>`). The hot loop is therefore monomorphized in the strategy's bin crate and compiled with that crate's profile-wide settings (31 §4.2). Measurement **M-DSP** (M1 step 7, on worker-1 under 16 §13.5 conditions; registered as M-23 in 16 §15.2) compares this with an engine compiled once, as a dependency, that calls the strategy through one `&mut dyn` call per callback: `smoke-50` throughput of `artifact` builds for a single candidate and for a 20-candidate group, plus warm rebuild time after a one-line strategy change in the `iterate` and `artifact` profiles (31 §4.1). Published, fleet and live binaries are chosen for runtime speed (D18 as amended at gate 1: the fast profile serves local checks only), so the option with the higher `artifact` throughput is the default; only if both are within 3% does the faster `iterate` rebuild decide. Declared interests (30 §4.1) and the tick interest filter (§5.3) skip callbacks the strategy ignores |
| P7 | Execution market-event processing costs O(own orders affected), not O(book) (13 §10) |
| P8 | Ledger operations are O(1) per event except iteration over open orders |
| P9 | No syscalls, locks or logging in the loop; logging is leveled and off on the fleet (30) |
| P10 | Batch API: `Session::run(&[Envelope])` over decoded batches produced on other threads (15 I-3, 16) |
| P11 | Live: the loop runs on a dedicated thread; `execution.submit` returns in microseconds and never blocks; I/O, signing and journaling run elsewhere (01 S4, 50). The journal records receipt and command-enqueue stamps, so decision latency is measured |
| P12 | Counters for envelopes, ticks, skipped strategy ticks, deliveries, intents by kind, rejects by reason, dedupe drops and scheduled actions are always on (plain integers); per-phase timers sit behind a compile-time feature, off by default (16) |

## 15. TS behaviors kept (oracle evidence)

| Behavior | TS evidence | Rule here |
|---|---|---|
| Breadth-first FIFO cascades; every account event re-enters the strategy | `StrategyRunner.ts:551, 568-595, 628-689` | §6.2 |
| Silent dedupe of an active cid; release on sync terminal, delivered terminal or full fill | `OrderManager.ts:161-184, 466, 526-534, 666, 739-747` | §7.6 (both profiles) |
| TS risk pass: whole list first, rejections first, delivered view | `OrderManager.ts:207-223`; `riskLimits.ts:47-219` | §7.2, §8.2 (ts-compat only, TC-C2; not reproduced since D71) |
| Pending obligations visible to funding within a cascade | `OrderManager.ts:121-155`; `capital.test.ts:190-212, 459-476` | §9.1 (by construction) |
| Merge clamped by pending merges | `OrderManager.ts:412-431` | §7.3 |
| Cancel reference resolution; never guess an unacknowledged exchange id | `cancellation.ts:61-127` | §7.3 |
| Cash released only on an authoritative final quantity; trade-status sizes ignored | `Portfolio.ts:210-279` | §9.4 |
| Fill before ack handled | `Portfolio.ts:849-858` | Keys exist from emission; the live adapter buffers raw frames by exchange id (10 S5, 50) |
| Per-market allowance isolation; old-market events stay with the old market | `StrategyRunner.ts:290-309, 597-608`; `capital.test.ts:531-596` | §9.4, §10 |
| Tick-scoped plugin snapshot; fill callbacks see the new book and the previous snapshot | `StrategyRunner.ts:313, 326-334, 436-437, 655` | §5.2, §6.4 |
| `portfolio.nowMs` as an event clock | `Portfolio.ts:148-153, 434-437`; `StrategyRunner.clock.test.ts` | §4.2 |
| Synthetic ticks never run the simulator; plugins skip them unless they opt in | `StrategyRunner.ts:316-334`; `PluginSet.ts:72-79` | §5.3 |
| Position clamped at zero on a SELL without inventory | `Portfolio.ts:924-976` | §9.5 (TC-C4) |
| Inclusive window gate, counted before the gate | `runSingleMarket.ts:297-316` | §5.4 (ts-compat) |
| Risk defaults, starting capital, drain budget | `riskLimits.ts:24-29`, `capital.ts:6`, `runnerConfig.ts:2` | §8, §9.4, §6.3 |

The converted TS suites that pin these behaviors are listed in 01 M1 and 60.

## 16. Changes required in other documents

None open: every item was applied in the gate-1 consolidation.

## Open questions

None. Gate 1 settled the former questions: the one-ledger reading of §9.1
stands, and the dispatch boundary is chosen for runtime speed (§14 P6, D18 as
amended).

## Gate-4 questions

1. **Live host** (01 §12.1 item 3). Realistic telonex-delta runs and paper
   emulate the `md` distribution of the live host (§4.5); until it is
   measured in M10, worker-2's distribution stands in and outputs are flagged
   uncalibrated.
