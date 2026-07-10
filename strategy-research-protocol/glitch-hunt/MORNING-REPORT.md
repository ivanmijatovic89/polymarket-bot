# Morning Report — Glitch Foundry

Written 2026-07-10 by the cartographer, after Phase 2 Round 7 (the
hygiene round). Assumes no context: this is the whole night in one file.

Status: 7 rounds completed (6 interrogation + 1 hygiene); 6 candidates
adjudicated, 6 kills/quarantines (scores 4, 31, 29, 18, 26, 8 /100);
mantis quota window 007-009 unopened at 0/3.
Coverage: census 2,000 episodes x 71 checkpoints (2025-10..2026-05);
holdout 17,126 episodes at t 0-60, t {300,450,600,690}, t 780-899; plus
a round-7 census re-extraction for the instrument autopsy. The resolved
universe is mapped at density everywhere a scan was worth running; the
census/holdout boundary — the only out-of-sample instrument — is spent.
Window/backoffs: none reported this round.

## The bottom line of the night

**Seven rounds, a census plus three extraction extensions, six candidate
kills/quarantines — and zero takeable glitches in the resolved universe.**
That is a strong result, not a weak one: every instrument is now
cross-validated (the round-7 autopsy cleared the extractor family
7,999/8,000 rows against an independent code path), every standing claim
is regime-stable (the round-7 audit found no K-004-shaped flip anywhere),
and every remaining discovery path is enumerated and gated on exactly two
operator actions. The map is trustworthy; nothing on it is tradeable
today; three locked pre-registrations are waiting for data that only you
can provide.

## OPERATOR ACTION ITEMS (ranked)

1. **Refresh `data/telonex/markets.parquet` outcomes to cover 2026-06
   and later.** Zero resolved rows exist after 2026-05 while 1,287
   episode files for 2026-06 alone sit unusable. This single refresh
   unlocks three gated pre-registrations — PR-002 (31/100, fires at
   ~month +3), PR-005's future-pocket arm (26/100), and the Q-006 retest
   (powered at month +1) — plus the K-004 reopen-check and, at ~month
   +5, the memorylessness family. The loop fires all of them
   automatically, in that order, from frozen specs (ATLAS.md standing
   gap map). No analysis workaround exists; it is a data-ingest task.
2. **One afternoon: check for trade prints inside the Nov-2025..Jan-2026
   frozen-book intervals (OL-002).** Highest value per hour on the map
   and fully prepped. Binary payoff: SILENCE inside the intervals
   certifies a +9.3c gross / +7.9c net historical glitch (n=100, 83
   independent runs, z=7.9) and activates PR-005's locked prereg; PRINTS
   quarantine every Nov–Jan stale row on the atlas — and that cleanup is
   a pre-computed lookup (`census/ol002_support.csv`), not a scramble.
   Start with the 67 neighbor-alive episodes (`census/
ol002_liveness.csv`); full spec in ATLAS.md OL-002. Independent of
   the data refresh.

## Engine-side leads (discretionary; no mission claim rides on them)

- **OL-001 (29/100) — the resting bid on the endgame favorite** stands
  +2.32/+2.52c under fair at t=897/899, 8/8 months, and the round-7
  regime audit made it the only claim that STRENGTHENED recently
  (+2.65/+2.90c, z up to 10.6, in 2026-03..2026-05). Round 7 also
  sharpened the mechanism: the asymmetric straddle (bid deep under fair,
  ask fair on the same book) exists NOWHERE in the mid-window — it is an
  expiry-only shape, exactly where the last-seconds dumpers of ~99%
  winners operate. Only the backtest engine's fill model can price the
  adverse selection (breakeven P(win|filled) 0.9813 vs standing 0.9899).
  Ready-to-spec maker baseline in ATLAS.md OL-001.
- **OL-003 — NOT FILED (a deliberate negative).** The round-7 scan of
  the mid-window standing-bid field found no OL-class margins: of 373
  cells at n >= 150, the 16 that show a margin over a fair ask all sit
  at z <= 1.1 (spread, not calibration), and the rest are the already-
  adjudicated round-6 noise field seen from the bid side. Map fact:
  **"mid-window standing-bid field: no OL-class margins."** Do not
  commission anything mid-window maker-side.

## The epistemic headline (what round 6 proved, and round 7 sealed)

The night's best-constructed claim — gates frozen three rounds before
the data existed, z=3.85 unique field maximum, 8/8 months, a
pre-registered concentration split, a failed adversarial kill-shot —
still REVERSED on the census slice reserved before discovery (−0.04c,
n=613, at better-than-declared power). Round 7's autopsy then cleared
the instruments: both extractor code paths read the disputed cell
identically to the digit, so the reversal was pure selection + sampling.
**Within-sample disjointness is not out-of-sample; the boundary reserved
before looking is the only instrument that has caught both of this
mission's ghosts — and the frozen verdict rule must match the discovery
selection (first-touch vs static moved the same episodes from +1.71c to
−0.04c).** Every future retest inherits this rule.

## Loop posture going forward: check-in cadence

Full-cadence rounds on 2025-10..2026-05 can only manufacture debt — both
samples and the boundary between them are consumed. From round 8 the
loop drops to slow check-ins: each wakeup it (1) checks the MISSION.md
kill-switch, (2) checks markets.parquet for resolved months > 2026-05,
(3) checks for OL-002 results, then appends one ledger line and ends.
When new resolved months land it fires the gated retests automatically —
month +1: regime recheck + Q-006 retest + PR-005 pocket detector;
month +2: K-004 reopen-check; month +3: PR-002; month +5: memorylessness
— all from frozen specs in the ATLAS.md standing gap map, no re-tuning,
no archaeology required.

## What is now trusted map (verified, cite-don't-re-derive)

- **Endgame takeable set is efficient** (E-001): 148 cells at t 780-899,
  mean edge −1.10c, hot cells exactly at the false-positive rate; fav
  96+ Wilson-95 UPPER bound negative before fee. Regime label: MIXED
  early / SUPPORTED late (one marginal early breach, z=−1.94).
- **Mid-window is fair or sub-friction everywhere measured** (C-001):
  371 ask cells at n >= 150, one full-stack survivor, reversed; round 7
  added the bid side — no OL-class margins there either. The region is
  closed from both sides of the book.
- **Four donation channels, all landing at resting quotes** (S-001):
  endgame lottery longshot buyers (−2.9 → −6.2c into expiry, 8/8 fresh
  months, regime-stable); last-second favorite dumpers (+2.3-2.5c to the
  resting bid, stronger late); early momentum chasers (−1.4..−2.2c,
  regime-dead since 2026-03); the t=15 open-skew level. Every taker
  route crosses a fair-or-worse quote (route duality, verified to the
  cent). S-001 is unbroken on fresh books after seven rounds.
- **Instruments are clean** (A-001 + round-7 autopsy): 2025-10/11 flips
  are regime, not staleness; the one true stale pocket (Nov→Jan endgame,
  peak 15.3% at t=897) is extinct since February and its adjudication is
  OL-002's afternoon; the extension-extractor family is cross-validated
  99.99% with the disputed cell identical on both code paths.
- **Standing claims are regime-stable** (A-002): no K-004-shaped flip in
  E-001, E-002, or OL-001 across early (2025-10..2026-02) vs late
  (2026-03..2026-05) recuts on fresh books.
- **t=0 skew is signal, not error** (T-001): the skewed-against side
  wins 43.7%, not 50% (n=5,315, z=−9.15). Never anchor fair value at
  0.50.

## Top dossiers (everything a human could act on, in expected-value order)

### 1. PR-002 — "memoryless t=15 book" (taker; locked prereg; 31/100; fires at refresh month +3)

- Invariant, both slices: holdout +3.89c gross (n=1,712); census
  subsample −0.98c (n=175); union +3.44c gross / +2.51c net (n=1,887,
  z=3.12), 6/6 months positive 2025-12..2026-05, placebo at zero.
- Mechanism: open skew is real information (T-001) that vanishes from
  the screen by t=15; the market charges ~0.59-0.60 for the 15s mover
  whether the open confirmed it (wins 63.2%) or contradicted it (54.3%).
  Nobody is paid to fix the level (S-001 instance 1).
- Glitch shape: taker-buy the skew-intact favorite at the t=15 ask.
- Locked rule (zero knobs): dog ask(t=0) <= 0.46 AND fav ask(t=15) >=
  fav ask(t=0) − 0.5c → buy fav at t=15 ask, hold. Fires iff, on >= 3
  post-2026-05 months: pooled gross >= +2c at n >= 350, placebo
  (0.48-0.50) within ±1c, contradicted movers <= 0.
- A 000-baseline would sweep (ONLY on fire + replication): fade
  tolerance −1c/0/+1c; skew threshold 0.44/0.46/0.48 (0.48 = built-in
  placebo).
- Biggest doubt: found on the cohort that produced round 1's phantom;
  its only sample-disjoint read is wrong-signed — and Q-006 just showed
  exactly how a package this shaped reverses.

### 2. OL-001 — endgame resting favorite bid (maker; engine-gated; 29/100)

- Invariant: two-sided fav bid at t=897/899 = 0.966/0.965 vs P(win)
  0.989/0.990 → +2.32/+2.52c standing margin, 8/8 months; regime audit:
  +1.97/+2.24c early, +2.65/+2.90c late (z 10.58/7.85) — the only claim
  that strengthened. The same books' ask side is fair, and round 7
  showed that asymmetry exists ONLY at expiry — it tracks the named
  donor (last-seconds dumpers of ~99% winners), not book geometry.
- The catch: the whole adverse-selection budget is 0.86c of win
  probability (breakeven P(win|filled) >= 0.9813); per-fill tail −96.6c
  vs +3.4c; fill-conditioned outcomes unobservable in book deltas; depth
  ~600-700 USDT top-3.
- Ready-to-spec baseline (hand to `modules/ProposeFamily.md` if you
  choose to spend an engine run): maker family — join the best bid on
  the two-sided endgame favorite (band 90-98) at t=870, one-shot, hold
  to settlement; sweep join-vs-improve and entry t in {840, 870, 885}.
  LESSONS priors listed in ATLAS.md OL-001.

### 3. PR-005 + OL-002 — frozen-book endgame favorite discount (taker; killed to a gated prereg; 26/100)

- Invariant: books frozen > 60s at t >= 885 with a standing 80-96c ask
  resolve to that token 97.0% at avg ask 87.75c → +9.3c gross / +7.9c
  net (n=100, 83 runs, z=7.9); mirror −9.9c; same cells fresh −2.3c;
  placebo at zero. Strongest raw number of the night.
- Why it is dead anyway: the pocket (Nov→Jan) is regime-extinct and the
  surviving artifact — a per-market subscription drop in the recorder —
  reproduces every number by construction. Book data cannot discharge
  it; the recorder was provably dying per-market all around the pocket
  (73/93 predecessor files).
- What resolves it: OL-002 (action item 2) — one afternoon, either
  branch decisive. The locked future-pocket prereg is valid ONLY
  alongside its feed-integrity gate.

### 4. Q-006 — mid-window favorite discount (quarantined; 8/100; a lesson, not a lead)

- Discovery: fav ask 82-86c at t=300 read +3.62c on the holdout
  (n=1,271, z=3.85, 8/8 months). Reserved census slice: −0.04c (n=613),
  structure inverted. Round-7 autopsy: both extractor code paths read
  the disputed cell identically (n=156, +1.705c, z=0.597) — the
  reversal is selection + sampling, the instruments are innocent, and
  the boundary rule is vindicated.
- Retest is locked to post-refresh months (frozen first-touch rule, in
  ATLAS.md Q-006; powered at month +1). Do not trade it; do not re-mine
  it.

There is no fifth dossier worth a human's morning; everything else on
the map is a verified negative, a completed audit, or a gated reopening.

## Do not bother (the three most instructive kills of the night)

1. **Trusting within-sample corroboration (Q-006).** Disjoint-looking
   arms computed inside the discovery sample — mirror tokens, month
   vectors, adjacent-t probes — all inherit its selection; the claim
   survived every one of them and reversed on the boundary reserved
   before discovery. Reserve the boundary first; freeze the selection
   RULE (first-touch vs static), not just thresholds.
2. **Trusting recorded books because the statistics are strong
   (PR-005).** A +9.3c edge reproduced to the digit at z=7.9 certifies
   the recording, not the exchange; a per-market feed drop manufactures
   exactly those numbers, and a backtest would confirm them by
   construction. When book age is the treatment, feed integrity is the
   hypothesis.
3. **Chasing (or fading) the previous window's winner (K-004).**
   Momentum buyers really overpay 1.4-2.2c and you still cannot collect:
   buy-the-complement-at-ask IS sell-the-winner-at-bid — one door, and
   the mispricing is smaller than the spread it must cross. Sub-spread
   mispricings are maker revenue (S-001).

## Suggested next protocol step

Nothing scored >= 70; nothing is READY FOR PROTOCOL — under the mission
bar, do NOT start a family on tonight's evidence. In expected-value
order:

1. Today, no new data: OL-002 (action item 2). Prep is complete; either
   branch is decisive.
2. After the markets.parquet refresh: let the loop run the frozen
   on-refresh sequence (it needs no instruction). If PR-002 fires and
   then REPLICATES on further disjoint months, propose the family —
   working name **skew-intact favorite (t=15 taker entry)**; the
   baseline question for `modules/ProposeFamily.md`: "does taker-buying
   the favorite at the t=15 ask, gated on dog ask(t=0) <= 0.46 and an
   intact skew (fav ask(t=15) >= fav ask(t=0) − 0.5c), clear measured
   fees and depth-walk slippage at 300-USDT clips, with the 0.48-0.50
   skew band as built-in placebo?"
3. At your discretion, engine-side: OL-001's maker baseline (dossier 2)
   — the fill model is the only instrument that can answer it, and the
   round-7 audit just strengthened its prior.
