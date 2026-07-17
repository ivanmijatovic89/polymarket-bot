# STATE — gabagool knowledge shift

Session relay state. A fresh session continues from CHARTER.md + this file.

## Status digest (updated 2026-07-17T01:35Z, session 3)

NOTE: journal timestamps before session 3 are mislabeled (~4h ahead);
trust git commit times. All sessions so far ran 2026-07-17 00:26Z→.

Phase 0 + first forensics arc COMPLETE. All deliverable files exist and
have substantive content: PRIORS.md (P1–P51 + amendments A1–A8),
STRATEGY-BRIEF.md, HYPOTHESES.md (H1–H5), METRICS.md, VENUE-MECHANICS.md,
ENGINE-GAPS.md (G1–G8), OPEN-QUESTIONS.md (ranked queue),
wallets/{gabagool22,b55f-incumbent,_META}.md,
measurements/{tail-forensics,era-comparison}-gabagool22.md.

### The story so far (for a fresh session, 60 seconds)

- Archetype @gabagool22 (0x6031…f96d, $868,863 all-time): parity-grinder
  maker — buys-only both-sides ladders, ~0.1% leg imbalance, $4 clips,
  merge exits. Zero-fee era (start 2025-10-29): +1.9% of turnover,
  98.7% win on btc-15m (his best book — the lab's exact scope). Fees
  arrived 2026-01-06 → pair costs compressed to ≥$1 → end-state was
  rebate farming (trading −$1.8k ≈ rebates +$1.8k in final 2.6d) → quit
  2026-02-20.
- Incumbent 0xb55fa1296e6ec55d0ce53d93b9237389f11764d4 (still active,
  $670k all-time, growing): DIFFERENT variant — loss-tolerant tail
  harvester (47% win, never merges, deep cheap-side buys, clips to
  $1.3k). Income Jul 14-16: trading $2.7k/day + maker rebate $0.9k/day +
  TAKER rebate $3.1k/day (tiered program since 2026-05-28, top tier 50%
  fee refund — incumbents pay half fees; cold-start moat).
- Ecosystem: ~7 active wallets, ~$18.5k/day collectively; b55f+0xce25
  are one operator (profiles created 121s apart). Stratified: 3 edge /
  3 farmers / bonereaper = hybrid (btc-5m farming + real 15m edge
  sleeve + sports punts; rescued by a $62.6k BULK taker-rebate payout —
  A12). btc-15m edge now confirmed by 3 independent wallets.
- Venue timeline: fee-free → 2026-01-06 15m-crypto taker fees + 20%
  daily maker rebates → 2026-03-06 all-crypto fees → fee curve reshaped
  (peak $0.78→$1.75/100sh) between Feb 28 and May 31 → 2026-05-28 taker
  rebate tiers. Fee formula details + history in VENUE-MECHANICS.md.

### Known pitfalls for successors

- data-api /activity: NO row ids, second timestamps → identical
  same-second rows are REAL; never content-dedupe (puller v1 incident).
  Use scripts/pull-activity.ts v2 (inclusive-end cursor walking).
- MERGE usdcSize = pairs × $1 (validated). lb-api profit ≈ excludes
  rebate transfers. UI per-leg reads inflated (P17).
- Boundary truncation: analyze only markets with fills>0 and 1h/2h
  margins (analyze-tail.ts does this).
- Write ONLY inside research/gabagool/ (pre-commit hook; one near-miss
  with a stray repo-root measurements/ dir — deleted).

## Work queue (ranked)

1. NEXT: January transition analysis — pull COMPLETE
   (data/activity-gabagool22-jan.jsonl, done:true). Analyze with
   analyze-tail.ts + decompose-activity.ts; compare pair cost / win%
   vs Dec 0.98/98.7% and Feb 1.00/38.6% — decay-speed prior. May also
   empirically pin the contested January fee rate.
2. Edge-source hunt for the CURRENT btc-15m edge (+2-3.2%): what do
   the edge wallets do differently from farmers? Candidates: level
   selection, timing within window, coin choice. Needs fills×books join
   (measure-fill-gap.ts pattern) for b55f/0xce25 on btc-15m slugs.
   Data already on disk (activity-{b55f,0xce25}-jul.jsonl).
4. D3 endgame reversal table / D4 open dynamics / D5 spread lifecycle
   (check fable coverage first — E24/E25 partially cover D4/D5).
5. Venue leftovers: tick/min-size/rate limits, resolution mechanics
   (Game J). Jan fee-rate still contested (2× ambiguity) — formula
   change now bracketed Mar 5→Apr 1 (57b8b85); Jan rate may fall out
   of queue item 1's data instead of archaeology.
6. Continuous: fold into BRIEF/HYPOTHESES/METRICS; at saturation →
   SATURATION.md → LAB-HANDOFF.md → DONE.

DONE since last queue refresh: per-book nets (T1: btc-15m still an edge
book — A11), _META v2, fee-formula bracketing, literature A2 (queue
value + subsidized MM; YIELD is dust), leg-risk policy rewrite in BRIEF
(parity is era-dependent; sweep it 0.1%→40%).

## Workstream status

- A Literature: A1 done (A-S, G-M, queue models); A2 done (queue value,
  subsidized-MM economics, YIELD verdict: dust).
- B Venue mechanics: fee+rebate history solid incl. taker-rebate tiers
  (2026-05-28); formula change bracketed Mar 5→Apr 1 2026. Open: Jan
  rate (contested), tick/min/rate limits, resolution mechanics (Game J).
- C Wallet forensics: archetype DONE (two eras + D2), incumbent DONE,
  powerwinner DONE (taker-rebate farmer); 6 wallets remain.
- D Measurements: **D2 DONE — worst_queue admits 44–49% of real fills,
  touch 64–68%; ~30-45% of archetype fills were taker completions**
  (measurements/d2-fill-reality-gap.md). D1 re-scoped (P38). D3–D5 open.
- E Synthesis: BRIEF/HYPOTHESES current incl. D2+powerwinner (H3
  "subsidy dominance" now leading).
