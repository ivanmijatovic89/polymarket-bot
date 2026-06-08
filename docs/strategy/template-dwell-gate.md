---
title: 'Template: Dwell Gate Strategy'
description: Reference for the DwellGate template strategy — how to use DwellGatePlugin to gate trading on sustained price levels.
---

# Template: Dwell Gate Strategy

`src/strategies/templates/TemplateDwellGate.ts` demonstrates how to use `DwellGatePlugin` to open a trading gate only when a token's price has remained within a specified range for a required duration. This pattern avoids entering trades during transient price spikes.

Registry ID: `TemplateDwellGate`

---

## Purpose

The dwell gate pattern answers: "Has the bid (or ask) price of a token stayed within a target range long enough to be considered stable?"

When `dwellUpOk` or `dwellDownOk` is `true`, the corresponding token's price has dwelt within `[from, to]` for at least `requiredMs` milliseconds without leaving that range. The gate resets automatically when the price exits the range.

---

## Parameters

| Parameter              | Type               | Default | Description                                                   |
| ---------------------- | ------------------ | ------- | ------------------------------------------------------------- |
| `dwellRangeFrom`       | `number`           | `0.2`   | Lower bound of the dwell price range (inclusive).             |
| `dwellRangeTo`         | `number`           | `0.35`  | Upper bound of the dwell price range (inclusive).             |
| `dwellSecondsRequired` | `number`           | `60`    | Seconds the price must remain in range before the gate opens. |
| `dwellTrackPrice`      | `'bid'` or `'ask'` | `'bid'` | Which side of the orderbook to track.                         |

CLI usage:

```bash
tsx src/cli/trading-bot.ts --strategy TemplateDwellGate \
  --param dwellRangeFrom=0.15 \
  --param dwellRangeTo=0.30 \
  --param dwellSecondsRequired=90 \
  --param dwellTrackPrice=bid
```

---

## Plugin Setup

```typescript
import { DwellGatePlugin } from '../../strategy/plugins/DwellGatePlugin.js'

const plugins: Plugin[] = [
  new DwellGatePlugin({
    from: cfg.dwellRangeFrom,
    to: cfg.dwellRangeTo,
    requiredMs: cfg.dwellSecondsRequired * 1000,
    trackPrice: cfg.dwellTrackPrice,
    log: true, // Emits console output when gate state changes.
  }),
]
```

The plugin registers under the key `'dwellGate'` and exposes `{ dwellUpOk: boolean, dwellDownOk: boolean }` each tick. Each boolean corresponds to one of the two outcome tokens (UP / DOWN) of the current market.

---

## The Gate Pattern

```typescript
const dwell = ctx?.plugins?.['dwellGate'] as
  | { dwellUpOk?: unknown; dwellDownOk?: unknown }
  | undefined

const dwellUpOk = dwell?.dwellUpOk === true
const dwellDownOk = dwell?.dwellDownOk === true
```

The template uses these booleans alongside the live bid prices to select which side to sell:

```typescript
const upBid = tick.snapshot.byAssetId[upAssetId]?.bestBid ?? null
const downBid = tick.snapshot.byAssetId[downAssetId]?.bestBid ?? null

const upCanSell = dwellUpOk && upBid !== null
const downCanSell = dwellDownOk && downBid !== null

// Side selection: prefer whichever side has the lower bid (more attractive sell).
let side: 'UP' | 'DOWN' | null = null
if (upCanSell && !downCanSell) side = 'UP'
else if (!upCanSell && downCanSell) side = 'DOWN'
else if (upCanSell && downCanSell) side = upBid <= downBid ? 'UP' : 'DOWN'

if (!side) return []
```

This pattern ensures the gate drives the side selection decision, not an arbitrary preference.

---

## Full Config Schema

```typescript
const ConfigSchema = z.strictObject({
  dwellRangeFrom: z.coerce.number().finite().default(0.2),
  dwellRangeTo: z.coerce.number().finite().default(0.35),
  dwellSecondsRequired: z.coerce.number().finite().nonnegative().default(60),
  dwellTrackPrice: z.enum(['bid', 'ask']).default('bid'),
})
```

---

## Strategy Source

```typescript
export function createStrategy(cfg: Config): { strategy: Strategy; plugins: Plugin[] } {
  const name = 'TemplateDwellGate'

  const plugins: Plugin[] = [
    new DwellGatePlugin({
      from: cfg.dwellRangeFrom,
      to: cfg.dwellRangeTo,
      requiredMs: cfg.dwellSecondsRequired * 1000,
      trackPrice: cfg.dwellTrackPrice,
      log: true,
    }),
  ]

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const nowMs = tick.snapshot.timestamp
    if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return []

    const upAssetId = ctx?.market?.upAssetId ?? null
    const downAssetId = ctx?.market?.downAssetId ?? null
    if (!upAssetId || !downAssetId) return []

    const dwell = ctx?.plugins?.['dwellGate'] as
      | { dwellUpOk?: unknown; dwellDownOk?: unknown }
      | undefined
    const dwellUpOk = dwell?.dwellUpOk === true
    const dwellDownOk = dwell?.dwellDownOk === true

    const upBid = tick.snapshot.byAssetId[upAssetId]?.bestBid ?? null
    const downBid = tick.snapshot.byAssetId[downAssetId]?.bestBid ?? null

    const upCanSell = dwellUpOk && upBid !== null
    const downCanSell = dwellDownOk && downBid !== null

    let side: 'UP' | 'DOWN' | null = null
    if (upCanSell && !downCanSell) side = 'UP'
    else if (!upCanSell && downCanSell) side = 'DOWN'
    else if (upCanSell && downCanSell)
      side = (upBid as number) <= (downBid as number) ? 'UP' : 'DOWN'

    if (!side) return []

    const assetId = side === 'UP' ? upAssetId : downAssetId
    // Place your sell intent here.
    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent }, plugins }
}
```

---

## Notes

- The dwell timer resets to zero each time the tracked price exits `[from, to]`. A single tick outside the range is enough to reset it.
- `dwellUpOk` and `dwellDownOk` are independent: both can be `true` simultaneously when both tokens have separately satisfied the dwell condition.
- Setting `log: true` produces console output whenever a gate transitions from open to closed or closed to open. Set to `false` in production strategies to reduce noise.
- Both live and backtest modes are supported. In backtests, the plugin uses `tick.snapshot.timestamp` (replay clock) so dwell timing is fully deterministic.
- Combine with `TimeWindowGatePlugin` when you need both a time window and a price dwell condition. See [Template: Time Window Gate Strategy](./template-time-window-gate.md).
