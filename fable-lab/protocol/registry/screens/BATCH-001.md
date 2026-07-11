# BATCH-001 — first screening batch under the exploration mandate

_Session 59, 2026-07-11. Tier: protocol/SCREENING.md (D49). Freeze anchor:
the commit that adds this file (batch file + strategy files together;
fleet submissions only after push). Sample rule for all fleet screens:
`--random --limit 500 --to-ms 1772323199999` (discovery window only),
latency pinned DELAY=0/JITTER=0. Touch screens run local `--sequential
--fill-mode touch_or_better`, batchUid containing `touch`, same sample
rule, D18 rules bind (kill/escalate only)._

_Idea-family note recorded at derivation (zero-cost kill): every
"cross-book freshness/consistency" mechanism (trust the fresher book,
one-sided staleness gaps, sum inconsistencies beyond E9) is DEGENERATE —
recorded DOWN books are exact mirrors of UP (CAL-001 amendment #12), so
no cross-book feature carries information the UP book lacks. The family
is dead at derivation, not worth a run. This generalizes E9's empirical
kill of dutch books to the whole feature class._

## Mini-specs (frozen pre-results)

### SCR-001a — first-passage barrier continuation
- mechanism: first arrival of UP-implied probability at a conviction
  barrier under-adjusts; buy the crossing side on the crossing tick.
- not-a-reskin: E20 scans state at fixed offsets, E21/E22 fixed-segment
  moves between offsets; first passage is event-time conditioning the CAL
  log cannot express. E12 (first-minute fade) is the opposite bet in a
  different window.
- aim: unaimed (event-time mechanism; the map samples fixed times).
- strategy: `screens/SCR-001-first-passage.ts` (`fable-scr-001`),
  params `barrier=0.8 mode=continue minElapsedSec=120` (defaults).
- prediction: winRate(bought side) > mean entry ask (gross continuation
  ≥ the 1.5c fee floor would need winRate − ask ≥ ~0.015).
- kill: SCREENING.md default bars.

### SCR-001b — first-passage barrier overshoot fade
- mechanism: first arrival at an extreme overshoots; buy the OTHER side
  (at ~1−B) on the crossing tick.
- not-a-reskin: same escape as SCR-001a; the fade direction additionally
  tests the tail the E14 tail-discount kill never touched (E14 bought the
  favorite, this buys the longshot on an event trigger).
- aim: unaimed.
- strategy: same file, params `barrier=0.8 mode=fade minElapsedSec=120`.
- prediction: winRate(bought side) > mean entry ask.
- kill: default bars. NOTE (E14 transfer): longshot cell — win rate will
  be low and skewed; minority-outcome count (wins) ≥ 30 required for any
  survive call.

### SCR-002 — depth-withdrawal momentum
- mechanism: makers pull 5-level depth ahead of adverse moves before the
  mid adjusts; buy the side the withdrawal points to.
- not-a-reskin: E11 tested the static imbalance LEVEL (its lesson
  "resting depth is not flow" motivates testing the flow); no CAL scan
  and not even SIGNAL-001 measures depth CHANGES.
- aim: unaimed (map has static depth only).
- strategy: `screens/SCR-002-depth-pull.ts` (`fable-scr-002`), defaults
  (`ratio=0.4 lookbackSec=30 maxMidMove=0.02 minRefDepth=200`).
- prediction: winRate(bought side) > mean entry ask.
- kill: default bars.

### SCR-003 — quote-pressure before the move
- mechanism: one-sided top-of-book revision flow (bid stepping up / ask
  lifting) precedes mid moves; buy the pressured side while the mid is
  still flat.
- not-a-reskin: revision-count flow is a rate, not E11's stock; not
  expressible in the CAL log; SIGNAL-001's rate60 is direction-blind.
- aim: unaimed.
- strategy: `screens/SCR-003-quote-pressure.ts` (`fable-scr-003`),
  defaults (`minNet=12 windowSec=60 maxMidMove=0.02`).
- prediction: winRate(bought side) > mean entry ask.
- kill: default bars.

### SCR-004t — at-touch tail maker (touch bound, local)
- mechanism: join the favorite's bid at touch late (750-880s, fav mid
  ≥ 0.90): collect the tail spread at zero fee from late longshot
  sellers.
- not-a-reskin: E14 killed TAKING the tail (fee + spread on the cost
  side); E19's two cells were regime-gated mid-window quotes — this cell
  is time × extreme-price gated. D18: kill/escalate only.
- aim: unaimed.
- strategy: `screens/SCR-004-touch-maker.ts` (`fable-scr-004`),
  params `gate=tail` (+defaults).
- prediction: EV per played market > 0 under the touch bound.
- kill: default bars on q̂ (played-market EV per D14 practice); a kill is
  decisive under the engine's most favorable fill assumption (audit-4.1
  wording).

### SCR-004r — at-touch reversal DOWN bid (touch bound, local)
- mechanism: the E22 buyer-adverse staleness (up-then-down reversal
  leaves UP ask ~4.4c stale-high gross) monetized from the maker side:
  bid DOWN at touch after the shape fires — removes fee AND spread from
  the cost side of the same continuation the taker mirror couldn't clear.
- not-a-reskin: IDEAS #10's taker mirror is parked on power for NET
  taker economics; this is a different instrument (maker at touch) on the
  same measured gross structure — explicitly sanctioned as an aimed shot
  at the one measured positive. Does NOT spend the reserve, does NOT
  touch CONFIRM-010 (which stays frozen for the taker mirror at unlock).
- aim: E22 (the map's seed already lights this zone).
- strategy: same file, params `gate=reversal minSeg=0.02 startSec=750`.
- prediction: EV per played market > 0 under the touch bound.
- kill: as SCR-004t.

### SCR-004o — at-touch opening spread capture (touch bound, local)
- mechanism: quote both sides at touch in the first 90s, before window
  information accumulates; cancel after. Pre-information flow is the
  least adversely selected of the episode.
- not-a-reskin: E19's quiet cell was regime-gated over the whole window
  (quiet ticks cluster at extreme mids, U27); this is time-gated at the
  open where mids sit near 0.5.
- aim: unaimed.
- strategy: same file, params `gate=open openEndSec=90`.
- prediction: EV per played market > 0 under the touch bound.
- kill: as SCR-004t.

## Feasibility smokes (counts only, no PnL — E15/EXP-006 discipline)

_Smokes run 2026-07-11 session 59, oldest-15 discovery markets, latency
0/0. Entry counts: SCR-001a 14/15, SCR-001b 14/15, SCR-002 14/15,
SCR-003 6/15; touch gates (D18 hook line verified in all three logs):
tail 1/15 played, reversal 2/15, open 12/15 (17 maker fills). All
plumbing green; NO cell was modified post-smoke (cells are the schema
defaults frozen above). Disclosure: the engine's end-of-run summary
prints won/lost lines for smoke samples (standard output, 15 markets);
read for plumbing verification only, per smoke precedent (EXP-001/005/
006); cells unchanged after reading. Note for verdict reading: SCR-002's
14/15 entry rate says the frozen gate is loosely selective — if its
conditional mean tracks the unconditional average (E20 ≈ 0), that is the
expected kill path, not a surprise. Touch tail/reversal gates are
low-incidence (~7-13%); at N=500 expect ~35-65 played — q̂-sign kill
semantics apply either way (kill-biased by design)._

## Verdicts (append-only after runs complete)

_Read 2026-07-11 session 59 via `tools/results.ts --run <id>`; all four
fleet runs completed 500/500 markets, 0 failures, commit 50a76f3 (the
freeze anchor's push). Screen-grade verdicts per SCREENING.md bars; batch
checker to follow._

- **SCR-001a — KILL** (run 450, played 465): q̂=−0.0813, t=−1.82,
  EV/market −2.75 CI95=[−5.72,+0.21]; winRate(played) 0.7849 vs entry ask
  ≈ 0.81 → prediction CONTRADICTED. Two kill branches fire (q̂≤0 with
  t≤−1; contradiction). First-arrival continuation at 0.80 pays the
  spread for a fair coin: the crossing side's ask is already ≥ fair at
  the crossing tick — event-time entry meets the same adversely-adjusted
  ask as fixed-time entry (E20 extended to first-passage conditioning).
- **SCR-001b — KILL** (run 446, played 463): q̂=−0.0024, t=−0.05;
  winRate(played) 0.1901 vs entry ask ≈ 0.19 → prediction NOT held
  (no overshoot: the longshot at first passage is priced fair). Minority
  count 88 ≥ 30 (E14 rule satisfied — the null is well-measured). Kill
  branch: q̂ ≤ 0.
- **SCR-002 — KILL** (run 447, played 474): q̂=−0.0348, t=−0.78; winRate
  0.5169 at mid-range entries, EV −0.94/market. Kill branch: q̂ ≤ 0.
  Depth-withdrawal points the WRONG way or too late — no tradable
  momentum after fee+spread. (Gate fired in 95% of markets — loosely
  selective as flagged pre-freeze; the conditional mean tracked the
  unconditional E20 null as predicted in the smoke note.)
- **SCR-003 — KILL** (run 449, played 219): q̂=−0.0478, t=−1.07; winRate
  0.4795, EV −1.04/market. Kill branches: q̂ ≤ 0 (t within −1 rounding:
  −1.07 ≤ −1 also fires). Directional quote-revision flow at a flat mid
  does NOT predict the outcome — one-sided revisions are already-adjusted
  quotes, not pending flow (E11's lesson extends from stocks to rates).

_Batch-checker erratum (fresh-context verification, session 59 — verdicts
stay append-only): (1) SCR-001b's "prediction NOT held" was imprecise —
back-derived mean entry ask is 0.1888, so winRate 0.1901 exceeded it by a
statistically null +0.0013 (t=−0.05); the accurate reading is "priced
fair"; the kill rests on the independent q̂ ≤ 0 branch and stands. (2)
SCR-003's "within −1 rounding" hedge was unnecessary — unrounded
t=−1.0696 fires the branch outright. (3) Disclosed limitation: the D8
latency pin on FLEET runs is not verifiable from run metadata (no
latency columns; cmd carries no flags) — for fleet screens the pin claim
rests on the U62 fleet/local parity evidence, not on per-run metadata.
_Session-63 upgrade: the pin is now EMPIRICALLY verified for this
batch's fleet path — run 450's played markets re-run locally at pinned
0/0 (run 471) reproduce 12/12 rows byte-identically across 19 fields
(parity.ts exit 0). A 140ms submission could not produce these rows
(latency is behavior-changing: BATCH-003 re-smoke evidence). The four
fleet screens were submitted in one loop, so the check transfers to
446/447/449 by construction; local touch runs 453/456/457 were already
0/0 in-log._
All four KILLs re-derived exactly (every quoted number matched
results.ts; freeze integrity confirmed: zero mini-spec edits after the
freeze commit; sample rule verified in stored cmd)._

_Touch-screen verdicts (read session 60, 2026-07-11, via results.ts;
local `--sequential --fill-mode touch_or_better` per the freeze; D18
rules bind — kill/escalate only:_

- **SCR-004r — KILL** (run 453, N=500, played 52, maker fills only,
  makerShare=1): q̂=−0.038, t=−0.85, EV/market −0.47
  CI95=[−1.55,+0.61]; EV(played) = −235/52 ≈ −4.52/market; winRate
  (played) 0.5192 (27/25) → prediction (EV per played market > 0 under
  the touch bound) CONTRADICTED in sign; kill branch q̂ ≤ 0 fires.
  Decisive under the engine's most favorable fill assumption
  (audit-4.1 wording). THE AIMED SHOT MISSES: the E22 up-then-down
  reversal staleness (~4.4c gross taker-side) does NOT survive
  instrument transfer to a DOWN bid at touch — fills arrive
  preferentially when continuation runs through the bid (the E16/E19
  adverse-selection mechanism eats the gross edge even at zero fee and
  zero spread cost). Incidence 52/500 ≈ 10.4%, consistent with the
  smoke (2/15). Pre-verdict checks: D18 hook startup + end-summary
  (481 instances forced), latency 0/0 in-log, boundary market absent
  (0 log hits; structurally excluded by --to-ms), phantom-fill
  tripwire clean (best/worst singles at 0.36/0.79 — plausible touch
  prices).

- **SCR-004t — KILL** (run 456, N=500, played 231, 236 maker fills,
  makerShare=1): q̂=−0.0838, t=−1.87, EV/market −1.65
  CI95=[−3.37,+0.08]; EV(played) = −823.1/231 ≈ −3.56/market; winRate
  (played) 0.9048 (209/22) → prediction (EV per played market > 0 under
  the touch bound) CONTRADICTED; kill branches q̂ ≤ 0 AND t ≤ −1 both
  fire. Decisive under the engine's most favorable fill assumption.
  E14 skew disclosure: minority (loss) count 22 < 30 — irrelevant to
  the kill (that floor gates SURVIVE calls), and the loss pattern is
  the finding: wins collect ~+10-12/market but worst losses run
  −96/−97 — bids at 0.96-0.97 fill exactly when the late favorite is
  flipping. Joining the favorite's bid late is selling insurance
  against the reversal at stale prices: the tail spread does not cover
  reversal risk even at zero fee and the friendliest fill model.
  Pre-verdict checks: D18 hook startup + end-summary (472 instances),
  latency 0/0 in-log, boundary market absent (0 log hits + structural
  --to-ms exclusion), phantom-fill tripwire clean (fill prices 0.88-
  0.97, plausible for the ≥0.90-fav-mid gate).

- **SCR-004o — KILL** (run 457, N=500, played 472, 923 maker fills,
  makerShare=1): q̂=−0.2307, t=−5.16, EV/market −2.578
  CI95=[−3.557,−1.599]; EV(played) = −1289/472 ≈ −2.73/market; winRate
  (played) 0.2373 (112/262) → prediction (EV per played market > 0
  under the touch bound) CONTRADICTED; kill branches q̂ ≤ 0 AND t ≤ −1
  both fire — the strongest and cleanest kill of the batch (t=−5.16).
  Decisive under the engine's most favorable fill assumption
  (audit-4.1 wording). The "pre-information grace window" does not
  exist: quoting both sides at touch in the first 90s gets ~1.96
  fills per played market (both sides often fill, partially hedged),
  yet the directional residue loses hard — the side that fills first
  is systematically the side the window is about to run against, from
  the very first seconds of the episode (E16/E19 adverse selection has
  no time-of-window off-switch). Incidence 472/500 = 94.4%, consistent
  with the smoke (12/15). Pre-verdict checks: D18 hook startup +
  end-summary (476 instances forced), latency 0/0 in-log, boundary
  market absent (0 log hits + structural --to-ms exclusion),
  phantom-fill tripwire clean (fill prices 0.15–0.83, plausible for
  first-90s touch quotes; worst singles −57 on 100 shares match
  mid-range entries).

## Batch checker — touch verdicts (fresh context, 2026-07-11 session 61)

_Per SCREENING step 5, one fresh-context checker over the three touch
verdicts (runs 453/456/457; the four fleet verdicts had their own
checker in session 59). Verdict: **sound-with-findings** — every
bar-relevant number re-derived exactly from raw SQL (N, played, pnl,
EV/market, CI95, q̂, t, EV(played), win/loss, fill counts, failures);
kill bars fire as claimed (004r on q̂≤0 only, 004t/004o on both
branches; played-only q̂ also kills all three, so the bar holds under
either population reading); predictions contradicted in sign; touch
discipline fully verified (batchUids, local single-machine sequential,
--to-ms in cmd, zero markets ≥ 1772323200000 DB-level, D18 hook +
latency 0/0 lines in all three logs, hook instance counts 481/472/476
match); mini-spec block byte-identical from freeze to HEAD, BATCH-001
diff since freeze removes zero lines. Four MINOR findings, accepted as
this erratum (verdicts above stay append-only):_

1. **SCR-004t fill-price range**: verdict says "0.88-0.97"; DB shows 68
   played markets at exactly 0.98 — the frozen `maxPrice=0.98` cap.
   True range 0.88–0.98. Tripwire conclusion unaffected (0.98 is within
   the cap, not a phantom price).
2. **SCR-004t win-size narrative**: "wins collect ~+10-12/market"
   overstates — mean win ≈ +5.72 (sum +1,195.9 over 209 wins), max +12,
   only 26/209 wins ≥ +10. The loss asymmetry (worst −96/−97) is
   thereby STRONGER than stated; kill unaffected.
3. **Freeze-anchor wording**: BATCH-001.md was introduced at 759e34f
   (U80); 50a76f3 (U80b, cited in the verdict preamble as "the freeze
   anchor's push") is the placement-fix follow-up. Mini-spec block
   byte-identical across both and HEAD — no integrity consequence.
4. **q̂ population ambiguity**: the mini-spec bar says "played-market EV
   per D14 practice" while verdicts quote all-N q̂ (results.ts
   convention). Both readings kill all three runs. Resolved for future
   batches in SCREENING.md (verdict bars now pin the population).
