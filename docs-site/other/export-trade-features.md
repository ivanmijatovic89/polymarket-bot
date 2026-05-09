---
title: Export Trade Features
description: How to export per-trade feature vectors from a backtest run for use in research, gate analysis, and machine learning workflows.
---

# Export Trade Features

The export-trade-features script reads the `marketStats` JSON column of a completed backtest run from the database and writes feature vectors — one row per market with non-zero PnL — to CSV and JSON files. The output is split into search (training) and test sets to support cross-validated gate analysis.

## Running the export

```bash
npm run export:trade-features -- --id <backtestId> [--split <ratio>]
```

Or invoke directly:

```bash
npx tsx src/cli/research/export-trade-features.ts --id <backtestId> [--split 0.7]
```

### Flags

| Flag              | Default | Description                                                                               |
| ----------------- | ------- | ----------------------------------------------------------------------------------------- |
| `--id <n>`        | —       | **Required.** The integer primary key of the backtest row in the `backtests` table        |
| `--split <ratio>` | `0.7`   | Fraction of rows allocated to the search (training) set. Must be strictly between 0 and 1 |

::: warning --id is required
If `--id` is omitted or resolves to a non-finite number, the script prints a usage message and exits with an error.
:::

## What features are extracted

Each market entry in `marketStats` must have `intentMeta[0]` populated. The first intent's metadata is used exclusively. Markets with `pnl === 0` are skipped entirely.

For each qualifying market, the following feature columns are extracted:

### Identity and label

| Column  | Description                                     |
| ------- | ----------------------------------------------- |
| `slug`  | Market slug (e.g., `btc-updown-15m-1716825600`) |
| `isWin` | `true` if `pnl > 0`                             |
| `pnl`   | Net PnL in USDC                                 |

### Price movement windows

Computed over windows: `1s`, `3s`, `5s`, `10s`, `20s`, `30s`, `45s`, `60s`, `120s`, `180s`, `220s`.

| Column pattern          | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `netChange_<window>`    | Net price change over the window at entry time |
| `highLowRange_<window>` | High-low range over the window at entry time   |

### Order book levels

Computed for levels 1 through 10.

| Column pattern                  | Description                                             |
| ------------------------------- | ------------------------------------------------------- |
| `ob_<n>_upBidDepth`             | Bid depth at level `n` for the UP token                 |
| `ob_<n>_downBidDepth`           | Bid depth at level `n` for the DOWN token               |
| `ob_<n>_weakBidSide`            | Which side has the weaker bid (`"up"` or `"down"`)      |
| `ob_<n>_weakBidRatio`           | Ratio of weak-side bid depth to strong-side bid depth   |
| `ob_<n>_isMyOrderOnWeakBidSide` | Whether the bot's order was placed on the weak-bid side |

### Technical indicators

Two timeframes are captured:

**1-hour (`tf1h`):**

| Column               | Description                    |
| -------------------- | ------------------------------ |
| `ta_tf1h_rv20`       | 20-period realised volatility  |
| `ta_tf1h_rv80`       | 80-period realised volatility  |
| `ta_tf1h_bbWidth`    | Bollinger Band width           |
| `ta_tf1h_atr14Pct`   | 14-period ATR as a percentage  |
| `ta_tf1h_wickRatio`  | Wick-to-body ratio             |
| `ta_tf1h_hlRangePct` | High-low range as a percentage |
| `ta_tf1h_rv20Over80` | Ratio of `rv20` to `rv80`      |

**15-minute (`tf15m`):**

| Column                | Description                    |
| --------------------- | ------------------------------ |
| `ta_tf15m_rv20`       | 20-period realised volatility  |
| `ta_tf15m_atr14Pct`   | 14-period ATR as a percentage  |
| `ta_tf15m_wickRatio`  | Wick-to-body ratio             |
| `ta_tf15m_hlRangePct` | High-low range as a percentage |

**Session metadata:**

| Column                 | Description                                                |
| ---------------------- | ---------------------------------------------------------- |
| `ta_meta_session`      | Trading session label (e.g., `"asia"`, `"london"`, `"us"`) |
| `ta_meta_dayOfWeekUTC` | Day of week (0 = Sunday … 6 = Saturday)                    |
| `ta_meta_hourOfDayUTC` | Hour of day in UTC (0–23)                                  |

## Output structure

All files are written to `data/research-backtest/<id>/`:

```
data/research-backtest/<id>/
├── ALL_trades_features.csv
├── ALL_trades_features.json
├── SEARCH_trades_features.csv       ← first floor(total × split) rows
├── SEARCH_trades_features.json
├── TEST_trades_features.csv         ← remaining rows
├── TEST_trades_features.json
├── orderbook/
│   ├── ALL_trades_features.{csv,json}
│   ├── SEARCH_trades_features.{csv,json}
│   └── TEST_trades_features.{csv,json}
├── netChange/
│   ├── ALL_trades_features.{csv,json}
│   ├── SEARCH_trades_features.{csv,json}
│   └── TEST_trades_features.{csv,json}
├── highLowRange/
│   ├── ALL_trades_features.{csv,json}
│   ├── SEARCH_trades_features.{csv,json}
│   └── TEST_trades_features.{csv,json}
└── ta/
    ├── ALL_trades_features.{csv,json}
    ├── SEARCH_trades_features.{csv,json}
    └── TEST_trades_features.{csv,json}
```

The subdirectories (`orderbook/`, `netChange/`, `highLowRange/`, `ta/`) contain the same SEARCH/TEST split but with only the columns relevant to each feature group — useful for focused analysis.

### The `--split` parameter

The split is applied deterministically by row order (as returned from the database query). With `--split 0.7`:

- **SEARCH** — the first 70% of qualifying rows (used for parameter search / training).
- **TEST** — the remaining 30% (used for out-of-sample validation).

No shuffling is applied; order is preserved from the `marketStats` array.

::: tip Using the output with research-gate
After exporting, run the gate analysis tool against the output directory:

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts \
  data/research-backtest/<id> \
  "netChange_45s>0.05"
```

See [Research Gate Analysis](./research-gate-new.md) for full usage.
:::

## Console output

On completion the script prints:

```
[export-trade-features] wrote ALL=320 SEARCH=224 TEST=96 -> data/research-backtest/42
```
