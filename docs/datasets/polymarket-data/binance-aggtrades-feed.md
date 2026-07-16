# Binance aggTrades Feed for Backtests

Makes the live-only `ctx.plugins.externalFeeds.binanceWsSpotPrice` feed
available in backtests via a point-in-time (as-of) lookup over historical
`data.binance.vision` daily aggTrades dumps — the **same event stream** the
live WS client (`<symbol>@aggTrade`) consumes.

Source decision and Chainlink follow-up: [Backtest Price Feeds](./price-feeds-for-backtests.md).

## Usage

```bash
# 1. Fetch + convert daily dumps to parquet (idempotent, atomic, sha256-verified)
npm run binance:download-aggtrades -- --pair BTCUSDT --from 2026-06-01 --to 2026-06-14
# (--symbol btc → BTCUSDT; --dry-run for preflight; --force to re-download)

# 2. Run a backtest with the feed
npm run backtest -- --strategy <id> --input-mode telonex-delta --read-from local \
  --symbol btc --timeframe 15m --limit 50 --feeds binance
```

`--feeds binance` is **opt-in and default-off**: without the flag, not a single
feed statement executes — existing backtests are bit-identical to before.
Works with every input mode (telonex modes use the precise `strategyWindow`;
recorded mode derives the window from the file slug) and every timeframe
(5m/15m/1h/4h/1d — the feed only needs coverage of the market window).

## How it works

- The strategy declares its feeds via `ExternalFeedsRequestPlugin` (same as
  live). With `--feeds binance`, `runSingleMarket` fulfills that plugin with an
  as-of provider before replay starts
  (`src/backtest/feeds/wireBacktestExternalFeeds.ts`).
- Per market, the provider loads the aggTrade prices covering
  `[windowStart − lookback, windowEnd]`
  (`src/backtest/feeds/binanceAggTradesSource.ts`, DuckDB over the day
  parquet) and answers each tick with the latest trade whose
  `T + latencyOffset ≤ tick ts_exchange_ms`
  (`src/backtest/feeds/backtestExternalFeedsProvider.ts`).
- The snapshot shape is identical to live (`ExternalFeedsSnapshot`):
  `rtdsPolymarketCryptoPrices: {}` always present; `binanceWsSpotPrice` absent
  until the first visible trade (live: absent until the first WS message);
  same-ms trades resolve to the highest agg id (live last-write-wins).
- **Missing day files are a hard error** naming the exact download command.
  An opted-in backtest silently running feed-less would recreate the exact
  live/replay divergence this feature eliminates. Distributed workers need the
  day files on their local disk (the producer preflight warns early).

## Semantics vs live (read before trusting results)

- **Prices are bit-identical**: the dump CSV carries the same decimal strings
  the WS sends; parquet stores `DOUBLE` = IEEE-754 parse = live `Number(agg.p)`.
- **`tsMs`** is the aggTrade trade time `T` — identical live and replay.
- **`receivedAtMs`** is *modeled* in replay (`T + latencyOffset`); live it is
  wall-clock arrival. No current strategy consumes it.
- **Latency model**: live, a trade at exchange time `T` reaches the bot a few
  ms later. `BACKTEST_BINANCE_FEED_LATENCY_MS` shifts visibility accordingly.
  The default is derived from the measured live distribution (see below).

## Env vars

| Var | Default | Meaning |
|---|---|---|
| `BACKTEST_BINANCE_FEED_LATENCY_MS` | `85` (measured p50, see below) | trade visible at `T + offset`; also sets `receivedAtMs` |
| `BACKTEST_BINANCE_FEED_LOOKBACK_MS` | `300000` | pre-window load margin so a value exists at the first tick |
| `BINANCE_DATA_BASE_DIR` | `data/binance` | data root (repo-root-anchored when relative) |

## Verification tooling (backtest == live, proven)

```bash
# Record the LIVE WS stream (full aggTrade fields + local receive time)
npm run binance:record-aggtrades -- --pair BTCUSDT           # hourly parquet rotation

# Next day (dumps publish with ~1-day lag): join recorded vs dump
npm run binance:verify-aggtrades -- --pair BTCUSDT --date <YYYY-MM-DD> --download --check-asof
```

The verify CLI full-outer-joins the recording against the dump on
`agg_trade_id` inside the overlap window (WS-disconnect gaps from the status
jsonl are excused with ±2s margin) and exits non-zero unless:

- 0 price / qty / trade-time mismatches,
- 0 recorded rows absent from the dump,
- 0 dump rows absent from the recording outside excused gaps,
- (with `--check-asof`) 0 mismatches between the provider's as-of answer and
  a reference SQL query over 1000 sampled timestamps.

It also prints the live latency distribution (`received_at_ms − ts_ms`
p50/p90/p95/p99) — the empirical input for `BACKTEST_BINANCE_FEED_LATENCY_MS`.

### Measured latency (2026-07-16, BTCUSDT, recorded on the trading machine)

| metric | ms |
|---|---|
| p50 | **85** ← `BACKTEST_BINANCE_FEED_LATENCY_MS` default |
| p90 | 334 |
| p95 | 346 |
| p99 | 519 |
| min / max | 59 / 3507 |

First-hour sample (8.9k trades); re-measure any time with
`binance:verify-aggtrades` (it prints these percentiles) and override the env
var if your machine/network differs.

## Data layout

```
data/binance/aggTrades/<PAIR>/<PAIR>-aggTrades-YYYY-MM-DD.parquet   # converted dumps
data/binance/recordings/aggTrades/<PAIR>/...-live-YYYY-MM-DDTHH.parquet
data/binance/recordings/aggTrades/<PAIR>/<PAIR>-status.jsonl        # connect/disconnect log
data/binance/tmp/                                                   # scratch (auto-cleaned)
```

Dump parquet schema: `agg_trade_id BIGINT, price DOUBLE, qty DOUBLE,
first_trade_id BIGINT, last_trade_id BIGINT, ts_ms BIGINT, is_buyer_maker
BOOLEAN`, ordered by `agg_trade_id`. Timestamps are normalized to
**milliseconds** (daily spot dumps switched to microseconds on 2025-01-01;
`floor(µs/1000)` equals the WS `T` exactly — proven by the verify CLI).

## Gotchas

- **~1-day publication lag**: `data.binance.vision` daily dumps appear the next
  day. The newest market windows can't run with `--feeds binance` yet; the
  downloader warns (instead of failing) for the trailing 2 days.
- **UTC midnight**: windows crossing midnight load two day files —
  `utcDatesCovering` in `src/binance/paths.ts` is the single place that logic lives.
- **`--extend` + `--feeds` is rejected**: parent runs don't record the flag, so
  an extension can't safely inherit it.
- **Symbol comes from the strategy config** (`binanceWsSpotPrice.symbol`), not
  the market slug — exactly like live. A mismatch logs a loud warning.

## Adding the Chainlink feed later (the seam)

1. Ingest the Telonex `crypto_prices` channel (needs `TELONEX_API_KEY`) into a
   day-partitioned parquet series.
2. Add a series-source module next to `binanceAggTradesSource.ts`.
3. Pass it to `createBacktestExternalFeedsProvider` as a new arg and emit it
   under `rtdsPolymarketCryptoPrices.chainlink`.
4. Register `chainlink` in the `--feeds` validator (`backtestArgs.ts`).

No other plumbing changes — the request-plugin fulfillment, job field, and
window derivation are feed-agnostic.
