import type {
  AccountEvent,
  CancelBatchIntent,
  CancelMarketIntent,
  OrderReference,
  PortfolioSnapshot,
} from '../strategy/Strategy.js'

export type CancelFailure = Extract<AccountEvent, { kind: 'cancel_failed' }>

export function cancelFailed(
  operation: CancelFailure['operation'],
  tsMs: number,
  reason: string,
  target: OrderReference & { market?: string; assetId?: string } = {},
): CancelFailure {
  return {
    kind: 'cancel_failed',
    operation,
    tsMs,
    reason,
    ...(target.clientOrderId ? { clientOrderId: target.clientOrderId } : {}),
    ...(target.orderId ? { orderId: target.orderId } : {}),
    ...(target.market ? { market: target.market } : {}),
    ...(target.assetId ? { assetId: target.assetId } : {}),
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

export function validateCancelScope(intent: CancelMarketIntent): string | null {
  if (intent.market === undefined && intent.assetId === undefined) return 'missing_cancel_scope'
  if (
    intent.market !== undefined &&
    (typeof intent.market !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(intent.market))
  ) {
    return 'invalid_cancel_market'
  }
  if (
    intent.assetId !== undefined &&
    (typeof intent.assetId !== 'string' || !/^[0-9]+$/.test(intent.assetId))
  ) {
    return 'invalid_cancel_assetId'
  }
  return null
}

export function matchesCancelScope(
  order: { market?: string; assetId?: string },
  scope: Pick<CancelMarketIntent, 'market' | 'assetId'>,
): boolean {
  return (
    (scope.market === undefined || order.market?.toLowerCase() === scope.market.toLowerCase()) &&
    (scope.assetId === undefined || order.assetId === scope.assetId)
  )
}

/** Resolve before submission in both runtimes. Never guess an unacknowledged exchange ID. */
export function resolveCancelBatch(
  intent: CancelBatchIntent,
  portfolio: PortfolioSnapshot | undefined,
  nowMs: number,
  dryRun = false,
): { orders: OrderReference[]; events: AccountEvent[] } {
  const orders: OrderReference[] = []
  const events: AccountEvent[] = []
  if (!Array.isArray(intent.orders) || intent.orders.length > 3000) {
    return { orders, events: [cancelFailed(intent.kind, nowMs, 'invalid_cancel_batch_size')] }
  }
  const seen = new Set<string>()
  const open = Object.values(portfolio?.openOrdersByClientId ?? {})
  const history = Object.values(portfolio?.ordersByClientId ?? {})
  for (const ref of intent.orders) {
    if (
      !ref ||
      (ref.clientOrderId === undefined && ref.orderId === undefined) ||
      (ref.clientOrderId !== undefined && !validId(ref.clientOrderId)) ||
      (ref.orderId !== undefined && !validId(ref.orderId))
    ) {
      events.push(cancelFailed(intent.kind, nowMs, 'invalid_order_reference'))
      continue
    }
    const byClient = ref.clientOrderId
      ? portfolio?.openOrdersByClientId[ref.clientOrderId]
      : undefined
    const byExchange = ref.orderId ? open.find((o) => o.orderId === ref.orderId) : undefined
    if (ref.clientOrderId && byExchange && byExchange.clientOrderId !== ref.clientOrderId) {
      events.push(cancelFailed(intent.kind, nowMs, 'conflicting_order_reference', ref))
      continue
    }
    const bot = byClient ?? byExchange
    const previous = ref.clientOrderId
      ? portfolio?.ordersByClientId[ref.clientOrderId]
      : history.find((o) => o.orderId === ref.orderId)
    const knownId = bot?.orderId ?? previous?.orderId
    if (ref.orderId && knownId && ref.orderId !== knownId) {
      events.push(cancelFailed(intent.kind, nowMs, 'conflicting_order_reference', ref))
      continue
    }
    if (
      !bot &&
      previous &&
      previous.lifecycleState &&
      ['filled', 'canceled', 'expired', 'killed', 'rejected'].includes(previous.lifecycleState)
    ) {
      continue // A known terminal order has no remainder to cancel.
    }
    if (ref.clientOrderId && !bot && !ref.orderId) {
      events.push(cancelFailed(intent.kind, nowMs, 'unknown_client_order', ref))
      continue
    }
    // A supplied exchange ID is sufficient only if it agrees with a known client ID.
    if (bot && !bot.orderId && !dryRun) {
      events.push(cancelFailed(intent.kind, nowMs, 'missing_exchange_order_id', ref))
      continue
    }
    const orderId = bot?.orderId ?? ref.orderId
    const clientOrderId = bot?.clientOrderId ?? ref.clientOrderId
    const key = orderId ? `exchange:${orderId}` : `client:${clientOrderId}`
    if (seen.has(key)) continue
    seen.add(key)
    orders.push({ ...(clientOrderId ? { clientOrderId } : {}), ...(orderId ? { orderId } : {}) })
  }
  return { orders, events }
}
