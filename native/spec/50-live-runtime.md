# 50 — Live runtime

This document specifies the Rust live runtime: the long-running process that
feeds live Polymarket and feed data into the same engine core that backtests
use, and executes the core's intents either in **paper** mode (realistic
simulator on live inputs) or in **real-order** mode (CLOB V2 adapter). It
covers market discovery and rotation, the WebSocket clients, the journal and
the identical-decision replay proof, the CLOB V2 adapter, startup
reconciliation, session risk guards, strategy fault handling, alerts, and the
TypeScript launcher that stays responsible for on-chain transactions,
result persistence and the static WebUI. Speed is the top priority (user,
2026-10-08): the runtime is designed for minimum tick-to-wire latency and
every latency component is measured.
The ~$100 calibration that uses this runtime is in
[51-calibration-plan.md](51-calibration-plan.md).

Normative keywords: MUST, SHOULD, MAY. Decisions referenced as Dnn are in
[02-decisions.md](02-decisions.md) and are not reopened here.

## 1. Scope and references

In scope: BTC 5m and 15m (D06); paper mode (D28); real-order mode in a
separate `real-orders` build plus an explicit flag (D05, D44); journal (D26); startup
reconciliation (D29); heartbeat and single key owner (D30); live capital and
session guards (D31); strategy panic policy (D32); alerts (D33); the TS
launcher for split/merge/redeem transactions (D25), result persistence and
the WebUI.

Out of scope: Deribit; other symbols; any change to the TS trading bot
(`src/cli/trading-bot.ts` stays as is and is not a design template; it is
broken since the CLOB V2 cutover, `docs/live-trading/live-trading-bot.md:11`,
`package.json:190`).

Owned by other documents (referenced, not repeated):

| Topic | Document |
|---|---|
| Fixed-point types, ids, clock vocabulary | 10-domain-model.md |
| ExchangeRules fields, tick/min size, fee curve, taker delay, GTD conversion | 11-exchange-rules.md |
| Serial event loop, input envelope, intents, order state machine, settlement statuses, cascade | 12-engine-core.md |
| Execution trait, simulator, FillModel, LatencyModel, ReportModel, profiles | 13-execution-models.md |
| Feed decoders and visibility clocks, plugins | 14-feeds-and-plugins.md |
| Recorder V4 reader and journal reader | 15-inputs.md |
| Threading, measurement method, Apple core types, platform crate | 16-performance-and-parallelism.md |
| Subcommands `paper` and `live`, `run` with input mode `journal`, I/O and exit codes | 20-binary-protocol.md |
| RunSingleMarketOutput / MarketStats, ModelConfig | 21-job-and-output-contract.md |
| Journal schema, file layout, durability and writer backpressure (extended V4 envelope + execution sidecar), ledger | 22-trace-ledger-journal.md (§6.4 is normative for §12 here) |
| Strategy SDK, panic contract for strategy authors | 30-strategy-sdk.md |
| Reproducible build, artifact identity, live trust check | 31-artifacts-build-publish.md |
| backtest_runs rows for live/paper windows | 42-persistence-and-stats.md §7.4 |
| Calibration sets (committed `native/contract/calibrations/latency/<id>.json`, resolved through `execution.latency.calibrationId` and `clock.marketData.calibrationId`) | 21 §6.3, 13 §7.4, 51-calibration-plan.md §13 |
| Proof gates and fault-injection suite | 60-verification.md |

## 2. Principles

- **LR-1 One core.** The live runtime links the same core crate as the
  backtest binary. Live differs only in the input source (sockets instead of
  Parquet) and the execution adapter (paper simulator or CLOB V2). The core
  never knows which one it runs on.
- **LR-2 No hidden inputs.** The core reads no wall clock, no environment
  variable and no network. Everything that can change a decision enters as a
  journaled input envelope (§5).
- **LR-3 Nothing blocks the loop.** REST calls, signing, on-chain operations,
  journal writes and alerts run off the core thread. Their results return as
  input envelopes. This removes the TS stall where a tick awaits a REST round
  trip (`src/trading/StrategyRunner.ts:192-246`,
  `src/trading/execution/LiveExecution.ts:614-690`).
- **LR-4 Never drop, fail closed.** No input, fill or status is ever dropped
  (contrast `src/trading/StrategyRunner.ts:574-585`, which drops queued
  events). A full queue applies back-pressure, never discard:
  - journal writer: the soft bound of 22 §6.4 (no new intents, cancels still
    go out, alert), escalated to the kill switch by its hard bound (§12);
  - ingress ring: the ingress thread stops reading its socket (TCP
    back-pressure; nothing is lost) and raises `core_stall`; a stall longer
    than 2 s also stops heartbeats through liveness gating (§8.2.9) and trips
    the kill switch (§10.4).
  Logs and telemetry are not inputs: their queues MAY drop lines, counted in
  `status.json` (§15), so a slow log sink can never stall the core.
- **LR-5 The agent never places real orders.** The AI agent MAY build and run
  paper mode with the `standard` build, which contains no order-sending code
  (D44); agent-run paper sessions run on worker-1 (D36, 01 §6 M8) and load no
  secret (§8.1). It MUST NOT build a `real-orders` artifact
  (`strategy:build-live`) or run the feature against production endpoints;
  it MAY compile the feature for the mock-exchange, golden-vector and
  shadow-mode tests of §19, with throwaway keys and nothing sent (31 §5.5,
  60 §13). Only the user launches real-order mode (§17).

## 3. Ownership split

| Responsibility | Owner | Notes |
|---|---|---|
| Market discovery, rules fetch, pre-subscription, rotation, resolution tracking | Rust | §6 |
| Market WS, user WS, Binance, PolyBolt Chainlink, PTB poller | Rust | §7; decoders shared with the V4 reader (15-inputs.md) |
| Paper execution, CLOB V2 order/cancel/heartbeat, REST reconciliation | Rust | §8, §9 |
| Capital, session guards, kill switch, strategy panic policy | Rust | §10, §11 |
| Journal, per-market results, latency telemetry | Rust | §12–§14, §18 |
| Alerts (push) and status file | Rust | §15 |
| State and command WebSocket (existing WebUI protocol, 127.0.0.1) | Rust | 20 §7; §16 |
| Split/merge/redeem transaction submission | TS launcher | `chain_request` / `chain_response` (D25, 20-binary-protocol.md §7), §8.3 |
| pUSD wrapping, approvals, on-chain balance display | TS scripts | user-run |
| Static WebUI bundle | TS | `webui/` package, connects to the Rust state WebSocket |
| MySQL ingest of live/paper results, journal upload to R2, trust check | TS launcher | Rust holds no DB or R2 credentials |

## 4. Process model

### 4.1 One owner per wallet and key

- A live process MUST own exactly one funder wallet and one CLOB API key, and
  run exactly one strategy artifact over one or two BTC timeframe streams
  (5m, 15m). Running both timeframes in one process keeps one heartbeat chain,
  one capital ledger and one session-risk ledger (D30, D31). A second process
  on the same funder or key would break the heartbeat chain and the capital
  rule, so it is refused.
- At startup the runtime MUST take an exclusive `flock` on
  `<state_dir>/locks/<funder>-<api_key_id>.lock` and exit with a clear error
  if it is held. The lock is released by the OS on process death.
- Paper mode takes a separate lock namespace (`paper-<session>`) and never
  touches authenticated trading endpoints, so it MAY run next to a real
  process.

### 4.2 Threads

The core is single-threaded and deterministic. Concurrency lives only at the
I/O edges. Thread layout (16-performance-and-parallelism.md §12 owns the
runtime choice and the measurement method):

| Thread | Work | Priority class (macOS QoS) |
|---|---|---|
| core | dequeue envelopes, apply to books/plugins/strategy/order manager/portfolio, emit intents and outputs | hot (USER_INTERACTIVE) |
| ingress (one per socket group) | read frames, take the ingress stamp, decode with the shared pure decoder, push `(raw, decoded, stamp)` | hot (USER_INTERACTIVE) |
| egress | build, sign and send orders/cancels over pre-warmed connections; push responses back as envelopes | hot (USER_INTERACTIVE) |
| heartbeat | CLOB heartbeat chain, gated on core liveness (§8.2.9) | high (USER_INITIATED) |
| journal writer | serialize and append envelopes and execution records | background-ish (UTILITY) |
| telemetry | alerts, status file, logs, state/command WebSocket for the WebUI | background-ish (UTILITY) |

- Apple Silicon has no hard core affinity. The runtime MUST steer hot threads
  to performance cores through QoS classes (`pthread_set_qos_class_self_np`)
  and MUST keep journal and telemetry work at UTILITY so it can run on
  efficiency cores.
- Queues between threads MUST be bounded and allocation-free in steady state
  (preallocated ring buffers or bounded MPSC/SPSC channels).

### 4.3 Host requirements

The rules below are written for the current macOS hosts; each OS-specific
item is the macOS implementation of the platform trait (§4.4).

- **Hosts.** Agent-run paper sessions run on worker-1 (D36). The calibration
  and live host is chosen at gate 4 (Gate-4 question 2); today's TS live Mac
  is the MacBook m1-ivan, which takes no native market jobs (D55).
- The process MUST hold a power assertion that prevents idle system sleep
  (IOKit `PreventUserIdleSystemSleep`) and MUST alert if the system announces
  sleep; sleep stops heartbeats and data.
- The launchd job MUST set `ProcessType=Interactive` so App Nap and timer
  coalescing do not delay the loop.
- Paper sessions MAY share worker-1 with the fleet worker, Global Runtime
  sessions and goal-session builds; their backtest threads run at `utility`
  or `background` QoS (16 §10.3), and no benchmark runs during a paper session
  (D47). While real orders run, backtest workers, Global Runtime sessions,
  the M11 build daemon (31 §11) and goal-session builds, parity runs and
  benchmarks on the live host MUST be paused (pause Global Runtime runs
  before stopping any daemon, never kill an in-flight session) or capped to
  `background` QoS, so performance cores stay free
  (`calibration-host-isolation` in `research/requirements-sweep.json`).
  Host load MUST be journaled every 10 s.

### 4.4 Platform independence

Network distance to the CLOB is the largest live latency term (§18), so the
runtime MUST NOT be tied to macOS by design:

- Every OS-specific behavior (priority class per thread, sleep prevention,
  sleep notifications, service supervision hooks) MUST sit behind one trait
  in the engine-owned platform crate (16-performance-and-parallelism.md
  §10.2), with a macOS implementation (QoS, IOKit power assertion, launchd)
  and a Linux implementation (`SCHED_OTHER` nice levels or `SCHED_FIFO` when
  permitted for hot threads; no power assertion; systemd unit).
- The live runtime crates, the CLOB V2 adapter and its mock-exchange and
  golden-vector tests MUST compile and pass on `aarch64-unknown-linux-gnu` and
  `x86_64-unknown-linux-gnu` in addition to `aarch64-apple-darwin`, checked in
  CI or by a local cross build at every milestone from M8. This does not
  change D12: fleet artifacts stay `aarch64-apple-darwin`; the Linux targets
  keep a co-located live host possible without a port under time pressure.
  Whether live trading ever moves to such a host is part of Gate-4 question 2.

## 5. Input envelopes, sequencing and clocks

### 5.1 Envelope

Every input is journaled as an extended V4 record (D26; schema 22 §6.2:
`sequence` assigned at core dequeue, `receivedAtMs`, `monotonicNs`, `source`,
`connectionId`, `sourceTimeMs` when the payload has an exchange timestamp,
the raw payload) and enters the core as a 12 §3.1 envelope. The record
already exists for captures (`src/recorder-v4/types.ts:22-36,64-84`) and is
built the same way in the TS live stream
(`src/trading/feeds/liveCapturedFeeds.ts:94-115`).

Input kinds: market frames (book, price_change, last_trade_price,
tick_size_change, best_bid_ask, new_market, market_resolved), feed frames
(Binance aggTrade, Chainlink rounds, PTB), user-WS frames, REST responses
(order, batch, cancel, open orders, trades, balances, rules, server time),
timer firings, `chain_response` results (split/merge/redeem), operator commands,
connection status changes, clock samples.

### 5.2 Sequencing rules

- The journal order MUST equal the core consumption order. Replay feeds the
  journal back in that order; this is the only order that matters for
  determinism. Several ingress rings are merged by ascending ingress stamp
  with a fixed source rank (12 E2).
- Ingress threads MUST take the stamp at socket read, before decoding, and
  MUST decode with the same pure function that the V4/journal reader uses
  (15-inputs.md). The journal stores the raw frame; replay decodes it again
  and MUST get the same typed event.
- One frame that carries several events (batched price_change) is one
  envelope; the core expands it deterministically.

### 5.3 Clocks (D27)

- `monotonicNs` is the source of truth for intervals. `receivedAtMs` is
  derived as `wall_anchor + (monotonicNs − mono_anchor)`, with the anchor
  taken at startup and re-anchored only by journaled clock-sample envelopes,
  so `ctx.now` never moves backwards when NTP steps the OS clock.
- `ctx.now` = local receive time of the triggering envelope.
- The exchange-time estimate is `ctx.now − skew`. The skew is measured at
  startup and then every 60 s from (a) `GET /time` (second resolution) and
  (b) the lower envelope of `receive − exchange_ts` over market events, which
  bounds offset plus minimum one-way delay. Both are journaled as
  clock-sample envelopes. GTD validation and the late-start gate use the
  exchange-time estimate.
- **Timers** (`Journaled` scheduler, 13 §2.3 TS1–TS4; stamps 12 E5). The
  core's deadlines (paper latency and taker delay, GTD expiry, rotation,
  resolution and reconciliation deadlines) become `Timer(due)` envelopes:
  synthesized by the core before the first input whose `at` is past the due
  time, or injected by the runtime's OS timer, armed at `next_due()`, when no
  input arrives. Both are journaled with their own `sequence`; the OS-timer
  fire lateness is journaled and shown in the latency report (§18.1).
  Exchange-side effects keep the due time; events delivered to the strategy
  carry the loop clock (12 K2, 10 V2). Replay synthesizes no timer and
  asserts each journaled due time (13 TS4).

## 6. Market discovery, subscription, rotation, resolution

### 6.1 MarketSession lifecycle

Each market has its own session (own book set, strategy instance, plugin set,
portfolio, order manager). Sessions share the process-level capital and risk
ledgers (§10).

```
Discovered -> RulesLoaded -> Subscribed (pre-window) -> Active [start, end)
  -> Draining (end) -> AwaitingResolution -> Resolved -> Reported
```

At most three sessions coexist per timeframe: the one awaiting resolution,
the active one and the pre-subscribed next one.

### 6.2 Discovery and rules

- The next slug MUST be derived from the window epoch
  (`btc-updown-{5m,15m}-<startSec>`), not from "current market" queries.
- Gamma `GET /markets/slug/<slug>` MUST be fetched at least 120 s before the
  window start (configurable), retried with backoff. A response describing an
  earlier window MUST be retried, as in
  `src/polymarket/upDown15mWindowGuard.ts:31-49`.
- Rules MUST be fetched from CLOB `/clob-markets/{condition_id}` (the SDK's
  `getClobMarketInfo`: `mts`, `mos`, `fd`, `itode`, `oas`) and Gamma
  (`feeSchedule`, `secondsDelay`, `orderMinSize`, `orderPriceMinTickSize`,
  `version`, `negRisk`; `negRisk` only from Gamma, 11 K8), journaled as raw
  bodies and normalized before the first tick (11 §13.6). They replace the
  TS lazy warmup (`src/trading/execution/LiveExecution.ts:118-142`).
- `tick_size_change` MUST update the rules in force for validation from the
  envelope on which it is applied.
- **Market version guard.** The runtime MUST refuse to trade a market whose
  `(version, negRisk)` pair is not in the adapter's tested set. Today that is
  `(v1, false)`; the other domains of 11 §10 V2 are refused. A refused market
  is journaled and alerted; paper mode MAY still run it.

### 6.3 Pre-subscription

- The next market's asset ids MUST be added to the existing market WS with
  `{"operation":"subscribe","assets_ids":[...],"custom_feature_enabled":true}`
  before the boundary, never by closing and reopening the socket. The V4
  feed already does this (`src/recorder-v4/feeds/polymarket.ts:20-40`); the
  TS bot does not (`src/cli/trading-bot.ts:1036-1059`).
- The user WS `markets` filter MUST be extended with the next condition id
  in the same way (`{"operation":"subscribe","markets":[...]}`).
- Assets of sessions that reached Reported MUST be unsubscribed.

### 6.4 Window semantics (D23)

- The strategy is called only for envelopes with `ctx.now ∈ [start, end)`,
  the realistic window gate of 12 §5.4. Plugins observe pre-window envelopes
  from Subscribed onward without strategy calls.
- **Late start.** If the process starts after `start + late_start_skip`
  (default 15 s, the current TS default at `src/cli/trading-bot.ts:584`),
  the session runs in observe-only mode for that window. The value is part of
  the journaled live config.
- At `end` the session enters Draining (12 §10 `Closing`): `Control(WindowEnd)`
  makes the OM send `CancelMarket{Market}` with cause `WindowEnd`. Real mode
  sends it as `DELETE /cancel-market-orders {"market": <condition_id>}`
  (§8.2.4); paper mode lets it travel with the simulated cancel latency, and
  the simulated exchange-side close cancels what still rests with
  `Canceled(MarketClosed)` (13 §6.6, 13 §8). The session then waits for
  terminal states. Fills and settlement updates that arrive later are still
  applied to that session.

### 6.5 Resolution and reporting

- Resolution comes from `market_resolved` (custom feature) and, as a
  fallback, from a Gamma poll every 30 s starting at `end`.
- When resolved and every order is terminal, the session emits its
  RunSingleMarketOutput (§14) and moves to Reported.
- If unresolved 6 h after `end`, the session emits an output with
  `skipReason: unresolved_outcome` and alerts. Values are configurable.

## 7. WebSocket and feed clients

| Stream | Endpoint | Subscription | Keep-alive and staleness | Reconnect rule |
|---|---|---|---|---|
| Market | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | `type: market`, `initial_dump`, `custom_feature_enabled: true`, then `operation` add/remove | text `PING` every 10 s; stale if no frame for `market_stale_ms` (default 15 s) | rebuild books from the fresh `book` dump; keep strategy and plugin state |
| User (real only) | `wss://ws-subscriptions-clob.polymarket.com/ws/user` | `{"auth":{...},"type":"user","markets":[cond...]}` sent immediately | text `PING` every 10 s; stale after 25 s | REST reconcile (§8.2.7) before applying new frames |
| Binance | `wss://stream.binance.com:443/stream?streams=btcusdt@aggTrade` (`bookTicker` only with follow-up F7, D43) | combined stream | WS ping/pong; stale after 10 s | resume; gap journaled |
| Chainlink | PolyBolt `wss://ws-live-v2.polymarket.com/ws` | rounds as in `src/recorder-v4/feeds/polybolt.ts` (TWAP only with F7, D43) | per provider; stale after 10 s | resume; gap journaled |
| PTB | website poll (`src/recorder-v4/feeds/priceToBeat.ts`) | per market from start | poll interval 1 s, 429 backoff | n/a |

Endpoints and payload shapes are those of the V4 recorder
(`src/recorder-v4/feeds/*.ts`) and docs.polymarket.com/trading/realtime-order-updates.
The V4 transport already uses text `PING`; the TS user source uses a
protocol-level ping, which is wrong (`src/polymarket/ws/userWsAccountSource.ts:494`).

Rules:

- A disconnect MUST produce a journaled `data_gap` status envelope. Between a
  market-WS disconnect and the fresh `book` dump, the affected books are
  marked stale. The strategy receives no ticks for a stale book and sees the
  gap state through the SDK (30-strategy-sdk.md). V4 replay with capture gaps
  follows the same rule (15-inputs.md). This replaces the TS reset of books
  and plugins on every reconnect (`src/cli/trading-bot.ts:997-1006`).
- A market-WS gap longer than `gap_alert_ms` (default 5 s) while a session is
  Active MUST raise an alert (§15).
- The user-WS client MUST NOT be the only source of account truth. Every
  (re)connect and every gap triggers REST reconciliation, because the stream
  does not replay missed changes.
- Feed clients MUST match the requested-feed configuration of the strategy
  artifact (`describe`, 20-binary-protocol.md). A requested feed that is not
  available MUST fail the start, never be substituted.
- Plugins MUST NOT do network I/O. Any external data becomes a captured,
  journaled feed (`single-feed-model-no-plugin-io` in the requirements sweep).
- **Redundant market-WS connection: measured in M8, enabled only later.** A
  second market-WS connection with first-arrival-wins could reduce the
  market-data delay `md` (13 §6.8) and its tail, which matters before
  calibration fixes the host's latency tables (51). M8 MUST measure it in
  shadow form: during the 24 h paper session a second connection with the
  same subscriptions runs on its own ingress thread, and for every frame it
  records `(connection, monoNs, eventType, exchange ts, sha256 of the raw
  bytes)` in a per-market sidecar `<slug>.mdshadow.jsonl`. The sidecar is not
  part of the replay journal and never reaches the core, so the input model
  is unchanged. The M8 report gives, per event type, the share of frames
  where the second connection was first and the p50/p90/p99 of the gain.
  Consuming the second connection (first-arrival-wins) changes the input
  model and the book-update order risk (absolute level sizes from two
  sockets can interleave out of exchange order), so it needs an update of
  15-inputs.md, a per-asset order guard and a fresh replay-identity proof
  before it is enabled.

## 8. Execution adapters

### 8.1 Paper adapter (D28)

- Paper mode MUST use the realistic simulator of 13-execution-models.md in
  `Journaled` mode (13 §8), driven by live envelopes, with the ModelConfig and
  seed from the live config (seed derived from (session seed, slug), as in
  backtests). Effective latencies include the live host's `md` distribution
  (`clock.marketData`, 12 §4.5; 13 §6.8: `L_place = md + place`); until that
  host is measured in M10, worker-2's distribution stands in and outputs are
  flagged uncalibrated.
- Own orders are not in the real book. Queue-ahead is computed from the
  displayed size, exactly as on a V4 backtest.
- Simulated delays (latency, taker delay, settlement) use timer envelopes
  (§5.3).
- Paper mode MUST NOT send heartbeats, MUST NOT open the user WS, MUST NOT
  call any authenticated trading endpoint and MUST NOT hold a private key.
  The `standard` build contains no code that can call a trading endpoint
  (D44).
- **Chainlink credentials (interim rule until Gate-4 question 1).** The
  PolyBolt Chainlink feed authenticates with the three CLOB API values
  (`src/recorder-v4/feeds/polybolt.ts:26-32,68`), which are not read-only
  scoped (`docs/datasets/recording/recorder-v4.md:136`): they also authorize
  cancels on their account. The unauthenticated RTDS stream of the TS bot
  (`src/trading/feeds/rtdsCryptoPricesClient.ts:88,142`) was replaced by
  PolyBolt on 2026-09-15 (14 §5.1); using it would be a substitution, which
  §7 forbids. Until the answer (01 §6 M8, option (a)):
  - An agent-run `paper` session loads no secret. A strategy whose requested
    feeds include Chainlink fails the start with `feed_unavailable` (detail
    `chainlink_requires_feed_credentials`); it never starts without the feed.
  - The M8 identity proof (§13.4) runs on strategies that do not request
    Chainlink (engine exerciser, feed exerciser with `chainlink: false`,
    60 §5.8). The PolyBolt decoder and the Chainlink receipt-clock visibility
    are covered by V4 replay in M7 with the same pure decoder (§5.2, 14 F-31);
    only the live PolyBolt socket client needs a session with credentials.
  - Chainlink paper sessions (lagsnipe.v15.rs for 51 P11 and Mode C, the full
    feed exerciser) are launched by the user with the feed-credential channel
    `--feed-secrets-fd <n>` (20 §7): the PolyBolt triple only,
    used only for the PolyBolt auth frame, redacted per 22 §6.7. The binary
    still has no trading-endpoint code. The agent passes the channel only if
    Gate-4 question 1 allows an empty-wallet key.
- `paper --decisions-only` (20 §7) accepts and opens every valid order and never
  fills or expires it (the TS dry-run behavior,
  `src/trading/OrderManager.ts:508-521`). Its outputs are flagged
  `decisionsOnly` and are excluded from any comparison.

### 8.2 CLOB V2 adapter (feature `real-orders`)

#### 8.2.1 Authentication

- L2 HMAC headers (`POLY_ADDRESS`, `POLY_SIGNATURE`, `POLY_TIMESTAMP`,
  `POLY_API_KEY`, `POLY_PASSPHRASE`); the signature covers
  timestamp + method + path + exact body bytes. ClobAuthDomain stays at
  version "1" (docs.polymarket.com/v2-migration).
- API key creation (L1) stays in the existing TS script (`clob:api-key`).
  The Rust runtime receives ready credentials only.

#### 8.2.2 Order signing

EIP-712 domain `Polymarket CTF Exchange`, version and `verifyingContract`
selected per market from 11 §10 V2. Only the v1, non-negRisk domain
(version 2, `0xE111180000d2663C0091e4f400237545B87B996B`; BTC 5m/15m today)
is in the tested set; the others are refused by the version guard (§6.2).

Signed struct: `salt, maker, signer, tokenId, makerAmount, takerAmount, side,
signatureType, timestamp (ms), metadata (bytes32), builder (bytes32)`. The V1
fields `taker, expiration, nonce, feeRateBps` are gone; `expiration` stays in
the POST body for GTD only (docs.polymarket.com/v2-migration).

- `makerAmount`/`takerAmount` are integers in 1e-6 units, which equal the
  engine's fixed-point base (10-domain-model.md). They MUST be computed by
  the same ExchangeRules function the simulator uses (11 §7; a FOK/FAK BUY
  is sized in pre-fee collateral, and a share-sized one is converted at its
  limit price, 10 §7.2 O2, D42).
- `salt` comes from the OS CSPRNG (never the engine RNG) and is journaled.
  `timestamp` is the egress wall time in ms. `metadata` and `builder` are
  zero unless a builder code is configured.
- GTD `expiration` (seconds) MUST come from the shared conversion of 11 §8
  GT1–GT3, checked against the exchange-time estimate (§5.3). The TS bot's
  missing 60 s (`LiveExecution.ts:189-191`) is not carried over (11 GT5).
- The adapter MUST compute the EIP-712 order hash locally before sending and
  treat it as the expected `orderID`. Until the day-0 probe verifies this
  (51 §6.1 R13), reconciliation also matches on
  `(asset, side, price, original_size, created_at window)`.
- Domain separators, type hashes and per-asset token ids MUST be
  precomputed when the session loads its rules.
- **Golden vectors.** Signatures are deterministic (RFC 6979). The test suite
  MUST compare Rust signatures, order hashes and POST bodies byte-for-byte
  with the official `@polymarket/clob-client-v2` on a generated fixture set
  (all order types, both sides, every tick table row, GTD). The generator
  follows the existing golden pattern
  (`native/crates/pmb-core/tests/fixtures/*_gen.ts`) and uses a throwaway
  key. No network is involved.

#### 8.2.3 Endpoints used

| Purpose | Endpoint |
|---|---|
| Place one / batch (caps per 11 §9) | `POST /order`, `POST /orders` |
| Cancel one / batch (id cap per 11 §9) / market / all | `DELETE /order`, `DELETE /orders`, `DELETE /cancel-market-orders`, `DELETE /cancel-all` |
| Open orders, one order | `GET /data/orders?market=`, `GET /data/order/{id}` |
| Trades | `GET /data/trades?market=&after=` |
| Heartbeat | `POST /v1/heartbeats` |
| Balances | `GET /balance-allowance?asset_type=COLLATERAL` and per conditional token |
| Account state | `GET /auth/ban-status/closed-only`, `https://polymarket.com/api/geoblock` |
| Server time | `GET /time` |

Sources: docs.polymarket.com/trading/manage-orders, /trading/place-orders,
/api-reference/rate-limits, /api-reference/geoblock.

The adapter never sends more orders per `POST /orders` or more ids per
`DELETE /orders` than 11 §9 allows (today 15 and 1,000); the OM rejects
larger intents first (`BatchTooLarge`, `CancelFailed(TooManyIds)`), exactly as
the simulator does. The mock-exchange tests (§19) include a request at each
cap and one above it.

#### 8.2.4 Mapping exchange observations to core events

The adapter normalizes REST and user-WS observations into the core's account
event stream (12-engine-core.md), using only the event variants of 10 §10.1
and the reasons of 10 §10.2. Out-of-order handling (fill before ack, WS
before REST, duplicate sources) lives in the adapter, not in the core. The
core uses engine-assigned order ids; the adapter keeps the map to exchange
ids. **Parity rule:** for the same exchange behavior, the adapter MUST emit
the same terminal event (`DoneReason`, `CancelCause`) as the realistic
simulator (13 §6.6–§6.7), so a strategy that branches on them decides the same
way live and in backtest.

| Observation | Core event |
|---|---|
| POST `success` with `orderID`, status `live` | `OrderAccepted`, `OrderOpen` |
| status `matched` | `OrderAccepted`; fills follow from trades (`tradeIDs`, user WS) |
| status `delayed` | `OrderAccepted`, `OrderDelayed` (amounts are 0; not filled) |
| status `unmatched` | `OrderAccepted`; state unknown until the user-WS order event or a REST read (never terminal by itself, 13 §6.7) |
| `success:false`, or `success:true` with non-empty `errorMsg` and no `orderID` | `OrderRejected{origin: Exchange}` with a typed reason (shared taxonomy with the simulator, 10 §10.2) |
| `success:true` with both `orderID` and `errorMsg` | `Unknown`, then reconcile |
| HTTP 425 | `OrderRejected(TradingRestricted{mode: Restarting})`; exchange state Restarting (§8.2.8) |
| HTTP 503 `post_only_mode` / cancel-only / disabled | `OrderRejected(TradingRestricted{mode: PostOnly \| CancelOnly \| Disabled})`; exchange state updated |
| timeout, connection reset after the request was written, other 5xx | `Unknown`, then reconcile (§8.2.6) |
| user-WS order `PLACEMENT` | confirms open (resolves in-flight or `Unknown`) |
| user-WS order `UPDATE` | consistency check of `size_matched`; fills come from trade events |
| order fully matched (`UPDATE` with `size_matched = original_size`, or our trades summing to it) | `OrderDone(Filled, filled = size)` after the last `Fill` |
| user-WS order `CANCELLATION` | terminal event per the cancel-cause table below, with authoritative `filled = size_matched` |
| first sight of one of our trades, any status (REST or user WS) | `Fill`s in the unit of 13 §4.5 F-U1 (one per own order, trade and price level; legs at one price aggregated, §8.2.5) with settlement status `Matched`, then any later status of that sight as below |
| `MATCHED` or `MATCHED_NOT_BROADCASTED` for a known trade | no event (`MATCHED_NOT_BROADCASTED` ranks as `Matched`, 10 §9.2; the raw status stays in the journal and sidecar) |
| `MINED`, `CONFIRMED`, `RETRYING` | `SettlementUpdate{Mined \| Confirmed \| Retrying}` (10 §9.2 ranks) |
| `FAILED` | `SettlementUpdate{Failed}`: fill reversal (10 F1; the strategy is notified) |

**Cancel causes.** The adapter records, for every cancel it sends, the
`CancelOp` and the engine cause that produced it. A `CANCELLATION` maps as
follows, first matching row wins:

| Situation of the order when `CANCELLATION` is applied | Core event |
|---|---|
| FOK or FAK order (the exchange kills the unfilled remainder) | `OrderDone(Killed, filled)` (10 §8.2) |
| a cancel of ours is pending and its REST response listed the id in `canceled` | `OrderDone(Canceled(<recorded cause>), filled)` |
| a cancel of ours is pending and its REST response has not arrived | hold the terminal event until that response or 2 s (a `Journaled` timer), then apply the row that matches |
| GTD order, no accepted cancel of ours, frame exchange time (else the exchange-time estimate, §5.3) ≥ effective expiry (stated − 60 s, 11) − 1 s | `OrderDone(Expired, filled)` (13 §6.6) |
| no cancel of ours, runtime in HeartbeatLost, or the last accepted heartbeat older than 10 s | `OrderDone(Canceled(HeartbeatLoss), filled)` |
| no cancel of ours, at or after the market's end or close | `OrderDone(Canceled(MarketClosed), filled)` |
| otherwise | `OrderDone(Canceled(Exchange), filled)` and alert `foreign_activity` (someone else cancelled our order) |

Recorded causes for cancels the runtime sends:

| Origin of the cancel | Recorded `CancelCause` (10 §10.2) |
|---|---|
| strategy `cancel_order`, `cancel_batch`, `cancel_market`, `cancel_all` | `Strategy(<op>)` |
| window end, Draining (§6.4) | `WindowEnd` |
| kill switch (§10.4) | `KillSwitch` |
| strategy panic or cascade limit (§11) | `StrategyPanic` |
| operator command, graceful stop (`SIGTERM`, launcher `stop`) | `Operator` |
| early session teardown at rotation (a market refused after a `RulesUpdate`, §6.2) | `Rotation` |

`HeartbeatLoss`, `MarketClosed` and `Exchange` are used only for cancels the
runtime did not send. Every row of both tables has a mock-exchange test
(§19, 60 LV-6).

- REST cancel responses: ids in `canceled` produce `CancelAcked`; the terminal
  `OrderDone` waits for `CANCELLATION` or a REST order read (bounded, default
  2 s) so it carries the authoritative filled size. Ids in `not_canceled`
  produce `CancelFailed(ExchangeNotCanceled(code))`; if the order is a GTD past
  its effective expiry, the later `CANCELLATION` maps to `Expired` (table
  above), as in the simulator, where an expiry that precedes the cancel's
  arrival gives `Expired` plus `CancelFailed` (13 §6.6). This keeps the TS rule
  that only confirmed ids terminate an order (`LiveExecution.ts:402-490`) and
  adds the final filled size the capital model needs.
- A cancel of an order in state delayed is sent normally. The exchange
  answer is mapped as above; the simulator returns the same class. The day-0
  probe records what the exchange actually answers (51 §6.1 R3).
- Timestamp units: `timestamp` is ms; `created_at`, `match_time`,
  `last_update`, `expiration` are seconds
  (docs.polymarket.com/trading/realtime-order-updates).

#### 8.2.5 Fill identity and attribution

- Our identity is the configured API key (the user-WS `owner`). It MUST be
  known at startup and checked against the first order event. Maker fills
  come from `maker_orders[]` entries whose `owner` equals our key; a maker
  fill is never lost because the owner was not yet learned (TS bug,
  `src/polymarket/ws/userWsAccountSource.ts:280-287`).
- Raw fill-leg ids are derived identically from user-WS and REST trades
  (this section owns them, 10 I3): maker leg `"{tradeId}:M:{ourOrderId}"`,
  taker leg `"{tradeId}:T:{makerOrderId}"`, one leg per counterparty with
  that leg's price and matched amount. Either source may arrive first
  without double counting (`research/approach-audit.json`, execution audit).
  Raw legs are used for dedupe and kept in the journal sidecar and the ledger
  side tables (22 §4.2, §6.5); the core receives aggregated `Fill`s
  (13 §4.5 F-U1, F-U3) whose fee is the sum of per-leg fees computed by
  ExchangeRules at the exchange's fee granularity (11 FC4). The units of
  `matched_amount` per side and the fee granularity are day-0 items
  (51 §6.1 R13, R14).
- Settlement progress is keyed by trade id and attached to our own order, not
  to `taker_order_id` (TS bug, `userWsAccountSource.ts:259-273`).
- FAK/FOK responses carry `tradeIDs` (since 2026-07-24). The adapter MUST
  track each of them until CONFIRMED or FAILED, from the user WS and, if a
  status is missing for 30 s, from `GET /data/trades?id=`.
- Trades and order events for order ids this process did not place MUST NOT
  change any portfolio. They are journaled and counted. In the current
  market they raise a `foreign_activity` alert, since a single owner per key
  is expected.
- The fee on each fill is computed once by ExchangeRules from the market's
  fee schedule. The WS `fee_rate_bps` is journaled but never trusted (D22;
  it was 0 on every print of a fee-charging day,
  `research/requirements-sweep.json` `fee-ground-truth`). Charged amounts are
  checked after each market (§14).

#### 8.2.6 Ambiguous outcomes

- An ambiguous placement MUST NOT be retried blindly. The order enters
  unknown; the adapter reads `GET /data/order/{expected_hash}`, then open
  orders and trades for the market, at 250 ms, 1 s, 3 s and 10 s. The first
  authoritative answer resolves it (open, filled, canceled or never
  existed). If still unresolved after 10 s, the session halts new intents
  (cancels allowed) and alerts `reconciliation_mismatch`.
- Unknown orders hold their full capital reservation until resolved.
- Cancels are idempotent on the exchange, so an ambiguous cancel MAY be
  retried with backoff (250 ms, 1 s, 3 s) and is otherwise resolved by an
  order read.

#### 8.2.7 Reconciliation reads

REST reconciliation runs (a) at startup, (b) after every user-WS reconnect or
staleness, (c) every 30 s while orders are open (cheap consistency check),
and (d) after a session is resolved. It reads open orders and trades for the
session's condition id with `after = last seen match time − 60 s`. Results
enter the core as REST-response envelopes, and the adapter emits only the
differences as normalized events. The TS poller fetched the whole history on
first use, ignored trade status and never read orders
(`src/polymarket/restPollAccountSource.ts:145-160,204`); none of that is
carried over.

#### 8.2.8 Exchange state machine

| State | Trigger | Placement | Cancels | Exit |
|---|---|---|---|---|
| Normal | default | allowed | allowed | — |
| Restarting | any 425 | rejected locally, `TradingRestricted{mode: Restarting}` | retried with backoff | first non-425 answer, then PostOnly for 120 s |
| PostOnly | 503 `post_only_mode`, or after Restarting | only `postOnly` orders; others rejected locally, `TradingRestricted{mode: PostOnly}` | allowed | `retry_after_seconds` / Retry-After elapsed |
| CancelOnly | 503 "cancel-only" | rejected locally, `TradingRestricted{mode: CancelOnly}` | allowed | probe every 10 s with a read endpoint and the next placement |
| Disabled | 503 "trading disabled" | rejected locally, `TradingRestricted{mode: Disabled}` | not accepted | alert critical; probe every 10 s |

- Backoff for 425 starts at 1 s, doubles, caps at 30 s
  (docs.polymarket.com/trading/matching-engine). Intents are never queued
  for later submission: a rejected intent goes back to the strategy as
  rejected, because a delayed resubmission would act on a stale decision.
- The exchange state is an input envelope, so the strategy and the replay
  see the same transitions. The weekly restart (Tuesday 07:00 ET, ~90 s)
  SHOULD be a known window in which the runtime starts no new session.

#### 8.2.9 Heartbeat dead-man switch (D30)

- Real mode only. The first heartbeat (`{"heartbeat_id":""}`) MUST be
  accepted before the first order is sent; then one heartbeat every 5 s with
  the latest returned id. On `400 Invalid Heartbeat ID` the adapter retries
  at once with the expected id from the error body.
- **Liveness gating.** A heartbeat MUST be sent only if the core loop
  advanced its progress counter within the last 2 s. A hung or stalled core
  therefore stops heartbeats, and the exchange cancels all orders within
  10–15 s (docs.polymarket.com/trading/manage-orders). This is the purpose of
  the switch and MUST NOT be defeated by a heartbeat thread that runs
  independently of the core.
- If no heartbeat has succeeded for 7 s, the runtime enters HeartbeatLost:
  no new orders, cancels allowed, REST reconciliation; cancellations observed
  in that state that the runtime did not send map to
  `Canceled(HeartbeatLoss)` (§8.2.4). Alert `heartbeat_failure`.
- **Calibration-only pause.** The operator command `heartbeat_pause` (§16)
  suspends heartbeats for a bounded time to observe the exchange's dead-man
  cancel (51 §6.1 R11). It is accepted only in real mode with
  `calibration.allowHeartbeatPause = true` in the live config, is journaled,
  and follows the HeartbeatLost rules above while it lasts.
- Repeated `Invalid Heartbeat ID` after a successful retry indicates a second
  owner of the key: kill switch and alert.

#### 8.2.10 Client-side rate limits

The exchange throttles (delays) instead of rejecting when limits are exceeded
(docs.polymarket.com/api-reference/rate-limits), which would show up as
silent latency. The adapter MUST keep its own token buckets well below the
documented limits (default 20 placements/s and 40 cancels/s per process) and
MUST journal every request's queueing delay. The session order-rate cap
(§10.2) is stricter still.

### 8.3 Split, merge and redeem (D25)

- The core treats split and merge as async operations: intent, then
  `positions_split` / `positions_merged` or a failure event, with a request
  id. Real mode emits a `chain_request` to the TS launcher and receives a
  `chain_response` as a journaled input envelope (20-binary-protocol.md §7).
  Paper mode and backtests use the same operation model with simulated
  latency and outcome (13-execution-models.md).
- A request without an answer within `onchain_timeout_ms` (default 120 s)
  becomes unknown and is resolved by conditional-token balance reads.
- Redeem is not a strategy intent. After a session is Resolved, the runtime
  emits a `chain_request {kind: redeem}` for its winning shares, then re-reads
  collateral when the response arrives (§10.1). The existing redeem watcher
  MAY keep running as a fallback; its `refresh_balance` reaches the runtime
  through the state WebSocket.

## 9. Startup sequence and reconciliation (D29)

The runtime MUST execute these steps in order, journal each one, and abort
with a clear error at any failure:

1. Parse the live config; take the lock (§4.1); open the journal.
2. Real mode only: verify the binary trust record (§17) and the real-order
   flag.
3. Measure clock skew (§5.3); abort if `|skew|` exceeds `max_skew_ms`
   (default 1,000 ms; `GET /time` has only second resolution, so the WS
   lower-envelope estimate decides).
4. Real mode only: geoblock and closed-only checks; collateral
   balance-allowance; abort when blocked, closed-only, or collateral below
   the configured minimum.
5. Load the persistent session-risk ledger (§10.5); refuse to start if it is
   in the `halted` state.
6. Discover the current and next market per timeframe; fetch rules (§6.2).
7. Real mode only: list open orders. Orders in the current or next market are
   cancelled with `DELETE /cancel-market-orders {"market": cond}` and the
   runtime waits until the list is empty (bounded, 10 s). Open orders in any
   other market are foreign: the start is refused unless
   `--allow-foreign-orders` is given (single owner per key).
8. Real mode only: read trades and conditional balances for the current
   market. Positions found there are adopted **read-only**: they are tracked
   for settlement, session PnL and wallet exposure, flagged `adopted`, kept
   out of the strategy's sellable inventory and out of the per-market stats
   of the new instance.
9. Start the heartbeat (real), connect sockets, pre-subscribe, start
   sessions.

## 10. Capital and session risk

### 10.1 Live available cash (D31)

`available = min(per_market_allocation − reservations of this market,
collateral_balance − Σ reservations over all open market sessions)`.

- `collateral_balance` is the CLOB COLLATERAL balance (pUSD), read at
  startup, after each `refresh_balance`, after each resolution and every
  60 s. It is a journaled REST envelope, so replay sees the same values.
- The TS virtual 500-USDC-per-market budget unrelated to the wallet
  (`src/trading/StrategyRunner.ts:53-54`) is not carried over. Backtests keep
  isolated per-market capital equal to the same allocation.
- Reservation rules (BUY reserves notional plus taker fee unless post-only;
  release only on an authoritative final quantity) are in 12-engine-core.md.
- `ctx.balance` is not part of the strategy context (no strategy reads it,
  `live-capital-source` in the requirements sweep).

### 10.2 Session guards

Session guards MUST NOT reset on market rotation (contrast
`src/trading/riskLimits.ts:28,86`, computed on a per-market portfolio that is
recreated each market).

| Guard | Default | Action when tripped |
|---|---|---|
| `max_session_loss_usdc` | required, no default | kill switch, state `halted` |
| `max_wallet_exposure_usdc` (open reservations + position cost of unresolved markets) | required | reject new opening orders |
| `max_orders_per_minute` | 120 | reject new orders for the rest of the minute; alert on 3 trips |
| `reject_burst` (≥ N rejects in 60 s) | 10 | reject the session's new placements locally (`StrategyHalted`) until rotation; cancels stay allowed and the strategy keeps receiving events; alert |
| `max_strategy_panics_per_session` | 3 | kill switch |
| `max_cascade_events` per envelope | 4,200 | as a strategy panic (§11, 12 §11): halt strategy calls, cancel the session's orders with cause `StrategyPanic`; every account event is still applied |

### 10.3 Session loss definition

Session loss = `baseline_equity − equity_now`, where equity is collateral
plus positions valued at $1 per winning share once resolved, $0 per losing
share, and the best bid for unresolved shares (no bid → $0). It is
recomputed on every fill, settlement update, resolution and balance read,
and cross-checked against REST balances every 5 min. A cross-check
difference above $0.05 raises `reconciliation_mismatch`.

### 10.4 Kill switch

Triggers: any guard above, operator command `kill`, `SIGUSR1`, the presence
of the file `<state_dir>/KILL`, the journal hard bound (§12), an ingress
stall over 2 s (LR-4), a second key owner, an engine fault (12 §11). Actions,
in order: stop strategy calls in every session; `DELETE /cancel-all` (real)
or cancel all simulated orders (paper), both with cause `KillSwitch`; keep
applying account events until
every order is terminal; write the `halted` state; alert critical. A halted
runtime needs an explicit operator reset (`--clear-halt`) to start again.

### 10.5 Persistence across restarts

The session-risk ledger (baseline equity, cumulative realized loss,
counters, halted flag, calibration phase budgets) MUST be persisted in
`<state_dir>/session.json` with an atomic write after every change and
mirrored in the journal. A restart MUST continue from it, so a crash or
restart never resets the loss budget. A new baseline needs an explicit
`--new-session`.

## 11. Strategy faults (D32)

- Every strategy callback MUST run inside `catch_unwind` (requires
  `panic = "unwind"`, D18; overflow checks make fixed-point overflow a panic).
- On a panic in session S: stop calling S's strategy; send
  `DELETE /cancel-market-orders` for S (real) or cancel S's simulated orders
  (paper), both with cause `StrategyPanic`; keep applying S's account events; alert `strategy_panic` with the
  panic message and envelope seq. The next market gets a fresh strategy
  instance. Plugins continue to observe.
- Callback duration is measured on every call. A callback slower than
  `strategy_budget_ms` (default 20 ms) raises a warning; ten in a session
  raise an alert. A callback that never returns stalls the core, which stops
  heartbeats (§8.2.9) so the exchange cancels the orders.

## 12. Journal (D26)

- The runtime MUST journal every input envelope in core consumption order,
  plus per-intent execution records (decision seq, egress queue delay, sign
  start/end, socket write time, response receive time, full sanitized
  request and response, computed order hash, salt), timer requests,
  operator commands, rules, clock samples, host load, binary sha256,
  source hash, params, profile, ModelConfig, seed and live config. Schema:
  22-trace-ledger-journal.md.
- A record's time MUST be the time of its own observation. The TS bot stamps
  `order_accepted` with the decision tick time
  (`LiveExecution.ts:249-254,377-384`); that is not allowed.
- **Secrets.** Private keys, API secrets, passphrases, HMAC signatures and
  auth frames MUST NOT reach the journal, logs, state stream or alerts. The
  user-WS subscription frame is journaled with the `auth` object replaced by
  the key id. The TS source logged raw user messages and a partial key
  (`userWsAccountSource.ts:515-535`).
- **Layout, durability, finalization and back-pressure: 22 §6.4 is
  normative** (one JSONL file per market plus `session.jsonl`; fsync at most
  every 100 ms, at market end and at every session state change; soft, hard
  and reserve bounds; finalization and verified upload by the TS launcher).
  This document adds only the runtime's reactions: the soft bound raises
  alert `journal_backpressure`, the hard bound trips the kill switch
  (§10.4), and the runtime never deletes a journal file itself. Any
  size-based splitting for upload belongs to finalization, never to the
  replay unit.
- **Logs are not the journal.** Logs follow §15.

## 13. Identical-decision replay proof

### 13.1 Replay

Journal replay runs through the backtest path: `run` with input mode
`journal` (21-job-and-output-contract.md, 15-inputs.md), optionally with a
different artifact of the same source hash (§13.3). It feeds the journaled
envelopes in order to the same core:

- paper journals use the same simulator, profile and seed, and regenerate the
  simulated fills;
- real journals use a journal execution adapter that returns the journaled
  REST responses and user-WS events instead of calling the network.

### 13.2 What must match

For every session: the sequence of `(seq, intent)` records, the sequence of
`(seq, account event)` records delivered to the strategy, timer requests,
and the final RunSingleMarketOutput MUST be identical (canonical JSON, byte
equality). Any difference is a determinism bug and blocks the live track.

### 13.3 Cross-artifact proof

The live binary is the `real-orders` variant; the fleet artifact is the
`standard` variant with the same source hash (D44, §17). Replaying a live or
paper journal with the fleet artifact MUST give identical decisions. This
proves that the feature gates only the adapter and that the strategy the
fleet backtests is the strategy that traded. Timing (60 LV-3): at G4, once
the live host is chosen, the user builds the `real-orders` variant there and
runs a short `paper` session with it (paper sends no order); the agent
replays that journal with the `standard` artifact. The first real-order
journal of M10 repeats the proof.

### 13.4 Required coverage

The journal identity proof belongs to M8 (01-scope-milestones.md,
60-verification.md DET-11, LV-1); M7 delivers only the shared reader
foundation. It needs zero differences on paper sessions totaling at least
24 h and covering 5m and 15m (more than 300 windows; 01 M8), plus drills that include at
least one market-WS reconnect, one restart, one rotation with a pending
order, one injected strategy panic, one kill switch, one GTD expiry and one
journal soft-bound stall (§12). Under the interim rule of §8.1 agent-run
sessions run on worker-1 with strategies that do not request Chainlink. M9 adds the
same proof for user-WS reconnects on journals from shadow mode and
mock-exchange tests.

### 13.5 Live-vs-backtest decision parity (diagnostic, free)

Before any real order, the same strategy runs in paper mode (worker-1 for
agent-run sessions; the calibration host once chosen) while worker-2 records
the same markets with Recorder V4. A V4 backtest of each recorded market with
the paper ModelConfig and seed is compared with the paper output: decision
agreement rate, first divergence (seq and cause: input difference, timer
lateness (13 TS2), clock), and PnL difference per market. This is reported,
not gated. It measures how much host and socket differences alone change
decisions, before execution effects enter (51-calibration-plan.md uses it as
a baseline, P11, and as context for its free-running Mode C, 51 §11.3). For
lagsnipe.v15.rs it needs Chainlink in paper (§8.1).

## 14. Per-market results and reconciliation

- Each Reported session MUST emit one `market_result` (an `EngineResult`,
  21-job-and-output-contract.md §10, 20-binary-protocol.md §7) with input
  mode `live` or `paper`, the official outcome, engine provenance, profile
  and seed, and MUST also write it to `<state_dir>/results/<session>/<slug>.json`
  so a launcher restart loses nothing. The TS launcher persists it as a run
  row (D11; mapping in 42-persistence-and-stats.md). Adopted positions are
  reported separately, never inside the stats.
- Real mode MUST reconcile each resolved market: journal fills vs
  `GET /data/trades`; fill cash deltas vs the collateral balance change;
  positions vs conditional balances; computed fees vs charged amounts.
  A difference marks the market `unreconciled` in the output, raises an
  alert, and excludes the market from calibration
  (`own-fill-attribution` in the requirements sweep).

## 15. Alerts, status and supervision (D33)

| Alert | Severity |
|---|---|
| kill switch, session-loss stop, second key owner, exchange Disabled | critical |
| heartbeat failure, reconciliation mismatch, strategy panic, unresolved unknown order | high |
| market-WS gap > `gap_alert_ms` in an Active session, feed stale, reject burst, foreign activity | high |
| process restart after a crash (real mode) | high |
| exchange Restarting / PostOnly / CancelOnly, slow callbacks, clock skew > 250 ms | info |
| daily summary (PnL, fills, rejects, latency percentiles), after G3 | info |

- Push alerts go to the phone through the configured provider (Gate-4
  question 4) over HTTPS from the telemetry thread. Delivery never blocks the
  core; failed deliveries are retried and journaled. The same alert is
  coalesced to at most one per 60 s. Alerts contain no secrets.
- The runtime writes `<state_dir>/status.json` atomically every 1 s (mode,
  sessions, PnL, exposure, open orders, exchange state, feed health, last
  alert, dropped log lines); the operator checklist of 51 §7.1 reads it.
- **After G3 (not a G4 prerequisite):** the daily summary and the D33
  SwiftBar status line (a plugin next to `ops/swiftbar/polybot.mjs`, which
  today shows fleet status only) that renders `status.json`. Push alerts and
  `status.json` cover supervision during calibration.
- **Logs.** The binary logs NDJSON to stderr (20 G1) from the telemetry
  thread only; the core and egress threads hand log events over a bounded
  queue that drops and counts on overflow (LR-4), so logging never blocks
  the hot path. The TS launcher connects the binary's stderr to
  `<state_dir>/logs/runtime.log` and rotates it by size (64 MiB, keep 20,
  closed files gzipped). The launcher's own output goes to the service's
  stderr path `<state_dir>/logs/launcher.log`, rotated by a `newsyslog`
  entry shipped with the template (logrotate on Linux). Logs never contain
  secrets (22 §6.7); the redaction scan of LV-9 covers log files too.
- A launchd template under `ops/macos/` (pattern:
  `ops/macos/recorder-v4/com.polymarket.recorder-v4.plist.template`) runs the
  launcher, which runs the runtime; a systemd unit template is the Linux
  equivalent (§4.4). In real mode it MUST NOT auto-restart after a kill
  switch (the `halted` state refuses start). After a crash it restarts at
  most 3 times per hour (default pending Gate-4 question 5; `0` disables
  restarts); every restart runs the full startup reconciliation and alerts.
- **Upgrade rule.** The binary may be replaced only when no session is Active
  and no order is open (between windows or after a drain).

## 16. TS launcher and sidecar functions

The process contract is fixed in 20-binary-protocol.md §7: a TS launcher
starts `paper` or `live`, exchanges NDJSON with it on stdin/stdout
(`chain_request`, `chain_response`, `market_result`, `alert`, `stop`,
`stopped`), and the binary serves the state/command WebSocket on 127.0.0.1
itself. The runtime never depends on the TS side to keep trading safe: if the
launcher's on-chain worker is down, chain requests fail after their timeout;
if the WebUI is closed, nothing changes.

| Function | Owner | Notes |
|---|---|---|
| Trust check before start | TS launcher | 31-artifacts-build-publish.md §10 |
| Split / merge / redeem transactions | TS launcher | answers `chain_request` with `chain_response`; the response is a journaled input envelope |
| Result ingest | TS launcher | `market_result` → MySQL rows (D11, 42-persistence-and-stats.md) |
| Journal upload | TS launcher | finalized market files (22 §6.4) → private R2 bucket (D15); bucket and token are the R2 gate-4 question (22, 01 §12.1 item 1), and journals stay local until then |
| State and commands | Rust | WebSocket on 127.0.0.1 in the existing WebUI protocol (`webui/src/types.ts:66-89`) |
| Static WebUI bundle, on-chain balance display | TS | display only; never an input to decisions |

- State snapshots (top-N books, portfolio, plugin snapshots, strategy meta,
  feed and socket health) are published at most every 250 ms from a copy the
  core hands off without waiting. They use the existing `BotUiSnapshot`
  shape (`src/cli/webui/botUiState.ts`) so the WebUI keeps working.
- **Operator commands.** Commands arrive as `command` messages on the
  state/command WebSocket, are journaled as `operator` envelopes (22 §6.3)
  and are applied through the serial loop. The TS bot ran WebUI cancels
  outside its serial funnel (`src/cli/trading-bot.ts:1210-1263`), which is a
  race. The vocabulary is closed; an unknown command is refused with a
  `command_ack` error (R14).

| Command | Modes | Effect | Core payload (12 §3.2) |
|---|---|---|---|
| `cancel_order {cid}` | paper, real | cancel one order, cause `Operator` | `Control::Operator(cancel_order)` |
| `cancel_all` | paper, real | cancel every order of every session, cause `Operator` | `Control::Operator(cancel_all)` |
| `refresh_balance` | real | runtime reads collateral; the REST response enters as an envelope (§10.1) | none (runtime action) |
| `kill` | paper, real | kill switch (§10.4) | `Control::Operator(kill_switch)` |
| `pause` | paper, real | from the next window on, new sessions run observe-only (no strategy calls); the current session continues to its end | `SessionStart` with observe-only at the next window |
| `resume` | paper, real | lifts `pause` from the next window on | `SessionStart` with strategy at the next window |
| `heartbeat_pause {seconds ≤ 30}` | real, only with `calibration.allowHeartbeatPause = true` | suspends heartbeats (§8.2.9); refused otherwise | none (adapter action; its effects arrive as exchange cancellations) |

  The vocabulary is the closed list of 20 §7, journaled as 22 §6.3
  `operator` records.
- Non-loopback binds are refused; the TS default `0.0.0.0` with an
  unauthenticated `cancel_all` (`src/cli/trading-bot.ts:1096-1099`) is not
  carried over. The redeem watcher's `refresh_balance`
  (`src/cli/redeem-watcher.ts:58-98`) keeps working against the same
  WebSocket.
- **CLOB V2 on-chain prerequisite.** The TS on-chain stack is USDC.e and
  V1-only (`src/polymarket/contractAddresses.ts:4`). Before split/merge or
  redeem runs against real funds, the launcher's on-chain code MUST be
  updated for pUSD collateral and verified for v1 markets on CLOB V2 (redeem
  collateral, approvals to the V2 exchange) for the wallet type chosen at
  gate 4 (Gate-4 question 3). Real-order mode with a strategy whose
  `describe` output declares split or merge use (20-binary-protocol.md) MUST
  refuse to start until that verification is recorded.

## 17. Real-order gate, trust and secrets

- Real-order code (signing, authenticated trading endpoints, heartbeat) is
  compiled only into the `real-orders` variant (cargo feature
  `pmb-sdk/real-orders`, D44). Fleet artifacts and every artifact the agent
  builds are the `standard` variant, which contains no path that can place or
  cancel a real order (31 §5.5); agent test builds with the feature follow
  LR-5.
- Real orders additionally require the gate of 20-binary-protocol.md §7
  (`--real-orders`, `config.realOrders = true`, clean engine at or above the
  live-safe minimum, key lock) plus a config field `confirm_funder` equal to
  the funder address. Real mode is never inferred from `DRY_RUN`, `.env` or
  `.env.$BOT_ENV`; the binary loads no dotenv file at all (m1-ivan has
  `DRY_RUN=false` in its env files and the bot file overrides the shell,
  `src/config/env.ts:16-29`).
- **Live-safe minimum (owned here).** `native/live/policy.json` holds
  `{ "liveMinEngineVersion": "<semver>" | null, "reason": "...",
  "setBy": "user", "date": "..." }`. It is committed on main (on the
  implementation branch until gate 2) and only the user raises it, by
  approving the commit that changes it. `null` (the initial value, until the
  user sets it at G4) allows paper and refuses real mode. The launcher reads
  the file, runs check 4 of 31 §10, and copies the value and the file's
  sha256 into the live config; the binary refuses real mode when its compiled
  `engineVersion` is below the value or the value is `null` (20 §7 gate 3).
  Both checks are journaled. The engine blocklist (40 §11) applies in
  addition.
- **Two variants, one source (D05, D17, D44).** The user builds the
  `real-orders` variant on the live host with `strategy:build-live` from the
  tree that `strategy:verify-rebuild` of the `standard` artifact has just
  reproduced (31 §5.5); it is never published to the fleet. The launcher MUST
  run the trust check of 31 §10, including the shared `source_hash` and
  `parent_sha256` = the standard sha. The cross-artifact replay proof
  (§13.3) shows that the strategy the fleet backtested is the strategy that
  traded.
- Secrets come only through `--secrets-fd` (20-binary-protocol.md §7):
  private key; API key, secret, passphrase; the push credential (for ntfy,
  the private topic). They are held in memory only, zeroized on drop, and
  never written anywhere (§12).
- The live config (risk limits, allocation, model parameters, timeframes,
  thresholds) is a file whose sha256 is journaled. Behavior never comes from
  environment variables.

## 18. Performance requirements

Speed is the top priority. Network round trips dominate (place 71–379 ms,
cancel 65–210 ms measured from intent to portfolio change,
`docs/other/MeasureLatency.md:68-93`), so the runtime MUST add as little as
possible on top and MUST measure every component.

### 18.1 Measurement points

Every envelope and order carries monotonic stamps at: socket read (ingress),
decode done, core dequeue, strategy start and end, intent validated, egress
dequeue, sign start and end, request bytes written, response first byte,
response parsed, core applied. A latency report computed from the journal
(`latency-report`, 16 §12.3) MUST print p50/p90/p99/max per segment and per
order type, the timer-lateness histogram of OS-fired timers (13 TS2) and the
host and its load (§4.3). 16 §12.3 owns the report format.

### 18.2 Targets (reported, not gated, D07)

| Segment | Target p99 |
|---|---|
| socket read → core dequeue (incl. decode) | ≤ 50 µs |
| core dequeue → intent validated (excluding strategy time) | ≤ 20 µs |
| intent validated → request bytes written (incl. signing) | ≤ 200 µs |
| tick-to-wire total, excluding strategy time | ≤ 300 µs |

### 18.3 Required techniques

- Pre-established TLS connections to `clob.polymarket.com` (rustls, a
  keep-alive pool of at least 2, `TCP_NODELAY`, DNS resolved at startup and
  refreshed in the background, a cheap unauthenticated GET every 20 s to
  keep connections warm). HTTP/1.1 pool versus a single HTTP/2 connection
  MUST be chosen by measurement (51-calibration-plan.md interleaves both in
  the latency probes).
- No heap allocation per envelope in steady state on the core and egress
  threads (reused buffers, borrowed decoding, preallocated order templates
  per asset and side so only amounts, salt and timestamp change).
- Signing with a fast secp256k1 implementation, benchmarked; keccak and
  domain hashes precomputed per session (§8.2.2).
- `place_batch` is sent as one `POST /orders`; separate `place_limit` intents
  of one callback are sent in parallel over the pool. The adapter never
  merges or splits the strategy's batches, so live matches the simulator's
  semantics.
- JSON decoding of market frames SHOULD be benchmarked against a SIMD
  decoder; the faster one wins only if it decodes the golden frame corpus
  identically.
- **Hosting.** Network distance to the CLOB is the largest latency term and
  is outside the code: the local path is under 0.5% of the order round trip
  (16-performance-and-parallelism.md §12.2). Two measurements are required:
  - M8: the redundant market-WS shadow measurement of §7 (how much a second
    connection would cut `md`);
  - M9: an unauthenticated network report from each candidate calibration
    and live host (m1-ivan and worker-1) and from worker-2: TCP connect, TLS
    handshake and `GET /time` round trip to `clob.polymarket.com`, WS connect
    time and the market-data delay lower envelope on
    `wss://ws-subscriptions-clob.polymarket.com`, 1,000 samples per item
    spread over 24 h, p50/p90/p99. No credentials are involved, so the agent
    MAY run it on worker-1 and worker-2. On m1-ivan, which does no engine work
    (01 §8.1 H6), the user starts the same `standard` binary built on worker-1
    (no build there) unless the user gives the agent access for this one
    report; nothing else runs there. The same report from one cloud region runs
    only if the user provides that host (Gate-4 question 2); the region MUST
    pass the geoblock check (§8.2.3) before any credential is placed there.
  The report is an input to Gate-4 question 2; calibration (51) is valid only
  for the host that produced it (51 §16).

## 19. Live track milestones

The live track is M8–M10 of 01-scope-milestones.md. This document adds the
following proof details.

| Milestone | Proof details from this document | Gate |
|---|---|---|
| M8 Live paper mode | On worker-1 (D36): §13.4 replay identity with zero diffs; zero dropped inputs; §13.5 decision-parity report; §18 latency report; redundant market-WS shadow report (§7); journal bytes per market-day (input to the live host's disk need, Gate-4 question 2); Linux build and unit tests of the runtime crates (§4.4) | — |
| M9 CLOB V2 adapter | golden vectors vs the official SDK (§8.2.2); mock-exchange tests for every row of §8.2.4 (both cancel-cause tables included) and §8.2.8, and for the batch and cancel-id caps (§8.2.3); heartbeat liveness-gating test (§8.2.9); ambiguous-POST test (§8.2.6); journal soft- and hard-bound tests (§12); shadow mode during a paper session (orders built and signed with a throwaway key, never sent) with its egress latency report; the network report of §18.3; a test that a `standard` build cannot reach a trading endpoint; `native/live/policy.json` present (§17); all adapter tests also green on the Linux targets (§4.4); a check from public docs whether `clob-staging.polymarket.com` accepts orders without funds; if it does, the G4 report proposes a user-launched staging run with a staging key before the first real order | G4 (user) |
| M10 Calibration | 51-calibration-plan.md | G3 (user) |

## 20. Interfaces this document relies on

None open: the statements this document relies on (the timer-lateness
histogram in 16 §12.3; `paper --feed-secrets-fd` from M8 in 20 §7) were
applied in the gate-1 consolidation.

## Gate-4 questions

Deferred to gate 4 by the lead (D56; collected in 01 §12.1). Nothing before
M9 depends on them; the interim rules stated in the text apply until then.

1. **Agent-run paper sessions with an empty-wallet key** (01 §12.1 item 2;
   formerly Open question 7). The live Chainlink price stream (PolyBolt)
   needs a Polymarket API key, and that key can also cancel the orders of its
   account. May the agent run Chainlink paper sessions (lagsnipe, the full
   feed exerciser) on worker-1 with the API key of a new wallet that holds no
   funds, passed through `--feed-secrets-fd`? Until then, option (a) of §8.1
   applies: agent sessions without Chainlink, Chainlink sessions launched by
   you. **Recommended: yes.** A key of an empty wallet can neither spend
   money nor cancel your real orders, and it lets the lagsnipe paper
   rehearsals (51 P11 and the Mode C context rows) run without you. It is a
   narrow exception to R10 that only you can grant; it becomes a D entry.
2. **Calibration and live host** (01 §12.1 item 3; formerly Open question 3,
   shared with 51). Calibration is valid only for the machine and network
   that produced it. Candidates: m1-ivan, today's TS live Mac, which already
   holds the trading keys and takes no native jobs (D55), but is a laptop
   that must stay at home on power and has 2.6 GB free, while the toolchain,
   the `real-orders` build and several days of journals need roughly
   10–15 GB (estimate; M8 measures the journal size); worker-1, always on
   with the toolchain and 77 GB free (D36), but its fleet worker, Global
   Runtime sessions and the goal session must all pause for the calibration
   days, and the key would sit on the host where the autonomous goal session
   works. worker-2 is excluded: it records the reference the calibration
   replays. A Linux server near Polymarket in a permitted region (§4.4) stays
   possible later, with a new calibration (51 §16). The choice also fixes
   the `md` host of paper and telonex-delta runs (12 §4.5) and feeds 31
   Gate-4 question 1 (byte reproducibility on the live host). Will you also
   provide one small cloud host for the M9 network report (§18.3)?
   **Recommended:** m1-ivan, after freeing the disk, on a wired network if
   possible, with everything except the runtime paused during the runs
   (§4.3); confirm after the M9 network report and use worker-1 only if
   m1-ivan's numbers are clearly worse. Yes to one small cloud host, for the
   network report only.
3. **Wallet type** (01 §12.1 item 4; formerly Open question 1). A plain
   wallet (EOA, `signatureType` 0) or the existing SAFE/relayer setup (2)?
   It decides `maker` vs `signer`, approvals and the launcher's on-chain path
   (§16). **Recommended:** a new dedicated EOA funded with about $100 pUSD:
   the simplest signing path, nothing else at risk, and separate from other
   bots, since a missed heartbeat cancels every order of its key (D30). SAFE
   support later if live trading needs it.
4. **Alert channel** (01 §12.1 item 5; formerly Open question 2). Telegram
   bot or ntfy (D33), and which account receives the alerts?
   **Recommended:** ntfy with a private random topic: no account, one HTTPS
   request per alert, iOS and Android apps; the topic travels as the push
   secret (§17).
5. **Auto-restart in real mode** (01 §12.1 item 6; formerly Open question 4).
   After a crash, may the runtime restart itself (§15: up to 3 times per
   hour, each with full startup reconciliation (§9) and an alert, never after
   a kill switch), or stay stopped until you restart it?
   **Recommended:** up to 3 restarts per hour, then stay stopped. The $60 stop
   carries over across restarts (§10.5).

## Open questions

None. Former Open question 5 (CLOB staging) is an M9 check (§19); former
Open question 6 (exchange facts) is the day-0 list of 51 §6.1 R13.
