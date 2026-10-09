# 01 — Milestones: what is defined, what is not

Only the next steps are defined in detail. Everything after them is a roadmap
and is written properly when the step before it has passed, from what that
step measured. This is deliberate: the plan assumes it is wrong in places we
cannot see yet, and a wrong assumption may cost one step, never the project.

| Step | What it is | Defined | Owner sees at the end | Gate |
|---|---|---|---|---|
| N0 | Bootstrap | done | green tree, draft PR | — |
| N1 | Replay one Recorder V4 market through the engine | **in full (§2)** | one market's result and trace, identical on two runs | — |
| N2 | Place and cancel real orders from Rust; probe session P0 | **in full (§3)** | an order on Polymarket and in the journal; a table of measured facts | **A** |
| N3 | Simulator from the measurements | after P0 (§4) | report: simulator vs probes | **B** |
| N4–N9 | paper mode, persistence and merge, speed, Telonex, fleet, live | roadmap only (§5) | — | C, D |

Every defined step: a step plan in STATUS.md at the start, green commits (P10),
the proof command recorded with its result, a STATUS.md entry at the end.
Proofs run from the clone root. Binary subcommand names are the lead's to
define in N1 and are recorded in 02 (E08) once defined.

## 1. N0 — Bootstrap (done)

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

## 4. N3 — Simulator from the measurements (defined after P0)

Not defined in detail on purpose. After gate A the lead writes this section
from the P0 report: which models the probes settled (fees, taker delay,
expiry, validation, fill timing, latency distributions), which are still
hypotheses, and in which order they are built. Each model gets a record in
`native/calibration/` (P2) and is checked by replaying the P0 actions inside
a backtest of the same recorded markets, with our own orders removed from the
books first (carried D24). Pass marks are proposed in that section and
confirmed by the owner at gate B. Candidate models and the old pass marks are
listed in `03-reuse.md` §3 (13 and 51 of the previous attempt) for reading,
not for copying.

## 5. Roadmap, not defined yet (N4–N9)

Each line becomes a defined section only when the step before it has passed.
Until then nothing here is a commitment, and the lead does not start it.

- **N4 paper mode:** live market data through the same engine with the N3
  simulator, no orders; the journal replays to the identical decisions; a
  paper market compared with the backtest of worker-2's recording of it.
- **N5 native backtest path and persistence:** `backtest --strategy-artifact
  <sha> --input-mode recorder-v4` writes rows with engine provenance; dev
  schema first, production after the merge; the lagsnipe v15 port as the
  first real strategy (artifact `304eceb3…`, carried D40); **gate C** merges to
  main.
- **N6 speed:** long-lived executor, shared caches, benchmark sets on V4,
  byte-identical output across thread counts.
- **N7 Telonex input:** the history dataset through the same engine, feed
  timings from our own measurements, a Telonex-vs-V4 report.
- **N8 fleet and protocols in Rust:** native queue, worker shim, candidate
  groups, the build daemon so protocol sessions author Rust strategies.
- **N9 live runtime:** discovery and rotation, session guards, alerts,
  launchd, the `real-orders` trust chain; **gate D**, the first real strategy
  run, launched by the owner.

## 6. Gates

| Gate | After | Owner sees | Owner decides |
|---|---|---|---|
| A | N2 | P0 report, calibration file, open facts | Next probe budget; confirm or change the hypotheses; approve the N3 section the lead then writes |
| B | N3 | Simulator vs P0 report, pass marks | Accept the simulator or order probe P1; approve the N4 and N5 sections |
| C | N5 | Native rows in the dashboard, lagsnipe difference report, merge content | Merge to main |
| D | N9 | Paper identity, safety checklist, shadow-mode log | First real strategy run |

## 7. Resuming

A new session reads 00, 01, 02, 03 in full (under 1,000 lines), then 10 and
11 when its step cites them, then STATUS.md "Current state" and the current
step plan. It verifies the tree is green (N0 proof) before changing anything,
and continues with "Next action". A proof is never redone unless a change
invalidated it. A step that is "roadmap only" is never started; the lead
writes its section first and the owner approves it at the preceding gate.
