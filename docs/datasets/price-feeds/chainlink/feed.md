# Chainlink crypto_prices Feed for Backtests

Makes the live-only `ctx.plugins.externalFeeds.rtdsPolymarketCryptoPrices.chainlink`
feed available in backtests from the Telonex `crypto_prices` channel — the
**Chainlink oracle rounds Polymarket displays and resolves crypto markets
with**, broadcast by Polymarket's RTDS and archived by Telonex.

Source decision: [Backtest Price Feeds](../overview.md).
Day-to-day cron/incident checklists: [Operations Runbook](./operations.md).

## Usage

```bash
# 1. Fetch day files (idempotent, integrity-gated; needs TELONEX_API_KEY)
npm run telonex:crypto-prices:download -- --asset btcusd --sync

# 2. Run a backtest — no flag needed
npm run backtest -- --strategy <id> --input-mode telonex-delta --read-from local \
  --symbol btc --timeframe 15m --limit 50
```

The feed is **strategy-driven, exactly like live**: a strategy that registers
`ExternalFeedsRequestPlugin` with an `rtdsCryptoPrices` request gets the
chainlink sub-feed fulfilled automatically. Explicit `chainlinkSymbols` win;
an empty request (`rtdsCryptoPrices: {}`) follows the traded market
(`btc-updown…` → `btc/usd`), mirroring live's `TRADING_SYMBOL` derivation.
Strategies without the plugin replay bit-identically to before.

`rtdsPolymarketCryptoPrices.binance` has **no backtest source** (the channel
carries only the chainlink stream) and stays absent in replay — same as a live
run without that subscription. Strategies needing a Binance price use
`binanceWsSpotPrice` ([Binance aggTrades Feed](../binance/feed.md)).

## Waking the strategy on every round (tickOnUpdate)

`rtdsCryptoPrices: { tickOnUpdate: true }` additionally fires a synthetic
`onMarketTick` (event_type `chainlink_round`) on **every round** (~1/s), live
and replay identically — replay visibility uses the two-clock broadcast time
plus the measured bot leg described below. Full semantics and measured
verification: [Synthetic Feed Ticks](/datasets/price-feeds/synthetic-ticks).

## The two-clock model (the one structural difference vs the Binance feed)

Every Chainlink round carries two timestamps:

- **round time** (`timestamp_us`) — when the oracle produced the price. This
  is what live strategies see as `RtdsPricePoint.tsMs` (`payload.timestamp`).
- **broadcast time** (`server_timestamp_us`) — when Polymarket pushed it to
  RTDS subscribers. Measured p50 ≈ **1.0–1.2s AFTER the round time**
  (structural, exists live too).

Replay therefore keys **visibility** on
`broadcast time + BACKTEST_RTDS_CHAINLINK_LATENCY_MS` (the modeled
broadcast→bot network leg — measured, see below), while the emitted point
carries the **round time** as `tsMs` — exactly what live delivers. The ~1s
round→broadcast lag is data (`visibleAtMs` in the series), never part of the
env offset — don't double-count.

One live-correct oddity this reproduces: a late re-broadcast can make the
emitted round-`tsMs` step backwards across consecutive ticks (last-write-wins
in broadcast order, like the live store).

## Missing-data policy: hard error, everywhere

Unlike priceToBeat (absent-key for pre-epoch markets), the chainlink feed is
**hard-error in every case where a strategy requests it and data is
unavailable** (project decision — it is the resolution price):

| case | behavior |
|---|---|
| market before coverage (2026-04-02) | error: exclude with `--from-ms 1775001600000` or drop the request |
| day file within the ~1-day publication lag | error: run `--sync` later and retry |
| older day file missing | error naming the worker (`download-r2-to-local`) and producer (`download`) commands |
| day file empty/corrupt | error naming `--force` re-download |
| in-window data hole ≥ `BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS` (default 5min) | **error naming the hole** — data-driven, no hole list to maintain; set the env var to `0` to instead accept replaying on the frozen last-known price (the live-faithful behavior — live bots during upstream outages also saw a stale value) |

The producer preflight surfaces all of it at launch (including a pre-coverage
market count), so nothing is discovered one failed job at a time. Failures
land in `backtest_run_failures` → dashboard.

## Env vars

| Var | Default | Meaning |
|---|---|---|
| `BACKTEST_RTDS_CHAINLINK_LATENCY_MS` | `320` (parity-calibrated, see below) | broadcast→bot leg ONLY; visibility = `server_ts + offset` |
| `BACKTEST_RTDS_CHAINLINK_LOOKBACK_MS` | `300000` | pre-window load margin (seed row guarantees a value at tick 1) |
| `BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS` | `300000` | max tolerated in-window stale span before the market hard-errors; `0` disables (stale replay accepted) |
| `TELONEX_CRYPTO_PRICES_BASE_DIR` | `data/telonex/crypto_prices` | data root (repo-root-anchored) |

## Verification evidence

### Resolution replication (the strongest check)

`telonex:crypto-prices:verify --asset btcusd --resolution-check --timeframe 15m --limit 500`
derives UP/DOWN from `sign(chainlink@windowEnd − chainlink@windowStart)` and
compares against actual `telonex_markets` outcomes:

- **99.80% agreement** (496/497 decided; 3 exact ties)
- strike vs chainlink@open: **351/487 bit-exact**; outliers cluster around
  upstream outage windows (see below)
- finalPrice vs chainlink@close: 338/472 bit-exact, same outlier pattern

### Live == Telonex (recorded stream join)

`telonex:crypto-prices:verify --asset btcusd --date <D>` joins a live RTDS
recording (`telonex:crypto-prices:record-rtds`) against the Telonex day file
on the round time (both sides deduped last-per-round in broadcast order) —
acceptance is 0 value mismatches and 0 missing either side outside excused
disconnect/clock-jump gaps. It also prints both latency legs; the measured
p50 of `received_at − server_ts` is the recorder-level candidate for
`BACKTEST_RTDS_CHAINLINK_LATENCY_MS`.

Measured (2026-07-21, btcusd, 27,447 rounds over ~10.5h on the trading machine):

| leg | p50 | p90 | p95 | p99 | min/max |
|---|---|---|---|---|---|
| broadcast→bot (`received_at − server_ts`) | **235** (recorder-level) | 375 | 407 | 470 | −20 / 6109 |
| total round→bot (`received_at − round_ts`) | 1314 | — | — | — | — |

The two legs are consistent: total ≈ the ~1.0–1.2s structural round→broadcast
lag (carried as data in `visibleAtMs`) + this network leg.

The **env default is 320**, not 235: the feeds:parity harness (same day,
21 live 15m markets vs replay, boundary-lag bias at the strategy's eyes)
showed 235 left replay seeing chainlink transitions 86ms EARLY; 320 brought
the residual mean bias to 2ms. The recorder-level p50 varies with network
conditions and misses the in-bot processing between socket receive and
strategy visibility — the parity number is end-to-end, which is exactly what
the knob models. See [Parity Harness](../parity-harness.md).

### As-of correctness

`--check-asof`: 1000+ sampled timestamps (ascending with backwards jumps),
provider vs reference SQL, both offsets, checking value AND round-`tsMs` —
0 mismatches required.

### Unit tests

`npx tsx --test src/backtest/feeds/*.test.ts src/telonex/cryptoPrices/paths.test.ts`
covers the two-clock cursor semantics (visibility gating, re-broadcast
backwards round clock, ties, monotone clamp), loader ordering/seeding/µs→ms,
and every hard-error branch.

## Data layout & coverage

```
data/telonex/crypto_prices/<asset_id>/<asset_id>-crypto-prices-YYYY-MM-DD.parquet  raw Telonex day files
data/telonex/crypto_prices/recordings/<asset_id>/...                               live RTDS recordings
R2: telonex/crypto_prices/<asset_id>/<same filename>
```

Raw Telonex parquet stored as delivered (no conversion): `timestamp_us`,
`server_timestamp_us`, `local_timestamp_us`, `exchange`, `asset_id`, `symbol`,
`source`, `price` (VARCHAR, 18 decimals — `CAST AS DOUBLE` at load equals
live's `Number(payload.value)` bit-for-bit). ~1 round/s, ~3MB/day/asset.

- **Coverage from 2026-04-02** (all assets). btcusd fully backfilled +
  mirrored to R2 (109 days, 9.15M rounds, integrity-swept: 0 foreign rows,
  0 unparseable prices, 0 broadcast-before-round rows).
- **Known upstream holes** (source-side, live bots also saw nothing): a gap
  census over Apr–Jul 2026 btcusd found **34 intra-day gaps ≥5min** (~20h of
  dead time total, ~0.8%; largest 8.1h on 2026-06-11, 3.6h on 2026-06-10,
  clustered late-May/early-June). Impact on the market universe (btc):
  ~1.5% of 5m and ~0.9% of 15m coverage-window markets have their whole
  window inside a hole. Enforcement is **data-driven** — the loader measures
  the worst in-window stale span itself (no hole list to maintain), so this
  applies automatically to eth/sol/xrp once backfilled.
- eth/sol/xrp: same three commands with a different `--asset`.

## Gotchas

- **~1-day publication lag** — the newest windows can't replay with the feed
  yet; hard error says exactly that.
- **Downloads may be metered** (plan-dependent): 403 aborts the sync cleanly
  with a resume hint; progress is never lost (skip-if-exists).
- **Multi-symbol `chainlinkSymbols` lists**: backtest supports one symbol per
  market (live last-write-wins across symbols isn't reproducible); the first
  entry wins with a warning.
