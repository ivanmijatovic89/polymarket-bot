---
title: Dwell Gate Plugin
description: Reference for the DwellGatePlugin — a gate that opens when both the UP and DOWN asset prices have held within a configured range for a minimum continuous duration.
---

# Dwell Gate Plugin

**Plugin ID:** `dwellGate`  
**Class:** `DwellGatePlugin`  
**Source:** `src/strategy/plugins/DwellGatePlugin.ts`

The Dwell Gate Plugin tracks whether the bid or ask price of both the UP and DOWN assets have remained within a specified price range for a minimum continuous duration. When either asset leaves the range, its dwell timer resets. The plugin exposes per-asset gate state and elapsed dwell time on every tick.

"Dwell" refers to a price dwelling — remaining continuously within a range — for at least `requiredMs` milliseconds without interruption.

This plugin operates entirely in-process, requires no network access, and is compatible with both live trading and backtesting.

---

## Configuration

The plugin is instantiated with the following parameters:

```typescript
type DwellGateConfig = {
  /** Lower bound of the price range (inclusive). */
  from: number

  /** Upper bound of the price range (inclusive). */
  to: number

  /** Minimum continuous in-range duration required to open the gate (milliseconds). */
  requiredMs: number

  /** Which side of the book to observe. */
  trackPrice: 'bid' | 'ask'

  /**
   * Optional console logging.
   * Pass `true` for default 5-second interval logging.
   * Pass `{ everyMs: number }` to customise the interval.
   */
  log?: boolean | { everyMs?: number }
}
```

### Configuration Fields

| Field        | Type                              | Required | Description                                                                                                                                    |
| ------------ | --------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `from`       | `number`                          | Yes      | Lower bound of the dwell range. The effective lower bound is always `Math.min(from, to)`.                                                      |
| `to`         | `number`                          | Yes      | Upper bound of the dwell range. The effective upper bound is always `Math.max(from, to)`.                                                      |
| `requiredMs` | `number`                          | Yes      | Continuous in-range duration (ms) required before the gate is considered open (`ok = true`).                                                   |
| `trackPrice` | `'bid' \| 'ask'`                  | Yes      | Which price to observe for each asset. `'bid'` uses `bestBid`; `'ask'` uses `bestAsk`.                                                         |
| `log`        | `boolean \| { everyMs?: number }` | No       | When set, logs range entry/exit and periodic in-range status to the console. The `everyMs` sub-option (default `5000`) controls log frequency. |

::: tip Range order
`from` and `to` may be provided in any order. The plugin normalises them so that `lo = Math.min(from, to)` and `hi = Math.max(from, to)`.
:::

---

## Output Type

```typescript
type DwellGateSnapshot = {
  from: number
  to: number
  requiredMs: number
  trackPrice: 'bid' | 'ask'
  dwellUpOk: boolean
  dwellDownOk: boolean
  up: {
    inRange: boolean
    elapsedInRangeMs: number | null
    remainingMs: number | null
  }
  down: {
    inRange: boolean
    elapsedInRangeMs: number | null
    remainingMs: number | null
  }
}
```

---

## Output Fields

### Configuration Echo

| Field        | Type             | Description                                           |
| ------------ | ---------------- | ----------------------------------------------------- |
| `from`       | `number`         | Configured lower bound, as passed to the constructor. |
| `to`         | `number`         | Configured upper bound, as passed to the constructor. |
| `requiredMs` | `number`         | Configured minimum dwell duration in milliseconds.    |
| `trackPrice` | `'bid' \| 'ask'` | Configured price side being tracked.                  |

### Gate State

| Field         | Type      | Description                                                                                                                                                   |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dwellUpOk`   | `boolean` | `true` when the UP asset has remained within `[from, to]` for at least `requiredMs` ms continuously. Resets to `false` the moment the price leaves the range. |
| `dwellDownOk` | `boolean` | `true` when the DOWN asset has remained within `[from, to]` for at least `requiredMs` ms continuously.                                                        |

### Per-Asset Detail: `up` and `down`

| Field              | Type             | Description                                                                                                                                             |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inRange`          | `boolean`        | Whether the asset price is currently within `[from, to]`.                                                                                               |
| `elapsedInRangeMs` | `number \| null` | Milliseconds the price has been continuously in range since last entry. `null` when `inRange` is `false`.                                               |
| `remainingMs`      | `number \| null` | Milliseconds remaining until `requiredMs` is met: `max(0, requiredMs - elapsedInRangeMs)`. `null` when `inRange` is `false`. `0` when the gate is open. |

::: warning Asset ID dependency
The plugin reads `ctx.market.upAssetId` and `ctx.market.downAssetId` from the strategy context on each tick. If these are unavailable (e.g. the market context is not set), all gate fields default to `false` / `null` for that tick.
:::

---

## Gate Open Semantics

The gate for an asset (`dwellUpOk` / `dwellDownOk`) opens when:

- The asset price has been **continuously** within `[lo, hi]` (where `lo = Math.min(from, to)`, `hi = Math.max(from, to)`) for at least `requiredMs` milliseconds without a single out-of-range observation.

The gate resets immediately on the first tick where the price is outside the range, regardless of how long it had been open.

Both gates are evaluated **independently**. A strategy that requires both sides may gate on `dwellUpOk && dwellDownOk`.

---

## Accessing the Snapshot in a Strategy

```typescript
import type { DwellGateSnapshot } from '../plugins/DwellGatePlugin.js'

onMarketTick(ctx, snapshot): Intent[] {
  const dwell = ctx.plugins.dwellGate?.snapshot() as
    DwellGateSnapshot | undefined

  if (!dwell) return []

  if (!dwell.dwellUpOk || !dwell.dwellDownOk) {
    // Gate not yet open — show remaining time for diagnostics
    const remaining = Math.max(
      dwell.up.remainingMs ?? Infinity,
      dwell.down.remainingMs ?? Infinity,
    )
    return []
  }

  // Both UP and DOWN have dwelled — proceed with order logic
  return [/* ... */]
}
```

::: details PluginSet registration example

```typescript
import { DwellGatePlugin } from '../plugins/DwellGatePlugin.js'

const pluginSet = new PluginSet([
  new DwellGatePlugin({
    from: 0.45,
    to: 0.55,
    requiredMs: 10_000, // 10 seconds
    trackPrice: 'bid',
    log: { everyMs: 5_000 },
  }),
])
```

:::

---

## Behaviour Notes

- The dwell clock starts the moment a price enters the range and stops immediately on range exit.
- Each of the UP and DOWN assets has its own independent dwell tracker.
- The plugin's `reset()` method clears both trackers. `StrategyRunner` calls `reset()` between market window episodes in backtests.
- If `tick.snapshot.timestamp` is not a finite number, the snapshot defaults to all gates closed.
