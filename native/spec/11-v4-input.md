# 11 — Recorder V4 input (first input mode)

Scope: first Rust input = Recorder V4 package (BTC 5m/15m, one mixed-feed Parquet per market).
"Doc" = `docs/datasets/recording/recorder-v4.md`; "old spec" = `native/spec/15-inputs.md` / `14-…`;
other paths are under `src/recorder-v4/` unless rooted. Silence of a source is stated.

## 1. Package layout and identity

**R2** (doc:197-222; `storage/manifest.ts:103-117`; `storage/archive.ts:170-171`):
`recorder-v4/btc/<5m|15m>/btc-updown-<tf>-<openSec>/<recordingId>/` containing
`events-<sha256(parquet)>.parquet`, `manifest-<sha256(manifest.json bytes)>.json`, and
`resolutions/<observedAtMs>-<sha256>.json`. A package without a published manifest does not
exist. Child namespaces (`recorder-v4/validation/<run>`) are opt-in (doc:238).

**Local cache** (`storage/archive.ts:336-395`): `<cache>/<slug>/<recordingId>/{events.parquet,
manifest.json, resolutions.json}` (+ optional spool `resolution-outbox/`, `replay/package.ts:181`).
Default `data/recorder-v4-cache` via `RECORDER_REPLAY_CACHE_DIR` (`replay/cacheDirectory.ts`; doc silent).
Real `btc-updown-15m-1791457200/f61f1fd0-…/`: events 6,514,466 B (413,787 rows, 50 groups), manifest 6,281 B, resolutions 6,561 B.

**Manifest** (`storage/manifest.ts:7-117`, zod-validated):
- `schemaVersion: 4`, `archiveLayout: "symbol-timeframe"`, `recordingId` (`[A-Za-z0-9][A-Za-z0-9._-]{0,199}`)
- `market`: `slug, symbol ("btc"), timeframe ("5m"|"15m"), conditionId, tokenIds[2], outcomes[2]`
  (`["Up","Down"]` in sample), `startMs, endMs, twapEnabled, twapLookbackSeconds|null,
  resolutionSource|null, rawJson` (full Gamma discovery response; `types.ts:86-100`).
  Refinement: `startMs % 1000 == 0`, `slug == btc-updown-<tf>-<startMs/1000>`,
  `endMs = startMs + 300000|900000`.
- `coverage`: `complete, startedAtMs, endedAtMs, missingInitialBook, warnings[], gaps[]` with
  gap `{feed ∈ polymarket|binance_agg_trade|binance_book_ticker|chainlink_spot|chainlink_twap|
  price_to_beat, startMs, endMs|null, reason, certainty: confirmed|uncertain}`.
- `createdAtMs, finalizedAtMs`; `events: {key, sha256, bytes, rows, firstSequence|null,
  lastSequence|null}` (decimal strings); `key` ends `/<sym>/<tf>/<slug>/<recId>/events-<sha>.parquet`.

**Integrity**: R2 manifest bytes must hash to the key's `<sha256>` and the manifest must sit in
the same directory as `events.key` (`replay/package.ts:159-164`); downloaded Parquet must match
`events.bytes` and `events.sha256` (`storage/archive.ts:377`); the worker re-hashes before replay
(`src/backtest/runSingleMarket.ts:427-429`) and, for R2 jobs, requires the downloaded manifest to
canonically equal the job manifest (`src/backtest/runSingleMarket.ts:397-399`).

**Resolution sidecar** (`types.ts:119-133`; doc:250-254): `{schemaVersion 4, slug, conditionId,
observedAtMs, status: pending|proposed|disputed|resolved|unknown, winningOutcome|null,
winningTokenId|null, payouts{tokenId: "0"|"1"}|null, priceToBeat|null (string), finalPrice|null,
source (Gamma URL), rawJson}`. Local `resolutions.json` is an array of these. Outcome = latest
observation by `observedAtMs`, only if `status=resolved` and `winningTokenId` matches the
outcome's token (`replay/package.ts:126-146`). Settlement only; never injected into ticks.

**Catalog row** `recorder_v4_recordings` (`src/db/schema.ts:704-751`; mapping
`src/db/recorderV4Catalog.ts:18-49`): `id, bucket, archive_prefix, manifest_key,
manifest_sha256, manifest (json), recording_id, slug, symbol, timeframe, start_ms, end_ms,
events_key, events_sha256, events_bytes, events_rows, complete, missing_initial_book,
polymarket_complete (= no polymarket gap AND no missing initial book),
binance_agg_trade_complete, binance_book_ticker_complete, chainlink_spot_complete,
chainlink_twap_complete, website_ptb_complete` (each = no gap of that feed anywhere in
`coverage.gaps`), `website_ptb_observed, opening_twap_available, reference_evidence
({websiteObserved, openingReasons[]}), latest_resolution, outcome ("UP"|"DOWN"|null),
resolution_observed_at_ms, resolution_keys_sha256, verified_at_ms, updated_at`.

## 2. Event stream contract

**Parquet identity** (`storage/parquet.ts:21-67`; doc:224-232): Parquet V2, ZSTD; footer
key-values `recorder_schema_version=4`, `recorder_format=recorder-v4-compact-1`, plus
`market_slug` (observed in the real file; doc silent). Exactly 66 OPTIONAL columns in a fixed
order; lists are standard 3-level LIST of OPTIONAL elements; VARCHAR=UTF8 BYTE_ARRAY,
BIGINT=INT64, INTEGER=INT32. Row groups: writer target 8,192 (real file: up to 10,224);
TS reader rejects groups above 16,384 rows (`storage/parquet.ts:139`).

**Envelope columns (13)** (`storage/compactCodec.ts:6-20`; `types.ts:64-84`):
`schema_version INT32 (=4), capture_id, session_id, sequence INT64, received_at_ms INT64,
monotonic_ns INT64, source, connection_id, event_type, source_time_ms INT64|null, details_json,
kind, raw_fallback`. Exactly one of `kind` (typed payload) or `raw_fallback` (exact original text)
is set. `eventId = capture_id + ":" + sequence` is reconstructed (no column).
`source ∈ polymarket|binance|chainlink|price_to_beat|market_metadata|control|bootstrap`.

**Typed payload columns (53)** (`storage/compactShapes.ts:99-165`), keyed by `kind`:

| kind | columns (all VARCHAR unless noted; `[]` = parallel list) |
|---|---|
| `price_change` | `pc_market, pc_asset_id[], pc_price[], pc_size[], pc_side[], pc_best_bid[], pc_best_ask[], pc_timestamp, pc_event_type` (per-change `hash` deliberately dropped, doc:230) |
| `book` | `book_market, book_asset_id, book_bids_price[], book_bids_size[], book_asks_price[], book_asks_size[], book_hash, book_timestamp, book_event_type` |
| `last_trade_price` | `lt_market, lt_asset_id, lt_price, lt_size, lt_fee_rate_bps, lt_side, lt_timestamp, lt_event_type, lt_transaction_hash` |
| `best_bid_ask` | `bba_market, bba_asset_id, bba_best_bid, bba_best_ask, bba_spread, bba_timestamp, bba_event_type` |
| `btcusdt@aggTrade` | `at_stream, at_e, at_event_time INT64 (E), at_s, at_a INT64, at_p, at_q, at_f INT64, at_l INT64, at_trade_time INT64 (T), at_m BOOL, at_ignore BOOL (M)` |
| `btcusdt@bookTicker` | `bt_stream, bt_u INT64, bt_s, bt_b, bt_bid_quantity (B), bt_a, bt_ask_quantity (A)` |

Prices/sizes are exact decimal strings; Polymarket timestamps are decimal-ms strings. Parallel
lists must have equal length (`storage/compactPayloadDecoder.ts:24-25`). Typed kinds are only
used when the JSON matches the wire shape exactly (`storage/compactShapes.ts:8-91`); anything else
(extra/missing field, non-lossless string) is raw fallback.

**Raw-fallback shapes observed in the real 15m package** (source|event_type|shape → rows):
- `polymarket|message`: typed `price_change` 225,958, `best_bid_ask` 4,292, `book` 1,226,
  `last_trade_price` 611; fallback text `PONG` 90 and `tick_size_change` 4
  (`{market, asset_id, old_tick_size, new_tick_size, timestamp, event_type}`).
- `binance|message`: typed `bookTicker` 164,017, `aggTrade` 15,582; fallback
  `{"transport":"ping","base64":…}` 45.
- `chainlink|message` (all fallback, PolyBolt): `price.crypto` 887, `price.crypto.twap` 887,
  transport ping 36. Shape `{v, channel, seq, ts, payload:{full_accuracy_value (string), source:
  "chainlink", symbol: "btcusd", timestamp, value (number), window_seconds (TWAP only)}}`;
  `snapshot:true` frames carry `payload.data[]` points (`replay/feedState.ts:60-83`).
- `price_to_beat|message` 30: `{openPrice (JSON number), closePrice, timestamp, completed,
  incomplete, cached}`; `details_json = {url, httpStatus, startedAtMs}` (website
  `/api/crypto/crypto-price`, doc:50-54).
- `market_metadata|message` 120: Gamma market JSON, `connection_id = gamma-discovery`, with
  request `details_json`.
- `control|window_end` 1: `{"kind":"window_end","at":…,"reason":"boundary"}`. Status controls
  follow `FeedStatus` (`types.ts:38-57`: `source, connectionId, kind, stamp, reason?,
  marketSlug(s)?, channelId?, details?`).
- `bootstrap|initial_state` 1 (`connection_id = local`): `{kind, market, feeds: CapturedEvent[],
  books: [{rawJson, observedAtMs, sequence}]}` (`types.ts:135-143`) = **initial book snapshot**.

`event_type` is `message` for every feed frame in the sample; the provider type lives in `kind`
or the raw JSON. `source_time_ms` was null in all 413,787 rows (provider times stay in payloads).

**Receipt semantics** (doc:99-111; `types.ts:22,66-77`): one global decimal `sequence` per
recorder (`captureId` = installation, `sessionId` = process run); strictly increasing per file,
gaps in numbering are expected after restarts. `receivedAtMs` = wall clock at callback entry,
before parsing; it assigns observations to the half-open window `[startMs, endMs)`.
`monotonicNs` is for local elapsed time and clock-discontinuity detection only. Sample spans
`startMs − 898 s` (60 metadata rows) to `endMs + 60 s` (finalization grace, doc:109).

**Overlap** (doc:8,107,222): shared Binance/Chainlink rows are copied into every overlapping
5m/15m file with identical `eventId`, `sequence`, receipt time. One Polymarket socket per
timeframe, so a frame may address several markets: filter by `conditionId` (`marketFrame.ts:96-108`).
Recordings are never stitched.

## 3. What the Rust reader must do

1. **Verify before reading** (old spec 15 §5.1): manifest schema/refinements; manifest sha for
   R2 inputs; Parquet `bytes`+`sha256`; footer format keys and exact 66-column schema; row group
   bound; per row `schema_version=4`, known source, `kind` consistent with source
   (`btcusdt@*` ⇒ binance, else polymarket) and `raw_fallback` null when typed
   (`storage/parquet.ts:70-90`); sequence strictly increasing; total rows = footer rows. Rust addition:
   rows/first/last sequence = manifest. One `captureId` per file (`replay/dispatcher.ts:109-110`).
2. **Order**: dispatch strictly by file/sequence order; never reorder by provider time.
   Recorded order only — TS rejects `--order exchange_time` and `--time-driven`
   (`src/backtest/runSingleMarket.ts:418-421`).
3. **Bootstrap**: `initial_state` market identity (all `RecordedMarket` fields except `rawJson`)
   must equal the manifest; at most once per session; no feed/book entry from the future;
   resets books and feeds, restores state without emitting ticks; an invalid bootstrap book is
   fatal (`replay/dispatcher.ts:124-170,229`).
4. **Window**: non-bootstrap envelopes outside `[startMs, endMs)` by `receivedAtMs` are ignored
   (`replay/dispatcher.ts:172-173`; old spec I-24 keeps them for its "realistic" profile).
5. **Market frames**: ignore `PING`/`PONG`, transport ping/pong, `best_bid_ask`, `new_market`,
   `market_resolved`; validate `book`/`price_change`/`tick_size_change`/`last_trade_price`
   (price ∈ [0,1], size ≥ 0, BUY/SELL, safe-integer timestamp, asset ∈ tokenIds); any invalid
   member ⇒ book reset for this market, no mutation (`marketFrame.ts:27-108`). Only `book` and
   `price_change` produce strategy ticks (old spec I-27).
6. **Control**: polymarket status `disconnected|gap|stale|provider_mismatch|error` whose scope
   includes the slug (legacy unscoped = all markets) ⇒ book reset (`replay/dispatcher.ts:179-189`).
7. **Coverage gate** before any tick (`replay/eligibility.ts:51-100`; `replay/dispatcher.ts:22-41`):
   reasons, with exact TS strings, are `unsupported_feed: …`, `not_finalized: …`,
   `empty_capture: …`, `<feed>: <gap reason>` for required-feed gaps overlapping the window,
   `polymarket: missing initial book`, `recording coverage is incomplete`, and PTB evidence
   (`ptb_unverified: …`, `price_to_beat: website opening observation missing`,
   `chainlink_opening_twap: …` from `replay/openingReference.ts:54-58`). Required feeds =
   `polymarket` + those requested (`replay/feedState.ts:262-275`). Any reason ⇒ result
   `{marketStats:null, eventsProcessed:0, eventsByType:{}, skipReason:"incomplete_capture",
   coverageReasons}` (`src/backtest/runSingleMarket.ts:437-447`).
8. **`--allow-capture-gaps`** drops gap and PTB-evidence reasons only; `unsupported_feed`,
   `not_finalized`, `empty_capture` still skip. Replay then keeps the recorded resets; nothing is
   synthesized (doc:304-322; `replay/eligibility.ts:67`).
9. **Rules from `rawJson`**: strategy-visible allowlist only — `question, description,
   orderPriceMinTickSize, orderMinSize, feesEnabled, feeSchedule, negRisk`, plus identity, token
   map, start/end ISO, `cryptoMarketConfig{twapEnabled, twapLookbackSeconds}`
   (`replay/package.ts:80-124`). In-window `tick_size_change` updates the tick (sample: 0.01 →
   0.001 mid-market). Final outcomes/prices from later Gamma data are never exposed.
10. **Feeds**: reducer per `replay/feedState.ts:103-260`, `receivedAtMs` = receipt time, no modeled
    latency (doc:365). Offered to strategies in v1 (old spec 14 §7.4): Binance aggTrade spot
    (`binanceWsSpotPrice`), Chainlink spot (`rtdsPolymarketCryptoPrices.chainlink`), website PTB
    (`polymarketPriceToBeat`, source `website`). Decoded only (reducer + gate, not offered;
    request ⇒ `unsupported_feed`): Binance `bookTicker`, Chainlink TWAP,
    `chainlink-opening-twap`. The opening-reference tracker (`replay/openingReference.ts`) is
    still required because the website-PTB gate uses its `websiteObserved` evidence
    (`replay/eligibility.ts:41-48`). Synthetic ticks: aggTrade and single (non-snapshot) Chainlink spot
    points, only with `tickOnUpdate` and a non-empty book (`replay/dispatcher.ts:194-218`).
11. **Data anomalies** (old spec 15 §8 — the goal prompt's "§10" is §10 Verification): never
    change replay, only count — `deltaBeforeBook`, `crossedBookTicks`, `duplicateRows`,
    `invalidFrames` (reset), `bookResets` (control), `bookIntegrityMismatches` (reconstructed
    best bid/ask vs `pc_best_bid/ask`, I-38), `ignoredMessages` by type. Errors, not
    anomalies: integrity/schema failures, non-increasing sequence, mixed capture ids, invalid
    bootstrap, job/file identity mismatch.

## 4. How TS reads it today (golden generation)

- CLI: `npm run backtest -- --input-mode recorder-v4 (--dir <cache> | <pkg|manifest|r2 url> |
  --read-from r2 --symbol btc --timeframe …) [--allow-capture-gaps] [--list-eligible] [--sequential]`.
- Discovery: `discoverCapturePackages` (`replay/selection.ts:36`) → catalog
  `queryCatalogRecordings` (`src/db/recorderV4Catalog.ts:147`) or `resolveCaptureInputs` +
  `resolveCapturePackage` (`replay/package.ts:32,148`).
- Worker: `src/backtest/runSingleMarket.ts:392-470` — `downloadCaptureForReplay` → digest check →
  `validateCapturedFeedRequest` → `inspectCaptureEligibility` → `replayCapturedEvents` over
  `readCapturedEvents(filePath)` (`storage/parquet.ts:187`, hyparquet + fzstd) →
  `CapturedMarketDispatcher` → shared `MarketEngine` → `StrategyRunner`.
- Offline golden without DB/strategy: `npm run record:v4:verify -- <pkg-dir>` →
  `verifyCapturePackage` (`src/recorder-v4/verify.ts:32`) returns rows, ticks, source/feed
  counts, coverage, `replaySha256` (book + feed snapshots per tick) and `openingReference`.
- Download: `npm run record:v4:data -- download|list …` (`src/cli/record-v4-data.ts`). Modules: `storage/{parquet,compactCodec,compactShapes,compactPayloadDecoder,manifest,archive,
  resolutionArtifact}.ts`, `replay/{dispatcher,feedState,openingReference,eligibility,package,
  selection,provenance,admissionCache,cacheDirectory}.ts`, `marketFrame.ts`, `marketScope.ts`,
  `types.ts`, `verify.ts`; tests via `npm run record:v4:test` (incl. `replay/engineParity.test.ts`).

## 5. Inventory

on 2026-10-09: 211 complete BTC 15m and 589 complete BTC 5m packages since 2026-10-06, every feed complete (read-only query over `recorder_v4_recordings`).env`).
Local cache: 3 packages (2× 15m, 1× 5m) in `data/recorder-v4-cache` → `../../polymarket-bot/…`.

## Contradictions and gaps found

- Doc:230 speaks of "the `event_id` column"; the compact schema has no such column
  (`storage/compactCodec.ts:6-20`; real file has 66 columns, none named `event_id`).
- Doc:101 lists `eventType` as an envelope field; in practice it is `message` for all feed
  frames (provider type is in `kind`/raw JSON) — doc is silent on this.
- Doc:226 "8192-row group target" vs real groups up to 10,224 rows (limit 16,384 in TS).
- `source_time_ms` exists but was null in every sampled row; doc is silent.
- Catalog `*_complete` flags count gaps anywhere in the manifest; the replay gate only counts
  gaps overlapping `[startMs, endMs)` (`recorderV4Catalog.ts:21` vs `replay/dispatcher.ts:28-35`).
- Old spec 15 §5.1 omits local `resolutions.json`/`resolution-outbox/` (`replay/package.ts:175-188`).
- Old spec 14 §7.4 withholds bookTicker/TWAP/opening-TWAP in v1, while TS and doc:64-97 already
  offer them to strategies — a deliberate scope cut, to be reconfirmed for the new spec.
- Website PTB `openPrice` is a JSON number (f64); sidecar `priceToBeat` is a string and in the
  sample differs from the first website value (doc:62 expects corrections).
