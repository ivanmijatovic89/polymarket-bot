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
   */
  reserveLow: z.coerce.number().finite().min(0).max(1).default(0.6),
  /** Milliseconds into the window before `reserveLow` engages. */
  reserveLowAfterMs: z.coerce.number().finite().min(0).default(20_000),
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
   * Latest Chainlink−Binance basis. The two feeds price the same asset a few
   * dollars apart and the gap drifts; the market resolves on Chainlink, so the
   * continuous Binance tape is only usable once shifted by this.
   */
  let clBasis: number | null = null
  let clBasisAtMs = 0
  /** Smoothed distance from the price to beat — see `ptbTauMs`. */
  let emaDiff: number | null = null
  let emaDiffAtMs = 0
  /** Smoothed book-versus-model disagreement — see `ptbFairTauMs`. */
  let emaGap: number | null = null
  let emaGapAtMs = 0
  /** Legs the outside price has backed at some point — see `earlyFair`. */
  const earlyFree: Record<Side, boolean> = { UP: false, DOWN: false }
  /** Side the disagreement is currently overriding towards — see `ptbFairMinLag`. */
  let fairLatch: Side | null = null

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
    lastEmaMs = nowMs

    pushLow('UP', nowMs, askUp)
    pushLow('DOWN', nowMs, askDown)

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
    const diff = cfg.ptbTauMs > 0 ? emaDiff : rawDiff
    const leftFrac = Math.min(1, Math.max(0, 1 - elapsed / WINDOW_MS))
    const needDiff = cfg.ptbEdge * Math.sqrt(leftFrac)
    const outsideSide: Side | null =
      diff === null || Math.abs(diff) < needDiff ? null : diff > 0 ? 'UP' : 'DOWN'
    /** How settled the outcome is on the outside price: 1 ⇒ decided, 0 ⇒ a coin flip. */
    const outsideFrac = diff === null ? 0 : Math.abs(diff) / Math.max(needDiff, 1e-9)
    // The two probabilities, and the leg the disagreement between them favours.
    const pModel =
      diff === null ? null : normCdf(diff / (cfg.ptbSigma * Math.sqrt(Math.max(leftFrac, 1e-6))))
    const pBook = askUp + askDown > 0 ? askUp / (askUp + askDown) : 0.5
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
    const fairEdge =
      cfg.ptbFairLagEdge > 0 &&
      (fairLag >= cfg.ptbFairMinLag * cfg.qty || fairLatch === fairWant)
        ? cfg.ptbFairLagEdge
        : cfg.ptbFairEdge
    const fairOpen =
      Math.abs(fairGap) >= fairEdge &&
      Math.abs(pBook - 0.5) <= cfg.ptbFairBookMax &&
      elapsed >= cfg.ptbFairAfterMs &&
      (cfg.ptbFairUntil >= 1 || elapsed < cfg.ptbFairUntil * WINDOW_MS) &&
      modelBacks
    fairLatch = fairOpen ? fairWant : null
    const fairSide: Side | null = fairLatch

    const logNow = cfg.debug === 1 && nowMs - lastLogMs >= cfg.debugEveryMs
    if (logNow) lastLogMs = nowMs
    const logTick = (lead: Side | null, conv: number, tgt: Partial<Record<Side, number>>): void => {
      if (!logNow) return
      console.log(
        `[pair.v1] t+${Math.round(elapsed / 1000)}s askUp=${askUp.toFixed(3)} askDown=${askDown.toFixed(3)} ` +
          `held=${held.UP.toFixed(0)}/${held.DOWN.toFixed(0)} spent=${spent.toFixed(1)} ` +
          `lead=${lead ?? '-'} conv=${conv.toFixed(2)} ` +
          `tgt=${tgt.UP?.toFixed(2) ?? '-'}/${tgt.DOWN?.toFixed(2) ?? '-'} ` +
          `live=${live.UP?.price ?? '-'}/${live.DOWN?.price ?? '-'} ` +
          `diff=${diff === null ? '-' : diff.toFixed(0)} need=${needDiff.toFixed(0)} out=${outsideSide ?? '-'} ` +
          `pModel=${pModel === null ? '-' : pModel.toFixed(2)} pBook=${pBook.toFixed(2)} ` +
          `want=${fairWant} gap=${fairGap.toFixed(3)} lag=${fairLag.toFixed(0)} fair=${fairSide ?? '-'}`,
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
    // Share of the target either leg is allowed to hold this early in the
    // window — see `holdRamp`. 1 whenever the ramp is off or has fully opened.
    const holdShare =
      cfg.holdRamp <= 0
        ? 1
        : Math.min(1, cfg.holdRamp0 + (1 - cfg.holdRamp0) * (elapsed / (cfg.holdRamp * WINDOW_MS)))

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
      const reservePrice =
        cfg.reserveAsk * askSecond + (1 - cfg.reserveAsk) * Math.min(askSecond, cfg.underdogMax)
      // The floor the other leg's own observed low puts under that reserve. It
      // is deliberately outside the conviction mix: conviction shrinks the
      // reserve because it expects the second leg to be cheap, and this is the
      // evidence that says how cheap it has actually managed to be.
      const lowSecond = trailingLow(second)
      const reserveFloor =
        cfg.reserveLow <= 0 || elapsed < cfg.reserveLowAfterMs || !Number.isFinite(lowSecond)
          ? 0
          : cfg.reserveLow * Math.min(askSecond, lowSecond)
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
        cfg.jumpPad >= 1 || elapsed < cfg.jumpPadAfterMs || jumpRef === null
          ? Infinity
          : jumpRef + cfg.jumpPad
      const capOfFirst = Math.min(
        cfg.maxPrice,
        capFirst,
        chaseCap,
        paceCap,
        jumpCap,
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
      const loserCap = cfg.underdogMax + lift * Math.max(0, budgetOfSecond - cfg.underdogMax)
      const capOfSecond = Math.min(budgetOfSecond, loserCap) * underdogRamp
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
        held[side === 'UP' ? 'DOWN' : 'UP'] < cfg.earlyBoth * cfg.qty ||
        (cfg.earlyFair === 1 && (!fairAgainst || earlyFree[side]))
          ? Infinity
          : cfg.earlyShare * cfg.qty - held[side]
      // Edge pace: a leg may only hold as much of its target as the book has
      // already revealed. Only meaningful while both legs are still contested.
      // The outside reading is required alongside the book's when `ptbPace` is
      // on: the position may be no larger than the WEAKER of the two pieces of
      // evidence supports.
      const bookFrac = edge / cfg.edgeFull
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
      const finishing = cfg.finishShare < 1 && held[side] >= cfg.finishShare * cfg.qty
      const edgeRoom =
        cfg.edgeFull <= 0 || leadSide === null || finishing || (cfg.pairEdge === 1 && edgeFrac >= 1)
          ? Infinity
          : cfg.qty * edgeFrac - edgeHeld
      // Clock pace: this early in the window, neither leg may own more than
      // `holdShare` of its target. Only while both legs are still contested —
      // a leg left alone by a finished partner has no decision left to protect
      // and its shares simply have to be bought.
      const rampRoom =
        cfg.holdRamp <= 0 || leadSide === null ? Infinity : cfg.qty * holdShare - held[side]
      // Sub-share room is dust: posting it would churn the book for nothing.
      const roomRaw = Math.min(
        Math.max(0, cfg.maxImbalance - lead),
        Math.max(0, paceRoom),
        Math.max(0, openRoom),
        Math.max(0, earlyRoom),
        Math.max(0, edgeRoom),
        Math.max(0, rampRoom),
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
