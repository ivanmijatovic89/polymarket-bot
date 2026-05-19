---
title: Run a Backtest with Telonex Data
description: How to feed a converted Telonex parquet (paired, delta, or typed delta) to the backtest engine.
---

# Run a Backtest with Telonex Data

Once a market has been converted by [`telonex:convert`](/datasets/telonex/convert), its Parquet output can be replayed by the backtest engine. The command differs by converter:

- **Delta** output is in the live format — no `--input-mode` flag needed.
- **Delta-typed** output is a compact typed delta format — requires `--input-mode telonex-delta-parquet`.
- **Paired** output is in `orderbook_pair` format — requires `--input-mode telonex-paired-parquet`.

The strategy runs through the exact same engine as a live-recorded backtest. The only difference is the data source.

## Backtesting a delta-converted file

The delta converter emits the same `book` / `price_change` event stream as the live recorder. Pass the file path positionally with no special mode flag:

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  data/events/telonex/delta/btc/15m/btc-updown-15m-1766364300.parquet
```

The engine processes each row in stored order, exactly as it would for a file you recorded yourself.

## Backtesting a delta-typed converted file

The delta-typed converter keeps the same `book` / `price_change` tick cadence as the delta converter, but stores typed columns instead of a full `raw_json` payload. Use the dedicated typed delta input mode:

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  --input-mode telonex-delta-parquet \
  data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1766364300.parquet
```

## Backtesting a paired-converted file

The paired converter emits one `orderbook_pair` row per exchange timestamp with both sides of the book inline. This requires the dedicated input mode:

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  --input-mode telonex-paired-parquet \
  data/events/telonex/paired/btc/15m/btc-updown-15m-1766364300.parquet
```

In paired mode, both the Up and Down books are applied to the engine **before** the strategy tick fires, so the strategy always sees both sides synchronised at the same exchange timestamp.

## Backtesting an R2-only converted file

When `--output r2` was used at convert time, the file lives only on R2. The backtest reader supports `r2://` URLs directly:

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  --input-mode telonex-delta-parquet \
  r2://polymarket-telonex/telonex/converted/delta-typed/btc/15m/1766364300/btc-updown-15m-1766364300.parquet
```

Read latency from R2 is observed to be roughly 12% slower than from local disk on this codebase. Use `--output both` at convert time if you want a local cache without giving up the durable R2 copy.

## Passing strategy parameters

Use `--param key=value` to override any strategy parameter, the same as in a normal backtest:

::: code-group

```bash [delta]
npm run backtest -- \
  --strategy split-sell-redeem-v3 \
  --param splitShares=10 \
  --param sellSize=10 \
  data/events/telonex/delta/btc/15m/btc-updown-15m-1766364300.parquet
```

```bash [paired]
npm run backtest -- \
  --strategy split-sell-redeem-v3 \
  --param splitShares=10 \
  --param sellSize=10 \
  --input-mode telonex-paired-parquet \
  data/events/telonex/paired/btc/15m/btc-updown-15m-1766364300.parquet
```

```bash [delta-typed]
npm run backtest -- \
  --strategy split-sell-redeem-v3 \
  --param splitShares=10 \
  --param sellSize=10 \
  --input-mode telonex-delta-parquet \
  data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1766364300.parquet
```

:::

## Replaying multiple files

You can pass more than one file in a single run. Files are processed sequentially, one market episode at a time:

```bash
npm run backtest -- \
  --strategy split-sell-redeem-v3 \
  --input-mode telonex-delta-parquet \
  data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1766364300.parquet \
  data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1766365200.parquet
```

## Constraints for typed Telonex modes

`--input-mode telonex-paired-parquet` and `--input-mode telonex-delta-parquet` cannot be combined with the database-query flags. The following combinations are rejected at startup:

| Flag | Allowed with typed Telonex modes? |
| --- | --- |
| `--symbol` | No |
| `--slug` | No |
| `--dir` | No |
| `--limit` | No |
| `--random` | No |
| `--latest` | No |
| `--order` | No |
| `--time-driven` | No |
| `--param` | Yes |
| `--strategy` | Yes |

File paths must always be provided as positional arguments after all flags.

The raw-json **delta** converter's output runs in standard `recorded` mode and has none of these restrictions.

## How replay differs between modes

In standard (`recorded`) mode — used for both live recordings and raw-json **delta** Telonex output — the engine processes every raw WebSocket-style event individually. Each `book` or `price_change` event triggers a separate strategy tick, and only the side mentioned in that event is updated before the tick fires.

In `telonex-delta-parquet` mode — used for **delta-typed** output — the same `book` / `price_change` cadence is replayed from typed columns instead of parsing `raw_json`. It should expose the same strategy tick semantics as raw-json delta output.

In `telonex-paired-parquet` mode — used only for the **paired** converter — each row is one tick and both books are current as of the same exchange timestamp. There is no `--order` or `--time-driven` option; rows always replay in their stored sequence.

This means strategies that look at both sides simultaneously (e.g. spread between Up ask and Down ask) see a consistent view on every tick in paired mode, which is not guaranteed in standard mode where ticks alternate between sides.

::: tip Latency simulation still applies
`BACKTEST_LATENCY_DELAY` and `BACKTEST_LATENCY_JITTER` work the same way in both modes. Set them if you want to model order submission latency.
:::

## Verifying a converted file before backtesting

If you are unsure whether a converted file is well-formed:

```bash
npm run verify:parquet -- data/events/telonex/paired/btc/15m/btc-updown-15m-1766364300.parquet
```

For a **paired** file, the schema output should show `event_type=orderbook_pair` and the typed columns `up_asset_id`, `down_asset_id`, `up_bids`, `up_asks`, `down_bids`, `down_asks`.

For a **delta** file, `event_type` values should be `book` and `price_change`, and the `raw_json` column should be present.

For a **delta-typed** file, `event_type` values should be `book` and `price_change`, `raw_json` should not be present, and flat repeated typed columns should be present for book depth and price changes.

## Next steps

- [Convert](/datasets/telonex/convert) — upstream stage that produces the file you backtest.
- [Diagnostics](/datasets/telonex/diagnostics) — inspect coverage and merge alignment if results look unexpected.
