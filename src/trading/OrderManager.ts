import type { MarketOrderBooksSnapshot } from '../market/orderbook/index.js'
import type {
  AccountEvent,
  CancelAllIntent,
  CancelOrderIntent,
  ClientOrderId,
  Intent,
  MergePositionsIntent,
  OpenOrder,
  OrderType,
  PlaceBatchIntent,
  PlaceLimitIntent,
  PortfolioSnapshot,
  SplitPositionsIntent,
} from '../strategy/Strategy.js'
import { enforceRiskLimits } from './riskLimits.js'

export type OrderManagerContext = {
  nowMs: number
  lastMarket?: MarketOrderBooksSnapshot
  portfolio?: PortfolioSnapshot
}

export type ExecutionPlaceResult = {
  events: AccountEvent[]
}

export type ExecutionCancelResult = {
  events: AccountEvent[]
}

export type ExecutionMergeResult = {
  events: AccountEvent[]
}

export type ExecutionAdapter = {
  placeLimit: (intent: PlaceLimitIntent, ctx: OrderManagerContext) => Promise<ExecutionPlaceResult>
  placeBatch: (intent: PlaceBatchIntent, ctx: OrderManagerContext) => Promise<ExecutionPlaceResult>
  cancelOrder: (
    intent: CancelOrderIntent,
    ctx: OrderManagerContext,
  ) => Promise<ExecutionCancelResult>
  cancelAll: (intent: CancelAllIntent, ctx: OrderManagerContext) => Promise<ExecutionCancelResult>
  mergePositions: (
    intent: MergePositionsIntent,
    ctx: OrderManagerContext,
  ) => Promise<ExecutionMergeResult>
  splitPositions: (
    intent: SplitPositionsIntent,
    ctx: OrderManagerContext,
  ) => Promise<{ events: AccountEvent[] }>
  /**
   * Optional: backtest execution can simulate resting order fills on each market tick.
   * Live execution typically does nothing here (fills come via user WS/polling).
   */
  onMarketTick?: (ctx: OrderManagerContext) => Promise<{ events: AccountEvent[] }>
}

export type OrderManagerOptions = {
  execution: ExecutionAdapter
  dryRun?: boolean
  /**
   * Minimum expiry offset for GTD, in ms. Docs mention a 1-minute threshold.
   * Default 60_000.
   */
  minGtdOffsetMs?: number
  log?: (msg: string, extra?: unknown) => void
}

export type IntentExecutionMode = 'queued' | 'immediate'

/**
 * Minimal order manager:
 * - enforces basic validation (GTD expiry)
 * - emits deterministic AccountEvents (order_submitted, order_accepted, etc.)
 * - delegates to an ExecutionAdapter (live or backtest)
 */
export class OrderManager {
  private readonly execution: ExecutionAdapter
  private readonly dryRun: boolean
  private readonly minGtdOffsetMs: number
  private readonly log: ((msg: string, extra?: unknown) => void) | undefined

  // Internal dedupe of clientOrderId to avoid spamming the same intent every tick.
  private readonly activeClientOrders = new Set<ClientOrderId>()

  // Optional 1-tick latency mode: intents submitted on tick N execute on tick N+1.
  private pendingIntents: Intent[] = []

  constructor(opts: OrderManagerOptions) {
    this.execution = opts.execution
    this.dryRun = opts.dryRun ?? false
    this.minGtdOffsetMs = Math.max(0, opts.minGtdOffsetMs ?? 60_000)
    this.log = opts.log
  }

  async handleIntents(
    intents: Intent[],
    ctx: OrderManagerContext,
    opts?: { mode?: IntentExecutionMode },
  ): Promise<AccountEvent[]> {
    const mode: IntentExecutionMode = opts?.mode ?? 'queued'
    if (!intents || intents.length === 0) return []

    if (mode === 'queued') {
      void ctx // latency queue does not use ctx at enqueue-time
      this.pendingIntents.push(...intents)
      return []
    }

    const { allowed, rejectedEvents, blocked } = enforceRiskLimits({
      nowMs: ctx.nowMs,
      intents,
      ...(ctx.portfolio ? { portfolio: ctx.portfolio } : {}),
    })

    if (blocked.length > 0) {
      this.log?.('[risk] blocked intents', {
        count: blocked.length,
        reasons: blocked.map((b) => b.reason),
      })
    }

    const out: AccountEvent[] = []
    out.push(...rejectedEvents)
    out.push(...(await this.executeIntentsNow(allowed, ctx)))
    return out
  }

  async onMarketTick(ctx: OrderManagerContext): Promise<AccountEvent[]> {
    const out: AccountEvent[] = []

    // 1) Execute intents queued from previous ticks.
    if (this.pendingIntents.length > 0) {
      const queued = this.pendingIntents
      this.pendingIntents = []

      const { allowed, rejectedEvents, blocked } = enforceRiskLimits({
        nowMs: ctx.nowMs,
        intents: queued,
        ...(ctx.portfolio ? { portfolio: ctx.portfolio } : {}),
      })

      if (blocked.length > 0) {
        this.log?.('[risk] blocked intents', {
          count: blocked.length,
          reasons: blocked.map((b) => b.reason),
        })
      }

      out.push(...rejectedEvents)
      out.push(...(await this.executeIntentsNow(allowed, ctx)))
    }

    // 2) Let execution layer simulate fills (backtests) for orders resting on the book.
    if (this.execution.onMarketTick) {
      const res = await this.execution.onMarketTick(ctx)
      out.push(...res.events)
    }

    // 3) Maintain clientOrderId dedupe: if an order is done/rejected, allow re-use.
    for (const ev of out) {
      if (ev.kind === 'order_rejected') this.activeClientOrders.delete(ev.clientOrderId)
      if (ev.kind === 'order_done' && ev.clientOrderId)
        this.activeClientOrders.delete(ev.clientOrderId)
    }

    return out
  }

  private async executeIntentsNow(
    intents: Intent[],
    ctx: OrderManagerContext,
  ): Promise<AccountEvent[]> {
    const out: AccountEvent[] = []
    for (const intent of intents) {
      if (intent.kind === 'place_limit') {
        out.push(...(await this.handlePlaceLimit(intent, ctx)))
      } else if (intent.kind === 'place_batch') {
        out.push(...(await this.handlePlaceBatch(intent, ctx)))
      } else if (intent.kind === 'cancel_order') {
        out.push(...(await this.handleCancelOrder(intent, ctx)))
      } else if (intent.kind === 'cancel_all') {
        out.push(...(await this.handleCancelAll(intent, ctx)))
      } else if (intent.kind === 'merge_positions') {
        out.push(...(await this.handleMergePositions(intent, ctx)))
      } else if (intent.kind === 'split_positions') {
        out.push(...(await this.handleSplitPositions(intent, ctx)))
      } else {
        const _exhaustive: never = intent
        void _exhaustive
      }
    }
    return out
  }

  private async handleSplitPositions(
    intent: SplitPositionsIntent,
    ctx: OrderManagerContext,
  ): Promise<AccountEvent[]> {
    const nowMs = ctx.nowMs
    const size = typeof intent.size === 'number' && Number.isFinite(intent.size) ? intent.size : 0
    if (!intent.assetIdA || !intent.assetIdB || intent.assetIdA === intent.assetIdB) {
      return [
        {
          kind: 'split_failed',
          tsMs: nowMs,
          assetIdA: intent.assetIdA,
          assetIdB: intent.assetIdB,
          requestedSize: size,
          reason: 'invalid asset ids',
        },
      ]
    }
    if (size <= 0) {
      return [
        {
          kind: 'split_failed',
          tsMs: nowMs,
          assetIdA: intent.assetIdA,
          assetIdB: intent.assetIdB,
          requestedSize: size,
          reason: 'invalid size',
        },
      ]
    }

    // Split is not an order and should not be deduped by clientOrderId. Delegate to execution.
    const res = await this.execution.splitPositions(intent, ctx)
    return res.events
  }

  private async handleMergePositions(
    intent: MergePositionsIntent,
    ctx: OrderManagerContext,
  ): Promise<AccountEvent[]> {
    const nowMs = ctx.nowMs
    const size = typeof intent.size === 'number' && Number.isFinite(intent.size) ? intent.size : 0
    if (!intent.assetIdA || !intent.assetIdB || intent.assetIdA === intent.assetIdB) {
      return [
        {
          kind: 'merge_failed',
          tsMs: nowMs,
          assetIdA: intent.assetIdA,
          assetIdB: intent.assetIdB,
          requestedSize: size,
          reason: 'invalid asset ids',
        },
      ]
    }
    if (size <= 0) return []

    if (this.dryRun) {
      // Dry-run: treat as successful merge for strategy wiring tests.
      return [
        {
          kind: 'positions_merged',
          tsMs: nowMs,
          assetIdA: intent.assetIdA,
          assetIdB: intent.assetIdB,
          size,
          ...(intent.reason ? { reason: intent.reason } : {}),
        },
      ]
    }

    const res = await this.execution.mergePositions(intent, ctx)
    return res.events
  }

  private async handlePlaceLimit(
    intent: PlaceLimitIntent,
    ctx: OrderManagerContext,
  ): Promise<AccountEvent[]> {
    // Dedupe by clientOrderId.
    if (this.activeClientOrders.has(intent.clientOrderId)) return []
    this.activeClientOrders.add(intent.clientOrderId)

    const nowMs = ctx.nowMs
    const err = this.validatePlaceLimit(intent, nowMs)
    if (err) {
      this.activeClientOrders.delete(intent.clientOrderId)
      return [
        {
          kind: 'order_rejected',
          tsMs: nowMs,
          clientOrderId: intent.clientOrderId,
          reason: err,
        },
      ]
    }

    const submitted: OpenOrder = {
      clientOrderId: intent.clientOrderId,
      ...(ctx.lastMarket?.market ? { market: ctx.lastMarket.market } : {}),
      assetId: intent.assetId,
      side: intent.side,
      price: intent.price,
      size: intent.size,
      remaining: intent.size,
      filled: 0,
      orderType: intent.orderType,
      ...(intent.meta ? { meta: intent.meta } : {}),
      ...(intent.orderType === 'GTD' ? { expireAtMs: intent.expireAtMs } : {}),
      state: 'requested',
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    }

    const events: AccountEvent[] = [{ kind: 'order_submitted', tsMs: nowMs, order: submitted }]

    if (this.dryRun) {
      // In dry-run, we simulate acceptance so strategies can observe lifecycle without sending orders.
      events.push({
        kind: 'order_accepted',
        tsMs: nowMs,
        clientOrderId: intent.clientOrderId,
      })
      events.push({
        kind: 'order_open',
        tsMs: nowMs,
        clientOrderId: intent.clientOrderId,
      })
      return events
    }

    const res = await this.execution.placeLimit(intent, ctx)
    events.push(...res.events)

    // If the order was immediately finalized (e.g. FOK killed/filled), allow re-use of clientOrderId.
    for (const ev of res.events) {
      if (ev.kind === 'order_rejected' && ev.clientOrderId === intent.clientOrderId) {
        this.activeClientOrders.delete(intent.clientOrderId)
      }
      if (ev.kind === 'order_done' && ev.clientOrderId === intent.clientOrderId) {
        this.activeClientOrders.delete(intent.clientOrderId)
      }
    }
    return events
  }

  private async handleCancelOrder(
    intent: CancelOrderIntent,
    ctx: OrderManagerContext,
  ): Promise<AccountEvent[]> {
    if (this.dryRun) {
      if (!intent.clientOrderId) return []
      this.activeClientOrders.delete(intent.clientOrderId)
      return [
        {
          kind: 'order_done',
          tsMs: ctx.nowMs,
          clientOrderId: intent.clientOrderId,
          ...(intent.orderId ? { orderId: intent.orderId } : {}),
          reason: 'canceled',
        },
      ]
    }
    const res = await this.execution.cancelOrder(intent, ctx)
    // Best-effort: if we know the clientOrderId, mark it inactive once cancel requested.
    if (intent.clientOrderId) this.activeClientOrders.delete(intent.clientOrderId)
    return res.events
  }

  private async handleCancelAll(
    intent: CancelAllIntent,
    ctx: OrderManagerContext,
  ): Promise<AccountEvent[]> {
    if (this.dryRun) {
      // We don't have the list of orders here; the Portfolio will still reflect whatever was simulated.
      this.activeClientOrders.clear()
      return []
    }
    const res = await this.execution.cancelAll(intent, ctx)
    this.activeClientOrders.clear()
    return res.events
  }

  private async handlePlaceBatch(
    intent: PlaceBatchIntent,
    ctx: OrderManagerContext,
  ): Promise<AccountEvent[]> {
    const nowMs = ctx.nowMs
    const events: AccountEvent[] = []

    if (!intent.orders || intent.orders.length === 0) {
      return events
    }

    // Validate all orders first and create order_submitted events
    const validOrders: Array<{ order: PlaceBatchIntent['orders'][number]; submitted: OpenOrder }> =
      []

    for (const order of intent.orders) {
      // Dedupe by clientOrderId
      if (this.activeClientOrders.has(order.clientOrderId)) {
        events.push({
          kind: 'order_rejected',
          tsMs: nowMs,
          clientOrderId: order.clientOrderId,
          reason: 'duplicate_clientOrderId',
        })
        continue
      }

      const err = this.validatePlaceLimitOrder(order, nowMs)
      if (err) {
        events.push({
          kind: 'order_rejected',
          tsMs: nowMs,
          clientOrderId: order.clientOrderId,
          reason: err,
        })
        continue
      }

      this.activeClientOrders.add(order.clientOrderId)

      const submitted: OpenOrder = {
        clientOrderId: order.clientOrderId,
        ...(ctx.lastMarket?.market ? { market: ctx.lastMarket.market } : {}),
        assetId: order.assetId,
        side: order.side,
        price: order.price,
        size: order.size,
        remaining: order.size,
        filled: 0,
        orderType: order.orderType,
        ...(order.meta ? { meta: order.meta } : {}),
        ...(order.orderType === 'GTD' ? { expireAtMs: order.expireAtMs } : {}),
        state: 'requested',
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      }

      events.push({ kind: 'order_submitted', tsMs: nowMs, order: submitted })
      validOrders.push({ order, submitted })
    }

    if (validOrders.length === 0) {
      return events
    }

    if (this.dryRun) {
      // In dry-run, simulate acceptance for all valid orders
      for (const { order } of validOrders) {
        events.push({
          kind: 'order_accepted',
          tsMs: nowMs,
          clientOrderId: order.clientOrderId,
        })
        events.push({
          kind: 'order_open',
          tsMs: nowMs,
          clientOrderId: order.clientOrderId,
        })
      }
      return events
    }

    // Execute batch via execution adapter
    const batchIntent: PlaceBatchIntent = {
      kind: 'place_batch',
      orders: validOrders.map(({ order }) => order),
      ...(typeof intent.reason === 'string' ? { reason: intent.reason } : {}),
    }

    const res = await this.execution.placeBatch(batchIntent, ctx)
    events.push(...res.events)

    // Clean up clientOrderIds for rejected/done orders
    for (const ev of res.events) {
      if (ev.kind === 'order_rejected' && ev.clientOrderId) {
        this.activeClientOrders.delete(ev.clientOrderId)
      }
      if (ev.kind === 'order_done' && ev.clientOrderId) {
        this.activeClientOrders.delete(ev.clientOrderId)
      }
    }

    return events
  }

  private validatePlaceLimit(intent: PlaceLimitIntent, nowMs: number): string | null {
    return this.validatePlaceLimitOrder(intent, nowMs)
  }

  private validatePlaceLimitOrder(
    intent: PlaceLimitIntent | PlaceBatchIntent['orders'][number],
    nowMs: number,
  ): string | null {
    if (!Number.isFinite(intent.price) || intent.price <= 0) return 'invalid_price'
    if (!Number.isFinite(intent.size) || intent.size <= 0) return 'invalid_size'
    if (!intent.assetId) return 'missing_assetId'

    if (intent.orderType === 'GTD') {
      if (intent.expireAtMs === undefined) return 'gtd_requires_expireAtMs'
      if (!Number.isFinite(intent.expireAtMs)) return 'invalid_expireAtMs'
      if (intent.expireAtMs < nowMs + this.minGtdOffsetMs)
        return `gtd_expireAtMs_too_soon(min_offset_ms=${this.minGtdOffsetMs})`
    }
    if (intent.orderType !== 'GTD' && intent.expireAtMs !== undefined) {
      this.log?.('[orderManager] ignoring expireAtMs for non-GTD orderType', {
        clientOrderId: 'clientOrderId' in intent ? intent.clientOrderId : 'unknown',
        orderType: intent.orderType as OrderType,
      })
    }
    return null
  }
}
