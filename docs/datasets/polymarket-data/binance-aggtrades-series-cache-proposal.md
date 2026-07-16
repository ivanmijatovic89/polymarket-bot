# Proposal: per-day cache for the Binance aggTrades feed loader

**Status: proposal — not implemented.** This documents a possible performance
optimization for backtests that use the Binance external feed, so the decision
can be made when (if) the cost becomes noticeable.

## The problem, in plain terms

When a backtest market uses the Binance feed, the worker loads that market's
price series from the converted day file(s) on disk
(`loadBinanceAggTradesSeries` in `src/backtest/feeds/binanceAggTradesSource.ts`).

The load happens **once per market**, and each load opens the parquet day file
with DuckDB from scratch: parse the file footer, decompress the row groups,
filter the ~20-minute window, sort. A BTCUSDT day file holds roughly 1–3
million trades.

A 15-minute timeframe has up to **96 markets per calendar day**. A worker
child processes markets sequentially, so a 500-market batch re-opens and
re-scans the *same handful of day files* hundreds of times — each time
extracting a different 20-minute slice of data it already read on the
previous market.

## The proposed fix

Keep a small in-memory cache **per worker process**, keyed by
`(pair, UTC date)`:

1. First market touching `BTCUSDT 2026-07-15`: read the **whole day** into two
   `Float64Array`s (timestamps + prices) — one DuckDB scan, ~16 bytes per
   trade, so ~16–48 MB per cached day.
2. Every later market on that day: binary-search the two arrays for its
   `[windowStart − lookback, windowEnd]` slice — microseconds, no I/O.
3. Cap the cache at 2–3 days per pair (LRU): markets are dispatched roughly
   chronologically, so old days age out naturally.

No behavior change — the per-market series is bit-identical to what the
per-market query returns today; only the redundant re-reading disappears.

## What it buys, what it costs

| | Today (per-market query) | With cache |
|---|---|---|
| Parquet scans per 500-market batch | ~500 | ~6–8 (one per distinct day) |
| Feed-load overhead per market | ~100–500 ms (footer + decompress + filter) | ~0 after the first market of the day |
| Worker memory | ~0 between markets | +16–48 MB per cached day (bounded by LRU cap) |
| Code | — | ~40 lines in `binanceAggTradesSource.ts`, no API change |

## When it matters — and when it doesn't

- **Doesn't matter**: small runs (tens of markets), feed-less strategies
  (nothing loads at all), or runs bottlenecked by tick replay itself
  (a 1M-event market replays for much longer than one day-file scan).
- **Matters**: large batches (hundreds–thousands of 15m/5m markets) of
  feed-using strategies, where hundreds of redundant scans add minutes of
  pure overhead per worker, multiplied by however many workers share a disk.

## Recommendation

Skip it until large feed-using batches are routine. When one feels slow,
compare the `[backtest:feeds] ... trades=N` log-line timestamps against
replay time: if feed loading is a visible fraction, implement the cache —
it is self-contained inside `loadBinanceAggTradesSeries` and needs no
changes anywhere else.
