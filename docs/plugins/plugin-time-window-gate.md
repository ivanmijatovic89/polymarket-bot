---
title: Time Window Gate Plugin
description: Reference for the TimeWindowGatePlugin — a gate that is open only during a configured elapsed-time window relative to the Gamma market start time.
---

# Time Window Gate Plugin

**Plugin ID:** `timeWindowGate`  
**Class:** `TimeWindowGatePlugin`  
**Source:** `src/strategy/plugins/TimeWindowGatePlugin.ts`

The Time Window Gate Plugin evaluates whether the current tick falls within a configured elapsed-time window relative to the Gamma market's start time. It exposes a single boolean (`withinWindow`) indicating gate state, plus diagnostic fields for the elapsed time and window boundaries.

"Elapsed time" here means the number of milliseconds that have passed since the Gamma market opened. The gate is open when `elapsed >= allowAfterMs && elapsed <= disableAfterMs`.

This plugin operates entirely in-process, requires no network access, and is compatible with both live trading and backtesting.

---

## Configuration

The plugin is instantiated with the following parameters:

```typescript
type TimeWindowGateConfig = {
  /** Gate opens this many milliseconds after market start. */
  allowAfterMs: number

  /** Gate closes this many milliseconds after market start. */
  disableAfterMs: number

  /**
   * Optional console logging.
   * Pass `true` for default 5-second interval logging.
   * Pass `{ everyMs?: number; logChangeOnly?: boolean }` for fine-grained control.
   */
  log?:
    | boolean
    | {
        everyMs?: number
        /** Only log on transitions between active and inactive. */
        logChangeOnly?: boolean
      }
}
```

### Configuration Fields

| Field            | Type                | Required | Description                                                                                                                                                        |
| ---------------- | ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `allowAfterMs`   | `number`            | Yes      | Gate opens this many milliseconds after the Gamma market start time.                                                                                               |
| `disableAfterMs` | `number`            | Yes      | Gate closes this many milliseconds after the Gamma market start time.                                                                                              |
| `log`            | `boolean \| object` | No       | Enables console logging. `true` logs at 5-second intervals. Pass `{ everyMs, logChangeOnly }` for custom interval or transition-only logging. Default: no logging. |

::: tip Elapsed time is market-relative
Both thresholds are measured from the Gamma market's `start_time`, not from the Polymarket 15-minute window epoch. The market start time is read via `parseGammaMarketStartMs(ctx.market)` on each tick.
:::

---

## Output Type

```typescript
type TimeWindowGateSnapshot = {
  allowAfterMs: number
  disableAfterMs: number
  withinWindow: boolean
  startMs: number | null
  nowMs: number | null
  elapsedMs: number | null
}
```

---

## Output Fields

| Field            | Type             | Description                                                                                                                                                           |
| ---------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowAfterMs`   | `number`         | Configured gate-open threshold in milliseconds, echoed from construction.                                                                                             |
| `disableAfterMs` | `number`         | Configured gate-close threshold in milliseconds, echoed from construction.                                                                                            |
| `withinWindow`   | `boolean`        | `true` when `elapsedMs >= allowAfterMs && elapsedMs <= disableAfterMs`. `false` before the gate opens, after it closes, or when the market start time is unavailable. |
| `startMs`        | `number \| null` | Parsed Gamma market start time in milliseconds. `null` if the context does not contain a valid market start time.                                                     |
| `nowMs`          | `number \| null` | Timestamp of the current tick in milliseconds (`tick.snapshot.timestamp`). `null` if the tick timestamp is not a finite number.                                       |
| `elapsedMs`      | `number \| null` | `nowMs - startMs`. `null` when either `nowMs` or `startMs` is `null`.                                                                                                 |

---

## Gate Open Logic

The gate is evaluated as follows on each tick:

```
withinWindow = (nowMs !== null)
  && (startMs !== null)
  && (elapsedMs >= allowAfterMs)
  && (elapsedMs <= disableAfterMs)
```

All three conditions must hold simultaneously. The gate evaluates to `false` when:

- The tick timestamp is absent or non-finite.
- The Gamma market start time cannot be parsed from `ctx.market`.
- The elapsed time is less than `allowAfterMs` (market too new).
- The elapsed time exceeds `disableAfterMs` (market too old).

---

## Accessing the Snapshot in a Strategy

```typescript
import type { TimeWindowGateSnapshot } from '../plugins/TimeWindowGatePlugin.js'

onMarketTick(ctx, snapshot): Intent[] {
  const gate = ctx.plugins.timeWindowGate?.snapshot() as
    TimeWindowGateSnapshot | undefined

  if (!gate?.withinWindow) return []

  // Gate is open — the market has been live for between allowAfterMs and disableAfterMs
  return [/* place orders */]
}
```

For diagnostics, use `elapsedMs` and the boundary fields:

```typescript
const pct =
  gate.elapsedMs !== null
    ? (
        ((gate.elapsedMs - gate.allowAfterMs) / (gate.disableAfterMs - gate.allowAfterMs)) *
        100
      ).toFixed(1)
    : 'n/a'
// e.g. "34.7" — 34.7% through the active window
```

::: details PluginSet registration example

```typescript
import { TimeWindowGatePlugin } from '../plugins/TimeWindowGatePlugin.js'

const pluginSet = new PluginSet([
  new TimeWindowGatePlugin({
    allowAfterMs: 60_000, // open 1 minute after market start
    disableAfterMs: 840_000, // close 14 minutes after market start
    log: { logChangeOnly: true },
  }),
])
```

:::

---

## Multiple Windows

The `TimeWindowGatePlugin` models a single contiguous time window. To gate on multiple disjoint windows, instantiate multiple plugins with different IDs, or implement the combination logic directly in the strategy:

```typescript
onMarketTick(ctx, snapshot): Intent[] {
  const gate = ctx.plugins.timeWindowGate?.snapshot() as TimeWindowGateSnapshot | undefined

  // Alternatively, compute multiple windows in strategy logic:
  const elapsed = gate?.elapsedMs ?? null
  if (elapsed === null) return []

  const inEarlyWindow = elapsed >= 60_000  && elapsed <= 300_000
  const inLateWindow  = elapsed >= 600_000 && elapsed <= 840_000
  if (!inEarlyWindow && !inLateWindow) return []

  // ...
  return []
}
```

---

## Behaviour Notes

- The plugin's `reset()` method resets the internal logging state. Statistical state is not applicable — the gate is stateless between ticks.
- `StrategyRunner` calls `reset()` between market window episodes in backtests.
- In backtests, `tick.snapshot.timestamp` reflects the recorded exchange timestamp, so the gate evaluates correctly against the historical market timeline.
