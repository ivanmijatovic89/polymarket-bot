# 15 — Inputs

This document specifies the market-data inputs of the Rust engine: the
telonex-delta reader with a versioned converted-Parquet format, the Recorder
V4 reader (manifest and checksum verification, coverage gate,
`incomplete_capture`, `--allow-capture-gaps`, trade prints, own-order removal
for calibration), the live journal reader, how inputs and their integrity
travel in the job, the data-anomaly policy, and the speed rules for decoding.
Every reader turns local files into one ordered input stream for the core
(`12-engine-core.md`); the core never knows which reader produced it. External
feed semantics are in `14-feeds-and-plugins.md`.

Related: fixed point and outcome indexing in `10-domain-model.md`; clocks,
event loop and window rule in `12-engine-core.md`; rules sources in
`11-exchange-rules.md`; fill models that consume trade prints in
`13-execution-models.md`; thread and cache model in `16-performance.md`; exit
codes in `20-binary-protocol.md`; job and output fields in
`21-job-and-output-contract.md`; journal schema in `22-trace-ledger-journal.md`;
worker input resolution in `40-fleet-integration.md`; shared candidate replay
in `41-candidate-groups.md`; DB columns in `42-persistence-and-stats.md`; the
live runtime in `50-live-runtime.md`; calibration in `51-calibration-plan.md`.

## 1. Input modes in native v1

| Mode | Source | Decision clock (D27) | Window gate, ts-compat | Trade prints | Status |
|---|---|---|---|---|---|
| `telonex-delta` | converted Telonex `book_snapshot_full` per market (`src/telonex/converters/deltaTyped.ts`) | exchange ts (`ts_exchange_ms`) | inclusive `[start, end]` on exchange ts; out-of-window rows still update books and are counted (`src/backtest/runSingleMarket.ts:297-315`, `src/cli/backtest.ts:942-951`) | none | MUST (first parity target) |
| `recorder-v4` | worker-2 V4 package: `manifest.json` + `events.parquet` | ts-compat: TS V4 semantics (last applied message's exchange ts; synthetic clamp); realistic: envelope `receivedAtMs` | no strategy gate; envelopes outside the half-open `[start, end)` on `receivedAtMs` are dropped, bootstrap excepted (`src/recorder-v4/replay/dispatcher.ts:172-173`) | yes, with `transaction_hash` | MUST (calibration prerequisite, D05) |
| `journal` | Rust live/paper journal (D26) | bot receive time (wall ms; monotonic ns for intervals) | as live (`50-live-runtime.md`) | yes (market WS as seen by the bot) | MUST (M8 determinism proof) |
| `recorded`, `telonex-paired`, `--order exchange_time`, `--time-driven` | legacy | — | — | — | rejected with `invalid_input`, and before enqueue by `describe` capabilities |

The realistic window rule (strategy only inside the window, matching until
`endMs`, plugins see pre-window ticks; D23) is defined once in
`12-engine-core.md` and applies to every mode. Market universe is BTC 5m and
15m (D06); readers are symbol-agnostic and the producer restricts markets.

## 2. Common reader contract

- **I-1 Event model.** A reader yields, in input order, events of these kinds:
  `Book`, `PriceChange`, `LastTrade`, `TickSizeChange` (market events),
  `FeedObservation` (captured feeds, reduced by `14-feeds-and-plugins.md` §7),
  `BookReset {scope, reason}`, `Bootstrap {books, feeds}` (state without
  ticks), and, for journals only, the extra sources of
  `22-trace-ledger-journal.md` §6.3 (user WS, REST, timer, operator, chain,
  session, clock, lifecycle). Every event carries an input sequence
  number, the exchange timestamp when the source has one, the receive
  timestamp when the source has one, and the frame index for multi-message
  frames.
- **I-2 Fixed point and identity.** Prices and sizes are decoded from decimal
  strings straight into 1e6 fixed point (`10-domain-model.md`); asset ids are
  mapped once per file to an outcome index (0 = UP, 1 = DOWN) through the
  job's token map. Hot paths never carry token-id strings.
- **I-3 Pure and local.** Readers read only local files named in the job,
  never the network, env or wall clock. An `r2://` path, a relative path or a
  missing file is an error (§9). They create no threads; parallelism is the
  scheduler's (`16-performance.md`), and readers expose row-group-sized decode
  units so the scheduler MAY decode ahead on another thread.
- **I-4 Two consumption forms.** Every reader supports streaming (bounded
  memory, for single-market runs and live) and an immutable decoded tape
  (`Arc`, for candidate groups and multi-pass work such as the V4 coverage
  gate). Both yield identical streams (tested).
- **I-5 Book reconstruction once.** Recorded book state is candidate-independent:
  it is computed once per market read and shared read-only by all candidates
  (`41-candidate-groups.md`); per-candidate simulator state overlays it
  (`13-execution-models.md`).
- **I-6 Never repair data silently.** Anomalies are replayed as recorded and
  counted (§8); only the cases listed as errors stop the market.

### 2.1 Book reconstruction (normative; TS behavior kept)

`10-domain-model.md` excludes processing semantics, so the rules for applying
recorded market messages to the recorded book live here; `12-engine-core.md`
and `13-execution-models.md` consume the result. Evidence:
`src/market/orderbook/MarketOrderBookEngine.ts:58-161`,
`src/market/orderbook/OrderBookEngine.ts:72-118`; the WIP `market.rs` book is
the starting point (keep, `research/early-audits.md` §D).

- **I-6a `book`** replaces both sides of that outcome's book; levels with size
  `<= 0` are dropped.
- **I-6b `price_change`** sets the aggregate size at `(outcome, side, price)`;
  size `<= 0` deletes the level. Changes of one message are grouped by
  outcome and applied in message order.
- **I-6c** A `price_change`, `last_trade_price` or `tick_size_change` for an
  outcome without a book creates an empty book entry for it first (TS
  `getOrCreate`), counted as `deltaBeforeBook`.
- **I-6d Snapshot time (ts-compat).** Every applied message with a finite
  timestamp sets the market snapshot time to that message's exchange
  timestamp, including `last_trade_price` and `tick_size_change`; it can move
  backwards across outcomes. The realistic decision clock is defined in
  `12-engine-core.md` (D27).
- **I-6e** The snapshot lists only outcomes seen so far. Books are keyed by
  fixed-point price in ordered maps or a dense ladder (`10-domain-model.md`
  P6), never by float. The strategy-visible depth is not truncated by any
  environment variable (TS caps it with `WEB_UI_ORDERBOOK_LEVELS`,
  `src/market/orderbook/utils.ts:3-12`).

## 3. Input resolution and integrity

- **I-7 TS resolves, Rust verifies.** The TS worker turns every input into a
  verified local file before dispatch: R2 download for
  `local-or-download-from-r2-to-local` (`runSingleMarket.ts:407-415`), a
  worker download instead of today's direct R2 reads for `--read-from r2`
  (`:386-390`; caching policy is Open question 3), and the V4 `manifestUrl`
  download with canonical manifest equality (`:392-401`). The `[read-from]`
  LOCAL-hit / R2-download log stays in TS. The binary receives absolute local
  paths only.
- **I-8 Integrity fields.** Each input file in the job carries `path`, `bytes`,
  `sha256` (or null when unknown) and `format {name, version}`
  (`21-job-and-output-contract.md` §5). The TS shim verifies before spawn
  (21 §9) and the binary verifies again before replay: `bytes` always,
  `sha256` when present (`data_defect` on mismatch). V4 events and
  journals always have a sha256 (manifest, journal header); converted
  telonex files get one once the `sha256` column exists (§4.1).
- **I-9 Verification is memoized.** A file is hashed at most once per process,
  keyed by `(device, inode, bytes, mtime)`; candidate groups and repeated
  jobs on the same file reuse the result. Hashing is never repeated per
  candidate.
- **I-10 Feed day files** are resolved by the TS shim under the machine's
  data roots and passed as `market.feedFiles` (21 §5, §9); the binary never
  derives paths from cwd or env (`14-feeds-and-plugins.md` §4.1).

## 4. telonex-delta reader

### 4.1 Format identity and versioning

The converter writes one Parquet per market with the parquetjs schema in
`src/parquet/io/eventSchema.ts:53-70`: 16 columns, GZIP, no footer key-value
metadata. `telonex_market_conversions` stores only a `converter` name, no
format version and no sha256 (`src/db/schema.ts:504-525`), and the WIP reader
hardcodes the column layout (`native/crates/pmb-replay/src/telonex.rs:73-90`),
so a converter change on main would silently mis-read native replays.

- **I-11 Version 1** is the current converter output, defined by schema **and**
  semantics: the 16 column names, order, physical/logical types and
  repetition of `eventSchema.ts:53-70`; a full `book` row every 500 snapshots
  per asset (`deltaTyped.ts:18`); empty deltas dropped; up/down deltas of one
  exchange timestamp combined into one `price_change` row whose `ts_local_ms`
  is the larger local time of the pair (`deltaTyped.ts:192-243`); rows in
  `(exchange ts, local ts, asset, side)` order (`src/telonex/converters/parsing.ts:125-132`).
- **I-12 Identification.** A file is version N when its footer has
  `pmb_format=telonex-delta-typed` and `pmb_format_version=N`. A file without
  these keys is version 1 only if its schema matches the version-1 fingerprint
  exactly; anything else is `data_defect`.
- **I-13 Job and reader agreement.** The job carries `format: {name:
  "telonex-delta-typed", version}`; the reader MUST refuse an unknown version
  or a job/file mismatch with `data_defect` (`20-binary-protocol.md` §4).
- **I-14 Converter rule (TS, after gate 2).** Any change to the converter's
  columns, cadence (`DEFAULT_BOOK_INTERVAL`), combining rule or clock rule MUST
  bump the version, write the footer keys (plus `book_interval`), add a
  version-fingerprint test, and ship with a reader update. The DB gets
  `telonex_market_conversions.format_version` and `sha256` columns
  (`42-persistence-and-stats.md`), filled at conversion time; the producer
  copies them into the job. Until that lands (main is untouched before gate 2,
  D03), the producer sends format version 1 for `converter = 'delta-typed'`
  and `sha256: null`, and the reader relies on I-12.

### 4.2 Row decoding (normative; matches TS and the WIP)

- **I-15** Replay order is file row order. `ingest_seq` is informational; a
  non-increasing value is counted, not an error.
- **I-16** A row yields no event, no tick and no count when: `market` is blank;
  `ts_exchange_ms` is null or negative; `event_type` is neither `book` nor
  `price_change`; a `book` row's `asset_index` does not resolve; a
  `price_change` row has no resolvable change after dropping changes with a
  side code other than 0 (BUY) or 1 (SELL) or an unresolvable asset index
  (`src/parquet/replay/replayTelonexDeltaParquetForMarket.ts:92-149`; WIP
  `telonex.rs:243-311`).
- **I-17** `asset_index` and `change_asset_indexes` refer to the row's own
  `asset0_id` / `asset1_id` columns (first-appearance order in the file), not to
  outcome order. A blank asset column does not resolve.
- **I-18** Every file asset id MUST be one of the job's two token ids, the
  `market` column MUST be constant within the file (the WIP enforces this at
  `telonex.rs:291-300`), and it MUST equal `market.conditionId` when the job
  carries one; any violation is `data_defect` (the job points at the wrong
  file). Today's telonex job carries no condition id
  (`src/cli/backtest.ts:174-207`); the native job adds it from
  `telonex_markets.market_id` (21 §5; also needed to key the rules snapshot,
  D21). TS would replay a foreign asset silently; that
  difference is classified "TS bug".
- **I-19** Every kept row is exactly one real tick, even when no level changes
  (`replayTelonexDeltaParquetForMarket.ts:181-188`), applied with §2.1.
- **I-20** Decimal strings parse to fixed point with the shared exact parser
  of `10-domain-model.md` T6: the full JSON number grammar including
  exponents, never through `f64`; more than 6 fractional digits round
  `HalfAwayFromZero` and are counted as `inexact_decimal` (§8). Unparsable
  values, and values outside the fixed-point range, are `data_defect`. The
  WIP plain-decimal parser and its `f64` fallback for exponents and
  whitespace (`telonex.rs:326-380`) are replaced by the T6 parser.
- **I-21** `ts_local_ms <= 0` means no local time. The feed clock rule is in
  `14-feeds-and-plugins.md` §3.

### 4.3 Properties the engine must not assume

- Tick cadence is the dataset's, not live WS cadence: combined up/down deltas,
  periodic full books, no trade prints (`deltaTyped.ts:1-8`). Only V4 and
  journals match live cadence; parity with live is therefore judged on V4.
- Files carry about 24 h of pre-window rows. Sample
  `btc-updown-15m-1785028500.parquet`: 93,427 rows, of which 3,700 before the
  window, 89,492 inside, 235 after; 376 `book` rows; 23 row groups (about
  4,096 rows each); 1.2 MB (measured 2026-10-09). Pre-window rows MUST be
  applied (book state depends on them) and counted (TS counts them).
- Exchange timestamps were non-decreasing and local timestamps stepped back
  twice in that sample; §8 covers both.

### 4.4 Optional format version 2 (performance)

The prototype profile spent 50.6% of one market in Parquet row reconstruction
and 16.1% in decoding/validation (`research/early-audits.md` §C). A version 2
MAY store prices and sizes as INT64 fixed point, use ZSTD and row groups of
about 64 k rows, carry the footer keys, and reserve optional trade-print
columns for the Telonex trades follow-up. It MUST NOT be adopted without a
measured gain on 1,000 markets and the user's approval (Open question 1). Arrow
storage stays rejected (1.34x faster, 25x larger; early-audits §C).

## 5. Recorder V4 reader

### 5.1 Inputs and verification

The worker supplies a local package directory (`<cache>/<slug>/<recording-id>/`
with `manifest.json` and `events.parquet`) and the job carries the manifest
JSON and `allowGaps` (today `recorderV4: {manifest, allowGaps?}`,
`src/backtest/jobTypes.ts:42`). The binary MUST verify, failing with the class
shown:

| Check | Class | Evidence |
|---|---|---|
| Manifest parses and satisfies the schema: `schemaVersion 4`, `archiveLayout symbol-timeframe`, id patterns, slug equals `<symbol>-updown-<tf>-<startSec>`, `endMs = startMs + 300 000 / 900 000`, events key suffix | `data_defect` | `src/recorder-v4/storage/manifest.ts:28-117` |
| Job manifest slug equals the job slug; job token map equals the manifest `tokenIds` by outcome | `invalid_input` | `runSingleMarket.ts:425-426`; `src/recorder-v4/replay/provenance.ts:62-67` |
| The package's `manifest.json` canonically equals the job manifest | `data_defect` | `runSingleMarket.ts:397-399` |
| Events file `bytes` and `sha256` equal `manifest.events` | `data_defect` | `runSingleMarket.ts:427-429` |
| Footer `recorder_schema_version=4`, `recorder_format=recorder-v4-compact-1`; exact compact schema (column count, names, types, list structure) | `data_defect` | `src/recorder-v4/storage/parquet.ts:21-67` |
| Row groups of at most 16,384 rows; complete column groups; total rows equal footer rows | `data_defect` | `parquet.ts:126-184` |
| Per row: `schema_version 4`, known source, compact kind consistent with source, decimal sequence, strictly increasing sequence | `data_defect` | `parquet.ts:70-124,170-178` |
| Rows read equal `manifest.events.rows`; first and last sequence equal the manifest | `data_defect` | Rust addition (TS checks this only in `record:v4:verify`) |

`eventId` is reconstructed as `captureId:sequence`; raw fallback JSON is parsed
only for rows without a typed kind (Chainlink, price-to-beat, bootstrap,
control, metadata, `tick_size_change`, unfamiliar shapes;
`docs/datasets/recording/recorder-v4.md:226-232`).

### 5.2 Receipt-order dispatch (port of `CapturedMarketDispatcher`)

- **I-22** Envelopes are processed in sequence order; one `captureId` per file
  (`dispatcher.ts:103-112`).
- **I-23 Bootstrap.** A `bootstrap` envelope MUST be `initial_state` whose
  market identity fields equal the manifest market, at most once per session,
  with no feed or book state from the future; it resets books and feed state,
  restores feeds and books without ticks, and seeds the opening-reference
  tracker (`dispatcher.ts:124-170`). Violations are `data_defect`.
- **I-24 Window.** Non-bootstrap envelopes with `receivedAtMs < start` or
  `>= end` are ignored (half-open; boundary events belong to the next market).
- **I-25 Control.** A Polymarket control status of kind `disconnected`, `gap`,
  `stale`, `provider_mismatch` or `error` whose scope includes this market
  resets the books (`BookReset`); other control records are ignored
  (`dispatcher.ts:179-189`).
- **I-26 Market frames.** Text `PING`/`PONG` and transport ping/pong are
  ignored; `best_bid_ask`, `new_market` and `market_resolved` are ignored;
  `book`, `price_change`, `tick_size_change` and `last_trade_price` messages
  for this condition id are validated (numeric price in `[0, 1]`, size `>= 0`,
  BUY/SELL sides, safe-integer timestamp, asset in the market's token ids). A
  malformed member invalidates the whole frame for this market: books reset
  (`BookReset`), or `data_defect` inside a bootstrap
  (`src/recorder-v4/marketFrame.ts:12-108`, `dispatcher.ts:221-234`).
- **I-27 Ticks.** Messages of a frame apply in order; each `book` and
  `price_change` child is one real tick with its frame index. `last_trade_price`
  and `tick_size_change` update state and are emitted as `LastTrade` /
  `TickSizeChange` events; in ts-compat they never create strategy ticks and
  are not counted (`src/market/MarketEngine.ts:132-155`). Their delivery and
  counting in realistic are defined in `12-engine-core.md` and
  `21-job-and-output-contract.md`.
- **I-28 Feeds.** Feed envelopes go through the captured-feed reducer and may
  produce synthetic ticks (`14-feeds-and-plugins.md` §7-§8).

### 5.3 Coverage gate, `incomplete_capture` and `--allow-capture-gaps`

- **I-29** Before any tick, the reader validates the strategy's feed request
  against the market (`validateCapturedFeedRequest`; violation = `invalid_input`,
  as TS throws at `runSingleMarket.ts:432`) and computes coverage reasons with
  the rules of `captureEligibilityReasons` and `capturedMarketGapReasons`
  (`src/recorder-v4/replay/eligibility.ts:51-84`, `dispatcher.ts:22-41`):
  `not_finalized`, `empty_capture`, required-feed gaps overlapping the market
  (feeds derived from the request by `requestedCapturedFeeds`,
  `src/recorder-v4/replay/feedState.ts:262-275`), `polymarket: missing initial
  book`, `recording coverage is incomplete`, and price-to-beat evidence from
  the opening-reference inspection over reference rows only
  (`eligibility.ts:87-100`). Reason strings MUST equal TS (golden-tested); they
  reach failure rows and dashboards.
- **I-30** With `allowGaps = false` and any reason, the output is exactly
  `{marketStats: null, eventsProcessed: 0, eventsByType: {}, skipReason:
  "incomplete_capture", coverageReasons}` (`runSingleMarket.ts:437-447`); no
  tick is replayed.
- **I-31** With `allowGaps = true`, gap and price-to-beat-evidence reasons are
  skipped; `not_finalized` and `empty_capture` still apply. Replay then
  includes the recorded resets and skips invalid mutations; nothing is
  invented (`recorder-v4.md:304-314`).
- **I-32** The gate runs on the decoded tape, then the same tape is replayed:
  one file read per market, never a second decode for the gate.
- **I-33** The official outcome comes from the job's `marketResolution`, is
  used only for settlement and is never injected into ticks. Missing
  resolution keeps the existing `no_resolution` / `unresolved_outcome` skips
  (`runSingleMarket.ts:494-516`).
- **I-34** `recorderV4Capture` provenance is built and attached by the TS
  worker, not the binary (it needs the input URL and resolution;
  `provenance.ts:74-90`).

### 5.4 Trade prints and tick size

- **I-35** `last_trade_price` rows decode to `LastTrade {asset, price, size,
  side (taker side as recorded), fee_rate_bps, exchange ts, receive ts,
  transaction_hash}` from the typed columns
  (`src/recorder-v4/storage/compactShapes.ts:80-90,154-164`). Prints are never
  dropped; `transaction_hash` is kept because it is the 1:1 join key to own
  fills (1,123 prints and 1,123 distinct hashes in one 15m market,
  requirements-sweep `journal-v4-join`). Fill models consume prints in
  realistic (`13-execution-models.md`); `fee_rate_bps` is recorded but not a
  fee source (D22).
- **I-36** `tick_size_change` decodes to `TickSizeChange {asset, new tick,
  exchange ts, receive ts}`; the rule in force is applied by
  `11-exchange-rules.md`.
- **I-37** `manifest.market.rawJson` (the Gamma discovery response frozen at
  market start) is exposed to `11-exchange-rules.md` as a rules source.

### 5.5 Book integrity diagnostic

- **I-38** V4 `price_change` rows keep each change's `best_bid` / `best_ask`
  (`compactShapes.ts:100-110`). After applying a change, the reader SHOULD
  compare the reconstructed best bid and ask of that asset with them and count
  mismatches (`bookIntegrityMismatches`); it never alters replay. A mismatch
  signals a missed message upstream or a reconstruction bug.

### 5.6 Fidelity

ts-compat on V4 MUST reproduce TS V4 replay (tick stream, bound feed
snapshots, counts): `01-scope-milestones.md` M7 requires it on at least 50
worker-2 packages, after gate 2. Whether a small V4 subset is pulled forward
into gate 2 is Open question 2.

## 6. Own-order removal for calibration

Recordings of markets we traded contain our own resting orders and fills; a
simulator replaying them would count our own flow as market flow and fill the
simulated order twice (D24; requirements-sweep `own-order-decontamination`).
Calibration jobs therefore carry an own-activity ledger and the reader applies a
deterministic decontamination transform before the engine sees the events.
`51-calibration-plan.md` §10 describes the step at procedure level and
measures its precision and recall on the latency probes; this section is the
normative reader-level definition, and the two MUST agree.

- **I-39 Activation.** The job field `ownActivity` (null by default) names the
  ledger file (derived from the live journal's execution sidecar, I-54,
  `22-trace-ledger-journal.md` §6.5) with bytes and sha256, plus the clock mapping
  from the bot host to the recording host (offset and its uncertainty,
  estimated per market by `51-calibration-plan.md`). Research universes
  exclude own-activity markets in the producer (D24); the binary does not
  look up own activity itself.
- **I-40 Ledger content used.** Per own order: client id, exchange order id,
  outcome, side, price, original size, order type, send time (bot wall and
  monotonic), REST ack time, exchange creation time when known, status
  transitions with matched sizes, terminal time and reason. Per own trade:
  trade id, `transaction_hash`, role (maker/taker), price, matched size, match
  time, and per-maker-level price, matched amount and fee rate.
- **I-41 Prints.** For each recorded print whose `transaction_hash` matches an
  own trade, subtract our matched amount at that price from the print size.
  The print is kept (it may contain other makers' fills) and marked
  `own_size`; a print reduced to zero stays in the stream marked own-only and
  is excluded from market flow by the fill models. An own trade with no
  matching print makes the market `unmatched_own_print` and excludes it from
  calibration (requirements-sweep `journal-v4-join`).
- **I-42 Resting orders.** For each own order that rested, find the insertion:
  the first `price_change` (or `book`) for the same outcome, side and price whose
  aggregate size increases by at least our size, received within `[send +
  offset - u, send + offset + maxPlacementMs + u]` on the recording clock
  (`u` = offset uncertainty; `maxPlacementMs` from the calibration
  parameters). From insertion until removal (the matching decrease at our
  cancel, or our fill prints, or the mapped terminal time when neither is
  identifiable), subtract our remaining open size from that level in every
  recorded book state, floored at zero.
- **I-43 Ambiguity.** Zero or several candidate insertions, or a subtraction
  that would go below zero by more than the market's size precision (0.01
  shares on a 0.01-tick market, `11-exchange-rules.md`), marks
  the order episode `ambiguous`; the calibration harness excludes ambiguous
  orders from per-order metrics and reports their count. Floor-at-zero clamps
  are counted.
- **I-44 Report.** The transform emits a deterministic report: own prints
  matched/unmatched, orders matched/ambiguous/unmatched, clamp count and total
  clamped quantity. With an empty ledger the transform is the identity
  (neutrality test, §10).
- **I-45 Telonex variant.** For the readout on telonex-delta after the
  publication lag (requirements-sweep `pinned-execution-harness`), alignment
  uses exchange time directly (exchange creation and match times from the
  ledger against `ts_exchange_ms`); there is no print step because telonex has
  no prints; fills are removed at their match time. SHOULD be supported.
- **I-46 Journal variant.** A journal's own market frames contain our orders
  too; when its market data is replayed through the simulator, the same
  transform applies with offset zero (same host clock).

## 7. Live journal reader

`22-trace-ledger-journal.md` §6 owns the journal format: Recorder V4
`CapturedEvent` envelopes (D26) with the extra sources `polymarket_user`,
`rest`, `timer`, `operator`, `chain`, `session`, `clock`, `lifecycle` and
`engine`, written as one JSONL file per market (plus `session.jsonl`), gzipped
at finalization, with a manifest carrying `journalFormat: "pmb-live-journal/1"`.
This section is the reader contract.

- **I-47 Identity and integrity.** The job names the market journal file with
  `format {name: "pmb-live-journal", version: 1}`, `bytes` and the manifest
  `sha256` (required). The reader refuses an unknown `journalFormat` or
  version (`data_defect`). It shares the market-frame validator (I-26) and
  the captured-feed reducer (`14-feeds-and-plugins.md` §7) with the V4
  reader; only the envelope decoding differs (JSON lines instead of compact
  Parquet).
- **I-48 Header.** The first record MUST be the `lifecycle` `market_header`
  (binary sha256, engine version and commit, strategy id, normalized params,
  `ModelConfig` and its sha, seed, rules snapshot, instance and session ids,
  mode). A missing header is `data_defect`; job params, `ModelConfig` or seed
  that differ from the header are `invalid_input` (22 §6.6).
- **I-49 Replay unit is one market file.** A market file contains every
  envelope routed to that market plus the duplicated shared observations,
  including `session` envelopes that carry cross-market state (available-cash
  grants, session guard state, kill switch; D31). One market file therefore
  replays that market alone; a whole session is replayed market by market.
  Envelopes are consumed in sequence order; gaps in the sequence are allowed
  (shared sequence across markets), a non-increasing sequence is
  `data_defect`.
- **I-50 Determinism replay (M8).** `engine` decision records are never
  inputs; they are the expected output. Paper journals: replay is a backtest
  over the journaled inputs with the header seed and MUST yield identical
  decisions and fills, compared record by record. Live journals: `rest`,
  `polymarket_user` and `chain` responses are injected by a journal execution
  adapter keyed by `requestSeq` and client order id, and the replay MUST
  produce the same order requests as the journaled `request` records. The
  first difference fails the replay with a structured diff (22 §6.6).
- **I-51 Engine identity.** A journal whose binary sha256 differs from the
  replaying binary is refused unless the job sets `allowEngineMismatch: true`,
  which turns the run into a what-if replay that is reported as such and
  cannot serve as a determinism proof.
- **I-52 Live outputs reproduce.** The per-market outputs that the live runtime
  writes as `input_mode = 'live' | 'paper'` rows (D11) MUST equal the outputs
  of the determinism replay of the same market file.
- **I-53 Partial files.** The last incomplete line of a crashed session's file
  is ignored and reported (same rule as V4 journal recovery,
  `recorder-v4.md:248`); any other malformed record is `data_defect`.
- **I-54 Sidecar regeneration.** The execution sidecar is a derived index
  (22 §6.5); the reader MUST be able to regenerate it from the journal, and
  the own-activity ledger of §6 is built from the regenerated sidecar, never
  from a sidecar that disagrees with the journal.

## 8. Data-anomaly policy

Anomalies never change replay; each is counted in diagnostics
(`21-job-and-output-contract.md` decides where they appear).

| Anomaly | Mode | Behavior (both profiles) | Counter |
|---|---|---|---|
| Local time behind exchange time | telonex | feed clock clamps to exchange (`14` §3) | `localBehindExchange` |
| Local time steps backwards | telonex | feed high-water clamp | `localClockBackwards` |
| Exchange time steps backwards | telonex | replay in file order; engine clock rule in `12-engine-core.md` | `exchangeClockBackwards` |
| Change before the asset's first book | telonex, V4 | creates the book (TS) | `deltaBeforeBook` |
| Crossed or locked book after an update | all | replay unchanged; simulator rules in `13` | `crossedBookTicks` |
| Row skipped by I-16 | telonex | no event | `skippedRows` by reason |
| Non-increasing `ingest_seq` | telonex | replay in file order | `ingestSeqBackwards` |
| Identical consecutive rows | all | replayed as-is | `duplicateRows` |
| Decimal with more than 6 fractional digits | all | rounded `HalfAwayFromZero` (I-20, 10 T6) | `inexact_decimal` |
| Invalid market frame | V4, journal | books reset (I-26) | `invalidFrames` |
| Control gap/disconnect | V4, journal | books reset (I-25) | `bookResets` |
| Best bid/ask disagreement | V4 | none (I-38) | `bookIntegrityMismatches` |
| Ignored message types | V4, journal | ignored | `ignoredMessages` by type |

Errors (not anomalies): integrity and schema failures, non-increasing V4
sequence, mixed capture ids, invalid bootstrap, job/file identity mismatches.

## 9. Job input fields and error classes

`21-job-and-output-contract.md` §5 is normative for the `EngineJob` shape. The
input-related fields, with the two that this doc adds (`journal`,
`ownActivity`):

```jsonc
{
  "run":    { "inputMode": "telonex-delta" },          // | "recorder-v4" | "journal"
  "market": {
    "conditionId": "0x...",
    "input": { "path": "/abs/local/path.parquet", "bytes": 1209921, "sha256": null,
               "format": { "name": "telonex-delta-typed", "version": 1 } },
               // recorder-v4: { "name": "recorder-v4-compact", "version": 1 }, sha256 required
               // journal:     { "name": "pmb-live-journal", "version": 1 }, sha256 required
    "recorderV4": { "manifest": { }, "allowGaps": false },        // recorder-v4 only
    "journal": { "replay": "determinism", "allowEngineMismatch": false },  // journal only (I-50, I-51)
    "ownActivity": null,                                          // calibration only (I-39)
    "feedFiles": [ { "feed": "binance_agg_trades", "symbol": "BTCUSDT", "day": "2026-06-01",
                     "path": "/abs/...", "bytes": 98765 } ]
  }
}
```

Input error classes use the vocabulary of `20-binary-protocol.md` §4:

| Condition | Class |
|---|---|
| Unsupported input mode or legacy flag; `r2://` or relative path; job-internal inconsistency (job slug vs job manifest, token map vs manifest); unsupported V4 feed request | `invalid_input` |
| Input file absent on this machine | `data_missing` |
| Bytes or sha256 mismatch; unknown format version; file does not match the job (foreign asset, condition id, package manifest); schema or footer mismatch; corrupt rows; V4 sequence or bootstrap violations; malformed journal records | `data_defect` |
| V4 coverage reasons | not an error: `incomplete_capture` skip (I-30) |

## 10. Verification

- **I-V1 telonex goldens.** A TS script dumps the raw events that
  `replayTelonexDeltaParquetForMarket` hands to `onSnapshot` (kind, asset,
  levels, exchange and local time) for fixture files, including crafted rows
  for every I-16 skip case; the Rust stream MUST match exactly. The version-1
  fingerprint test runs against the TS schema definition.
- **I-V2 V4 goldens.** For fixture packages (normal, gaps, invalid frames,
  control resets, restarts with a second bootstrap, multi-market frames),
  the Rust tick stream with bound feed snapshots MUST equal TS
  `replayCapturedEvents`, and coverage reasons MUST equal TS
  `inspectCaptureEligibility` on a manifest corpus.
- **I-V3 Integrity.** Flipped bytes, wrong sizes, foreign manifests and
  truncated files each yield the documented class.
- **I-V4 Decontamination.** Injecting a synthetic own order and its prints into
  a recording and then removing it MUST give back the original stream exactly;
  an empty ledger is the identity; shifting the clock offset beyond the
  window makes orders `ambiguous` or unmatched, never silently mismatched.
- **I-V5 Journal.** The M8 proof (I-50) on recorded paper sessions;
  regenerating the sidecar from the journal reproduces the written sidecar
  (I-54); fuzzed journals (reordered, duplicated, truncated records) fail
  with precise errors.
- **I-V6 Forms.** Streaming and tape consumption produce identical streams and
  outputs; anomaly fixtures produce the expected counters and unchanged
  results.

## 11. Performance requirements

Speed is the top priority (project direction item 7); measured, not
thresholded (D07). Overall model: `16-performance.md`.

- **IP-1 Column-wise decode without per-row allocation**, reusing buffers
  across row groups (WIP `native/crates/pmb-replay/src/pq.rs:36-121`); event
  views borrow decoded column buffers; levels are parsed straight into fixed
  point and applied to the book without intermediate per-row vectors where
  the engine allows it.
- **IP-2 Decode once per market read**, shared by candidates and by the V4
  gate (I-5, I-32). A 15m telonex market decodes to a tape of about 93 k
  events; it MUST NOT be decoded once per candidate.
- **IP-3 Decompression.** Version-1 files are GZIP with ~4 k-row groups; the
  GZIP backend is chosen by measurement (`16-performance.md`), and version 2
  (§4.4) is the structural fix if decoding dominates.
- **IP-4 No skipping of pre-window rows** in v1: they are about 4% of rows in
  the sample and both book state and counts depend on them.
- **IP-5 V4.** Typed rows decode without JSON; JSON parsing only for
  raw-fallback rows.
- **IP-6 Hashing** is memoized per process (I-9).
- **IP-7 Measurements** per market: rows and bytes read, decompress time,
  decode time, book-apply time, gate time, decontamination time.

## Open questions

1. **telonex-delta format version 2.** Adopting INT64 fixed point, ZSTD and
   larger row groups (with reserved trade-print columns) means re-converting
   about 31,186 BTC 15m files (52 GB locally, measured 2026-10-09) plus the R2
   copies. Proposal: measure decode share on 1,000 markets after the version-1
   reader is optimized, then decide. Do you want this considered at all, or
   should version 1 stay the only format?
2. **V4 in gate 2.** Gate 2 is defined on 200+ telonex-delta markets; V4
   parity against TS (at least 50 packages) comes later, in M7. Should gate 2
   also require ts-compat parity against TS V4 replay on a small V4 set (for
   example 20 worker-2 markets), given that V4 is the calibration input and
   its dispatch rules (bootstrap, resets, frame children) are subtle?
3. **`--read-from r2` on native workers.** The binary reads only local files.
   `21-job-and-output-contract.md` §9 keeps the "no local copy" meaning: the
   shim downloads to the job temp dir and deletes the file afterwards. That
   re-downloads the same market for every repeated run. Should native workers
   be allowed a bounded LRU cache for `r2` inputs instead (same canonical
   paths as `local-or-download-from-r2-to-local`)?
