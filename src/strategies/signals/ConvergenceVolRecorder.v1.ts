import type {
  AccountEvent,
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../../strategy/Strategy.js'
import type { StrategyContext } from '../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../strategy/strategyDefinition.js'
import { parseGammaMarketStartMs, safeProbabilityPrice } from '../../strategy/strategyToolkit.js'
import type { OrderBookSnapshot } from '../../market/orderbook/types.js'
import * as z from 'zod'

/**
 * ConvergenceVolRecorder.v1 — feature recorder for late-window-calibration hypotheses.
 *
 * The expensive part of a backtest is replaying ~18k markets; computing features is free.
 * So this strategy does the replay ONCE and records a RICH set of per-market entry-time
 * features into the order meta, so that MANY gate hypotheses (vol, spread, liquidity,
 * momentum, lead-size, book-imbalance, time-of-day…) can later be tested purely as
 * post-hoc analysis on this single run — no re-running.
 *
 * It does NOT gate. It always buys the late-window FAVORITE and holds to resolution, so
 * each market's row carries: favorite price, outcome (pnl sign), and the recorded features.
 *
 * Recorded per market (intentMeta):
 *   favMid, favEntry, secondsLeft           — the trade
 *   volStd30/60/120, volRange60             — recent realized vol (std of UP mid, 3 windows)
 *   drift60                                  — signed recent move of UP mid (momentum)
 *   lead                                     — favMid - 0.5 (how strong the favorite is)
 *   favSpread, favBidL1, favAskL1            — top-of-book liquidity of the favorite
 *   favDepth3Bid, favDepth3Ask, favImb3      — depth + imbalance over top 3 levels
 *   nSamples                                 — tick activity in the lookback
 *
 * Order-book only; no external feeds.
 */

export const ConfigSchema = z.strictObject({
  favoriteThreshold: z.coerce.number().finite().min(0.5).max(0.98).default(0.55),
  maxPrice: z.coerce.number().finite().min(0.6).max(0.999).default(0.97),
  entryWindowSec: z.coerce.number().finite().min(10).max(600).default(120),
  minEntrySec: z.coerce.number().finite().min(2).max(300).default(15),
  /** History buffer length (seconds) used to derive recent-vol / drift features. */
  lookbackSec: z.coerce.number().finite().min(10).max(600).default(180),
  size: z.coerce.number().finite().positive().max(10000).default(25),
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'ConvergenceVolRecorder.v1',
  title: 'Convergence Vol Recorder v1',
  description:
    'Diagnostic: always buys the late-window favorite (hold to resolution) and records a rich set ' +
    'of entry-time features per market, so many gate hypotheses can be tested post-hoc from one run.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

const WINDOW_MS = 15 * 60 * 1000

type Stage = 'scan' | 'held' | 'done'

type StrategyState = {
  marketId: string
  upAssetId: string
  downAssetId: string
  stage: Stage
  entryClientOrderId: string | null
  history: Array<{ ms: number; upMid: number }>
} | null

function resolveUpDownAssetIds(
  tick: MarketTick,
  ctx?: StrategyContext,
): { upAssetId: string; downAssetId: string } | null {
  const upFromMeta = ctx?.market?.upAssetId
  const downFromMeta = ctx?.market?.downAssetId
  if (
    typeof upFromMeta === 'string' &&
    upFromMeta.length > 0 &&
    typeof downFromMeta === 'string' &&
    downFromMeta.length > 0 &&
    upFromMeta !== downFromMeta
  ) {
    return { upAssetId: upFromMeta, downAssetId: downFromMeta }
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

function midOf(book: OrderBookSnapshot | undefined): number | null {
  if (!book) return null
  return typeof book.mid === 'number' && Number.isFinite(book.mid) ? book.mid : null
}

function secondsLeftOf(nowMs: number, ctx?: StrategyContext): number | null {
  const startMs = parseGammaMarketStartMs(ctx?.market)
  if (startMs === null || !Number.isFinite(nowMs)) return null
  return (startMs + WINDOW_MS - nowMs) / 1000
}

function stdOf(xs: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / n
  const v = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n
  return Math.sqrt(v)
}

function round(x: number, d = 6): number {
  const f = 10 ** d
  return Math.round(x * f) / f
}

function cumDepth(arr: number[] | undefined, n: number): number {
  if (!arr || arr.length === 0) return 0
  const i = Math.min(n, arr.length) - 1
  const v = arr[i]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'ConvergenceVolRecorder.v1'
  let state: StrategyState = null

  const onMarketTick = (
    tick: MarketTick,
    _portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    void _portfolio
    const marketId = tick.snapshot.market ?? 'unknown_market'
    const nowMs = tick.snapshot.timestamp || Date.now()

    if (state && state.marketId !== marketId) state = null
    if (!state) {
      const ids = resolveUpDownAssetIds(tick, ctx)
      if (!ids) return []
      state = {
        marketId,
        upAssetId: ids.upAssetId,
        downAssetId: ids.downAssetId,
        stage: 'scan',
        entryClientOrderId: null,
        history: [],
      }
    }

    const upMidNow = midOf(bookOf(tick, state.upAssetId))
    if (upMidNow !== null) {
      state.history.push({ ms: nowMs, upMid: upMidNow })
      const cutoff = nowMs - cfg.lookbackSec * 1000
      while (state.history.length > 0 && (state.history[0]?.ms ?? 0) < cutoff) {
        state.history.shift()
      }
    }

    if (state.stage !== 'scan') return []

    const secondsLeft = secondsLeftOf(nowMs, ctx)
    if (secondsLeft === null) return []
    if (secondsLeft > cfg.entryWindowSec || secondsLeft < cfg.minEntrySec) return []

    const upBook = bookOf(tick, state.upAssetId)
    const downBook = bookOf(tick, state.downAssetId)
    const upMid = midOf(upBook)
    const downMid = midOf(downBook)
    if (upMid === null || downMid === null) return []

    const favIsUp = upMid >= downMid
    const favAssetId = favIsUp ? state.upAssetId : state.downAssetId
    const favMid = favIsUp ? upMid : downMid
    const favBook = favIsUp ? upBook : downBook
    const favAsk = favBook?.bestAsk

    if (favMid < cfg.favoriteThreshold) return []
    if (typeof favAsk !== 'number' || !Number.isFinite(favAsk)) return []
    if (favAsk > cfg.maxPrice) {
      state.stage = 'done'
      return []
    }

    // ── derive entry-time features from history + book ────────────────────
    const win = (sec: number) =>
      state!.history.filter((h) => h.ms >= nowMs - sec * 1000).map((h) => h.upMid)
    const w30 = win(30)
    const w60 = win(60)
    const w120 = win(120)
    const volStd30 = stdOf(w30)
    const volStd60 = stdOf(w60)
    const volStd120 = stdOf(w120)
    const volRange60 = w60.length >= 2 ? Math.max(...w60) - Math.min(...w60) : 0
    const drift60 = w60.length >= 2 ? (w60[w60.length - 1] as number) - (w60[0] as number) : 0
    const favBid = favBook?.bestBid
    const favSpread = typeof favBid === 'number' && Number.isFinite(favBid) ? favAsk - favBid : null
    const favBidL1 = favBook?.bids?.[0]?.size ?? 0
    const favAskL1 = favBook?.asks?.[0]?.size ?? 0
    const favDepth3Bid = cumDepth(favBook?.bidsDepthByLevel, 3)
    const favDepth3Ask = cumDepth(favBook?.asksDepthByLevel, 3)
    const denom = favDepth3Bid + favDepth3Ask
    const favImb3 = denom > 0 ? (favDepth3Bid - favDepth3Ask) / denom : 0

    const entryPrice = safeProbabilityPrice(favAsk + cfg.slippage)
    const cid = `${name}:${state.marketId}:entry:${nowMs}`
    state.stage = 'held'
    state.entryClientOrderId = cid

    return [
      {
        kind: 'place_limit',
        clientOrderId: cid,
        assetId: favAssetId,
        side: 'BUY',
        price: entryPrice,
        size: cfg.size,
        orderType: 'FOK',
        reason: 'vol_recorder_buy_favorite',
        meta: {
          favMid: round(favMid),
          favEntry: round(entryPrice),
          secondsLeft: Math.round(secondsLeft),
          lead: round(favMid - 0.5),
          volStd30: round(volStd30),
          volStd60: round(volStd60),
          volStd120: round(volStd120),
          volRange60: round(volRange60),
          drift60: round(drift60),
          favSpread: favSpread === null ? null : round(favSpread),
          favBidL1: round(favBidL1, 2),
          favAskL1: round(favAskL1, 2),
          favDepth3Bid: round(favDepth3Bid, 2),
          favDepth3Ask: round(favDepth3Ask, 2),
          favImb3: round(favImb3),
          nSamples: state.history.length,
        },
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev: AccountEvent): Intent[] => {
    if (!state) return []
    if (
      state.stage === 'held' &&
      state.entryClientOrderId &&
      ev.kind === 'order_done' &&
      ev.clientOrderId === state.entryClientOrderId &&
      ev.reason !== 'filled'
    ) {
      state.stage = 'scan'
      state.entryClientOrderId = null
    }
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}
