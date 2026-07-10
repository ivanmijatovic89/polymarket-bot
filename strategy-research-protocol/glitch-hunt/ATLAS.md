# Glitch Atlas — BTC 15m up/down

Product of the Glitch Foundry mission (see MISSION.md). Maintained by the
cartographer agent. Ranked by Glitch Score; quarantined entries keep their
reversal numbers — anti-lessons are assets.

State after Phase 2 Round 7 (2026-07-10, hygiene round — no memo, no
mantis; quota window 007-009 unopened at 0/3): 0 living anomalies, 2
operator leads (OL-001 engine-gated, now regime-labeled STRONGER LATE;
OL-002 trade-print afternoon, prep complete), **OL-003 NOT FILED** (the
mid-window standing-bid field has no OL-class margins — numbers in the
operator-leads section; the last unread page of the round-6 extraction is
now read), 2 killed entries with gated pre-registrations (PR-002; PR-005
feed-integrity-gated), 2 quarantined (Q-001; Q-006 — autopsy CLOSED this
round: the instrument confound is discharged, the reversal is
selection + sampling), 1 formally closed cell family (K-002), 4 other
kills, 1 falsified structural assumption (T-001), 2 completed audits
(A-001 staleness; A-002 NEW — regime-shift audit of all standing claims:
no K-004-shaped flip anywhere), 1 named structural pattern (S-001,
sharpened: the asymmetric straddle is an ENDGAME-ONLY shape), 1
SUPERSEDED coverage fact (C-001). The round-6 instrument family
(extract_endgame.cjs / extract_midwindow.cjs) is cross-validated
7,999/8,000 rows against the full-replay path — E-001/E-002 carry no
instrument doubt line. Nothing READY FOR PROTOCOL. **The mission enters
check-in cadence: no unscanned territory remains in the resolved
universe; every discovery path runs through the markets.parquet refresh
or the OL-002 afternoon (see the standing gap map).**

**Epistemic upgrade (round 6, header-level because every future round
inherits it): within-holdout disjointness is not out-of-sample.** Memo
006 was pre-gated (gates frozen 3 rounds before the data existed),
region-level z=3.85 unique field max, 8/8 months, token-mirror arm on
disjoint episodes, one-tick concentration on a pre-registered split with
a kill rule, and mantis's own kill-shot probe (t=450 on 1,316 episode-
instances the selection never touched: +2.18c, z=2.26) FAILED to kill it
— and it still reversed on the truly reserved slice (−0.04c, n=613,
P(dev<=0 | true +3.6c) < 1%). Every corroborating arm computed inside the
discovery sample inherited its selection; only the census/holdout
boundary, reserved before discovery, discriminated. The disjoint-slice
rule is not a formality — it is the only instrument that has caught both
of this mission's ghosts (Q-001, Q-006).

**Operator gate (unchanged, still the broadest unlock): `data/telonex/
markets.parquet` has zero resolved outcomes after 2026-05. 1,287 episode
files for 2026-06 alone sit unusable. The refresh gates PR-002, PR-005's
future-pocket arm, the Q-006 retest, the memorylessness reopening, the
K-004 reopening, and ALL disjoint-month replication. As of round 6 the
census/holdout boundary is also spent (consumed by Q-006's replication):
nothing disjoint remains inside the resolved universe at all.**

**Operator lead (NEW, round 5 — highest value per hour on the map):
OL-002 below. One afternoon of trade-print checking on the Nov-2025..
Jan-2026 frozen-book intervals either certifies a +9.3c gross / +7.9c net
historical glitch and activates the locked PR-005 prereg, or quarantines
every Nov–Jan stale row on this atlas. Does NOT gate on the
markets.parquet refresh.**

**Operator lead (round 3): OL-001 below — the endgame resting-bid
margin (+2.3/+2.5c standing, 8/8 months) is an engine-fill-model question,
not answerable by this mission's data. See OL-001 for the ready-to-spec
000-baseline.**

Measurement assets available to all rounds:

- `census/checkpoints.parquet` — 2,000 episodes, 71-checkpoint grid t=0..900.
- `replication/holdout_checkpoints.parquet` — 17,126 episodes (all resolved
  2025-10..2026-05 not in the census sample), grid t=0/15/30/45/60, 85,630
  rows, snapshot self-checked.
- `census/endgame_checkpoints.parquet` — the SAME 17,126 holdout episodes at
  t in {780, 840, 870, 885, 897, 899}, 102,756 rows, one-sided books KEPT
  with per-side depth and state taxonomy (two_sided | bid_only | ask_only |
  empty). Self-check 3.49% raw / 1.45% hard (churn-dense region; 2025-10 at
  11.1%/4.7% — sub-2c endgame effects there are noise).
- Aggregates: `census/endgame_calibration_{mid,takeable,bid}.csv`,
  `census/endgame_taxonomy.csv`, `census/friction_map.csv` (census, full 15s
  grid), `census/friction_map_endgame.csv`. Rubric component 1 can now use
  measured per-cell spread/depth instead of the 156bps convention alone.
- `replication/data/holdout_manifest.csv` — the holdout slug list.
- `census/outcomes_all.csv` — settlement per episode; prev-window join via
  epoch-900 covers 17,113/17,126 holdout episodes (result_id semantics
  verified 2,000/2,000 against census up_won; K-004).
- `census/round4_prereg.md` + `census/round4_probe.sql` — the round-4
  pre-registration precedent (prereg on disk BEFORE first query, mtime =
  birthtime, mantis-verified; the prereg killed its own author's result).
  Future memos with pre-declared gates should copy this file pattern.
  Second instance: `census/round5_prereg.md` + `census/round5_probe.sql`
  (integrity PASS: birth=mtime 07:05:17 → probe 07:06:19 → memo 07:12:38;
  one blemish — the memo's stated "06:59" prereg time is wrong by 6 min,
  ordering unaffected; behavioral tell present again: the prereg killed its
  author's promotion, third consecutive round).
- `census/midwindow_checkpoints.parquet` (NEW, round 6) — the SAME 17,126
  holdout episodes at t in {300, 450, 600, 690}, 68,504 rows, one-sided
  books KEPT, age*ms carried. Self-check 1.72% raw / 0.66% hard — the
  cleanest extraction of the night (per-month in
  `midwindow_selfcheck_by_month.csv`; 2025-10 still 3.14% hard).
  Aggregates: `midwindow_calibration*{mid,takeable,bid}.csv`,
`midwindow_taxonomy.csv`, `friction_map_midwindow.csv`. Two-sided mass
  99.6% at t=300/450, 97.5% at t=600, 91.3% at t=690; one-sided states
  are near-deterministic from t=600 (same shape as E-001's endgame
  taxonomy).
- `census/round6_gatestack_cells.csv` — full scored dump of the frozen
  gate-stack scan (371 token-cells at n >= 150). `census/round6_prereg.md`
  - `census/round6_gabagool_probe.sql` — third prereg instance; chain
    timestamps mantis-verified (dump 08:25:26 → prereg 08:33:53 → probe
    08:34:18 → memo 08:38:49) WITH the recorded demerit that this prereg
    postdated the gate-stack dump: it formalized, it did not predict.
    `replication/replicate_006.sql` — the independent script that reversed
    it.
- `census/ol002_liveness.csv` + `census/ol002_support.csv` (NEW, round 6)
  — per-episode witness status for PR-005's 100-episode cell, and the
  Nov-2025..Jan-2026 stale-row exposure inventory over every atlas-cited
  endgame cell. If OL-002 finds trade prints, the quarantine is a lookup
  in this file, not a scramble.
- `age_ms` in both checkpoint parquets: the fresh-book recut
  (age_ms < 60,000) is one WHERE clause — mandatory for 2026-01 endgame
  claims (see A-001).
- `census/census_midwindow_checkpoints.parquet` (NEW, round 7) — the
  2,000 census episodes re-extracted by `extract_midwindow.cjs` at
  t in {300,450,600,690} (self-check 0.72% hard), built for the Q-006
  instrument autopsy. Cross-validation vs the full-replay path
  (`extract.cjs`): 7,999/8,000 rows agree on all 7 fields (99.99%); the
  single discrepancy is a documented one-tick seq-vs-timestamp cutoff
  edge case at t=690, unstructured. Files: `census/
autopsy_q006_instrument.sql`, `autopsy_q006_field_match.csv`,
  `autopsy_q006_discrepancies.csv`. Consequence: the extension-extractor
  family is CLEARED; no extension-parquet fact carries an instrument
  doubt line.
- `census/regime_audit.sql` + `census/regime_audit.csv` (NEW, round 7) —
  A-002's per-claim early/late recut on fresh books. See A-002 below.
- **CRLF trap (round 7, fixed in outputs, cause remains):**
  `census/sample_manifest.csv` has CRLF line endings; a line-by-line
  reader leaves `\r` on the last column (`result_id`). The corrupted
  pass-through column in the round-7 raw batch CSVs was stripped in
  place; book fields were never affected and the holdout manifest
  (`replication/data/holdout_manifest.csv`) is LF. Any future script
  consuming `sample_manifest.csv` must strip `\r`.
- **Pooling trap (round 7, caught before it shipped):** the
  `{midwindow,endgame}_calibration_*.csv` aggregates carry `month='ALL'`
  pooled rows ALONGSIDE per-month rows. Summing over all rows double-
  counts every episode exactly 2x and inflates z by sqrt(2). Filter
  `month='ALL'` for pooled reads or exclude it when pooling by hand.
- **Neighbor-market liveness check (mantis round 5 — instrument, use
  on any staleness claim):** during episode E's frozen interval, the
  successor market's file (epoch+900) on the SAME feed records the same
  wall-clock; events there while E's book stands still refute a
  machine-level recorder outage for that episode. It CANNOT discharge a
  per-market subscription drop — only trade prints can (OL-002). First
  application: refuted machine-level outage for 67/100 of PR-005's
  favorite-cell episodes. Round-6 closure: **the predecessor witness
  (epoch-900) is mechanically BLIND** — 0/100 predecessor files cover any
  freeze interval; recordings typically die ~4 min before their own
  expiry (median file-end offset −239s; only 20/93 extend past expiry at
  all). One witness exists, not two. Upgrades A-001's toolkit.
- Coverage state after round 6: holdout is measured at density for
  t 0-60, t {300, 450, 600, 690}, and t 780-899. Unmeasured at density:
  the 15s-grid t-values BETWEEN the four mid-window checkpoints
  (census-only there, unmeasurable per C-001) — bracketed on both sides
  by fair-or-negative readings and costing a round-6-class extraction per
  ~4 t-values. Expected value LOW; see the gap-map honesty note.

## Standing gap map — check-in era (round 8+ reads this first)

Round-7 disposition of the old map: item 1 (regime-shift audit) CONSUMED
→ A-002 below, all labels written. Item 2 (Q-006 instrument autopsy)
CONSUMED → instruments cleared, Q-006 entry updated, gap closed. Item 3
(bid-margin scan) CONSUMED → OL-003 NOT FILED (numbers in operator
leads). Item 4 carries as the gated list below. **There is no unscanned
census-addressable territory left in the resolved universe** (measured at
density: t 0-60, t {300,450,600,690}, t 780-899; the 15s-grid slices
between mid-window checkpoints are bracketed by fair readings and cost a
round-6-class extraction per ~4 t-values — expected value LOW, unchanged).

**Loop posture: check-in cadence.** Each wakeup: (1) check the MISSION.md
kill-switch; (2) check `data/telonex/markets.parquet` for resolved rows
with month > 2026-05 (`SELECT max(month)` over btc-updown-15m rows with
non-empty result_id); (3) check whether the operator has left OL-002
results under `glitch-hunt/` or in MISSION.md. If nothing changed: append
one ledger line, end the turn. No new scans of 2025-10..2026-05 are
licensed — both samples and the census/holdout boundary are consumed.

**On-refresh execution order (fires automatically when new resolved
months land; specs are frozen — no re-tuning anywhere):**

1. **Month +1 (first new resolved month):**
   a. Surveyor extracts the new month(s): outcomes join via slug
   (K-004-verified result_id semantics), checkpoint grids as needed
   per the retests below; self-check bar < 2% hard; strip `\r` if any
   manifest is CRLF.
   b. **A-002 recheck** on the new month(s) alone, fresh books: E-001
   (fav 96+ within ±1c gross t>=885; adjacency pair count), E-002
   (longshot 4-20c <= −1c t>=885), OL-001 (fav bid margin >= +1.5c at
   t=897/899). Labeling only; protects everything downstream from a
   K-004-style ambush. Template: `census/regime_audit.sql`.
   c. **Q-006 retest** (powered in month 1: census accrual was ~0.31
   first-touch entries/episode → ~800/month vs the n >= 350 floor).
   Needs a 15s-grid extraction over t in [240,360] for the new month.
   Frozen rule (mantis verdict, binding): first-touch t in [240,360],
   ask in [0.82,0.86), two-sided, one entry per (slug, token); fires
   iff pooled dev >= +2.0c at n >= 350 AND one-tick stratum > 0.
   d. **PR-005 pocket detector**: endgame stale share at t=897 > 2% in
   any new month? If no — one ledger line. If yes — the locked prereg
   evaluates ONLY alongside its feed-integrity gate (OL-002-class
   trade-print verification on the NEW intervals).
2. **Month +2:** K-004 reopen-check (cheap label, not a reopening):
   prev-winner in-band <= −1c gross at t in {30,45} on the new months?
   Reopening additionally requires the harvest leg to clear 156bps x ask
   net at z >= 2 on those months alone (retryOnlyIf unchanged).
3. **Month +3:** **PR-002 locked prereg** (accrual ~130 in-cell
   episodes/month vs n >= 350 floor). Exact rule in the PR-002 entry:
   dog ask(t=0) <= 0.46, fav ask(t=15) >= fav ask(t=0) − 0.5c, taker-buy
   fav at t=15 ask; fires iff pooled gross >= +2c at n >= 350 AND placebo
   (0.48-0.50) within ±1c AND contradicted movers <= 0. On fire: re-enters
   at replication + 300-USDT depth-walk extraction (per-level prices).
4. **Month +5 or later:** M-003 memorylessness family reopens at
   n >= ~11,000/leg. Nothing to pre-compute.

**Independent of the refresh:** OL-002 (operator afternoon, spec in its
entry) — either branch is decisive and both are one-lookup cleanups
(`census/ol002_support.csv`). OL-001 engine baseline at operator
discretion (spec in its entry; A-002 upgraded its stability).

## Ranked anomalies

(none living — six adjudicated candidates over seven rounds, six
kills/quarantines; round 7 was hygiene and produced instrument verdicts
and audit labels, no claims; best dead entry is PR-002 below at 31/100,
gated on the operator outcomes refresh; best ACTIONABLE item is OL-002,
gated on nothing but an operator afternoon; OL-001 remains gated on the
engine fill model and is now regime-labeled STRONGER LATE)

## Operator leads (outside mission scope)

### OL-002 — Trade-print check on the Nov-2025..Jan-2026 frozen-book intervals — LEAD, one afternoon, binary payoff

- Source: memo 005 + mantis retryOnlyIf arm (i)
  (`memos/005-frozen-book-endgame-favorite-discount.md`). This is the
  load-bearing question for PR-005 and it is operator-only by
  construction: book deltas cannot distinguish "market went silent" from
  "our per-market subscription died" — mantis's neighbor-liveness check
  already refuted machine-level recorder outage for 67/100 of the cell,
  narrowing the artifact to a per-market sub drop, and only trade prints
  discriminate further.
- The question: do Polymarket trade prints (data-api trade history or any
  recorded trade channel) exist INSIDE the frozen intervals? Start with
  the 67 neighbor-alive favorite-cell episodes (derivable from
  `census/endgame_checkpoints.parquet`: age_ms > 60,000 at t in
  {885,897,899}, standing ask band 80-96, months 2025-11..2026-01), then
  the wider 333-episode 2026-01 frozen set if time allows.
- Branch 1 — SILENCE inside the intervals: the books were real. The
  +9.3c gross / +7.9c net fossil discount (n=100, run-level z=7.9) is
  certified a genuine historical money glitch (still capacity- and
  regime-dead: ~$130 best-ask, pocket extinct since Feb), and PR-005's
  locked future-pocket prereg goes LIVE as written.
- Branch 2 — PRINTS inside the intervals: the recorded books are fiction.
  Quarantine EVERY Nov-2025..Jan-2026 stale (age_ms > 60,000) row on this
  atlas and retroactively harden A-001's distrust flag from
  "recut 2026-01 on fresh books" to "Nov–Jan stale rows are
  reconstruction fiction". Gap item 3(ii) pre-computes the affected rows.
- Value note: highest value per hour on the map — one afternoon either
  activates a locked +7.9c-net prereg or removes three months of possible
  fiction from every future memo. Independent of the markets.parquet
  refresh; no engine run needed.
- **Round-6 support pass (complete — `census/ol002_liveness.csv`,
  `census/ol002_support.csv`):**
  - Cell re-derived independently to the digit: n=100, avg ask 87.75c,
    P(win) 97.0%, +9.25c gross; successor witness reproduces mantis's
    67 alive / 26 silent / 7 no-file exactly.
  - Predecessor-witness arm CLOSED: mechanically blind, 0/100 predecessor
    files cover any freeze interval (recordings die median 239s before
    their own expiry; max overrun +146s vs a 300-477s gap to the freeze).
    The ambiguous stratum stays 33/100. No second book-side witness
    exists; trade prints remain the only discriminator.
  - Successor-silent decomposition: of the 26 "silent" episodes, 24 are
    file-coverage gaps (the successor recording never spanned the freeze
    — not a witness statement), 1 is covered-and-quiet (the only genuine
    ambiguous case), 1 starts post-freeze.
  - Prior shift, recorded not adjudicated: 73/93 Nov-Jan-adjacent
    predecessor recordings died before their own expiry — per-market
    recording death was PERVASIVE around the pocket. This is exactly what
    the sub-drop artifact branch predicts and mildly weights against the
    real-fossil branch. The afternoon's binary payoff is unchanged.
  - Quarantine arm pre-computed (`ol002_support.csv`, per-cell): if
    prints are found, E-001's fav-96+ set carries 142/21,289 stale-NJ
    rows (0.18% at t=780 → 2.38% at t=899 — marginal); E-002 ch.1 4-20c
    carries 570/15,725 (1.46% → 12.26% by t; 308 of 4,153 rows in the
    robust t>=885 cell); OL-001's bid cells 113/3,361 (2.7-4.5%); full
    two-sided scan universe 7,154/90,552 token-rows (7.9%). The
    quarantine is a lookup, not a scramble.

### OL-001 — Endgame resting favorite bid (t=897/899, bands 90-98) — LEAD (engine fill model required), score 29/100

- Source: memo 003 channel 2 (`memos/003-endgame-taker-efficiency.md`),
  numbers mantis-verified in the appended verdict. Not a living anomaly:
  the tradable quantity P(win | filled) is unobservable in book deltas by
  construction, and a maker rule is not expressible under this mission's
  SCOPE. Filed for the human/protocol side.
- The measured fact: two-sided fav BID at t=897/899 stands at 0.9662/0.9646
  vs P(win) 0.9894/0.9899 → standing margin +2.32/+2.52c gross per filled
  share, 8/8 months positive (+1.4c..+3.8c). The ask side of the SAME books
  is fair (E-001) — the book straddles fair asymmetrically at expiry:
  ask ~ fair, bid ~ fair - 2.4c.
- Score arithmetic (rubric per MISSION.md):
  - Edge vs friction 7/30 — +2.32/+2.52c standing gross vs 1.51c fee
    (156bps x 0.966) → ~+0.8-1.0c net AT STANDING QUOTES; cell med spread
    0.9-1.0c. Discounted hard: the harvested edge is fill-conditioned and
    the entire adverse-selection budget is 0.86c of win probability
    (breakeven P(win|filled) >= 0.9813 vs standing 0.9899) — unmeasurable
    here, could be fully consumed.
  - Evidence 9/20 — 8/8 months positive, mantis-reproduced, large n
    (two-sided fav bid bands 90-98, t=897/899). Docked: the load-bearing
    conditional (P(win|filled)) has n=0; 2025-10 endgame carries 4.7% hard
    self-check.
  - Replication 0/25 — unevaluable twice over: resolved universe exhausted
    (no disjoint months) and no checkpoint slice can observe fills.
  - Mechanism 12/15 — donor named and sized: last-3s taker-sellers of ~99%
    winners donate ~2.4c/share; the symmetric longshot channel (E-002,
    -1.9c → -6.2c into expiry) corroborates price-insensitive crosser flow.
    Persistence named: the pick-off tail keeps the bid ~2.4c under fair
    while the ask is already fair, so no taker is paid to tighten it.
    Docked 3: the donor story and the risk story are the same unmeasured
    term — the natural counterparty of a t=899 favorite dump is someone
    watching spot cross the strike.
  - Capacity 1/10 — top-3 bid depth at the cell 626-719 shares ~ 600-700
    USDT vs the 3-4k bar, before fill risk; and the rule needs a maker fill
    model, not expressible with SCOPE-allowed inputs.
  - **Total: 29/100. Not READY; routed to the operator.**
- Ready-to-spec 000-baseline (from the memo, unmodified): maker family —
  join the best bid on the two-sided endgame favorite (band 90-98) at
  t=870, one-shot, hold to settlement; sweep join-vs-improve and entry
  t in {840, 870, 885}. The engine's fill model prices fill rate and
  adverse selection; the standing margin (+2.3-2.5c, 8/8 months) is the
  prior it must beat AFTER fills. LESSONS priors against it:
  `one-shot-take-profit-can-add-churn-without-removing-tail-loss`,
  `persistent-book-pressure-selects-longshots-not-informed-flow`.
- Loss tail per fill: -96.6c against +3.4c. This fails mission criterion 2
  as measured here; only the engine can bound it.
- **A-002 label (round 7): SUPPORTED both regimes, STRONGER LATE** — early
  +1.97/+2.24c (z=5.48/5.91), late +2.65/+2.90c (z=10.58/7.85) at
  t=897/899. The only standing claim that strengthened in the recent
  regime.
- **Mechanism sharpening (round 7, from the OL-003 scan):** the
  asymmetric straddle (bid >= 2c under fair while the same book's ask is
  fair) does NOT exist anywhere in the mid-window — 16/373 bid-band cells
  at t 300-690 pass the shape filter and all 16 sit at z <= 1.1 (spread,
  not calibration). The shape emerges only at t=897/899, exactly where
  the named donor (last-seconds dumpers of ~99% winners) operates. The
  margin is expiry-specific dumper flow, not a generic book artifact.

### OL-003 — Mid-window standing-bid margins — NOT FILED (round 7 map fact; do not re-scan)

- **One-line fact: the mid-window standing-bid field (t 300-690) contains
  no OL-class margins.** Gap item 3 executed against
  `midwindow_calibration_bid.csv` (month='ALL' rows) + the parquet.
- Arithmetic: 373 two-sided bid-band token-cells at n >= 150. A naive
  "margin >= +2c over fee" screen passes 111 — mechanically inflated,
  because a resting bid sits under fair by the spread (margin =
  same-book ask dev + spread; avg spread 1.4-1.7c in these cells). The
  OL-001-class shape filter (margin >= +2c AND same-book ask fair,
  |dev| <= 1c) passes 16 cells: ALL with margin 2.0-2.5c and z <= 1.1 —
  indistinguishable from zero calibration deviation. The remaining 95
  both-sides-positive cells are the round-6 gate-stack noise field
  re-binned by bid instead of ask: same books, top z 3.1-3.9 vs a null
  max expectation ~2.9 over 373 cells, sign-incoherent adjacency (UP
  t=300 asks: band 38 −0.01c / 40 +4.63c / 44 −1.00c / 46 +4.13c) —
  already adjudicated by the frozen gate stack (38/371 gate-1, 1
  survivor → Q-006, REVERSED). Filing any of them would re-mine the
  consumed sample against Q-006's retryOnlyIf.
- Positive by-product: the endgame-only localization of the asymmetric
  straddle, recorded on OL-001's mechanism line above.

## Verified structure (trusted map facts — cite, do not re-derive)

### E-001 — The endgame takeable set is efficient (memo 003 claims a+b, mantis-verified)

- 148 (t in {780..899} x 2c ask band) two-sided cells with n >= 150,
  episode-level, 8 months pooled: mean edge -1.10c, 39/148 positive,
  exactly 2 cells clear fee at z > 2 (t=840 bands 66/68) vs ~3.4 expected
  false positives — and the pair dies on band flanks (64: -7.14c,
  70: -3.57c, 74: -5.78c), cross-t incoherence (same bands at 897: -7.99c),
  and mirror tautology. Not a region.
- Certainty bands: fav ask >= 0.96 two-sided, gross edge -0.08c (t=780,
  n=5,652) monotonically down to -0.68c (t=899, n=1,260); Wilson-95 UPPER
  bound at t=897/899 is -0.08c/-0.02c — negative BEFORE the ~1.54c fee.
  Band-96/98 sub-split: all 12 cells <= +0.11c. 7/8 months negative at
  t >= 885 (best +0.54c, 2026-03). Conditioning on "still two-sided" is
  adverse information for the favorite (P(win) decays 0.9841 → 0.9786 from
  t=780 to 899 at an unchanged ~0.985 ask) and the ask does not discount it.
- One-sided states are near-perfect but untakeable classifiers:
  P(UP | bid_only) = 0.9967→0.9992, P(UP | ask_only) = 0.0057→0.0013 across
  t=780→899; two-sided mass at t=899 is 16.3% (2,794/17,126). Ask-only
  books sit almost entirely at ask <= 0.02.
- Structural read: mispricing in this market has so far been found only in
  ERASED conditioning states (memo 002's t=0 skew), never in the level
  calibration of a visible state — and the endgame is the most-visible
  state there is.
- Standing falsifiable claim (memo 003 a/b, retest on months > 2026-05):
  no two adjacent takeable endgame bands both clear 156bps x ask at z >= 2
  same-direction, and fav 96+ at t >= 885 stays within +-1c gross of ask.
- OL-002 exposure (round 6, `ol002_support.csv`): the fav-96+ set holds
  142/21,289 Nov-Jan stale rows (0.18% at t=780 → 2.38% at t=899) — the
  claim survives the print-found branch nearly untouched.
- **A-002 label (round 7): MIXED early / SUPPORTED late.** Fav-96+ ±1c
  claim: early t=885/897 in-bounds (−0.24/−0.40c), early t=899 −1.04c
  (z=−1.94 — a marginal breach, inside noise); late all three t
  in-bounds (t=899 +0.19c). Adjacency claim SUPPORTED both regimes
  (0 positive fee-clearing pairs early AND late; the 4 same-direction
  pairs that exist early are all NEGATIVE, in longshot bands 0-8 —
  E-002's own channel, not a taker harvest). One hot month inside the
  supported late regime, recorded not adjudicated: 2026-05 t=897 fav-96+
  at −6.83c (n=151).

### E-002 — Endgame donation channels exist but land at resting quotes (memo 003 claim c, mantis-verified; channel 1 restated as two cells in round 4)

- Channel 1, late longshot lottery buyers (two-sided, ask 4-20c, taker-buy).
  Round-4 mandatory restatement (mantis caught a cell conflation in memo
  004): the two cells are SEPARATE — do not pool them or paste one's
  monthly numbers over the other.
  - **t >= 885 cell — the robust one:** -2.90c (885) → -5.64c (897) →
    -6.20c (t=899, n=869), monotone into expiry. Fresh-book (age < 60s)
    monthly, 2025-10..2026-05: -8.14 / -6.72 / -3.39 / -1.09 / -3.20 /
    -3.21 / -3.92 / -4.61c — **8/8 months <= -1.09c**. 2026-01 falls
    -4.14c → -1.09c (n 744→493) once its stale books are removed (A-001):
    a third of that month's in-band endgame rows were stale and carried
    most of its donation. Claim verified stronger than before, at a
    mildly smaller pooled magnitude.
  - **t = 780+840 cell — WEAKER than previously stated.** The old row
    "6/8 months <= -1.3c (max +0.07c)" is SUPERSEDED. Fresh recut
    (mantis, round 4): 2026-01 -0.22c (n 1,255→1,126), 2026-02 -0.43c,
    2026-05 +0.19c — 3/8 fresh months sit inside fee. The donation's
    onset is late: small/patchy at t=780-840, unambiguous only from
    t >= 885.
  - Untakeable (both cells): every taker route to the sell side reduces to
    the fair fav ask via the mint-and-sell mirror (holds within 1.1c on
    130,502 checkpoints). K-004 confirmed the same route-duality identity
    at the early window (opp_ask = 1 - w_bid to the cent).
- Channel 2, last-second dumpers of winning favorites: see OL-001.
- Standing falsifiable claims (memo 003 c/d, retest on months > 2026-05):
  longshot 4-20c at t >= 885 stays <= -1c (round-4 status: survives 8/8
  months on fresh books); t=897/899 fav bid margin stays >= +1.5c. The
  780+840 cell carries NO standing claim.
- OL-002 exposure (round 6, `ol002_support.csv`): ch.1's 4-20c set holds
  570/15,725 Nov-Jan stale rows (1.46% at t=780 rising to 12.26% at
  t=899; 308 of 4,153 rows in the robust t >= 885 cell) — material in the
  print-found branch, but the fresh-book recuts already exist and the
  8/8-month status is quoted on fresh books. OL-001's bid cells hold
  113/3,361 (2.7-4.5%).
- Round-6 corroborating context (descriptive, from the Q-006 discovery
  sample — cite with that caveat): the same lottery channel is visible at
  mid-window (dog asks 16-18c at t=300 read −2.7..−6.4c on the holdout),
  but the favorite-side harvest built on it reversed out-of-sample; only
  the endgame expression above is verified.
- **A-002 label (round 7): SUPPORTED both regimes.** Robust t>=885 cell,
  fresh books: early −2.75/−4.80/−4.67c (z=−3.65/−5.79/−4.94), late
  −1.46/−5.81/−6.75c (z=−1.56/−7.15/−6.25) at t=885/897/899;
  month-pooled t>=885 stays 8/8 months <= −1.21c. No regime risk on the
  standing claim.

### C-001 — Mid-window coverage: MEASURED as of round 6 (supersedes the round-5 unmeasurability fact)

- Round-5 fact (kept for lineage): at census density only 29/4,534 cells
  (0.64%) reached the n >= 150 floor — the mid-window was UNMEASURABLE,
  not efficient, and nobody was permitted to cite it as clean.
- **Round-6 supersession — what IS now measured:** the interleave
  extraction put all 17,126 holdout episodes on t in {300, 450, 600, 690}
  (self-check 0.66% hard, cleanest of the night) and the frozen gate
  stack ran as the first real scan: **371 token-cells at n >= 150**
  (12.8x the round-5 count), 38 passed gate 1 (vs 77.6 expected under a
  fair-ask null — the field is negative-shifted, S-001's signature),
  5 passed adjacency, 1 passed everything — and that survivor (memo 006)
  REVERSED on the reserved census slice (Q-006).
- Standing conclusion, with its power scope attached (M-003 discipline):
  **the mid-window at t 300-690 is fair or sub-friction everywhere
  measured** — at n >= 150 per cell the scan sees ~2.5c+ effects, and the
  one candidate that size produced was a ghost. The region's cross-t
  shape even for that ghost decayed monotonically to E-001's endgame
  fairness (+3.6 → +2.7 → +0.1 → −0.8c at t=300→690).
- Residual holes, stated exactly: 15s-grid t-values between the four
  checkpoints remain census-density-only (unmeasurable per the round-5
  fact); t in (60, 300) likewise. Bracketed by fair readings on both
  sides; see the gap-map honesty note before spending a round here.

### S-001 — The resting-quote sink (structural pattern, 4 confirmed instances)

- Every donation channel this mission has measured empties into RESTING
  quotes; no taker route reaches any of them:
  1. t=15 skew correction (PR-002 mechanism): the unconditioned harvest is
     +0.35c net — nobody is paid to fix the level.
  2. Endgame longshot lottery flow (E-002 ch.1): -2.9..-6.2c donation at
     t >= 885, consumed by the spread via the mint-and-sell mirror.
  3. Endgame favorite dumpers (OL-001): +2.3/+2.5c margin exists only at
     the standing bid; the ask side of the same books is fair.
  4. Early-window momentum chasers (K-004): -1.4..-2.2c prev-winner tax;
     best expressible mirror nets -0.23c; route duality closed by mantis
     (buy-complement-at-ask == mint-and-sell-at-bid, opp_ask = 1 - w_bid
     to the cent at all four t).
- Prospecting consequence: a calibration deviation is a candidate ONLY if
  it exceeds the full spread at the cell plus fee. A deviation smaller than
  the spread is, by this pattern, someone else's maker revenue — label it
  on sight and route it (if the standing margin is large and month-stable)
  to the operator as an OL-001-class engine-gated lead, or (if thin) to
  the graveyard. Corollary: hunt where measured spreads are TIGHT relative
  to the deviation (friction_map.csv gives per-cell spreads).
- Round-5 addendum: the first measured S-001-EXEMPT shape exists — PR-005's
  frozen-book fossil ask IS a standing takeable quote (+9.3c gross to the
  taker, if the book is real). It died on replication/artifact/capacity
  grounds, not on the sink; the exemption class ("stale standing quote =
  takeable by definition") is validated as a prospecting category.
- Round-6 addendum: the first claimed exemption on FRESH books — memo
  006's one-tick mid-window favorite discount (+4.49c in one-tick books,
  "the mid itself is miscalibrated, a taker captures it") — REVERSED on
  the reserved slice (one-tick stratum +0.47c, inside fee; Q-006).
  S-001 remains unbroken on fresh books: after six rounds, no taker
  route through an actively-quoted book has survived out-of-sample. The
  only measured exemption class is still the suspect fossil quote.

### A-001 — Staleness audit — COMPLETE (round 4, mantis-verified instrumentation facts)

- Book age is NOT a confounder for 2025-10/11: they are among the freshest
  months at both t=15 and t=897 (p50 <= 0.1s; fresh% 97.1-99.9). Pre-declared
  recuts on age_ms < 60,000 are numerically stable: PR-002's locked cell
  unchanged (2025-10: -9.6c on 40/40 already-fresh episodes; 2025-11:
  -1.08c on 26/26); K-004's primary moves <= 0.19c/month. Verdict: the
  2025-10/11 sign flips (Q-001 +11.3/+4.4c, PR-002 -9.9/-1.1c, E-001
  outliers) are **REGIME/SAMPLING, not instrumentation**. No staleness
  footnote rescues any month-consistency count; **6/8-month consistency
  stays the honest ceiling** for full-window claims. PR-002's evidence
  component stands exactly as scored. 2025-10's separate defect
  (delta-churn self-check 11.1% raw / 4.7% hard at endgame) is a
  reconstruction issue, unrelated to quote age, and stands as before.
- **The true stale pocket is 2026-01 ENDGAME**: 15.3% of t=897 books older
  than 60s, p90 = 327s (five-minute-dead books inside the last 3 seconds);
  only 84.7% fresh vs 93-100% everywhere else. **DISTRUST FLAG (binding on
  future memos): any sub-2c endgame effect concentrated in 2026-01 must be
  recut on age_ms < 60,000 before it may be cited.** This flag already
  re-priced E-002's 2026-01: -4.14c → -1.09c at t >= 885, -1.23c → -0.22c
  at 780+840.
- Full age table (p50/p90 s at t=897; fresh%): 2025-10 0.8/5.6 (99.9),
  2025-11 0.3/1.7 (98.0), 2025-12 0.2/1.0 (93.2), 2026-01 0.1/326.6
  (84.7), 2026-02 0.1/0.3 (99.9), 2026-03 0.0/0.2 (100.0), 2026-04
  0.1/0.4 (99.8), 2026-05 0.0/0.3 (99.7). At t=15 all months p50 <= 0.1s.
- Source: memo 004 part B (`memos/004-prev-winner-momentum-tax.md`), every
  number mantis-reproduced. One immaterial memo overstatement on record:
  2025-11 t=60 primary moves 0.19c under the filter, not "<0.1c".
- Round-5 toolkit upgrade: the neighbor-market liveness check (see
  measurement assets) refutes machine-level recorder outage per-episode;
  it cannot discharge a per-market subscription drop. Round-5 escalation
  pending: if OL-002 finds trade prints inside the Nov–Jan frozen
  intervals, this flag hardens from "recut 2026-01 on fresh books" to
  "ALL Nov-2025..Jan-2026 stale rows are reconstruction fiction —
  quarantined" (scope now pre-computed in `census/ol002_support.csv`).
- Round-6 additions: (i) the predecessor-witness arm is CLOSED —
  mechanically blind by file-coverage construction (0/100 files span any
  freeze; recordings die median 239s before their own expiry); the
  successor is the only book-side witness. (ii) New audit fact: 73/93
  Nov-Jan-adjacent predecessor recordings died before their own window
  expired — per-market recording death was pervasive around the stale
  pocket, which weights the sub-drop artifact branch of PR-005 without
  deciding it. (iii) The exposure inventory over every atlas-cited
  endgame cell is on disk; the OL-002 print-found branch executes as a
  lookup.

### A-002 — Regime-shift audit of standing claims — COMPLETE (round 7; labeling only, nothing retired)

- Motivation: K-004's tax lived in 2025-10..2026-02 and flipped positive
  in 2026-05; carried three rounds as gap debt, executed round 7. Fresh
  books (age_ms < 60,000), `endgame_checkpoints.parquet`, early =
  2025-10..2026-02 vs late = 2026-03..2026-05. Files:
  `census/regime_audit.sql` + `census/regime_audit.csv` — the SQL is the
  template for every post-refresh month +1 recheck.
- **Result: no K-004-shaped flip in any standing claim.** Per-claim
  labels (also stamped on each claim's own entry):
  - E-001 fav 96+ within ±1c gross, t>=885: **MIXED early / SUPPORTED
    late** (early t=899 −1.04c, z=−1.94 — the only breach, marginal).
  - E-001 no adjacent positive fee-clearing band pair: **SUPPORTED
    both** (0 pairs in both regimes).
  - E-002 longshot 4-20c <= −1c, t>=885: **SUPPORTED both**
    (early −2.7..−4.8c; late −1.5..−6.8c; 8/8 months <= −1.21c pooled).
  - OL-001 fav bid margin >= +1.5c, t=897/899: **SUPPORTED both,
    STRONGER late** (+1.97/+2.24c → +2.65/+2.90c; z up to 10.58).
- Two details recorded, neither adjudicated: (i) the 4 same-direction
  adjacent pairs that exist early are all NEGATIVE, in longshot bands
  0-8 — E-002's own channel seen through the pair scan, gone late;
  (ii) a single hot month 2026-05 t=897 fav-96+ at −6.83c (n=151)
  inside an otherwise-supported late regime.
- Consequence: every post-refresh retest in the standing gap map starts
  from regime-stable priors; none of the frozen preregs gets ambushed by
  a claim that had already died in the recent regime.

### T-001 — "t=0 martingale anchor" — FALSIFIED ASSUMPTION (permanent trap)

- Claim: strike is set at open, so fair P(dog) at the t=0 book is ~0.50.
- Killed by: holdout P(dog wins | t=0 dog ask <= 0.46) = 0.4373, n=5,315,
  z=-9.15 vs 0.50. Pre-open book skew is genuine short-horizon directional
  signal, not error — the skewed side really does lose more often.
- Consequence: any memo whose fair-value side rests on "price at window open
  must be 0.50" inherits 001's reversal. The t=0 book may only be used as a
  CONDITIONING variable, never as a fair-value anchor.
- retryOnlyIf: never as an anchor. The open-skew information content is
  quantified (memo 002's 2x2: truth spread 8.9c at matched t=15 price) but
  harvesting it on 2025-10..2026-05 is banned — see PR-002.

## Graveyard

### Q-006 — Mid-window favorite discount (fav ask 82-86c, t=300, region claim) — QUARANTINED (round 6), score 8/100

- Memo: `memos/006-midwindow-favorite-discount.md` (mantis SURVIVES
  appended — the only one of quota window 004-006, now closed 1/3).
  Replication: `replication/REPLICATION-006.md` + `replicate_006.sql` —
  **REVERSED**. Prereg chain verified but demerit-carrying: the region
  prereg postdated the gate-stack dump (formalized, did not predict);
  the gate STACK itself was frozen 3 rounds before the data.
- Dedupe lineage: this is the round-6 gate-stack survivor (UP t=300 band 82) promoted to a region claim (both tokens, bands 82-84, t=300). The
  dog-side mirror (16-18c overpriced −2.7..−6.4c) is the SAME books via
  route duality — zero independent weight (mantis banked that). The
  mechanism was E-002's lottery channel claimed at mid-window; the
  endgame expression stays verified, this expression is quarantined.
- The discovery-side facts (holdout, n=1,271): +3.62c gross, z=3.85,
  unique max among ~92 candidate regions, 8/8 months sign-positive,
  one-tick stratum +4.49c (z=4.36) on a pre-registered split with a kill
  rule, survives dropping 2025-10, n_stale ~0, and mantis's own
  kill-shot probe — t=450 on 1,316 episode-instances the selection never
  touched — came back +2.18c (z=2.26). The strongest pre-reversal
  package of the night.
- The reversal (census slice, episode-disjoint by construction, better
  powered than declared — n=613 first-touch vs anticipated 200-300,
  expected z ≈ 2.6 under a true +3.6c): **pooled dev −0.04c** (P(win)
  83.36% vs ask 83.40c). One-tick stratum +0.47c — inside the 1.30c fee
  AND the weakest part of the static cell rather than the carrier: the
  claimed structure inverts. 5/8 months negative; the holdout's
  "recent three months strongest" shape does not reproduce (2026-03
  −0.34c, 2026-05 +0.08c). n_stale 0/613 — not an A-001 channel.
- Mantis's concession 1 fired verbatim: _"Pooled first-touch dev ≤ 0 on
  the census slice — the region was selection-plus-instrument artifact
  and I will write the graveyard entry myself."_ Mantis's point 4 had
  declared the outcome space near-binary (sharp island vs fluke — the
  diffuse-truth branch had no measured support: fav 78-90 excluding R
  read −0.79c on the holdout); the census answered fluke.
- Score arithmetic (rubric per MISSION.md):
  - Edge vs friction 0/30 — the only sample-disjoint read is −0.04c
    gross; one-tick +0.47c vs 1.30c fee. Nothing clears friction
    anywhere out-of-sample.
  - Evidence 3/20 — every corroborating arm (token mirror, month vector,
    one-tick split, t=450 fresh entrants) lived inside the discovery
    sample and inherited its selection; the one reserved read is null at
    P < 1% under the claimed truth, with inverted structure. Two points
    above Q-001's 2/20 for real, documented discovery discipline (frozen
    gates, verified prereg chain, mantis reproduction to the digit) —
    which is exactly what makes the reversal instructive.
  - Replication 0/25 — REVERSED; forces quarantine regardless of the
    other components.
  - Mechanism 3/15 — the donor channel (longshot lottery flow) is
    independently verified at endgame (E-002), so the mechanism is not
    falsified the way T-001 was; but its predicted mid-window expression
    measured zero on disjoint episodes, the cross-t decay "fingerprint"
    was computed inside the discovery sample, and the sharp band edges
    (82-84 in, 80/86 out) were never derived from the story.
  - Capacity 2/10 — ~$800 median top-3 per fire (0.2-0.25x the bar),
    ~5.3 fires/day, SCOPE-expressible, depth-walk unpriced. Moot.
  - **Total: 8/100. QUARANTINED.**
- Biggest remaining doubt (stated because it is real, not to soften the
  verdict): the two slices are not flatly contradictory. Under the frozen
  first-touch rule they disagree at z ≈ 2.1; on like-for-like STATIC
  t=300 selection the census analog reads +1.71c (n=156, z=0.60) vs the
  holdout's +3.62c — z ≈ 0.6 apart — and a homogeneous ~+2.3c truth sits
  within 1.4-1.6 SE of both slices. Two confounds keep this a doubt and
  not a defense: (i) the frozen rule (first-touch, t ∈ [240,360]) and the
  discovery measurement (static t=300) are different selections, and the
  holdout's 4-point grid structurally cannot express first-touch —
  first-touch vs static moved the census read from +1.71c to −0.04c on
  the same episodes; (ii) the slices were measured by different extractor
  code paths (`extract_midwindow.cjs` vs `extract.cjs`), cross-validated
  on only 16 episodes. Gap item 2 (the autopsy's instrument arm) splits
  these without re-mining the region. The quarantine stands on the frozen
  rule; precedent (Q-001, PR-005, K-004) binds.
- **Autopsy CLOSED (round 7): confound (ii) is DISCHARGED.**
  `extract_midwindow.cjs` re-ran over the 2,000 census episodes
  (`census_midwindow_checkpoints.parquet`, self-check 0.72% hard); the
  two code paths agree 7,999/8,000 rows (99.99%) on all 7 fields, and
  the disputed static t=300 in-band cell reads IDENTICALLY on identical
  entry sets: n=156, +1.705c, z=0.597 on BOTH paths — REPLICATION-006's
  census number reproduces to the digit. The lone discrepancy is a
  documented one-tick seq-vs-timestamp cutoff edge case at t=690,
  unstructured. The census/holdout gap is therefore SELECTION + SAMPLING
  — confound (i) alone: first-touch-over-a-9-point-15s-grid vs
  static-t300 are different populations (+1.71c vs −0.04c on the same
  episodes), and the −0.04c reversal was measured under the frozen rule.
  The boundary rule is vindicated; the remaining doubt shrinks to the
  static-selection z≈0.6 compatibility already stated above. E-001 and
  E-002, which stand on the same extractor family, carry NO instrument
  doubt line. retryOnlyIf unchanged.
- Trap names: (a) **within-sample disjointness is not out-of-sample** —
  disjoint episode arms, mirror tokens, and adjacent-t fresh entrants
  computed inside the discovery sample corroborated at z 2.2-4.4 and the
  reserved boundary still reversed it; only a slice reserved BEFORE
  discovery counts (this upgrades the disjoint-slice rule itself — see
  header). (b) **the frozen verdict rule must match the discovery
  selection** — a claim measured static that is retested first-touch has
  quietly changed populations; freeze the selection rule, not just the
  thresholds, and confirm the discovery data can express it.
- retryOnlyIf (per the mantis verdict's terms, binding): post-2026-05
  resolved months ONLY (markets.parquet refresh), the exact frozen
  first-touch rule (t ∈ [240,360], ask ∈ [0.82,0.86), two-sided, one
  entry per (slug, token)), no re-tuning of band/t/tolerance; fires iff
  pooled dev >= +2.0c at n >= 350 (z≈2 power per the memo's own
  arithmetic) AND one-tick stratum > 0. No re-slicing on 2025-10..2026-05
  — both samples are now consumed; the census/holdout boundary is spent
  on this cohort.

### PR-005 — Frozen-book endgame favorite discount (stale ask 80-96c, t >= 885, Nov-2025..Jan-2026) — KILLED, ACTIVE PRE-REGISTRATION (feed-integrity-gated), score 26/100

- Memo: `memos/005-frozen-book-endgame-favorite-discount.md` (mantis KILL
  appended, both parts; quota window 004-006 stays 0/3). Prereg:
  `census/round5_prereg.md` — integrity PASS with one recorded blemish
  (see measurement assets); the prereg killed its author's own promotion,
  third consecutive round.
- Dedupe lineage: this IS gap item 2 (round 4), unlocked by A-001's stale
  pocket. The 4-20c stale mirror (-9.9c) is the SAME frozen books seen
  from the losing token — one observation set, not a second entry. The
  stale deepening of E-002 ch.1 (-6.4c fresh → -9.9c stale at t=899) is
  this entry's mirror and was already consistent with A-001's 2026-01
  re-pricing. The three t values {885, 897, 899} are ONE observation set
  (same frozen episodes; +9.29/+9.25/+9.25c).
- The measured fact (mantis-reproduced to the digit; cite, do not
  re-derive): holdout books frozen > 60s at t in {885,897,899} with
  standing ask 80-96c resolve to that token 97.0% at avg ask 87.75c —
  **+9.3c gross / +7.9c net** (n=100 episodes = 83 outage runs, 70
  singletons, max run 4; run-level mean +10.2c, z_runs=7.9). Mirror 4-20c:
  -9.9c (z=-5.7). Fresh-book same cells at t=899: -2.3c — an +11.6c swing
  on book age alone. Placebo 20-80c (median 38-minute-dead, effectively
  never-quoted books): -0.7c. Positive 3/3 pocket months (2026-01 n=80
  +9.5c; 2025-12 n=14 +5.0c; 2025-11 n=3 +10.7c) and in both age buckets.
  Pocket shape: stale share at t=897 runs 2.0% → 6.8% → 15.3% across
  2025-11..2026-01, then 0.0-0.3% for four straight months — a Nov→Jan
  continuum, extinct since February.
- Neighbor-liveness result (mantis; the instrument is registered in
  measurement assets): 67/100 episodes neighbor-alive → machine-level
  recorder outage REFUTED for two-thirds of the cell; edge alive +9.63c
  (n=67, 65/67 win, standalone z~4.6) / silent +7.54c (n=26) — the effect
  does not hide in the outage-compatible stratum, and 2 of the 3 losers
  are in the alive subset. Surviving artifact: per-market subscription
  drop (Nov→Jan, fixed early Feb) — coherent, undischargeable from book
  data, and it reproduces every number above by construction. Only trade
  prints discriminate (OL-002).
- Score arithmetic (rubric per MISSION.md):
  - Edge vs friction 11/30 — +9.3c gross / +7.9c net taking a STANDING
    ask (friction = fee only, 156bps x 0.878 = 1.37c; no spread to cross)
    → 5.8x fee, the largest net margin measured all night. Discounted by
    more than half because the quote's EXISTENCE is the unpriced term:
    under the sub-drop scenario the real ask is ~97-99c and an IOC at the
    fossil quote fills only when the favorite is collapsing —
    adverse-selection-only fills. No query on recorded data can price
    that branch; a backtest would fill against the possibly-fictional
    book and reproduce +7.9c by construction.
  - Evidence 8/20 — n=100 episodes = 83 independent runs (z_runs=7.9);
    standalone z~4.6 on the alive stratum; mirror z=-5.7; placebo
    behaves; 3/3 pocket months; both age buckets; all three t. Docked
    hard: fails its own prereg floor (n=100 < 200); effectively ONE month
    (2026-01 carries 80 of 100); and the cell is OBSERVED, not predicted
    — the prereg's declared direction (H_glitch: low bands positive)
    came back REVERSED (4-20c = -9.9c) and the winning band was
    pre-declared not-glitch-shaped; post-hoc reframe demerit on record.
  - Replication 0/25 — structurally unevaluable twice over: the pocket
    lies entirely inside the already-measured holdout, and it is
    regime-extinct after January (0.0-0.3% stale share for the last four
    resolved months; resolved universe ends 2026-05). Precedent binds
    (PR-002, K-004): kill-to-preregistration, not SURVIVES.
  - Mechanism 6/15 — donor named (owner of an abandoned resting ask,
    fossilized at the pre-move price after spot leaves the strike) and
    persistence named ($130-$1,540 prize beneath bot table stakes;
    attention follows activity — S-001's own logic). First measured
    S-001-EXEMPT shape. Docked 9: the load-bearing premise (the ask
    existed on the exchange) is exactly the undischarged artifact branch,
    and the abrupt February extinction is unexplained under the market
    story while perfectly explained under "the subscription bug got
    fixed" — the regime shape itself argues for the artifact.
  - Capacity 1/10 — ~$130 at best ask (149 shares x 87.8c), ~$1,540
    top-3 (fossil-book walk unpriced) vs the 3-4k bar; ~100 in-band
    episodes per pocket month; zero pocket months in the last four
    resolved. Near-floor even if fully real.
  - **Total: 26/100. KILLED, converted to feed-integrity-gated
    pre-registration + operator lead (OL-002).**
- Killed by (mantis, numbered): (1) replication structurally unevaluable
  (see above); (2) the load-bearing question is operator-only — after
  the feed-alive check, only trade prints inside the frozen intervals
  discriminate sub-drop fiction from real fossil, and a SURVIVES would
  buy a replication slice that cannot move the answer; (3) the author's
  own prereg blocks promotion three ways (n floor, reversed declared
  direction, winning band pre-declared not-glitch-shaped); (4) capacity
  near-zero even if fully real.
- Trap names: (a) **recorded books can be fiction** — a reproduction at
  z=7.9 certifies the RECORDING, not the exchange; when the instrument
  itself is the suspect, statistical attacks cannot acquit it, and any
  backtest that fills against the recorded book reproduces the edge by
  construction. (b) **an observed cell is not a predicted cell** — a
  prereg whose declared direction reverses has generated a hypothesis,
  not confirmed one; re-framing the winner post-hoc is debt even when
  confessed.
- retryOnlyIf (mantis, binding, two arms):
  (i) **OL-002 — operator trade-print check** on the Nov–Jan frozen
  intervals, starting with the 67 neighbor-alive episodes. Silence →
  genuine historical glitch (still capacity/regime-dead) and the prereg
  below goes LIVE. Prints → quarantine ALL Nov–Jan stale rows on this
  atlas and harden A-001.
  (ii) **Locked future-pocket pre-registration (no re-tuning):** on any
  post-refresh resolved month with endgame stale share > 2% at t=897,
  the rule "book age > 120s at t=885, standing ask in [0.80, 0.96],
  taker-buy at the quote, hold to settlement" FIRES iff pooled gross
  > = +4c at n >= 60 in-band episodes AND the 4-20c mirror <= -4c AND the
  > 20-80c placebo within +-2c of 0 — AND ONLY alongside the feed-integrity
  > gate: the adjacent-window feed-alive check passes AND trade prints
  > inside the new frozen intervals are verified, because a per-market
  > sub drop reproduces the numeric criteria by construction. Any change to
  > the age threshold, band edges, or t restarts the comparison clock.

### K-004 — Prev-winner momentum tax (t=15-60, ask 0.50-0.66) — KILLED per own pre-registration (round 4), score 18/100

- Memo: `memos/004-prev-winner-momentum-tax.md` (mantis KILL affirmed and
  scoped; quota window 004-006 untouched at 0/3). Pre-registration
  integrity mantis-verified via file timestamps (prereg 06:38:55 → probe
  06:43:31 → memo 06:45:01, mtime = birthtime) and the behavioral tell:
  the prereg killed its author's own result — declaring t=45 instead of
  t=60 would have passed gates 1-5.
- Dedupe lineage: this IS gap pointer 3 grown up — same map region as memo
  003's t=15 whisper. **Demotion on record:** the round-3 "-1.06c
  confirmed" framing is retroactively downgraded — holdout-only is ~90%
  sample overlap with the round-3 union, so round 4 was instrument cleanup
  on the same episodes, not out-of-sample confirmation. No independent
  confirmation of this effect exists or can exist on 2025-10..2026-05.
- Verified calibration fact (mantis: cite, do not re-derive): prev-winner
  tokens at ask 0.50-0.66 resolve below price — -1.26 / -1.72 / -1.92 /
  -1.41c at t=15/30/45/60 (n=7.0-7.7k per cell; t=45 CI [-3.06, -0.78]);
  DEEPENS on fresh books (-1.96/-2.17/-1.61 at t=30/45/60 — not a
  stale-quote artifact, per A-001). Contrast vs prev-loser -1.27..-1.54c.
- Regime caveat (mantis, memo underplayed it): the tax lives in
  2025-10..2026-02 (+2026-04 at t=45). At the declared t=60 the last three
  resolved months are +0.69 / -0.45 / +0.94; 2026-05 is positive at EVERY
  t; the deepest cells (-3.73/-4.37) sit in distrusted 2025-10. The
  calibration fact is genuinely at risk on new months.
- Score arithmetic (rubric per MISSION.md):
  - Edge vs friction 3/30 — the deviation is real (-1.4..-2.2c, t=45 CI
    excludes zero by 0.78c) but the ONLY expressible route nets negative
    at every t: best leg t=45 gross +0.49c (z=0.84) vs 0.72c fee →
    **-0.23c net**. The 1.9c overpricing coexists with a fair complement
    ask; the gap between them is the spread, and crossing it consumes the
    donation. Power: harvest net 95% CI upper +0.91c — the kill rules out
    a >= 1c-net harvest, not a sub-1c one; ruling out 0.5c net needs ~29k
    in-cell episodes vs ~7k existing.
  - Evidence 6/20 — n=7.0-7.7k/cell, z to -3.30, fresh-book deepening,
    contrast intact (prev-loser -0.47c at t=60). Docked hard: 5/8 months
    at the declared t=60 (7/8 only at non-declared t=45); regime
    concentration per above; sub-band shape sign-churns (4 lone |z|>2
    cells, no contiguous run, ~0.9 flukes expected in 18 cells); ~90%
    sample overlap with the round-3 prior.
  - Replication 0/25 — unevaluable: resolved universe exhausted; the one
    "confirmation" was the overlap demoted above.
  - Mechanism 9/15 — donor named (post-resolution momentum chasers
    taker-buying the just-won side in the first 30-60s; new-window outcome
    ~independent of old) and persistence named AND structurally verified:
    the correction is maker-only — mantis closed the route-duality hole
    (buy-complement-at-ask and mint-and-sell-at-bid are the same route to
    the cent; the memo priced the cheaper fee leg; no unexplored
    expressible harvest). Docked 6: a persistence story must persist —
    the donor is measurably absent in 2026-03/05.
  - Capacity 0/10 — no expressible entry/exit path under SCOPE; nothing
    to size. NOT filed as a second operator lead: the takeable mirror is
    only 0.2-0.5c from fair — no margin budget for adverse selection
    (contrast OL-001's +2.3-2.5c, 8/8 months).
  - **Total: 18/100. KILLED.**
- Killed by: pre-registered gate 2 (deepening: edge(60) = -1.41c vs
  required <= -1.76c — effect peaks at t=45 and shallows), gate 4 (5/8
  months negative at t=60), and decisively gate 6 (harvest fails friction
  at every t). Fourth confirmed instance of the resting-quote sink
  (S-001).
- Trap names: (a) **route duality** — on a binary book, buying the
  complement at its ask IS minting-and-selling the target at its bid
  (opp_ask = 1 - w_bid); price the cheaper fee leg once and stop looking
  for a second door. (b) **sample-overlap confirmation** — re-measuring
  ~90% of the same episodes with a cleaner instrument is cleanup, not
  confirmation; only disjoint episodes confirm.
- retryOnlyIf (mantis, binding): reopen only on (i) >= 2 newly resolved
  months > 2026-05 where prev-winner in-band stays <= -1c gross at
  t in {30,45} AND the complement harvest leg clears 156bps x ask net at
  z >= 2 on those months alone; or (ii) an engine-side maker-fill
  instrument (same gate class as OL-001). No re-slicing of
  bands/t/decision-points on 2025-10..2026-05 — the harvest question
  needs ~29k in-cell episodes and the resolved universe holds ~7k.
- Low-priority engine note (not an operator action item): the memo's
  000-baseline (taker-buy prev-loser at t=45 when prev-winner ask is in
  0.50-0.66; sweep t in {30,45,60}) would let the engine's measured
  fees/slippage adjudicate the -0.23c point estimate. Standing margin
  <= 0.5c gross — an order of magnitude thinner than OL-001's prior.

### M-003 — "Memorylessness family has no harvestable member" — KILLED CLAIM (mantis, round 3)

- Memo: `memos/003-endgame-taker-efficiency.md` (verdict appended). The
  kill is scoped: claims a/b/c were verified and live above as E-001/E-002/
  OL-001; claim (d) — closure of gap pointer 4 — is what died.
- Killed by: the memo's own table (T3 ask-thin leg +1.08c gross at avg ask
  0.5940, fee 0.93c → **+0.15c net at point estimate**, contradicting "no
  leg clears fee"); power (per-leg 95% CI upper bounds +1.8c..+3.1c at
  n=1,268-3,991 — cannot distinguish "null" from "fee-clearing 1-2c";
  resolving needs ~11k/leg and the resolved universe is exhausted); and a
  null shipped with no replication hook would have entered the map as
  permanently untested truth.
- Trap name: **a negative claim needs power arithmetic, exactly like a
  positive one needs friction arithmetic.** "All null" at n that admits 3x
  fee is not null — it is unmeasured.
- Not scored as an anomaly (negative result; the memo's one edge-shaped
  finding is scored at OL-001: 29/100).
- retryOnlyIf (mantis, binding on the family): pointer 4 stays OPEN,
  power-scoped ("rules out 8.9c-scale; cannot rule out <= ~2.7c"). Close or
  open only at n >= ~11,000/leg on resolved data (~5+ new months after the
  markets.parquet refresh) or a disjoint-slice negative point estimate. No
  further probes of this instrument on 2025-10..2026-05.

### K-002 — Endgame 96+ certainty grab (t=897/899, fav ~0.98) — CLOSED WRONG-SIGNED (round 3, formal)

- Round-1 self-kill (P(win)=1.000 at n=204, Wilson lower bound ~ ask) is
  now formally closed against its exact retryOnlyIf by memo 003 + mantis:
  n delivered (3,238 / 1,976 / 1,260 at t=885/897/899 — the t=897 shortfall
  vs the 2,000 bar is population-exhausted, not underdelivered, and moot
  because the Wilson UPPER bound is already negative pre-fee), one-sided
  selection handled explicitly (books kept; the restriction to two-sided is
  conservative — high-band ask_only quotes are rare and wrong-signed, e.g.
  t=897 band 98: n=13, P(win)=0.077).
- Final numbers: buying fav 96+ at t=897/899 is -0.61/-0.68c gross,
  ~ -2.2c net of fee, on the largest sample this dataset can produce.
- retryOnlyIf: no re-slicing of this cell family without months > 2026-05.
  E-001's standing falsifiable claim is the designated retest.

### PR-002 — Memoryless t=15 book / skew-intact favorite (fav at t=15 ask) — KILLED, ACTIVE PRE-REGISTRATION

- Memo: `memos/002-memoryless-t15-open-skew.md` (mantis verdict KILL
  appended; no replication step — nothing disjoint exists to replicate on).
- Lineage: third slicing of Q-001's dog-ask<=0.46 cohort; the harvestable
  mirror of REPLICATION-001's table b (dog t=15 net -3.7c, z=-5.4).
  Deduped INTO this entry: gap-map pointer 1 (round 1), whose sanctioned
  unconditioned measurement FAILED friction (+0.35c net, n=5,875) — the
  surviving cell needed a mined interaction term (skew intact at t=15).
- Score arithmetic (rubric per MISSION.md):
  - Edge vs friction 10/30 — union window +3.44c gross / +2.51c net
    (n=1,887), 3.7x measured remaining friction (1.22c spread consumed +
    0.94c fee at 0.5994); mantis reproduced +3.89c holdout and its
    stale-book attack failed (+3.63c, n=1,402). Discounted hard: mined on
    the banned window with ~10+ splits of comparison debt on z=3.12, and
    net assumes best-ask fill for the whole clip (1c of depth-walk removes
    40% of net).
  - Evidence 8/20 — 6/6 months positive 2025-12..2026-05 (+1.8c..+9.4c),
    monotone skew-depth gradient (+4.56c / +2.71c / -1.19c across
    <0.44 / 0.44-0.46 / 0.46-0.48), entry-time plateau t=15..60 (net
    +2.51..+2.36c), mid-based restatement +2.69c, placebo -0.13c. Against:
    the ONLY sample-disjoint read is wrong-signed (census -0.98c, n=175)
    and this exact cohort already produced a z=2.4 census phantom that
    reversed at z=2.66 (REPLICATION-001).
  - Replication 0/25 — unevaluable: the union consumes every resolved
    episode in existence (max resolved month 2026-05); a powered disjoint
    test needs ~3 new resolved months.
  - Mechanism 11/15 — donor named (makers re-centering off post-open
    reversal flow; 90.5% of skewed opens price the previous window's loser
    as favorite) and persistence is measured-adjacent: the state variable
    is invisible at t=15, the unconditioned harvest is +0.35c net so nobody
    is paid to correct the level, T-001 (z=-9.15) supplies the information
    content. Docked: the 2x2's contradicted leg is z=-1.81 (n=365),
    noise-compatible.
  - Capacity 2/10 — fav-ask depth at t=15 in-cell: best level median ~97
    USDT, top-3 median ~570 USDT (p10 ~155) vs the 3-4k bar; ~9.5
    fires/day gives ~3-6k USDT/day aggregate at 300-600 USDT clips.
    SCOPE-expressible. Mantis caps this at 2 until depth-walk slippage for
    a 300 USDT clip is measured. Round-3 update: top-3 ask depth covers a
    300-USDT clip 69% of in-cell fires pooled but is UNSTABLE by month
    (20.6% → 87% → 43.6% across the window); the exact depth-walk still
    cannot be computed — the t=15 extraction carries only d1/d3 aggregates,
    not per-level prices. Cap stands.
  - **Total: 31/100. KILLED (structurally unfalsifiable today + banned
    cohort), converted to pre-registration.**
- Killed by: Q-001 retryOnlyIf ("do not retry on 2025-10..2026-05 data")
  covering the cohort; sole disjoint read wrong-signed; replication
  unevaluable until ~3 new resolved months; capacity ~570 USDT median vs
  3-4k bar with slippage unmeasured inside a 2.5c margin.
- **Pre-registration (locked 2026-07-10 — no re-tuning permitted):** on >= 3
  resolved months strictly after 2026-05, fresh instrument, exact rule:
  two-sided t=0 and t=15 books; dog ask(t=0) <= 0.46; fav ask(t=15) >=
  fav ask(t=0) - 0.005; taker-buy fav at t=15 ask; hold to settlement.
  FIRES iff pooled gross >= +2c at n >= 350 AND unskewed placebo (dog ask
  0.48-0.50, same intact condition) within +-1c of zero AND
  skew-contradicted movers at matched ask <= 0. Any change to the 0.46
  threshold, 0.5c tolerance, or entry time restarts the comparison clock.
  On pass: verdict voided, re-enters at replication stage; replicator must
  then measure 300-USDT depth-walk slippage (per-level prices required —
  a new extraction, not the existing d1/d3 aggregates) before capacity can
  exceed 2/10. Expected accrual ~130 in-cell episodes/month → powered ~3
  months after the markets.parquet outcomes refresh.

### Q-001 — Window-roll reversal skew (t=0 dog at ask) — QUARANTINED

- Memo: `memos/001-window-roll-reversal-skew.md` (mantis SURVIVES, 1/3 quota).
  Replication: `replication/REPLICATION-001.md` — **REVERSED**.
- Score arithmetic (rubric per MISSION.md):
  - Edge vs friction 0/30 — holdout t=0 edge -0.7c gross / -1.4c net;
    t=15 entry -3.7c net (z=-5.4). No edge exists.
  - Evidence 2/20 — census region was contiguous with fair flanks (+5.1c,
    n=560, z=2.41) but holdout n=5,315 (9.5x) puts the treated cell at
    placebo level (-0.7c vs -0.3c/+0.6c flanks). Sampling fluke, amplified
    by the two sparse-snapshot months (2025-10/11 the only sizable holdout
    positives: +11.3c n=120, +4.4c n=113). Round-4 audit footnote (A-001):
    those months' books are FRESH — the flips are regime/sampling, not
    quote staleness; no instrumentation rescue exists in either direction.
  - Replication 0/25 — REVERSED; forces quarantine regardless of the rest.
  - Mechanism 0/15 — donor was named, but the load-bearing premise
    ("P(dog)~0.50 at t=0 by martingale") measured 0.4373 on holdout,
    z=-9.15. Mechanism falsified, not merely unproven.
  - Capacity 2/10 — ~200-500 USDT/window (median top-3 dog-ask depth ~465
    USDT), fails the 3-4k bar; rule itself is SCOPE-expressible.
  - **Total: 4/100. QUARANTINED.**
- Killed by: holdout pooled t=0 edge -0.7c (n=5,315) and t=15 net -3.7c;
  mantis concession criteria 1, 2, 3 all fired; side split symmetric
  (UP -0.7c / DOWN -0.8c), so criterion 4's drift-artifact story is also out.
- retryOnlyIf: a disjoint future slice (months > 2026-05, resolved) shows
  treated-vs-placebo contrast >= +3c with n >= 1,000 AND without invoking the
  t=0 fair-value anchor (see T-001). Do not retry on 2025-10..2026-05 data.
  Enforcement precedent: this clause killed memo 002 (PR-002 above), the
  cohort's third slicing.

### K-003 — Late-window 10c+ jump continuation (t 600-900) — self-kill (gabagool, round 2)

- Apparent invariant (`census/jumps.csv`): 10c+ jumps at t 600-780 showed
  median 120s mid-drift +6.0c up (n=974) / -4.25c down (n=964).
- Killed by chain-dedupe + settlement basis: rows re-trigger every 10s;
  deduped to first jump per chain (>30s gap, same direction) n collapses
  ~2.4x to 181 up / 221 down. Settlement-based edge vs post-jump MID
  (before spread and fee): up +2.4c (P=0.6022 at mid 0.578), down +0.6c
  (P=0.5566 at 0.551) — direction-asymmetric; at 5-10c magnitude it
  sign-flips (up +2.2c / down -2.6c). Paying the post-jump ask plus 156bps
  erases the remainder. The +6.0c "drift" was duplicated-row mid-drift, not
  harvestable edge.
- Trap names: (a) jump re-trigger rows are not events — chain-dedupe before
  believing any jump n; (b) global first-per-episode dedupe is too
  aggressive for late buckets (first 3c+ move almost always lands before
  t=300, leaving n<=3 late) — use gap-based chaining, not global firsts.
- retryOnlyIf: a chain-deduped, ask-based, settlement-basis cut clears
  measured friction with the SAME sign in both directions in >= 6/8 months.

### K-001 — Mid-window longshot overpricing (t 300-600, 5-9c band) — self-kill

- Apparent -2.0 to -2.8c dev on n~1,800 checkpoint rows was duration
  weighting: lingering episodes contribute repeated rows. Deduped to first
  entry per episode: -1.0 to -1.3c (inside friction) and month-flipping
  (positive 2025-11..2026-02, negative 2026-04/05).
- Trap name: checkpoint-row n is not episode n. Every calibration claim must
  dedupe to episodes before quoting n or z.
- Round-3 footnote: the same longshot overpricing measured at endgame is
  2-6x larger and monotone (E-002 channel 1) — real, and still untakeable;
  the donation is consumed by the spread it crosses.
- retryOnlyIf: episode-deduped deviation > cell friction with the same sign
  in >= 6/8 months.
