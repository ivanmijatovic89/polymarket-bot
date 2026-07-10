# CALIBRATION — the (price × episode-time) calibration plane (CAL-001)

_Registered session 10 (U43), DECISIONS D21. Method frozen in this file
BEFORE any outcome is read; the commit that adds this file predates the
discovery run (spec-before-results, same discipline as experiments)._

## Why this study exists (motivating evidence)

1. **It audits the map's central generalization.** E12/E14 conclude
   "directional pricing is efficient at taker horizons across the episode
   clock" — a generalization from five *conditional* point measurements
   (tails at expiry, post-jump, first-minute, depth signal, dutch books).
   The unconditional (price × time) plane has never been measured as a
   whole. This study is verification depth on E12/E14 (the sanctioned work
   of the gated state, EDGE-SPACE §4 last paragraph).
2. **It is the only sanctioned source of a §4 taker citation.** EDGE-SPACE
   §4 requires any taker registration to "argue, from recorded-data
   evidence, a gross edge ≥ ~1.5c/share". No instrument in the lab can
   produce such evidence today; this one can — with multiplicity
   protection designed in, instead of ad-hoc mining.
3. **The fee floor is NOT uniform: extreme prices are nearly fee-free.**
   E10's ~1.5c floor holds at mid-range only. The taker fee is
   `156bps · min(p, 1−p)` (E3): at ask 0.95 it is ~0.08c/share, at ask
   0.05 ~0.08c. EXP-001 measured the high tail **at expiry only**
   (last-seconds certainty discount). Extreme prices at EARLY and MID
   window — where a deviation as small as ~0.5c/share would clear fees —
   are unmeasured territory, not a re-ask of E14.

## Method (frozen — do not tune after seeing data)

### Instrument

- Fixture `strategies/_fixtures/diag-calib.ts` (id `fable-diag-calib`),
  outcome-free: places no orders, reads no PnL, logs no outcome. It logs
  one line per (market, offset) at capture time: the FIRST uncrossed UP
  top-of-book (bestBid, bestAsk) observed at-or-after that episode-clock
  offset (both prices present, bestBid < bestAsk — the E6 crossed-book
  guard; crossed/incomplete ticks are skipped until the first clean one).
  Emission is immediate, not end-of-market buffered: the engine has no
  episode-end hook, so buffering would silently drop every market whose
  recording ends before the last offset (a selection effect).
- Offsets (seconds after slug-epoch window open): **30, 150, 300, 450,
  600, 750, 850**. Samples with ts ≥ epoch+900s are discarded (the 850
  sample must land inside the window).
- Outcomes enter ONLY in `tools/calib.ts`, which joins
  `telonex_markets.result_id` (0=UP; engine/CAPABILITIES.md §2) via
  `src/db/telonexMarkets.ts` and prints the WHOLE pre-registered cell
  table in a single invocation. No subset reads, no exploratory queries.

### Windows (E18-aware: all bounds quoted as the inclusive ms actually passed)

- **Discovery window:** eligible markets with
  `market_start_ms ≤ 1772323199999` (i.e. < 2026-03-01T00:00:00Z).
  Count at registration: **8,516**.
- **Reserved probe window:** `1772323200000 ≤ market_start_ms ≤
  1777237199999` (2026-03-01 → holdout boundary − 1). Count at
  registration: **5,460**. This study never touches it; any candidate
  cell that survives the decision rule must probe here (fresh data),
  never on discovery data.
- **Holdout:** untouched, locked, as always (boundary 1777237200000).
- Sample rule: ALL discovery-window markets (no --random, no
  subsampling), `--sequential`, latency pinned 0/0 (D8), detached (D10),
  committed code only. batchUid `CAL-001-discovery`.

### Grid (k = 63 cells)

- Rows: UP bestAsk buckets:
  `[0.02,0.10) [0.10,0.20) [0.20,0.35) [0.35,0.50) [0.50,0.65)
   [0.65,0.80) [0.80,0.90) [0.90,0.98) [0.98,0.995]`.
  Asks < 0.02 or > 0.995 are excluded (tick-granularity degenerate).
- Columns: the 7 offsets. One observation per (market, offset): the
  logged ask `a` and the market outcome `w` (1 if UP won).
- Per-cell statistics (all printed for every cell, one shot):
  `n`, `meanAsk`, `wins`, `winRate`, deviation `d = winRate − meanAsk`
  (= gross EV/share of buy-UP-at-ask), `fee = 0.0156·min(meanAsk,
  1−meanAsk)`, `net = d − fee`, H0-based standard error
  `se = sqrt(Σ aᵢ(1−aᵢ))/n`, `z = d/se`, minority-outcome count
  `min(wins, n−wins)`.

### Decision rule (frozen)

- **CANDIDATE cell** (may be cited under EDGE-SPACE §4 as recorded-data
  evidence for a taker registration): `net > 0` AND one-sided
  `p ≤ 0.023/63` (z ≥ 3.377) AND minority-outcome count ≥ 30 (D13).
- **NEGATIVE-FLAG cell**: `z ≤ −3.377`. Not directly tradable (no
  shorting; the DOWN side has its own book and spread) — a negative flag
  motivates a separately pre-registered DOWN-ask measurement, nothing
  more.
- **Anything else**: the cell is on-diagonal within power; the study
  output is the CI table itself (durable knowledge: the taker question
  closes plane-wide, within stated power, not just at five triggers).
- **Multiplicity travels:** any experiment registered from a candidate
  cell carries `lineage_cells = 63` (EPISTEMOLOGY §5 promotion tax); its
  decisive probe on the reserved window needs one-sided p ≤ 0.023/63.
- **Instrument validation gates (checked before reading anything else):**
  (a) join-direction check — cell (850s, [0.98,0.995]) must show
  winRate > 0.9, else the result_id join is suspect and the analysis
  aborts; (b) positive control — cells (850s, [0.90,0.98)) replicate
  EXP-001/E14 territory and are expected on-diagonal (|net| small); a
  large deviation there means instrument bug first, venue second.
- **Disclosure:** the smoke (≤10 markets, plumbing only) necessarily
  parses a handful of outcome joins when testing calib.ts; those markets
  are inside the discovery window and their statistics are meaningless at
  that N. No smoke number may be quoted.

### Power (recorded at registration, so "no candidates" is interpretable)

With H0 se = sqrt(Σa(1−a))/n: a cell with n = 2,000 mid-range
observations resolves |d| ≈ 3.377·0.011 ≈ 3.8c at the candidate bar —
mid-range cells are only powered for gross deviations far above the
1.5c fee floor (consistent with E9–E14: none expected). Extreme-price
cells are the real target: at meanAsk 0.95, n = 3,000 → se ≈ 0.004 →
candidate bar ≈ 1.3c; fee there ~0.08c. The study can therefore only
DISCOVER economically-relevant cells near the tails — exactly the
unmeasured low-fee region. A null result at mid-range is a power
statement, not proof of efficiency beyond what E9–E14 already measured.

## Amendments (pre-results, 2026-07-10 — audit-motivated, frozen before any read)

A fresh-context adversarial audit (verbatim report:
`knowledge/AUDIT-2026-07-10-CAL-001-REG.md`) reviewed this registration
while the first discovery launch was minutes old. Its findings were acted
on BEFORE any outcome was read; the first launch was KILLED (~500 markets
replayed, log discarded unanalyzed) because finding 1 made its log
unusable, and the run was relaunched on amended committed code with
batchUid `CAL-001-discovery-v2` (the `CAL-001-discovery` partial run row
in the DB is VOID — instrument defect, not result-based).

1. **(BLOCKER, finding 1) Capture time is now logged and filtered.** The
   fixture logs `ts=<elapsed seconds>` per sample. Frozen drift filter:
   a sample for offset o is valid only if `ts < next offset` (900s for
   850) — each column's samples must come from its own time segment;
   without this, one post-gap tick could stamp all 7 offsets with
   expiry-regime prices and the leak would be invisible. Discard counts
   are printed.
2. **(finding 2) The E14 positive control has a frozen numeric bar:**
   analysis ABORTS iff |z| ≥ 3.377 on cell (850s, [0.90,0.98)). No
   analyst discretion after seeing the table.
3. **(finding 3) Scope wording corrected:** a null result closes the
   **buy-UP taker half-plane** within stated power. The DOWN book has its
   own ask and spread and is NOT measured here; NEG-FLAG cells motivate a
   separately pre-registered DOWN-ask study, nothing more. Any LESSONS
   entry must use the half-plane wording.
4. **(finding 4) Fee formula frozen to the engine's share-denominated BUY
   fee:** `fee = winRate · 0.0156 · min(meanAsk, 1−meanAsk) / meanAsk`
   (src/trading/fees.ts:47 — fees are taken in shares; expected cost per
   intended share scales with the win rate).
5. **(finding 5) One-shot disclosure:** the single-read rule is
   honor-system + git audit trail (as E19's erratum precedent), not
   mechanical. Stated plainly here so nobody mistakes it.
6. **(finding 6) Serial-correlation guard, frozen:** a CANDIDATE cell must
   also show d > 0 in each of three fixed sub-windows (→2025-12-31,
   2026-01, 2026-02, UTC by slug epoch); otherwise it is demoted to
   "subwindow-inconsistent" and cannot be cited under EDGE-SPACE §4.
7. **(finding 7) NEG-FLAG cells with minority < 30 are annotated
   `underpowered-E14`** and carry no motivating weight.
8. **(finding 8) Per-offset market coverage is printed** (dropout is a
   selection effect and must be visible in the readout).
9. **(finding 9) Cosmetic: last bucket label prints `]`; the
   resolvedOnly comment corrected.**
10. **(both-sides extension, motivated by finding 3; frozen before any
    read, run relaunched a second time as `CAL-001-discovery-v3`).**
    Finding 3 exposed that the instrument covered only the buy-UP
    half-plane and a later DOWN study would cost a second full 2h replay.
    The v2 launch was ~10 minutes old — killing it and logging BOTH books
    in one run costs minutes and halves total compute, so the instrument
    was extended pre-results: the fixture samples the UP and DOWN books
    independently (per-line `asset=UP|DOWN`; the DOWN ask has its own
    spread and is not 1 − UP bid), and the analysis evaluates BOTH frozen
    63-cell grids in one shot. Consequences, all frozen now: **k = 126**;
    the candidate/NEG-FLAG bar becomes **z ≥ 3.565** (one-sided
    p = 0.023/126); `lineage_cells = 126` travels with any resulting
    registration; validation gates run per side (join-direction: DOWN
    tail winRate uses result_id=1; the E14 control applies to both sides
    — EXP-001 bought whichever side was expensive, so on-diagonal at
    expiry is established for both). A NEG-FLAG on one side is now
    directly cross-checkable against the other side's table instead of
    motivating a separate study. The v2 partial run row + log were
    discarded UNANALYZED (instrument coverage change, not result-based);
    v2's only read output was launch-health lines (file count, latency
    pin, first sample line). A null now closes BOTH taker half-planes
    within stated power.

11. **(session 16, mid-run, outcome-free; measured from log slug/asset/
    off/ts fields ONLY — no outcome or price read) Late-offset attrition
    is large and its interpretation is frozen now.** At 1,662 fully
    replayed markets, per-offset UP-book coverage: 30s→100%, 150s→99.9%,
    300s→99.7%, 450s→99.5%, 600s→96.6%, 750s→75.4%, **850s→43.0%**.
    Capture delay when present is prompt (95% < 1s at 850s), so this is
    not sampling lag: a missing offset means the market emitted NO
    uncrossed book event between that offset and 900s (quiet/pinned book
    or stream end). Frozen interpretation: every cell estimates its
    quantity CONDITIONAL on a book event at-or-after the offset. This
    conditioning coincides with in-engine tradability (a tick-driven
    strategy in replay can only act on the same events), so candidate
    cells remain valid for strategy registration — but any verdict or
    LESSONS wording citing 750s/850s cells must state the coverage
    fraction and must NOT claim venue-level pricing efficiency/
    inefficiency for the excluded quiet markets. The E14 positive-control
    and join-direction gates are unaffected (they condition the same
    way). No analysis constant, gate, or threshold changes.

12. **(session 18, mid-run, outcome-free; measured from log bid/ask
    fields ONLY — no outcome read) The two books are exact mirrors;
    interpretation frozen now.** Across 13,422 paired (market, offset)
    samples with both assets present, 13,421 satisfy
    `bid_DOWN = 1 − ask_UP` and `ask_DOWN = 1 − bid_UP` exactly; the
    single deviant (epoch 1764846000, off=850, cross-sums 0.95/0.96)
    prints ts=850.0 for BOTH assets, so at log precision it is NOT
    explained by sampling lag — it is either a sub-0.1s gap between
    the two per-asset book reads or a genuinely dislocated recorded
    moment (E6 precedent shows recording artifacts exist); at 1 in
    13,422 it is immaterial either way. This FALSIFIES amendment #10's
    stated premise ("the DOWN ask has its own spread and is not
    1 − UP bid") — the recorded books are one order set viewed from
    both sides, spreads identical by construction. Frozen consequences:
    (a) the DOWN grid remains NON-redundant — buying DOWN at
    `ask_DOWN = 1 − bid_UP` is economically selling UP at the bid, a
    trade no UP cell measures — so the both-sides design stands and
    still closes both taker half-planes on a null; (b) cross-side cell
    hits share the same underlying book samples with complementary
    outcomes and are NOT independent confirmations — verdict wording
    must not present an UP hit and its DOWN reflection as two pieces of
    evidence; (c) k = 126 and z ≥ 3.565 are unchanged (the correction
    is conservative under dependence). No analysis constant, gate, or
    threshold changes.

13. **(session 18, post-verifier; process rule for future mid-run checks,
    motivated by AUDIT-2026-07-10-CAL-001-AMENDMENTS finding 2).** Any
    mid-run measurement that touches PRICE fields of an in-flight
    instrument log must print only relabeling-invariant aggregates
    (quantities unchanged under UP↔DOWN swap, e.g. cross-sums, match
    counts); per-sample directional price values must not be inspected
    before the one-shot read. Timing/coverage-only measurements (as in
    amendment #11) are unrestricted. The #12 measurement itself was
    audited leak-free (its reported statistics are all
    relabeling-invariant; exposure bounded at ≤1 market of 8,516).
    Post-read erratum obligation (finding 3): the falsified
    independent-spread premise also appears in the frozen decision rule
    ("the DOWN side has its own book and spread") and in the
    diag-calib.ts header — both stay untouched mid-run and must be
    flagged in the Results erratum. Verdict-wording obligation
    (finding 4): treat ANY overlapping-sample cross-side cell pair as
    non-independent, not only exact reflections (the UP→DOWN cell map
    is spread-shifted, not a bijection).

14. **(session 19, mid-run, outcome-free) Prepared erratum text for the
    amendment #13 obligation — content is fully outcome-independent, so
    it is frozen now; the verdict session appends it to Results verbatim
    (adjusting only the final pair-count if the complete log differs):**

    > ERRATUM (per amendments #12/#13): two frozen texts carry the
    > falsified independent-spread premise and are corrected in wording
    > only. (1) Amendment #10's rationale "the DOWN ask has its own
    > spread and is not 1 − UP bid" and (2) the `diag-calib.ts` header
    > describing the DOWN book as independently sampled are FALSE:
    > amendment #12 (re-verified on the grown log at 18,634/18,635
    > exact pairs, single known deviant epoch 1764846000 off=850)
    > established the recorded books are exact mirrors — one order set
    > viewed from both sides. No analysis constant, gate, or threshold
    > is affected: the DOWN grid remains non-redundant (buying DOWN at
    > `1 − bid_UP` is economically selling UP at the bid, a trade no UP
    > cell measures); k = 126 and z ≥ 3.565 stand (conservative under
    > dependence); any overlapping-sample cross-side cell pair is
    > treated as non-independent per amendment #13.

## Results

_(append-only below this line; nothing here until the discovery run
completes and `tools/calib.ts` runs ONCE on its log)_

### Discovery run (CAL-001-discovery-v3) — completed 2026-07-10

Run facts: batchUid `CAL-001-discovery-v3`, pid 73037, code ab2acc9,
8,516/8,516 markets replayed sequentially in 174m21s (952,211,001 book
events), zero trade intents (outcome-free instrument), clean engine
end-of-run summary. Latency pinned `DELAY=0 JITTER=0` (logged, D8/U41).

**Final integrity battery (D23 `tools/calib-integrity.sh`, complete log):**
all green — 0 error lines, progress 8516/8516 gaps=0 dupfiles=0, 104,776
sample lines 0 malformed, UP/DOWN exact balance (52,388 each), epoch max
1772322300 < frozen bound 1772323200 with 0 slug/epoch mismatches, fields
clean (badoff=0, tsbounds=0, crossed=0), dedupe clean (0 duplicate tuples,
0 markets over the 14-line cap), 0 one-sided (slug,offset) keys, ts
monotonicity 0 violations. MIRROR: 52,388 paired samples, **2 deviants**
(see disclosure below).

**Disclosure (checklist §1 — new mirror deviant):** the final log shows a
SECOND mirror deviant beyond the known one: epoch 1771651800, off=300
(UP 0.51/0.52, DOWN 0.47/0.49; cross-sums 0.99/1.00, both ts=300.0 —
same signature as the known deviant: sub-0.1s book-read gap or a
dislocated recorded moment, E6 precedent). It was not present through
~74% of the run's mid-flight checks (it entered with later months).
2 deviants in 52,388 pairs remains immaterial; neither deviant's market
belongs to any cell discussed below beyond its 1-observation weight.

**Coverage fractions (frozen `tools/calib-coverage.sh`, final log —
amendment #11 binding wording input):** denominator 8,133 distinct slugs
with any UP line (383 of 8,516 markets emitted no sample line at all —
no uncrossed book event at-or-after 30s);
off=30→1.0000, 150→0.9993, 300→0.9974, 450→0.9942, 600→0.9766,
750→0.8746, **850→0.5993**.

**One-shot read (`tools/calib.ts`, run ONCE per amendment #5; full output
verbatim):**

```
parsed 100404 valid observations across 8133 markets (200 drift-discarded [ts past next offset], 4172 ask outside [0.02,0.995]; 8133 markets emitted any line)
per-offset market coverage UP: o30=8121 o150=8117 o300=8104 o450=8070 o600=7772 o750=6235 o850=3774
per-offset market coverage DOWN: o30=8121 o150=8117 o300=8104 o450=8068 o600=7784 o750=6239 o850=3778
outcome joined for 8133/8133 markets (0 missing/unresolved — excluded)
gates UP: join-direction OK (850s tail winRate=0.9854, n=687); E14 positive control OK (net=-0.0110 z=-1.02 n=520)
gates DOWN: join-direction OK (850s tail winRate=0.9778, n=721); E14 positive control OK (net=-0.0068 z=-0.59 n=516)

CAL-001 UP-side cell table (k=126 total, candidate bar z>=3.565, minority>=30, fee=winRate*0.0156*min(a,1-a)/a, sub-window consistency required)
off  askBucket      n     meanAsk winRate      d     fee     net      se      z  minor  flag
 30  [0.02,0.100)  empty
 30  [0.10,0.200)      8  0.1737  0.2500 +0.0763 0.0039 +0.0724 0.1339 +  0.57      2  
 30  [0.20,0.350)    238  0.3077  0.2563 -0.0514 0.0040 -0.0554 0.0298  -1.72     61  
 30  [0.35,0.500)   3173  0.4413  0.4368 -0.0045 0.0068 -0.0113 0.0088  -0.51   1386  
 30  [0.50,0.650)   4255  0.5522  0.5438 -0.0084 0.0069 -0.0152 0.0076  -1.10   1941  
 30  [0.65,0.800)    431  0.6830  0.6729 -0.0101 0.0049 -0.0150 0.0224  -0.45    141  
 30  [0.80,0.900)     15  0.8227  0.8000 -0.0227 0.0027 -0.0254 0.0985  -0.23      3  
 30  [0.90,0.980)      1  0.9300  1.0000 +0.0700 0.0012 +0.0688 0.2551 +  0.27      0  
 30  [0.98,0.995]  empty
150  [0.02,0.100)     15  0.0747  0.0667 -0.0080 0.0010 -0.0090 0.0678  -0.12      1  
150  [0.10,0.200)    221  0.1585  0.1222 -0.0363 0.0019 -0.0382 0.0245  -1.48     27  
150  [0.20,0.350)   1242  0.2836  0.2665 -0.0171 0.0042 -0.0212 0.0127  -1.34    331  
150  [0.35,0.500)   2277  0.4234  0.4150 -0.0084 0.0065 -0.0149 0.0103  -0.82    945  
150  [0.50,0.650)   2494  0.5669  0.5621 -0.0047 0.0067 -0.0114 0.0099  -0.48   1092  
150  [0.65,0.800)   1557  0.7070  0.7007 -0.0063 0.0045 -0.0108 0.0115  -0.55    466  
150  [0.80,0.900)    283  0.8336  0.8445 +0.0109 0.0026 +0.0083 0.0221 +  0.49     44  
150  [0.90,0.980)     28  0.9196  0.9643 +0.0446 0.0013 +0.0433 0.0512 +  0.87      1  
150  [0.98,0.995]  empty
300  [0.02,0.100)    178  0.0683  0.0393 -0.0289 0.0006 -0.0295 0.0189  -1.53      7  
300  [0.10,0.200)    661  0.1491  0.1180 -0.0311 0.0018 -0.0329 0.0138  -2.25     78  
300  [0.20,0.350)   1458  0.2717  0.2586 -0.0131 0.0040 -0.0171 0.0116  -1.13    377  
300  [0.35,0.500)   1605  0.4198  0.4262 +0.0063 0.0066 -0.0003 0.0123 +  0.52    684  
300  [0.50,0.650)   1553  0.5698  0.5493 -0.0205 0.0065 -0.0270 0.0125  -1.64    700  
300  [0.65,0.800)   1600  0.7172  0.7081 -0.0091 0.0044 -0.0135 0.0112  -0.81    467  
300  [0.80,0.900)    757  0.8407  0.8547 +0.0139 0.0025 +0.0114 0.0133 +  1.05    110  
300  [0.90,0.980)    284  0.9246  0.9437 +0.0190 0.0012 +0.0178 0.0156 +  1.22     16  
300  [0.98,0.995]      8  0.9850  1.0000 +0.0150 0.0002 +0.0148 0.0429 +  0.35      0  
450  [0.02,0.100)    664  0.0601  0.0331 -0.0269 0.0005 -0.0275 0.0092  -2.93     22  
450  [0.10,0.200)    920  0.1436  0.1141 -0.0295 0.0018 -0.0312 0.0115  -2.56    105  
450  [0.20,0.350)   1282  0.2673  0.2668 -0.0005 0.0042 -0.0047 0.0123  -0.04    342  
450  [0.35,0.500)   1034  0.4176  0.4217 +0.0041 0.0066 -0.0025 0.0153 +  0.27    436  
450  [0.50,0.650)   1044  0.5713  0.5632 -0.0081 0.0066 -0.0147 0.0153  -0.53    456  
450  [0.65,0.800)   1254  0.7227  0.6914 -0.0313 0.0041 -0.0354 0.0126  -2.48    387  
450  [0.80,0.900)    970  0.8445  0.8577 +0.0133 0.0025 +0.0108 0.0116 +  1.14    138  
450  [0.90,0.980)    785  0.9334  0.9363 +0.0029 0.0010 +0.0019 0.0089 +  0.33     50  
450  [0.98,0.995]    117  0.9837  0.9915 +0.0078 0.0003 +0.0075 0.0117 +  0.67      1  
600  [0.02,0.100)   1282  0.0497  0.0374 -0.0123 0.0006 -0.0129 0.0060  -2.04     48  
600  [0.10,0.200)    837  0.1408  0.1314 -0.0093 0.0021 -0.0114 0.0120  -0.78    110  
600  [0.20,0.350)    917  0.2657  0.2519 -0.0138 0.0039 -0.0177 0.0145  -0.95    231  
600  [0.35,0.500)    723  0.4193  0.3790 -0.0403 0.0059 -0.0462 0.0183  -2.20    274  
600  [0.50,0.650)    693  0.5706  0.5541 -0.0165 0.0065 -0.0230 0.0187  -0.88    309  
600  [0.65,0.800)    884  0.7239  0.6991 -0.0248 0.0042 -0.0290 0.0150  -1.66    266  
600  [0.80,0.900)    807  0.8478  0.8525 +0.0048 0.0024 +0.0024 0.0126 +  0.38    119  
600  [0.90,0.980)   1134  0.9397  0.9365 -0.0031 0.0009 -0.0041 0.0070  -0.45     72  
600  [0.98,0.995]    495  0.9854  0.9919 +0.0066 0.0002 +0.0063 0.0054 +  1.22      4  
750  [0.02,0.100)   1468  0.0416  0.0354 -0.0062 0.0006 -0.0067 0.0052  -1.19     52  
750  [0.10,0.200)    566  0.1405  0.1413 +0.0008 0.0022 -0.0014 0.0146 +  0.06     80  
750  [0.20,0.350)    563  0.2636  0.2078 -0.0558 0.0032 -0.0590 0.0185  -3.02    117  
750  [0.35,0.500)    418  0.4186  0.3852 -0.0335 0.0060 -0.0395 0.0240  -1.39    161  
750  [0.50,0.650)    432  0.5739  0.5486 -0.0253 0.0064 -0.0317 0.0237  -1.07    195  
750  [0.65,0.800)    503  0.7168  0.6859 -0.0310 0.0042 -0.0352 0.0200  -1.55    158  
750  [0.80,0.900)    482  0.8469  0.8257 -0.0212 0.0023 -0.0235 0.0164  -1.30     84  
750  [0.90,0.980)    872  0.9422  0.9278 -0.0144 0.0009 -0.0153 0.0079  -1.84     63  
750  [0.98,0.995]    931  0.9868  0.9903 +0.0036 0.0002 +0.0034 0.0037 +  0.95      9  
850  [0.02,0.100)   1086  0.0391  0.0359 -0.0032 0.0006 -0.0038 0.0058  -0.55     39  
850  [0.10,0.200)    308  0.1421  0.1104 -0.0317 0.0017 -0.0334 0.0198  -1.60     34  
850  [0.20,0.350)    291  0.2678  0.2302 -0.0375 0.0036 -0.0411 0.0258  -1.45     67  
850  [0.35,0.500)    211  0.4155  0.3507 -0.0647 0.0055 -0.0702 0.0338  -1.92     74  
850  [0.50,0.650)    187  0.5717  0.5187 -0.0530 0.0061 -0.0591 0.0361  -1.47     90  
850  [0.65,0.800)    246  0.7233  0.7236 +0.0003 0.0043 -0.0040 0.0284 +  0.01     68  
850  [0.80,0.900)    238  0.8485  0.8445 -0.0040 0.0024 -0.0063 0.0232  -0.17     37  
850  [0.90,0.980)    520  0.9447  0.9346 -0.0101 0.0009 -0.0110 0.0100  -1.02     34  
850  [0.98,0.995]    687  0.9867  0.9854 -0.0013 0.0002 -0.0015 0.0044  -0.30     10  

CAL-001 DOWN-side cell table (k=126 total, candidate bar z>=3.565, minority>=30, fee=winRate*0.0156*min(a,1-a)/a, sub-window consistency required)
off  askBucket      n     meanAsk winRate      d     fee     net      se      z  minor  flag
 30  [0.02,0.100)      1  0.0800  0.0000 -0.0800 0.0000 -0.0800 0.2713  -0.29      0  
 30  [0.10,0.200)      8  0.1775  0.3750 +0.1975 0.0058 +0.1917 0.1350 +  1.46      3  
 30  [0.20,0.350)    257  0.3073  0.2840 -0.0232 0.0044 -0.0277 0.0287  -0.81     73  
 30  [0.35,0.500)   3496  0.4415  0.4348 -0.0067 0.0068 -0.0135 0.0084  -0.80   1520  
 30  [0.50,0.650)   3945  0.5514  0.5483 -0.0031 0.0070 -0.0100 0.0079  -0.39   1782  
 30  [0.65,0.800)    404  0.6830  0.7129 +0.0299 0.0052 +0.0247 0.0231 +  1.29    116  
 30  [0.80,0.900)     10  0.8340  0.8000 -0.0340 0.0025 -0.0365 0.1176  -0.29      2  
 30  [0.90,0.980)  empty
 30  [0.98,0.995]  empty
150  [0.02,0.100)     11  0.0673  0.0000 -0.0673 0.0000 -0.0673 0.0753  -0.89      0  
150  [0.10,0.200)    207  0.1598  0.1401 -0.0197 0.0022 -0.0219 0.0254  -0.78     29  
150  [0.20,0.350)   1326  0.2852  0.2760 -0.0092 0.0043 -0.0135 0.0123  -0.74    366  
150  [0.35,0.500)   2427  0.4231  0.4174 -0.0057 0.0065 -0.0122 0.0100  -0.57   1013  
150  [0.50,0.650)   2388  0.5668  0.5649 -0.0019 0.0067 -0.0086 0.0101  -0.19   1039  
150  [0.65,0.800)   1424  0.7082  0.7072 -0.0010 0.0045 -0.0056 0.0120  -0.08    417  
150  [0.80,0.900)    292  0.8323  0.8527 +0.0205 0.0027 +0.0178 0.0218 +  0.94     43  
150  [0.90,0.980)     42  0.9164  0.9762 +0.0598 0.0014 +0.0584 0.0426 +  1.40      1  
150  [0.98,0.995]  empty
300  [0.02,0.100)    170  0.0710  0.0353 -0.0357 0.0006 -0.0363 0.0196  -1.82      6  
300  [0.10,0.200)    681  0.1492  0.1219 -0.0273 0.0019 -0.0292 0.0136  -2.01     83  
300  [0.20,0.350)   1568  0.2741  0.2672 -0.0069 0.0042 -0.0111 0.0112  -0.61    419  
300  [0.35,0.500)   1523  0.4182  0.4261 +0.0079 0.0066 +0.0013 0.0126 +  0.63    649  
300  [0.50,0.650)   1644  0.5698  0.5554 -0.0145 0.0065 -0.0210 0.0122  -1.19    731  
300  [0.65,0.800)   1480  0.7186  0.7216 +0.0030 0.0044 -0.0014 0.0116 +  0.26    412  
300  [0.80,0.900)    737  0.8397  0.8453 +0.0057 0.0025 +0.0031 0.0135 +  0.42    114  
300  [0.90,0.980)    293  0.9259  0.9556 +0.0297 0.0012 +0.0285 0.0152 +  1.95     13  
300  [0.98,0.995]      8  0.9850  1.0000 +0.0150 0.0002 +0.0148 0.0429 +  0.35      0  
450  [0.02,0.100)    665  0.0595  0.0511 -0.0083 0.0008 -0.0091 0.0091  -0.91     34  
450  [0.10,0.200)    989  0.1444  0.1173 -0.0271 0.0018 -0.0289 0.0111  -2.43    116  
450  [0.20,0.350)   1299  0.2674  0.2818 +0.0144 0.0044 +0.0100 0.0122 +  1.17    366  
450  [0.35,0.500)   1057  0.4178  0.4106 -0.0072 0.0064 -0.0137 0.0151  -0.48    434  
450  [0.50,0.650)   1022  0.5712  0.5695 -0.0017 0.0067 -0.0084 0.0154  -0.11    440  
450  [0.65,0.800)   1257  0.7236  0.7025 -0.0211 0.0042 -0.0253 0.0126  -1.68    374  
450  [0.80,0.900)    909  0.8464  0.8625 +0.0161 0.0024 +0.0136 0.0119 +  1.35    125  
450  [0.90,0.980)    755  0.9340  0.9510 +0.0170 0.0010 +0.0160 0.0090 +  1.89     37  
450  [0.98,0.995]    115  0.9842  0.9913 +0.0071 0.0002 +0.0068 0.0116 +  0.61      1  
600  [0.02,0.100)   1357  0.0501  0.0310 -0.0192 0.0005 -0.0197 0.0059  -3.26     42  
600  [0.10,0.200)    887  0.1411  0.1342 -0.0069 0.0021 -0.0090 0.0116  -0.59    119  
600  [0.20,0.350)    939  0.2669  0.2801 +0.0132 0.0044 +0.0088 0.0144 +  0.92    263  
600  [0.35,0.500)    709  0.4211  0.4260 +0.0049 0.0066 -0.0018 0.0185 +  0.26    302  
600  [0.50,0.650)    703  0.5727  0.5818 +0.0091 0.0068 +0.0023 0.0186 +  0.49    294  
600  [0.65,0.800)    867  0.7245  0.7416 +0.0172 0.0044 +0.0128 0.0151 +  1.14    224  
600  [0.80,0.900)    762  0.8477  0.8451 -0.0025 0.0024 -0.0049 0.0130  -0.19    118  
600  [0.90,0.980)   1042  0.9382  0.9386 +0.0004 0.0010 -0.0006 0.0074 +  0.05     64  
600  [0.98,0.995]    518  0.9853  0.9865 +0.0012 0.0002 +0.0010 0.0053 +  0.22      7  
750  [0.02,0.100)   1549  0.0412  0.0310 -0.0102 0.0005 -0.0107 0.0050  -2.04     48  
750  [0.10,0.200)    551  0.1410  0.1543 +0.0133 0.0024 +0.0109 0.0148 +  0.90     85  
750  [0.20,0.350)    511  0.2693  0.2857 +0.0164 0.0045 +0.0119 0.0195 +  0.84    146  
750  [0.35,0.500)    464  0.4150  0.4375 +0.0225 0.0068 +0.0157 0.0228 +  0.99    203  
750  [0.50,0.650)    406  0.5720  0.5887 +0.0167 0.0069 +0.0098 0.0245 +  0.68    167  
750  [0.65,0.800)    525  0.7256  0.7695 +0.0440 0.0045 +0.0394 0.0194 +  2.27    121  
750  [0.80,0.900)    512  0.8480  0.8379 -0.0102 0.0023 -0.0125 0.0158  -0.64     83  
750  [0.90,0.980)    841  0.9421  0.9322 -0.0099 0.0009 -0.0108 0.0080  -1.24     57  
750  [0.98,0.995]    880  0.9869  0.9830 -0.0039 0.0002 -0.0041 0.0038  -1.02     15  
850  [0.02,0.100)   1075  0.0396  0.0326 -0.0071 0.0005 -0.0076 0.0059  -1.20     35  
850  [0.10,0.200)    268  0.1412  0.1418 +0.0006 0.0022 -0.0017 0.0212 +  0.03     38  
850  [0.20,0.350)    266  0.2679  0.2368 -0.0310 0.0037 -0.0347 0.0270  -1.15     63  
850  [0.35,0.500)    196  0.4228  0.4541 +0.0313 0.0071 +0.0242 0.0351 +  0.89     89  
850  [0.50,0.650)    186  0.5741  0.5968 +0.0226 0.0069 +0.0157 0.0361 +  0.63     75  
850  [0.65,0.800)    283  0.7220  0.7385 +0.0165 0.0044 +0.0120 0.0265 +  0.62     74  
850  [0.80,0.900)    267  0.8474  0.8764 +0.0290 0.0025 +0.0265 0.0219 +  1.32     33  
850  [0.90,0.980)    516  0.9439  0.9380 -0.0059 0.0009 -0.0068 0.0101  -0.59     32  
850  [0.98,0.995]    721  0.9867  0.9778 -0.0089 0.0002 -0.0091 0.0043  -2.10     16  

CANDIDATE cells: none
NEG-FLAG / demoted cells: none
```

> ERRATUM (per amendments #12/#13): two frozen texts carry the
> falsified independent-spread premise and are corrected in wording
> only. (1) Amendment #10's rationale "the DOWN ask has its own
> spread and is not 1 − UP bid" and (2) the `diag-calib.ts` header
> describing the DOWN book as independently sampled are FALSE:
> amendment #12 (re-verified on the final log at 52,386/52,388
> exact pairs, single known deviant epoch 1764846000 off=850)
> established the recorded books are exact mirrors — one order set
> viewed from both sides. No analysis constant, gate, or threshold
> is affected: the DOWN grid remains non-redundant (buying DOWN at
> `1 − bid_UP` is economically selling UP at the bid, a trade no UP
> cell measures); k = 126 and z ≥ 3.565 stand (conservative under
> dependence); any overlapping-sample cross-side cell pair is
> treated as non-independent per amendment #13.

_Pair-count adjustment note: the erratum text above is the amendment #14
frozen text with only the pair-count adjusted as licensed; the final log
additionally shows a second deviant (epoch 1771651800 off=300), disclosed
in full above — the "single known deviant" phrase is the frozen text's,
accurate as of its freezing at ~40% of the run._

_Additional stale-premise flag (amendment #13 / checklist §6, verifier
finding 1 of U43ah): the frozen decision rule's NEG-FLAG bullet also
carries the falsified premise — "the DOWN side has its own book and
spread". Same correction applies: the books are exact mirrors; the
bullet's operative content (a NEG-FLAG motivates a DOWN-side reading) was
superseded by amendment #10's both-sides instrument anyway._

### Verdict (frozen decision rule, k = 126)

**NULL — zero CANDIDATE cells, zero NEG-FLAG cells.**

- Validation gates all pass, read before any other cell: join-direction
  UP (850s, [0.98,0.995]) winRate = 0.9854 (n = 687) > 0.9; DOWN
  winRate = 0.9778 (n = 721) > 0.9. E14 positive control on-diagonal on
  both sides: UP net = −0.0110, z = −1.02 (n = 520); DOWN net = −0.0068,
  z = −0.59 (n = 516) — |z| far below the 3.377 abort bar.
- Drift filter and coverage printed per amendments #1/#8: 200
  drift-discarded samples, 4,172 asks outside [0.02,0.995] (frozen band
  exclusion), 8,133/8,133 sampled markets outcome-joined (0 unresolved).
- No cell on either side reaches |z| ≥ 3.565. Most extreme cells:
  DOWN (600s, [0.02,0.10)) z = −3.26 and UP (750s, [0.20,0.35))
  z = −3.02 — both NEGATIVE (buying costs money), below the flag bar,
  and consistent with the fee drag + adverse selection picture of
  E9–E14. No positive cell exceeds z = +2.27 (DOWN 750s [0.65,0.80),
  net +0.0394, minority 121 — under the bar by a wide margin, and a
  single cell among 126).
- Sub-window consistency was never reached: no cell cleared the z bar.

**Interpretation (binding wording per amendments #3/#10/#11 and §Power):**
Within the stated power, the discovery window (8,516 markets,
2025-11-30 → 2026-02-28) shows BOTH taker half-planes — buy-UP at ask
and buy-DOWN at ask (economically: sell-UP at bid) — on-diagonal across
the full frozen offset × price grid. Extreme-price tail cells, where
power was best (candidate bar ≈ 1.3c at n ≈ 3,000, fee ~0.08c), are
clean on both sides at 600s/750s/850s. Per amendment #11, 750s and 850s
cells are estimates CONDITIONAL on a book event at-or-after the offset
(coverage 0.8746 and 0.5993 respectively, of the 8,133 sampled markets);
no venue-level efficiency claim is made for the excluded quiet markets.
Mid-range cells are a power statement (resolve only |d| ≳ 3.8c), not
proof of efficiency — but E9–E14 already measured those regions with
targeted strategies. Cross-side cells share underlying book samples
(amendment #12) and nothing here is presented as two independent
confirmations.

**Consequence:** no EXP-010 registration. The probe reserve
(2026-03-01 → boundary−1, 5,460 markets) stays unspent. The EDGE-SPACE
§4 gated state continues; LESSONS E20 records the closure.

### Fresh-context Judge verdict (appended verbatim)

- decision: null-confirmed
- basis: The frozen decision rule (k = 126, candidate/NEG-FLAG bar |z| ≥ 3.565, minority ≥ 30, sub-window consistency) yields zero candidate and zero NEG-FLAG cells on the printed tables: the most extreme cells are DOWN (600s, [0.02,0.10)) z = −3.25/−3.26 and UP (750s, [0.20,0.35)) z = −3.02, both negative and below the bar; the largest positive is DOWN (750s, [0.65,0.80)) z = +2.27. Both validation gates pass as frozen: join-direction winRate 0.9854 (UP, n=687) and 0.9778 (DOWN, n=721) > 0.9; E14 controls z = −1.02 / −0.59, far inside the |z| < 3.377 abort bar. I re-derived z = d/se on seven cells (all match within display rounding), confirmed the count identities (104,776 lines − 200 drift − 4,172 out-of-band = 100,404 parsed; per-offset coverage sums and 850s cell-n sums reconcile exactly), and confirmed the bar z = 3.565 corresponds to one-sided p ≈ 0.023/126. All pre-registered wording obligations (amendments #3, #10, #11, #12, #13, #14 plus the decision-rule stale-premise flag) are present in Results, and the interpretation stays within the frozen power caveats.
- checks:
  - Full scan of both 63-cell tables: no cell reaches |z| ≥ 3.565; extremes DOWN 600s [0.02,0.10) −3.26, UP 750s [0.20,0.35) −3.02, UP 450s [0.02,0.10) −2.93, DOWN 850s [0.98,0.995] −2.10, max positive +2.27 — matches the verdict's claims. PASS.
  - z-arithmetic re-derived on 7 cells (both sides, including both gate cells): all match printed values within rounding. PASS.
  - Gates: join-direction > 0.9 both sides (0.9854 / 0.9778, matching the 850s tail rows); E14 control |z| < 3.377 both sides (−1.02 / −0.59, matching the 850s [0.90,0.98) rows). PASS.
  - Raw log spot-checks: end-of-run engine summary present (8516/8516, 952,211,001 events, 174m21s); latency pin DELAY=0 line present; 0 error/exception/failed lines; asset=UP and asset=DOWN each exactly 52,388; max slug epoch 1772322300 < frozen bound 1772323200. PASS.
  - Both mirror deviants verified in the raw log at the disclosed prices (1764846000/850: UP 0.30/0.32 vs DOWN 0.63/0.66, cross-sums 0.95/0.96; 1771651800/300: UP 0.51/0.52 vs DOWN 0.47/0.49, cross-sums 0.99/1.00) — second deviant is disclosed in Results with the required immateriality framing. PASS.
  - Count identities: parsed 100,404 = 104,776 − 200 − 4,372; per-offset UP+DOWN coverage sums to 100,404; 850s cell-n column sums equal the printed o850 coverage (3,774 UP / 3,778 DOWN). PASS.
  - Checklist §6 wording obligations: amendment #14 erratum appended with only pair-count adjusted (52,386/52,388); decision-rule stale-premise flag present; 750s/850s cited only with the frozen script's fractions (0.8746 / 0.5993) and the "conditional on a book event" wording; no venue-level efficiency claim for excluded markets; cross-side non-independence stated; half-plane/both-half-planes wording and mid-range power caveat present. PASS.
  - No sign of post-hoc tuning: all constants (offsets, buckets, k=126, 3.565, fee formula, gates) trace to pre-results amendments; the one printed table is the whole grid, empty cells included; no subset reads appear in Results. PASS (with honor-system caveat below).
  - Sub-window consistency correctly untriggered: it is conditional on clearing the z bar, which no cell did.
- reservations: (1) The single-read rule is honor-system per amendment #5; I can verify the printed output's internal consistency and the git trail, not that calib.ts ran exactly once. (2) The appended erratum retains the frozen phrase "single known deviant" while the final log has two; the #14 license permitted only a pair-count adjustment and the second deviant is fully disclosed in an adjacent note, so this is a handled wording tension, not a violation. (3) 850s cells condition on ~60% coverage; the Results wording handles this correctly, but any future citation of those cells must carry the same conditioning. None of these affects the verdict.

_Transcription-typo note (E20-propagation audit, finding 5 — the judge
text above stays verbatim): the checks bullet's identity
"104,776 − 200 − 4,372" should read 4,172, per the verbatim calib.ts
output line ("4172 ask outside [0.02,0.995]") and the judge's own basis
paragraph; 104,776 − 200 − 4,172 = 100,404 ✓._
