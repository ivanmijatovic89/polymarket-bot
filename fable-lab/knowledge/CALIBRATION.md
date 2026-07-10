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

## Results

_(append-only below this line; nothing here until the discovery run
completes and `tools/calib.ts` runs ONCE on its log)_
