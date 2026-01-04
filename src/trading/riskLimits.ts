import type {
  AccountEvent,
  Intent,
  PlaceLimitIntent,
  PortfolioSnapshot,
} from '../strategy/Strategy.js'

export type RiskLimits = {
  /** Maximum number of open orders allowed (global). */
  maxOpenOrders: number
  /** Maximum order size per single order (shares). */
  maxOrderSize: number
  /** Maximum absolute position per asset (shares). */
  maxAbsPosition: number
  /**
   * Stop trading (block new place_limit intents) once realized PnL breaches this loss.
   * Units are the same as Portfolio's realizedPnlTotal (price units * shares).
   */
  maxLossStop: number
}

// Hardcoded defaults for now (per plan). Keep these conservative.
export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxOpenOrders: 20,
  maxOrderSize: 25,
  maxAbsPosition: 50,
  maxLossStop: 50,
}

type Blocked = { intent: Intent; reason: string }

function realizedPnlTotal(p: PortfolioSnapshot): number {
  const x = p.realizedPnlTotal
  return typeof x === 'number' && Number.isFinite(x) ? x : 0
}

function openExposureByAssetId(p: PortfolioSnapshot): {
  openBuysByAssetId: Map<string, number>
  openSellsByAssetId: Map<string, number>
  openOrdersCount: number
} {
  const openBuysByAssetId = new Map<string, number>()
  const openSellsByAssetId = new Map<string, number>()
  let openOrdersCount = 0

  for (const o of Object.values(p.openOrdersByClientId)) {
    openOrdersCount += 1
    const size = Number.isFinite(o.remaining) ? Math.max(0, o.remaining) : 0
    const m = o.side === 'BUY' ? openBuysByAssetId : openSellsByAssetId
    m.set(o.assetId, (m.get(o.assetId) ?? 0) + size)
  }

  return { openBuysByAssetId, openSellsByAssetId, openOrdersCount }
}

function blockPlace(nowMs: number, intent: PlaceLimitIntent, reason: string): AccountEvent {
  return { kind: 'order_rejected', tsMs: nowMs, clientOrderId: intent.clientOrderId, reason }
}

/**
 * Apply basic risk limits to a batch of intents. Cancels are always allowed.
 *
 * This is intentionally simple/deterministic and uses only PortfolioSnapshot + intent batch.
 */
export function enforceRiskLimits(params: {
  nowMs: number
  intents: Intent[]
  portfolio?: PortfolioSnapshot
  limits?: RiskLimits
}): { allowed: Intent[]; rejectedEvents: AccountEvent[]; blocked: Blocked[] } {
  const limits = params.limits ?? DEFAULT_RISK_LIMITS
  const p = params.portfolio
  if (!p) return { allowed: params.intents, rejectedEvents: [], blocked: [] }

  const allowed: Intent[] = []
  const rejectedEvents: AccountEvent[] = []
  const blocked: Blocked[] = []

  // Loss stop: block new risk, allow exits/cancels.
  const realized = realizedPnlTotal(p)
  const lossStopActive = Number.isFinite(realized) && realized <= -Math.abs(limits.maxLossStop)

  const exp = openExposureByAssetId(p)
  let openOrdersCount = exp.openOrdersCount
  const openBuysByAssetId = exp.openBuysByAssetId
  const openSellsByAssetId = exp.openSellsByAssetId

  for (const intent of params.intents) {
    if (intent.kind !== 'place_limit') {
      allowed.push(intent)
      // Best-effort reduce open order count/exposure when we see cancels for existing open orders.
      if (intent.kind === 'cancel_order' && intent.clientOrderId) {
        const o = p.openOrdersByClientId[intent.clientOrderId]
        if (o) {
          openOrdersCount = Math.max(0, openOrdersCount - 1)
          const size = Number.isFinite(o.remaining) ? Math.max(0, o.remaining) : 0
          const m = o.side === 'BUY' ? openBuysByAssetId : openSellsByAssetId
          m.set(o.assetId, Math.max(0, (m.get(o.assetId) ?? 0) - size))
        }
      }
      if (intent.kind === 'cancel_all') {
        openOrdersCount = 0
        openBuysByAssetId.clear()
        openSellsByAssetId.clear()
      }
      continue
    }

    // place_limit
    if (lossStopActive) {
      const reason = `risk_loss_stop(realized=${realized})`
      blocked.push({ intent, reason })
      rejectedEvents.push(blockPlace(params.nowMs, intent, reason))
      continue
    }

    if (!Number.isFinite(intent.size) || intent.size <= 0) {
      // Not a risk error (handled elsewhere), but don't count it against limits here.
      allowed.push(intent)
      continue
    }

    if (intent.size > limits.maxOrderSize) {
      const reason = `risk_max_order_size(max=${limits.maxOrderSize})`
      blocked.push({ intent, reason })
      rejectedEvents.push(blockPlace(params.nowMs, intent, reason))
      continue
    }

    if (openOrdersCount + 1 > limits.maxOpenOrders) {
      const reason = `risk_max_open_orders(max=${limits.maxOpenOrders})`
      blocked.push({ intent, reason })
      rejectedEvents.push(blockPlace(params.nowMs, intent, reason))
      continue
    }

    const posQty = p.positionsByAssetId[intent.assetId]?.qty ?? 0
    const openBuys = openBuysByAssetId.get(intent.assetId) ?? 0
    const openSells = openSellsByAssetId.get(intent.assetId) ?? 0

    // Conservative worst-case: buys add, sells subtract.
    const projectedQty =
      intent.side === 'BUY' ? posQty + openBuys + intent.size : posQty - (openSells + intent.size)

    if (Math.abs(projectedQty) > limits.maxAbsPosition) {
      const reason = `risk_max_abs_position(max=${limits.maxAbsPosition})`
      blocked.push({ intent, reason })
      rejectedEvents.push(blockPlace(params.nowMs, intent, reason))
      continue
    }

    // Allowed: update counters so subsequent intents in this batch see it.
    allowed.push(intent)
    openOrdersCount += 1
    if (intent.side === 'BUY') {
      openBuysByAssetId.set(intent.assetId, openBuys + intent.size)
    } else {
      openSellsByAssetId.set(intent.assetId, openSells + intent.size)
    }
  }

  return { allowed, rejectedEvents, blocked }
}
