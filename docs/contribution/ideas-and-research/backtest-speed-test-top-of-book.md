---
title: "Idea: Backtest Speed Test — Top-of-Book-Only Mode"
description: Research proposal to measure whether skipping full order book reconstruction in the backtest engine speeds up runs for strategies that only need top-of-book price.
---

# Idea: Backtest Speed Test — Top-of-Book-Only Mode

## Status

> **Open** — not started. Captured for future investigation.

---

## Motivation

The backtest engine replays every raw WebSocket event through the full `MarketEngine` pipeline. For each `book` or `price_change` message, `OrderBookEngine` reconstructs the complete order book — all price levels, all sizes — before emitting an `EngineTick`.

The majority of strategies in `src/strategies/` do not read any order book depth. They act only on top-of-book data: best bid, best ask, and mid price. The full order book reconstruction happens regardless, because the engine has no knowledge of what a given strategy actually needs.

This is potentially a significant source of waste when running large parallel backtests across thousands of Parquet files.

---

## Hypothesis

Skipping full order book reconstruction when a strategy does not require it will meaningfully reduce backtest runtime, particularly for CPU-bound runs where the bottleneck is event processing rather than I/O.

The expected gains are most pronounced when:

- the Parquet files contain dense `book` snapshots (many price levels per message)
- the strategy tick rate is high (many events processed per 15-minute window)
- backtests are running in parallel and are CPU-bound

---

## Scope

This is purely a backtest engine change. Live trading is out of scope — the live engine always needs the full order book for order management and position tracking.

Strategies that use the `orderBook` field on `EngineTick` (e.g. those using the `TechnicalIndicators` plugin or reading depth directly) must continue to receive the full book. The mechanism must be opt-in or auto-detected — strategies that need the full book must not be silently broken.

---

## What to Measure

Run the same batch of backtest files with the same strategy under two configurations and compare wall-clock time and CPU usage:

| Metric | Method |
|---|---|
| Total wall-clock time | Time the full `--dir` backtest run |
| CPU time per tick | Instrument `MarketOrderBookEngine.onMessage` |
| Ticks per second | Derive from run duration ÷ total tick count |
| Result parity | Assert identical PnL and trade count between both modes |

Use a strategy that does **not** read order book depth as the benchmark subject (e.g. `SplitSellRedeem.v5`). Use a strategy that **does** read depth to verify the fallback path is correct.

::: tip Benchmark command baseline
The existing `--dir data/events/btc` run is a suitable baseline — it processes ~3,000 files and covers a wide range of market conditions.
:::

---

## Proposed Technical Approach

Two approaches are worth evaluating:

### Option A — Strategy-declared data requirements

Add an optional `dataRequirements` field to the strategy `definition`:

```typescript
dataRequirements?: {
  orderBookDepth: boolean  // default: false
}
```

`StrategyRunner` reads this flag at startup and passes it to `MarketEngine`. When `orderBookDepth: false`, `OrderBookEngine` parses only the top-of-book fields from each message and skips the full level reconstruction.

**Advantage:** explicit, per-strategy control.
**Risk:** strategies that forget to declare the flag and silently receive incomplete data.

### Option B — Lazy reconstruction

`OrderBookEngine` always parses the full message but defers building the depth map until `snapshot.orderBook` is first accessed. If the strategy never accesses it, the allocation never happens.

**Advantage:** fully transparent — no strategy changes required.
**Risk:** harder to reason about, and profiling overhead from lazy accessors may offset gains.

::: warning Result parity is non-negotiable
Any implementation must produce bit-for-bit identical trade results compared to the full-book mode for strategies that use only top-of-book data. This must be verified before the feature is considered complete.
:::

---

## Open Questions

1. What fraction of CPU time does `OrderBookEngine` consume in a typical backtest run? Profiling first will confirm whether this is the actual bottleneck.
2. Do any existing strategies access `orderBook` in non-obvious ways (e.g. through a plugin that checks depth indirectly)?
3. Is Option B (lazy) measurably faster than Option A (declared), given the overhead of getter interception in V8?
4. Should a `--top-of-book-only` CLI flag be added as a temporary experimental path, or should this be fully automatic?

---

## Related

- `src/market/MarketOrderBookEngine.ts` — processes each WS message and calls into `OrderBookEngine`
- `src/market/orderbook/OrderBookEngine.ts` — full order book reconstruction logic
- `src/trading/StrategyRunner.ts` — owns the tick loop and passes context to strategies
