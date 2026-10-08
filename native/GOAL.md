# GOAL — Rust trading engine

Agreed with the user on 2026-10-08. This file is the contract for the migration.
Progress lives in [STATUS.md](STATUS.md); parity findings in `PARITY.md`.

## Objective

Port the **whole trading engine** to idiomatic Rust: one core shared by live
trading and backtesting, with every engine feature. The TypeScript engine stays
in place, untouched, for strategies that are not ported. TypeScript keeps
orchestration (CLI, Redis/BullMQ fleet, batch aggregation, MySQL, dashboard).

## Boundary

| Rust (`native/`)                                                         | TypeScript (unchanged role)                |
| ------------------------------------------------------------------------ | ------------------------------------------ |
| Market decoding, order books, ticks, synthetic feed ticks                | CLI / producer, market selection           |
| Feeds: Binance aggTrades, Chainlink, price-to-beat (+ visibility clocks) | Redis queues, workers, fleet, heartbeats   |
| Strategy SDK + strategies                                                | Parquet download / R2 cache                |
| OrderManager, risk, Portfolio, capital                                   | Batch aggregation, MySQL, extensions       |
| Plugins with backtest support                                            | Dashboard, WebUI, recorder, research tools |
| Backtest execution simulator, per-market stats                           |                                            |
| Shared candidate replay (N param sets, one market read)                  |                                            |
| Live runtime: WS inputs, rotation, dry-run execution, journal            |                                            |

Seam for backtests: worker sends `MarketJobData` JSON → Rust executor →
`RunSingleMarketOutput` JSON. No per-tick TS↔Rust calls.

## Hard rules (anti-drift)

1. **Idiomatic Rust. Never emulate JavaScript/Node semantics** (no Number/JSON/
   RegExp/Promise emulation, no bit-exact float-formatting chasing).
2. Money and sizes are fixed-point integers (1e6 base units). Feed prices and
   analytics may be `f64`.
3. TS is a reference for **business behavior**, not a spec for its bugs. Every
   parity mismatch is classified in `PARITY.md`: _TS bug_ (keep Rust, document),
   _Rust bug_ (fix), or _intended model change_ (behind the `realistic` profile).
4. Parity tolerance (ts-compat profile): identical order/fill/cancel sequence,
   sides and prices; sizes / USDC / PnL within 1e-6 per market.
5. Two execution profiles: `ts-compat` (reproduces today's TS behavior, quirks as
   explicit config flags — only to prove the port) and `realistic` (fixes below).
   Every realistic fix gets an A/B report. `realistic` becomes default only when
   the user says so.
6. No scope change without the user. A milestone that overruns its time box stops
   and writes down why in STATUS.md.
7. Every milestone ends with a demo command + commit. CI must stay green.
8. **No real orders.** No live signing activation. Never launch the TS
   trading-bot (this machine has `DRY_RUN=false` in `.env`).

## Architecture requirements (from day 1)

- Intents: `place_limit`, `place_batch` (≤15), `cancel_order`, `cancel_batch`,
  `cancel_market`, `cancel_all`, `split_positions`, `merge_positions`.
- Order types: GTC, GTD, FOK, **FAK**; post-only on GTC/GTD.
- Per-market `ExchangeRules`: tick size, min order size, price bounds,
  `feeSchedule` by date, taker delay by date, GTD rules, batch cap.
- Market events include `last_trade_price` and `tick_size_change` (kept even if
  a strategy ignores them).
- Simulated book that can include our own orders, consume liquidity, and track
  queue-ahead. Pluggable `FillModel`, `LatencyModel` (seeded RNG per market),
  discrete-event scheduler.
- `Execution` trait: backtest simulator, live dry-run, (later) live CLOB V2.
  The core never knows which one it runs on.
- `TraceSink` trait (no-op by default) for the future market simulator UI.

## Realistic profile fixes (each with A/B)

Fee from market/date `feeSchedule` (none before 2026-01-05; 5 dp rounding),
taker delay on marketable crypto orders (not cancellable), tick / min-size /
price-bound validation, GTD ≥3 min and expires 60 s early, FOK/FAK BUY sized in
collateral, liquidity depletion, no free fill of a crossing GTC remainder,
separate seeded place/cancel latency executed at exact event time.

## Milestones (priority order)

| #   | Milestone                                                                                                                                                                                                            | Proof                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 0   | Worktree, Cargo workspace, CI, GOAL/STATUS                                                                                                                                                                           | CI green                     |
| 1   | Core: all intents/order types, OrderManager, Portfolio, Runner (cascading account events, synthetic ticks), feeds, backtestable plugins, stats, Execution trait, simulator, latency, trace sink, telonex-delta input | unit tests                   |
| 2   | Parity: exerciser strategy (TS + Rust, every intent/edge case) + `lagsnipe.v15` in Rust on ~200 markets, ts-compat                                                                                                   | `PARITY.md`                  |
| 3   | Realistic profile                                                                                                                                                                                                    | A/B report per fix           |
| 4   | Shared candidate replay                                                                                                                                                                                              | identical to standalone runs |
| 5   | Static-binary strategy artifacts (publish → R2), worker dispatch, fleet (switch fleet to branch for the test, then back), dashboard                                                                                  | run on 4 machines            |
| 6   | Benchmark TS vs Rust, same 1,000 markets                                                                                                                                                                             | report                       |
| 7   | Live dry-run: WS feeds + rotation → same core → dry-run execution + journal; replay journal through backtest path                                                                                                    | identical decisions          |
| 8   | _Stretch:_ live CLOB V2 adapter (signing, REST, user WS fixes, heartbeat) — built + tested, NOT activated                                                                                                            | unit tests                   |
| 9   | _Stretch:_ Recorder V4 input + queue-position fill model                                                                                                                                                             | test on V4 data              |

## Out of scope

Deleting the TS engine; porting other existing strategies; telonex-paired and
legacy recorded input modes; Deribit; simulator UI; Telonex trades-channel
ingestion; real-money activation.

## Follow-up tasks (after this goal is done)

1. **Telonex trades** (user request, 2026-10-08): ingest the Telonex `trades`
   channel, merge trade prints into the telonex-delta replay as
   `last_trade_price` events, then build and A/B the queue-position fill model
   on telonex data (today only Recorder V4 has trade prints).
2. Recorder V4 input mode in Rust, if not finished as stretch M9.
3. Live CLOB V2 execution activation with real money — separate session with the user.

## Done means

Milestones 0–7 pass their proofs on the final revision, PARITY.md has no
unclassified mismatch, fleet run succeeded, benchmark report exists, PR open
against `main` with CI green. Stretch milestones are reported as done or not.
