---
title: Run a Backtest with Telonex Data
description: How to use a Telonex paired Parquet file as input to the backtest engine with --input-mode telonex-paired-parquet.
---

# Run a Backtest with Telonex Data

Once you have a paired Parquet file produced by the [merge step](/datasets/telonex/merge), you can pass it to the backtest CLI using the `--input-mode telonex-paired-parquet` flag. The strategy runs through the exact same engine as a live-recorded backtest — the only difference is the data source.

## Basic usage

```bash
npx tsx src/cli/backtest.ts \
  --strategy <strategy-id> \
  --input-mode telonex-paired-parquet \
  <path-to-paired.parquet>
```

Example:

```bash
npx tsx src/cli/backtest.ts \
  --strategy split-sell-redeem-v3 \
  --input-mode telonex-paired-parquet \
  data/telonex/btc-updown-15m-1766364300/btc-updown-15m-1766364300-merged-backtest.parquet
```

## Passing strategy parameters

Use `--param key=value` to override any strategy parameter, exactly as in a normal backtest:

```bash
npx tsx src/cli/backtest.ts \
  --strategy split-sell-redeem-v3 \
  --param minSpread=0.04 \
  --param maxPositionUsdc=50 \
  --input-mode telonex-paired-parquet \
  data/telonex/btc-updown-15m-1766364300/btc-updown-15m-1766364300-merged-backtest.parquet
```

## Replaying multiple files

You can pass more than one paired file in a single run. Files are processed sequentially, one market episode at a time:

```bash
npx tsx src/cli/backtest.ts \
  --strategy split-sell-redeem-v3 \
  --input-mode telonex-paired-parquet \
  data/telonex/btc-updown-15m-1766364300/btc-1766364300-merged.parquet \
  data/telonex/btc-updown-15m-1766365200/btc-1766365200-merged.parquet
```

## Constraints for this mode

`--input-mode telonex-paired-parquet` cannot be combined with the database-query flags. The following combinations are rejected at startup:

| Flag          | Allowed with `telonex-paired-parquet`? |
| ------------- | -------------------------------------- |
| `--symbol`    | No                                     |
| `--slug`      | No                                     |
| `--dir`       | No                                     |
| `--limit`     | No                                     |
| `--random`    | No                                     |
| `--latest`    | No                                     |
| `--order`     | No                                     |
| `--time-driven` | No                                   |
| `--param`     | Yes                                    |
| `--strategy`  | Yes                                    |

The file paths must always be provided as positional arguments after all flags.

## How replay differs from live-recorded mode

In standard (`recorded`) mode, the engine processes every raw WebSocket event individually. Each `book` or `price_change` event triggers a separate strategy tick, and only the side mentioned in that event is updated before the tick fires.

In `telonex-paired-parquet` mode:

- Each row in the paired file is one tick.
- Both the UP book and the DOWN book are applied to the engine before the tick fires.
- The strategy always receives a snapshot where both sides are current as of the same exchange timestamp.
- There is no `--order` or `--time-driven` option — rows are always replayed in their stored sequence.

This means strategies that look at both sides simultaneously (e.g. spread between UP ask and DOWN ask) see a consistent view on every tick, which is not guaranteed in live-recorded replay where ticks alternate between sides.

::: tip Latency simulation still applies
`BACKTEST_LATENCY_DELAY` and `BACKTEST_LATENCY_JITTER` work the same way in Telonex mode. Set them if you want to model order submission latency.
:::

## Verifying the paired file before backtesting

If you are unsure whether the merged file is well-formed, run `verify:parquet` on it first:

```bash
npm run verify:parquet -- <path-to-paired.parquet>
```

A healthy paired file will show `event_type` column values of `orderbook_pair` and columns `up_asset_id`, `down_asset_id`, `up_bids`, `up_asks`, `down_bids`, `down_asks` in its schema output.
