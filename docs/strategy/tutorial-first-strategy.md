---
title: 'Tutorial: Write Your First Strategy'
description: A step-by-step walkthrough of building a simple trading strategy — from template to backtest results.
---

# Tutorial: Write Your First Strategy

This tutorial walks you through creating a working strategy from scratch. By the end, you will have a strategy that places a limit buy order when a token's price drops below a threshold, registered in the bot and runnable in backtests.

::: tip Prerequisites
Complete the [Quickstart](/quickstart) first. You need recorded Parquet files and a working backtest setup before following this tutorial.
:::

## What we're building

A strategy that monitors both the YES and NO tokens in a 15-minute market. When either token's best ask price falls below a configured threshold, it places a single GTC limit buy order and then does nothing until the next market window.

## Step 1 — Create the strategy file

Create a new file at `src/strategies/BuyDip.v1.ts`:

```typescript [src/strategies/BuyDip.v1.ts]
import * as z from 'zod'
import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'

// 1. Define and validate params with Zod.
//    Each --param key=value passed on the CLI is validated here.
export const ConfigSchema = z.strictObject({
  triggerAsk: z.coerce.number().finite().min(0.01).max(0.99).default(0.25),
  size: z.coerce.number().finite().positive().default(5),
  limitOffset: z.coerce.number().finite().min(0).max(0.05).default(0.01),
})

export type Config = z.infer<typeof ConfigSchema>

// 2. Export a definition — this is what the registry picks up.
export const definition: StrategyDefinition<Config> = {
  id: 'buyDip.v1',
  title: 'Buy Dip v1',
  description: 'Buys a token when its ask price falls below a threshold.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

function createStrategy(cfg: Config): Strategy {
  const name = 'buyDip.v1'

  // 3. Episode state — reset automatically on each new market window
  //    because create() is called once per episode.
  let ordered = false

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    // Already placed our one order this episode — do nothing.
    if (ordered) return []

    // Skip if we already hold a position.
    const hasPosition = Object.values(portfolio.positionsByAssetId).some((p) => p.qty > 0)
    if (hasPosition) return []

    // Find the cheapest token by best ask.
    let cheapestAssetId: string | null = null
    let cheapestAsk = Infinity

    for (const [assetId, book] of Object.entries(tick.snapshot.byAssetId)) {
      const ask = book.bestAsk
      if (ask !== null && ask < cheapestAsk) {
        cheapestAsk = ask
        cheapestAssetId = assetId
      }
    }

    // Only act when below our trigger threshold.
    if (cheapestAssetId === null || cheapestAsk > cfg.triggerAsk) return []

    ordered = true

    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:buy`,
        assetId: cheapestAssetId,
        side: 'BUY',
        price: Math.min(cheapestAsk + cfg.limitOffset, 0.99),
        size: cfg.size,
        orderType: 'GTC',
        reason: `buyDip: ask=${cheapestAsk.toFixed(4)} trigger=${cfg.triggerAsk}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev) => {
    if (ev.kind === 'fill' && ev.fill.clientOrderId === `${name}:buy`) ordered = true
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
```

## Step 2 — Nothing to register

There's no registry to edit. As long as your file lives under `src/strategies/` and does `export const definition`, it is auto-discovered at startup. Just save the file.

## Step 3 — Verify discovery

```bash
npm run backtest -- --strategy buyDip.v1 --symbol btc --limit 1 --latest
```

If the strategy is not discovered, the command exits immediately with `[strategy] unknown strategy id="buyDip.v1"`. In that case, check the file is under `src/strategies/`, that it does `export const definition`, and that `definition.id` matches the `--strategy` value.

## Step 4 — Run in backtest

```bash
npm run backtest -- \
  --strategy buyDip.v1 \
  --symbol btc \
  --limit 20 \
  --latest \
  --param triggerAsk=0.30 \
  --param size=10
```

This replays the 20 most recent BTC recordings. The output shows per-market results and aggregate statistics.

::: tip Iterate quickly
Change `--param triggerAsk=0.20` to test a different threshold without modifying code. All `--param` values are validated by the Zod schema — invalid values error immediately.
:::

## Step 5 — Interpret the results

Look for these fields in the batch summary:

| Field           | What it tells you                                              |
| --------------- | -------------------------------------------------------------- |
| `winRate`       | Fraction of decisive markets where the strategy made a profit  |
| `pnlTotal`      | Net PnL across all replayed markets in USDC                    |
| `tradesTotal`   | How often the trigger fired                                    |
| `qualitySystem` | Risk-adjusted return: avg/std of per-market PnL (higher is better) |

A low `tradesTotal` with a tight threshold means the trigger rarely fires — try raising `triggerAsk`. A high trade count with negative PnL means the dip wasn't predictive at that threshold.

## What to explore next

- Add a **sell intent** in `onAccountEvent` when the fill arrives — cascade the fill into an immediate limit sell at a higher price.
- Gate on time: use `TimeWindowGatePlugin` to only trade in the middle portion of each window when price discovery is more stable.
- Add a volatility filter: read `ctx.plugins['timeWindowVolatility']` and skip ticks when the market is unusually volatile.
- Run against more data: increase `--limit 100` or use `--dir data/events/btc` to replay your entire archive.

See [Strategy Interface](/strategy/strategy-interface) for the full Intent API, and [Strategy Context](/strategy/strategy-context) for everything available on `ctx`.
