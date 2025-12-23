import type { OrderBookSnapshot } from '../../orderbook/OrderBookEngine.js'
import type {
  AccountEvent,
  CancelAllIntent,
  CancelOrderIntent,
  Fill,
  PlaceLimitIntent,
} from '../../strategy/Strategy.js'
import type { ExecutionAdapter, OrderManagerContext } from '../OrderManager.js'

type SimOrder = {
  clientOrderId: string
  orderId: string
  market?: string
  assetId: string
  side: 'BUY' | 'SELL'
  limitPrice: number
  remaining: number
  orderType: 'FOK' | 'GTC' | 'GTD'
  expireAtMs?: number
  createdAtMs: number
  updatedAtMs: number
  fillSeq: number
}

function sumFillableSize(o: SimOrder, book: OrderBookSnapshot | undefined): number {
  if (!book) return 0
  let sum = 0
  if (o.side === 'BUY') {
    for (const lvl of book.asks) {
      if (lvl.price > o.limitPrice) break
      sum += lvl.size
    }
  } else {
    for (const lvl of book.bids) {
      if (lvl.price < o.limitPrice) break
      sum += lvl.size
    }
  }
  return sum
}

function buildMakerFillTouchCross(
  o: SimOrder,
  book: OrderBookSnapshot | undefined,
  tsMs: number,
): Fill | null {
  if (!book) return null
  if (o.remaining <= 0) return null

  if (o.side === 'BUY') {
    const bestAsk = book.bestAsk
    if (bestAsk === null || !Number.isFinite(bestAsk)) return null
    if (bestAsk > o.limitPrice) return null

    o.fillSeq += 1
    const f: Fill = {
      id: `${o.clientOrderId}:${o.fillSeq}`,
      tsMs,
      market: o.market,
      assetId: o.assetId,
      side: o.side,
      // Conservative: fill at the crossing best price, not always at our limit.
      price: bestAsk,
      size: o.remaining,
      clientOrderId: o.clientOrderId,
      orderId: o.orderId,
      liquidity: 'MAKER',
    }
    o.remaining = 0
    return f
  }

  const bestBid = book.bestBid
  if (bestBid === null || !Number.isFinite(bestBid)) return null
  if (bestBid < o.limitPrice) return null

  o.fillSeq += 1
  const f: Fill = {
    id: `${o.clientOrderId}:${o.fillSeq}`,
    tsMs,
    market: o.market,
    assetId: o.assetId,
    side: o.side,
    price: bestBid,
    size: o.remaining,
    clientOrderId: o.clientOrderId,
    orderId: o.orderId,
    liquidity: 'MAKER',
  }
  o.remaining = 0
  return f
}

function buildFillsFromBook(
  o: SimOrder,
  book: OrderBookSnapshot | undefined,
  tsMs: number,
): Fill[] {
  if (!book) return []
  const fills: Fill[] = []
  let remaining = o.remaining

  const consume = (price: number, size: number): void => {
    if (remaining <= 0) return
    const take = Math.min(remaining, size)
    if (take <= 0) return
    o.fillSeq += 1
    fills.push({
      id: `${o.clientOrderId}:${o.fillSeq}`,
      tsMs,
      market: o.market,
      assetId: o.assetId,
      side: o.side,
      price,
      size: take,
      clientOrderId: o.clientOrderId,
      orderId: o.orderId,
      liquidity: 'TAKER',
    })
    remaining -= take
  }

  if (o.side === 'BUY') {
    for (const lvl of book.asks) {
      if (lvl.price > o.limitPrice) break
      consume(lvl.price, lvl.size)
      if (remaining <= 0) break
    }
  } else {
    for (const lvl of book.bids) {
      if (lvl.price < o.limitPrice) break
      consume(lvl.price, lvl.size)
      if (remaining <= 0) break
    }
  }

  // Update remaining on the order object (caller uses this).
  o.remaining = remaining
  return fills
}

export class BacktestExecution implements ExecutionAdapter {
  private readonly openByClientId = new Map<string, SimOrder>()

  async placeLimit(
    intent: PlaceLimitIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const nowMs = ctx.nowMs
    const orderId = `bt-${intent.clientOrderId}`
    const o: SimOrder = {
      clientOrderId: intent.clientOrderId,
      orderId,
      market: ctx.lastMarket?.market,
      assetId: intent.assetId,
      side: intent.side,
      limitPrice: intent.price,
      remaining: intent.size,
      orderType: intent.orderType,
      ...(intent.orderType === 'GTD' ? { expireAtMs: intent.expireAtMs } : {}),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      fillSeq: 0,
    }

    const book = ctx.lastMarket?.byAssetId[intent.assetId]
    const fillable = sumFillableSize(o, book)

    const events: AccountEvent[] = [
      { kind: 'order_accepted', tsMs: nowMs, clientOrderId: intent.clientOrderId, orderId },
    ]

    if (intent.orderType === 'FOK') {
      if (fillable < intent.size) {
        events.push({
          kind: 'order_done',
          tsMs: nowMs,
          clientOrderId: intent.clientOrderId,
          orderId,
          reason: 'killed',
        })
        return { events }
      }

      const fills = buildFillsFromBook(o, book, nowMs)
      for (const f of fills) events.push({ kind: 'fill', fill: f })
      events.push({
        kind: 'order_done',
        tsMs: nowMs,
        clientOrderId: intent.clientOrderId,
        orderId,
        reason: 'filled',
      })
      return { events }
    }

    // GTC/GTD: take what’s immediately available, rest the remainder.
    if (fillable > 0) {
      const fills = buildFillsFromBook(o, book, nowMs)
      for (const f of fills) events.push({ kind: 'fill', fill: f })
    }

    if (o.remaining <= 0) {
      events.push({
        kind: 'order_done',
        tsMs: nowMs,
        clientOrderId: intent.clientOrderId,
        orderId,
        reason: 'filled',
      })
      return { events }
    }

    // Resting order becomes open.
    this.openByClientId.set(intent.clientOrderId, o)
    events.push({ kind: 'order_open', tsMs: nowMs, clientOrderId: intent.clientOrderId, orderId })
    return { events }
  }

  async cancelOrder(
    intent: CancelOrderIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const nowMs = ctx.nowMs
    const cid = intent.clientOrderId
    if (!cid) return { events: [] }
    const o = this.openByClientId.get(cid)
    if (!o) {
      // Nothing to cancel; treat as no-op.
      return { events: [] }
    }
    this.openByClientId.delete(cid)
    return {
      events: [
        {
          kind: 'order_done',
          tsMs: nowMs,
          clientOrderId: cid,
          orderId: o.orderId,
          reason: 'canceled',
        },
      ],
    }
  }

  async cancelAll(
    _intent: CancelAllIntent,
    ctx: OrderManagerContext,
  ): Promise<{ events: AccountEvent[] }> {
    const nowMs = ctx.nowMs
    const events: AccountEvent[] = []
    for (const [cid, o] of this.openByClientId.entries()) {
      events.push({
        kind: 'order_done',
        tsMs: nowMs,
        clientOrderId: cid,
        orderId: o.orderId,
        reason: 'canceled',
      })
    }
    this.openByClientId.clear()
    return { events }
  }

  async onMarketTick(ctx: OrderManagerContext): Promise<{ events: AccountEvent[] }> {
    const nowMs = ctx.nowMs
    const snap = ctx.lastMarket
    if (!snap) return { events: [] }

    const events: AccountEvent[] = []

    for (const [cid, o] of [...this.openByClientId.entries()]) {
      // GTD expiry
      if (o.orderType === 'GTD' && typeof o.expireAtMs === 'number' && nowMs >= o.expireAtMs) {
        this.openByClientId.delete(cid)
        events.push({
          kind: 'order_done',
          tsMs: nowMs,
          clientOrderId: cid,
          orderId: o.orderId,
          reason: 'expired',
        })
        continue
      }

      const book = snap.byAssetId[o.assetId]
      const fill = buildMakerFillTouchCross(o, book, nowMs)
      if (!fill) continue

      events.push({ kind: 'fill', fill })

      if (o.remaining <= 0) {
        this.openByClientId.delete(cid)
        events.push({
          kind: 'order_done',
          tsMs: nowMs,
          clientOrderId: cid,
          orderId: o.orderId,
          reason: 'filled',
        })
      }
    }

    return { events }
  }
}
