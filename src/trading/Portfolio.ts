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
import { round2, round8 } from './utils/rounding.js'
import { computePolymarketTakerFee } from './fees.js'
import {
  buyCommitment,
  DEFAULT_STARTING_CAPITAL,
  fillCashDelta,
  validateStartingCapital,
} from './capital.js'

type CashOrder = {
  orderId?: string
  side: 'BUY' | 'SELL'
  price: number
  size: number
  postOnly: boolean
  filled: number
  matched: number
  /** Undefined until a terminal event supplies the final executed quantity. */
  finalFilled?: number
}

function clampFinite(n: number, fallback = 0): number {
  if (!Number.isFinite(n)) return fallback
  return n
}

function positionKey(assetId: string): string {
  return assetId
}

/**
 * INVARIANT: `apply(ev)` and the one-shot `initializeClock()` are the only methods
 * that mutate snapshot-exposed state
 * (positionsByAssetId, openOrdersByClientId, wsOpenOrdersByOrderId,
 * ordersByClientIdSnapshot, recentFills, recentSplits, marketByAssetId, nowMs,
 * realizedPnlTotal). Every private mutator (upsertOrderSnapshot, applyFillTo*,
 * pushFill, …) is reachable only from apply().
 *
 * `snapshot()` relies on this: it caches a frozen snapshot and invalidates it in
 * apply() and initializeClock() (see `cachedSnapshot`). Any new mutation path
 * must null `cachedSnapshot` too, or snapshot() will serve stale data. Route
 * later state changes through apply() to preserve snapshot reuse between events.
 */
export class Portfolio {
  private nowMs = Date.now()
  private clockInitialized = false
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
  // Terminal exchange IDs must not reappear as open after a delayed WS placement/update.
  private readonly terminalOrderIds = new Set<string>()

  private markOrderTerminal(orderId: string): void {
    this.terminalOrderIds.add(orderId)
    this.wsOpenOrdersByOrderId.delete(orderId)
    if (this.terminalOrderIds.size > this.maxClientOrderIdByOrderIdSnapshot) {
      this.terminalOrderIds.delete(this.terminalOrderIds.values().next().value!)
    }
  }

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
  private readonly startingCapital: number
  private cash: number
  // Order status can precede fills. Preserve obligations independently of whether
  // the order is still open, using the same submission/exchange identities.
  private readonly cashOrders = new Set<CashOrder>()
  private readonly cashOrderByClientId = new Map<string, CashOrder>()
  private readonly cashOrderByOrderId = new Map<string, CashOrder>()
  private readonly unlinkedCashFills = new Map<string, number>()

  // Cached, frozen snapshot reused across calls until the next state change.
  // StrategyRunner calls snapshot() on every market tick (172k+ ticks/market in
  // backtests), but after clock initialization, portfolio state only changes
  // inside apply() (account events, orders of magnitude rarer than ticks).
  // Rebuilding every map on every tick
  // dominated backtest runtime (see #77); caching the whole snapshot makes the
  // per-tick cost O(1) between account events. Invalidated in apply() and once
  // when initializeClock() replaces the pre-observation display clock.
  private cachedSnapshot: PortfolioSnapshot | null = null

  constructor(opts?: { maxRecentFills?: number; startingCapital?: number }) {
    this.maxRecentFills = Math.max(0, opts?.maxRecentFills ?? 500)
    this.startingCapital = validateStartingCapital(
      opts?.startingCapital ?? DEFAULT_STARTING_CAPITAL,
    )
    this.cash = this.startingCapital
  }

  /** The first observed tick/event replaces the construction-time display clock. */
  initializeClock(nowMs: number): void {
    if (this.clockInitialized || !Number.isFinite(nowMs)) return
    this.nowMs = nowMs
    this.clockInitialized = true
    this.cachedSnapshot = null
  }

  snapshot(): PortfolioSnapshot {
    if (this.cachedSnapshot) return this.cachedSnapshot
    let reservedCash = 0
    for (const order of this.cashOrders) {
      if (order.side !== 'BUY') continue
      const outstanding = Math.max(0, (order.finalFilled ?? order.size) - order.filled)
      reservedCash += buyCommitment(order.price, outstanding, order.postOnly)
    }
    reservedCash = round8(reservedCash)
    const snap: PortfolioSnapshot = {
      capital: Object.freeze({
        startingCapital: this.startingCapital,
        cash: this.cash,
        reservedCash,
        availableCash: round8(this.cash - reservedCash),
      }),
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

  private linkCashOrder(clientOrderId: string, orderId: string): void {
    const open = this.openOrdersByClientId.get(clientOrderId)
    if (open && this.belongsToEarlierOrder(open, orderId)) return
    const local = this.cashOrderByClientId.get(clientOrderId)
    if (!local) return
    // Closed replacements still own their exchange identity. A late acknowledgement
    // for an older generation must not merge two independent cash obligations.
    if (local.orderId && local.orderId !== orderId) return
    local.orderId = orderId
    const exchange = this.cashOrderByOrderId.get(orderId)
    if (exchange && exchange !== local) {
      local.filled = Math.max(local.filled, exchange.filled)
      local.matched = Math.max(local.matched, exchange.matched)
      if (exchange.finalFilled !== undefined) local.finalFilled = exchange.finalFilled
      this.cashOrders.delete(exchange)
    }
    local.filled = round8(local.filled + (this.unlinkedCashFills.get(orderId) ?? 0))
    this.unlinkedCashFills.delete(orderId)
    this.cashOrderByOrderId.set(orderId, local)
  }

  private applyCashOrderEvent(ev: AccountEvent): void {
    if (ev.kind === 'order_submitted') {
      const o = ev.order
      const order: CashOrder = {
        side: o.side,
        price: o.price,
        size: o.size,
        postOnly: o.postOnly === true,
        filled: o.filled,
        matched: o.filled,
      }
      this.cashOrders.add(order)
      this.cashOrderByClientId.set(o.clientOrderId, order)
      if (o.orderId) this.linkCashOrder(o.clientOrderId, o.orderId)
    } else if (ev.kind === 'order_accepted' || ev.kind === 'order_open') {
      if (ev.clientOrderId && ev.orderId) this.linkCashOrder(ev.clientOrderId, ev.orderId)
    } else if (ev.kind === 'ws_order_update') {
      const o = ev.order
      // Trade-status updates carry an individual trade size, not an order's
      // cumulative size_matched. Only real order updates establish final sizes.
      if (['MATCHED', 'MINED', 'CONFIRMED', 'RETRYING', 'FAILED'].includes(o.status ?? '')) return
      let order = this.cashOrderByOrderId.get(o.orderId)
      if (!order && o.side && Number.isFinite(o.price) && Number.isFinite(o.originalSize)) {
        order = {
          orderId: o.orderId,
          side: o.side,
          price: o.price!,
          size: o.originalSize!,
          postOnly: false,
          filled: this.unlinkedCashFills.get(o.orderId) ?? 0,
          matched: 0,
        }
        this.unlinkedCashFills.delete(o.orderId)
        this.cashOrders.add(order)
        this.cashOrderByOrderId.set(o.orderId, order)
      }
      if (!order) return
      if (Number.isFinite(o.sizeMatched)) order.matched = Math.max(order.matched, o.sizeMatched!)
      const terminal =
        o.event === 'CANCELLATION' ||
        ['CANCELED', 'CANCELLED', 'EXPIRED'].includes(o.status ?? '') ||
        order.matched >= order.size
      if (terminal && Number.isFinite(o.sizeMatched)) {
        order.finalFilled = Math.max(order.finalFilled ?? 0, order.matched, order.filled)
      }
    } else if (ev.kind === 'order_done' || ev.kind === 'order_rejected') {
      // Validation/funding can reject a reused client ID before a new submission.
      // Only a currently submitted order can be released by that rejection;
      // an earlier closed order may still have fills awaiting reconciliation.
      if (ev.kind === 'order_rejected' && !this.openOrdersByClientId.has(ev.clientOrderId)) return
      const order =
        ev.kind === 'order_done' && ev.orderId
          ? this.cashOrderByOrderId.get(ev.orderId)
          : ev.clientOrderId
            ? this.cashOrderByClientId.get(ev.clientOrderId)
            : undefined
      if (!order) return
      const filled =
        ev.kind === 'order_rejected' || ev.reason === 'killed'
          ? 0
          : ev.reason === 'filled'
            ? order.size
            : ev.filledSize
      if (filled !== undefined && Number.isFinite(filled)) {
        order.finalFilled = Math.max(filled, order.matched, order.filled, order.finalFilled ?? 0)
      }
      // Without a final quantity (e.g. REST cancel acknowledgement), retain the
      // unresolved obligation until the terminal WS order update arrives.
    }
  }

  private applyCashFill(fill: Fill): void {
    this.cash = round8(this.cash + fillCashDelta(fill))
    if (fill.orderId && fill.clientOrderId && !this.cashOrderByOrderId.has(fill.orderId)) {
      this.linkCashOrder(fill.clientOrderId, fill.orderId)
    }
    const order = fill.orderId
      ? this.cashOrderByOrderId.get(fill.orderId)
      : fill.clientOrderId
        ? this.cashOrderByClientId.get(fill.clientOrderId)
        : undefined
    if (order) order.filled = round8(order.filled + fill.size)
    else if (fill.orderId)
      this.unlinkedCashFills.set(
        fill.orderId,
        round8((this.unlinkedCashFills.get(fill.orderId) ?? 0) + fill.size),
      )
  }

  private indexOrder(o: OpenOrder): void {
    if (o.orderId) this.clientOrderIdByOrderId.set(o.orderId, o.clientOrderId)
  }

  private unindexOrder(o: OpenOrder): void {
    if (o.orderId) this.clientOrderIdByOrderId.delete(o.orderId)
  }

  private belongsToEarlierOrder(o: OpenOrder, orderId: string | undefined): boolean {
    if (!orderId || o.orderId === orderId) return false
    // A pending replacement has no exchange ID yet. An already indexed ID belongs
    // to a previous submission, even when both submissions use the same client ID.
    return o.orderId !== undefined || this.clientOrderIdByOrderIdSnapshot.has(orderId)
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
    // The one-shot clock initialization also invalidates it — see the class invariant.
    this.cachedSnapshot = null
    // Advance portfolio clock deterministically off inbound events.
    const eventMs =
      ev.kind === 'fill' ? ev.fill.tsMs : ev.kind === 'positions_split' ? ev.split.tsMs : ev.tsMs
    this.initializeClock(eventMs)
    this.nowMs = Math.max(this.nowMs, eventMs)
    this.applyCashOrderEvent(ev)
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

        if (filled || canceled || this.terminalOrderIds.has(orderId)) {
          this.markOrderTerminal(orderId)
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
          if ((prevSnap || bot) && (bot?.orderId ?? prevSnap?.orderId) === orderId) {
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
                ...(bot?.postOnly !== undefined ? { postOnly: bot.postOnly } : {}),
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
            // A late nonterminal update can advance trade status, but cannot reopen an order.
            nextSnap.sizeMatched = Math.max(base.sizeMatched ?? 0, o.sizeMatched ?? 0)
            if (this.terminalOrderIds.has(orderId)) nextSnap.remaining = 0
            this.upsertOrderSnapshot(clientOrderId, nextSnap)
          }
        }
        return
      }
      case 'positions_merged': {
        if (!this.fillSeenOnce(`merge:${ev.id}`, ev.tsMs)) return
        const a = ev.assetIdA
        const b = ev.assetIdB
        const requested = clampFinite(ev.size, 0)
        if (!a || !b || a === b) return
        if (!Number.isFinite(requested) || requested <= 0) return
        // The event reports confirmed collateral proceeds, regardless of whether
        // all position-producing events have arrived yet.
        this.cash = round8(this.cash + requested)

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
          ...(o.postOnly !== undefined ? { postOnly: o.postOnly } : {}),
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
        if (!o || this.belongsToEarlierOrder(o, ev.orderId)) return
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
          ...(o.postOnly !== undefined ? { postOnly: o.postOnly } : {}),
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
        if (!o || this.belongsToEarlierOrder(o, ev.orderId)) return
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
          ...(o.postOnly !== undefined ? { postOnly: o.postOnly } : {}),
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
          ...(o.postOnly !== undefined ? { postOnly: o.postOnly } : {}),
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
        if (ev.orderId) this.markOrderTerminal(ev.orderId)
        const clientId =
          ev.clientOrderId ??
          (ev.orderId
            ? (this.clientOrderIdByOrderId.get(ev.orderId) ??
              this.clientOrderIdByOrderIdSnapshot.get(ev.orderId))
            : undefined)
        if (!clientId) return
        const o = this.openOrdersByClientId.get(clientId)
        const previous = this.ordersByClientIdSnapshot.get(clientId)
        if (!o) {
          // A full fill can remove the open order before its terminal event arrives.
          if (
            previous &&
            (!ev.orderId || previous.orderId === ev.orderId) &&
            (!previous.lifecycleState ||
              ['requested', 'open', 'partially_filled'].includes(previous.lifecycleState))
          ) {
            this.upsertOrderSnapshot(clientId, {
              ...previous,
              lifecycleState: ev.reason,
              remaining: 0,
              ...(ev.reason === 'filled' && previous.originalSize !== undefined
                ? { sizeMatched: previous.originalSize }
                : {}),
              updatedAtMs: this.nowMs,
            })
          }
          return
        }
        if (this.belongsToEarlierOrder(o, ev.orderId)) return
        if (o.orderId) this.markOrderTerminal(o.orderId)
        const next = ev.reason
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
          sizeMatched: Math.max(o.filled, previous?.sizeMatched ?? 0),
          remaining: 0,
          lifecycleState: next,
          ...(o.postOnly !== undefined ? { postOnly: o.postOnly } : {}),
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
        if (
          !Number.isFinite(ev.fill.size) ||
          ev.fill.size <= 0 ||
          !Number.isFinite(ev.fill.price) ||
          ev.fill.price < 0
        )
          return
        if (!this.fillSeenOnce(ev.fill.id, ev.fill.tsMs)) return
        this.applyCashFill(ev.fill)
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
        if (!Number.isFinite(s.splitCost) || s.splitCost < 0) return
        if (!this.fillSeenOnce(`split:${s.id}`, s.tsMs)) return
        this.cash = round8(this.cash - s.splitCost)

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
      case 'cancel_failed':
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
    const o = cid ? this.openOrdersByClientId.get(cid) : undefined
    if (o && this.belongsToEarlierOrder(o, f.orderId)) return false
    if (!cid || (o && !o.orderId && f.orderId)) {
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
    // Taker fees are charged in USDC (never in outcome shares): a BUY fee
    // increases the cost of the acquired shares, a SELL fee reduces proceeds.
    const feeUsdc = shouldApplyFee ? computePolymarketTakerFee({ feeRateBps, price, size }) : 0

    if (f.side === 'BUY') {
      // Increase position, update avg + cost basis (average-cost accounting).
      const prevCostBasis =
        typeof (prev as { costBasis?: unknown }).costBasis === 'number'
          ? (prev as { costBasis: number }).costBasis
          : prev.avgEntryPrice === null
            ? 0
            : prev.avgEntryPrice * prev.qty
      const newQty = prev.qty + size
      const newCostBasis = prevCostBasis + price * size + feeUsdc
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
    const netProceeds = grossProceeds - feeUsdc
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
