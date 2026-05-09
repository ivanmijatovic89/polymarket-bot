---
title: PnL Report
description: How to run the PnL report CLI to view per-market profit and loss, activity breakdowns, and aggregate statistics for your Polymarket wallet.
---

# PnL Report

The PnL report fetches your wallet's on-chain activity from the Polymarket data API and computes per-market profit and loss. It supports both a colour-coded terminal table and machine-readable JSON output.

## Running the report

```bash
npx tsx src/cli/pnl-report.ts [options]
```

The script resolves your wallet address automatically from the environment:

- If `CLOB_FUNDER` is set, the SAFE address is used.
- Otherwise, `PRIVATE_KEY` (or `POLYMARKET_PRIVATE_KEY`) is used to derive the EOA address.

At least one of these must be present in `.env`.

## Flags

| Flag               | Default | Description                                                                                        |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------- |
| `--symbol <sym>`   | —       | Filter results to markets whose slug begins with `<sym>-`. Case-insensitive. Example: `btc`, `eth` |
| `--slug <pattern>` | —       | Filter results to markets whose slug contains `<pattern>`. Case-insensitive substring match        |
| `--limit <n>`      | `50`    | Maximum number of markets to display, sorted newest-first by slug                                  |
| `--json`           | off     | Emit JSON to stdout instead of the terminal table                                                  |
| `--debug`          | off     | Print pagination diagnostics and a breakdown of activity types                                     |
| `--help`, `-h`     | —       | Print usage and exit                                                                               |

### Examples

```bash
# Default: show the 50 most recent markets
npx tsx src/cli/pnl-report.ts

# Filter to BTC markets, show up to 200
npx tsx src/cli/pnl-report.ts --symbol btc --limit 200

# Filter by slug substring
npx tsx src/cli/pnl-report.ts --slug "btc-updown-15m"

# Machine-readable output for scripting
npx tsx src/cli/pnl-report.ts --json

# Combine filters with JSON output
npx tsx src/cli/pnl-report.ts --symbol eth --limit 100 --json
```

## What the output shows

### Terminal table

Each row represents one market (identified by its slug) and shows:

| Column  | Description                                                                      |
| ------- | -------------------------------------------------------------------------------- |
| Market  | Truncated slug (up to 40 characters)                                             |
| Bought  | Total USDC spent on BUY trades                                                   |
| Sold    | Total USDC received from SELL trades                                             |
| Split   | USDC spent on SPLIT operations                                                   |
| Merge   | USDC received from MERGE operations                                              |
| Redeem  | USDC received from REDEEM operations                                             |
| Net PnL | `(Sold + Merge + Redeem) - (Bought + Split)`. Green if positive, red if negative |
| Result  | `WIN`, `LOSS`, `SKIP` (PnL ≈ 0), or `-` (market still open)                      |
| Status  | `open`, `closed`, or `redeemed`                                                  |

Below the table, a summary shows total markets, open/closed counts, win/loss/skipped counts, and win rate (wins as a fraction of decisive — i.e., non-skipped — outcomes).

::: tip Portfolio value
The current portfolio value (from the Polymarket data API) is printed above the table alongside the wallet address.
:::

### Status classification

| Status     | Condition                                                                              |
| ---------- | -------------------------------------------------------------------------------------- |
| `open`     | Market window has not yet ended                                                        |
| `closed`   | Market ended; position was exited via SELL or MERGE, or no redemption has occurred yet |
| `redeemed` | A REDEEM activity exists and net PnL is positive                                       |

### JSON output

`--json` emits a single JSON object with the following structure:

```json
{
  "address": "0x...",
  "portfolioValue": 1234.56,
  "stats": {
    "totalMarkets": 80,
    "totalPnl": 12.34,
    "totalBought": 400.0,
    "totalSold": 380.0,
    "totalSplitCost": 0.0,
    "totalMergeProceeds": 0.0,
    "totalRedeemProceeds": 32.34,
    "marketsRedeemed": 5,
    "marketsClosed": 72,
    "marketsOpen": 3,
    "winCount": 41,
    "lossCount": 36,
    "skippedCount": 3,
    "winRate": 0.532
  },
  "markets": [
    {
      "slug": "btc-updown-15m-1716825600",
      "conditionId": "0x...",
      "outcome": "Up",
      "sharesBought": 100.0,
      "sharesSold": 0.0,
      "totalBought": 50.0,
      "totalSold": 0.0,
      "splitCost": 0.0,
      "mergeProceeds": 0.0,
      "redeemProceeds": 100.0,
      "netPnl": 50.0,
      "status": "redeemed",
      "result": "win",
      "tradesCount": 2,
      "splitsCount": 0,
      "mergesCount": 0,
      "redeemsCount": 1
    }
  ]
}
```

Stats are computed only over closed and redeemed markets; open positions are counted but excluded from PnL totals.

## Activity pagination

The script fetches up to 5000 activity records in pages of 500, using the Polymarket data API's `offset` parameter. Pages are sorted newest-first by timestamp. If fewer than 500 records are returned in a page, pagination stops early. Use `--debug` to see per-page counts.

::: details PnL formula

```
Net PnL = (SELL proceeds + MERGE proceeds + REDEEM proceeds)
        - (BUY cost + SPLIT cost)
```

Open positions have unrealised value that is not included in Net PnL — only closed/redeemed activity is counted.
:::
