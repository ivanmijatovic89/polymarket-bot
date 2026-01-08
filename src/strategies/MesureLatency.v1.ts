import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyContext } from '../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  side: z.enum(['up', 'down']),
  price: z.string(),
  size: z.string(),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'mesureLatency.v1',
  title: 'Measure Latency v1',
  description:
    'Test strategy: places a single LIMIT GTC order for specified side (up/down), price, and size after 3 second delay. Executes only once.',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

function getAssetIdBySide(
  tick: MarketTick,
  ctx: StrategyContext | undefined,
  side: 'up' | 'down',
): string | null {
  const market = ctx?.market
  if (!market) {
    // Fallback: if no market context, try to pick from available assets
    const assetIds = Object.keys(tick.snapshot.byAssetId).sort()
    if (assetIds.length === 0) return null
    // For binary markets, first asset is typically UP, second is DOWN
    return side === 'up' ? assetIds[0] : assetIds[1] || null
  }

  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : []
  const tokenIds = Array.isArray(market.clobTokenIds) ? market.clobTokenIds : []
  const k = Math.min(outcomes.length, tokenIds.length)

  for (let i = 0; i < k; i += 1) {
    const outcome = outcomes[i]
    const tokenId = tokenIds[i]
    const o = typeof outcome === 'string' ? outcome.toLowerCase() : ''
    const id = typeof tokenId === 'string' && tokenId.length > 0 ? tokenId : undefined
    if (!id) continue

    if (side === 'up' && o.includes('up')) return id
    if (side === 'down' && o.includes('down')) return id
  }

  return null
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
} {
  const name = 'mesureLatency.v1'
  let hasPlacedOrder = false
  let startTimeMs: number | null = null
  let lastLoggedSecond = -1
  const delayMs = 3000 // 3 seconds delay

  const price = parseFloat(cfg.price)
  const size = parseFloat(cfg.size)

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`[${name}] Invalid price: ${cfg.price}`)
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`[${name}] Invalid size: ${cfg.size}`)
  }

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void portfolio

    // Only trigger once
    if (hasPlacedOrder) return []

    const assetId = getAssetIdBySide(tick, ctx, cfg.side)
    if (!assetId) return []

    const nowMs = tick.snapshot.timestamp || Date.now()

    // Initialize start time on first tick
    if (startTimeMs === null) {
      startTimeMs = nowMs
      console.log(
        `[${name}] ⏱️  Starting countdown, will place ${cfg.side.toUpperCase()} order in 3 seconds...`,
      )
    }

    // Check if delay has passed
    const elapsedMs = nowMs - startTimeMs
    const remainingMs = Math.max(0, delayMs - elapsedMs)

    if (remainingMs > 0) {
      // Log countdown every second
      const secondsRemaining = Math.ceil(remainingMs / 1000)
      if (secondsRemaining !== lastLoggedSecond) {
        lastLoggedSecond = secondsRemaining
        console.log(`[${name}] ⏱️  Countdown: ${secondsRemaining} second(s) remaining...`)
      }
      return []
    }

    // Delay has passed, place the order
    hasPlacedOrder = true

    console.log(`[${name}] ⚡️ Placing ${cfg.side.toUpperCase()} order NOW!`, {
      assetId,
      side: cfg.side,
      price,
      size,
      orderType: 'GTC',
      elapsedMs: elapsedMs.toFixed(0) + 'ms',
    })

    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${assetId}:buy:${nowMs}`,
        assetId,
        side: 'BUY',
        price,
        size,
        orderType: 'GTC',
        reason: `test_latency_${cfg.side}`,
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
