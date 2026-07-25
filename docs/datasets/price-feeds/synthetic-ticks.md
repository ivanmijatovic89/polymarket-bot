---
title: Synthetic Feed Ticks
description: Opt-in extra strategy ticks on every Binance trade and Chainlink round — live and replay identically — via the tickOnUpdate flag.
---

# Synthetic Feed Ticks

By default a strategy's `onMarketTick` fires only when the Polymarket
orderbook moves (`book` / `price_change` events). External feed values are
sampled passively at those moments — which means a strategy cannot *react* to
a spot move until the book happens to tick. Measured on live BTC 15m markets:
**~24% of Binance price transitions occur between two Polymarket ticks** and
were invisible as trigger points.

Synthetic feed ticks close that gap. A strategy that opts in receives an
**extra `onMarketTick` call for every feed update** — each Binance aggTrade
and/or each Chainlink round — in live trading and in backtest replay with
identical semantics. Strategies that do not opt in are **bit-identical** to
before the feature existed (verified — see [Verification](#verification-how-these-numbers-were-measured)).

## Quick start

Opt in per feed with the uniform `tickOnUpdate` flag on
`ExternalFeedsRequestPlugin`:

```typescript
import { ExternalFeedsRequestPlugin } from '../strategy/plugins/ExternalFeedsRequestPlugin.js'

const feeds = new ExternalFeedsRequestPlugin({
  binanceWsSpotPrice: { tickOnUpdate: true }, // tick on every Binance aggTrade
  rtdsCryptoPrices: { tickOnUpdate: true }, // tick on every Chainlink round
  polymarketPriceToBeat: { enabled: true },
})
```

In `onMarketTick`, distinguish what woke you via `tick.msg.event_type`:

```typescript
onMarketTick(tick, portfolio, ctx) {
  const spot = ctx?.plugins?.externalFeeds?.binanceWsSpotPrice
  const oracle = ctx?.plugins?.externalFeeds?.rtdsPolymarketCryptoPrices?.chainlink
  const strike = ctx?.plugins?.externalFeeds?.polymarketPriceToBeat

  switch (tick.msg.event_type) {
    case 'binance_agg_trade':
      // A Binance trade just arrived. tick.snapshot is the UNCHANGED last
      // book; spot.value is the fresh price. React to spot here — e.g.
      // "spot crossed the strike → take liquidity now".
      break
    case 'chainlink_round':
      // A Chainlink round (the price Polymarket resolves with) just arrived.
      break
    default:
      // Normal Polymarket book tick — same as before the feature.
  }
  return []
}
```

Chainlink rounds arrive ~1/s; Binance aggTrades ~2–20/s depending on market
activity — expect roughly 1–20k extra ticks per 15-minute window.

## Semantics (what a synthetic tick is and is not)

| Property | Behavior |
| --- | --- |
| `tick.msg.event_type` | `'binance_agg_trade'` or `'chainlink_round'` (plus `msg.symbol`, e.g. `btcusdt` / `btc/usd`) |
| `tick.snapshot` | The **unchanged** last book snapshot — a synthetic tick carries no book change by definition |
| `tick.snapshot.timestamp` | `max(feed visibility time, last book timestamp)` — a monotone clamp, so strategy time never steps backward |
| Feed values | Read through `ctx.plugins.externalFeeds` exactly like on real ticks, as-of this tick's clock — the update that scheduled the tick is already visible |
| Execution simulator | **Never runs** on a synthetic tick: no maker fills, no GTD expiry, no latency-queue dispatch (an unchanged book must not create fill opportunities live never had). Live equivalent is a no-op, so this is identical in both runtimes |
| Strategy intents | Execute normally — placing a marketable order on a synthetic tick taker-fills against the current book at the synthetic timestamp (that is the feature) |
| Plugins | Skipped by default. Only plugins declaring `handlesSyntheticTicks = true` see synthetic ticks: the feeds plugin and the time gates (`DwellGate`, `TimeWindowGate`). `TimeWindowVolatility` deliberately does **not** — its one-sample-per-tick statistics would be biased (unit-tested byte-equal with and without synthetic ticks) |
| Replay bounds | Ticks are scheduled inside the market window only, and any tick scheduled before the first real book snapshot is dropped — mirroring live, where no book means no tick |

Timing model in replay: a Binance trade at exchange time `T` produces a
synthetic tick at `T + BACKTEST_BINANCE_FEED_LATENCY_MS`; a Chainlink round
broadcast at `B` produces one at `B + BACKTEST_RTDS_CHAINLINK_LATENCY_MS`.
Live, the tick fires at actual local receipt — the same physical quantity the
latency envs model (both were calibrated end-to-end by the
[Parity Harness](/datasets/price-feeds/parity-harness)).

::: warning Multi-symbol chainlink configs
With `tickOnUpdate` and more than one entry in `chainlinkSymbols`, live ticks
on every symbol's round but replay schedules only the first — the bot logs a
warning. Use a single symbol for parity.
:::

::: tip Live connection robustness
The live RTDS socket has twice been observed going silent *without* a close
event (once freezing the chainlink feed — the resolution price — for 28
minutes with zero log output). The client now has an idle watchdog: 30 s
without a **data** message (PONGs don't count) forces a reconnect
(`idleReconnectMs`, `0` disables).
:::

## Verification (how these numbers were measured)

Every claim below is reproducible with the
[Parity Harness](/datasets/price-feeds/parity-harness); run artifacts live in
`data/feeds-parity/<runId>/`.

**Bit-identity for non-opted-in strategies.** The probe strategy was replayed
over the same market on `main` and on the feature branch, in both `recorded`
and `telonex-delta` modes, with per-tick JSONL output — files compared
byte-for-byte (`cmp`): identical (5,241 / 5,526 rows). This is the guarantee
that existing strategies and past results are untouched.

**Determinism with the feature on.** The same telonex market replayed twice
with `tickOnUpdate` on both feeds → byte-identical output (153,436 rows), and
the dispatched synthetic tick count exactly equals the schedule the feed
wiring logs: **18,245 scheduled == 17,349 binance + 896 chainlink
dispatched**.

**Live == replay.** Two live captures (DRY_RUN bot + parallel recording, then
replay of the same period over the recording):

| Capture | Scope | Result |
| --- | --- | --- |
| `202607251006-btc` (75 min) | binance ticks | live 13,464 vs replay 13,461 — **Δ = 0.02%**; binance value agreement 96.2% (was ~84% pre-feature) |
| `202607252048-btc` (50 min) | both feeds | live 5,675 vs replay 5,677 — **Δ = 0.04%**; bias binance −3 ms, chainlink +41 ms (target ≤ 50 ms); chainlink value agreement 92.5% (was 27–53% pre-feature) |

Acceptance thresholds and the backward-time (clamp) check are defined on the
[Parity Harness](/datasets/price-feeds/parity-harness) page. The first
chainlink capture additionally exposed the silent RTDS freeze described
above — in the interval where live had a connection, arrival rates matched
replay (0.95 vs 0.93 rounds/s).

**Guard rails pinned by tests** (all in the repo, run with
`npx tsx --test`): the spurious-maker-fill regression (a synthetic tick must
not fill a resting remainder against a stale crossed book — mutation-tested:
removing the guard fails 3 tests), GTD-expires-on-real-ticks-only,
queued-intents-on-real-ticks-only, `TimeWindowVolatility` sample invariance,
plugin default-skip policy, tick interleaving order and tie-breaks, and a
compile-level test that a synthetic message can never reach the orderbook
engine.

## Related pages

- [ADR: Binance-Driven Strategy Ticks](/backtest/adr-binance-driven-ticks) — the design decision record and implementation notes
- [Binance feed](/datasets/price-feeds/binance/feed) · [Chainlink feed](/datasets/price-feeds/chainlink/feed) — the underlying passive feeds and their datasets
- [Parity Harness](/datasets/price-feeds/parity-harness) — the measuring instrument behind every number on this page
