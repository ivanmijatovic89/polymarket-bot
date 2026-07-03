import type {
  AccountEvent,
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../../../strategy/Strategy.js'
import type { StrategyContext } from '../../../strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../strategy/strategyDefinition.js'
import { parseGammaMarketStartMs, safeProbabilityPrice } from '../../../strategy/strategyToolkit.js'
import type { OrderBookSnapshot, OrderLevel } from '../../../market/orderbook/types.js'
import * as z from 'zod'

/**
 * liquidity-wall.000-baseline — "trade around a single dominant resting order (a wall)".
 *
 * Family: liquidity-wall (see strategy-research-protocol/liquidity-wall/FAMILY.md).
 *
 * Primary decision driver: CONCENTRATION, not aggregate pressure. A "wall" is one
 * resting level whose size dominates its side of the book. This is a DIFFERENT
 * driver from book-imbalance — a book can be balanced in aggregate (imbalance ~ 0)
 * yet have one giant bid wall and many small asks summing to the same total. The
 * wall is a discrete barrier / conviction object (committed capital defending a
 * price), not a continuous size ratio.
 *
 * Hypothesis (baseline, `mode=follow`): a dominant BID wall on the UP token is
 * committed buyers defending UP -> UP is supported -> lean UP. A dominant ASK wall
 * caps UP -> lean DOWN. `mode=fade` bets the opposite (walls get pulled / broken).
 * The baseline sweep discovers the sign.
 *
 * Mechanism (order-book only — no external feeds):
 *  - On the UP token book, look at the top `depthLevels` of each side.
 *  - A side has a wall when its largest single level dominates that side's total:
 *    maxLevelSize / sum(top levels) >= `wallRatio`, AND maxLevelSize >= `minWallShares`.
 *  - Pick the dominant wall (larger ratio if both sides qualify) -> wallSide bid|ask.
 *  - Require wallSide to persist >= `dwellSec` (anti-spoof).
 *  - Resolve (wallSide, mode) -> trade side, buy it as a taker.
 *  - Exit: take-profit / stop / maxHold / late-window bailout. Open only when
 *    secondsLeft >= `minSecondsLeft`.
 *
 * v1 uses TAKER entry + taker exit so fees land explicitly in `evPerMarketTotal`
 * (the metric we judge on), and so the backtest's adversely-selected passive-fill
 * model does not bite (cf. the book-imbalance v2 maker-TP lesson). LIVE CAVEAT: buy-then-sell needs MINED
 * before selling (see CLAUDE.md); the backtest books on fill.
 */

const MODES = ['follow', 'fade'] as const
type Mode = (typeof MODES)[number]

export const ConfigSchema = z.strictObject({
  /** Top N levels (per side) used to detect a wall. */
  depthLevels: z.coerce.number().int().min(1).max(20).default(5),
  /** Dominant-level share of its side's top-N total to count as a wall. */
  wallRatio: z.coerce.number().finite().min(0.2).max(0.99).default(0.6),
  /** Absolute floor on the wall's size (shares) — ignore tiny "walls". */
  minWallShares: z.coerce.number().finite().min(0).max(1_000_000).default(200),
  /** follow = lean WITH the wall (barrier defends); fade = bet it breaks/gets pulled. */
  mode: z.enum(MODES).default('follow'),
  /** Dominant wall side must persist this long before acting (anti-spoof). */
  dwellSec: z.coerce.number().finite().min(0).max(60).default(5),
  /** Profit target (held-token mid gain). */
  takeProfit: z.coerce.number().finite().min(0.005).max(0.2).default(0.15),
  /** Adverse move (held-token mid loss) that cuts the trade. */
  stopLoss: z.coerce.number().finite().min(0.005).max(0.2).default(0.02),
  /** Hard time-box on a single trade (seconds). */
  maxHoldSec: z.coerce.number().finite().min(2).max(900).default(300),
  /** Refuse to OPEN when fewer than this many seconds remain. */
  minSecondsLeft: z.coerce.number().finite().min(0).max(900).default(300),
  /** Order size (shares). */
  size: z.coerce.number().finite().positive().max(10000).default(25),
  /** Marketable slippage budget (price) for taker entry/exit. */
  slippage: z.coerce.number().finite().min(0).max(0.2).default(0.02),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'liquidity-wall.000-baseline',
  title: 'Liquidity Wall 000 Baseline',
  description:
    'Trades around a single dominant resting order (a wall) on the UP token — ' +
    'concentration, not aggregate imbalance. Taker entry + exit; order-book only; ' +
    'refuses to open near expiry.',
  schema: ConfigSchema,
  create: (cfg) => ({ strategy: createStrategy(cfg) }),
}

const WINDOW_MS = 15 * 60 * 1000
const LATE_EXIT_SECONDS = 15

type Side = 'up' | 'down'
type WallSide = 'bid' | 'ask'
type Stage = 'scan' | 'long' | 'closing' | 'done'

type StrategyState = {
  marketId: string
  upAssetId: string
  downAssetId: string
  /** Which side of the UP book the dominant wall sits on + when it first appeared. */
  wallSide: WallSide | null
  wallSinceMs: number | null
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

/**
 * Dominance ratio of the largest single resting level among the top `n` levels.
 * `levels` is already sorted top-of-book-first (bids DESC / asks ASC by price).
 * Returns the wall's dominance ratio in (0, 1], or null if no qualifying wall.
 */
function wallDominance(
  levels: OrderLevel[] | undefined,
  n: number,
  minWallShares: number,
  wallRatio: number,
): number | null {
  if (!levels || levels.length === 0) return null
  const k = Math.min(n, levels.length)
  let total = 0
  let maxSize = 0
  for (let i = 0; i < k; i++) {
    const s = Number.isFinite(levels[i]!.size) ? levels[i]!.size : 0
    total += s
    if (s > maxSize) maxSize = s
  }
  if (total <= 0 || maxSize < minWallShares) return null
  const ratio = maxSize / total
  return ratio >= wallRatio ? ratio : null
}

/** Which side of the UP book has the dominant wall, or null. */
function dominantWallSide(book: OrderBookSnapshot | undefined, cfg: Config): WallSide | null {
  if (!book) return null
  const bid = wallDominance(book.bids, cfg.depthLevels, cfg.minWallShares, cfg.wallRatio)
  const ask = wallDominance(book.asks, cfg.depthLevels, cfg.minWallShares, cfg.wallRatio)
  if (bid === null && ask === null) return null
  if (bid !== null && ask !== null) return bid >= ask ? 'bid' : 'ask'
  return bid !== null ? 'bid' : 'ask'
}

/** Map (wall side on UP book, mode) -> the side we buy. */
function tradeSide(wallSide: WallSide, mode: Mode): Side {
  // follow: bid wall supports UP -> buy UP; ask wall caps UP -> buy DOWN.
  const followSide: Side = wallSide === 'bid' ? 'up' : 'down'
  if (mode === 'follow') return followSide
  return followSide === 'up' ? 'down' : 'up'
}

function secondsLeftOf(nowMs: number, ctx?: StrategyContext): number | null {
  const startMs = parseGammaMarketStartMs(ctx?.market)
  if (startMs === null || !Number.isFinite(nowMs)) return null
  return (startMs + WINDOW_MS - nowMs) / 1000
}

export function createStrategy(cfg: Config): Strategy {
  const name = 'liquidity-wall.000-baseline'
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
        wallSide: null,
        wallSinceMs: null,
        stage: 'scan',
        heldAssetId: null,
        entryMid: null,
        entryMs: null,
        entryClientOrderId: null,
        lastExitMs: null,
      }
    }

    // Update the dominant-wall tracker every tick (also while in a position, so the
    // dwell clock is fresh when we return to scanning).
    const wallSide = dominantWallSide(bookOf(tick, state.upAssetId), cfg)
    if (wallSide === null) {
      state.wallSide = null
      state.wallSinceMs = null
    } else if (state.wallSide !== wallSide) {
      state.wallSide = wallSide
      state.wallSinceMs = nowMs
    }

    const secondsLeft = secondsLeftOf(nowMs, ctx)

    if (state.stage === 'long') {
      return manageOpenPosition(tick, portfolio, state, cfg, name, nowMs, secondsLeft)
    }
    if (state.stage === 'closing') {
      return manageClosing(tick, portfolio, state, cfg, name, nowMs)
    }
    if (state.stage !== 'scan') return []

    // ── scanning for a persistent dominant wall ────────────────────────────────
    if (secondsLeft !== null && secondsLeft < cfg.minSecondsLeft) return []
    if (state.wallSide === null || state.wallSinceMs === null) return []
    if (nowMs - state.wallSinceMs < cfg.dwellSec * 1000) return []

    const side = tradeSide(state.wallSide, cfg.mode)
    const followAssetId = side === 'up' ? state.upAssetId : state.downAssetId
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
          state.wallSide === 'bid'
            ? `bid_wall_${cfg.mode}_buy_${side}`
            : `ask_wall_${cfg.mode}_buy_${side}`,
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
