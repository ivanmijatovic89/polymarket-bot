# TimeWindowVolatility plugin (`ctx.plugins.timeWindowVolatility`)

Time-based volatility plugin using **bestAsk** (\"price you can buy\") per asset.

## Usage

### 1) Create a `PluginSet` and register the plugin

```ts
import { PluginSet } from '../strategy/plugins/PluginSet.js'
import { TimeWindowVolatility } from '../strategy/plugins/TimeWindowVolatility.js'

const pluginSet = new PluginSet()
pluginSet.register(
  new TimeWindowVolatility({
    windows: {
      '1s': 1_000,
      '5s': 5_000,
      '10s': 10_000,
      '60s': 60_000,
    },
  }),
)
```

Return `{ strategy, pluginSet }` from the strategy factory so `StrategyRunner` can update it.

### 2) Read it in a strategy

```ts
const vol = ctx?.plugins?.['timeWindowVolatility']
```

The snapshot shape is:

- `vol.asOfTsMs`: timestamp of the latest tick processed
- `vol.byAssetId[assetId][windowLabel]`: window stats (stddev, range, etc.)

