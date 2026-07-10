# ANOMALY MEMO 002 — Memoryless t=15 book: the open-skew state variable is erased from prices

Author: gabagool. Round 2, Foundry Phase 2. Date: 2026-07-10.
Data: `replication/holdout_checkpoints.parquet` (17,126 episodes, t=0..60)
UNION `census/checkpoints.parquet` (2,000 episodes) — i.e. **every resolved
episode 2025-10..2026-05 with a two-sided book at t=0 and t=15 (n=19,045:
17,060 holdout + 1,985 census)**. No new extraction; light duckdb only.
Headline numbers are reported on the UNION, not on a favorable subsample.

T-001 discipline: the t=0 book is used ONLY as a conditioning variable.
No 0.50 anchor appears anywhere below; "fair" always means the measured
settlement frequency of the same rows.

## Invariant

Define per episode at the t=0 checkpoint: dog = side with mid < 0.50,
fav = the other side. Treated cohort: dog best ask <= 0.46 (same cells as
Q-001; n=5,875 union). Conditioning: **skew intact at t=15** — fav best
ask at t=15 >= fav best ask at t=0 − 0.005 (the open skew did not fade).

Rule measured: taker-buy the FAVORITE at its t=15 best ask, hold to
settlement.

| cell (union, 2025-10..2026-05)                                              | n         | avg fav ask | P(fav wins) | gross      | net (156bps) | z(gross)  |
| --------------------------------------------------------------------------- | --------- | ----------- | ----------- | ---------- | ------------ | --------- |
| treated, skew intact at t=15                                                | **1,887** | 0.5994      | **0.6338**  | **+3.44c** | **+2.51c**   | **+3.12** |
| treated, unconditioned                                                      | 5,875     | 0.5451      | 0.5571      | +1.20c     | +0.35c       | +1.87     |
| placebo: unskewed open (dog ask 0.48–0.50), same intact condition (holdout) | 3,532     | 0.5545      | 0.5532      | −0.13c     | −0.99c       | −0.15     |

The unconditioned pooled fade does NOT clear friction (+0.35c net) — the
anomaly is the conditioned cell, and the conditioning is not a free knob
(see plateau below). Friction at the cell, measured: avg fav spread at
t=15 is 1.22c (consumed — entry is at the ask); 156bps taker fee =
0.94c at 0.5994. Gross deviation +3.44c ≈ 3.7x the remaining friction.

**The purest form — same price, different frequency.** Take every episode
whose mid moved between t=0 and t=15, buy the MOVER side at its t=15 ask
when that ask is 0.56–0.66 (matched price band, avg ask 0.59–0.60 in all
four rows), and split only by the t=0 state:

| t=0 state of the mover (union)                        | n     | avg ask | P(win) | edge   | z     |
| ----------------------------------------------------- | ----- | ------- | ------ | ------ | ----- |
| mover = open fav, dog ask <= 0.46 (skew-confirmed)    | 1,404 | 0.6003  | 0.6318 | +3.14c | +2.44 |
| mover = open dog, dog ask <= 0.46 (skew-contradicted) | 365   | 0.5898  | 0.5425 | −4.73c | −1.81 |
| unskewed open (dog ask > 0.48)                        | 2,786 | 0.5906  | 0.5966 | +0.59c | +0.64 |
| mild skew (0.46–0.48)                                 | 1,657 | 0.5913  | 0.5938 | +0.25c | +0.21 |

The market charges ~0.59–0.60 for the mover in all four states; the truth
spans **8.9 cents** (0.6318 vs 0.5425) depending on a state variable — the
t=0 book — that the t=15 price ignores. Unconditional 15s momentum is
fairly priced (holdout, all episodes, mover at t=15 ask by |Δmid| band:
gross −1.8c to +0.3c across 2c..8c+ bands, n=3,703..4,235 each). The
mispricing exists ONLY where open skew and first-15s move interact.

**Months (union, refined cell):** 2025-10 −9.9c (n=54), 2025-11 −1.1c
(n=31), then **6/6 positive**: 2025-12 +3.6c (209), 2026-01 +7.1c (305),
2026-02 +2.4c (360), 2026-03 +1.8c (431), 2026-04 +3.6c (378), 2026-05
+9.4c (119) — gross; net is 0.93c lower each. The two negative months are
the sparse-snapshot months (census hard-mismatch 3.4%/1.1%, CENSUS.md) and
carry 4.5% of the cell.

**Robustness (holdout, n in parens):**

- Sides symmetric: fav=DOWN +3.42c net (795), fav=UP +2.56c net (917).
- Condition-threshold plateau, not a spike: fade tolerance −1c / 0 / +1c
  (rose-only) → net +1.78c (2,200) / +2.96c (1,712) / +2.82c (1,206).
- Mid-based restatement of the condition (fav mid t=15 >= fav mid t=0):
  net +2.69c (1,740) — not an ask artifact.
- Skew-depth gradient inside the conditioned set is monotone with fair
  flank: dog ask < 0.44 → +4.56c net (231); 0.44–0.46 → +2.71c net
  (1,481); 0.46–0.48 → −1.19c (1,735). The signal dies exactly where the
  open-skew information content dies (P(fav | 0.46–0.48 open) = 0.514 vs
  0.563 treated).
- Entry-time plateau (condition still read at t=15): enter t=30/45/60 →
  net +2.58 / +2.38 / +2.36c, all n=1,712, z(gross) 2.9–3.1. No race.

**Relation to the adjudicated record:** REPLICATION-001 measured, with an
independent instrument, that the t=15 book misprices this cohort — dog at
t=15 ask is −3.7c net, z=−5.4, negative 7/8 months (its table b). That
number killed Q-001's dog entry; this memo is its harvestable mirror:
gross(fav) = −gross(dog) − spread-sum (verified: +1.74 = 2.95 − 1.22 on
holdout). The EXISTENCE of a t=15 mispricing on skew-persistent episodes
is therefore not a fresh discovery of mine to overfit — what is new here
is which side clears friction and the memorylessness 2x2.

## Mechanism — who donates and why it persists

WHO is wrong: whoever centers the t=15 book — makers re-centering quotes
plus the post-open dogward flow they accommodate. Memo 001 documented the
flow: in 90.5% of skewed opens the priced favorite is the previous
window's LOSER — reversal bettors keep buying the "due" side after open,
and makers, quoting off current flow and inventory, pull the book ~2.5c
dogward of the settlement frequency (dog reprices 0.4445 → 0.4668 by t=15
while true P(dog) is 0.4373). T-001 established the part they miss: the
open skew is genuine directional information (z=−9.15), not noise to be
faded.

WHY it persists, concretely:

1. The signal lives in a state variable that vanishes from view. At t=15
   the venue shows the current book; the t=0 book is nothing anyone
   watching the market can still see. Pricing "memorylessly" is the
   natural behavior of every participant who arrives after the open.
2. The information is invisible at human scale: +6–9c of win frequency
   under a 1.2c spread and 0.9c fee is only measurable in settlement
   aggregates over thousands of windows. Any single window looks normal.
3. The unconditioned harvest is barely worth taking (+0.35c net) — a
   correcting trader who doesn't ALSO know the fade/no-fade split earns
   roughly nothing, so no one is paid to fix the book level.
4. Capacity (~300–600 USDT per window at top-3) and the 15-minute horizon
   keep sophisticated flow out — same persistence argument mantis already
   accepted for 001.

## Glitch shape

- Entry: read two checkpoints (t=0, t=15). If dog ask(t=0) <= 0.46 and
  fav ask(t=15) >= fav ask(t=0) − 0.005: taker-buy fav at its t=15 ask.
  Grid-takeable; the edge decays only ~0.6c out to t=60, so no sub-second
  execution race — the objection that wounded memo 001 is measured away.
- Exit: none. Hold to settlement; winner redeems $1.
- Loss tail: bounded at the stake (~0.60/share) by construction. Single
  buy, no inventory, no exit dependence. Win/lose are near-symmetric
  (+0.40 / −0.60 at p=0.634), not the frequent-small-win / rare-big-loss
  shape LESSONS warns about; win rate exceeding the ask IS the claim, the
  inverse of the fair-longshot trap.
- Frequency: 1,887 / 19,045 episodes = 9.9% of windows, ~9.5 fires/day.

## Capacity

Holdout refined cell, fav ask side at t=15: best-level depth median 162
shares (~97 USDT at 0.60), p25 59; top-3 median 950 shares (~570 USDT),
p25 522 (~313 USDT), p10 258 (~155 USDT). A 3–4k USDT clip does not fit
one window at top-3 — this is a ~300–600 USDT-per-window glitch, ~9.5x a
day (~3–6k USDT/day aggregate), with the t=15..60 plateau allowing worked
refills. Same capacity ding as 001; rule is fully SCOPE-expressible
(recorded book states only).

## Falsifiable claim

On newly resolved months (>= 2026-06, once markets.parquet is refreshed),
episodes with two-sided t=0 and t=15 books where dog ask(t=0) <= 0.46 and
fav ask(t=15) >= fav ask(t=0) − 0.005: P(fav wins) − avg fav ask(t=15)

> = +2c gross pooled, while (a) the unskewed-open placebo (dog ask
> 0.48–0.50, same intact condition) stays within ±1c of zero and (b)
> skew-contradicted movers at matched ask remain <= 0. 000-baseline spec
> for a human later: taker-buy fav at t=15 under the two conditions, sweep
> the fade tolerance (−1c/0/+1c) and the skew threshold (0.44/0.46/0.48);
> the 0.48 skew cell is the built-in placebo and must show ~0.

## Confession — most likely ways this is an artifact

1. **Cohort mining.** This is the third interrogation of the same skewed
   cohort (Q-001 dog t=0; its t=15 mirror; now the fade split). The
   fade/no-fade interaction was FOUND on the data it is reported on;
   z=3.12 carries an unquantified multiple-comparisons debt from ~10
   splits this round. Mitigants — condition plateau, mid-based
   restatement, monotone skew gradient, matched-price 2x2, placebo at
   zero — are internal; only new months settle it.
2. **The disjoint census sample disagrees in sign.** Same rule on the
   2,000-episode census sample: −0.98c gross (n=175; excluding 2025-10/11:
   −0.10c, n=156) vs holdout +3.89c (n=1,712). Statistically compatible
   (Δp = 0.042→0.050, z ≈ 1.1–1.4) and the same census-vs-holdout tension
   REPLICATION-001 already adjudicated toward the 9.5x-larger sample
   (treated-cell P(dog): census 0.4964 vs holdout 0.4373, samples disagree
   at z=2.66) — but I cannot call n=175 a confirmation, and if truth lies
   between the samples the cell is nearer +2.5c gross / +1.5c net.
3. **No sample-disjoint replication is possible today.** The union
   consumes every resolved month. 2026-06 has 1,287 episode files awaiting
   outcomes (~130 expected in-cell episodes/month) — a powered disjoint
   test needs ~3 new months. Interim replicator options are instrument-
   level only (fresh extractor; grid-shift: read the condition at t=10 or
   t=20 from raw deltas via one surveyor drilldown).
4. Fee is the mission's 156bps convention, not a measured number; at
   0.94c/share it is 27% of the gross edge, so a mismeasured fee moves the
   net materially.
5. 2025-10/11 are negative. Consistent with their measured snapshot
   sparsity and 4.5% weight, but if they are regime rather than noise,
   month-consistency is 6/8, not 8/8.

## Reproduce (duckdb, from glitch-hunt/)

```sql
WITH hb AS (SELECT slug, month, t_sec, up_bid, up_ask, down_bid, down_ask,
       (up_bid+up_ask)/2 up_mid, (result_id=0) AS up_won
  FROM 'replication/holdout_checkpoints.parquet'),
cb AS (SELECT slug, month, t_sec, up_best_bid, up_best_ask, down_best_bid,
       down_best_ask, up_mid, up_won
  FROM 'census/checkpoints.parquet' WHERE t_sec IN (0,15)),
base AS (SELECT * FROM hb UNION ALL SELECT * FROM cb),
w AS (SELECT b0.slug,
       CASE WHEN b0.up_mid<0.5 THEN b0.up_ask ELSE b0.down_ask END dog_ask0,
       CASE WHEN b0.up_mid<0.5 THEN b0.down_ask ELSE b0.up_ask END fav_ask0,
       CASE WHEN b0.up_mid<0.5 THEN b15.down_ask ELSE b15.up_ask END fav_ask15,
       CASE WHEN b0.up_mid<0.5 THEN (NOT b0.up_won) ELSE b0.up_won END fav_won
  FROM base b0 JOIN base b15 USING (slug)
  WHERE b0.t_sec=0 AND b15.t_sec=15
    AND b0.up_bid IS NOT NULL AND b0.up_ask IS NOT NULL
    AND b0.down_bid IS NOT NULL AND b0.down_ask IS NOT NULL
    AND b15.up_bid IS NOT NULL AND b15.up_ask IS NOT NULL
    AND b15.down_bid IS NOT NULL AND b15.down_ask IS NOT NULL)
SELECT COUNT(*) n, AVG(fav_ask15) ask, AVG(fav_won::INT) p,
       AVG(fav_won::INT - fav_ask15) gross
FROM w WHERE dog_ask0 BETWEEN 0.20 AND 0.46 AND fav_ask15 >= fav_ask0 - 0.005;
-- n=1887, ask=0.5994, p=0.6338, gross=+0.0344
```

## Self-killed this round (for the graveyard map)

- **Gap pointer 2 — late-window 10c+ jump continuation: dies on dedupe +
  settlement basis.** Chain-deduped (`jumps_raw`, new event when >30s
  since prior same-direction row): t 600-780 10c+ leaves n=181 up / 221
  down (raw 974/964 was ~2.4x re-trigger inflation). Settlement-based
  edge vs post-jump MID (before spread and fee): up +2.4c (P=0.6022 at
  mid 0.578), down +0.6c (P=0.5566 at down-mid 0.551) — direction-
  asymmetric, and at 5-10c magnitude it sign-flips (up +2.2c / down
  −2.6c). The +6.0c median drift in `jumps.csv` was duplicated-row
  mid-drift, not harvestable edge; paying the post-jump ask and 156bps
  erases what remains. Trap name: jump re-trigger rows are not events —
  chain-dedupe before believing any jump n. retryOnlyIf: a deduped,
  ask-based, settlement-basis cut clears friction with the SAME sign both
  directions in >= 6/8 months.
- Global first-per-episode dedupe is too aggressive for the same table
  (first 3c+ move almost always occurs before t=300, leaving n<=3 in late
  buckets) — use gap-based chaining, not global firsts.

---

## MANTIS VERDICT — KILL

Reviewer: mantis. Round 2, Foundry Phase 2. Date: 2026-07-10.
Independent checks run before verdict: headline reproduced (holdout
+3.89c gross, n=1,712); per-month reproduced (6/6 positive 2025-12..05,
+2.0c to +10.9c); census disagreement reproduced (−0.98c, n=175; −0.10c
ex-Oct/Nov); stale-book attack FAILED — edge holds at +3.63c (n=1,402)
where the fav touch genuinely moved t=0→t=15, and is not carried by
unchanged books. The author's confessions are accurate and complete.
This is the best-constructed memo the Foundry has produced. It still dies.

1. **GRAVEYARD: the claim is structurally unfalsifiable today, and the
   quarantine clause covers this cohort.** Q-001's retryOnlyIf reads "a
   disjoint future slice (months > 2026-05, resolved) ... Do not retry on
   2025-10..2026-05 data." This memo is the THIRD slicing of that exact
   quarantined cohort (dog ask <= 0.46), measured entirely on the banned
   window, and its union consumes every resolved episode in existence
   (verified: holdout max month = 2026-05, 17,126 episodes; 2026-06 has
   zero outcomes in markets.parquet). The clause has not fired. The gap
   map sanctioned ONE fav-side measurement — the unconditioned t=15/30/60
   fav buy — and that measurement FAILED friction (+0.35c net, memo's own
   table). The surviving cell required a new interaction term (skew-intact
   fade condition) mined from the same data it is reported on. That is
   the precise move the quarantine clause exists to block.
2. **MEASUREMENT: the only sample-disjoint read that exists points the
   wrong way, from the cohort that already burned us once.** Census
   subsample: −0.98c gross at n=175 (reproduced) vs holdout +3.89c.
   Compatible at z≈1.3, yes — but Round 1 taught that this same cohort
   produces z=2.4 phantoms that reverse on the other sample
   (REPLICATION-001: census +5.1c → holdout −0.7c, samples disagreeing at
   z=2.66). A z=3.12 headline carrying ~10+ splits of multiple-comparisons
   debt, with its one out-of-sample-ish check wrong-signed, does not clear
   a raised bar. The 2x2's "8.9c truth spread" leans one leg on the
   skew-contradicted row at z=−1.81 (n=365) — noise-compatible with zero.
3. **CAPACITY + unmeasured slippage inside a 2.5c margin.** Median
   best-level depth at the cell is ~97 USDT and top-3 median ~570 USDT
   (p10 ~155): the mission's 3–4k USDT clip misses by ~10x at median, and
   even the memo's own 300–600 USDT sizing walks past the best level while
   the +2.51c net assumes best-ask fill for the entire clip. Depth-limited
   slippage is unmeasured; 1c of walk removes 40% of the net edge.
4. **SURVIVES buys nothing today.** The replicator's only possible action
   is an instrument-level re-check, and REPLICATION-001 already proved the
   instruments agree exactly (200/200 checkpoint rows). Mission definition
   #4 — survives independent replication on disjoint months — cannot be
   evaluated until ~3 new months resolve. A SURVIVES now is a promise, not
   a finding, and the quota (consumed by memo 001, then reversed) exists
   precisely to make such promises expensive.

What died: not the phenomenon — the claim that it is ESTABLISHED. The
treated-vs-placebo contrast (+3.44c vs −0.13c), the monotone skew
gradient, and the entry-time plateau are real numbers on this window and
are hereby preserved as a pre-registration, not a discovery.

**retryOnlyIf:** markets.parquet contains resolved outcomes for >= 3
months strictly after 2026-05, AND a fresh-instrument measurement of the
EXACT pre-registered rule (two-sided t=0 and t=15 books; dog ask(t=0) <=
0.46; fav ask(t=15) >= fav ask(t=0) − 0.005; taker-buy fav at t=15 ask)
on those months alone shows: pooled gross >= +2c at n >= 350, unskewed
placebo (dog ask 0.48–0.50, same intact condition) within ±1c of zero,
and skew-contradicted movers at matched ask <= 0. No re-tuning of the
0.46 threshold, the 0.5c tolerance, or the entry time is permitted before
that read — any knob change restarts the multiple-comparisons clock. If
it passes, mantis concedes the anomaly and the memo re-enters at
replication stage with this verdict voided; additionally the replicator
must then measure depth-walk slippage for a 300 USDT clip before any
capacity score above 2/10.
