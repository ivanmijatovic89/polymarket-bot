# Binance aggTrades Feed for Backtests

Makes the live-only `ctx.plugins.externalFeeds.binanceWsSpotPrice` feed
available in backtests via a point-in-time (as-of) lookup over historical
`data.binance.vision` daily aggTrades dumps — the **same event stream** the
live WS client (`<symbol>@aggTrade`) consumes.

Source decision and Chainlink follow-up: [Backtest Price Feeds](./price-feeds-for-backtests.md).
Day-to-day cron/incident checklists: [Operations Runbook](./binance-aggtrades-operations.md).

## Usage

```bash
# 1. Fetch + convert daily dumps to parquet (idempotent, atomic, sha256-verified)
npm run binance:download-aggtrades -- --pair BTCUSDT --from 2026-06-01 --to 2026-06-14
# (--symbol btc → BTCUSDT; --dry-run for preflight; --force to re-download)

# 2. Run a backtest — no flag needed
npm run backtest -- --strategy <id> --input-mode telonex-delta --read-from local \
  --symbol btc --timeframe 15m --limit 50
```

The feed is **strategy-driven, exactly like live**: a strategy that registers
`ExternalFeedsRequestPlugin` with a `binanceWsSpotPrice` request gets the feed
fulfilled automatically — declaring the plugin IS the opt-in; there is no CLI
flag. Strategies without the plugin replay exactly as before (bit-identical).
Works with every input mode (telonex modes use the precise `strategyWindow`;
recorded mode derives the window from the file slug) and every timeframe
(5m/15m/1h/4h/1d — the feed only needs coverage of the market window).

## How it works

- The strategy declares its feeds via `ExternalFeedsRequestPlugin` (same as
  live). `runSingleMarket` fulfills that plugin with an as-of provider before
  replay starts (`src/backtest/feeds/wireBacktestExternalFeeds.ts`).
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
  A feed-declaring strategy silently replaying feed-less would recreate the
  exact live/replay divergence this feature eliminates. Distributed workers
  need the day files on their local disk (the producer preflight warns early).

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
| `BACKTEST_BINANCE_FEED_LATENCY_MS` | `110` (measured p50, see below) | trade visible at `T + offset`; also sets `receivedAtMs` |
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
| p50 | **110** ← `BACKTEST_BINANCE_FEED_LATENCY_MS` default |
| p90 | 171 |
| p95 | 254 |
| p99 | 397 |
| min / max | 59 / 3507 |

48k-trade sample over ~105 min (verified 100% identical to the exchange
record — 0 mismatches, 0 missing). Re-measure any time with
`binance:verify-aggtrades` (it prints these percentiles) and override the env
var if your machine/network differs.

## Distribution: producer → R2 → workers

Day files are immutable once Binance publishes them, so the whole sync
protocol is skip-if-exists on both hops — no DB index, the (pair, date) pair
determines every path and key.

```bash
# Producer (data machine, daily cron):
npm run binance:download-aggtrades -- --pair BTCUSDT --sync   # eligibility floor −1 → yesterday, missing only
npm run binance:upload-aggtrades-r2 -- --pair BTCUSDT         # mirror new files to R2

# Each worker (before backtests / own cron):
npm run binance:download-aggtrades-r2-to-local -- --pair BTCUSDT
```

- `--sync` always scans the FULL expected range
  (`TELONEX_DATASET_ELIGIBLE_FROM − 1 day` → yesterday) and downloads whatever
  is missing — self-healing: a day that failed mid-run, was skipped while
  unpublished, or was deleted locally is retried on the next run, and lowering
  the eligibility floor backfills automatically.
- R2 keys mirror the local layout: `binance/aggTrades/<PAIR>/<PAIR>-aggTrades-<date>.parquet`.
- Uploads are Content-MD5-validated server-side, and the skip-if-exists check
  compares sizes on BOTH hops (upload and worker pull), so a locally
  regenerated day file (converter fix) propagates end-to-end on the next cron
  runs. Limitation: the drift check is size-based — a regenerated file that
  lands on the identical byte size is not detected; pass `--force` after a
  converter fix if that's plausible. Worker downloads are atomic (tmp→rename)
  with retries and size validation against the R2 listing. All three commands
  support `--dry-run` preflights.
- **The feed loader itself never touches the network** — a missing local file
  is a hard per-market error by design, so the data pipeline stays auditable.
- Additional pairs (ETH/SOL/XRP) are the same three commands with a different
  `--pair`.

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
  day. The newest market windows can't replay with the feed yet; the
  downloader warns (instead of failing) for the trailing 2 days.
- **UTC midnight**: windows crossing midnight load two day files —
  `utcDatesCovering` in `src/binance/paths.ts` is the single place that logic lives.
- **`--extend` inherits the feed automatically**: the feed follows the
  strategy, and extensions inherit the parent's strategy — no extra handling.
- **Pair follows the traded market by default**: `binanceWsSpotPrice: {}`
  (no symbol) derives the pair from `TRADING_SYMBOL` live and from the market
  slug in backtests, so one strategy works on BTC/ETH/SOL/XRP. An explicit
  `binanceWsSpotPrice.symbol` overrides it — exactly like live — and a
  slug/config mismatch logs a loud warning. The live-only `rtdsCryptoPrices`
  request works the same way: `{}` derives `<symbol>usdt` / `<symbol>/usd`
  from `TRADING_SYMBOL`, explicit lists win.
- **Quiet gaps don't drop the feed**: the loaded series is seeded with the
  latest trade before the coverage window, mirroring the live store's
  retain-last-price-forever semantics; day files with zero trades up to the
  window end are a hard error (empty/corrupt data), like missing files.

## Adding the Chainlink feed later (the seam)

1. Ingest the Telonex `crypto_prices` channel (needs `TELONEX_API_KEY`) into a
   day-partitioned parquet series.
2. Add a series-source module next to `binanceAggTradesSource.ts`.
3. Pass it to `createBacktestExternalFeedsProvider` as a new arg and emit it
   under `rtdsPolymarketCryptoPrices.chainlink`, gated on the strategy's
   `rtdsCryptoPrices.chainlinkSymbols` request.

No other plumbing changes — the request-plugin fulfillment and window
derivation are feed-agnostic.
