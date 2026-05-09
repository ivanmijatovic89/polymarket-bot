---
title: Strategy Context
description: Reference for every property available on StrategyContext inside onMarketTick and onAccountEvent.
---

# Strategy Context

`StrategyContext` is passed as the optional third argument to `onMarketTick` and the optional fourth argument to `onAccountEvent`. It provides metadata that is not part of the core tick or portfolio state: market configuration, plugin snapshots, on-chain balances, and the live warmup status.

::: tip Optional by design
All top-level fields on `StrategyContext` are optional. Code defensively — `ctx?.market?.upAssetId` — because context availability differs between live trading, backtesting, and older strategy versions.
:::

## Type Definition

```typescript
type StrategyContext = {
  plugins?: PluginsSnapshot
  market?: GammaMarketMeta
  metrics?: Metrics
  balance?: BalanceSnapshot
  warmup?: WarmupSnapshot // Live only
}
```

---

## `ctx.plugins`

Type: `Record<string, unknown>` (aliased `PluginsSnapshot`)

A snapshot of all plugin outputs for the current tick. Each plugin writes its result under its own string key. The snapshot is computed once per market tick and reused for all `onAccountEvent` calls that cascade from that tick.

Access a plugin by its ID:

```typescript
const vol = ctx?.plugins?.['timeWindowVolatility']
const gate = ctx?.plugins?.['timeWindowGate'] as { withinWindow?: boolean } | undefined
const dwell = ctx?.plugins?.['dwellGate'] as
  | { dwellUpOk?: boolean; dwellDownOk?: boolean }
  | undefined
const feeds = ctx?.plugins?.['externalFeeds'] as ExternalFeedsSnapshot | undefined
```

### Built-in Plugin Keys

| Key                    | Plugin class                 | Snapshot type                                  |
| ---------------------- | ---------------------------- | ---------------------------------------------- |
| `timeWindowVolatility` | `TimeWindowVolatility`       | Volatility statistics per configured window    |
| `timeWindowGate`       | `TimeWindowGatePlugin`       | `{ withinWindow: boolean }`                    |
| `dwellGate`            | `DwellGatePlugin`            | `{ dwellUpOk: boolean; dwellDownOk: boolean }` |
| `externalFeeds`        | `ExternalFeedsRequestPlugin` | `ExternalFeedsSnapshot`                        |

### `ExternalFeedsSnapshot`

Available under `ctx.plugins?.['externalFeeds']` when the strategy declares `requiredFeeds`.

```typescript
type ExternalFeedsSnapshot = {
  rtdsPolymarketCryptoPrices?: {
    binance?: { symbol: string; value: number; tsMs: number }
    chainlink?: { symbol: string; value: number; tsMs: number }
  }
  binanceWsSpotPrice?: { symbol: string; value: number; tsMs: number }
  polymarketPriceToBeat?: { openPrice: number | null }
}
```

::: warning Live only
External feed data is `undefined` in backtests. Any strategy logic that reads from `externalFeeds` must handle the `undefined` case gracefully to be backtest-compatible.
:::

---

## `ctx.market`

Type: `GammaMarketMeta` (optional)

Metadata fetched from the Gamma API for the current 15-minute market window. This object is `undefined` when market metadata has not yet been resolved (early startup or resolution failure).

```typescript
type GammaMarketMeta = Record<string, unknown> & {
  slug: string
  outcomes: string[]
  clobTokenIds: string[]
  outcomeTokenMap: Record<string, string> // lowercased outcome label -> assetId
  upAssetId: string | null // null if market is not an Up/Down type
  downAssetId: string | null
  question?: string
}
```

| Field                | Description                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `slug`               | Polymarket market slug, e.g. `btc-updown-15m-1715000000`.                                      |
| `outcomes`           | Array of outcome labels, e.g. `["Up", "Down"]`.                                                |
| `clobTokenIds`       | Array of CLOB token IDs (assetIds) corresponding to each outcome.                              |
| `outcomeTokenMap`    | Lowercased outcome label to token ID mapping, e.g. `{ "up": "0xabc...", "down": "0xdef..." }`. |
| `upAssetId`          | Token ID for the UP outcome. `null` for non-directional markets.                               |
| `downAssetId`        | Token ID for the DOWN outcome. `null` for non-directional markets.                             |
| `question`           | The market question string from Gamma, if present.                                             |
| _(all other fields)_ | Raw Gamma API fields are preserved via spread; access via `ctx.market?.['fieldName']`.         |

Typical access pattern:

```typescript
const upAssetId = ctx?.market?.upAssetId ?? null
const downAssetId = ctx?.market?.downAssetId ?? null
if (!upAssetId || !downAssetId) return [] // Not an Up/Down market; abort.
```

---

## `ctx.metrics`

Type: `Metrics` (optional)

Pre-computed, strategy-friendly derived metrics for the current tick. Computed by the engine from the current portfolio state and orderbook snapshot. The full type is defined in [Strategy Interface — Metrics](./strategy-interface.md#metrics).

```typescript
type Metrics = {
  position?: PositionMetrics // UP/DOWN position PnL and merge analytics
  orderbook?: OrderbookMetrics // Bid/ask imbalance by depth level
}
```

Access:

```typescript
const pos = ctx?.metrics?.position
const mergeablePairs = pos?.shares_mergeable ?? 0
const pnlIfUpWins = pos?.pnl_if_up_wins ?? 0
```

---

## `ctx.balance`

Type: `BalanceSnapshot` (optional)

The most recent on-chain USDC and POL balance snapshot for the trading wallet(s). Refreshed periodically by the balance tracker during live trading. `undefined` in backtests.

```typescript
type BalanceSnapshot = {
  updatedAtMs: number // When the snapshot was last fetched.
  reason: string // Why the snapshot was triggered (e.g. "fill", "split_success").
  eoa?: UsdcBalanceLite
  safe?: UsdcBalanceLite
  error?: string // Set if a balance check failed.
}

type UsdcBalanceLite = {
  address: string
  usdcBalance: number // Human-readable USDC balance.
  usdcBalanceRaw: string // Raw on-chain value as a string (avoids bigint serialization issues).
  polBalance: number // Human-readable POL (MATIC) balance.
  polBalanceRaw: string
}
```

| Field   | Description                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------- |
| `eoa`   | Balance for the EOA (externally owned account) wallet. Present when `PRIVATE_KEY` is set.       |
| `safe`  | Balance for the SAFE multisig wallet. Present when `CLOB_FUNDER` / `safeAddress` is configured. |
| `error` | Non-fatal error string if one or both balance checks failed during the last refresh.            |

::: tip Balance is cached
The balance tracker applies a cooldown (default 5 seconds) between on-chain calls. The snapshot in `ctx.balance` may be seconds old. Use `updatedAtMs` to assess freshness.
:::

---

## `ctx.warmup`

Type: `WarmupSnapshot` (optional, **live only**)

Indicates whether the CLOB client has completed its first-order warmup for the current market window. The CLOB client lazily fetches tick-size, fee rates, and negRisk data on the first order per token. `warmup` is `undefined` in backtests — `isWarmed(ctx)` returns `true` in that case.

```typescript
type WarmupSnapshot = {
  status: 'warming' | 'warmed' | 'error'
  slug?: string // Market slug being warmed, for debugging.
  assetIds: string[] // Token IDs (typically UP+DOWN) scheduled to warm.
  startedAtMs: number
  finishedAtMs?: number // Set once warmup completes.
  error?: string // Set if warmup encountered an error.
}
```

| `status`  | Meaning                                                        |
| --------- | -------------------------------------------------------------- |
| `warming` | Warmup is in progress. Strategies should not place orders yet. |
| `warmed`  | Warmup succeeded. Safe to place orders.                        |
| `error`   | Warmup failed. Strategies may choose to continue or abort.     |

Use the `isWarmed` helper from `strategyToolkit` rather than reading `ctx.warmup` directly:

```typescript
import { isWarmed } from '../../strategy/strategyToolkit.js'

const onMarketTick = (tick, portfolio, ctx) => {
  if (!isWarmed(ctx)) return [] // Block order placement until warmup is complete.
  // ...
}
```

`isWarmed` returns `true` when `ctx` is absent (backtests) or when `warmup` is absent — safe by default.
