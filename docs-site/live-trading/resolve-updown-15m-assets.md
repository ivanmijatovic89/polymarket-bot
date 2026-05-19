---
title: Resolve UP/DOWN 15m Assets
description: Reference for how the bot discovers current UP/DOWN 15-minute token IDs from the Gamma API, the slug format, and the window guard that prevents subscribing to stale markets.
---

# Resolve UP/DOWN 15m Assets

## What UP/DOWN tokens are

Each 15-minute Polymarket crypto market contains exactly two conditional tokens:

- **UP** — resolves to $1.00 if the asset closes above its opening price within the 15-minute window.
- **DOWN** — resolves to $1.00 if the asset closes at or below its opening price.

Every window is a fresh binary market with new token IDs (`clobTokenIds`). The bot must resolve these IDs at startup and again at each 15-minute boundary before it can subscribe to the order book or place orders.

## Market slug format

Markets are identified by a slug with the structure:

```
<symbol>-updown-15m-<epochSeconds>
```

Examples:

```
btc-updown-15m-1716825600
eth-updown-15m-1716826500
```

`<epochSeconds>` is the Unix timestamp (in seconds) of the window's start time. The window ends exactly 15 minutes (900 seconds) later.

## How the bot resolves current token IDs

The function `resolveCurrentUpDown15mAssets` (`src/polymarket/resolveUpDown15mAssets.ts`) performs the resolution:

1. Calls `getCurrentUpDown15mMarket(symbol, date)`, which queries the Gamma API for the active UP/DOWN market for the given symbol at the given wall-clock time.
2. Extracts the first two entries from `clobTokenIds` — index 0 is the UP token, index 1 is the DOWN token.
3. Builds a `tokenMap` of `{ outcome: tokenId }` pairs (e.g., `{ "Up": "0x...", "Down": "0x..." }`).
4. Returns the resolved structure:

```typescript
type ResolvedUpDown15mAssets = {
  market: UpDown15mMarket // full Gamma market metadata
  slug: string // e.g. "btc-updown-15m-1716825600"
  assetsIds: string[] // [upTokenId, downTokenId]
  label: string // "gamma:<slug>"
  tokenMap: Record<string, string> // { "Up": "0x...", "Down": "0x..." }
}
```

If no active market is found for the symbol, the function throws an error and the caller (the market event source) retries with exponential backoff.

## 15-minute window rotation

The trading bot schedules a rotation callback at each 15-minute UTC boundary using `createWindowBoundaryScheduler`. When the boundary fires:

1. The current market WebSocket subscription is stopped.
2. `resolveCurrentUpDown15mAssets` is called again to obtain the new window's token IDs.
3. The order book engine and plugins are reset.
4. A new WebSocket subscription is started for the new token IDs.

The market warmup sequence (pre-fetching tick-size, fee, and negRisk metadata from the CLOB) also runs on each rotation, so strategies can gate order placement until `ctx.warmup.status === 'warmed'`.

## Window guard: preventing stale market subscriptions

The Gamma API occasionally returns the previous window's market for a brief period around boundaries. Subscribing to a previous-window market would send ticks for an already-closed 15-minute episode.

The guard is implemented in `src/polymarket/upDown15mWindowGuard.ts` via two exported utilities:

### `parseUpDown15mSlugEpochMs`

```typescript
function parseUpDown15mSlugEpochMs(args: { slug: string; symbol: string }): number | null
```

Parses the epoch milliseconds of a slug's window start. Returns `null` if the slug does not match the expected pattern for the given symbol.

### `throwIfPreviousWindowSlug`

```typescript
function throwIfPreviousWindowSlug(args: {
  slug: string
  symbol: string
  windowMs: number
  nowMs: number
  waitMs?: number
  messagePrefix?: string
}): void
```

Compares the slug's epoch against `floorToWindowStart(nowMs, windowMs)`. If the slug's start time is earlier than the expected current window start, it throws a `RetryLaterError` with `waitMs` (default 500 ms). The caller catches this error and schedules a retry instead of proceeding with the stale market.

```typescript
class RetryLaterError extends Error {
  readonly waitMs: number
}
```

### Guard behavior in the trading bot

Inside `resolveAssetsIds`, the trading bot calls `throwIfPreviousWindowSlug` immediately after receiving a result from `resolveCurrentUpDown15mAssets`. If the guard throws:

- If `currentMarket` has not yet been set (startup), `currentSlug` and `currentMarket` are cleared and the error propagates, causing a retry.
- If `currentMarket` is already set (mid-run rotation), the existing valid state is preserved and the error propagates, causing the rotation to retry until Gamma returns the new window's market.

::: tip Retry timing
The default `waitMs` of 500 ms keeps retries lightweight. In practice Gamma updates within one to two seconds of the boundary.
:::

## Supported symbols

| Symbol   | Env value |
| -------- | --------- |
| Bitcoin  | `BTC`     |
| Ethereum | `ETH`     |
| Solana   | `SOL`     |
| XRP      | `XRP`     |

The symbol is set via `TRADING_SYMBOL` (or `RECORD_SYMBOL` as a fallback) and must be one of the four values above. An unsupported value causes an immediate startup error.
