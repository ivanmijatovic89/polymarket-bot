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

design-ts: 47fd391 (pre-registration commit, 2026-07-31 session 8)

## Result (E-019, session 9, 2026-07-31)

Runs 889–895 (batch uids in STATUS history / `backtest_runs.batch_uid
LIKE 'pf9-20260731%'`), all completed, 0 failures, 800/800 markets each,
140/20 ms, engine surface unchanged since last CLEAN capability refresh.

| X | run | ev/mkt | p/100 | starts | compl. | doom% | d* | gap | ḡ/mkt | L̄/mkt | capture× |
|------|-----|--------|--------|-----|-----|------|-----|--------|------|------|------|
| 0.15 | 891 | −0.031 | −4.71 | 303 | 50 | 83.8 | 82% | +1.8pp | 7.02 | 1.46 | **1.06** |
| 0.20 | 889 | −0.152 | −14.97 | 338 | 69 | 80.5 | 75% | +5.5pp | 6.05 | 1.95 | 1.22 |
| 0.25 | 890 | −0.251 | −16.73 | 379 | 99 | 74.9 | 67% | +7.9pp | 5.10 | 2.44 | 1.27 |
| 0.30 | 892 | −0.284 | −12.22 | 439 | 155 | 67.2 | 57% | +10.2pp | 4.28 | 2.96 | 1.20 |
| 0.35 | 893 | −0.336 | −9.64 | 488 | 194 | 60.5 | 46% | +14.5pp | 3.98 | 3.44 | 1.19 |
| 0.40 | 894 | −0.483 | −8.88 | 554 | 256 | 55.1 | 33% | +22pp | 3.26 | 3.89 | 1.21 |
| 0.45 | 895 | −0.780 | −8.49 | 619 | 308 | 51.2 | 18% | +33pp | 2.51 | 4.25 | 1.30 |

(doom% = residue markets / played; d* = g/(g+L_s) with g=1−2X, L_s=X;
ḡ = pairsPnl/won-markets, L̄ = |residuePnl|/residue-markets; capture× =
(compl + |pnl|/(ḡ+L̄)) / compl — the completion multiple that reaches
breakeven converting dooms→completions, the pre-registered kill-scope
statistic.)

**Verdict: KILL (pre-registered bar — ev < 0 at every X), time-scoped
2026-07, this universe, ONE-REST implementation only.** Scope per the
frozen bar:

- **X ≥ 0.20: kill extends to persistent-rest variants.** Required
  capture multiples 1.19–1.30 vs a plausible duty-cycle gain of ~1.1
  (ttl 90s + ~10s cooldown+latency gap ⇒ ≈90% duty). The doom-vs-d* gap
  widens monotonically with X (+5.5pp → +33pp): buying expensive sides
  is worse in exact proportion to how much of L_s the ceiling gives back.
- **X = 0.15: kill does NOT extend.** ev −0.031 is inside noise (rough
  per-market SE ≈ 0.07 on 800), capture multiple 1.06 < the plausible
  duty-cycle gain alone. Two live openings: (a) near-100% duty
  (`cooldownTicks=0`, no new code), (b) X < 0.15 — the grid's best point
  sits on its lower boundary and every trend (ev, doom-gap, capture×)
  improves toward low X. E-021 pre-registered below covers both.
- Residue wins are 0 at every X (0/254 … 0/317) — but this is
  survivorship (recovering sides get repaired out of the residue set),
  NOT evidence that doomed sides never recover; recorded to prevent a
  future session mis-citing it as a salvage-EV proof.
- Confounder (a): played 303–619 of 800 (38–77%) — frequency is not the
  binding problem at any X.
- Daily profile at X=0.15 (compare 872/879/891): 3/9 days positive
  (parents 0/9 and 1/9); daily-pnl corr vs v1 parents −0.04 / −0.20 —
  the ceiling mechanism carries a genuinely different exposure, worth
  remembering for portfolio stacking if a positive low-X variant emerges.
- Fee drag is second-order: fees $5.43 (X=0.15) → $52.46 (X=0.45),
  0.2–0.8¢/mkt.

## E-021 pre-registration: low-X extension + duty-cycle test (session 9)

Written BEFORE any run is submitted; no new strategy code (pair.v9.ts
unchanged — `cooldownTicks` is already a param). Targets the two openings
the E-019 kill-scope left: the grid's best point on its lower boundary,
and the X=0.15 capture multiple (1.06) being inside the plausible
duty-cycle gain.

- **Grid** (5 configs, family defaults unless stated, same pinned
  800-market window, 140/20 ms):
  1. X=0.08   2. X=0.10   3. X=0.12   (pure low-X extension)
  4. X=0.12, cooldownTicks=0   5. X=0.15, cooldownTicks=0   (≈100% duty)
- **Readouts**: as E-019 (headline, anatomy identity terms, capture
  multiples, per-day; compare vs 891).
- **Priors (honest)**: d* rises toward low X (X=0.10 ⇒ 88.9%, X=0.08 ⇒
  91.3%) but the realized-doom-vs-d* gap shrank monotonically toward low
  X (+1.8pp at 0.15) — two worlds again: the gap keeps shrinking through
  zero (some X* < 0.15 is positive), or entries at very low X are pure
  verdict-confirmation (a side at 0.08 rarely oscillates back) and doom
  jumps above d*. Starts also thin out (303 played at 0.15, falling).
  cooldown-0 raises duty from ≈90% to ≈99%+ — mechanically worth ≈ the
  1.06 multiple at X=0.15 IF the missed crossings exist during gaps
  (unverified; that is the measurement).
- **Pre-registered verdicts** (same bars as E-019): PROMOTE any config
  ev ≥ +0.25 AND ≥6/9 days positive; ITERATE 2×SE < ev < 0.25; WEAK
  (0, 2×SE]; KILL if all ≤ 0 — and specifically: if config 5 (X=0.15,
  duty≈100%) stays ≤ 0, the duty-cycle carve-out of E-019 is CLOSED
  empirically and the one-rest+persistent ceiling family dies at every
  tested X; if configs 1–3 are all ≤ 0 with capture multiples > plausible
  gains, the low-X opening closes too, and axis 1 (absolute ceiling,
  maker-rest implementations) is done on this universe absent a new
  identity argument (§Kill standards).
- Confounders: (a) played count per config (thin-entry configs can't
  carry goal 1 alone); (b) X=0.08 sits 8 grid ticks from 0 — quoting at
  bestBid ≤ 0.08 may collide with the `price < GRID` floor rarely;
  reported if seen; (c) guard 6 worst-queue direction unchanged.

design-ts (E-021): this commit, session 9, before submission.
