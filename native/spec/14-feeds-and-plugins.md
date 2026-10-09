# 14 — External feeds and plugins

This document specifies how the Rust engine supplies external feeds (Binance
aggTrades, Chainlink, price-to-beat) and tick-scoped plugins to strategies, in
backtest and live, under both profiles. It fixes the visibility clocks and tie
rules that make backtest feed values equal live feed values, moves every model
parameter out of the worker environment into `ModelConfig`, classifies every
missing-data case, and lists the golden tests that prove the Rust feed and
plugin layer equals the TypeScript oracle where TypeScript is believed correct.
The TS feed layer is the most calibrated part of the old engine
(approach-audit, market-data subsystem); its **behavior** is kept, its code
shape is not.

Related: fixed-point types and RNG in `10-domain-model.md`; clocks (incl.
the realistic receipt-time synthesis), event loop, window rule and
cascade/plugin-snapshot timing in `12-engine-core.md`; latency model
components in `13-execution-models.md`; process, thread and cache model in
`16-performance-and-parallelism.md`; `describe` capabilities and error
classes in `20-binary-protocol.md`; the `ModelConfig` container and job
fields in `21-job-and-output-contract.md`; trace format in
`22-trace-ledger-journal.md`; the strategy-facing API in `30-strategy-sdk.md`;
input readers in `15-inputs.md`; calibration in `51-calibration-plan.md`.

Scope decisions applied here: BTC 5m and 15m (D06), gate-2 parity on BTC 15m
only (D38), all four plugins in v1 with TechnicalIndicators candles from local
aggTrades (D19 as amended), V4-only feed capabilities deferred to follow-up
F7 (D43, §7.4), the opt-in tick interest filter (D41, P-13).

## 1. Feed inventory and sources

| Feed (TS key) | telonex-delta (historical) | recorder-v4 / journal / live (captured) | Value fields |
|---|---|---|---|
| Binance spot `binanceWsSpotPrice` | data.binance.vision aggTrades day files, modeled visibility (§4) | Binance WS `aggTrade` envelope, receipt order (§7) | value, source ts (trade time), receivedAt |
| Chainlink spot `rtdsPolymarketCryptoPrices.chainlink` | Telonex `crypto_prices` day files, two-clock model (§5) | PolyBolt `price.crypto` envelope, receipt order (§7) | value, source ts (round time), receivedAt |
| Price to beat `polymarketPriceToBeat` (website/Gamma source) | producer-resolved Gamma strike, availability model (§6) | website PTB HTTP responses, receipt order (§7) | openPrice, receivedAt, window ISO strings |
| Synthetic feed ticks (`tickOnUpdate`) | schedule from the loaded series (§8) | one per captured update (§8) | — |
| V4-only: `binanceBookTicker`, `chainlinkTwap`, PTB `chainlink-opening-twap` | rejected (TS rejects too, `src/backtest/feeds/wireBacktestExternalFeeds.ts:176-181`) | decoded, not offered to strategies in v1 (§7.4) | — |
| Legacy RTDS Binance `rtdsPolymarketCryptoPrices.binance` | no source (TS warns, key absent, `wireBacktestExternalFeeds.ts:234-238`) | rejected (`src/recorder-v4/replay/feedState.ts:294-298`) | — |
| Deribit volatility index | out of scope | out of scope | — |

Market universe is BTC 5m and 15m (D06). Feed code stays symbol-agnostic; the
producer restricts markets.

## 2. Principles

- **F-1 One feed model, input-specific timelines.** Every input mode produces
  the same thing for the core: an ordered stream of feed *state updates* on the
  decision clock, plus optional synthetic-tick wakeups. Historical inputs
  derive that stream from modeled visibility times (§3-§6); captured inputs
  take it from recorded receipt order (§7). The core, plugins and strategies
  never know which one they run on.
- **F-2 Same code live and replay.** The captured-feed reducer (§7) and the
  market-frame validator (`15-inputs.md`) are one Rust implementation, used by
  the live runtime (`50-live-runtime.md`), the V4 reader and the journal
  reader. TS already does this (`src/trading/feeds/liveCapturedFeeds.ts:65-69`
  shares `CapturedMarketDispatcher`).
- **F-3 No env, no wall clock, no network.** Every result-affecting feed
  parameter comes from `ModelConfig.feeds` in the job (§9, D09). The binary
  MUST NOT read `BACKTEST_*` variables (TS reads them on the worker:
  `wireBacktestExternalFeeds.ts:39-44,95-100`; the WIP copied this:
  `native/crates/pmb-replay/src/feeds/mod.rs:59-89`). It MUST NOT read the
  wall clock for any decision; the TS wall-clock rules (30 h fresh-market
  grace `wireBacktestExternalFeeds.ts:121,314`; publication-lag branch
  `src/backtest/feeds/chainlinkCryptoPricesSource.ts:87-97`) move to the
  producer as `feedAvailability` (§6.2) or to the TS shim's `data_missing`
  message (publication lag). Plugins and the binary do no
  network I/O (the TS TA plugin fetches REST klines:
  `src/strategy/plugins/TechnicalIndicatorsPlugin.ts:236-245`).
- **F-4 Hard error over silent absence.** A strategy that requests a feed and
  cannot get real data fails that market with a classified error (§10).
  Exceptions are explicit and listed (price-to-beat before its series epoch,
  fresh-market grace, seed-only Binance window).
- **F-5 Typed values inside, TS shape only at the boundary.** Strategies read a
  typed feed view (`30-strategy-sdk.md`). The TS JSON shape
  (`src/trading/feeds/externalFeeds.ts:1-69`) is produced only for `describe`,
  the parity trace and the live WebUI (§11.2).
- **F-6 Numbers.** Times are `i64` milliseconds. Feed prices are `f64` (allowed
  by the anti-drift rules; they are analytics, not money). Prices are parsed
  from the same source doubles/decimal strings TS uses, so equality with TS is
  expected without any float emulation; a decision flip caused by a last-ulp
  difference is classified, never emulated.

## 3. Historical feed timeline (telonex-delta)

### 3.1 Clocks

| Clock | ts-compat (TS oracle) | realistic (12 §4.1, §4.3) |
|---|---|---|
| exchange ts `E(t)` | `ts_exchange_ms` of the row behind real tick `t` (TS `snapshot.timestamp`; `src/parquet/replay/replayTelonexDeltaParquetForMarket.ts:94-96`) | same; drives only the receipt-time synthesis |
| feed clock `C(t)` of a real tick | `max(L, E)` when the row has a Telonex local time `L > 0`, else `E` (`wireBacktestExternalFeeds.ts:59-64`) | loop clock `now` = synthesized receipt time `R_t` (12 RS1-RS3); `L` is not used |
| feed clock of a synthetic tick | its stamp `S = max(v, E(last real tick))` (§8.2; `src/market/syntheticTick.ts:61-70`) | its stamp `max(v, now)` (F-41) |
| high-water `H` | `max` of all feed clocks of ticks delivered to the runner so far; initial `-inf` (`src/backtest/feeds/backtestExternalFeedsProvider.ts:68,138-139`) | equals `now` (monotone by 12 K2) |

- **F-7** Feed state seen by a tick is evaluated at `H` after updating
  `H := max(H, C(t))`. In ts-compat `H` MUST advance on **every** tick
  delivered to the runner (in-window real ticks and dispatched synthetic
  ticks), whether or not the strategy reads feeds, because a later read at a
  smaller clock must still see the high-water value. Lazy evaluation of the
  cursor at read time is allowed; lazy update of `H` is not. In realistic the
  feed state is a function of `now` alone; `max(L, E)` exists only in
  ts-compat (12 K5).
- **F-8** Telonex local time is Telonex's recorder clock, not the bot's: it
  trails the exchange stamp by a median 7-8 ms (p99 19-48 ms depending on the
  market) and stepped backwards twice in 93,427 rows (measured 2026-10-09 on
  `data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1785028500.parquet`;
  12 §4.3). The ts-compat high-water clamp absorbs the backward steps. The
  feed latencies of §9 were calibrated against the bot's receive clock, which
  is why realistic evaluates feeds on the synthesized receipt time instead
  (12 §4.3).

### 3.2 Visibility and cursor rules (normative, both profiles)

- **F-9 Inclusive visibility.** An element with visibility time `vis` is
  visible at clock `c` iff `vis <= c`
  (`backtestExternalFeedsProvider.ts:70-74,105-109`).
- **F-10 Cursor in series order.** Each series has one monotone cursor that
  advances while the **next element in series order** is visible; the visible
  value is the element at the cursor; no visible element means the key is
  absent. This reproduces TS exactly even when timestamps are not monotone in
  series order (a later-id trade with an earlier timestamp waits behind its
  predecessor). Because of F-7 the cursor never moves backwards; the TS
  backward binary search is dead code and MUST NOT be ported
  (`backtestExternalFeedsProvider.ts:78-94,111-129`).
- **F-11 Key presence.** Binance and Chainlink keys are absent until their
  first visible element; price-to-beat is absent until its availability time.
  The live store keeps the last Binance/Chainlink value across market
  rotations and clears price-to-beat at rotation
  (`src/trading/feeds/externalFeeds.ts:113-158`); the per-market seed (F-14,
  F-22) reproduces the retained value in backtests.

## 4. Binance aggTrades (historical)

### 4.1 Day-file contract

- Path: `<binanceRoot>/aggTrades/<PAIR>/<PAIR>-aggTrades-<YYYY-MM-DD>.parquet`
  (WIP `native/crates/pmb-replay/src/feeds/mod.rs:124-129`). The TS shim
  resolves day files under the machine's data roots and passes them as the
  job's `market.feedFiles` (`21-job-and-output-contract.md` §5, §9); the
  binary never derives paths from cwd or env. The engine computes the
  required day set itself (F-12) and fails with `data_missing` when
  `feedFiles` lacks one of those days.
- Columns used: `agg_trade_id INT64`, `ts_ms INT64`, `price DOUBLE`; `qty
  DOUBLE` only for TA candles (§12.5). Rows are ordered by `agg_trade_id`
  (`docs/datasets/price-feeds/binance/feed.md:171-173`).
- Size reference: `BTCUSDT-aggTrades-2026-09-16.parquet` holds 945,839 trades
  in 8 row groups, 7.3 MB (measured 2026-10-09).
- Decode and byte checks: a day file whose size differs from its `feedFiles`
  entry is `data_missing` (`integrity_mismatch`: the local copy changed after
  the shim's check). Day files carry no sha256, so a decode failure is
  `runtime` (`decode_unverified`, retried on another host; 20 §4).

### 4.2 Series (normative)

- **F-12 Day set** = UTC dates covering `[start - lookback, end)`, the end day
  excluded at exact midnight (`src/binance/paths.ts:130-142`). Any missing day
  file is an error (§10).
- **F-13 Membership** = trades with `start - lookback <= ts_ms <= end + 2000`
  (tail), ordered by `agg_trade_id`
  (`src/backtest/feeds/binanceAggTradesSource.ts:43,83-87`).
- **F-14 Seed** = the single trade with the highest `agg_trade_id` among
  trades with `ts_ms < start - lookback` **in the covered day files only**,
  prepended (`binanceAggTradesSource.ts:77-82`). Same rule in both profiles.
- **F-15 Visibility.** ts-compat: `vis = ts_ms + L_b` with `L_b` the constant
  of `ModelConfig.feeds.binance.latency` (§9). Realistic: per-trade drawn
  latency with monotone delivery (§9.1 F-51, F-52). Same-ms trades resolve
  to the highest id through F-10 (live last-write-wins).
- **F-16 Emitted point**: `{symbol: resolved feed symbol (e.g. btcusdt),
  sourceTsMs: ts_ms, value: price, receivedAtMs: vis}`
  (`backtestExternalFeedsProvider.ts:140-151`).
- **F-17 Validation.** Each loaded price MUST be finite and > 0, else
  `data_defect` (TS does not check, `binanceAggTradesSource.ts:96-106`; the WIP
  checks finiteness, `native/crates/pmb-replay/src/feeds/binance.rs:131-138`).
  A divergence caused by this check is classified "TS bug".
- **F-18** Zero rows up to the window end is `data_defect`; a seed-only series
  (no trade inside the range) is a diagnostic warning, not an error
  (`binanceAggTradesSource.ts:108-132`). There is no in-window gap check for
  Binance (TS has none).

### 4.3 Lookback and tail are engine constants

The lookback (300,000 ms) is not result-affecting given the seed rule: the value
visible at any in-window clock is the highest-id trade with `ts + L_b <= c`
(realistic: `vis <= c`, F-53), which is either inside the range or is the
seed. The tails (Binance 2,000 ms,
Chainlink 5,000 ms) matter only when a feed clock runs past the window end by
more than the tail (local-clock skew; Telonex p99 is 19 ms, F-8), so they stay
exactly equal to TS. Both MUST be engine constants exported in the `describe`
capabilities (so the producer preflight computes the same day set,
`src/cli/backtest.ts:994-1031`), not `ModelConfig` fields. A property test MUST
show identical traces for lookbacks of 60 s, 300 s and 900 s (§13 V-7).

## 5. Chainlink (historical, two-clock)

### 5.1 Day-file contract

- Path: `<cryptoPricesRoot>/<asset_id>/<asset_id>-crypto-prices-<date>.parquet`
  (WIP `feeds/mod.rs:131-135`), passed in `feedFiles` like Binance days (the
  byte and decode rules of §4.1 apply); raw Telonex file as delivered:
  `timestamp_us` (round time), `server_timestamp_us` (Polymarket broadcast
  time), `price` (VARCHAR, 18 decimals), `asset_id`
  (`docs/datasets/price-feeds/chainlink/feed.md:152-154`).
- Size reference: `btcusd-crypto-prices-2026-09-17.parquet` holds 85,155
  rounds; broadcast minus round time is min 637 ms, median 1,126 ms, max
  5,861 ms (measured 2026-10-09). Telonex kept delivering this channel after
  the 2026-09-15 RTDS-to-PolyBolt switch. The Telonex subscription has expired
  (D38): no new day files arrive until renewal, so a market after the last
  synced day fails `data_missing` (`day_file_missing`).

### 5.2 Series (normative)

- **F-19 Coverage floor.** A window starting before 2026-04-02T00:00:00Z
  (`1775088000000`, `src/telonex/cryptoPrices/paths.ts:36-37`) is
  `data_defect` (cause `pre_coverage`). Note: `docs/datasets/price-feeds/chainlink/feed.md:71`
  suggests `--from-ms 1775001600000` (2026-04-01); the code value is
  authoritative.
- **F-20 Day set** = dates covering `[max(start - lookback, floor), end)`.
- **F-21 Membership** by **round** time: `start - lookback <= round <= end +
  5000`; **order** by `(broadcast, round)` ascending
  (`chainlinkCryptoPricesSource.ts:120-125`).
- **F-22 Seed** = the latest row with `round < start - lookback` in
  `(broadcast, round)` order (`chainlinkCryptoPricesSource.ts:113-119`).
- **F-23 Visibility.** ts-compat: `vis = broadcast + L_c` with `L_c` the
  constant of `ModelConfig.feeds.chainlink.latency`. Realistic: per-row
  drawn latency with monotone delivery (§9.1). `L_c` models only the
  broadcast-to-bot leg; the ~1 s round-to-broadcast lag is data and MUST NOT
  be added again (`wireBacktestExternalFeeds.ts:71-87`).
- **F-24 Emitted point**: `{symbol: feed symbol (e.g. btc/usd), sourceTsMs:
  round, value, receivedAtMs: vis}`. `sourceTsMs` may step
  backwards between consecutive points; that is live-correct
  (`chainlinkCryptoPricesSource.ts:10-31`).
- **F-25 Validation.** `server_timestamp_us` NULL or `<= 0` is `data_defect`
  for **every** row including the seed (TS validates only range rows,
  `chainlinkCryptoPricesSource.ts:113-136` vs `:146-154`). `price` MUST parse
  to a finite value > 0 and `asset_id` MUST equal the requested asset, else
  `data_defect` (TS checks neither; the coverage tool does,
  `src/backtest/feeds/feedCoverageCheck.ts:113-121`).
- **F-26 Gap check.** Sort round times ascending; the largest stale span
  clipped to `[start, end]`, bounded by the seed before and the tail after,
  MUST be `< maxGapMs`, else `data_defect` (cause `upstream_hole`) naming the hole
  (`chainlinkCryptoPricesSource.ts:211-249`). `maxGapMs =
  ModelConfig.feeds.chainlink.maxGapMs`; `0` disables the check (replay on the
  frozen value, the live-faithful behavior).
- **F-27** Zero rows up to the window end is `data_defect`
  (`chainlinkCryptoPricesSource.ts:161-170`).

## 6. Price to beat

### 6.1 Historical availability model

- **F-28** When the job carries a strike, the feed is present iff `H >= start
  + L_p` (`H` per §3.1; `L_p` = the constant of
  `ModelConfig.feeds.priceToBeat.latency` in ts-compat, the market's single
  draw in realistic, §9.1) and
  emits `{symbol: uppercase slug symbol, eventStartTimeIso, endDateIso (from
  the slug window), openPrice, receivedAtMs: start + L_p}`
  (`backtestExternalFeedsProvider.ts:164-175`,
  `wireBacktestExternalFeeds.ts:290-298`).

### 6.2 Producer-side resolution: `feedAvailability.priceToBeat`

TS decides absent-vs-error inside the worker using `Date.now()`
(`wireBacktestExternalFeeds.ts:283-344`). Native jobs keep today's
`market.gammaPriceToBeat` tri-state for the value and add
`market.feedAvailability` (field defined in `21-job-and-output-contract.md`
§4-§5; its schema is owned here). The producer evaluates the TS rules once, at
the enqueue time recorded as `asOfMs`, and the binary only applies the result:

```jsonc
"feedAvailability": {
  "priceToBeat": null            // strategy did not request price-to-beat
  // or { "status": "fed" | "absent_pre_series_epoch" | "absent_fresh_market_grace"
  //                | "unavailable_pipeline_incomplete" | "unavailable_upstream_hole",
  //      "message": "..." }     // message required for unavailable_*
}
```

| Producer finding (TS logic kept) | `status` | Binary behavior |
|---|---|---|
| strike present (always fed, regardless of epoch) | `fed` | F-28; `gammaPriceToBeat.priceToBeat` MUST be a finite number |
| null, window before the series epoch (`src/polymarket/gammaEventMetadata.ts:43-54`) | `absent_pre_series_epoch` | key stays absent, info diagnostic |
| null, market ended less than 30 h before `asOfMs` | `absent_fresh_market_grace` | key absent, warning diagnostic |
| slug not in catalog, or never synced | `unavailable_pipeline_incomplete` | market fails `data_defect` (cause `pipeline_incomplete`) with the message, which names `telonex:sync` / `telonex:sync-pricetobeat-and-final-price` |
| synced, empty strike (Polymarket-side hole) | `unavailable_upstream_hole` | market fails `data_defect` (cause `upstream_hole`) |
| strategy requests PTB but `feedAvailability.priceToBeat` is null or inconsistent with `gammaPriceToBeat` | - | `invalid_input` (cause `feed_availability`; producer bug) |

An `--extend` resolves fresh availability for its new markets (which matches TS
evaluating at run time), while `ModelConfig` stays equal to the parent's
(`21-job-and-output-contract.md` §5.3). A re-run of the same job is identical
on any machine and date.

### 6.3 Captured sources

Recorder V4, journal and live use observed website PTB responses at their
receipt time (§7). `ModelConfig.feeds.priceToBeat` is not used there.

## 7. Captured feeds (recorder-v4, journal, live)

### 7.1 Reducer (port of `applyCapturedFeed`, `src/recorder-v4/replay/feedState.ts:103-260`)

- **F-29** Feed envelopes update state in recorded sequence order with
  `receivedAtMs = envelope receipt time`; no modeled latency is applied
  (`docs/datasets/recording/recorder-v4.md:365`).
- **F-30 Binance**: only `btcusdt@aggTrade` with `e=aggTrade`, safe-integer
  `a >= 0`, finite `p > 0`, `T > 0` updates the spot point `{symbol: btcusdt,
  value: p, sourceTsMs: T, receivedAtMs}` and is a synthetic-tick candidate;
  invalid envelopes are ignored (`feedState.ts:19-44,111-125`).
- **F-31 Chainlink**: PolyBolt `price.crypto` with `payload.source=chainlink`,
  `symbol=btcusd`; a `snapshot:true` history frame restores the latest point
  by timestamp and is **not** a synthetic-tick candidate; a single point is
  (`feedState.ts:160-230`). `price.crypto.twap` updates TWAP state only when
  `window_seconds` equals the market's configured TWAP window.
- **F-32 Price to beat (website)**: `openPrice` finite and > 0 and HTTP status
  2xx updates the PTB point with window ISO strings from the market
  (`feedState.ts:231-257`).
- **F-33 Selection**: a tick sees only feeds the strategy requested; the
  opening-reference selection rules of `selectCapturedFeeds` apply
  (`feedState.ts:318-362`). The feed state is bound to the tick when it is
  dispatched (TS binds a cloned snapshot per tick, `dispatcher.ts:93-101`; in
  Rust the tick carries an immutable copy of the small feed view).
- **F-34 Request validation** (`validateCapturedFeedRequest`,
  `feedState.ts:277-315`) runs before replay; a violation is `invalid_input`.

### 7.2 Opening reference

The `OpeningReferenceTracker` (`src/recorder-v4/replay/openingReference.ts`)
MUST be ported because the V4 coverage gate uses its evidence even for the
website PTB source (`websiteObserved`, `src/recorder-v4/replay/eligibility.ts:41-48,72-81`)
and because the live runtime needs the same rules. Its exact-boundary,
duplicate, correction and conflict rules are golden-tested against TS (§13 V-4).

### 7.3 Differences from the historical model (expected, not parity breaks)

- The TS historical snapshot always contains `rtdsPolymarketCryptoPrices: {}`
  (`backtestExternalFeedsProvider.ts:136`); the captured selection includes it
  only when requested and present (`feedState.ts:352-354`). This matters only
  for TS-shape serialization (§11.2).
- Captured Chainlink is PolyBolt (receipt clock), historical is RTDS-era
  Telonex data (two-clock model). The `L_c = 320` default was calibrated on
  RTDS on 2026-07-21 (`docs/datasets/price-feeds/parity-harness.md:90-104`);
  F-56 governs its re-measurement.

### 7.4 V4-only capabilities (follow-up, not v1)

Binance `bookTicker`, Chainlink TWAP and the `chainlink-opening-twap` PTB source
exist only in captured inputs. They are follow-up F7 (D43,
`01-scope-milestones.md` §10). In v1 the readers MUST decode them (the
reducer state and the V4 coverage gate need them), the SDK MUST NOT offer
them, `describe` never lists them, and a feed request naming them is
`invalid_input` (`unsupported_feed`) on every input mode, reported before
enqueue (`20-binary-protocol.md` §5.1).

## 8. Synthetic feed ticks

### 8.1 Opt-in and execution rules (both profiles, all inputs)

- **F-35** Opt-in per feed (`tickOnUpdate` on Binance spot and/or Chainlink
  spot, `src/strategy/plugins/ExternalFeedsRequestPlugin.ts:10-29`). Without
  opt-in nothing is scheduled and the run is identical to a run of an engine
  without the feature.
- **F-36** A synthetic tick carries an unchanged book and the feed view as of
  its clock. It MUST NOT trigger matching of resting orders, GTD expiry or
  latency-queue drain in ts-compat (`src/trading/StrategyRunner.ts:316-334`);
  in realistic, scheduled exchange events fire at their own exact times
  (`13-execution-models.md`) and a synthetic tick still never re-matches
  resting orders against the unchanged book. Intents returned on a synthetic
  tick execute normally.
- **F-37** Plugins observe synthetic ticks only if they declare it (§12.2).
- **F-38** Exactly one Chainlink symbol may tick. The Rust feed request type
  admits one Chainlink symbol (TS replay uses the first and warns, live ticks
  on every symbol: `wireBacktestExternalFeeds.ts:242-248`,
  `src/cli/trading-bot.ts:664`).

### 8.2 Historical schedule and flush (ts-compat and realistic)

- **F-39 Schedule** = every series element (seed included) with `v = vis`
  (F-15/F-23) and `start <= v <= end`; sorted by `(v, feed)` with Binance
  before Chainlink at equal `v`, series order kept within a feed
  (`src/backtest/feeds/syntheticTickSchedule.ts:28-60`).
- **F-40 Flush.** Before **every** real tick `t` (in or out of the window),
  dispatch all not-yet-consumed entries with `v < C(t)` (strict; `C(t)` per
  §3.1, i.e. `R_t` in realistic, 12 RS3) in schedule order, then deliver
  `t`. Equal times therefore put the real tick first, and that real tick
  already sees the feed value (F-9). Entries are consumed
  without dispatch while no real book snapshot exists. The index only moves
  forward; a backward `C(t)` flushes nothing. After the input ends, the
  remainder is flushed (`syntheticTickSchedule.ts:62-103`,
  `src/backtest/runSingleMarket.ts:346-378,492`). Dispatched counts can be
  lower than scheduled counts (`docs/backtest/adr-binance-driven-ticks.md:64-66`).
- **F-41 Stamp.** ts-compat: `S = max(v, E(last real tick))`, where the last
  real tick includes out-of-window ticks. Realistic: `max(v, now)` (12 §4.1).
  The synthetic tick passes through the same counting and the profile's
  window gate as real ticks (`runSingleMarket.ts:297-315`; 12 §5.3), so it
  can be counted and then gated.
- **F-42 Shared schedule.** The schedule depends only on the series, the
  visibility times (F-15/F-23, including realistic draws) and the window; it
  is built once per market read and shared by all candidates. Candidates of
  one group have identical feed requests including `tickOnUpdate` (21 C3,
  41 §3.5), and `ModelConfig.feeds`, `clock` and `seed` are shared (21 C4);
  feed draws depend only on them and the element (F-51), so every candidate
  sees the same visibility times and the same synthetic ticks.

### 8.3 Captured inputs and live

- **F-43** One synthetic candidate per reducer update that F-30/F-31 marks
  (no history snapshots), dispatched immediately after the state update when
  opted in and the book snapshot has a finite positive timestamp and at least
  one asset (`src/recorder-v4/replay/dispatcher.ts:194-218`).
- **F-44 Stamp.** ts-compat on V4 reproduces TS: `max(receivedAtMs,
  snapshot.timestamp)`. Realistic, journal and live stamp the decision clock
  of the envelope (receipt time, D27), which is monotone by construction.
- **F-45 Live drop rules**: no synthetic tick before the first book of the
  current market, during rotation or while stopping (`src/cli/trading-bot.ts:630-666`).

### 8.4 Counting

Dispatched synthetic ticks are counted under `binance_agg_trade` and
`chainlink_round`, before the window gate; entries consumed before the first
book are not counted (`runSingleMarket.ts:297-300`). The full counting rule is
in `21-job-and-output-contract.md`.

## 9. `ModelConfig.feeds`

Result-affecting feed parameters. The producer resolves them, the job carries
them, the run row persists them (D09); `--extend` and candidate groups inherit
them unchanged. This doc owns the sub-object (`21-job-and-output-contract.md`
§6); its exact field set is:

```jsonc
"feeds": {
  "calibrationId": "feeds-2026-07-21",
  "binance":     { "latency": { "kind": "constant", "ms": 110 } },
  "chainlink":   { "latency": { "kind": "constant", "ms": 320 }, "maxGapMs": 300000 },
  "priceToBeat": { "latency": { "kind": "constant", "ms": 2700 } }
}
```

Each `latency` is a distribution object with the kinds and encoding of
`13-execution-models.md` §7.3 (`constant`, `uniform`, `empirical` with 101
quantiles, `lognormal` with decimal-string parameters); §9.1 says which
profile may use which kind.

| Field | Unit | Default | Validation | Applies to | Evidence |
|---|---|---|---|---|---|
| `binance.latency` (`L_b`) | ms | constant 110 | every value the kind can produce in `0..=10,000` (`lognormal`: samples clamped to that range, F-51) | historical | measured p50 2026-07-16 (p90 171, p95 254, p99 397, max 3,507 ms); end-to-end bias -1 ms on 2026-07-21 (`wireBacktestExternalFeeds.ts:28-37`, `docs/datasets/price-feeds/binance/feed.md:113-121`, `parity-harness.md:96-99`) |
| `chainlink.latency` (`L_c`, broadcast-to-bot leg only) | ms | constant 320 | as above, `0..=10,000` | historical | tuned from 235 to 320 on 2026-07-21, residual bias 2 ms; recorder-level leg p50 235, p90 375, p99 470 ms (`wireBacktestExternalFeeds.ts:71-87`, `docs/datasets/price-feeds/chainlink/feed.md:113-127`) |
| `chainlink.maxGapMs` | ms | 300,000 | integer, 0 or >= 1,000; 0 disables | historical | `chainlinkCryptoPricesSource.ts:193-220` |
| `priceToBeat.latency` (`L_p`) | ms | constant 2,700 | as above, `0..=60,000` | historical | live p50 2,651, p90 3,455, max 5,384 ms (`wireBacktestExternalFeeds.ts:102-110`) |
| `calibrationId` | string | `feeds-2026-07-21` | non-empty | all | names the defaults set; a new calibration publishes a new id |

- **F-46** Invalid or missing values are `invalid_input` (cause
  `model_config`); there is no silent fallback to a default (TS `envInt`
  silently falls back, `wireBacktestExternalFeeds.ts:39-44`).
- **F-47** Engine constants, exported by `describe` and not configurable:
  lookback 300,000 ms; tails 2,000 / 5,000 ms; Chainlink coverage floor; TA
  candle lookback (§12.5). Lookbacks are not part of `ModelConfig`, because
  they cannot change a result (§4.3).
- **F-48** ts-compat parity runs MUST use the defaults above. Changing a
  default is a model change: it gets a new `calibrationId` and an A/B report,
  and never rewrites history.
- **F-57 Calibration file.** `native/contract/calibrations/feeds/<id>.json`
  (layout per 21 §6.3) holds the complete `feeds` object above with
  `calibrationId = <id>`, plus `provenance`: method (constant or `empirical`
  fit), sources (journal files and V4 packages with sha256), date range,
  hosts, sample counts per leg and the F-55 metrics of the fit. The producer
  copies the object into `ModelConfig.feeds` (21 §6.3). The file is immutable
  once a persisted run used it. `feeds-2026-07-21.json` holds the defaults
  above, with the evidence column as provenance.

### 9.1 Latency distributions (realistic only)

A constant offset removes the delivery variance of the live feeds. The
measured Binance leg has a heavy tail (p50 110, p99 397, max 3,507 ms;
`docs/datasets/price-feeds/binance/feed.md:113-121`), and for lag-sniping
strategies the moments when a feed arrives late are where the edge exists or
turns into adverse selection. The realistic profile therefore MAY model each
feed leg as a distribution.

- **F-50 Profiles.** ts-compat: every feed `latency` MUST be `constant` (F-48).
  Realistic: any kind. Captured inputs (V4, journal, live) carry the real
  per-message latency in their receipt times (F-29) and never use these
  fields; that is also why parity with live is judged on V4 (`15-inputs.md`
  §4.3).
- **F-51 Per-element draws.** In realistic each series element draws its own
  latency with the draw and mapping rules of 10 §6.1 (RNG-5 draw 0, RNG-6
  inverse CDF and integer-ms rounding), never depending on call order:
  - Binance and Chainlink use **run-level** streams (10 RNG-3 (b)), because
    one live connection delivers each element once to every market, so
    overlapping markets of one run MUST see the same element at the same
    time:
    `feed_stream_seed(tag) = LE64(SHA-256("pmb-feed-stream/v1" ‖ LE64(run_seed) ‖ ASCII(tag))[0..8])`
    with tag `feed.binance` or `feed.chainlink`. Entity: Binance
    `agg_trade_id` as `u64`; Chainlink
    `LE64(SHA-256("pmb-feed-entity/v1" ‖ LE64(timestamp_us) ‖ LE64(server_timestamp_us))[0..8])`.
    The 10 RNG-4 `(kind << 32) | id` packing is not used, because
    `agg_trade_id` outgrows 32 bits in 2027 (max 4,067,485,738 on
    2026-09-18, about 1 M per day, measured 2026-10-09); feed streams are
    disjoint from execution streams by their tag.
  - Price-to-beat draws once per market on the per-market stream of 10
    RNG-3 (a) with tag `feed.priceToBeat`, entity 0.

  10 I1 still holds (no wall clock, `idx`, worker or group position); a draw
  never depends on the market slice, lookback, candidate, thread count or
  group composition. Samples are clamped to the field's range; clamps are
  counted (`feedLatencyClamps`).
- **F-52 Monotone delivery.** In realistic, visibility is clamped in series
  order: `vis_0 = T_0 + L_0` for the first element of the market's series
  (the seed when present), then `vis_i = max(vis_{i-1}, T_i + L_i)`, with `T`
  = `ts_ms` (Binance) or broadcast time (Chainlink) and series order as in
  F-13 / F-21. This is the in-order delivery of one WS connection: a late
  message holds back every later one (head-of-line blocking). `vis_i` is the
  emitted `receivedAtMs` (F-16, F-24) and the schedule time `v` (F-39), so
  schedule order equals series order within a feed. F-9 and F-10 apply
  unchanged. ts-compat keeps the unclamped `vis = T + L` because TS does;
  with a constant latency the two differ only when `ts_ms` steps backwards in
  id order (Binance; checked per day by PF-2), never for Chainlink, which is
  ordered by broadcast time.
- **F-53 Lookback invariance survives.** Draws are keyed by element, and every
  sample is at most 10,000 ms, far below the 300,000 ms lookback, so the
  clamp chain started by elements before `start - lookback + 10,000` cannot
  change any visibility at an in-window clock. §4.3 and V-7 therefore hold for
  distributions too (tested in V-10).
- **F-54 Fitting.** A feed calibration publishes fitted `empirical` tables
  under a new `calibrationId` (F-57). Primary source: Rust live and paper
  journals (D26) on the calibration/live host chosen at gate 4: bot receipt
  minus `T` (Binance trade time, Chainlink broadcast time), using the host's
  journaled clock samples (D27),
  because a raw cross-clock leg can be negative (Chainlink min -20 ms,
  `chainlink/feed.md:117`). Journals measure at the bot itself and so include
  the in-bot processing that made 320 ms, not the recorder-level 235 ms, the
  end-to-end constant (`chainlink/feed.md:122-127`). Secondary source, for
  continuous re-measurement: worker-2 V4 receipts of the same feeds, mapped to
  the live host through the per-market receipt offset of
  `51-calibration-plan.md` §9 (median of bot minus worker-2 receipts of
  identical events). A fit is accepted only if the end-to-end boundary-lag
  check of the TS parity harness (`parity-harness.md:90-104`) shows no larger
  median bias than the constant it replaces.
- **F-55 Calibration metrics.** Each feed leg (Binance trade time to
  visibility, Chainlink broadcast to visibility, price-to-beat window start
  to first strike) is a latency component in the sense of D35: model versus
  live `|median bias|` <= 10 ms and p90 within ±20%, n >= 200.
  Price-to-beat has one sample per market and a seconds scale, so it follows
  the rule decided at gate 4 for seconds-scale components (01 §12.1 item 7).
  The report also gives, without threshold, the p99 relative error and the
  lag-1 autocorrelation of consecutive latencies: independent draws plus F-52
  reproduce head-of-line blocking but not multi-second congestion episodes,
  and the autocorrelation shows whether that matters.
  `51-calibration-plan.md` §12.3 owns the component table; these three legs
  MUST appear in it. Whether p99 becomes a pass threshold is gate-4
  question 1.
- **F-56 Re-measurement after the PolyBolt switch.** The 2026-07-21 constants
  predate the 2026-09-15 RTDS-to-PolyBolt switch (Binance: 2026-07-16). They
  stay the ts-compat values permanently (F-48) and remain the realistic
  default until a fitted set replaces them. M10 fits all three legs per F-54
  from PolyBolt-era journals and V4 receipts, publishes them under a new
  `calibrationId` (F-57) and reports them in the gate-3 report as C7
  components (F-55). The
  fitted set becomes the realistic default only through a deliberate commit
  after gate 3 (51 §13); it changes realistic results on historical data and
  makes realistic feed timing seeded-random, which every run records through
  `ModelConfig.feeds.calibrationId`.

## 10. Missing data and coverage errors

Classes, causes, the reason format `<class>: <cause>: <message>` and the
retry policy are those of `20-binary-protocol.md` §4 (§4.1-§4.3); the causes
below are the subset feeds use, so a deterministic upstream hole is
distinguishable from a damaged local copy. TS today retries every thrown
error three times; classes change retry behavior, never results.

| Class | Causes used by feeds | Retried |
|---|---|---|
| `invalid_input` | `unsupported_feed`, `symbol`, `window`, `model_config`, `feed_availability` | never |
| `runtime` | `decode_unverified` (a day file that fails to decode; day files carry no sha256) | yes, any worker |
| `data_missing` | `day_file_missing`, `integrity_mismatch` (size differs from `feedFiles`) | yes, any worker after sync |
| `data_defect` | `corrupt`, `pre_coverage`, `upstream_hole`, `pipeline_incomplete` | never |

| Condition | Class (cause) | Message MUST name | Evidence |
|---|---|---|---|
| Binance day file missing (normally caught by the TS shim before spawn) | `data_missing` (`day_file_missing`) | missing dates; worker R2-pull and producer download commands | `binanceAggTradesSource.ts:61-68` |
| Binance: no trade up to window end | `data_defect` (`corrupt`) | dates; `binance:download-aggtrades ... --force` | `:108-119` |
| Binance price non-finite or <= 0 | `data_defect` (`corrupt`) | pair, agg id | F-17 |
| Binance seed-only window | warning only | file to verify | `:120-132` |
| Chainlink window before coverage floor | `data_defect` (`pre_coverage`) | floor; `--from-ms 1775088000000` | `chainlinkCryptoPricesSource.ts:69-76` |
| Chainlink day file missing (the shim adds the publication-lag hint for today/yesterday UTC) | `data_missing` (`day_file_missing`) | dates; R2-pull and download commands | `:86-104` |
| Chainlink: no round up to window end | `data_defect` (`corrupt`) | dates; `--force` re-download | `:161-170` |
| Chainlink NULL/<= 0 broadcast ts, bad price, wrong asset | `data_defect` (`corrupt`) | asset, round ts | F-25 |
| Chainlink in-window hole >= `maxGapMs` | `data_defect` (`upstream_hole`) | hole start and length; the `maxGapMs: 0` option | `:238-247` |
| PTB unavailable | from `feedAvailability` (§6.2) | from the job | `wireBacktestExternalFeeds.ts:310-342` |
| Window not derivable while feeds are requested | `invalid_input` (`window`) | slug | `:188-193` |
| Feed symbol not derivable or mismatched (§11.1) | `invalid_input` (`symbol`) | slug, symbol | `:203-210,252-256` |
| Any V4-only feed request (v1, §7.4); legacy RTDS Binance on V4 | `invalid_input` (`unsupported_feed`) | feed | `:176-181`, `feedState.ts:294-298` |
| Day file fails to decode, or its size differs from `feedFiles` | `runtime` (`decode_unverified`) / `data_missing` (`integrity_mismatch`) | file path | §4.1 |
| Captured-feed coverage gap | not an error: `incomplete_capture` skip (`15-inputs.md` §5.3) | coverage reasons | `runSingleMarket.ts:433-448` |

## 11. Symbols and boundary shapes

### 11.1 Symbol resolution

- **F-49** Feed symbols follow the traded market: `btc` -> Binance `btcusdt`
  (pair `BTCUSDT`), Chainlink `btc/usd`, asset id `btcusd`, PTB symbol `BTC`
  (`wireBacktestExternalFeeds.ts:199-265`). An explicit symbol in a Rust feed
  request is allowed only when it equals the derived one; otherwise
  `invalid_input`. TS feeds a mismatched explicit symbol with a warning; that
  difference is an intended change (no v1 strategy needs a foreign symbol).

### 11.2 TS-shape mapping (trace, `describe`, WebUI)

| Rust field | TS JSON |
|---|---|
| Binance spot point | `binanceWsSpotPrice: {symbol, tsMs, value, receivedAtMs}` |
| Chainlink spot point | `rtdsPolymarketCryptoPrices.chainlink: {symbol, tsMs, value, receivedAtMs}`; historical inputs always emit `rtdsPolymarketCryptoPrices: {}` |
| Price to beat | `polymarketPriceToBeat: {symbol, eventStartTimeIso, endDateIso, openPrice, receivedAtMs[, apiTimestampMs]}` |
| Feed request | `ExternalFeedsRequestConfig` (`ExternalFeedsRequestPlugin.ts:5-35`) in `describe.requiredFeeds`, so producer eligibility works unchanged |

## 12. Plugins

### 12.1 Contract (normative)

- **P-1** A plugin is a deterministic tick observer with a typed snapshot. It
  does no I/O, reads no clock other than the tick's decision time
  (`12-engine-core.md`), reads no env, and no iteration over a randomly
  seeded hash container may affect its output.
- **P-2** Transcendental math that can affect decisions (`ln`, `exp`, `pow`)
  MUST use the pure-Rust `libm` crate, not the OS libm, for byte-identical
  results across fleet macOS versions (WIP uses `.ln()` from the OS:
  `native/crates/pmb-core/src/plugins/technical_indicators.rs:281`).
  `sqrt` is IEEE-exact and may use the standard library.
- **P-3** Plugin instances are created per strategy instance (per candidate)
  at market start and reset per market. A strategy declares its plugins at
  creation; the SDK shape is in `30-strategy-sdk.md`.
- **P-4 Update timing** follows `12-engine-core.md`: plugins update once per
  tick, after the tick's book event, simulator step and account cascade, and
  before the strategy tick callback; the snapshot is then fixed for every
  callback until the next tick (`src/trading/StrategyRunner.ts:326-459`;
  TS caches it at `:436-437`). Feeds are not a plugin in Rust; the engine's
  feed view replaces `ExternalFeedsRequestPlugin` and has no
  `structuredClone` per tick (`ExternalFeedsRequestPlugin.ts:81-87`).
- **P-5 Window.** ts-compat: plugins observe only ticks that pass the window
  gate (TS skips the runner for out-of-window ticks,
  `runSingleMarket.ts:306-315`). Realistic: plugins also observe pre-window
  real ticks without strategy calls while the session is Warming, and no
  ticks after `end` (D23, 12 §5.2, §5.4). This applies to every input with
  pre-window data: telonex-delta's pre-window rows and V4 envelopes received
  before `start`, which realistic keeps (15 I-24).
- **P-6 Sharing.** All v1 plugins are pure functions of the recorded market
  input (the `SharedMarket` books, 12 §2.1), the tick clock, their config and
  market identity; they never read a candidate's overlay (13 §6.11). The
  engine MAY compute one instance per distinct config per market read and
  share its snapshot read-only across candidates (41 §5, 16 CG-3); the test
  of §13 V-7 MUST show identical outputs to per-candidate instances before
  this is enabled. Live plugins read the WS book, which includes our own
  resting orders; that difference is expected and appears in the
  live-vs-backtest attribution (50 §13.5).
- **P-7 Absence is visible.** A plugin that cannot compute (for example TA
  with too few candles) yields a typed "unavailable" state with a reason,
  counted in diagnostics; it never substitutes a value. In the TS-shape view
  the key is absent, as in TS.
- **P-13 Change generations.** Each plugin instance and each requested feed
  of the feed view carry a `u64` generation that increments exactly when the
  value visible to the strategy changes: a plugin snapshot differs from the
  previous one (field-wise; `f64` compared by bit pattern; availability state
  included), or a feed's visible point changes (`value`, `tsMs` or
  `receivedAtMs`, or key presence). Generations are engine-internal (not in
  the TS-shape view) and feed the tick interest filter that new Rust
  strategies may declare (D41; 16 §9.4 TF-2 (d), (e); 30 §4.1). Plugins still
  update on every tick (16 TF-3); only the snapshot build for a skipped
  callback is lazy.

### 12.2 v1 plugin set

All four plugins of the project direction are in v1 (D19 as amended at
gate 1; `01-scope-milestones.md` §4), with TechnicalIndicators candles built
from local aggTrades and never from the network (§12.5). Deribit is out of
scope.

| Plugin (TS id) | Config | Observes synthetic ticks | Key semantics | Evidence |
|---|---|---|---|---|
| `timeWindowVolatility` | `windows {label: ms}`, `trackPrice` bid/ask/mid (default mid) | no (one sample per real tick; synthetic samples would bias statistics) | per outcome, rolling time windows with running sums and monotonic min/max deques; ready iff coverage >= 0.93 x window and n >= 6, else last ready values with `staleMs` | `src/strategy/plugins/TimeWindowVolatility.ts:199,295-347`; WIP `plugins/volatility.rs:94-247` |
| `dwellGate` | `from`, `to`, `requiredMs`, `trackPrice` bid/ask | yes | per outcome in-range state, elapsed and remaining dwell, `dwellUpOk/dwellDownOk` | `src/strategy/plugins/DwellGatePlugin.ts:170-273` |
| `timeWindowGate` | `allowAfterMs`, `disableAfterMs` | yes | `withinWindow`, `startMs` (market start from the job), `nowMs`, `elapsedMs` | `src/strategy/plugins/TimeWindowGatePlugin.ts:90-150` |
| `technicalIndicators` | none (BTCUSDT) | no | §12.5 | `TechnicalIndicatorsPlugin.ts:37-66,215-300` |

### 12.3 Clock for time-based plugins

Plugins read the tick's decision time. In ts-compat on telonex-delta this is
TS `snapshot.timestamp`: the exchange time for real ticks and the clamped stamp
`S` for synthetic ticks, including the documented sawtooth
(`docs/backtest/adr-binance-driven-ticks.md:67-73`). Realistic uses `now`,
which is monotone (12 §4.2).

### 12.4 Gates and dwell on synthetic ticks

DwellGate and TimeWindowGate opt in because their outputs depend only on time
and the current book; synthetic ticks improve their time resolution. A
non-monotone decision time near a threshold MUST behave exactly as TS (the TS
gates compute from the timestamp and tolerate the sawtooth).

### 12.5 TechnicalIndicators from local aggTrades (offline candles)

- **P-8** Candles are built from the same local aggTrades day files as the
  Binance feed, never from the network (D19). A 1h or 15m candle with open time
  `o` covers trades with `o <= ts_ms <= o + interval - 1`: open/close = first/
  last trade in `agg_trade_id` order, high/low = max/min price, volume = sum of
  `qty`, `closeTime = o + interval - 1`.
- **P-9** As of `t0 - 1` (`t0` = market start from the slug), use the last 160
  closed 1h candles and the last 40 closed 15m candles (2 x the longest
  period: `TechnicalIndicatorsPlugin.ts:37-66`). The last 15m candle MUST close
  at exactly `t0 - 1`, else unavailable (`:272-277`). Indicator definitions
  equal the `technicalindicators` npm package as the WIP already reproduces
  (Wilder ATR with SMA seed, ADX via Wilder sums, population-SD Bollinger,
  realized volatility; WIP `technical_indicators.rs:192-405`).
- **P-10** The snapshot is computed synchronously before the first strategy
  callback of the market. This equals TS with
  `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1` when the fetch succeeds
  (`src/trading/StrategyRunner.ts:404-434`); TS without the wait is
  nondeterministic and is not a parity target (classified "TS
  nondeterminism"). The env variables are not used.
- **P-11** Markets whose slug is not a 15m BTC up/down slug yield
  "unavailable" in both profiles (TS: `parseUpDown15mSlugEpochMs`,
  `TechnicalIndicatorsPlugin.ts:220`). The WIP hardcodes the 15m prefix
  separately from `slug.rs` (`technical_indicators.rs:180-183`); the rewrite
  MUST use the single slug parser. Extending TA to 5m markets is a model
  change that needs a new 02 entry (00 R11); no v1 strategy needs it.
- **P-12** Data requirement: aggTrades days covering `[floorHour(t0) - 160 h,
  t0)` (160 closed 1h candles plus the last 10 h of 15m candles). `describe`
  exports this lookback so the producer preflight requires those days (D19).
  Candles are derived in process from those day files and cached per day
  (PF-5); about 7 days of aggTrades are decoded once per cold process. A
  separate derived candle dataset is introduced only if the 16 §13
  measurements show candle building is a material share of job time.

## 13. Verification (feeds and plugins)

Parity sets, classification rules and the pinned TS oracle are in
`60-verification.md`. Feed- and plugin-specific gates:

- **V-1 Loader goldens.** A TS generator runs the real TS loaders over fixture
  day files (small synthetic files plus excerpts of real days) and records the
  series arrays, seed presence and error class; Rust MUST match exactly.
- **V-2 Timeline goldens.** A TS generator drives
  `createBacktestExternalFeedsProvider`, `buildSyntheticTickSchedule` and
  `createSyntheticFlusher` over synthetic clock sequences that include
  backward local clocks, equal timestamps, events before the first book,
  out-of-window real ticks and the tail flush; Rust MUST reproduce every
  per-tick snapshot (key presence, `tsMs`, `value`, `receivedAtMs`) and the
  dispatch order exactly.
- **V-3 Trace parity.** The parity trace (`22-trace-ledger-journal.md`) MUST
  record, per tick, the visible feed fields and plugin snapshots (TS
  `src/backtest/parity/trace.ts` records only the tick cause today). A
  feed exerciser (60 §5.8: TS and Rust, same schedule as the engine
  exerciser plus requests for all three historical feeds and all four
  plugins, run once with `tickOnUpdate` on and once off) MUST match exactly
  on the parity market set (cells F15-on, F15-off, F15-TA of 60 §4.1; BTC 5m
  cells wait for the Telonex renewal, D38).
- **V-4 Captured-feed goldens.** The TS reducer, selection and
  `OpeningReferenceTracker` run over envelopes from real V4 packages plus
  crafted invalid, history-snapshot, correction and conflict envelopes; Rust
  MUST match.
- **V-5 Plugin goldens.** Keep and extend the WIP generator
  (`native/crates/pmb-core/tests/fixtures/plugins_gen.ts`, which runs the real
  TS plugins): add sawtooth timestamps, missing sides, non-finite timestamps
  and long synthetic runs. Tolerance: integers exact, floats relative 1e-9.
- **V-6 TA.** (a) For at least 50 sampled market starts, aggTrades-built 1h
  and 15m candles MUST equal Binance REST klines in OHLC (fixtures captured
  once by a TS script; the network is used only by the fixture generator);
  volume within relative 1e-9. (b) Indicator outputs on identical candles
  match the TS plugin within relative 1e-9.
- **V-7 Properties.** Lookback invariance (§4.3); `tickOnUpdate` off equals a
  run without schedule; Volatility output unchanged by synthetic ticks; shared
  plugin instances equal per-candidate instances; identical outputs with a
  cold or warm day cache and with any thread count; P-13 generations change
  iff the strategy-visible value changes (checked against a full snapshot
  comparison on every tick of the parity set).
- **V-8 Latency self-tests** (as the TS harness,
  `parity-harness.md:69-77`): replaying with a feed latency shifted by +X ms
  shifts every feed transition by +X ms, and replaying twice gives zero
  difference.
- **V-9 Error matrix.** Every row of §10 has a test asserting class and the
  required message content.
- **V-10 Latency distributions (§9.1).** (a) Realistic with `constant`
  latencies reproduces the ts-compat feed timeline exactly on days whose
  `ts_ms` is non-decreasing in id order. (b) Visibility is non-decreasing in
  series order and schedule order equals series order per feed. (c) A given
  element gets the same draw across markets, lookbacks (60, 300, 900 s),
  thread counts, candidate counts and group compositions; a 5m market and
  the overlapping 15m market show identical visibility for every shared
  in-window element. (d) Over one full Binance day, the p1..p99 quantiles of
  the drawn latencies are within 1 ms of the configured `empirical` table.
  (e) Adding X ms to every quantile shifts every feed transition by X ms
  (V-8 for distributions). (f) The feed rows of the 10 RNG-7 golden vectors
  (`feed_stream_seed`, both entity encodings, price-to-beat) pass.
- **V-11 Realistic clock.** On telonex-delta realistic, feed visibility,
  the synthetic flush and synthetic stamps use `R` (§3.1, F-40, F-41): a
  golden replays a fixture with `md` and the feed latencies fixed to
  constants and checks that every feed transition and synthetic stamp equals
  the ts-compat rules evaluated with `C(t) := R_t` and `E(last real tick) :=
  R(last real tick)` (on days where V-10 (a) applies).

## 14. Performance requirements

Speed is the top priority (01 §1 item 6, §2). Targets are measured,
not thresholds (D07). Overall process, thread and cache model, budgets and
benchmark conditions: `16-performance-and-parallelism.md` (§6, §13).

- **PF-1 Shared day caches.** Decoded day files are immutable values in a
  per-process cache indexed by `(dataset, symbol or asset, UTC date)` and
  validated by the file identity of 16 §6.1 (path, size, mtime), shared
  (`Arc`) across markets, candidates and threads, loaded once per key even
  under concurrent requests, and evicted by a byte-capped LRU that never drops
  an entry in use. One BTCUSDT day (about 0.95 M trades, 7.3 MB on disk) is
  about 23 MB decoded as `(i64, i64, f64)`; one day serves 96 15m and 288 5m
  markets. TS re-opens day files through DuckDB for every market and
  candidate (`binanceAggTradesSource.ts:70-86`,
  `chainlinkCryptoPricesSource.ts:106-125`).
- **PF-2 Zero-copy market slices.** A market's Binance series is an index range
  into the cached day plus a seed index, found by binary search, when the day
  is verified (once, at load) to have non-decreasing `ts_ms` in id order;
  otherwise a filtered copy implements F-13 exactly. Chainlink membership is by
  round time and order by broadcast, so its market series is a small filtered
  copy (about 1.5 k rows for a 15m market).
- **PF-3 Cold single-market path.** When the process handles one market, the
  loader reads only row groups whose `ts_ms` statistics overlap the range plus
  the seed groups (WIP `native/crates/pmb-replay/src/pq.rs:140-177`), instead
  of decoding whole days.
- **PF-4 Per tick.** Cursor advance is amortized O(1); the feed view is a small
  `Copy` value; no allocation and no snapshot clone per tick.
- **PF-5 Candles.** TA candles are cached per `(pair, interval, date)`; raw
  trades loaded only for candles are not retained.
- **PF-6 Decode work off the hot path.** Day loading is pure; the scheduler
  (`16-performance-and-parallelism.md` §5.3) MAY prefetch the next markets'
  day files on other threads. Feed code MUST NOT create its own threads.
- **PF-7 Measurements** reported per market in diagnostics
  (`21-job-and-output-contract.md`): feed load time (cold or warm), day-cache
  hits and misses, bytes decoded, synthetic ticks scheduled and dispatched,
  visibility-build time, plugin time.
- **PF-8 Drawn visibility.** With `constant` latencies visibility stays
  computed on the fly from the zero-copy slice (PF-2). With a non-constant
  kind, the market's visibility vector (one `i64` per series element; a 15m
  Binance slice spans about 1,200 s, about 13 k trades at the 11 trades/s
  average of the §4.1 sample day) is built once per market read in
  one pass (keyed draw plus inverse CDF per element, F-51/F-52), shared
  read-only by all candidates, and never rebuilt per tick or per candidate.

## 15. Ownership and WIP salvage

| Responsibility | Owner |
|---|---|
| Resolve `ModelConfig.feeds` from the calibration file (F-57), persist it on the run | TS producer (`21`, `42`) |
| Fit and commit new feed calibration files (F-54, F-56) | M10 analysis tooling (`51`) |
| Resolve price-to-beat into the job (§6.2) | TS producer |
| Preflight day files from `describe`-exported constants and resolved symbols | TS producer (`src/cli/backtest.ts:988-1098` logic kept) |
| Make day files present locally; list them in `feedFiles`; fail missing days as `data_missing` before spawn | TS shim / dataset commands (`21` §9, `40`) |
| Load, validate, build timelines, compute plugins | Rust binary |

WIP (frozen reference, D01): keep `feeds/binance.rs`, `pq.rs` and the measured
defaults of `feeds/mod.rs` after review; delete `FeedSettings::from_env` and
`DataRoots::from_env` (`feeds/mod.rs:59-122`) and `FeedContext.now_ms`
(`:225-226`); write the missing `chainlink`, `price_to_beat`, `schedule` and
`state` modules (declared at `feeds/mod.rs:12-16`, absent on disk) against the
TS oracle; keep the plugin math and `plugins_golden.json`; redesign the plugin
container (`native/crates/pmb-core/src/plugins.rs:85-190`) to follow §12.1.

## 16. Changes required in other documents

None open: every item was applied in the gate-1 consolidation.

## Gate-4 questions

Deferred to gate 4 (D56); they block no work before M9. The canonical list is
`01-scope-milestones.md` §12.1; the items that touch this document:

1. **p99 as a pass threshold for feed legs** (01 §12.1 item 7, calibration
   threshold additions). D35 judges latency components on median bias and
   p90 only; for lag-sniping strategies the feed tail is where the edge is
   decided. Should the Binance and Chainlink legs also have to match p99
   (proposal: within ±30%, n >= 2,000, which the feeds reach in minutes)
   before realistic becomes default, or does p99 stay report-only (F-55)?
2. **Fitting sources** (01 §12.1 items 2 and 3): the calibration/live host is
   F-54's primary source; without agent-run paper sessions on an
   empty-wallet API key, Chainlink-leg journals come only from user-launched
   sessions. Worker-2 V4 receipts (F-54 secondary source) are available
   either way.

## Open questions

None. Resolved at gate 1 (D56): the realistic feed clock (12 §4.3, §3.1);
V4-only feeds (D43, §7.4); the TA candle source (P-12) and 15m-only TA
(P-11); feed re-measurement after the PolyBolt switch (F-56).
