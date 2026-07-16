---
title: 'ADR: Binance-Driven Strategy Ticks'
description: Architecture decision record for a future extension where strategies wake up on Binance aggTrade events, not only on Polymarket orderbook ticks.
---

# ADR: Binance-Driven Strategy Ticks (synthetic feed ticks)

## Status

**Proposed — not implemented.** Parked deliberately; this document exists so
the idea can be picked up later without re-deriving the design. Prerequisite:
the Binance aggTrades feed (PR #121/#122) is merged.

## Context

Today, `Strategy.onMarketTick` fires **only on Polymarket orderbook events**
(`book` / `price_change`), both live and in replay — that is the core
invariant of the whole system. The Binance feed added in PR #121 is *passive*:
at each Polymarket tick the strategy samples
`ctx.plugins.externalFeeds.binanceWsSpotPrice` and sees the latest Binance
trade that had arrived by that moment (trade time + modeled ~110ms latency).

Measured proportions on 15m BTC markets (2026-06-13 verification set):

| stream | events per 15m window |
|---|---|
| Polymarket ticks (`onMarketTick` calls) | ~100,000–180,000 |
| Binance aggTrades | ~5,000–21,000 |

Consequences of the sampling model:

- If several Binance trades land **between two Polymarket ticks**, the
  strategy observes only the newest one at the next tick — intermediate prices
  are never seen.
- A strategy cannot *react* to a spot move until Polymarket's book produces an
  event. In liquid windows that is milliseconds; in a quiet book it can be
  longer — exactly the moments where reacting to spot first could matter.

Some future strategies may want to **wake up on the Binance trade itself**
(spot-momentum triggers, spot/strike crossing alarms, hedging on spot moves).
That requires *synthetic ticks*, and it must be built **live and replay
simultaneously** — adding it to only one side would break the
live == backtest invariant this repo exists to protect.

## Decision (proposed design)

Introduce an opt-in synthetic tick kind, `binance_agg_trade`, delivered
through the existing `onMarketTick` hook.

### Opt-in

Extend the request-plugin config (the same strategy-driven seam as the feed):

```ts
new ExternalFeedsRequestPlugin({
  binanceWsSpotPrice: { symbol: 'btcusdt', tickOnTrade: true },
})
```

Strategies without `tickOnTrade` keep today's behavior **bit-identically** —
same zero-blast-radius bar as the feed itself (verify with
`backtest:verify-diff`).

### Tick shape

- `tick.msg.event_type === 'binance_agg_trade'` (new synthetic type; strategies
  already switch on `event_type`).
- `tick.snapshot` = the current `MarketOrderBooksSnapshot`, **unchanged** since
  the last orderbook event; `snapshot.timestamp` = the trade's visibility time
  (`T + latencyOffset`), so time keeps moving monotonically for gates/plugins.
- The Binance payload itself is read via `ctx.plugins.externalFeeds` as usual
  (the as-of cursor will have advanced to exactly this trade).

### Live side

`trading-bot.ts` already receives every aggTrade (`onAggTrade` callback on
`binanceWsSpotPriceClient`). When the strategy opted in, forward each trade as
a synthetic tick into `StrategyRunner.onMarketTick` with the current engine
snapshot. Single event loop ⇒ ordering with real WS ticks is naturally
serialized in arrival order.

### Replay side

Per market, heap-merge two ordered streams before dispatch:

1. the parquet orderbook events (existing replay), keyed by `ts_exchange_ms`;
2. the loaded aggTrade series, keyed by visibility time `T + latencyOffset`.

Deterministic tie-break at equal timestamps: **orderbook events first, then
Binance trades by `agg_trade_id`** (mirrors live, where the book event that
"caused" the same wall-clock moment is processed by the engine before the
sampled feed value is read; any fixed rule works as long as it is documented
and stable).

### Things the implementation MUST audit

- **Plugins** run on every tick (`PluginSet.onMarketTick`): DwellGate,
  TimeWindowGate, TechnicalIndicators etc. will now also advance on synthetic
  ticks. For time-based gates that is correct (more time resolution); for
  anything counting *events* it must be checked per plugin.
- **Window enforcement** in `runSingleMarket` (strategyWindow filter) must
  apply to synthetic ticks identically.
- **Stats**: `eventsProcessed` / `eventsByType` will include the new type —
  only for opted-in strategies, so existing runs stay comparable.
- **Cascading `onAccountEvent`** reuses the tick-cached plugin snapshot —
  unchanged semantics, but verify with the fill-on-synthetic-tick path
  (BacktestExecution can fill on any tick that moves the book — synthetic
  ticks don't move the book, so no new fill opportunities should appear;
  assert that).
- **Warmup / `isWarmed`**: unchanged (live-only concern).

### Verification bar (same as the feed)

1. Non-opted-in strategies: `backtest:verify-diff` bit-identical before/after.
2. A probe strategy that logs every tick (`event_type`, `snapshot.timestamp`,
   feed value): run live for N minutes while recording, then replay the same
   window — the synthetic-tick sequence (count, order, timestamps modulo
   latency model) must match the recorded live sequence.
3. `binance:verify-aggtrades` stays the ground-truth check for the underlying
   trade stream.

## Consequences

- Strategies gain sub-book-tick reaction to spot moves with full determinism
  in replay (5–21k extra ticks per 15m window — negligible vs the existing
  100–180k).
- The latency model (`BACKTEST_BINANCE_FEED_LATENCY_MS`, measured p50=110ms)
  becomes *more* load-bearing: it now decides **when the strategy acts**, not
  just what value it reads. Re-measuring per machine matters more; a seeded
  per-market latency-distribution sampler (instead of a constant) is the
  natural follow-up if strategies prove latency-sensitive.
- One more tick source to keep in lockstep across live and replay — the
  probe-strategy parity test above should join the standard verification
  checklist whenever either side is touched.

## Alternatives considered

- **Separate hook (`onFeedTick`)** — rejected: two hooks with shared state
  invite ordering bugs; strategies already dispatch on `event_type`.
- **Time-driven replay clock** (fire strategy on a fixed cadence) — rejected:
  live has no such clock; it would break parity rather than extend it.
- **Replay-only synthetic ticks** — rejected outright: backtests would trade
  on wake-ups the live bot never gets.
