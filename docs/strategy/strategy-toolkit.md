---
title: Strategy Toolkit
description: Reference for every helper function exported from strategyToolkit.ts.
---

# Strategy Toolkit

`src/strategy/strategyToolkit.ts` exports a small set of utility functions shared across strategies. Import from it rather than re-implementing these primitives:

```typescript
import {
  safeProbabilityPrice,
  parseGammaMarketStartMs,
  requiredTradeRank,
  isOrderTradeStatusAtLeast,
  isWarmed,
} from '../../strategy/strategyToolkit.js'
```

---

## `safeProbabilityPrice`

```typescript
function safeProbabilityPrice(p: number): number
```

Clamps a number to the valid Polymarket probability price range `[0, 1]`. Non-finite inputs (e.g. `NaN`, `Infinity`) are mapped to `0`.

**When to use:** Before submitting any price to a `place_limit` or `place_batch` intent. Polymarket rejects orders with prices outside `[0.01, 0.99]` (the exchange further enforces tick-size increments), but clamping to `[0, 1]` first prevents passing obviously invalid numbers to `OrderManager`.

```typescript
const sellPrice = safeProbabilityPrice(cfg.sellPrice)
// If cfg.sellPrice is 1.2, sellPrice becomes 1.0.
// If cfg.sellPrice is NaN, sellPrice becomes 0.
```

---

## `parseGammaMarketStartMs`

```typescript
function parseGammaMarketStartMs(market?: unknown): number | null
```

Extracts the market start time in epoch milliseconds from a raw Gamma API market object. Returns `null` when the start time cannot be determined.

**Resolution order:**

1. `market.eventStartTime` — preferred when present and non-empty.
2. `market.startDate` — fallback.

**When to use:** When a strategy needs to compute elapsed time since market open (e.g. to gate trading to a specific window within the 15-minute episode). Accepts the raw `ctx.market` object directly.

```typescript
const startMs = parseGammaMarketStartMs(ctx?.market)
if (startMs === null) return [] // Cannot determine market start; skip.

const elapsedMs = tick.snapshot.timestamp - startMs
if (elapsedMs < 60_000) return [] // Do not trade within the first minute.
```

---

## `requiredTradeRank`

```typescript
type TradeStatusName = 'MATCHED' | 'MINED' | 'CONFIRMED'

function requiredTradeRank(s: TradeStatusName): 1 | 2 | 3
```

Maps a Polymarket trade status name to its numeric rank:

| Status      | Rank |
| ----------- | ---- |
| `MATCHED`   | 1    |
| `MINED`     | 2    |
| `CONFIRMED` | 3    |

**When to use:** Internally by `isOrderTradeStatusAtLeast`. Rarely needed directly.

---

## `isOrderTradeStatusAtLeast`

```typescript
function isOrderTradeStatusAtLeast(
  portfolio: PortfolioSnapshot,
  clientOrderId: string,
  atLeast: TradeStatusName,
): boolean
```

Returns `true` if the order identified by `clientOrderId` has reached at least the specified trade status rank. Returns `false` when the order is not found in `portfolio.ordersByClientId`.

**When to use:** Before merging positions or selling shares that were just acquired via a fill. Polymarket requires fills to reach `MINED` before the resulting shares can be on-chain merged or sold.

```typescript
const onAccountEvent = (ev, portfolio) => {
  if (ev.kind !== 'fill') return []

  const cid = ev.fill.clientOrderId
  if (!cid) return []

  // Do not attempt to merge until the fill is on-chain.
  if (!isOrderTradeStatusAtLeast(portfolio, cid, 'MINED')) return []

  return [{ kind: 'merge_positions', ... }]
}
```

::: danger MATCHED vs MINED
Strategies that respond to `MATCHED` fills for speed still need `MINED` before attempting a sell or merge on the resulting shares. See the [fill-status semantics](../other/architecture.md) section in the architecture docs.
:::

---

## `isWarmed`

```typescript
function isWarmed(ctx?: StrategyContext): boolean
```

Returns `true` when the CLOB client warmup for the current market window has completed (or when warmup state is not applicable).

**Behaviour:**

| Condition                         | Return value                                                |
| --------------------------------- | ----------------------------------------------------------- |
| `ctx` is `undefined`              | `true` (backtest mode; warmup not applicable)               |
| `ctx.warmup` is `undefined`       | `true` (warmup tracking not configured)                     |
| `ctx.warmup.status === 'warming'` | `false`                                                     |
| `ctx.warmup.status === 'warmed'`  | `true`                                                      |
| `ctx.warmup.status === 'error'`   | `true` (warmup failed; strategy decides whether to proceed) |

**When to use:** At the top of `onMarketTick` in any live strategy that places orders. The CLOB client fetches tick-size and fee data lazily on the first order per token; placing orders before warmup completes may result in errors.

```typescript
const onMarketTick = (tick, portfolio, ctx) => {
  if (!isWarmed(ctx)) return []
  // ... rest of strategy logic
}
```

This guard is safe to include in strategies that also run in backtests: `isWarmed` returns `true` in backtest mode because `ctx.warmup` is absent.
