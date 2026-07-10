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
  (bid0.size + ask0.size). Crossed ticks are excluded from sampling.
- Aggregate: `npx tsx fable-lab/tools/venue-drift.ts <log>` — per-month
  cross-market medians (mean for crossedFrac).
- Known artifact: the final market of each chunk can miss its log line if
  its last tick lands before 780s (flush fires on market change or on the
  first post-780s tick). Expect 28-30 markets per month cell, not always 30.

## Reopening bar (D17, pre-specified)

A refreshed month is a citable venue change under EDGE-SPACE §4 if, vs the
exploration-era baseline (2025-12 → 2026-04 pooled):

- median spread outside [0.5×, 2×] the baseline median, or
- median top depth outside [0.5×, 2×] the baseline median, or
- crossed-tick fraction ≥ 2× the baseline mean.

Anything inside those bands is normal variation — do not reopen on it.

## Baseline (measured 2026-07-10, log `logs/venue-drift-baseline.log`)

198 unique markets parsed (7 monthly chunks × 30 random, minus the known
end-of-chunk flush artifact). Sweep shape (per chunk; `--from-ms/--to-ms`
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
   --limit 30`, batchUid `EXP-000-debug`, detached per D10).
3. Aggregate with `tools/venue-drift.ts`, append the new rows to the table
   below the baseline block (append-only, dated), and evaluate the D17 bar
   against the pooled 2025-12 → 2026-04 baseline.
4. If the bar fires: that is motivating evidence — record which settled
   question it reopens (with the specific mechanism linkage: spread ↑ →
   maker economics changed; crossed ↑ → recording quality changed, E6) in
   a new IDEAS entry or DECISIONS note.
