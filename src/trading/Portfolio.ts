import type {
  AccountEvent,
  Fill,
  OpenOrder,
  OrderSnapshot,
  PortfolioSnapshot,
  PositionsSplit,
  Position,
  TradeStatusRank,
} from '../strategy/Strategy.js'
import { round2 } from './utils/rounding.js'
import { computePolymarketTakerFee } from './fees.js'

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
  private readonly ordersByClientIdSnapshot = new Map<string, OrderSnapshot>()
  // Many exchange events reference exchange `orderId` but not our `clientOrderId`.
  // Keep an index so we can reconcile order lifecycle + fills by orderId.
  private readonly clientOrderIdByOrderId = new Map<string, string>()
  // Persistent mapping for snapshot purposes: keep orderId -> clientOrderId even after the bot order is closed.
  // This allows late ws trade-status progression (MINED/CONFIRMED) to still attach to the correct OrderSnapshot.
  private readonly clientOrderIdByOrderIdSnapshot = new Map<string, string>()
  private readonly maxClientOrderIdByOrderIdSnapshot = 50_000

  // WS can deliver fills before our local order lifecycle events are applied.
  // Buffer unmatched fill sizes by exchange orderId, then apply once the order appears/index is known.
  private readonly pendingFilledByOrderId = new Map<string, number>()

  // Track open orders observed from USER ws channel, including orders not placed by this bot.
  private readonly wsOpenOrdersByOrderId = new Map<
    string,
    {
      orderId: string
      owner?: string
      market?: string
      assetId?: string
      side?: 'BUY' | 'SELL'
      price?: number
      originalSize?: number
      sizeMatched?: number
      status?: string
      orderType?: string
      outcome?: string
      updatedAtMs: number
    }
  >()

  // Best-effort: status progression can arrive (ws_order_update) before we can map orderId -> clientOrderId.
  // Store latest observed trade status by orderId so we can merge once mapping is known.
  private readonly pendingTradeStatusByOrderId = new Map<
    string,
    { tradeStatusRaw?: string; tradeStatusRank: TradeStatusRank; updatedAtMs: number }
  >()
  private readonly maxPendingTradeStatus = 10_000

  private readonly maxOrderSnapshots = 10_000

  // Idempotency: protect portfolio from duplicate fill events across sources (WS status updates, REST polling, reconnects).
  private readonly seenFillIds = new Map<string, number>()
  private readonly maxSeenFillIds = 50_000
  private readonly recentFills: Fill[] = []
  private readonly maxRecentFills: number
  private readonly recentSplits: PositionsSplit[] = []
  private readonly maxRecentSplits = 500
  private readonly marketByAssetId = new Map<string, string>()
  private realizedPnlTotal = 0

  // Cached, frozen snapshot reused across calls until the next state change.
  // StrategyRunner calls snapshot() on every market tick (172k+ ticks/market in
  // backtests), but portfolio state only changes inside apply() (account events,
  // orders of magnitude rarer than ticks). Rebuilding every map on every tick
  // dominated backtest runtime (see #77); caching the whole snapshot makes the
  // per-tick cost O(1) between account events. Invalidated in apply().
  private cachedSnapshot: PortfolioSnapshot | null = null

  constructor(opts?: { maxRecentFills?: number }) {
    this.maxRecentFills = Math.max(0, opts?.maxRecentFills ?? 500)
  }

  snapshot(): PortfolioSnapshot {
    if (this.cachedSnapshot) return this.cachedSnapshot
    const snap: PortfolioSnapshot = {
      nowMs: this.nowMs,
      realizedPnlTotal: this.realizedPnlTotal,
      positionsByAssetId: Object.fromEntries([...this.positionsByAssetId.entries()]),
      openOrdersByClientId: Object.fromEntries([...this.openOrdersByClientId.entries()]),
      wsOpenOrdersByOrderId: Object.fromEntries([...this.wsOpenOrdersByOrderId.entries()]),
      ordersByClientId: Object.fromEntries([...this.ordersByClientIdSnapshot.entries()]),
      recentFills: [...this.recentFills],
      ...(this.recentSplits.length > 0 ? { recentSplits: [...this.recentSplits] } : {}),
      marketByAssetId: Object.fromEntries([...this.marketByAssetId.entries()]),
    }
    this.cachedSnapshot = Object.freeze(snap)
    return this.cachedSnapshot
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

  private tradeStatusRankFromRaw(raw?: string): TradeStatusRank {
    if (raw === 'MATCHED') return 1
    if (raw === 'MINED') return 2
    if (raw === 'CONFIRMED') return 3
    return 0
  }

  private tradeStatusRawField(raw: unknown): { tradeStatusRaw?: string } {
    return typeof raw === 'string' ? { tradeStatusRaw: raw } : {}
  }

  private upsertOrderSnapshot(clientOrderId: string, next: OrderSnapshot): void {
    // Maintain persistent orderId -> clientOrderId mapping for snapshot merges.
    if (next.orderId) {
      // Refresh insertion order so pruning drops the oldest.
      if (this.clientOrderIdByOrderIdSnapshot.has(next.orderId))
        this.clientOrderIdByOrderIdSnapshot.delete(next.orderId)
      this.clientOrderIdByOrderIdSnapshot.set(next.orderId, clientOrderId)
      if (this.clientOrderIdByOrderIdSnapshot.size > this.maxClientOrderIdByOrderIdSnapshot) {
        const drop = Math.ceil(this.maxClientOrderIdByOrderIdSnapshot * 0.1)
        let i = 0
        for (const k of this.clientOrderIdByOrderIdSnapshot.keys()) {
          this.clientOrderIdByOrderIdSnapshot.delete(k)
          i++
          if (i >= drop) break
        }
      }
    }

    // Refresh insertion order so pruning drops the oldest.
    if (this.ordersByClientIdSnapshot.has(clientOrderId))
      this.ordersByClientIdSnapshot.delete(clientOrderId)
    this.ordersByClientIdSnapshot.set(clientOrderId, next)
    if (this.ordersByClientIdSnapshot.size > this.maxOrderSnapshots) {
      const drop = Math.ceil(this.maxOrderSnapshots * 0.1)
      let i = 0
      for (const k of this.ordersByClientIdSnapshot.keys()) {
        this.ordersByClientIdSnapshot.delete(k)
        i++
        if (i >= drop) break
      }
    }
  }

  private mergePendingTradeStatusIntoSnapshot(clientOrderId: string, orderId?: string): void {
    if (!orderId) return
    const pending = this.pendingTradeStatusByOrderId.get(orderId)
    if (!pending) return
    const prev = this.ordersByClientIdSnapshot.get(clientOrderId)
    if (!prev) return
    const next: OrderSnapshot = {
      ...prev,
      ...this.tradeStatusRawField(pending.tradeStatusRaw ?? prev.tradeStatusRaw),
      tradeStatusRank: Math.max(prev.tradeStatusRank, pending.tradeStatusRank) as TradeStatusRank,
      updatedAtMs: Math.max(prev.updatedAtMs, pending.updatedAtMs),
    }
    this.upsertOrderSnapshot(clientOrderId, next)
  }

  private applyPendingFillsForOrderId(orderId: string): boolean {
    const pending = this.pendingFilledByOrderId.get(orderId)
    if (pending === undefined) return false
    const cid = this.clientOrderIdByOrderId.get(orderId)
    if (!cid) return false
    const o = this.openOrdersByClientId.get(cid)
    if (!o) return false

    const size = Math.max(0, clampFinite(pending, 0))
    if (size <= 0) {
      this.pendingFilledByOrderId.delete(orderId)
      return false
    }

    const prevFilled = o.filled
    const prevRemaining = o.remaining
    const prevState = o.state

    o.filled = round2(o.filled + size)
    o.remaining = round2(Math.max(0, o.size - o.filled))
    o.updatedAtMs = this.nowMs
    o.state = o.remaining > 0 ? 'partially_filled' : 'filled'

    const changed =
      o.filled !== prevFilled || o.remaining !== prevRemaining || o.state !== prevState

    // Consumed.
    this.pendingFilledByOrderId.delete(orderId)

    if (o.state === 'filled') {
      this.openOrdersByClientId.delete(cid)
      this.unindexOrder(o)
    } else {
      this.openOrdersByClientId.set(cid, o)
    }
    return changed
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
    // Any inbound event can change portfolio state (and always advances nowMs
    // below), so drop the cached snapshot; the next snapshot() rebuilds it once.
    this.cachedSnapshot = null
    // Advance portfolio clock deterministically off inbound events.
    if (ev.kind === 'fill') this.nowMs = Math.max(this.nowMs, ev.fill.tsMs)
    else if (ev.kind === 'positions_split') this.nowMs = Math.max(this.nowMs, ev.split.tsMs)
    else this.nowMs = Math.max(this.nowMs, ev.tsMs)
    // console.log(`[portfolio][${ev.kind}]`,  ev )
    switch (ev.kind) {
      case 'ws_order_update': {
        const o = ev.order
        const orderId = o.orderId
        const prev = this.wsOpenOrdersByOrderId.get(orderId)
        const next = {
          orderId,
          ...(o.owner ? { owner: o.owner } : {}),
          ...(o.market ? { market: o.market } : {}),
          ...(o.assetId ? { assetId: o.assetId } : {}),
          ...(o.side ? { side: o.side } : {}),
          ...(typeof o.price === 'number' ? { price: o.price } : {}),
          ...(typeof o.originalSize === 'number' ? { originalSize: o.originalSize } : {}),
          ...(typeof o.sizeMatched === 'number' ? { sizeMatched: o.sizeMatched } : {}),
          ...(o.status ? { status: o.status } : {}),
          ...(o.orderType ? { orderType: o.orderType } : {}),
          ...(o.outcome ? { outcome: o.outcome } : {}),
          updatedAtMs: this.nowMs,
        }

        // Determine if it's still open.
        const originalSize = typeof o.originalSize === 'number' ? o.originalSize : undefined
        const sizeMatched = typeof o.sizeMatched === 'number' ? o.sizeMatched : undefined
        const filled =
          originalSize !== undefined &&
          sizeMatched !== undefined &&
          Number.isFinite(originalSize) &&
          Number.isFinite(sizeMatched) &&
          originalSize > 0 &&
          sizeMatched >= originalSize
        const canceled = o.event === 'CANCELLATION' || o.status === 'CANCELED'

        if (filled || canceled) {
          this.wsOpenOrdersByOrderId.delete(orderId)
        } else {
          this.wsOpenOrdersByOrderId.set(orderId, next)
        }

        // Show table whenever WS order state changes.
        const changed = JSON.stringify(prev ?? null) !== JSON.stringify(next)
        if (changed || filled || canceled) this.logOpenOrdersTable()

        // Capture trade status progression (MATCHED/MINED/CONFIRMED) for strategy-friendly snapshots.
        const statusRaw = o.status
        const rank = this.tradeStatusRankFromRaw(statusRaw)
        if (statusRaw || rank > 0) {
          // Store pending by orderId even if we can't map to clientOrderId yet.
          this.pendingTradeStatusByOrderId.set(orderId, {
            ...this.tradeStatusRawField(statusRaw),
            tradeStatusRank: rank,
            updatedAtMs: this.nowMs,
          })
          if (this.pendingTradeStatusByOrderId.size > this.maxPendingTradeStatus) {
            const drop = Math.ceil(this.maxPendingTradeStatus * 0.1)
            let i = 0
            for (const k of this.pendingTradeStatusByOrderId.keys()) {
              this.pendingTradeStatusByOrderId.delete(k)
              i++
              if (i >= drop) break
            }
          }
        }

        // If this orderId belongs to a bot order, merge into the corresponding OrderSnapshot.
        const clientOrderId =
          this.clientOrderIdByOrderId.get(orderId) ??
          this.clientOrderIdByOrderIdSnapshot.get(orderId)
        if (clientOrderId) {
          const prevSnap = this.ordersByClientIdSnapshot.get(clientOrderId)
          const bot = this.openOrdersByClientId.get(clientOrderId)
          if (prevSnap || bot) {
            const base: OrderSnapshot =
              prevSnap ??
              ({
                clientOrderId,
                ...(bot?.orderId ? { orderId: bot.orderId } : { orderId }),
                assetId: bot?.assetId ?? o.assetId ?? '',
                side: bot?.side ?? o.side ?? 'BUY',
                ...(typeof bot?.price === 'number' ? { price: bot.price } : {}),
                ...(typeof bot?.size === 'number' ? { originalSize: bot.size } : {}),
                ...(typeof bot?.filled === 'number' ? { sizeMatched: bot.filled } : {}),
                ...(typeof bot?.remaining === 'number' ? { remaining: bot.remaining } : {}),
                ...(bot?.state ? { lifecycleState: bot.state } : {}),
                tradeStatusRank: 0,
                updatedAtMs: this.nowMs,
              } as OrderSnapshot)

            const nextSnap: OrderSnapshot = {
              ...base,
              ...(o.orderId ? { orderId: o.orderId } : {}),
              ...(o.assetId ? { assetId: o.assetId } : {}),
              ...(o.side ? { side: o.side } : {}),
              ...(typeof o.price === 'number' ? { price: o.price } : {}),
              ...(typeof o.originalSize === 'number' ? { originalSize: o.originalSize } : {}),
              ...(typeof o.sizeMatched === 'number' ? { sizeMatched: o.sizeMatched } : {}),
              ...(typeof o.originalSize === 'number' && typeof o.sizeMatched === 'number'
                ? { remaining: round2(Math.max(0, o.originalSize - o.sizeMatched)) }
                : {}),
              ...this.tradeStatusRawField(
                typeof statusRaw === 'string' ? statusRaw : base.tradeStatusRaw,
              ),
              tradeStatusRank: Math.max(base.tradeStatusRank, rank) as TradeStatusRank,
              updatedAtMs: this.nowMs,
            }
            this.upsertOrderSnapshot(clientOrderId, nextSnap)
          }
        }
        return
      }
      case 'positions_merged': {
        const a = ev.assetIdA
        const b = ev.assetIdB
        const requested = clampFinite(ev.size, 0)
        if (!a || !b || a === b) return
        if (!Number.isFinite(requested) || requested <= 0) return

        const posA = this.positionsByAssetId.get(positionKey(a))
        const posB = this.positionsByAssetId.get(positionKey(b))
        const qa = clampFinite(posA?.qty ?? 0, 0)
        const qb = clampFinite(posB?.qty ?? 0, 0)

        const actual = Math.min(requested, qa, qb)
        if (!Number.isFinite(actual) || actual <= 0) return

        const nextA = round2(qa - actual)
        const nextB = round2(qb - actual)

        if (posA) {
          if (nextA > 0) this.positionsByAssetId.set(positionKey(a), { ...posA, qty: nextA })
          else this.positionsByAssetId.delete(positionKey(a))
        }
        if (posB) {
          if (nextB > 0) this.positionsByAssetId.set(positionKey(b), { ...posB, qty: nextB })
          else this.positionsByAssetId.delete(positionKey(b))
        }

        this.logPositionsByMarket()
        return
      }
      case 'merge_failed':
        // No state change; execution reported a failure.
        return
      case 'split_failed':
        // No state change; execution reported a failure.
        return
      case 'order_submitted': {
        const o = ev.order
        this.openOrdersByClientId.set(o.clientOrderId, o)
        this.indexOrder(o)
        if (o.market) this.marketByAssetId.set(o.assetId, o.market)
        this.upsertOrderSnapshot(o.clientOrderId, {
          clientOrderId: o.clientOrderId,
          ...(o.orderId ? { orderId: o.orderId } : {}),
          assetId: o.assetId,
          side: o.side,
          price: o.price,
          originalSize: o.size,
          sizeMatched: o.filled,
          remaining: o.remaining,
          lifecycleState: o.state,
          ...(o.meta ? { meta: o.meta } : {}),
          tradeStatusRank: 0,
          updatedAtMs: this.nowMs,
        })
        this.mergePendingTradeStatusIntoSnapshot(o.clientOrderId, o.orderId)
        this.logOpenOrdersTable()
        return
      }
      case 'order_accepted': {
        const o = this.openOrdersByClientId.get(ev.clientOrderId)
        if (!o) return
        if (ev.orderId !== undefined) o.orderId = ev.orderId
        this.indexOrder(o)
        o.state = o.state === 'requested' ? 'open' : o.state
        o.updatedAtMs = this.nowMs
        this.openOrdersByClientId.set(o.clientOrderId, o)
        this.upsertOrderSnapshot(o.clientOrderId, {
          clientOrderId: o.clientOrderId,
          ...(o.orderId ? { orderId: o.orderId } : {}),
          assetId: o.assetId,
          side: o.side,
          price: o.price,
          originalSize: o.size,
          sizeMatched: o.filled,
          remaining: o.remaining,
          lifecycleState: o.state,
          ...(o.meta ? { meta: o.meta } : {}),
          ...this.tradeStatusRawField(
            this.ordersByClientIdSnapshot.get(o.clientOrderId)?.tradeStatusRaw,
          ),
          tradeStatusRank: this.ordersByClientIdSnapshot.get(o.clientOrderId)?.tradeStatusRank ?? 0,
          updatedAtMs: this.nowMs,
        })
        this.mergePendingTradeStatusIntoSnapshot(o.clientOrderId, o.orderId)
        if (ev.orderId) this.applyPendingFillsForOrderId(ev.orderId)
        this.logOpenOrdersTable()
        return
      }
      case 'order_open': {
        const clientId =
          ev.clientOrderId ?? (ev.orderId ? this.clientOrderIdByOrderId.get(ev.orderId) : undefined)
        if (!clientId) return
        const o = this.openOrdersByClientId.get(clientId)
        if (!o) return
        o.state = 'open'
        if (ev.orderId !== undefined) o.orderId = ev.orderId
        this.indexOrder(o)
        o.updatedAtMs = this.nowMs
        this.openOrdersByClientId.set(o.clientOrderId, o)
        this.upsertOrderSnapshot(o.clientOrderId, {
          clientOrderId: o.clientOrderId,
          ...(o.orderId ? { orderId: o.orderId } : {}),
          assetId: o.assetId,
          side: o.side,
          price: o.price,
          originalSize: o.size,
          sizeMatched: o.filled,
          remaining: o.remaining,
          lifecycleState: o.state,
          ...(o.meta ? { meta: o.meta } : {}),
          ...this.tradeStatusRawField(
            this.ordersByClientIdSnapshot.get(o.clientOrderId)?.tradeStatusRaw,
          ),
          tradeStatusRank: this.ordersByClientIdSnapshot.get(o.clientOrderId)?.tradeStatusRank ?? 0,
          updatedAtMs: this.nowMs,
        })
        this.mergePendingTradeStatusIntoSnapshot(o.clientOrderId, o.orderId)
        if (ev.orderId) this.applyPendingFillsForOrderId(ev.orderId)
        this.logOpenOrdersTable()
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
        this.upsertOrderSnapshot(ev.clientOrderId, {
          clientOrderId: ev.clientOrderId,
          ...(o.orderId ? { orderId: o.orderId } : {}),
          assetId: o.assetId,
          side: o.side,
          price: o.price,
          originalSize: o.size,
          sizeMatched: o.filled,
          remaining: 0,
          lifecycleState: 'rejected',
          ...(o.meta ? { meta: o.meta } : {}),
          ...this.tradeStatusRawField(
            this.ordersByClientIdSnapshot.get(ev.clientOrderId)?.tradeStatusRaw,
          ),
          tradeStatusRank:
            this.ordersByClientIdSnapshot.get(ev.clientOrderId)?.tradeStatusRank ?? 0,
          updatedAtMs: this.nowMs,
        })
        this.mergePendingTradeStatusIntoSnapshot(ev.clientOrderId, o.orderId)
        this.logOpenOrdersTable()
        return
      }
      case 'order_done': {
        const clientId =
          ev.clientOrderId ?? (ev.orderId ? this.clientOrderIdByOrderId.get(ev.orderId) : undefined)
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
        this.upsertOrderSnapshot(clientId, {
          clientOrderId: clientId,
          ...(o.orderId ? { orderId: o.orderId } : {}),
          assetId: o.assetId,
          side: o.side,
          price: o.price,
          originalSize: o.size,
          sizeMatched: o.filled,
          remaining: 0,
          lifecycleState: next,
          ...(o.meta ? { meta: o.meta } : {}),
          ...this.tradeStatusRawField(this.ordersByClientIdSnapshot.get(clientId)?.tradeStatusRaw),
          tradeStatusRank: this.ordersByClientIdSnapshot.get(clientId)?.tradeStatusRank ?? 0,
          updatedAtMs: this.nowMs,
        })
        this.mergePendingTradeStatusIntoSnapshot(clientId, o.orderId)
        this.logOpenOrdersTable()
        return
      }
      case 'fill': {
        if (!this.fillSeenOnce(ev.fill.id, ev.fill.tsMs)) return
        this.pushFill(ev.fill)
        const orderChanged = this.applyFillToOrders(ev.fill)
        this.applyFillToPosition(ev.fill)
        if (ev.fill.market) this.marketByAssetId.set(ev.fill.assetId, ev.fill.market)
        if (orderChanged) this.logOpenOrdersTable()
        return
      }
      case 'positions_split': {
        const s = ev.split
        const size = Math.max(0, clampFinite(s.size, 0))
        if (!s.assetIdA || !s.assetIdB || s.assetIdA === s.assetIdB) return
        if (!Number.isFinite(size) || size <= 0) return

        // Mint shares on both sides. This is NOT a trade fill and should not affect realizedPnlTotal.
        // We intentionally keep costBasis at 0 so later sells are treated as pure proceeds unless
        // you explicitly model basis via normal BUY fills.
        const mint = (assetId: string): void => {
          const key = positionKey(assetId)
          const prev = this.positionsByAssetId.get(key)
          if (!prev) {
            this.positionsByAssetId.set(key, {
              assetId,
              qty: round2(size),
              avgEntryPrice: null,
              costBasis: 0,
            })
          } else {
            this.positionsByAssetId.set(key, { ...prev, qty: round2(prev.qty + size) })
          }
          if (s.market) this.marketByAssetId.set(assetId, s.market)
        }
        mint(s.assetIdA)
        mint(s.assetIdB)

        this.recentSplits.push(s)
        if (this.maxRecentSplits > 0 && this.recentSplits.length > this.maxRecentSplits) {
          this.recentSplits.splice(0, this.recentSplits.length - this.maxRecentSplits)
        }
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

  private applyFillToOrders(f: Fill): boolean {
    const cid =
      f.clientOrderId ?? (f.orderId ? this.clientOrderIdByOrderId.get(f.orderId) : undefined)
    if (!cid) {
      // Out-of-order: we got a fill before we know/mapped the order. Buffer by orderId.
      if (f.orderId) {
        const size = Math.max(0, clampFinite(f.size, 0))
        if (size > 0) {
          const prev = this.pendingFilledByOrderId.get(f.orderId) ?? 0
          this.pendingFilledByOrderId.set(f.orderId, round2(prev + size))
        }
      }
      return false
    }
    const o = this.openOrdersByClientId.get(cid)
    if (!o) return false
    const size = Math.max(0, clampFinite(f.size, 0))
    const prevFilled = o.filled
    const prevRemaining = o.remaining
    const prevState = o.state
    o.filled = round2(o.filled + size)
    o.remaining = round2(Math.max(0, o.size - o.filled))
    o.updatedAtMs = this.nowMs
    o.state = o.remaining > 0 ? 'partially_filled' : 'filled'
    const changed =
      o.filled !== prevFilled || o.remaining !== prevRemaining || o.state !== prevState
    if (o.state === 'filled') {
      this.openOrdersByClientId.delete(cid)
      this.unindexOrder(o)
    } else {
      this.openOrdersByClientId.set(cid, o)
    }
    return changed
  }

  private applyFillToPosition(f: Fill): void {
    const assetId = f.assetId
    const key = positionKey(assetId)
    const prev = this.positionsByAssetId.get(key) ?? {
      assetId,
      qty: 0,
      avgEntryPrice: null,
      costBasis: 0,
    }

    const size = Math.max(0, clampFinite(f.size, 0))
    const price = clampFinite(f.price, 0)
    if (size <= 0) return

    const feeRateBps =
      typeof f.feeRateBps === 'number' && Number.isFinite(f.feeRateBps) ? f.feeRateBps : undefined
    const shouldApplyFee = f.liquidity === 'TAKER' && feeRateBps !== undefined && feeRateBps > 0
    const fee = shouldApplyFee
      ? computePolymarketTakerFee({ feeRateBps, price, size, side: f.side })
      : { feeBase: 0, feeQuote: 0 }

    if (f.side === 'BUY') {
      // Increase position, update avg + cost basis (average-cost accounting).
      const prevCostBasis =
        typeof (prev as { costBasis?: unknown }).costBasis === 'number'
          ? (prev as { costBasis: number }).costBasis
          : prev.avgEntryPrice === null
            ? 0
            : prev.avgEntryPrice * prev.qty
      const netSize = Math.max(0, size - fee.feeBase)
      const newQty = prev.qty + netSize
      const newCostBasis = prevCostBasis + price * size
      const avg = newQty > 0 ? newCostBasis / newQty : null
      this.positionsByAssetId.set(key, {
        assetId,
        qty: round2(newQty),
        avgEntryPrice: avg === null ? null : round2(avg),
        costBasis: round2(newCostBasis),
      })

      // Log positions after BUY
      this.logPositionsByMarket()
      return
    }

    // SELL: reduce position; realize PnL against avg entry when available.
    const sellQty = Math.min(size, prev.qty)
    const remainingQty = prev.qty - sellQty
    const prevCostBasis =
      typeof (prev as { costBasis?: unknown }).costBasis === 'number'
        ? (prev as { costBasis: number }).costBasis
        : prev.avgEntryPrice === null
          ? 0
          : prev.avgEntryPrice * prev.qty
    const avgCostPerShare = prev.qty > 0 ? prevCostBasis / prev.qty : 0
    const costRemoved = avgCostPerShare * sellQty
    const remainingCostBasis = Math.max(0, prevCostBasis - costRemoved)

    // Realize PnL against average cost-per-share (more consistent than rounded avgEntryPrice).
    // We keep only portfolio-level realized PnL (cumulative across all assets).
    const grossProceeds = price * sellQty
    const netProceeds = grossProceeds - fee.feeQuote
    const realizedDelta = round2(netProceeds - avgCostPerShare * sellQty)
    if (Number.isFinite(realizedDelta))
      this.realizedPnlTotal = round2(this.realizedPnlTotal + realizedDelta)
    if (remainingQty > 0) {
      const nextAvg = remainingQty > 0 ? remainingCostBasis / remainingQty : null
      this.positionsByAssetId.set(key, {
        assetId,
        qty: round2(remainingQty),
        avgEntryPrice: nextAvg === null ? null : round2(nextAvg),
        costBasis: round2(remainingCostBasis),
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
    return
    const shortAsset = (assetId: string) => assetId.slice(-8)
    const fmt4 = (n: number | null | undefined) =>
      typeof n === 'number' && Number.isFinite(n) ? n.toFixed(4) : 'N/A'

    // ---- Positions table ----
    const positions = [...this.positionsByAssetId.values()]
    if (positions.length === 0) {
      console.log('[portfolio][positions]: (none)')
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
          }
        })
        .sort((a, b) => (a.market < b.market ? -1 : a.market > b.market ? 1 : 0))

      console.log(`[portfolio][positions]: (${positions.length})`)
      console.table(positionRows)
    }

    console.log(`[portfolio][Total realized PnL]: ${this.realizedPnlTotal.toFixed(4)}`)
  }

  private logOpenOrdersTable(): void {
    // Debug-only (table logging). Keep disabled in hot paths; can be re-enabled when needed.
    return
  }
}
