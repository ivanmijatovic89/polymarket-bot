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

### Discovery read (2026-07-11, one-shot on CAL-001-discovery-v3.log)

Tool: `tools/calib4.ts` at the audited pre-read commit (974c418); selftest
32/32 green at that commit.

**Invocation disclosure (one-shot integrity):** the first invocation was
piped through `head -30` for a progress glance and the pipe closure
SIGPIPE-killed the process mid-print — its output file truncated inside
the UP 450s rows. What was seen before the kill: the gate lines and the
UP-side rows through 450s (no flag on any of them); no rule, threshold,
or tool byte was touched afterwards (git shows no change between the two
invocations). The tool is deterministic on the same log + DB state, so
the immediate re-run (same command, output redirected to the file,
exit 0) is the COMPLETING invocation of the same read, not a second
read. Both invocations' outputs agree on every overlapping line. This is
disclosed rather than hidden because the one-shot rule is honor-system
(amendment #5 lineage).

**Full output verbatim (`logs/CAL-004-discovery-read.txt`, committed at
`knowledge/CAL-004-discovery-read.txt`):**

```
gate line-totals: OK (lines=104776, UP=52388, DOWN=52388)
parsed 100404 valid observations across 8133 markets (200 drift-discarded [ts past next offset], 4172 ask outside [0.02,0.995]; 8133 markets emitted any line)
per-offset market coverage UP: o30=8121 o150=8117 o300=8104 o450=8070 o600=7772 o750=6235 o850=3774
per-offset market coverage DOWN: o30=8121 o150=8117 o300=8104 o450=8068 o600=7784 o750=6239 o850=3778
outcome joined for 8133/8133 markets (0 missing/unresolved — excluded)
gates UP: join-direction OK (pooled 850s tail winRate=0.9854, n=687); E14 positive control OK (net=-0.0110 z=-1.02 n=520)
gates DOWN: join-direction OK (pooled 850s tail winRate=0.9778, n=721); E14 positive control OK (net=-0.0068 z=-0.59 n=516)

CAL-004 UP-side cell table (k=252 total, candidate bar z>=3.75, minority>=30, tight=spread<=0.0105, fee=winRate*0.0156*min(a,1-a)/a, sub-window consistency required)
off  askBucket     st      n    tfr  meanAsk winRate      d     fee     net      se      z  minor  flag
 30  [0.02,0.100)  T empty
 30  [0.02,0.100)  W empty
 30  [0.10,0.200)  T      6  0.750 0.1717  0.1667 -0.0050 0.0026 -0.0076 0.1538  -0.03      1  
 30  [0.10,0.200)  W      2        0.1800  0.5000 +0.3200 0.0078 +0.3122 0.2716 +  1.18      1  
 30  [0.20,0.350)  T    211  0.887 0.3075  0.2607 -0.0469 0.0041 -0.0509 0.0317  -1.48     55  
 30  [0.20,0.350)  W     27        0.3089  0.2222 -0.0867 0.0035 -0.0901 0.0887  -0.98      6  
 30  [0.35,0.500)  T   2757  0.869 0.4416  0.4353 -0.0063 0.0068 -0.0131 0.0094  -0.67   1200  
 30  [0.35,0.500)  W    416        0.4393  0.4471 +0.0078 0.0070 +0.0008 0.0243 +  0.32    186  
 30  [0.50,0.650)  T   3717  0.874 0.5515  0.5461 -0.0054 0.0069 -0.0123 0.0081  -0.66   1687  
 30  [0.50,0.650)  W    538        0.5567  0.5279 -0.0288 0.0066 -0.0354 0.0214  -1.35    254  
 30  [0.65,0.800)  T    344  0.798 0.6830  0.6919 +0.0089 0.0050 +0.0039 0.0250 +  0.36    106  
 30  [0.65,0.800)  W     87        0.6830  0.5977 -0.0853 0.0043 -0.0896 0.0498  -1.71     35  
 30  [0.80,0.900)  T     12  0.800 0.8192  0.8333 +0.0142 0.0029 +0.0113 0.1110 +  0.13      2  
 30  [0.80,0.900)  W      3        0.8367  0.6667 -0.1700 0.0020 -0.1720 0.2131  -0.80      1  
 30  [0.90,0.980)  T      1  1.000 0.9300  1.0000 +0.0700 0.0012 +0.0688 0.2551 +  0.27      0  
 30  [0.90,0.980)  W empty
 30  [0.98,0.995]  T empty
 30  [0.98,0.995]  W empty
150  [0.02,0.100)  T     13  0.867 0.0723  0.0769 +0.0046 0.0012 +0.0034 0.0717 +  0.06      1  
150  [0.02,0.100)  W      2        0.0900  0.0000 -0.0900 0.0000 -0.0900 0.2024  -0.44      0  
150  [0.10,0.200)  T    191  0.864 0.1602  0.1257 -0.0345 0.0020 -0.0365 0.0265  -1.30     24  
150  [0.10,0.200)  W     30        0.1480  0.1000 -0.0480 0.0016 -0.0496 0.0646  -0.74      3  
150  [0.20,0.350)  T   1093  0.880 0.2837  0.2690 -0.0147 0.0042 -0.0189 0.0136  -1.08    294  
150  [0.20,0.350)  W    149        0.2832  0.2483 -0.0348 0.0039 -0.0387 0.0367  -0.95     37  
150  [0.35,0.500)  T   1971  0.866 0.4231  0.4206 -0.0025 0.0066 -0.0090 0.0111  -0.22    829  
150  [0.35,0.500)  W    306        0.4258  0.3791 -0.0467 0.0059 -0.0526 0.0282  -1.66    116  
150  [0.50,0.650)  T   2154  0.864 0.5663  0.5585 -0.0078 0.0067 -0.0145 0.0106  -0.74    951  
150  [0.50,0.650)  W    340        0.5702  0.5853 +0.0151 0.0069 +0.0082 0.0267 +  0.56    141  
150  [0.65,0.800)  T   1335  0.857 0.7069  0.7041 -0.0028 0.0046 -0.0073 0.0124  -0.22    395  
150  [0.65,0.800)  W    222        0.7076  0.6802 -0.0274 0.0044 -0.0318 0.0304  -0.90     71  
150  [0.80,0.900)  T    231  0.816 0.8341  0.8398 +0.0058 0.0026 +0.0032 0.0244 +  0.24     37  
150  [0.80,0.900)  W     52        0.8315  0.8654 +0.0338 0.0027 +0.0311 0.0518 +  0.65      7  
150  [0.90,0.980)  T     25  0.893 0.9192  0.9600 +0.0408 0.0013 +0.0395 0.0543 +  0.75      1  
150  [0.90,0.980)  W      3        0.9233  1.0000 +0.0767 0.0013 +0.0754 0.1524 +  0.50      0  
150  [0.98,0.995]  T empty
150  [0.98,0.995]  W empty
300  [0.02,0.100)  T    161  0.904 0.0675  0.0311 -0.0364 0.0005 -0.0369 0.0197  -1.85      5  
300  [0.02,0.100)  W     17        0.0759  0.1176 +0.0418 0.0018 +0.0399 0.0641 +  0.65      2  
300  [0.10,0.200)  T    579  0.876 0.1487  0.1157 -0.0330 0.0018 -0.0348 0.0147  -2.24     67  
300  [0.10,0.200)  W     82        0.1515  0.1341 -0.0173 0.0021 -0.0194 0.0395  -0.44     11  
300  [0.20,0.350)  T   1262  0.866 0.2708  0.2591 -0.0117 0.0040 -0.0157 0.0124  -0.94    327  
300  [0.20,0.350)  W    196        0.2772  0.2551 -0.0221 0.0040 -0.0261 0.0318  -0.69     50  
300  [0.35,0.500)  T   1370  0.854 0.4189  0.4226 +0.0038 0.0066 -0.0028 0.0133 +  0.28    579  
300  [0.35,0.500)  W    235        0.4254  0.4468 +0.0214 0.0070 +0.0144 0.0321 +  0.66    105  
300  [0.50,0.650)  T   1323  0.852 0.5698  0.5480 -0.0219 0.0065 -0.0283 0.0136  -1.61    598  
300  [0.50,0.650)  W    230        0.5693  0.5565 -0.0127 0.0066 -0.0193 0.0325  -0.39    102  
300  [0.65,0.800)  T   1382  0.864 0.7170  0.7062 -0.0108 0.0043 -0.0152 0.0121  -0.90    406  
300  [0.65,0.800)  W    218        0.7185  0.7202 +0.0017 0.0044 -0.0027 0.0303 +  0.05     61  
300  [0.80,0.900)  T    642  0.848 0.8400  0.8629 +0.0229 0.0026 +0.0203 0.0144 +  1.59     88  
300  [0.80,0.900)  W    115        0.8447  0.8087 -0.0360 0.0023 -0.0383 0.0337  -1.07     22  
300  [0.90,0.980)  T    231  0.813 0.9245  0.9394 +0.0149 0.0012 +0.0137 0.0173 +  0.86     14  
300  [0.90,0.980)  W     53        0.9253  0.9623 +0.0370 0.0012 +0.0358 0.0360 +  1.03      2  
300  [0.98,0.995]  T      7  0.875 0.9857  1.0000 +0.0143 0.0002 +0.0141 0.0448 +  0.32      0  
300  [0.98,0.995]  W      1        0.9800  1.0000 +0.0200 0.0003 +0.0197 0.1400 +  0.14      0  
450  [0.02,0.100)  T    606  0.913 0.0593  0.0363 -0.0230 0.0006 -0.0236 0.0096  -2.41     22  
450  [0.02,0.100)  W     58        0.0681  0.0000 -0.0681 0.0000 -0.0681 0.0330  -2.06      0  
450  [0.10,0.200)  T    799  0.868 0.1431  0.1126 -0.0304 0.0018 -0.0322 0.0123  -2.46     90  
450  [0.10,0.200)  W    121        0.1471  0.1240 -0.0231 0.0019 -0.0251 0.0321  -0.72     15  
450  [0.20,0.350)  T   1098  0.856 0.2671  0.2732 +0.0061 0.0043 +0.0018 0.0133 +  0.46    300  
450  [0.20,0.350)  W    184        0.2684  0.2283 -0.0402 0.0036 -0.0437 0.0325  -1.24     42  
450  [0.35,0.500)  T    863  0.835 0.4186  0.4311 +0.0124 0.0067 +0.0057 0.0167 +  0.74    372  
450  [0.35,0.500)  W    171        0.4122  0.3743 -0.0379 0.0058 -0.0437 0.0375  -1.01     64  
450  [0.50,0.650)  T    871  0.834 0.5716  0.5706 -0.0010 0.0067 -0.0077 0.0167  -0.06    374  
450  [0.50,0.650)  W    173        0.5697  0.5260 -0.0436 0.0062 -0.0498 0.0375  -1.16     82  
450  [0.65,0.800)  T   1051  0.838 0.7214  0.6841 -0.0373 0.0041 -0.0415 0.0138  -2.71    332  
450  [0.65,0.800)  W    203        0.7289  0.7291 +0.0001 0.0042 -0.0041 0.0311 +  0.00     55  
450  [0.80,0.900)  T    836  0.862 0.8453  0.8600 +0.0147 0.0025 +0.0123 0.0125 +  1.18    117  
450  [0.80,0.900)  W    134        0.8392  0.8433 +0.0041 0.0025 +0.0016 0.0316 +  0.13     21  
450  [0.90,0.980)  T    698  0.889 0.9336  0.9398 +0.0063 0.0010 +0.0052 0.0094 +  0.67     42  
450  [0.90,0.980)  W     87        0.9318  0.9080 -0.0238 0.0010 -0.0248 0.0269  -0.88      8  
450  [0.98,0.995]  T    115  0.983 0.9835  0.9913 +0.0078 0.0003 +0.0075 0.0119 +  0.65      1  
450  [0.98,0.995]  W      2        0.9900  1.0000 +0.0100 0.0002 +0.0098 0.0704 +  0.14      0  
600  [0.02,0.100)  T   1167  0.910 0.0488  0.0377 -0.0111 0.0006 -0.0117 0.0063  -1.77     44  
600  [0.02,0.100)  W    115        0.0593  0.0348 -0.0245 0.0005 -0.0251 0.0219  -1.12      4  
600  [0.10,0.200)  T    691  0.826 0.1403  0.1317 -0.0086 0.0021 -0.0107 0.0132  -0.65     91  
600  [0.10,0.200)  W    146        0.1429  0.1301 -0.0128 0.0020 -0.0148 0.0289  -0.44     19  
600  [0.20,0.350)  T    747  0.815 0.2659  0.2597 -0.0061 0.0041 -0.0102 0.0161  -0.38    194  
600  [0.20,0.350)  W    170        0.2650  0.2176 -0.0474 0.0034 -0.0507 0.0337  -1.40     37  
600  [0.35,0.500)  T    607  0.840 0.4193  0.3970 -0.0222 0.0062 -0.0284 0.0199  -1.11    241  
600  [0.35,0.500)  W    116        0.4194  0.2845 -0.1349 0.0044 -0.1394 0.0457  -2.95     33  
600  [0.50,0.650)  T    578  0.834 0.5708  0.5536 -0.0172 0.0065 -0.0237 0.0205  -0.84    258  
600  [0.50,0.650)  W    115        0.5697  0.5565 -0.0131 0.0066 -0.0197 0.0460  -0.29     51  
600  [0.65,0.800)  T    732  0.828 0.7239  0.6940 -0.0299 0.0041 -0.0340 0.0164  -1.82    224  
600  [0.65,0.800)  W    152        0.7241  0.7237 -0.0005 0.0043 -0.0048 0.0361  -0.01     42  
600  [0.80,0.900)  T    672  0.833 0.8472  0.8586 +0.0115 0.0024 +0.0091 0.0138 +  0.83     95  
600  [0.80,0.900)  W    135        0.8508  0.8222 -0.0286 0.0022 -0.0308 0.0306  -0.94     24  
600  [0.90,0.980)  T   1007  0.888 0.9398  0.9355 -0.0044 0.0009 -0.0053 0.0075  -0.59     65  
600  [0.90,0.980)  W    127        0.9383  0.9449 +0.0065 0.0010 +0.0056 0.0213 +  0.31      7  
600  [0.98,0.995]  T    454  0.917 0.9855  0.9912 +0.0057 0.0002 +0.0055 0.0056 +  1.02      4  
600  [0.98,0.995]  W     41        0.9840  1.0000 +0.0160 0.0003 +0.0157 0.0196 +  0.82      0  
750  [0.02,0.100)  T   1291  0.879 0.0395  0.0333 -0.0062 0.0005 -0.0067 0.0054  -1.15     43  
750  [0.02,0.100)  W    177        0.0572  0.0508 -0.0063 0.0008 -0.0071 0.0174  -0.36      9  
750  [0.10,0.200)  T    436  0.770 0.1391  0.1422 +0.0031 0.0022 +0.0008 0.0165 +  0.18     62  
750  [0.10,0.200)  W    130        0.1451  0.1385 -0.0066 0.0022 -0.0088 0.0308  -0.21     18  
750  [0.20,0.350)  T    430  0.764 0.2626  0.2256 -0.0370 0.0035 -0.0405 0.0211  -1.75     97  
750  [0.20,0.350)  W    133        0.2669  0.1504 -0.1165 0.0023 -0.1189 0.0382  -3.05     20  
750  [0.35,0.500)  T    311  0.744 0.4189  0.3955 -0.0234 0.0062 -0.0295 0.0279  -0.84    123  
750  [0.35,0.500)  W    107        0.4179  0.3551 -0.0628 0.0055 -0.0683 0.0475  -1.32     38  
750  [0.50,0.650)  T    349  0.808 0.5726  0.5530 -0.0196 0.0064 -0.0260 0.0264  -0.74    156  
750  [0.50,0.650)  W     83        0.5795  0.5301 -0.0494 0.0060 -0.0554 0.0540  -0.91     39  
750  [0.65,0.800)  T    379  0.753 0.7156  0.6623 -0.0534 0.0041 -0.0575 0.0231  -2.31    128  
750  [0.65,0.800)  W    124        0.7205  0.7581 +0.0376 0.0046 +0.0330 0.0401 +  0.94     30  
750  [0.80,0.900)  T    382  0.793 0.8464  0.8298 -0.0165 0.0023 -0.0189 0.0184  -0.90     65  
750  [0.80,0.900)  W    100        0.8490  0.8100 -0.0390 0.0022 -0.0412 0.0357  -1.09     19  
750  [0.90,0.980)  T    723  0.829 0.9431  0.9350 -0.0081 0.0009 -0.0090 0.0086  -0.94     47  
750  [0.90,0.980)  W    149        0.9380  0.8926 -0.0454 0.0009 -0.0463 0.0197  -2.31     16  
750  [0.98,0.995]  T    875  0.940 0.9868  0.9897 +0.0029 0.0002 +0.0027 0.0039 +  0.76      9  
750  [0.98,0.995]  W     56        0.9864  1.0000 +0.0136 0.0002 +0.0134 0.0154 +  0.88      0  
850  [0.02,0.100)  T    893  0.822 0.0357  0.0336 -0.0022 0.0005 -0.0027 0.0062  -0.35     30  
850  [0.02,0.100)  W    193        0.0548  0.0466 -0.0081 0.0007 -0.0088 0.0163  -0.50      9  
850  [0.10,0.200)  T    196  0.636 0.1413  0.1276 -0.0137 0.0020 -0.0157 0.0248  -0.55     25  
850  [0.10,0.200)  W    112        0.1436  0.0804 -0.0632 0.0013 -0.0645 0.0330  -1.91      9  
850  [0.20,0.350)  T    180  0.619 0.2682  0.2278 -0.0404 0.0036 -0.0439 0.0329  -1.23     41  
850  [0.20,0.350)  W    111        0.2671  0.2342 -0.0329 0.0037 -0.0365 0.0418  -0.79     26  
850  [0.35,0.500)  T    125  0.592 0.4182  0.3840 -0.0342 0.0060 -0.0402 0.0439  -0.78     48  
850  [0.35,0.500)  W     86        0.4114  0.3023 -0.1091 0.0047 -0.1138 0.0529  -2.06     26  
850  [0.50,0.650)  T     96  0.513 0.5708  0.4896 -0.0813 0.0057 -0.0870 0.0503  -1.61     47  
850  [0.50,0.650)  W     91        0.5726  0.5495 -0.0232 0.0064 -0.0296 0.0517  -0.45     41  
850  [0.65,0.800)  T    144  0.585 0.7252  0.7361 +0.0109 0.0044 +0.0066 0.0370 +  0.29     38  
850  [0.65,0.800)  W    102        0.7205  0.7059 -0.0146 0.0043 -0.0189 0.0442  -0.33     30  
850  [0.80,0.900)  T    151  0.634 0.8467  0.8543 +0.0076 0.0024 +0.0052 0.0292 +  0.26     22  
850  [0.80,0.900)  W     87        0.8516  0.8276 -0.0240 0.0022 -0.0263 0.0380  -0.63     15  
850  [0.90,0.980)  T    376  0.723 0.9464  0.9309 -0.0156 0.0008 -0.0164 0.0116  -1.35     26  
850  [0.90,0.980)  W    144        0.9404  0.9444 +0.0040 0.0009 +0.0031 0.0196 +  0.21      8  
850  [0.98,0.995]  T    607  0.884 0.9870  0.9852 -0.0018 0.0002 -0.0020 0.0046  -0.39      9  
850  [0.98,0.995]  W     80        0.9851  0.9875 +0.0024 0.0002 +0.0021 0.0135 +  0.18      1  

CAL-004 DOWN-side cell table (k=252 total, candidate bar z>=3.75, minority>=30, tight=spread<=0.0105, fee=winRate*0.0156*min(a,1-a)/a, sub-window consistency required)
off  askBucket     st      n    tfr  meanAsk winRate      d     fee     net      se      z  minor  flag
 30  [0.02,0.100)  T      1  1.000 0.0800  0.0000 -0.0800 0.0000 -0.0800 0.2713  -0.29      0  
 30  [0.02,0.100)  W empty
 30  [0.10,0.200)  T      7  0.875 0.1800  0.2857 +0.1057 0.0045 +0.1013 0.1452 +  0.73      2  
 30  [0.10,0.200)  W      1        0.1600  1.0000 +0.8400 0.0156 +0.8244 0.3666 +  2.29      0  
 30  [0.20,0.350)  T    216  0.840 0.3065  0.2593 -0.0472 0.0040 -0.0513 0.0313  -1.51     56  
 30  [0.20,0.350)  W     41        0.3115  0.4146 +0.1032 0.0065 +0.0967 0.0721 +  1.43     17  
 30  [0.35,0.500)  T   3063  0.876 0.4420  0.4358 -0.0062 0.0068 -0.0130 0.0089  -0.69   1335  
 30  [0.35,0.500)  W    433        0.4377  0.4273 -0.0105 0.0067 -0.0171 0.0238  -0.44    185  
 30  [0.50,0.650)  T   3419  0.867 0.5507  0.5478 -0.0029 0.0070 -0.0099 0.0085  -0.34   1546  
 30  [0.50,0.650)  W    526        0.5555  0.5513 -0.0042 0.0069 -0.0111 0.0216  -0.19    236  
 30  [0.65,0.800)  T    335  0.829 0.6839  0.7194 +0.0355 0.0052 +0.0303 0.0253 +  1.40     94  
 30  [0.65,0.800)  W     69        0.6787  0.6812 +0.0025 0.0050 -0.0026 0.0561 +  0.04     22  
 30  [0.80,0.900)  T      7  0.700 0.8343  0.8571 +0.0229 0.0027 +0.0202 0.1404 +  0.16      1  
 30  [0.80,0.900)  W      3        0.8333  0.6667 -0.1667 0.0021 -0.1687 0.2150  -0.78      1  
 30  [0.90,0.980)  T empty
 30  [0.90,0.980)  W empty
 30  [0.98,0.995]  T empty
 30  [0.98,0.995]  W empty
150  [0.02,0.100)  T     10  0.909 0.0690  0.0000 -0.0690 0.0000 -0.0690 0.0800  -0.86      0  
150  [0.02,0.100)  W      1        0.0500  0.0000 -0.0500 0.0000 -0.0500 0.2179  -0.23      0  
150  [0.10,0.200)  T    175  0.845 0.1578  0.1429 -0.0150 0.0022 -0.0172 0.0275  -0.54     25  
150  [0.10,0.200)  W     32        0.1706  0.1250 -0.0456 0.0020 -0.0476 0.0664  -0.69      4  
150  [0.20,0.350)  T   1140  0.860 0.2847  0.2754 -0.0093 0.0043 -0.0136 0.0133  -0.70    314  
150  [0.20,0.350)  W    186        0.2880  0.2796 -0.0084 0.0044 -0.0127 0.0331  -0.25     52  
150  [0.35,0.500)  T   2096  0.864 0.4231  0.4208 -0.0023 0.0066 -0.0088 0.0107  -0.21    882  
150  [0.35,0.500)  W    331        0.4230  0.3958 -0.0272 0.0062 -0.0334 0.0271  -1.01    131  
150  [0.50,0.650)  T   2069  0.866 0.5667  0.5597 -0.0070 0.0067 -0.0137 0.0109  -0.64    911  
150  [0.50,0.650)  W    319        0.5677  0.5987 +0.0311 0.0071 +0.0240 0.0276 +  1.12    128  
150  [0.65,0.800)  T   1237  0.869 0.7080  0.7082 +0.0001 0.0046 -0.0044 0.0129 +  0.01    361  
150  [0.65,0.800)  W    187        0.7091  0.7005 -0.0086 0.0045 -0.0131 0.0331  -0.26     56  
150  [0.80,0.900)  T    255  0.873 0.8315  0.8588 +0.0273 0.0027 +0.0246 0.0234 +  1.17     36  
150  [0.80,0.900)  W     37        0.8376  0.8108 -0.0268 0.0025 -0.0292 0.0605  -0.44      7  
150  [0.90,0.980)  T     31  0.738 0.9174  0.9677 +0.0503 0.0014 +0.0490 0.0493 +  1.02      1  
150  [0.90,0.980)  W     11        0.9136  1.0000 +0.0864 0.0015 +0.0849 0.0846 +  1.02      0  
150  [0.98,0.995]  T empty
150  [0.98,0.995]  W empty
300  [0.02,0.100)  T    148  0.871 0.0703  0.0405 -0.0298 0.0006 -0.0304 0.0210  -1.42      6  
300  [0.02,0.100)  W     22        0.0755  0.0000 -0.0755 0.0000 -0.0755 0.0562  -1.34      0  
300  [0.10,0.200)  T    573  0.841 0.1501  0.1204 -0.0297 0.0019 -0.0316 0.0149  -2.00     69  
300  [0.10,0.200)  W    108        0.1445  0.1296 -0.0149 0.0020 -0.0169 0.0337  -0.44     14  
300  [0.20,0.350)  T   1363  0.869 0.2746  0.2685 -0.0061 0.0042 -0.0103 0.0120  -0.51    366  
300  [0.20,0.350)  W    205        0.2708  0.2585 -0.0123 0.0040 -0.0163 0.0309  -0.40     53  
300  [0.35,0.500)  T   1297  0.852 0.4184  0.4302 +0.0119 0.0067 +0.0052 0.0136 +  0.87    558  
300  [0.35,0.500)  W    226        0.4174  0.4027 -0.0148 0.0063 -0.0211 0.0327  -0.45     91  
300  [0.50,0.650)  T   1389  0.845 0.5701  0.5587 -0.0114 0.0066 -0.0180 0.0132  -0.86    613  
300  [0.50,0.650)  W    255        0.5684  0.5373 -0.0311 0.0064 -0.0375 0.0309  -1.01    118  
300  [0.65,0.800)  T   1275  0.861 0.7183  0.7231 +0.0049 0.0044 +0.0004 0.0125 +  0.39    353  
300  [0.65,0.800)  W    205        0.7207  0.7122 -0.0085 0.0043 -0.0128 0.0312  -0.27     59  
300  [0.80,0.900)  T    648  0.879 0.8394  0.8472 +0.0079 0.0025 +0.0053 0.0144 +  0.55     99  
300  [0.80,0.900)  W     89        0.8418  0.8315 -0.0103 0.0024 -0.0128 0.0386  -0.27     15  
300  [0.90,0.980)  T    255  0.870 0.9261  0.9608 +0.0347 0.0012 +0.0335 0.0163 +  2.13     10  
300  [0.90,0.980)  W     38        0.9247  0.9211 -0.0037 0.0012 -0.0049 0.0427  -0.09      3  
300  [0.98,0.995]  T      8  1.000 0.9850  1.0000 +0.0150 0.0002 +0.0148 0.0429 +  0.35      0  
300  [0.98,0.995]  W empty
450  [0.02,0.100)  T    616  0.926 0.0587  0.0471 -0.0116 0.0007 -0.0123 0.0094  -1.23     29  
450  [0.02,0.100)  W     49        0.0694  0.1020 +0.0327 0.0016 +0.0311 0.0362 +  0.90      5  
450  [0.10,0.200)  T    867  0.877 0.1441  0.1176 -0.0264 0.0018 -0.0283 0.0119  -2.22    102  
450  [0.10,0.200)  W    122        0.1466  0.1148 -0.0318 0.0018 -0.0336 0.0319  -1.00     14  
450  [0.20,0.350)  T   1070  0.824 0.2675  0.2879 +0.0203 0.0045 +0.0159 0.0135 +  1.51    308  
450  [0.20,0.350)  W    229        0.2669  0.2533 -0.0136 0.0040 -0.0176 0.0291  -0.47     58  
450  [0.35,0.500)  T    900  0.851 0.4169  0.4089 -0.0080 0.0064 -0.0144 0.0164  -0.49    368  
450  [0.35,0.500)  W    157        0.4232  0.4204 -0.0028 0.0066 -0.0094 0.0393  -0.07     66  
450  [0.50,0.650)  T    854  0.836 0.5709  0.5621 -0.0088 0.0066 -0.0154 0.0169  -0.52    374  
450  [0.50,0.650)  W    168        0.5724  0.6071 +0.0347 0.0071 +0.0276 0.0380 +  0.91     66  
450  [0.65,0.800)  T   1066  0.848 0.7241  0.6989 -0.0252 0.0042 -0.0294 0.0136  -1.85    321  
450  [0.65,0.800)  W    191        0.7207  0.7225 +0.0018 0.0044 -0.0025 0.0323 +  0.06     53  
450  [0.80,0.900)  T    790  0.869 0.8471  0.8671 +0.0200 0.0024 +0.0175 0.0128 +  1.57    105  
450  [0.80,0.900)  W    119        0.8418  0.8319 -0.0098 0.0024 -0.0123 0.0334  -0.29     20  
450  [0.90,0.980)  T    665  0.881 0.9343  0.9459 +0.0116 0.0010 +0.0105 0.0096 +  1.21     36  
450  [0.90,0.980)  W     90        0.9313  0.9889 +0.0576 0.0011 +0.0564 0.0265 +  2.17      1  
450  [0.98,0.995]  T    107  0.930 0.9843  0.9907 +0.0064 0.0002 +0.0061 0.0120 +  0.53      1  
450  [0.98,0.995]  W      8        0.9838  1.0000 +0.0162 0.0003 +0.0160 0.0447 +  0.36      0  
600  [0.02,0.100)  T   1231  0.907 0.0492  0.0317 -0.0175 0.0005 -0.0180 0.0061  -2.86     39  
600  [0.02,0.100)  W    126        0.0590  0.0238 -0.0352 0.0004 -0.0356 0.0209  -1.68      3  
600  [0.10,0.200)  T    746  0.841 0.1408  0.1367 -0.0040 0.0021 -0.0062 0.0127  -0.32    102  
600  [0.10,0.200)  W    141        0.1427  0.1206 -0.0221 0.0019 -0.0240 0.0294  -0.75     17  
600  [0.20,0.350)  T    776  0.826 0.2663  0.2796 +0.0133 0.0044 +0.0090 0.0158 +  0.84    217  
600  [0.20,0.350)  W    163        0.2696  0.2822 +0.0126 0.0044 +0.0082 0.0346 +  0.37     46  
600  [0.35,0.500)  T    595  0.839 0.4213  0.4319 +0.0106 0.0067 +0.0039 0.0202 +  0.53    257  
600  [0.35,0.500)  W    114        0.4199  0.3947 -0.0252 0.0062 -0.0313 0.0460  -0.55     45  
600  [0.50,0.650)  T    584  0.831 0.5727  0.5736 +0.0010 0.0067 -0.0057 0.0204 +  0.05    249  
600  [0.50,0.650)  W    119        0.5729  0.6218 +0.0489 0.0072 +0.0417 0.0452 +  1.08     45  
600  [0.65,0.800)  T    711  0.820 0.7232  0.7286 +0.0053 0.0043 +0.0010 0.0167 +  0.32    193  
600  [0.65,0.800)  W    156        0.7301  0.8013 +0.0712 0.0046 +0.0665 0.0354 +  2.01     31  
600  [0.80,0.900)  T    631  0.828 0.8476  0.8479 +0.0002 0.0024 -0.0021 0.0143 +  0.02     96  
600  [0.80,0.900)  W    131        0.8479  0.8321 -0.0158 0.0023 -0.0181 0.0313  -0.51     22  
600  [0.90,0.980)  T    914  0.877 0.9388  0.9387 -0.0001 0.0010 -0.0010 0.0079  -0.01     56  
600  [0.90,0.980)  W    128        0.9339  0.9375 +0.0036 0.0010 +0.0026 0.0219 +  0.16      8  
600  [0.98,0.995]  T    479  0.925 0.9854  0.9854 +0.0000 0.0002 -0.0002 0.0055 +  0.00      7  
600  [0.98,0.995]  W     39        0.9844  1.0000 +0.0156 0.0002 +0.0154 0.0199 +  0.79      0  
750  [0.02,0.100)  T   1401  0.904 0.0394  0.0286 -0.0109 0.0004 -0.0113 0.0052  -2.11     40  
750  [0.02,0.100)  W    148        0.0578  0.0541 -0.0038 0.0008 -0.0046 0.0191  -0.20      8  
750  [0.10,0.200)  T    420  0.762 0.1410  0.1452 +0.0042 0.0023 +0.0019 0.0169 +  0.25     61  
750  [0.10,0.200)  W    131        0.1407  0.1832 +0.0425 0.0029 +0.0397 0.0303 +  1.40     24  
750  [0.20,0.350)  T    397  0.777 0.2697  0.3174 +0.0477 0.0050 +0.0427 0.0222 +  2.15    126  
750  [0.20,0.350)  W    114        0.2679  0.1754 -0.0925 0.0027 -0.0952 0.0413  -2.24     20  
750  [0.35,0.500)  T    360  0.776 0.4164  0.4389 +0.0225 0.0068 +0.0156 0.0259 +  0.87    158  
750  [0.35,0.500)  W    104        0.4100  0.4327 +0.0227 0.0067 +0.0159 0.0481 +  0.47     45  
750  [0.50,0.650)  T    317  0.781 0.5715  0.5804 +0.0089 0.0068 +0.0021 0.0277 +  0.32    133  
750  [0.50,0.650)  W     89        0.5736  0.6180 +0.0444 0.0072 +0.0372 0.0523 +  0.85     34  
750  [0.65,0.800)  T    392  0.747 0.7273  0.7577 +0.0304 0.0044 +0.0260 0.0224 +  1.36     95  
750  [0.65,0.800)  W    133        0.7205  0.8045 +0.0840 0.0049 +0.0791 0.0387 +  2.17     26  
750  [0.80,0.900)  T    393  0.768 0.8478  0.8321 -0.0157 0.0023 -0.0180 0.0181  -0.87     66  
750  [0.80,0.900)  W    119        0.8490  0.8571 +0.0082 0.0024 +0.0058 0.0327 +  0.25     17  
750  [0.90,0.980)  T    683  0.812 0.9421  0.9385 -0.0036 0.0009 -0.0045 0.0089  -0.41     42  
750  [0.90,0.980)  W    158        0.9420  0.9051 -0.0370 0.0009 -0.0378 0.0185  -2.00     15  
750  [0.98,0.995]  T    818  0.930 0.9870  0.9829 -0.0041 0.0002 -0.0043 0.0040  -1.03     14  
750  [0.98,0.995]  W     62        0.9858  0.9839 -0.0020 0.0002 -0.0022 0.0150  -0.13      1  
850  [0.02,0.100)  T    893  0.831 0.0361  0.0325 -0.0037 0.0005 -0.0042 0.0062  -0.59     29  
850  [0.02,0.100)  W    182        0.0568  0.0330 -0.0239 0.0005 -0.0244 0.0171  -1.40      6  
850  [0.10,0.200)  T    163  0.608 0.1379  0.1534 +0.0155 0.0024 +0.0131 0.0269 +  0.57     25  
850  [0.10,0.200)  W    105        0.1464  0.1238 -0.0226 0.0019 -0.0245 0.0344  -0.66     13  
850  [0.20,0.350)  T    163  0.613 0.2619  0.2270 -0.0349 0.0035 -0.0384 0.0343  -1.02     37  
850  [0.20,0.350)  W    103        0.2773  0.2524 -0.0249 0.0039 -0.0288 0.0439  -0.57     26  
850  [0.35,0.500)  T    106  0.541 0.4239  0.4811 +0.0573 0.0075 +0.0498 0.0478 +  1.20     51  
850  [0.35,0.500)  W     90        0.4216  0.4222 +0.0007 0.0066 -0.0059 0.0519 +  0.01     38  
850  [0.50,0.650)  T    109  0.586 0.5761  0.6147 +0.0386 0.0071 +0.0316 0.0472 +  0.82     42  
850  [0.50,0.650)  W     77        0.5714  0.5714 +0.0000 0.0067 -0.0067 0.0562 +  0.00     33  
850  [0.65,0.800)  T    177  0.625 0.7226  0.7232 +0.0006 0.0043 -0.0038 0.0335 +  0.02     49  
850  [0.65,0.800)  W    106        0.7211  0.7642 +0.0430 0.0046 +0.0384 0.0434 +  0.99     25  
850  [0.80,0.900)  T    170  0.637 0.8495  0.8706 +0.0211 0.0024 +0.0187 0.0273 +  0.77     22  
850  [0.80,0.900)  W     97        0.8439  0.8866 +0.0427 0.0026 +0.0401 0.0367 +  1.16     11  
850  [0.90,0.980)  T    357  0.692 0.9441  0.9412 -0.0030 0.0009 -0.0038 0.0121  -0.24     21  
850  [0.90,0.980)  W    159        0.9434  0.9308 -0.0126 0.0009 -0.0135 0.0182  -0.69     11  
850  [0.98,0.995]  T    635  0.881 0.9870  0.9795 -0.0075 0.0002 -0.0077 0.0045  -1.67     13  
850  [0.98,0.995]  W     86        0.9848  0.9651 -0.0196 0.0002 -0.0199 0.0132  -1.49      3  

CANDIDATE cells: none
NEG-FLAG / demoted cells: none
```

### Verdict (frozen decision rule + pre-read amendments, k = 252)

**NULL — zero CANDIDATE cells, zero NEG-FLAG cells.**

- All six discovery identity gates passed: line totals, pipeline totals,
  both coverage vectors, join counts, and both gate cells reproduce the
  published CAL-001 read exactly at printed precision (winRate
  0.9854/0.9778, E14 controls z = −1.02/−0.59 at n = 520/516). The
  parse and join are the audited CAL-001 pipeline, byte-equivalent.
- Cell accounting is complete: 237 non-empty + 15 empty = 252 cells;
  Σn(T) = 85,127 and Σn(W) = 15,277 sum to the 100,404 parsed
  observations exactly.
- No cell on either side, in either spread state, reaches |z| ≥ 3.75.
  The single |z| ≥ 3 cell is UP W (750s, [0.20,0.35)) at z = −3.05
  (n = 133, net = −0.1189) — NEGATIVE (buyer-adverse), below the flag
  bar, and the W-state concentration of CAL-001's own published marginal
  there (z = −3.02, n = 563): buying into a wide-spread mid-low ask late
  in the window costs ~12c net, the E21/E22 staleness picture, not an
  edge. The most positive cells are +2.17 (two W cells, n = 90/133,
  one at minority 1) and +2.29 on an n = 1 cell — noise territory, far
  under the bar.
- The T-state tables track CAL-001's marginals throughout, as the
  a-priori expectation stated: no tight-confined edge was hiding inside
  the CAL-001 null. Per amendment 2, any cell citation quotes its
  printed tfr; per the frozen dependence rule, T-cell agreement with
  CAL-001 is NOT an independent confirmation (~85% shared samples).
- Sub-window consistency and the amendment-1 proceed/park criterion were
  never reached (no cell cleared the z bar). The probe reserve stays
  unspent; the holdout stays locked.
- Binding coverage wording (amendment #11 logic): 750s/850s cells
  condition on a book event at-or-after the offset (0.8746 / 0.5993 of
  the 8,133 sampled markets) and additionally on their spread state at
  the sampled moment; no venue-level efficiency claim is made for
  excluded quiet markets or the complementary state. W-state nulls are
  POWER STATEMENTS almost everywhere (mid-range W cells resolve only
  |d| ≳ 6-10c); the W conclusion is bounded to "no gross dislocation at
  the several-cent level", per the frozen Power section.
- The two known mirror deviants contribute ≤1 sample per affected cell
  (disclosed in the registration); immaterial to every number above.

**Interpretation (binding wording per the frozen sections + amendments):**
Within stated power, decomposing the fixed-time plane by spread state
reveals NO cell clearing the candidate bar on either side in either
state: the CAL-001 null is not hiding a tight-confined edge (T cells,
powered at 1.10-1.16× CAL-001's per-cell resolution on the marginal
range, wider where the printed tfr is lower), and wide-spread states show
no exploitable dislocation at the gross levels the scan can resolve —
the only near-flag W deviation is buyer-adverse continuation/staleness,
consistent with E21/E22.

**Consequence:** spread state was the LAST feature axis the discovery
log can express that had never been scanned (motivation 1). With this
null, the CAL-001 discovery log is **measurement-exhausted**: price
levels × time (CAL-001/E20), single-segment moves (CAL-002/E21),
two-segment big-move sign paths (CAL-003/E22, mid-involved shapes
power-futile per U45), spread state (CAL-004), cross-side sums
(degenerate, mirror fact), sizes (never recorded). No further discovery
scan of this log can produce a citable result — future taker
registrations need a NEW instrument or NEW data (universe growth per
IDEAS #10 arithmetic, or the trades-channel fill model per EDGE-SPACE
§3.2). LESSONS E23 records the closure; EDGE-SPACE §1/§4 updated.

### Fresh-context Judge verdict (appended verbatim)

- decision: null-confirmed

- basis: The committed raw read (`fable-lab/knowledge/CAL-004-discovery-read.txt`) is byte-identical to the Results code block, and my independent parse of all 252 cells reproduces the claimed NULL exactly: zero cells at |z| ≥ 3.75, extremes and count identities as claimed, all six identity gates matching CAL-001's published Results verbatim, every printed z and fee consistent with the frozen formulas within display rounding, and the git trail (185f5db registration → 40d022b tool+selftest → 974c418 audit+amendments → 1a2c4a2 results-only append, tool file unchanged since 40d022b) supports the frozen-before-read ordering and the SIGPIPE-disclosure account. The one substantive weakness is not in the NULL itself but in the derived "measurement-exhausted" consequence, whose categorical "no further discovery scan of this log can produce a citable result" outruns what four per-axis scans plus two degenerate axes strictly support (interaction/joint conditionings of already-scanned axes remain expressible on the log) — the same decomposition logic CAL-004's own motivation 3 used against CAL-001. This is a wording-scope defect in a derived claim (the E20/E21/E22 propagation-audit class), fixable in the not-yet-written E23/EDGE-SPACE propagation; it does not touch the frozen decision rule or the table.

- checks:
  - (a) Full 252-cell scan — PASS: 0 cells with |z| ≥ 3.75; unique |z| ≥ 3 cell is UP W (750s, [0.20,0.35)) z=−3.05 n=133 net=−0.1189; most positive are DOWN W (30s,[0.10,0.20)) z=+2.29 n=1, DOWN W (450s,[0.90,0.98)) z=+2.17 n=90 minority=1, DOWN W (750s,[0.65,0.80)) z=+2.17 n=133 — exactly the verdict's claims including the n=1 caveat.
  - (b) Re-derivation — PASS: 8 explicit cells across both sides/states give d/se = printed z (e.g. UP 750 W −3.0497→−3.05; DOWN 450 [0.90,0.98) W +2.1736→+2.17; DOWN 600 [0.02,0.10) T −2.8689→−2.86); all 237 non-empty cells pass a propagated-rounding z check and all fees/nets reproduce from fee = winRate·0.0156·min(a,1−a)/a (UP 750 W: 0.00235→0.0023; DOWN 450 W: 0.00114→0.0011).
  - (c) Count identities — PASS: 237 non-empty + 15 empty = 252; Σn = 100,404 exactly; ΣnT = 85,127, ΣnW = 15,277 (sum 100,404); both per-offset coverage lines are string-identical to CALIBRATION.md:309-310; T+W partition spot-check (UP 750s [0.20,0.35): 430+133=563, pooled winRate 0.20784→0.2078, minority 97+20=117) reconciles with CAL-001's marginal row.
  - (d) Identity gates — PASS: line totals 104,776/52,388, pipeline 100,404/8,133/200/4,172/8,133, join 8,133/8,133/0, and all four gate cells (0.9854 n=687; 0.9778 n=721; net −0.0110 z=−1.02 n=520; net −0.0068 z=−0.59 n=516) match CALIBRATION.md's published Results verbatim.
  - (e) Bar arithmetic — PASS: tail(3.75) = 8.8417e-5 ≤ 0.023/252 = 9.1270e-5 (conservative, margin 2.85e-6).
  - (f) Flagged-adjacent claim — PASS: table shows UP W (750s,[0.20,0.35)) n=133 z=−3.05 net=−0.1189; CALIBRATION.md:364 shows the marginal z=−3.02 n=563; decomposition (430/563)(−0.0370)+(133/563)(−0.1165) = −0.0558 = the published marginal d, so "W-state concentration of the marginal" is numerically coherent.
  - (g) Wording obligations — PASS: (i) 82-92% is quoted only as "the marginal range, wider where the printed tfr is lower", never as a per-cell claim; (ii) 0.8746/0.5993 coverage conditioning present; (iii) T-vs-CAL-001 non-independence explicit ("NOT an independent confirmation, ~85% shared" — consistent with 85,127/100,404 = 84.8%), and no cross-side pair is anywhere leaned on as dual evidence (see reservation 2); (iv) W nulls stated as power statements with the 6-10c resolution; (v) mirror-deviant ≤1-sample note present; (vi) sub-window and amendment-1 proceed/park correctly stated as never reached (no cell cleared z).
  - (h) Invocation disclosure — PASS: what was seen mid-run (gates + UP rows through 450s, none flagged) could not steer any decision — every rule was frozen at 974c418, which precedes the read, and `git diff 974c418 1a2c4a2` shows a pure append (no tool/registration byte changed between invocations; calib4.ts unchanged since 40d022b). Deterministic tool + same command makes the re-run a completion, not a second read. Residue: the truncated first output file was not committed, so "both invocations agree on every overlapping line" rests on the disclosure, consistent with the honor-system framing.
  - (i) Measurement-exhausted scoping — FAIL (narrowly, on one sentence): the consequence correctly preserves the known open sub-power windows (universe growth per IDEAS #10, trades-channel fill model, U45 power-futile parking kept as power statements, W nulls bounded to gross dislocations), but the categorical "No further discovery scan of this log can produce a citable result" forecloses more than the four scans + degenerate axes support — joint/interaction conditionings of scanned axes (e.g. spread × prior-move on the larger T cells) are expressible on the log, unscanned, and not measured degenerate; this is plausibility-grade foreclosure, the lab's own D25/D31 defect class and the exact arithmetic CAL-004's motivation 3 invoked against CAL-001's marginals. "Axis-exhausted" is supported; "measurement-exhausted" categorically is not.
  - Audit-to-amendment mapping — PASS: all 5 findings of AUDIT-2026-07-11-CAL-004-REG.md map one-to-one to amendments 1-5 (mechanical proceed/park z≥4.49 with 1.995·(1+1.249)=4.487 verified; marginal-scope tfr rule; 0.641/84% correction; printed-precision gate note; fine-tick rewording), all committed at 974c418 before the read.

- reservations:
  1. The "measurement-exhausted" consequence (check i) should be weakened to per-axis exhaustion before it propagates: EDGE-SPACE §4 saying "categorically" closed forecloses joint-axis interaction scans the log can still express. Recommend the E23/EDGE-SPACE wording state "every single feature axis scanned or degenerate; further scans limited to interactions with less power and the same reserve-confirmation burden", not "no further scan can produce a citable result".
  2. Cross-side non-independence is stated in the frozen dependence rule but not restated in the appended verdict; nothing in the verdict leans on cross-side agreement as dual evidence, so the obligation is only weakly engaged, but the E23 propagation should carry it.
  3. The one-shot rule remains honor-system: I verified determinism claims via the git trail and the committed output's internal consistency, not the runtime history; the SIGPIPE-truncated first output was not preserved, so overlap agreement is disclosed, not independently checkable.
  4. "LESSONS E23 records the closure; EDGE-SPACE §1/§4 updated" is forward-looking — neither file mentions CAL-004/E23 at HEAD; the propagation (and reservation 1's fix) is still owed.
  5. The verdict's "~85% shared samples" is the pooled figure (84.8% by the printed Σ), acceptable as an aggregate under amendment 2 since no per-cell dilution claim is attached, but late-offset T cells share as little as ~61% (e.g. 850s tfr 0.608-0.636) — future citations of specific T cells must use the printed per-cell tfr as amendment 2 requires.

_Erratum (accepted from Judge check (i) / reservation 1, same session, before any propagation): the Consequence paragraph's sentence "No further discovery scan of this log can produce a citable result" over-claims — the supported statement is PER-AXIS exhaustion: every single feature axis the log expresses is now scanned (levels, moves, two-segment big-move sign paths, spread state) or measured degenerate (cross-side sums; sizes unrecorded). Joint/interaction conditionings of scanned axes remain formally expressible with strictly less power per cell (incidence products) and carry the same binding reserve-confirmation burden under the U45 envelope; any such scan needs its own pre-registered motivation. E23 and EDGE-SPACE carry the scoped wording; the verdict text above stays as appended (append-only convention). Reservation 2's obligation (cross-side non-independence) and reservation 5's rule (per-cell printed tfr for any specific T-cell citation) travel with E23._
