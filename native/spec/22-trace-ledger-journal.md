# 22 — Trace, ledger and journal formats

This document defines the four record streams the engine produces besides its
per-market result: the canonical parity trace (proves `ts-compat` parity
against the TS oracle), the opt-in order and fill ledger (calibration and
analysis), the dashboard simulator trace (a sink built in M3c; native runs
are refused until then), and the live journal (the replay input and
calibration source for paper and live). It replaces `native/TRACE.md`.
Payload contracts for jobs and results are in
[21-job-and-output-contract.md](21-job-and-output-contract.md). The process
flags that turn these streams on are in [20-binary-protocol.md](20-binary-protocol.md).

## 1. Overview

| Stream | Format id | Purpose | Written when | Storage | Compared |
|---|---|---|---|---|---|
| Parity trace | `pmb-parity-trace/2` | Prove the port: identical order, fill and cancel sequence vs TS | parity runs only | local gz JSONL | yes, by the diff rules in §3.4 |
| Ledger | `pmb-ledger/1` | Per-order and per-fill records with exact times for calibration and A/B analysis (D11) | opt-in per submission; always for paper and live | R2 gz JSONL | no (analysis input) |
| Simulator trace | dashboard `TraceManifest`/`TraceChunk` v1 | Dashboard Market Simulator playback | M3c (D10); until then native runs are refused | dashboard job dir | saved vs replay comparison |
| Live journal | `pmb-live-journal/1` | Replay input (M8 identity proof) and calibration join source (D26) | always in `paper` and `live` | local, then private R2 | replay must reproduce decisions |

## 2. One engine event stream, several sinks

- The engine emits typed events to a `TraceSink` chosen when the job starts.
  The sink is a generic parameter (static dispatch). The default `NoTrace`
  compiles to nothing: no allocation, no formatting, no branch per event.
  **Speed rule:** with no outputs requested, the hot path MUST be the same
  machine code as an untraced build. [60-verification.md](60-verification.md)
  benchmarks traced vs untraced.
- Observation never changes engine state. A traced run MUST produce the same
  `resultDigest` as an untraced one (the same contract as the TS observer,
  `src/backtest/parity/trace.ts:14-21`).
- Event variants (the Rust enum lives in `pmb-core`; the WIP trait at
  `native/crates/pmb-core/src/trace.rs:1-15` is the starting point):

| Event | Fields | Used by |
|---|---|---|
| `TickStart` | `seq`, `cause`, `decisionTsMs`, `exchangeTsMs`, `visibilityTsMs` | trace, ledger, simulator |
| `FeedView` | `seq`, visible Binance, Chainlink and price-to-beat values | trace (level `feeds`), simulator |
| `Decision` | `seq`, `origin` (`tick` \| `account`), intents | trace, ledger, simulator, journal (`engine` records) |
| `AccountEvent` | `seq`, the event as delivered to the strategy | trace, ledger, simulator |
| `OrderLifecycle` | engine order id, internal transition (`scheduled`, `exchange_visible`, `delayed`, `resting`, `cancel_effective`, `expired`, …) with times | ledger |
| `FillDetail` | fill plus queue-ahead and sampled latency components | ledger |
| `Final` | stats, unrounded values, cash summary | trace, ledger |

- Sinks: `ParityTraceSink` (§3), `LedgerSink` (§4), `SimulatorSink` (§5,
  M3c), and `Tee` to combine them. The live journal writer (§6) is not a
  `TraceSink`: it sits at the ingress of the serial event loop and also
  receives `Decision` events.
- In a candidate group, each candidate has its own sink instance and its own files.

## 3. Canonical parity trace — `pmb-parity-trace/2`

### 3.1 File

- gzip JSONL. One file per (market, candidate). The first line is `header`,
  the last line is `final`. Written atomically (temp file, then rename;
  `trace.ts:231-237`).
- Two writers produce it: the TS writer (`src/backtest/parity/trace.ts`,
  upgraded from v1 to v2 on this branch) and the Rust `ParityTraceSink`.

### 3.2 Records

| `t` | Fields | Notes |
|---|---|---|
| `header` | `format:"pmb-parity-trace"`, `version:2`, `engine:"ts"\|"native"`, `engineVersion`, `profile`, `slug`, `candidateKey`, `level:"decisions"\|"feeds"` | new in v2 |
| `tick` | `seq`, `ts`, `cause`; optional `xts` (exchange ts), `vts` (visibility ts) | optional fields are compared only when both sides have them |
| `intent` | `seq`, `src:"tick"\|"account"`, `kind`, plus per kind: `place_limit` → `cid, asset, side, price, size, orderType, postOnly, expireAtMs`, where an order the strategy sized in collateral (`buy_spend`, 30; 10 O2) carries `amountUsdc` instead of `size`; `place_batch` → `orders[]` (same fields); `cancel_order` → `cid`; `cancel_batch` → `cids[]`; `cancel_market` → `asset` (+`market`); `cancel_all` → nothing; `split_positions`/`merge_positions` → `size` | as `trace.ts:96-119`. Order meta is not traced here; it is compared via `final.stats.intentMeta`. |
| `event` | `seq`, `kind`, `ts`, plus per kind: `order_submitted` → order fields; `order_accepted` / `order_open` → `cid`; `order_rejected` → `cid, reason`; `order_done` → `cid, reason, filledSize`; `fill` → `cid, asset, side, price, size, fee, liquidity`; `cancel_failed` → `op, cid, asset, reason`; `positions_split` → `size, cost`; `positions_merged` → `size`; `split_failed`/`merge_failed` → `size, reason`; `settlement_update` → `cid, status, sizeMatched`. Realistic and live only: `order_delayed` → `cid, releaseAtMs`; `cancel_acked` → `op, cid` | Both engines write every kind delivered to the strategy; v2 adds `settlement_update` to the TS `TRACED_EVENT_KINDS` (`trace.ts:26-38`). `fee` is the charged fee carried by the fill (single source, [11](11-exchange-rules.md)); v1 recomputed it from `feeRateBps` (`trace.ts:144-148`). |
| `feeds` | `seq`, `binance: {tsMs, value, receivedAtMs}\|null`, `chainlink: {tsMs, value, receivedAtMs}\|null`, `priceToBeat: {value, receivedAtMs}\|null`, `plugins: {<plugin id>: snapshot}` | Level `feeds` only: the values the strategy can see at this tick. `receivedAtMs` is the emitted visibility time (14 F-16, F-24, F-28). `plugins` holds the TS-shape snapshot of every requested plugin (absent keys omitted, 14 P-7). Used by the replay and feed-visibility gate ([14](14-feeds-and-plugins.md) V-3, [60](60-verification.md)). |
| `final` | `stats` (`MarketStats` without `execution` and `recorderV4Capture`), `skipReason`, `eventsProcessed`, `eventsByType`, `unrounded: {pnl, cost, feesPaid, splitCost, upShares, downShares}` | `unrounded` is new in v2 (6 dp; TS writes its float values) |

`order_delayed` and `cancel_acked` (account events of
[10-domain-model.md](10-domain-model.md) §10.1) MUST NOT appear in a
`ts-compat` trace. `settlement_update` is traced in both profiles, because
strategies receive it (TS `ws_order_update`,
`src/trading/StrategyRunner.ts:628-689`), so a status-driven decision is
verified directly. This replaces the statement in 13 §5.1 (`CompatStatus`)
that the parity trace omits status events. The TS writer traces a
`ws_order_update` only when its status maps to a `SettlementStatus`
(`MATCHED`, `MINED`, `CONFIRMED`, `RETRYING`, `FAILED`); the TS `CANCELED`
update after a FOK kill has no Rust counterpart and is classified, not
traced (13 §5.4). A fill reversal is a `settlement_update` with
status `Failed` (10 §9.2; serialized as the TS trade-status string).

### 3.3 Conventions

- `seq` = 0-based index of the strategy ticks ([21](21-job-and-output-contract.md)
  §1.1: counted ticks that passed the window gate; the TS observer starts a
  tick only after the gate, `src/backtest/runSingleMarket.ts:306-317`). So
  `seq` is not `eventsProcessed`, which counts every counted tick.
- `ts` = the tick's decision timestamp. For synthetic feed ticks it is the
  re-stamped visibility time. `cause` = the tick cause (an `eventsByType` key).
- Assets are written as outcome index `0` (UP) or `1` (DOWN), never as token
  ids. Exchange order ids and fill ids are omitted, and client ids are
  resolved through the accepted/open map (`trace.ts:69-77`).
- Numbers: prices, sizes and USDC values are JSON numbers. Rust renders exact
  6 dp decimals from fixed point. TS rounds to 1e-9 (`trace.ts:40-45`).
- **Ordering contract (both engines).** Tick record → the intents of that
  market callback, in returned order, written when the callback returns and
  before any resulting event → account events in strategy-delivery order, each
  written just before the strategy's account callback for it → that
  callback's intents → and so on, breadth-first FIFO through the cascade
  (`src/trading/StrategyRunner.ts:450-459`, `:669-690`). Events that are never
  delivered to the strategy are not traced.

### 3.4 Diff rules (v2)

These rules implement the binding parity tolerance (00 R5). They
replace the v1 rules, which used a 1e-6 numeric tolerance on every field and
loose rejection reasons (`src/backtest/parity/diff.ts:3-22`).

| Item | Rule |
|---|---|
| Alignment | Records are compared by index after the `header`. The headers must agree on `format`, `version`, `slug`, `candidateKey` and `profile`. |
| Prices, sizes, intent `amountUsdc`, `filledSize` | Exact after conversion to micros (round half away from zero at 1e-6). |
| USDC fields (`fee`, split `cost`, `final.unrounded.*`) | \|a − b\| ≤ 1e-4. |
| Integers (`seq`, `ts`, `expireAtMs`, counts), strings, booleans, null, key sets | Exact. |
| `reason` of `order_rejected`, `cancel_failed`, `split_failed`, `merge_failed` | The reason code (text before the first `(`) must match exactly when both sides use a known code from the `RejectReason` vocabulary ([21](21-job-and-output-contract.md) §17). Parenthesized parameters are ignored. If either code is unknown, both must be non-empty, and the diff reports `reason_code_unmapped`. |
| `final.stats` | Exact at persisted precision (2 dp, 4 dp, integers). `intentMeta` is compared deep-equal, with numbers inside meta within a relative 1e-9 (they are strategy floats). |
| `final.eventsProcessed`, `eventsByType`, `skipReason` | Exact. |
| Rounding boundary | If a quantized stat differs while its `unrounded` counterpart is within 1e-4, the diff reports `rounding_boundary` (or `rounding_tie` for a negative half tie, D08). A `fill` fee that differs by exactly 1e-4 on an exact 4-dp half is `fee_rounding_tie`, with the compensation rule of 60 §3.5 (PE-R3). These kinds are auto-classified: listed in PARITY.md, not failures. |
| Tolerance flags | Gate runs MUST use these fixed rules. A `--tolerance` override exists for exploration only and marks the report non-gating. |

The diff reports the first divergence with ±5 records of context, plus the
summaries (`diff.ts:118-149`). Classifying each mismatch (TS bug, Rust bug,
intended model change) is specified in [60-verification.md](60-verification.md).

### 3.5 Why parity uses unrounded values

A 1e-6 internal difference can flip a 0.01 rounding and, with it, a
win/flat classification (batch stats classify by the sign of the rounded pnl;
requirement `output-quantization-policy`). Comparing quantized stats alone
would turn harmless residue into mismatches. Comparing only unrounded values
would miss persisted differences. v2 does both, with the auto-classes above.

### 3.6 Cost

Parity traces are written only in parity runs (on worker-1, D36; concurrency
per 60). Rust writes with streaming gzip (level 6, the same as
`trace.ts:235`) through a 64 KiB buffer on the job's thread.

## 4. Ledger — `pmb-ledger/1`

### 4.1 Production and storage

- Opt-in per submission: the backtest CLI flag `--ledger`
  ([20](20-binary-protocol.md) §5.6). Calibration and A/B runs set it. It sets
  `MarketJobData.ledger`, and the shim sets `job.outputs.ledgerPath` inside
  the executor's work dir ([21](21-job-and-output-contract.md) §4, §5.1). The
  binary writes one gz JSONL file per (market, candidate), streaming gzip
  level 6 through a 64 KiB buffer on the job's thread, like the parity trace
  (§3.6).
- **Transport is owned by [42](42-persistence-and-stats.md) §7.5** and
  summarized here: the shim attaches each ledger to the job result as base64
  gzip, at most 4 MiB per market-candidate (above that it drops the ledger
  and marks the candidate result `ledgerDropped: 'too_large'`); the
  aggregate host uploads every ledger to
  `backtest-ledgers/<submissionUid>/<slug>.jsonl.gz` (in a group, under each
  candidate's own `submissionUid`) plus a `manifest.json`, skip-if-exists,
  before the run's DB transaction, then writes `ledger_uri`. Market workers
  hold only read-only R2 keys and never upload
  (`docs/backtest/fleet/overview.md:114-131`). Which host holds the write
  credential, and its scope, is a gate-4 question (01 §12.1 item 1); until
  then only worker-1 uploads, and without a write credential ledgers stage
  locally with a `local://` `ledger_uri` (42 §7.5.3). Under `--sequential`
  the producer process plays the aggregate role.
- Redis volume: the producer bounds markets × candidates with ledgers at
  10,000 (`--max-ledger-markets`, 42 §7.5). Estimate for 41 §6.4: the header
  (full ModelConfig) is about 1 KiB gzipped and each order with its fills
  about 0.2 KiB, so a market-candidate with at most 10 orders is about
  1-3 KiB gzipped, 1.3-4 KiB after base64; the 10,000 bound is then 13-40 MB
  of transient Redis. M3b measures real sizes and revises the bound.
- `--extend` writes ledgers iff the parent run has `ledger_uri`, under the
  parent's prefix, so a ledgered run stays complete (20 §5.6).
- `paper` and `live` always produce a ledger per window, with real exchange
  times taken from the journal (§6). The TS launcher uploads it with the
  journal (§6.4). Retention comes later (D15).

### 4.2 Records

All money and size values are JSON numbers rendered exactly from fixed point
(6 dp). Times are integer ms.

| `t` | Fields |
|---|---|
| `header` | `format:"pmb-ledger"`, `version:1`, `source:"backtest"\|"paper"\|"live"`, `slug`, `conditionId`, `candidateKey`, `profile`, `seed`, `modelConfigSha256`, `modelConfig` (full, so it includes `rules.rulesTableVersion`), `rules {rulesSource, snapshotParserVersion, captured, feeEra, feeCurve, feeSource}` (the job's `market.rules` record plus the engine's classification, [11](11-exchange-rules.md) §13.4, §13.8), `window`, `engineVersion`, `engineCommit` |
| `order` | One record per order, written at its terminal state: `oid` (engine order id), `cid`, `gen` (client-id generation), `asset`, `side`, `orderType`, `price`, `size` (requested shares; null when the strategy sized the order in collateral), `amountUsdc\|null` (the collateral amount of a collateral-sized BUY, including one converted from shares, 10 O2), `postOnly`, `expireAtMs`, `meta`, `decision {seq, tsMs, origin}`, `submit {tsMs}`, `visible {tsMs}\|null` (exchange-visible after latency), `delayedUntilMs\|null` (taker delay), `accept {tsMs}\|null`, `reject {tsMs, reason}\|null`, `cancelRequest {tsMs, seq}\|null`, `cancelEffective {tsMs}\|null`, `terminal {tsMs, reason, filledSize}`, `queueAheadAtArrival\|null`, `bookAtDecision {bestBid, bestAsk}`, `bookAtArrival {bestBid, bestAsk}` |
| `fill` | `fid` (engine fill sequence), `oid`, `cid`, `tsMs`, `asset`, `side`, `price`, `size`, `liquidity`, `fee`, `queueAheadBefore\|null`, `latency {component: ms}` (the sampled components, [13](13-execution-models.md)), `printRef\|null` (the trade print that triggered a maker fill, when the fill model uses prints) |
| `split` / `merge` | `requestedTsMs`, `completedTsMs`, `size`, `amountUsdc`, `status: ok\|failed`, `reason` |
| `final` | `stats`, `unrounded`, `cash {start, end, reservedEnd}`, `counters` (as in [21](21-job-and-output-contract.md) §10) |
| `truncated` | Written once, as the last record before `final`, when a market-candidate reaches 200,000 records; later `order`, `fill`, `split` and `merge` records are not written. A guard against runaway strategies: the 4 MiB transport cap of 42 §7.5 normally binds first. The job still succeeds. Calibration rejects truncated and dropped ledgers (42 §7.5). |

For `live`, `order` and `fill` additionally carry `exchangeOrderId`, `sentAtMs`,
`sentMonoNs`, `ackAtMs`, `ackMonoNs`, the exchange status progression,
`tradeId`, `matchTime`, `txHash` and `role`, copied from the execution
sidecar (§6.5).

## 5. Dashboard simulator trace (M3c, D10)

- **Guard (TS, MUST; merged at G2, kept for engine versions without the
  sink, 01 §6 M3c):** `src/backtest/simulator/resolveMarket.ts:98-111`
  refuses a run whose artifact is native, with the message "Market Simulator
  does not support native runs yet". Today it falls back to
  `getStrategyDefinition(run.strategy)` (`:106`), which throws or silently
  replays a same-id TS registry strategy and labels it as that run.
- **M3c:** a `SimulatorSink` emits the existing dashboard contract unchanged
  (`src/backtest/simulator/contracts.ts:6-146`: `TraceManifest`, `ChunkIndex`,
  `TraceChunk`, `TraceFrame`, `DisplayState`, `ActionIndex`, `ChartPoint`).
  The engine must provide, per tick, the top-10 book per outcome, the exchange
  and receive times, and the input sequence. Per account event it must
  provide `DisplayState`: the `CapitalSnapshot`
  `{startingCapital, cash, reservedCash, availableCash}`, positions
  (qty, cost, average), orders with state and meta, `cashDelta`, fees, fills
  and realized PnL. It also provides action labels, the external-feeds
  context snapshot, and the rejection text
  `insufficient_capital(required=X,available=Y)` that the UI parses
  (`contracts.ts:186-197`). The saved-vs-replay comparison keeps its 0.00005
  tolerance (`src/backtest/simulator/captureTrace.ts:72`). TS keeps filling
  `ReplayProvenance`. The binary writes it with `run --sim-trace <dir>`
  ([20](20-binary-protocol.md) §5.4).

## 6. Live journal — `pmb-live-journal/1`

### 6.1 Invariants

- The journal is a replay input, not a log (D26). It holds every envelope
  that entered the serial event loop ([12-engine-core.md](12-engine-core.md);
  requirement `single-serial-event-loop`), in loop order, with receive stamps.
  Replaying it through the backtest path MUST reproduce the same decisions
  (and, in paper mode, the same fills). That is the M8 identity proof (01 §6,
  60 DET-11); M7 delivers the shared reader foundation.
- `paper` and `live` use the same schema. Today's `LOG_TO_FILE` output is a
  text log and cannot be replayed (`src/cli/trading-bot.ts:221-235`).

### 6.2 Envelope

Each record is a Recorder V4 `CapturedEvent` (`src/recorder-v4/types.ts:64-84`),
so one Rust reader handles worker-2 V4 packages and live journals
([15-inputs.md](15-inputs.md)):

| Field | Journal meaning |
|---|---|
| `schemaVersion` | `4` |
| `captureId` | live `instanceId` (stable per installation and API key) |
| `sessionId` | one process run |
| `sequence` | serial-loop sequence, decimal int64, strictly increasing within a session, never reused |
| `eventId` | `captureId + ":" + sequence` |
| `receivedAtMs`, `monotonicNs` | wall and monotonic receive stamps, taken at callback entry before parsing (`types.ts:22-23`) |
| `source`, `connectionId`, `eventType` | §6.3 |
| `sourceTimeMs` | the exchange timestamp when the payload has one, otherwise null |
| `rawJson` | exact frame or response text after redaction (§6.7) |
| `detailsJson` | request metadata (`requestSeq`, `sentAtMs`, `sentMonoNs`, `httpStatus`, endpoint) and local annotations; never authentication |

### 6.3 Sources

The journal extends V4's `RecorderSource` (`src/recorder-v4/types.ts:5-12`).

| `source` | Input? | Content |
|---|---|---|
| `polymarket` | yes | Market WS frames: `book` (with hash), `price_change`, `last_trade_price` (with transaction hash), `tick_size_change`, `best_bid_ask`, resolution events |
| `polymarket_user` | yes | User WS order and trade frames, unmodified |
| `binance`, `chainlink`, `price_to_beat` | yes | Feed frames as V4 records them |
| `market_metadata` | yes | Gamma and CLOB market responses used for discovery and rules (D21) |
| `rest` | responses yes, requests no | `request` records at send time and `response` records at receipt (order post, cancel, open orders, trades, balance, heartbeat), linked by `requestSeq` |
| `timer` | yes | Every scheduler firing that reaches the loop (GTD and expiry checks, paper latency wake-ups, rotation, heartbeat) with its actual fire time, because live timer timing depends on OS scheduling |
| `operator` | yes | State-socket commands: `cancel_order`, `cancel_all`, `refresh_balance`, `kill`, `pause`, `resume`, `heartbeat_pause` (20 §7, 50 §16) |
| `chain` | yes | Split, merge and redeem results from the TS sidecar (D25) |
| `session` | yes | Cross-market inputs that change this market's decisions: available-cash grants (D31), session guard state, kill switch |
| `clock` | yes | Clock-offset samples (local vs exchange time, method, RTT), used for the exchange-time estimate (D27) |
| `lifecycle` | yes | Headers, config, market start and rotation, reconnects and data-gap markers, stop |
| `control`, `bootstrap` | yes | As in V4 (for example the book state restored after a reconnect, `types.ts:135-143`) |
| `engine` | no | `decision` records (intents per callback, with `seq`). Replay skips them as inputs and compares its own decisions against them. |

### 6.4 Files, durability, finalization

- Local layout: `<journal-dir>/<instanceId>/<sessionId>/<slug>.jsonl` per
  market, plus `session.jsonl` for envelopes that belong to no market. Like
  V4, a market file contains every envelope routed to that market plus
  duplicated shared observations (feeds, clock, session), with global
  sequence numbers and gaps allowed (`docs/datasets/recording/recorder-v4.md:222`).
  One market file is enough to replay that market.
- The first record of a market file is the `lifecycle` `market_header`:
  binary sha256 (supplied by the launcher in the config), source hash and
  build variant (`standard` or `real-orders`, 31 §5.5; 15 I-51), `engineVersion`,
  `engineCommit`, strategy id, normalized params, `ModelConfig` and its sha,
  seed, the rules snapshot as fetched, instance and session ids,
  `configSha256`, clock skew at startup, mode, the `decisionsOnly` flag and
  the journal bounds below. No secrets.
- **Writer off the hot path:** a dedicated writer thread fed by a bounded
  channel. The serial loop never waits on disk. Records are written in
  sequence order. An outgoing order request's `rest request` record is
  enqueued before the HTTP send. `fsync` runs at most every 100 ms, at
  market end and at every session state change (halted, kill switch,
  rotation). Guarantee: an OS-level write survives a process crash, while a
  crash can lose at most the queued, unwritten tail. A power loss can lose
  about the last 100 ms. Startup reconciliation covers both (D29). This trade
  keeps fsync latency out of the order path (01 §2 S4: minimum live latency).
- **Back-pressure: records are never dropped.** Every consumed envelope is
  journaled first. Three bounds on queued bytes, all live config fields:
  - *Soft* (default 16 MiB): the loop stops issuing new intents, cancels
    still go out, alert `journal_backpressure`; inputs are still consumed
    and journaled.
  - *Hard* (default 64 MiB, or the soft state lasting longer than
    `journal_stall_kill_ms`, default 5,000 ms): the kill switch trips
    (50 §10.4). From then on the loop consumes only account inputs (REST
    and user-WS responses) and timers; market and feed ingress wait (TCP
    back-pressure).
  - *Reserve* (default 4 MiB above the hard bound): only cancel requests,
    their responses, account inputs and kill-switch records may use it, so
    the kill-switch cancels are journaled before they are sent.
  The runtime never deletes a journal file itself.
- Finalization after market end plus the resolution grace: gzip, sha256, and
  a manifest `{schemaVersion: 4, journalFormat: "pmb-live-journal/1", mode,
  instanceId, sessionIds, slug, conditionId, sequence range, record counts by
  source, gaps, sha256, bytes, binary sha256, engineVersion}`. The TS launcher
  uploads it to the private bucket (D15; bucket and credential are a gate-4
  question, below) with read-back verification, as V4 does
  (`recorder-v4.md:186-196`), and deletes the local files only after a
  verified receipt; without one, finalized packages stay local. V4 tools that do not know `journalFormat` reject the package rather than
  misread it.
- A restart in the middle of a market creates a new session file. Sessions
  are never stitched together silently (`recorder-v4.md:242`).

### 6.5 Execution sidecar (derived index)

`<slug>.exec.jsonl` holds one record per intent: `cid`, `oid`, decision
`{seq, tsMs}`, request `{sentAtMs, sentMonoNs, endpoint, body (redacted)}`,
response `{ackAtMs, ackMonoNs, httpStatus, status: live|matched|delayed|unmatched,
orderId, makingAmount, takingAmount, tradeIds, errorMsg}`, the status
progression `[{status, receivedAtMs, monoNs, exchangeTsMs}]`, and trades
`[{tradeId, role, matchTime, txHash, statusProgression
(MATCHED → MINED → CONFIRMED | RETRYING | FAILED), price, size, feeRateBps,
makerOrders[{orderId, price, matchedAmount, feeRateBps}]}]`, plus cancel
`{requestedAtMs, ackAtMs, result}` and the terminal state.

- It is derived: it can be regenerated from the journal by the journal reader
  ([15-inputs.md](15-inputs.md)). The runtime writes it as a convenience, and
  when the two disagree, the journal wins.
- No event time may use the decision time in place of an ack or fill time.
  Today `order_accepted` is stamped with the decision tick time
  (`src/trading/execution/LiveExecution.ts:249-254`, `:377-384`).

### 6.6 Replay semantics

- Input mode `journal` ([21](21-job-and-output-contract.md) §5). The job is
  built from the `market_header`. Its params, `ModelConfig` and seed MUST
  equal the header's, otherwise `invalid_input`.
- **Paper journals** contain no exchange responses, because the simulator is
  internal. Replay = a backtest over the journaled inputs with the same seed.
  It MUST yield identical decisions and fills, checked against the `engine`
  decision records one by one.
- **Live journals:** `rest`, `polymarket_user` and `chain` responses are
  inputs, injected by a journal execution adapter keyed by `requestSeq` and
  `cid`. Replay MUST produce the same order requests as the journaled
  `request` records. Any difference is a determinism failure.
- Clocks follow D27: `ctx.now` = the processed envelope's `receivedAtMs`.
  Latency intervals come from `monotonicNs`. GTD and expiry use the estimated
  exchange time (local time minus the skew from `clock` samples).

### 6.7 Redaction (MUST)

- Never written anywhere (journal, sidecar, ledger, logs, state stream): the
  private key, API secret, passphrase, L2 authentication headers and HMAC
  signatures, the `auth` object of the user-WS subscription, relayer and
  builder credentials, and anything read from a secrets file descriptor
  (20 §7).
- REST request headers are allowlisted (method, path, content type). In
  bodies, order `signature` and `owner` values are replaced by
  `"<redacted:sha256:<first 16 hex>>"`, so joins still work.
- Redaction happens before a record enters the writer channel, so the writer
  never holds a secret. A test journal is scanned for the fixture secret
  values. Today raw user messages and part of the API key are logged
  (`src/polymarket/ws/userWsAccountSource.ts:515-535`); this is not copied.

### 6.8 Calibration join keys

Because the journal stores raw frames, no field is dropped. These keys MUST
be recoverable for calibration ([51-calibration-plan.md](51-calibration-plan.md);
requirements `calibration-join-keys`, `journal-v4-join`): `condition_id`; own
trades to worker-2 V4 `last_trade_price` by `transaction_hash` (1:1, one
print per transaction); book state by book hash plus exchange timestamp; and
per order the client id, exchange order id, local submit and ack times, the
exchange `created_at`, trade ids, `match_time`, status changes, transaction
hash, maker or taker role, and each maker level's price, size and
`fee_rate_bps`. V4 compact storage drops only `price_change` hashes
(`recorder-v4.md:230`). The journal keeps the raw text, so nothing is lost.

## Open questions

None.

## Gate-4 questions

Listed with the other gate-4 questions in 01 §12.1.

1. **Private storage for live journals and live ledgers (R2 tokens; 01
   §12.1 item 1).** D15
   keeps live journals long-term in a private bucket, but no bucket or
   prefix exists yet, and the live host's launcher needs a write credential
   that fleet workers and agent sandboxes must not hold. Which
   bucket or prefix, and which scoped token? Until then the interim rule of
   01 §12.1 item 1 applies, and no journal is deleted without a verified
   upload (§6.4).
