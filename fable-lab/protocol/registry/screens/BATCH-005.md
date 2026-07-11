# BATCH-005 — the FINAL RUN batch (operator directive, 2026-07-11)

_Authority: the operator FINAL RUN directive (STATE.md operator update
2026-07-11, commit aef8dc3): build TWENTY new candidate strategies —
"recombinations, hybrid gates, unswept parameter regions, different
exit/hold structures, and subpopulation-conditioned variants of dead
ideas all count" — screen every one on the fleet with at least TWO
disjoint random samples, judge on the frozen bars, rank everything.
The directive explicitly OVERRIDES the frontier-closure dedupe rules
(EDGE-SPACE §4, E30 maker closure) for candidate CONSTRUCTION in this
batch; it does NOT touch the bars, the holdout, or the reserve. Where
a mini-spec below re-enters a closed family, the `not-a-reskin` line
names the closure and the directive as the override._

## Batch-level frozen rules (deviations from SCREENING.md stated here, pre-freeze)

- **Sample rule (deviation from the single-run D49 rule, mandated by the
  directive):** every screen runs TWICE on the fleet, `--detach`,
  latency pinned per D8 (`BACKTEST_LATENCY_DELAY=0
  BACKTEST_LATENCY_JITTER=0` on the submit command):
  - **Sample A:** `--random --limit N --to-ms 1768481099999`
    (discovery first half: 2025-11-30 → 2026-01-15T12:45Z, 4,258
    eligible markets)
  - **Sample B:** `--random --limit N --from-ms 1768481100000 --to-ms
    1772323199999` (discovery second half: → 2026-03-01, 4,258
    eligible markets)
  The split point is the MEDIAN market_start_ms of the eligible
  discovery window (computed outcome-free by `tools/final-split.ts`).
  The two samples are disjoint BY WINDOW CONSTRUCTION. The reserve
  (≥ 2026-03-01) and the holdout (≥ 2026-04-26T21:00Z) stay untouched
  by every run in this batch.
- **N per screen:** 500 default; 2,000 for the six low-incidence cells
  (SCR-017/018/019/023/025/029 — D49 amendment 2; the incidence
  arithmetic is in each mini-spec; estimates are priors from measured
  neighbors, disclosed as estimates).
- **Verdict rule (frozen):** each sample is judged on the unchanged D49
  bars (q̂/t over ALL N, results.ts convention; kill is the default
  outcome). The screen's overall verdict:
  - **SURVIVE** only if BOTH samples independently clear the survive
    bar (q̂ > 0 ∧ t ≥ +1.5 ∧ prediction held ∧ E14 minority count ≥ 30
    where skewed).
  - **PARK-DESIGN** if both samples are structurally entry-less.
  - **KILL** otherwise (default; one-sample survivals are reported in
    the table but are kills — the SCR-005/SCR-006 lessons E26 say one
    sample lies).
  A survivor is a CANDIDATE for the full confirmation lifecycle
  (fresh-sample screen on the reserve per D53 economics, then the
  LIFECYCLE path); screen survival licenses no edge language and no
  holdout read.
- **Maker-mechanism screens (SCR-026/027/028):** fleet = worst_queue;
  kills are model-conditional per D14. The E30 family closure is
  overridden for construction by the directive; the EXIT/inversion
  axes these cells test are genuinely unmeasured (every prior maker
  cell held fills to settlement).
- **In-sample screens (SCR-024/025):** the E21/E22 signals were FOUND
  on the discovery window these screens re-sample. Binding
  interpretation, frozen now: a positive readout is
  winner's-curse-inflated and confirms NOTHING (CONFIRM-010 stays the
  only confirmation path for #10); a kill is decisive at screen grade
  against the tradable version. These two screens exist because the
  directive orders measured numbers on every constructible candidate.
- **Batch checker:** one fresh-context checker over the verdict table
  (SCREENING §5, amendment 4 in force). If the session ends before the
  checker can run, the table says so explicitly.

## The twenty mini-specs (frozen at this commit)

Common: taker fee 156 bps modeled; E6 crossed-book guards in all
templates; one entry (or one quote cycle) per market; deterministic
clientOrderIds; time from tick timestamps only. `q̂` = EV/market over
all N; predictions are the sign the mechanism requires.

### SCR-010 — momentum + maker take-profit exit
- mechanism: 30s move ≥ 3c continues; monetize the continuation with a
  zero-fee maker re-ask at +2c instead of riding settlement variance.
- not-a-reskin: EXP-003/SCR-001 tested momentum ENTRIES held to
  settlement (killed: entry ask already fair). The EXIT structure is
  the new element — settlement-fair entry + asymmetric early
  monetization was never expressible in a hold-to-settle cell.
- invariants (D50): no cross-book disagreement needed; maker exit
  fills on worst-queue punch-through (bid must trade THROUGH the TP
  price — conservative against us); E6 guarded; results.ts zero-PnL
  convention noted.
- aim: unaimed (exit-axis gap).
- strategy: `screens/SCR-B5-momentum.ts` (`fable-scr-mom`)
  `mode=continue windowSec=30 moveThresh=0.03 exit=tp tpDelta=0.02`
- prediction: q̂ > 0; TP fill rate materially > 0 (else reduces to the
  measured settle cell).
- kill: default D49 bars, both samples. N=500.

### SCR-011 — momentum + taker stop-loss exit
- mechanism: same entry as SCR-010; the stop truncates the loss tail
  at −3c−fee. If momentum losses concentrate in continued adverse
  moves (they did in EXP-003's win rate), the stop reshapes EV upward.
- not-a-reskin: as SCR-010 (exit axis; stop never expressible before).
- invariants: stop exit pays taker fee twice (entry+exit) — the
  mechanism must clear ~2× fee floor on stopped markets; E6 guarded.
- aim: unaimed (exit-axis gap).
- strategy: `fable-scr-mom`
  `mode=continue windowSec=30 moveThresh=0.03 exit=sl slDelta=0.03`
- prediction: q̂ > 0 and EV improves vs the settle-held EXP-003 sign.
- kill: default bars, both samples. N=500.

### SCR-012 — fade + maker take-profit (reversion scalp)
- mechanism: 30s move ≥ 3c overshoots; buy the faded side, exit at +2c
  maker. EXP-005/SCR-001b faded and LOST to settlement — but a
  reversion that only needs 2c of pullback (not a settlement flip)
  is a different payoff object.
- not-a-reskin: fade-to-settlement measured (E12/E24); fade-to-scalp
  never. The TP turns "wrong about the winner" into "right about a 2c
  pullback".
- invariants: TP fill needs a punch-through above entry+2c
  (worst-queue, conservative); E6.
- aim: unaimed (exit-axis gap).
- strategy: `fable-scr-mom`
  `mode=fade windowSec=30 moveThresh=0.03 exit=tp tpDelta=0.02`
- prediction: q̂ > 0 with TP fills carrying the PnL.
- kill: default bars, both samples. N=500.

### SCR-013 — tight-spread × momentum (interaction)
- mechanism: continuation conditioned on a TIGHT book (≤ 1c spread) at
  trigger — the fee-minimal, adverse-selection-minimal subpopulation.
  CAL-004 measured spread state × LEVEL (null); spread × MOVE is a
  joint conditioning its scope note leaves formally open.
- not-a-reskin: the named open interaction (CAL-004 erratum scope);
  single axes measured, this joint cell not.
- invariants: E6; entry at ask, hold to settlement (results
  comparable to EXP-003's unconditional kill).
- aim: EDGE-SPACE §1 "joint/interaction conditionings" open clause.
- strategy: `fable-scr-mom`
  `mode=continue windowSec=30 moveThresh=0.03 spreadMax=0.01 exit=settle`
- prediction: q̂ > 0 (the unconditional q̂ was −0.0475 at t=−1.06;
  the gate must flip the sign, not just dampen it).
- kill: default bars, both samples. N=500.

### SCR-014 — depth-agreement × momentum (interaction)
- mechanism: continuation only when the L1 book agrees (bid size ≥ 2×
  ask size on the move side — resting demand supports the move).
  EXP-004 killed depth-imbalance ALONE; move sign alone is fair
  (CAL-002); the conjunction is unmeasured.
- not-a-reskin: interaction of two individually-dead axes (the
  directive's explicit recombination case).
- invariants: E6; depth read from the same tick as entry (no
  lookahead); hold to settlement.
- aim: joint-conditioning open clause.
- strategy: `fable-scr-mom`
  `mode=continue windowSec=30 moveThresh=0.03 depthRatioMin=2 exit=settle`
- prediction: q̂ > 0.
- kill: default bars, both samples. N=500.

### SCR-015 — US-hours × momentum (seasonality subpopulation)
- mechanism: continuation gated to 14:00–21:00 UTC (US market
  attention; retail flow hypothesis). SIGNAL-001 seasonality was null
  for LEVEL features; hour × momentum is a subpopulation variant.
- not-a-reskin: subpopulation-conditioned variant of a dead idea
  (directive case); hour × move never scanned.
- invariants: hour from tick timestamp (UTC, deterministic); E6.
- aim: unaimed.
- strategy: `fable-scr-mom`
  `mode=continue windowSec=30 moveThresh=0.03 hourMin=14 hourMax=21 exit=settle`
- prediction: q̂ > 0.
- kill: default bars, both samples. N=500.

### SCR-016 — busy-tape × momentum (vol-regime subpopulation)
- mechanism: continuation only when the trailing 120s mid RANGE ≥ 4c
  (loud regime — information arriving). EXP-007 tested loud MAKER
  (killed); loud TAKER momentum is the unswept quadrant.
- not-a-reskin: regime gate recombined onto the taker side (directive
  case: unswept quadrant of two dead axes).
- invariants: range from the strategy's own mid buffer
  (deterministic); E6.
- aim: unaimed.
- strategy: `fable-scr-mom`
  `mode=continue windowSec=30 moveThresh=0.03 volMin=0.04 volWindowSec=120 exit=settle`
- prediction: q̂ > 0.
- kill: default bars, both samples. N=500.

### SCR-017 — dwell-breakout (small-then-big path shape)
- mechanism: ≥120s of ≤1c mid range, then a 2c move in 30s — a
  breakout from stasis. CAL-003 scanned BIG-BIG two-segment shapes
  only; quiet-then-big is the formally open small-then-big shape
  (E22 scope note).
- not-a-reskin: the named open path-shape window; no prior cell
  conditioned on preceding stasis.
- invariants: dwell measured as range (not endpoints — round trips
  disqualify); E6; hold to settlement.
- aim: EDGE-SPACE §1 "mid-involved shapes excluded and formally open".
- strategy: `fable-scr-mom`
  `mode=continue windowSec=30 moveThresh=0.02 preQuietMax=0.01 preQuietWindowSec=120 exit=settle`
- prediction: q̂ > 0.
- kill: default bars, both samples. N=2000 (incidence prior: quiet
  120s windows are common but the 2c-in-30s break right after is a
  tail conjunction; estimate 8-15% of markets ⇒ expected played
  ~160-300 at N=2000, ≥ ~100 at the survive-bar floor).

### SCR-018 — late-window big-move continuation (unswept parameter region)
- mechanism: E21 measured post-down-move continuation ≈1.5-2.4c gross
  from 300s on at 2c moves — below taker costs. A 4c/30s move late
  (≥600s) is the unswept aggressive corner: if continuation scales
  with move size, gross may clear spread+fee there.
- not-a-reskin: CAL-002's grid capped at "big = 2c" between fixed
  offsets; 4c event-time moves late are outside the measured grid
  (unswept parameter region — directive case).
- invariants: E6; hold to settlement; late entries have wide books
  (CAL-004 W-state) — ask bounds 0.03-0.97 apply.
- aim: SIGNAL-MAP staleness family, aggressive-move corner.
- strategy: `fable-scr-mom`
  `mode=continue windowSec=30 moveThresh=0.04 minElapsedSec=600 exit=settle`
- prediction: q̂ > 0.
- kill: default bars, both samples. N=2000 (4c/30s late: estimate
  5-12% ⇒ played ~100-240).

### SCR-019 — late favorite-collapse fade (level-anchored overreaction)
- mechanism: a favorite at ≥0.80 that collapses to ≤0.68 within 60s
  late in the window (≥450s) is a panic reprice; buy the collapsed
  side back. Level-anchored collapse (state+path+event-time
  conjunction) is expressible in no prior scan.
- not-a-reskin: SCR-001b faded FIRST touches of 0.80 from below;
  this fades violent EXITS from above — different event, different
  side of the barrier.
- invariants: E6; anchor uses window-ago mid ≥ level (not high-water
  mark — stated so the cell is honest about partial coverage); hold
  to settlement.
- aim: unaimed (overreaction family).
- strategy: `fable-scr-mom`
  `mode=fade fromLevel=0.80 moveThresh=0.12 windowSec=60 minElapsedSec=450 exit=settle`
- prediction: q̂ > 0.
- kill: default bars, both samples. N=2000 (12c collapses are rare:
  estimate 2-6% ⇒ played ~40-120; if both samples are structurally
  entry-less → park-design).

### SCR-020 — extreme favorite + maker take-profit (payoff reshape)
- mechanism: buy the 0.90-0.95 favorite late (≥600s) and re-ask at
  +3c (cap 0.99) as a zero-fee maker order: monetize convergence
  early, avoid holding the full tail loss when the favorite flips.
  EXP-001 killed BUY-AND-SETTLE at the tails (E14: fair). The TP
  asymmetry: wins are capped early (lose ~nothing vs settle), losses
  are NOT truncated — the bet is that flips pass through 0.93+ often
  enough on the way down that the TP already banked the win.
- not-a-reskin: EXP-001's cell with the unswept exit axis (directive
  case).
- invariants: TP fills need bid > TP price (worst-queue punch);
  E14 skew rule applies (minority count ≥ 30 required to survive).
- aim: unaimed (exit axis at the measured-fair tail).
- strategy: `screens/SCR-B5-level-exit.ts` (`fable-scr-lvl`)
  `entryMinAsk=0.90 entryMaxAsk=0.95 minElapsedSec=600 exit=tp tpDelta=0.03 tpCap=0.99`
- prediction: q̂ > 0.
- kill: default bars + E14 minority rule, both samples. N=500.

### SCR-021 — mid favorite convergence + maker take-profit
- mechanism: buy the 0.60-0.75 favorite mid-window (≥300s), re-ask at
  +4c maker. Favorites drift toward certainty conditional on winning;
  the TP monetizes the drift leg fee-free without settlement risk on
  the full path.
- not-a-reskin: CAL-001 measured this band at fixed offsets as
  BUY-AND-SETTLE (fair). Exit axis new.
- invariants: as SCR-020; mid-band = maximal variance (E14 rule not
  skewed here).
- aim: unaimed (exit axis, mid band).
- strategy: `fable-scr-lvl`
  `entryMinAsk=0.60 entryMaxAsk=0.75 minElapsedSec=300 exit=tp tpDelta=0.04`
- prediction: q̂ > 0.
- kill: default bars, both samples. N=500.

### SCR-022 — underdog + taker stop-loss (loss-tail truncation)
- mechanism: buy the 0.20-0.35 underdog (≥300s) with a −5c taker
  stop: keep the settle-to-$1 right tail, cut the bleed-to-zero left
  tail. Underdog-and-settle is measured fair; the stop is a payoff
  reshape on the same fair entry.
- not-a-reskin: exit axis on a measured-fair band (directive case).
- invariants: stopped markets pay double taker fee; the reshape must
  beat that drag; E6.
- aim: unaimed (exit axis, underdog band).
- strategy: `fable-scr-lvl`
  `entryMinAsk=0.20 entryMaxAsk=0.35 minElapsedSec=300 exit=sl slDelta=0.05`
- prediction: q̂ > 0.
- kill: default bars, both samples. N=500.

### SCR-023 — quiet-early favorite (subpopulation conditioning)
- mechanism: in markets whose first 300s mid range ≤ 3c (nothing
  happened early), a ≥0.80 favorite at 600s reflects mid-window
  information with less accumulated noise; buy and settle. The
  subpopulation split (per-market early-path regime) is a
  conditioning no scan expressed (CAL grids condition on the ENTRY
  state/path, not on a disjoint earlier window's realized range).
- not-a-reskin: subpopulation variant of the measured-fair late
  favorite (directive case; population selection ≠ entry state).
- invariants: range gate requires the feed observed from ≤60s (late
  starters skip — disclosed coverage conditioning); E6; E14 skew rule
  applies at 0.80-0.92.
- aim: unaimed.
- strategy: `fable-scr-lvl`
  `entryMinAsk=0.80 entryMaxAsk=0.92 minElapsedSec=600 activityMaxRange=0.03 exit=settle`
- prediction: q̂ > 0.
- kill: default bars + E14 minority rule, both samples. N=2000
  (quiet-early ∧ late-favorite conjunction: estimate 10-20% ⇒ played
  ~200-400).

### SCR-024 — E21 continuation mirror (measured staleness, taker)
- mechanism: after a ≥2c down segment between 600s and 750s, the UP
  ask is measured stale-high ≈2-2.4c gross (E21, z=−3.72); buy DOWN
  at 750s — the tradable mirror, which netted ≤+0.75c on the
  discovery table. Screened here at the directive's order for a
  measured number on the tradable version.
- not-a-reskin: THE measured signal itself; in-sample caveat frozen
  in the batch header (positive ⇒ inflated, kill ⇒ decisive).
- invariants: CAL offset convention (first book state at/after
  offset); coverage conditioning at late offsets (0.766 pair
  fraction) discloses itself in played counts; E6.
- aim: EDGE-SPACE §1 E21 row.
- strategy: `screens/SCR-B5-stale-mirror.ts` (`fable-scr-stm`)
  `shape=dn t1Sec=600 t2Sec=750 segThresh2=0.02`
- prediction: q̂ > 0 but BELOW the survive bar (the honest reading of
  ≤+0.75c at z≤+1.75); the screen tests whether the tradable mirror
  clears bars it never cleared on the scan table.
- kill: default bars, both samples. N=500 (incidence ~33% measured).

### SCR-025 — E22 reversal mirror (measured staleness, taker)
- mechanism: big up (450→600) then bigger down (600→750) reversal
  leaves the UP ask ≈4.4c stale gross (E22, z=−3.47); buy DOWN at
  750s (mirror netted +2.38c at z=+2.40 on the scan — sub-bar).
  CONFIRM-010's shape, screened in-sample per the directive.
- not-a-reskin: the measured E22 signal; in-sample caveat frozen in
  the header. This screen does NOT execute or replace CONFIRM-010
  (which draws on post-freeze data only).
- invariants: as SCR-024; triple coverage 0.766/0.464 late.
- aim: EDGE-SPACE §1 E22 row.
- strategy: `fable-scr-stm`
  `shape=updn t0Sec=450 t1Sec=600 t2Sec=750 segThresh1=0.02 segThresh2=0.02`
- prediction: q̂ > 0 (winner's-curse-inflated in-sample; survive on
  both fresh halves would still only buy a reserve-economics
  registration, not confirmation).
- kill: default bars, both samples. N=2000 (measured incidence ~12%
  ⇒ played ~240).

### SCR-026 — maker bid + maker take-profit (worst-queue, exit axis)
- mechanism: DOWN bid 1c below fair; on the punch-through fill,
  immediately re-ask at +2c maker (zero fee both legs). Every
  measured maker cell SETTLED its toxic fills (E16/E17: −0.79 to
  −1.27/played). If any fraction of punch-throughs partially reverts
  2c before settlement, the TP harvests it fee-free.
- not-a-reskin: maker family closed (E30) — OVERRIDDEN for
  construction by the FINAL RUN directive. The exit axis is
  genuinely unmeasured on maker fills. Kill is model-conditional
  (D14): worst-queue on BOTH legs (the TP itself needs a
  punch-through above it, which biases AGAINST the strategy —
  disclosed).
- invariants: worst-queue = informative fills (E16); the premise is
  partial REVERSION after the sweep, which E26b's pair-sum
  adverseness makes unlikely — stated honestly; one quote cycle per
  market; E6.
- aim: unaimed (maker exit axis).
- strategy: `screens/SCR-B5-maker-exit.ts` (`fable-scr-mkx`)
  `delta=0.01 exit=tp tpDelta=0.02`
- prediction: q̂ > 0 via TP fills recovering the adverse selection.
- kill: default bars, both samples; D14 model-conditional. N=500
  (fill incidence prior ~25-50% from E16 quiet-gated 117/500 and
  ungated touch 479/500).

### SCR-027 — maker bid + taker stop-loss (worst-queue, exit axis)
- mechanism: same bid; if the mid runs 3c beyond the fill, taker-exit
  immediately — cut the informed tail, keep noise fills that revert.
  E16's kill was driven by fills that KEPT going; the stop bounds
  each fill's loss at ~3c+fee.
- not-a-reskin: as SCR-026 (override + unmeasured exit axis).
- invariants: stop pays taker fee on exit; worst-queue entry; E6;
  one cycle per market.
- aim: unaimed (maker exit axis).
- strategy: `fable-scr-mkx` `delta=0.01 exit=sl slDelta=0.03`
- prediction: q̂ > 0 (stop converts the E16 left tail into bounded
  losses smaller than the noise-fill wins).
- kill: default bars, both samples; D14. N=500.

### SCR-028 — fill-as-signal inversion (probe bid → taker momentum)
- mechanism: E16/E17 prove a worst-queue fill IS informed flow. Stop
  being its counterparty: a 1-share DOWN probe bid detects the sweep,
  and on fill the strategy taker-buys UP — riding WITH the
  information. No prior cell used own-fill as an entry TRIGGER; the
  CAL scans cannot express it (fill events are not in the discovery
  log's state space).
- not-a-reskin: inverts the dead family's role assignment (directive
  recombination); the maker leg is a detector, not a position (1
  share bounds its loss).
- invariants: the UP ask at signal time has already moved (the sweep
  happened) — the bet is continuation BEYOND the post-sweep ask,
  which E24's event-time kills make the named risk; stated honestly.
  E6 on both legs.
- aim: unaimed (event-type gap: sweep-triggered entry).
- strategy: `screens/SCR-B5-fill-signal.ts` (`fable-scr-fsig`)
  defaults (`probeDelta=0.01 probeShares=1 mainShares=100`).
- prediction: q̂ > 0 driven by the UP leg.
- kill: default bars, both samples. N=500.

### SCR-029 — second-passage barrier (multi-crossing path shape)
- mechanism: SCR-001 killed FIRST passages of 0.80. The SECOND
  passage — reached, rejected, re-attained — is a different path
  object (failed-reversal exhaustion); crossing COUNTS exist in no
  scan's state space.
- not-a-reskin: SCR-001's dead first-passage is the explicit
  contrast; the re-arm hysteresis (2c) makes the second crossing a
  real rejection, not bid-ask flutter.
- invariants: E6; per-side counters; crossings before the entry
  window still count toward the index (stated); hold to settlement.
- aim: unaimed (path-shape gap).
- strategy: `screens/SCR-B5-second-passage.ts` (`fable-scr-2pass`)
  `barrier=0.80 passageIndex=2 rearmDelta=0.02`
- prediction: q̂ > 0.
- kill: default bars, both samples. N=2000 (second passages with 2c
  re-arm: estimate 5-12% ⇒ played ~100-240).

## Derivation record (constructed = 20; nothing killable at freeze was submitted)

The idea sweep also produced candidates killed at derivation, all
previously recorded and re-verified against the invariant list (E27c):
split-funded two-sided asks (≡ EXP-006 by the mirror identity),
standing dutch books (E9: zero incidence net of fees), cross-book
lead-lag (same-tick mirror invariant forbids the premise), round-number
anchoring (no carrier, BATCH-003), cross-episode conditioning (not
backtest-expressible). No twenty-first constructible mechanism-distinct
candidate was dropped for capacity reasons.

## Feasibility smokes (counts only, no PnL — E15 discipline)

_To be appended before submission: one local `--sequential` 10-market
smoke per template (6 smokes), fill/entry counts only._

## Verdicts (append-only after runs complete)

_To be appended: one ranked table, both samples per screen, per-sample
q̂/t/played/winRate, verdict line per screen against the frozen bars._
