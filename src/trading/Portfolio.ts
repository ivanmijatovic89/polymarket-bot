import type {
  AccountEvent,
  Fill,
  OpenOrder,
  PortfolioSnapshot,
  Position,
} from '../strategy/Strategy.js'
import { round2 } from './utils/rounding.js'

function clampFinite(n: number, fallback = 0): number {
  if (!Number.isFinite(n)) return fallback
  return n
}

function positionKey(assetId: string): string {
  return assetId
}

export class Portfolio {
  private nowMs = Date.now()
  private readonly positionsByAssetId = new Map<string, Position>()
  private readonly openOrdersByClientId = new Map<string, OpenOrder>()
  // Many exchange events reference exchange `orderId` but not our `clientOrderId`.
  // Keep an index so we can reconcile order lifecycle + fills by orderId.
  private readonly clientOrderIdByOrderId = new Map<string, string>()

  // Idempotency: protect portfolio from duplicate fill events across sources (WS status updates, REST polling, reconnects).
  private readonly seenFillIds = new Map<string, number>()
  private readonly maxSeenFillIds = 50_000
  private readonly recentFills: Fill[] = []
  private readonly maxRecentFills: number
  private readonly marketByAssetId = new Map<string, string>()
  private realizedPnlTotal = 0

  constructor(opts?: { maxRecentFills?: number }) {
    this.maxRecentFills = Math.max(0, opts?.maxRecentFills ?? 500)
  }

  snapshot(): PortfolioSnapshot {
    return {
      nowMs: this.nowMs,
      realizedPnlTotal: this.realizedPnlTotal,
      positionsByAssetId: Object.fromEntries([...this.positionsByAssetId.entries()]),
      openOrdersByClientId: Object.fromEntries([...this.openOrdersByClientId.entries()]),
      recentFills: [...this.recentFills],
      marketByAssetId: Object.fromEntries([...this.marketByAssetId.entries()]),
    }
  }

  getOpenOrderByClientId(clientOrderId: string): OpenOrder | undefined {
    return this.openOrdersByClientId.get(clientOrderId)
  }

  private indexOrder(o: OpenOrder): void {
    if (o.orderId) this.clientOrderIdByOrderId.set(o.orderId, o.clientOrderId)
  }

  private unindexOrder(o: OpenOrder): void {
    if (o.orderId) this.clientOrderIdByOrderId.delete(o.orderId)
  }

  private fillSeenOnce(id: string, tsMs: number): boolean {
    if (this.seenFillIds.has(id)) return false
    this.seenFillIds.set(id, tsMs)

    // Bound memory: delete oldest insertion-order entries.
    if (this.seenFillIds.size > this.maxSeenFillIds) {
      const drop = Math.ceil(this.maxSeenFillIds * 0.1)
      let i = 0
      for (const k of this.seenFillIds.keys()) {
        this.seenFillIds.delete(k)
        i++
        if (i >= drop) break
      }
    }
    return true
  }

  apply(ev: AccountEvent): void {
    // Advance portfolio clock deterministically off inbound events.
    if (ev.kind === 'fill') this.nowMs = Math.max(this.nowMs, ev.fill.tsMs)
    else this.nowMs = Math.max(this.nowMs, ev.tsMs)
    console.log('Portfolio > apply >',  ev )
    switch (ev.kind) {
      case 'order_submitted': {
        const o = ev.order
        this.openOrdersByClientId.set(o.clientOrderId, o)
        this.indexOrder(o)
        if (o.market) this.marketByAssetId.set(o.assetId, o.market)
        return
      }
      case 'order_accepted': {
        console.log('Portfolio > order_accepted >',  ev )
        const o = this.openOrdersByClientId.get(ev.clientOrderId)
        console.log('Portfolio > order_accepted > o >',  o )
        if (!o) return
        if (ev.orderId !== undefined) o.orderId = ev.orderId
        this.indexOrder(o)
        o.state = o.state === 'requested' ? 'open' : o.state
        o.updatedAtMs = this.nowMs
        this.openOrdersByClientId.set(o.clientOrderId, o)
        return
      }
      case 'order_open': {
        const clientId =
          ev.clientOrderId ??
          (ev.orderId ? this.clientOrderIdByOrderId.get(ev.orderId) : undefined)
        if (!clientId) return
        const o = this.openOrdersByClientId.get(clientId)
        console.log('Portfolio > order_open > o >',  o )
        if (!o) return
        o.state = 'open'
        if (ev.orderId !== undefined) o.orderId = ev.orderId
        this.indexOrder(o)
        o.updatedAtMs = this.nowMs
        this.openOrdersByClientId.set(o.clientOrderId, o)
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
        this.unindexOrder(o)
        return
      }
      case 'order_done': {
        const clientId =
          ev.clientOrderId ??
          (ev.orderId ? this.clientOrderIdByOrderId.get(ev.orderId) : undefined)
        if (!clientId) return
        const o = this.openOrdersByClientId.get(clientId)
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
        this.openOrdersByClientId.delete(clientId)
        this.unindexOrder(o)
        return
      }
      case 'fill': {
        if (!this.fillSeenOnce(ev.fill.id, ev.fill.tsMs)) return
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
    const cid =
      f.clientOrderId ?? (f.orderId ? this.clientOrderIdByOrderId.get(f.orderId) : undefined)
    if (!cid) return
    const o = this.openOrdersByClientId.get(cid)
    if (!o) return
    const size = Math.max(0, clampFinite(f.size, 0))
    o.filled = round2(o.filled + size)
    o.remaining = round2(Math.max(0, o.size - o.filled))
    o.updatedAtMs = this.nowMs
    o.state = o.remaining > 0 ? 'partially_filled' : 'filled'
    if (o.state === 'filled') {
      this.openOrdersByClientId.delete(cid)
      this.unindexOrder(o)
    }
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

      // Log positions after BUY
      this.logPositionsByMarket()
      return
    }

    // SELL: reduce position; realize PnL against avg entry when available.
    const sellQty = Math.min(size, prev.qty)
    const remainingQty = prev.qty - sellQty
    const avg = prev.avgEntryPrice
    const realized =
      avg === null ? prev.realizedPnl : round2(prev.realizedPnl + (price - avg) * sellQty)
    const realizedDelta = round2(realized - prev.realizedPnl)
    if (Number.isFinite(realizedDelta))
      this.realizedPnlTotal = round2(this.realizedPnlTotal + realizedDelta)
    if (remainingQty > 0) {
      this.positionsByAssetId.set(key, {
        assetId,
        qty: round2(remainingQty),
        avgEntryPrice: avg,
        realizedPnl: realized,
      })

      // Log positions after SELL (partial)
      this.logPositionsByMarket()
      return
    }

    // IMPORTANT: keep Portfolio state bounded.
    // If a position is fully closed, remove it. Otherwise positionsByAssetId grows forever across markets,
    // and StrategyRunner's per-tick `portfolio.snapshot()` becomes increasingly expensive.
    this.positionsByAssetId.delete(key)

    // Log positions after SELL (closed)
    this.logPositionsByMarket()

    // Best-effort: also clear market mapping for this asset if we have no other exposure.
    // (If a new fill/open order appears later, mapping will be re-populated.)
    let stillExposed = false
    for (const o of this.openOrdersByClientId.values()) {
      if (o.assetId === assetId) {
        stillExposed = true
        break
      }
    }
    if (!stillExposed) this.marketByAssetId.delete(assetId)
  }

  private logPositionsByMarket(): void {
    const shortAsset = (assetId: string) => assetId.slice(-8)
    const fmt4 = (n: number | null | undefined) =>
      typeof n === 'number' && Number.isFinite(n) ? n.toFixed(4) : 'N/A'

    // ---- Positions table ----
    const positions = [...this.positionsByAssetId.values()]
    if (positions.length === 0) {
      console.log('[Portfolio] All positions: (none)')
    } else {
      const positionRows = positions
        .map((p) => {
          const market = this.marketByAssetId.get(p.assetId) ?? 'unknown'
          const costBasis = p.avgEntryPrice === null ? null : p.avgEntryPrice * p.qty
          return {
            market,
            asset: shortAsset(p.assetId),
            qty: p.qty,
            avgEntry: fmt4(p.avgEntryPrice),
            costBasis: costBasis === null ? 'N/A' : Number(costBasis.toFixed(4)),
            realizedPnl: Number(p.realizedPnl.toFixed(4)),
          }
        })
        .sort((a, b) => (a.market < b.market ? -1 : a.market > b.market ? 1 : 0))

      console.log(`[Portfolio] Positions (${positions.length}):`)
      console.table(positionRows)
    }

    // ---- Open orders table ----
    const orders = [...this.openOrdersByClientId.values()]
    if (orders.length === 0) {
      console.log('[Portfolio] Open orders: (none)')
    } else {
      const anyExpires = orders.some((o) => typeof o.expireAtMs === 'number')

      const orderRows = orders
        .map((o) => {
          const market = o.market ?? this.marketByAssetId.get(o.assetId) ?? 'unknown'
          const base = {
            market,
            asset: shortAsset(o.assetId),
            side: o.side,
            price: Number(o.price.toFixed(4)),
            size: o.size,
            filled: o.filled,
            remaining: o.remaining,
            state: o.state,
            tif: o.orderType,
            clientOrderId: o.clientOrderId.slice(-10),
            orderId: o.orderId ?? '',
          }

          if (!anyExpires) return base
          return {
            ...base,
            expireAt: o.expireAtMs ? new Date(o.expireAtMs).toISOString() : '',
          }
        })
        .sort((a, b) => (a.market < b.market ? -1 : a.market > b.market ? 1 : 0))

      console.log(`[Portfolio] Open orders (${orders.length}):`)
      console.table(orderRows)
    }

    console.log(`[Portfolio] Total realized PnL: ${this.realizedPnlTotal.toFixed(4)}`)
  }
}
