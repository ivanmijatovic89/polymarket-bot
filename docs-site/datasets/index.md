---
title: Datasets
description: An overview of the three dataset sources the backtest engine supports — Live Recording, Telonex, and PMXT.
---

# Datasets

The backtest engine is data-source agnostic. It runs the same strategy code and the same `MarketEngine` regardless of where the data comes from. What changes between dataset sources is how the data was collected, what format it arrives in, and how you prepare it for replay.

Three dataset sources are currently supported:

| Source | Format | Historical reach | Setup effort | Replay speed |
| --- | --- | --- | --- | --- |
| [Live Recording](/datasets/recording/overview) | Raw WS events (Parquet) | From the moment you start recording | Run the recorder yourself | Baseline |
| [Telonex](/datasets/telonex/overview) | Paired order book snapshots (Parquet) | Pre-collected historical data | Download + one-time merge | ~3× slower |
| [PMXT](/datasets/pmxt/overview) | _(coming soon)_ | — | — | — |

## Live Recording

The recorder subscribes to Polymarket's WebSocket and writes every valid market event to a Parquet file in real time. This is the highest-fidelity source — it captures the exact event stream the live trading engine sees, including disconnect markers when connectivity is lost.

The tradeoff is that you can only record from the moment you start. There is no historical backfill — if you want data from last week, you needed to be recording last week.

→ [Live Recording docs](/datasets/recording/overview)

## Telonex

Telonex is a market data platform that has been continuously recording Polymarket's WebSocket feed. You download their pre-collected snapshots as daily Parquet files (one per side per day), run a one-time merge to produce a paired Parquet file, and then replay it with `--input-mode telonex-paired-parquet`.

The paired format is approximately three times faster to replay than live-recorded files because both order book sides are pre-merged into a single row, eliminating runtime timestamp matching and JSON parsing on each tick.

→ [Telonex docs](/datasets/telonex/overview)

## PMXT

Documentation coming soon.

→ [PMXT docs](/datasets/pmxt/overview)

## Choosing a source

- **You need data from before you started recording** → use Telonex or PMXT.
- **You need the highest possible event fidelity** → use Live Recording. Telonex captures the same events but may omit redundant snapshots where the top of book did not change.
- **You are running many backtests over the same market window and replay speed is not a bottleneck** → Telonex or PMXT are fine. If raw replay speed matters, live-recorded files are faster because most events are small deltas rather than full snapshots.
- **You want to validate a strategy against your own recorded data** → use Live Recording, then cross-check with Telonex diagnostics to understand coverage differences.

## From dataset to backtest: the full workflow

Regardless of source, the path from raw data to a runnable backtest follows the same steps.

### Live Recording

```
1. Record         npm run record:live:btc
2. Scan           npm run scan:disconnect-events -- data/events/btc
3. Verify         npm run verify:parquet -- <file.parquet>
4. Seed database  npm run db:insert-parquet
5. Backtest       npm run backtest -- --strategy <id> --symbol btc
```

- **Record** — capture the live WebSocket stream to Parquet files. One file per 15-minute market window.
- **Scan** — inspect files for WebSocket disconnect gaps and remove files that would degrade backtest quality.
- **Verify** — confirm a file is fully readable and its schema looks correct before running a backtest.
- **Seed database** — index the files on disk into the `markets` table so the backtest CLI can query them by symbol, slug, or date range.
- **Backtest** — replay the files through your strategy.

→ [Scan Disconnect Events](/datasets/recording/scan-disconnect-events) · [Verify Parquet File](/datasets/tools/verify-parquet) · [Seed Database from Parquet](/datasets/recording/insert-parquet-to-db) · [Running Backtests](/other/running-backtests)

### Telonex

```
1. Download       curl -L "https://api.telonex.io/v1/downloads/polymarket/book_snapshot_full/<date>?slug=...&outcome=Up" -o ...
2. Merge          npx tsx src/parquet/cli/telonex/merge-telonex-to-backtest-parquet.ts <dir>
3. Verify         npm run verify:parquet -- <merged.parquet>
4. Backtest       npx tsx src/cli/backtest.ts --strategy <id> --input-mode telonex-paired-parquet <merged.parquet>
```

- **Download** — fetch one Parquet file per side (Up/Down) per day from the Telonex API.
- **Merge** — combine the separate Up and Down files into a single paired Parquet file. This is a one-time step per market window.
- **Verify** — confirm the merged file is intact before running a backtest.
- **Backtest** — replay the paired file directly without seeding the database.

→ [Merge to Backtest Parquet](/datasets/telonex/merge) · [Verify Parquet File](/datasets/tools/verify-parquet) · [Run a Backtest with Telonex Data](/datasets/telonex/backtest)
