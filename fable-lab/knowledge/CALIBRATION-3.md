# CAL-003 — two-segment path calibration: consecutive-move shape × entry side

_Registered session 42 (U44), DECISIONS D26. Method frozen in the
registration commit BEFORE any two-segment statistic is computed. Data:
the already-integrity-verified CAL-001 discovery log — zero new replay
compute for discovery. Analysis tool: `tools/calib3.ts` (one-shot)._

## Why this study exists (motivating evidence)

E21 (CAL-002, null-confirmed) closed the single-segment conditional layer
and left a specific, coherent structure on the table: after the UP mid
falls ≥ 2c in one segment, the post-move UP ask is stale-high ≈ 1.5-2.4c
gross at every pair from 300s on — 2-2.4c at the late pairs (UP dn2 z:
−2.23, −3.00, −3.72, −2.90; gross d 1.51/1.92/2.43/2.25c),
but the tradable mirror (buy DOWN at its ask) nets at most +0.75c —
continuation is real gross and inside spread + fee net. EDGE-SPACE §4's
tightened taker bar explicitly names **multi-segment paths** as an escape
that goes beyond single-segment move sign/size.

_(Amendment #3, pre-read: the range above originally read "≈ 2-2.4c
gross at every pair from 300s on" — the published gross d values are
1.51c / 1.92c / 2.43c / 2.25c, so it is ≈ 1.5-2.4c from 300s on and
2-2.4c only at the late pairs. Corrected before any read.)_

CAL-003 asks the next question that evidence poses: does PATH SHAPE over
two consecutive segments concentrate the continuation? If the mispricing
is momentum-driven, persistence paths (two consecutive big same-sign
moves) should carry more of it than the single-segment marginal, and
reversal paths less. A ~1.5-2× concentration in the persistence cells
would push the tradable side past the cost floor — that is the specific,
falsifiable stake.

**A-priori hypothesis (recorded before any read, does not change the
bar):** the most likely candidate cells are buy-DOWN, shape dn-dn, at the
two late triples ((450-600,600-750) and (600-750,750-850)) — the region
where E21's continuation was strongest. The scan itself stays symmetric:
all 40 cells, one bar. If the hypothesis is wrong and some other cell
clears the bar, it is treated identically (Bonferroni + reserve
confirmation).

## Data (frozen)

- Log: `fable-lab/logs/CAL-001-discovery-v3.log` — the completed CAL-001
  discovery run (8,516 markets < 2026-03-01; integrity battery green, see
  CALIBRATION.md Results). No new engine run for discovery.
- Outcome join: `telonex_markets.result_id` by slug via
  `src/db/telonexMarkets.ts` (`'0'` → UP won, `'1'` → DOWN won),
  identical to calib.ts / calib2.ts.
- Probe reserve (CONFIRMATION data, untouched by discovery): the 5,460
  eligible markets in [2026-03-01, holdout boundary 1777237200000), as
  reserved at CAL-001 registration.
- Holdout: untouched, locked, unaffected by this study.

## Instrument (derived, frozen)

From each market's `[diag-calib]` lines (same grammar as calib.ts):

- calib.ts's exact validity pipeline per (slug, asset, offset):
  first-occurrence dedupe, drift filter `ts < next offset` (NEXT_BOUND
  900s after 850).
- UP mid at offset o: `mid(o) = (bid_UP(o) + ask_UP(o)) / 2`. As in
  CAL-002, no DOWN-derived move is computed (mirror books; the two known
  mirror deviants are ≤ 2 markets in 52,388 — immaterial, caveat
  inherited below).
- A TRIPLE (t0, t1, t2) of consecutive offsets defines two segments:
  `s1 = mid(t1) − mid(t0)`, `s2 = mid(t2) − mid(t1)`. Defined only when
  ALL THREE offsets have valid UP lines.
- Per-segment sign class, frozen from the SAME ±0.02 edges as CAL-002's
  big-move buckets (tick size + published median spread; FP edge
  behavior therefore in the same audited class):
  - `dn`: move ≤ −0.02
  - `up`: move ≥ +0.02
  - `mid`: −0.02 < move < +0.02
- SHAPES scanned (4): dn-dn, dn-up, up-dn, up-up — both segments big.
  Entries where EITHER segment is `mid` are counted and EXCLUDED from
  the scan. Rationale, from PUBLISHED numbers only (CAL-002 Results):
  the move distribution is strongly bimodal — dn2/up2 hold ~90% of
  single-segment entries. _(Amendment #2, pre-read: the original text
  claimed mid-involved cells "would sit at n ≈ 15-60" — not derivable
  from published numbers. Correct derivation under independence from
  published bucket fractions: single-mid shape cells ≈ 180-380, mid-mid
  ≈ 15-80. The exclusion rests on the resolvable-|d| bar, not on that
  figure: even at n ≈ 300 a mid-involved cell resolves only |d| ≈ 8-9c
  against effects measured at 1.5-2.4c.)_ Scanning only the powered
  region is disclosed, and the excluded region remains formally open
  (sub-power window, EDGE-SPACE §4).
- Entry: buy side S ∈ {UP, DOWN} at `ask_S(t2)` from side S's valid line
  at t2, requiring `ask_S(t2) ∈ [0.02, 0.995]` (same band as CAL-001/002).
- Win: side S resolves as winner per result_id.

## Grid (k = 40 cells, frozen)

- TRIPLES (5): (30,150,300), (150,300,450), (300,450,600),
  (450,600,750), (600,750,850).
- SHAPES (4): dn-dn, dn-up, up-dn, up-up.
- SIDES (2): buy-UP, buy-DOWN.
- k = 5 × 4 × 2 = 40. No price-level dimension: price is absorbed by the
  statistic, as everywhere since EXP-001.

## Statistic and decision rule (frozen — identical formulas to CAL-001/002)

Per cell: `d = winRate − meanAsk`;
`fee = winRate · 0.0156 · min(meanAsk, 1−meanAsk) / meanAsk`;
`net = d − fee`; `se = sqrt(Σ a(1−a)) / n`; `z = d / se`.

- **CANDIDATE cell**: `net > 0` AND `z ≥ 3.26` (one-sided
  tail(3.26) ≈ 5.57e-4 ≤ 0.023/40 = 5.75e-4 — same total-α convention as
  CAL-001/002. _Amendment #1, pre-read: originally 3.25, whose tail
  5.77e-4 slightly EXCEEDS α/k — anti-conservative; raised to 3.26
  before any read._) AND minority-outcome count ≥ 30 (D13) AND `d > 0`
  in all three CAL-001 sub-windows (→2025-12-31, 2026-01, 2026-02, UTC
  by slug epoch) — else demoted `subwindow-inconsistent`, not citable.
- **NEG-FLAG cell**: `z ≤ −3.26`; minority < 30 → annotated
  `underpowered-E14`, no motivating weight.
- **Anything else**: on-diagonal within power.
- **Dependence (binding, CAL-002 amendments #12/#13 logic):** buy-DOWN
  cells share samples with their buy-UP reflections — ONE piece of
  evidence. Adjacent triples share two offsets AND the same market
  outcomes; overlapping-sample cells are never independent
  confirmations. Additionally every CAL-003 cell is a sub-selection of
  a CAL-002 cell's samples: a CAL-003 deviation is a refinement of
  E21's published structure, not new independent evidence of it.

### Confirmation requirement (BINDING — the discovery table cannot be cited alone)

CAL-003 is the THIRD study on this log, and the designer has seen both
CAL-001's marginals AND CAL-002's single-segment conditional tables
(disclosure: that is exactly why dn-dn is the anticipated cell — the
hypothesis is derived from published structure; no TWO-segment statistic
of any kind has been computed before this freeze). Discovery candidates
are therefore HYPOTHESIS-GENERATING ONLY. Before any citation under
EDGE-SPACE §4 or any EXP registration, a candidate cell must REPLICATE
on the probe reserve:

1. a new diag-calib instrument run over the reserve window
   [2026-03-01, boundary−1] (committed code, detached, integrity battery
   per D23), then
2. a one-shot calib3.ts read of the reserve log
   (`--expect-totals <lines>,<perSide>` mode, judged at the SAME bar
   `net > 0 ∧ z ≥ 3.26 ∧ minority ≥ 30` on the pre-named candidate cells
   only — sub-window consistency does not apply to the reserve, CAL-002
   amendment #1 semantics, built in from registration).

A candidate that fails reserve confirmation is dead (noise mined from a
reused log). Any experiment registered from a CONFIRMED candidate
carries `lineage_cells = 40` (plus CAL-002's 60 if the cell refines an
E21 structure — the lineage is cumulative across studies on this log).
The holdout stays locked regardless.

## Instrument validation gates (frozen; abort before reading the table)

1. **Parser consistency:** calib3.ts's line parse of the discovery log
   must reproduce the published CAL-001 totals exactly — 104,776
   well-formed sample lines, 52,388 per side. Mismatch → ABORT.
2. **Gate-reproduction (NEW, mechanical):** the join-direction and
   E14-analog gate pools are derived EXACTLY as calib2.ts derived them
   (pair (750,850) conditioned — NOT triple-conditioned; pooled over
   move buckets). On the discovery log their printed values must equal
   CAL-002's published gate values EXACTLY: join-direction tail
   winRate 0.9869 n=686 (UP) / 0.9777 n=719 (DOWN); E14-analog control
   z=−1.03 n=519 (UP) / −0.59 n=516 (DOWN). Any mismatch → ABORT
   (derivation drift between tools). This check is hard-coded in
   discovery mode; reserve mode falls back to CAL-002's threshold gates
   (n ≥ 30, winRate > 0.9; |z| < 3.26; empty control on a real log →
   ABORT).
3. **Join-direction / E14-analog thresholds:** as in CAL-002 (subsumed
   by gate 2 on the discovery log; binding on the reserve).

## Coverage / conditioning (binding wording)

Every cell conditions on valid book events at ALL THREE triple offsets
(and the entry side's line at t2) — strictly tighter than CAL-002's pair
conditioning. CAL-001 measured late-offset attrition (750s → 0.8746,
850s → 0.5993); the late triples inherit roughly the triple
intersection. calib3.ts prints per-triple market counts per side; any
verdict wording citing a triple must state its coverage fraction and
must NOT claim venue-level (in)efficiency for excluded quiet markets.

## Power (recorded at registration, from PUBLISHED numbers only)

Two-segment cell sizes have never been computed. Bounds from CAL-002's
published single-segment ns: dn2 at 600-750 had n = 2,708 and at 750-850
n = 1,673; the dn-dn subsets are those entries whose PREVIOUS segment was
also dn — an unknown persistence fraction. If persistence is 30-60%, the
loaded late cells land at n ≈ 500-1,600. At meanAsk ≈ 0.21 the candidate
bar in cents is ≈ 3.26·se: ~5.9c at n = 500, ~4.2c at n = 1,000, ~3.3c at
n = 1,600. BINDING consequence, recorded now: this scan can only detect a
path-concentration of the E21 continuation to ≳ 3.3-6c gross in the
loaded cells (vs 2.4c unconditional). A null therefore does NOT exclude a
persistent-path edge in the ~1.5-3c band; it is a power statement there,
and the verdict must say so. Reversal cells (dn-up, up-dn) are plausibly
thinner still; their nulls are power statements a fortiori.

## Disclosures

- THIRD reuse of the discovery log; published statistics seen by the
  designer: CAL-001 marginal tables, CAL-002 single-segment conditional
  tables, both gate printouts. No two-segment statistic (no persistence
  fraction, no path-conditional win rate, no cell n) has been computed
  before this freeze. Protection: frozen a-priori grid + Bonferroni at
  k = 40 + the BINDING reserve confirmation.
- One-shot rule: calib3.ts runs ONCE on the discovery log; honor-system
  + git audit trail.
- calib3.ts is validated mechanically on a SYNTHETIC fixture with
  hand-computable expected output (`tools/calib3-selftest.ts`,
  committed) before the one-shot; never tested against the real log.
- Mirror-deviant caveat (CAL-002 amendment #2 inherited): triples
  touching off=300 or off=850 carry the two known deviants' ≤ 1-market
  exposure each; immaterial at these n but cited wording inherits it.
- FP edge assignment (CAL-002 amendment #4 inherited): segment moves are
  float differences of 4-dp mids at the same ±0.02 edges; deterministic,
  direction-agnostic; the selftest documents actual FP behavior at the
  edges on both segments.
- No engine run, no DB write, no order of any kind in discovery; a
  reserve confirmation (if reached) is a standard detached local
  `--sequential` instrument run under D8 latency pinning.

## Amendments (pre-read, 2026-07-10 — audit-motivated, frozen before any read)

A fresh-context adversarial audit reviewed this registration and the tool
before the one-shot (verdict sound-with-findings, all findings minor;
report verbatim in `knowledge/AUDIT-2026-07-10-CAL-003-REG.md`). All
findings acted on with NO result read:

1. **(finding 1) Bar raised 3.25 → 3.26** in the registration and
   calib3.ts: tail(3.25) ≈ 5.77e-4 slightly exceeds α/k = 5.75e-4
   (anti-conservative, breaking the CAL-001/002 convention);
   tail(3.26) ≈ 5.57e-4 clears it. Selftest's designed candidate
   (z = +5.14) and NEG-FLAG (z = −5.69) unaffected.
2. **(finding 2) Mid-cell power figure corrected in-place** (the "n ≈
   15-60" claim was not derivable from published numbers; single-mid
   cells land ≈ 180-380 under independence, mid-mid ≈ 15-80; the
   exclusion rationale now rests on the resolvable-|d| bar). The same
   figure in DECISIONS D26 carries a pointer to this amendment.
3. **(finding 3) Motivating-evidence range corrected in-place** ("2-2.4c
   at every pair from 300s on" → "1.5-2.4c from 300s on, 2-2.4c at the
   late pairs" with the published gross d values quoted) — the E21-Judge
   reservation-1 defect class, caught pre-read this time.
4. **(finding 4) Vacuous selftest assertion replaced**: the
   gate-reproduction-not-claimed-on-synthetic check used a negated
   lookahead that could not cross newlines (could never fail on
   multi-line output); now a string-negation function. Selftest re-run
   green after the change.
5. **(finding 5, recorded assumption — no code change) Gate-reproduction
   assumes a stable DB**: the hard-coded CAL-002 gate values embed
   `telonex_markets.result_id` as of CAL-002's read (2026-07-10). Any DB
   mutation on a joined slug makes gate 2 ABORT spuriously — the abort
   fires before any cell table prints, so it is recoverable without a
   protocol breach. The eight GATE_EXPECT constants were hand-verified
   by the auditor against CAL-002's published Results.

## Results

_(append-only below this line; nothing here until calib3.ts runs ONCE on
the discovery log)_


### Discovery read (2026-07-10, one-shot on CAL-001-discovery-v3.log)

Tool: `tools/calib3.ts` at the post-audit amended commit a505f1d (audit
reviewed f5e6164; amendments frozen pre-read); selftest 21/21 green at
that commit; run ONCE per the one-shot rule. Full output verbatim:

```
gate parser-consistency: OK (lines=104776, UP=52388, DOWN=52388)
parsed 8133 markets with any valid sample (200 drift-discarded lines)
derived 55320 path entries (4050 dropped: entry ask outside [0.02,0.995]; 12532 excluded: mid segment)
per-triple market coverage UP (pre-shape): t30-150-300=8094 t150-300-450=8061 t300-450-600=7764 t450-600-750=6228 t600-750-850=3770
per-triple market coverage DOWN (pre-shape): t30-150-300=8094 t150-300-450=8059 t300-450-600=7776 t450-600-750=6232 t600-750-850=3774
outcome joined for 8012/8012 scan markets (0 missing/unresolved — excluded)
gates UP: join-direction OK (pooled 750-850 tail winRate=0.9869, n=686); E14-analog control OK (net=-0.0112 z=-1.03 n=519); gate-reproduction OK (matches CAL-002 published)
gates DOWN: join-direction OK (pooled 750-850 tail winRate=0.9777, n=719); E14-analog control OK (net=-0.0068 z=-0.59 n=516); gate-reproduction OK (matches CAL-002 published)

CAL-003 UP-side cell table (k=40 total, candidate bar z>=3.26, minority>=30, fee=winRate*0.0156*min(a,1-a)/a, sub-window consistency required)
triple       shape      n     meanAsk winRate      d     fee     net      se      z  minor  flag
30-150-300   dn-dn   1748  0.2407  0.2248 -0.0159 0.0035 -0.0194 0.0099  -1.61    393  
30-150-300   dn-up   1541  0.5508  0.5406 -0.0103 0.0069 -0.0172 0.0120  -0.86    708  
30-150-300   up-dn   1496  0.4610  0.4646 +0.0036 0.0072 -0.0037 0.0122 +  0.29    695  
30-150-300   up-up   1855  0.7689  0.7585 -0.0104 0.0036 -0.0139 0.0094  -1.10    448  
150-300-450  dn-dn   1853  0.1959  0.1797 -0.0162 0.0028 -0.0190 0.0086  -1.88    333  
150-300-450  dn-up   1407  0.5586  0.5544 -0.0042 0.0068 -0.0110 0.0119  -0.35    627  
150-300-450  up-dn   1461  0.4605  0.4456 -0.0149 0.0070 -0.0219 0.0117  -1.27    651  
150-300-450  up-up   1973  0.8138  0.8003 -0.0135 0.0029 -0.0164 0.0082  -1.66    394  
300-450-600  dn-dn   1812  0.1583  0.1391 -0.0193 0.0022 -0.0214 0.0078  -2.48    252  
300-450-600  dn-up   1287  0.5901  0.5680 -0.0221 0.0062 -0.0283 0.0117  -1.88    556  
300-450-600  up-dn   1263  0.4341  0.4125 -0.0216 0.0064 -0.0280 0.0120  -1.80    521  
300-450-600  up-up   1939  0.8556  0.8520 -0.0036 0.0022 -0.0058 0.0072  -0.50    287  
450-600-750  dn-dn   1439  0.1327  0.1147 -0.0181 0.0018 -0.0199 0.0079  -2.30    165  
450-600-750  dn-up    974  0.6306  0.6324 +0.0018 0.0058 -0.0040 0.0125 +  0.14    358  
450-600-750  up-dn    981  0.3956  0.3517 -0.0439 0.0055 -0.0494 0.0127  -3.47    345  NEG-FLAG
450-600-750  up-up   1579  0.8899  0.8778 -0.0121 0.0017 -0.0138 0.0069  -1.75    193  
600-750-850  dn-dn    886  0.1133  0.0914 -0.0219 0.0014 -0.0233 0.0094  -2.32     81  
600-750-850  dn-up    622  0.6706  0.6752 +0.0047 0.0052 -0.0005 0.0144 +  0.32    202  
600-750-850  up-dn    652  0.3462  0.3282 -0.0180 0.0051 -0.0231 0.0143  -1.26    214  
600-750-850  up-up    883  0.8969  0.8947 -0.0022 0.0016 -0.0038 0.0087  -0.26     93  

CAL-003 DOWN-side cell table (k=40 total, candidate bar z>=3.26, minority>=30, fee=winRate*0.0156*min(a,1-a)/a, sub-window consistency required)
triple       shape      n     meanAsk winRate      d     fee     net      se      z  minor  flag
30-150-300   dn-dn   1748  0.7707  0.7752 +0.0044 0.0036 +0.0008 0.0097 +  0.46    393  
30-150-300   dn-up   1541  0.4609  0.4594 -0.0014 0.0072 -0.0086 0.0120  -0.12    708  
30-150-300   up-dn   1496  0.5508  0.5354 -0.0154 0.0068 -0.0222 0.0122  -1.27    695  
30-150-300   up-up   1855  0.2427  0.2415 -0.0012 0.0038 -0.0050 0.0096  -0.13    448  
150-300-450  dn-dn   1856  0.8157  0.8206 +0.0049 0.0029 +0.0020 0.0084 +  0.58    333  
150-300-450  dn-up   1407  0.4532  0.4456 -0.0075 0.0070 -0.0145 0.0120  -0.63    627  
150-300-450  up-dn   1461  0.5515  0.5544 +0.0029 0.0070 -0.0041 0.0117 +  0.25    651  
150-300-450  up-up   1973  0.1977  0.1997 +0.0020 0.0031 -0.0011 0.0084 +  0.24    394  
300-450-600  dn-dn   1835  0.8550  0.8627 +0.0077 0.0023 +0.0054 0.0074 +  1.04    252  
300-450-600  dn-up   1286  0.4222  0.4323 +0.0101 0.0067 +0.0034 0.0118 +  0.86    556  
300-450-600  up-dn   1263  0.5779  0.5875 +0.0095 0.0067 +0.0029 0.0119 +  0.80    521  
300-450-600  up-up   1920  0.1573  0.1495 -0.0078 0.0023 -0.0102 0.0076  -1.04    287  
450-600-750  dn-dn   1475  0.8824  0.8881 +0.0058 0.0018 +0.0039 0.0073 +  0.79    165  
450-600-750  dn-up    971  0.3838  0.3687 -0.0151 0.0058 -0.0208 0.0126  -1.19    358  
450-600-750  up-dn    983  0.6190  0.6490 +0.0301 0.0062 +0.0238 0.0125 +  2.40    345  
450-600-750  up-up   1557  0.1235  0.1240 +0.0005 0.0019 -0.0014 0.0074 +  0.07    193  
600-750-850  dn-dn    893  0.9019  0.9093 +0.0074 0.0015 +0.0059 0.0087 +  0.85     81  
600-750-850  dn-up    618  0.3493  0.3269 -0.0224 0.0051 -0.0275 0.0147  -1.52    202  
600-750-850  up-dn    653  0.6723  0.6723 +0.0000 0.0051 -0.0051 0.0140 +  0.00    214  
600-750-850  up-up    878  0.1181  0.1059 -0.0122 0.0017 -0.0138 0.0094  -1.29     93  

CANDIDATE cells: none
NEG-FLAG / demoted cells: UP (450-600-750, up-dn) NEG-FLAG
```

### Verdict (frozen decision rule, k = 40)

**NULL for candidates — zero CANDIDATE cells. One NEG-FLAG: UP
(450-600-750, up-dn), z = −3.47, minority = 345 (fully powered).**

- All gates passed before the tables were read: parser-consistency exact
  (104,776 / 52,388 / 52,388); join-direction pooled (750,850) tail
  winRate 0.9869 (UP, n=686) / 0.9777 (DOWN, n=719); E14-analog controls
  on-diagonal (z = −1.03 / −0.59, n = 519 / 516); and the NEW
  gate-reproduction check matched CAL-002's published values EXACTLY on
  both sides — no derivation drift between calib2.ts and calib3.ts.
- No cell on either side reaches z ≥ +3.26; the largest positive is DOWN
  (450-600-750, up-dn) at z = +2.40 (net +0.0238). Sub-window
  consistency was never evaluated (no cell cleared the positive bar).
  The reserve confirmation stage is NOT triggered; the probe reserve
  stays unspent.
- **A-priori hypothesis check (recorded at registration): NOT
  supported.** The anticipated candidates — buy-DOWN, dn-dn, late
  triples — sit at net +0.39c (z +0.79, n=1,475) and +0.59c (z +0.85,
  n=893): persistence does NOT concentrate the E21 continuation. The
  UP-side dn-dn gross d (−1.6c to −2.2c across triples) is
  approximately the UNCONDITIONAL single-segment dn2 staleness; the
  preceding segment's direction adds nothing on the persistence side.
- **The NEG-FLAG and its economics (binding cross-side wording):** UP
  (450-600-750, up-dn) — buying UP at the ask after a big up-segment
  (450→600s) followed by a big down-segment (600→750s) — loses 4.39c
  gross (winRate 0.3517 vs meanAsk 0.3956, n = 981), net −4.94c. This
  is a REVERSAL-shape refinement of E21's continuation: when the
  down-move follows an up-move, the post-move UP ask is nearly twice as
  stale (−4.39c) as the unconditional single-segment figure (−2.43c at
  600-750, E21). The tradable expression — buying DOWN at its ask, the
  SAME book samples with complementary outcomes, NOT independent
  evidence — nets +2.38c (z = +2.40, n = 983): positive, the largest
  net in the table, but BELOW the corrected candidate bar (needs
  z ≥ 3.26; at this cell's se the bar is ≈ +4.1c gross d, observed
  +3.01c). Under the frozen rule this cell has NO citable status: it is
  on-diagonal within power, and the binding reserve-confirmation path
  exists only for bar-clearing candidates. Any future use of this
  structure is hypothesis-generating only and must clear EDGE-SPACE §4
  on its own instrument.
- **Coverage conditioning (binding):** cells condition on valid book
  events at ALL THREE triple offsets; per-triple UP coverage of the
  8,133 sampled markets: 30-150-300 → 0.995, 150-300-450 → 0.991,
  300-450-600 → 0.955, 450-600-750 → 0.766, 600-750-850 → 0.464. The
  NEG-FLAG triple carries 0.766; no venue-level claim is made for
  excluded quiet markets.
- **Power (binding wording):** loaded cells sit at n ≈ 600-2,000; at
  their meanAsks the candidate bar corresponds to ≈ 2.4-4.7c gross.
  Nulls below that are power statements, not efficiency proofs — in
  particular the DOWN up-dn mirror (+3.01c gross at a ≈ 4.1c bar) and
  all dn-up cells. 12,532 mid-involved entries were excluded by the
  frozen shape rule and 4,050 dropped out-of-band; the excluded region
  remains formally open (sub-power window, EDGE-SPACE §4).
- Mirror-deviant caveat (inherited): triples touching off=300 or
  off=850 carry the two known deviants' ≤ 1-market exposure each;
  immaterial at these n.

**Interpretation:** within stated power, two-segment path shape adds no
taker-exploitable signal that clears the bar on either side at any of
the five triple horizons. The persistence hypothesis is dead on this
data. The one significant deviation is again buyer-ADVERSE and again a
continuation refinement (E16/E17/E21 pattern): a big down-move that
REVERSES a prior big up-move leaves the UP ask ≈ 4.4c stale-high — the
strongest gross staleness measured in this program — but its tradable
mirror (+2.38c net, z +2.40) is statistically below the corrected bar
on this sample. Directional continuation exists gross at reversal
shapes; the measured evidence does not license a claim that it is
tradable net.

**Consequence:** no EXP registration, no reserve spend. E22 records the
closure; EDGE-SPACE §4's taker bar tightens from "beyond single-segment
move sign/size" to conditional structure beyond one- AND two-segment
sign paths at these horizons (this scan), with the sub-power window —
now concretely including the up-dn reversal mirror at ≈ +2.4c net,
z +2.40 — still formally open.

### Fresh-context Judge verdict (appended verbatim)

**decision: null-confirmed**

**basis:** The frozen rule (CANDIDATE: `net > 0 ∧ z ≥ 3.26 ∧ minority ≥ 30 ∧ sub-window consistency`, k = 40; NEG-FLAG: `z ≤ −3.26`) yields zero CANDIDATE cells on my independent scan of both printed tables — the largest positive anywhere is DOWN (450-600-750, up-dn) at z = +2.40 (net +0.0238), and even under display-rounding its z window is [2.39, 2.42], nowhere near 3.26 — and exactly one NEG-FLAG, UP (450-600-750, up-dn), whose z window under rounding is [−3.47, −3.44], safely past −3.26, with minority 345 (correctly not annotated underpowered-E14). All three pre-read gates pass as frozen, including the new mechanical gate-reproduction check whose eight printed values match CAL-002's published gate line character-for-character (0.9869/686, 0.9777/719, −0.0112/−1.03/519, −0.0068/−0.59/516). Sub-window consistency was correctly never evaluated (it attaches only to bar-clearing candidates), the reserve stage is correctly untriggered, and every BINDING wording obligation in the registration is discharged in the verdict draft. The a-priori dn-dn hypothesis is honestly reported as not supported by its own registered numbers. Null-confirmed follows from the recorded numbers with no skipped obligation.

**checks:**
- **Full 40-cell scan, UP table:** max positive z = +0.32 (600-750-850, dn-up); only cell at z ≤ −3.26 is 450-600-750 up-dn at −3.47 (next most negative −2.48). No missed candidate, no missed or spurious NEG-FLAG. PASS.
- **Full 40-cell scan, DOWN table:** max z = +2.40 (450-600-750, up-dn), min z = −1.52 (600-750-850, dn-up). No candidate, no flag — matches the printed summary lines. PASS.
- **NEG-FLAG arithmetic (UP 450-600-750 up-dn):** wins = round(0.3517·981) = 345 = minority ✓; d = 345/981 − 0.3956 = −0.04392 → −0.0439 ✓; fee = winRate·0.0156 (a < 0.5 so min(a,1−a)/a = 1) = 0.00549 → 0.0055 ✓; net = −0.0494 exact ✓; z = −3.458, printed −3.47 within the rounding window [−3.474, −3.439], and the entire window clears −3.26 — the flag is rounding-robust. PASS.
- **Mirror arithmetic (DOWN 450-600-750 up-dn):** wins = 638, minority = 345 ✓ (consistent with the UP side: 636 UP-losses + 2 extra DOWN-only markets, both DOWN-wins — the n asymmetry 981/983 is coherent with side-specific t2 entry-line/band validity); d = +0.03003 → +0.0301 ✓; fee = 0.6490·0.0156·(0.381/0.619) = 0.00623 ✓; net = +0.0238 exact ✓; z = +2.403 ✓. The verdict's "bar ≈ +4.1c gross at this se" re-derives as 3.26·0.0125 = 4.08c ✓. PASS.
- **A-priori cells (DOWN dn-dn):** 450-600-750: d = +0.00574, fee = 0.00185, net = +0.00389, z = 0.786 → printed +0.0058/0.0018/+0.0039/+0.79 ✓; 600-750-850: d = +0.00739, fee = 0.00154, net = +0.00585, z = 0.850 → printed ✓. Verdict draft's "+0.39c (z +0.79, n=1,475)" and "+0.59c (z +0.85, n=893)" are exact transcriptions. PASS.
- **Two additional cells:** UP 30-150-300 dn-dn (d −0.01587, fee 0.00351, net −0.01938, z −1.603 ≈ −1.61, minority 393 ✓) and DOWN 300-450-600 dn-up (d +0.01015, fee 0.00674, net +0.0034, z 0.860 ✓, minority 556 ✓). All within display rounding. PASS.
- **Gate 1 (parser):** 104,776 / 52,388 / 52,388 — exact match to the frozen CAL-001 totals in the registration. PASS.
- **Gate 2 (gate-reproduction):** all eight printed values identical to CAL-002's published Results lines (verified against CALIBRATION-2.md directly). PASS.
- **Gate 3 (thresholds):** join-direction winRates 0.9869/0.9777 > 0.9, n = 686/719 ≥ 30; E14-analog |z| = 1.03/0.59 < 3.26, controls non-empty. PASS (subsumed by gate 2, as registered).
- **Count identities:** both tables' n sum to exactly 55,320 = the printed "derived path entries" (UP 27,651 + DOWN 27,669); coverage fractions re-derive as 8094/8133 = 0.9952, 8061 → 0.9911, 7764 → 0.9546, 6228 → 0.7658, 3770 → 0.4635 — verdict's 0.995/0.991/0.955/0.766/0.464 exact; every triple coverage ≤ the min of its constituent CAL-002 pair coverages (e.g. t450-600-750 UP 6228 ≤ min(7768, 6232); t600-750-850 UP 3770 ≤ 3770). PASS (one wording ambiguity, reservation 1).
- **Binding wording obligations:** coverage fractions stated with the NEG-FLAG triple's 0.766 named; cross-side non-independence stated ("SAME book samples… NOT independent evidence"); power framing present with the sub-power window explicitly open; mirror-deviant caveat inherited; no venue-level claim for excluded markets; reserve correctly unspent; a-priori failure reported with correct numbers; DOWN up-dn z=+2.40 explicitly given NO citable status and confined to hypothesis-generation. PASS.
- **Verdict-draft transcription:** −4.39c gross / net −4.94c / winRate 0.3517 / meanAsk 0.3956 / n=981 / minority 345; "UP dn-dn gross d −1.6c to −2.2c" (table: −1.59 to −2.19); "nearly twice" the E21 unconditional −2.43c (600-750 dn2, confirmed in CALIBRATION-2.md; ratio 1.81); 12,532 mid-excluded / 4,050 band-dropped match the log. PASS.
- **Consequence paragraph:** power-scoped ("within stated power" leads the interpretation; nulls called power statements; the +2.4c mirror named as concretely inside the still-open sub-power window); the taker-bar tightening is scoped to "these horizons (this scan)"; no tradable-net claim is made for the gross staleness. The persistence-hypothesis "dead on this data" is licensed by point estimates, not just power: conditional dn-dn gross d (+0.57c/+0.74c) is at or below E21's unconditional dn2 DOWN d (+1.09c at 600-750) — no concentration, opposite of the hypothesized 1.5-2×. PASS.

**reservations:**
1. The output line "derived 55320 path entries (4050 dropped…; 12532 excluded…)" is ambiguous: read subtractively it implies 38,738 scanned entries, contradicting the tables; the tables sum to exactly 55,320, so 55,320 must be the post-drop, post-exclusion scan count with the parenthetical counts additional. Internally consistent under only one reading; the tool's wording should not require the reader to resolve this by summation.
2. The power bullet's "candidate bar ≈ 2.4-4.7c gross" is slightly narrow at both ends: over the printed ses, 3.26·se spans 2.25c (UP up-up 450-600-750, se 0.0069) to 4.79c (DOWN dn-up 600-750-850, se 0.0147). Approximate and directionally honest, but the true span is a touch wider on both sides; not verdict-affecting.
3. "The strongest gross staleness measured in this program" (−4.39c): verified larger than any CAL-002 cell (max |d| there 2.89c) and any CAL-003 cell, but I did not re-open CAL-001's marginals or the E14-E19 outputs to confirm program-wide; plausible, not fully cross-checked.
4. The 8,133 parsed markets vs 8,012 outcome-joined "scan markets" gap (121 markets with valid samples but no surviving scan entry) is consistent with the drop/exclusion pipeline but not independently checkable from the printed output.
5. The one-shot rule remains honor-system: I verified internal consistency of the printed output and its exact agreement with predecessor publications, not that calib3.ts executed exactly once on the discovery log.

_Erratum (accepting Judge reservations 1-3): (1) the tool's
"derived N path entries" line reports the POST-drop, POST-exclusion scan
count (N = 55,320 = the table sums), with the parenthesized drop/exclusion
counts additional to it — matching the calib2.ts wording convention;
(2) the power bullet's bar span should read "≈ 2.3-4.8c gross" (computed
over the printed ses, 3.26·se spans 2.25c to 4.79c); (3) "strongest gross
staleness measured in this program" is scoped to the conditional scans
CAL-002/CAL-003 (max |d| elsewhere 2.89c); CAL-001's marginal extreme-price
cells are a different statistic family and are not compared._
