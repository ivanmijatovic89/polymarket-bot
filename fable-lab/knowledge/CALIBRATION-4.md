# CAL-004 — the fixed-time plane decomposed by spread state (tight vs wide book)

_Registered session 49 (U57), DECISIONS D34. Method frozen in the
registration commit BEFORE any conditional outcome statistic is computed.
Data: the already-integrity-verified CAL-001 discovery log — zero new
replay compute for discovery. Analysis tool: `tools/calib4.ts` (one-shot)._

## Why this study exists (motivating evidence)

1. **Spread state is the LAST unscanned feature axis in the discovery
   log.** The log records exactly (bid, ask) per (market, side, offset).
   Derivable feature families and their status: price levels × time —
   scanned (CAL-001, null/E20); single-segment inter-offset moves —
   scanned (CAL-002, null/E21); two-segment sign paths — scanned
   (CAL-003, null/E22); cross-side sums — the books are exact mirrors
   (CAL-001 amendment #12), so the sum is degenerate and the dutch-book
   version died at EXP-002/E9; book depth/sizes — never recorded, not
   derivable. That leaves the spread `ask − bid` — the one recorded state
   variable no scan has conditioned on. After CAL-004, every feature the
   log can express has been either scanned or measured degenerate: the
   log is measurement-exhausted and EDGE-SPACE §4 can say so
   categorically instead of per-axis.
2. **The high-incidence regime is the only reserve-confirmable one, and
   spread-state cells live there.** The U45 reserve-confirmability
   envelope (EDGE-SPACE §4): mid-priced candidates at incidence ≲15-20%
   cannot be confirmed until the universe grows; high-incidence (≳50%)
   or extreme-price cells confirm down to ~1.5-1.9c TODAY. Session-49
   outcome-free incidence measurement (spread × ask-bucket counts on the
   log; no outcome touched): the tight state (spread ≤ 0.0105) covers
   **82-92% of samples uniformly across ALL 9 ask buckets and both
   sides** (pooled 85.4% of 104,776 samples). Tight cells are therefore
   the high-incidence family the envelope names — a scan whose plausible
   candidates have a live confirmation path today.
3. **CAL-001's null does not exclude a spread-confined edge.** By the law
   of total expectation, a cell deviation d decomposes as
   `d = frT·dT + (1−frT)·dW`. CAL-001's marginals bound only d; a
   tight-confined edge dT ≈ +1.5c with a canceling wide-state dW is not
   excluded arithmetically (it requires dW ≈ −8c-13c, implausible but
   unmeasured — and the lab's audited rule, D25/D31 lineage, is that
   plausibility-grade foreclosure of an open avenue is a defect class,
   not a conclusion). One cheap measurement closes it either way.

Dedupe (D5): no prior experiment or scan conditions on the spread.
EXP-002 (cross-side sum) tested a different quantity; EXP-006/007 used
spread as a maker QUOTING reference, never as a taker conditioning state.
Not a re-skin.

A-priori mechanism expectations (stated for honesty; this is an unsigned
closure scan, not a hypothesis-driven registration): for WIDE states, a
wide spread marks uncertainty or a stale/thin book — if anything the ask
should be stale-HIGH after moves (E21/E22 measured gross continuation),
i.e. buyer-adverse, so W-state deviations are expected ≤ 0 where powered.
For TIGHT states there is no mechanism story — a one-tick book is the
pinned, liquid, presumably efficient regime — and T-cells are expected to
track CAL-001's marginals. Expected outcome: NULL. The value of a null is
the categorical log-exhaustion statement in motivation 1.

## Data (frozen)

- Log: `fable-lab/logs/CAL-001-discovery-v3.log` — the completed CAL-001
  discovery run (8,516 markets < 2026-03-01; integrity battery green, see
  CALIBRATION.md Results). No new engine run for discovery. This is the
  FOURTH reuse of this log (CAL-001/002/003 precede it) — see
  Disclosures.
- Outcome join: `telonex_markets.result_id` by slug via
  `src/db/telonexMarkets.ts` (`'0'` → UP won, `'1'` → DOWN won),
  identical to calib.ts.
- Probe reserve (CONFIRMATION data, untouched by discovery): the 5,460
  eligible markets in [2026-03-01, holdout boundary 1777237200000), as
  reserved at CAL-001 registration.
- Holdout: untouched, locked, unaffected by this study.

## Instrument (derived, frozen)

From each market's `[diag-calib]` lines (same line grammar as calib.ts):

- Apply calib.ts's EXACT validity pipeline per (slug, asset, offset):
  first-occurrence dedupe, drift filter `ts < next offset` (NEXT_BOUND,
  900s after 850), ask band [0.02, 0.995] (out-of-band counted and
  dropped).
- Spread state of a valid sample, from the SAME line's bid and ask:
  `spread = ask − bid`; **T (tight)** iff `spread ≤ 0.0105`, else
  **W (wide)**. The threshold is one tick (0.01) at the venue's standard
  tick size plus a half-tick tolerance for 4-dp float artifacts — the
  same tick-derived construction as CAL-002's move buckets. The spread is
  observable at decision time on the live book (live/backtest parity
  holds); the two books are exact mirrors (amendment #12), so
  spread_UP = spread_DOWN at a shared moment and the state is
  side-invariant by construction (up to the two known mirror deviants).
- Entry: buy side S at `ask_S(offset)` from side S's valid line — the
  identical entry CAL-001 evaluates; outcome per result_id.

## Grid (k = 252 cells, frozen)

- OFFSETS (7): 30, 150, 300, 450, 600, 750, 850 (CAL-001's, unchanged).
- ASK BUCKETS (9): CAL-001's, unchanged.
- SIDES (2): buy-UP, buy-DOWN.
- SPREAD STATES (2): T, W as defined above.
- k = 7 × 9 × 2 × 2 = 252. Within each (side, offset, bucket), T and W
  PARTITION the corresponding CAL-001 cell: `nT + nW = n(CAL-001)` after
  identical filtering. The tool prints this decomposition (nT, nW,
  tightFrac) so dilution is visible per cell.

## Statistic and decision rule (frozen — identical formulas to CAL-001)

Per cell: `d = winRate − meanAsk`;
`fee = winRate · 0.0156 · min(meanAsk, 1−meanAsk) / meanAsk` (amendment
#4 share-denominated BUY fee); `net = d − fee`;
`se = sqrt(Σ a(1−a)) / n`; `z = d / se` (same convention as calib.ts).

- **CANDIDATE cell**: `net > 0` AND `z ≥ 3.75` (one-sided
  p = 0.023/252 ≈ 9.127e-5; tail(3.75) ≈ 8.84e-5 — the bar rounds UP so
  the realized level is conservative, per the CAL-003 audit precedent)
  AND minority-outcome count ≥ 30 (D13) AND `d > 0` in all three CAL-001
  sub-windows (→2025-12-31, 2026-01, 2026-02, UTC by slug epoch) — else
  demoted `subwindow-inconsistent`, not citable.
- **NEG-FLAG cell**: `z ≤ −3.75`; minority < 30 → annotated
  `underpowered-E14`, no motivating weight.
- **Anything else**: on-diagonal within power.
- **Dependence (binding wording):** T cells share ~82-92% of their
  samples with the corresponding CAL-001 cell — a T-cell result is NOT
  independent of E20 and must never be presented as a second
  confirmation of (or contradiction to) CAL-001; W is the complement.
  Cross-side reflections share mirrored book samples (amendments
  #12/#13) and are ONE piece of evidence. The W-state envelope note
  below governs citability of W candidates.

### Confirmation requirement (BINDING — the discovery table cannot be cited alone)

CAL-004 discovery runs on the SAME log whose marginal and conditional
tables are already published (E20/E21/E22), and the designer has seen all
of those (disclosure below). Discovery candidates are therefore
HYPOTHESIS-GENERATING ONLY. Before any citation under EDGE-SPACE §4 or
any EXP registration, a candidate cell must REPLICATE on the probe
reserve:

1. a new diag-calib instrument run over the reserve window
   [2026-03-01, boundary−1] (committed code, detached, integrity battery
   per D23), then
2. a one-shot `calib4.ts --expect-totals <lines>,<perSide>` read of the
   reserve log, judged at the SAME bar (`net > 0`, `z ≥ 3.75`,
   minority ≥ 30 — sub-window consistency dropped, CAL-002 amendment #1
   precedent) on the pre-named candidate cells only.

A candidate that fails reserve confirmation is dead (noise mined from a
reused log). Any experiment registered from a CONFIRMED candidate carries
`lineage_cells = 252`. The holdout stays locked regardless.

**W-state envelope note (U45, binding):** a W candidate in a mid-priced
bucket sits at measured incidence 8-18% — the U45 envelope says the
reserve cannot confirm such a cell at the few-cent level today. If one
appears, it is recorded as a PARKED idea with its power arithmetic
(IDEAS #10 precedent), NOT probed on the reserve — spending the reserve's
pristine status on a ~coin-flip test is forbidden by the same arithmetic
that parked IDEAS #10. T-state and extreme-price W-state candidates have
a live confirmation path and proceed per the rule above.

## Instrument validation gates (frozen; abort before reading the table)

On the real discovery log, calib4.ts must reproduce the published CAL-001
read EXACTLY (same parse pipeline, same log, same DB join — any mismatch
is parser/join drift and ABORTS before any new cell is printed; fix the
tool against the synthetic fixture, never against the real log):

1. **Line totals:** 104,776 well-formed sample lines, 52,388 per side
   (CAL-002 gate 1).
2. **Pipeline totals:** 100,404 valid observations across 8,133 markets;
   200 drift-discarded; 4,172 ask out-of-band; 8,133 markets emitting any
   line.
3. **Per-offset market coverage:** UP o30=8121 o150=8117 o300=8104
   o450=8070 o600=7772 o750=6235 o850=3774; DOWN o30=8121 o150=8117
   o300=8104 o450=8068 o600=7784 o750=6239 o850=3778.
4. **Outcome join:** 8,133/8,133 markets joined, 0 unresolved.
5. **Join-direction (per side):** the T/W-pooled cell (850s,
   [0.98,0.995]) must reproduce CAL-001's published values exactly at
   printed precision — UP winRate 0.9854 n=687; DOWN winRate 0.9778
   n=721 — and satisfy winRate > 0.9.
6. **E14 positive control (per side):** the T/W-pooled cell (850s,
   [0.90,0.98)) must reproduce z −1.02 n=520 (UP) and −0.59 n=516 (DOWN)
   at printed precision, and ABORT iff |z| ≥ 3.75. An EMPTY control on a
   real log ABORTS (CAL-002 amendment #3).

Gates 1-6 run on the discovery path. In reserve mode (`--expect-totals`),
gates 2-6's hard-coded discovery constants are replaced by: the passed
outcome-free battery totals (gate 1 analog), winRate > 0.9 on the pooled
join-direction cell with n ≥ 30, and |z| < 3.75 with non-empty control on
the pooled E14 cell — the CAL-002 reserve-mode semantics, frozen now so
no tool edit is ever needed after a table is seen. `--expect-totals` is
REFUSED on paths containing `CAL-001-discovery` (reserve mode can never
relax the discovery read).

## Coverage / conditioning (binding wording, amendment #11 logic)

Cells inherit CAL-001's per-offset attrition (750s → 0.8746,
850s → 0.5993 of sampled markets): every cell estimates its quantity
CONDITIONAL on a valid book event at-or-after its offset. Additionally,
each cell conditions on its spread state at the sampled moment. Any
verdict wording citing 750s/850s cells must state the coverage fraction;
no venue-level (in)efficiency claim is made for excluded quiet markets or
for the complementary spread state.

## Power (recorded at registration, from the outcome-free incidence
measurement — so "no candidates" is interpretable)

- T cells: nT ≈ 0.82-0.92 × the CAL-001 cell n → seT ≈ 1.04-1.10 × the
  CAL-001 cell se, and the bar in cents is
  `3.75 · seT ≈ (3.75/3.565) · 1.04-1.10 × [CAL-001's bar]` ≈ 1.10-1.16×
  CAL-001's published per-cell resolution. Concretely: the largest
  mid-range T cells (n ≈ 3,600) resolve |d| ≳ 3.2c; the best
  extreme-price T cells (850s tails, nT ≈ 600-630, meanAsk ≈ 0.987)
  resolve |d| ≳ 1.7c at fee ~0.02c. As with CAL-001, mid-range nulls are
  power statements.
- W cells: nW ≈ 0.08-0.18 × the CAL-001 cell n → best mid-range W cells
  (nW ≈ 400-750) resolve only |d| ≳ 6-10c; extreme-price W cells (850s
  tails, nW ≈ 55-90) resolve |d| ≳ 4-6c. W nulls are power statements
  almost everywhere; the scan's W value is bounded to detecting GROSS
  dislocations (≥ several cents), which E21/E22 make plausible only as
  buyer-adverse.
- Reserve projection for a T candidate (confirmation feasibility): the
  reserve holds 5,460 markets ≈ 0.64 × discovery; a T cell projects
  nT(reserve) ≈ 0.55 × nT(discovery). A discovery T candidate at
  z ≥ 3.75 has point effect ≥ 3.75·seT(disc) and the reserve read at
  α = 0.023 on that cell has ≥ ~78% power at the discovery point
  estimate (se grows by 1/√0.55 ≈ 1.35×; 3.75/1.35 ≈ 2.78 > z_0.023 ≈
  2.0) — before winner's-curse shrinkage, which is why confirmation is
  binding rather than assumed.

## Disclosures

- **Fourth same-log reuse.** The designer has seen CAL-001's full
  marginal tables, CAL-002's move-conditional tables, and CAL-003's
  path-conditional tables (all published). Protection against mining:
  the frozen a-priori grid (the conditioner and threshold are
  tick-derived and were frozen before any spread×outcome statistic
  existed anywhere), Bonferroni at k = 252, and the BINDING reserve
  confirmation.
- **Pre-freeze incidence inspection (outcome-free).** In session 49,
  before this freeze, the designer measured spread marginals on the log:
  spread × offset × side and spread × ask-bucket × side COUNTS
  (incidences quoted in Motivation 2 and Power). No outcome was joined;
  no win rate, deviation, or any spread×outcome statistic was computed.
  This is the same disclosure class as CAL-002's tick-derived buckets
  (there: no move statistic pre-freeze; here: incidence-only
  inspection, disclosed).
- The one-shot rule (amendment #5 logic) applies: calib4.ts runs ONCE on
  the discovery log; honor-system + git trail.
- calib4.ts is validated mechanically on a SYNTHETIC log fixture with
  hand-computable expected output (never on the real log) before the
  one-shot; the selftest is committed with the tool
  (`tools/calib4-selftest.ts`).
- No engine run, no DB write, no order of any kind in discovery; the
  reserve confirmation (if reached) is a standard detached local
  `--sequential` instrument run under D8 latency pinning.
- The two known mirror deviants (epochs 1764846000 off=850, 1771651800
  off=300) each contribute ≤1 sample per affected cell; any verdict
  wording citing an affected (offset) inherits that 1-market exposure.

## Amendments (pre-read, 2026-07-11 — audit-motivated, frozen before any read)

A fresh-context adversarial audit reviewed this registration and the tool
before the one-shot (verdict sound-with-findings; report verbatim in
`knowledge/AUDIT-2026-07-11-CAL-004-REG.md`). All findings acted on with
NO result read. The frozen sections above stay untouched; these
amendments govern where they conflict.

1. **(finding 1) The candidate proceed/park decision is now fully
   mechanical, computed only from the printed table.** The frozen
   W-state envelope note forked on an undefined "mid-priced vs
   extreme-price" boundary — the one post-table discretionary branch in
   the registration. Frozen replacement, strictly TIGHTENING the frozen
   rule (an amendment may never relax reserve protection):
   - (a) EVERY candidate cell (T or W) proceeds to reserve confirmation
     only if `z ≥ 4.49`; a candidate with `3.75 ≤ z < 4.49` is PARKED
     with its power arithmetic recorded (IDEAS #10 precedent).
     Derivation, frozen now: the one-sided 2.3% lower confidence bound
     of the discovery effect (`d − 1.995·se`) must itself clear the
     reserve's 50%-power minimum detectable effect
     (`1.995 · se · √(8,516/5,460)` = `1.995·se·1.249`), i.e.
     `d ≥ 1.995·(1 + 1.249)·se = 4.487·se`, rounded UP to 4.49. This
     removes the winner's-curse coin-flip the bare point estimate would
     invite.
   - (b) ADDITIONALLY, a W candidate with printed `meanAsk ∈ (0.10,
     0.90)` is PARKED regardless of z — this is the frozen envelope rule
     with its boundary now defined by a printed quantity (the mid-priced
     buckets are exactly those whose cell meanAsk falls strictly inside
     (0.10, 0.90)).
   Both tests use only `z`, `meanAsk`, `d`, `se` as printed. No analyst
   classification survives.
2. **(finding 2) Incidence scope correction.** The 82-92% tight-fraction
   range (and the 8-18% W range) are MARGINAL measurements (spread ×
   offset and spread × ask-bucket, each pooled over the other axis).
   Joint (offset × bucket) cells can deviate: the auditor's outcome-free
   joint measurement found tfr 0.692-0.723 at (850s, [0.90,0.98))
   (nW/n up to 0.31; seT multiplier up to ~1.20 there, not 1.04-1.10).
   Binding wording rule: any verdict or LESSONS sentence citing a cell's
   incidence or dilution must quote that cell's PRINTED tfr, not the
   marginal range.
3. **(finding 3) Reserve projection corrected.** `nT(reserve) ≈ 0.55 ×
   nT(discovery)` is not derivable; under stationary tight fraction the
   ratio is the market ratio 5,460/8,516 = 0.641 (the 0.55 applied the
   tight fraction twice). Power at the discovery point estimate is
   ≈ 84%, not 78% — an understatement, conservative direction, no
   decision flips. The amendment-1 criterion supersedes this projection
   for the proceed/park decision.
4. **(finding 4) Identity-gate precision note.** Gates 5/6 reproduce
   CAL-001's published gate values at PRINTED precision, not bit level:
   calib4.ts sums T then W sub-cells while calib.ts summed interleaved in
   log order, and FP addition is non-associative (measured harmless:
   ~1e-13 discrepancy, all four gate cells agree at printed precision).
   If a gate-5/6 abort ever fires, check summation order before
   suspecting the join.
5. **(finding 5) Threshold derivation rewording.** The 0.0105 tolerance
   is one standard tick (0.01) plus HALF OF THE FINE TICK (0.001) as FP
   tolerance — not "a half-tick" of the standard tick. The constant is
   unchanged and remains a-priori robust: any tolerance in (0.0001,
   0.0095) classifies standard-tick books identically, and spreads of
   exactly 0.0105 cannot occur at either tick size on 4-dp prices, so
   the selftest's FP edge cases are fixture-only by construction.

## Results

_(append-only below this line; nothing here until calib4.ts runs ONCE on
the discovery log)_
