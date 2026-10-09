# 01 — Milestones, proofs and gates

Order of work: **N0 bootstrap → N1 V4 replay end to end → N2 exchange adapter
and probe session P0 → N3 simulator from measurements → N4 paper mode → N5
native backtest path and persistence (merge to main) → N6 speed → N7 Telonex
input with measured feed timings → N8 fleet and protocols in Rust → N9 live
runtime and real-order gate.** Numbers are stable; the "Depends on" column is
binding. While waiting at a gate, work that does not depend on the gate's
outcome MAY continue on the branch.

Every milestone: a step plan in STATUS.md at the start, green commits (P10),
the proof commands recorded with their result, a STATUS.md entry at the end.
Proofs run from the worktree root; `SCRATCH` is a directory outside the
repository. Binary subcommand names below are the lead's to define in N1; once
defined they are recorded in 02 and used unchanged.

| # | Milestone | Depends on | Owner sees | Gate after |
|---|---|---|---|---|
| N0 | Bootstrap | — | Branch, worktree, green leaf crates, V4 inventory, draft PR | — |
| N1 | V4 replay end to end | N0 | One V4 market replayed twice with identical output; TS decode goldens pass | — |
| N2 | Exchange adapter + probe P0 | N1 (reader, result types) | An order placed and cancelled from Rust; the P0 facts table and latency numbers | **A** |
| N3 | Simulator from measurements | N2 | Report: simulator vs P0 outcomes per probe | **B** |
| N4 | Paper mode | N3 | Paper session next to a backtest of the same market; journal replay identity | — |
| N5 | Native backtest path, persistence, first real strategy | N3 | `backtest --strategy-artifact <sha> --input-mode recorder-v4` rows in the dashboard | **C** (merge) |
| N6 | Speed | N5 | Benchmark report, determinism across thread counts | — |
| N7 | Telonex input | N5, measurements from N2/N4 | Telonex replay of history; Telonex-vs-V4 report | — |
| N8 | Fleet, protocols in Rust | N5, N6 | Fleet run on native artifacts; a protocol authors a Rust strategy end to end | — |
| N9 | Live runtime, real-order gate | N4, N5 | 24 h paper with replay identity; safety checklist; first real strategy run launched by the owner | **D** |

## 1. N0 — Bootstrap

Done by the owner's review session on 2026-10-09 unless marked open:

- [x] Branch `rust-live-first` from `origin/main`, worktree
  `/Users/worker-1/Sites/polymarket-bot-rust-live-first`, data and
  `node_modules` symlinks, `.env` (00 §5).
- [x] Leaf crates carried from the previous attempt (03 §1): `domain`,
  `orderbook`, `job-contract`, `telonex-replay`; `cargo test --workspace` green.
- [x] Native CI job, `npm run native:ci:local`, Prettier exclusions,
  `native/deny.toml`.
- [x] This spec, `native/goal/PROMPT.md`, `native/STATUS.md`.
- [ ] Draft PR "DO NOT MERGE before gate C: Rust engine, live-first".
- [ ] V4 inventory (read-only DB query over `recorder_v4_recordings`: complete
  packages per timeframe, first and last `start_ms`, feed completeness) and
  local cache check (`data/recorder-v4-cache`); recorded in STATUS.md. On
  2026-10-09 the catalog held 211 complete BTC 15m and 589 complete BTC 5m
  packages since 2026-10-06, every feed complete.
- [ ] Fleet worker and Global Runtime untouched; confirm with `ps`.
- [ ] Strip copy-mode remnants from the carried crates before N1 builds on
  them: the `TsCompat` profile, `Flat700Bps4Dp`, `Compat` latency and the old
  feed constants in `job-contract` (`vocab.rs`, `model_config.rs`,
  `contract/defaults/model-config-v1.json`), the ts-compat rule set in
  `domain::rules`; keep the dated tables with their verification status.

Proof: `(cd native && cargo fmt --all --check && cargo clippy --workspace
--all-targets --locked -- -D warnings && cargo test --workspace --locked)`,
`npm run code:eslint`, `npm run code:prettier:check`, `npm run code:typecheck`;
the draft PR URL and the inventory in STATUS.md.

## 2. N1 — V4 replay end to end

Deliverables:

1. **V4 reader** (`v4-replay`, new crate; contract in 11): manifest and
   sha256 verification, receipt order, receive times as the engine clock
   (carried D27), rules from the package `rawJson`, coverage gate
   (`incomplete_capture` with reasons; `--allow-capture-gaps` as explicit
   outage replay), duplicate observations across overlapping windows handled
   as the contract says. Hard error on any field the reader does not know
   (P8).
2. **Engine core** (`engine`, new crate): serial event loop; tick → strategy →
   intents → validation against `ExchangeRules` (in tree, `domain::rules`;
   facts in 10, hypotheses until P0) → order manager and order state machine
   (`domain::order`, `state`) → execution adapter trait → ledger (cash,
   positions, reservations) → account events delivered breadth-first within
   the tick → per-market stats (`job-contract::result`). The previous
   attempt's `pmb-engine` is reference (03 §2): modules MAY be copied after
   review, with every `TsCompat` branch removed. Cascade order and capital
   reservation rules are design decisions recorded in 02 (E09, E10), not TS
   facts.
3. **Placeholder execution adapter**: accepts, rests, cancels and expires
   orders; fills a taker at the touch for the visible size and never fills a
   maker. Every output carries `models: { fill: "placeholder", unmeasured:
   true }`. It exists only so N1 can run end to end; N3 replaces it.
4. **Binary** (`runtime`, new crate, or copied after review): `describe`,
   `schema`, `run --input <package> --params <json> [--trace <file>]`,
   `selftest`. Output = the deterministic result section plus `diagnostics`
   (wall time, RSS), as `job-contract` defines.
5. **Test strategy** `intent-exerciser` (SDK surface minimal: params, `on_tick`,
   `on_account_event`, feed view): drives every intent and order type on a
   schedule, so the state machine is exercised without a real strategy.
6. **Goldens from TS**: three complete BTC 5m packages, the smallest ones in
   the catalog, copied whole with their manifests under `native/fixtures/v4/`
   so sha verification works. A script runs the real TS V4 reader offline
   (the `record:v4:verify` replay path, never `npm run backtest`) and writes
   per-source event counts, first and last receive times, the rules fields
   and the first book snapshot as canonical JSON (per outcome, price and size
   ladders at 1e-6, sorted) hashed with sha256; the Rust reader MUST produce
   the same bytes.
7. **Property tests** (from the previous attempt's 60 §8, reference): cash
   conservation, reservations never negative and released on every terminal
   state, fills never exceed order size, same job twice byte-identical.

Proof:

```bash
BIN=native/target/release/runtime        # cargo build --release (canonical build comes in N5)
P=data/recorder-v4-cache/<a complete btc/15m package dir>
T=$(mktemp -d)
$BIN run --input "$P" --strategy intent-exerciser --params '{}' --trace "$T/a.jsonl" > "$T/a.json"
$BIN run --input "$P" --strategy intent-exerciser --params '{}' --trace "$T/b.jsonl" > "$T/b.json"
cmp <(jq -cS 'del(.diagnostics)' "$T/a.json") <(jq -cS 'del(.diagnostics)' "$T/b.json") && cmp "$T/a.jsonl" "$T/b.jsonl"
npm run -s native:v4:goldens:check          # TS goldens vs Rust reader on native/fixtures/v4
```

Owner sees: the result JSON of one real market, the trace, and the golden
check output.

## 3. N2 — Exchange adapter and probe session P0

Deliverables:

0. **On-chain prerequisites** (small TS change, outside the engine): the
   approval and deposit scripts updated for CLOB V2 collateral (pUSD) so the
   owner can fund and approve the probe wallet; the owner runs them. Listed in
   10 §5.
1. **`exchange-clob` crate**, `real-orders` feature only for the sending path:
   L2 auth, EIP-712 v2 order signing checked byte for byte against vectors
   generated from the official V2 client (a TS script in its own small npm
   package under `scripts/native/clob-v2-vectors/` with a gitignored
   `node_modules`, because the repository's `node_modules` is a read-only
   symlink and the V2 client is not installed there; the client library is the
   oracle for signing, not for behavior), REST place / cancel / batch / open
   orders / trades, user WS
   with the documented status mapping (incl. FAILED and RETRYING), heartbeat
   off by default (carried D30: real-orders only, lockfile per key), client
   side rate limits, ambiguous-outcome handling (timeout or 5xx → reconcile
   from REST, never blind retry). The `standard` build compiles none of the
   sending code (a test proves `probe --send` is absent there).
2. **Journal**: every request and response with send and ack times, every WS
   frame with receive time, clock-offset samples, binary sha, params, the
   probe script. Format: the V4 envelope extended with account and REST
   sources (carried D26); the N1 reader learns to read it in N4.
3. **`probe` subcommand**: takes a market slug and a JSON script of timed
   actions (the P0 list in 10 §2, plus at least two resting post-only maker
   orders at the best price left for 60 s so the maker fill ratio has data), a
   budget cap and a kill switch (Ctrl-C cancels all), runs them, journals
   everything. **Budget cap, one definition:** the runner stops and cancels
   all when cumulative loss plus fees reaches the cap ($20 for P0) or when
   open exposure would exceed $15. Secrets come through a file descriptor or
   a prompt, never env or argv.
4. **Mock exchange tests** from the documented payloads: place, cancel, batch,
   FAILED reversal, reconnect resync, 429, ambiguous POST.
5. **P0 session** (owner): on the owner's own Mac, BTC 15m, budget cap $20
   (E04), minimum sizes, while worker-2 records the same markets. No probe
   strategy, no paper rehearsal and no alerting are required for P0: the
   runner is scripted and the owner watches it. The agent prepares the script
   and the runbook; the owner builds `real-orders` there from the pushed
   branch, runs, and copies the journal to worker-1 (the journal holds no
   secrets).
6. **Analysis**: journal joined with the V4 recording of the same market. The
   clock offset between the probe host and worker-2 is measured from
   Polymarket WS frames both hosts received (same frame, two receive times)
   and recorded with the join → `native/reports/probe-P0-<date>.md`: one
   row per fact (measured value, n, method, docs said, verdict) and the
   latency distributions (place, cancel, ack, fill report, MATCHED→MINED), and
   `native/calibration/<date>-P0.json` with provenance.

Proof: adapter and mock tests green in both builds; the P0 report and
calibration file committed; STATUS.md lists every fact the probe could not
answer, each with the probe that will.

**Gate A** (owner): reads the P0 report, approves the next probe budget, and
confirms or changes the facts that 10 marked as hypotheses.

## 4. N3 — Simulator from measurements

Deliverables, one model at a time, each with a measurement record:

1. Validation at decision and at exchange arrival from `ExchangeRules`: tick,
   min size, price bounds, GTD lead, post-only crossing, batch caps (P0 rows).
2. Fee from the market's `feeSchedule`, verified against the fees P0 was
   charged (carried D22: charged amounts win).
3. Taker delay (hold on marketable orders) as measured. The dated table for
   history (10) matters only for Telonex replay and is wired in N7, flagged
   `hypothesis` for dates before our measurements.
4. GTD early expiry and lead time as measured.
5. Latency model: separate seeded distributions for place, cancel, ack and
   fill report, fitted to P0; exact-time scheduler.
6. Fill model: taker walks the book with depletion by our own orders; maker
   queue position from V4 trade prints at our price level; partial fills;
   FOK/FAK semantics incl. BUY sized in collateral (carried D42, hypothesis
   until P0 confirms).
7. Report model: MATCHED → MINED timing from P0; FAILED reversal rate if
   observed.
8. Async split and merge with latency (carried D25: on-chain via the TS
   sidecar in live; modeled as async operations here).
9. Window gate (carried D23, hypothesis until probe R15 confirms): strategy
   called only inside the window, orders keep matching until the window end,
   then everything expires.

Proof: the recorded books are first decontaminated of our own P0 orders
(matched by price, size and time from the journal; carried D24), then a
**probe strategy** re-issues the P0 actions at the journaled times inside a
backtest of the same V4 packages; the comparison
`native/reports/sim-vs-P0-<date>.md` shows per probe: accept/reject
agreement, fill price and size, fee, timing. Pass marks (adapted from the
previous attempt's D35, reference): accept/reject ≥ 99%, fee exact at 1e-6,
taker VWAP identical on ≥ 90%, timing medians within ±30%, maker filled-share
ratio within [0.8, 1.25] where n allows. Property tests of N1 still pass; no
oversell; liquidity conserved.

**Gate B** (owner): accepts the simulator or asks for a second probe session
P1 on the failing rows.

## 5. N4 — Paper mode

Deliverables: live inputs (market WS incl. `custom_feature_enabled` and text
PING, Binance, Chainlink, price-to-beat poller, rules fetch at market start)
through the N1 loop with the N3 simulator; no orders sent; the journal of N2
for every input; rotation to the next BTC 5m / 15m market; per-market result
written as a local file (DB rows come in N5). Agent-run sessions load no
secrets; if the Chainlink feed needs credentials, the owner runs those
sessions or they run with `chainlink: false` (recorded in STATUS.md).

Proof: paper sessions totaling ≥ 6 hours over both timeframes; every market's
journal replayed through `run` gives a byte-identical deterministic result
section; `native/reports/paper-vs-backtest-<date>.md` compares each paper
market with the backtest of worker-2's V4 package for the same slug and
attributes every difference (input clocks, feed gaps, nothing else).

## 6. N5 — Native backtest path, persistence, first real strategy

Deliverables:

1. Canonical reproducible build and publish (reference 03: builder), binary
   identity = sha256, `describe` capabilities, `strategy_artifacts` row,
   `data/strategy-artifacts/native/<sha>`.
2. TS side: `src/native/` builds `EngineJob` from `MarketJobData` for
   `--input-mode recorder-v4`, validates `EngineResult`, maps to
   `RunSingleMarketOutput` (contract: `job-contract`, in tree). `--sequential`
   first; the fleet worker path in N8.
3. Additive migrations: `engine`, `engine_version`, `model_config` (incl.
   the calibration id), seed, rules provenance; dashboard engine badge and
   cross-engine comparison guard; Market Simulator guard for native runs
   (carried D09, D10, D50).
4. Rules capture import (the LaunchAgent's JSONL files) into a rules snapshot
   table; `rulesSource = snapshot | partial | fallback` in every result.
5. Plugins from reference as strategies need them, candles from local data,
   no network.
6. **First real strategy**: `overnight-opus55-lagsnipe.v15.rs` ported from the
   built TS artifact `304eceb346bdd813d3acda0f5fac38b657237bed8195352b5346c330f6d78ab8`
   (bundle in `data/fleet-strategy-artifacts/`, read-only; carried D40), run
   on every complete V4 15m package available; its TS twin run by the TS
   engine `--sequential` on the same packages. The difference report is
   information for the owner: it attributes divergences to models (fees,
   fills, latency) where it can; an unexplained divergence is listed, it does
   not block gate C (E02).

Proof:

```bash
npm run strategy:publish -- --repo native/strategies --bin overnight-opus55-lagsnipe.v15
npm run backtest -- --strategy-artifact <sha256> --sequential --input-mode recorder-v4 --symbol btc --timeframe 15m --limit 50
#   → one backtest_runs row with engine='native', model_config incl. calibration id; rows visible in the dashboard
```

plus refusal tests that exit 2 before anything is enqueued: `--symbol eth`,
a 1h timeframe, `--input-mode telonex-delta` before N7, an unknown param.
The proof runs against the dev schema of 00 §5, never production.

**Gate C** (owner): merge to main (one PR; CI green; no behavior change for
TS strategies, proven by running one TS strategy before and after).

## 7. N6 — Speed

Deliverables: long-lived executor (`serve`) with a work-stealing pool across
markets; shared immutable caches of decoded packages; benchmark harness with
frozen sets on V4 (`smoke-50`, `heavy-1`, and `recent-N` with as many complete
15m packages as exist on the day the set is frozen); per-phase timers
(decode, book, strategy, simulator, stats); thread count and QoS measured per
machine type; build-profile measurement. Optimizations are A/B measured and
MUST keep outputs byte-identical across thread counts, `run` vs `serve`, and
build profiles.

Proof: `native/reports/bench-N6-<date>-worker-1.md` with wall time, markets/s,
CPU, peak RSS and phase profile per set, TS engine on the same packages as the
baseline row; determinism checks pass. Non-idle label until the owner confirms
a pause procedure.

## 8. N7 — Telonex input with measured feed timings

Deliverables: `telonex-delta` reader (in tree, `telonex-replay`, golden-tested
against TS decode); feed visibility models for Binance, Chainlink (two-clock)
and price-to-beat whose bot-leg timings come from N2/N4 measurements
(`native/calibration/`), never from the previous attempt's constants unless
re-measured; synthetic feed ticks as an opt-in; Telonex eligibility through
`src/db/telonexMarkets.ts` only; the derived fast tape from reference MAY be
added if the N7 phase timers on Telonex replay show decode above 40% of job
time.

Proof: TS decode goldens pass; `backtest --input-mode telonex-delta` persists
rows labeled with the input mode; `native/reports/telonex-vs-v4-<date>.md`
runs the lagsnipe port on every market both datasets cover and attributes the
differences (missing trade prints, modeled vs recorded feed times).

## 9. N8 — Fleet and protocols in Rust

Deliverables (reference 03: fleet, groups, artifacts): native queue with
version and target gate, worker shim supervising the executor, execution
stamping, artifact cache, kill switch and engine-version blocklist, candidate
groups (`--candidates`, one row per candidate, group result equals standalone),
the out-of-sandbox build daemon and `strategy:new -- --lang rust` so protocol
sessions author Rust strategies, docs pages and CLAUDE.md updates.

Proof: a V4 run of the lagsnipe port over every complete 15m package on the
fleet hosts (deployment with the normal fleet commands, owner's go-ahead
recorded in STATUS.md) with
byte-identical outputs on every host; a sandboxed session creates, checks,
publishes and backtests a Rust strategy end to end; kill-switch drill
recorded.

## 10. N9 — Live runtime and the real-order gate

Deliverables (reference 03: live runtime): market discovery and pre-subscribed
rotation, session guards that survive rotation (session loss, exposure,
order-rate cap, kill switch; carried D31, D32), restart behavior (carried
D29: cancel, adopt positions read-only), reconciliation, alerts (carried D33;
channel is an owner question), launchd service, the TS sidecar for split,
merge and redeem and pUSD handling, the `real-orders` trust chain (clean
commit, reproducible rebuild to the same sha, source hash linking it to the
backtested `standard` binary).

Proof: ≥ 24 hours of paper on both timeframes with replay identity; safety
checklist; a test proving a `standard` binary cannot send; shadow mode during
a paper session (orders built and signed with a throwaway key, never sent).

**Gate D** (owner): answers the live questions (wallet, host, alert channel,
auto-restart policy, budget), approves, builds `real-orders`, launches the
first real strategy session. The agent never does.

## 11. Gates

| Gate | After | Owner sees | Owner decides |
|---|---|---|---|
| A | N2 | P0 report, calibration file, open facts | Next probe budget; confirm or change hypotheses |
| B | N3 | Simulator vs P0 report, pass marks | Accept the simulator or order probe P1 |
| C | N5 | Native rows in the dashboard, lagsnipe difference report, merge content | Merge to main |
| D | N9 | Paper identity, safety checklist, shadow-mode log | First real strategy run |

## 12. Resuming

A new session reads 00, 01, 02, 03 in full (under 1,000 lines), then 10 and
11 when its milestone cites them, then STATUS.md "Current state" and the
current milestone's step plan. It verifies the tree is green (N0 proof) before
changing anything, and continues with "Next action". A proof is never redone
unless a change invalidated it.
