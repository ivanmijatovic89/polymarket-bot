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
