import type { Intent, MarketTick, PortfolioSnapshot, Strategy } from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import { parseGammaMarketStartMs, safeProbabilityPrice } from '../../strategy/strategyToolkit.js'
import type { OrderBookSnapshot } from '../../market/orderbook/types.js'
import * as z from 'zod'

/**
 * SpreadFadeScan.v1 — mirror of EdgeScan that BUYS DOWN (= fades UP), to measure the REAL net P&L
 * of the spread signal. EdgeScan (always-buy-UP) found UP is overpriced when its spread is wide
 * (residual win%-mid is consistently negative, replicating train+test). To trade that you buy DOWN.
 * This records `upSpread` + the surviving-combo features per market and holds DOWN to resolution, so
 * post-hoc we gate by upSpread and read whether fading wide-spread UP is net-positive after real cost.
 *
 * Each market is sampled at a different time-in-window (hash of the id) for full timeline coverage.
 * Order-book only; no external feeds.
 */

export const ConfigSchema = z.strictObject({
  minSampleSec: z.coerce.number().finite().min(5).max(890).default(30),
  maxSampleSec: z.coerce.number().finite().min(10).max(895).default(840),
  lookbackSec: z.coerce.number().finite().min(10).max(600).default(120),
  size: z.coerce.number().finite().positive().max(10000).default(25),
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'SpreadFadeScan.v1',
  title: 'Spread Fade Scan v1',
  description:
    'Samples each market across the window, buys DOWN (fades UP), records upSpread + features, holds ' +
    'to resolution — to measure the real net P&L of the wide-spread mispricing, gated post-hoc.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

const WINDOW_MS = 15 * 60 * 1000

type StrategyState = {
  marketId: string
  upAssetId: string
  downAssetId: string
  targetSecondsLeft: number
  done: boolean
  history: Array<{ ms: number; upMid: number }>
} | null

function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

function resolveUpDownAssetIds(
  tick: MarketTick,
  ctx?: StrategyContext,
): { upAssetId: string; downAssetId: string } | null {
  const up = ctx?.market?.upAssetId
  const down = ctx?.market?.downAssetId
  if (typeof up === 'string' && up && typeof down === 'string' && down && up !== down) {
    return { upAssetId: up, downAssetId: down }
  }
  const ids = Object.keys(tick.snapshot.byAssetId).sort()
  if (ids.length < 2) return null
  const upAssetId = ids[0]
  const downAssetId = ids[1]
  if (!upAssetId || !downAssetId || upAssetId === downAssetId) return null
  return { upAssetId, downAssetId }
}

function bookOf(tick: MarketTick, assetId: string): OrderBookSnapshot | undefined {
  return tick.snapshot.byAssetId[assetId]
}
function midOf(b: OrderBookSnapshot | undefined): number | null {
  if (!b) return null
  return typeof b.mid === 'number' && Number.isFinite(b.mid) ? b.mid : null
}
function secondsLeftOf(nowMs: number, ctx?: StrategyContext): number | null {
  const startMs = parseGammaMarketStartMs(ctx?.market)
  if (startMs === null || !Number.isFinite(nowMs)) return null
  return (startMs + WINDOW_MS - nowMs) / 1000
}
function stdOf(xs: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / n
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / n)
}
function round(x: number, d = 6): number {
  const f = 10 ** d
  return Math.round(x * f) / f
}
function spreadOf(b: OrderBookSnapshot | undefined): number | null {
  if (!b) return null
  if (typeof b.bestAsk === 'number' && typeof b.bestBid === 'number') return b.bestAsk - b.bestBid
  return null
}
function cumDepth(arr: number[] | undefined, n: number): number {
  if (!arr || arr.length === 0) return 0
  const v = arr[Math.min(n, arr.length) - 1]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
function imb(book: OrderBookSnapshot | undefined, n: number): number {
  if (!book) return 0
  const b = cumDepth(book.bidsDepthByLevel, n)
  const a = cumDepth(book.asksDepthByLevel, n)
  return b + a > 0 ? (b - a) / (b + a) : 0
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'SpreadFadeScan.v1'
  let state: StrategyState = null

  const onMarketTick = (
    tick: MarketTick,
    _p: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _p
    const marketId = tick.snapshot.market ?? 'unknown_market'
    const nowMs = tick.snapshot.timestamp || Date.now()
    if (state && state.marketId !== marketId) state = null
    if (!state) {
      const ids = resolveUpDownAssetIds(tick, ctx)
      if (!ids) return []
      const target = cfg.minSampleSec + hash01(marketId) * (cfg.maxSampleSec - cfg.minSampleSec)
      state = {
        marketId,
        upAssetId: ids.upAssetId,
        downAssetId: ids.downAssetId,
        targetSecondsLeft: target,
        done: false,
        history: [],
      }
    }

    const upMidNow = midOf(bookOf(tick, state.upAssetId))
    if (upMidNow !== null) {
      state.history.push({ ms: nowMs, upMid: upMidNow })
      const cutoff = nowMs - cfg.lookbackSec * 1000
      while (state.history.length > 0 && (state.history[0]?.ms ?? 0) < cutoff) state.history.shift()
    }

    if (state.done) return []
    const secondsLeft = secondsLeftOf(nowMs, ctx)
    if (secondsLeft === null) return []
    if (secondsLeft > state.targetSecondsLeft) return []

    const upBook = bookOf(tick, state.upAssetId)
    const downBook = bookOf(tick, state.downAssetId)
    const upMid = midOf(upBook)
    const downMid = midOf(downBook)
    const downAsk = downBook?.bestAsk
    if (upMid === null || downMid === null) return []
    if (typeof downAsk !== 'number' || !Number.isFinite(downAsk)) return []

    state.done = true
    const w60 = state.history.filter((h) => h.ms >= nowMs - 60_000).map((h) => h.upMid)
    const drift60 = w60.length >= 2 ? (w60[w60.length - 1] as number) - (w60[0] as number) : 0
    const d = new Date(nowMs)

    return [
      {
        kind: 'place_limit',
        clientOrderId: `${name}:${marketId}:${nowMs}`,
        assetId: state.downAssetId,
        side: 'BUY',
        price: safeProbabilityPrice(downAsk + cfg.slippage),
        size: cfg.size,
        orderType: 'FOK',
        reason: 'spread_fade_buy_down',
        meta: {
          secondsLeft: Math.round(secondsLeft),
          upMid: round(upMid),
          downMid: round(downMid),
          downEntry: round(downAsk + cfg.slippage),
          upSpread: round(spreadOf(upBook) ?? 0),
          downSpread: round(spreadOf(downBook) ?? 0),
          upImb3: round(imb(upBook, 3)),
          vol60: round(stdOf(w60)),
          drift60: round(drift60),
          hour: d.getUTCHours(),
        },
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (): Intent[] => []

  return { name, onMarketTick, onAccountEvent }
}
