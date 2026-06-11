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
 * OrderbookImbalance.v2 — maker take-profit exit.
 *
 * Why: v1 (taker) over 6000 btc markets is GROSS +$335 but fees ~$324 → net ~$0.
 * The edge is real and persistent; cost is the whole problem. v2 attacks cost
 * WITHOUT touching the signal (low overfitting risk):
 *
 *  - ENTRY: taker FOK, identical to v1.
 *  - TAKE-PROFIT EXIT: a RESTING maker SELL at `entryMid + takeProfit`. This is
 *    FAVOURABLY selected — it fills only when the trade goes our way (price rises
 *    to it), the opposite of the SpikeMomentum.v2 maker-ENTRY trap. It saves the
 *    exit fee AND earns the spread on winners (the big-PnL trades).
 *  - STOP / maxHold / late-window EXIT stays TAKER (marketable) — you must be able
 *    to get out fast when it goes against you; you can't rest a maker stop.
 *
 * Everything else (signal, knobs) is identical to v1, so v2 isolates the exit change.
 *
 * Order-book only; no external feeds. LIVE CAVEAT: buy-then-sell needs MINED before
 * selling (see CLAUDE.md); backtest books on fill.
 */

export const ConfigSchema = z.strictObject({
  depthLevels: z.coerce.number().int().min(1).max(10).default(3),
  enter: z.coerce.number().finite().min(0.05).max(0.95).default(0.4),
  dwellSec: z.coerce.number().finite().min(0).max(60).default(20),
  takeProfit: z.coerce.number().finite().min(0.005).max(0.2).default(0.15),
  stopLoss: z.coerce.number().finite().min(0.005).max(0.2).default(0.02),
  maxHoldSec: z.coerce.number().finite().min(2).max(600).default(300),
  minSecondsLeft: z.coerce.number().finite().min(0).max(900).default(300),
  size: z.coerce.number().finite().positive().max(10000).default(25),
  /** Marketable slippage budget (price ticks) for taker entry + taker stop/dump. */
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'OrderbookImbalance.v2',
  title: 'Orderbook Imbalance v2 (maker take-profit)',
  description:
    'Leans with a persistent top-of-book imbalance (taker entry), exits winners via a RESTING maker ' +
    'take-profit SELL (favourably selected) and losers via taker stop. Fee-cut variant of v1.',
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
  signalSide: Side | null
  signalSinceMs: number | null
  stage: Stage
  heldAssetId: string | null
  entryMid: number | null
  entryMs: number | null
  entryClientOrderId: string | null
  /** Resting maker take-profit SELL. */
  tpClientOrderId: string | null
  tpPlaced: boolean
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

function cumDepth(arr: number[] | undefined, n: number): number | null {
  if (!arr || arr.length === 0) return null
  const i = Math.min(n, arr.length) - 1
  const v = arr[i]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

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
  const name = 'OrderbookImbalance.v2'
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
        tpClientOrderId: null,
        tpPlaced: false,
        lastExitMs: null,
      }
    }

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
    state.tpPlaced = false
    state.tpClientOrderId = null

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
      !state.tpPlaced &&
      state.entryClientOrderId &&
      ev.kind === 'order_done' &&
      ev.clientOrderId === state.entryClientOrderId &&
      ev.reason !== 'filled'
    ) {
      // Entry FOK never filled -> re-scan.
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

  if (!assetId || qty <= 0) {
    // If the resting take-profit was placed and the position is gone, it filled -> win, done.
    if (state.tpPlaced) state.stage = 'done'
    return []
  }

  // Place the resting maker take-profit SELL once, as soon as we're filled.
  if (!state.tpPlaced) {
    state.tpPlaced = true
    const ref = state.entryMid ?? midOf(bookOf(tick, assetId)) ?? 0.5
    const tpPrice = safeProbabilityPrice(ref + cfg.takeProfit)
    const tpCid = `${name}:${state.marketId}:tp:${nowMs}`
    state.tpClientOrderId = tpCid
    return [
      {
        kind: 'place_limit',
        clientOrderId: tpCid,
        assetId,
        side: 'SELL',
        price: tpPrice,
        size: qty,
        orderType: 'GTC',
        reason: 'maker_take_profit',
      },
    ]
  }

  // Resting TP handles the win side. We only intervene for stop / time exits (taker).
  const curMid = midOf(bookOf(tick, assetId))
  const entryMid = state.entryMid
  const elapsedSec = state.entryMs !== null ? (nowMs - state.entryMs) / 1000 : 0

  let exit: string | null = null
  if (secondsLeft !== null && secondsLeft <= LATE_EXIT_SECONDS) exit = 'late_window_bailout'
  else if (elapsedSec >= cfg.maxHoldSec) exit = 'max_hold'
  else if (curMid !== null && entryMid !== null && entryMid - curMid >= cfg.stopLoss)
    exit = 'stop_loss'
  if (!exit) return []

  // Cancel the resting take-profit, then dump as taker.
  state.stage = 'closing'
  state.lastExitMs = nowMs
  const intents: Intent[] = []
  if (state.tpClientOrderId) {
    intents.push({
      kind: 'cancel_order',
      clientOrderId: state.tpClientOrderId,
      reason: `cancel_tp_for_${exit}`,
    })
  }
  intents.push(...sellMarketable(tick, assetId, qty, cfg, name, state.marketId, nowMs, exit))
  return intents
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
