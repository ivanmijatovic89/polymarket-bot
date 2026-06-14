---
title: Run a Backtest with Telonex Data
description: How to feed a converted Telonex parquet (paired, delta, or delta-typed) to the backtest engine, including database-driven slug and symbol lookups.
---

# Run a Backtest with Telonex Data

Once a market has been converted by [`telonex:convert`](/datasets/telonex/convert), its Parquet output can be replayed by the backtest engine. The same `MarketEngine` and `StrategyRunner` code used for live trading processes the events — only the data source differs.

## How input modes map to data sources

`--input-mode` picks **both** the replayer and the database source. There is no separate "data source" flag.

| Input mode        | Replayer                              | Database source                                                            |
| ----------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| `recorded`        | WS-event orderbook replay (default)   | `markets` table                                                            |
| `telonex-delta`   | typed `book` / `price_change` replay  | `telonex_markets` ⋈ `telonex_market_conversions` (`converter='delta-typed'`) |
| `telonex-paired`  | `orderbook_pair` per-tick replay      | `telonex_markets` ⋈ `telonex_market_conversions` (`converter='paired'`)    |

Telonex modes always require `--read-from local|r2` (see below). The raw-json **delta** converter's output runs in standard `recorded` mode and does not use the telonex DB join.

## Required flag: `--read-from`

For any telonex input mode, you must specify where to read the converted parquet from:

| `--read-from`  | Effect                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local`        | Reads `telonex_market_conversions.local_path` (on-disk parquet). Markets without a local file are excluded by eligibility.                                       |
| `r2`           | Streams `telonex_market_conversions.r2_url` from R2 every run (no local copy kept).                                                                              |
| `local-or-download-from-r2-to-local`  | Reads the canonical local file if present; otherwise downloads it from R2 to that path once (download-if-missing), then reads locally. Best of both — see below. |

Passing `--read-from` with `--input-mode recorded` is an error. Omitting `--read-from` on a telonex mode is also an error.

::: tip `local-or-download-from-r2-to-local` is usually what you want
`r2` re-streams every run; `local` requires the files to already be on this machine. `local-or-download-from-r2-to-local` lazily fetches each market's converted parquet from R2 to its canonical local path (`data/events/telonex/<converter>/<symbol>/<timeframe>/<slug>.parquet`) the first time, then every later run reads it locally. The fetch is per-worker, so it works even when workers run on a different machine. To pre-warm everything up front instead, run [`telonex:download-converted-r2-to-local`](/datasets/telonex/download-converted-r2-to-local) and then use `--read-from local`.
:::

## Backtest a delta-typed file

`telonex-delta` is the typical choice — it preserves the same `book` / `price_change` tick cadence as the live recorder but stores typed columns instead of `raw_json`.

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  --input-mode telonex-delta --read-from local \
  data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1766364300.parquet
```

Or by slug — the file path is resolved from `telonex_market_conversions.local_path`:

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  --input-mode telonex-delta --read-from local \
  --slug btc-updown-15m-1766364300
```

Or sample by symbol:

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  --input-mode telonex-delta --read-from local \
  --symbol btc --timeframe 15m --limit 50 --random
```

There's a convenience shortcut for the common case:

```bash
npm run backtest:telonex:btc:15m -- --strategy <strategy-id> --limit 20
```

`:eth:15m`, `:sol:15m`, and `:xrp:15m` variants exist too.

## Backtest a paired-converted file

The paired converter emits one `orderbook_pair` row per exchange timestamp with both sides of the book inline. Use `--input-mode telonex-paired`:

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  --input-mode telonex-paired --read-from local \
  --slug btc-updown-15m-1766364300
```

In paired mode, both the Up and Down books are applied to the engine **before** the strategy tick fires, so the strategy always sees both sides synchronised at the same exchange timestamp.

## Backtest a delta (raw-json) file

The raw-json delta converter emits the same `book` / `price_change` event stream as the live recorder, with full `raw_json` payloads. Use `recorded` mode — there is no telonex-specific input mode for raw-json delta:

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  data/events/telonex/delta/btc/15m/btc-updown-15m-1766364300.parquet
```

::: tip
Raw-json delta files do not currently appear in the `markets` table, so `--symbol` / `--slug` lookups against them do not work. Pass file paths or `--dir` instead.
:::

## Reading from R2 directly

When the converted file lives on R2 (e.g. you ran `telonex:convert --output r2` without `local`), pass `--read-from r2`. The reader streams the file directly from R2; no local download or cache is created.

```bash
# By slug — DB resolves the r2_url
npm run backtest -- \
  --strategy <strategy-id> \
  --input-mode telonex-delta --read-from r2 \
  --slug btc-updown-15m-1766364300

# Or by an explicit r2:// URL
npm run backtest -- \
  --strategy <strategy-id> \
  --input-mode telonex-delta --read-from r2 \
  r2://polymarket-telonex/telonex/converted/delta-typed/btc/15m/1766364300/btc-updown-15m-1766364300.parquet
```

Read latency from R2 is observed to be roughly 12% slower than from local disk on this codebase. Use `--output both` at convert time if you want a local copy without giving up the durable R2 copy.

## Symbol queries and timeframes

When using `--symbol`, the DB filter is `slug LIKE '<symbol>-updown-<timeframe>-%'`. `--timeframe` defaults to `15m`; pass `--timeframe 5m`, `--timeframe 1h`, etc. once data for other intervals exists.

```bash
npm run backtest -- \
  --strategy <strategy-id> \
  --input-mode telonex-delta --read-from local \
  --symbol btc --timeframe 5m --limit 100 --latest
```

`--timeframe` is only valid together with `--symbol` — passing it with `--slug` / `--dir` / explicit file paths is rejected at startup (those carry the timeframe in the slug itself).

## Resolution and outcomes

Telonex modes read the resolved outcome directly from `telonex_markets`:

| Column           | Source for                                |
| ---------------- | ----------------------------------------- |
| `outcome_0`      | `Up` outcome label (always `Up` today)    |
| `outcome_1`      | `Down` outcome label (always `Down` today) |
| `asset_id_0`     | UP token id                               |
| `asset_id_1`     | DOWN token id                             |
| `telonex_status` | Must equal `resolved` to count toward stats |
| `result_id`      | `0` → UP won, `1` → DOWN won              |

There is **no Gamma API fallback** in telonex modes. If a slug isn't in `telonex_markets`, or if its conversion isn't `status='done'`, the file is skipped with a warning and the run continues.

## Database-driven flag combinations

All telonex modes accept the same query flags as recorded mode:

| Flag         | Notes                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| `--symbol`   | Filters by `slug LIKE '<sym>-updown-<timeframe>-%'`.                            |
| `--slug`     | Comma-separated list, joined to `telonex_market_conversions`.                   |
| `--dir`      | Scans a directory of parquet files; slug parsed from filename for DB lookup.    |
| `--limit`    | Required with `--random` or `--latest`.                                         |
| `--random`   | `ORDER BY RAND()`. Mutually exclusive with `--latest`.                          |
| `--latest`   | Fetches the `--limit` most recent rows (highest slug epoch).                    |
| `--timeframe`| Only valid with `--symbol`. Defaults to `15m`.                                  |

`--order` and `--time-driven` are silently ignored for telonex modes (the file format already encodes a deterministic order).

## Passing strategy parameters

Use `--param key=value` to override any strategy parameter. JSON strings work too: `--param assetIds='["a","b"]'`.

```bash
npm run backtest -- \
  --strategy split-sell-redeem-v3 \
  --param splitShares=10 \
  --param sellSize=10 \
  --input-mode telonex-delta --read-from local \
  --symbol btc --limit 20 --random
```

## Replay differences between modes

In `recorded` and `telonex-delta` modes, the engine processes every `book` / `price_change` event individually. Each event triggers a separate strategy tick, and only the side mentioned in that event is updated before the tick fires.

In `telonex-paired` mode, each row is one tick and both books are current as of the same exchange timestamp. Strategies that look at both sides simultaneously (e.g. spread between Up ask and Down ask) see a consistent view on every tick — which is not guaranteed in `recorded` / `telonex-delta` mode where ticks alternate between sides.

::: tip Latency simulation still applies
`BACKTEST_LATENCY_DELAY` and `BACKTEST_LATENCY_JITTER` work the same way in all modes.
:::

## Verifying a converted file before backtesting

If you are unsure whether a converted file is well-formed:

```bash
npm run verify:parquet -- data/events/telonex/delta-typed/btc/15m/btc-updown-15m-1766364300.parquet
```

- **Paired** file: schema should show `event_type=orderbook_pair` and typed columns `up_asset_id`, `down_asset_id`, `up_bids`, `up_asks`, `down_bids`, `down_asks`.
- **Delta** file: `event_type` values should be `book` and `price_change`, `raw_json` column present.
- **Delta-typed** file: `event_type` values should be `book` and `price_change`, no `raw_json` column, flat repeated typed columns for book depth and price changes.

## Next steps

- [Convert](/datasets/telonex/convert) — upstream stage that produces the file you backtest.
- [Diagnostics](/datasets/telonex/diagnostics) — inspect coverage and merge alignment if results look unexpected.
- [Running Backtests](/backtest/running-backtests) — generic backtest CLI reference (covers recorded mode and shared flags).
