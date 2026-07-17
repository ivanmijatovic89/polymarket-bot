# STATE — gabagool knowledge shift

Session relay state. A fresh session continues from CHARTER.md + this file.

## Status digest (updated 2026-07-17T05:20Z, session 1)

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
  are one operator (profiles created 121s apart).
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

## Work queue (ranked — mirrors OPEN-QUESTIONS.md)

1. Decompose remaining actives: 0xaaaaa, badfallen, doggystyie,
   bonereaper, 0xce25 (H3 verdict needs majority; scripts ready —
   pull-activity.ts + the inline python pattern used for
   b55f/powerwinner). Then _META synthesis v2 with the
   trading-vs-subsidy table.
2. January transition sample (Jan 10–14, gabagool) — decay-speed prior.
3. Per-market leg-balance check for powerwinner (is his btc-5m churn
   pair-shaped or directional?) — one python pass on existing data.
4. Jan fee-rate archaeology (contested 2×) + any mid-Feb change (his
   exit trigger) — archive.org developer-docs pages.
5. D3 endgame reversal table / D4 open dynamics / D5 spread lifecycle
   (charter list; D5 partially covered by fable data — check before
   duplicating).
6. Literature A2 (queue-position value, rebate-driven MM literature,
   prediction-market MM empirics).
7. Continuous: fold into BRIEF/HYPOTHESES/METRICS; when material changes
   stop → SATURATION.md → LAB-HANDOFF.md → DONE.

## Workstream status

- A Literature: A1 done (A-S, G-M, queue models → implications).
- B Venue mechanics: fee+rebate history solid incl. taker-rebate tiers
  (2026-05-28) + YIELD program existence; open: Jan rate, tick/min/rate
  limits, resolution mechanics (Game J).
- C Wallet forensics: archetype DONE (two eras + D2), incumbent DONE,
  powerwinner DONE (taker-rebate farmer); 6 wallets remain.
- D Measurements: **D2 DONE — worst_queue admits 44–49% of real fills,
  touch 64–68%; ~30-45% of archetype fills were taker completions**
  (measurements/d2-fill-reality-gap.md). D1 re-scoped (P38). D3–D5 open.
- E Synthesis: BRIEF/HYPOTHESES current incl. D2+powerwinner (H3
  "subsidy dominance" now leading).
