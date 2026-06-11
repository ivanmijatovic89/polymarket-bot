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
 * OverreactionSnap.v1 — "fade the jerk, take the snap-back".
 *
 * Hypothesis: in a 15m up/down market the price sometimes jerks to an extreme
 * on a single burst (a big taker, a thin-book sweep) and then snaps back,
 * because the jerk was liquidity noise, not new information. Fade the jerk and
 * exit on the partial snap-back.
 *
 * Mechanism (all computable from the recorded order book — no external feeds):
 *  - Track a short rolling history of the UP-token mid price.
 *  - Spike = |upMid - upMid(jumpWindow ago)| >= `jump`.
 *  - Fade it: spike UP  -> buy DOWN (bet UP reverts down).
 *             spike DOWN -> buy UP.
 *  - Exit, whichever first: revert by `takeProfit`, adverse by `stopLoss`,
 *    or `maxHoldSec` elapsed (plus a hard late-window bailout).
 *  - Only OPEN when secondsLeft >= `minSecondsLeft`: near expiry a "spike" is
 *    the market correctly converging to 0/1 (real resolution), not overreaction.
 *
 * Knobs are intentionally written so the research expander can sweep ranges:
 *   jump, jumpWindowSec, takeProfit, stopLoss, maxHoldSec, minSecondsLeft, size.
 *
 * LIVE CAVEAT: this is a buy-then-sell strategy. In live trading you must wait
 * for MINED before selling shares you just bought (see CLAUDE.md). The backtest
 * books positions on fill, so the sweep works; a live port needs that guard.
 */

export const ConfigSchema = z.strictObject({
  /** Minimum UP-mid move within the window that counts as a spike. */
  jump: z.coerce.number().finite().min(0.01).max(0.5).default(0.05),
  /** Lookback window (seconds) the spike must happen inside. */
  jumpWindowSec: z.coerce.number().finite().min(1).max(60).default(8),
  /** Revert target (held-token mid gain) that closes the trade as a win. */
  takeProfit: z.coerce.number().finite().min(0.005).max(0.2).default(0.03),
  /** Adverse move (held-token mid loss) that cuts the trade. */
  stopLoss: z.coerce.number().finite().min(0.005).max(0.2).default(0.04),
  /** Hard time-box on a single trade (seconds). */
  maxHoldSec: z.coerce.number().finite().min(2).max(600).default(45),
  /** Refuse to OPEN when fewer than this many seconds remain in the window. */
  minSecondsLeft: z.coerce.number().finite().min(0).max(900).default(300),
  /** Order size (shares). */
  size: z.coerce.number().finite().positive().max(10000).default(25),
  /** Marketable slippage budget (price ticks) for taker entry/exit. */
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'OverreactionSnap.v1',
  title: 'Overreaction Snap v1',
  description:
    'Fades a fast UP-mid spike (buys the opposite side) and exits on the partial snap-back. ' +
    'Order-book only; no external feeds. Refuses to open near expiry.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

const WINDOW_MS = 15 * 60 * 1000
/** Always bail out of any open position when this few seconds remain. */
const LATE_EXIT_SECONDS = 15
/** Minimum mid samples before we trust a spike reading. */
const MIN_HISTORY = 3

type Stage = 'scan' | 'long' | 'closing' | 'done'

type StrategyState = {
  marketId: string
  upAssetId: string
  downAssetId: string
  history: Array<{ ms: number; upMid: number }>
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

function secondsLeftOf(nowMs: number, ctx?: StrategyContext): number | null {
  const startMs = parseGammaMarketStartMs(ctx?.market)
  if (startMs === null || !Number.isFinite(nowMs)) return null
  return (startMs + WINDOW_MS - nowMs) / 1000
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'OverreactionSnap.v1'
  let state: StrategyState = null

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    const marketId = tick.snapshot.market ?? 'unknown_market'
    const nowMs = tick.snapshot.timestamp || Date.now()

    // New market -> fresh cycle.
    if (state && state.marketId !== marketId) state = null
    if (!state) {
      const ids = resolveUpDownAssetIds(tick, ctx)
      if (!ids) return []
      state = {
        marketId,
        upAssetId: ids.upAssetId,
        downAssetId: ids.downAssetId,
        history: [],
        stage: 'scan',
        heldAssetId: null,
        entryMid: null,
        entryMs: null,
        entryClientOrderId: null,
        lastExitMs: null,
      }
    }

    const upMid = midOf(bookOf(tick, state.upAssetId))
    if (upMid !== null) {
      state.history.push({ ms: nowMs, upMid })
      const cutoff = nowMs - cfg.jumpWindowSec * 1000
      while (state.history.length > 0 && (state.history[0]?.ms ?? 0) < cutoff) {
        state.history.shift()
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

    // ── scanning for a spike ───────────────────────────────────────────────
    if (secondsLeft !== null && secondsLeft < cfg.minSecondsLeft) return []
    if (upMid === null || state.history.length < MIN_HISTORY) return []

    const refMid = state.history[0]?.upMid
    if (typeof refMid !== 'number') return []
    const delta = upMid - refMid
    if (Math.abs(delta) < cfg.jump) return []

    // spike UP in UP-mid -> fade by buying DOWN; spike DOWN -> buy UP.
    const fadeAssetId = delta > 0 ? state.downAssetId : state.upAssetId
    const fadeBook = bookOf(tick, fadeAssetId)
    const bestAsk = fadeBook?.bestAsk
    const fadeMid = midOf(fadeBook)
    if (typeof bestAsk !== 'number' || !Number.isFinite(bestAsk) || fadeMid === null) return []

    const entryPrice = safeProbabilityPrice(bestAsk + cfg.slippage)
    const cid = `${name}:${state.marketId}:entry:${nowMs}`
    state.stage = 'long'
    state.heldAssetId = fadeAssetId
    state.entryMid = fadeMid
    state.entryMs = nowMs
    state.entryClientOrderId = cid

    return [
      {
        kind: 'place_limit',
        clientOrderId: cid,
        assetId: fadeAssetId,
        side: 'BUY',
        price: entryPrice,
        size: cfg.size,
        orderType: 'FOK',
        reason: delta > 0 ? 'fade_spike_up_buy_down' : 'fade_spike_down_buy_up',
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev: AccountEvent): Intent[] => {
    if (!state) return []
    // Entry FOK that did not fill -> go back to scanning.
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
  if (!assetId || qty <= 0) return [] // entry not (yet) filled; wait or onAccountEvent resets us

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
  // Remainder still resting/unsold: retry marketable exit, throttled.
  if (state.lastExitMs !== null && nowMs - state.lastExitMs < 2000) return []
  state.lastExitMs = nowMs
  return sellMarketable(tick, assetId, qty, cfg, name, state.marketId, nowMs, 'close_retry')
}
