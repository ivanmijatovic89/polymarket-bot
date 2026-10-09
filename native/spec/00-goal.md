# 00 — Goal: Rust trading engine, live-first

This directory is the whole normative specification of the goal. It is short on
purpose: the owner reads all of it before work starts, and it stays under 2,500
lines in total (E07). Details that do not change decisions live in the
reference material of [03-reuse.md](03-reuse.md) and are read only when a
milestone row cites them. Normative keywords (MUST, SHOULD, MAY) follow RFC 2119.

Files: `00-goal.md` (this), `01-milestones.md` (order of work, proofs, gates),
`02-decisions.md` (decision log E01+), `03-reuse.md` (what is reused from the
previous attempt and when), `10-exchange-facts.md` (CLOB V2 facts and the
probe list; reference, extracted from sources), `11-v4-input.md` (Recorder V4
package contract; reference). Living files: `native/STATUS.md` (progress and
resume point), `native/reports/` (probe, simulator, paper and benchmark
reports), `native/calibration/` (measured model parameters, versioned).

## 1. Objective

1. One deterministic engine in idiomatic Rust that runs the same strategy code
   in backtest and live. Backtest and live differ only in the input source and
   the execution adapter.
2. **The exchange is the ground truth.** Every execution-model parameter (fees,
   taker delay, expiry, validation, fill timing, latency) is measured against
   Polymarket CLOB V2 with small real orders before it is modeled. The docs are
   hypotheses until a probe confirms them.
3. **Recorder V4 is the first input.** Its packages carry every feed with real
   receive times and trade prints, so version one needs no feed-latency
   models. Telonex (the historical dataset) is added later with feed timings
   taken from our own measurements (milestone N7).
4. **Every milestone ends with something the owner runs and sees**: an order
   placed and cancelled from Rust, a table of measured exchange facts, a
   simulator report against those probes, a paper session next to a backtest
   of the same market, a persisted native run in the dashboard.
5. The TypeScript engine is **never an oracle for execution**. It is used only
   to generate goldens for file decoding (V4 and Telonex) and as reference
   material. There is no copy-mode profile and no parity matrix.
6. Speed matters and is measured from N1, but correctness against the exchange
   comes first in the order of work.

### 1.1 Done means

Milestones N0–N9 of 01 pass their proofs on the final revision, the branch is
merged to main through PRs with CI green (gate C and later PRs), every model
parameter in `native/calibration/` carries its measurement provenance, and
the reports of N2, N3, N4, N6 and N7 exist. The first real-money strategy run
is gate D (01 §4) and needs the owner; if the owner has not run it, the goal is
paused there, not failed.

## 2. Principles (cited as P1–P12)

| # | Principle |
|---|---|
| P1 | **Exchange is truth.** A probe result beats the docs; the docs beat the old TS engine; the old TS engine beats nothing. Where a probe cannot be run yet, the parameter is flagged `unmeasured` in every output that depends on it (P8). |
| P2 | **Measure before model.** No execution-model parameter without a measurement record in `native/calibration/` (value, n, method, date, host) or an explicit `unmeasured` flag. Models are pluggable traits (fill, latency, fee, report) so a parameter can change without touching the core. |
| P3 | **V4 first, Telonex second.** `recorder-v4` is the only backtest input until N7. Telonex replay then reuses the same engine with feed visibility models whose timings come from our measurements, never from the old constants. |
| P4 | **Runnable steps.** Each milestone proof is a command the owner can run. STATUS.md records the exact command, the binary sha and the result; a proof is recorded only after it ran. |
| P5 | **Determinism.** Same binary, same job, same seed: byte-identical output on every Mac, at every thread count, in any scheduling order. Seeds derive only from (run seed, slug). The engine never reads env for behavior, never reads the wall clock inside the decision loop, and does no network I/O in backtest. |
| P6 | **Fixed-point money.** Prices, sizes and USDC are integers at 1e6 base units; `f64` only for external feed values and analytics. |
| P7 | **Idiomatic Rust.** Never emulate JavaScript or Node semantics; never transliterate TS internals. |
| P8 | **Fail loud.** Unknown params, fields, modes or flag combinations are errors. Every fallback is explicit and recorded in the output. |
| P9 | **Safety.** The agent never holds trading keys or API secrets, never builds or runs the `real-orders` variant, never launches the TS trading bot. The `standard` build contains no order-sending code. The owner builds and launches every real-order session (probes included), with a hard budget cap in the probe script. |
| P10 | **Green steps.** Every commit on the branch compiles and passes fmt, clippy, `cargo test` and the TS checks it touches. STATUS.md is updated in the same commit. Non-compiling WIP commits are forbidden. |
| P11 | **English only** in code, comments, docs, commits and PRs. |
| P12 | **Short spec.** This spec changes only through 02-decisions.md. Anything that would make it longer than 2,500 lines goes to a reference document cited by section, or is dropped. |

## 3. Scope of version one

| Item | v1 |
|---|---|
| Markets | BTC 5m and BTC 15m only (carried D06). The engine refuses other symbols and timeframes. |
| Target | `aarch64-apple-darwin` for shipped binaries; Linux only for CI checks. |
| Builds | `standard` (backtest, paper, fleet, agents; cannot send orders) and `real-orders` (probes and live; built and launched by the owner) from the same source (carried D44). |
| Inputs | `recorder-v4` packages (N1); live market WS and feeds (N2 probes, N4 paper); `telonex-delta` (N7). Rejected: legacy `recorded`, `telonex-paired`, PMXT. |
| Execution profile | One profile, **measured**: every model parameter from `native/calibration/`. No `ts-compat`. |
| Order types | GTC, GTD, FOK, FAK; post-only on GTC/GTD. |
| Intents | `place_limit`, `place_batch` (≤15), `cancel_order`, `cancel_batch`, `cancel_market`, `cancel_all`, `split_positions`, `merge_positions`. |
| Market events | `book`, `price_change`, `last_trade_price`, `tick_size_change`. |
| Feeds | What V4 records with receive times: Binance aggTrades, Chainlink rounds, price to beat. Offered to strategies as the engine's feed view. V4-only extras (bookTicker, TWAP) are decoded, not offered, in v1. |
| Plugins | Added from N5 on, from reference (03): TimeWindowVolatility, TechnicalIndicators (candles from local data, no network), DwellGate, TimeWindowGate. |
| Strategies in this goal | A test strategy that drives every intent (N1); the probe script runner (N2, not a strategy); the `overnight-opus55-lagsnipe.v15.rs` port as the first real strategy (N5, carried D20: distinct id). |

Out of scope: the ts-compat profile and any parity against the TS engine;
other symbols and timeframes; maker and taker rebates as PnL components;
retention and cleanup of old runs; Telonex trades-channel ingestion; the Market
Simulator beyond replaying native runs (N5 adds a guard, a sink comes later).

## 4. What the owner provides

- A dedicated wallet with a small pUSD balance on Polymarket CLOB V2 and its
  API credentials, used only by the owner on the `real-orders` build.
- Probe sessions: about one to two hours each, the first within days of N2
  (E04), budget cap $20 for P0, later sessions as 01 lists them.
- Decisions at the gates of 01 §4, and answers to questions parked under
  "Waiting on user" in STATUS.md.

## 5. Host rules (worker-1)

- All work runs on worker-1 in this worktree
  (`/Users/worker-1/Sites/polymarket-bot-rust-live-first`, branch
  `rust-live-first`). Never edit, build or run anything in the fleet copy
  `/Users/worker-1/Sites/polymarket-bot` or in the previous attempt's clone
  `/Users/worker-1/Sites/polymarket-bot-native` (reference only, read through
  `git show native-engine:<path>` or by reading its files).
- `data/{events,binance,telonex,recorder-v4-cache}` are read-only symlinks into
  the fleet copy; nothing is written through them. Everything else under
  `data/` is local. `node_modules` is a symlink to the fleet copy.
- `.env` holds only `DATABASE_*` and `DRY_RUN=true`. No trading keys, ever.
- Database: read-only until the N5 migrations; then only additive migrations,
  applied by the agent after the PR merges (carried D50).
- The fleet worker and Global Runtime on worker-1 keep running. No pause, stop
  or restart of them in this goal unless the owner confirms the pause
  procedure; benchmarks run alongside them and are labeled `non-idle`.
- The rules capture LaunchAgent on worker-1 keeps running; its files are
  imported in N5.
- GitHub: push the branch after every milestone step; open the draft PR
  "DO NOT MERGE before gate C: Rust engine, live-first" at N0; never merge
  anything to main before gate C.

## 6. Change control and precedence

1. The owner's instructions and decisions marked "user" in 02 bind.
2. Other entries of 02 bind unless the owner changes them. The lead MAY add an
   entry for any non-user topic the spec is silent on, choosing the simplest
   option consistent with P1–P12, and continue. Topics that change scope, a
   gate, safety, money handling or the owner's time go to "Waiting on user".
3. 00, 01 and 03 own their topics; 10 and 11 are reference extracted from
   sources and may be corrected when a probe or a golden contradicts them (the
   correction is a 02 entry with the evidence).
4. The previous attempt's spec (03 §3) is reference only. It never overrides
   this spec.
