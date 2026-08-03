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
 * ceiling. Because both legs finish at exactly `qty`, the pair cost IS the total
 * spend divided by `qty`, so this single budget line is the whole ceiling
 * guarantee. An additional guard on the realized averages (`avgGuard`) sounds
 * safer and is not: it reads a leg that holds a fifth of its target at 0.59 as a
 * 0.59 leg, when the rest of that leg is capped at `underdogMax` and its final
 * average will be half of that — so it locks the OTHER leg out at exactly the
 * moment the player needs to recover from a bad opening read. It ships off.
 *
 * Which leg to chase is the whole game. A resting bid only fills while its own
 * side is getting CHEAPER, so a builder that treats both legs alike spends a
 * trending window buying the outcome that is collapsing and ends holding none
 * of the one that ran away. The player therefore ranks the two legs every tick
 * and gives priority to the side whose ask is rising against its own EMA: that
 * side will only get dearer, while its partner keeps getting cheaper and can be
 * picked up late for very little. The underdog's allowance is then whatever the
 * ceiling still holds once the priority leg is finished at today's price, which
 * is what stops the early minutes, when both asks sit either side of 0.50, from
 * quietly eating the budget on whichever leg ticks down first.
 *
 * Four things decide whether that plan survives contact with a real window.
 * The priority leg has to be COMPLETED while it is still affordable — its
 * window is a minute or two, and often under one, so crossing is not rationed
 * by the clock at all (`takeFloor`); the ceiling guard is the only thing that
 * bounds it. When the book opens already leaning hard, the trend reading is too
 * slow to be useful: the favourite is never cheaper than in its first seconds
 * and the pair is only affordable if it is bought there, so the size of the
 * opening lean overrides the trend outright (`convEdge`). And the second leg is
 * never allowed to pay a coin-flip price (`underdogMax`): every window in this
 * universe ends with one side under 0.12, so the leg that is not being chased
 * will be cheap later, and letting it fill at 0.4–0.5 in the opening minute is
 * how the ceiling gets spent on the outcome that expires worthless. Finally, the
 * opening read may not be sized like a confirmed one (`openMs`, `openShare`):
 * with crossing unthrottled a leg completes in under three seconds, which means
 * the whole market can be decided by a tick-zero guess, and a wrong guess sets
 * an average that no later cheapness can undo. Capping the first seconds to a
 * fifth of the target is what makes being wrong survivable.
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
/** How long to wait for a cancel to come back before re-sending it. */
const CANCEL_RETRY_MS = 2_000

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
   * Fraction of the window by which crossing aims to have the priority leg
   * complete. Larger values buy more patiently and lean harder on free maker
   * fills — but patience here is not free, and this throttle turned out to be
   * the binding constraint on the whole strategy.
   *
   * The priority leg is by definition the one running away, so the stretch of
   * window in which it is still affordable is short — often a minute or two,
   * and in a window that opens already trending, under a minute. Rationing the
   * crossing over a quarter of the window means the leg is still half-built
   * when its price has gone; the ceiling is then spent on the leg that ends up
   * worthless and the market finishes lopsided. Completing the priority leg
   * inside its own window is worth far more than the taker fee it costs.
   */
  takePace: z.coerce.number().finite().min(0.05).max(1).default(0.05),
  /**
   * Fraction of the window by which the UNDERDOG leg may reach `qty` shares.
   *
   * A resting bid one tick under the ask fills on every downtick, so an unpaced
   * leg buys the WHOLE of a collapse and pays the average of the descent
   * instead of its minimum — and, worse, it reaches `qty` near the TOP of that
   * descent, which spends the ceiling and leaves nothing to average down with.
   * Pacing inverts that: the early, expensive part of the fall can only ever be
   * a few shares, and the bulk of the leg is acquired near the bottom.
   *
   * It applies to the underdog ONLY. Pacing both legs measured much worse, and
   * the reason is the asymmetry that runs through this whole strategy: the
   * favourite has to be secured while it is still affordable, whereas the
   * underdog only ever gets cheaper and should be bought as late as the window
   * allows.
   *
   * 0 disables pacing entirely.
   */
  fillPace: z.coerce.number().finite().min(0).max(1).default(0),
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
  /**
   * How far the momentum readings of the two legs must diverge before the
   * priority leg is allowed to switch. The raw signal is `ask − ownEMA` on each
   * side, and around a flat book it changes sign on a single tick of noise. An
   * ungated switch hands the aggressive bid — and the permission to cross — to
   * whichever leg happens to have wiggled, which is how a window that is
   * quietly building the right leg suddenly buys 1,000 shares of the other one
   * at the worst price. The priority leg latches and only moves on a real
   * divergence.
   */
  momDeadband: z.coerce.number().finite().min(0).default(0),
  /**
   * Conviction override. `edge = |askUp − askDown|` is how strongly the book
   * favours one outcome right now; `convEdge` is where that starts to count and
   * `convFull` where it counts fully. Values ≥ 1 disable the whole mechanism.
   *
   * Why it has to exist: in a window that opens already trending hard, the
   * favourite is never cheaper than in its first seconds, and the underdog is
   * never expensive again. There is no patient line — the pair is affordable
   * only if the favourite is bought immediately, and the ceiling that pays for
   * it is earned back on an underdog that ends up costing a few cents. The
   * player cannot know the window will keep trending, but it can read how
   * strongly the market already believes it, and size its commitment to that.
   * Below `convEdge` the book is close to a coin flip and the patient,
   * dip-buying behaviour is right.
   */
  convEdge: z.coerce.number().finite().min(0).default(0.12),
  /** Edge at which conviction is full. Must exceed `convEdge` to ramp. */
  convFull: z.coerce.number().finite().min(0).default(0.2),
  /**
   * Fraction of the window during which conviction can fire at all.
   *
   * The edge widens in EVERY window as the market resolves, so an ungated
   * reading says "high conviction" late in all of them — and chasing a
   * favourite that has already run to 0.85 is the one thing the player must
   * never do. What the mechanism is actually for is the opposite case: a book
   * that leans hard in its first seconds, before anything has moved. Outside
   * this opening window the patient, dip-buying behaviour governs.
   */
  convUntil: z.coerce.number().finite().min(0).max(1).default(0.06),
  /** `leadReserve` used at full conviction: the underdog will be cheap, so reserve little. */
  convReserve: z.coerce.number().finite().min(0).max(1).default(0.25),
  /** `soloShare` used at full conviction. */
  convShare: z.coerce.number().finite().min(0.1).max(1).default(0.9),
  /** `takePace` used at full conviction — the favourite's window is seconds, not minutes. */
  convTakePace: z.coerce.number().finite().min(0.01).max(1).default(0.05),
  /**
   * How much further the priority leg is assumed to run before it is finished,
   * when deciding what the other leg may pay.
   *
   * The underdog's allowance is the ceiling minus the projected cost of
   * completing the priority leg, and projecting that leg at TODAY's ask is
   * exactly wrong: it is the priority leg because it is running away, so it
   * will cost more than it does now. Under-projecting hands the underdog an
   * allowance near 0.5 in the opening minutes, and a pair with both legs bought
   * near 0.5 is the one shape that can never come in under the ceiling.
   */
  leadPad: z.coerce.number().finite().min(0).max(0.5).default(0),
  /**
   * Fraction below its own allowance at which the underdog rests its bid.
   *
   * Without it the underdog bids exactly AT the highest price the ceiling
   * permits, so every one of its fills happens at the worst price it was ever
   * allowed to pay — a systematic leak, because the leg only fills while it is
   * getting cheaper and would have come to a lower bid moments later anyway.
   * Bidding under the allowance turns each fill into a better one, and the
   * saving compounds: a cheaper underdog average is exactly what raises the
   * ceiling room the favourite needs to finish.
   */
  underdogDiscount: z.coerce.number().finite().min(0).max(0.6).default(0),
  /**
   * Fraction of the window over which the underdog's price allowance ramps from
   * nothing to full. 0 disables the ramp.
   *
   * At the open both asks sit either side of 0.50 and the underdog's allowance
   * — the ceiling minus what the favourite costs today — is itself about 0.50.
   * So the underdog is permitted to buy at 0.48, which silently commits the
   * player to a pair whose other leg must never rise, in the one moment when
   * the book has told it nothing at all. That single early fill is what ends a
   * one-way window holding 1,000 shares of the outcome that expires worthless.
   * The favourite is unaffected: it still buys from the first tick. This only
   * says that the SECOND leg has no business spending the ceiling before the
   * window has revealed which leg is which.
   */
  underdogRamp: z.coerce.number().finite().min(0).max(1).default(0),
  /**
   * Absolute price ceiling for the NON-priority leg. 1 disables it.
   *
   * The book always prices the two asks to sum above 1.00, so a pair under the
   * ceiling can only ever be assembled from one leg bought while it is dear and
   * the other bought while it is cheap — and since a leg only ever gets cheaper
   * by losing, the cheap leg is the losing one and it is cheapest at the close.
   * Every market in this universe ends with one side under 0.12 and the other
   * over 0.78, so the ceiling is never the real constraint: buying the loser at
   * a few cents leaves 0.85+ of allowance for the winner, which is more than it
   * ever costs while it is still identifiable.
   *
   * What actually loses a window is the second leg quietly filling at 0.4–0.5 in
   * the first minute. It fills fast, because a resting bid fills precisely while
   * its side is collapsing, and it fills at the expensive end of that collapse.
   * The ceiling guard is then spent and the leg that ran away is unaffordable
   * for the rest of the window. This cap says the second leg may only ever be
   * bought at a price that is plausibly near a loser's floor; if it turns out to
   * be the winner instead, the momentum reading promotes it and the cap lifts.
   *
   * Measured on level 6: the whole level is lost without this cap (0 of 20
   * runs) and won with it anywhere from 0.08 to 0.50 (20 of 20 at 0.08, 0.12,
   * 0.15, 0.20, 0.30, 0.45, 0.50). It ships at the middle of that plateau. 0.60
   * fails outright, and the reason is exactly the mechanism above: market 6's
   * losing leg opens at 0.53, so a cap above it lets the leg fill at the open.
   */
  underdogMax: z.coerce.number().finite().min(0.02).max(1).default(0.25),
  /**
   * Milliseconds at the start of the window during which NO leg may hold more
   * than `openShare` × `qty` shares.
   *
   * Crossing is unthrottled and a clip is 200 shares, so the player can and does
   * commit an entire leg inside three seconds — on a read the window has not
   * confirmed yet. When that read is wrong the market is already lost: the
   * mistaken leg's realized average is set at a coin-flip price and no later
   * cheapness can undo it.
   *
   * The opening seconds are exactly when the book carries the least information
   * — the trend EMA has no history and the price level alone does not say which
   * leg will run. This cap does not decide anything; it only says that the
   * decision taken with no evidence may not be sized like a decision taken with
   * evidence. What it buys is the right to be wrong: a leg stopped at a fifth of
   * its target can still be completed cheaply once the trend reveals itself,
   * because most of its average is still unspent.
   *
   * 0 disables it.
   */
  openMs: z.coerce.number().finite().min(0).default(5_000),
  /** Fraction of `qty` any one leg may hold before `openMs`. 1 disables the cap. */
  openShare: z.coerce.number().finite().min(0).max(1).default(0.2),
  /**
   * 1 ⇒ keep the realized-average ceiling guard.
   *
   * The guard caps every bid so that `avgUp + avgDown` stays inside `pairCeil`
   * using the other leg's average AS REALIZED SO FAR. That is far more
   * pessimistic than the rule it is protecting: a leg holding 200 shares at 0.59
   * out of a target of 1,000 is treated as a 0.59 leg, when its remaining 800
   * shares are capped at `underdogMax` and its final average will be nearer
   * 0.30. The guard therefore locks the OTHER leg out at exactly the moment the
   * player has realized it bought the wrong side first and needs to recover.
   *
   * It is also redundant. Every bid is already capped by the remaining budget
   * (`qty × pairCeil − spent`), and when both legs finish at exactly `qty` the
   * pair cost IS the total spend divided by `qty` — so the budget alone
   * guarantees the ceiling. The only case the average guard adds anything is a
   * market that ends short of `qty`, and such a market has already failed on
   * share count.
   */
  avgGuard: z.coerce.number().int().min(0).max(1).default(0),
  /**
   * Minimum crossing allowance, as a fraction of `qty`, available from the very
   * first tick.
   *
   * `takePace` ramps the crossing budget from zero, so at t+0 the priority leg
   * may cross nothing at all — and in a window that opens near even, t+0 is the
   * only moment its side is cheap. Combined with `underdogMax` (which stops the
   * other leg from spending in the meantime) this is what lets the player commit
   * to a leg in the opening seconds instead of watching it run away.
   *
   * At 1 the elapsed-time throttle is gone entirely and `takePace` no longer
   * does anything; that is what ships, because level 6 measures 20 of 20 at 1
   * and 0.5 against 15 of 20 at 0. The ceiling guard, not the clock, is what
   * bounds how much the player may take.
   */
  takeFloor: z.coerce.number().finite().min(0).max(1).default(1),
  /**
   * 1 ⇒ the priority leg is chosen once and then held for the window.
   *
   * The plan this strategy plays is "buy leg A while it is still cheap, collect
   * leg B once it has been abandoned". That is a commitment, and re-deciding it
   * every tick destroys it: whichever leg is currently cheaper (or currently
   * rising) keeps swapping into the role, so BOTH legs end up bought around
   * 0.5 — the one shape whose pair can never come in under the ceiling. Only
   * conviction may re-latch, because that is the case where the opening read
   * was genuinely superseded.
   */
  priorityLatch: z.coerce.number().int().min(0).max(1).default(0),
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
  /** Debug log interval in ms. Drop to ~1000 to watch a fast window tick by tick. */
  debugEveryMs: z.coerce.number().finite().positive().default(60_000),
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
  /**
   * Set when `order_open` arrives. A cancel may only be sent for an order that
   * is provably resting, because both messages travel with the same simulated
   * latency and independent jitter: a cancel issued on the tick after the place
   * can arrive FIRST, find nothing to cancel, and be dropped as a silent no-op
   * with no terminal event. The strategy would then wait forever for an
   * `order_done` that is never coming, holding its one permitted live order per
   * outcome hostage — the leg simply stops trading for the rest of the window.
   * Waiting for the acknowledgement costs one tick and makes that impossible.
   */
  acked: boolean
  /** When the cancel was requested — used to re-send one that went missing. */
  cancelAtMs: number
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
  // Latched priority leg — see `momDeadband`.
  let priorityLeg: Side | null = null
  // Committed priority leg for the whole window — see `priorityLatch`.
  let latched: Side | null = null

  // diagnostics
  let minAsk: Record<Side, number> = { UP: Infinity, DOWN: Infinity }
  let minAskAtMs: Record<Side, number> = { UP: 0, DOWN: 0 }
  let ticks = 0
  let lastLogMs = 0

  let summaryLogged = false

  /**
   * Cancel a resting order, but only once the exchange has acknowledged it, and
   * re-send a cancel that produced no terminal event. Both guards exist because
   * a cancel is silently dropped when it reaches the book before the order it
   * refers to; the leg would then hold its single permitted live order forever.
   */
  const cancelIntent = (side: Side, nowMs: number, reason: string): Intent | null => {
    const o = live[side]
    if (!o || !o.acked) return null
    if (o.cancelRequested && nowMs - o.cancelAtMs < CANCEL_RETRY_MS) return null
    o.cancelRequested = true
    o.cancelAtMs = nowMs
    return { kind: 'cancel_order', clientOrderId: o.clientOrderId, reason }
  }

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

    const logNow = cfg.debug === 1 && nowMs - lastLogMs >= cfg.debugEveryMs
    if (logNow) lastLogMs = nowMs
    const logTick = (lead: Side | null, conv: number, tgt: Partial<Record<Side, number>>): void => {
      if (!logNow) return
      console.log(
        `[pair.v1] t+${Math.round(elapsed / 1000)}s askUp=${askUp.toFixed(3)} askDown=${askDown.toFixed(3)} ` +
          `held=${held.UP.toFixed(0)}/${held.DOWN.toFixed(0)} spent=${spent.toFixed(1)} ` +
          `lead=${lead ?? '-'} conv=${conv.toFixed(2)} ` +
          `tgt=${tgt.UP?.toFixed(2) ?? '-'}/${tgt.DOWN?.toFixed(2) ?? '-'} ` +
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
        const stillNeeded = side === 'UP' ? needUp : needDown
        if (stillNeeded > 0 && !stopPosting) continue
        const c = cancelIntent(side, nowMs, 'done')
        if (c) intents.push(c)
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
      if (cfg.avgGuard === 0) return Infinity
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
    // Conviction: how hard the book is already leaning. At full conviction the
    // favourite is chased (it will never be cheaper), the reserve held back for
    // the underdog shrinks (it will be cheap), and the crossing throttle opens
    // (its window is measured in seconds).
    const edge = Math.abs(askUp - askDown)
    const conv =
      cfg.convEdge >= 1 || elapsed > cfg.convUntil * WINDOW_MS
        ? 0
        : cfg.convFull > cfg.convEdge
          ? Math.min(1, Math.max(0, (edge - cfg.convEdge) / (cfg.convFull - cfg.convEdge)))
          : edge >= cfg.convEdge
            ? 1
            : 0
    const mix = (base: number, full: number): number => base * (1 - conv) + full * conv

    const soloShare = mix(cfg.soloShare, cfg.convShare)
    const capFirst = soloShare * cfg.pairCeil

    // Bid ceiling per side WITHOUT the "stay behind the ask" term. Crossing is
    // judged against this: it is the price the ceiling and the budget allow us
    // to pay, whether we wait for the book or reach out and take it.
    const cap: Partial<Record<Side, number>> = {}
    const target: Partial<Record<Side, number>> = {}
    // The priority leg, once both legs are contested — the underdog pace below
    // keys off it. Null when only one leg is left, where pacing has no meaning.
    let leadSide: Side | null = null
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
        const diff = mUp - mDown // > 0 ⇒ UP is the leg running away
        if (priorityLeg === null || Math.abs(diff) >= cfg.momDeadband) {
          priorityLeg = diff !== 0 ? (diff > 0 ? 'UP' : 'DOWN') : askUp <= askDown ? 'UP' : 'DOWN'
        }
        first = priorityLeg
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
      // A book leaning this hard overrides the trend reading: chase the favourite.
      if (conv > 0) first = askUp >= askDown ? 'UP' : 'DOWN'
      if (cfg.priorityLatch === 1) {
        if (conv > 0 || latched === null) latched = first
        first = latched
      }
      leadSide = first
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
      // Only what the underdog is ACTUALLY allowed to pay needs reserving. With
      // `underdogMax` in force, reserving 0.9 × its ask instead caps the
      // priority leg near 0.49 in a near-even opening — one cent under the ask
      // plus the taker fee, which is exactly how a leg that had to be taken in
      // the first seconds never got taken at all.
      const reserve = Math.max(
        cfg.minPrice,
        mix(cfg.leadReserve, cfg.convReserve) * Math.min(askSecond, cfg.underdogMax),
      )
      const capOfFirst = Math.min(
        cfg.maxPrice,
        capFirst,
        avgCap(first, sizeFirst),
        (budgetLeft - needSecond * reserve) / needFirst,
      )
      const bidFirst = floorTick(Math.min(askFirst - TICK, capOfFirst))
      // What the underdog may pay is whatever the ceiling still holds once the
      // priority leg is finished at today's price. A FIXED split cannot do this
      // job: set it wide and the underdog buys at 0.4 in the opening minutes,
      // spending the ceiling on a coin flip; set it narrow and a genuinely
      // mid-priced underdog is starved until the priority leg completes — which
      // is how a window ends 0/1000. This projection is both at once, and it
      // self-corrects: every cent the priority leg runs away costs the underdog
      // a cent of allowance, and every cent it falls back hands one over.
      const projPrice = Math.min(capOfFirst, mix(askFirst + cfg.leadPad, capOfFirst))
      const projFirst = (basis[first] + needFirst * Math.max(0, projPrice)) / cfg.qty
      const underdogRamp =
        cfg.underdogRamp <= 0 ? 1 : Math.min(1, elapsed / (cfg.underdogRamp * WINDOW_MS))
      const capOfSecond =
        Math.min(
          cfg.maxPrice,
          cfg.underdogMax,
          cfg.pairCeil - projFirst,
          avgCap(second, sizeSecond),
          (budgetLeft - needFirst * Math.max(0, bidFirst)) / needSecond,
        ) * underdogRamp
      cap[first] = capOfFirst
      cap[second] = capOfSecond
      target[first] = bidFirst
      target[second] =
        cfg.postSecondLeg === 1
          ? floorTick(Math.min(askSecond - TICK, capOfSecond * (1 - cfg.underdogDiscount)))
          : -1
    } else if (needUp > 0) {
      cap.UP = Math.min(budgetLeft / needUp, avgCap('UP', Math.min(needUp, cfg.clip)))
      target.UP = floorTick(cap.UP)
    } else {
      cap.DOWN = Math.min(budgetLeft / needDown, avgCap('DOWN', Math.min(needDown, cfg.clip)))
      target.DOWN = floorTick(cap.DOWN)
    }
    logTick(leadSide, conv, target)

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
      // Shares this leg may still acquire: the imbalance throttle, and the
      // accumulation pace that stops a one-way window from being bought
      // entirely at the expensive end of its own trend.
      // Underdog pacing only, and conviction opens even that gate: when the
      // favourite's only affordable moment is the next thirty seconds,
      // rationing anything by the clock is fatal.
      const paceRoom =
        cfg.fillPace <= 0 || leadSide === null || side === leadSide
          ? Infinity
          : cfg.qty * Math.max(conv, Math.min(1, elapsed / (cfg.fillPace * WINDOW_MS))) - held[side]
      // Opening cap: before `openMs` no leg may exceed `openShare` of its
      // target, however confident the tick-zero read looks.
      const openRoom =
        cfg.openShare >= 1 || elapsed >= cfg.openMs
          ? Infinity
          : cfg.openShare * cfg.qty - held[side]
      // Sub-share room is dust: posting it would churn the book for nothing.
      const roomRaw = Math.min(
        Math.max(0, cfg.maxImbalance - lead),
        Math.max(0, paceRoom),
        Math.max(0, openRoom),
      )
      const room = roomRaw < Math.min(1, need) ? 0 : roomRaw

      if (need <= 0 || want === undefined || room <= 0) {
        const c = cancelIntent(side, nowMs, 'filled')
        if (c) intents.push(c)
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
      // `conv` opens the throttle outright: rationing the favourite by elapsed
      // time locks crossing out for seconds after the very first clip, which is
      // most of the window it had.
      const paceTarget =
        cfg.qty *
        Math.max(
          conv,
          cfg.takeFloor,
          Math.min(1, elapsed / (mix(cfg.takePace, cfg.convTakePace) * WINDOW_MS)),
        )
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
        const c = cancelIntent(side, nowMs, 'too-low')
        if (c) intents.push(c)
        continue
      }

      // One live BUY per outcome, at most `clip` shares: the target is reached
      // by repeated fills rather than by a single large order.
      const size = Math.min(need, cfg.clip, room)

      if (!o) {
        const clientOrderId = `pg-${side}-${++seq}`
        live[side] = { clientOrderId, price, size, cancelRequested: false, acked: false, cancelAtMs: 0 }
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

      // Reprice on a real move (>= 1 tick), or when the resting order is now
      // larger than what is still needed (a partial fill on the other path).
      // Never re-post merely because a fill made room for a bigger clip: `size`
      // is already the cap, and churning would lose queue position for nothing.
      if (o.cancelRequested || Math.abs(o.price - price) >= TICK - 1e-9 || o.size > size + 1e-9) {
        const c = cancelIntent(side, nowMs, o.cancelRequested ? 'cancel-retry' : 'reprice')
        if (c) intents.push(c)
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
    if (ev.kind === 'order_open') {
      for (const side of ['UP', 'DOWN'] as Side[]) {
        const o = live[side]
        if (o && o.clientOrderId === ev.clientOrderId) o.acked = true
      }
    } else if (ev.kind === 'order_done') clear(ev.clientOrderId)
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
