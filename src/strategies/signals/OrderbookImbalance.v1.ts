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
 * OrderbookImbalance.v1 — "lean with the heavy side of the book".
 *
 * Family: orderbook-imbalance (see research/families/orderbook-imbalance/family.md).
 * A different edge from spike-reaction: standing book *structure*, not a transient move.
 *
 * Hypothesis: a strong, PERSISTENT resting-size imbalance on the UP token predicts
 * short-term UP-mid drift toward the heavy side.
 *
 * Mechanism (order-book only — no external feeds):
 *  - imbalance = (bidDepth - askDepth) / (bidDepth + askDepth) over top `depthLevels`
 *    (uses the cumulative depth arrays already in the snapshot).
 *  - Require it to hold the same side past `enter` for >= `dwellSec` (anti-spoof).
 *  - bids heavy (imb >= +enter)  -> buy UP;  asks heavy (imb <= -enter) -> buy DOWN.
 *  - Exit: take-profit / stop / maxHold / late-window bailout (machinery lifted from
 *    SpikeMomentum.v1). Open only when secondsLeft >= `minSecondsLeft`.
 *
 * v1 uses a TAKER entry + taker exit so we can read GROSS (pre-fee) cleanly — the
 * spike-reaction family died on the execution wall, so GROSS is the first thing to check.
 *
 * LIVE CAVEAT: buy-then-sell needs MINED before selling (see CLAUDE.md); backtest books on fill.
 */

export const ConfigSchema = z.strictObject({
  /** Top N cumulative levels used to measure imbalance. */
  depthLevels: z.coerce.number().int().min(1).max(10).default(3),
  /** |imbalance| threshold to consider a side "heavy". */
  enter: z.coerce.number().finite().min(0.05).max(0.95).default(0.4),
  /** Imbalance must hold the same side this long before acting (anti-spoof). */
  dwellSec: z.coerce.number().finite().min(0).max(60).default(3),
  /** Profit target (held-token mid gain). */
  takeProfit: z.coerce.number().finite().min(0.005).max(0.2).default(0.05),
  /** Adverse move (held-token mid loss) that cuts the trade. */
  stopLoss: z.coerce.number().finite().min(0.005).max(0.2).default(0.03),
  /** Hard time-box on a single trade (seconds). */
  maxHoldSec: z.coerce.number().finite().min(2).max(600).default(120),
  /** Refuse to OPEN when fewer than this many seconds remain. */
  minSecondsLeft: z.coerce.number().finite().min(0).max(900).default(300),
  /** Order size (shares). */
  size: z.coerce.number().finite().positive().max(10000).default(25),
  /** Marketable slippage budget (price ticks) for taker entry/exit. */
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'OrderbookImbalance.v1',
  title: 'Orderbook Imbalance v1',
  description:
    'Leans with a persistent top-of-book size imbalance on the UP token (taker entry + exit). ' +
    'Order-book only; refuses to open near expiry.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

const WINDOW_MS = 15 * 60 * 1000
const LATE_EXIT_SECONDS = 15

type Side = 'up' | 'down'
type Stage = 'scan' | 'long' | 'closing' | 'done'

type StrategyState = {
  marketId: string
  upAssetId: string
  downAssetId: string
  /** Side the imbalance currently favours + when it first crossed `enter`. */
  signalSide: Side | null
  signalSinceMs: number | null
  stage: Stage
  heldAssetId: string | null
  entryMid: number | null
  entryMs: number | null
  entryClientOrderId: string | null
  lastExitMs: number | null
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

/** Cumulative depth across the top `n` levels (arrays are cumulative, index 0 == L1). */
function cumDepth(arr: number[] | undefined, n: number): number | null {
  if (!arr || arr.length === 0) return null
  const i = Math.min(n, arr.length) - 1
  const v = arr[i]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** imbalance in [-1, 1] over top `depthLevels` of the UP book; null if not computable. */
function upImbalance(book: OrderBookSnapshot | undefined, depthLevels: number): number | null {
  if (!book) return null
  const bid = cumDepth(book.bidsDepthByLevel, depthLevels)
  const ask = cumDepth(book.asksDepthByLevel, depthLevels)
  if (bid === null || ask === null) return null
  const tot = bid + ask
  if (tot <= 0) return null
  return (bid - ask) / tot
}

function secondsLeftOf(nowMs: number, ctx?: StrategyContext): number | null {
  const startMs = parseGammaMarketStartMs(ctx?.market)
  if (startMs === null || !Number.isFinite(nowMs)) return null
  return (startMs + WINDOW_MS - nowMs) / 1000
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'OrderbookImbalance.v1'
  let state: StrategyState = null

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
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
        signalSide: null,
        signalSinceMs: null,
        stage: 'scan',
        heldAssetId: null,
        entryMid: null,
        entryMs: null,
        entryClientOrderId: null,
        lastExitMs: null,
      }
    }

    // Update persistent-imbalance tracker every tick (also while in a position,
    // so the dwell clock is fresh when we return to scanning).
    const imb = upImbalance(bookOf(tick, state.upAssetId), cfg.depthLevels)
    if (imb === null || Math.abs(imb) < cfg.enter) {
      state.signalSide = null
      state.signalSinceMs = null
    } else {
      const side: Side = imb > 0 ? 'up' : 'down'
      if (state.signalSide !== side) {
        state.signalSide = side
        state.signalSinceMs = nowMs
      }
    }

    const secondsLeft = secondsLeftOf(nowMs, ctx)

    if (state.stage === 'long') {
      return manageOpenPosition(tick, portfolio, state, cfg, name, nowMs, secondsLeft)
    }
    if (state.stage === 'closing') {
      return manageClosing(tick, portfolio, state, cfg, name, nowMs)
    }
    if (state.stage !== 'scan') return []

    // ── scanning for a persistent imbalance ────────────────────────────────
    if (secondsLeft !== null && secondsLeft < cfg.minSecondsLeft) return []
    if (state.signalSide === null || state.signalSinceMs === null) return []
    if (nowMs - state.signalSinceMs < cfg.dwellSec * 1000) return []

    const followAssetId = state.signalSide === 'up' ? state.upAssetId : state.downAssetId
    const followBook = bookOf(tick, followAssetId)
    const bestAsk = followBook?.bestAsk
    const followMid = midOf(followBook)
    if (typeof bestAsk !== 'number' || !Number.isFinite(bestAsk) || followMid === null) return []

    const entryPrice = safeProbabilityPrice(bestAsk + cfg.slippage)
    const cid = `${name}:${state.marketId}:entry:${nowMs}`
    state.stage = 'long'
    state.heldAssetId = followAssetId
    state.entryMid = followMid
    state.entryMs = nowMs
    state.entryClientOrderId = cid

    return [
      {
        kind: 'place_limit',
        clientOrderId: cid,
        assetId: followAssetId,
        side: 'BUY',
        price: entryPrice,
        size: cfg.size,
        orderType: 'FOK',
        reason:
          state.signalSide === 'up'
            ? 'imbalance_bids_heavy_buy_up'
            : 'imbalance_asks_heavy_buy_down',
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev: AccountEvent): Intent[] => {
    if (!state) return []
    if (
      state.stage === 'long' &&
      state.entryClientOrderId &&
      ev.kind === 'order_done' &&
      ev.clientOrderId === state.entryClientOrderId &&
      ev.reason !== 'filled'
    ) {
      state.stage = 'scan'
      state.heldAssetId = null
      state.entryMid = null
      state.entryMs = null
      state.entryClientOrderId = null
    }
    return []
  }

  return { name, onMarketTick, onAccountEvent }
}

function heldQty(portfolio: PortfolioSnapshot, assetId: string | null): number {
  if (!assetId) return 0
  const pos = portfolio.positionsByAssetId[assetId]
  return pos && Number.isFinite(pos.qty) ? pos.qty : 0
}

function sellMarketable(
  tick: MarketTick,
  assetId: string,
  qty: number,
  cfg: Config,
  name: string,
  marketId: string,
  nowMs: number,
  reason: string,
): Intent[] {
  const bestBid = bookOf(tick, assetId)?.bestBid
  if (typeof bestBid !== 'number' || !Number.isFinite(bestBid)) return []
  const price = safeProbabilityPrice(bestBid - cfg.slippage)
  return [
    {
      kind: 'place_limit',
      clientOrderId: `${name}:${marketId}:exit:${nowMs}`,
      assetId,
      side: 'SELL',
      price,
      size: qty,
      orderType: 'GTC',
      reason,
    },
  ]
}

function manageOpenPosition(
  tick: MarketTick,
  portfolio: PortfolioSnapshot,
  state: NonNullable<StrategyState>,
  cfg: Config,
  name: string,
  nowMs: number,
  secondsLeft: number | null,
): Intent[] {
  const assetId = state.heldAssetId
  const qty = heldQty(portfolio, assetId)
  if (!assetId || qty <= 0) return []

  const curMid = midOf(bookOf(tick, assetId))
  const entryMid = state.entryMid
  const elapsedSec = state.entryMs !== null ? (nowMs - state.entryMs) / 1000 : 0

  let exit: string | null = null
  if (secondsLeft !== null && secondsLeft <= LATE_EXIT_SECONDS) exit = 'late_window_bailout'
  else if (elapsedSec >= cfg.maxHoldSec) exit = 'max_hold'
  else if (curMid !== null && entryMid !== null) {
    if (curMid - entryMid >= cfg.takeProfit) exit = 'take_profit'
    else if (entryMid - curMid >= cfg.stopLoss) exit = 'stop_loss'
  }
  if (!exit) return []

  state.stage = 'closing'
  state.lastExitMs = nowMs
  return sellMarketable(tick, assetId, qty, cfg, name, state.marketId, nowMs, exit)
}

function manageClosing(
  tick: MarketTick,
  portfolio: PortfolioSnapshot,
  state: NonNullable<StrategyState>,
  cfg: Config,
  name: string,
  nowMs: number,
): Intent[] {
  const assetId = state.heldAssetId
  const qty = heldQty(portfolio, assetId)
  if (!assetId || qty <= 0) {
    state.stage = 'done'
    return []
  }
  if (state.lastExitMs !== null && nowMs - state.lastExitMs < 2000) return []
  state.lastExitMs = nowMs
  return sellMarketable(tick, assetId, qty, cfg, name, state.marketId, nowMs, 'close_retry')
}
