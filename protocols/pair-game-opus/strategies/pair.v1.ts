/**
 * pair-game-opus-pair.v1 — the pair-game player.
 *
 * Goal (RULES.md): end every 15m BTC UP/DOWN market holding at least `qty` UP
 * and at least `qty` DOWN shares, with a fee-inclusive cost per matched pair of
 * at most `pairCeil`, and positive settlement PnL.
 *
 * Mechanism
 * ---------
 * Both legs are bought with limit orders, resting where possible (maker ⇒ zero
 * fee; the taker fee is 7bp·p·(1−p), about 1.75c/share at p=0.5, a quarter of
 * the whole margin). The two legs are never affordable at the same instant —
 * the book's UP-ask + DOWN-ask is always ≥ 1.00 — so the edge has to come from
 * buying each leg at a different moment: catch UP on an UP dip and DOWN on a
 * DOWN dip. Over a 15m window the price oscillates enough that both dips
 * usually happen.
 *
 * Budget accounting is the control loop. At any tick:
 *   budgetLeft = qty·pairCeil − spentSoFar (fee-inclusive cost basis)
 * and the invariant we maintain is
 *   needUp·bidUp + needDown·bidDown ≤ budgetLeft,
 * so filling the entire remaining need at the shown bids can never breach the
 * ceiling. That bound only holds if BOTH legs finish, though, so every bid is
 * additionally gated on `avgCap` — the highest price that keeps the realized
 * avgUp + avgDown inside the ceiling right now. A window that ends short is
 * then still inside the ceiling instead of holding a handful of 1.11 pairs.
 *
 * Which leg to chase is the whole game. A resting bid only fills while its own
 * side is getting CHEAPER, so a builder that treats both legs alike spends a
 * trending window buying the outcome that is collapsing and ends holding none
 * of the one that ran away. The player therefore ranks the two legs every tick
 * and gives priority to the side whose ask is rising against its own EMA: that
 * side will only get dearer, while its partner keeps getting cheaper and can be
 * picked up late for very little. `soloShare` splits the ceiling between them —
 * the priority leg may spend that share of it, the other only the remainder —
 * which is what stops the early minutes, when both asks sit either side of
 * 0.50, from quietly eating the budget on whichever leg ticks down first.
 *
 * Order placement rules:
 *   - rest one tick behind the ask by default, so most fills are free maker
 *     fills, but cross when the ceiling guard says the taker fee is affordable
 *     — a leg that is running away never comes back to a passive bid;
 *   - one live order per side (a game limit), sized at most `clip` shares
 *     (another game limit), so the target is reached by repeated fills;
 *   - never let one leg run more than `maxImbalance` shares ahead of the other;
 *   - reprice only when the target moves ≥ 1 tick;
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
/** Polymarket crypto taker fee: fee = size × rate × p × (1−p) (src/trading/fees.ts). */
const TAKER_FEE_RATE = 0.07
const WINDOW_MS = 15 * 60 * 1000

export const ConfigSchema = z.strictObject({
  /** Target matched shares per market (the level's quantity). */
  qty: z.coerce.number().finite().positive().default(10),
  /** Fee-inclusive ceiling for the cost of one UP+DOWN pair. */
  pairCeil: z.coerce.number().finite().positive().max(2).default(0.97),
  /**
   * Maximum shares per BUY order. RULES cap this at 200 and allow only one live
   * BUY per outcome, so `qty` is reached by repeated clips, not one big order.
   */
  clip: z.coerce.number().int().positive().max(200).default(200),
  /**
   * Maximum shares one leg may hold ahead of the other. A resting bid only ever
   * fills while its side is getting cheaper, so an uncontrolled builder ends a
   * trending window holding a full position in the collapsing outcome and
   * nothing in the other. This is the throttle that forces the legs to take
   * turns.
   */
  maxImbalance: z.coerce.number().int().positive().default(1_000_000),
  /**
   * Fraction of the leading leg's current ask that stays reserved for it while
   * the lagging leg bids. 1 splits the budget the way the book prices the two
   * sides (cautious, every pair near the ceiling); 0 lets the scarce leg claim
   * the whole remaining budget (fast, but front-loads the spend).
   */
  leadReserve: z.coerce.number().finite().min(0).max(1).default(0.9),
  /**
   * Share of the pair ceiling a single leg may pay while the other leg is still
   * short of `qty`. 0.5 splits the ceiling evenly; 1 removes the cap.
   */
  soloShare: z.coerce.number().finite().min(0.1).max(1).default(0.8),
  /** 1 ⇒ allow crossing the spread when the ceiling guard says it is affordable. */
  takeMode: z.coerce.number().int().min(0).max(1).default(1),
  /**
   * Fraction of the window by which crossing aims to have a leg complete. Larger
   * values buy more patiently and lean harder on free maker fills.
   */
  takePace: z.coerce.number().finite().min(0.05).max(1).default(0.25),
  /**
   * Milliseconds at the start of the window during which nothing is posted. The
   * trend signal is meaningless on the first ticks, so the tie-break decides,
   * and committing budget on a coin flip is what loses a fast one-way window:
   * the first shares land on the leg that is about to be worthless and their
   * cost blocks the other leg for the rest of the market. Measured as a cure
   * worse than the disease so far — 15s of silence costs more on the windows
   * that already work than it saves on the fast ones — so it ships disabled.
   */
  warmupMs: z.coerce.number().finite().min(0).default(0),
  /** Which leg gets the aggressive bid each tick. */
  priority: z.enum(['lag', 'momentum', 'cheap', 'dear']).default('momentum'),
  /** 1 ⇒ also rest a bid on the non-priority leg with the leftover budget. */
  postSecondLeg: z.coerce.number().int().min(0).max(1).default(1),
  /** Time constant of the ask EMA that defines `priority=momentum`. */
  momentumTauMs: z.coerce.number().finite().positive().default(30_000),
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

  // Time-weighted ask EMAs; an ask above its own EMA is a leg running away.
  const ema: Record<Side, number | null> = { UP: null, DOWN: null }
  let lastEmaMs = 0

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
    if (ema.UP === null || ema.DOWN === null) {
      ema.UP = askUp
      ema.DOWN = askDown
    } else {
      const k = 1 - Math.exp(-Math.max(0, nowMs - lastEmaMs) / cfg.momentumTauMs)
      ema.UP += k * (askUp - ema.UP)
      ema.DOWN += k * (askDown - ema.DOWN)
    }
    lastEmaMs = nowMs

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
    const basis: Record<Side, number> = {
      UP: portfolio.positionsByAssetId[upId]?.costBasis ?? 0,
      DOWN: portfolio.positionsByAssetId[downId]?.costBasis ?? 0,
    }
    const spent = basis.UP + basis.DOWN
    const avgOf = (s: Side): number => (held[s] > 0 ? basis[s] / held[s] : 0)

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
    if (elapsed < cfg.warmupMs) return intents

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

    // The aggregate budget alone is NOT enough: it only bounds the pair cost if
    // both legs actually reach `qty`. A window that ends short can hold a few
    // very expensive pairs and still sit well inside the total spend — that is
    // how a run posts a 1.11 pair cost against a 0.97 budget. So every bid is
    // also gated on the number the scoring actually reads: the realized average
    // of one leg plus the realized average of the other. `avgCap(side, size)`
    // returns the highest price at which buying `size` more shares of `side`
    // still leaves avgUp + avgDown at or under the ceiling. Because it is
    // checked before each order, the run is inside the ceiling at every instant
    // rather than only if it finishes.
    const avgCap = (side: Side, size: number): number => {
      const other: Side = side === 'UP' ? 'DOWN' : 'UP'
      const room = cfg.pairCeil - avgOf(other)
      return (room * (held[side] + size) - basis[side]) / size
    }

    // While BOTH legs are still open, neither may take more than `soloShare` of
    // the ceiling. Without it the window's first minutes — when the two asks sit
    // either side of 0.50 and every pair is unaffordable — quietly eat the whole
    // budget at around half a dollar a share on whichever leg happens to tick
    // down first. That leg is then usually the one that collapses, and the
    // budget that should have bought the surviving outcome is already gone. The
    // cap keeps early buying cheap and leaves the ceiling's second half intact
    // for the leg that turns out to be dear. The split is deliberately
    // asymmetric: the priority leg may spend `soloShare` of the ceiling, the
    // other only the remainder, which is what makes the non-priority leg wait
    // for a genuinely cheap price instead of taking the first tick down.
    const capFirst = cfg.soloShare * cfg.pairCeil
    const capSecond = (1 - cfg.soloShare) * cfg.pairCeil

    // Bid ceiling per side WITHOUT the "stay behind the ask" term. Crossing is
    // judged against this: it is the price the ceiling and the budget allow us
    // to pay, whether we wait for the book or reach out and take it.
    const cap: Partial<Record<Side, number>> = {}
    const target: Partial<Record<Side, number>> = {}
    if (needUp > 0 && needDown > 0) {
      // Which leg gets the aggressive bid. `lag` chases whichever side holds
      // fewer shares — the balancing instinct. `momentum` chases the side whose
      // ask is rising, on the reasoning that the side running away is the one
      // that will be unaffordable later while its partner keeps getting
      // cheaper; in a trending window that is the difference between owning the
      // outcome that pays and owning the one that expires worthless.
      let first: Side
      if (cfg.priority === 'momentum') {
        const mUp = ema.UP === null ? 0 : askUp - ema.UP
        const mDown = ema.DOWN === null ? 0 : askDown - ema.DOWN
        first = mUp !== mDown ? (mUp > mDown ? 'UP' : 'DOWN') : askUp <= askDown ? 'UP' : 'DOWN'
      } else if (cfg.priority === 'cheap') {
        first = askUp <= askDown ? 'UP' : 'DOWN'
      } else if (cfg.priority === 'dear') {
        // The side the market has already decided is winning. It is the sticky
        // choice — a leg stays dear for as long as the move lasts, where a
        // momentum reading flips on every pullback — and it is the leg whose
        // partner will be nearly free by the close.
        first = askUp >= askDown ? 'UP' : 'DOWN'
      } else {
        first =
          held.UP !== held.DOWN
            ? held.UP < held.DOWN
              ? 'UP'
              : 'DOWN'
            : askUp <= askDown
              ? 'UP'
              : 'DOWN'
      }
      const second: Side = first === 'UP' ? 'DOWN' : 'UP'
      const askFirst = first === 'UP' ? askUp : askDown
      const askSecond = second === 'UP' ? askUp : askDown
      const needFirst = first === 'UP' ? needUp : needDown
      const needSecond = second === 'UP' ? needUp : needDown
      const sizeFirst = Math.min(needFirst, cfg.clip)
      const sizeSecond = Math.min(needSecond, cfg.clip)

      // Bid the priority leg as high as the book, the ceiling guard and the
      // remaining budget allow, holding back `leadReserve` × the other leg's
      // current ask so its own need stays fundable.
      const reserve = Math.max(cfg.minPrice, cfg.leadReserve * askSecond)
      const capOfFirst = Math.min(
        cfg.maxPrice,
        capFirst,
        avgCap(first, sizeFirst),
        (budgetLeft - needSecond * reserve) / needFirst,
      )
      const bidFirst = floorTick(Math.min(askFirst - TICK, capOfFirst))
      // The other leg gets whatever the priority leg left behind, so the
      // aggregate invariant holds exactly.
      const capOfSecond = Math.min(
        cfg.maxPrice,
        capSecond,
        avgCap(second, sizeSecond),
        (budgetLeft - needFirst * Math.max(0, bidFirst)) / needSecond,
      )
      cap[first] = capOfFirst
      cap[second] = capOfSecond
      target[first] = bidFirst
      target[second] =
        cfg.postSecondLeg === 1 ? floorTick(Math.min(askSecond - TICK, capOfSecond)) : -1
    } else if (needUp > 0) {
      cap.UP = Math.min(budgetLeft / needUp, avgCap('UP', Math.min(needUp, cfg.clip)))
      target.UP = floorTick(cap.UP)
    } else {
      cap.DOWN = Math.min(budgetLeft / needDown, avgCap('DOWN', Math.min(needDown, cfg.clip)))
      target.DOWN = floorTick(cap.DOWN)
    }

    for (const side of ['UP', 'DOWN'] as Side[]) {
      const need = side === 'UP' ? needUp : needDown
      const want = target[side]
      const ask = side === 'UP' ? askUp : askDown
      const assetId = side === 'UP' ? upId : downId
      const o = live[side]
      // Room left before this leg would run further than `maxImbalance` ahead
      // of the other. Fills only ever happen on a leg that is getting cheaper,
      // so without this the trending market hands us 1,000 shares of the side
      // that is collapsing and none of the side that is running away.
      const lead = held[side] - held[side === 'UP' ? 'DOWN' : 'UP']
      const room = Math.max(0, cfg.maxImbalance - lead)

      if (need <= 0 || want === undefined || room <= 0) {
        if (o && !o.cancelRequested) {
          o.cancelRequested = true
          intents.push({ kind: 'cancel_order', clientOrderId: o.clientOrderId, reason: 'filled' })
        }
        continue
      }

      // Crossing. A resting bid only ever fills while its own side is getting
      // cheaper, which is precisely the side we do NOT need in a trending
      // window: the leg that is running away simply never comes back to a
      // passive bid, and the market ends 200/1000. Taking the ask always works,
      // and the taker fee (7bp·p·(1−p), about 1.7c a share at even money) is
      // affordable whenever the ceiling guard says so — that guard already
      // knows what the other leg has cost. Crossing is paced so it fills the
      // gap the book left rather than emptying the budget in the first seconds.
      const paceTarget = cfg.qty * Math.min(1, elapsed / (cfg.takePace * WINDOW_MS))
      const takeFee = TAKER_FEE_RATE * ask * (1 - ask)
      const capNoAsk = cap[side]
      const cross =
        cfg.takeMode === 1 &&
        held[side] < paceTarget &&
        capNoAsk !== undefined &&
        ask + takeFee <= capNoAsk + 1e-9
      const price = cross
        ? round2(ask)
        : round2(floorTick(Math.min(want, ask - TICK, cfg.maxPrice)))
      if (price < cfg.minPrice) {
        if (o && !o.cancelRequested) {
          o.cancelRequested = true
          intents.push({ kind: 'cancel_order', clientOrderId: o.clientOrderId, reason: 'too-low' })
        }
        continue
      }

      // One live BUY per outcome, at most `clip` shares: the target is reached
      // by repeated fills rather than by a single large order.
      const size = Math.min(need, cfg.clip, room)

      if (!o) {
        const clientOrderId = `pg-${side}-${++seq}`
        live[side] = { clientOrderId, price, size, cancelRequested: false }
        intents.push({
          kind: 'place_limit',
          clientOrderId,
          assetId,
          side: 'BUY',
          price,
          size,
          orderType: 'GTC',
          meta: { side, p: price, s: size, ts: nowMs, m: 'S' },
          reason: 'pair-leg',
        })
        continue
      }

      if (o.cancelRequested) continue
      // Reprice on a real move (>= 1 tick), or when the resting order is now
      // larger than what is still needed (a partial fill on the other path).
      // Never re-post merely because a fill made room for a bigger clip: `size`
      // is already the cap, and churning would lose queue position for nothing.
      if (Math.abs(o.price - price) >= TICK - 1e-9 || o.size > size + 1e-9) {
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
