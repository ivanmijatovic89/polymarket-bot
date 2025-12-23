import type {
  AccountEvent,
  Fill,
  OpenOrder,
  PortfolioSnapshot,
  Position,
} from '../strategy/Strategy.js'

function clampFinite(n: number, fallback = 0): number {
  if (!Number.isFinite(n)) return fallback
  return n
}

function round2(n: number): number {
  return Math.round(n * 1e8) / 1e8
}

function positionKey(assetId: string): string {
  return assetId
}

export class Portfolio {
  private nowMs = Date.now()
  private readonly positionsByAssetId = new Map<string, Position>()
  private readonly openOrdersByClientId = new Map<string, OpenOrder>()
  private readonly recentFills: Fill[] = []
  private readonly maxRecentFills: number
  private readonly marketByAssetId = new Map<string, string>()

  constructor(opts?: { maxRecentFills?: number }) {
    this.maxRecentFills = Math.max(0, opts?.maxRecentFills ?? 500)
  }

  snapshot(): PortfolioSnapshot {
    return {
      nowMs: this.nowMs,
      positionsByAssetId: Object.fromEntries([...this.positionsByAssetId.entries()]),
      openOrdersByClientId: Object.fromEntries([...this.openOrdersByClientId.entries()]),
      recentFills: [...this.recentFills],
      marketByAssetId: Object.fromEntries([...this.marketByAssetId.entries()]),
    }
  }

  getOpenOrderByClientId(clientOrderId: string): OpenOrder | undefined {
    return this.openOrdersByClientId.get(clientOrderId)
  }

  apply(ev: AccountEvent): void {
    // Advance portfolio clock deterministically off inbound events.
    if (ev.kind === 'fill') this.nowMs = Math.max(this.nowMs, ev.fill.tsMs)
    else this.nowMs = Math.max(this.nowMs, ev.tsMs)

    switch (ev.kind) {
      case 'order_submitted': {
        const o = ev.order
        this.openOrdersByClientId.set(o.clientOrderId, o)
        if (o.market) this.marketByAssetId.set(o.assetId, o.market)
        return
      }
      case 'order_accepted': {
        const o = this.openOrdersByClientId.get(ev.clientOrderId)
        if (!o) return
        if (ev.orderId !== undefined) o.orderId = ev.orderId
        o.state = o.state === 'requested' ? 'open' : o.state
        o.updatedAtMs = this.nowMs
        this.openOrdersByClientId.set(o.clientOrderId, o)
        return
      }
      case 'order_open': {
        if (ev.clientOrderId) {
          const o = this.openOrdersByClientId.get(ev.clientOrderId)
          if (!o) return
          o.state = 'open'
          if (ev.orderId !== undefined) o.orderId = ev.orderId
          o.updatedAtMs = this.nowMs
          this.openOrdersByClientId.set(o.clientOrderId, o)
        }
        return
      }
      case 'order_rejected': {
        const o = this.openOrdersByClientId.get(ev.clientOrderId)
        if (!o) return
        o.state = 'rejected'
        o.lastError = ev.reason
        o.remaining = 0
        o.updatedAtMs = this.nowMs
        this.openOrdersByClientId.delete(ev.clientOrderId)
        return
      }
      case 'order_done': {
        if (!ev.clientOrderId) return
        const o = this.openOrdersByClientId.get(ev.clientOrderId)
        if (!o) return
        const next =
          ev.reason === 'filled'
            ? 'filled'
            : ev.reason === 'canceled'
              ? 'canceled'
              : ev.reason === 'expired'
                ? 'expired'
                : 'killed'
        o.state = next
        o.remaining = 0
        o.updatedAtMs = this.nowMs
        this.openOrdersByClientId.delete(ev.clientOrderId)
        return
      }
      case 'fill': {
        this.pushFill(ev.fill)
        this.applyFillToOrders(ev.fill)
        this.applyFillToPosition(ev.fill)
        if (ev.fill.market) this.marketByAssetId.set(ev.fill.assetId, ev.fill.market)
        return
      }
      case 'account_stream_status':
        return
      default: {
        const _exhaustive: never = ev
        void _exhaustive
        return
      }
    }
  }

  private pushFill(f: Fill): void {
    this.recentFills.push(f)
    if (this.maxRecentFills > 0 && this.recentFills.length > this.maxRecentFills) {
      this.recentFills.splice(0, this.recentFills.length - this.maxRecentFills)
    }
  }

  private applyFillToOrders(f: Fill): void {
    const cid = f.clientOrderId
    if (!cid) return
    const o = this.openOrdersByClientId.get(cid)
    if (!o) return
    const size = Math.max(0, clampFinite(f.size, 0))
    o.filled = round2(o.filled + size)
    o.remaining = round2(Math.max(0, o.size - o.filled))
    o.updatedAtMs = this.nowMs
    o.state = o.remaining > 0 ? 'partially_filled' : 'filled'
    if (o.state === 'filled') this.openOrdersByClientId.delete(cid)
    else this.openOrdersByClientId.set(cid, o)
  }

  private applyFillToPosition(f: Fill): void {
    const assetId = f.assetId
    const key = positionKey(assetId)
    const prev = this.positionsByAssetId.get(key) ?? {
      assetId,
      qty: 0,
      avgEntryPrice: null,
      realizedPnl: 0,
    }

    const size = Math.max(0, clampFinite(f.size, 0))
    const price = clampFinite(f.price, 0)
    if (size <= 0) return

    if (f.side === 'BUY') {
      // Increase position, update average.
      const newQty = prev.qty + size
      const prevCost = prev.avgEntryPrice === null ? 0 : prev.avgEntryPrice * prev.qty
      const newCost = prevCost + price * size
      const avg = newQty > 0 ? newCost / newQty : null
      this.positionsByAssetId.set(key, {
        assetId,
        qty: round2(newQty),
        avgEntryPrice: avg === null ? null : round2(avg),
        realizedPnl: prev.realizedPnl,
      })
      return
    }

    // SELL: reduce position; realize PnL against avg entry when available.
    const sellQty = Math.min(size, prev.qty)
    const remainingQty = prev.qty - sellQty
    const avg = prev.avgEntryPrice
    const realized = avg === null ? 0 : round2(prev.realizedPnl + (price - avg) * sellQty)
    this.positionsByAssetId.set(key, {
      assetId,
      qty: round2(remainingQty),
      avgEntryPrice: remainingQty > 0 ? avg : null,
      realizedPnl: realized,
    })
  }
}
