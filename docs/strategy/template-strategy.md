---
title: Template Strategy
description: Reference for the minimal strategy template — structure, sections, and how to adapt it for a new strategy.
---

# Template Strategy

`src/strategies/templates/Template.v1.ts` is the canonical starting point for a new strategy. It demonstrates every structural element a strategy can have: a Zod config schema, a plugin list, the two required hook functions, and the `StrategyDefinition` export.

Registry ID: `template.v1`

---

## File Structure

```
src/strategies/templates/Template.v1.ts
```

A strategy file has four sections:

1. **Config schema** — Zod shape that validates `--param` flags.
2. **`definition` export** — The `StrategyDefinition` object that gets auto-discovered.
3. **`createStrategy` factory** — Constructs plugins, closes over mutable state, and returns `{ strategy, plugins }`.
4. **Hook functions** — `onMarketTick` and `onAccountEvent`.

---

## Config Schema

```typescript
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  logEveryMs: z.coerce.number().finite().int().positive().default(1000),
})

export type Config = z.infer<typeof ConfigSchema>
```

Use `z.strictObject` to reject unknown `--param` keys at startup. All parameters that have a `.default(...)` value are optional at the CLI. Parameters without defaults are required.

`z.coerce.number()` is the standard pattern for numeric CLI params: the CLI delivers all values as strings, and `coerce` handles the conversion.

---

## Definition Export

```typescript
export const definition: StrategyDefinition<Config> = {
  id: 'template.v1',
  title: 'Template v1',
  description: 'Template strategy: placeholder for new strategies.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}
```

The `definition` export is what `strategyRegistry.ts` auto-discovers (it imports every file under `src/strategies/` that exports a `definition`). The `id` must be globally unique. `title` and `description` appear in `listStrategies()` output.

---

## Factory Function

```typescript
export function createStrategy(_cfg: Config): {
  strategy: Strategy
  plugins: Plugin[]
} {
  const name = 'template.v1'

  // Plugin instantiation happens here, once, at startup.
  const plugins = [
    new TimeWindowVolatility({ windows }),
    new ExternalFeedsRequestPlugin({ ... }),
    new DwellGatePlugin({ ... }),
    new TimeWindowGatePlugin({ ... }),
  ]

  // Mutable per-episode state lives here, in the factory closure.
  let splitRequested = false

  const onMarketTick = (...): Intent[] => { ... }
  const onAccountEvent: Strategy['onAccountEvent'] = (...) => { ... }

  const strategy: Strategy = { name, onMarketTick, onAccountEvent }
  return { strategy, plugins }
}
```

The factory is called exactly once per bot startup (or once per backtest run). State variables declared inside the factory closure (`splitRequested`, counters, flags) are episode-scoped for the bot lifetime. In backtests with multiple episodes, use the `onMarketTick` clock rather than wall-clock time to reason about timing.

### Plugins in the factory

Plugins are instantiated as plain class instances in the `plugins` array. The `StrategyRunner` registers them into a `PluginSet` and calls `plugin.onMarketTick(tick, ctx)` before calling the strategy's own `onMarketTick`. The plugin output is then available via `ctx.plugins?.[pluginId]`.

The template demonstrates all currently available plugins — remove those your strategy does not need.

---

## `onMarketTick`

```typescript
const onMarketTick = (
  tick: MarketTick,
  _portfolio: PortfolioSnapshot,
  ctx?: StrategyContext,
): Intent[] => {
  // Live-only warmup gate.
  if (!isWarmed(ctx)) return []

  // Read external feeds (optional).
  const feeds = ctx?.plugins?.['externalFeeds'] as ExternalFeedsSnapshot | undefined

  // Return intents or an empty array.
  return []
}
```

Return an `Intent[]`. Returning `[]` means no action this tick. The function signature accepts `ctx` as optional to maintain compatibility with older strategy code.

**Warmup gate:** `if (!isWarmed(ctx)) return []` is the standard guard. It is a no-op in backtests (where `ctx.warmup` is absent) and prevents order placement during the CLOB client's lazy initialization phase in live trading.

---

## `onAccountEvent`

```typescript
const onAccountEvent: Strategy['onAccountEvent'] = (ev, _portfolio, _lastMarket, _ctx) => {
  // Inspect ev.kind to respond to specific events.
  return []
}
```

The explicit type annotation `Strategy['onAccountEvent']` ensures TypeScript checks the full `AccountEvent` union. Without it, TypeScript cannot verify that all event kinds are handled (or safely ignored via `return []`).

---

## Adapting the Template

To create a new strategy from this template:

1. Copy `Template.v1.ts` to a new file, e.g. `src/strategies/MyStrategy.v1.ts`.
2. Change the `id`, `title`, and `description` in `definition`.
3. Update `ConfigSchema` to reflect the parameters your strategy needs.
4. Remove plugins you do not need from the `plugins` array.
5. Implement logic in `onMarketTick` and `onAccountEvent`.

That's it — keep the file under `src/strategies/` and it's auto-discovered (it already does `export const definition`). No registry to edit.

::: tip Naming convention
Give your file and strategy ID a version suffix from the start (e.g. `MyStrategy.v1`). When the logic changes significantly, create `MyStrategy.v2.ts` with a new ID rather than editing `v1`. This preserves backtest reproducibility for runs that reference the older version.
:::

::: details Template source

```typescript
// Template.v1.ts — abridged for clarity
export const definition: StrategyDefinition<Config> = {
  id: 'template.v1',
  title: 'Template v1',
  description: 'Template strategy: placeholder for new strategies.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

export function createStrategy(_cfg: Config): { strategy: Strategy; plugins: Plugin[] } {
  const name = 'template.v1'
  const plugins = [
    new TimeWindowVolatility({ windows: { '1s': 1000, '5s': 5000, '10s': 10000, '60s': 60000 } }),
    new ExternalFeedsRequestPlugin({
      rtdsCryptoPrices: { binanceSymbols: ['btcusdt'], chainlinkSymbols: ['btc/usd'] },
      binanceWsSpotPrice: { symbol: 'btcusdt' },
      polymarketPriceToBeat: { enabled: true },
    }),
    new DwellGatePlugin({
      from: 0.1,
      to: 0.45,
      requiredMs: 60 * 1000,
      trackPrice: 'bid',
      log: true,
    }),
    new TimeWindowGatePlugin({ allowAfterMs: 100 * 1000, disableAfterMs: 800 * 1000, log: true }),
  ]

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    if (!isWarmed(ctx)) return []
    return []
  }

  const onAccountEvent: Strategy['onAccountEvent'] = () => []

  return { strategy: { name, onMarketTick, onAccountEvent }, plugins }
}
```

:::
