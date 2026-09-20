import type { OrderBookSnapshot } from '../../market/orderbook/types.js'
import type {
  AccountEvent,
  Fill,
  Intent,
  PlaceLimitIntent,
  PortfolioSnapshot,
  Strategy,
} from '../../strategy/Strategy.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import { isWarmed } from '../../strategy/strategyToolkit.js'
import { computePolymarketTakerFee, POLYMARKET_CRYPTO_TAKER_FEE_BPS } from '../../trading/fees.js'
import {
  ConfigSchema,
  floorShares,
  generateLadder,
  opposite,
  repairFraction,
  repairTarget,
} from './config.js'
import type { Config, Execution, Outcome, Variant } from './config.js'

type Level = ReturnType<typeof generateLadder>[number] & { filled: Record<Outcome, number> }
type Order = {
  id: string
  state: State
  side: Outcome
  kind: 'normal' | 'repair'
  level: Level | null
  size: number
  price: number
  filled: number
  matched: number
  terminal: boolean
  orderId?: string
  createdAt: number
  cancelAt: number | null
  execution: Execution
}
type State = {
  market: string
  slug: string
  assets: Record<Outcome, string>
  direction: Outcome | null
  levels: Level[]
  peak: Record<Outcome, number>
  normal: Record<Outcome, number>
  repairs: Record<Outcome, number>
  cost: Record<Outcome, number>
  fees: number
  orders: Order[]
  sequence: number
  nextAttempt: number
  lastDecision: Record<string, unknown>
}
const zeroSides = (): Record<Outcome, number> => ({ UP: 0, DOWN: 0 })
const quantity = (s: State, side: Outcome) => s.normal[side] + s.repairs[side]
const pending = (o: Order) => Math.max(0, (o.terminal ? o.matched : o.size) - o.filled)

function inventory(s: State) {
  const upShares = quantity(s, 'UP')
  const downShares = quantity(s, 'DOWN')
  const totalSpent = s.cost.UP + s.cost.DOWN + s.fees
  return {
    upShares,
    downShares,
    upCost: s.cost.UP,
    downCost: s.cost.DOWN,
    upAverage: upShares ? s.cost.UP / upShares : null,
    downAverage: downShares ? s.cost.DOWN / downShares : null,
    fees: s.fees,
    totalSpent,
    imbalance: upShares - downShares,
    minimumPayout: Math.min(upShares, downShares),
    pnlIfUp: upShares - totalSpent,
    pnlIfDown: downShares - totalSpent,
    peakUp: s.peak.UP,
    peakDown: s.peak.DOWN,
    repairedUp: s.repairs.UP,
    repairedDown: s.repairs.DOWN,
  }
}

function bookUsable(
  book: OrderBookSnapshot | undefined,
  now: number,
  cfg: Config,
): book is OrderBookSnapshot & { bestBid: number; bestAsk: number; mid: number } {
  return (
    !!book &&
    book.bestBid !== null &&
    book.bestAsk !== null &&
    book.mid !== null &&
    book.bestBid > 0 &&
    book.bestAsk < 1 &&
    book.bestAsk >= book.bestBid &&
    book.bestAsk - book.bestBid <= cfg.maxSpread + 1e-8 &&
    now >= book.timestamp &&
    now - book.timestamp <= cfg.maxBookAgeMs
  )
}

export function makeDefinition(variant: Variant): StrategyDefinition<Config> {
  return {
    id: variant.id,
    title: variant.title,
    description: 'Cross-level inventory held to settlement with cumulative pullback repair.',
    schema: ConfigSchema,
    create: (cfg) => ({ strategy: createPairStrategy(cfg, variant) }),
  }
}

export function createPairStrategy(cfg: Config, variant: Variant): Strategy {
  const states = new Map<string, State>()
  const orders = new Map<string, Order>()
  const exchangeOrders = new Map<string, Order>()
  const fills = new Set<string>()
  // A fill may precede its exchange acknowledgement and carry no client id.
  const orphanFills = new Map<string, Fill>()

  function log(s: State, event: string, details: Record<string, unknown>) {
    if (cfg.logMode === 'fills')
      console.log(
        '[pair]',
        JSON.stringify({
          strategy: variant.id,
          market: s.slug,
          event,
          ...inventory(s),
          ...s.lastDecision,
          // Decision targets describe the latest market tick; actual fills are current.
          actualCumulativeRepair:
            s.lastDecision.overweight === 'UP'
              ? s.repairs.DOWN
              : s.lastDecision.overweight === 'DOWN'
                ? s.repairs.UP
                : 0,
          ...details,
        }),
      )
  }

  function applyFill(fill: Fill, order: Order) {
    if (
      fills.has(fill.id) ||
      fill.side !== 'BUY' ||
      fill.assetId !== order.state.assets[order.side]
    )
      return
    fills.add(fill.id)
    orphanFills.delete(fill.id)
    const s = order.state
    order.filled += fill.size
    order.matched = Math.max(order.matched, order.filled)
    if (order.filled + 1e-8 >= order.size) order.terminal = true
    if (order.level) order.level.filled[order.side] += fill.size
    s[order.kind === 'normal' ? 'normal' : 'repairs'][order.side] += fill.size
    s.cost[order.side] += fill.price * fill.size
    if (fill.liquidity === 'TAKER')
      s.fees += computePolymarketTakerFee({
        price: fill.price,
        size: fill.size,
        feeRateBps: fill.feeRateBps ?? 0,
      })
    log(s, `${order.kind}_fill`, {
      fillId: fill.id,
      side: order.side,
      price: fill.price,
      size: fill.size,
      level: order.level?.price ?? null,
    })
  }

  function reconcile(portfolio: PortfolioSnapshot) {
    for (const order of orders.values()) {
      const snapshot = portfolio.ordersByClientId[order.id]
      if (!snapshot) continue
      order.matched = Math.max(order.matched, snapshot.sizeMatched ?? 0)
      if (snapshot.orderId) {
        order.orderId = snapshot.orderId
        exchangeOrders.set(snapshot.orderId, order)
      }
      if (
        snapshot.lifecycleState &&
        ['filled', 'canceled', 'rejected', 'expired', 'killed'].includes(snapshot.lifecycleState)
      ) {
        order.terminal = true
        if (snapshot.lifecycleState === 'filled') order.matched = order.size
      }
    }
    for (const fill of orphanFills.values()) {
      const order = fill.orderId ? exchangeOrders.get(fill.orderId) : undefined
      if (order) applyFill(fill, order)
    }
  }

  function place(
    s: State,
    side: Outcome,
    desired: number,
    kind: Order['kind'],
    level: Level | null,
    execution: Execution,
    book: OrderBookSnapshot & { bestBid: number; bestAsk: number },
    now: number,
  ): PlaceLimitIntent | null {
    const rawPrice = execution === 'taker' ? book.bestAsk : book.bestBid
    const price = Number(
      (
        (execution === 'taker'
          ? Math.ceil(rawPrice / cfg.orderPriceStep - 1e-8)
          : Math.floor(rawPrice / cfg.orderPriceStep + 1e-8)) * cfg.orderPriceStep
      ).toFixed(6),
    )
    if (price <= 0 || price >= 1 || (execution === 'maker' && price >= book.bestAsk)) return null
    const depth =
      execution === 'taker'
        ? book.asks.reduce((sum, row) => sum + (row.price <= price + 1e-8 ? row.size : 0), 0)
        : Infinity
    // p(1-p) <= 1/4: reserve the worst fee at any improved execution price.
    const feePerShare = POLYMARKET_CRYPTO_TAKER_FEE_BPS / 10000 / 4
    const reserved = s.orders.reduce(
      (sum, order) => sum + pending(order) * (order.price + feePerShare),
      0,
    )
    const available = Math.max(
      0,
      cfg.maxCapital - s.cost.UP - s.cost.DOWN - s.fees - reserved - 0.01,
    )
    const size = floorShares(Math.min(desired, depth, available / (price + feePerShare)))
    if (size < cfg.minOrderSize || price * size + 1e-8 < cfg.minOrderNotional) return null
    const id = `${variant.id}:${s.market}:${kind}:${level?.index ?? side}:${side}:${s.sequence++}`
    const order: Order = {
      id,
      state: s,
      side,
      kind,
      level,
      size,
      price,
      filled: 0,
      matched: 0,
      terminal: false,
      createdAt: now,
      cancelAt: null,
      execution,
    }
    orders.set(id, order)
    s.orders.push(order)
    return {
      kind: 'place_limit',
      clientOrderId: id,
      assetId: s.assets[side],
      side: 'BUY',
      price,
      size,
      orderType: execution === 'taker' ? 'FOK' : 'GTC',
      ...(execution === 'maker' ? { postOnly: true } : {}),
      reason: `pair_${kind}_${execution}`,
      meta: {
        pair: {
          kind,
          side,
          level: level?.price ?? null,
          direction: s.direction,
          target: level ? (side === s.direction ? level.directional : level.opposite) : null,
          ...inventory(s),
          ...s.lastDecision,
        },
      },
    }
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev: AccountEvent, portfolio) => {
    reconcile(portfolio)
    if (ev.kind === 'order_accepted') {
      const order = orders.get(ev.clientOrderId)
      if (order && ev.orderId) {
        order.orderId = ev.orderId
        exchangeOrders.set(ev.orderId, order)
      }
      reconcile(portfolio)
    } else if (ev.kind === 'fill') {
      const order =
        (ev.fill.clientOrderId ? orders.get(ev.fill.clientOrderId) : undefined) ??
        (ev.fill.orderId ? exchangeOrders.get(ev.fill.orderId) : undefined)
      if (order) applyFill(ev.fill, order)
      else if (ev.fill.orderId && !fills.has(ev.fill.id)) orphanFills.set(ev.fill.id, ev.fill)
    } else if (ev.kind === 'ws_order_update') {
      const order = exchangeOrders.get(ev.order.orderId)
      if (order) {
        order.matched = Math.max(order.matched, ev.order.sizeMatched ?? 0)
        if (
          ev.order.event === 'CANCELLATION' ||
          ev.order.status === 'CANCELED' ||
          order.matched >= order.size
        )
          order.terminal = true
      }
    } else if (ev.kind === 'order_done' || ev.kind === 'order_rejected') {
      const order =
        (ev.clientOrderId ? orders.get(ev.clientOrderId) : undefined) ??
        ('orderId' in ev && ev.orderId ? exchangeOrders.get(ev.orderId) : undefined)
      if (order) {
        order.terminal = true
        if (ev.kind === 'order_done' && ev.reason === 'filled') order.matched = order.size
        if (ev.kind === 'order_rejected')
          log(order.state, 'order_rejected', { reason: ev.reason, clientOrderId: order.id })
      }
    } else if (ev.kind === 'cancel_failed') {
      const order = ev.clientOrderId ? orders.get(ev.clientOrderId) : undefined
      if (order) order.cancelAt = null
    }
    return []
  }

  const onMarketTick: Strategy['onMarketTick'] = (tick, portfolio, ctx) => {
    if (tick.msg.event_type !== 'book' && tick.msg.event_type !== 'price_change') return []
    const now = tick.snapshot.timestamp
    const upId = ctx?.market?.upAssetId
    const downId = ctx?.market?.downAssetId
    if (!upId || !downId || !Number.isFinite(now)) return []
    reconcile(portfolio)
    let s = states.get(tick.snapshot.market)
    if (!s) {
      s = {
        market: tick.snapshot.market,
        slug: ctx?.market?.slug ?? tick.snapshot.market,
        assets: { UP: upId, DOWN: downId },
        direction: null,
        levels: generateLadder(cfg).map((level) => ({ ...level, filled: zeroSides() })),
        peak: zeroSides(),
        normal: zeroSides(),
        repairs: zeroSides(),
        cost: zeroSides(),
        fees: 0,
        orders: [],
        sequence: 0,
        nextAttempt: 0,
        lastDecision: {},
      }
      states.set(s.market, s)
    }
    const up = tick.snapshot.byAssetId[upId]
    const down = tick.snapshot.byAssetId[downId]
    const usable = bookUsable(up, now, cfg) && bookUsable(down, now, cfg)
    let level: Level | undefined
    let repair: { missing: Outcome; additional: number } | undefined
    if (usable) {
      const prices = { UP: up.mid, DOWN: down.mid }
      // First qualifying side owns this market's one ladder. UP/DOWN are symmetric.
      if (s.direction === null) {
        const candidate: Outcome = prices.UP >= prices.DOWN ? 'UP' : 'DOWN'
        if (
          prices[candidate] + 1e-8 >= cfg.rangeStart &&
          prices[candidate] < cfg.rangeEnd + cfg.priceStep - 1e-8
        )
          s.direction = candidate
      }
      for (const side of ['UP', 'DOWN'] as const)
        s.peak[side] = Math.max(s.peak[side], prices[side])
      if (s.direction) {
        const index = Math.floor((prices[s.direction] - cfg.rangeStart + 1e-8) / cfg.priceStep)
        level = s.levels[index]
      }
      // Keep the original orientation: repairs must not start a reverse cycle.
      const overweight: Outcome = s.direction ?? 'UP'
      const pullback = Math.max(0, s.peak[overweight] - prices[overweight])
      const target = repairTarget(
        s.normal,
        s.repairs,
        overweight,
        repairFraction(pullback, variant),
      )
      s.lastDecision = {
        overweight,
        directionalPeak: s.peak[overweight],
        pullback,
        repairBaseline: target.baseline,
        desiredCumulativeRepair: target.desired,
        actualCumulativeRepair: target.actual,
      }
      repair = { missing: opposite(overweight), additional: target.additional }
    }
    // Never release reservations on a cancellation request. Wait for account events.
    const cancels: Intent[] = []
    for (const order of s.orders) {
      if (order.terminal || order.execution !== 'maker' || !order.orderId) continue
      const invalid =
        !usable ||
        (order.kind === 'normal'
          ? order.level !== level
          : !repair || order.side !== repair.missing || pending(order) > repair.additional + 1e-8)
      if (
        (invalid || now - order.createdAt >= cfg.quoteLifetimeMs) &&
        (order.cancelAt === null || now - order.cancelAt >= cfg.retryMs)
      ) {
        order.cancelAt = now
        cancels.push({
          kind: 'cancel_order',
          clientOrderId: order.id,
          reason: 'pair_quote_expired_or_target_changed',
        })
      }
    }
    if (cancels.length) return cancels
    // Serialize allocations, including delayed fills reported after order_done.
    if (
      !usable ||
      !isWarmed(ctx) ||
      now < s.nextAttempt ||
      s.orders.some((order) => pending(order) > 1e-8)
    )
      return []
    const books = { UP: up, DOWN: down }
    if (repair && repair.additional >= cfg.minOrderSize) {
      const order = place(
        s,
        repair.missing,
        Math.min(repair.additional, variant.repairChunk ?? Infinity),
        'repair',
        null,
        variant.repairExecution,
        books[repair.missing],
        now,
      )
      s.nextAttempt = now + cfg.retryMs
      if (order) return [order]
    }
    if (!level || !s.direction) return []
    const intents: Intent[] = []
    for (const side of [s.direction, opposite(s.direction)]) {
      const target = side === s.direction ? level.directional : level.opposite
      const order = place(
        s,
        side,
        Math.max(0, target - level.filled[side]),
        'normal',
        level,
        variant.normalExecution,
        books[side],
        now,
      )
      if (order) intents.push(order)
    }
    if (intents.length) s.nextAttempt = now + cfg.retryMs
    return intents
  }
  return { name: variant.id, onMarketTick, onAccountEvent }
}
