# Round 4 pre-registration — gabagool (written BEFORE any hypothesis query)

Date: 2026-07-10. Target: ATLAS gap pointer 3 (prev-window-agreement
whisper, kill or grow), with gap pointer 1 (staleness audit) as the
supporting confounder check. Gap pointer 2 is NOT touched this round.

## Prior (from memo 003, already on the map — not new evidence)

t=15, ask 0.50-0.66, holdout ∪ census: prev-winner tokens −1.06c
(n=8,731, z=−1.99) vs prev-loser −0.04c (n=13,603), 6/8 months
negative-side. Logged as noise-compatible with full debt attached.

## Universe (fixed)

`replication/holdout_checkpoints.parquet` only (no census mixing — the
prior was measured on the union; this round uses holdout-only so the
numbers are one instrument). Two-sided rows: up_bid, up_ask, down_bid,
down_ask all non-null, 0 < bid < ask < 1 on the traded token.
Prev-window winner from `census/outcomes_all.csv` joined on
epoch − 900; episodes with unresolved/missing previous window excluded.
Unit: one row per (episode, token, t). Edge = P(token wins) − avg ask
(taker-buy at best ask, hold to settlement, episode-level, no duration
weighting). Fee convention 156bps × ask. z = edge / sqrt(p(1−p)/n)
using cell p.

## Primary cut (the pointer's exact question)

Prev-winner tokens, ask ∈ [0.50, 0.66), at each t ∈ {15, 30, 45, 60}.
Contrast: prev-loser tokens, same band, same t.

GROW (memo-positive) requires ALL of:

1. prev-winner edge ≤ −1.0c at every t ∈ {30,45,60};
2. deepening: edge(60) ≤ edge(15) − 0.5c;
3. z ≤ −2.0 at t=60;
4. ≥ 6/8 months negative at t=60;
5. contrast intact: prev-loser edge within ±0.5c of 0 at t=60;
6. HARVEST test (separate — a negative edge on buying X is not an edge
   until the expressible mirror clears friction): taker-buy the
   OPPOSITE token (prev-loser) at its own ask in the episodes where the
   prev-winner token is in-band; that leg's net edge (gross − 156bps ×
   its ask) must be > 0 with z ≥ 2, else the donation is spread-consumed
   (E-002 precedent) and the memo reports "real donation, untakeable".

KILL (record dead with numbers) if at t=60: prev-winner edge > −0.5c OR
z > −1.5 OR < 6/8 months negative. Power scope mandatory (M-003
lesson): report per-leg 95% CI and the smallest effect the n could have
detected at z=2; no "null" language beyond what the CI supports.

Anything between GROW and KILL: report as unresolved whisper with
numbers; no atlas claim.

## Secondary shape cut (pre-declared, only after primary)

t=60, 4c ask bands over [0.34, 0.66), both prev-winner and prev-loser
tokens: adjacency sign agreement for whichever primary result obtains.

## Staleness audit (gap pointer 1, exact spec from the map)

1. Per-month p50/p90 of age_ms at t=15 (holdout) and t=897
   (endgame_checkpoints).
2. Re-cut PR-002's locked cell on fresh books: dog ask(t=0) ≤ 0.46 AND
   fav ask(t=15) ≥ fav ask(t=0) − 0.005, buy fav at t=15 ask — with
   age_ms < 60,000 at t=15. (Measurement of instrumentation, NOT a
   retry of the banned cohort: no new thresholds, no tuning, numbers go
   to PR-002's evidence footnote only.)
3. Re-cut E-002 channel 1 (two-sided, ask 4-20c, t ≥ 885) on
   age_ms < 60,000.
4. Re-cut THIS round's primary (prev-winner, t=60) on age_ms < 60,000.
   Decision rule for the footnote: if 2025-10/11 signs flip or |edge|
   moves > 50% under the age filter while other months move < 20%, the
   atlas month-consistency counts get the instrumentation footnote; if
   2025-10/11 survive the filter unchanged, they are regime, not
   instrumentation.

## Debt ledger commitment

Every cell inspected this round is counted in the memo's ledger,
including the audit cells. No cut not listed above will be reported as
evidence; anything exploratory beyond this file is confession-only.
