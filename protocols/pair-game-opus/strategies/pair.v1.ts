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
 * fifth of the target is what makes being wrong survivable, and `edgeFull`
 * generalises that cap: a leg may hold only as much of its target as the gap
 * between the two asks has already revealed, so a position grows with the
 * evidence behind it rather than with the clock.
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
 * The fifth thing is not in the book at all. Everything above reads the two
 * asks, and a window whose asks spend six minutes crossing around 0.50 gives
 * that machinery nothing to work with: the priority role changes hands on every
 * swing and both legs end up bought near half a dollar, which is the one shape
 * whose pair can never come in under the ceiling. BTC's own distance from the
 * price to beat is an independent reading of the same question. Turned into a
 * probability — a random walk of scale `ptbSigma` over the time still left — it
 * can be compared directly with the probability the book is quoting, and where
 * the two disagree the book is paying up for an outcome the underlying does not
 * support (`ptbFair`). The player then chases the other leg, which is both
 * cheaper now and, on that reading, likelier to win. Three qualifications make
 * it safe rather than merely clever: the disagreement must persist rather than
 * flicker (`ptbFairTauMs`), it must exceed a deadband (`ptbFairEdge`), and it
 * may not touch the opening lean (`ptbFairAfterMs`) — a book that opens at
 * 0.41/0.60 knows something BTC, which starts every window exactly on its own
 * strike, cannot yet know. The deadband is not one number but two: a smaller
 * disagreement is enough to redirect the chase when the leg it names is already
 * far behind (`ptbFairMinLag`, `ptbFairLagEdge`), because redirecting towards a
 * lagging leg and rebalancing are then the same action.
 *
 * Nothing here branches on slug, timestamp or outcome: the only inputs are the
 * live books, the window clock, the public price feeds and our own inventory.
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
import type { ExternalFeedsSnapshot } from '../../../src/trading/feeds/externalFeeds.js'
import { ExternalFeedsRequestPlugin } from '../../../src/strategy/plugins/ExternalFeedsRequestPlugin.js'
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
  /**
   * Fee-inclusive ceiling for the cost of one UP+DOWN pair. RULES fail a market
   * above 0.98, so 0.97 leaves a cent of headroom against the fee estimate.
   *
   * That headroom is real and it is nearly all unused: over the first sixty-eight
   * markets the realized pair cost is 0.955 at the lower quartile, 0.962 at the
   * median and 0.969 at the worst — the player spends essentially its whole
   * allowance in every market it passes. Which is the single most useful thing to
   * know about this ladder: there is no slack anywhere, so any rule that
   * withholds money from a leg does not make the player careful, it makes some
   * market end short. It is why five separate families of restraint all cost
   * between nine and forty-three markets.
   *
   * Raising it is SAFE and INERT. At 0.975 (with `finishCeil` at 0.978) the first
   * sixty-eight still show exactly the baseline single failure and the worst
   * realized cost is 0.9758, comfortably inside the rule. At 0.978/0.98 the worst
   * is 0.9784. So half a cent to a cent of extra budget is available on demand —
   * it simply does not buy anything by itself, and handed to a reserve
   * escalation it is spent re-enabling the purchase the escalation was meant to
   * refuse (`reserveLow` 0.8 goes from nine failures to seven, and stops
   * repairing the level 68 window).
   */
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
   *
   * Re-measured against level 47, where the arithmetic said it should work: both
   * blocking windows die because the budget is spent finishing the leg that
   * expires worthless, and refusing to finish it leaves exactly enough money to
   * buy the winner during the reversal. It does save the money — 300 caps the
   * losing leg at 581 shares and the spend at 484 of 970 — and the winning leg
   * still does not move a share (281 and 344, unchanged to the decimal). The
   * saved budget cannot be spent because the leg that needs it is capped
   * somewhere else: at the reversal the player's bid is 0.52 against an ask of
   * 0.56, held there by the reserve `reserveLow` sets aside for the leg it is
   * abandoning. Money is not the constraint on the winning leg; the bid is.
   * Combined with `swapEdge` it is worse than either alone — the imbalance cap
   * then prevents EITHER leg from finishing (600/300 on both blockers at 300,
   * and it re-breaks at 450 and 600 what `swapEdge` alone repairs).
   *
   * Paired with the reserve switched off — the two constraints the tick record
   * says are binding, released together — it is by far the closest either
   * blocking window has come: the winning leg climbs from 281 / 344 shares to
   * 656 / 778 at a cap of 300, and to 800 / 750 at a cap of 150. Neither
   * finishes, and the reason is the one the ceiling has always had: forcing the
   * legs to take turns buys both of them near half a dollar, and market 47 at
   * 950/800 has a pair cost of 1.10. Share count and pair cost trade against
   * each other here, and this pair of knobs sits on the wrong end of that trade.
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
  /**
   * How long the book must have been leaning by at least `convEdge`, without a
   * break, before conviction may act on it. 0 ⇒ act on the first tick that
   * shows the lean.
   *
   * Conviction reads the opening book and buys the dearer leg, on the argument
   * that a window which opens trending never offers the favourite cheaper. The
   * argument is sound and it is why the mechanism exists — but at t+0 there is
   * no history at all, so "the book is leaning" and "the book happens to be
   * quoted apart on its first tick" are the same observation, and the player
   * commits a full opening clip to the dearer side on it.
   *
   * The level 68 window is that mistake in isolation. It opens 0.44 / 0.58, an
   * edge of 0.14 against a `convEdge` of 0.12, and the player pays 0.5955 for
   * two hundred shares of the dearer leg in the first second. One second later
   * the edge is 0.11 and the lean is gone; it never returns, the window sits at
   * even money for ten minutes and settles the other way. Nothing about that
   * opening tick was information.
   *
   * Requiring the lean to SURVIVE is the cheapest possible test of it, and it
   * is the only restraint on this player that costs nothing when it is wrong:
   * it acts before any money has been committed, and the most it can lose is
   * `convDwellMs` of the favourite's cheapest stretch. Every other family tried
   * on this window — share caps, price caps, spend paces, reassigning the
   * chase, a money-velocity cap — refuses a purchase the player has already
   * half-paid for.
   *
   * MEASURED INERT on the window it was built for, and the reason is worth more
   * than the knob. At 1, 2, 3 and 5 seconds the level 68 window ends on exactly
   * the same 1000/344, to the cent. Gating conviction DOES change the opening
   * tick — the player leads with the cheap leg at t+0 — and then momentum picks
   * the dearer leg back one tick later and buys the identical two hundred shares
   * at the identical price, because the ask EMA is seeded at t+0 and a one-cent
   * uptick on the second tick of a window reads as a leg running away. Refusing
   * the opening lean is not enough; the direction rule has to be replaced, which
   * is what `openCheapMs` does.
   */
  convDwellMs: z.coerce.number().finite().min(0).default(0),
  /**
   * How much of the OTHER leg's current ask, rather than `underdogMax`, the
   * priority leg must leave behind for it. 0 reserves at `underdogMax`; 1
   * reserves the other leg's full shown price.
   *
   * Reserving at `underdogMax` is a bet that the leg not being chased will end
   * up nearly worthless. That bet is right in a trending window and it is how a
   * priority leg is allowed to spend most of the ceiling. It is wrong in a
   * window whose two asks keep crossing: the player completes the leg it was
   * chasing, discovers the other leg is the one that ran, and has nothing left
   * to buy it with.
   *
   * Measured on level 19 and it does NOT rescue that market: 0.2, 0.4, 0.6 and
   * 1.0 all still lose it, and from 0.4 upward they lose earlier markets too
   * (the reserve starves a leg that genuinely had to be chased). Ships disabled.
   */
  reserveAsk: z.coerce.number().finite().min(0).max(1).default(0),
  /**
   * Fraction of the OTHER leg's own cheapest observed ask that must stay
   * reserved for it, whatever the rest of the budget split says. 0 disables it.
   *
   * The priority leg's price cap is `(budgetLeft − needSecond × reserve) /
   * needFirst`, and `reserve` is normally `underdogMax` — a bet that the leg not
   * being chased ends the window nearly worthless. In a trending market that bet
   * is right and it is what lets the favourite be bought at all. In a market
   * that opens leaning, runs, and then reverses for good, it is what kills the
   * player: the favourite is completed at 0.68 on the strength of an assumption
   * that the other leg will be available at 0.09, the reversal arrives, and the
   * leg that has to be bought never trades below 0.30 again.
   *
   * The other leg's own cheapest ask so far is a fact rather than an assumption,
   * and it is the right one to plan against, because it is the price the player
   * has actually seen and can hope to see again. Reserving against it costs
   * nothing in a trending window — the loser keeps setting new lows, so the
   * reserve keeps shrinking on its own — and in a reversing one it stops the
   * favourite from spending money the second leg is going to need.
   *
   * It has to stand down for the opening seconds for the same reason
   * `underdogMax` exists: at t+0 the other leg's low IS its opening ask, near
   * 0.50, and reserving that much leaves the favourite unable to buy anything at
   * all in the one moment it is affordable (`reserveLowAfterMs`).
   *
   * SHIPS AT 0.6, after two sessions of rejecting it, and the reversal is worth
   * understanding because it is about WHICH leg the cap catches rather than
   * about the number.
   *
   * The standing objection to every price cap in this strategy is that capping
   * what a leg may pay does not stop the leg being bought: the taker fill
   * becomes a resting maker bid a few cents lower, and a leg that then FALLS
   * runs straight through it, so the same thousand shares of the same losing
   * outcome are acquired anyway. That objection is exactly right for the market
   * that blocked level 37, where the over-bought leg collapses afterwards — and
   * that market is now handled by `earlyShare`, which bounds size instead.
   *
   * The market that blocks level 40 is the mirror image. There the priority leg
   * is chased UPWARD, from 0.50 to 0.68 over twenty seconds, and completed —
   * against a reserve of `underdogMax` that assumes the other leg will be
   * available at 0.10, when it has never traded below 0.43 and never will trade
   * below 0.16. A bid left behind at 0.53 does not get run through, because the
   * leg is going the other way; it simply does not fill. Against a rising leg a
   * price cap is a size cap, and this is the case the reserve floor is for.
   *
   * Measured over the first forty markets with `finishShare` in force: 0.55,
   * 0.6 and 0.65 pass all forty, repeatedly. 0.5 is too small to hold the
   * fortieth market back (468/1000) and 0.7 is large enough to starve the
   * twenty-sixth, which is refused outright and ends at a sixth of its target —
   * the failure `chasePad` documents. 0.6 is the middle of that band. Treat the
   * edges as real: this is a reserve against a leg that has to be bought, so
   * too much of it does not make the player cautious, it makes it unable to buy
   * the outcome that wins.
   *
   * RE-MEASURED over the first sixty-eight, with `finishCeil`, `commitReserve`
   * and `oracleReserve` all in force, because the reserve is what lets the level
   * 68 window finish its leading leg at 0.62 against a leg that has never traded
   * below 0.38: the floor there is 0.228 a share when the honest number is 0.38,
   * and the missing 0.15 × 656 shares is exactly the money the pair needed.
   * Raising it does repair that window — and the band the level 40 measurement
   * found is still the band. Failures against a baseline of 1: 0.7 → 3, 0.8 → 9,
   * 0.9 → 9, 1.0 → 11. Only 0.8 repairs the specimen, and it breaks nine other
   * markets to do it; 0.7 breaks three and does not repair it. The casualties are
   * always the same shape — a leg that genuinely had to be chased is refused and
   * ends at a fifth or a third of its target, several at 200/1000 or 0/1000.
   */
  reserveLow: z.coerce.number().finite().min(0).max(1).default(0.6),
  /** Milliseconds into the window before `reserveLow` engages. */
  reserveLowAfterMs: z.coerce.number().finite().min(0).default(20_000),
  /**
   * Share of the remaining budget the other leg's HONEST cost may take up before
   * the reserve is allowed to discount it. 0 disables the rule.
   *
   * `reserveLow` reserves 0.6 of the other leg's own cheapest observed ask, and
   * the 0.4 it shaves off is a bet: the leg will be cheaper than it has ever
   * been by the time it is bought. A flat sweep says that bet cannot simply be
   * made smaller — 0.7, 0.8, 0.9 and 1.0 cost three, nine, nine and eleven of
   * the sixty-seven markets that pass, because the same discount is what lets a
   * leg that genuinely has to be chased be bought at all.
   *
   * But there is a moment when the discount buys nothing: while the honest
   * number still FITS. If finishing the other leg at the cheapest price it has
   * actually shown costs less than the money in hand, shaving the reserve does
   * not enable a purchase the player could not otherwise make — it just licenses
   * the leg being chased to spend money that is not spare. Discounting is worth
   * something only once the plan genuinely depends on the other leg getting
   * cheaper than it has ever been.
   *
   * That is the whole of the level 68 window. At eighty seconds the player holds
   * 719 of one leg and 344 of the other, with $369 left; the other leg has never
   * traded below 0.38 and 656 of them cost $249, which fits. The discounted
   * reserve prices them at $150 instead, and the $99 difference is exactly what
   * pays for the last 281 shares of the leading leg at 0.62 — the purchase that
   * loses the market.
   *
   * MEASURED AND NOT SHIPPED: at 0.7 and at 1.0 it moves the level 68 window
   * from 1000/344 to 1000/594 and still loses it, which is the same place a flat
   * `reserveLow` of 1.0 lands. The honest reserve does stop the leading leg
   * being finished at 0.62; what it does not do is get the other leg bought,
   * because the leg that is not the priority is still held to `underdogMax`. The
   * gate is sound and the deadlock behind it is the one this player keeps
   * hitting.
   */
  reserveFull: z.coerce.number().finite().min(0).default(0),
  /**
   * How far above its OWN running low ask the priority leg may pay. 1 disables it.
   *
   * Every other rule the player owns is instantaneous: it reads the two asks at
   * this tick and nothing else. That is enough in a trending window, where the
   * current price IS the whole story, and it is exactly wrong in a whipsawing
   * one. There the priority role changes hands every time the asks cross, and
   * each time it changes the newly-promoted leg is bought at whatever it costs
   * NOW — which, after a swing, is well above what the same leg traded at two
   * minutes ago. Both legs end up bought near 0.5 by taking turns, which is the
   * one shape whose pair can never come in under the ceiling.
   *
   * Giving each leg a memory of its own cheapest ask so far turns that around.
   * A leg may be chased only while it is at or near its own low, so:
   *   - in a monotone trend the losing leg keeps setting new lows and stays
   *     buyable the whole way down, while the winner is bought in its first
   *     seconds when its low IS its current price — unchanged behaviour;
   *   - in a whipsaw the second and third swings are refused outright, because
   *     the leg being re-promoted has already been seen cheaper.
   *
   * It is deliberately NOT applied to the underdog (`underdogMax` already holds
   * that leg to a loser's price) nor to a leg left alone after its partner has
   * finished, where there is no decision left to protect and the shares simply
   * have to be bought.
   *
   * MEASURED AND REJECTED, and the reason is structural rather than a matter of
   * tuning. On level 19's whipsaw market alone the cap works exactly as
   * designed: 0.03, 0.05 and 0.08 all finish 1000/1000 at pair costs of 0.79 to
   * 0.90, against 1.07 and 1000/687 without it. Across the level it loses more
   * than it wins at every setting tried — ungated 8 to 13 of 19; gated on the
   * other leg's realized average (0.10 / 0.20 / 0.30) 9 to 10; gated on elapsed
   * time 11 to 18; measured over a trailing window instead of the whole market
   * 7 to 15; released late 10 to 16. The best of them, pad 0.05 released at
   * four tenths of the window, wins market 19 and loses three others.
   *
   * Every one of those failures is a share count, never a pair cost — the
   * refused markets routinely finish at 0.65 to 0.90 on a leg that reached only
   * 200 of 1,000. That is the structural objection: the leg the cap refuses is
   * by construction the one whose ask is rising, which in a market that does
   * trend is the winner, and the winner is only ever cheap early. So the cap
   * systematically pushes the budget into the leg that is falling — the loser —
   * and the player ends holding all of the wrong outcome at an excellent price.
   * A price cap on the chase cannot tell the two cases apart, because a leg
   * bought back above its own low looks identical in both.
   */
  chasePad: z.coerce.number().finite().min(0).max(1).default(1),
  /**
   * Milliseconds into the window before `chasePad` engages. 0 ⇒ from the open.
   *
   * The cap must not touch the move that pays for the whole strategy. A window
   * that trends identifies its winner in the first minute or two, and the
   * winner is affordable only there — blocked at the open it is never bought at
   * all, and the market ends 200/1000. So the cap has to stay out of the way
   * while the winner is still being established, and only then start refusing.
   *
   * After that point the argument reverses. A leg still being chased minutes
   * into the window is one whose price has already been all over the place;
   * every cent it is now above its own low is a cent that was available earlier
   * and was not taken, and paying it commits the ceiling to a leg the window
   * has not actually settled on.
   */
  chaseAfterMs: z.coerce.number().finite().min(0).default(0),
  /**
   * Length of the trailing window `chasePad` measures its low over. 0 ⇒ the
   * whole market.
   *
   * A low that never expires cannot tell a trend from a whipsaw, and the two
   * need opposite treatment. In a market that trends from the first tick, the
   * winner's cheapest ask IS its opening ask, so a lifetime low pins the cap at
   * the open and the leg that has to be bought all the way up is never bought
   * at all. In a market that swings, the leg being re-promoted was cheap a
   * minute ago and the cap should refuse it.
   *
   * Measuring the low over a trailing window separates them. Under a steady
   * trend the trailing low walks up behind the price and the cap stays clear of
   * it, so nothing changes. Under a swing the dip is still inside the window
   * and the cap bites. The window therefore has to be long enough to still
   * remember the last dip and short enough to forget the open.
   */
  chaseLookbackMs: z.coerce.number().finite().min(0).default(0),
  /**
   * Fraction of the window after which `chasePad` stops applying. 1 ⇒ never.
   *
   * A price cap with no release is a share-count failure waiting to happen, and
   * that is exactly how every ungated variant of `chasePad` loses: a leg gets
   * refused at 0.61, its price never returns, and the market ends 200/1000 with
   * an excellent pair cost on 200 pairs and no pass. The refusal is only worth
   * making if the player still intends to finish the leg.
   *
   * Releasing it late costs much less than it looks. By then the window has
   * decided, so the leg that was refused is either the loser — now trading at a
   * few cents, and the refusal saved most of its cost — or the winner at 0.90,
   * paid for out of a partner leg that the same decisiveness has made nearly
   * free. What is NOT survivable is paying 0.60 for a leg in the third minute
   * of a window that has not decided anything, which is what the cap is there
   * to stop.
   */
  chaseUntil: z.coerce.number().finite().min(0).max(1).default(1),
  /**
   * 1 ⇒ the `edgeFull` pace budgets the TWO legs together instead of each
   * separately.
   *
   * Per leg, the pace is not the guard it looks like. At an edge a third of
   * `edgeFull` it permits a third of the UP target AND a third of the DOWN
   * target, and a window whose priority role changes hands in its first seconds
   * takes both: the player ends ten seconds in holding a quarter of each leg,
   * every share bought around 0.5, a quarter of the ceiling gone and the pair
   * already priced at 1.00. Nothing later recovers that, because the only way
   * back under the ceiling is a leg bought cheap, and the budget for it is
   * spent.
   *
   * The edge measures how much the window has revealed, and what it has
   * revealed is a total amount of information, not one allowance per side. Held
   * jointly, the same reading says: own as many shares as the book has earned,
   * distributed however the priority rule currently likes. A flip then costs
   * nothing — the newly promoted leg simply spends the allowance the demoted
   * one was using, instead of opening a second one.
   *
   * Measured neutral and it ships off. It holds all eighteen passing markets at
   * `edgeFull` 0.24, 0.32 and 0.40, so the joint pace costs nothing there, and
   * it does change the whipsaw market's shape — the double purchase in the
   * opening ten seconds stops happening. It still does not win that market: the
   * allowance has to lapse once the edge is full (a shared budget of `qty`
   * cannot carry two legs of `qty` each, and without the release both legs
   * deadlock short — 3 of 19), and the moment it lapses the player buys the
   * same leg at the same high price, finishing 1000/144 instead of 1000/688.
   * Worth keeping on the shelf: it is the only change measured this session
   * that costs nothing, so it is the natural carrier for a rule that also fixes
   * what happens after the release.
   */
  pairEdge: z.coerce.number().int().min(0).max(1).default(0),
  /**
   * Exponent by which `underdogMax` lifts toward the budget's own allowance as
   * the priority leg fills. 0 disables the lift.
   *
   * The player holds two rules about the second leg that contradict each other.
   * The budget reserves it a real per-share allowance — whatever the ceiling
   * still holds once the priority leg is projected to completion, often 0.3 or
   * more — and `underdogMax` then forbids it from paying above 0.10. In a
   * trending window that contradiction is invisible, because the second leg
   * really does fall to a few cents and the reserve is never needed. In a
   * window where the second leg turns out to be the winner it is fatal: the
   * money is set aside, the leg never trades under 0.10, and the reserve is
   * carried unspent to settlement while the market fails on share count. Runs
   * that reserve aggressively show it plainly — a pair cost comfortably inside
   * the ceiling on a leg that only ever reached a third of its target.
   *
   * The lift resolves it in the order the information arrives. While the
   * priority leg is still being built the player has not committed to anything
   * and the 0.10 cap is right: a second leg filling at 0.45 in the first minute
   * is the classic way to lose a window. Once the priority leg is nearly
   * finished the bet is made, the ceiling's remainder exists for exactly one
   * purpose, and refusing to spend it buys nothing. Raising the exponent keeps
   * the cap near 0.10 for longer and hands the allowance over later.
   *
   * Measured inert on its own — 18 of 19 at exponents 1, 2, 3 and 5, with the
   * whipsaw market unchanged to the cent — because by the time the priority leg
   * is nearly full the budget it was supposed to hand over has already been
   * spent. Paired with `reserveAsk` 0.7 or 1.0, which is what actually keeps
   * money back, it is worse than either alone (14 to 17 of 19) and the whipsaw
   * market still ends short. Ships off, with the contradiction it describes
   * left standing and unresolved.
   */
  underdogLift: z.coerce.number().finite().min(0).max(8).default(0),
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
   * runs) and won with it anywhere from 0.08 to 0.50.
   *
   * Level 14 narrowed that band from above. Its fourteenth market whipsaws — the
   * two asks cross five times in seven minutes — so the priority role keeps
   * changing hands and BOTH legs get bought around 0.5 by taking turns. The
   * lower the cap, the less of the ceiling the leg that is momentarily second
   * can spend before the market changes its mind. Level 14 passes 5 of 5 at
   * 0.03, 0.05, 0.08, 0.10, 0.12 and 0.15, and fails 5 of 5 at 0.17, 0.20 and
   * the old 0.25. It ships at 0.10, roughly the middle of the surviving band and
   * about where a losing leg trades late in these windows.
   */
  underdogMax: z.coerce.number().finite().min(0.02).max(1).default(0.1),
  /**
   * Share of `qty` the NON-priority leg must already hold before `underdogMax`
   * stops applying to it and the ordinary budget cap takes over. 1 ⇒ never.
   *
   * `underdogMax` is a bet that the leg not being chased will be sweepable for a
   * loser's few cents at the death. The bet is cheap on an EMPTY leg — losing it
   * costs only the opportunity. It is expensive on a leg that already holds a
   * third of its target, because every one of those shares is worthless unless
   * the leg is finished, and a ten-cent ceiling on the rest is how the player
   * throws away what it has already spent on it.
   *
   * This is the other half of the market-109 diagnosis. The counterfactual that
   * wins that window — finish the leg the player is already holding, at 0.36 to
   * 0.40, while the other leg is being chased — is not blocked by the pace at
   * all after t+115. It is blocked here: the priority flips to DOWN, the 344 UP
   * shares become an underdog's, and their ceiling drops to 0.10 in a window
   * where UP never trades below 0.34 again.
   *
   * WRONG, and measured wrong the moment it was built. At 0.2, 0.3, 0.5 and 0.7
   * market 109 does not move by a single share — same 343.75/1000, same cost to
   * the cent. `underdogMax` is not what refuses that leg. The BUDGET is: the
   * second leg's cap is also `(budgetLeft − needFirst × bidFirst) / needSecond`,
   * and with 800 DOWN still to buy near 0.6 that term is about 0.32 while UP is
   * asking 0.39. Lifting a price ceiling cannot fund a leg whose money has been
   * reserved for the other one — which is the lesson worth keeping: there is one
   * pot, and after the priority flips the leg left behind is not overpriced, it
   * is unfunded. Ships off; kept because it turns an assumption into a fact.
   */
  underdogHeldShare: z.coerce.number().finite().min(0).max(1).default(1),
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
   * Milliseconds at the start of the window during which the CHEAPER leg holds
   * priority, whatever the book's opening lean says. 0 disables it.
   *
   * `openMs`/`openShare` caps the size of the opening guess; this is about its
   * direction. Every priority rule in this file reads "dearer" as "leading" in
   * one form or another — conviction takes the favourite outright, and momentum
   * takes whichever leg ticked up first, which on the second tick of a window is
   * a one-cent coin flip. So the player's first two hundred shares are reliably
   * spent on the more expensive side of a book that has told it nothing.
   *
   * The level 68 window opens 0.44 / 0.58 and the player pays 0.5955 for two
   * hundred shares of the dearer leg inside the first second. Refusing that is
   * the one restraint on this player that is free: no money has been committed
   * yet, so nothing is stranded, and the shares are bought either way — just on
   * the side that costs fourteen cents less.
   *
   * Gated by `openCheapMin` so it cannot fire in a window that opens genuinely
   * trending, where the favourite has to be taken immediately and the cheap leg
   * is the one heading for zero.
   *
   * MEASURED DEAD, and it closes the "the opening is the free move" thread for
   * good. It does exactly what it says: the opening clip moves to the cheap leg
   * and the level 68 window's total cost falls from $785 to $773. It ends on the
   * identical 1000/344 at 3, 6, 15 and 30 seconds — twelve dollars is nothing
   * against a $185 shortfall. And it is not free after all: over the first
   * sixty-eight, fifteen seconds costs EIGHT markets that pass at zero, all with
   * the familiar signature of a leg left at half its target. Leading with the
   * cheap leg means opening on the side that is about to collapse, and the two
   * hundred shares saved at the open are worth less than the head start lost on
   * the side that has to be chased.
   */
  openCheapMs: z.coerce.number().finite().min(0).default(0),
  /**
   * How dear the cheaper leg must still be for `openCheapMs` to apply — i.e. how
   * close to a coin flip the opening book has to be. A window that opens 0.25 /
   * 0.76 has already decided, and leading with its cheap leg would be buying the
   * loser at the only price it will never be worth.
   */
  openCheapMin: z.coerce.number().finite().min(0).max(1).default(0.4),
  /**
   * Milliseconds at the start of the window during which no leg may hold more
   * than `earlyShare` × `qty` shares. The same idea as `openMs`/`openShare`, one
   * stage later and one stage looser.
   *
   * `openMs` protects the tick-zero guess; this protects the whole stretch in
   * which the ONLY evidence available is the order book. The outside price is
   * not allowed to overrule the book until `ptbFairAfterMs`, for good reason —
   * a book that leans in its first seconds is carrying what the market learned
   * before the window opened, and BTC, which starts every window exactly on its
   * own strike, cannot contradict it yet. But that stand-down is also a blind
   * spot: conviction can complete an entire leg inside it, on the book's word
   * alone, and if the window then reverses the budget is gone and the leg that
   * has to be bought is the one that ran.
   *
   * Capping how much may be committed before the outside price is allowed to
   * speak makes that reversal survivable without touching the stand-down
   * itself. The favourite is still bought from the first tick and still bought
   * ahead of everything else; it simply may not be finished on the strength of
   * one opinion.
   *
   * The length matters and it is the stand-down's length, not a free parameter:
   * shortened to 30 s the cap lifts before the override arrives and the market
   * it exists for is lost again exactly as before; extended to 60 s it starts
   * costing trending markets that had finished deciding.
   *
   * Price caps cannot do this job — measured, and the reason is worth keeping.
   * Capping what the priority leg may PAY (`chasePad`, and the reserve floor
   * `reserveLow` below) only converts a taker fill into a resting maker bid a
   * few cents lower, and in a window that reverses the leg falls straight
   * through that bid: the same 1,000 shares of the same losing outcome are
   * bought anyway, slightly cheaper. Only a cap on SIZE stops the commitment.
   *
   * 1 disables it.
   */
  earlyMs: z.coerce.number().finite().min(0).default(45_000),
  /**
   * Fraction of `qty` any one leg may hold before `earlyMs`. 1 disables the cap.
   *
   * The surviving band is narrow and it is not smooth: with the two gates below
   * in force, 0.5 leaves one market of the first forty unsolved, 0.4 leaves
   * two and 0.45 leaves three. Treat a change here as a change of behaviour, not
   * a tuning nudge.
   */
  earlyShare: z.coerce.number().finite().min(0).max(1).default(0.5),
  /**
   * Fraction of `qty` the OTHER leg must already hold before `earlyShare`
   * applies to this one. 0 ⇒ the cap is unconditional.
   *
   * Unconditional, the cap costs more than it saves, and the markets it costs
   * say why: a window that trends from its first tick has to have its favourite
   * finished inside the first minute, because that is the whole time the
   * favourite is affordable, and a cap that stops it at four tenths of target
   * leaves the leg unbought when the price has gone. Restraint is not free.
   *
   * What separates those windows from the ones the cap is for is not how far
   * the book has leaned but whether the player has ALREADY been made to buy both
   * sides. `underdogMax` holds the non-priority leg to a loser's price, so in a
   * window that trends the second leg simply does not fill early — the player
   * owns one leg and nothing else. The second leg only accumulates when the
   * priority role has changed hands, which means the book has contradicted
   * itself, and both legs are then being bought at coin-flip prices. That is
   * exactly the window that must not be finished on the book's word alone, and
   * it identifies itself by the player's own inventory rather than by any
   * reading of the quote.
   *
   * Where this threshold sits decides which windows the cap can see at all.
   * Below 0.35 (measured at 0, 0.05, 0.15, 0.25, 0.3) it starts catching
   * trending windows whose second leg picked up a token fill; at 0.4 the windows
   * it exists for slip under the bar and the market that blocked level 37 is
   * lost again.
   *
   * 0.35 is also where the mechanism stops being FRAGILE, which matters more
   * than where it scores best on one pass. At 0.25 and 0.3 the fourth market of
   * the universe becomes bistable — the same data finishes 1000/1000 or
   * 632/1000 depending on nothing but order latency, because the cap leaves both
   * legs half-built and the second one can then only be finished during the
   * seconds the outside-price override happens to be pointing at it. A level
   * that passes three runs in four is not passed. At 0.35 that market is
   * 1000/1000 in every run, because the cap never engages there at all.
   */
  earlyBoth: z.coerce.number().finite().min(0).max(1).default(0.35),
  /**
   * 1 ⇒ `earlyShare` restrains a leg only while the outside price DISAGREES
   * with buying it.
   *
   * `ptbFairAfterMs` makes the disagreement wait 45 s before it may switch the
   * priority leg, and the reason is sound: the book's opening lean carries what
   * the market learned before the window began, and BTC, sitting exactly on its
   * own strike, cannot contradict it yet. But that argument is about
   * OVERRULING the book. It says nothing against using the same reading, in the
   * same seconds, for the far weaker purpose of deciding how much to commit —
   * and the price to beat arrives about three seconds into the window, so the
   * reading is there long before the override may use it.
   *
   * This is what separates the two windows the unconditional cap cannot tell
   * apart. Both open near even, buy a few hundred of each leg, and then run
   * hard on one side. In the one that keeps running, the model agrees with the
   * book the whole way up — the underlying really has moved — and the leg must
   * be finished immediately, because it is never cheaper again. In the one that
   * reverses, the book is quoting 0.68 while the model reads 0.58, and the
   * player is being asked to spend its ceiling on an outcome the underlying does
   * not support. Restraint belongs to the second case only.
   *
   * It is worth two markets on its own: with the cap otherwise unchanged, the
   * first forty go from thirty-seven passing to thirty-nine.
   *
   * The permission LATCHES, and that is not a detail. Whether the gap sits above
   * or below `ptbFairEdge` at a given instant is exactly the kind of reading
   * that a few milliseconds of order latency can flip, and a cap that switches
   * on and off across that boundary makes the whole market bistable: measured on
   * the fourth market of the universe, an unlatched release finishes 1000/1000
   * in about three runs out of four and 632/1000 in the rest, from the same
   * data. Latched, that market is 1000/1000 every time. A window where the
   * outside price has at some point backed this leg is not a window where the
   * player is committing on the book's word alone, and that fact does not stop
   * being true when the gap wobbles back under the threshold.
   */
  earlyFair: z.coerce.number().int().min(0).max(1).default(1),
  /**
   * Disagreement the outside price must show before it lifts `earlyShare` off a
   * leg. 0 ⇒ use `ptbFairEdge`, the same threshold the override itself uses.
   *
   * Above 0 it also inverts the question. At 0 the cap lifts unless the outside
   * price positively DISAGREES, so a leg the model has nothing to say about may
   * be finished. Above 0 the cap lifts only when the model positively BACKS the
   * leg by that much, so silence means restraint.
   *
   * MEASURED AND NOT SHIPPED. The inversion is exactly a wash and the two
   * markets it trades are the two halves of the same problem. At 0.10 it wins
   * the thirty-eighth market — whose book completes the losing leg on a
   * seven-hundredths disagreement the model gets wrong — and loses the
   * eighteenth, which trends all the way and whose model simply agrees with the
   * book rather than leading it, so silence there is not doubt. Requiring the
   * model to speak first cannot tell "the model has no view" from "the model
   * disagrees", and those need opposite treatment.
   */
  earlyFairEdge: z.coerce.number().finite().min(0).max(1).default(0),
  /**
   * How far the MODEL itself must lean toward a leg before it lifts
   * `earlyShare` off it. 0 ⇒ the lift is decided by `earlyFair` alone.
   *
   * `earlyFair` has two states and needs three. It lifts the cap unless the
   * outside price positively disagrees, so a leg the model has NOTHING to say
   * about is finished on the book's word alone — which is the exact case the
   * cap exists to prevent. `earlyFairEdge` inverts that and treats silence as
   * doubt, and it fails the other way: a window that trends all the way has a
   * model that merely AGREES with the book rather than leading it, so silence
   * there is not doubt and the cap wrongly refuses the leg that has to be
   * bought.
   *
   * The two cases separate on the model's own reading rather than on its
   * disagreement with the book. In a window that genuinely runs, BTC moves
   * clear of the strike and the model leans hard on the same side as the book.
   * In a window that leans and then reverses, the book prices the favourite at
   * 0.59 while BTC has barely left the strike and the model reads 0.53 — it is
   * not contradicting the book, it is failing to confirm it. Requiring
   * CONFIRMATION rather than the absence of contradiction is what tells them
   * apart.
   *
   * MEASURED AND NOT SHIPPED, and the measurement says something more useful
   * than the knob. Over the first sixty markets it costs the thirty-seventh at
   * 0.03, 0.05 and 0.08, costs a second one at 0.08, and fixes NONE of the five
   * markets it was built for. The reason is that the cap it modifies cannot
   * reach those markets at all: they over-commit around the first minute while
   * holding barely a third of the other leg, and `earlyBoth` — which asks
   * whether the player has already been made to buy BOTH sides — is what keeps
   * the cap out. Lengthening `earlyMs` to 90 s does not change one share of the
   * result. Whatever answers that family, it is not this cap with better gates.
   */
  earlyModelMin: z.coerce.number().finite().min(0).max(0.5).default(0),
  /**
   * Edge at which a leg may be completed. 0 disables the pace.
   *
   * `openMs`/`openShare` is a two-state version of one idea: do not size a
   * position larger than the evidence behind it. This is the continuous form.
   * `edge = |askUp − askDown|` is how much the window has already revealed, and
   * a leg may hold `edge / edgeFull` of its target — a fifth of it while the
   * book is a coin flip, all of it once the market has clearly decided.
   *
   * What it prevents is the failure that survived the opening cap: a leg
   * completed at 0.45 in the first ten seconds on a still-undecided book, after
   * which the pair needs the other leg under 0.52 and the other leg never trades
   * there. Pacing by the edge stops that leg at a few hundred shares, and when
   * the book then swings the other way there is budget left to buy the leg that
   * actually ran.
   *
   * It applies only while BOTH legs are short of `qty`. Once one leg is done
   * there is no decision left to protect and the other simply has to be
   * completed.
   */
  edgeFull: z.coerce.number().finite().min(0).max(1).default(0.32),
  /**
   * Total size resting within three levels of a leg, smoothed on `depthTauMs`,
   * below which the ask gap is not read as evidence at all. 0 disables it.
   *
   * The same lesson `depthMinDep` records, applied to the pace instead of the
   * cap: a share of nothing is not a reading, and an eight-cent move on a book
   * carrying a thousand shares is not information either. The allowance still
   * has its `openShare` floor underneath, so this never freezes the player — it
   * holds the JOINT allowance at the opening size until the book has enough in
   * it for its own price to mean something.
   *
   * As a ramp (`edgeDepRamp=1`, the default) every value from 1,200 to 2,000
   * carries the first 86 markets; the failures further out move around inside
   * that band and the moves are the size of the latency jitter. As a bare gate
   * the band is narrower — 1,200–1,800 over the first 84 — and it costs the
   * level 85 window. 2,500, the value `depthMinDep` uses, costs five markets
   * either way: the pace is read on every tick of every window, where the cap
   * arms once, so it needs the lower floor.
   */
  edgeMinDep: z.coerce.number().finite().min(0).default(1_500),
  /**
   * 1 ⇒ `edgeMinDep` is a RAMP rather than a gate: the ask gap counts in
   * proportion to how much of the floor the book has, instead of not at all
   * until the floor is reached.
   *
   * The gate is too blunt, and the window that blocks level 85 says why. It
   * opens already leaning, trends one way for twenty-five seconds and only
   * reverses after the pair is finished — a window the player has to buy into,
   * and the whole of that stretch happens on 600–1,500 shares. A gate refuses
   * it outright and it finishes the leg twenty seconds later at 0.79 instead of
   * 0.74, with nothing left for the other side. The ramp lets a thin book buy a
   * proportionally smaller position rather than none, which is what the reading
   * actually supports.
   */
  edgeDepRamp: z.coerce.number().int().min(0).max(1).default(1),
  /**
   * Milliseconds the book's spread must have been WIDE before it licenses
   * inventory. 0 ⇒ the pace reads the spread at this instant.
   *
   * `edgeFull` grants an allowance from `edge = |askUp − askDown|` read at one
   * tick, and the allowance RATCHETS: once bought, the shares stay bought even
   * after the spread closes again. So a single instant of separation licenses a
   * position permanently, and the book produces such instants constantly — a
   * one-sided sweep prints a wide spread for a second before the other side
   * re-quotes. That is how the two windows that block this level are lost: the
   * book is a coin flip for their whole first minute, momentarily shows a
   * twenty-cent spread, and the player takes six hundred shares of a leg at
   * 0.57–0.61 on the strength of it. The spread then closes, the window turns,
   * and the leg is worthless.
   *
   * The remedy is the one that worked for the spike gate: judge the signal over
   * a stretch of time rather than at an instant. With this set, `edge` becomes
   * the LOWEST spread seen in the trailing window, so a burst licenses nothing
   * until it persists. A genuine trend pays only the delay — its spread widens
   * and stays wide, so the allowance follows it one window later.
   *
   * MEASURED AND REJECTED, and it is the cleanest demonstration yet that the
   * edge pace is load-bearing exactly as it stands. It DOES repair both windows
   * that block this level — at 20 s and at 30 s, over six probes, they finish
   * 1000/1000 at a pair cost near 0.96 where the shipped player finishes
   * 1000/281. It also costs, against two failures with it off: 14 failures
   * unconditional at 20 s, 15 unconditional at 30 s, 14 gated on a handover, 9
   * gated on a thirty-second clock. Every one of them is a leg stranded between
   * 200 and 700 at a pair cost above 1.05 — the price of a delayed chase, paid
   * in every window whose favourite really was running away. Four windows lost
   * per window saved, and narrowing the gate does not improve the trade,
   * because the gate late enough to spare the trends is too late for the coin
   * flips: at 45 s the repair itself is gone.
   */
  edgeHoldMs: z.coerce.number().finite().min(0).default(0),
  /**
   * Milliseconds into the window before `edgeHoldMs` engages. Until then the
   * pace reads the spread at this instant, as it always did.
   *
   * The trailing minimum applied from the first tick is far too strong: it
   * costs a dozen windows for the two it repairs, and every one of them is lost
   * the same way — a leg frozen at two or four hundred shares while its partner
   * finishes, at a pair cost of 1.10 and up. The reason is structural. A window
   * whose favourite is genuinely running away has to have it bought in the
   * first minute, and a trailing minimum delays exactly that purchase by the
   * length of the window it measures over, because the spread it looks back at
   * is the coin-flip spread the window opened with.
   *
   * Gating on a HANDOVER instead — waiting until the priority role has changed
   * hands while the demoted leg held shares — was tried and is worthless: it
   * reproduced the unconditional result market for market. The role does not
   * change hands once mid-window, as reading a fifteen-second log suggests; it
   * flickers on essentially every tick, so any counter over it saturates within
   * seconds of the first fill. That is a fact about this player worth keeping:
   * "the priority leg changed" is not a rare event and cannot carry a rule.
   *
   * The clock can. It leaves the opening chase alone, which is what the trend
   * windows need, and still arrives in time for the second and third swings,
   * which is where the coin-flip windows lose their money.
   */
  edgeHoldAfterMs: z.coerce.number().finite().min(0).default(0),
  /**
   * Fraction of `qty` past which a leg is FINISHED rather than paced. 1 ⇒ the
   * pace applies all the way to the target.
   *
   * `edgeFull` is a rule about commitment: do not own more of a leg than the
   * book has justified. That is the right question while the position is being
   * built and the wrong one once most of it exists, because the pace is
   * two-sided in effect but not in intent. The allowance is `edge / edgeFull`
   * of the target, and `edge` FALLS whenever the two asks converge — so a leg
   * that was built to eight tenths under a wide edge is retroactively over its
   * allowance when the book narrows, and the pace stops being a limit on new
   * commitment and becomes a freeze on an existing one.
   *
   * The two are not the same decision. Refusing to grow a position costs the
   * player nothing but the opportunity; refusing to FINISH one costs the whole
   * of what has already been spent, because an unmatched share pays either 1 or
   * 0 while its missing partner guarantees the pair is never formed. At eight
   * tenths built the marginal shares are worth far more than the pace they
   * violate: the alternative to buying them is not a cheaper leg later, it is a
   * leg of 800 shares that can never be paired with anything.
   *
   * This releases only, and only upward — it can never make the player buy a
   * leg it had not already chosen and mostly built. Everything that decides
   * WHICH leg to build, and the ceiling that decides what may be paid for it,
   * is untouched: an unaffordable finish is still refused by the budget line.
   */
  finishShare: z.coerce.number().finite().min(0).max(1).default(0.75),
  /**
   * Fraction of the OTHER leg's current ask that must still be fundable, for
   * every share that leg still needs, before the `finishShare` exemption lets
   * this leg run to its target. 0 disables the test.
   *
   * `finishShare` argues that a leg near its target must be finished whatever
   * the evidence paces say, because unmatched shares are worth nothing. That is
   * true right up to the point where finishing is what makes the OTHER leg
   * unbuyable — and then it is exactly backwards, because the shares it rushes
   * to buy are the ones that become unmatchable.
   *
   * The level 68 window is that case in its purest form: the priority leg
   * crosses the exemption's line at 0.62 with the other leg two-thirds unbought
   * and quoted at 0.37, runs to 1,000 in fifteen seconds, and leaves 0.28 a
   * share to buy a leg the market never offers below 0.37 again. The window
   * settles on that leg and the player holds 344 of it.
   *
   * The test is deliberately priced at the other leg's ASK rather than at the
   * cheapest it has shown: the whole family of trailing-low guesses is what put
   * the player here, and a leg the exemption is about to strand is not one to
   * extend fresh credit to.
   *
   * MEASURED AND INERT, so it ships at 0. The diagnosis is simply wrong about
   * WHICH release does the damage. In the level 68 window the leg crosses the
   * finishing line and its target in the same cascade, so by the time the
   * exemption is consulted the shares are already bought: turning `finishShare`
   * off outright changes that window by nothing at all, share for share. What
   * actually hands over the last three hundred shares is `edgeFull` — the ask
   * gap touches 0.32 for a few seconds at the top of the spike and the whole
   * target is released on the book's word. See `oracleHold` for what happened
   * when that release was gated instead.
   */
  finishSolv: z.coerce.number().finite().min(0).max(1).default(0),
  /**
   * How far the chased leg would have to FALL, in cents a share, for the pair to
   * still fit inside the ceiling — the discount the plan is quietly counting on.
   * At or above this, the chase changes hands. 0 disables the rule.
   *
   * Finish the chased leg at today's ask, fund the other at the cheapest it has
   * ever shown, and ask what price the chased leg would have had to be for the
   * two together to fit inside `qty × pairCeil`. Subtract that from its actual
   * ask. In the opening minute, with nothing spent and both legs a thousand
   * short, the answer is two or three cents — the ordinary small overrun of two
   * asks that sum to about one. In a window that has decided it is negative,
   * because the leg left behind is quoted at a few cents and funding it costs
   * almost nothing. In the level 68 window at ninety seconds it is twenty-two
   * cents: the player holds seven hundred of a leg bought at 0.61, needs six
   * hundred and fifty of a leg that has never in the window been quoted below
   * 0.39, and the plan only closes if the leg it is chasing becomes twenty-two
   * cents cheaper than the screen.
   *
   * This is `solvSwap`'s arithmetic read as a PRICE rather than as a comparison,
   * and that is the whole difference. `solvSwap` asked which of two assignments
   * overran the ceiling less; both overrun in every market, so what decided it
   * was a couple of cents of trailing-low noise and it degenerated into
   * `priority=cheap`. The required discount is a single number in cents a share,
   * it is near zero everywhere the plan is sound, and it grows only where the
   * player is deep in one leg and the other has never been abandoned.
   *
   * MEASURED AND REJECTED, so it ships at 0, and the prediction above is simply
   * false. Against a baseline of one failure over the first sixty-eight markets:
   * 21 failures at 0.10, 19 at 0.14, 19 at 0.18, 21 at 0.18 with `solvGap` 0.15.
   * The required discount is not small in ordinary windows, because it divides by
   * the chased leg's REMAINING shares: a leg with fifty left to buy makes the
   * denominator tiny and the discount enormous, so the rule fires hardest on a
   * leg that is one clip from done. The same swap driven by the cruder "finish
   * both at today's asks overruns the budget" test is worse still — 24, 13, 21
   * and 23 failures across four settings, and 24, 27, 24 and 20 when gated on the
   * priority leg already holding half, six tenths, seven tenths or eight tenths
   * of its target, with the demoted leg parked at exactly the gate in market
   * after market.
   *
   * Four shapes of this idea have now been measured and all four cost between
   * nineteen and twenty-seven of the sixty-seven markets that already pass.
   * Reassigning the chase is the fifth family to fail on this window after three
   * share caps and the price caps. Do not try a fifth shape of it.
   */
  solvDrop: z.coerce.number().finite().min(0).max(1).default(0),
  /**
   * Minimum `askFirst − askOther` before `solvDrop` may fire — a second opinion
   * from the book rather than from the player's own budget.
   */
  solvGap: z.coerce.number().finite().min(0).max(1).default(0),
  /**
   * Share of its target the priority leg must already hold before `solvDrop` may
   * hand the chase away. 0 disables the gate.
   *
   * The rule is about a decision already made and paid for, not about which leg
   * to buy. Before the player is deep in one leg, "can the pair still be
   * completed" and "which leg is cheaper" are the same question, and answering it
   * with the cheaper leg is the rule already known to lose.
   */
  solvSwapShare: z.coerce.number().finite().min(0).max(1).default(0),
  /**
   * 1 ⇒ a leg demoted by `solvDrop` keeps the allowance the ceiling still holds
   * for it instead of dropping to `underdogMax`.
   *
   * Every rule that reassigns the chase on this player has failed the same way,
   * and the failure is not in the reassignment. `underdogMax` holds the leg that
   * is NOT the priority to a loser's price, which is right for a leg the market
   * has abandoned and wrong for one the player was chasing a tick ago: the
   * handover becomes a freeze, and the frozen leg stops exactly where the rule
   * caught it. Letting the demoted leg answer to the ceiling arithmetic alone
   * means the swap redirects the next purchase without forbidding the previous
   * one.
   *
   * MEASURED AND INERT. With `solvDrop` at 0.10, 0.14 and 0.18 the failure count
   * over the first sixty-eight markets moves from 21, 19 and 19 to 22, 19 and 20
   * — noise. So the freeze is not the mechanism of harm: by the time the swap
   * fires the money is already committed, and giving the demoted leg back its
   * allowance buys nothing because there is nothing left to spend.
   */
  solvFree: z.coerce.number().int().min(0).max(1).default(0),
  /**
   * Fraction of the pair budget one leg may commit within any rolling
   * `burstMs`. 1 disables the cap.
   *
   * Every other pace on this player refuses a leg on a condition that can stay
   * true for the rest of the window: a share count, a price, a total spend. Each
   * of them has produced the same failure — a leg stopped where the rule caught
   * it and never resumed, because by the time the condition cleared the leg was
   * unaffordable. A velocity cap cannot do that. It never says no, only not this
   * second, and everything it withholds is released by the clock alone a few
   * seconds later whatever the book does.
   *
   * The level 68 window is a burst in the literal sense: six hundred and fifty
   * shares of one leg, at 0.57 rising to 0.64, inside sixteen seconds. An
   * ordinary window builds the same position over minutes and never comes near
   * the limit.
   *
   * MEASURED AND REJECTED, so it ships at 1. Against a baseline of one failure
   * over the first sixty-eight markets: 13 failures at 0.15, 9 at 0.18, 12 at
   * 0.20, and at 0.20 over a twenty-second window it stops repairing the specimen
   * at all. It is the least destructive rule in this whole search — the failures
   * are scattered rather than parked on a threshold, which is the velocity cap
   * doing what it promised — and it is still nine times the baseline. Delaying a
   * purchase in a market that moves this fast is the same as refusing it: the
   * seconds the cap withholds are the seconds the price was available in.
   */
  burstShare: z.coerce.number().finite().min(0).max(1).default(1),
  /** Length of the rolling window `burstShare` is measured over. */
  burstMs: z.coerce.number().finite().positive().default(30_000),
  /**
   * 1 ⇒ a leg that has committed `burstSwapShare` of the ceiling inside
   * `burstSwapMs` is LATCHED at `burstSwapHold` of its target and the chase is
   * handed to the other leg. 0 disables it.
   *
   * `burstShare` above is the same reading used as a plain cap, and it fails for
   * the reason every plain cap on this player fails: the money it withholds is
   * money `underdogMax` then forbids the other leg from spending, so the window
   * simply stops buying. This is the `depthHold` shape instead — cap, latch, and
   * hand the chase over — on the one reading that describes all three markets
   * that have blocked a level since 101: the player takes one leg from half
   * built to complete in a single burst, in the middle of the window, and the
   * money that burst spends is exactly the money the other leg needed.
   *
   * The reading is deliberately MONEY rather than shares. A leg bought out at
   * 0.20 a share is a cheap sweep and must never be interrupted; the same
   * thousand shares at 0.65 is more than half the ceiling and is the purchase
   * that strands the partner. Only the money form tells those apart.
   *
   * What it cannot use is anything measured at the instant of completion.
   * `closeScan` over the first 110 shows market 109's completing purchase is
   * indistinguishable from the field on every observable the player has — the
   * other leg's ask, the shares already held on it, the money already spent, the
   * volatility-normalised oracle and the depth share all sit inside the passing
   * distribution, and about twenty passing windows complete a leg on WORSE
   * numbers. So the rule cannot ask whether this completion looks wise. It can
   * only ask how fast the money is going.
   */
  burstSwap: z.coerce.number().int().min(0).max(1).default(0),
  /** Fraction of `qty × pairCeil` one leg may commit inside `burstSwapMs`. */
  burstSwapShare: z.coerce.number().finite().min(0).max(2).default(0.35),
  /** Length of the rolling window `burstSwapShare` is measured over. */
  burstSwapMs: z.coerce.number().finite().positive().default(30_000),
  /** Share of `qty` the latched leg is held at, exactly as `depthHold` holds its own. */
  burstSwapHold: z.coerce.number().finite().min(0).max(1).default(0.8),
  /**
   * Share of `qty` a leg must already hold before the burst latch may fire.
   * 0 ⇒ from the first share.
   *
   * A burst that BUILDS a position from nothing is the ordinary way this player
   * wins a trending window, and interrupting it is what makes the ungated rule
   * cost twenty-eight markets. The burst that has to be stopped is the one that
   * FINISHES a leg already mostly built, because the money it spends is the
   * money the partner needed and there is no cheaper moment left to find it in.
   */
  burstSwapFrom: z.coerce.number().finite().min(0).max(1).default(0),
  /**
   * 1 ⇒ a leg holding MORE than the edge pace currently allows, continuously for
   * `stallFinishMs`, is finished rather than paced. 0 disables it.
   *
   * The edge allowance ratchets in one direction only: shares bought while the
   * asks were apart stay bought after they come back together, and the pace then
   * reads the position it already licensed as an over-commitment and freezes it.
   * That is not a limit on new commitment — it is a leg the player cannot add to
   * and cannot sell, held against an allowance that has already been spent.
   *
   * Market 109 is two minutes of exactly that. The player holds 344 of one leg
   * against an allowance of 219, its own bid a cent under an ask it may not take,
   * and it buys nothing at all from t+82 to t+113 while both asks sit either side
   * of 0.50. Then the window turns, the other leg becomes the favourite, and the
   * money that should have finished the first leg at 0.55 buys the second at 0.65
   * instead. Releasing the pace outright (`finishShare` 0.35) does repair it, and
   * costs seven other markets, each a leg that escaped the pace in the opening
   * minute and ate the ceiling. The dwell is what tells the two apart: a leg that
   * has been stuck above its allowance for twenty seconds is one the book has
   * RETREATED from, where the leg escaping early is one the book is still moving
   * toward.
   *
   * MEASURED AND NOT SHIPPED, and it is the most interesting result of the
   * session, because it is the first thing that reaches market 109 by LOOSENING
   * rather than tightening. Over the first 110, against one failure with it off:
   * 7 at a twenty-second dwell (109 repaired, 1000/1000 at 0.967), 5 at thirty
   * seconds (109 lost again). Every casualty is the same shape — one leg at
   * 1,000 and the other stranded between 200 and 600 — which says the release is
   * sound and the question left open is WHICH leg may take it. Adding the idle
   * test below takes twenty seconds from 7 to 5 and gives 109 back, and
   * shortening the dwell to 15 s or 10 s with the idle test on does not recover
   * it (424/1000 and 425/1000): the release then lands too close to the turn to
   * finish anything, and the sixty shares it does buy are spent for nothing.
   */
  stallFinish: z.coerce.number().int().min(0).max(1).default(0),
  /** Milliseconds a leg must have stood above its edge allowance before it may finish. */
  stallFinishMs: z.coerce.number().finite().min(0).default(20_000),
  /** Share of `qty` the stalled leg must already hold. */
  stallFinishShare: z.coerce.number().finite().min(0).max(1).default(0.3),
  /**
   * 1 ⇒ the player must also have bought NOTHING, on either leg, for
   * `stallFinishMs`. 0 ⇒ the leg's own allowance is the whole test.
   *
   * The argument is that the pace deserves to be overruled only when it has
   * actually STOPPED the player — when the window has gone silent with both legs
   * short — and that is a different event from one leg being over its ration
   * while the other is being bought perfectly happily.
   *
   * It is right about the casualties and wrong about the repair: at a twenty
   * second dwell it takes the failures from 7 to 5, and market 109 is one of the
   * two it gives back. The silence in that window starts at t+82 and the leg only
   * goes over its allowance at t+91, so the idle clock pushes the release past
   * t+111 — three seconds before the book turns. Ships at 1 only because the rule
   * it gates ships at 0.
   */
  stallFinishIdle: z.coerce.number().int().min(0).max(1).default(1),
  /**
   * 1 ⇒ the STALLED LEG itself must have bought nothing for `stallFinishMs`.
   * The window-wide `stallFinishIdle` above is the same test over both legs.
   *
   * The distinction the release actually needs is between a position that was
   * built slowly and has since been frozen, and one that is still being built
   * this second. Both look identical in a snapshot — measured, not argued: the
   * blocking market's stall and the first casualty's are the same state to the
   * cent (344 shares against a 200-share allowance, the leg at 0.53 and its
   * partner at 0.48, the same money left, the same unaffordable pair) and they
   * differ only in that one is at t+54 and the other at t+110. What separates
   * them is not the snapshot but the leg's own recent history.
   *
   * Except that this reading of the history is degenerate and does not have to
   * be tried: a leg over its allowance has zero pace room, so it CANNOT buy, so
   * its own idle time is always at least the dwell by construction. Measured
   * anyway — 20, 21, 21, 20, 29 and 39 seconds across the release moments, with
   * the LONGEST belonging to a casualty. Ships off.
   */
  stallFinishIdleSide: z.coerce.number().int().min(0).max(1).default(0),
  /**
   * Milliseconds into the window before the stall release may fire at all.
   *
   * The last axis left after every snapshot reading was measured and found not
   * to separate. Over the first 110 markets the release costs six windows and
   * every one of them fires between t+26 and t+77, while the window it repairs
   * fires at t+110. The story the clock tells: in the opening minute the edge
   * allowance is still climbing off its `openShare` floor and a leg over it is a
   * leg that outran an allowance which had not yet been granted, which is the
   * pace doing its job. A leg still stuck over a RETREATED allowance two minutes
   * in is a position the book has walked away from.
   *
   * The story is wrong. The clock does not PREVENT a release, it POSTPONES one —
   * the leg is still over its allowance at t+90 and fires then instead — and one
   * window is repaired by an early release and destroyed by a late one, which no
   * reading of "early releases are premature" survives. Measured over the first
   * 110 against a baseline of 1 failure: 90 s ⇒ 3, 90 s with a 0.03 ask lead ⇒ 2,
   * 100 s with it ⇒ 2, and `…1775109600` fails in EVERY clocked variant while
   * passing every unclocked one.
   */
  stallFinishAfterMs: z.coerce.number().finite().min(0).default(0),
  /**
   * How far the stalled leg's ask must sit ABOVE its partner's before the
   * release may fire. Negative ⇒ never binding.
   *
   * The one gate on the release with a story rather than a threshold. This
   * player's whole method is to secure the leg that becomes unaffordable and
   * sweep the other one at the death; a release spent on the CHEAPER leg buys
   * shares that will still be there, and cheaper, later. So the release belongs
   * to the leg the book currently prices as the favourite, and only when it says
   * so clearly.
   *
   * It is the best of the gates and it is still not enough. Over the first 110
   * against a baseline of 1: 0.03 alone ⇒ 6, 0.03 with a 90 s clock ⇒ 2, 0.06
   * with it ⇒ 3. No single threshold can hold, because the ask lead at the
   * release is 0.07 in the window that must be repaired and 0.03, 0.05, 0.11 and
   * 0.13 in windows that must not be — it straddles.
   */
  stallFinishAskLead: z.coerce.number().finite().min(-1).max(1).default(-1),
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
   * Fraction of `qty` at or above which the realized-average cap applies even
   * with `avgGuard` off — i.e. to orders that FINISH a leg. 0 ⇒ never.
   *
   * The objection above is entirely about a leg that has barely started: its
   * realized average is not its final average, so capping the other leg against
   * it is wrong. That objection evaporates when the order in front of the
   * player would take a leg to its target, because then the realized average IS
   * the final average and the arithmetic is exact rather than pessimistic.
   *
   * This is level 46's blocker read from its own timeline. The player opens
   * 469 UP at 0.584 and 375 DOWN at 0.449, BTC then falls 91 dollars in ten
   * seconds, and the player finishes DOWN outright — 625 shares between 0.63
   * and 0.67 — because the only cap in force is the aggregate budget, which at
   * that moment permits 0.83 a share. The pair was already lost when those
   * fills printed: 469 UP at 0.584 leaves DOWN room for 0.386, so no completion
   * of DOWN above that could ever have come in under the ceiling, whatever BTC
   * did next. BTC then reversed ten seconds later anyway, leaving UP an
   * allowance of 0.19 against an ask that never came back below 0.55.
   *
   * MEASURED AND DEAD, so it ships off at 0. Over the first sixty markets:
   * 23 failures at 1.0, 34 at 0.9, 41 at 0.75, 41 at 0.5, against 4 without it,
   * monotone in how much of a leg the cap governs — and level 46 still fails at
   * every setting. The reasoning above is sound about the arithmetic and wrong
   * about the remedy. Refusing the last shares of a leg does not undo the
   * expensive shares already bought; it only converts a market that would have
   * ended 1000/469 into one that ends 469/833, and it does so everywhere,
   * because in an ordinary window the other leg's realized average is high for
   * most of the window and the cap then refuses perfectly good completions. The
   * ceiling cannot be defended at the end of a leg. Whatever fixes this family
   * has to act while the expensive fills are being taken, not after.
   */
  avgGuardFrom: z.coerce.number().finite().min(0).max(1).default(0),
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
  /**
   * Book edge, per unit of the priority leg already bought, that the OTHER leg
   * must show before the priority role may change hands. 0 disables it.
   *
   * `priorityLatch` is the same idea taken to its limit — pick once, never
   * re-decide — and measuring it exposes why the limit is wrong: it repairs the
   * windows that are lost by re-deciding and destroys the ones that are saved by
   * it, 56 of 60 against 58. The role has to be able to change; what it must not
   * be is free.
   *
   * The price of the change is the shares already sunk into the leg being
   * abandoned. With nothing bought, changing the mind costs nothing and should
   * happen on the first hint. With most of a leg bought, the pair's whole budget
   * is already committed to one side of the market, and a change means paying a
   * coin-flip price for the second leg as well — the one shape that can never
   * come in under the ceiling. So the threshold is `swapEdge × held(current)/qty`
   * against `askNew − askCurrent`, the book's own statement of how much better
   * the other leg looks.
   *
   * This is deliberately NOT another restraint: it never stops the player buying,
   * it only decides which leg it is buying. A market that trends from the first
   * tick never triggers it at all, because its priority leg never changes.
   *
   * It does exactly what it was built to do and still does not pay. Over the
   * first sixty markets it repairs BOTH blocking windows outright — 1000/1000 at
   * pair costs 0.920 and 0.941, the healthiest either has ever printed — and
   * breaks three others that the shipped player passes (`-1775127600`,
   * `-1775131200`, `-1775132100`), for 57 of 60 against a baseline 58. 0.5 and
   * 0.7 are worse (53 and 51); below 0.4 the two blocking windows are not
   * repaired at all, so there is no gentler setting that keeps the win.
   *
   * The casualties explain themselves and are worth remembering. The flicker
   * this parameter suppresses was doing a second job nobody designed: a leg is
   * only bought on the ticks where it holds priority, so a priority that changes
   * hands every tick is an accumulation brake. Remove the flicker and the player
   * buys its chosen leg out in seventy-five seconds instead of minutes — and
   * when that leg is the loser, there is no money left for the winner at any
   * price. All three casualties end 1000/200 or 1000/0.
   *
   * Combining it with a bigger reserve for the leg left behind (`reserveLow`
   * 0.7 / 0.8 / 0.9, the obvious complement) does not recover them: 56 / 54 / 55.
   */
  swapEdge: z.coerce.number().finite().min(0).max(2).default(0),
  /**
   * 1 ⇒ `reserveLow` stops holding money back for the non-priority leg while
   * that leg's ask is under its own average, i.e. while it is still falling.
   *
   * The reserve floor is the player's answer to "how cheap can the second leg
   * honestly be expected to get", and it answers with that leg's own trailing
   * low. On a leg that has stopped falling this is good evidence. On a leg that
   * is still on its way down it is the one number guaranteed to be wrong: the
   * low is whatever it printed a second ago, and the leg is about to print
   * lower. The money set aside against it is money the player can never spend —
   * it is reserved for a price that will not come back, while the leg it is
   * being withheld from is the one running away.
   *
   * The reasoning is right and the distinction is empty: measured on both
   * blocking windows it reproduces `reserveLow=0` to the cent, at every level of
   * `reserveLow` and with or without `swapEdge`. At the moments where the reserve
   * binds, the leg left behind is ALWAYS below its own average — that is what
   * being left behind means. So this is not a narrower version of turning the
   * floor off; it is the same thing spelled differently, and turning the floor
   * off does not finish either window (1000/406 and 1000/531).
   */
  reserveMom: z.coerce.number().int().min(0).max(1).default(0),
  /**
   * Milliseconds after which `reserveLow`'s floor stops applying. Defaults to
   * the whole window, i.e. no limit.
   *
   * The isolating probe for the claim that the bid, not the money, is what
   * strands the winning leg: leave the opening minutes exactly as they are and
   * release only the late reserve, which is the one measured to be pinned to a
   * price the abandoned leg will never trade at again.
   */
  reserveLowUntilMs: z.coerce.number().finite().min(0).default(900_000),
  /**
   * Fraction of `qty` one leg must reach before the ACCUMULATION PACES stop
   * applying to the other one. 0 disables it.
   *
   * Every pace in the room block — `edgeFull`, `holdRamp`, `earlyShare`,
   * `openShare`, `fillPace` — rations a leg by how much the book has revealed,
   * because buying a leg is a decision about which outcome the player wants and
   * an early decision is made on no evidence. That is right for the first leg
   * and wrong for the second. Once the player holds most of one leg the decision
   * has been made and the money is spent; the leg left behind is not a second
   * decision, it is the thing that makes the first one's shares matchable, and
   * a market that ends 1000/281 is worth less than one that never traded.
   *
   * This is the level 47 blocker read off its own tick record. At t+50s the
   * player holds 656 UP at an average of 0.59 and 281 DOWN; the window then
   * turns and DOWN — the eventual winner — is offered between 0.44 and 0.56 for
   * ninety seconds with 439 dollars of ceiling still unspent, which is enough to
   * finish both legs at 0.95 a pair. It buys none of it. The bid cap is the
   * constraint everyone found first, and it is real: the reserve held back for
   * the abandoned leg is sized off that leg's trailing low, and at t+105s it
   * puts the cap at 0.484 against an ask of 0.56. But releasing the reserve
   * alone only lifts DOWN to about 400 shares, and the tick record says why: the
   * edge pace lets a leg hold `qty × edge / edgeFull` shares, the book edge at
   * that moment is 0.11, and 0.11/0.32 × 1000 is 344. Two separate rules,
   * measured one after the other, cut the same leg off at nearly the same place.
   *
   * The exemption is deliberately one-sided and latched. Turning the paces off
   * for BOTH legs is the measured disaster: the edge pace is precisely what
   * stops the committed leg at 656 in this window, and without it the player
   * buys that leg out at 0.57 and has nothing left. Latching matters for the
   * opposite reason — an exemption keyed to "whichever leg is behind right now"
   * switches itself off at parity, which in this window is 656 shares, and the
   * market fails in the same shape one rung higher up.
   */
  commitShare: z.coerce.number().finite().min(0).max(1).default(0.6),
  /**
   * 1 ⇒ `reserveLow`'s floor stops applying while the player is bidding for the
   * leg `commitShare` latched, i.e. while the leg being reserved against is the
   * one it is already committed to. 0 disables it.
   *
   * The pace exemption alone gets the level 47 blockers from 281 and 344 shares
   * of the winning leg to 514 and 544, and then they stop dead against the other
   * half of the diagnosis: the bid. The reserve withheld for the abandoned leg
   * is 0.6 of that leg's trailing low, and in these windows that is about a
   * hundred dollars set aside for shares that end up costing two cents, while
   * the leg it is withheld from goes unbought for want of four cents a share.
   *
   * Turning the floor off outright (`reserveLow=0`) does finish both windows,
   * and costs three other markets in the first sixty — it is a change to every
   * window from twenty seconds in, including all the ones where the reserve is
   * doing its job. This is the same release restricted to the case the tick
   * record actually describes: the player already holds most of the leg being
   * reserved against, so the reserve is protecting a purchase it has already
   * made rather than one it still has to make.
   */
  commitReserve: z.coerce.number().int().min(0).max(1).default(1),
  /**
   * Multiple of the oracle band the price-to-beat signal must clear, in the
   * direction of the PRIORITY leg, before `reserveLow`'s floor stops applying.
   * 0 disables it; 1 ⇒ the moment `outsideSide` names the priority leg.
   *
   * The floor asks "how cheap can the second leg honestly be expected to get"
   * and answers with the cheapest price that leg has actually shown. That is
   * the best answer available while the window is still a coin flip. It is the
   * wrong answer once BTC has run clear of the price to beat in the priority
   * leg's own direction, because then the second leg is the one heading for
   * zero: its trailing low is an overestimate of what it will finally cost, and
   * the money held back at that stale price is withheld from the only leg whose
   * price is still running away.
   *
   * This is `commitReserve`'s release keyed to evidence about the OUTCOME
   * rather than evidence about the player's own inventory. The two answer
   * different windows: `commitReserve` needs the player to already hold most of
   * the leg it reserves against, and a whipsaw that split the spend evenly
   * across both legs never satisfies it.
   *
   * The margin the value has to carry is a real one. At 1 — release the floor
   * the instant the band is cleared — the release fires early enough in a
   * window that later reverses to overspend on the leg that eventually loses,
   * and an earlier market that finishes with a one-cent margin fails instead.
   * 1.3 through 1.8 fix the level 67 whipsaw and keep that market; 1.5 is the
   * middle of the band, and both windows finish on all of eighteen seeded
   * latency draws across it.
   */
  oracleReserve: z.coerce.number().finite().min(0).default(1.5),
  /**
   * Share of its target the PRIORITY leg may hold on the book's evidence alone,
   * i.e. while the price to beat has not confirmed that leg by `oracleHoldFrac`
   * bands. 1 disables the cap.
   *
   * `edgeFull` reads the gap between the two asks as evidence and hands over
   * allowance in proportion to it. The reading is right on average and wrong at
   * exactly the worst moment: the gap is at its widest at the TOP of a spike, so
   * the rule grants the whole target precisely when the leg is dearest. In the
   * level 68 window the two asks touch 0.66 and 0.34 for a few seconds at t+88,
   * the allowance goes to the full thousand, and the player takes its last three
   * hundred shares at 0.64 in one cascade. The window then sits at a coin flip
   * for ten more minutes and settles on the other leg, which it can no longer
   * afford at any price the book ever shows.
   *
   * Raising `edgeFull` instead is the same idea applied to every window, and it
   * is ruinous: 12 failures over the first 68 markets at 0.45 and 15 at 0.50,
   * against one. The point is not that the book's evidence is too generous in
   * general — it is that the last quarter of a leg is a commitment no single
   * widening of the spread should be allowed to make on its own.
   *
   * Deliberately restricted to the leg holding priority. The other leg is paced
   * by what it is allowed to PAY, and a share cap there would strand it short of
   * a thousand in every window where the oracle names its opponent.
   *
   * It is also LATCHED to the first leg it catches, and that is what makes it
   * work rather than deadlock. Applied to whichever leg happens to hold
   * priority, it caps each of them in turn as priority changes hands, and a
   * window whose oracle never confirms either side ends at the cap on BOTH legs
   * — 600/600, with four hundred of each still to buy and no allowance to buy
   * them with. Lapsing it on a clock instead is no better: the restrained leg
   * simply completes at the same price twenty seconds later and the window
   * fails share for share, at every lapse from three to five minutes.
   *
   * Latched, it says the thing that is actually meant: ONE leg has been bought
   * as far as an unconfirmed book reading may take it, and what the rest of the
   * ceiling is for is the other leg. That IS the winning shape in the level 68
   * window — stop the leading leg near seven hundred, buy the other one out in
   * the middle of the window while it is still near 0.50, and finish the first
   * in the closing minute at four cents. The specimen finishes 1000/1000 at
   * 0.966 a pair at every setting tried, 0.6 through 0.8.
   *
   * MEASURED AND REJECTED, and not narrowly. Over the first 68 markets, against
   * one failure with the cap off: 24 failures at 0.6, 31 at 0.7, 29 at 0.8. The
   * shape of every one of them is the cap itself — 700/1000, 600/1000, 1000/700
   * — a leg stopped exactly on the line and never resumed, because the latch
   * that stops it deadlocking the pair is also what stops it ever letting go.
   * The book edge is a poor reason to buy the last quarter of a leg and still a
   * far better one than nothing, which is what this leaves in its place.
   *
   * This is the third time a share cap has been tried on this window's shape
   * (`maxImbalance`, `holdRamp`, now this) and the third identical answer: the
   * failures are share counts, never pair costs. Do not try a fourth.
   */
  oracleHold: z.coerce.number().finite().min(0).max(1).default(1),
  /** Multiple of the oracle band that lifts `oracleHold`. */
  oracleHoldFrac: z.coerce.number().finite().min(0).default(1.5),
  /**
   * Share of its target the leg that is ALREADY AHEAD may hold while the model
   * is running ahead of the book on it by `fairHoldGap`. 1 disables the cap.
   *
   * This is a fourth share cap, and the doc for `oracleHold` says not to try
   * one. Two things are different, and both come from reading the level 68
   * window side by side with the window that most needs the aggressive chase
   * (`…1775110500`, whose favourite runs from 0.52 to 0.99 and never comes back).
   *
   * The first is the signal. In both windows the book leans hard, the ask gap
   * reaches 0.23–0.55, and the oracle confirms the leaning leg by more than a
   * band — the two states are indistinguishable on everything the earlier caps
   * looked at. They differ on ONE reading: the disagreement between the model
   * and the book. Where the favourite really is running away the book is at or
   * above the model (gap 0.000 at t+30, −0.021 at t+45, −0.029 at t+61). In the
   * level 68 window the model is 5 to 11 cents ABOVE the book for the whole
   * approach, rising monotonically while the player buys (0.058 at t+70, 0.064
   * at t+75, 0.084 at t+89). The reading says: BTC has made an excursion the
   * book does not believe, and over a fifteen-minute horizon the book is the
   * better judge of it. Both windows bear that out — the one the book priced
   * settled the way the book said, and the one the book refused to price
   * mean-reverted and settled the other way.
   *
   * The second is that it CANNOT deadlock. `oracleHold` had to be latched to one
   * leg or it capped both in turn at 600/600, and the latch is what stopped the
   * capped leg ever resuming. This cap applies only to the leg that is ahead of
   * its partner, so the trailing leg is never refused: 720/720 is not a state it
   * can produce, and a leg it stops can always be caught up to and passed.
   *
   * MEASURED AND REJECTED — and it inverted the premise. It DOES repair the level
   * 68 window, robustly rather than on a knife edge: 1000/1000 at 0.965–0.968 a
   * pair at 0.50, 0.60, 0.65 and 0.72, which is the first setting of anything to
   * survive a whole band rather than one lucky point. Over the first 68 markets
   * it costs 9 failures at (0.72, 0.06), 7 at (0.72, 0.08), 8 at (0.65, 0.06) and
   * 8 at (0.60, 0.06) — a set disjoint from `reserveLow`'s nine.
   *
   * The casualties say something worth more than the rule. Every single one of
   * them is the capped leg stranded exactly on the cap, and in every single one
   * of them THAT LEG IS THE WINNER: eight windows settle on the leg the model was
   * running ahead of the book on. So the disagreement is not a warning that the
   * model is over-reading a BTC blip — it is a good directional signal, right in
   * eight of the nine windows where it is strong, and the level 68 window is its
   * only miss. A rule built to distrust it is wrong eight times to be right once.
   * Do not build another one; if this reading is used again it should be used the
   * way it actually points.
   */
  fairHold: z.coerce.number().finite().min(0).max(1).default(1),
  /** Model-minus-book disagreement, in probability, that engages `fairHold`. */
  fairHoldGap: z.coerce.number().finite().min(0).default(0.06),
  /**
   * Share of its target the leg that is ALREADY AHEAD may hold while its own
   * book is a THIN OFFER — `depthGate` or more of the size within three levels
   * sitting on the bid rather than the ask. 1 disables the cap.
   *
   * Every earlier cap read a price: the ask gap, the leg's own ask, the model,
   * the oracle, the player's own spend. Measured over the first 68 markets, the
   * level 68 window is unremarkable in all of them — median in what it pays
   * (26th of 68 in the ask it chases and in the gap it chases on), near the top
   * in how fast the book moved, twelfth in how far it commits past its own cash.
   * That is why six families of price rule each cost between seven and
   * forty-three of the markets that already pass: nothing in the price separates
   * this window from the ones that must be chased.
   *
   * The SIZE behind the quote does. At the instant it commits, the leg this
   * player is buying has 85% of its near depth on the bid and 15% on the offer:
   * third-highest of the 68 markets, and higher than all eighteen windows
   * measured to break when money or shares are withheld. The lean it is chasing
   * is a lean nobody funded — the price is high because there is nothing left to
   * sell, not because anyone bought size. In `…1775110500`, the window whose
   * chase is most essential, this reading never reaches the gate at all.
   *
   * Smoothed over `depthTauMs` and required to bite while the leg is still being
   * bought, a 0.80 gate would fire in only 17 of the 68 windows and for one to
   * eleven seconds in all but this one, where it covers the whole buyout.
   */
  depthHold: z.coerce.number().finite().min(0).max(1).default(0.8),
  /**
   * Share of near depth on the bid that makes a leg's offer "thin".
   *
   * Measured over the first 80 markets with the clock below stood down, the
   * clean band is 0.65–0.68: at 0.70 the level 80 window survives (its reading
   * only grazes 0.71 and falls back below the gate in the same seconds its leg
   * crosses `depthHold`, so the cap never latches), and at 0.62 the rule starts
   * biting a window that has to be chased. 0.66 is the middle of that band.
   */
  depthGate: z.coerce.number().finite().min(0).max(1).default(0.66),
  /** Time constant of the depth-imbalance estimate, in ms. */
  depthTauMs: z.coerce.number().finite().min(0).default(10_000),
  /** How many top book levels the depth reading sums. */
  depthLevels: z.coerce.number().int().min(1).max(10).default(3),
  /**
   * How long into the window the depth cap stays disarmed, in ms.
   *
   * A window that has just opened has almost nothing resting on either side, so
   * the ratio is noise: it takes one order to empty an offer that is only a few
   * hundred shares deep. Measured over the first 68 markets, every casualty of
   * the cap that survives a tighter gate is armed between t+10s and t+27s, while
   * the lean it is built to refuse arrives at t+70s.
   *
   * It was suspected of being what let the level 80 window through, since that
   * window's reading crosses the gate at t+42s. It is not: standing the clock
   * down entirely leaves that window failing exactly as before, because at the
   * old 0.70 gate the reading fell back under the gate in the same seconds the
   * leg crossed `depthHold`, so the cap never latched. The gate was the problem.
   * It is now off, replaced by `depthMinDep` — the thing it was a proxy for,
   * measured directly. Over the first 80 markets both are clean, but the size
   * floor holds a wider gate band (0.65–0.68 against 0.65–0.68 minus 0.64…0.65,
   * where the clock already fails) and costs less further out: probed market by
   * market over the first 110, the clock leaves six failures beyond level 80 and
   * the size floor five.
   */
  depthAfterMs: z.coerce.number().finite().min(0).default(0),
  /**
   * Total size that must be resting within `depthLevels` of the leading leg,
   * smoothed on `depthTauMs`, before its bid/ask share is trusted. 0 ⇒ no size
   * requirement.
   *
   * This is what `depthAfterMs` is a proxy for, said causally instead of as a
   * clock. The reason a just-opened book gives a meaningless ratio is not that
   * the clock is young: it is that one order empties an offer only a few hundred
   * shares deep, so the share swings to 1 on no information. State the size
   * directly and the cap can arm the moment a book is thick enough, however
   * early that is. Measured at the moment the cap would engage, the windows that
   * arm in the first half-minute — the ones the clock was added to protect — are
   * carrying 1,250 to 1,750 shares near the top of the book, while the level 80
   * window is carrying 3,100. The floor sits between them.
   *
   * 2,500 is not a knife edge for the level: the first 80 markets are clean at
   * 2,000, 2,500 and 3,200 alike. It is the best of the three further out, where
   * 2,000 is too low to hold `…1775160000` and 3,200 too high to hold
   * `…1775179800`.
   */
  depthMinDep: z.coerce.number().finite().min(0).default(2500),
  /**
   * How recently the book must have crossed the coin flip for the depth cap to
   * arm, in ms. 0 ⇒ no freshness requirement.
   *
   * A thin offer means two different things depending on how long the leg has
   * been dear. A leg the book has priced above even for a full minute has had
   * its offer bought through: the depth is gone because someone took it. A leg
   * that crossed the coin flip eleven seconds ago and is already at 0.61 has an
   * empty offer because nobody has put one up yet. Only the second is evidence
   * of nothing. The two windows that collide on every other reading are 11s and
   * 63s old at the moment the cap would arm.
   */
  depthFreshMs: z.coerce.number().finite().min(0).default(30_000),
  /**
   * The LOWER gate the depth reading must fall through before an already-armed
   * cap disarms. `>= depthGate` ⇒ no hysteresis, one gate both ways.
   *
   * The cap and its latch are two different things and only the latch was
   * broken. Every tick the reading is above `depthGate` the cap is recomputed
   * and the leg cannot pass `depthHold` × `qty`; the latch is what makes that
   * permanent once the reading fades and, more importantly, what hands the
   * chase to the other leg. The latch waits to see the leg at or above the
   * threshold, so it fires only if a fill happens to land there while the
   * reading is still up.
   *
   * `…1775179800` is the market that showed it. Two draws of the same window,
   * identical to the share until t+151s, both holding 747 of UP with the
   * reading at 0.68: one fill lands 53 shares and stops exactly on 800, the
   * latch engages, the chase moves to DOWN, and DOWN is bought out in the next
   * second at 0.32. The other lands 32 shares and stops on 779, the latch does
   * not engage, the reading slides under the gate two seconds later, and eight
   * seconds after that UP runs 779 → 1000 with DOWN left on 406. Twenty
   * milliseconds of latency jitter chose between +75 and −427, and the market
   * passed about one draw in four.
   *
   * Latching earlier — the moment the cap would clamp the next clip — is the
   * obvious repair and it is WRONG: it arms the cap in windows where the leg
   * would never have reached the threshold at all. `…1775172600` latches DOWN
   * at 719 on that rule, hands the chase to UP, buys UP out at 0.40, and ends
   * 1000/719 with DOWN — the winner — short. The escape is not the threshold,
   * it is the release: the reading in the level-103 window slides 0.68 → 0.61
   * over eight seconds and never comes back, and a cap released at 0.66 is
   * simply gone when the burst arrives. Hold it to 0.60 and the burst is
   * clamped at 800, the ordinary latch engages there, and nothing about when
   * the cap ARMS has changed.
   */
  depthRelease: z.coerce.number().finite().min(0).max(1).default(0.6),
  /**
   * How long, in ms, an armed depth cap may stand on `depthRelease` alone after
   * its full arming condition stops holding. 0 ⇒ no grace, one gate both ways.
   *
   * The grace has to be bounded. Dropping the freshness clock from the release
   * entirely — letting the cap stand for as long as the reading leans — holds
   * the level-103 window but strands two much earlier ones on 800/1000: the cap
   * survives into windows where the leg it stopped is the one that WINS, and
   * the last two hundred shares are then unaffordable at the death. A few
   * seconds is all the level-103 window needs; its cap loses freshness at
   * t+156.7s and the burst it has to clamp arrives at t+159.2s.
   */
  depthReleaseMs: z.coerce.number().finite().min(0).default(5_000),
  /**
   * 1 ⇒ an armed depth cap also latches once the leg is buying faster, per
   * `commitRateMs`, than the room the cap has left it. 0 ⇒ the latch waits to
   * see the leg at `depthHold` × `qty`.
   *
   * The cap and its latch are two different things and only the latch was
   * broken. Every tick the reading is armed the cap is recomputed and the leg
   * cannot pass `depthHold` × `qty`; the latch is what makes that permanent
   * when the reading fades, and what hands the chase to the other leg. Waiting
   * to SEE the leg at the threshold makes all of that depend on where a fill
   * happens to land.
   *
   * `…1775179800` is the market that showed it. Two draws of the same window,
   * identical to the share until t+151s, both holding 747 of UP with the
   * reading at 0.68 and 53 shares of room under the cap: one fill lands 53 and
   * stops exactly on 800, the latch engages, the chase moves to DOWN, and DOWN
   * is bought out in the next second at 0.32. The other lands 32 and stops on
   * 779, the latch does not engage, and UP later runs to 1000 with DOWN left on
   * 406. Twenty milliseconds of latency jitter chose between +75 and −427.
   *
   * Latching whenever the cap would clamp the next CLIP is the obvious repair
   * and it is wrong: it also latches in windows where the leg is not going
   * anywhere. `…1775172600` latches DOWN at 719 on that rule, hands the chase
   * to UP, buys UP out at 0.40, and ends 1000/719 with DOWN — the winner —
   * short. The rate separates the two cleanly, because it is the actual
   * difference between them: the level-103 leg took 153 shares in the second
   * before it was capped, the other took 31 in the previous half-minute.
   */
  depthLatchRate: z.coerce.number().int().min(0).max(1).default(1),
  /**
   * The window, in ms, the depth latch measures that rate over.
   */
  depthRateMs: z.coerce.number().finite().positive().default(3_000),
  /**
   * Standard deviations of BTC's OWN measured volatility at which the outside
   * price releases a leg `fairHold` has stopped, for the rest of the window.
   * 0 ⇒ the cap is never released this way.
   *
   * This is what the casualties above ask for. The disagreement between model
   * and book is a good directional read — right in eight of the nine windows
   * where it is strong — so a cap built on it must be a DELAY, not a refusal,
   * and the delay has to end when something more reliable agrees with it.
   *
   * `outsideZ` is that something. The player's existing oracle reading measures
   * BTC's distance from the price to beat against a FIXED sixty dollars scaled
   * by the time left, which means the same distance counts the same in a calm
   * quarter-hour and a violent one. Measured over the first 68 markets, that
   * fixed reading names the side that eventually wins at its first crossing of
   * 1.6 bands in only 54 of 68 windows. The same distance divided by the
   * standard deviation of BTC's own recent one-second moves names the winner in
   * 65 of 68 at one sigma, and 66 of 68 at 1.4 sigma.
   *
   * The catch, also measured, is that it is LATE: the median first crossing of
   * one sigma is at t+574s against t+153s for the fixed reading, and at the
   * crossing the named leg already asks 0.71–0.94. So it is useless as a gate on
   * the chase — a player that waited for it would buy every winner at
   * eighty-five cents — and it is exactly right as a release, which is the only
   * thing it is used for here.
   */
  fairHoldZ: z.coerce.number().finite().min(0).default(0),
  /** Time constant of the BTC volatility estimate behind `fairHoldZ`, in ms. */
  volTauMs: z.coerce.number().finite().positive().default(180_000),
  /** Sampling interval of that estimate, in ms — see the note where it is taken. */
  volSampleMs: z.coerce.number().finite().positive().default(1000),
  /**
   * How far above its OWN trailing low the chased leg must trade before the
   * `commitShare` pace exemption applies. 0 ⇒ always.
   *
   * The idea: the exemption is for a leg running away from the player, and on a
   * leg that is getting cheaper it is strictly harmful, because a falling leg
   * fills a resting bid on every downtick — the paces cost nothing but patience
   * there, while the exemption buys the whole leg out at today's price.
   *
   * MEASURED AND INERT, so it ships at 0. The reasoning is fine and the trailing
   * low cannot carry it: the low is the minimum over the whole window, so one
   * thin print in the opening seconds sits under everything that follows and the
   * gate never closes again. On the market this was built to protect, pads of
   * 0.02, 0.04, 0.06, 0.10 and 0.15 all leave the exemption firing and the market
   * failing; 0.15 finally moves it and breaks one of the two windows the
   * exemption exists to repair. The ask average was tried in its place first and
   * is worse — a leg falling from 0.49 to 0.39 ticks back above a thirty-second
   * average often enough that the gate is open whenever it matters.
   */
  commitRise: z.coerce.number().finite().min(0).max(1).default(0),
  /**
   * How far BELOW the average the player paid for the committed leg that leg's
   * ask must trade before the `commitShare` exemption applies. 0 ⇒ always.
   *
   * The exemption is a bet, and it is worth naming: chasing the leg left behind
   * spends the ceiling now, which only comes in under the cap if the committed
   * leg's own remaining shares turn out to be cheap. That is the same as betting
   * the committed leg collapses. When it does not, the exemption is exactly
   * wrong — the two markets it breaks in the first sixty both end with the
   * chased leg finished and the committed one two hundred shares short with
   * seventy dollars left.
   *
   * The player can read which bet it is in, from its own book: in both level 47
   * blockers the committed leg is trading four to five cents UNDER the average
   * it paid — the market is telling it the commitment was wrong, which is
   * precisely when the other leg has to be chased. In both casualties the
   * committed leg is at or above that average; the market agrees with the
   * commitment, so the shares still owing on it will not be cheap and the money
   * has to stay where it is.
   *
   * On its own it half works: at 0.045 all six markets in the argument pass on
   * one run and on two repeats of that run one casualty and then one blocker
   * fail again. Three or four cents of a noisy number is not a separation. What
   * it IS good at is the case the other two gates cannot see — a window where
   * the committed leg is only briefly marked down and its own thirty-second
   * average never follows, which is why the test is against the WORSE of the two
   * readings. With `commitLeadMs` and `commitLag` carrying the timing, this pad
   * is what keeps the level 47 casualty at market 38 from arming, and the three
   * of them together pass the level on three runs out of three. Ships at 0.045.
   */
  commitLoss: z.coerce.number().finite().min(0).max(1).default(0.045),
  /**
   * Milliseconds the `commitLoss` verdict must stand CONTINUOUSLY before the
   * exemption it unlocks may be used. 0 ⇒ the first tick that reads wrong is
   * enough.
   *
   * `commitLoss` asks whether the market has turned against the leg the player
   * committed to, and answers on two readings of the same instant — the last
   * quote and a thirty-second average. Both of those are prices, and a price
   * that moves twenty cents in fifteen seconds drags a thirty-second average a
   * long way with it. The reading the pair was built to reject is a two- or
   * three-cent wobble, not a genuine excursion that reverts.
   *
   * The market blocking level 95 is the excursion. The player holds 719 of the
   * leg that eventually wins and 531 of the other, and is two hundred dollars
   * from finishing both. Its committed leg spikes twenty cents against it over
   * fifteen seconds, the verdict flips, four hundred and sixty-nine shares of
   * the other leg are taken in four seconds at prices thirteen cents above
   * where that leg traded thirty seconds earlier, and the spike is fully
   * reverted fifteen seconds later. What was left could not finish either leg.
   *
   * A clock is the right instrument here and a price is not: the excursion and
   * the real turn are indistinguishable on every price reading at the instant
   * they start, and differ only in whether they are still there afterwards.
   * What waiting costs is the first seconds of a genuine chase, which is real
   * but bounded — the chase runs for minutes when it is right.
   *
   * Band, over the first 110 markets: eight seconds is too short to sit out the
   * excursion and costs an earlier market as well; ten, twelve and fifteen all
   * carry the same three failures, none of them below level 103; twenty breaks
   * market 52, whose chase is genuine and starts inside that window. Ships at
   * twelve, the middle of the band that holds.
   */
  commitDwellMs: z.coerce.number().finite().min(0).default(12_000),
  /**
   * Shares per second the chased leg may acquire while the `commitShare`
   * exemption is active, measured over the last `commitRateMs`. 0 ⇒ unlimited.
   *
   * Every attempt to tell the two blockers apart from the casualty by PRICE
   * failed, and they are not actually separable that way: put them side by side
   * and the share counts, the committed averages, the asks, the budget left and
   * the model built from BTC all carry the same sign. What differs is SPEED. In
   * the window the exemption repairs, the chase takes 719 shares over thirty
   * seconds in four separate stretches; in the window it breaks, 750 shares in
   * five seconds, one burst, ending with the committed leg 219 shares short and
   * 74 dollars in hand.
   *
   * MEASURED DEAD, so it ships at 0. A rate cap slows the chase without
   * stopping it: the money still goes out, one clip a second instead of four at
   * once, and in both casualties the cheap stretch lasts long enough for the cap
   * to be irrelevant. What it does reliably is strand the windows where the
   * chase genuinely has to be fast — over the first sixty markets the count goes
   * 58 without it, 57 at 100 shares a second, 54 at 60 and 40, and 51 at 20,
   * monotone in the throttle. The reading behind it was also half wrong: the
   * one-second bursts looked like bursts only because the chase finished and the
   * leg stopped being contested. What actually separates the windows is how long
   * the book had been calling that leg the one to buy BEFORE the chase started —
   * see `commitLeadMs`.
   */
  commitRate: z.coerce.number().finite().min(0).default(0),
  /** Rolling window the `commitRate` cap is measured over. */
  commitRateMs: z.coerce.number().finite().positive().default(1_000),
  /**
   * How long IN TOTAL the chased leg must have held the momentum lead, since
   * the moment the other leg was latched, before the `commitShare` exemption
   * applies. 0 ⇒ immediately.
   *
   * This is the discriminator the price tests could not find. Every reading of
   * the prices themselves carries the same sign in the windows this repairs and
   * the windows it breaks, because the exemption is a bet on the committed leg
   * collapsing and nothing visible at the time says whether it will. What does
   * differ is how long the book had been calling the deficient leg the one to
   * buy before the player acted on it. In the two windows the exemption exists
   * to repair, that leg has led for twelve to fifteen seconds, in stretches, by
   * the time the chase is half done. In the casualties it has led for one or two
   * seconds and the whole remaining ceiling goes out in the next instant — 656
   * shares in a second, 571 in a second, and a window that ends with one leg
   * finished, the other two hundred short and seventy dollars in hand.
   *
   * A regime change is something the market keeps saying. Cumulative rather
   * than consecutive, because the repaired windows alternate — the chased leg
   * leads for three seconds, gives the lead back, takes it again for ten — and a
   * counter that resets on every flip never arms in a window genuinely turning.
   * Measured at 8 s (both casualties still fire), 12 s (the level 47 set passes)
   * and 16 s (one repair is delayed into a worse price and fails).
   */
  commitLeadMs: z.coerce.number().finite().min(0).default(12_000),
  /**
   * How far behind the other leg, as a share of target, the chased leg must
   * still be at the MOMENT the exemption arms. 0 ⇒ no requirement.
   *
   * The chased leg is latched once and never recomputed, which is what stops
   * the exemption switching itself off at parity and stranding the leg one rung
   * higher up. The cost of that latch shows in one window: the player reaches
   * 719 and 781 shares — 62 apart, the imbalance essentially gone — and the
   * exemption, still pointed at the leg that was behind a minute earlier, spends
   * 137 dollars finishing it at 0.47 and leaves the other leg 219 short. Left
   * alone it finishes both later at 0.29 and comes in at 0.968.
   *
   * So the latch stays, and the ARMING is what gets the test: the exemption is
   * for a genuine imbalance, and 6 percent of target is not one. Checked once,
   * at the instant the dwell completes, and latched from there — checking it
   * every tick would switch the exemption off mid-chase, which is the failure
   * the latch exists to prevent.
   */
  commitLag: z.coerce.number().finite().min(0).max(1).default(0.15),
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
  /**
   * The outside-price signal: how the player uses BTC's distance from the level
   * the market settles against.
   *
   * 0 ⇒ off, and the external-feed request is not even registered, so the run
   *     has no dependency on those datasets.
   * 1 ⇒ on: the feeds are read, and whichever of `ptbPriority` / `ptbPace` is
   *     enabled uses them. With both off this is observation only.
   *
   * Everything else the player owns is derived from the order book, and the
   * market that blocks level 19 is exactly one where the book says nothing for
   * six minutes: the two asks cross repeatedly around 0.5 and the momentum
   * reading follows each swing. BTC's distance from the price to beat is an
   * independent read on the same question, and the two things it can do with it
   * are quite different — see `ptbPriority` and `ptbPace`.
   */
  ptbMode: z.coerce.number().int().min(0).max(1).default(1),
  /**
   * 1 ⇒ when BTC is decisively clear of the price to beat, the signal, not the
   * book, chooses which leg is chased.
   *
   * Ships off: by the time raw distance is decisive the book has long since
   * priced it, so this only ever repeats what momentum already said. The
   * informative case is the two readings DISAGREEING (`ptbFair`).
   */
  ptbPriority: z.coerce.number().int().min(0).max(1).default(0),
  /**
   * 1 ⇒ the accumulation pace requires OUTSIDE evidence as well as book
   * evidence: a leg may hold only as much of its target as the smaller of the
   * two readings supports.
   *
   * `edgeFull` already paces by how far the two asks have separated, on the
   * principle that a position may not be larger than the evidence behind it.
   * The book, though, is only one opinion, and in a whipsawing window it is a
   * loud one: the asks separate to 0.16 within seconds and the pace lets the
   * player commit half a leg to a market that has decided nothing.
   *
   * Crucially this is NOT the family of rules that failed before. Those capped
   * the price of the leg whose ask was RISING, which in a trending window is
   * the winner — so they systematically bought the loser. This one is blind to
   * which leg is which: it asks only whether BTC is far enough from the strike
   * that the outcome is settled at all, and in a genuinely trending window that
   * distance grows immediately, so the pace opens rather than closes.
   *
   * MEASURED AND REJECTED, and the reason is that it has exactly one scalar to
   * trade off. On level 19 the required distance has to be at least $60 to hold
   * the whipsawing market back and at most $55 to let the two markets that open
   * on a genuine move through; the boundary is that sharp, and nothing passes
   * both sides of it (30 and 45: markets 2 and 3 pass, 19 fails 1000/419 and
   * 1000/496; 50 and 55: 19 fails 1000/476 and 1000/531; 60: 19 passes, 2 fails
   * 267/1000; 70 and 90: 2 fails 227/1000). The whole level runs 17 of 19 at
   * $60. Smoothing the distance first (`ptbTauMs` 30s/60s/120s) does not
   * separate them either — 12 of 19 at a minute. Replaced by `ptbFair`, which
   * asks a question the book cannot answer instead of the same question louder.
   */
  ptbPace: z.coerce.number().int().min(0).max(1).default(0),
  /**
   * Which outside price is compared with the price to beat.
   *
   * `chainlink` is what the market actually resolves against but updates only
   * about once a minute; `binance` is continuous but carries a basis against
   * Chainlink; `blend` uses the Binance tape shifted by the latest observed
   * Chainlink−Binance basis, which is continuous AND anchored to the resolving
   * feed.
   */
  ptbSrc: z.enum(['binance', 'chainlink', 'blend']).default('blend'),
  /**
   * Dollars BTC must sit away from the price to beat, at the START of the
   * window, for the signal to name a leg. The requirement shrinks with the
   * square root of the time left, because that is how far a random walk can
   * still travel: $60 of lead means little with fifteen minutes to go and is
   * decisive with one.
   */
  ptbEdge: z.coerce.number().finite().min(0).default(60),
  /**
   * Time constant of the EMA applied to that distance before it is used as
   * evidence. 0 ⇒ use the instantaneous reading.
   *
   * A momentary excursion is not the same fact as a maintained one. BTC printing
   * $68 clear of the strike for a few seconds, in a window that spends the rest
   * of its time within $20 of it, released the pace at the exact top of a spike
   * and let a whole leg be bought there. Smoothing asks the outcome to have
   * STAYED decided, which a genuine trend does easily and a whipsaw never does.
   */
  ptbTauMs: z.coerce.number().finite().min(0).default(0),
  /**
   * 1 ⇒ the priority leg is chosen by DISAGREEMENT between the book and the
   * outside price, rather than by either one alone.
   *
   * The book prices UP at `askUp / (askUp + askDown)`. The outside price implies
   * its own probability: BTC is `diff` dollars from the strike with `leftFrac`
   * of the window to run, so on a random walk of scale `ptbSigma` the chance of
   * finishing above is `Φ(diff / (ptbSigma·√leftFrac))`. Where the two agree
   * there is nothing to say and the book's own momentum reading governs, exactly
   * as before. Where they disagree by more than `ptbFairEdge`, the book is
   * paying up for an outcome the underlying does not support, and the leg to
   * chase is the OTHER one — which is both cheaper now and, on this reading,
   * likelier to win.
   *
   * This is what the raw distance could not do. A pure magnitude gate has one
   * scalar to trade off — small enough to let a trending window through is
   * already too small to hold a whipsawing one back — and the measured boundary
   * between those two demands sits between 55 and 60 dollars, with markets
   * failing on either side of it. Disagreement separates the same two cases
   * cleanly, because a window whose book merely reflects the underlying produces
   * no disagreement at all, however far from the strike it is.
   *
   * This is what carries level 19: 19 of 19 with pair costs between 0.928 and
   * 0.969, against 18 of 19 without it.
   */
  ptbFair: z.coerce.number().int().min(0).max(1).default(1),
  /** Dollar scale of BTC's move over a FULL window: the 1σ of the model. */
  ptbSigma: z.coerce.number().finite().positive().default(110),
  /**
   * Probability gap between book and model below which neither is preferred,
   * when the two legs are close together. A leg that is already far behind is
   * read against `ptbFairLagEdge` instead.
   */
  ptbFairEdge: z.coerce.number().finite().min(0).max(1).default(0.07),
  /**
   * Time constant of the EMA applied to that gap. 0 ⇒ act on the instantaneous
   * reading.
   *
   * A disagreement that lasts ten seconds is a quote wobble; one that lasts a
   * minute is the book pricing an outcome the underlying is not supporting. The
   * player commits real money the moment the priority leg changes hands, so the
   * flip should require the second kind.
   */
  ptbFairTauMs: z.coerce.number().finite().min(0).default(30_000),
  /**
   * How far from a coin flip the BOOK may be and still be overruled by the
   * disagreement. 1 ⇒ no limit.
   *
   * The rule is meant to correct an indifferent book, not to argue with a
   * decided one. When the book opens at 0.41/0.60 it is already telling the
   * player which way the window has gone, and BTC — which has not moved yet —
   * says only that it has not moved yet. Treating that as a disagreement buys
   * the leg the market has already abandoned: measured on a strongly trending
   * market, the player took a full thousand shares of the outcome that expired
   * at a fifth of a cent. The book leads the underlying at the open, so the
   * override has to stand down whenever the book is speaking clearly.
   *
   * Measured and NOT shipped. It does rescue the trending market, and a second
   * one with it, but at both 0.05 and 0.08 it silences the override in the
   * whipsawing market too — whose useful disagreements happen while the book
   * sits at 0.58–0.62, inside the same band. The two cases are not separable by
   * how far the book has leaned; they ARE separable by when it leaned, which is
   * what `ptbFairAfterMs` does instead.
   */
  ptbFairBookMax: z.coerce.number().finite().min(0).max(1).default(1),
  /**
   * How far the MODEL itself must be from a coin flip, on the side it is
   * arguing for, before the disagreement counts. 0 ⇒ no requirement.
   *
   * This is the same objection as `ptbFairBookMax` seen from the other end, and
   * it is the sharper one. A gap can open in two ways: the underlying moves, or
   * the book leans. Only the first is information the player does not already
   * have. A window that opens at 0.41/0.60 with BTC exactly on the strike
   * produces a gap of 0.09 in which the model has contributed nothing at all —
   * it is not a prediction, it is the absence of one — and acting on it means
   * buying whatever the market has just abandoned. Requiring the model to have
   * moved keeps the override to cases where the underlying is actually saying
   * something.
   *
   * Measured and NOT shipped, for a reason worth keeping: at 0.03 and 0.06 it
   * fixes five of the six markets it was tested on and loses the whipsawing
   * one, because that market's decisive disagreements are precisely the ones
   * where the model contributes nothing — BTC keeps returning to the strike
   * while the book insists on 0.58–0.62. So "the book leans and the underlying
   * does not" is fatal in one market and load-bearing in another, and the thing
   * that tells them apart is the clock, not the size of either reading.
   */
  ptbFairModelMin: z.coerce.number().finite().min(0).max(0.5).default(0),
  /**
   * Milliseconds into the window before the disagreement may override anything.
   *
   * The book's OPENING lean is the one lean the player should not fade: it
   * carries whatever the market learned in the minutes before the window began,
   * and BTC starts every window exactly on its own strike, so the model has
   * nothing to say yet and a gap at t+0 measures only the book. A few tens of
   * seconds later the underlying has either confirmed the lean or failed to, and
   * the disagreement means what it claims to mean.
   *
   * 45 s is what ships and it is the whole difference between 17 and 19 of 19:
   * at 0 the override fires on the opening lean and loses two markets outright
   * (1000/200 and 200/1000 — a full leg of the outcome that expired worthless),
   * at 20 s one of them still fails, at 45 s every market on the level passes.
   */
  ptbFairAfterMs: z.coerce.number().finite().min(0).default(45_000),
  /**
   * Fraction of the window after which the disagreement stops overriding
   * anything. 1 ⇒ it never stops, which is what ships.
   *
   * `ptbFairAfterMs` opens this gate because the book's opening lean should not
   * be faded; this closes it for the opposite reason. The override redirects the
   * chase, and redirecting the chase is only affordable while there is still a
   * chase to redirect. Late in a window the player is no longer choosing between
   * two legs, it is finishing one, and a gate that changes its mind then leaves
   * the half-built leg unmatchable — the failures it produces are share counts
   * of exactly a half, 1000/500 and 500/1000, not pair costs.
   *
   * The reason to want it is measurable. Narrowing `ptbFairEdge` from the
   * shipped 0.07 to 0.03 repairs level 45's blocker outright and does so
   * repeatably — it is the only reading measured so far that names that market's
   * reversal from inside the window. It costs two markets already on the ladder,
   * and both of them lose their leg late. If the narrow reading can be given the
   * early window and denied the late one, the repair comes without the bill.
   *
   * MEASURED AND INERT AGAINST THAT BILL, so it ships at 1. Closing the gate at
   * 0.15, 0.25, 0.4 and 0.6 of the window all leave the two casualties failing
   * at exactly the same share counts, 1000/500 and 500/1000, as the narrow
   * reading with no closing time at all. The premise was wrong: those two legs
   * are not abandoned late, they are misassigned inside the first two minutes
   * and the half-built shape is only where they come to rest. The knob remains
   * because the closing time it expresses is real and cheap, but nothing on the
   * ladder currently needs it. The bill it was built to pay was eventually
   * removed a different way — see `ptbFairMinLag`.
   */
  ptbFairUntil: z.coerce.number().finite().min(0).max(1).default(1),
  /**
   * How far BEHIND the other leg the leg named by the disagreement must be, as
   * a fraction of `qty`, for `ptbFairLagEdge` to replace `ptbFairEdge`.
   *
   * This is what tells the narrow reading's repair apart from its casualties,
   * and it was read off their timelines rather than guessed. At the instant the
   * override first fires — 45 s, where `ptbFairAfterMs` opens it — all four
   * markets look alike on every reading the gate already has: the gap is a few
   * hundredths, the book sits between 0.33 and 0.75, the model between 0.39 and
   * 0.73, and in three of the four the model's own lean points the other way.
   * They differ on one thing only. The market the override repairs is holding
   * 594 of one leg and 136 of the other, and the leg the disagreement names is
   * the one 458 shares behind. All three casualties are holding 500 and 375,
   * and the leg named is behind by exactly 125.
   *
   * That difference is the whole argument for the override, not an incidental
   * fact about these four windows. Redirecting the chase is cheap when the
   * player is already lopsided: following the disagreement and closing the
   * imbalance are then the same action, and if the reading is wrong the player
   * has still bought the leg it was short of. When the two legs are close
   * together the override has no such cover — it spends the remaining ceiling
   * putting the player lopsided the OTHER way, which is exactly the shape all
   * three casualties come to rest in: 1000/556, 1000/500 and 500/1000.
   *
   * 0.2 ships. Over the first sixty markets, 0.15 and 0.2 both give the same
   * four failures in three independent runs each — level 45's blocker repaired,
   * no casualty anywhere — while 0.3 lets one balanced market through to
   * 1000/950. The floor is where it is because a lag of a fifth of the target
   * is well above the 125 shares the casualties carry and well below the 458
   * the repair carries.
   */
  ptbFairMinLag: z.coerce.number().finite().min(0).max(1).default(0.2),
  /**
   * The disagreement threshold that applies once the named leg is at least
   * `ptbFairMinLag` behind. 0 ⇒ `ptbFairEdge` always applies everywhere.
   *
   * 0.03 ships, against the 0.07 that governs balanced windows. This is what
   * carries level 45. Applied everywhere, 0.03 repairs the blocker and breaks
   * three markets that were passing, for a net 7 failures against 5; applied
   * only to a lagging leg it repairs the blocker and breaks nothing, 4 failures
   * against 5, reproduced in three independent runs.
   *
   * Two things were measured before this shape was arrived at, and both are
   * worth keeping because they are the reason it is a second THRESHOLD rather
   * than a second condition.
   *
   * Making the lag a hard requirement — no override at all below it — is worse
   * than no lag test whatsoever: 8, 10 and 10 failures over the first sixty
   * markets at 0.15, 0.2 and 0.35, against 7 for the narrow reading alone and 5
   * for the shipped wide one. The override is not a rescue mechanism that fires
   * only in trouble; it is load-bearing in ordinary balanced windows, and
   * silencing it there costs more markets than the casualties it saves.
   *
   * Testing the lag every tick also switches the override off halfway through
   * its own repair, because acting on it closes the very lag that licensed it.
   * Level 45's blocker lands on 1000/606 that way — better than the 1000/344 it
   * fails at, and still a failure. Hence the latch: the lag decides whether the
   * narrow reading may OPEN an override, and the override then lives or dies on
   * the disagreement alone.
   */
  ptbFairLagEdge: z.coerce.number().finite().min(0).max(1).default(0.03),
  /**
   * 1 ⇒ the narrow threshold's latch only keeps an override alive if the LAG
   * licensed that override in the first place. 0 ⇒ any override that has ever
   * opened is read at the narrow threshold from then on, which is what the
   * latch above did on its own.
   *
   * The latch exists because acting on the lag closes the lag, so an override
   * the lag licensed would switch itself off halfway through its own repair.
   * That argument says nothing about an override the lag never licensed — one
   * that opened on a single tick of the WIDE reading in a window where the two
   * legs were level, or where the leg the disagreement names is the leg already
   * ahead. Such an override gets the narrow threshold as a gift, and then it
   * only has to keep clearing 0.03 to run for the rest of the window.
   *
   * That gift is what loses the market blocking level 108. Its book leans UP
   * from the first quote while BTC sits within twenty dollars of the strike all
   * the way to the seventh minute, so the disagreement points DOWN. It clears
   * 0.07 for eight seconds around t+48s, hands the chase to DOWN, and then sits
   * between 0.040 and 0.069 — under the wide reading, over the narrow one — for
   * the next three minutes, holding the chase on DOWN while the book walks UP
   * from 0.48 to 0.58. The player finishes DOWN, and UP wins the window.
   *
   * 1 ships. On its own it takes that market from 200/1000 to 648/1000 — the
   * chase points the right way for three minutes — and it breaks nothing over
   * the first 110. What it does not survive is the last second of that chase;
   * see `ptbFairLagDwellMs`.
   */
  fairLagLatch: z.coerce.number().int().min(0).max(1).default(1),
  /**
   * Milliseconds the lag must have STOOD at `ptbFairMinLag` before it may
   * license the narrow threshold. 0 ⇒ the instant reading, which is what the
   * rule did on its own.
   *
   * The lag's whole argument is that redirecting the chase is cheap when the
   * player is already lopsided — following the disagreement and closing the
   * imbalance are the same action, so a wrong reading still leaves the player
   * holding the leg it was short of. That argument assumes the lopsidedness is
   * a condition the player has been living with. It is not an argument for a
   * lag the player created three hundred milliseconds ago by deliberately
   * chasing a leg.
   *
   * That is what the market blocking level 108 does. At t+190s it holds 469 of
   * UP against 344 of DOWN — 125 apart, under the floor — and in one second the
   * book jumps and it takes 217 more UP. The lag is now 342, the floor opens on
   * the same tick, the disagreement has been sitting quietly at 0.04 (over the
   * narrow reading, under the wide one) for three minutes, and the chase is
   * handed to DOWN. It spends 260 of its remaining 394 dollars buying DOWN out
   * at 0.38, and the 686 shares of UP it had just chosen to buy — in the window
   * UP wins — are stranded 314 short.
   *
   * 10 s ships, out of a flat band: over the first 110 markets, 5 s, 10 s and
   * 20 s all leave exactly one failure and it is the same market in all three.
   * The dwell only pays alongside `fairLagLatch=1` — on its own it leaves this
   * market failing untouched at 200/1000, because by t+190s the override is
   * already alive on the narrow threshold and never has to re-open.
   */
  ptbFairLagDwellMs: z.coerce.number().finite().min(0).default(10_000),
  /**
   * 1 ⇒ the priority leg is taken away from a leg whose completion the ceiling
   * can no longer pay for, and given to the other one.
   *
   * Every gate above this one asks whether a leg deserves to be bought. This
   * asks whether it can still be AFFORDED, which is a different question and
   * one the player can answer without an opinion: finish the leg it is chasing
   * at today's ask, fund the other leg at the cheapest price that leg has
   * actually shown, add the two to what has already been spent, and compare
   * with `qty × pairCeil`. If the sum overruns, the plan the book is
   * recommending has already failed; if the opposite assignment overruns less,
   * the player is chasing the wrong leg.
   *
   * The family it exists for is the window that leans, runs for a minute and
   * then reverses for good. The player finishes the leg the book was favouring
   * at around 0.63, and the leg it still needs a thousand of has never in the
   * whole window been quoted below 0.37 — a pair of 1.00 against a ceiling of
   * 0.97, decided while there were still thirteen minutes left to trade. The
   * arithmetic was available at the time: at the moment the leg was being
   * completed, "finish this leg and fund the other at its own cheapest ask"
   * already came to 1.01, and the same sum for the opposite assignment came to
   * 0.98.
   *
   * A leg's own cheapest ask so far is doing the real work here, and it is
   * worth saying why it is the right number. In a window that genuinely trends,
   * the leg not being chased keeps setting new lows, so the funding estimate
   * falls on its own and the chase stays affordable — the rule never fires. A
   * leg that has NEVER been cheap is a leg the market has never abandoned, and
   * funding a thousand shares of it is the bill the player is about to be
   * handed. So the same reading that makes the sum overrun is also the evidence
   * that the other leg is the one worth owning.
   *
   * It has to PROMOTE rather than merely refuse. Refusing alone deadlocks the
   * market: the chased leg stops buying and the other leg is still held to
   * `underdogMax`, so neither side trades for the rest of the window and the
   * player ends with less than it started the refusal with. Handing the chase
   * over is what turns the refusal into the recovery — the newly promoted leg
   * gets a real allowance, and the demoted one, which is by now the leg the
   * market is abandoning, is completed late at a few cents under the same
   * `underdogMax` that was blocking it.
   *
   * It is self-correcting rather than latched, and deliberately so. Once the
   * demoted leg has fallen far enough its own completion becomes solvent again
   * and it is chased again — which is exactly right, because a cheap leg is a
   * cheap leg whatever the player thought of it two minutes ago.
   *
   * MEASURED AND REJECTED. Over the first sixty markets, against five failures
   * with the rule off: 11 failures at `solvEdge` 0 (twice), 11 at 0.02, 10 at
   * 0.03, 12 at 0.04, 7 at 0.05; and exactly the baseline five — share for
   * share, i.e. the rule never fires at all — at 0.10, or at 0.05 from two
   * minutes onward. It is strictly worse than the baseline everywhere it is
   * active and identical to it everywhere it is not; there is no setting in
   * between. It does repair market 45, the specimen it was built for, but takes
   * seven other markets to do it.
   *
   * The reason is in the arithmetic, not the tuning. Two asks on the same market
   * sum to about one all window, so "finish this leg and fund the other at its
   * own cheapest ask" overruns a ceiling of 0.97 in nearly every market from the
   * first minute — the overrun is not a signal, it is the normal state. What is
   * left to decide the swap is the DIFFERENCE between the two assignments, which
   * reduces to how far each leg sits above its own trailing low, and that is a
   * couple of cents wide. So a deadband big enough to ignore quote noise is big
   * enough to ignore the whole signal, and anything smaller hands the chase to
   * whichever leg is nearest its own low — which is `priority=cheap`, the rule
   * the player already knows loses, reached by a longer road.
   */
  solvSwap: z.coerce.number().int().min(0).max(1).default(0),
  /**
   * Fraction of the other leg's own cheapest observed ask used as its funding
   * price in that sum. 1 ⇒ plan to pay exactly what it has already shown.
   *
   * Below 1 the player assumes the leg it is not chasing will get cheaper than
   * it has yet been, which is true in a trending window and is the assumption
   * that loses a reversing one. Above 1 has no meaning: a price never seen is
   * not evidence.
   */
  solvFrac: z.coerce.number().finite().min(0).max(1).default(1),
  /**
   * How much cheaper, per pair, the opposite assignment must project before the
   * chase is handed over. 0 ⇒ any improvement is enough.
   *
   * Both assignments overrun in the markets this rule is for, so the comparison
   * is between two failures and the margin between them is small — a few cents
   * of pair cost. A deadband here buys stability against a swap that flickers
   * on quote noise, at the price of leaving the smaller mistakes unfixed.
   */
  solvEdge: z.coerce.number().finite().min(0).max(0.5).default(0),
  /**
   * Milliseconds into the window before the swap may fire.
   *
   * At the open both legs sit either side of 0.50 and neither has ever been
   * cheap, so the sum overruns for BOTH assignments and the comparison between
   * them is decided by a cent of spread — which is to say by nothing. That is
   * the `priority=cheap` rule the player already knows loses, arrived at
   * sideways. The arithmetic only becomes informative once one leg has had time
   * to be abandoned and the other has not.
   */
  solvAfterMs: z.coerce.number().finite().min(0).default(60_000),
  /**
   * Multiple of the remaining budget's own average that the priority leg may
   * pay. 0 disables it.
   *
   * Every other price cap in this file reserves money for the OTHER leg at some
   * guess about what that leg will cost — `underdogMax` guesses a loser's few
   * cents, `reserveLow` guesses the cheapest price that leg has actually shown.
   * Both guesses are about a leg the player is not currently buying, and both
   * are wrong in the same direction when the window reverses: the leg left
   * behind turns out to be the winner and none of the reserved money is
   * anywhere near enough.
   *
   * This cap makes no guess at all. The player still needs `needUp + needDown`
   * shares and has `budgetLeft` to buy them with, so `budgetLeft / (needUp +
   * needDown)` is the average it can afford across everything still
   * outstanding — a fact, recomputed every tick, that needs no view on which
   * leg is which. Paying above that average is not forbidden; the whole
   * strategy depends on paying above it for the favourite and far below it for
   * the loser. What the multiple says is HOW FAR above it a single leg may go
   * before the arithmetic it is leaving behind stops being survivable.
   *
   * It is the failure shape shared by the four markets that block level 46,
   * read off their timelines side by side. Each spends between a half and three
   * fifths of its ceiling acquiring six hundred-odd shares of one leg at an
   * average near 0.59, the window then reverses, and the leg still owed six or
   * seven hundred shares is quoted at 0.65 to 0.85 against a remaining budget
   * that affords 0.60. At the instant of those fills the remaining average is
   * 0.41 to 0.48 and the price being paid is 1.3 to 1.5 times it; at the open,
   * where the same legs must be bought for the strategy to work at all, the
   * ratio is 1.0 to 1.15. The two regimes separate on this ratio in a way they
   * do not separate on price, on elapsed time, or on either leg's own history.
   *
   * It tightens on its own as the budget goes, which is what the reserve family
   * could never do: the more of the ceiling is already committed, the smaller
   * the average that remains and the lower the cap, so the last third of the
   * budget cannot be spent at opening prices.
   *
   * MEASURED AND DEAD, by a wide margin: over the first sixty markets, 19
   * failures at 1.15, 19 at 1.25, 18 at 1.35 and 17 at 1.45, against four with
   * it off — and none of the four markets it was built for is repaired at any
   * setting. The separating ratio does not exist. Reading it off four timelines
   * gave a window of 1.15 to 1.3; measured across sixty, ordinary passing
   * markets routinely buy their favourite at two and three times the remaining
   * average, late in the window when the average has collapsed but the leg
   * still has to be finished. The cap's self-tightening, the property it was
   * built for, is exactly what makes it ruinous: the last third of the budget
   * is when the second leg is bought, and refusing to spend it at anything
   * above a shrinking average strands a leg in market after market.
   */
  budgetPace: z.coerce.number().finite().min(0).max(4).default(0),
  /**
   * Milliseconds into the window before `budgetPace` engages. 0 ⇒ from the open.
   */
  budgetPaceAfterMs: z.coerce.number().finite().min(0).default(0),
  /**
   * How far above its own ask EMA the priority leg may be bought. 1 disables it.
   *
   * Every price cap this file has rejected is PINNED to something the leg can
   * never get back to. `chasePad` pins to the leg's cheapest ask ever, the
   * reserve floor pins to the other leg's cheapest ask ever, `budgetPace` pins
   * to an average that only falls as money is spent. All three fail the same
   * way and the failures are share counts, not pair costs: the leg that is
   * running away is refused, its price never returns, and the market ends with
   * a stranded leg at 200 to 600 of 1,000. A cap that cannot follow a real move
   * cannot tell a real move from a spike, so it refuses both.
   *
   * This one FOLLOWS. The leg's own exponential average of its ask is a moving
   * reference: a sustained trend drags it along within a time constant, so the
   * cap climbs behind the price and the leg is bought the whole way up, a few
   * seconds late and a cent or two dearer. An instantaneous jump outruns it,
   * because an average cannot move fourteen cents in five seconds, so the cap
   * bites exactly there. The distinction it draws is between a price that has
   * moved and a price that is moving, and that is the distinction the four
   * markets blocking level 46 turn on.
   *
   * Their common anatomy: the book jumps, the player crosses into the jump, and
   * the jump reverts within a minute — 400 shares at 0.59-0.64 while the
   * average sat at 0.51, 625 shares at 0.63-0.67 while it sat at 0.46, 456
   * shares at 0.54-0.61 while it sat at 0.53. In each case the reversion left
   * the other leg quoted above what the remaining ceiling could ever pay, and
   * the market failed on share count with more than half the budget already
   * spent on the wrong outcome. Being a few seconds late to those fills costs
   * almost nothing; being on time for them costs the market.
   *
   * Unlike a pinned cap it also releases itself, which is what makes refusing
   * safe: the player is never left waiting on a price that has gone, only on an
   * average that is still catching up.
   *
   * NOT SHIPPED, and it is the most interesting failure in this file, because
   * it is the first restraint on the chase that repairs anything at all.
   * Over the first sixty markets, against four failures with it off: 11 at pad
   * 0.03, 9 at 0.05, 6 at 0.08, 6 at 0.12 (all at the default time constant),
   * and with the pad held at 0.08, 6 at a time constant of 8 s, 5 at 15 s, 5 at
   * 20 s, 10 at 45 s. At its best it fixes markets 46 and 55 — the two whose
   * fills come inside a jump, and which no pinned cap has ever moved by a
   * single share — and the mechanism does exactly what it was designed to do.
   *
   * It is not shipped because of what it cannot reach and what it costs. The
   * other two blocking markets are not jumps at all: their legs climb eight
   * cents over sixty seconds, which an average follows comfortably, so the cap
   * waves them through at every setting tried. And the delay it imposes is not
   * free — a leg held back through a climb is finished later and dearer, which
   * is how the second market of the universe goes from passing to buying its
   * last three hundred shares at 0.72 and stranding the other leg at four
   * tenths. The twenty-sixth market, which is starved by every restraint this
   * file has ever tried, is lost here too.
   *
   * The lesson worth keeping is the diagnosis, not the knob: the four markets
   * are two different failures wearing the same result. Two of them buy inside
   * a spike and are reachable by a cap that can tell a spike from a trend; two
   * of them buy a genuine trend that later reverses, and nothing that reads the
   * price path can distinguish those from the trends the player must chase.
   */
  jumpPad: z.coerce.number().finite().min(0).max(1).default(1),
  /**
   * Milliseconds into the window before `jumpPad` engages. 0 ⇒ from the open.
   *
   * The EMA is seeded with the first ask it sees, so for the first fraction of
   * a time constant it IS the current price and the cap is at its tightest
   * precisely when the opening lean has to be bought.
   */
  jumpPadAfterMs: z.coerce.number().finite().min(0).default(0),
  /**
   * Time constant of the ask average `jumpPad` measures against. 0 ⇒ reuse
   * `momentumTauMs`, the average the priority rule already keeps.
   *
   * The two readings want different memories. Momentum asks which leg is
   * rising, which wants a long enough window to survive a pullback; the jump
   * filter asks whether THIS price has been available for more than a moment,
   * which wants a short one, or it refuses trends it should be following.
   */
  jumpTauMs: z.coerce.number().finite().min(0).default(0),
  /**
   * 1 ⇒ `jumpPad` governs only the decision to CROSS the spread, leaving the
   * resting bid where the rest of the budget machinery puts it.
   *
   * The whole cost of the following cap is the delay it imposes: a leg held
   * back through a legitimate climb is finished later and dearer, and one
   * market of the first sixty pays 0.72 for its last three hundred shares
   * instead of 0.61 for exactly that reason. But the delay and the refusal are
   * separable. What actually does the damage in a spike is CROSSING into it —
   * taking the ask while it is fourteen cents above where it sat five seconds
   * ago. A bid resting one tick under that ask is a different animal: it cannot
   * chase, it only fills if the price comes back to it, and when the spike
   * reverts it is exactly where the player wants to be.
   *
   * So this splits the mechanism in two. The cap still refuses to pay up, and
   * the leg still stays in the book at the best passive price the ceiling
   * allows, filling on every downtick. In a climb that means the leg keeps
   * building — a tick behind, maker-priced, but building — which is the cost the
   * unsplit cap could not avoid.
   */
  jumpCross: z.coerce.number().int().min(0).max(1).default(0),
  /**
   * Fraction of `qty` past which `jumpPad` stops applying to a leg. 1 ⇒ never.
   *
   * The same argument `finishShare` makes about the evidence pace: refusing to
   * GROW a position costs only the opportunity, while refusing to FINISH one
   * costs everything already spent on it, because the shares left unbought make
   * every share already held unmatchable. A leg eight tenths built is not a
   * commitment being considered, it is a commitment made, and the cheapest way
   * to complete it is usually now rather than after the average catches up.
   *
   * This is also where the unsplit cap's one clear casualty goes wrong: the leg
   * it delays is completed minutes later at a price the delay itself created.
   */
  jumpFinishShare: z.coerce.number().finite().min(0).max(1).default(1),
  /**
   * Dollars BTC must travel away from its own short average before the player
   * stops buying anything at all. 0 disables the gate.
   *
   * Every restraint in this file so far reads a PRICE — the leg's own ask, the
   * other leg's ask, a budget average — and every one of them fails the same
   * way: the leg whose ask is rising is, in a window that trends, the winner,
   * and refusing it hands the ceiling to the loser. `jumpPad` got closest by
   * reading the ask's own average, and it still cannot separate the two markets
   * that matter, because the BOOK looks the same in both: a lurch to a new
   * level with the model agreeing.
   *
   * The underlying does not look the same. Read the two side by side:
   *
   *   - the market that must be chased moves 25 dollars in five seconds and then
   *     keeps going — 18, 36, 43, 54, 69 dollars clear of the strike at five
   *     second intervals, a ramp;
   *   - the market that must not be chased moves 91 dollars in five seconds and
   *     gives two thirds of it back in the next five, a spike.
   *
   * Both produce a decisive book and a confident model at the instant the money
   * is committed. They differ in the SPEED of the underlying, and speed is
   * something the order book cannot express, because a book that has re-priced
   * has re-priced regardless of how quickly it got there.
   *
   * So this gate is not a price cap and names no leg. It asks one question — is
   * the underlying in a violent excursion right now? — and while the answer is
   * yes the player buys nothing, on either side, and pulls whatever it has
   * resting so a bid cannot be run through by the excursion itself. A spike
   * lasting seconds costs the player those seconds. A genuine move settles
   * within one time constant and the player resumes with its budget intact,
   * which is the whole difference: after refusing the spike in the market that
   * blocks this level, the player still holds 469 and 375 of the two legs with
   * half the ceiling unspent, and the reversal it then trades into is affordable.
   *
   * SHIPS AT 35, with `spikeHoldMs` 10 s, and it is the first restraint in this
   * file that repairs anything WITHOUT costing anything. Over the first sixty
   * markets it takes the failures from four to two, and the two it removes are
   * the pair of spike markets no price cap has ever moved. Nothing else changes:
   * the market that every restraint starves, and the one the previous best
   * attempt broke, are untouched, because neither of them ever sees the
   * underlying travel more than 27 dollars from its own average.
   *
   * The surviving band on this axis is 30 to 40 dollars — 30, 35 and 40 all take
   * the first sixty to fifty-eight, repeatedly, while 45 loses one of the two
   * spike markets outright (1000/0) and 50 loses both. Treat the upper edge as
   * real: too large a threshold does not make the player braver, it simply stops
   * seeing the event.
   */
  spikeEdge: z.coerce.number().finite().min(0).default(35),
  /**
   * Time constant of the BTC average `spikeEdge` measures deviation from. Short
   * by design: the question is whether the price is moving NOW, not where it has
   * been.
   */
  spikeTauMs: z.coerce.number().finite().positive().default(5_000),
  /**
   * Milliseconds into the window before the spike gate engages. The average is
   * seeded with the first reading it sees, so the opening ticks are the one
   * stretch where a deviation means nothing.
   */
  spikeAfterMs: z.coerce.number().finite().min(0).default(0),
  /**
   * Milliseconds the spike gate stays engaged after the last reading above
   * `spikeEdge`. 0 ⇒ the gate is instantaneous.
   *
   * Instantaneous, it does not work, and the reason is the feed rather than the
   * idea. The outside price is a Binance tape shifted by the latest Chainlink
   * basis, and tick to tick it jitters by tens of dollars, so the deviation
   * crosses any threshold in bursts: in the market this gate is for it reads 86,
   * then 26, then 14, then 72, then 44, 45, 31 on consecutive seconds. The gate
   * flickers, and the player does its buying in the gaps — the leg is completed
   * inside the excursion exactly as before, one second at a time.
   *
   * A spike is an event, not an instant. Once the underlying has printed that
   * far from its own average, the seconds that follow are the ones where the
   * book is mispriced and the reversion has not happened yet, and those are
   * precisely the seconds the player must sit out. The hold turns a threshold
   * crossing into a refractory period.
   *
   * The plateau is 8 to 12 seconds and both edges of it are real, measured over
   * the first sixty markets at the shipped threshold. At 5 s the gate lifts
   * before the excursion has finished and the market it exists for is lost
   * exactly as before. At 15 s it starts costing a market that has nothing to do
   * with spikes — a window that trends early and needs its favourite bought
   * inside the first minute, which is time the hold spends refusing. 10 s is the
   * middle, and it is roughly two time constants of the average it measures
   * against, which is about how long these excursions take to unwind.
   */
  spikeHoldMs: z.coerce.number().finite().min(0).default(10_000),
  /**
   * Fraction of the window over which a leg's holding allowance ramps from
   * `holdRamp0` to the full target. 0 ⇒ off, no ramp at all.
   *
   * Every other pace in this file is keyed to evidence — how far the asks have
   * separated, how confident the book is, what the outside price says. This one
   * is keyed to nothing but the clock, and that is the point. The market it
   * exists for leans hard for a minute, and every evidence-shaped rule agrees
   * with the lean, because at that moment the evidence genuinely does say the
   * leg is running away. Then the window turns and never comes back.
   *
   * The anatomy of the specimen: at seventy-five seconds the player owned all
   * 1,000 of the leg the book was favouring, at an average of 0.62, having spent
   * eight tenths of its ceiling in the first minute and a quarter of a
   * fifteen-minute window. Twenty seconds later that leg began a slide it never
   * recovered from, ending at 0.002. The other leg was quoted at 0.39 while the
   * last four hundred shares of the first were being taken at 0.64. There was no
   * reading available at seventy-five seconds that named the reversal — but
   * there was also no reason to have finished anything yet. Fourteen minutes of
   * trading remained and the player had no budget left to trade them with.
   *
   * So the rule says only this: this early in the window, you may not own this
   * much of one leg yet. It is a SIZE limit and it posts nothing, which is what
   * separates it from every price cap this file has rejected — `chasePad` and
   * the reserve floor both leave a bid resting below the market, and a leg that
   * reverses falls straight through it, so the player pays the capped price
   * anyway and the cap buys nothing but a worse entry.
   *
   * The cost is real and is the mirror image: in a window that trends and does
   * NOT come back, the winner is cheapest in its first seconds, and a clock that
   * refuses to own it then makes it be bought later and dearer. `holdRamp` is
   * the length of that penalty and `holdRamp0` its depth.
   *
   * MEASURED AND REJECTED, and the mirror image turns out to be much the larger
   * half. Over the first sixty markets, against five failures with the ramp off:
   * 14 failures at (span 0.15, floor 0.5), 20 at (0.3, 0.5), 18 at (0.3, 0.65),
   * 24 at (0.5, 0.5) — monotone in how much restraint is applied, and ruinous
   * well before the restraint is deep enough to matter. The failures are share
   * counts, not pair costs: market after market ends with a leg stranded at 600
   * to 750 of 1,000, which is the signature of a leg that was refused while it
   * was cheap and unaffordable by the time the clock let go of it.
   *
   * It does not even repair the specimen. At its deepest useful setting market
   * 45 improves from 1000/344 to 1000/531 and still fails; at the shallower ones
   * it is unchanged share for share. The reason is the pair ceiling rather than
   * the pace: by the time the ramp lets go, the leg it restrained has still been
   * bought at an average around 0.55, and the other leg has by then reversed
   * past 0.52, so no allowance the ceiling can compute will buy it. Slowing the
   * accumulation does not help when the damage is the PRICE of what was
   * accumulated; the clock simply cannot tell the leg that is running away from
   * the leg that is about to turn round.
   */
  holdRamp: z.coerce.number().finite().min(0).max(1).default(0),
  /**
   * Share of the whole budget the player may have SPENT at the open, ramping to
   * all of it by `spendPaceUntil`. 1 disables the pace.
   *
   * `holdRamp` rations shares and fails because a share is not the scarce thing:
   * refusing a leg at 0.05 costs the window its cheap half for no saving, while
   * one clip at 0.60 does the real damage. Money is the scarce thing, and it is
   * the quantity the pair ceiling is actually denominated in. Rationed by money,
   * the same clock lets the cheap side through untouched — five hundred shares
   * at a nickel spend what fifty do at half a dollar — and bites only on the
   * expensive commitment made before the window has said anything.
   *
   * That is exactly the shape of the two windows blocking this level: both spend
   * more than half of everything they have inside the first minute, on a leg
   * quoted between 0.53 and 0.61 with the book still a coin flip, and both then
   * reverse and cannot fund the leg that wins.
   *
   * MEASURED AND REJECTED. The reasoning survives contact — money IS the right
   * quantity, and rationing it does exactly what it promised. Market 47 goes
   * from 1000/281 to a clean 1000/1000, market 52 from 344 to 825, and the pair
   * costs of what it does buy fall to 0.83–0.95, the cheapest this player has
   * ever bought. It still fails, and worse than `holdRamp`: at (0.15, 0.6),
   * 22 failures over the first sixty markets against two. Anything gentle
   * enough to be safe is inert — at 0.35 the allowance at t+90 s already exceeds
   * what the losing windows had spent by then, so nothing changes at all.
   *
   * The failures are share counts, never pair costs, and that is the whole
   * lesson. This player wins by completing legs; a budget it may not spend is a
   * leg it may not finish, and an unmatched share is worth nothing however
   * cheaply it was bought. The clock cannot distinguish money spent early on
   * the leg that wins from the same money spent on the leg that turns.
   */
  spendPace: z.coerce.number().finite().min(0).max(1).default(1),
  /** Fraction of the window by which the whole budget is released. */
  spendPaceUntil: z.coerce.number().finite().min(0.05).max(1).default(0.33),
  /**
   * Share of the target either leg may hold at the open, before the ramp has
   * opened at all. 1 disables the ramp as surely as `holdRamp` 0.
   */
  holdRamp0: z.coerce.number().finite().min(0).max(1).default(0.5),
  /**
   * 1 ⇒ when the priority leg has run into its ramp allowance and the other leg
   * has not, the other leg becomes the priority.
   *
   * Without this the ramp deadlocks the market instead of steering it. A leg
   * that is not the priority is held to `underdogMax`, a loser's price it will
   * not be quoted at while it is still contested — so freezing the priority leg
   * and leaving the assignment alone stops BOTH legs, and the player waits out
   * the ramp having bought nothing with the time. Handing the chase over is what
   * turns the refusal into a purchase: the newly promoted leg gets a real
   * allowance and spends the paused minutes buying the side the player is short
   * of, at whatever the book is asking for it.
   */
  holdSwap: z.coerce.number().int().min(0).max(1).default(1),
  /**
   * A SECOND, higher pair budget that only a nearly-complete leg may reach, and
   * only by taking the ask. 0 (or anything at or below `pairCeil`) disables it.
   *
   * `pairCeil` is deliberately set below the 0.98 the game scores against, and
   * the gap is insurance: a window that ends one leg short scores its pair cost
   * against the shares it actually matched, so a run that spends right up to
   * 0.98 and then falls short posts a cost above the ceiling. The insurance is
   * worth holding while the position is still being built.
   *
   * It is worth nothing at all in the one case this exists for. A leg nine
   * tenths built, whose last hundred shares are on the screen at a price the
   * plan misses by a cent, is not a position being built — it is a position
   * that either completes in the next second or scores zero. Refusing to spend
   * a dollar of the insurance there does not protect the ceiling; it guarantees
   * the loss the insurance was bought against.
   *
   * Measured on the market that gates level 52: the plan has 92 dollars left
   * for the last 102 shares of the chased leg and 344 of the other, which
   * prices the chase at 0.565. The offer is 0.56 and the taker fee 1.7 cents,
   * so the take is refused by 1.2 cents — 1.25 dollars on a 1,000-share
   * position. The offer never comes back: the leg stalls at 898, the window
   * ends 1000/898 and scores −44. With the exemption the same window takes the
   * offer, finishes at 1000/1000, and lands at 0.967 a pair — the identical
   * result the luckier latency draws already reach without it.
   *
   * The exemption is narrow on purpose: extra budget can only be spent to
   * FINISH a leg (`finishCeilShare`), never to accumulate one, and only through
   * a crossing order, so it can never raise a resting bid.
   */
  finishCeil: z.coerce.number().finite().min(0).max(0.98).default(0.975),
  /**
   * Fraction of `qty` a leg must already hold before `finishCeil` applies to
   * it. 1 ⇒ never.
   *
   * The same argument `finishShare` and `jumpFinishShare` make: refusing to GROW
   * a position costs only the opportunity, while refusing to FINISH one costs
   * everything already spent on it.
   */
  finishCeilShare: z.coerce.number().finite().min(0).max(1).default(0.85),
  /**
   * 1 ⇒ a leg whose PARTNER is already complete also reads the finish budget,
   * whatever fraction of its own target it holds.
   *
   * `finishCeilShare` releases the extra budget to a leg that is nearly done on
   * the argument that the shares it still owes make everything already bought
   * unmatchable. That argument is at its strongest, not its weakest, when the
   * OTHER leg has reached `qty`: at that point the player holds a thousand
   * shares whose entire value depends on the trailing leg being completed, and
   * every dollar the ceiling withholds from it is a dollar that buys nothing at
   * all. The share test cannot see this — it asks how far the trailing leg has
   * come, and a leg at three tenths reads as an accumulation to be paced even
   * when it is the only purchase left in the window.
   *
   * The market that blocks level 87 is exactly this shape. Its window grinds one
   * way for three minutes, the player finishes that leg at the top of the move,
   * the market comes all the way back, and the trailing leg is offered at 0.28
   * against a remaining budget that affords 0.2997 a share — a fill that would
   * have closed the pair at 0.966 and passed. Six hundred shares are refused for
   * a cent, and there is no second offer.
   *
   * Narrow in the same two ways `finishCeilShare` is: crossing only, so it can
   * never raise a resting bid, and only ever the difference between `pairCeil`
   * and `finishCeil` — five dollars at the shipped settings, which is all this
   * market needed. Over the first 110 markets it repairs 87 and moves nothing
   * else: the failures either side of it are unchanged, and raising the whole
   * ceiling to buy the same cent instead costs market 39.
   */
  closeFinish: z.coerce.number().int().min(0).max(1).default(1),
  /** 1 ⇒ print a per-window diagnostic summary (book extremes, fills). */
  /** 0 off, 1 the decision timeline, 2 the whole-window observation channel. */
  debug: z.coerce.number().int().min(0).max(2).default(0),
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

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation). */
function normCdf(z: number): number {
  const x = z / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return 0.5 * (1 + (x >= 0 ? y : -y))
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
  /** The shorter ask average `jumpPad` measures against. */
  const jumpEma: Record<Side, number | null> = { UP: null, DOWN: null }
  let lastEmaMs = 0
  // Latched priority leg — see `momDeadband`.
  let priorityLeg: Side | null = null
  // Committed priority leg for the whole window — see `priorityLatch`.
  let latched: Side | null = null
  // The leg that currently holds the priority role — see `swapEdge`.
  let committed: Side | null = null
  // The leg that was behind when the player first became committed to the other
  // one, latched for the rest of the window — see `commitShare`.
  let chaseLeg: Side | null = null
  // Total time that leg has held the momentum lead since the latch, and the
  // previous tick's reading it is accumulated from — see `commitLeadMs`.
  let chaseLeadMs = 0
  let prevLeadSide: Side | null = null
  let prevLeadAtMs = 0
  // Whether the exemption has been armed — one way, see `commitLag`.
  let commitArmed = false
  // When the committed leg first started reading as wrong, and 0 whenever it is
  // not reading that way. Reset on every tick the test fails, so it measures a
  // CONTINUOUS stretch rather than a total. See `commitDwellMs`.
  let chaseWrongSinceMs = 0
  // The leg `oracleHold` has caught. Latched: the cap follows that leg for the
  // rest of the window and never touches the other one. See `oracleHold`.
  let holdLatch: Side | null = null
  // The leg `fairHold` is capping on THIS tick, if any. Recomputed every tick
  // from the model-book disagreement, never latched, and only ever the leg that
  // is ahead of its partner. See `fairHold`.
  let fairCapSide: Side | null = null
  // The leg `fairHold` has handed the chase TO, on this tick. Exempt from the
  // book's own pace: the whole premise of the cap is that the ask gap is not
  // evidence, so it may not ration the leg the cap is buying instead.
  let fairHandover: Side | null = null
  // The leg `fairHold` has actually stopped. Latched for the rest of the window,
  // and released only once its partner is complete. See `fairHold`.
  let fairHeld: Side | null = null
  // Each leg's near-depth imbalance — the share of the size within
  // `depthLevels` that sits on the bid — smoothed over `depthTauMs`. Null until
  // the first tick. See `depthHold`.
  const depthImb: Record<Side, number | null> = { UP: null, DOWN: null }
  // Each leg's ABSOLUTE near depth — the total size within `depthLevels`, bid
  // plus ask — on the same time constant. This is what the ratio above is a
  // share OF, and what decides whether that share means anything. See
  // `depthMinDep`.
  const depthAbs: Record<Side, number | null> = { UP: null, DOWN: null }
  // The same three latches as `fairHold`, driven by the depth reading instead of
  // the model-book disagreement. `depthCapSide` and `depthHandover` are per-tick
  // and MUST be cleared above the both-legs-contested branch; `depthHeld` is
  // latched for the window. See `depthHold`.
  let depthCapSide: Side | null = null
  let depthHandover: Side | null = null
  let depthHeld: Side | null = null
  // Which leg the cap is currently armed on, carried ACROSS ticks so the
  // release may use a lower gate than the arm. Null while unarmed. See
  // `depthRelease`.
  let depthArmed: Side | null = null
  // The same three latches again, driven by how fast one leg is spending the
  // ceiling. `burstCapSide` and `burstHandover` are per-tick and MUST be cleared
  // above the both-legs-contested branch; `burstHeld` is latched for the window.
  // See `burstSwap`.
  let burstCapSide: Side | null = null
  let burstHandover: Side | null = null
  let burstHeld: Side | null = null
  // When each leg last went above the edge pace's current allowance and stayed
  // there. 0 while the leg is inside its allowance. See `stallFinish`.
  const overSinceMs: Record<Side, number> = { UP: 0, DOWN: 0 }
  // Instrument only: whether the stall release has already been reported for a
  // leg, so `debug>=2` prints ONE line at the instant it first fires. Reads
  // nothing, gates nothing. See `stallFinish`.
  const stallLogged: Record<Side, boolean> = { UP: false, DOWN: false }
  // The highest edge allowance each leg has ever been granted, in shares. A leg
  // holding more than the pace allows is only a RATCHET victim if the allowance
  // once covered what it holds; a leg that never had the licence is one the pace
  // is legitimately still refusing. See `stallFinishLic`.
  const peakAllow: Record<Side, number> = { UP: 0, DOWN: 0 }
  // The last moment the player spent anything at all, and the total it had spent
  // then, so `stallFinishIdle` can ask how long the window has been silent.
  let lastSpend = -1
  let lastSpendMs = 0
  // The same reading PER LEG: when this leg last bought a share. Maintained
  // unconditionally — a deque or clock read by a rule but written behind a
  // disabled guard is the trap that cost session 30 a full afternoon.
  // See `stallFinishIdleSide`.
  const lastSideSpend: Record<Side, number> = { UP: -1, DOWN: -1 }
  const lastSideSpendMs: Record<Side, number> = { UP: 0, DOWN: 0 }
  // The last moment the cap's full arming condition held, so the grace period
  // after it stops holding can be bounded. See `depthReleaseMs`.
  let depthStrictMs: number | null = null
  // The last time the book was NOT already pricing this leg as the favourite —
  // how old the lean on it is. See `depthFreshMs`.
  const lastEvenMs: Record<Side, number | null> = { UP: null, DOWN: null }
  // When the current unbroken stretch of "the book leans by at least
  // `convEdge`" began. Null while the book is inside the deadband.
  let leanSinceMs: number | null = null

  /**
   * Sliding-window minimum of each leg's ask, as a monotonically increasing
   * deque of (time, ask) samples: the head is the window's low, and a sample is
   * dropped as soon as a later, lower one makes it unreachable. That keeps both
   * the update and the query O(1) amortised over the ~100k ticks a market
   * delivers, and it is exact rather than a decayed approximation, so the cap it
   * feeds can be read straight off a price chart.
   */
  const lowQ: Record<Side, { t: number; v: number }[]> = { UP: [], DOWN: [] }
  const pushLow = (side: Side, t: number, v: number): void => {
    const q = lowQ[side]
    while (q.length > 0 && q[q.length - 1]!.v >= v) q.pop()
    q.push({ t, v })
    if (cfg.chaseLookbackMs > 0) {
      const cutoff = t - cfg.chaseLookbackMs
      while (q.length > 1 && q[0]!.t < cutoff) q.shift()
    }
  }
  const trailingLow = (side: Side): number => lowQ[side][0]?.v ?? Infinity

  /**
   * Rolling record of each leg's holding, kept so the rate cap can ask how many
   * shares a leg has acquired in the last `commitRateMs`. The head is the newest
   * sample at or before the start of that window, so the answer is one
   * subtraction; everything older is dropped as it falls out.
   */
  const rateQ: Record<Side, { t: number; h: number }[]> = { UP: [], DOWN: [] }
  const pushRate = (side: Side, t: number, h: number): void => {
    const q = rateQ[side]
    q.push({ t, h })
    const cutoff = t - cfg.commitRateMs
    while (q.length > 1 && q[1]!.t <= cutoff) q.shift()
  }
  const boughtRecently = (side: Side, h: number): number => h - (rateQ[side][0]?.h ?? h)

  /**
   * The same deque on its own window, for the depth latch. It cannot share
   * `commitRateMs`: one second is the right window for throttling a chase and
   * far too short to tell a leg mid-burst from a leg that is standing still,
   * because the burst arrives in thirty-share fills a second apart.
   */
  const depthQ: Record<Side, { t: number; h: number }[]> = { UP: [], DOWN: [] }
  const pushDepthRate = (side: Side, t: number, h: number): void => {
    const q = depthQ[side]
    q.push({ t, h })
    const cutoff = t - cfg.depthRateMs
    while (q.length > 1 && q[1]!.t <= cutoff) q.shift()
  }
  const boughtOverDepthWindow = (side: Side, h: number): number => h - (depthQ[side][0]?.h ?? h)

  /**
   * The same deque over MONEY rather than shares, so the burst cap can ask how
   * much of the pair budget a leg has committed in the last `burstMs`.
   */
  const burstQ: Record<Side, { t: number; b: number }[]> = { UP: [], DOWN: [] }
  const pushBurst = (side: Side, t: number, b: number): void => {
    const q = burstQ[side]
    q.push({ t, b })
    const cutoff = t - cfg.burstMs
    while (q.length > 1 && q[1]!.t <= cutoff) q.shift()
  }
  const spentRecently = (side: Side, b: number): number => b - (burstQ[side][0]?.b ?? b)

  /**
   * The same deque on its own window for the burst latch. It cannot share
   * `burstQ`: that one is only written when `burstShare` is on, and `burstShare`
   * ships disabled — a rule reading a deque nobody fills is the trap this file
   * has already paid for twice. See `burstSwap`.
   */
  const swapQ: Record<Side, { t: number; b: number }[]> = { UP: [], DOWN: [] }
  const pushSwapBurst = (side: Side, t: number, b: number): void => {
    const q = swapQ[side]
    q.push({ t, b })
    const cutoff = t - cfg.burstSwapMs
    while (q.length > 1 && q[1]!.t <= cutoff) q.shift()
  }
  const spentOverSwapWindow = (side: Side, b: number): number => b - (swapQ[side][0]?.b ?? b)

  /**
   * The same deque over the book's own spread, so the pace can ask how wide the
   * spread has been for a while rather than how wide it is right now. Head is
   * the trailing minimum. See `edgeHoldMs`.
   */
  const edgeQ: { t: number; v: number }[] = []
  const pushEdge = (t: number, v: number): void => {
    while (edgeQ.length > 0 && edgeQ[edgeQ.length - 1]!.v >= v) edgeQ.pop()
    edgeQ.push({ t, v })
    const cutoff = t - cfg.edgeHoldMs
    while (edgeQ.length > 1 && edgeQ[0]!.t < cutoff) edgeQ.shift()
  }

  /**
   * Latest Chainlink−Binance basis. The two feeds price the same asset a few
   * dollars apart and the gap drifts; the market resolves on Chainlink, so the
   * continuous Binance tape is only usable once shifted by this.
   */
  let clBasis: number | null = null
  let clBasisAtMs = 0
  /** Smoothed distance from the price to beat — see `ptbTauMs`. */
  let emaDiff: number | null = null
  let emaDiffAtMs = 0
  /** The short BTC average the spike gate measures deviation from. */
  let spikeEma: number | null = null
  let spikeEmaAtMs = 0
  /**
   * Running variance of BTC's own one-second moves — see `volTauMs`. Held as
   * dollars² per second, so `sqrt(volVar * secondsLeft)` is the spread of where
   * BTC can still finish.
   */
  let volVar: number | null = null
  let volAtMs = 0
  let volPrevDiff: number | null = null
  /** The volatility-normalised oracle has named this leg — see `fairHoldZ`. */
  let fairFreed = false
  /** While `nowMs` is under this, the spike gate stays engaged (`spikeHoldMs`). */
  let spikeUntilMs = 0
  /** Smoothed book-versus-model disagreement — see `ptbFairTauMs`. */
  let emaGap: number | null = null
  let emaGapAtMs = 0
  /** Legs the outside price has backed at some point — see `earlyFair`. */
  const earlyFree: Record<Side, boolean> = { UP: false, DOWN: false }
  /** Side the disagreement is currently overriding towards — see `ptbFairMinLag`. */
  let fairLatch: Side | null = null
  /**
   * Side of an override that was LICENSED BY THE LAG, as opposed to one that
   * merely happens to be running — see `fairLagLatch`.
   */
  let fairLagLatch: Side | null = null
  /** Side and start of the lag currently being timed — see `ptbFairLagDwellMs`. */
  let fairLagSide: Side | null = null
  let fairLagSinceMs: number | null = null

  /**
   * BTC's signed distance from the price to beat, in dollars, on whichever
   * outside price `ptbSrc` selects. Positive ⇒ UP is currently winning.
   * Null when the feeds have not produced enough to say.
   */
  const outsideDiff = (ctx: StrategyContext | undefined): number | null => {
    if (cfg.ptbMode === 0) return null
    const feeds = ctx?.plugins?.['externalFeeds'] as ExternalFeedsSnapshot | undefined
    const ptb = feeds?.polymarketPriceToBeat?.openPrice
    if (ptb === undefined || !Number.isFinite(ptb)) return null
    const bin = feeds?.binanceWsSpotPrice
    const cl = feeds?.rtdsPolymarketCryptoPrices?.chainlink
    if (cl && bin && Number.isFinite(cl.value) && Number.isFinite(bin.value) && cl.tsMs > clBasisAtMs) {
      clBasis = cl.value - bin.value
      clBasisAtMs = cl.tsMs
    }
    if (cfg.ptbSrc === 'chainlink') {
      return cl && Number.isFinite(cl.value) ? cl.value - ptb : null
    }
    if (cfg.ptbSrc === 'binance') {
      return bin && Number.isFinite(bin.value) ? bin.value - ptb : null
    }
    if (bin && Number.isFinite(bin.value)) return bin.value + (clBasis ?? 0) - ptb
    return cl && Number.isFinite(cl.value) ? cl.value - ptb : null
  }

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
    if (jumpEma.UP === null || jumpEma.DOWN === null) {
      jumpEma.UP = askUp
      jumpEma.DOWN = askDown
    } else {
      const tau = cfg.jumpTauMs > 0 ? cfg.jumpTauMs : cfg.momentumTauMs
      const kj = 1 - Math.exp(-Math.max(0, nowMs - lastEmaMs) / tau)
      jumpEma.UP += kj * (askUp - jumpEma.UP)
      jumpEma.DOWN += kj * (askDown - jumpEma.DOWN)
    }
    // Near-depth imbalance per leg: of the size resting within `depthLevels` of
    // the top of that leg's own book, how much is on the bid. A leg whose offer
    // has been emptied reads near 1. Smoothed, because a single tick's ladder
    // has a hole in it constantly. See `depthHold`.
    {
      const cum = (a: number[] | undefined): number => {
        if (!a || a.length === 0) return 0
        const v = a[Math.min(cfg.depthLevels, a.length) - 1]
        return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
      }
      const kd =
        cfg.depthTauMs > 0 ? 1 - Math.exp(-Math.max(0, nowMs - lastEmaMs) / cfg.depthTauMs) : 1
      for (const [s, b] of [
        ['UP', upBook],
        ['DOWN', downBook],
      ] as const) {
        const bid = cum(b.bidsDepthByLevel)
        const ask = cum(b.asksDepthByLevel)
        if (bid + ask <= 0) continue
        const raw = bid / (bid + ask)
        const prev = depthImb[s]
        depthImb[s] = prev === null ? raw : prev + kd * (raw - prev)
        const prevAbs = depthAbs[s]
        depthAbs[s] = prevAbs === null ? bid + ask : prevAbs + kd * (bid + ask - prevAbs)
      }
    }
    lastEmaMs = nowMs

    pushLow('UP', nowMs, askUp)
    pushLow('DOWN', nowMs, askDown)

    // How hard the book is leaning, now and over the trailing window. Both are
    // needed before the early returns below, or a tick the player sits out
    // would leave a hole in the trailing minimum.
    const edge = Math.abs(askUp - askDown)
    pushEdge(nowMs, edge)
    // How long this lean has survived. Tracked here, above the early returns,
    // for the same reason the trailing minimum is: a tick the player sits out
    // still happened, and a break in the lean has to count. See `convDwellMs`.
    if (edge >= cfg.convEdge) {
      if (leanSinceMs === null) leanSinceMs = nowMs
    } else {
      leanSinceMs = null
    }
    const leanHeldMs = leanSinceMs === null ? 0 : nowMs - leanSinceMs
    const sustainedEdge =
      cfg.edgeHoldMs > 0 && nowMs - windowStartMs >= cfg.edgeHoldAfterMs
        ? (edgeQ[0]?.v ?? edge)
        : edge

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
    if (cfg.commitRate > 0) {
      pushRate('UP', nowMs, held.UP)
      pushRate('DOWN', nowMs, held.DOWN)
    }
    // Kept out of the `commitRate` guard above: the depth latch reads this
    // deque and `commitRate` is off.
    if (cfg.depthLatchRate === 1) {
      pushDepthRate('UP', nowMs, held.UP)
      pushDepthRate('DOWN', nowMs, held.DOWN)
    }
    if (cfg.burstShare < 1) {
      pushBurst('UP', nowMs, basis.UP)
      pushBurst('DOWN', nowMs, basis.DOWN)
    }
    if (spent > lastSpend + 1e-9 || lastSpend < 0) {
      lastSpend = spent
      lastSpendMs = nowMs
    }
    for (const s of ['UP', 'DOWN'] as Side[]) {
      if (basis[s] > lastSideSpend[s] + 1e-9 || lastSideSpend[s] < 0) {
        lastSideSpend[s] = basis[s]
        lastSideSpendMs[s] = nowMs
      }
    }
    // Its own deque on its own window: `burstQ` above is only filled while
    // `burstShare` is on, and it ships off. See `burstSwap`.
    if (cfg.burstSwap === 1) {
      pushSwapBurst('UP', nowMs, basis.UP)
      pushSwapBurst('DOWN', nowMs, basis.DOWN)
    }

    // The outside read: BTC's distance from the price to beat, and the side it
    // names once that distance is large relative to the time still available
    // for the price to travel back.
    const rawDiff = outsideDiff(ctx)
    if (rawDiff !== null) {
      if (emaDiff === null || cfg.ptbTauMs <= 0) emaDiff = rawDiff
      else {
        const kd = 1 - Math.exp(-Math.max(0, nowMs - emaDiffAtMs) / cfg.ptbTauMs)
        emaDiff += kd * (rawDiff - emaDiff)
      }
      emaDiffAtMs = nowMs
    }
    // How far BTC has run from its own short average — the speed of the move,
    // read before the new price is folded in, or the average would already have
    // followed it. See `spikeEdge`.
    const spikeDev =
      rawDiff === null || spikeEma === null ? 0 : Math.abs(rawDiff - spikeEma)
    if (rawDiff !== null) {
      if (spikeEma === null) spikeEma = rawDiff
      else {
        const ks = 1 - Math.exp(-Math.max(0, nowMs - spikeEmaAtMs) / cfg.spikeTauMs)
        spikeEma += ks * (rawDiff - spikeEma)
      }
      spikeEmaAtMs = nowMs
    }
    if (cfg.spikeEdge > 0 && spikeDev >= cfg.spikeEdge) spikeUntilMs = nowMs + cfg.spikeHoldMs
    const spiking =
      cfg.spikeEdge > 0 &&
      elapsed >= cfg.spikeAfterMs &&
      (spikeDev >= cfg.spikeEdge || nowMs < spikeUntilMs)
    const diff = cfg.ptbTauMs > 0 ? emaDiff : rawDiff
    // BTC's own volatility, measured rather than assumed: the mean square of its
    // one-second moves, smoothed over `volTauMs`. Every other reading of the
    // outside price in this player scales a FIXED number of dollars by the time
    // left; this one scales the dollars BTC is actually moving. See `fairHoldZ`.
    //
    // Two details are load-bearing and were both wrong on the first attempt, in
    // the same direction — they made the reading far too small to ever fire.
    // The series has to be the SMOOTHED distance, the one the numerator uses,
    // and it has to be sampled about once a second. Sampled every tick (~145 a
    // second here) a smoothed series moves by an amount proportional to the step
    // rather than its square root, so the variance RATE collapses toward zero
    // the more often it is measured.
    if (diff !== null && nowMs - volAtMs >= cfg.volSampleMs) {
      const dtMs = Math.max(1, nowMs - volAtMs)
      if (volPrevDiff !== null && volAtMs > 0) {
        const perSec = ((diff - volPrevDiff) * (diff - volPrevDiff)) / (dtMs / 1000)
        if (volVar === null) volVar = perSec
        else {
          const kv = 1 - Math.exp(-dtMs / cfg.volTauMs)
          volVar += kv * (perSec - volVar)
        }
      }
      volPrevDiff = diff
      volAtMs = nowMs
    }
    const leftFrac = Math.min(1, Math.max(0, 1 - elapsed / WINDOW_MS))
    const needDiff = cfg.ptbEdge * Math.sqrt(leftFrac)
    /**
     * The same distance read in standard deviations of where BTC can still
     * finish: `|diff| / sqrt(volVar · secondsLeft)`. Zero while the variance is
     * still unmeasured, which reads as "no confirmation".
     */
    const secondsLeft = Math.max(1, (WINDOW_MS - elapsed) / 1000)
    const outsideZ =
      diff === null || volVar === null || volVar <= 0
        ? 0
        : Math.abs(diff) / Math.sqrt(volVar * secondsLeft)
    const outsideSide: Side | null =
      diff === null || Math.abs(diff) < needDiff ? null : diff > 0 ? 'UP' : 'DOWN'
    /** How settled the outcome is on the outside price: 1 ⇒ decided, 0 ⇒ a coin flip. */
    const outsideFrac = diff === null ? 0 : Math.abs(diff) / Math.max(needDiff, 1e-9)
    // The two probabilities, and the leg the disagreement between them favours.
    const pModel =
      diff === null ? null : normCdf(diff / (cfg.ptbSigma * Math.sqrt(Math.max(leftFrac, 1e-6))))
    const pBook = askUp + askDown > 0 ? askUp / (askUp + askDown) : 0.5
    // How old the book's lean on each leg is: the last moment the book was not
    // already pricing that leg above even. See `depthFreshMs`.
    if (pBook <= 0.5) lastEvenMs.UP = nowMs
    if (pBook >= 0.5) lastEvenMs.DOWN = nowMs
    const rawGap = pModel === null ? null : pModel - pBook
    if (rawGap !== null) {
      if (emaGap === null || cfg.ptbFairTauMs <= 0) emaGap = rawGap
      else {
        const kg = 1 - Math.exp(-Math.max(0, nowMs - emaGapAtMs) / cfg.ptbFairTauMs)
        emaGap += kg * (rawGap - emaGap)
      }
      emaGapAtMs = nowMs
    }
    const fairGap = (cfg.ptbFairTauMs > 0 ? emaGap : rawGap) ?? 0
    const fairWant: Side = fairGap > 0 ? 'UP' : 'DOWN'
    // The model's own view, and whether it points the same way as the gap.
    const modelLean = (pModel ?? 0.5) - 0.5
    const earlyEdge = cfg.earlyFairEdge > 0 ? cfg.earlyFairEdge : cfg.ptbFairEdge
    if (pModel !== null) {
      // Whichever reading is in force, the permission it grants LATCHES: a
      // window where the outside price has once backed a leg is not a window
      // where the player is committing on the book's word alone, and a reading
      // that wobbles back across its threshold does not make it one.
      if (cfg.earlyModelMin > 0) {
        if (Math.abs(modelLean) >= cfg.earlyModelMin) {
          earlyFree[modelLean > 0 ? 'UP' : 'DOWN'] = true
        }
      } else if (Math.abs(fairGap) >= earlyEdge) {
        earlyFree[fairWant] = true
      }
    }
    const modelBacks =
      cfg.ptbFairModelMin <= 0 ||
      (Math.abs(modelLean) >= cfg.ptbFairModelMin && (modelLean > 0) === (fairWant === 'UP'))
    // How far behind the other leg the disagreement's own leg already is — see
    // `ptbFairMinLag`.
    const fairLag = held[fairWant === 'UP' ? 'DOWN' : 'UP'] - held[fairWant]
    // The lag decides which threshold the disagreement is read against, and it
    // decides it once: an override already running keeps the threshold it
    // opened on, because acting on the lag is what closes it.
    //
    // Which override, though. `fairLagLatch` is the difference between "an
    // override the lag licensed keeps its threshold" and "any override that
    // ever opened is henceforth read at the narrow one".
    // A lag the player has been CARRYING, not one it created on this tick. See
    // `ptbFairLagDwellMs`.
    const lagRaw = fairLag >= cfg.ptbFairMinLag * cfg.qty
    if (!lagRaw) {
      fairLagSide = null
      fairLagSinceMs = null
    } else if (fairLagSide !== fairWant) {
      fairLagSide = fairWant
      fairLagSinceMs = nowMs
    }
    const lagServed =
      lagRaw && (fairLagSinceMs === null || nowMs - fairLagSinceMs >= cfg.ptbFairLagDwellMs)
    const lagOk =
      lagServed ||
      (cfg.fairLagLatch === 1 ? fairLagLatch === fairWant : fairLatch === fairWant)
    const fairEdge = cfg.ptbFairLagEdge > 0 && lagOk ? cfg.ptbFairLagEdge : cfg.ptbFairEdge
    const fairOpen =
      Math.abs(fairGap) >= fairEdge &&
      Math.abs(pBook - 0.5) <= cfg.ptbFairBookMax &&
      elapsed >= cfg.ptbFairAfterMs &&
      (cfg.ptbFairUntil >= 1 || elapsed < cfg.ptbFairUntil * WINDOW_MS) &&
      modelBacks
    fairLatch = fairOpen ? fairWant : null
    fairLagLatch = fairOpen && lagOk ? fairWant : null
    const fairSide: Side | null = fairLatch

    const logNow = cfg.debug === 1 && nowMs - lastLogMs >= cfg.debugEveryMs
    if (logNow) lastLogMs = nowMs
    // `debug=2` is the observation channel: one line per `debugEveryMs` for the
    // WHOLE window, emitted here, above every early return, so it keeps running
    // after both legs are complete. The ordinary `debug=1` timeline stops the
    // moment the player is done, which silently truncates any measurement of
    // what the outside price did later in the window.
    if (cfg.debug === 2 && nowMs - lastLogMs >= cfg.debugEveryMs) {
      lastLogMs = nowMs
      // Depth is reported here and nowhere else: no rule reads it yet. Every
      // price-shaped reading of this book has now been measured and none of them
      // separates the windows that must be chased from the one that must not, so
      // the next question is whether the SIZE behind the quote does.
      const cum = (a: number[] | undefined, n: number): number => {
        if (!a || a.length === 0) return 0
        const v = a[Math.min(n, a.length) - 1]
        return typeof v === 'number' && Number.isFinite(v) ? v : 0
      }
      const dep = (b: typeof upBook): string =>
        `${cum(b.bidsDepthByLevel, 3).toFixed(0)}/${cum(b.asksDepthByLevel, 3).toFixed(0)}`
      console.log(
        `[pair.v1] obs slug=${ctx?.market?.slug ?? '?'} t+${Math.round(elapsed / 1000)}s ` +
          `askUp=${askUp.toFixed(3)} askDown=${askDown.toFixed(3)} ` +
          `held=${held.UP.toFixed(0)}/${held.DOWN.toFixed(0)} spent=${spent.toFixed(1)} ` +
          `diff=${diff === null ? '-' : diff.toFixed(1)} need=${needDiff.toFixed(2)} z=${outsideZ.toFixed(2)} ` +
          `pModel=${pModel === null ? '-' : pModel.toFixed(3)} pBook=${pBook.toFixed(3)} ` +
          `depUp=${dep(upBook)} depDown=${dep(downBook)} ` +
          `dimb=${depthImb.UP === null ? '-' : depthImb.UP.toFixed(2)}/` +
          `${depthImb.DOWN === null ? '-' : depthImb.DOWN.toFixed(2)} ` +
          `dabs=${depthAbs.UP === null ? '-' : depthAbs.UP.toFixed(0)}/` +
          `${depthAbs.DOWN === null ? '-' : depthAbs.DOWN.toFixed(0)} ` +
          `dcap=${depthHeld ?? '-'} darm=${depthArmed ?? '-'} ` +
          `bcap=${burstHeld ?? '-'} bspend=${spentOverSwapWindow('UP', basis.UP).toFixed(0)}/` +
          `${spentOverSwapWindow('DOWN', basis.DOWN).toFixed(0)} ` +
          `bidUp=${upBook.bestBid === null ? '-' : upBook.bestBid.toFixed(3)} ` +
          `bidDown=${downBook.bestBid === null ? '-' : downBook.bestBid.toFixed(3)}`,
      )
    }
    const logTick = (lead: Side | null, conv: number, tgt: Partial<Record<Side, number>>): void => {
      if (!logNow) return
      console.log(
        `[pair.v1] t+${Math.round(elapsed / 1000)}s askUp=${askUp.toFixed(3)} askDown=${askDown.toFixed(3)} ` +
          `held=${held.UP.toFixed(0)}/${held.DOWN.toFixed(0)} spent=${spent.toFixed(1)} ` +
          `lead=${lead ?? '-'} conv=${conv.toFixed(2)} ` +
          `tgt=${tgt.UP?.toFixed(2) ?? '-'}/${tgt.DOWN?.toFixed(2) ?? '-'} ` +
          `live=${live.UP?.price ?? '-'}/${live.DOWN?.price ?? '-'} ` +
          `diff=${diff === null ? '-' : diff.toFixed(0)} need=${needDiff.toFixed(0)} out=${outsideSide ?? '-'} ` +
          `z=${outsideZ.toFixed(2)}${fairFreed ? '!' : ''} ` +
          `pModel=${pModel === null ? '-' : pModel.toFixed(2)} pBook=${pBook.toFixed(2)} ` +
          `want=${fairWant} gap=${fairGap.toFixed(3)} lag=${fairLag.toFixed(0)} fair=${fairSide ?? '-'} ` +
          `dimb=${depthImb.UP === null ? '-' : depthImb.UP.toFixed(2)}/` +
          `${depthImb.DOWN === null ? '-' : depthImb.DOWN.toFixed(2)}` +
          `${depthHeld === null ? '' : `!${depthHeld}`} ` +
          `dabs=${depthAbs.UP === null ? '-' : depthAbs.UP.toFixed(0)}/` +
          `${depthAbs.DOWN === null ? '-' : depthAbs.DOWN.toFixed(0)} ` +
          `spk=${spikeDev.toFixed(0)}${spiking ? '!' : ''} ` +
          `edg=${edge.toFixed(2)}/${sustainedEdge.toFixed(2)} ` +
          `chs=${chaseLeg ?? '-'}/${(chaseLeadMs / 1000).toFixed(1)}s`,
      )
    }

    const needUp = Math.max(0, cfg.qty - held.UP)
    const needDown = Math.max(0, cfg.qty - held.DOWN)

    // Latch the leg the player has to chase for the rest of the window: the one
    // that was behind at the moment the other passed `commitShare`. Latched
    // rather than recomputed, because it stops being true the instant the rule
    // works — a chase that reaches parity would switch the exemption off and
    // strand the leg exactly where it was stranded before.
    if (cfg.commitShare > 0 && chaseLeg === null) {
      if (held.UP >= cfg.commitShare * cfg.qty && held.DOWN < held.UP) chaseLeg = 'DOWN'
      else if (held.DOWN >= cfg.commitShare * cfg.qty && held.UP < held.DOWN) chaseLeg = 'UP'
    }

    // Time the chased leg has actually spent as the leg the book says is
    // running away, totalled since the latch. Measured off the PREVIOUS tick's
    // reading, which is the only one already known when this tick has to decide.
    // See `commitLeadMs`.
    if (chaseLeg !== null && prevLeadAtMs > 0 && prevLeadSide === chaseLeg) {
      chaseLeadMs += Math.max(0, nowMs - prevLeadAtMs)
    }
    prevLeadAtMs = nowMs
    // Arming is a one-way door: the dwell has to be served and the imbalance has
    // to still be worth the exemption, both at the same instant. See
    // `commitLeadMs` and `commitLag`.
    if (!commitArmed && chaseLeg !== null && chaseLeadMs >= cfg.commitLeadMs) {
      const chaseLag = held[chaseLeg === 'UP' ? 'DOWN' : 'UP'] - held[chaseLeg]
      if (chaseLag >= cfg.commitLag * cfg.qty) commitArmed = true
    }

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
    // Every cap below is built from `budgetLeft`. `finishCeil` adds a strictly
    // larger second budget that only the crossing test of a nearly-complete leg
    // reads, so exhausting `pairCeil` still stops the player accumulating — it
    // just no longer strands a leg that is one clip from done.
    const finishExtra = cfg.finishCeil > cfg.pairCeil ? cfg.qty * (cfg.finishCeil - cfg.pairCeil) : 0
    if (budgetLeft + finishExtra <= 0) return intents

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
      const finishing =
        cfg.avgGuardFrom > 0 && held[side] + size >= cfg.avgGuardFrom * cfg.qty
      if (cfg.avgGuard === 0 && !finishing) return Infinity
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
    const conv =
      cfg.convEdge >= 1 || elapsed > cfg.convUntil * WINDOW_MS || leanHeldMs < cfg.convDwellMs
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
    // The same ceiling recomputed against `finishCeil`'s larger budget. Only a
    // leg past `finishCeilShare`, and only when it is crossing, ever reads it.
    const capFin: Partial<Record<Side, number>> = {}
    const target: Partial<Record<Side, number>> = {}
    // Share of the target either leg is allowed to hold this early in the
    // window — see `holdRamp`. 1 whenever the ramp is off or has fully opened.
    const holdShare =
      cfg.holdRamp <= 0
        ? 1
        : Math.min(1, cfg.holdRamp0 + (1 - cfg.holdRamp0) * (elapsed / (cfg.holdRamp * WINDOW_MS)))

    // The priority leg, once both legs are contested — the underdog pace below
    // keys off it. Null when only one leg is left, where pacing has no meaning.
    let leadSide: Side | null = null
    // Cleared here rather than inside the branch below: the branch is skipped
    // once a leg is complete, and a cap left standing from the previous tick
    // would refuse the only leg still being bought.
    fairCapSide = null
    fairHandover = null
    depthCapSide = null
    depthHandover = null
    burstCapSide = null
    burstHandover = null
    // The release of `fairHold`, latched and evaluated here for the same reason
    // the two lines above are: the branch below is skipped once a leg completes,
    // and the witness can arrive on any tick.
    if (
      cfg.fairHoldZ > 0 &&
      fairHeld !== null &&
      !fairFreed &&
      diff !== null &&
      outsideZ >= cfg.fairHoldZ &&
      (diff > 0 ? 'UP' : 'DOWN') === fairHeld
    ) {
      fairFreed = true
    }
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
      // In the opening seconds of a book that is still close to even, neither
      // the lean nor the trend reading is information, and both of them name the
      // dearer leg. Lead with the cheaper one instead. See `openCheapMs`.
      if (
        cfg.openCheapMs > 0 &&
        elapsed < cfg.openCheapMs &&
        Math.min(askUp, askDown) >= cfg.openCheapMin
      ) {
        first = askUp <= askDown ? 'UP' : 'DOWN'
      }
      // The outside price overrides both. The momentum reading and the
      // conviction reading are two views of the same order book; when BTC is
      // decisively clear of the price to beat, which leg will end up dear is
      // not a matter of opinion.
      if (cfg.ptbMode === 1 && cfg.ptbPriority === 1 && outsideSide !== null) first = outsideSide
      if (cfg.ptbMode === 1 && cfg.ptbFair === 1 && fairSide !== null) first = fairSide
      // Arithmetic overrides every opinion above. Chasing a leg is only worth
      // doing if the pair it belongs to can still be completed, and that is a
      // sum the player can evaluate from prices it has actually seen: finish
      // the chased leg at TODAY's ask, fund the leg left behind at the
      // cheapest price that leg has ever shown, and compare the total with the
      // ceiling. When the assignment the book prefers overruns and the
      // opposite one overruns less, the chase itself is the mistake.
      const projTotal = (s: Side): number => {
        const o: Side = s === 'UP' ? 'DOWN' : 'UP'
        const askS = s === 'UP' ? askUp : askDown
        const askO = o === 'UP' ? askUp : askDown
        const needS = s === 'UP' ? needUp : needDown
        const needO = o === 'UP' ? needUp : needDown
        const lowO = trailingLow(o)
        const fundO = cfg.solvFrac * Math.min(askO, Number.isFinite(lowO) ? lowO : askO)
        return spent + needS * askS + needO * fundO
      }
      // Changing the priority leg costs whatever has already been sunk into the
      // current one, so the book has to say more the further in the player is.
      // Placed above the solvency swap on purpose: arithmetic still overrides it,
      // so a blocked change cannot strand the player in a pair it cannot finish.
      if (cfg.swapEdge > 0 && committed !== null && first !== committed) {
        const askNew = first === 'UP' ? askUp : askDown
        const askOld = committed === 'UP' ? askUp : askDown
        if (askNew - askOld < (cfg.swapEdge * held[committed]) / cfg.qty) first = committed
      }
      if (cfg.solvSwap === 1 && elapsed >= cfg.solvAfterMs) {
        const o: Side = first === 'UP' ? 'DOWN' : 'UP'
        const projFirstSide = projTotal(first)
        if (
          projFirstSide > cfg.qty * cfg.pairCeil &&
          projTotal(o) < projFirstSide - cfg.solvEdge * cfg.qty
        ) {
          first = o
        }
      }
      // A leg that has run into its ramp allowance cannot be bought, so leading
      // with it leads with nothing: hand the chase to the leg that still has
      // room. See `holdSwap`.
      if (cfg.holdSwap === 1 && holdShare < 1) {
        const o: Side = first === 'UP' ? 'DOWN' : 'UP'
        if (held[first] >= holdShare * cfg.qty && held[o] < holdShare * cfg.qty) first = o
      }
      // The chase has run out of MONEY, not out of evidence: one more share of
      // this leg would leave the other one unbuyable at what it is asking right
      // now. Refusing alone deadlocks the window — the leg that is not the
      // priority answers to `underdogMax`, a loser's price a contested leg is
      // never quoted at — so the chase changes hands instead. See `solvDrop`.
      let solvDemoted: Side | null = null
      if (cfg.solvDrop > 0) {
        const o: Side = first === 'UP' ? 'DOWN' : 'UP'
        const askF = first === 'UP' ? askUp : askDown
        const askO = o === 'UP' ? askUp : askDown
        const needF = first === 'UP' ? needUp : needDown
        const needO = o === 'UP' ? needUp : needDown
        const lowO = trailingLow(o)
        const fundO = cfg.solvFrac * Math.min(askO, Number.isFinite(lowO) ? lowO : askO)
        // What the chased leg would have to cost, per share, for the pair to
        // still fit inside the ceiling once the other leg is funded at the
        // cheapest it has ever shown. The gap between that and its actual ask is
        // the discount the plan is quietly counting on. See `solvDrop`.
        const affordF = needF > 0 ? (budgetLeft - needO * fundO) / needF : Infinity
        if (
          needF > 0 &&
          needO > 0 &&
          held[first] >= cfg.solvSwapShare * cfg.qty &&
          askF - askO >= cfg.solvGap &&
          askF - affordF >= cfg.solvDrop
        ) {
          solvDemoted = first
          first = o
        }
      }
      // The leg that is ahead is being bought on an ask gap the model is running
      // well ahead of — a BTC excursion the book does not believe. Stop it at
      // `fairHold` of its target, and once it is there hand the chase to the
      // OTHER leg: the cap alone is inert, because the money it saves is money
      // `underdogMax` then forbids the other leg from spending. See `fairHold`.
      if (cfg.fairHold < 1 && fairHeld === null && !fairFreed) {
        const o: Side = first === 'UP' ? 'DOWN' : 'UP'
        if (fairWant === first && Math.abs(fairGap) >= cfg.fairHoldGap && held[first] > held[o]) {
          fairCapSide = first
          if (held[first] >= cfg.fairHold * cfg.qty) fairHeld = first
        }
      }
      // Once the cap has actually stopped a leg the plan is settled for the rest
      // of the window, so it is LATCHED — the disagreement that justified it
      // fades as the book comes back to the model, and letting the cap fade with
      // it would resume the very purchase it refused. What the latch commits to
      // is the winning shape: stop one leg, buy the other one OUT, then finish
      // the first in the closing minute at whatever it is worth by then. So the
      // cap lifts the moment the other leg is complete, and not before.
      if (fairHeld !== null && !fairFreed) {
        const o: Side = fairHeld === 'UP' ? 'DOWN' : 'UP'
        if (held[o] < cfg.qty) {
          fairCapSide = fairHeld
          fairHandover = o
          first = o
        }
      }
      // The same shape as `fairHold` above, on the one reading measured to
      // separate this window from the ones that must be chased: the leg that is
      // ahead is being bought into an offer that has been emptied out. Stop it
      // at `depthHold` of its target and hand the chase to the other leg, which
      // is cheap for exactly the same reason. See `depthHold`.
      if (cfg.depthHold < 1 && depthHeld === null && elapsed >= cfg.depthAfterMs) {
        const o: Side = first === 'UP' ? 'DOWN' : 'UP'
        const imb = depthImb[first]
        const evenAt = lastEvenMs[first]
        const fresh =
          cfg.depthFreshMs <= 0 || (evenAt !== null && nowMs - evenAt <= cfg.depthFreshMs)
        // A share of nothing is not a reading. See `depthMinDep`.
        const thick = cfg.depthMinDep <= 0 || (depthAbs[first] ?? 0) >= cfg.depthMinDep
        // Hysteresis: what ARMS the cap is not what releases it. Arming is as
        // strict as it ever was — gate, freshness and size all have to agree.
        // An armed cap survives a few seconds longer on the reading alone, and
        // no longer than `depthReleaseMs`: the strict conditions are a
        // description of the whole episode, not of the instant, and losing the
        // cap for two seconds in the middle of one is what let the burst
        // through. See `depthRelease`.
        const ahead = held[first] > held[o]
        const strict = imb !== null && imb >= cfg.depthGate && fresh && thick && ahead
        const graced =
          depthArmed === first &&
          depthStrictMs !== null &&
          nowMs - depthStrictMs <= cfg.depthReleaseMs &&
          imb !== null &&
          imb >= Math.min(cfg.depthGate, cfg.depthRelease) &&
          ahead
        if (strict) depthStrictMs = nowMs
        if (strict || graced) {
          depthCapSide = first
          depthArmed = first
          // A leg buying faster than the room the cap has left is a leg the
          // threshold test will miss: the fill that would have landed on it
          // lands past it, or the reading goes before the fill comes. Latch on
          // the rate instead of waiting for the coincidence. See
          // `depthLatchRate`.
          const bursting =
            cfg.depthLatchRate === 1 &&
            cfg.depthHold * cfg.qty - held[first] < boughtOverDepthWindow(first, held[first])
          if (held[first] >= cfg.depthHold * cfg.qty || bursting) depthHeld = first
        } else {
          depthArmed = null
          depthStrictMs = null
        }
      }
      // Latched for the same reason `fairHold`'s cap is: the offer refills as
      // soon as the player stops taking it, and letting the cap fade with it
      // would resume the purchase it just refused.
      if (depthHeld !== null) {
        const o: Side = depthHeld === 'UP' ? 'DOWN' : 'UP'
        if (held[o] < cfg.qty) {
          depthCapSide = depthHeld
          depthHandover = o
          first = o
        }
      }
      // The same shape once more, on the money velocity: a leg that has just
      // eaten `burstSwapShare` of the ceiling in `burstSwapMs` is stopped where
      // it stands and the chase changes hands. Nothing about this reading looks
      // at whether the purchase was wise — no observable at the moment of
      // completion separates the market that blocks level 109 from the field —
      // only at how fast the money went. See `burstSwap`.
      if (cfg.burstSwap === 1 && burstHeld === null) {
        const o: Side = first === 'UP' ? 'DOWN' : 'UP'
        if (
          held[first] > held[o] &&
          held[first] >= cfg.burstSwapFrom * cfg.qty &&
          spentOverSwapWindow(first, basis[first]) >=
            cfg.burstSwapShare * cfg.qty * cfg.pairCeil
        ) {
          burstHeld = first
        }
      }
      if (burstHeld !== null) {
        const o: Side = burstHeld === 'UP' ? 'DOWN' : 'UP'
        if (held[o] < cfg.qty) {
          burstCapSide = burstHeld
          burstHandover = o
          first = o
        }
      }
      if (cfg.priorityLatch === 1) {
        if (conv > 0 || latched === null) latched = first
        first = latched
      }
      committed = first
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
      const reservePrice =
        cfg.reserveAsk * askSecond + (1 - cfg.reserveAsk) * Math.min(askSecond, cfg.underdogMax)
      // The floor the other leg's own observed low puts under that reserve. It
      // is deliberately outside the conviction mix: conviction shrinks the
      // reserve because it expects the second leg to be cheap, and this is the
      // evidence that says how cheap it has actually managed to be.
      const lowSecond = trailingLow(second)
      // A leg making new lows will keep making them: its trailing low is stale
      // within seconds, and reserving against it sets aside money for a price
      // that leg will never trade at again. See `reserveMom`.
      const emaSecond = ema[second]
      const secondFalling =
        cfg.reserveMom === 1 && emaSecond !== null && askSecond < emaSecond
      // Once the player is committed to a leg, the money held back for it is
      // held back for shares it has mostly already bought, and it is withheld
      // from the only leg that can still complete the pair. See `commitReserve`.
      const secondCommitted = cfg.commitReserve === 1 && first === chaseLeg && commitArmed
      // The oracle has already called the window in the priority leg's favour,
      // so the leg being reserved against is the one heading for zero and its
      // trailing low overstates what finishing it will cost. See `oracleReserve`.
      const secondDoomed =
        cfg.oracleReserve > 0 &&
        outsideSide === first &&
        outsideFrac >= cfg.oracleReserve
      // The other leg's honest cost: finishing it at the cheapest price it has
      // actually shown. While that still fits in the money left, the reserve has
      // nothing to gain by discounting it. See `reserveFull`.
      const honestSecond = Math.min(askSecond, lowSecond)
      const honestFits =
        cfg.reserveFull > 0 &&
        Number.isFinite(honestSecond) &&
        needSecond * honestSecond <= cfg.reserveFull * budgetLeft
      const reserveFloor =
        cfg.reserveLow <= 0 ||
        elapsed < cfg.reserveLowAfterMs ||
        elapsed >= cfg.reserveLowUntilMs ||
        !Number.isFinite(lowSecond) ||
        secondFalling ||
        secondCommitted ||
        secondDoomed
          ? 0
          : (honestFits ? 1 : cfg.reserveLow) * honestSecond
      const reserve = Math.max(
        cfg.minPrice,
        mix(cfg.leadReserve, cfg.convReserve) * reservePrice,
        reserveFloor,
      )
      // The priority leg may not be chased far above its own cheapest ask so
      // far: this is the player's only non-instantaneous rule, and the only
      // thing that refuses the second and third swing of a whipsaw.
      const chaseCap =
        cfg.chasePad >= 1 ||
        elapsed < cfg.chaseAfterMs ||
        elapsed >= cfg.chaseUntil * WINDOW_MS
          ? Infinity
          : trailingLow(first) + cfg.chasePad
      // What the remaining budget affords, on average, across every share still
      // outstanding on BOTH legs. The priority leg is allowed a multiple of it;
      // see `budgetPace`.
      const paceCap =
        cfg.budgetPace <= 0 || elapsed < cfg.budgetPaceAfterMs
          ? Infinity
          : (cfg.budgetPace * budgetLeft) / (needFirst + needSecond)
      // A cap that FOLLOWS the price instead of being pinned behind it: the
      // priority leg may run away, but only as fast as its own average can.
      const jumpRef = jumpEma[first]
      const jumpCap =
        cfg.jumpPad >= 1 ||
        elapsed < cfg.jumpPadAfterMs ||
        jumpRef === null ||
        (cfg.jumpFinishShare < 1 && held[first] >= cfg.jumpFinishShare * cfg.qty)
          ? Infinity
          : jumpRef + cfg.jumpPad
      // Everything except the jump filter. With `jumpCross` on, this is what the
      // resting bid answers to: the cap refuses to pay up but does not push the
      // leg out of the book, so it still fills on every downtick.
      // Everything the ceiling refuses on grounds other than how much money is
      // left — split out so the finish budget can replace the money term alone.
      const capChaseBase = Math.min(
        cfg.maxPrice,
        capFirst,
        chaseCap,
        paceCap,
        cfg.jumpCross === 1 ? Infinity : jumpCap,
        avgCap(first, sizeFirst),
      )
      const capChase = Math.min(capChaseBase, (budgetLeft - needSecond * reserve) / needFirst)
      const capOfFirst = Math.min(capChase, jumpCap)
      // The priority leg's cap recomputed on the finish budget. Only the money
      // term moves: the price limits above still apply, so this can release
      // budget the plan was holding back but never a price it already refused.
      const capFinFirst = Math.min(
        capChaseBase,
        jumpCap,
        (budgetLeft + finishExtra - needSecond * reserve) / needFirst,
      )
      const bidFirst = floorTick(Math.min(askFirst - TICK, capChase))
      // What the underdog may pay is whatever the ceiling still holds once the
      // priority leg is finished at today's price. A FIXED split cannot do this
      // job: set it wide and the underdog buys at 0.4 in the opening minutes,
      // spending the ceiling on a coin flip; set it narrow and a genuinely
      // mid-priced underdog is starved until the priority leg completes — which
      // is how a window ends 0/1000. This projection is both at once, and it
      // self-corrects: every cent the priority leg runs away costs the underdog
      // a cent of allowance, and every cent it falls back hands one over.
      // Projected at the cap the RESTING bid answers to: with `jumpCross` on
      // that is what the leg will end up paying, since the jump filter only
      // withholds the crossing.
      const projPrice = Math.min(capChase, mix(askFirst + cfg.leadPad, capChase))
      const projFirst = (basis[first] + needFirst * Math.max(0, projPrice)) / cfg.qty
      const underdogRamp =
        cfg.underdogRamp <= 0 ? 1 : Math.min(1, elapsed / (cfg.underdogRamp * WINDOW_MS))
      // What the ceiling and the remaining budget alone would let the second
      // leg pay, before the loser-price cap is applied on top.
      const budgetOfSecond = Math.min(
        cfg.maxPrice,
        cfg.pairCeil - projFirst,
        avgCap(second, sizeSecond),
        (budgetLeft - needFirst * Math.max(0, bidFirst)) / needSecond,
      )
      // The loser-price cap hands its allowance back as the priority leg fills:
      // by then the bet has been made and the reserve exists to be spent.
      const lift = cfg.underdogLift <= 0 ? 0 : (held[first] / cfg.qty) ** cfg.underdogLift
      // A leg the solvency rule has just demoted is not a loser the market has
      // abandoned — it is the leg the player was chasing one tick ago, and
      // holding it to `underdogMax` is what turns the handover into a freeze.
      // See `solvFree`.
      const loserCap =
        (cfg.solvFree === 1 && solvDemoted === second) ||
        (cfg.underdogHeldShare < 1 && held[second] >= cfg.underdogHeldShare * cfg.qty)
          ? budgetOfSecond
          : cfg.underdogMax + lift * Math.max(0, budgetOfSecond - cfg.underdogMax)
      const capOfSecond = Math.min(budgetOfSecond, loserCap) * underdogRamp
      cap[first] = capOfFirst
      cap[second] = capOfSecond
      capFin[first] = capFinFirst
      // The underdog's finish budget: the same projection, with the money term
      // and the ceiling it is projected against both moved to `finishCeil`.
      capFin[second] =
        Math.min(
          cfg.maxPrice,
          cfg.pairCeil + finishExtra / cfg.qty - projFirst,
          avgCap(second, sizeSecond),
          (budgetLeft + finishExtra - needFirst * Math.max(0, bidFirst)) / needSecond,
          loserCap,
        ) * underdogRamp
      target[first] = bidFirst
      target[second] =
        cfg.postSecondLeg === 1
          ? floorTick(Math.min(askSecond - TICK, capOfSecond * (1 - cfg.underdogDiscount)))
          : -1
    } else if (needUp > 0) {
      cap.UP = Math.min(budgetLeft / needUp, avgCap('UP', Math.min(needUp, cfg.clip)))
      capFin.UP = Math.min(
        (budgetLeft + finishExtra) / needUp,
        avgCap('UP', Math.min(needUp, cfg.clip)),
      )
      target.UP = floorTick(cap.UP)
    } else {
      cap.DOWN = Math.min(budgetLeft / needDown, avgCap('DOWN', Math.min(needDown, cfg.clip)))
      capFin.DOWN = Math.min(
        (budgetLeft + finishExtra) / needDown,
        avgCap('DOWN', Math.min(needDown, cfg.clip)),
      )
      target.DOWN = floorTick(cap.DOWN)
    }
    logTick(leadSide, conv, target)
    prevLeadSide = leadSide

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
      // Every accumulation pace below rations a leg by how much the book has
      // revealed, because buying a leg early is a DECISION. Once the player
      // holds most of one leg that decision has been made and paid for, and the
      // leg left behind is no longer a decision: those shares are what makes
      // every share already bought matchable, and the market is worth nothing
      // without them. See `commitShare`.
      // A chase leg that is getting CHEAPER does not need the exemption: a
      // resting bid fills on its own every time the leg ticks down, and the
      // paces cost nothing but patience. It is the leg running away that the
      // paces strand, and a leg running away is one trading clear of its own
      // low, where a falling leg sits on its low by construction. See
      // `commitRise`.
      const chaseLow = trailingLow(side)
      const chaseRising =
        cfg.commitRise <= 0 ||
        !Number.isFinite(chaseLow) ||
        (side === 'UP' ? askUp : askDown) >= chaseLow + cfg.commitRise
      // Chasing the other leg is a bet that the committed one will be finished
      // cheaply later. The evidence for that bet is the committed leg trading
      // BELOW what the player paid for it — the market disagreeing with the
      // commitment. See `commitLoss`.
      // The committed leg has to be down on BOTH readings: its last quote and its
      // own thirty-second average. A single ask wobbles two or three cents
      // around a flat leg, so the quote alone reads noise as a verdict; the
      // average alone is a price that may already have gone. Measured on the
      // three markets this rule exists to tell apart, each reading gets one of
      // them wrong on its own and the pair of them gets all three right.
      const other: Side = side === 'UP' ? 'DOWN' : 'UP'
      const otherAvg = avgOf(other)
      const otherAsk = other === 'UP' ? askUp : askDown
      const otherRef = Math.max(otherAsk, ema[other] ?? otherAsk)
      const chaseWrongNow =
        cfg.commitLoss <= 0 || otherAvg <= 0 || otherRef <= otherAvg - cfg.commitLoss
      // How long the verdict has stood. Updated for the chased leg only, which
      // is the only side `completing` reads, so exactly one of the two passes
      // through the loop touches it. See `commitDwellMs`.
      if (side === chaseLeg) {
        if (!chaseWrongNow) chaseWrongSinceMs = 0
        else if (chaseWrongSinceMs === 0) chaseWrongSinceMs = nowMs
      }
      const chaseWrong =
        chaseWrongNow &&
        (cfg.commitDwellMs <= 0 ||
          side !== chaseLeg ||
          nowMs - chaseWrongSinceMs >= cfg.commitDwellMs)
      const completing =
        cfg.commitShare > 0 && side === chaseLeg && chaseRising && chaseWrong && commitArmed
      // Shares this leg may still acquire: the imbalance throttle, and the
      // accumulation pace that stops a one-way window from being bought
      // entirely at the expensive end of its own trend.
      // Underdog pacing only, and conviction opens even that gate: when the
      // favourite's only affordable moment is the next thirty seconds,
      // rationing anything by the clock is fatal.
      const paceRoom =
        cfg.fillPace <= 0 || leadSide === null || side === leadSide || completing
          ? Infinity
          : cfg.qty * Math.max(conv, Math.min(1, elapsed / (cfg.fillPace * WINDOW_MS))) - held[side]
      // Opening cap: before `openMs` no leg may exceed `openShare` of its
      // target, however confident the tick-zero read looks.
      const openRoom =
        cfg.openShare >= 1 || elapsed >= cfg.openMs || completing
          ? Infinity
          : cfg.openShare * cfg.qty - held[side]
      // Second-stage cap: before the outside price is allowed to overrule the
      // book, no leg may be finished on the book's word alone.
      // Does the outside price argue against buying THIS leg right now? Unknown
      // (the price to beat has not arrived yet) counts as "yes": the whole point
      // of the cap is that the book alone is not enough.
      const fairAgainst =
        pModel === null
          ? true
          : cfg.earlyModelMin > 0
            ? // Confirmation, not the absence of contradiction: the model has to
              // lean toward THIS leg on its own reading before the cap comes off.
              !(Math.abs(modelLean) >= cfg.earlyModelMin && (modelLean > 0) === (side === 'UP'))
            : cfg.earlyFairEdge > 0
              ? !(fairWant === side && Math.abs(fairGap) >= cfg.earlyFairEdge)
              : Math.abs(fairGap) >= cfg.ptbFairEdge && fairWant !== side
      const earlyRoom =
        cfg.earlyShare >= 1 ||
        elapsed >= cfg.earlyMs ||
        completing ||
        held[side === 'UP' ? 'DOWN' : 'UP'] < cfg.earlyBoth * cfg.qty ||
        (cfg.earlyFair === 1 && (!fairAgainst || earlyFree[side]))
          ? Infinity
          : cfg.earlyShare * cfg.qty - held[side]
      // Edge pace: a leg may only hold as much of its target as the book has
      // already revealed. Only meaningful while both legs are still contested.
      // The outside reading is required alongside the book's when `ptbPace` is
      // on: the position may be no larger than the WEAKER of the two pieces of
      // evidence supports.
      // An ask gap on a book with nothing in it is not evidence either. Same
      // floor as `depthMinDep`, applied to the pace instead of the cap.
      const depSeen = depthAbs[side] ?? 0
      const edgeThick =
        cfg.edgeMinDep <= 0
          ? 1
          : cfg.edgeDepRamp === 1
            ? Math.min(1, depSeen / cfg.edgeMinDep)
            : depSeen >= cfg.edgeMinDep
              ? 1
              : 0
      const bookFrac = (edgeThick * sustainedEdge) / cfg.edgeFull
      const evidence =
        cfg.ptbMode === 1 && cfg.ptbPace === 1 ? Math.min(bookFrac, outsideFrac) : bookFrac
      const edgeFrac = Math.min(1, Math.max(cfg.openShare, evidence))
      // Held jointly the allowance has to lapse once the book has revealed
      // everything it is going to: a shared budget of `qty` can never carry two
      // legs of `qty` each, and the pace would deadlock both of them short.
      const edgeHeld = cfg.pairEdge === 1 ? held.UP + held.DOWN : held[side]
      // A leg past `finishShare` of its target is finished, not paced: the
      // shares it still needs are worth more than the evidence rule they break,
      // because their absence makes every share already bought unmatchable.
      // Finishing this leg at today's ask has to leave the other leg fundable
      // at `finishSolv` of its own current ask, or the exemption is buying
      // shares it is simultaneously making unmatchable. See `finishSolv`.
      const sideAsk = side === 'UP' ? askUp : askDown
      const finishSolvent =
        cfg.finishSolv <= 0 ||
        Math.max(0, cfg.qty - held[side]) * sideAsk +
          cfg.finishSolv * Math.max(0, cfg.qty - held[other]) * otherAsk <=
          budgetLeft
      const finishing =
        cfg.finishShare < 1 && held[side] >= cfg.finishShare * cfg.qty && finishSolvent
      // The book's word alone does not buy the last quarter of the priority
      // leg: the ask gap is widest at the top of a spike. See `oracleHold`.
      const oracleBacks =
        cfg.oracleHold >= 1 ||
        side !== leadSide ||
        (holdLatch !== null && holdLatch !== side) ||
        (outsideSide === side && outsideFrac >= cfg.oracleHoldFrac)
      const oracleRoom = oracleBacks ? Infinity : cfg.oracleHold * cfg.qty - held[side]
      if (!oracleBacks && held[side] >= cfg.oracleHold * cfg.qty) holdLatch = side
      // The book has not confirmed what the model believes. `edgeFull` reads the
      // ask gap as evidence, and a gap the model is running well ahead of is a
      // BTC excursion the book does not believe — the book being the better
      // judge over fifteen minutes. Applied only to the leg already AHEAD of its
      // partner, so the trailing leg is never refused and the cap cannot park
      // both legs on the same line. See `fairHold`.
      const fairRoom =
        fairCapSide !== side ? Infinity : cfg.fairHold * cfg.qty - held[side]
      // The same room cap, driven by the depth reading. See `depthHold`.
      const depthRoom =
        depthCapSide !== side ? Infinity : cfg.depthHold * cfg.qty - held[side]
      // The same room cap again, driven by the money velocity. See `burstSwap`.
      const burstSwapRoom =
        burstCapSide !== side ? Infinity : cfg.burstSwapHold * cfg.qty - held[side]
      // How long this leg has held more than the pace currently allows. Updated
      // for BOTH sides, once each per tick, since each pass touches only its own
      // side. See `stallFinish`.
      if (held[side] <= cfg.qty * edgeFrac + 1e-9) overSinceMs[side] = 0
      else if (overSinceMs[side] === 0) overSinceMs[side] = nowMs
      peakAllow[side] = Math.max(peakAllow[side], cfg.qty * edgeFrac)
      const stalled =
        cfg.stallFinish === 1 &&
        elapsed >= cfg.stallFinishAfterMs &&
        sideAsk - otherAsk >= cfg.stallFinishAskLead &&
        held[side] >= cfg.stallFinishShare * cfg.qty &&
        overSinceMs[side] > 0 &&
        nowMs - overSinceMs[side] >= cfg.stallFinishMs &&
        (cfg.stallFinishIdle === 0 || nowMs - lastSpendMs >= cfg.stallFinishMs) &&
        (cfg.stallFinishIdleSide === 0 ||
          nowMs - lastSideSpendMs[side] >= cfg.stallFinishMs)
      if (stalled && !stallLogged[side] && cfg.debug >= 2) {
        stallLogged[side] = true
        console.log(
          `[pair.v1] stall slug=${ctx?.market?.slug ?? '?'} side=${side} ` +
            `t+${Math.round(elapsed / 1000)}s ask=${sideAsk.toFixed(3)} other=${otherAsk.toFixed(3)} ` +
            `held=${held[side].toFixed(0)}/${held[other].toFixed(0)} ` +
            `budgetLeft=${budgetLeft.toFixed(1)} ` +
            `finish=${(Math.max(0, cfg.qty - held[side]) * sideAsk).toFixed(1)} ` +
            `sweep=${(Math.max(0, cfg.qty - held[other]) * otherAsk).toFixed(1)} ` +
            `out=${outsideSide ?? '-'} z=${outsideZ.toFixed(2)} ` +
            `pModel=${pModel === null ? '-' : pModel.toFixed(3)} pBook=${pBook.toFixed(3)} ` +
            `dimb=${depthImb[side] === null ? '-' : (depthImb[side] as number).toFixed(2)} ` +
            `allow=${(cfg.qty * edgeFrac).toFixed(0)} peak=${peakAllow[side].toFixed(0)} ` +
            `idleSide=${((nowMs - lastSideSpendMs[side]) / 1000).toFixed(0)}s ` +
            `idleAll=${((nowMs - lastSpendMs) / 1000).toFixed(0)}s ` +
            `lead=${leadSide ?? '-'} chase=${chaseLeg ?? '-'}`,
        )
      }
      const edgeRoom =
        cfg.edgeFull <= 0 ||
        leadSide === null ||
        finishing ||
        completing ||
        stalled ||
        side === fairHandover ||
        side === depthHandover ||
        side === burstHandover ||
        (cfg.pairEdge === 1 && edgeFrac >= 1)
          ? Infinity
          : cfg.qty * edgeFrac - edgeHeld
      // Clock pace: this early in the window, neither leg may own more than
      // `holdShare` of its target. Only while both legs are still contested —
      // a leg left alone by a finished partner has no decision left to protect
      // and its shares simply have to be bought.
      const rampRoom =
        cfg.holdRamp <= 0 || leadSide === null || completing
          ? Infinity
          : cfg.qty * holdShare - held[side]
      // Spike gate: while BTC is in a violent excursion the player buys nothing
      // and rests nothing, on either side. Zero room also pulls the live order,
      // which is the point — a bid left in the book is run through by the very
      // move being refused.
      const spikeRoom = spiking ? 0 : Infinity
      // Rate cap on the chase: with the paces lifted, the only thing left
      // holding the chased leg back is how fast the ceiling may be spent on it.
      // See `commitRate`.
      const rateRoom =
        cfg.commitRate <= 0 || !completing
          ? Infinity
          : (cfg.commitRate * cfg.commitRateMs) / 1000 - boughtRecently(side, held[side])
      // Spend pace: shares this leg could buy at today's ask without taking the
      // running total past what the clock has released. See `spendPace`.
      const spendRoom =
        cfg.spendPace >= 1
          ? Infinity
          : (Math.max(
              0,
              cfg.qty *
                cfg.pairCeil *
                Math.min(
                  1,
                  cfg.spendPace +
                    (1 - cfg.spendPace) * (elapsed / (cfg.spendPaceUntil * WINDOW_MS)),
                ) -
                spent,
            ) /
              Math.max(ask, cfg.minPrice))
      // Burst cap: money, per leg, per rolling `burstMs`. Not a share cap and not
      // a budget cap — a VELOCITY cap, and the only one of the three that never
      // refuses a leg permanently. See `burstShare`.
      const burstRoom =
        cfg.burstShare >= 1
          ? Infinity
          : Math.max(
              0,
              cfg.burstShare * cfg.qty * cfg.pairCeil - spentRecently(side, basis[side]),
            ) / Math.max(ask, cfg.minPrice)
      // Sub-share room is dust: posting it would churn the book for nothing.
      const roomRaw = Math.min(
        Math.max(0, cfg.maxImbalance - lead),
        Math.max(0, paceRoom),
        Math.max(0, openRoom),
        Math.max(0, earlyRoom),
        Math.max(0, edgeRoom),
        Math.max(0, oracleRoom),
        Math.max(0, fairRoom),
        Math.max(0, depthRoom),
        Math.max(0, burstSwapRoom),
        Math.max(0, rampRoom),
        Math.max(0, spikeRoom),
        Math.max(0, spendRoom),
        Math.max(0, rateRoom),
        burstRoom,
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
      // A leg past `finishCeilShare` judges the take against the finish budget
      // instead of the pair budget. Crossing only — the resting bid below still
      // answers to `cap`, so the exemption can never raise a passive quote or
      // buy a share the player was not already one clip from needing.
      const capNoAsk =
        (cfg.finishCeilShare < 1 && held[side] >= cfg.finishCeilShare * cfg.qty) ||
        (cfg.closeFinish === 1 && held[other] >= cfg.qty)
          ? (capFin[side] ?? cap[side])
          : cap[side]
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
  // The feed request is registered only when the signal is actually used, so a
  // run with `ptbMode=0` keeps zero dependency on the price-to-beat, Binance
  // and Chainlink datasets (any of which can hard-error a replay when a market
  // falls in a coverage hole).
  const plugins: Plugin[] =
    cfg.ptbMode === 0
      ? []
      : [
          new ExternalFeedsRequestPlugin({
            binanceWsSpotPrice: {},
            rtdsCryptoPrices: {},
            polymarketPriceToBeat: { enabled: true },
          }),
        ]
  return { strategy, plugins }
}
