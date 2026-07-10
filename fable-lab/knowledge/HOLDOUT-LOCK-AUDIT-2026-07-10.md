# HOLDOUT-LOCK AUDIT — 2026-07-10 (U50)

**Question.** STATE.md asserts "Holdout remains locked and unused" every
session, but the lock had only ever been spot-checked per-run (U40 verified
the four touch-lineage runs DB-level; E18 and the U35 hygiene note prove
post-boundary draws HAVE happened and were caught by hand, not mechanically).
This audit sweeps EVERY fable-lab run in the DB and enumerates every
replayed or failed market at/past the frozen boundary 1777237200000
(2026-04-26T21:00Z).

**Instrument.** `tools/holdout-lock-audit.ts` (new, this unit): selects all
`backtest_runs` with `strategy LIKE 'fable-%'` (all lab strategies and
fixtures share the prefix — 64 runs found, ids 296–364, matching the
registry lineage), and per run reports (a) `backtest_run_markets` rows with
`market_start_ms >= boundary`, (b) failure rows whose slug epoch is
post-boundary, (c) slug-epoch vs `market_start_ms` mismatches and NULL
starts (belt-and-braces against a wrong stored start hiding a leak). NO
outcome column is selected anywhere (E15 discipline); flagged rows print
maker/taker FILL COUNTS only, which assess exposure (zero-trade ⇒ the
market cannot have contributed to any aggregate statistic).

**Discriminator soundness (checked this unit):** every `backtest_runs` row
with id ≥ 296 (the lab's first run) is either `fable-%` (64 rows — the
audited set) or the old system's `endgame-panic-bid.*` (6 rows, ids
365–382, correctly excluded). The five id gaps (304, 315, 318, 320, 323)
have NO rows at all — the known rolled-back / void persists (the E7 void
probe launch; the E13/U22–U23 grid persist crashes), which by construction
exposed no results.

**Result: 67 post-boundary rows, 0 slug/start mismatches, 0 NULL starts.
Every row is classified; two documentation gaps found and fixed (below);
no finding threatens any published verdict.**

## Classification of all 67 rows

| Rows | Runs | What | Status |
|---|---|---|---|
| 3 | 301 (EXP-001 main), 326/327 (lat150/lat300) | the boundary market `btc-updown-15m-1777237200` itself — E18's inclusive `--to-ms` class, but DETERMINISTIC here (full-window runs), not a pool chance | **NEW DISCLOSURE** — E18 amendment + EXP-001 erratum (this unit) |
| 2 | 351 (EXP-000-debug, fable-exp-006) | 2026-04-30 + 2026-05-09, both maker=0 taker=0 | already disclosed — the U35 hygiene note ("2 post-boundary slugs, both zero-trade"), matches exactly |
| 2 | 348 (diag-venue, 2026-04 chunk) | Apr 28 + Apr 29 markets inside the pooled BASELINE; book-stats only, no orders | **NEW (minor)** — VENUE-DRIFT.md label note (this unit) |
| 60 | 349/350 (diag-venue, 2026-05 / 2026-06 chunks) | drift-evaluation months are entirely post-boundary BY DESIGN; diag-venue places no orders and reads no PnL | by design (D17); VENUE-DRIFT.md already states the instrument never touches the holdout lock |

All other 59 runs — every probe, every grid cell (313–325), every CAL run
(359–364), every touch-lineage run — are CLEAN. Notably the 8 EXP-001 grid
cells (`--random --limit 2000` from the inclusive pool, pre-E18) each had a
~14% chance of drawing the boundary market and empirically drew it zero
times; that was luck, now verified rather than assumed.

## Finding 1 (MAJOR disclosure gap, verdict-immaterial): the boundary market
is IN the published EXP-001 main readout, with a fill

E18 (found by the U37 audit) scoped the inclusive-`--to-ms` leak to the
EXP-006/007/008/009 random pools (~3.5% draw chance each). It missed that
the SAME flag on the EXP-001 lineage was deterministic: run 301's extension
replays the full window `--to-ms 1777237200000`, so N=13,977 = 13,976
exploration markets + the boundary market, which entered with **1 taker
fill** — an outcome-bearing holdout contamination of the published kill
readout (EV=−0.19, t=−1.15). Runs 326/327 (latency battery) also replayed
it, with zero fills (zero-PnL contribution only).

**Materiality, computed WITHOUT reading the market's outcome** (reading its
PnL would itself be a holdout-outcome read): EXP-001 trades shares=100 at
ask ≤ 0.99, so the market's |PnL| ≤ 100 ⇒ its removal shifts EV/market by
≤ 100/13,977 ≈ 0.007 (published EV −0.19, CI half-width ≈ 0.33) and win
rate by ≤ 1/13,977. No branch of the verdict changes under either sign.
The kill stands. The probe-era snapshot (N=379) cannot be re-derived (run
301 was extended in place, U32 known-unverifiable), so whether the boundary
market was among the 379 is indeterminate — moot, since the probe's
"advance" was superseded by the main kill.

**Fixes applied in this unit:** E18 amendment in LESSONS.md (scope
extended to the EXP-001 lineage, deterministic inclusion, fill disclosed);
erratum appended to EXP-001's experiment file (verdicts stay append-only).

## Finding 2 (MINOR label): the venue-drift pooled baseline is not purely
exploration-era

The "pooled exploration-era baseline (2025-12 → 2026-04, 142 markets)"
includes 2 post-boundary markets (2026-04-28, 2026-04-29 — the boundary is
Apr 26 21:00Z, so the 2026-04 monthly chunk spans it). Book-stats only,
zero fills, outcome-free — the bands are unaffected and no re-baselining is
warranted (D17 pre-specification). VENUE-DRIFT.md now carries a label note.

## Standing procedure

Re-run `npx tsx fable-lab/tools/holdout-lock-audit.ts` after any future
evidence run (exit 0 = fully clean; exit 2 = rows to classify against
disclosures). With E18's boundary−1 sample rule in force since U37, the
expected steady state is: this file's 67 rows, plus 30 new by-design
diag-venue rows per future drift-refresh month, and nothing else.

## Verbatim tool output (2026-07-10)

```
holdout-lock-audit  boundaryMs=1777237200000 (2026-04-26T21:00:00.000Z)
fable-lab runs found (strategy LIKE 'fable-%'): 64

run    296  EXP-000-wrapper-smoke                      fable-fixture-noop       completed  n=2  CLEAN
run    297  EXP-001-smoke                              fable-exp-001            completed  n=10  CLEAN
run    298  EXP-002-smoke                              fable-exp-002            completed  n=10  CLEAN
run    299  EXP-000-debug                              fable-debug-book         completed  n=1  CLEAN
run    300  EXP-000-debug                              fable-debug-book         completed  n=1  CLEAN
run    301  EXP-001-probe                              fable-exp-001            completed  n=13977  FLAGGED
    POST-BOUNDARY REPLAYED: btc-updown-15m-1777237200  startMs=1777237200000 (2026-04-26T21:00:00.000Z)  fills maker=0 taker=1
run    302  EXP-002-smoke                              fable-exp-002            completed  n=10  CLEAN
run    303  EXP-003-smoke                              fable-exp-003            completed  n=10  CLEAN
run    305  EXP-004-smoke                              fable-exp-004            completed  n=10  CLEAN
run    306  EXP-000-debug                              fable-exp-004            completed  n=10  CLEAN
run    307  EXP-000-debug                              fable-exp-004            completed  n=30  CLEAN
run    308  EXP-002-probe                              fable-exp-002            completed  n=500  CLEAN
run    309  EXP-003-probe                              fable-exp-003            completed  n=500  CLEAN
run    310  EXP-005-smoke                              fable-exp-005            completed  n=10  CLEAN
run    311  EXP-004-probe                              fable-exp-004            completed  n=500  CLEAN
run    312  EXP-005-probe                              fable-exp-005            completed  n=500  CLEAN
run    313  EXP-001-grid-entryAfterSec-600-minAsk-0.85-maxAsk-0.99-shares-100 fable-exp-001            completed  n=2000  CLEAN
run    314  EXP-001-grid-entryAfterSec-600-minAsk-0.9-maxAsk-0.99-shares-100 fable-exp-001            completed  n=2000  CLEAN
run    316  EXP-000-debug                              fable-exp-001            completed  n=3  CLEAN
run    317  EXP-001-grid-entryAfterSec-720-minAsk-0.85-maxAsk-0.99-shares-100 fable-exp-001            completed  n=2000  CLEAN
run    319  EXP-001-grid-entryAfterSec-840-minAsk-0.85-maxAsk-0.99-shares-100 fable-exp-001            completed  n=2000  CLEAN
run    321  EXP-001-grid-entryAfterSec-840-minAsk-0.95-maxAsk-0.99-shares-100 fable-exp-001            completed  n=2000  CLEAN
run    322  EXP-001-grid-entryAfterSec-840-minAsk-0.9-maxAsk-0.99-shares-100 fable-exp-001            completed  n=2000  CLEAN
run    324  EXP-001-grid-entryAfterSec-720-minAsk-0.95-maxAsk-0.99-shares-100 fable-exp-001            completed  n=2000  CLEAN
run    325  EXP-001-grid-entryAfterSec-600-minAsk-0.95-maxAsk-0.99-shares-100 fable-exp-001            completed  n=2000  CLEAN
run    326  EXP-001-lat150                             fable-exp-001            completed  n=13977  FLAGGED
    POST-BOUNDARY REPLAYED: btc-updown-15m-1777237200  startMs=1777237200000 (2026-04-26T21:00:00.000Z)  fills maker=0 taker=0
run    327  EXP-001-lat300                             fable-exp-001            completed  n=13977  FLAGGED
    POST-BOUNDARY REPLAYED: btc-updown-15m-1777237200  startMs=1777237200000 (2026-04-26T21:00:00.000Z)  fills maker=0 taker=0
run    328  EXP-006-smoke                              fable-exp-006            completed  n=10  CLEAN
run    329  EXP-000-debug                              fable-diag-quiet         completed  n=12  CLEAN
run    330  EXP-000-debug                              fable-diag-quiet         completed  n=12  CLEAN
run    331  EXP-000-debug                              fable-exp-006            completed  n=30  CLEAN
run    332  EXP-000-debug                              fable-exp-006            completed  n=30  CLEAN
run    333  EXP-000-debug                              fable-exp-006            completed  n=30  CLEAN
run    334  EXP-006-probe                              fable-exp-006            completed  n=70  CLEAN
run    335  EXP-000-debug                              fable-exp-006            completed  n=30  CLEAN
run    336  EXP-006-probe                              fable-exp-006            completed  n=500  CLEAN
run    337  EXP-000-debug                              fable-exp-007            completed  n=30  CLEAN
run    338  EXP-000-debug                              fable-exp-007            completed  n=30  CLEAN
run    339  EXP-000-debug                              fable-exp-007            completed  n=30  CLEAN
run    340  EXP-000-debug                              fable-exp-007            completed  n=30  CLEAN
run    341  EXP-007-smoke                              fable-exp-007            completed  n=10  CLEAN
run    342  EXP-007-probe                              fable-exp-007            completed  n=500  CLEAN
run    343  EXP-000-debug                              fable-diag-venue         completed  n=3  CLEAN
run    344  EXP-000-debug                              fable-diag-venue         completed  n=30  CLEAN
run    345  EXP-000-debug                              fable-diag-venue         completed  n=30  CLEAN
run    346  EXP-000-debug                              fable-diag-venue         completed  n=30  CLEAN
run    347  EXP-000-debug                              fable-diag-venue         completed  n=30  CLEAN
run    348  EXP-000-debug                              fable-diag-venue         completed  n=30  FLAGGED
    POST-BOUNDARY REPLAYED: btc-updown-15m-1777387500  startMs=1777387500000 (2026-04-28T14:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1777491000  startMs=1777491000000 (2026-04-29T19:30:00.000Z)  fills maker=0 taker=0
run    349  EXP-000-debug                              fable-diag-venue         completed  n=30  FLAGGED
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778413500  startMs=1778413500000 (2026-05-10T11:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778352300  startMs=1778352300000 (2026-05-09T18:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778220000  startMs=1778220000000 (2026-05-08T06:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778984100  startMs=1778984100000 (2026-05-17T02:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778166000  startMs=1778166000000 (2026-05-07T15:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779354000  startMs=1779354000000 (2026-05-21T09:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779550200  startMs=1779550200000 (2026-05-23T15:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778248800  startMs=1778248800000 (2026-05-08T14:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1777647600  startMs=1777647600000 (2026-05-01T15:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779048000  startMs=1779048000000 (2026-05-17T20:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778628600  startMs=1778628600000 (2026-05-12T23:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779057000  startMs=1779057000000 (2026-05-17T22:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1777696200  startMs=1777696200000 (2026-05-02T04:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778174100  startMs=1778174100000 (2026-05-07T17:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780103700  startMs=1780103700000 (2026-05-30T01:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779892200  startMs=1779892200000 (2026-05-27T14:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779817500  startMs=1779817500000 (2026-05-26T17:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778217300  startMs=1778217300000 (2026-05-08T05:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779846300  startMs=1779846300000 (2026-05-27T01:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780016400  startMs=1780016400000 (2026-05-29T01:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778556600  startMs=1778556600000 (2026-05-12T03:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779639300  startMs=1779639300000 (2026-05-24T16:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778238000  startMs=1778238000000 (2026-05-08T11:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1777651200  startMs=1777651200000 (2026-05-01T16:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778552100  startMs=1778552100000 (2026-05-12T02:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779069600  startMs=1779069600000 (2026-05-18T02:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779239700  startMs=1779239700000 (2026-05-20T01:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779405300  startMs=1779405300000 (2026-05-21T23:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780097400  startMs=1780097400000 (2026-05-29T23:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1779499800  startMs=1779499800000 (2026-05-23T01:30:00.000Z)  fills maker=0 taker=0
run    350  EXP-000-debug                              fable-diag-venue         completed  n=30  FLAGGED
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780508700  startMs=1780508700000 (2026-06-03T17:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1781418600  startMs=1781418600000 (2026-06-14T06:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780626600  startMs=1780626600000 (2026-06-05T02:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780640100  startMs=1780640100000 (2026-06-05T06:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1781411400  startMs=1781411400000 (2026-06-14T04:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780739100  startMs=1780739100000 (2026-06-06T09:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780532100  startMs=1780532100000 (2026-06-04T00:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1781315100  startMs=1781315100000 (2026-06-13T01:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780922700  startMs=1780922700000 (2026-06-08T12:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1781077500  startMs=1781077500000 (2026-06-10T07:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1781125200  startMs=1781125200000 (2026-06-10T21:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780698600  startMs=1780698600000 (2026-06-05T22:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780362900  startMs=1780362900000 (2026-06-02T01:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780731900  startMs=1780731900000 (2026-06-06T07:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780412400  startMs=1780412400000 (2026-06-02T15:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1781197200  startMs=1781197200000 (2026-06-11T17:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780636500  startMs=1780636500000 (2026-06-05T05:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780845300  startMs=1780845300000 (2026-06-07T15:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780564500  startMs=1780564500000 (2026-06-04T09:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780828200  startMs=1780828200000 (2026-06-07T10:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780594200  startMs=1780594200000 (2026-06-04T17:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1781367300  startMs=1781367300000 (2026-06-13T16:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780345800  startMs=1780345800000 (2026-06-01T20:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1781336700  startMs=1781336700000 (2026-06-13T07:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780477200  startMs=1780477200000 (2026-06-03T09:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780852500  startMs=1780852500000 (2026-06-07T17:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780617600  startMs=1780617600000 (2026-06-05T00:00:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1781227800  startMs=1781227800000 (2026-06-12T01:30:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780452900  startMs=1780452900000 (2026-06-03T02:15:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1780955100  startMs=1780955100000 (2026-06-08T21:45:00.000Z)  fills maker=0 taker=0
run    351  EXP-000-debug                              fable-exp-006            completed  n=10  FLAGGED
    POST-BOUNDARY REPLAYED: btc-updown-15m-1777527900  startMs=1777527900000 (2026-04-30T05:45:00.000Z)  fills maker=0 taker=0
    POST-BOUNDARY REPLAYED: btc-updown-15m-1778346900  startMs=1778346900000 (2026-05-09T17:15:00.000Z)  fills maker=0 taker=0
run    352  EXP-000-debug-wq                           fable-exp-006            completed  n=8  CLEAN
run    353  EXP-000-debug-touch                        fable-exp-006            completed  n=8  CLEAN
run    354  EXP-000-debug-touch                        fable-exp-006            completed  n=2  CLEAN
run    355  EXP-008-smoke-touch                        fable-exp-006            completed  n=10  CLEAN
run    356  EXP-009-smoke-touch                        fable-exp-007            completed  n=10  CLEAN
run    357  EXP-008-probe-touch                        fable-exp-006            completed  n=500  CLEAN
run    358  EXP-009-probe-touch                        fable-exp-007            completed  n=500  CLEAN
run    359  CAL-001-smoke                              fable-diag-calib         completed  n=5  CLEAN
run    360  CAL-001-discovery                          fable-diag-calib         completed  n=751  CLEAN
run    361  CAL-001-smoke-v2                           fable-diag-calib         completed  n=3  CLEAN
run    362  CAL-001-discovery-v2                       fable-diag-calib         completed  n=137  CLEAN
run    363  CAL-001-smoke-v3                           fable-diag-calib         completed  n=3  CLEAN
run    364  CAL-001-discovery-v3                       fable-diag-calib         completed  n=8516  CLEAN

TOTAL: 67 post-boundary row(s), 0 slug/start mismatch(es) across 64 runs
```
