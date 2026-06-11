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
import type { MarketOrderBooksSnapshot, OrderBookSnapshot } from '../../market/orderbook/types.js'
import * as z from 'zod'

/**
 * SpikeMomentum.v2 — maker-entry variant of SpikeMomentum.v1.
 *
 * Why this exists: the v1 (taker) TP/SL surface was fully mapped over the last
 * 1000 btc 15m markets. The directional edge is real but tops out at ~GROSS
 * break-even (peak tp≈0.12/sl≈0.02) and taker fees (~$325 / 1000 markets) turn
 * that into a guaranteed loss. v2 attacks the one thing killing it: execution.
 *
 * ONLY the ENTRY changes vs v1:
 *  - v1 crossed the spread with a taker FOK at bestAsk+slippage.
 *  - v2 RESTS a maker BUY just inside the spread (bestAsk - `entryOffset`) and
 *    waits up to `entryTimeoutSec`; if unfilled, it cancels and re-scans.
 *
 * This both removes the entry fee AND flips spread-paying into spread-earning
 * on entry. The honest risk: a resting buy on a MOMENTUM signal is adversely
 * selected — in the backtest's worst-queue maker model it fills only when the
 * ask trades back DOWN through our level, i.e. exactly when the move is NOT
 * continuing. So this is a real test that can fail for a real reason: fewer
 * markets played, and the filled subset may be the losers.
 *
 * Exit is still taker (marketable), identical to v1, so v2 isolates the entry
 * change. If maker entry helps, a v3 can also make the take-profit a maker.
 *
 * Order-book only; no external feeds. LIVE CAVEAT: buy-then-sell needs MINED
 * before selling (see CLAUDE.md); backtest books on fill.
 */

export const ConfigSchema = z.strictObject({
  jump: z.coerce.number().finite().min(0.01).max(0.5).default(0.05),
  jumpWindowSec: z.coerce.number().finite().min(1).max(60).default(8),
  takeProfit: z.coerce.number().finite().min(0.005).max(0.2).default(0.12),
  stopLoss: z.coerce.number().finite().min(0.005).max(0.2).default(0.02),
  maxHoldSec: z.coerce.number().finite().min(2).max(600).default(300),
  minSecondsLeft: z.coerce.number().finite().min(0).max(900).default(300),
  size: z.coerce.number().finite().positive().max(10000).default(25),
  /** Marketable slippage budget for the taker EXIT. */
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
  /** How far below bestAsk to rest the maker BUY (price units). 0.01 == 1 tick inside. */
  entryOffset: z.coerce.number().finite().min(0).max(0.1).default(0.01),
  /** Cancel an unfilled resting entry after this many seconds, then re-scan. */
  entryTimeoutSec: z.coerce.number().finite().min(1).max(300).default(20),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'SpikeMomentum.v2',
  title: 'Spike Momentum v2 (maker entry)',
  description:
    'Follows a fast UP-mid spike with a RESTING maker BUY just inside the spread (cancel-on-timeout), ' +
    'taker exit. Maker-entry variant of SpikeMomentum.v1 to kill taker entry fees.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

const WINDOW_MS = 15 * 60 * 1000
const LATE_EXIT_SECONDS = 15
const MIN_HISTORY = 3

type Stage = 'scan' | 'entering' | 'long' | 'closing' | 'done'

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
  entryPlacedMs: number | null
  cancelRequested: boolean
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
  const name = 'SpikeMomentum.v2'
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
        history: [],
        stage: 'scan',
        heldAssetId: null,
        entryMid: null,
        entryMs: null,
        entryClientOrderId: null,
        entryPlacedMs: null,
        cancelRequested: false,
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

    if (state.stage === 'entering') {
      return manageEntering(tick, portfolio, state, cfg, nowMs)
    }
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

    // MOMENTUM: spike UP -> buy UP; spike DOWN -> buy DOWN.
    const followAssetId = delta > 0 ? state.upAssetId : state.downAssetId
    const followBook = bookOf(tick, followAssetId)
    const bestAsk = followBook?.bestAsk
    const followMid = midOf(followBook)
    if (typeof bestAsk !== 'number' || !Number.isFinite(bestAsk) || followMid === null) return []

    // MAKER entry: rest a BUY just inside the spread (below the ask).
    const entryPrice = safeProbabilityPrice(bestAsk - cfg.entryOffset)
    const cid = `${name}:${state.marketId}:entry:${nowMs}`
    state.stage = 'entering'
    state.heldAssetId = followAssetId
    state.entryMid = followMid
    state.entryMs = nowMs
    state.entryClientOrderId = cid
    state.entryPlacedMs = nowMs
    state.cancelRequested = false

    return [
      {
        kind: 'place_limit',
        clientOrderId: cid,
        assetId: followAssetId,
        side: 'BUY',
        price: entryPrice,
        size: cfg.size,
        orderType: 'GTC',
        reason: delta > 0 ? 'maker_follow_spike_up' : 'maker_follow_spike_down',
      },
    ]
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (
    ev: AccountEvent,
    _portfolio: PortfolioSnapshot,
    lastMarket?: MarketOrderBooksSnapshot,
  ): Intent[] => {
    if (!state) return []

    // Maker entry filled -> become long; anchor entryMid at the fill book.
    if (
      state.stage === 'entering' &&
      state.entryClientOrderId &&
      ev.kind === 'fill' &&
      ev.fill.clientOrderId === state.entryClientOrderId
    ) {
      state.stage = 'long'
      state.heldAssetId = ev.fill.assetId
      state.entryMs = ev.fill.tsMs
      const bk = lastMarket?.byAssetId[ev.fill.assetId]
      const m = midOf(bk)
      if (m !== null) state.entryMid = m
      return []
    }

    // Entry order finished without filling (cancel/expire/kill) -> re-scan.
    if (
      state.stage === 'entering' &&
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
      state.entryPlacedMs = null
      state.cancelRequested = false
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

function manageEntering(
  tick: MarketTick,
  portfolio: PortfolioSnapshot,
  state: NonNullable<StrategyState>,
  cfg: Config,
  nowMs: number,
): Intent[] {
  // Backstop: if a fill landed, switch to managing the position.
  if (heldQty(portfolio, state.heldAssetId) > 0) {
    state.stage = 'long'
    if (state.entryMs === null) state.entryMs = nowMs
    const m = midOf(bookOf(tick, state.heldAssetId as string))
    if (m !== null) state.entryMid = m
    return []
  }
  // Cancel-on-timeout, then onAccountEvent('order_done') resets us to scan.
  if (
    !state.cancelRequested &&
    state.entryPlacedMs !== null &&
    nowMs - state.entryPlacedMs >= cfg.entryTimeoutSec * 1000 &&
    state.entryClientOrderId
  ) {
    state.cancelRequested = true
    return [
      { kind: 'cancel_order', clientOrderId: state.entryClientOrderId, reason: 'entry_timeout' },
    ]
  }
  return []
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
