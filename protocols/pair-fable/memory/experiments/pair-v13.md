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
