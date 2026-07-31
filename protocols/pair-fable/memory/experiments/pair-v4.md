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

(filled after launch)
