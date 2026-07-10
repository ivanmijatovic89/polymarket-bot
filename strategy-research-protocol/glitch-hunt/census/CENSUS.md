# Census v1 — BTC 15m up/down checkpoint dataset

Built 2026-07-10 by the surveyor (Glitch Foundry Phase 1). All paths below are
relative to `strategy-research-protocol/glitch-hunt/census/`.

## Provenance

- Source episodes: `data/events/telonex/delta-typed/btc/15m/btc-updown-15m-<epoch>.parquet`
  (repo root relative), replayed in `ingest_seq` order.
- Outcomes: `data/telonex/markets.parquet`, join key `slug`, resolved rows only.
  **result_id semantics: `'0'` = UP wins, `'1'` = DOWN wins** (index, NOT an
  asset id — confirmed in `src/backtest/stats/telonexMarketResolution.ts` and
  validated empirically: at t=899 with up_mid>0.95, P(UP)=1.0000 (n=59); with
  up_mid<0.05, P(UP)=0.0000 (n=63)).
- Book reconstruction per ENGINE.md: `book` = full snapshot replacement;
  `price_change` size 0 removes a level, non-zero upserts. Side code 0 = bid
  (BUY), 1 = ask (SELL) (`src/telonex/converters/deltaTyped.ts`).
- Window anchor: epoch in slug = window start (sec); window = [epoch, epoch+900].
  Pre-window events are replayed as initial state only.
- Extractor: `extract.cjs` (Node + `@duckdb/node-api`, 2 threads / 3GB / nice 19,
  resumable per 100-file batch via `progress.json`).

## Sample

Stratified by calendar month (UTC), even-stride within month over the
intersection of (local episode file exists) AND (resolved outcome exists).
250 episodes per month x 8 months = **2,000 episodes**, listed in
`sample_manifest.csv`.

| month   | sampled | available (file ∩ resolved) |
| ------- | ------- | --------------------------- |
| 2025-10 | 250     | 1204                        |
| 2025-11 | 250     | 2368                        |
| 2025-12 | 250     | 2921                        |
| 2026-01 | 250     | 2842                        |
| 2026-02 | 250     | 2688                        |
| 2026-03 | 250     | 2976                        |
| 2026-04 | 250     | 2880                        |
| 2026-05 | 250     | 1247                        |

**2026-06 is NOT covered**: 1,287 episode files exist but `markets.parquet` has
no resolved rows for them (its coverage ends mid-May 2026). Any Phase 2 holdout
plan must treat 2026-06 as outcome-less until markets.parquet is refreshed.

## Checkpoint grid

Per episode, 71 checkpoints at t_sec ∈ {0,15,...,900} ∪ {840,845,...,895}
∪ {897,899}. A checkpoint at T reflects all events with `ts_local_ms <=
epoch*1000 + T*1000`.

## Extractor self-check (snapshot vs delta-reconstruction)

At every `book` snapshot after the first per asset, reconstructed best bid/ask
were compared to the snapshot's. 799,942 snapshots checked across the sample:

| month   | snaps/ep | raw mismatch % | stale-explained | hard %   | incidents/ep |
| ------- | -------- | -------------- | --------------- | -------- | ------------ |
| 2025-10 | 104      | 10.99          | 69% of mism.    | 3.40     | 5.7          |
| 2025-11 | 319      | 4.44           | 76%             | 1.07     | 7.1          |
| 2025-12 | 300      | 2.97           | 63%             | 1.10     | 4.4          |
| 2026-01 | 463      | 1.34           | 55%             | 0.61     | 3.1          |
| 2026-02 | 669      | 1.06           | 57%             | 0.45     | 3.5          |
| 2026-03 | 635      | 1.09           | 54%             | 0.51     | 3.5          |
| 2026-04 | 391      | 1.47           | 48%             | 0.76     | 2.9          |
| 2026-05 | 320      | 1.37           | 37%             | 0.86     | 2.2          |
| ALL     | 400      | **2.02**       | 61%             | **0.78** | 4.0          |

Interpretation (investigated case-by-case, see below): the raw rate exceeds the
0.5% bar, but this is a **data-feed artifact, not a reconstruction bug**:

1. **Stale snapshots** (>= 61% of mismatches, conservatively classified): the
   snapshot payload matches the reconstructed state from up to 10s EARLIER —
   deltas already ingested are newer than the snapshot content. Classification
   requires both best bid AND best ask to match a single prior state within
   10s, so partially-stale snapshots land in "hard"; the true stale share is
   higher.
2. **Hard residual** (0.78% overall): lost deltas — levels removed by a delta
   then present in a later snapshot, or added by a delta then absent from the
   snapshot, with no intervening delta touching that level. The reconstruction
   is a faithful fold of everything the file contains; the engine's own replay
   (`telonex-delta`) produces the identical state sequence, so the census
   measures exactly what any backtest would see.
3. Mismatches always come in pairs (Up/Down books mirror), so incidents =
   mismatches/2, roughly 2-7 per episode regardless of month; per-snapshot
   rates differ mainly because snapshot cadence differs (~93s in 2025-10 vs
   ~5s dense stretches later).
4. **Magnitude** (`mismatch_audit.csv`, 80 episodes, 10/month): mean |mid
   error| at a mismatching snapshot is 0.5-0.8 cents; max observed 15.5c
   (single 2025-11 case). Errors self-heal at the next snapshot.
5. **Mirror invariant**: 0 of 130,502 checkpoints with both up_best_bid and
   down_best_ask present violate
   |up_best_bid + down_best_ask − 1| <= 0.011 — the fold is internally
   consistent.

Net: checkpoint top-of-book values carry a ~1% chance (worse in 2025-10/11,
better from 2026-01) of a sub-cent-to-2-cent transient error. Sub-2-cent
effects in 2025-10/11 should be treated as within noise.

## Files

| file                                        | what                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `sample_manifest.csv`                       | slug, epoch, month, result_id for the 2,000 sampled episodes               |
| `outcomes_all.csv`                          | all 20,712 resolved btc-updown-15m outcomes (for later coverage extension) |
| `checkpoints/batch-*.csv`                   | raw extractor output, 20 batches                                           |
| `checkpoints.parquet`                       | canonical checkpoint dataset, 142,000 rows                                 |
| `jumps/batch-*.csv` + `jumps_raw.parquet`   | per-jump rows, 92,135 rows                                                 |
| `selfcheck.csv` + `selfcheck_by_month.sql`  | per-episode self-check counts + rollup query                               |
| `mismatch_audit.csv` + `audit_mismatch.cjs` | mismatch magnitude audit                                                   |
| `calibration.csv`                           | P(UP wins) per cell                                                        |
| `friction.csv`                              | spread/depth per cell                                                      |
| `endgame.csv`                               | endgame calibration                                                        |
| `jumps.csv`                                 | jump drift aggregates                                                      |
| `windowroll.csv`                            | per-episode window-open stats                                              |
| `extract.cjs`, `build_tables.sql`           | the code that built all of the above                                       |

## Table schemas

**checkpoints.parquet** — slug, epoch, t_sec, up_best_bid, up_best_ask, up_mid,
spread (up book, $), top3_bid_depth, top3_ask_depth (sum of sizes at 3 best up
levels, shares), down_best_bid, down_best_ask, last_event_age_ms (any-asset
event), month, up_won (bool), band_c (2-cent up_mid band: floor(mid*50)*2,
clamped to 98; NULL when mid is NULL).

**calibration.csv** — month ('ALL' + each month), t_sec (15s grid), band_c, n,
n_up_wins, p_up, avg_mid. Cells need n filtering by the consumer — no minimum
n was imposed.

**friction.csv** — month, t_sec, band_c, n, med/p90 spread, med/p90 top3 bid
and ask depth.

**endgame.csv** — month, t_sec ∈ {840..900 step 5, 897, 899}, band_c, n,
n_up_wins, p_up, med_spread.

**jumps_raw.parquet** — slug, epoch, t_sec (jump time in window), jump_size
(signed mid change over trailing <=10s, trigger |x|>=0.03, 10s cooldown),
mid_at_jump, drift_30s/60s/120s (mid(t+h) − mid_at_jump; NULL when t+h passes
the window end), month, up_won.

**jumps.csv** — t_bucket (000-300/300-600/600-780/780-900), jump_dir, jump_mag
(3-5c/5-10c/10c+), n, and med/p10/p90 of drift at 30/60/120s.

**windowroll.csv** — slug, month, epoch, mid_t0, spread_t0 (state at window
open, i.e. reflecting all pre-window events), mid_t30, up_won.

## Endgame holdout extension (round 3 interleave, built 2026-07-10)

Extractor: `extract_endgame.cjs`; tables built by `build_endgame_tables.sql`.
Coverage: **all 17,126 holdout episodes** (`replication/data/holdout_manifest.csv`,
disjoint from the 2,000-episode census sample), checkpoints at
t ∈ {780, 840, 870, 885, 897, 899} = **102,756 rows**, 6 per episode, 0 errors.

Key difference from the main census: **one-sided and empty books are KEPT** —
best bid and best ask are recorded independently with sizes and top-3 depth
per side for BOTH assets (`up_state`/`down_state` ∈ two_sided | bid_only |
ask_only | empty). `band_c`/`spread` are NULL only where genuinely undefined;
the row itself always exists. Fields: slug, epoch, month, result_id, t_sec,
{up,down}\_{bid,bid_sz,ask,ask_sz,top3_bid,top3_ask}, age_ms,
replay_start_off_s, up_won, up_state, down_state, band_c, spread.

Replay optimization (validated): replay starts at the last `book` snapshot per
asset with ts <= t780 (min across assets; 17,111 fast / 15 full-file
fallbacks). On a 15-episode validation set, all 90 overlapping checkpoints
matched the full-replay census extractor exactly on every field (best
bid/ask, top-3 depths, age_ms).

Self-check (snapshots within the replayed range only): 18,410/527,355 raw
mismatches = **3.49%**, stale-explained 10,762, **hard 1.45%**
(`endgame_selfcheck_by_month.csv`; worst 2025-10 at 11.1%/4.7% raw/hard,
2026-01..04 at ~2.5-3.0%/1.1-1.4%). This is higher than the census whole-file
rate (2.02%/0.78%) because the endgame window is churn-dense: on the same 15
validation episodes, whole-file snapshots mismatched at 2.26% vs 4.55% in the
endgame range while checkpoint values were bit-identical — a feed-region
property (stale snapshots/lost deltas, see the main self-check section), not
a fold bug. Same caveat applies: sub-2-cent endgame effects in 2025-10/11 are
within noise.

One-sided-book taxonomy (ALL months, up book; down mirrors) — the mass the
main census dropped as NULL-mid, and it is near-deterministic:

| t_sec | two_sided | bid_only | ask_only | empty | P(UP&#124;bid_only) | P(UP&#124;ask_only) | P(UP&#124;two_sided) |
| ----- | --------- | -------- | -------- | ----- | ------------------- | ------------------- | -------------------- |
| 780   | 13,498    | 1,842    | 1,752    | 34    | 0.9967              | 0.0057              | 0.4973               |
| 840   | 10,581    | 3,372    | 3,162    | 11    | 0.9982              | 0.0016              | 0.4911               |
| 870   | 8,100     | 4,604    | 4,412    | 10    | 0.9987              | 0.0025              | 0.4888               |
| 885   | 6,351     | 5,491    | 5,276    | 8     | 0.9993              | 0.0027              | 0.4831               |
| 897   | 3,952     | 6,628    | 6,531    | 15    | 0.9991              | 0.0018              | 0.4884               |
| 899   | 2,794     | 7,176    | 7,149    | 7     | 0.9992              | 0.0013              | 0.4979               |

Ask-only books sit almost entirely at ask <= 0.02 (t=870: 8,929/9,016 in band
0, avg ask 0.0074, P(win)=0.0019); high-band ask-only quotes are rare and
miscalibrated (t=897 band 98: n=13, P(win)=0.077 at avg ask 0.986 — stale).

Endgame extension files:

| file                                                                                  | what                                                                                                                                         |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `endgame/checkpoints/batch-*.csv` + `endgame/progress.json` + `endgame/selfcheck.csv` | raw extractor output, 172 batches                                                                                                            |
| `endgame_checkpoints.parquet`                                                         | canonical endgame checkpoint dataset, 102,756 rows                                                                                           |
| `endgame_taxonomy.csv`                                                                | book-state counts + P(UP) per (month+'ALL', t_sec, up_state)                                                                                 |
| `endgame_calibration_mid.csv`                                                         | two-sided mid calibration per (month, t_sec, band_c) with med_spread                                                                         |
| `endgame_calibration_takeable.csv`                                                    | P(token wins) per (month, t_sec, token, state, 2c ask band) + med ask size / top-3 ask                                                       |
| `endgame_calibration_bid.csv`                                                         | same shape on the bid side                                                                                                                   |
| `endgame_selfcheck_by_month.csv`                                                      | self-check rollup                                                                                                                            |
| `friction_map.csv`                                                                    | per (t_sec, band_c) on up book: n, med/p25 spread, med/p25 top-3 depth both sides — from census checkpoints (source='census'), full 15s grid |
| `friction_map_endgame.csv`                                                            | same cells from the endgame holdout rows (two-sided only, source='endgame_holdout')                                                          |

## Mid-window holdout extension (round 6 interleave, built 2026-07-10)

Extractor: `extract_midwindow.cjs` (extract_endgame.cjs with grid
t ∈ {300, 450, 600, 690}, fast-start anchor at the last `book` snapshot
per asset ≤ t300, replay cutoff t690); tables built by
`build_midwindow_tables.sql`. Coverage: **all 17,126 holdout episodes**,
**68,504 rows** (4/episode), 0 errors, 17,084 fast-start / 42 full-replay.
Same conventions as the endgame extension: one-sided/empty books KEPT with
per-side best + sizes + top-3 depth for both assets, state taxonomy
(two_sided | bid_only | ask_only | empty), `age_ms` on every row.
Validation: on 16 census episodes (2/month), all 64 overlapping
checkpoints matched the full-replay census extractor exactly on every
field (best bid/ask, sizes excluded there, top-3 depths, age_ms).

Self-check (`midwindow_selfcheck_by_month.csv`): 55,129/3,211,620 raw =
**1.72%**, hard (stale-explained excluded) **0.66%** — better than the
endgame region (3.49%/1.45%), in line with the census whole-file rate
(2.02%/0.78%). Worst month as always 2025-10 (10.16% raw / 3.14% hard);
2025-11/12 ≈ 0.9-1.0% hard; 2026-01..05 ≤ 0.7% hard. Standing caveat
unchanged: sub-2c effects in 2025-10 are within noise.

Book-state taxonomy at mid-window (up book, ALL months): two-sided mass
is 99.6% at t=300 (17,062/17,126), 99.6% at t=450, 97.5% at t=600,
91.3% at t=690 (15,642; 741 ask_only / 723 bid_only / 20 empty).
One-sided states are near-deterministic already at t=600
(P(UP|bid_only)=1.000, P(UP|ask_only)=0.01) — same shape E-001 measured
at t≥780.

Files: `midwindow_checkpoints.parquet` (canonical, 68,504 rows),
`midwindow_taxonomy.csv`, `midwindow_calibration_mid.csv`,
`midwindow_calibration_takeable.csv`, `midwindow_calibration_bid.csv`,
`midwindow_selfcheck_by_month.csv`, `friction_map_midwindow.csv`
(source='midwindow_holdout'), raw batches under `midwindow/`.

### Round-6 frozen gate stack over the new data (`round6_probe.sql`)

Memo 005 Part A's exact stack (gates frozen round 3, re-affirmed by
mantis round 5; zero cells carried), episode-level, 2c ask bands, both
tokens, n ≥ 150, friction from `friction_map.csv` (source='census'),
run at t ∈ {300, 450, 600, 690} on the holdout (~9.5x census density).
Full scored-cell dump: `round6_gatestack_cells.csv` (371 cells).
Counts: **371 cells** at n ≥ 150 (vs 29 at census density — the region
is now measurable, per C-001's re-registration), 108 friction-unpriced,
**38 pass gate 1** (margin > 0), **5 pass gates 1+2** (adjacency),
**1 passes all three** (≥6/8 months): UP t=300 band 82 — n=324,
avg_ask 82.52c, P(win) 87.04%, dev +4.51c, margin +2.22c,
dev−p50_full_spread +3.51c (> 0 → not a maker-sink label per S-001),
z=2.42, months 7/8 (2026-02 is the miss at −3.40c; monthly dev
+3.36/+1.07/+9.96/+2.42/−3.40/+8.09/+7.87/+4.43c for 2025-10..2026-05),
flanks +0.65c (band 80, n=376) / +4.03c (band 84, n=322), med top-3
take-side depth 869 shares, n_stale 0 (fresh-book dev identical at
+4.51c). Interpretation is gabagool's job (round-6 memo), not this
file's — the comparison-debt arithmetic (371 cells scanned, 1 survivor)
belongs in that memo.

## OL-002 support pass (round 6, gap item 3 — built 2026-07-10)

Files: `ol002_liveness.csv` (per-episode, script `ol002_liveness.cjs`),
`ol002_support.csv` (exposure inventory, query `ol002_support.sql`).

**(i) Predecessor-witness liveness on PR-005's favorite cell.** The cell
(stale age_ms > 60s standing ask 80-96c at t=899) re-derives to exactly
n=100 episodes, avg ask 87.75c, P(win) 97.0%, +9.25c gross — matching
mantis round 5 to the digit (months: 82 x 2026-01, 14 x 2025-12,
3 x 2025-11, 1 x 2026-05). Successor check (epoch+900) reproduces
mantis's 67 alive / 26 silent / 7 no-file exactly. New results:

- **The predecessor witness (epoch-900) is mechanically blind**: 93/100
  predecessor files exist but ALL end recording before the freeze
  interval starts. File-end offset vs the predecessor's own expiry:
  median -239s (i.e. the recording typically dies ~4 min BEFORE its own
  window ends), range -18,594s..+146s, only 20/93 extend past expiry at
  all (max +146s << the 300-477s gap to the freeze intervals). 0/100
  predecessor files cover any freeze interval → 0 episodes move out of
  the ambiguous stratum. The predecessor is not a usable second witness
  by file-coverage construction; only the successor's pre-window
  subscription overlaps a predecessor-episode endgame. (Side fact for
  OL-002: 73/93 of these Nov-Jan-adjacent predecessor recordings died
  before their own expiry — per-market recording death was pervasive
  around the pocket, consistent with PR-005's sub-drop artifact branch.)
- **Coverage decomposition of the 26 successor-silent episodes** (new
  column `succ_coverage`): 24/26 successor files END before the freeze
  interval begins (their recording never covered it — the "silence" is
  file-coverage, not a witness statement), 1/26 covered-and-quiet (the
  only genuine feed-alive-but-market-silent ambiguous case), 1/26 file
  starts after the freeze end. Net for OL-002: the ambiguous stratum
  stays 33/100 (26 silent + 7 no-file); 24 of those 26 "silent" are
  outage-compatible at the recorder level for those specific episodes.

**(ii) Nov-2025..Jan-2026 stale-row (age_ms > 60s) exposure inventory**
over atlas-cited endgame cells (`ol002_support.csv`: claim, t_sec, cell,
n_rows_total, n_stale_novjan, stale_pct). Quarantine scope if OL-002
finds trade prints: E-001 fav ask>=0.96 two-sided carries 142/21,289
stale-NJ rows (0.18% at t=780 rising to 2.38% at t=899); E-002 ch.1
(4-20c) carries 570/15,725 (1.46% at 780 → 12.26% at 899 — the robust
t>=885 cell holds 308 stale-NJ rows of 4,153); OL-001 fav bid 90-98 at
t=897/899 carries 113/3,361 (2.69%/4.45%); full two-sided scan universe
7,154/90,552 token-rows (7.9%); per-(t, band) friction_map_endgame cell
counts listed row-by-row (3,577 stale-NJ rows across 43,344 two-sided
book rows).

## Q-006 instrument autopsy (round 7, gap item 2 — built 2026-07-10)

`extract_midwindow.cjs` run over the 2,000 CENSUS episodes
(`sample_manifest.csv`), t ∈ {300,450,600,690}: raw batches under
`midwindow_census/`, canonical `census_midwindow_checkpoints.parquet`
(8,000 rows, 0 errors, 1,999 fast-start / 1 full). Self-check 6,618/344,499
raw = **1.92%**, hard **0.72%** — matches the census whole-file rate.
Comparison vs the full-replay `checkpoints.parquet` on the same (slug,
t_sec) grid points (`autopsy_q006_instrument.sql`,
`autopsy_q006_field_match.csv`, `autopsy_q006_discrepancies.csv`):

- **7,999/8,000 rows identical on all seven comparable fields** (up/down
  best bid+ask, up top-3 both sides, age_ms) — 99.9875% row match.
- The 1 discrepant row (2026-04, t=690) is a boundary-semantics edge case
  on an out-of-order timestamp at the replay cutoff (extension folds ALL
  events ts ≤ t690; full replay emits the checkpoint at the first
  seq-ordered event with ts > t690). One tick of price; not month-, age-,
  or one-sidedness-structured.
- **Static in-band cell (t=300, two-sided, ask ∈ [0.82,0.86)): BOTH code
  paths read n=156, P(win) 0.8526, avg ask 0.8355, dev +1.705c, z=0.597**
  — identical entry sets (156/156 common). REPLICATION-006's census
  number reproduces exactly on both paths.
- Verdict shape: code paths agree to 99.99% on 8,000 rows; the Q-006
  census/holdout gap is NOT attributable to instrumentation. The
  extension-extractor family (extract_endgame.cjs / extract_midwindow.cjs)
  carries no doubt line; E-001/E-002 stand on validated instruments.
- **TRAP fixed in the output, cause left in the manifest:**
  `sample_manifest.csv` has CRLF line endings; the extractor's
  `split('\n')` left `\r` on `result_id`, corrupting that pass-through
  column in the raw batch CSVs (book fields unaffected). The `\r` were
  stripped in place post-extraction. Any future script consuming
  `sample_manifest.csv` line-by-line must strip `\r`
  (`replication/data/holdout_manifest.csv` is LF and unaffected).

## Regime-shift audit of standing claims (round 7, gap item 1 — `regime_audit.sql` / `regime_audit.csv`)

Fresh books (age_ms < 60000), `endgame_checkpoints.parquet`, early =
2025-10..2026-02 vs late = 2026-03..2026-05. Labels per claim:

| claim                                             | early                                                      | late                                                           |
| ------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| E-001 fav 96+ within ±1c gross, t≥885             | MIXED (885/897 in; t=899 −1.04c, z=−1.94, marginal breach) | SUPPORTED (all t; t=899 +0.19c)                                |
| E-001 no adjacent positive fee-clearing band pair | SUPPORTED (0 pairs)                                        | SUPPORTED (0 pairs)                                            |
| E-002 longshot 4-20c ≤ −1c, t≥885                 | SUPPORTED (−2.7..−4.8c)                                    | SUPPORTED (−1.5..−6.8c); month-pooled t≥885 stays 8/8 ≤ −1.21c |
| OL-001 fav bid margin ≥ +1.5c, t=897/899          | SUPPORTED (+1.97/+2.24c)                                   | SUPPORTED, stronger (+2.65/+2.90c)                             |

No K-004-shaped regime flip in any standing claim; the only cells worth a
line: E-001 t=899 early at −1.04c (marginal, z<2) and a single hot month
2026-05 t=897 at −6.83c (n=151) inside an otherwise-supported late regime.
Adjacent-pair scan detail: 4 same-direction pairs exist early, 0 late —
all NEGATIVE (longshot bands 0-8, E-002's own channel); positive
(taker-harvestable) pairs are 0 in both regimes.

## Known quirks and approximations

- **One-sided endgame books**: 23,021/142,000 checkpoints have NULL up_mid,
  overwhelmingly one-sided books (11,025 no-bid + 11,523 no-ask vs 473 empty)
  concentrated at t>=690 and rising into expiry. These rows drop out of
  calibration cells, so late-t cells are conditioned on "book still two-sided"
  — a selection effect toward uncertain outcomes. Endgame conclusions must
  account for this. RESOLVED for t>=780 by the endgame holdout extension
  and for t in {300,450,600,690} by the mid-window holdout extension,
  both of which keep one-sided/empty books.
- t=0 checkpoints are empty for episodes whose recording starts after window
  open (mostly 2025-10).
- Jump counting: a sustained move re-triggers every 10s (cooldown), so
  jumps_raw over-counts independent "events"; 92k rows ≈ 46/episode.
- `last_event_age_ms` is age of the last event of ANY type/asset, not
  specifically an up-book-touching event.
- duckdb `strftime` on epochs uses local time; all month labels here were
  computed in UTC (python) via the manifest — use `month` from the manifest or
  checkpoints.parquet, do not re-derive with local-time strftime.
- markets.parquet has 97 btc-updown-15m rows with empty result_id (excluded)
  and covers ~20,712 resolved episodes vs 22,142 local files.
