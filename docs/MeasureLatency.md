# MesureLatency (measureLatency.v1) — latency measurement strategy

This document explains how to use the `measureLatency.v1` strategy to measure **end-to-end live trading latency**, why it matters, and how to use the result to make backtests simulate the same latency.

## What this is for

When running live (either on your local PC or on a rented server/droplet), there is always delay between:

- **when the bot decides to place/cancel an order** (your process emits an intent), and
- **when Polymarket reflects that change** (you see the order appear/disappear in your account/portfolio state).

`measureLatency.v1` runs repeated “place + cancel” cycles and logs latency statistics so you can quantify that delay.

## What it measures (exactly)

Per cycle, it measures two timings:

- **Placement latency (ms)**: time from **when the bot emits a place order intent** to **when the order becomes visible in the portfolio open-orders snapshot**.
- **Cancel latency (ms)**: time from **when the bot emits a cancel intent** to **when the order disappears from the portfolio open-orders snapshot**.

Important notes:

- It measures **your real end-to-end path**, including your runtime + network + Polymarket processing + the time it takes for account updates to reach you.
- The measurement is based on **local `Date.now()` timestamps** inside the bot process.

## Why this measurement is important

If your backtests execute with “instant” order placement/cancel, they can be unrealistically optimistic (or pessimistic) compared to live.

By measuring your real latency on the environment you’ll run the bot on (local machine vs droplet), you can:

- **calibrate your backtest** to simulate the same latency,
- get more realistic fills/slippage behavior,
- and reduce the gap between live and backtest performance.

The goal is: **same strategy logic + same market data + same (simulated) execution latency** → tick-by-tick comparability.

## How to run it

Run the trading bot with the strategy id `measureLatency.v1` and pass parameters via `--param`.

Example:

```bash
npm run trade:bot:btc -- \
  --strategy measureLatency.v1 \
  --param side=up \
  --param size=100 \
  --param price=0.01 \
  --param totalCycles=20 \
  --param delayMs=3000
```

### Parameters

- **side**: `up` or `down` (which outcome token to trade)
- **price**: limit price (string input; parsed into a number)
- **size**: order size (string input; parsed into a number)
- **totalCycles** *(default: 10)*: how many place+cancel cycles to run
- **delayMs** *(default: 3000)*: delay before placing the order each cycle (milliseconds)

## Example output

At the end, it prints a summary like:

```text
[measureLatency.v1] 📊 FINAL RESULTS (20 cycles): {
  allMeasurements: [
    { cycle: 1, placementMs: '94.00', cancelMs: '210.00' },
    { cycle: 2, placementMs: '84.00', cancelMs: '81.00' },
    { cycle: 3, placementMs: '76.00', cancelMs: '70.00' },
    { cycle: 4, placementMs: '77.00', cancelMs: '71.00' },
    { cycle: 5, placementMs: '77.00', cancelMs: '66.00' },
    { cycle: 6, placementMs: '85.00', cancelMs: '117.00' },
    { cycle: 7, placementMs: '105.00', cancelMs: '71.00' },
    { cycle: 8, placementMs: '256.00', cancelMs: '68.00' },
    { cycle: 9, placementMs: '137.00', cancelMs: '146.00' },
    { cycle: 10, placementMs: '77.00', cancelMs: '137.00' },
    { cycle: 11, placementMs: '176.00', cancelMs: '70.00' },
    { cycle: 12, placementMs: '80.00', cancelMs: '66.00' },
    { cycle: 13, placementMs: '379.00', cancelMs: '65.00' },
    { cycle: 14, placementMs: '72.00', cancelMs: '74.00' },
    { cycle: 15, placementMs: '72.00', cancelMs: '91.00' },
    { cycle: 16, placementMs: '75.00', cancelMs: '70.00' },
    { cycle: 17, placementMs: '148.00', cancelMs: '65.00' },
    { cycle: 18, placementMs: '92.00', cancelMs: '69.00' },
    { cycle: 19, placementMs: '71.00', cancelMs: '136.00' },
    { cycle: 20, placementMs: '86.00', cancelMs: '70.00' }
  ],
  placementLatency: { avg: '115.95ms', min: '71.00ms', max: '379.00ms' },
  cancelLatency: { avg: '90.65ms', min: '65.00ms', max: '210.00ms' }
}
```

## How to use the result for backtests

Take the measured **average placement latency** (and optionally cancel latency) from the environment you will trade on.

Then add that latency value(s) into your `.env` (or config) so the backtest execution layer can **delay simulated order acknowledgements/fills by the same amount**.

That way, your backtests will reflect the same real-world “bot → exchange → account update” delay you measured live.

