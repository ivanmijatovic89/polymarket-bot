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
    if (side === 'up') {
      return assetIds[0] ?? null
    }
    return assetIds[1] ?? null
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

  // Cycle tracking
  const totalCycles = 10
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
  const delayMs = 3000 // 3 seconds delay

  // Latency measurement tracking for order placement
  let intentSentAtMs: number | null = null
  let clientOrderIdSent: string | null = null
  let latencyMeasured = false

  // Cancel tracking
  const cancelAfterMs = 2000 // 2 seconds after order appears
  let orderAppearedAtMs: number | null = null
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
    // Check if we need to start next cycle after pause
    if (
      cycleCompletedAtMs !== null &&
      currentCycle < totalCycles
    ) {
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

    // Check if order appears in portfolio after intent was sent
    if (hasPlacedOrder && intentSentAtMs !== null && clientOrderIdSent && !latencyMeasured) {
      const openOrder = portfolio.openOrdersByClientId[clientOrderIdSent]
      if (openOrder) {
        // Use Date.now() for consistent local time measurement
        const nowMs = Date.now()
        const latencyMs = nowMs - intentSentAtMs
        latencyMeasured = true
        orderAppearedAtMs = nowMs

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

    // Check if order disappeared after cancel was sent
    if (
      cancelSentAtMs !== null &&
      clientOrderIdSent &&
      !cancelLatencyMeasured &&
      cancelEmitted
    ) {
      const openOrder = portfolio.openOrdersByClientId[clientOrderIdSent]
      if (!openOrder) {
        // Order no longer exists in openOrdersByClientId
        // Use Date.now() for consistent local time measurement
        const nowMs = Date.now()
        const cancelLatencyMs = nowMs - cancelSentAtMs
        cancelLatencyMeasured = true

        // Get placement latency for this cycle (also using Date.now() timestamps)
        const placementLatencyMs = orderAppearedAtMs && intentSentAtMs
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

        // Check if all cycles are done
        if (currentCycle >= totalCycles) {
          logFinalResults()
          return []
        }

        // Mark cycle as completed and start pause
        cycleCompletedAtMs = Date.now()
        return []
      }
    }

    // Handle cancel after order appears
    if (
      hasPlacedOrder &&
      latencyMeasured &&
      orderAppearedAtMs !== null &&
      !cancelEmitted &&
      clientOrderIdSent
    ) {
      // Use tick timestamp for consistent timing (same clock as order placement)
      const nowMs = tick.snapshot.timestamp || Date.now()
      const elapsedSinceAppeared = nowMs - orderAppearedAtMs

      // Debug log every 500ms to see what's happening
      if (elapsedSinceAppeared > 0 && elapsedSinceAppeared % 500 < 100) {
        const openOrder = portfolio.openOrdersByClientId[clientOrderIdSent]
        // console.log(`[${name}] ⏳ Cancel check:`, {
        //   elapsedSinceAppeared: elapsedSinceAppeared.toFixed(0) + 'ms',
        //   cancelAfterMs: cancelAfterMs + 'ms',
        //   hasOrder: !!openOrder,
        //   orderId: openOrder?.orderId,
        //   orderState: openOrder?.state,
        // })
      }

      if (elapsedSinceAppeared >= cancelAfterMs) {
        // Get orderId for cancel
        const openOrder = portfolio.openOrdersByClientId[clientOrderIdSent]
        const orderId = openOrder?.orderId

        if (!orderId) {
          console.warn(`[${name}] ⚠️ Cannot cancel: orderId not available yet`, {
            clientOrderId: clientOrderIdSent,
            openOrder: openOrder ? 'exists but no orderId' : 'not found',
            elapsedSinceAppeared: elapsedSinceAppeared.toFixed(0) + 'ms',
          })
          return []
        }

        cancelSentAtMs = Date.now()
        cancelEmitted = true

        console.log(`[${name}] 🚫 Sending CANCEL intent NOW! [Cycle ${currentCycle}]`, {
          clientOrderId: clientOrderIdSent,
          orderId,
          cancelSentAtMs,
          elapsedSinceAppeared: elapsedSinceAppeared.toFixed(0) + 'ms',
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
    }

    // Only trigger order placement once per cycle
    if (hasPlacedOrder) return []

    const assetId = getAssetIdBySide(tick, ctx, cfg.side)
    if (!assetId) return []

    const nowMs = tick.snapshot.timestamp || Date.now()

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
        console.log(`[${name}] ⏱️  [Cycle ${currentCycle}] Countdown: ${secondsRemaining} second(s) remaining...`)
      }
      return []
    }

    // Delay has passed, place the order
    hasPlacedOrder = true
    // Use Date.now() for precise intent timestamp (not tick timestamp which may be same as portfolio.nowMs)
    intentSentAtMs = Date.now()
    const clientOrderId = `${name}:${assetId}:buy:${nowMs}:cycle${currentCycle}`
    clientOrderIdSent = clientOrderId

    console.log(`[${name}] ⚡️ Placing ${cfg.side.toUpperCase()} order NOW! [Cycle ${currentCycle}]`, {
      assetId,
      side: cfg.side,
      price,
      size,
      orderType: 'GTC',
      elapsedMs: elapsedMs.toFixed(0) + 'ms',
      intentSentAtMs,
      clientOrderId,
    })

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
