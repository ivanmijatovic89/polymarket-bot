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

1. NEXT: **Fee-inclusive re-audit of the July actives** (A13 fallout —
   the premise "real edge exists today" is now uncertain). Method
   proven on gabagool Jan: sample each wallet's fills' tx receipts,
   decode OrderFilled + refund transfers -> per-fill (maker/taker role,
   net fee). Sample btc-15m fills for b55f + 0xce25 + one farmer;
   compute true fee drag and fee-inclusive margins. This ALSO gives
   the maker/taker split and feeds the edge-source hunt from the same
   receipts.
2. Edge-source hunt on btc-15m (merge with 1 where possible): level
   selection vs mid, timing within window, completion behavior --
   fills x books join (measure-fill-gap.ts pattern) for b55f/0xce25.
   Data on disk (activity-{b55f,0xce25}-jul.jsonl).
3. D3 endgame reversal table / D4 open dynamics / D5 spread lifecycle
   (check fable coverage first -- E24/E25 partially cover D4/D5).
4. Venue leftovers: tick/min-size/rate limits, resolution mechanics
   (Game J).
5. Continuous: fold into BRIEF/HYPOTHESES/METRICS (BRIEF + H1 need the
   A13-A15 updates folded in); at saturation -> SATURATION.md ->
   LAB-HANDOFF.md -> DONE.

DONE this session: state sync; bonereaper verdict (hybrid, A12);
January transition analyzed (A15: adaptation, not decay); Jan fee rate
resolved on-chain (A14); fee-mechanics decode + gross-of-fee accounting
bias in ALL fee-era numbers (A13). Earlier sessions: per-book nets
(A11), _META v2, fee-formula bracketing, literature A1/A2, leg-risk
policy rewrite, D2 (A9), 7-wallet decomposition (A10).

## Workstream status

- A Literature: A1 done (A-S, G-M, queue models); A2 done (queue value,
  subsidized-MM economics, YIELD verdict: dust).
- B Venue mechanics: fee+rebate history SOLID — Jan rate resolved
  on-chain (A14), fee implementation decoded (charge+refund, A13),
  formula change bracketed Mar 5→Apr 1 2026. Open: tick/min/rate
  limits, resolution mechanics (Game J), bulk-payout provenance.
- C Wallet forensics: archetype DONE (two eras + Jan transition + D2),
  incumbent DONE, powerwinner DONE, bonereaper DONE (hybrid), 7-wallet
  decomposition DONE (gross-of-fee caveat A13); remaining: drfc4eybh7i8
  re-resolution, badfallen/doggystyie/0xaaaaa dossiers optional.
- D Measurements: **D2 DONE — worst_queue admits 44–49% of real fills,
  touch 64–68%; ~30-45% of archetype fills were taker completions**
  (measurements/d2-fill-reality-gap.md). D1 re-scoped (P38). D3–D5 open.
- E Synthesis: BRIEF/HYPOTHESES current incl. D2+powerwinner (H3
  "subsidy dominance" now leading).
