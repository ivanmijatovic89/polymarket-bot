# Family: pair-v3 (contested-start selection) — Phase 0: data validation

Axis switch per pair-v1.md §Gate-curve: HOW to complete pairs is exhausted
(per-dollar loss ~−8/$100 is invariant to entries/repair/gate). The new axis
is WHEN to start: select market states, not mechanics. Phase 0 validates the
signal from data BEFORE any strategy code exists (STATUS session-3 plan).

## Pre-registered hypothesis (written BEFORE running the analysis)

**Hypothesis**: dooms concentrate in windows/moments where the market has
already "decided" — spot has run away from priceToBeat — while contested
moments (spot near priceToBeat, low short-term drift) complete pairs.
Mechanism: once one side is winning, its book bids rich and the losing side's
book empties; a start filled there is adversely selected and its completion
leg never fills at gate-compatible prices (the 80% repair rate vs ~94%
break-even from pair-v1.md §Anatomy).

**Dataset**: run 872 (v1-a, latest-800 screen @140/20) per-start records —
every 'S' fill (ts from intent_meta), labeled doomed = it is the LAST 'S'
fill of a market that ended imbalanced (residue qty median = p90 = 10 ⇒ the
last unrepaired start IS the doomed increment). Features at fill time, from
the same data the live feeds would serve: `distBps` = |binanceSpot(asof ts) −
priceToBeat| / priceToBeat × 1e4 (aggTrades day files, as-of lookup) and
`drift60Bps` = |spot(ts) − spot(ts−60s)| / ptb × 1e4. Replication: run 873.

**Known bias, one-sided**: features are measured at FILL time, but a v3 gate
would evaluate at QUOTE time (earlier, less information — fills happen
preferentially after adverse moves). So this analysis OVERSTATES the
achievable separation. Failing here kills the hypothesis a fortiori; passing
here still requires the v3 screen to confirm at quote time.

**Economics frame (from 872's own anatomy)**: blocking a start avoids the
doom loss L (≈ $4.43/doomed market) at the cost of the pair gain g (≈
$0.28/completed increment) — a kept region is profitable per-start iff its
doom rate d < g/(g+L) ≈ 6%. Overall per-start doom rate is ~20% (345 dooms /
1714 starts). The exact g, L, break-even are recomputed from the run in the
tool, not assumed.

**Pre-registered verdicts** (tool: `tools/contested.ts`, run before results
were seen):

- **BUILD v3**: some decision-time-computable region (dist and/or drift
  threshold) keeps ≥ 20% of starts at doom rate ≤ 8% (near break-even given
  the one-sided bias), i.e. kept-region per-start EV ≈ ≥ 0.
- **WEAK / iterate the feature**: best region halves the doom rate (≤ 10%)
  with ≥ 10% of starts kept, but stays clearly above break-even — signal
  exists, this feature alone is insufficient; look for a sharper state
  variable before writing strategy code.
- **KILL the axis**: no region with ≥ 10% of starts kept gets doom rate
  below 10% (half of base) — given the fill-time information advantage,
  quote-time separation would be even weaker; do not build pair-v3 on
  spot-vs-ptb state.

Confounder checks pre-committed: (a) minute-0 starts are 555/1714 and their
dist is mechanically small (ptb is the window-open Chainlink price; note ptb
is only VISIBLE from ~2.7s after start — a v3 gate must hold starts ~3s) —
report minute-0 as its own stratum; a gate that only works after minute 0
must still clear the economics on the post-minute-0 stratum alone. (b) dist
grows with minute-of-window while doom hazard is FLAT by minute (pair-v1.md
§Anatomy) — a mild prior AGAINST the level feature; drift60 is the
minute-neutral variant. (c) completed-pair margin g may itself be lower in
contested regions (efficient pricing, pair-v2 lesson) — report kept-region
pairsPnl per increment, not just doom rate.

## Phase 0 results (2026-07-31, session 3) — VERDICT: KILL the axis

Tool: `tools/contested.ts` (per-start features from aggTrades day files +
`telonex_markets.price_to_beat`; 796/800 markets have ptb, 0 starts lacked
spot). All numbers from this session's tool runs.

**Run 872 (primary, 1709 starts, 343 dooms = 20.1%, break-even 6.0%)**:
per-start doom rate is FLAT across the whole feature range — distBps buckets
[2,4)/[4,8)/[8,16)/[16,32) = 20.8/19.8/19.4/26.0%; drift60Bps buckets
17.1–27.5% with no usable ordering. Threshold sweep: NO distBps threshold
gets kept-region doom rate below 19.4% (T=12, 88.6% kept); tight thresholds
are WORSE (T=2: 30.0%). Same for drift60 (best 19.6% at D=8). Joint
(dist≤8 × drift60≤8) quadrant "near+calm" = 19.9% vs base 20.1% — nothing.
The pre-registered KILL criterion (no region ≥10% kept at rate ≤10%) is met
by an enormous margin: no region of ANY size reaches even 17%.

**Last-start-only view (`--last-only`, 702 last starts, 48.9% doom)**: the
structural objection that only a market's last start can doom is closed —
conditional on being last, doom rate is still flat (44.8–55.4% across all
populated dist/drift buckets). State at start time does not predict which
last starts die.

**Replication run 873 (1163 starts, 27.5% doom, break-even 12.7%)**: same
flatness (dist buckets 21.1–35.4% with no monotone structure, drift buckets
22.5–29.9%). Kill replicates at the second gate level.

**Market-level INVERSION (confounder check c, run 872)**: dist@60s quartiles
give doom rates Q1(most contested) 61.1% → Q4(most decided) 38.1%, while
pair margin is flat (+0.27..0.29/inc). Contested windows doom MORE at market
level — they simply host more starts, each carrying the same ~20% hazard,
and v1's start gate already skips decided books (Q4 plays fewer starts).
The hypothesis is not just unsupported; its market-level correlation has the
OPPOSITE sign of the mechanism story.

**Interpretation (mechanism)**: dooms are caused by runaways that happen
AFTER the start, and the market is efficient enough that neither the level
(|spot−ptb|) nor the velocity (60s drift) at start time carries information
about them — consistent with flat doom hazard by minute (pair-v1.md
§Anatomy) and gate-invariant doom rate (~50% of played markets). Doom is
best modeled as an unpredictable per-market terminal event, not a
state-conditional one. Given the one-sided fill-time bias, the quote-time
version of any such gate would be even weaker.

**Consequences**: pair-v3 (contested-start gate) is KILLED before any
strategy code was written (guard 2 working as intended — the param slot was
never granted). Doom-rate PREDICTION is a dead axis alongside repair
mechanics (pair-v2) and gate level (v1 curve). The remaining levers are
arithmetic, not predictive — see pair-v1.md §Cadence model: raise starts per
market (S) at high pair margin, since increment size provably cancels and q
is unpredictable. [runs 872/873 reanalyzed | tools/contested.ts | 2026-07-31]
