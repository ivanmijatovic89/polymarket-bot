import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../strategy/Strategy.js'
import type { StrategyDefinition } from '../strategy/strategyDefinition.js'
import * as z from 'zod'

const assetIdPairSchema = z
  .tuple([z.string().min(1), z.string().min(1)])
  .refine(([a, b]) => a !== b, { message: 'assetIds must contain 2 distinct strings' })

const jsonString = <T>(inner: z.ZodType<T>) =>
  z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        ctx.addIssue({ code: 'custom', message: `invalid json: ${msg}` })
        return z.NEVER
      }
    })
    .pipe(inner)

export const ConfigSchema = z.strictObject({
  assetIds: jsonString(assetIdPairSchema).optional(),
  size: z.coerce.number().finite().default(5),
  triggerPrice: z.coerce.number().finite().min(0).max(1).default(0.9),
  limitPrice: z.coerce.number().finite().min(0).max(1).optional(),
  minDelayMs: z.coerce.number().finite().int().nonnegative().default(600_000),
  debug: z.coerce.boolean().default(false),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'winnerLimit.v1',
  title: 'Winner limit v1',
  description: 'After a delay, buys the outcome with higher probability above a trigger price.',
  schema: ConfigSchema,
  create: (params) => ({ strategy: createStrategy(params) }),
}

function finiteOr(v: number | null | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0
  return Math.max(0, Math.min(1, p))
}

function pickTwoAssetIds(tick: MarketTick, preferred?: [string, string]): [string, string] | null {
  if (
    preferred &&
    tick.snapshot.byAssetId[preferred[0]] &&
    tick.snapshot.byAssetId[preferred[1]] &&
    preferred[0] !== preferred[1]
  ) {
    return preferred
  }

  const ids = Object.keys(tick.snapshot.byAssetId).sort()
  if (ids.length < 2) return null
  const a = ids[0]
  const b = ids[1]
  if (!a || !b || a === b) return null
  return [a, b]
}

function bookProbability(book: {
  mid: number | null
  bestBid: number | null
  bestAsk: number | null
}): number | null {
  if (typeof book.mid === 'number' && Number.isFinite(book.mid)) return clamp01(book.mid)

  const bid =
    typeof book.bestBid === 'number' && Number.isFinite(book.bestBid) ? book.bestBid : null
  const ask =
    typeof book.bestAsk === 'number' && Number.isFinite(book.bestAsk) ? book.bestAsk : null
  if (bid !== null && ask !== null) return clamp01((bid + ask) / 2)
  if (ask !== null) return clamp01(ask)
  if (bid !== null) return clamp01(bid)
  return null
}

function posQty(portfolio: PortfolioSnapshot, assetId: string): number {
  const q = portfolio.positionsByAssetId[assetId]?.qty
  return typeof q === 'number' && Number.isFinite(q) ? q : 0
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'winnerLimit'

  const size = Math.max(0, Math.floor(finiteOr(cfg.size, 0)))
  const triggerPrice = clamp01(finiteOr(cfg.triggerPrice, 0.9))
  const limitPrice = clamp01(finiteOr(cfg.limitPrice ?? cfg.triggerPrice, triggerPrice))
  const minDelayMs = Math.max(0, Math.floor(finiteOr(cfg.minDelayMs, 10 * 60 * 1000)))

  const log = (msg: string, extra?: unknown): void => {
    if (!cfg.debug) return
    if (extra === undefined) console.log(`[${name}] ${msg}`)
    else console.log(`[${name}] ${msg}`, extra)
  }

  // One-shot state (single BUY order total).
  let startedAtMs: number | null = null
  const crossedAbove = new Set<string>()
  let didPlaceOrder = false
  const clientOrderId = `${name}:buy`

  const onMarketTick = (tick: MarketTick, portfolio: PortfolioSnapshot): Intent[] => {
    if (didPlaceOrder) return []
    if (size <= 0) return []

    const ids = pickTwoAssetIds(tick, cfg.assetIds)
    if (!ids) return []
    const [assetA, assetB] = ids

    // If we already have a position (or our order is open), do nothing.
    if (posQty(portfolio, assetA) > 0 || posQty(portfolio, assetB) > 0) return []
    if (portfolio.openOrdersByClientId[clientOrderId]) return []

    const nowMs = tick.snapshot.timestamp || Date.now()
    if (startedAtMs === null) startedAtMs = nowMs
    if (nowMs - startedAtMs < minDelayMs) return []

    const bookA = tick.snapshot.byAssetId[assetA]
    const bookB = tick.snapshot.byAssetId[assetB]
    if (!bookA || !bookB) return []

    const pA = bookProbability(bookA)
    const pB = bookProbability(bookB)
    if (pA === null || pB === null) return []

    // Record crossing state (crossing can happen on the same tick as the order).
    if (pA > triggerPrice) crossedAbove.add(assetA)
    if (pB > triggerPrice) crossedAbove.add(assetB)

    // Only act when at least one token is currently above trigger.
    if (pA <= triggerPrice && pB <= triggerPrice) return []

    const winnerAssetId = pA >= pB ? assetA : assetB
    const winnerP = pA >= pB ? pA : pB
    if (winnerP <= triggerPrice) return []
    if (!crossedAbove.has(winnerAssetId)) return []

    didPlaceOrder = true
    log('placing_buy_limit', {
      market: tick.snapshot.market,
      winnerAssetId,
      winnerP,
      triggerPrice,
      limitPrice,
      size,
    })

    return [
      {
        kind: 'place_limit',
        clientOrderId,
        assetId: winnerAssetId,
        side: 'BUY',
        price: limitPrice,
        size,
        orderType: 'GTC',
        reason: `winnerLimit: pA=${pA.toFixed(4)} pB=${pB.toFixed(4)} winner=${winnerAssetId} trigger=${triggerPrice.toFixed(
          4,
        )} limit=${limitPrice.toFixed(4)} delayMs=${minDelayMs}`,
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev) => {
    // Make one-shot behavior robust even if strategy state is re-entered via cascades.
    if (ev.kind === 'order_submitted' && ev.order.clientOrderId === clientOrderId)
      didPlaceOrder = true
    if (ev.kind === 'fill' && ev.fill.clientOrderId === clientOrderId) didPlaceOrder = true
    if (ev.kind === 'order_accepted' && ev.clientOrderId === clientOrderId) didPlaceOrder = true
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
