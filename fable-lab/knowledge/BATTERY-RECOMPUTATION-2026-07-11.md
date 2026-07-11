# battery.ts independent recomputation — 2026-07-11 (U71, session 56)

Closes AUDIT-COVERAGE residue **R1**: `tools/battery.ts` — the Stage-2
robustness-battery reader any future ADVANCE verdict's grid/latency read
goes through — previously had only tool-mediated (C) coverage: the U32
audit re-ran battery itself to reproduce the published EXP-001 grid, which
proves transcription fidelity, not the tool's math. U40's independent
recomputation covered `results.ts` outputs, never battery's.

## One-shot / outcome-safety note

Post-verdict reproduction of CLOSED, published numbers (EXP-001 killed at
U25; taker-only runs). Per the U60 reasoning: reproducing published bytes
of a closed readout cannot inflate any false-positive rate or enable
data-dependent selection — this is verification of the instrument, not a
second read. Holdout scope (corrected by the U71 verifier): grid runs
313–325 are exploration-only (verified via slug epochs, max 1777235400);
latency runs 326/327 each include the boundary market
btc-updown-15m-1777237200 per the EXP-001 U50 erratum (E18 inclusive
bound) — zero fills, pnl 0 in both runs, so its row is not outcome-bearing
and its inclusion was already inside the published aggregates being
reproduced; the SQL AVG over 326/327 necessarily aggregates that zero-fill
row, consuming no new holdout outcome information. No repo files outside
`fable-lab/` written; the ad-hoc scripts ran from `/tmp` (U40 precedent).

## Method

Raw SQL aggregates over `backtest_run_markets` via the `mysql` driver
directly (`/tmp/battery-recompute.mjs`, mysql2 + manual `.env` parse — no
lab tool, no drizzle helper, no battery code in the loop), for the 10
published battery rows: the 8 EXP-001 grid runs (313, 314, 317, 319, 321,
322, 324, 325) and the 2 latency runs (326, 327). Independent formulas:

- `n` = COUNT(*), `played` = SUM(trade_count > 0)
- `EV/mkt` = AVG(pnl), `q` = AVG(pnl)/STDDEV_SAMP(pnl) (sample sd, n−1),
  `t` = q·√n
- `makerShare` = Σmaker/(Σmaker+Σtaker), `feeTotal` = ΣfeesPaid

## Result: MATCH on all 10 rows × 7 statistics at printed precision

battery.ts output (this session) vs SQL recomputation vs the published
EXP-001 records (grid table lines 69–76 of the experiment file; latency
figures in the U25 verdict) — all three agree, equal at printed precision
(trailing zeros normalized: battery prints `-0.136`/`91.2`, the table
below pads to a fixed width):

```
runId  n      played  EV/mkt   q        t        makerShare feeTotal
313    2000   1855    +0.9757  +0.0411  +1.837   0          248.03
314    2000   1838    −0.8343  −0.0342  −1.53    0          198.65
317    2000   1613    −0.3239  −0.0155  −0.6916  0          168.27
319    2000   999     +0.2141  +0.0164  +0.7312  0          78.61
321    2000   1053    −0.4575  −0.0343  −1.5331  0          50.21
322    2000   1010    −0.1360  −0.0099  −0.4419  0          68.29
324    2000   1576    −0.7457  −0.0413  −1.845   0          91.20
325    2000   1846    −0.8279  −0.0404  −1.808   0          120.52
326    13977  8794    −0.1572  −0.0086  −1.0214  0          821.69
327    13977  8275    −0.1359  −0.0077  −0.9064  0          782.81
```

(Published grid rows record EV/q/t; published latency figures record
EV/q/t/played — every published figure is among the matched columns.)

## Rigor checks

- **NULL convention not load-bearing:** 0 NULLs in pnl / trade_count /
  trade_as_maker / trade_as_taker / fees_paid across all 43,954 rows of
  the 10 runs — battery's `?? 0` and SQL's COALESCE never fired; the match
  is value-level.
- **Byte stability:** `git log --follow tools/battery.ts` shows exactly
  one commit (4d7a04f, U8) — the tool validated today is byte-identical to
  the one that produced the published U24/U25 numbers.

## Remaining slivers (display-only, accepted)

The `n/a` branches (sd = 0, maker+taker = 0 → fmt(null)) and the
`(not found)` row for a missing run id have never fired on real data;
they are display formatting, not statistics, and are trivial by
inspection (battery.ts:62-64, 81-82, 92, 101-103). The maker columns are
exercised only trivially here (taker-only runs ⇒ maker = 0); the
makerShare formula's nonzero-maker path matches results.ts semantics but
has no independently-recomputed real-data check — if a future MAKER
experiment reaches a battery read, spot-check makerShare once against raw
sums then.
