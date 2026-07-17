# Pre-fill book state vs post-fill drift (OPEN-QUESTIONS #1, A44)

What does the book look like just BEFORE a resting fill that pays vs
one that bleeds? Follow-up to A39 (post-fill drift is the living
edge's discriminator).

Method: `scripts/drift-features.ts` — for every non-taker BUY fill of
0x04b6d7e9 (2,726) and b27bc932 (2,984) on the 30 Jun-12 books:
pre-fill features on the bought asset's own book series (preDrift10/30
= mid momentum into the fill, spread, depth of the level below bid,
book-event rate last 5s, minute), joined with postDrift60 (the A39
metric). Favorable = post60 > 0.

| feature (mean) | 04b6d7e9 all / fav / adv | b27bc932 all / fav / adv |
|---|---|---|
| preDrift30 | **+1.5c** / +3.3c / −0.0c | **+5.5c** / +6.9c / +4.3c |
| preDrift10 | +0.0c / +0.4c / −0.2c | +2.5c / +2.9c / +2.3c |
| spread | 1.02c (no diff) | 1.03c (no diff) |
| depthBelow | −1.1c (no diff) | −0.9c (no diff) |
| eventRate5s | 9.8 (no diff) | 9.2 (no diff) |
| post60 mean | **+0.47c** | **−0.15c** |
| corr(preDrift30, post60) | +0.13 | +0.05 |
| favorable share | 47% | 49% |

## Findings

1. **Momentum CONTINUES at the 30–60s horizon** (within-wallet):
   resting BUY fills that arrive while the asset's mid is falling
   (negative preDrift) are the adverse ones — the fall continues.
   "Catching the falling ask" is exactly the adversely-selected
   subset (the worst_queue intuition, now shown in real fills).
   Positive pre-drift into the fill (a pullback inside a rise)
   predicts favorable continuation. Effect is small per fill (corr
   +0.05/+0.13) but it is the ONLY discriminating feature — spread,
   depth, event rate, and minute all show nothing.
2. **The wallets occupy different momentum habitats** — and that IS
   the between-wallet edge gap: b27bc932's resting fills fire in
   strong-momentum states (+5.5c/30s — its fast requotes trail the
   rising side and get hit at local tops; post60 −0.15c), while
   0x04b6d7e9's fills sit in near-calm states (+1.5c; post60
   +0.47c). Same books, same days, same shallow ladders. The winner
   avoids being filled mid-chase.
3. **Entry-gate prior for the lab (shallow-fast cell)**: (a) veto or
   widen the bid on an asset whose mid fell over the last 10–30s
   (do not catch the knife — momentum continues); (b) do NOT
   instant-requote the bid upward under a rally (that manufactures
   b27bc932's local-top fills); (c) the target habitat is the calm
   micro-regime — quote both sides tight when 30s momentum ≈ 0.
   This is a measurable, sim-expressible gate: |preDrift30| below a
   threshold as a quoting condition.
4. Effect-size honesty: favorable share is ~47–49% for BOTH wallets
   — the edge is in the SIZE of drift conditional on state, not hit
   rate; per-fill noise dominates and only aggregates separate the
   wallets. Sweeps must evaluate the gate on aggregate drift and
   pair cost, not per-fill win rate.

## Producing command

- npx tsx research/gabagool/scripts/drift-features.ts --dir
  research/gabagool/data/telonex-r2 --wallets
  04b6d7e9=research/gabagool/data/activity-04b6d7e9-jun12-14.jsonl,b27bc932=research/gabagool/data/activity-b27bc932-jun.jsonl

## Out-of-sample validation (A45): May-13 + Jun-10

Same script on the W4 book days with fresh activity pulls (04b6d7e9:
1,575 + 1,262 resting fills; b27bc932: 0 on May-13 — a May-downtime
day, confirming the dossier's gap windows — and 7,488 on Jun-10).

| sample | 04b6 corr(pre10,post60) | 04b6 corr(pre30,post60) | fav-vs-adv preDrift10 | fav-vs-adv preDrift30 |
|---|---|---|---|---|
| Jun-12 (A44) | +0.06 | +0.13 | +0.4c vs −0.2c ✓ | +3.3c vs −0.0c ✓ |
| May-13 | **+0.21** | +0.04 | +0.0c vs −1.9c ✓✓ | +0.1c vs −1.2c ✓ |
| Jun-10 | −0.10 | **−0.19** | +0.1c vs −0.0c (~flat) | +0.4c vs **+2.2c ✗ reversed** |

What survives and what dies:

1. **ROBUST — the habitat separation**: b27bc932's resting fills
   fire at +3–4c/30s chase states in every joined sample; 04b6d7e9's
   at ≈0. The winner does not get filled mid-chase, ever.
2. **ROBUST (3/3) — the 10-second falling-ask veto**: adverse fills
   have equal-or-lower preDrift10 than favorable in all three
   samples (strongly on May-13, corr +0.21). Do not let a bid get
   hit within ~10s of a down-move.
3. **DEAD — the 30s directional rule**: sign flips by day (Jun-10:
   positive 30s momentum preceded the ADVERSE fills, corr −0.19).
   Momentum-continuation vs mean-reversion at 30–60s is
   day-regime-dependent; a fixed direction gate would overfit one
   day. Note Jun-10's pattern is "any 30s momentum is bad" —
   consistent with calm-preference, not with continuation.
4. Revised gate spec for the lab: (a) prefer quoting in low-|30s
   momentum| states; (b) hard veto on fills within ~10s of a fall
   (pull/widen the bid on a falling ask); (c) never instant-requote
   upward under a rally (the b27bc932 habitat); (d) treat any
   DIRECTIONAL 30s+ signal as a regime-dependent parameter to sweep,
   not a fixed rule.

Producing pulls: activity-{04b6d7e9,b27bc932}-{may13,jun10}.jsonl
(concatenated as *-w4days.jsonl); books data/telonex-r2-w4/<day>.
