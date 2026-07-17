> **OPERATOR NOTE (2026-07-17, after Phase 1 close):** Phase 1 ended at saturation and the relay notes below say the shift is over — that is now HISTORY. The operator re-opened the shift: DONE was removed deliberately and CHARTER.md gained a **Phase 2** section (streams W1–W7, NO saturation clause, never re-create DONE). Rebuild the work queue from Phase 2 and continue.

# STATE — gabagool knowledge shift

Session relay state. A fresh session continues from CHARTER.md + this file.

## Status digest (updated 2026-07-17, session 5 — PHASE 2 OPEN)

Phase 1 closed at saturation (all deliverables + LAB-HANDOFF.md done).
Operator reopened the shift as Phase 2 (CHARTER.md §Phase 2 + class
amendment): open-ended, W0 variant atlas first, DONE deleted (committed
session 5) and must never be recreated.

### Session-7 digest (2026-07-17 ~04:11–05:20Z, A26–A32)

VARIANT-ATLAS.md is written (W0 core done; 9 era days on-chain,
decoder bug A29 found+fixed, Apr–Jul re-scanned). W1 closed by
reclassification (A26: the −$542k "challenger" was a World Cup
sports-MM blow-up; class has NO large-loss casualty). W5 done (A28
rebate identity), W6 done (paper-EV; deep-pair cell = primary lab
target). New dossiers: 0x04b6d7e9 "quiet winner" (A30, +$473k in <4mo,
only trading-profitable parity wallet at scale), livebreathevolatility
(A31, PREDATES gabagool22, +$386k, quit at peak). A32: cold-start moat
only taxes taker completion — maker-pure newcomers win today. A27:
b27bc932 merge usage is a toggled module (era-bound). W3 snapshots 1–3
taken. Watch: journal timestamps drifted (trust git times).

### Phase-1 digest (still valid)

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

### Session-8 digest (2026-07-17 13:23Z→, A34)

Live snapshot 4 (O7): US-morning regime — sub-$1 club empty,
b27bc932 ran a 5x btc-5m sleeve; the meta is clock-dependent. A34:
0x04b6d7e9 btc-15m deep-dive DONE (was OPEN-QUESTIONS #1) —
shallow touch-hugging ladder + seconds-scale requoting, pairRate
0.94 p50 on btc-15m (0.78 was cross-book), excess leg =
favorite-side choice (60% win), all taker flow on 15m, sleeve ≈
breakeven+rebates in the hard regime. pull-telonex-r2.ts FIXED
(r2:// URIs now via S3 client — it never worked for r2-only rows).
H1 now carries TWO ladder cells (deep vs shallow+fast). A35: the
wallet keeps BUSINESS HOURS (12–19Z weekdays only, zero 20–05Z,
weekends mostly dark, Memorial Day off) — all +$473k earned in the
O7 hard regime; overnight-vs-session comparison must use b27bc932
(24/7). A36 (unit 4): b27bc932 session split — US 12–19Z is its
ONLY gross-negative session; the two living winners DIVIDE the day
(grind off-hours, shallow-fast US session); excess-leg-wins is a
class pattern (n=2). W4 must stratify by session. A37 (unit 5):
fill-density grid — rebate step reachable maker-only at touch/−1c;
(offset × requote) is a joint axis, two optima = the two living
recipes; OPEN-QUESTIONS #2 resolved. A38 (unit 7, W4 slice):
density grid replicated on 192 books across Jan/Mar/May/Jun × 4
sessions — structure holds everywhere, no calendar decay, session
is not a density axis; G10 ledgered (January stub parquets, ~27%
on Jan-15 — filter by event count). W4 books cached under
data/telonex-r2-w4/<day>/ (48 each; Jan stubs quarantined in
telonex-r2-w4-stubs/). Snapshots 5 (13:50Z) done; next ~15:30Z.
A39 (unit 8): b27bc932 fingerprint joined — four-wallet table in
edge-source-btc15m.md §addendum; edge signature = post-fill drift
(fill selection), not ladder depth; drift is now a first-class
sweep diagnostic (METRICS). W2 vol-regime residue superseded.
A40 (unit 9): D1 dip scan closed — current-era dips are sub-second
flickers (~$2.5/mkt, taker-taker arb dust); January had standing
discounts since repriced away. OPEN-QUESTIONS #10 resolved.
NOTE: session-8 journal stamps for units 2–8 drifted up to +1h
ahead again — git times are ground truth (units 1–9 ran
13:23–14:13Z real).

## Work queue — PHASE 2 (rebuilt 2026-07-17, session 5)

Phase 2 is open-ended: NO saturation clause, never create DONE. Research
object = the whole STRATEGY CLASS (sub-$1 UP+DOWN pair accumulation),
not gabagool-the-wallet. Prefer measurement units over reading units.

Queue (top = next):

1. ~~W0 variant atlas~~ **CORE DONE session 7**: all 9 era days
   scanned (A29 decoder fix, Apr–Jul re-scanned clean), classified
   (scripts/atlas-classify.ts), **VARIANT-ATLAS.md written** (era
   populations, design-axes map, dossier candidates ranked in §4).
   New dossiers: 0x04b6d7e9 (A30), livebreathevolatility (A31).
   Residue: §4 candidate dossiers (0x76d4d470, 0x13e0d447,
   0x2d8b401d regime-drifter case study, …); optional denser
   sampling (window-of-day effects).
2. ~~W1 failed-challenger post-mortem~~ **CLOSED session 7 (A26,
   reclassified)**: 0x95f5's −$542k was a WORLD CUP sports-MM blow-up
   (fifwc-* −$615k loss ledger); its crypto-updown life was $28k/day
   dust, near-breakeven. The class has NO known large-loss casualty.
   Dossier: wallets/95f5-challenger.md; BRIEF §8.2 corrected.
3. W2 deep parameter extraction on 0xb27bc932 (full history: ladder
   distributions per vol regime, requote cadence, capital curve,
   fee-era boundaries). PARTIAL (session 7): merge usage = TOGGLED
   module (A27, corrected same-session): ON ~Mar 7→Apr-28T14:27Z,
   OFF Apr 29–Jun 30, ON 2026-07-01T07:53:10Z; binary deploys,
   redeems continue, block merges p50 $50–110; live-shadow O2
   resolved. Life curve in dossier (first activity Mar 3, ramp Mar 18,
   May downtime windows). Full address (avoid A26-style typos):
   0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82.
4. W3 live shadowing (every ~1-2h real clock — CHECK `date -u`, the
   journal drifted; snapshots 1–4 done, latest 13:24Z Jul 17 (O7:
   US-morning regime — sub-$1 club empty, b27bc932 ran a btc-5m
   sleeve at 5x volume; watch if it persists); cumulative table in
   measurements/live-shadow.md; rename each raw JSON after the run,
   the script's bucket label collides). Watch O6: pair-cost regime
   drift intra-day; and whether b27bc932's merge era persists.
5. W4 scale D-measurements to thousands of markets / more months;
   month-by-month regime drift.
6. ~~W5 rebate economics per policy~~ **DONE session 7 (A28)**:
   rebate = 1.4%·(1−p) per $ maker notional (cheap-side ≈ 2× balanced);
   $1/day/market step at ~$143/$75 maker notional per market; sim
   rebate line ≈ 2× lower bound (D2); farmer postures dead cold-start.
   measurements/rebate-economics-per-policy.md; folded into BRIEF §6,
   H3, LAB-HANDOFF addendum. Residue: refresh if venue changes terms.
7. ~~W6 paper-EV~~ **DONE session 7**: measurements/paper-ev-seeds.md
   — per-seed EV bands with provenance, sim-reading rules (D2 2×
   lower bound, rebate step, tier-0 taker legs), sharpened kill
   lines; deep-pair cell promoted to primary target in LAB-HANDOFF.
   Refresh if atlas or venue terms move.
8. W7 terrain map beyond btc-15m (eth/sol/xrp 15m; btc 5m/1h/4h) —
   knowledge only, scope stays btc-15m.

Fold findings into BRIEF/HYPOTHESES/METRICS continuously; re-rank
LAB-HANDOFF seeds when the atlas surfaces stronger variants.

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
  formula change bracketed Mar 5→Apr 1 2026. Resolution DONE (A18);
  tick/min/rate-limits/stream-precision DONE (A19); payout mechanics +
  bulk-payout provenance DONE (A21). Open residue (low value):
  2026-exchange launch date, 1-pUSD marketable min primary source.
- C Wallet forensics: archetype DONE (two eras + Jan transition + D2),
  incumbent DONE, powerwinner DONE, bonereaper DONE (hybrid), 7-wallet
  decomposition DONE (gross-of-fee caveat A13), edge-source fingerprint
  DONE (A17); remaining: drfc4eybh7i8 re-resolution,
  badfallen/doggystyie/0xaaaaa dossiers optional.
- D Measurements: D3+D5 DONE (A20, window-lifecycle); D4 resolved by priors; **D2 DONE — worst_queue admits 44–49% of real fills,
  touch 64–68%; ~30-45% of archetype fills were taker completions**
  (measurements/d2-fill-reality-gap.md). Edge-source DONE (A17,
  measurements/edge-source-btc15m.md). D1 re-scoped (P38). Rebate
  provenance DONE (A21).
- E Synthesis: BRIEF/HYPOTHESES/METRICS current through A21.
