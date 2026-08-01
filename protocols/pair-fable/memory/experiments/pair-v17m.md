# pair-v17m — maker-only tilt acquisition (E-044)

Directional controller (mission priority 2). Registered session 28,
BEFORE any v17m code exists (design-ts = the commit adding this file;
M2). Motivated by the E-042 anatomy (pair-v17.md §7): the
spot-vs-strike leader signal is genuinely predictive — tilted residue
wins 88–90% of markets at bps 10–20 vs a 30% neutral base rate — but
the current acquisition machinery (doom-backstop and C-lock FOK fills
chasing the signed target at the ask) spends MORE than the residue
earns (g1: +163k residue vs g0, −161k extra pairs cost, +11k extra
fees). The lever is the cost of buying the tilt, not the signal.

## 1. Mechanism (falsifiable)

Hypothesis: acquiring the tilt exclusively through resting maker
quotes — never through taker FOKs — retains most of the residue's
predictive value while removing the taker/doom acquisition premium,
moving the tilt's NET absolute ev above neutral.

Registered counter-hypothesis (E-018 prior, the honest kill path):
worst-queue maker BUYs on the leader side fill predominantly when
price moves AGAINST the leader (adverse selection). If the fills the
maker tilt actually receives are concentrated in leader-flip markets,
residue win% collapses toward ~50% and the mechanism is dead — the
measured residue win% per cell is the decisive mechanism metric, not
just ev.

## 2. Exact delta over pair.v17.ts (one substitution + one schema drop)

pair.v17m.ts = pair.v17.ts with the FOK completion deficit changed:

- v17: `tiltDef = unitCost ≤ tiltUnitMax ? T[side] : 0`;
  `deficit = qty[o] − qty[side] + tiltDef` — the taker path both
  CHASES positive tilt (buys the leader at the ask toward T) and
  respects held tilt on the laggard.
- v17m: `tiltDef = min(T[side], 0)`; same deficit formula. The taker
  path NEVER buys the tilt component (no leader chasing — positive T
  contributes 0), but still RESPECTS held tilt (negative T on the
  laggard keeps C/D completion from pairing the tilt away), and doom
  salvage of a collapsing tilt still fires (on a leader flip T
  changes sign, the ex-laggard's tiltDef becomes 0, doom completes
  the full raw imbalance — loss mitigation preserved).
- `tiltUnitMax` is REMOVED from the schema (it only gated the
  positive tilt component of FOKs, which no longer exists; E-041
  CEIL-NULL closed its lever on the taker path).

Everything else — maker band guard on signed error (the ONLY tilt
acquisition path now: the leader side may maker-accumulate up to
T + Ib while the laggard stops at −T + Ib), graded lag pricing on the
target-relative deficit, VWAP ceiling + RAW reservation, grid,
cooldowns, TTL, doom, end-of-window, fill tags, feeds — byte-identical
to pair.v17.ts. Meta/cid tag `pf17m`.

**τ = 0 identity:** T ≡ 0 ⇒ tiltDef ≡ 0 in both files ⇒ v17m τ0 is
behavior-identical to v17 τ0 (= v15.4 neutral). No neutral control
cell needed; the code-identity argument substitutes.

## 3. Non-equivalence vs prior kills

- E-018 (deep-book maker δ-grid KILL) killed UNCONDITIONAL maker
  unpaired inventory. v17m's maker tilt is CONDITIONED on the feed
  leader (spot beyond strike by ≥ θ) — a state E-018 never
  conditioned on; the 88–90% residue win base rate measured in E-042
  is direct evidence the conditioned inventory is not the E-018
  population. The dose–response and win% read give the honest answer.
- E-026 (averaging-down KILL): trigger was own-inventory drift, not
  an external resolution-relevant signal; no equivalence.
- E-038/E-041: taker-acquired tilt is ~fair-priced net (TILT-EV-NULL
  at FULL); v17m changes the acquisition price, the exact term those
  experiments left as the binding cost.

## 4. E-044 grid (FROZEN before code)

Instrument, pin, latency, center = E-042 (pair-v17.md §5): FULL
universe to-ms 1785196800000, 140/20, B = 500, q100 I160 P*.96
doom.99 cool5 ttl90 persist0, τ = +160. Reuse B_full = 0.74.
References: g0 = 1008 (neutral), g1 = 1011 (taker tilt bps 10),
g3 = 1009 (taker tilt bps 40).

| # | spotLeadBps | batch label | vs (named) | question |
|---|---|---|---|---|
| m10 | 10 | pf-e044-m10 | g1, g0 | maker acquisition at the tight, most-predictive threshold (win% 88) |
| m40 | 40 | pf-e044-m40 | g3, g0 | maker acquisition at the ev-best threshold |

Stage: protocol:check + local `--sequential` smoke (5 mkts) + local
activation check (τ0 vs τ160 on identical markets must differ in
maker placement; τ160 D/C-fill counts must NOT exceed the τ0 run's —
the taker path may not chase tilt) BEFORE submission; then straight
to FULL (feed plumbing and worker fulfillment already proven for the
v17 family, runs 1001/1002/1006; params-only otherwise).

**Frozen metrics.** Per cell: ev (governs), p/100, invested, resid-mkt
count, residue win%, residue PnL, pairs PnL, D-fill count/$, S/R fill
counts, fees. Integrity: failures = the identical 96-slug outage set
only; pairwise common = 10,651 vs all E-042 cells.

**Frozen bars (B_full = 0.74).**

- **MAKERTILT-BETTER** iff ev(m10) − ev(g1) > 0.74 (and analogously
  m40 vs g3, reported per pair) ⇒ acquisition cost was the binding
  term; iterate (dose, persistence, size-of-tilt next).
- **TILT-EV-REAL (the program's first ev-positive tilt)** iff any m
  cell − ev(g0) > 0.74 ⇒ record as the directional program's first
  absolute-ev confirmation at FULL.
- **MAKERTILT-DEAD** iff both m cells are within ±0.74 of g0 AND
  residue win% ≤ 60% (adverse selection ate the signal — E-018 prior
  confirmed for feed-conditioned inventory) ⇒ maker-acquisition axis
  closed; tilt program continues only via E-043's dose result.
- **MAKERTILT-NULL** otherwise (e.g. win% holds ≥ 70% but ev flat —
  fills too few to matter; report maker-tilt fill counts and record
  as capacity-bound).

## 5. Integrity evidence (session 28, before submission)

- protocol:check PASS (typecheck + eslint).
- Smoke run 1012 (τ160, bps 10, center): PASS, 5/5, 0 failures,
  maker/taker 17/16.
- Activation check run 1013 (τ0, same 5 markets): maker placement
  differs materially per market (e.g. slug ...089800: m6/t0 vs
  m1/t2); τ160 taker count ≤ τ0 taker count on EVERY market
  (16 vs 24 total) — frozen §4 stage check PASS: the taker path does
  not chase tilt.

Decision mapping: BETTER/REAL ⇒ iterate maker-tilt levers at FULL
(τ dose, leadPersistTicks, laggard-side quoting asymmetry).
DEAD ⇒ directional acquisition axes (taker E-038/E-041, maker E-044)
both closed at ev; the tilt program's remaining open lever is E-043's
width curve, then priority reverts per pair-v17.md §7 mapping.
NULL ⇒ one bounded follow-up allowed only if fill counts show a
concrete starvation mechanism (e.g. band guard blocks leader quotes);
otherwise treat as DEAD.

## §5 E-044 readout (s34, 2026-08-01; m10=1026, m40=1025)

Integrity: both rows 96 failures (100% priceToBeat, identical to 1008),
pairs n=10,651. Bar 0.74.

- **MAKERTILT-BETTER (narrow width only):** m10−g1 = **+1.243 ± 0.453**
  (maker-only tilt beats the taker version at bps10); m40−g3 = −0.334 ±
  0.213 (no effect at bps40).
- **TILT-EV-REAL: still NO.** m10−g0 = +0.462 ± 0.281; m40−g0 = +0.201 ±
  0.193 — no tilt cell has ever beaten NEUTRAL beyond the bar.
- **Mechanism (engagement is width-inverted in maker form):** m10 S-split
  moved 58/42 → 55/45 toward the winner (win-side S avg 0.558 — pays up on
  the leader side by design), residue 1,420 mkts at **74.4% win**
  (+17.6k residue pnl), R fills ≈ 0, D-spend $623k. m40 S-split = 57.9/42.1
  (baseline — NOT engaged; wide dead zone rarely tilts maker quotes),
  residue 357 mkts at 37.5%. Headline ev: m10 −13.05, m40 −13.31 (g0
  −13.51).
- Reading: the E-042 anatomy lever (acquisition cost) is confirmed — with
  taker chase removed, tilted residue keeps its predictive value (74% win)
  at near-zero extra cost, closing the g1-vs-g0 harm (−1.24 → +0.46 ns).
  What remains vs neutral is small and below the instrument bar at one
  FULL run. Frozen mapping ⇒ ITERATE at the ENGAGED cell (bps10): dose
  (tiltShares), persistence — E-046 design next session; combining with
  the P* 0.92 re-center (E-045) is the natural frame.

## 6. E-046 — maker-tilt dose + persistence at bps10 on the 0.92 center
## (FROZEN s35, 2026-08-01, BEFORE submission; params-only, no code change)

pair.v17m.ts verified UNTOUCHED since 18ce0a43 (git log empty this
session) — strategy-SHA identity holds vs runs 1025/1026, and the τ0 ≡
v17-τ0 code identity makes **1029** (v17 τ0 P*0.92, the standing FULL
neutral baseline) the k=0 reference; no re-run.

Hypothesis: at the ENGAGED width (bps10, the only cell where the maker
tilt measurably moved the S-split and residue win% held at 74.4%), the
tilt dose and a persistence filter are the two untested levers left on
acquisition. E-044's +0.46 ns vs neutral was measured at τ160/P*0.96;
the P*0.92 re-center roughly halves participation, so both the harm
term (false-flip pairs cost) and the gain term (residue) rescale —
dose–response at the new center is the decisive read.

Registered risk (honest kill path): the 0.92 cap may STARVE maker-tilt
acquisition (fewer quotes live ⇒ tilt never builds). Engagement metrics
below distinguish starvation from a true ev null.

**Grid (4 cells, FULL universe --to-ms 1785196800000, 140/20, B=500).**
Center params EXPLICIT in every literal (schema defaults ≠ center):
ttlSec=90 lagAggr=0 orderSize=100 pairTarget=0.92 doomUnitMax=0.99
spotLeadBps=10 capPerMarket=500 cooldownTicks=5 imbalanceBand=160.

| # | tiltShares | leadPersistTicks | label | question |
|---|---|---|---|---|
| t40 | 40 | 0 | pf-e046-t40 | low dose: does a small tilt keep residue win% with less false-flip cost? |
| t80 | 80 | 0 | pf-e046-t80 | mid dose |
| t160 | 160 | 0 | pf-e046-t160 | E-044 m10 re-centered at P*0.92 (direct anchor) |
| t160p | 160 | 1000 | pf-e046-t160p | persistence filter ≈7 s of sustained lead on active markets (~138 ticks/s; longer wall-time on quiet books) |

Stage: straight to FULL — params-only within schema bounds
(tiltShares ≤ imbalanceBand=160 OK; leadPersistTicks 1000 ≤ 20000 OK)
on a strategy already proven at FULL (1025/1026, feeds fulfilled).

**Frozen metrics per cell:** ev (governs), p/100, invested/played,
S-split engagement (verified JSON_TABLE query, §S of STATUS guards),
residue mkt count + win% + residue pnl, D-fill count/$, S/R/C fill
counts, fees, noActivity. Integrity: failures must be the identical
96-slug priceToBeat set; pairwise common vs 1029 = 10,651.

**Frozen bars (B_full = 0.74; all paired per-market on the common
intersection vs 1029 unless named otherwise).**

- **TILT-EV-REAL-92** iff any cell − 1029 > +0.74 ⇒ the program's
  first ev-positive tilt at FULL. Decision: hold until E-045b settles
  the center, re-verify the winning cell at the final center if it
  moves, then iterate (laggard-side quoting asymmetry, size-of-tilt
  vs orderSize split).
- **TILT-HARMS-92** iff any cell − 1029 < −0.74 ⇒ report dose pattern;
  if harm grows with dose, acquisition cost returns at the tight cap.
- **DOSE-MONO / DOSE-PEAK / DOSE-FLAT** across t40/t80/t160 deltas
  vs 1029 (pattern read, each leg judged against 0.74).
- **PERSIST-HELPS / HURTS / FLAT**: t160p − t160 vs ±0.74 (paired).
- **ALL-NULL + ENGAGED** (all four within ±0.74 of 1029, S-split
  moved ≥ ~2 pts toward the winner and residue-mkt count is material
  — expectation ≈ 1,420 × (played@0.92 / played@0.96), i.e. roughly
  55–60% of the 0.96 count per E-045's participation drop) ⇒ the
  maker-tilt dose/persistence axes at bps10 are CLOSED at ev on this
  center. With E-038/E-041/E-043 (taker/width) and E-044/E-046
  (maker) all measured, the directional acquisition program is closed
  under the frozen bars pending a NEW signal-quality lever (different
  conditioning), which requires new evidence per mission §3.
- **ENGAGEMENT-STARVED** (residue count ≪ expectation or S-split
  unmoved in ALL cells) ⇒ the 0.92 cap starves tilt acquisition;
  record the mechanism (quote counts on leader side); one bounded
  follow-up allowed only with a concrete starvation mechanism shown
  (per §5's NULL rule).

**Secondary (context, not a verdict bar):** t160 vs 1026 paired —
measures the P* re-center effect ON the tilted config; expectation
≈ +5.4 if tilt and P* compose additively (E-045's p92−g0). A large
shortfall flags an interaction between the cap and tilt acquisition.

**Submit literals (whole grid up front):**

```
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17m --param ttlSec=90 --param lagAggr=0 --param orderSize=100 --param pairTarget=0.92 --param tiltShares=40 --param doomUnitMax=0.99 --param spotLeadBps=10 --param capPerMarket=500 --param cooldownTicks=5 --param imbalanceBand=160 --param leadPersistTicks=0 --to-ms 1785196800000 --label pf-e046-t40 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17m --param ttlSec=90 --param lagAggr=0 --param orderSize=100 --param pairTarget=0.92 --param tiltShares=80 --param doomUnitMax=0.99 --param spotLeadBps=10 --param capPerMarket=500 --param cooldownTicks=5 --param imbalanceBand=160 --param leadPersistTicks=0 --to-ms 1785196800000 --label pf-e046-t80 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17m --param ttlSec=90 --param lagAggr=0 --param orderSize=100 --param pairTarget=0.92 --param tiltShares=160 --param doomUnitMax=0.99 --param spotLeadBps=10 --param capPerMarket=500 --param cooldownTicks=5 --param imbalanceBand=160 --param leadPersistTicks=0 --to-ms 1785196800000 --label pf-e046-t160 --detach
npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy pair-fable-v17m --param ttlSec=90 --param lagAggr=0 --param orderSize=100 --param pairTarget=0.92 --param tiltShares=160 --param doomUnitMax=0.99 --param spotLeadBps=10 --param capPerMarket=500 --param cooldownTicks=5 --param imbalanceBand=160 --param leadPersistTicks=1000 --to-ms 1785196800000 --label pf-e046-t160p --detach
```

Known cost of submitting behind the s34 grid: the 8 in-flight
aggregates land only at FULL queue drain, so these 4 runs push ALL 12
rows to ≈04:30–05:00Z. Accepted — total evidence throughput is higher
(inbox c841c329) and no session blocks on drain.

### Submission record (s35, 01:18–01:22Z, commitSha 8c287bc4)

**Amendment recorded at submission: t40 was accidentally submitted
TWICE** (the first invocation's batchUid line was filtered out of the
visible output, so it was re-run). No safe single-batch cancel exists
while 10 other batches share the queue, so both stay. Designation,
fixed here BEFORE any results: **primary t40 = the FIRST submission
(…011803-2irtuw); the second (…011853-xaiyd1) = `t40dup`, read ONLY as
a same-config duplicate pair** re-validating the FULL noise model
(E-041 precedent: dup |Δev| 0.21, sd 38.29). t40dup takes no part in
verdict bars.

| cell | batchUid |
|---|---|
| t40 (primary) | pf-e046-t40-20260801T011803-2irtuw |
| t40dup | pf-e046-t40-20260801T011853-xaiyd1 |
| t80 | pf-e046-t80-20260801T012053-gnmn1l |
| t160 | pf-e046-t160-20260801T012138-ozzx0m |
| t160p | pf-e046-t160p-20260801T012224-hyw1rz |

Queue verified 01:23Z: 13 aggregates waiting-children (8 s34 + these
5), ~126k market jobs remaining at ~620/min ⇒ full drain ≈04:45–05:00Z
— ALL 13 rows land together then.

## 7. E-046 engagement-baseline calibration on reference 1029
## (s37, 2026-08-01 ~01:47Z, PRE-READOUT; §6 bars unchanged — this pins their inputs)

Recorded before any of the 13 in-flight rows landed (queue verified 01:39Z,
drain ≈04:45Z). Two §6 bar inputs were still quoted from the OLD 0.96
center; measured now on 1029 with the §6-named verified query
(known-answer check on 1008 reproduced 57.85/42.15, lose avg 0.418, first):

- **Baseline S split on 1029 = 61.6 / 38.4 toward the eventual loser**
  (1,127,200 lose sh @ 0.383 vs 703,600 win sh @ 0.485; S net −69.4k,
  −3.79¢/sh). The "S-split moved ≥ ~2 pts toward the winner" clause in
  ALL-NULL+ENGAGED / ENGAGEMENT-STARVED is judged against **61.6/38.4**,
  NOT the 58/42 measured on 1008.
- **Residue-count expectation (frozen formula, now evaluated):** played =
  markets with ≥1 fill: 8,764 @0.92 vs 10,152 @0.96 ⇒ ratio 0.863 ⇒
  expectation ≈ 1,420 × 0.863 ≈ **1,226 residue markets**. The §6
  parenthetical guess ("roughly 55–60% of the 0.96 count") was WRONG as a
  guess; the frozen formula itself is what binds and now has its number.
  ENGAGEMENT-STARVED's "residue count ≪ expectation" reads against ~1,226.

**Mechanism context (sharpens interpretation, no bar change):** the P*0.92
re-center did NOT make the maker flow fairer — per-share S toxicity is
worse at 0.92 (−3.79 vs −3.23¢/sh) and the split more skewed (61.6 vs
57.85). The +5.44 ev gain came from doing LESS of the toxic activity
(1.83M vs 3.40M S shares) at cheaper prices, not from fairer fills. For
E-046 this slightly raises the prior that a correctly-signed tilt has MORE
skew to correct at this center, while the engagement-starvation risk
(fewer live quotes) remains the registered kill path.

## 8. E-046 readout (s39, 2026-08-01 ~05:10Z; t40=1033, t40dup=1037,
## t80=1036, t160=1035, t160p=1034)

Integrity: all rows 96 failures (100% priceToBeat, identical set);
every pair vs 1029 n=10,651. Bar B_full=0.74. Reference inputs from §7:
S split 61.6/38.4, residue expectation ≈1,226.

**Paired deltas vs 1029:** t40 +0.284 ± 0.208, t80 +0.529 ± 0.217,
t160 +0.695 ± 0.238, t160p +0.394 ± 0.238.

- **TILT-EV-REAL-92: NO.** No cell clears +0.74 (t160 closest, 2.9σ by
  its own SE but below the frozen bar — the same shape as E-044's m10
  +0.462: consistently positive, never bar-clearing).
- **DOSE-FLAT** formally (every adjacent leg ≪ 0.74: +0.245, +0.166)
  with a monotone-up trend; dose is already at the ceiling
  (tiltShares 160 = imbalanceBand).
- **PERSIST-FLAT:** t160p − t160 = −0.301 ± 0.235 (paired). The ~7s
  persistence filter does not help.
- **Engagement is REAL but HALF-STARVED — both §6 clauses fire:**
  S-split moved 61.6/38.4 → 59.0/41.0 at t160 (2.6 pts ≥ the 2-pt
  clause; t80 1.9, t40 0.4 — dose-monotone), residue win% held at
  73.8% (E-044's 74.4% anchor; residue pnl +2.0k→+4.4k→+10.5k with
  dose), BUT the residue population is 343/403/667/629 mkts vs the
  ≈1,226 expectation — t160 builds ~54% of the expected tilt, median
  residue qty 100 of the 160 target. The §6 registered risk (the 0.92
  cap starves maker-tilt acquisition) is confirmed at half-strength:
  the win-side S avg price rises 0.485 → 0.520 (quotes pay up) yet
  volume still can't build before the cap binds.
- **Secondary (additivity):** t160 − 1026 = +5.676 ± 0.287 ≈ the +5.4
  expectation — the P* re-center effect composes ~additively with
  tilt; no cap–tilt interaction anomaly.
- **t40dup noise check:** t40dup − t40 = −0.007 paired, per-market sd
  21.54 — same-config FULL noise re-validated (E-041 precedent 0.21);
  no verdict role.

**Decision (frozen §6 mapping):** the maker-tilt dose and persistence
axes at bps10 are **CLOSED at ev on this center** — with E-038/E-041
(taker), E-043 (width), E-044/E-046 (maker dose/persistence) all
measured, the directional acquisition program is closed under the
frozen bars pending a NEW conditioning lever (mission §3 evidence
rule). The starvation escape hatch (§6: one bounded follow-up with a
concrete mechanism) is recorded but NOT taken now: (1) the residue
that does build already wins 74% and nets +10.5k — the binding term is
pairs cost, not signal quality; un-starving means paying more for
acquisition, the exact E-042 failure; (2) the center itself is in
motion again (E-045b P*-CONT, E-049 composition in flight) and §6
holds any tilt re-verification until the center settles. Revisit only
after E-049 fixes the neutral operating point.
