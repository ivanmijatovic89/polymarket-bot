# CAL-002 — conditional (path) calibration plane: inter-offset move × entry side

_Registered session 41 (U43bc), DECISIONS D24. Method frozen in the
registration commit BEFORE any conditional statistic is computed. Data:
the already-integrity-verified CAL-001 discovery log — zero new replay
compute for discovery. Analysis tool: `tools/calib2.ts` (one-shot)._

## Why this study exists (motivating evidence)

E20 (CAL-001, null-confirmed) closed the FIXED-TIME taker plane within
stated power: price level × time-into-window carries no taker-exploitable
signal on either side. E20 transfer (b) names the remaining in-scope taker
space: CONDITIONAL structure — path/flow features within the window.
EXP-003 (post-jump, kill/E10) and EXP-005 (first-minute, kill/E12) tested
two point hypotheses in that space with specific strategies; no systematic
conditional scan exists.

The CAL-001 instrument already recorded the raw material for the simplest
conditional feature: top-of-book state at 7 fixed offsets per market gives
6 inter-offset MOVES. By the law of total expectation, CAL-001's flat
marginals do NOT exclude offsetting conditional deviations (e.g. buying
after a big down-move could be underpriced while buying after a big
up-move is overpriced, netting to zero in the marginal cell). CAL-002 asks
exactly that question, on data already on disk, before any thought of new
replay compute.

## Data (frozen)

- Log: `fable-lab/logs/CAL-001-discovery-v3.log` — the completed CAL-001
  discovery run (8,516 markets < 2026-03-01; integrity battery green,
  see CALIBRATION.md Results). No new engine run for discovery.
- Outcome join: `telonex_markets.result_id` by slug via
  `src/db/telonexMarkets.ts` (`'0'` → UP won, `'1'` → DOWN won), identical
  to calib.ts.
- Probe reserve (CONFIRMATION data, untouched by discovery): the 5,460
  eligible markets in [2026-03-01, holdout boundary 1777237200000), as
  reserved at CAL-001 registration and re-verified session 20.
- Holdout: untouched, locked, unaffected by this study.

## Instrument (derived, frozen)

From each market's `[diag-calib]` lines (same line grammar as calib.ts):

- Apply calib.ts's exact validity pipeline per (slug, asset, offset):
  first-occurrence dedupe, drift filter `ts < next offset` (NEXT_BOUND
  900s after 850).
- UP mid at offset o: `mid(o) = (bid_UP(o) + ask_UP(o)) / 2` from the
  valid UP line. The DOWN book is an exact mirror (amendment #12 /
  E20), so no DOWN-derived move is computed — it would be `−move` by
  construction.
- Move over an adjacent offset pair (t1, t2):
  `move = mid(t2) − mid(t1)`. Defined only when BOTH offsets have valid
  UP lines.
- Entry: buy side S ∈ {UP, DOWN} at `ask_S(t2)` from side S's valid line
  at t2, requiring `ask_S(t2) ∈ [0.02, 0.995]` (same band + rationale as
  CAL-001; out-of-band entries are counted and dropped).
- Win for the entry: side S resolves as winner per result_id.

## Grid (k = 60 cells, frozen)

- PAIRS (6): (30,150), (150,300), (300,450), (450,600), (600,750),
  (750,850).
- MOVE BUCKETS (5), frozen from tick size (0.01) and the CAL-001-published
  pooled median spread (0.01) — chosen with NO inspection of the move
  distribution:
  - `dn2`: move ≤ −0.02 (two ticks or more down)
  - `dn1`: −0.02 < move ≤ −0.005
  - `flat`: −0.005 < move < +0.005
  - `up1`: +0.005 ≤ move < +0.02
  - `up2`: move ≥ +0.02
- SIDES (2): buy-UP, buy-DOWN — both taker half-planes at t2's ask.
- k = 6 × 5 × 2 = 60. No price-level dimension: price is absorbed by the
  statistic (d = winRate − meanAsk), as everywhere since EXP-001.

## Statistic and decision rule (frozen — identical formulas to CAL-001)

Per cell: `d = winRate − meanAsk`;
`fee = winRate · 0.0156 · min(meanAsk, 1−meanAsk) / meanAsk` (amendment #4
share-denominated BUY fee); `net = d − fee`;
`se = sqrt(Σ a(1−a)) / n`; `z = d / se` (same convention as calib.ts).

- **CANDIDATE cell**: `net > 0` AND `z ≥ 3.37` (one-sided
  p = 0.023/60 ≈ 3.83e-4; tail(3.37) ≈ 3.75e-4) AND minority-outcome
  count ≥ 30 (D13) AND `d > 0` in all three CAL-001 sub-windows
  (→2025-12-31, 2026-01, 2026-02, UTC by slug epoch) — else demoted
  `subwindow-inconsistent`, not citable.
- **NEG-FLAG cell**: `z ≤ −3.37`; minority < 30 → annotated
  `underpowered-E14`, no motivating weight.
- **Anything else**: on-diagonal within power.
- **Cross-side / cross-bucket dependence:** buy-DOWN cells are the
  sell-UP-at-bid economics on mirrored books; a candidate and its
  cross-side reflection share samples and are ONE piece of evidence
  (amendments #12/#13 apply unchanged). Adjacent pairs share the middle
  offset's samples; overlapping-sample cells are never independent
  confirmations.

### Confirmation requirement (BINDING — the discovery table cannot be cited alone)

CAL-002 discovery runs on the SAME log whose marginal tables are already
published (E20), and the designer has seen those marginals (disclosure:
no conditional statistic — no move value, move distribution, or
conditional win rate — was computed before this freeze; move buckets come
from tick size). Discovery candidates are therefore HYPOTHESIS-GENERATING
ONLY. Before any citation under EDGE-SPACE §4 or any EXP registration, a
candidate cell must REPLICATE on the probe reserve:

1. a new diag-calib instrument run over the reserve window
   [2026-03-01, boundary−1] (committed code, detached, integrity battery
   per D23), then
2. a one-shot calib2.ts read of the reserve log, judged at the SAME bar
   (`net > 0`, `z ≥ 3.37`, minority ≥ 30) on the pre-named candidate
   cells only.

A candidate that fails reserve confirmation is dead (noise mined from a
reused log). Any experiment registered from a CONFIRMED candidate carries
`lineage_cells = 60`. The holdout stays locked regardless.

## Instrument validation gates (frozen; abort before reading the table)

1. **Parser consistency:** calib2.ts's line parse of the discovery log
   must reproduce the published CAL-001 totals exactly — 104,776
   well-formed sample lines, 52,388 per side. Mismatch → ABORT (parser
   drift; fix the tool against the synthetic fixture, never against the
   real log).
2. **Join-direction (per side):** pooled over all move buckets, pair
   (750,850) with entry ask ∈ [0.98, 0.995]: `n ≥ 30` and
   `winRate > 0.9`. Fail → ABORT (join suspect).
3. **E14-analog positive control (per side):** pooled over all move
   buckets, pair (750,850) with entry ask ∈ [0.90, 0.98): ABORT iff
   `|z| ≥ 3.37`. This pools territory CAL-001 published as on-diagonal
   (850s [0.90,0.98): z = −1.02 UP / −0.59 DOWN); a bar-clearing
   deviation means instrument bug first. (Restriction to markets with a
   valid 750s sample is a sub-selection of CAL-001's cell; the control
   tolerates that shift by using the same wide bar, not a tighter one.)

## Coverage / conditioning (binding wording, amendment #11 logic)

Every cell conditions on valid book events at BOTH offsets of its pair
(and the entry side's line at t2). CAL-001 measured late-offset attrition
(750s → 0.8746, 850s → 0.5993 of sampled markets); pair (750,850) inherits
roughly the intersection. calib2.ts prints per-pair market counts per
side; any verdict wording citing a pair must state its coverage fraction
and must NOT claim venue-level (in)efficiency for excluded quiet markets.

## Power (recorded at registration)

Cell sizes are unknown before the read (the move distribution has never
been inspected — frozen buckets are a priori). Structural bounds: a pair
has at most ~8,000 markets; 5 move buckets split that unevenly (the flat
bucket plausibly dominates early pairs). At meanAsk ≈ 0.5 the candidate
bar in cents is ≈ 3.37·se ≈ 5.3c at n = 1,000 and ≈ 2.4c at n = 5,000; at
meanAsk ≈ 0.9, ≈ 3.2c at n = 1,000. A null is therefore a POWER STATEMENT
for thin cells (expected in `dn2`/`up2` at early pairs); binding verdict
wording: report n per cell and never present a thin-cell null as proof of
efficiency. The economically real question — do big moves at moderate
prices misprice the next segment — is powered at the few-cent level, which
is where E10's ≥1.5c fee floor lives.

## Disclosures

- Same-log reuse: the discovery log's marginal statistics (CAL-001
  tables) are published; this study's protection against mining is the
  frozen a-priori grid + Bonferroni + the BINDING reserve confirmation.
- The one-shot rule (amendment #5 logic) applies to the discovery read:
  calib2.ts runs ONCE on the discovery log; honor-system + git trail.
- calib2.ts is validated mechanically on a SYNTHETIC log fixture with
  hand-computable expected output (never on the real log) before the
  one-shot; the fixture and its expected values are committed with the
  tool.
- No engine run, no DB write, no order of any kind in discovery; the
  reserve confirmation (if reached) is a standard detached local
  `--sequential` instrument run under D8 latency pinning.

## Amendments (pre-read, 2026-07-10 — audit-motivated, frozen before any read)

A fresh-context adversarial audit reviewed this registration and the tool
before the one-shot (verdict sound-with-findings; report verbatim in
`knowledge/AUDIT-2026-07-10-CAL-002-REG.md`). All findings acted on with
NO result read:

1. **(MAJOR, finding 1) Reserve-read semantics frozen now.** The committed
   tool could not execute the binding reserve confirmation: its
   parser-consistency gate was hard-wired to the discovery totals, and the
   discovery sub-windows (→Dec/Jan/Feb) all predate the reserve window, so
   every reserve candidate would print as demoted. Frozen fix, pre-read:
   `calib2.ts --expect-totals <lines>,<perSide>` is the reserve mode — the
   gate checks the reserve run's OWN outcome-free D23 battery totals, and
   candidate flagging drops the sub-window requirement (the reserve bar
   was always `net > 0 ∧ z ≥ 3.37 ∧ minority ≥ 30` on pre-named cells).
   Mechanical guard: `--expect-totals` is refused on paths containing
   `CAL-001-discovery`, so reserve mode can never relax the discovery
   read. No tool edit will ever be needed after a table is seen.
2. **(finding 3) Mirror-deviant caveat:** "no DOWN-derived move — it would
   be −move by construction" holds up to the TWO known mirror deviants
   (CAL-001 Results: epochs 1764846000/850 and 1771651800/300); at ≤2
   markets in 52,388 pairs this is immaterial, but any verdict wording
   citing pairs (150,300)/(300,450) inherits the off=300 deviant's
   1-market exposure.
3. **(finding 4) Empty-control semantics frozen:** on a REAL log (discovery
   or reserve) an EMPTY E14-analog control gate ABORTS — CAL-001 measured
   n≈520/516 in that territory, so emptiness signals a derivation bug.
   The synthetic fixture is exempt.
4. **(finding 5) FP edge assignment acknowledged:** moves are float
   differences of 4-dp mids; a mathematically-exact-edge move can land on
   either side of its bucket edge by FP. Deterministic, direction-agnostic,
   and the same exposure class CAL-001 accepted for ask buckets. The
   selftest's edge fixtures document the actual FP behavior at all four
   edges.
5. **(findings 2, 6) Selftest extended:** exact-edge moves at all four
   bucket edges (asserted into their intended buckets),
   drift-invalid-first/valid-duplicate-second ordering (pair must never
   form — calib.ts convention), reserve-mode candidate flagging, and both
   refusal guards. Remaining unexercised paths (subwindow-demotion,
   underpowered annotation, unresolved-outcome exclusion, parser-gate
   PASS/FAIL branches) are accepted as structurally identical to
   calib.ts's audited logic.

## Results

_(append-only below this line; nothing here until calib2.ts runs ONCE on
the discovery log)_

### Discovery read (2026-07-10, one-shot on CAL-001-discovery-v3.log)

Tool: `tools/calib2.ts` at the audited pre-read commit (f5d9aa3); selftest
17/17 green at that commit; run ONCE per the one-shot rule. Full output
verbatim:

```
gate parser-consistency: OK (lines=104776, UP=52388, DOWN=52388)
parsed 8133 markets with any valid sample (200 drift-discarded lines)
derived 84112 conditional entries (4058 dropped: entry ask outside [0.02,0.995])
per-pair market coverage UP: p30-150=8112 p150-300=8099 p300-450=8066 p450-600=7768 p600-750=6232 p750-850=3770
per-pair market coverage DOWN: p30-150=8112 p150-300=8099 p300-450=8064 p450-600=7780 p600-750=6236 p750-850=3774
outcome joined for 8127/8127 markets (0 missing/unresolved — excluded)
gates UP: join-direction OK (pooled 750-850 tail winRate=0.9869, n=686); E14-analog control OK (net=-0.0112 z=-1.03 n=519)
gates DOWN: join-direction OK (pooled 750-850 tail winRate=0.9777, n=719); E14-analog control OK (net=-0.0068 z=-0.59 n=516)

CAL-002 UP-side cell table (k=60 total, candidate bar z>=3.37, minority>=30, fee=winRate*0.0156*min(a,1-a)/a, sub-window consistency required)
pair     bucket     n     meanAsk winRate      d     fee     net      se      z  minor  flag
30-150   dn2    3620  0.3757  0.3685 -0.0072 0.0057 -0.0129 0.0078  -0.92   1334  
30-150   dn1     313  0.4836  0.4792 -0.0043 0.0075 -0.0118 0.0278  -0.16    150  
30-150   flat    188  0.5138  0.5319 +0.0181 0.0079 +0.0103 0.0360 +  0.50     88  
30-150   up1     330  0.5231  0.4970 -0.0261 0.0071 -0.0332 0.0271  -0.96    164  
30-150   up2    3661  0.6408  0.6318 -0.0090 0.0055 -0.0145 0.0077  -1.16   1348  
150-300  dn2    3624  0.3421  0.3347 -0.0074 0.0052 -0.0126 0.0074  -1.01   1213  
150-300  dn1     276  0.4732  0.4638 -0.0094 0.0072 -0.0167 0.0278  -0.34    128  
150-300  flat    169  0.5252  0.5266 +0.0014 0.0074 -0.0060 0.0354 +  0.04     80  
150-300  up1     262  0.5189  0.5229 +0.0040 0.0076 -0.0036 0.0285 +  0.14    125  
150-300  up2    3768  0.6695  0.6600 -0.0095 0.0051 -0.0146 0.0072  -1.33   1281  
300-450  dn2    3645  0.3111  0.2960 -0.0151 0.0046 -0.0197 0.0068  -2.23   1079  
300-450  dn1     251  0.4613  0.4741 +0.0128 0.0074 +0.0054 0.0256 +  0.50    119  
300-450  flat    180  0.4852  0.4944 +0.0092 0.0077 +0.0015 0.0307 +  0.30     89  
300-450  up1     291  0.5515  0.5533 +0.0017 0.0070 -0.0053 0.0240 +  0.07    130  
300-450  up2    3699  0.7074  0.7010 -0.0064 0.0045 -0.0110 0.0066  -0.97   1106  
450-600  dn2    3378  0.2699  0.2507 -0.0192 0.0039 -0.0231 0.0064  -3.00    847  
450-600  dn1     307  0.3776  0.3941 +0.0166 0.0061 +0.0104 0.0194 +  0.86    121  
450-600  flat    213  0.4984  0.4742 -0.0242 0.0074 -0.0316 0.0232  -1.04    101  
450-600  up1     333  0.6312  0.6366 +0.0055 0.0058 -0.0003 0.0189 +  0.29    121  
450-600  up2    3537  0.7508  0.7419 -0.0090 0.0038 -0.0128 0.0061  -1.47    913  
600-750  dn2    2708  0.2355  0.2112 -0.0243 0.0033 -0.0276 0.0065  -3.72    572  NEG-FLAG
600-750  dn1     247  0.2972  0.2713 -0.0260 0.0042 -0.0302 0.0184  -1.41     67  
600-750  flat    177  0.5091  0.4802 -0.0289 0.0072 -0.0361 0.0206  -1.40     85  
600-750  up1     262  0.6651  0.6412 -0.0239 0.0050 -0.0289 0.0171  -1.40     94  
600-750  up2    2838  0.7909  0.7851 -0.0059 0.0032 -0.0091 0.0061  -0.97    610  
750-850  dn2    1673  0.2096  0.1871 -0.0225 0.0029 -0.0254 0.0077  -2.90    313  
750-850  dn1     145  0.3338  0.3103 -0.0234 0.0048 -0.0282 0.0209  -1.12     45  
750-850  flat    138  0.5178  0.5000 -0.0178 0.0073 -0.0250 0.0189  -0.94     69  
750-850  up1     172  0.6987  0.6802 -0.0184 0.0046 -0.0230 0.0179  -1.03     55  
750-850  up2    1642  0.8009  0.7966 -0.0044 0.0031 -0.0074 0.0075  -0.58    334  

CAL-002 DOWN-side cell table (k=60 total, candidate bar z>=3.37, minority>=30, fee=winRate*0.0156*min(a,1-a)/a, sub-window consistency required)
pair     bucket     n     meanAsk winRate      d     fee     net      se      z  minor  flag
30-150   dn2    3620  0.6359  0.6315 -0.0044 0.0056 -0.0100 0.0078  -0.57   1334  
30-150   dn1     313  0.5283  0.5208 -0.0075 0.0073 -0.0148 0.0278  -0.27    150  
30-150   flat    188  0.4970  0.4681 -0.0289 0.0073 -0.0362 0.0360  -0.80     88  
30-150   up1     330  0.4892  0.5030 +0.0138 0.0078 +0.0060 0.0271 +  0.51    164  
30-150   up2    3661  0.3708  0.3682 -0.0026 0.0057 -0.0083 0.0078  -0.33   1348  
150-300  dn2    3624  0.6695  0.6653 -0.0042 0.0051 -0.0094 0.0073  -0.58   1213  
150-300  dn1     276  0.5388  0.5362 -0.0026 0.0072 -0.0098 0.0277  -0.09    128  
150-300  flat    169  0.4860  0.4734 -0.0126 0.0074 -0.0200 0.0354  -0.36     80  
150-300  up1     262  0.4931  0.4771 -0.0160 0.0074 -0.0235 0.0285  -0.56    125  
150-300  up2    3768  0.3422  0.3400 -0.0022 0.0053 -0.0075 0.0072  -0.30   1281  
300-450  dn2    3648  0.7009  0.7042 +0.0034 0.0047 -0.0013 0.0067 +  0.50   1079  
300-450  dn1     251  0.5506  0.5259 -0.0247 0.0067 -0.0314 0.0256  -0.97    119  
300-450  flat    177  0.5404  0.5198 -0.0206 0.0069 -0.0275 0.0311  -0.66     85  
300-450  up1     290  0.4618  0.4483 -0.0135 0.0070 -0.0205 0.0242  -0.56    130  
300-450  up2    3698  0.3043  0.2991 -0.0052 0.0047 -0.0099 0.0067  -0.78   1106  
450-600  dn2    3403  0.7437  0.7511 +0.0074 0.0040 +0.0034 0.0062 +  1.19    847  
450-600  dn1     325  0.6543  0.6246 -0.0297 0.0051 -0.0349 0.0181  -1.64    122  
450-600  flat    213  0.5267  0.5399 +0.0132 0.0076 +0.0056 0.0232 +  0.57     98  
450-600  up1     323  0.3918  0.3746 -0.0172 0.0058 -0.0230 0.0196  -0.88    121  
450-600  up2    3516  0.2623  0.2597 -0.0026 0.0041 -0.0067 0.0062  -0.42    913  
600-750  dn2    2752  0.7809  0.7918 +0.0109 0.0035 +0.0075 0.0062 +  1.75    573  
600-750  dn1     279  0.7498  0.7634 +0.0136 0.0040 +0.0096 0.0159 +  0.86     66  
600-750  flat    176  0.5651  0.5852 +0.0201 0.0070 +0.0131 0.0206 +  0.98     73  
600-750  up1     231  0.3991  0.4156 +0.0164 0.0065 +0.0100 0.0195 +  0.84     96  
600-750  up2    2798  0.2244  0.2180 -0.0064 0.0034 -0.0098 0.0063  -1.01    610  
750-850  dn2    1686  0.8077  0.8144 +0.0067 0.0030 +0.0037 0.0074 +  0.91    313  
750-850  dn1     166  0.7256  0.7349 +0.0094 0.0043 +0.0050 0.0180 +  0.52     44  
750-850  flat    134  0.5798  0.5896 +0.0098 0.0067 +0.0031 0.0193 +  0.51     55  
750-850  up1     157  0.3563  0.3631 +0.0068 0.0057 +0.0011 0.0199 +  0.34     57  
750-850  up2    1631  0.2162  0.2048 -0.0114 0.0032 -0.0146 0.0079  -1.45    334  

CANDIDATE cells: none
NEG-FLAG / demoted cells: UP (600-750, dn2) NEG-FLAG
```

### Verdict (frozen decision rule, k = 60)

**NULL for candidates — zero CANDIDATE cells. One NEG-FLAG: UP
(600-750, dn2), z = −3.72, minority = 572 (fully powered).**

- All three gates passed before the table was read: parser-consistency
  exact (104,776 / 52,388 / 52,388); join-direction pooled (750,850) tail
  winRate 0.9869 (UP, n=686) / 0.9777 (DOWN, n=719); E14-analog controls
  non-empty and on-diagonal (z = −1.03 UP / −0.59 DOWN) — amendment #3's
  empty-abort did not trigger.
- No cell on either side reaches z ≥ +3.37; the largest positive is DOWN
  (600-750, dn2) at z = +1.75 (net +0.0075). Sub-window consistency was
  never evaluated (no cell cleared the positive bar). The reserve
  confirmation stage is NOT triggered; the probe reserve stays unspent.
- **The NEG-FLAG and its economics (binding cross-side wording,
  amendment #12/#13 logic):** UP (600-750, dn2) — buying UP at the ask
  after the UP mid fell ≥ 2c between 600s and 750s — loses 2.43c/share
  gross (winRate 0.2112 vs meanAsk 0.2355, n = 2,708), net −2.76c. The
  same directional pattern shows at every pair from 300s on (dn2 UP-side
  z: −2.23, −3.00, −3.72, −2.90): big late down-moves CONTINUE more than
  the post-move ask prices in. But the tradable expression of that
  continuation — buying DOWN at its ask, which shares the same underlying
  book samples with complementary outcomes and is therefore NOT an
  independent measurement — nets only +0.31c to +0.75c (z ≤ +1.75) after
  the spread and fee: the counterparty's mispricing is real but smaller
  than the cost of taking it. No shorting exists; the NEG-FLAG's only
  actionable path is that cross-side cell, and it is null.
- **Coverage conditioning (amendment #11 logic, binding):** cells
  condition on valid book events at BOTH pair offsets; per-pair UP
  coverage of the 8,133 sampled markets: 30-150 → 0.997, 150-300 → 0.996,
  300-450 → 0.992, 450-600 → 0.955, 600-750 → 0.766, 750-850 → 0.464.
  Late-pair cells (incl. the NEG-FLAG) are estimates for markets with a
  live book in both segments; no venue-level claim is made for excluded
  quiet markets.
- **Power (binding wording):** the move distribution turned out strongly
  bimodal — dn2/up2 hold ~90% of entries (n ≈ 1,600-3,800), dn1/flat/up1
  are thin (n ≈ 130-330, resolving only |d| ≈ 6-10c at the bar). Thin-cell
  nulls are power statements, not efficiency proofs. The economically
  loaded cells (big moves, all pairs) are well-powered and all
  on-diagonal-or-negative for the buyer.
- Mirror-deviant caveat (amendment #2): pairs (150,300)/(300,450) carry
  the off=300 deviant's ≤1-market exposure; immaterial at these n.

**Interpretation:** within stated power, the simplest conditional
structure — sign and size of the preceding inter-offset move — adds no
taker-exploitable signal on either side at any of the six pair horizons.
The one significant deviation is adverse for the buyer (post-down-move UP
asks are stale-high ≈ 2-2.4c gross at late offsets, consistent with E16/
E17's "through-moves are informative"), and its tradable mirror is priced
within fees. Directional continuation exists gross; the venue's spread +
156 bps fee is wider than it everywhere measured.

**Consequence:** no EXP registration, no reserve spend. E21 records the
closure; EDGE-SPACE §4's taker bar tightens from "conditional/path
structure" to conditional structure BEYOND single-segment move sign/size
(this scan), with the sub-power window (mid-range |d| between ~1.5c and
~3.8c fixed-time, ~6-10c thin conditional cells) still formally open.

### Fresh-context Judge verdict (appended verbatim)

- decision: null-confirmed

- basis: The frozen decision rule (net > 0 ∧ z ≥ 3.37 ∧ minority ≥ 30 ∧ sub-window consistency, k = 60) yields zero CANDIDATE cells on the printed tables — the largest positive anywhere is DOWN (600-750, dn2) at z = +1.75, nowhere near the bar — and exactly one NEG-FLAG, UP (600-750, dn2) at z = −3.72 with minority 572 (correctly not annotated underpowered). All three pre-read validation gates pass as frozen against CAL-001's published values, the reserve stage is correctly untriggered (it binds only on candidates), and every binding wording obligation (coverage fractions, cross-side non-independence, thin-cell power framing, mirror-deviant caveat, no venue-level claim) is present in the Results. The claimed verdict follows from the recorded numbers with no skipped obligation.

- checks:
  - Full 60-cell scan, both tables: no cell reaches z ≥ +3.37 (max positives: UP +0.86 at 450-600/dn1, DOWN +1.75 at 600-750/dn2) — no missed candidate. No cell besides UP (600-750, dn2) reaches z ≤ −3.37 (next most negative: UP 450-600/dn2 −3.00, UP 750-850/dn2 −2.90, DOWN min −1.64) — no missed NEG-FLAG. PASS.
  - Arithmetic re-derivation: NEG-FLAG cell — d = 572/2708 − 0.2355 = −0.0243 ✓, fee = 0.2112·0.0156·min/a = 0.0033 ✓, net = −0.0276 ✓, z = d/se ∈ [−3.78, −3.70] under display rounding, printed −3.72 ✓. DOWN 600-750/dn2: d = +0.0109, fee = 0.0035, net ≈ 0.0075, z = +1.75 ✓. Also verified UP 450-600/dn2 (−3.00), UP 750-850/dn2 (−2.90 within rounding), UP 30-150/flat (+0.50, net within 1 ulp of rounding), DOWN 450-600/dn2 (+1.19). All d = winRate − meanAsk identities hold; winRate·n reproduces the printed minority counts. PASS.
  - Count identities: per-pair row-n sums equal the printed per-pair coverage exactly on both sides (UP 8112/8099/8066/7768/6232/3770; DOWN 8112/8099/8064/7780/6236/3774); side totals 42,047 + 42,065 = 84,112 = printed derived-entry count. PASS.
  - Gate 1 parser-consistency: 104,776 / 52,388 / 52,388 matches CAL-001's published battery verbatim (CALIBRATION.md lines 280-285); 200 drift-discarded also matches. PASS.
  - Gate 2 join-direction: winRate 0.9869 (n=686) UP / 0.9777 (n=719) DOWN — both > 0.9, both n ≥ 30. PASS.
  - Gate 3 E14-analog: non-empty (n=519/516, consistent with CAL-001's 520/516 under pair-conditioning), z = −1.03 / −0.59, |z| < 3.37; amendment #3 empty-abort not triggered. PASS.
  - Reserve confirmation: applies only to candidates per the frozen text; zero candidates → correctly not run, reserve unspent. Sub-window consistency correctly never evaluated (no cell cleared the positive bar). PASS.
  - Wording obligations: per-pair coverage fractions stated and arithmetically correct (8112/8133 = 0.997 … 3770/8133 = 0.464); NEG-FLAG's cross-side cell explicitly treated as non-independent shared-sample evidence; thin-cell nulls framed as power statements with n ranges; mirror-deviant caveat present and matches CAL-001's two disclosed deviants (1764846000/850, 1771651800/300); no venue-level efficiency claim for excluded markets. PASS.
  - Interpretation consistency: "continuation exists gross but smaller than spread+fee" is supported — UP dn2 d is negative at every pair from 300s on while the mirrored DOWN dn2 nets are at most +0.75c with z ≤ +1.75. PASS (one prose figure imprecise, see reservations).
  - EDGE-SPACE tightening scope: correctly limited to "single-segment move sign/size (this scan)" and explicitly keeps the sub-power window open — does not exceed what was measured. PASS.

- reservations: (1) The verdict's "nets only +0.31c to +0.75c" does not exactly match the table: the positive DOWN dn2 nets are +0.34c / +0.75c / +0.37c (re-derived unrounded ≈ +0.34c and +0.36c), and the 300-450 DOWN dn2 cell in the cited "from 300s on" pattern actually nets −0.13c — a minor transcription/range slip that if anything understates how null the cross-side cell is; not verdict-changing. (2) The Results cite the tool at commit f5d9aa3 as "the audited pre-read commit," but the audit reviewed 9cb4940; f5d9aa3 is the post-audit amended commit (amendments documented as frozen pre-read, so acceptable, but the adjective is loose). (3) The one-shot rule is honor-system by design; I verified internal consistency of the printed output, not the run itself.

_Erratum (accepting Judge reservations 1-2): the verdict's cross-side net
range should read "+0.34c to +0.75c, with the 300-450 DOWN dn2 cell at
−0.13c" — conservative wrt the null; and "the audited pre-read commit"
should read "the post-audit amended commit f5d9aa3 (audit reviewed
9cb4940; amendments frozen pre-read)"._

_Post-verdict reproduction note (U60, session 50, 2026-07-11): the
published discovery read above was reproduced byte-identically — same
tool (calib2.ts, unchanged since read commit f5d9aa3 per git log), same
command (`npx tsx fable-lab/tools/calib2.ts
fable-lab/logs/CAL-001-discovery-v3.log`), current DB state — and the
77-line output diffs clean against the verbatim block above. CAL-002 had
no raw output capture (the block above was the only record); it is now
proven a faithful transcription. One-shot rule: this is verification of a
closed null against its own published bytes, not a second read — nothing
it can show steers any decision (U47 calib.ts precedent; CAL-004's
deterministic-completion reasoning)._
