# REPLICATION 001 — Window-roll reversal skew (t=0 underdog at ask)

Replicator, Round 1, Foundry Phase 2. Date: 2026-07-10.
Target: `glitch-hunt/memos/001-window-roll-reversal-skew.md` (mantis: SURVIVES).

## VERDICT: REVERSED

Original +5.1c (n=560, census) vs holdout **-0.7c** (n=5,315). P(dog wins) on
holdout = 0.4373, which is 9.1 sigma BELOW the memo's 0.50 martingale anchor —
the entry is quarantined. The number that reverses it: **-0.0073 pooled t=0
edge; -0.0368 net t=15 edge at n=5,315**.

## Holdout slice (disjoint by construction)

All resolved episodes 2025-10..2026-05 with a local episode file whose slug is
NOT in `census/sample_manifest.csv`: 17,126 episodes (954/2,118/2,671/2,592/
2,438/2,726/2,630/997 by month). 2026-06 excluded (no outcomes in
markets.parquet). 16,626 had a two-sided t=0 book; 5,315 fell in the treated
cell (dog ask 0.20–0.46 at t=0) — 9.5x the census cell n.

## Independent instrument

Fresh extractor written from the memo's claim alone
(`replication/extract_t60.cjs`): delta replay in ingest_seq order (book =
replace, price_change size-0 = remove / else upsert), checkpoints t =
0/15/30/45/60 at ts_local_ms <= epoch*1000 + t*1000. Not derived from
`census/extract.cjs`. Outcomes joined directly from `markets.parquet`
(result_id '0' = UP).

Pipeline sanity (all passed BEFORE looking at the treated cell):

- Base rate: P(UP wins) across holdout = 0.5005 (expected ~0.50).
- Mirror invariant: 0 / 85,326 checkpoints violate |up_bid + down_ask - 1| <= 0.011.
- Outcome semantics, own data: at t=60, up_mid > 0.65 -> UP wins 70.4%
  (n=1,360); up_mid < 0.35 -> UP wins 28.9% (n=1,386). Mapping correct.
- Snapshot self-check: raw mismatch 5.5% (2025-10) falling to ~0.5%
  (2026-02+), matching the census's own quality profile.
- Instrument cross-check: extractor run on 40 census episodes reproduces
  `census/checkpoints.parquet` best bid/ask EXACTLY on 200/200 checkpoint
  rows. The instruments agree; the divergence below is the sample.

## Measurements (mantis's required four)

### (a) t=0 edge in the treated cell (dog ask 0.20–0.46), pooled + per month

| month      | n        | avg ask    | P(dog wins) | edge      | z         |
| ---------- | -------- | ---------- | ----------- | --------- | --------- |
| 2025-10    | 120      | 0.4540     | 0.5667      | +11.3c    | +2.47     |
| 2025-11    | 113      | 0.4514     | 0.4956      | +4.4c     | +0.94     |
| 2025-12    | 706      | 0.4513     | 0.4193      | -3.2c     | -1.70     |
| 2026-01    | 846      | 0.4470     | 0.4255      | -2.2c     | -1.25     |
| 2026-02    | 834      | 0.4446     | 0.4508      | +0.6c     | +0.36     |
| 2026-03    | 1092     | 0.4432     | 0.4176      | -2.6c     | -1.69     |
| 2026-04    | 1196     | 0.4402     | 0.4482      | +0.8c     | +0.55     |
| 2026-05    | 408      | 0.4390     | 0.4314      | -0.8c     | -0.31     |
| **POOLED** | **5315** | **0.4445** | **0.4373**  | **-0.7c** | **-1.06** |

Months positive: 4/8, and the only sizable positives are the two smallest-n,
highest-mismatch months (2025-10/11). Equal-weighting months gives +1.1c —
still below the +3c bar and carried entirely by those two months.
P(dog wins) = 0.4373 vs the claimed 0.50 anchor: z = -9.15. The martingale
half of the claim fails outright on holdout — the skewed open book is
directionally INFORMATIVE (the dog really does lose more often), not wrong.

### (b) Entry at later checkpoints (dog side fixed at t=0), gross and net of 156bps

| t   | n    | avg ask | gross edge | net edge | z(net) |
| --- | ---- | ------- | ---------- | -------- | ------ |
| 0   | 5315 | 0.4445  | -0.7c      | -1.4c    | -2.07  |
| 15  | 5315 | 0.4668  | -3.0c      | -3.7c    | -5.37  |
| 30  | 5315 | 0.4650  | -2.8c      | -3.5c    | -5.10  |
| 45  | 5315 | 0.4636  | -2.6c      | -3.4c    | -4.89  |
| 60  | 5315 | 0.4621  | -2.5c      | -3.2c    | -4.68  |

t=15 net edge is negative in 7/8 months (only 2025-10 positive, +5.8c, n=120).
The load-bearing takeable-entry number is decisively negative.

### (c) Placebo bands at t=0

| band            | n    | avg ask | P(win) | edge  |
| --------------- | ---- | ------- | ------ | ----- |
| treated <= 0.46 | 5315 | 0.4445  | 0.4373 | -0.7c |
| 0.46–0.48       | 4143 | 0.4759  | 0.4815 | +0.6c |
| 0.48–0.50       | 2899 | 0.4900  | 0.4867 | -0.3c |

Placebos are fair, as the memo predicted — but the treated cell now sits AT
placebo level (within 1c of both), and slightly below. The treated-vs-placebo
contrast that defined the anomaly is gone.

### (d) Side split (treated cell)

| dog side | n    | avg ask | P(win) | t=0 edge | t=15 net |
| -------- | ---- | ------- | ------ | -------- | -------- |
| UP       | 2589 | 0.4438  | 0.4368 | -0.7c    | -4.0c    |
| DOWN     | 2726 | 0.4452  | 0.4376 | -0.8c    | -3.4c    |

Symmetric and both negative. The census's dog=UP +8.1c lopsidedness does not
reappear — consistent with both census side numbers being noise around a
slightly negative truth.

Depth/freshness at the cell (context): median top-1 dog-ask depth 120 shares,
top-3 1,148 shares (p25 487, p10 220); median book age at t=0 107ms — matches
census. The book is live and the quotes are real; they are just not mispriced.

## Concession criteria (mantis's) — three of four fired

1. Pooled holdout t=0 edge < +3c: **FIRED** (-0.7c).
2. t=15 net edge <= 0 at n >= 3,000: **FIRED** (-3.7c, n=5,315, z=-5.4).
3. Placebo within 1c of treated: **FIRED** (treated -0.7c vs -0.3c / +0.6c).
4. Sign carried entirely by dog=UP: not fired (both sides negative alike).

## Why the census saw +5.1c

Not an instrument bug (exact cross-check above). The census cell (n=560,
z=2.41 found while scanning) was a sampling fluke, amplified by the two
noisy early months. The memo's a-priori anchor — "fair value is KNOWN to be
0.50 at t=0" — is itself false in the data: pre-open flow prices genuine
short-horizon directional information (holdout dog wins 43.7%, not 50%).
The graveyard lesson to record: **the t=0 martingale anchor does not hold on
this market; the open book's skew is signal, not error.** Any future memo
leaning on "fair = 0.50 at window open" inherits this reversal.

## Files

- `replication/extract_t60.cjs` — independent extractor (this report's instrument)
- `replication/analyze.sql` — all measurement queries
- `replication/data/holdout_manifest.csv` — the 17,126-episode holdout slice
- `replication/holdout_checkpoints.parquet` — 85,630 checkpoint rows (t=0..60)
- `replication/holdout_selfcheck.parquet` — per-episode snapshot self-check counts
