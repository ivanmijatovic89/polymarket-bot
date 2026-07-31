# pair-v12 — averaging-down accumulation (ruling axis 4)

Ruling axis 4 (inbox 8758567d): "Size laddering / averaging down:
increment size is fixed everywhere. Test size as a function of price
cheapness, and multi-round accumulation on the same side." E-020b's
conclusion pointed the same way: on the v1 family the exploitable slack
is upstream of completion policy — "entry selection, size".

## Axis 4a (size as f(entry price) across starts) — answered from existing evidence, no runs

Sizing starts by cheapness is a convex REWEIGHTING of per-price-band
EV components: total EV = Σ_bands weight(band) × evPerShare(band), and a
ladder only moves weight between bands (it cannot change a band's
per-share EV in the sim — fills and subsequent policy per start are
size-linear until cap/imbalance bind). The bands are measured:

- E-019 (runs 891, 889, 890, 892–895): cumulative ev under entry ceiling
  X is strictly monotone DECLINING in X — −0.031 (0.15), −0.152 (0.20),
  −0.251 (0.25), −0.284 (0.30), −0.336 (0.35), −0.483 (0.40), −0.780
  (0.45). Every marginal band [X1,X2] on the grid therefore has negative
  incremental EV.
- The top band [0.45, 1): v1-a with no ceiling (run 872) sits at −1.50 ⇒
  incremental −0.72 < 0.
- The cheapest prefix itself is ≤ 0: −0.031 at X=0.15 (SE ≈ 0.07,
  noise-compatible with 0, not positive), and E-021 closed X ∈
  {0.08–0.12} at −0.02..−0.04 with zero duty-cycle gain.

No measured band has positive per-share EV ⇒ the best any reweighting
can reach is the best band's EV ≈ 0 from below, in the limit of moving
ALL weight there — which is E-021's measured degenerate outcome
($0.8–1.7 invested/market, ev → 0 only because activity vanishes).

**Scope + honesty**: this is a DEPRIORITIZATION on measured evidence,
not a class kill — the band decomposition is approximate (E-019's v9 is
a one-rest implementation, not v1; cross-config behavioral interactions
— duty cycle, cap consumption — are folded into the band estimates).
Reopen condition: any future measurement showing a price band with
per-share EV > 0 (at ≥ 2 SE) reopens 4a. Until then the fleet budget
goes to 4b, which no reanalysis can answer.

## E-026 pre-registration (session 13, BEFORE any strategy code) — pair-v12 averaging down (axis 4b)

**Claim to test**: when a start is stranded (sides imbalanced) and the
HELD side has fallen below its average cost, buying MORE of the held
side at the new lower price (maker, join bestBid) — lowering the held
average and thereby RAISING the deficit side's joint-gate repair cap —
converts enough strands into (larger-margin) completions to beat the
added doomed-side exposure. This is state-contingent NEW behavior, not a
reweighting: it changes the completion geometry after an adverse move.

Identity framing (per the ruling): avg-down attacks the completion term
(more completions, each with bigger g since the pair is assembled
cheaper) while deliberately RAISING stranded exposure (more shares on
the falling side when no reversion comes). Each avg-down fill is itself
a worst-queue maker fill and carries the E-014 per-start adverse
selection (≈ −0.06/share unpaired). Net sign unknown — that is the
experiment. E-025 calibrated the fill model as an acceptable capacity
bound, so maker-fill evidence here is no longer optimism-gapped.

**Strategy `pair-fable-v12`** (new file `strategies/pair.v12.ts`, exact
copy of pair.v1.ts except the unbalanced branch):

- Balanced book: identical to v1 (join-only starts, gate at join price,
  3-min start cutoff).
- Unbalanced (excess side H with qtyH > qtyD, held average avgH =
  costH/qtyH): if ALL of
  1. bestBid(H) ≤ avgH − `avgDownDiscount` (the trigger),
  2. qtyH + incrementSize − qtyD ≤ maxImbalance (existing guard),
  3. maxPairCost − newAvgH ≥ 0.01 where newAvgH = (costH +
     bestBid(H)·incrementSize)/(qtyH + incrementSize) (never average
     into an uncompletable book),
  4. capPerMarket allows the projected cost (existing guard),
  5. now ≤ windowEnd − 3 min (avg-down INCREASES exposure ⇒ it obeys
     the START cutoff, unlike deficit-repair which runs to the end),
  then place the increment on H joining bestBid(H) (maker, GTD ttl,
  capped below bestAsk, meta mode `'A'`). Otherwise: v1's repair on the
  deficit side at its gate cap, unchanged.
- One resting order at a time, cooldown, TTL — all v1 scaffolding
  unchanged. Avg-down has priority over repair on the tick where both
  are possible (frozen policy choice; the repair rest returns next
  cycle if the trigger lapses).
- New param `avgDownDiscount` (+1 to the family budget, guard 2: it IS
  the experiment's axis). `incrementSize` stays 10 (M5 bound 100 in
  schema, unchanged). Multi-round accumulation arises naturally: each
  further round needs a further δ fall below the NEW average;
  `maxImbalance` bounds the number of rounds (20 ⇒ 1 avg-down round
  beyond a stranded start, 40 ⇒ up to 3).

**Grid (5 runs, submitted together per inbox c841c329), pinned 800
(`--latest 800 --to-ms 1784762100000`) @ 140/20 ms, gate 0.98, cap 50:**

| # | avgDownDiscount | maxImbalance | role |
| --- | --- | --- | --- |
| 1 | 0.99 | 20 | regression gate: trigger can never fire ⇒ must ≡ run 872 |
| 2 | 0.05 | 20 | shallow trigger, single round |
| 3 | 0.10 | 20 | deep trigger, single round |
| 4 | 0.05 | 40 | shallow trigger, multi-round |
| 5 | 0.10 | 40 | deep trigger, multi-round |

Control/parent: run 872 (pair-v1-a, same universe+latency; screens
valid ≤ 2026-08-06 per evaluator.md §Universes).

**Frozen readouts**: results.ts headline (evPerMarketTotal over ALL 800
+ p/100 capital units), anatomy decomposition (pairsPnl, residue
markets, residue shares, residue cost — the L_s exposure —, completions,
doom%), avg-down fill count via meta m='A', CAP-BREACH integrity check
(standard since E-020; v12 has no taker path but the check is cheap),
daily corr vs 872 for independence bookkeeping.

**Frozen verdicts**:
- **INVALID** if config 1 deviates from run 872 by |Δev| > 0.01
  (family is near-deterministic per E-002) — code bug, fix before
  reading configs 2–5.
- **KILL** (time-scoped 2026-07, this universe, this grid, v1 base) if
  all of configs 2–5 have Δev vs 872 ≤ +0.05 — avg-down module dead or
  harmful; per §Kill standards this kills the family, not the class.
- **ITERATE** if any config has Δev ≥ +0.05 AND anatomy confirms the
  mechanism (completions up vs 872, or doom-residue cost profile shifted
  as designed) — then sweep gate 0.95 next (parent 873) before any
  S-gate claim.
- ev ≥ 0 on the screen remains the S-gate to further stages; not
  expected in one hop and NOT claimable from this grid alone.

**Confounders pre-committed**: (a) avg-down fills are worst-queue fills
— the −0.06/share E-014 invariant prices their adverse selection into
the result, which is exactly what we want measured; (b) one-rest
scaffolding means avg-down displaces the deficit repair while triggered
— completions could DROP from repair displacement even if the geometry
helps; anatomy's completion count arbitrates; (c) maxImbalance 40
doubles worst-case one-side exposure — capPerMarket $50 still binds
(≤ ~$25 typical); (d) the trigger uses average cost, so consecutive
rounds compound (each needs a further δ fall below the new average) —
intended; (e) same pinned screen universe as the family — regime drift
scoped as ever, per-day view available in segments.

design-ts (E-026): this commit, session 13 — before any strategy code.
