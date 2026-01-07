import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  // No config needed for this simple test strategy
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'buyBatchLimitGTC.v1',
  title: 'Buy Batch Limit GTC v1',
  description:
    'Test strategy: places a single batch order to buy 100 shares UP and 100 shares DOWN at 0.01 price. Executes only once.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

function pickTwoAssetIds(tick: MarketTick): [string, string] | null {
  const ids = Object.keys(tick.snapshot.byAssetId).sort()
  if (ids.length < 2) return null
  const a = ids[0]
  const b = ids[1]
  if (!a || !b || a === b) return null
  return [a, b]
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
} {
  const name = 'buyBatchLimitGTC.v1'
  let hasPlacedBatch = false
  let startTimeMs: number | null = null
  let lastLoggedSecond = -1
  const delayMs = 3000 // 3 seconds delay

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
  ): Intent[] => {
    void cfg
    void portfolio

    // Only trigger once
    if (hasPlacedBatch) return []

    const assetIds = pickTwoAssetIds(tick)
    if (!assetIds) return []

    const nowMs = tick.snapshot.timestamp || Date.now()

    // Initialize start time on first tick
    if (startTimeMs === null) {
      startTimeMs = nowMs
      console.log('[buyBatchLimitGTC.v1] ⏱️  Starting countdown, will place batch order in 3 seconds...')
    }

    // Check if delay has passed
    const elapsedMs = nowMs - startTimeMs
    const remainingMs = Math.max(0, delayMs - elapsedMs)

    if (remainingMs > 0) {
      // Log countdown every second
      const secondsRemaining = Math.ceil(remainingMs / 1000)
      if (secondsRemaining !== lastLoggedSecond) {
        lastLoggedSecond = secondsRemaining
        console.log(`[buyBatchLimitGTC.v1] ⏱️  Countdown: ${secondsRemaining} second(s) remaining...`)
      }
      return []
    }

    // Delay has passed, place the batch order
    const [assetUp, assetDown] = assetIds

    // Mark as placed immediately to prevent multiple triggers
    hasPlacedBatch = true

    console.log('[buyBatchLimitGTC.v1] ⚡️ Placing batch order NOW!', {
      assetUp,
      assetDown,
      price: 0.01,
      size: 100,
      orderType: 'GTC',
      elapsedMs: elapsedMs.toFixed(0) + 'ms',
    })

    return [
      {
        kind: 'place_batch',
        orders: [
          {
            clientOrderId: `${name}:${assetUp}:buy:${nowMs}`,
            assetId: assetUp,
            side: 'BUY',
            price: 0.01,
            size: 100,
            orderType: 'GTC',
            reason: 'test_batch_up',
          },
          {
            clientOrderId: `${name}:${assetDown}:buy:${nowMs}`,
            assetId: assetDown,
            side: 'BUY',
            price: 0.01,
            size: 100,
            orderType: 'GTC',
            reason: 'test_batch_down',
          },
        ],
        reason: 'test_batch_order_placement',
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (_ev, _portfolio, _lastMarket) => {
    void _ev
    void _portfolio
    void _lastMarket
    // No action needed on account events for this test strategy
    return []
  }

  const strategy: Strategy = {
    name,
    onMarketTick,
    onAccountEvent,
  }

  return { strategy }
}

