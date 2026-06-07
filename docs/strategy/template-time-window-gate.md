---
title: 'Template: Time Window Gate Strategy'
description: Reference for the TimeWindowGate template strategy — how to use TimeWindowGatePlugin to restrict trading to a configurable time window within a market episode.
---

# Template: Time Window Gate Strategy

`src/strategies/templates/TemplateTimeWindowGate.ts` demonstrates how to use `TimeWindowGatePlugin` to restrict trading to a configurable time window within a Polymarket 15-minute market episode.

Registry ID: `TemplateTimeWindowGate`

---

## Purpose

The time window gate pattern controls _when_ within a market window a strategy is permitted to act. It answers two questions:

- How long after the market opens should the strategy wait before trading?
- At what point before the market closes should the strategy stop trading?

This is useful for avoiding the illiquid period immediately after market open or reducing exposure near expiration.

---

## Parameters

| Parameter                              | Type     | Default | Description                                             |
| -------------------------------------- | -------- | ------- | ------------------------------------------------------- |
| `timeFilterAllowTradingAfterSeconds`   | `number` | `180`   | Seconds after market open before trading is permitted.  |
| `timeFilterDisableTradingAfterSeconds` | `number` | `600`   | Seconds after market open at which trading is disabled. |

Both values are measured from the Polymarket market episode start time (as tracked by the plugin internally). With the defaults, trading is allowed from **3 minutes** to **10 minutes** after market open — a 7-minute window within the 15-minute episode.

CLI usage:

```bash
tsx src/cli/trading-bot.ts --strategy TemplateTimeWindowGate \
  --param timeFilterAllowTradingAfterSeconds=120 \
  --param timeFilterDisableTradingAfterSeconds=720
```

---

## Plugin Setup

The plugin is instantiated in the factory and added to the `plugins` array:

```typescript
import { TimeWindowGatePlugin } from '../../strategy/plugins/TimeWindowGatePlugin.js'

const plugins: Plugin[] = [
  new TimeWindowGatePlugin({
    allowAfterMs: cfg.timeFilterAllowTradingAfterSeconds * 1000,
    disableAfterMs: cfg.timeFilterDisableTradingAfterSeconds * 1000,
  }),
]
```

The plugin registers under the key `'timeWindowGate'` and exposes a `{ withinWindow: boolean }` snapshot each tick.

---

## The Gate Pattern

Inside `onMarketTick`, read the gate state from `ctx.plugins`:

```typescript
const withinWindow =
  (ctx?.plugins?.['timeWindowGate'] as { withinWindow?: unknown } | undefined)?.withinWindow ===
  true

if (withinWindow) {
  // Execute trading logic here.
} else {
  // Outside the allowed window: do nothing.
  return []
}
```

The explicit `=== true` comparison is intentional: it handles the `undefined` case (plugin not yet computed) as `false`, which means the gate defaults to closed when the snapshot is unavailable.

---

## Full Config Schema

```typescript
const ConfigSchema = z.strictObject({
  timeFilterAllowTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(180),
  timeFilterDisableTradingAfterSeconds: z.coerce.number().finite().nonnegative().default(600),
})
```

---

## Strategy Source

```typescript
export function createStrategy(cfg: Config): { strategy: Strategy; plugins: Plugin[] } {
  const name = 'TemplateTimeWindowGate'
  const plugins: Plugin[] = [
    new TimeWindowGatePlugin({
      allowAfterMs: cfg.timeFilterAllowTradingAfterSeconds * 1000,
      disableAfterMs: cfg.timeFilterDisableTradingAfterSeconds * 1000,
    }),
  ]

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const withinWindow =
      (ctx?.plugins?.['timeWindowGate'] as { withinWindow?: unknown } | undefined)?.withinWindow ===
      true

    if (withinWindow) {
      // Place orders here.
    }

    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent }, plugins }
}
```

---

## Notes

- `TimeWindowGatePlugin` does not log by default in this template. To enable logging, pass `log: true` to the constructor.
- The gate is open only while `allowAfterMs <= elapsed < disableAfterMs`. If `allowAfterMs >= disableAfterMs`, the gate is never open.
- In backtests, the plugin uses the tick's `snapshot.timestamp` (replay clock) — not the system clock — so gate timing is deterministic.
- Combine with `DwellGatePlugin` when you also need a price-level condition. See [Template: Dwell Gate Strategy](./template-dwell-gate.md).
