# Family: pair-v9 (absolute entry-price ceiling) — E-019

First axis of the human ruling that withdrew the class kill (inbox
8758567d, 2026-07-31; see pair-v4.md §Class-kill WITHDRAWN and
evaluator.md §Kill standards). The ruling's identity, per market:

    EV = (completed increments × pair margin g) − (stranded shares × L_s)

Every prior family attacked completion rate or g. pair-v9 attacks **L_s**,
the loss per stranded share — a policy choice measured at ≈ $0.44/share in
the v1 family, because only the JOINT gate (maxPairCost) was constrained
and single sides were bought up to ~0.98 − otherRef. The axis: **never buy
any side above an absolute ceiling X**. Then L_s ≤ X by construction, and
a completion (both legs ≤ X) locks g ≥ 1 − 2X. Fewer starts, much bigger
margin per completion. This is NOT v8: v8 rested relative to bestBid
(bestBid − δ), which buys expensive sides at a discount; v9 refuses
expensive sides entirely.

## Design (minimal delta from pair.v1)

`pair-fable-v9` = pair.v1 verbatim, plus the ceiling, minus the exposed
joint-gate param (param budget stays 6, per evaluator.md guard 2):

1. **START** (balanced book): join bestBid ONLY when `bestBid ≤ X` (v1's
   join-only start, with the ceiling as the entry condition). No deep
   resting on the first leg — an unpaired deep rest is maximal adverse
   selection with no locked margin (v0 loss anatomy).
2. **REPAIR** (imbalanced): price = `min(gateCap, X)`, capped below
   bestAsk as in v1. When the other side trades above X this RESTS AT X,
   waiting for the oscillation across the strike — the capture mechanism
   of the family. When the other side is already ≤ X it joins/improves as
   v1 does.
3. **Joint gate demoted to a design constant**: `PAIR_BUDGET = 0.98`
   backstop (same formula as v1's maxPairCost). Under the ceiling it is
   non-binding for X ≤ 0.45 (pair ≤ 2X ≤ 0.90 < 0.98) — exposing it would
   be a dead param, and guard 2 says prefer simpler. `maxEntryPrice` (X)
   takes its schema slot; all other params/defaults are v1's.

Known duty-cycle confounder (pre-committed, NOT tuned this sweep): the
repair rest expires every ttlSec=90 s and waits cooldownTicks=25 before
re-placing, so the book is not covered 100% of the time; a crossing during
a gap is missed. If the family kills, this bounds how far the kill
generalizes within the axis (a persistent-rest variant remains untested
unless the identity terms already rule it out — see verdicts).

## Pre-registered experiment (written BEFORE strategy code)

- **Grid**: X ∈ {0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45} — 7 configs,
  everything else family defaults (inc 10, cap $50, ttl 90, imbalance 20,
  cooldown 25). Whole grid submitted up front (inbox c841c329).
- **Universe**: the pinned parents' screen window — `--from-ms
  1784043000000 --to-ms 1784762100000` (slugs 1784043000 → 1784762100,
  exactly the 800-market universe of runs 872/873/879 and the s4/s6
  bookscan archives; toMs verified inclusive,
  src/db/telonexMarkets.ts:429). Identical 800 denominator ⇒ direct
  ev-per-market comparability, no intersection caveats.
- **Latency**: 140/20 ms flag-pinned (run-backtest.ts defaults).
- **Readouts**: results.ts headline (evPerMarketTotal over ALL 800,
  profitPer100, played count); compare.ts vs 872 (v1-a) and 879 (v1-d);
  anatomy.ts identity terms per X — paired shares & pairsPnl
  (completions·g), residue shares & residue pnl (stranded·L_s), realized
  L_s, dooms/starts, per-day pnl (9 days).

## Pre-registered priors (honest)

Break-even doom rate d* = g/(g + L_s) with both legs at X: X=0.45 ⇒
g≥0.10, d*≈18%; X=0.35 ⇒ g≥0.30, d*≈46%; X=0.25 ⇒ g≥0.50, d*≈67%;
X=0.15 ⇒ g≥0.70, d*≈82%. The v1 family's doom-per-start was 20–29% at
joint gates — but those completions did not require an oscillation across
the strike. Two worlds: (i) BTC 15m windows oscillate enough that both
sides trade ≤ X often enough — completions at g ≥ 0.30 carry the rare
stranded X-bounded losses, EV > 0 somewhere on the mid-grid; (ii) a side
at ≤ X is cheap because it is LOSING (every worst-queue fill is a
trade-through on a falling side), the market rarely comes back across, d
≫ d*, and bounded-but-frequent stranding at ~X·(1−winRate) beats the rare
completions. E-017's stranded-side win rate of 2.2% (taker-lead entries
at low prices) is prior evidence for world (ii); E-018's finding that
deep fills are informed points the same way. Frequency: entries need
bestBid ≤ X at a balanced moment — X=0.15 will fire rarely and late in
the window (a side at 0.15 with 10 min left is a market verdict, not an
oscillation candidate). The sweep measures all of it.

## Pre-registered verdicts

- **PROMOTE to S2**: some X with evPerMarketTotal ≥ +$0.25 (800
  denominator) AND positive on ≥6 of the 9 window days → next session
  runs S2 FULL + S3 upward latency sweep on that X.
- **ITERATE**: some X with 2×SE(800) < ev < $0.25 (M3 noise bar) → explore
  the neighborhood (finer X, and the duty-cycle/persistence knob).
- **WEAK**: best X in (0, 2×SE] — record for stacking; no promotion.
- **KILL the family** (time-scoped 2026-07, this universe): ev < 0 at
  every X on the grid. Per §Kill standards this kills the one-rest
  implementation of axis 1, NOT the axis: the kill extends to
  persistent-rest variants ONLY if the identity terms show it — i.e.
  realized dooms/starts ≥ d* by a margin that a plausible ≤100%→100%
  duty-cycle improvement in completion capture cannot close (compute and
  record the required capture multiple per X either way).
- Confounders pre-committed: (a) played-markets count per X reported — a
  variant firing in <5% of markets cannot carry goal 1 alone regardless
  of sign; (b) per-day breakdown per X; (c) duty-cycle gap above; (d)
  worst-queue understates maker fill rate AND quality (guard 6 — safe
  direction for a kill, never grounds for promotion).

design-ts: (commit sha of this pre-registration; filled on commit)
