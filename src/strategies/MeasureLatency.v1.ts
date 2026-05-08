import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyContext } from '../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import { isWarmed } from '../strategy/strategyToolkit.js'
import * as z from 'zod'

export const ConfigSchema = z.strictObject({
  side: z.enum(['up', 'down']),
  price: z.string(),
  size: z.string(),
  totalCycles: z.coerce.number().int().min(1).default(10),
  delayMs: z.coerce.number().int().min(0).default(3000),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'measureLatency.v1',
  title: 'Measure Latency v1',
  description:
    'Test strategy: places a single LIMIT GTC order for specified side (up/down), price, and size after a 3-second delay. Executes only once.',
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
    if (side === 'up') {
      return assetIds[0] ?? null
    }
    return assetIds[1] ?? null
  }

  if (side === 'up') return market.upAssetId
  return market.downAssetId
}

export function createStrategy(cfg: Config): {
  strategy: Strategy
} {
  const name = 'measureLatency.v1'

  // Cycle tracking
  const totalCycles = cfg.totalCycles
  const pauseBetweenCyclesMs = 1000 // 1 second pause
  let currentCycle = 1 // Start from 1, go to 10
  const measurements: Array<{
    cycle: number
    placementLatencyMs: number
    cancelLatencyMs: number
  }> = []

  // Per-cycle state
  let hasPlacedOrder = false
  let startTimeMs: number | null = null
  let lastLoggedSecond = -1
  const delayMs = cfg.delayMs

  // Latency measurement tracking for order placement
  let intentSentAtMs: number | null = null
  let clientOrderIdSent: string | null = null
  let latencyMeasured = false

  // Cancel tracking
  const cancelAfterMs = 2000 // 2 seconds after order appears
  let orderAppearedAtMs: number | null = null
  let cancelDueAtMs: number | null = null
  let cancelSentAtMs: number | null = null
  let cancelLatencyMeasured = false
  let cancelEmitted = false
  let cycleCompletedAtMs: number | null = null

  const price = parseFloat(cfg.price)
  const size = parseFloat(cfg.size)

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`[${name}] Invalid price: ${cfg.price}`)
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`[${name}] Invalid size: ${cfg.size}`)
  }

  function resetCycleState(): void {
    hasPlacedOrder = false
    startTimeMs = null
    lastLoggedSecond = -1
    intentSentAtMs = null
    clientOrderIdSent = null
    latencyMeasured = false
    orderAppearedAtMs = null
    cancelDueAtMs = null
    cancelSentAtMs = null
    cancelLatencyMeasured = false
    cancelEmitted = false
    cycleCompletedAtMs = null
  }

  function logFinalResults(): void {
    if (measurements.length === 0) return

    const placementLatencies = measurements.map((m) => m.placementLatencyMs)
    const cancelLatencies = measurements.map((m) => m.cancelLatencyMs)

    const avgPlacement = placementLatencies.reduce((a, b) => a + b, 0) / placementLatencies.length
    const avgCancel = cancelLatencies.reduce((a, b) => a + b, 0) / cancelLatencies.length

    const minPlacement = Math.min(...placementLatencies)
    const maxPlacement = Math.max(...placementLatencies)
    const minCancel = Math.min(...cancelLatencies)
    const maxCancel = Math.max(...cancelLatencies)

    console.warn(`[${name}] 📊 FINAL RESULTS (${measurements.length} cycles):`, {
      allMeasurements: measurements.map((m) => ({
        cycle: m.cycle,
        placementMs: m.placementLatencyMs.toFixed(2),
        cancelMs: m.cancelLatencyMs.toFixed(2),
      })),
      placementLatency: {
        avg: avgPlacement.toFixed(2) + 'ms',
        min: minPlacement.toFixed(2) + 'ms',
        max: maxPlacement.toFixed(2) + 'ms',
      },
      cancelLatency: {
        avg: avgCancel.toFixed(2) + 'ms',
        min: minCancel.toFixed(2) + 'ms',
        max: maxCancel.toFixed(2) + 'ms',
      },
    })
  }

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void portfolio

    // Don't place new orders until the current market tokens are warmed (live-only).
    // Note: cancel path can still run once an order exists.
    if (!hasPlacedOrder && !isWarmed(ctx)) return []

    // Check if we need to start next cycle after pause
    if (cycleCompletedAtMs !== null && currentCycle < totalCycles) {
      // Use Date.now() for consistent local time measurement
      const nowMs = Date.now()
      const elapsedSinceCompletion = nowMs - cycleCompletedAtMs

      if (elapsedSinceCompletion >= pauseBetweenCyclesMs) {
        currentCycle++
        resetCycleState()
        console.log(`[${name}] 🔄 Starting cycle ${currentCycle}/${totalCycles}`)
      } else {
        return []
      }
    }

    // Handle cancel after order appears (measured + scheduled in onAccountEvent)
    if (
      hasPlacedOrder &&
      latencyMeasured &&
      cancelDueAtMs !== null &&
      !cancelEmitted &&
      clientOrderIdSent
    ) {
      const nowMs = Date.now()
      if (nowMs < cancelDueAtMs) {
        return []
      }

      // Get orderId for cancel
      const openOrder = portfolio.openOrdersByClientId[clientOrderIdSent]
      const orderId = openOrder?.orderId
      if (!orderId) return []

      cancelSentAtMs = Date.now()
      cancelEmitted = true

      console.log(`[${name}] 🚫 Sending CANCEL intent NOW! [Cycle ${currentCycle}]`, {
        clientOrderId: clientOrderIdSent,
        orderId,
        cancelSentAtMs,
      })

      return [
        {
          kind: 'cancel_order',
          clientOrderId: clientOrderIdSent,
          orderId,
          reason: `test_cancel_latency_${cfg.side}_cycle_${currentCycle}`,
        },
      ]
    }

    // Only trigger order placement once per cycle
    if (hasPlacedOrder) return []

    const assetId = getAssetIdBySide(tick, ctx, cfg.side)
    if (!assetId) return []

    // Use Date.now() consistently for all timing (not tick.snapshot.timestamp)
    const nowMs = Date.now()

    // Initialize start time on first tick of cycle
    if (startTimeMs === null) {
      startTimeMs = nowMs
      console.log(
        `[${name}] ⏱️  [Cycle ${currentCycle}] Starting countdown, will place ${cfg.side.toUpperCase()} order in 3 seconds...`,
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
        console.log(
          `[${name}] ⏱️  [Cycle ${currentCycle}] Countdown: ${secondsRemaining} second(s) remaining...`,
        )
      }
      return []
    }

    // Delay has passed, place the order
    hasPlacedOrder = true
    // Use Date.now() for precise intent timestamp (not tick timestamp which may be same as portfolio.nowMs)
    intentSentAtMs = Date.now()
    const clientOrderId = `${name}:${assetId}:buy:${nowMs}:cycle${currentCycle}`
    clientOrderIdSent = clientOrderId

    console.log(
      `[${name}] ⚡️ Placing ${cfg.side.toUpperCase()} order NOW! [Cycle ${currentCycle}]`,
      {
        assetId,
        side: cfg.side,
        price,
        size,
        orderType: 'GTC',
        elapsedMs: elapsedMs.toFixed(0) + 'ms',
        intentSentAtMs,
        clientOrderId,
      },
    )

    return [
      {
        kind: 'place_limit',
        clientOrderId,
        assetId,
        side: 'BUY',
        price,
        size,
        orderType: 'GTC',
        reason: `test_latency_${cfg.side}_cycle_${currentCycle}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev, portfolio, _lastMarket) => {
    void ev
    void _lastMarket

    // Measure placement latency as soon as the order appears in the Portfolio snapshot.
    if (hasPlacedOrder && intentSentAtMs !== null && clientOrderIdSent && !latencyMeasured) {
      const openOrder = portfolio.openOrdersByClientId[clientOrderIdSent]
      if (openOrder) {
        const nowMs = Date.now()
        const latencyMs = nowMs - intentSentAtMs
        latencyMeasured = true
        orderAppearedAtMs = nowMs
        cancelDueAtMs = nowMs + cancelAfterMs

        console.warn(`[${name}] ✅ PLACEMENT LATENCY MEASURED! [Cycle ${currentCycle}]`, {
          clientOrderId: clientOrderIdSent,
          intentSentAtMs,
          orderAppearedAtMs: nowMs,
          latencyMs: latencyMs.toFixed(2) + 'ms',
          latencySec: (latencyMs / 1000).toFixed(3) + 's',
          orderState: openOrder.state,
          orderId: openOrder.orderId,
        })
      }
    }

    // Measure cancel latency as soon as the order disappears from Portfolio open orders.
    if (cancelEmitted && cancelSentAtMs !== null && clientOrderIdSent && !cancelLatencyMeasured) {
      const openOrder = portfolio.openOrdersByClientId[clientOrderIdSent]
      if (!openOrder) {
        const nowMs = Date.now()
        const cancelLatencyMs = nowMs - cancelSentAtMs
        cancelLatencyMeasured = true

        const placementLatencyMs =
          orderAppearedAtMs !== null && intentSentAtMs !== null
            ? orderAppearedAtMs - intentSentAtMs
            : 0

        measurements.push({
          cycle: currentCycle,
          placementLatencyMs,
          cancelLatencyMs,
        })

        console.warn(`[${name}] ✅ CANCEL LATENCY MEASURED! [Cycle ${currentCycle}]`, {
          clientOrderId: clientOrderIdSent,
          cancelSentAtMs,
          orderDisappearedAtMs: nowMs,
          cancelLatencyMs: cancelLatencyMs.toFixed(2) + 'ms',
          cancelLatencySec: (cancelLatencyMs / 1000).toFixed(3) + 's',
        })

        if (currentCycle >= totalCycles) {
          logFinalResults()
        } else {
          cycleCompletedAtMs = nowMs
        }
      }
    }

    return []
  }

  const strategy: Strategy = {
    name,
    onMarketTick,
    onAccountEvent,
  }

  return { strategy }
}
