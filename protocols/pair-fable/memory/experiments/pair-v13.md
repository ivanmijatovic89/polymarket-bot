# pair-v13 — time-varying policy across the window (ruling axis 5)

Ruling axis 5 (inbox 8758567d): "Time-varying policy across the window:
your flat doom hazard was measured for a FIXED policy — it does not
test a policy whose price band, size, or completion trigger changes
with minutes-to-expiry."

## What existing evidence already bounds

- **Doom hazard by start minute** (anatomy, runs 872/916): ~0.16–0.28
  across minutes 0–11, mildly rising late — flat-ish, but hazard is only
  ONE term; per-minute pair margin g and per-minute EV were never
  computed. That is the gap this scan closes.
- **Completion trigger vs time**: E-020b measured the completion-module
  slack on the v1 base at ≈ +$30/800 markets total, with a time-agnostic
  mechanistic explanation (salvage transfers dollars between terms;
  profit-lock margins ≤ 1¢ get eaten by fees). A time-conditioned
  completion trigger is a subset of that module space; we scope it as
  bounded by E-020b and do NOT rescan it here (residual honesty note:
  strictly, time-conditioning could differ — reopen only with a concrete
  mechanism argument).
- **Size vs time**: sizing starts by minute is a convex reweighting of
  per-minute EV components (same argument as pair-v12 §Axis 4a) — it is
  bounded by the best minute bucket this scan measures. If all buckets
  ≤ 0, size-vs-time is answered with the same evidence.
- **Start rate is fill-limited** (E-013): starts are <1% elastic to
  ttl/cooldown — so a minute-window start policy mostly TRUNCATES starts
  rather than reallocating them, which is what makes reanalysis-based
  attribution meaningful at all.

## E-027 pre-registration (session 14, BEFORE any tool code) — Phase 0: per-minute EV scan

**Question**: does per-start-minute EV vary across the 15-minute window
enough that restricting starts to a minute region M (a time-varying
start gate — the start-window sub-axis of axis 5, and by the
reweighting argument also the size-vs-time sub-axis) could reach
ev ≥ 0 on the retained activity?

**Data**: existing runs 872 (v1-a, gate 0.98) and 873 (v1-b, gate
0.95) — pinned 800, 140/20 ms. Two gate endpoints so a minute-varying
gate interpolating within {0.95, 0.98} has measured cells at both ends.
No new backtest runs; no strategy code.

**Tool** (`tools/minuteev.ts`, written AFTER this design commits):
reads per-market rows + intent_meta (same fetch as anatomy.ts), and
reports per minute bucket m ∈ 0..14:

- **View 1 (clean attribution)**: markets with EXACTLY ONE 'S' fill —
  key = that start's minute. Per bucket: n, ev/mkt (mean pnl), SE
  (sample sd/√n), doom fraction (residue > 0), invested mean.
- **View 2 (all played markets)**: key = FIRST-start minute. Same
  stats. (Covers multi-start markets; attribution approximate.)
- **Cumulative-from-m view**: markets whose first start is in minute
  ≥ m (approximates the policy "forbid starts before minute m"). ev/mkt
  and SE per m.
- **Split-half reproduction**: the frozen halves are the pinned-800
  universe sorted by market_start_ms, first 400 vs last 400 (E-022
  methodology). Positive regions must reproduce: same sign AND ≥ half
  the full-sample magnitude in both halves.

**Frozen verdicts**:
- **KILL** the start-timing sub-axis (and with it size-vs-time, by the
  reweighting bound) if NO minute bucket and NO contiguous minute
  region reaches ev ≥ 0 at ≥ 2 SE in View 1, in either run, on the
  full 800 — or if any candidate region fails split-half reproduction.
  Scope: time-scoped 2026-07, pinned-800 universe, v1 family, gates
  {0.95, 0.98}.
- **ITERATE** if a contiguous region with ev ≥ 0 at ≥ 2 SE reproduces
  across halves in at least one run: then (and only then) design a
  REAL strategy sweep (v1 + startFromMin/startToMin params — new
  design-ts before code). A positive scan region is NEVER itself an
  S-gate claim.

**Confounders pre-committed**: (a) multi-start attribution is
approximate — View 1's single-S subsample is clean but selection-biased
toward quiet markets; both views are reported and View 1 rules the
verdict; (b) forbidding early starts frees cap/cooldown for later
crossings, which reanalysis cannot model — E-013's <1% cadence
elasticity bounds this reallocation error; (c) a negative scan kills
the start-timing + size-vs-time sub-axes only; completion-vs-time stays
bounded by E-020b as scoped above; (d) bucket SEs on ~800 markets split
across 12 active minutes are wide (~n=30–100/bucket in View 1) — the
2-SE bar plus reproduction guard against noise-mining, and "no bucket
positive" is a robust negative even with wide SEs if point estimates
are uniformly < 0.

design-ts (E-027): this commit, session 14 — before any tool code.

## Result E-027 (session 14) — VERDICT: KILL (start-timing + size-vs-time sub-axes; time-scoped 2026-07, pinned-800, v1 family, gates {0.95, 0.98})

Tool `tools/minuteev.ts` (written after design commit 743d0be), runs
872 + 873, no new backtest runs. 0 markets with S-fills missing ts.

**KILL condition met on the full sample in BOTH runs**: no minute
bucket and no contiguous minute region reaches mean ≥ 2·SE ≥ 0 in
View 1 (single-S markets — 247 mkts in 872, 296 in 873). Split-half
reproduction was not reached (no candidate regions exist).

The negative is not marginal — per-minute EV is uniformly negative:

- Run 872 (gate 0.98): View-1 buckets minute 0–3 (n=182/41/5/15) sit at
  −2.1..−3.3; the only non-negative cells are n=1 singletons (+0.20 ≈ a
  single completed pair's margin). Starts barely exist past minute 3 at
  this gate (join-only + 3-min-cutoff scaffolding fills early).
- Run 873 (gate 0.95): activity spreads across minutes 0–11 (n=7..99
  per bucket); every bucket ≤ 0; best cells minute 7 (0.000 ± 0.50,
  n=7) and minute 11 (−0.56 ± 0.38, n=10) — nowhere near +2 SE.
- Cumulative "forbid starts before minute m": never positive at any m
  in either run (872: −1.70 → −1.00 for m 0→5; 873: −1.38 → −0.56 for
  m 0→11, with the m=7 point −0.79 ± 0.23 still clearly negative).
- Doom fraction by start minute: 46–100% (872), 14–79% (873) with no
  usable structure — consistent with E-012/E-022's "doom is
  unpredictable" across a third signal space (time-of-window).

By the pre-registered reweighting argument, size-vs-time is answered by
the same evidence (all minute buckets ≤ 0 ⇒ any minute-weighted sizing
is bounded by the best bucket ≈ 0 from below). Completion-vs-time stays
bounded by E-020b as scoped in the design. A minute-varying gate
interpolating {0.95, 0.98} has no positive cell at either measured
endpoint.

**Ruling-axis bookkeeping**: axis 5 is the LAST of the six axes from
inbox 8758567d. All six are now answered on the v1 family, all
negative: 1 (E-019/E-021), 2+3 (E-020/E-020b), 4a (reweighting
argument)/4b (E-026), 5 (E-027), 6 (E-022). Per §Kill standards these
are family-scoped kills; no class kill is claimed. Session 15
(self-check) owes the strategic replan.
