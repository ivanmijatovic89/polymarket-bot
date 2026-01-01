# TimeWindowVolatility indicator

`TimeWindowVolatility` is a **time-based** rolling-volatility indicator that runs on **bestAsk** (the price you can buy now) from the order book snapshot.

It is designed to work identically in:
- **Live trading** (WS → `MarketEngine` → ticks)
- **Backtests** (Parquet replay → `MarketEngine` → ticks)

It uses the tick's **snapshot timestamp** (`tick.snapshot.timestamp`) so calculations are deterministic in replays.

## What it tracks

For each `assetId` (token id) in the market snapshot, and for each configured time window (e.g. `1s`, `2s`, `60s`), it maintains a rolling buffer of samples:

- `Sample = { tsMs, price }`
- `price` is **bestAsk** at that tick for that `assetId`
- samples older than `tsMs - windowMs` are evicted

This is a **time window** (last X milliseconds), not “last N ticks”.

## Snapshot shape

`TimeWindowVolatility.snapshot()` returns:

- `VolatilitySnapshot`
  - `asOfTsMs`: timestamp (ms) of the most recent tick processed
  - `byAssetId`: mapping `{ [assetId]: { [windowLabel]: VolatilityWindowStats } }`

## `VolatilityWindowStats` fields

For a specific `(assetId, windowLabel)`:

- `windowMs`: configured window size in milliseconds (e.g. 60000)
- `n`: number of samples currently inside the rolling window
- `startTsMs`: timestamp of the oldest sample in the current window (or `null` if `n=0`)
- `endTsMs`: timestamp of the newest sample in the current window (or `null` if `n=0`)
- `coverageMs`: `endTsMs - startTsMs` (or `null` if `n=0`)
- `ready`: `coverageMs >= windowMs`
  - Meaning: we have accumulated enough history to represent a “full” window.
- `staleMs`:
  - When `ready=true`: `0`
  - When `ready=false` but we have previously computed a ready value: how many ms have passed since that last ready value was computed.
  - When never ready yet: `null`

### Net direction (raw-only)

- `startPrice`: oldest sample price in the window (bestAsk)
- `endPrice`: newest sample price in the window (bestAsk)
- `netChange`: `endPrice - startPrice`
  - `> 0` means the price ended higher than it started over the window
  - `< 0` means the price ended lower than it started over the window

These are **raw** values (no “up/down/flat” label). Strategies can apply their own thresholds (e.g. cents for binary markets).

### Price extrema

- `low`: lowest observed bestAsk within the window (when ready). Uses a monotonic min queue.
- `high`: highest observed bestAsk within the window (when ready). Uses a monotonic max queue.
- `highLowRange`: `high - low` (when ready)

If `ready=false` but we had a prior ready value, these fields are held at the **last computed** values (same as other metrics), and `staleMs` tells you how old they are.

### Volatility metrics

All values are in **price units** (probability-like prices in `[0,1]`), unless your strategy formats them differently.

- `stddev`: standard deviation of prices in the current window.
  - Computed from rolling sums:
    - \( \mu = \frac{\sum x}{n} \)
    - \( \sigma^2 = \max(0, \frac{\sum x^2}{n} - \mu^2) \)
    - \( \sigma = \sqrt{\sigma^2} \)
- `avgAbsChange`: average absolute change between adjacent samples in time order:
  - \( \frac{1}{n-1} \sum_{i=2}^{n} |x_i - x_{i-1}| \) (for `n>=2`)
  - For `n=1`, it returns `0`.

If `ready=false` and we have never been ready yet, metrics are `null`.

## How it updates (incremental, per tick)

On each market tick:
- For each `assetId` in `tick.snapshot.byAssetId`:
  - read `bestAsk`
  - if `bestAsk` is `null`, skip that asset for that tick
  - otherwise push the sample into each configured rolling window for that asset

Each rolling window maintains:
- rolling `n`, `sum`, `sumSq` for `stddev`
- rolling `sumAbsDiff` for `avgAbsChange`
- monotonic min/max queues for `low/high`
- time-based eviction based on `tsMs - windowMs`

## How to use it

### 1) Create an `IndicatorSet` and register the indicator

```ts
import { IndicatorSet } from '../indicators/IndicatorSet.js'
import { TimeWindowVolatility } from '../indicators/volatility/TimeWindowVolatility.js'

const indicatorSet = new IndicatorSet()
indicatorSet.register(
  new TimeWindowVolatility({
    windows: {
      '1s': 1_000,
      '2s': 2_000,
      '3s': 3_000,
      '5s': 5_000,
      '10s': 10_000,
      '30s': 30_000,
      '60s': 60_000,
    },
  }),
)
```

### 2) Consume from strategy callbacks via `ctx`

In your strategy:
- `ctx.indicators.volatility` is the latest snapshot (updated once per tick by `StrategyRunner`)
- you can read per-asset per-window stats:
  - `ctx.indicators.volatility.byAssetId[assetId]['60s'].stddev`

For a complete working example, see `src/strategies/readVolatilityIndicator.v1.ts`.


