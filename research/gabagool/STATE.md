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

### Session-11 digest (2026-07-17 16:40Z→, live)

Unit 1 (16:57Z): A58 — session-drift decomposition
(measurements/session-drift-b27bc932.md). b27bc932's ladder is
session-INVARIANT (8 weekday cells, Jun-10/12/13); deep-class
post-fill drift flips sign by session: weekday overnight/evening
favorable (+0.4→+1.5c @60s), US adverse (−0.3→−0.4c, 2/2) → A49
session split = flow toxicity on identical quotes. Saturday evening
flipped adverse (n=1) → OPEN-QUESTIONS #7: weekday/weekend
stratification (cheap, dow filter on existing pulls). G10 corrected:
stubs NOT January-only (Jun-13 overnight all 16KB stubs — screen by
size any day). Bycatch: Mar-16 100% btc-5m → 15m sleeve start
bracketed Mar-17→25. Books cached: telonex-r2-jun12sess/,
telonex-r2-jun13/ (evening valid, overnight stubs).

Unit 2 (17:06Z): A59 — OQ #7 CLOSED same session
(session-split-vol-b27bc932.md §A59; script gained --dow; fresh
Jul-11/12 weekend pull, 574 mkts current era). The A49 session map
is WEEKDAY-only: weekday evening +1.74% (positive all vol
terciles), weekday US −1.58%; weekends restructure (no robust
cell; US +0.59% storm-driven only) and the favorite-lean collapses
(excessWon 40–51%, weekend calm 20–27%). v1 envelope = weekday
20–24Z; weekends idle or lean-disabled; never pool dow in metrics.

Queue for successor (in order): (1) W3 evening snapshot ~20–21Z —
club re-formation test (A49 evening-positive), tracks profile-less
pair (expect 13e0d447 sub-$1); morning snapshot tomorrow settles
OQ #5 residue; rerun lineage-sweep.ts if any active went dark.
(2) W7 terrain refresh with era-matched fee constants (A52) —
activity-API only for 5m/1h (G11). (3) Residue: 13e0d447
early-June 15m sleeve (minor); b27bc932 Jul-01 merge-ON cause
(operator-internal, likely dead end). (4) New measurable: A59
weekend read is n=4 days — extend with more weekends if a unit
frees up (cheap: pull-activity + session-split-vol --dow).

### Session-10 FINAL (15:27–16:35Z real; units 1–11; A51–A57, O10, G11)

All-measurement session. A51: venue-wide v1→v2 HARD cutover Apr-28
~11:02Z (first fill Apr-3 was a smoke test; v2 = ALL books; OQ #4
closed; tenderly RPC is the getLogs workhorse — drpc caps ~100
blocks). A52: fee history pinned — reshape Mar-29/31 (with v2
release train, NOT the cutover, which was fee-neutral), launch
k=0.072 ($1.80/100sh) quietly trimmed to 0.070 May 6–10; curve
uniform across books (btc-15m/eth-5m both 0.0700); era-matched
constants in VENUE-MECHANICS; A49 margin decay gains a fee-step
confound. A53: b27bc932's 15m sleeve = 1-week trial under 0.072
then one-day kill (Apr-08→09); May trim didn't revive it; back
~May-27 with the tier launch → btc-15m taker-completion negative
at tier-0, maker-weight is the viability lever. A54: 5m series
launched Dec-18 (fee-free→Mar-06); drfc dud; gabagool22→guh123
succession at 6m51s. A55: lineage sweep — 52483137→PurpleThunder
rotation (−78min); top earners ≈ 3 multi-wallet operators; two
actives are PROFILE-LESS. A56: Jul-01 merge toggle operator-only
(13e0d447 flipped opposite same day). A57: 13e0d447 dossier —
strongest living wallet ($3.2k/day blended, maker-pure cold-start,
pairCost 0.976 overnight, btc-5m only, now in live-shadow). O10:
snapshot 7 — sub-$1 club EMPTY in US storm (A49 live-confirmed).
G11: NO btc-5m book data exists (telonex 0 conversions) — the
strongest wallet + most meta volume are book-level unstudyable;
scope-decision input for W7.

Successor queue (in order): (1) W3 evening snapshot ~20–21Z — club
re-formation test (A49 evening-positive), now tracks the
profile-less pair (expect 13e0d447 sub-$1); morning snapshot
tomorrow settles OQ #5 residue; rerun lineage-sweep.ts if any
active went dark. (2) 04b6d7e9 overnight-stretch repeat (A34
residue; btc-15m telonex books EXIST — 423 eligible Jun-10–14,
some cached in data/telonex-r2-w4/). (3) W7 terrain refresh with
era-matched fee constants (A52) — activity-API only for 5m/1h (G11).
(4) Residue: 13e0d447 early-June 15m sleeve (minor), b27bc932
Jul-01 merge-ON cause (operator-internal, likely dead end).

### Session-10 digest (2026-07-17 15:27Z→, live)

Unit 1 (15:27–16:10Z): OQ #4 CLOSED — A51
(measurements/first-fill-2026-exchange.md; predecessor's stranded
script recovered + run, plus scripts/bisect-cutover.ts). First fill
on 0xe111…996b was 2026-04-03T12:52:59Z — a 2-wallet $38 smoke test
on novelty books; then 3.5 weeks of test trickle; then venue-wide
HARD cutover 2026-04-28 ~11:01–11:03Z (v1 58.7k fills/15m → 0 in
one window; no dual-running; v2 reloaded over hours). v2 = ALL
Polymarket books (corrects "crypto-only" read); receipt forensics
switch decoders at that timestamp. b27bc932 merge-OFF (A27,
Apr-28T14:27Z) = 3.4h post-cutover → dossier's "no venue event"
line corrected. RPC lesson: drpc free getLogs caps ~100-200 blocks;
polygon.gateway.tenderly.co takes 50k-result ranges (both scripts
accept --rpc). NEW residue (medium value): does the fee-curve
reshape date exactly to the Apr-28 cutover? (receipts Apr-27 vs
Apr-29, measure-onchain-fees.ts pattern).

Unit 2 (15:52Z): W3 snapshot 7 (O10) — sub-$1 club EMPTY at full
volume for the first time (all pair costs ≥1.0075; b55f blew out to
1.0496, its worst print, pairRate 0.647); late-US storm regime =
A49's US-worst rule live. b27bc932 btc-5m sleeve 4th consecutive
window, merge module ON (169). ~$410k/2h tracked flow — everyone
still buying through the bad hour.

Unit 3 (16:07Z): fee-curve history pinned — A52
(measurements/fee-curve-history.md; scripts/fee-curve-probe.ts).
14 receipt windows Mar-25→Jul-15: reshape rolled out Mar-29/30
(gradual per-order mixing), complete Mar-31 12Z = one release train
with v2 deploy; Apr-28 cutover FEE-NEUTRAL (refutes unit-1
residue); launch k=0.072 (published, peak $1.80/100sh) quietly
trimmed to 0.070 May 6–10. Knock-ons: A49 margin decay has a 2.3×
fee-step confound (March ≠ current era on competition alone); A50
15m-sleeve-OFF gains the reshape as causal candidate → sleeve
boundary bisection PROMOTED from low-value residue. Era-matched fee
constants in VENUE-MECHANICS.

Unit 4 (16:13Z): sleeve toggle dated — A53
(measurements/sleeve-toggle-b27bc932.md; 17-day 12–14Z probe
ladder). OFF is two-phase: rollout pause Mar-30/31, then ~1-week
FULL-cadence evaluation under 0.072 (Apr-02→08), one-day shutdown
Apr-08→09; May trim did NOT revive (May-13 off); revived ~May-27
(redeploy, one day before May-28 tier launch). btc-15m
taker-completion flipped sign at 0.072; viable today only with tier
refunds → lab candidates must budget full 0.07 on taker legs
(maker-weight is the viability lever). OQ #2 residue closed.
Folded: dossier, PRIORS A53, BRIEF, OQ.

Unit 5 (16:20Z): residue close-outs — A54
(measurements/residue-closeouts-session10.md). btc-5m launched
2025-12-18T05:00Z midnight-ET (fee-free until Mar-06 → no 5m
farmer meta possible before then; Gamma /markets/slug/ PATH form,
?slug= query form lies). drfc = 0x096924c4… confirmed, ZERO
lifetime activity — dud, closed. Twins: 961afce6↔93c22116 NOT
profile-linked (20d); **gabagool22→guh123 succession CONFIRMED**
(guh123 profile created 6m51s after gabagool22's last trade) —
quit-at-peak partly identity rotation, dossiers = operator
sleeves. OQ #6 fully closed.

Unit 6 (16:24Z): lineage sweep — A55
(measurements/lineage-sweep.md; scripts/lineage-sweep.ts, rerunnable
whenever an active goes dark). Rotation #2:
52483137→PurpleThunder (registered 78min BEFORE final trade, 2wks
parallel — consolidation; rewrites A43's "first exit was
competition quit"). Top earners ≈ 3 multi-wallet operators; 8
wallet exits ≤ 6 operator exits. Caveats: createdAt = username
registration (lags first trade); 13e0d447/76d4d470 are
PROFILE-LESS actives (rotations into such wallets invisible).
Day-scale suggestives (bonereaper +21h / 04b6d7e9 +29h after
guh123 exit) recorded, not counted.

Unit 7 (16:26Z, small): fee-curve uniformity — current 0.070 curve
identical on btc-15m (lab scope) and eth-5m (both 0.0700 exact;
fee-curve-history.md addendum; fee-curve-probe.ts gained --prefix).

Unit 8 (16:28Z, small): Jul-01 merge-ON is operator-specific — A56
(10-wallet MERGE/day scan Jun-25→Jul-05: 7 never merge, no
coordinated change; 13e0d447 STOPPED same day, opposite direction —
recorded unexplained). Merge posture = per-operator style axis.

Unit 9 (16:32Z): 13e0d447 dossier — A57 (wallets/13e0d447.md). The
profile-less cold-start is now the STRONGEST living wallet:
~$3.2k/day blended 7d (lb $2.14k + rebates $1.13k), ≈$124k in 5.5
weeks; btc-5m only, maker-pure, pairCost 0.9761 overnight/0.9978
US (deepest current-era sub-$1); overnight-tilted 1.6× — the two
living leaders split the clock (13e0d447 off-hours vs 04b6d7e9
business hours). live-shadow.ts now tracks both profile-less
wallets (13e0d447, 76d4d470). BRIEF genealogy re-ranked.

Unit 10 (16:33Z, small): 13e0d447 June check — 5m-only from at
least Jun-20 (both sessions); "5m/15m" tag was early-June at most;
Jun-13 US window fully dark (early schedule gaps). Dossier residue
now only the telonex ladder join (must use Jun-10–14, G9 bound).

Queue after unit 10: (1) W3 evening snapshot ~20–21Z (club
re-formation test; now includes the profile-less pair — expect
13e0d447 sub-$1 while others aren't; morning snapshot tomorrow
settles OQ #5 residue). (2) Measurable candidates: 13e0d447
ladder-offset telonex join on a Jun-10–14 day (extends A57; books
on disk under data/telonex-r2-w4/ may already cover it); 04b6d7e9
overnight-stretch repeat (A34 residue); W7 terrain refresh with
era-matched fee constants. Session 10 ran units 1–10 (A51–A57,
snapshot 7/O10); all API/receipt measurements — no engine runs, no
src/ touches.

### Session-9 digest (2026-07-17 14:50Z→, live)

Unit 1: b27bc932 dossier era amendment DONE (O7–O9 folded; mid-July
btc-5m-first US-session sleeve at farmer economics, June profile
era-bound; OQ #5 closed — residue: next-day MORNING snapshot decides
schedule-vs-expansion).

Unit 2 (15:04Z): OQ #2 CLOSED — A49 + A50
(measurements/session-split-vol-b27bc932.md; scripts
fetch-binance-1m.ts + session-split-vol.ts committed). A49: session
rule holds at month scale 3/3 (478 mkts Mar/Jun/Jul); current era:
US −1.05% (bleed, concentrated US×storm −1.43%), evening +1.65%
(ONLY robust positive — v1 grinder should run 20–24Z first);
realized-vol tercile = session proxy, never gate on vol alone;
margin decay +1.9% (Mar-25) → ≈0% (Jun→), losers 16%→~50%. A50:
b27bc932 was ALWAYS btc-5m-first (Mar-25 75%; Apr-15/May-13 100%
btc-5m, ZERO 15m — sleeve toggled OFF mid-Apr→May); corrects
A45/A46 "May downtime" reads; unit-1's "expansion" recast as
lifelong norm; merge counts re-confirm A27 eras. Folded into
BRIEF (session block), METRICS (2 rows), dossier (A50 section),
OPEN-QUESTIONS (#2 closed, #5 recast).

Queue now: (1) W3 snapshot ~16:15Z+ (last was 14:47Z; morning
snapshot tomorrow settles OQ #5 residue); (2) OQ #4
first-OrderFilled/migration on 2026 exchange; (3) low-value residue
(drfc re-resolution, 5m launch pin, twin-link checks, 15m-sleeve
toggle boundary bisection).

### Session-8 FINAL (13:23–14:50Z real; A34–A48, O7–O9, G10; 20 units)

Additions after the mid-session summary below: A44/A45 (entry gate
found + validated: habitat separation robust, 10s falling-ask veto
robust 3/3, 30s directional rule flips by day — sweep it), A46 (A36
session ordering replicates 2/2; grinder gross-negative days
normal), A47 (endgame flip table at scale: 0.99+ never flips 0/393;
mid-band flips 30–40%; A34 lean = base rate), A48 (pairing clock
~1 min, timeouts 60–300s), LAB-HANDOFF session-8 addendum (the
build-ordered mechanism spec — READ THIS FIRST for the lab view).
W4 is now FULLY covered (density A38, session A46, endgame A47,
pairing A48). Snapshot 6 (14:47Z, O9): b27bc932 btc-5m sleeve
persists 3rd window — DOSSIER ERA AMENDMENT PENDING (next session:
add mid-July btc-5m expansion era to wallets/b27bc932.md).

Next-session queue (in order): (1) W3 snapshot ~every 1–2h + fold
O7–O9 era amendment into b27bc932 dossier; (2) OQ #2 remainder —
month-scale session split with realized-vol covariate; (3) OQ #4
first-OrderFilled/migration on the 2026 exchange; (4) low-value
residue (drfc re-resolution, 5m launch pin, twin-link checks).
Data on disk: 209 clean books (telonex-r2 + telonex-r2-w4/<day>),
activity pulls for both key wallets on Jun-12-14/May-13/Jun-10.

### Session-8 mid-session summary (superseded by FINAL above)

The big session-8 arc: (1) MECHANISM — the two living recipes are
the two local optima of the (offset × requote) surface (A37/A38:
fast+shallow vs slow+deep; rebate step reachable maker-only); the
edge WITHIN a recipe is fill selection, visible as post-fill drift
(A39); the day divides between recipes (A35 business-hours winner /
A36 grinder bleeds US session); dips are flickers now, passive
capture only (A40). (2) HISTORY — full winner genealogy done:
PurpleThunder #2 all-time $854k (A43), January pool harvesters
$381k+$383k (A42, A40), guh123 sprint $6.5k/day (A41); per-operator
ceiling compressed 5× over 8 months ($14k→$2.75k/day); quit-at-peak
n=8, no winner ever bled out; fee shocks open brief rich windows.
NEW top question: what book-state predicts the favorable-drift
fills (OPEN-QUESTIONS #1). Successors: run W3 snapshot ~every 1-2h
(CHECK date -u — session-8 stamps drifted +1h again), then attack
OQ #1.

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
A41 (unit 10): guh123 dossier — 33-day sprint at $6.5k/day trading
(fastest documented), quit-at-peak n=4, started as gabagool22
exited; fee shocks = opportunity windows (pairs with A40 January).
NOTE: session-8 journal stamps for units 2–8 drifted up to +1h
ahead again — git times are ground truth (units 1–10 ran
13:23–14:16Z real).

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
