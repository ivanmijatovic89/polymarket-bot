# STATE — gabagool knowledge shift

Session relay state. A fresh session continues from CHARTER.md + this file.

## Status digest (updated 2026-07-17T05:05Z, session 4)

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

1. NEXT: D3 endgame reversal + D5 spread lifecycle — script
   scripts/window-lifecycle.ts DONE and smoke-tested; 288-market June
   run IN FLIGHT (log: research/gabagool/data/window-lifecycle-jun.log;
   if a successor finds it finished, write
   measurements/window-lifecycle-btc15m.md + A20 and fold). D4 open
   dynamics: RESOLVE BY PRIORS (fable E24 opening-quote kill + A17 no
   open concentration) — no new measurement needed.
2. Venue leftovers REMAINING: 2026-exchange launch date, bulk-payout
   provenance (bonereaper $62.6k lump). (Tick/rate-limits/stream
   precision RESOLVED, A19.)
3. Wallet leftovers (optional): drfc4eybh7i8 re-resolution, P19 $8M/day
   wallet hunt, badfallen/doggystyie/0xaaaaa dossiers.
4. Continuous: at saturation -> SATURATION.md -> LAB-HANDOFF.md -> DONE.

DONE session 4 so far: recovered + committed the edge-source unit a
crashed predecessor left on disk — A17 (edge execution fingerprint,
measurements/edge-source-btc15m.md), A18 (resolution = Chainlink
BTC/USD stream, ties→UP; negRisk false; tick 0.01; min 5 shares),
G9 (Telonex coverage ends 2026-06-14), OPEN-QUESTIONS re-ranked
(3 items resolved). Then: synthesis fold A17/A18 into
BRIEF/HYPOTHESES/METRICS (H1 ladder+timing priors; H6 June
cross-check; Chainlink basis caveat on H4; ties→UP endgame bounds).
DONE session 3: state sync; bonereaper (A12); A13-A16 folded into
BRIEF/HYPOTHESES (new H6 completion-aggressiveness; H5 resolved
supported)/METRICS; Jan transition (A15); Jan fee rate on-chain (A14);
fee-mechanics decode + gross-of-fee bias (A13); fee-inclusive re-audit
of actives (A16) — edge survives at +2.31% btc-15m, meta is
majority-taker, new exchange contract found. Earlier: A9-A11, _META
v2, literature A1/A2.

## Workstream status

- A Literature: A1 done (A-S, G-M, queue models); A2 done (queue value,
  subsidized-MM economics, YIELD verdict: dust).
- B Venue mechanics: fee+rebate history SOLID — Jan rate resolved
  on-chain (A14), fee implementation decoded (charge+refund, A13),
  formula change bracketed Mar 5→Apr 1 2026. Resolution DONE (A18:
  Chainlink stream, ties→UP); min size 5 / tick 0.01 / negRisk false
  verified. Open: sub-cent tick rule, rate limits, stream sampling
  precision, bulk-payout provenance.
- C Wallet forensics: archetype DONE (two eras + Jan transition + D2),
  incumbent DONE, powerwinner DONE, bonereaper DONE (hybrid), 7-wallet
  decomposition DONE (gross-of-fee caveat A13), edge-source fingerprint
  DONE (A17); remaining: drfc4eybh7i8 re-resolution,
  badfallen/doggystyie/0xaaaaa dossiers optional.
- D Measurements: **D2 DONE — worst_queue admits 44–49% of real fills,
  touch 64–68%; ~30-45% of archetype fills were taker completions**
  (measurements/d2-fill-reality-gap.md). Edge-source DONE (A17,
  measurements/edge-source-btc15m.md). D1 re-scoped (P38). D3–D5 open
  (June data only — G9).
- E Synthesis: BRIEF/HYPOTHESES/METRICS current through A18.
