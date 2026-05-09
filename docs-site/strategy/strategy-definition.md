---
title: Strategy Definition and Registration
description: Reference for the StrategyDefinition shape, Zod parameter validation, and how to register a strategy in the registry.
---

# Strategy Definition and Registration

Every strategy must be wrapped in a `StrategyDefinition` and registered in `strategyRegistry.ts`. The definition is the contract between the CLI argument parser and the strategy factory: it declares the strategy's ID, validates parameters, and constructs the strategy instance.

## `StrategyDefinition<TParams>`

```typescript
type StrategyDefinition<TParams> = {
  id: string
  title?: string
  description?: string
  schema: z.ZodType<TParams>
  create: (params: TParams) => BuiltStrategy
}
```

### Fields

| Field         | Type                                 | Required | Description                                                                                                       |
| ------------- | ------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`          | `string`                             | Yes      | Unique strategy identifier. Passed via `--strategy <id>` at the CLI. Must be globally unique across the registry. |
| `title`       | `string`                             | No       | Human-readable display name. Used in list output.                                                                 |
| `description` | `string`                             | No       | Short description. Used in list output.                                                                           |
| `schema`      | `z.ZodType<TParams>`                 | Yes      | Zod schema that validates and coerces `--param` key-value pairs.                                                  |
| `create`      | `(params: TParams) => BuiltStrategy` | Yes      | Factory function. Called once at startup with the validated params. Returns the strategy (and optional plugins).  |

### `BuiltStrategy`

```typescript
type BuiltStrategy = {
  strategy: Strategy
  pluginSet?: PluginSet // Pre-built PluginSet instance (alternative to plugins[]).
  plugins?: Plugin[] // Plugin instances to register (alternative to pluginSet).
}
```

Return either `pluginSet` or `plugins` from `create`, not both. The `StrategyRunner` will wrap a `plugins` array into a `PluginSet` automatically. Omit both when the strategy has no plugins.

---

## Parameter Validation with Zod

`--param key=value` flags are parsed from the CLI as raw strings. The `schema` coerces and validates them before `create` is called.

Use `z.strictObject` to reject unknown parameter keys (recommended):

```typescript
import * as z from 'zod'

const ConfigSchema = z.strictObject({
  splitShares: z.coerce.number().finite().positive().default(100),
  triggerBidBelow: z.coerce.number().finite().default(0.29),
  sellPrice: z.coerce.number().finite().default(0.31),
  sellSize: z.coerce.number().finite().positive().default(10),
})

type Config = z.infer<typeof ConfigSchema>
```

### Coercion rules

All CLI values arrive as strings. Use `z.coerce.number()`, `z.coerce.boolean()`, etc. to convert them.

For JSON array params, pass the value as a quoted JSON string on the CLI and parse inside `create`:

```bash
--param assetIds='["0xabc...","0xdef..."]'
```

```typescript
assetIds: z.string().transform((s) => JSON.parse(s) as string[])
```

### Defaults

Zod `.default(value)` applies when a param is not provided. This means all params with defaults are optional at the CLI. Params without defaults are required.

### Strict mode

`z.strictObject` causes Zod to error if an unrecognized key is supplied. This catches typos in `--param` flags early:

```bash
# Error: unrecognized key 'sellsSize'
tsx src/cli/backtest.ts --strategy SplitSellRedeem.v1 --param sellsSize=5
```

---

## Registering a Strategy

Open `src/strategy/strategyRegistry.ts`. Add an import and an entry to the `strategyRegistry` object:

```typescript
// 1. Import the definition from your strategy file.
import { definition as mySrategyV1 } from '../strategies/myStrategy.v1.js'

// 2. Add it to the registry object.
export const strategyRegistry = {
  // ... existing entries ...
  [myStrategyV1.id]: myStrategyV1,
} as const satisfies Record<string, StrategyDefinition<unknown>>
```

The registry is keyed by the strategy's `id` string. The `as const satisfies` pattern provides compile-time exhaustiveness checking via the derived `StrategyId` union type.

---

## CLI Lookup

When `--strategy <id>` is passed, the CLI calls `getStrategyDefinition(id)`:

```typescript
export function getStrategyDefinition(id: string): StrategyDefinition<unknown> {
  const def = (strategyRegistry as Record<string, StrategyDefinition<unknown>>)[id]
  if (!def) throw new Error(`[strategy] unknown strategy id=${JSON.stringify(id)}`)
  return def
}
```

An unknown ID throws immediately with a clear error message. Strategy IDs are case-sensitive.

---

## `parseStrategyArgs`

The CLI argument parser in `strategyDefinition.ts` extracts the strategy ID and raw params from `process.argv`:

```typescript
function parseStrategyArgs(argv: string[]): {
  strategyId: string
  rawParams: Record<string, string>
}
```

**Behaviour:**

- `--strategy <id>` and `--strategy=<id>` are both accepted.
- `--param key=value` and `--param=key=value` are both accepted.
- Duplicate `--param` keys throw a `CliArgsError`.
- Missing `--strategy` throws a `CliArgsError`.
- Param keys must be non-empty strings followed by `=` and a value.

---

## Listing All Strategies

```typescript
import { listStrategies } from './src/strategy/strategyRegistry.js'

listStrategies().forEach((def) => console.log(def.id, '-', def.title))
```

`listStrategies()` returns all definitions sorted alphabetically by `id`.

---

## Naming Conventions

| Convention                                        | Example                                         |
| ------------------------------------------------- | ----------------------------------------------- |
| IDs use PascalCase with optional `.v<N>` suffix   | `SplitSellRedeem.v1`, `Scalp.v1`                |
| Template IDs use PascalCase prefix `Template`     | `TemplateDwellGate`, `TemplateTimeWindowGate`   |
| File names mirror the ID                          | `SplitSellRedeem.v1.ts`, `TemplateDwellGate.ts` |
| Files live in `src/strategies/` or a subdirectory | `src/strategies/split/SplitSellRedeem.v1.ts`    |

::: tip Versioning strategies
Create a new file (`MyStrategy.v2.ts`) and register a new ID (`MyStrategy.v2`) rather than modifying an existing strategy. This preserves backtest reproducibility: older backtests that reference `v1` will use unchanged logic.
:::
