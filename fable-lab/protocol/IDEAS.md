# IDEAS — mechanism-first idea ledger

Rules (DECISIONS D5): every entry names its mechanism class, its who-loses
story, a falsifiable prediction about recorded data, and the cheapest
experiment that could kill it. Duplicates are judged by mechanism +
prediction, not by indicator or parameterization. Statuses: `open`,
`registered (EXP-NNN)`, `parked`, `dead (EXP-NNN)`.

## Mechanism classes

A closed starter set; extending it requires a DECISIONS.md entry saying why
the new class is not a re-skin of an existing one.

| class | one-line definition |
|---|---|
| `stale-quote` | resting orders lag a fast repricing; the book briefly quotes yesterday's probability |
| `tail-overpricing` | near-certain outcomes trade below $1 (or hopeless above $0) by more than remaining risk justifies |
| `spread-capture` | quoting both sides earns the spread when true probability moves slower than the spread width |
| `sum-mispricing` | UP+DOWN books jointly price to ≠ $1 beyond fees; split/merge or dual-sided taking captures the gap |
| `flow-momentum` | one-sided book pressure (depth deltas) predicts short-horizon drift of the implied probability |
| `time-structure` | systematic mispricing tied to the episode clock (open auction chaos, expiry pin, dead zones) |

## Priority queue

Score = mechanism novelty (no prior EXP in class) × plausibility × 1/cost.
Ordered; top entries get registered first.

| # | idea | class | status |
|---|---|---|---|
| 1 | expiry certainty discount | `tail-overpricing` | dead (EXP-001) |
| 2 | UP+DOWN dutch-book scan | `sum-mispricing` | dead (EXP-002) |
| 3 | post-jump stale ladder | `stale-quote` | dead (EXP-003) |
| 4 | quiet-regime two-sided quoting | `spread-capture` | dead (EXP-006, model-conditional per D14) |
| 5 | depth-imbalance drift | `flow-momentum` | dead (EXP-004) |
| 6 | first-minute overreaction | `time-structure` | dead (EXP-005) |
| 7 | expiry-tail maker capture | `spread-capture` | dead (EXP-001 killed at main; per its own park clause it dies unexamined) |
| 8 | loud-regime countertrend liquidity provision | `spread-capture` | dead (EXP-007, model-conditional per D14) |

## Entries

### 1. Expiry certainty discount — `tail-overpricing` — dead (EXP-001)
- **Who loses:** holders of the winning side who sell out at 0.95-0.99 in
  the final minutes to avoid redeem friction (gas, capital lockup, workflow),
  and late hedgers who must cross the spread. Their urgency is structural.
- **Prediction:** in the last T minutes, buying the side whose book mid is
  ≥ 0.9 and holding to resolution has positive gross EV before fees, and the
  win rate at price p exceeds p by a margin that widens as expiry approaches.
- **Cheapest kill:** probe with a taker strategy that buys the ≥0.9 side at
  various time cutoffs; if realized win rate ≤ price at all cutoffs, dead.
- **Risk:** taker fee `156bps × min(p,1−p)` is small at extreme p — this is
  the mechanism the fee shape punishes least. Adverse selection (book knows
  a reversal) is the true test. Simulator exposure: taker-only ⇒ pessimistic
  side of sim bias — a clean property.

### 2. UP+DOWN dutch-book scan — `sum-mispricing` — dead (EXP-002)
- **Who loses:** whichever side of the pair is quoted lazily; makers who
  don't rebalance the complement when one book moves.
- **Prediction:** moments exist where bestAsk(UP)+bestAsk(DOWN) < 1 − fees
  (buy both, guaranteed $1) or bestBid(UP)+bestBid(DOWN) > 1 + fees (split
  $1, sell both). Frequency and depth of these moments is measurable from
  ticks alone.
- **Cheapest kill:** probe strategy that takes only when the inequality
  clears measured fees at top-of-book depth. If it never (or almost never)
  fires across 500 markets, the market is internally consistent — dead, and
  that itself is a lesson worth having.
- **Simulator exposure:** taker-only, size capped by quoted depth ⇒
  pessimistic side. Watch cascade cap (100 events/drain) with batch orders.

### 3. Post-jump stale ladder — `stale-quote` — dead (EXP-003)
- **Who loses:** makers whose deep resting levels don't reprice within the
  first seconds after a large implied-probability jump.
- **Prediction:** after a mid jump of ≥ X in ≤ Y seconds, levels beyond the
  touch on the lagging side get consumed at prices that are stale relative
  to the new mid; taking them and exiting (or holding) is +EV.
- **Cheapest kill:** probe taker strategy triggered by jump detection; if
  post-jump ladders are already gone (books thin instantly), dead.
- **Simulator exposure:** taker-only against recorded liquidity, but the
  no-market-impact assumption matters if size > level size; cap size at
  quoted level size in the strategy itself.

### 4. Quiet-regime two-sided quoting — `spread-capture` — dead (EXP-006 probe kill, 2026-07-10; model-conditional per D14: closes the punch-through-backtestable version only — live at-touch provision was never measurable in this design)
- **Who loses:** impatient takers crossing a wide spread in low-volatility
  mid-episode stretches.
- **Prediction:** in windows where realized mid volatility is low
  (`timeWindowVolatility` plugin), quoting inside a wide spread on both UP
  books earns more in captured spread than it loses to adverse fills.
- **Cheapest kill:** probe; the worst-queue maker model is the pessimistic
  fill assumption, so a positive result is meaningful — but full-size-fill
  is the optimistic one, so size must stay small; classification will be
  `simulator-favored` unless taker-exit dominates. Expect this to need live
  paper regardless — register only when class 1-3 are exhausted.

### 5. Depth-imbalance drift — `flow-momentum` — dead (EXP-004)
- **Who loses:** quoters who ignore one-sided pressure buildup; the book
  tips before the price moves.
- **Prediction:** cumulative depth imbalance (bid vs ask, top 10 levels,
  both books) predicts the sign of the next N-second mid move better than
  chance, by enough to clear taker fees at the achieved entry prices.
- **Cheapest kill:** this one is killable OFFLINE: the prediction is a pure
  data question. But per protocol, offline feature studies are diagnostics —
  the decisive test is still a strategy run. Probe = simple threshold-entry
  taker.

### 6. First-minute overreaction — `time-structure` — dead (EXP-005)
- **Who loses:** traders who anchor the opening quotes before the book has
  found the window's true baseline; recording starts at the first book
  snapshot, so "open" here = first recorded state (CAPABILITIES §2 late-start
  caveat — the diagnostic must measure how late recording actually starts).
- **Prediction:** fading large deviations of implied probability from 0.5 in
  the first minute reverts more often than it continues, net of fees.
- **Cheapest kill:** probe with a fade-entry, fixed-exit taker.

### 7. Expiry-tail maker capture — `spread-capture` — dead (EXP-001 killed at main; per its own park clause)
- **Motivating evidence:** E12's synthesis — the only measured inefficiency
  is the expiry-tail certainty discount (EXP-001 probe: win rate 0.9697 vs
  mean ask 0.9343). EXP-001 pays the spread to reach the friction sellers;
  a maker posted at the bid collects the discount PLUS the spread, and
  serves the same structural counterparty (redeem-friction sellers who
  cross the spread to exit).
- **Who loses:** the same near-certain-side holders as EXP-001, selling out
  in the final minutes to avoid redeem friction; they hit resting bids.
- **Prediction:** a GTC bid posted at/inside the best bid on the ≥0.9 side
  in the final minutes fills in a substantial fraction of markets, and
  filled markets win more often than the fill price implies — by MORE than
  EXP-001's taker margin (the spread is added to the discount).
- **Cheapest kill:** probe with a passive-bid strategy; the worst-queue
  maker model (fills only when the book trades THROUGH the level) is the
  pessimistic fill assumption, so a positive result is meaningful, but
  full-size-fill optimism means size must stay small. Classification will
  be `simulator-favored` on the fill-rate axis regardless — needs live
  paper before belief. Hence parked until EXP-001 (same counterparty,
  taker version) confirms on holdout; if EXP-001 dies at main/holdout,
  this dies with it unexamined.

### 8. Loud-regime countertrend liquidity provision — `spread-capture` — dead (EXP-007, model-conditional per D14)
- **Motivating evidence:** E16's transfer point (a): under worst-queue,
  every fill is the most informed counterparty, so the only maker shape the
  simulator can test HONESTLY is one where being filled by a continuing
  move is the claim itself — quote INTO loud moves and get paid for
  catching overshoot. D14 (maker direction) plus the death of the quiet
  variant (EXP-006) make this the designated next candidate.
- **Who loses:** momentum takers and stop-outs selling into a fast move —
  they pay for immediacy at cascade prices; whoever rests a bid below the
  falling book is their counterparty.
- **Prediction:** conditional on a trailing-window signed UP-mid move of
  ≥ jumpSize, a GTC bid on the FALLING side at fair − δ that gets punched
  through wins more often than its fill price implies (overshoot reverts by
  settlement). Zero maker fee → gross = net.
- **D5 dedupe:** NOT a duplicate of EXP-003 (taker, bought the JUMP
  direction at the post-jump ask — fairly priced there) nor EXP-005
  (taker fade at the ask, first minute only — lost ~1.2c gross to the
  ask); the prediction target here is win rate vs a PASSIVE punch-through
  fill price, which sits (halfSpread + δ + fee saving) below those measured
  entries. Distinct from EXP-006: loud gate, one-sided, countertrend.
- **Honest prior:** low-moderate. E10/E12 measured continuation-not-
  reversion AT THE ASK (deficits ~0 and ~1.2c); this wins only if the
  passive discount exceeds the conditional continuation beyond the fill.
  E16 showed through-moves are informative in QUIET; loud overshoot is the
  remaining untested branch.
- **Cheapest kill:** probe; per E15, budget fills from single-tick gap
  statistics (fill-feasibility diagnostic under EXP-000-debug, fill counts
  only) BEFORE freezing the cell. `simulator-favored` on the size axis by
  construction (D14 escalation applies).

### 9. At-touch maker bracket (touch_or_better re-run of the frozen EXP-006/007 cells) — `spread-capture` — dead (EXP-008 + EXP-009 probe kills, 2026-07-10: both cells lose MORE under the optimistic bound than under worst_queue — quiet [−0.18, −0.433], loud [−0.45, −0.848]; both brackets closed negative at both ends, no operator escalation warranted; per audit 4.1 the kill is decisive under the engine's most favorable fill assumption, not formally conclusive over intermediate models — economically moot since both ends are negative)
- **Motivating evidence:** EDGE-SPACE §2 names the one channel the E9-E17
  map cannot see: at-touch liquidity provision (fills by flow that does
  NOT move the level). U35/D18 unlocked the engine's own `touch_or_better`
  fill model in-lab (`--fill-mode`), giving the OPTIMISTIC bound on that
  channel. EDGE-SPACE §4 (as amended in U35) explicitly opens this
  registration class.
- **Who loses:** same counterparties as EXP-006/EXP-007 (impatient takers
  crossing in quiet windows; momentum takers/stop-outs in loud moves) —
  but measured under the assumption most favorable to the maker: always
  first in queue, filled full-size the instant the touch reaches the level,
  zero maker fee.
- **Prediction:** under the optimistic bound, played markets have gross
  EV/market > 0 in at least one of the two frozen regime cells (quiet
  two-sided EXP-006 cell; loud countertrend EXP-007 cell).
- **Cheapest kill:** probes on the EXACT frozen primary cells of the killed
  parents (zero new tuning freedom). Binary by construction (D18): both
  ≤ 0 ⇒ at-touch maker economics dead in-model CONCLUSIVELY (the bound
  dominates every intermediate queue model — if the best case loses, all
  cases lose) and no live measurement is worth funding; any cell > 0 ⇒
  operator-escalation memo with the measured bracket [worst_queue EV,
  touch EV] (§3.2/§3.3). NEVER an advance: touch results cannot reach
  holdout or live-EV claims (D18 binding rules).
- **D5 dedupe:** not a re-skin of EXP-006/007 — identical strategies and
  cells, DIFFERENT measurement instrument (fill model), which is the axis
  EDGE-SPACE §4 opened. The parents' kills are worst-queue-conditional
  (D14); this measures the other end of the bracket those kills left open.

### 10. Up-then-dn reversal mirror (buy DOWN after a big up-segment reverses into a big down-segment, late window) — `time-structure` — PARKED (underpowered on all available fresh data; unlock condition below)
- **Motivating evidence:** E22 / CAL-003 (2026-07-10). The NEG-FLAG UP
  (450-600-750, up-dn) cleared the Bonferroni bar (z = −3.47, n = 981):
  the reversal shape leaves the UP ask ≈ 4.4c stale gross — the strongest
  gross staleness in the conditional scans. Its tradable mirror (buy DOWN,
  same book samples) showed net +2.38c at z = +2.40 — the largest net in
  the table but BELOW the corrected bar, therefore NOT citable
  (hypothesis-generating only, reserve correctly unspent).
- **Why parked (power arithmetic; AMENDED U45 after a fresh-context
  audit, `knowledge/AUDIT-2026-07-10-IDEAS-10-POWER.md` — the original
  U44c figures mixed two variance conventions; all figures below use the
  scan's own se convention (Σaᵢ(1−aᵢ)/n², per-sample variance ≈ 0.154 at
  this cell — the se the actual test statistic uses), and the reserve
  yield now includes CAL-001's 95.5% emitting fraction):** cell
  incidence ≈ 12.1% of sampled markets (983/8,133, coverage included);
  sampled fraction of eligible ≈ 0.955. The full 5,460-market reserve
  yields n ≈ 630 cell entries, se ≈ 1.56c → a pre-registered one-cell
  test at α = 0.023 has ~32% power at the observed +2.38c (~45% at
  α = 0.05) — and the observed effect is the MAX of 40 cells, so
  winner's curse biases it upward; true power is lower. 80% power needs
  ≈ 2,180 entries ≈ 19,000 markets — ~3.5× the reserve. No instrument
  fixes this: one market contributes at most one independent outcome to
  the cell, so denser sampling adds correlation, not power. A
  ~100-minute reserve replay would buy a coin-flip-at-best test and burn
  the reserve's pristine status for future CAL candidates. _(Original
  U44c figures for the record: n ≈ 660, se ≈ 1.9c, ~23%/35% power,
  ≈ 28,000 markets — Bernoulli-at-meanAsk variance, no emitting factor;
  conservative on power, overstated on the 80%-power requirement. The
  PARK is licensed under both conventions.)_
- **Unlock condition (mechanical; convention confirmed by the U45
  audit):** eligible universe grown by enough post-2026-06-14 markets
  that (new-window markets + reserve) ≥ ~15,000 in a pre-registrable
  fresh window (≥ ~50% power at α = 0.023 if the true net is ≥ +2c:
  n ≈ 1,730 entries → se ≈ 0.94c → power ≈ 55% under the scan-se
  convention — this threshold holds ONLY under that convention, which is
  the one the pre-registered test must therefore use), AND the
  venue-drift bands have not fired (else re-derive from the new regime).
  Then: full pre-registration (frozen cell, prediction net > 0, kill
  bar, N), per EDGE-SPACE §4's "reserve-window evidence under full
  pre-registration" clause.
- **Who pays (if real):** whoever leaves the DOWN ask stale after the
  reversal — the same stale-quoter E21/E22 measured on the UP side; the
  open question is only whether the staleness exceeds spread + fee on
  the tradable side, which the discovery data cannot resolve at this n.
- **D5 dedupe:** not a re-skin — CAL-003 measured this exact cell but
  below decision power on the tradable side; EXP-003/005 tested different
  taker triggers (post-jump, first-minute). Any registration MUST cite
  this entry and the unlock condition, not the discovery table alone.
- **Confirmation test FROZEN pre-data (U67/D41, 2026-07-11):**
  `knowledge/CONFIRMATION-010-REVERSAL-MIRROR.md` — full pre-registration
  written while the fresh window's data could not be obtained (U66 vendor
  quota blocker). At unlock, execute THAT spec; do not redesign the test.

## Batch screening ideas (SCREENING tier, D49 — ledger entries for dedupe)

- **#11 SCR-001a first-passage continuation** (BATCH-001): event-time
  barrier crossing, buy crossing side. Escapes E20-E23 (event-time, not
  fixed-time/segment). → screened in BATCH-001.
- **#12 SCR-001b first-passage fade** (BATCH-001): buy the longshot on
  barrier crossing (overshoot bet). Distinct from E12 (window) and E14
  (direction). → screened in BATCH-001.
- **#13 SCR-002 depth-withdrawal momentum** (BATCH-001): 5-level depth
  collapse before the mid moves. Depth CHANGE, not E11's level. →
  screened in BATCH-001.
- **#14 SCR-003 quote-pressure** (BATCH-001): signed top-of-book revision
  flow. Rate, not stock (E11); direction-aware, unlike SIGNAL-001 rate60.
  → screened in BATCH-001.
- **#15 SCR-004t at-touch tail maker** (BATCH-001): join favorite bid at
  touch late. E14's cell from the maker side; outside E19's two cells.
  D18: kill/escalate only. → screened in BATCH-001.
- **#16 SCR-004r at-touch reversal DOWN bid** (BATCH-001): the E22
  staleness monetized at touch (fee+spread removed from cost side). Aimed
  at the map's one measured positive. Does not touch reserve/CONFIRM-010.
  → screened in BATCH-001.
- **#17 SCR-004o at-touch opening spread** (BATCH-001): time-gated
  two-sided quoting in the first 90s (pre-information flow). Distinct
  from E19's regime-gated whole-window cells. → screened in BATCH-001.
- **DEAD FAMILY at derivation (no run needed): cross-book freshness /
  consistency signals** — recorded DOWN books are exact UP mirrors
  (CAL-001 amendment #12); the whole feature class carries zero
  information beyond the UP book. Generalizes E9 structurally.
- **#18 SCR-005 deep resting bid / overshoot catcher** (BATCH-002):
  maker bids ~10c below fair, both sides — the 5-15c distance regime
  E16/E17/E19 never measured (their cells sat 1-3c from fair). Dead
  classes distinguished: taker-after-move is E10/E21/E22; near-fair
  maker is EXP-006/007. → killed in BATCH-002 (run 462: q̂=−0.0218,
  winRate 0.36 on 22 played; E26a).
- **#19 SCR-006 late favorite after wide range** (BATCH-002): taker FOK
  on the ≥850s favorite (ask 0.65-0.98) when running UP-mid range ≥
  0.30. Aim disclosed: SIGNAL-001 warm mirror (DOWN o850 HI range q4,
  +4.51c sub-bar) — in-sample overlap with the scan disclosed in the
  mini-spec; E14 distinguisher: range-conditioned, HI stratum not 0.95+
  tail. → killed in BATCH-002 (run 464: t=+0.74 sub-bar default kill;
  warm cell diluted 8×; E26c).
- **#20 SCR-007 filled-maker instant lock** (BATCH-002): rest bids
  below fair; on maker fill, immediately FOK the other side — pair
  settles at $1; bet is on transient post-sweep dislocation
  (p + a < 1 − fee), not direction. E9/EXP-002 distinguisher: EXP-002
  measured STANDING ask sums with no position; this measures
  fill-CONDITIONAL sums the standing scan never sampled. → killed in
  BATCH-002 (run 465: t=−3.17, EV −6.80/market; E26b).
- **#21 SCR-008 ungated DOWN-side at-touch bid** (BATCH-003): the
  mirror-consistent expression of "sell the persistent UP-ask premium"
  (G2 asymmetry, −1.16c z=−5.2, the venue's strongest measured
  regularity). Escape vs E19/E24: no informed-flow timing gate — tests
  unconditional skew vs unconditional touch adverse selection. Touch
  mode, local, D18 kill/escalate only. → killed in BATCH-003 (run 472:
  q̂=+0.0033, t=+0.07 at N=500, kill by default outcome — the FIRST
  non-losing touch cell: the G2 premium cancels touch adverse selection
  to break-even at the optimistic bound, no rent left; E29).
- **DEAD FAMILY at derivation: split-funded sell-side maker (any
  gate)** — mirror identity (CAL-001 am. #12) makes UP ask at a ≡ DOWN
  bid at 1−a; the entire sell side collapses onto the measured buy-side
  maker family (E16/E17/E19/E24/E26a). See BATCH-003 derivation kills.
- **DEAD at design: round-number/tick-granularity anchoring** — no
  carrier: ask mass at mod-5c levels is 19.1% vs 20% uniform (measured
  outcome-free on the CAL-001 log, 100,119 asks); scan floor ~3.7c.
  See BATCH-003 derivation kills.
- **BLOCKED (not expressible): cross-episode conditioning strategies**
  — previous-window outcome is not observable from the current
  market's ticks in backtest (episode isolation); taker side already
  measured NULL by SIGNAL-002. Needs operator-side engine work + a
  live-parity argument. See BATCH-003 derivation kills.
- **#22 (CANDIDATE, needs SIGNAL-003 instrument first): state-gated
  DOWN-side touch bid — the complement of toxic fills.** Logic from
  E29's zero: run 472's UNGATED fills average exactly zero PnL, so if
  any tick-observable state at fill time predicts fill toxicity, the
  COMPLEMENT of that state is positive-EV by arithmetic (the average
  must balance). This is the only maker direction that satisfies the
  E29-raised EDGE-SPACE §4 bar (a fill population BETTER than
  unconditional), and it is falsifiable: if toxicity is unpredictable
  from tick state, the per-fill scan is null and the family closes for
  good. Dedupe vs E19/E24 gates: those gates were chosen a priori
  (time/regime stories) and all WORSENED the mix; this one would be
  MEASURED from per-fill state first. Prerequisite instrument
  (SIGNAL-003): a diag fixture that simulates the ungated SCR-008 cell
  and logs book/path state AT each simulated fill plus the fill's
  settlement PnL — an outcome-USING scan (per-fill PnL is the target),
  so it must run discovery-window only, frozen pre-read per the CAL
  discipline, Bonferroni over its cells, and any candidate gate then
  goes through a fresh D49 screen on a NEW sample (the U91/E26c
  winner's-curse discount applies). Run-472 DB grain already shown
  empty (BATCH-003 post-kill decomposition) — the instrument must log
  at fill time, not market aggregates. Park until SIGNAL-003 is built
  and frozen; do not register a gate picked by story.
