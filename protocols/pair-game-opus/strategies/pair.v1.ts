/**
 * pair-game-opus-pair.v1 — the pair-game player.
 *
 * Goal (RULES.md): end every 15m BTC UP/DOWN market holding at least `qty` UP
 * and at least `qty` DOWN shares, with a fee-inclusive cost per matched pair of
 * at most `pairCeil`, and positive settlement PnL.
 *
 * Mechanism
 * ---------
 * Both legs are bought with RESTING limit orders (maker ⇒ zero fee; taker fee
 * is 7bp·p·(1−p), i.e. ~1.75c/share at p=0.5, which alone blows the 0.98
 * ceiling on a pair). The two legs are never affordable at the same instant —
 * the book's UP-ask + DOWN-ask is always ≥ 1.00 — so the edge has to come from
 * buying each leg at a different moment: catch UP on an UP dip and DOWN on a
 * DOWN dip. Over a 15m window the price oscillates enough that both dips
 * usually happen.
 *
 * Budget accounting is the control loop. At any tick:
 *   budgetLeft = qty·pairCeil − spentSoFar (fee-inclusive cost basis)
 * and the still-needed legs share that budget. So a cheap first leg
 * automatically raises the bid we may show on the second leg — the strategy
 * self-corrects toward completing the pair instead of hunting a fixed price.
 *
 * Order placement rules:
 *   - never cross (post at most bestAsk − 1 tick) ⇒ every fill is a maker fill;
 *   - one live order per side, repriced only when the target moves ≥ 1 tick;
 *   - stop entirely once both legs hold `qty`.
 *
 * Nothing here branches on slug, timestamp or outcome: the only inputs are the
 * live books, the window clock and our own inventory.
 */
import * as z from 'zod'
import type {
  AccountEvent,
  Intent,
  MarketTick,
  PortfolioSnapshot,
  Strategy,
} from '../../../src/strategy/Strategy.js'
import type { StrategyContext } from '../../../src/strategy/StrategyContext.js'
import type { StrategyDefinition } from '../../../src/strategy/strategyDefinition.js'
import type { Plugin } from '../../../src/strategy/plugins/PluginSet.js'
import { isWarmed, parseGammaMarketStartMs } from '../../../src/strategy/strategyToolkit.js'

const TICK = 0.01
const WINDOW_MS = 15 * 60 * 1000

export const ConfigSchema = z.strictObject({
  /** Target matched shares per market (the level's quantity). */
  qty: z.coerce.number().finite().positive().default(10),
  /** Fee-inclusive ceiling for the cost of one UP+DOWN pair. */
  pairCeil: z.coerce.number().finite().positive().max(2).default(0.97),
  /**
   * Fraction of the window (0..1) after which no new orders are posted. Late
   * fills are the ones most likely to end up unpaired.
   */
  stopPostingAt: z.coerce.number().finite().min(0).max(1).default(0.95),
  /** Per-side floor price; below this a bid is pointless. */
  minPrice: z.coerce.number().finite().positive().default(0.02),
  /** Per-side cap price. */
  maxPrice: z.coerce.number().finite().positive().max(0.99).default(0.97),
  /** 1 ⇒ print a per-window diagnostic summary (book extremes, fills). */
  debug: z.coerce.number().int().min(0).max(1).default(0),
})

export type Config = z.infer<typeof ConfigSchema>

export const definition: StrategyDefinition<Config> = {
  id: 'pair-game-opus-pair.v1',
  title: 'Pair Game Opus — pair builder v1',
  description:
    'Budget-driven two-leg maker pair builder for BTC 15m UP/DOWN markets (pair-game-opus).',
  schema: ConfigSchema,
  create: (cfg) => createStrategy(cfg),
}

type Side = 'UP' | 'DOWN'

type LiveOrder = {
  clientOrderId: string
  price: number
  size: number
  cancelRequested: boolean
}

function floorTick(p: number): number {
  return Math.floor(p / TICK + 1e-9) * TICK
}

function round2(p: number): number {
  return Math.round(p * 100) / 100
}

export function createStrategy(cfg: Config): { strategy: Strategy; plugins: Plugin[] } {
  const name = 'pair-game-opus-pair.v1'

  // ---- per-market state (a fresh instance is built for every market) -------
  const live: Partial<Record<Side, LiveOrder>> = {}
  let seq = 0
  let windowStartMs: number | null = null

  // diagnostics
  let minAsk: Record<Side, number> = { UP: Infinity, DOWN: Infinity }
  let minAskAtMs: Record<Side, number> = { UP: 0, DOWN: 0 }
  let ticks = 0
  let lastLogMs = 0

  let summaryLogged = false

  const onMarketTick = (
    tick: MarketTick,
    portfolio: PortfolioSnapshot,
    ctx?: StrategyContext,
  ): Intent[] => {
    if (!isWarmed(ctx)) return []
    const upId = ctx?.market?.upAssetId
    const downId = ctx?.market?.downAssetId
    if (!upId || !downId) return []

    const nowMs = tick.snapshot.timestamp
    if (!Number.isFinite(nowMs)) return []
    if (windowStartMs === null) {
      windowStartMs = parseGammaMarketStartMs(ctx?.market) ?? nowMs
    }
    const elapsed = nowMs - windowStartMs

    const upBook = tick.snapshot.byAssetId[upId]
    const downBook = tick.snapshot.byAssetId[downId]
    if (!upBook || !downBook) return []
    const askUp = upBook.bestAsk
    const askDown = downBook.bestAsk
    if (askUp === null || askDown === null) return []

    ticks += 1
    if (askUp < minAsk.UP) {
      minAsk = { ...minAsk, UP: askUp }
      minAskAtMs = { ...minAskAtMs, UP: nowMs }
    }
    if (askDown < minAsk.DOWN) {
      minAsk = { ...minAsk, DOWN: askDown }
      minAskAtMs = { ...minAskAtMs, DOWN: nowMs }
    }

    const held: Record<Side, number> = {
      UP: portfolio.positionsByAssetId[upId]?.qty ?? 0,
      DOWN: portfolio.positionsByAssetId[downId]?.qty ?? 0,
    }
    const spent =
      (portfolio.positionsByAssetId[upId]?.costBasis ?? 0) +
      (portfolio.positionsByAssetId[downId]?.costBasis ?? 0)

    if (cfg.debug === 1 && nowMs - lastLogMs >= 60_000) {
      lastLogMs = nowMs
      console.log(
        `[pair.v1] t+${Math.round(elapsed / 1000)}s askUp=${askUp.toFixed(3)} askDown=${askDown.toFixed(3)} ` +
          `sum=${(askUp + askDown).toFixed(3)} held=${held.UP}/${held.DOWN} spent=${spent.toFixed(3)} ` +
          `live=${live.UP?.price ?? '-'}/${live.DOWN?.price ?? '-'}`,
      )
    }

    const needUp = Math.max(0, cfg.qty - held.UP)
    const needDown = Math.max(0, cfg.qty - held.DOWN)

    const intents: Intent[] = []

    // Done, or past the posting cutoff: pull any resting order and stop.
    const stopPosting = elapsed >= cfg.stopPostingAt * WINDOW_MS
    if (cfg.debug === 1 && stopPosting && !summaryLogged) {
      summaryLogged = true
      console.log(
        `[pair.v1] summary slug=${ctx?.market?.slug ?? '?'} ticks=${ticks} ` +
          `minAskUp=${minAsk.UP.toFixed(3)}@t+${Math.round((minAskAtMs.UP - windowStartMs) / 1000)}s ` +
          `minAskDown=${minAsk.DOWN.toFixed(3)}@t+${Math.round((minAskAtMs.DOWN - windowStartMs) / 1000)}s ` +
          `oracleFloor=${(minAsk.UP + minAsk.DOWN).toFixed(3)} held=${held.UP}/${held.DOWN} spent=${spent.toFixed(3)}`,
      )
    }
    if ((needUp <= 0 && needDown <= 0) || stopPosting) {
      for (const side of ['UP', 'DOWN'] as Side[]) {
        const o = live[side]
        const stillNeeded = side === 'UP' ? needUp : needDown
        if (o && !o.cancelRequested && (stillNeeded <= 0 || stopPosting)) {
          o.cancelRequested = true
          intents.push({ kind: 'cancel_order', clientOrderId: o.clientOrderId, reason: 'done' })
        }
      }
      return intents
    }

    // ---- budget split -----------------------------------------------------
    const budgetLeft = cfg.qty * cfg.pairCeil - spent
    if (budgetLeft <= 0) return intents

    const target: Partial<Record<Side, number>> = {}
    if (needUp > 0 && needDown > 0) {
      // Both legs open: spend the pair budget proportionally to where the
      // market currently prices each side, so neither bid is unreachable.
      const perPair = budgetLeft / Math.max(needUp, needDown)
      const total = askUp + askDown
      const wUp = total > 0 ? askUp / total : 0.5
      const pUp = floorTick(perPair * wUp)
      const pDown = floorTick(perPair - pUp)
      target.UP = pUp
      target.DOWN = pDown
    } else if (needUp > 0) {
      target.UP = floorTick(budgetLeft / needUp)
    } else {
      target.DOWN = floorTick(budgetLeft / needDown)
    }

    for (const side of ['UP', 'DOWN'] as Side[]) {
      const need = side === 'UP' ? needUp : needDown
      const want = target[side]
      const ask = side === 'UP' ? askUp : askDown
      const assetId = side === 'UP' ? upId : downId
      const o = live[side]

      if (need <= 0 || want === undefined) {
        if (o && !o.cancelRequested) {
          o.cancelRequested = true
          intents.push({ kind: 'cancel_order', clientOrderId: o.clientOrderId, reason: 'filled' })
        }
        continue
      }

      // Never cross the spread: a taker fill costs 7bp·p·(1−p) and the pair
      // ceiling has no room for it.
      const capped = Math.min(want, ask - TICK, cfg.maxPrice)
      const price = round2(floorTick(capped))
      if (price < cfg.minPrice) {
        if (o && !o.cancelRequested) {
          o.cancelRequested = true
          intents.push({ kind: 'cancel_order', clientOrderId: o.clientOrderId, reason: 'too-low' })
        }
        continue
      }

      if (!o) {
        const clientOrderId = `pg-${side}-${++seq}`
        live[side] = { clientOrderId, price, size: need, cancelRequested: false }
        intents.push({
          kind: 'place_limit',
          clientOrderId,
          assetId,
          side: 'BUY',
          price,
          size: need,
          orderType: 'GTC',
          meta: { side, p: price, s: need, ts: nowMs, m: 'S' },
          reason: 'pair-leg',
        })
        continue
      }

      if (o.cancelRequested) continue
      // Reprice only on a real move (>= 1 tick) or a size change.
      if (Math.abs(o.price - price) >= TICK - 1e-9 || Math.abs(o.size - need) > 1e-9) {
        o.cancelRequested = true
        intents.push({ kind: 'cancel_order', clientOrderId: o.clientOrderId, reason: 'reprice' })
      }
    }

    return intents
  }

  const onAccountEvent: Strategy['onAccountEvent'] = (ev: AccountEvent) => {
    const clear = (cid: string | undefined): void => {
      if (!cid) return
      for (const side of ['UP', 'DOWN'] as Side[]) {
        if (live[side]?.clientOrderId === cid) delete live[side]
      }
    }
    if (ev.kind === 'order_done') clear(ev.clientOrderId)
    else if (ev.kind === 'order_rejected') clear(ev.clientOrderId)
    else if (ev.kind === 'fill') {
      if (cfg.debug === 1) {
        console.log(
          `[pair.v1] FILL ${ev.fill.liquidity} ${ev.fill.side} ${ev.fill.size}@${ev.fill.price} ` +
            `cid=${ev.fill.clientOrderId ?? '-'}`,
        )
      }
      const o = Object.values(live).find((x) => x?.clientOrderId === ev.fill.clientOrderId)
      if (o) {
        o.size -= ev.fill.size
        if (o.size <= 1e-9) clear(ev.fill.clientOrderId)
      }
    }
    return []
  }

  const strategy: Strategy = { name, onMarketTick, onAccountEvent }
  return { strategy, plugins: [] }
}
