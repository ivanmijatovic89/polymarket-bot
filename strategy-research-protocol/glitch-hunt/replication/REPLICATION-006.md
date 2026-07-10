# REPLICATION-006 — Mid-window favorite discount (memo 006)

replicator, Foundry Phase 2 Round 6 — 2026-07-10.
Claim under test: `memos/006-midwindow-favorite-discount.md` §6, per the
frozen spec in mantis's SURVIVES verdict (adopted unchanged, no re-tuning).
Measurement script: `replication/replicate_006.sql` — written independently
from the falsifiable claim; no SQL reused from `census/round6_gabagool_probe.sql`
or `census/round6_probe.sql`.

## VERDICT: REVERSED

**Pooled first-touch dev = −0.04c (n=613). P(win) 83.36% vs avg ask
83.40c.** The frozen rule (REVERSED if pooled ≤ 0) fires. The number that
reverses it: −0.000375, i.e. the favorite at ask 82–86c mid-window resolves
at almost exactly its price on the held-out episodes. The original holdout
measurement was +3.62c (n=1,271); the census slice reproduces none of it.

Not an underpowered miss: the memo's power arithmetic anticipated n≈200–300
and z≈1.3–1.7 at a true +3.6c. First-touch actually yielded n=613; at a
true +3.6c the expected z here is ≈2.6–2.7, and the probability of
observing dev ≤ 0 would be under 1%. This is a point-estimate reversal at
better-than-declared power.

## Slice and disjointness

- Data: `census/checkpoints.parquet` ONLY (2,000 episodes, 250/month,
  2025-10..2026-05, 15s grid).
- Disjointness verified myself: 0 slug overlap between
  `census/sample_manifest.csv` (2,000) and
  `replication/data/holdout_manifest.csv` (17,126).
- No disjoint months exist (holdout and census span the same 8 months;
  markets.parquet has no resolved rows past mid-May 2026), so
  episode-disjointness is the replication currency, as the frozen spec
  acknowledged.

## Pipeline sanity (run before the measurement)

- Per-episode UP base rate on the slice: 50.75% (n=2,000) — window
  anchoring and outcome join sane.
- `up_won` agrees with `sample_manifest.csv` result_id (0=UP) 2000/2000.
- t ∈ [240,360]: 18,000 rows (9 grid points × 2,000), 99.5% two-sided,
  mirror invariant |up_bid + down_ask − 1| ≤ 0.011 holds on 100% of rows.
- Eligibility cross-check: in-band incidence at t=300 exactly is 7.80%
  (156/2,000) vs the holdout's 7.42% (1,271/17,126) — my selection matches
  the original's; the n=613 first-touch total is band-crossing across 9
  checkpoints, not a selection bug.

## Numbers (first-touch per (slug, token), t ∈ [240,360], ask ∈ [0.82,0.86), two-sided)

| cut                                           | n   | P(win) | avg ask | dev        | z     |
| --------------------------------------------- | --- | ------ | ------- | ---------- | ----- |
| POOLED                                        | 613 | 0.8336 | 0.8340  | **−0.04c** | −0.02 |
| one-tick (spr ≤ 0.011)                        | 446 | 0.8386 | 0.8339  | +0.47c     | 0.27  |
| wide                                          | 167 | 0.8204 | 0.8342  | −1.38c     | −0.46 |
| UP arm                                        | 310 | 0.8258 | 0.8342  | −0.84c     |       |
| DOWN arm                                      | 303 | 0.8416 | 0.8338  | +0.78c     |       |
| t=300-exact entries (secondary)               | 60  | 0.8167 | 0.8340  | −1.73c     |       |
| static in-band at t=300 (holdout-cell analog) | 156 | 0.8526 | 0.8355  | +1.71c     | 0.60  |
| … its one-tick stratum                        | 118 | 0.8390 | 0.8357  | +0.33c     | 0.10  |

Strata notes: one-tick is +0.47c — positive in sign but z=0.27 and far
inside the 1.30c fee; the claimed one-tick concentration (+4.49c holdout)
is absent. The static t=300 cell, the closest analog of the original
+3.62c holdout measurement, reads +1.71c at z=0.60 — inside fee, noise-level,
and its one-tick stratum (+0.33c) is the WEAKEST part rather than the
carrier, inverting the claimed structure.

## Per-month breakdown (pooled first-touch dev)

| month   | n   | dev    |
| ------- | --- | ------ |
| 2025-10 | 78  | −4.17c |
| 2025-11 | 95  | +3.01c |
| 2025-12 | 68  | −5.38c |
| 2026-01 | 69  | −0.88c |
| 2026-02 | 76  | −0.58c |
| 2026-03 | 70  | −0.34c |
| 2026-04 | 79  | +6.39c |
| 2026-05 | 78  | +0.08c |

3/8 months positive, 5/8 negative; the average is held near zero by one
hot month (2026-04, +6.39c). The holdout's 8/8 sign-positive vector, with
the recent three months strongest, does not reproduce — 2026-03 and
2026-05 are −0.34c and +0.08c here. Time-instability of exactly the kind
that kills.

## n_stale

`last_event_age_ms` (any-asset event age, the only age field in the census
grid) > 60s at entry: **0 of 613**. No stale-quote exposure; the reversal
is not an A-001/PR-005 artifact channel.

## Which concession fires

Mantis's first: "Pooled first-touch dev ≤ 0 on the census slice — the
region was selection-plus-instrument artifact and I will write the
graveyard entry myself." Mantis's own point 4 declared the outcome space
near-binary (sharp island vs fluke, no diffuse-truth branch); the census
answered fluke. Entry 006 is quarantined. Retest, if ever, gates on
post-refresh months (post-2026-05 outcomes) per the verdict's terms.

— replicator, 2026-07-10
