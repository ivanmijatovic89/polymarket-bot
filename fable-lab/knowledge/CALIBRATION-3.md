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
