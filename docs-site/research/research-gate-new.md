---
title: Research Gate Analysis
description: How to use the research-gate tool to evaluate the PnL impact of feature-based entry gates on exported backtest trade data.
---

# Research Gate Analysis

The research-gate tool reads trade feature files produced by [Export Trade Features](./export-trade-features.md) and answers the question: **if the strategy only entered markets where a given feature condition held, what would the total PnL have been?**

It computes three views for each of the three standard splits (ALL, SEARCH, TEST):

- **No gate** — total PnL and trade count with no filtering.
- **Gate skipped** — total PnL and trade count for rows that pass the filter (i.e., trades the gate would allow).
- **With gate** — total PnL and trade count for rows that fail the filter (i.e., trades the gate would have blocked). The label reflects what was blocked by the gate condition.

::: tip Interpreting the results
"Gate skipped" shows what you keep if you apply the gate. "With gate" shows what you throw away. Compare "pnl (gate skipped)" against "pnl (no gate)" to evaluate whether the gate improves the signal-to-noise ratio.
:::

## Running the tool

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts <folder> [filter]
```

Or with the named flag:

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts <folder> --filter "<expression>"
```

### Arguments

| Argument   | Description                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<folder>` | Path to the directory containing `ALL_trades_features.json`, `SEARCH_trades_features.json`, and `TEST_trades_features.json`. May be relative to the working directory |
| `[filter]` | Optional filter expression (see below). If omitted, no filtering is applied and the tool simply sums PnL for all three files                                          |

## Filter expressions

Filters are written as `field<op>value` with no spaces, or with spaces if the whole expression is quoted. Multiple conditions are joined with `&` (logical AND):

```
netChange_45s>0.05
netChange_45s>0.05&highLowRange_20s<20
ta_tf1h_rv20>=0.01&ta_meta_session==1
```

Supported operators:

| Operator | Meaning               |
| -------- | --------------------- |
| `>`      | Greater than          |
| `<`      | Less than             |
| `>=`     | Greater than or equal |
| `<=`     | Less than or equal    |
| `==`     | Equal                 |
| `!=`     | Not equal             |

All comparisons are numeric. Rows where the field is missing or non-numeric are excluded from the filtered set.

::: warning Shell quoting
The operators `>` and `<` are interpreted as shell redirections if unquoted. Always wrap filter expressions in single or double quotes:

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/42 "netChange_45s>0.05"
```

:::

## Required files

The tool expects the following files to be present in `<folder>`:

- `ALL_trades_features.json`
- `SEARCH_trades_features.json`
- `TEST_trades_features.json`

If any file is missing, the tool prints an error listing the missing files and exits with code 1. Generate these files first using `npm run export:trade-features`.

## Examples

### No filter — baseline PnL summary

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/240
```

### Single condition gate

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts \
  data/research-backtest/240 \
  "netChange_45s>0.05"
```

### Multi-condition gate

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts \
  data/research-backtest/240 \
  "netChange_45s>0.05&highLowRange_20s<20"
```

### Using the --filter flag

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts \
  data/research-backtest/240 \
  --filter "netChange_45s>0.05&highLowRange_20s<20"
```

## Output

The tool prints a `console.table` with one row per input file:

```
┌─────────────────────────────┬────────────────┬──────────────┬──────────────────────┬──────────────────────┬───────────────────────┬─────────────────────┐
│ file                        │ count (no gate)│ pnl (no gate)│ count (gate skipped) │ pnl (gate skipped)   │ count (with gate)     │ pnl (with gate)     │
├─────────────────────────────┼────────────────┼──────────────┼──────────────────────┼──────────────────────┼───────────────────────┼─────────────────────┤
│ ALL_trades_features.json    │ 320            │ 12.40        │ 87                   │ 18.30                │ 233                   │ -5.90               │
│ SEARCH_trades_features.json │ 224            │ 9.10         │ 61                   │ 13.20                │ 163                   │ -4.10               │
│ TEST_trades_features.json   │ 96             │ 3.30         │ 26                   │ 5.10                 │ 70                    │ -1.80               │
└─────────────────────────────┴────────────────┴──────────────┴──────────────────────┴──────────────────────┴───────────────────────┴─────────────────────┘
```

In this example the gate (`netChange_45s>0.05`) would allow 87 of 320 total trades and improve PnL from $12.40 to $18.30 on the ALL set, while blocking trades that collectively lost $5.90.

::: details Workflow: find a gate, then validate it

1. Export features from your backtest:

   ```bash
   npm run export:trade-features -- --id 240 --split 0.7
   ```

2. Explore feature conditions on the SEARCH set:

   ```bash
   npx tsx src/cli/research/research-gate-on-backtests.ts \
     data/research-backtest/240 "netChange_45s>0.05"
   ```

3. Validate the same condition on the TEST set to check for overfitting. A gate that improves both SEARCH and TEST PnL is a good candidate for implementation.

4. Implement the gate condition in your strategy's `onMarketTick` by checking the relevant plugin or tick snapshot values before emitting an intent.
   :::

## Subdirectory feature sets

The export script also writes feature subsets to `orderbook/`, `netChange/`, `highLowRange/`, and `ta/` subdirectories. Pass one of those subdirectories as `<folder>` to run gate analysis on a focused feature group:

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts \
  data/research-backtest/240/orderbook \
  "ob_1_weakBidRatio<0.8"
```
