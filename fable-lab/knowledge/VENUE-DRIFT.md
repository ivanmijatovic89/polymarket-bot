# VENUE-DRIFT — monthly venue statistics baseline and reopening bar

_Instrument for EDGE-SPACE §4's third reopening condition (DECISIONS D17):
a measured venue regime change is the one kind of evidence that can reopen
a question settled by E9-E17. This file holds the baseline table and the
refresh procedure. Outcome-free by construction: the fixture places no
orders and reads no PnL, so refreshing it never touches the holdout lock._

## Method (pre-specified in D17 — do not tune after seeing data)

- Fixture `strategies/_fixtures/diag-venue.ts` (id `fable-diag-venue`),
  batchUid `EXP-000-debug`, local `--sequential`, latency pinned 0/0.
- 30 random markets per calendar month (UTC, by slug epoch), full eligible
  range. Per market, from first tick to 780s of episode clock: tick rate,
  crossed-tick fraction (either book, E6 artifact rate), and medians of
  10s-sampled top-of-book UP spread and UP top-level depth
  (bid0.size + ask0.size). UP-crossed ticks are excluded from sampling
  (crossedFrac itself counts either-book crossing; a DOWN-only-crossed
  tick is still sampled — the sampled metrics are UP-side. Wording
  corrected U46 per audit finding 5).
- Aggregate: `npx tsx fable-lab/tools/venue-drift.ts <log>` — per-month
  cross-market medians (mean for crossedFrac).
- Known artifact (CAUSE CORRECTED U46, measured from the surviving
  baseline log — the original "end-of-chunk flush" explanation was wrong
  and that loss mode never actually fired): markets whose parquet
  replays with zero/near-zero events emit no diag line and are invisible
  to the fixture. Verified: every baseline chunk replayed 30/30 markets;
  the 12 missing ones (2025-12: 2, 2026-01: 6, 2026-06: 4) each finished
  in ~0s with no ticks. Expect 24-30 markets per month cell.

## Reopening bar (D17, pre-specified)

A refreshed month is a citable venue change under EDGE-SPACE §4 if, vs the
exploration-era baseline (2025-12 → 2026-04 pooled):

- median spread outside [0.5×, 2×] the baseline median, or
- median top depth outside [0.5×, 2×] the baseline median, or
- crossed-tick fraction ≥ 2× the baseline mean.

Anything inside those bands is normal variation — do not reopen on it.

**Fire confirmation (D27, added U46 BEFORE any refresh was ever evaluated
against the bands — motivated by the measured false-fire exposure in
`knowledge/AUDIT-2026-07-10-VENUE-DRIFT.md`: the crossedFrac trigger is
only ~14% above baseline month 2025-12's own value, and the depth band
edge is ~1.5-1.9σ of baseline monthly dispersion, ≈10%/month false-fire
on depth alone):**

- A fired month is NOT citable from one draw. Re-run the fixture on the
  same month with a fresh `--random --limit 30` draw (RAND() is unseeded
  → genuinely independent redraw) and re-aggregate; citable only if BOTH
  draws fire on the SAME metric.
- crossedFrac fires also need a concentration check: if the fired mean
  is dominated by ≤ 2 markets, investigate as an E6 recording-quality
  issue first, not regime evidence.
- Consequence mapping for step 4: spread ↑ → maker economics changed;
  depth outside band → liquidity/market-maker-program regime changed
  (affects fill-feasibility and depth-conditioned conclusions, E11);
  crossed ↑ → recording quality changed (E6). crossedFrac fires upward
  only — an improvement (e.g. 2026-06's 0.0004) is noted but does not
  reopen anything.
- Known power limit: the bands cannot detect real changes smaller than
  ~2× by construction. A quiet refresh means "no ≥2× shift", not "no
  shift".

## Baseline (measured 2026-07-10, log `logs/venue-drift-baseline.log`)

198 unique markets parsed (7 monthly chunks × 30 random, minus 12
zero-event-parquet markets — see Known artifact above; corrected U46b). Sweep shape (per chunk; `--from-ms/--to-ms`
at UTC month bounds over 2025-11-30 → 2026-06-14):

```bash
BACKTEST_LATENCY_DELAY=0 BACKTEST_LATENCY_JITTER=0 \
npx tsx fable-lab/tools/run-backtest.ts --strategy fable-diag-venue \
  --input-mode telonex-delta --read-from local-or-download-from-r2-to-local \
  --symbol btc --timeframe 15m --random --limit 30 \
  --from-ms <monthStartMs> --to-ms <monthEndMs> \
  --batchUid EXP-000-debug --sequential
```

Per-month table (`tools/venue-drift.ts` output, verbatim):

| month   | markets | spreadMed | depthMed | rateMed | crossedFracMean |
|---------|--------:|----------:|---------:|--------:|----------------:|
| 2025-12 |      28 |    0.0100 |    324.4 |   80.09 |          0.0021 |
| 2026-01 |      24 |    0.0100 |    760.2 |  105.63 |          0.0012 |
| 2026-02 |      30 |    0.0100 |    829.2 |  214.61 |          0.0008 |
| 2026-03 |      30 |    0.0100 |    382.4 |  159.03 |          0.0009 |
| 2026-04 |      30 |    0.0100 |    499.6 |  110.43 |          0.0011 |
| 2026-05 |      30 |    0.0100 |    372.4 |  106.05 |          0.0006 |
| 2026-06 |      26 |    0.0100 |    382.6 |  196.84 |          0.0004 |

**Pooled exploration-era baseline (2025-12 → 2026-04, 142 markets — the
reference values for the D17 bar):**

- median spread: **0.0100** → band [0.0050, 0.0200]
- median top depth: **479.4** → band [239.7, 958.8]
- crossed-tick fraction mean: **0.0012** → fires at ≥ 0.0024
- (tick-rate median, informational only, not part of the bar: 130.32/s)

_Label note (U50, `knowledge/HOLDOUT-LOCK-AUDIT-2026-07-10.md` finding 2):
"exploration-era" is approximate — the 2026-04 monthly chunk (run 348)
includes 2 post-boundary markets (2026-04-28, 2026-04-29; the holdout
boundary is 2026-04-26T21:00Z). Book-stats only, zero fills, outcome-free;
the bands are unaffected and stay as pre-specified (D17)._

**Pooling convention (recorded U46, settled empirically from the
baseline log — audit finding 3):** the pooled reference is the statistic
over ALL per-market values in the window (median for spread/depth/rate,
mean for crossedFrac) — NOT the median of monthly medians (that would
give depth 499.6). Reproduce mechanically with:

```bash
npx tsx fable-lab/tools/venue-drift.ts --pooled 2025-12:2026-04 <log>
# on logs/venue-drift-baseline.log prints: pooled 142 0.0100 479.4 130.32 0.0012
```

**Durable per-market record (D29):** the raw sweep log lives under the
gitignored `fable-lab/logs/`; the 198 per-market `[diag-venue]` lines are
committed at `knowledge/venue-drift-baseline-lines.log` in the exact format
`venue-drift.ts` parses. Verified 2026-07-10: both the monthly table and the
`--pooled 2025-12:2026-04` reference reproduce byte-identically from the
committed file alone (tool output diffed against the original log). Any
future re-baselining, D27 confirmation comparison, or convention question
can use the committed file — the monthly table above is NOT sufficient to
recompute the pooled reference (that was U46 audit finding 3's near-miss).

**First evaluation (2026-05, 2026-06 vs the bar): NO DRIFT.** Both months
have spread 0.0100 (inside band), depth 372.4 / 382.6 (inside band), and
crossed fraction 0.0006 / 0.0004 (below the 0.0024 trigger — recording
quality actually improved). The E9-E17 conclusions remain in-regime through
the end of currently eligible data (2026-06-14).

## Refresh procedure (any future session)

1. New months of data must exist (check `tools/universe.ts` — the eligible
   `last:` market). If the universe has not grown by a month or more since
   the last table row, there is nothing to measure; stop.
2. Run the fixture over the new month(s) only (same command shape as the
   baseline sweep, `--from-ms/--to-ms` at UTC month bounds, `--random
   --limit 30`, batchUid `EXP-000-debug`, detached per D10). Capture
   stdout to a log file under `fable-lab/logs/` — the aggregator reads
   the log. Note (U46): `--random` is unseeded SQL `RAND()`; the draw is
   not reproducible, which is exactly what the D27 confirmation redraw
   relies on.
3. Aggregate with `tools/venue-drift.ts`, append the new rows to the table
   below the baseline block (append-only, dated), and evaluate the D17 bar
   against the pooled 2025-12 → 2026-04 baseline.
4. If the bar fires: apply the D27 confirmation redraw (see "Fire
   confirmation" above) BEFORE citing. If confirmed, that is motivating
   evidence — record which settled question it reopens (with the
   specific mechanism linkage from the consequence mapping above) in a
   new IDEAS entry or DECISIONS note.
5. Re-baselining after a confirmed regime change (new era): derive the
   new pooled reference with `venue-drift.ts --pooled <newFrom>:<newTo>`
   over the new-era months (same convention as the 2025-12 → 2026-04
   baseline), record it in a NEW baseline block here (append-only), and
   note the era boundary. The D17 ×/÷2 band rule carries over; the
   reference values change.
