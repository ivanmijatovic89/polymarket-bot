# Family: pair-v4 (both-sides start quoting)

Strategy file: `protocols/pair-fable/strategies/pair.v4.ts` (id
`pair-fable-v4`). Derived from pair-v1; ONE structural change. Same 6 params
(guard 2: no new tunables).

**design-ts (M2 rule)**: the commit adding pair.v4.ts AND this file with the
frozen grid below is the param-freeze commit for all three configs.

## Design delta vs v1 (structural)

While balanced, v4 rests one start bid on EACH side simultaneously (each
joining its side's bestBid, placed only while the JOINT gate holds:
projected avgUp+avgDown ≤ maxPairCost after both fill), with per-side
requote cooldown. v1 quoted one side at a time (alternating), so every
crossing on the unquoted side was a missed start. On imbalance v4 cancels
resting starts (both ids) and repairs exactly like v1 (lesser side at gate
cap). Double fill in the latency race = instant pair at bid-sum cost.

## Pre-registered hypothesis + grid (guard 1, BEFORE launch)

Motivation: E-013 proved S is fill-limited (crossings are market-given) and
the §Cadence model says profit needs S > S* = q(1+avgE/g_sh) ≈ 2.7–3.0 at
gate 0.93. Both-sides quoting is the only structural way to capture more
crossings at top-of-book: symmetric crossings ⇒ S up to ~2×.

**Honest opposing force (pre-registered)**: q may RISE with both-sides
quoting — a runaway now always catches a resting start on the losing side,
where v1's alternation was only exposed ~half the time. If q inflates
toward ~2× the mechanism gets WORSE, not better. Which force dominates is
exactly what this batch measures. This also finally runs the q-vs-S
discrimination that E-013 could not (S never moved there).

Grid (screens `--latest --limit 800` @ 140/20ms; defaults ttl 90 / cd 25 to
isolate the both-sides delta vs same-gate v1 parents):

| config | params | falsifiable prediction |
| --- | --- | --- |
| v4-a | defaults (gate 0.98) | S 2.42→≥3.4 |
| v4-b | maxPairCost=0.95 | S 1.88→≥2.6 |
| v4-c | maxPairCost=0.93 | S 1.64→≥2.3; IF q holds ≤0.55, ev −0.55→≥−0.15; if S≥3.0 and q≤0.50: ev ≥ 0 |

Baselines: 872/873/879 via compare.ts intersection; anatomy.ts for (S, q,
g_sh, avgE) per run.

**Pre-registered verdict rules**:

- ADVANCE iff Δp/100 > 0 beyond noise at some gate AND the (S,q) readout
  shows S rising materially (≥1.3×) with q rising by less than half of S's
  relative rise — then iterate toward the S*-crossing gate.
- KILL the family if q inflates ≥ in proportion to S (per-start-hazard
  world: every extra start is a new independent doom coin — then
  pnl/played = inc·S·[g_sh(1−p) − avgE·p] < 0 at every gate/cadence and
  top-of-book pair accumulation is structurally unprofitable at 140ms; the
  protocol's next axis must leave this mechanism class entirely).
- E-004 guard as always: an ev gain from volume shrink with flat/worse
  p/100 is not a cure.
- S3 watch: taker share must stay in the parents' range (~13–16%); starts
  are join-only so any explosion would come from repair churn.

## Runs

design-ts (all 3 configs) = freeze commit `28f1f8b` @ 2026-07-31T00:49:42Z.
Smoke: run 884 (5 mkts, 0 failures, 25m/4t trades — both-sides visibly
active). All screens 2026-07-31, `--latest --limit 800` @ 140/20ms,
identical universe as parents (common=800 in every compare):

| run | config | pnl | ev/mkt | p/100 | played | S/played | q | g_sh | Δev vs parent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 885 | v4-a 0.98 | −1620.25 | −2.0253 | −7.81 | 705 | 3.42 (×1.41) | 0.732 (×1.50) | 0.0422 | −0.5234 |
| 886 | v4-b 0.95 | −1037.60 | −1.2970 | −7.94 | 668 | 2.39 (×1.27) | 0.597 (×1.15) | 0.0644 | −0.2301 |
| 887 | v4-c 0.93 | −524.28 | −0.6554 | −8.04 | 501 | 1.66 (×1.01) | 0.463 (×0.97) | 0.0831 | −0.1017 |

## Findings (2026-07-31 session 3) — VERDICT: KILL (family + mechanism class)

- **The pre-registered opposing force won.** At 0.98, q inflated FASTER
  than S (×1.50 vs ×1.41) — the q-proportional KILL prong fires. At 0.95, S
  ×1.27 (under the 1.3 bar) with q rising at 0.56× S's relative rise (over
  the ½ bar). At 0.93 the joint gate holds so rarely that S didn't move at
  all (×1.01; more markets touched — 501 vs 416 — but same starts/market).
  ev is WORSE at every gate; the p/100 upticks (+0.24/+1.23/+0.35) are
  denominators growing faster than losses, not a cure. No ADVANCE prong
  met anywhere. [runs 885–887 vs 872/873/879 | 2026-07-31]
- **Real positive worth recording: pair margin g_sh rose ~50%** (0.0279→
  0.0422 at 0.98) — double-fill races complete pairs at bid-sum cost,
  cheaper than v1's start+repair-at-cap. The margin gain was fully repaid
  by extra dooms: efficient pricing again (pair-v2's lesson generalized).
- **Late-window hazard explodes under both-sides** (885 doom hazard by
  start minute: 0.16–0.20 in minutes 0–5 → 0.43–0.49 in minutes 8–11):
  with both sides resting, every late runaway catches a start with no
  repair time left. (A wider start cutoff would trim this, but see the
  invariant below — there is no profitable residual to protect.)

### The per-start invariant (all 6 runs, both mechanisms — class verdict)

Doom probability PER START is a gate-dependent constant, invariant to
mechanism (one-sided v1 vs both-sides v4), ttl, and cooldown:

| gate | p = dooms/starts (v1) | p (v4) | per-start EV/share: g_sh(1−p) − avgE·p |
| --- | --- | --- | --- |
| 0.98 | 0.201 | 0.214 | −0.061 (v1: −0.061) |
| 0.95 | 0.275 | 0.250 | −0.060 (v1: −0.060) |
| 0.93 | 0.290 | 0.280 | −0.058 (v1: −0.058) |

**Every start loses ≈ $0.06/share (=$0.60/increment) in expectation, at
every gate, at every cadence, one-sided or both-sided.** g_sh and p co-move
exactly along the efficient-pricing line: tighter gates buy more margin AND
proportionally more per-start death (repair blocked more often). This is
the −8/$100 per-dollar invariant (pair-v1 gate curve) in per-start form,
and it explains every kill so far: E-004 (gate = volume knob), pair-v2
(repair persistence EV-neutral), E-012 (doom unpredictable from state),
E-013 (S fill-limited), E-014 (extra starts bring proportional dooms).

**Mechanism interpretation**: under worst-queue, a maker fill happens ONLY
when price trades through the level — every fill is by construction on a
locally falling side. The ≈6c/share is the adverse-selection cost of
trade-through fills net of pair margin, and no start/repair/gate/cadence
knob within the maker-accumulation class touches it. **The
top-of-book maker pair-accumulation class is structurally unprofitable at
140ms under the sim's fill model (time-scoped 2026-07, universe latest-800
+ FULL v0 E-005).** Guard 4: leave the mechanism class.

**Parity caveat worth carrying forward (not actionable without the human)**:
worst-queue understates fill QUALITY, not just rate — live maker fills
include benign lifts (level not traded through) that the sim never grants
(parity.md §3). The class verdict is therefore "unprofitable under the
binding evidence standard", which RULES make the promotion standard; only
live measurement (e.g. a dry-run benign-fill-share study) could revisit it.
