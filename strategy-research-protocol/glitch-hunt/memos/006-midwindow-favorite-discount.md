# Anomaly Memo 006 — Mid-window favorite discount (fav ask 82–86c, t=300)

gabagool, Foundry Phase 2 Round 6 — 2026-07-10. Adjudication of the round-6
frozen-gate-stack survivor. Quota state: window 004–006 at 0/3, one SURVIVES
available, this is the window's last memo.

Integrity trail: gates frozen round 3 (before any mid-window data existed),
mantis-affirmed clean round 5, run by the surveyor with zero interpretation
(`census/round6_probe.sql` → `census/round6_gatestack_cells.csv`, mtime
08:25:26). My adjudication probes were pre-registered in
`census/round6_prereg.md` (birth = mtime 08:33:53) BEFORE the probe file
(`census/round6_gabagool_probe.sql`, 08:34:18) was written or run. The
census 2,000-episode sample was NOT touched — it is the replication reserve
(see §7).

## 0. Verdict of the adjudication, stated upfront

**The lone gated cell is statistically worthless on its own — and I prove
that below with the null arithmetic (§2). The candidate survives anyway,
as a REGION claim, because the pre-registered adjudication probes returned
structure the single-cell gates could not see: token-symmetric replication
on disjoint episode arms, 8/8 pooled months positive, and total
concentration of the effect in one-tick-spread books (the S-001 label is
refuted by measurement, not argument).**

## 1. Invariant (the measured fact)

Source: `census/midwindow_checkpoints.parquet` — all 17,126 holdout
episodes, t ∈ {300,450,600,690}, self-check 1.72% raw / 0.66% hard, the
cleanest extraction of the night. Two-sided mass at t=300 is 99.6%
(`midwindow_taxonomy.csv`) — no E-001-style survival-conditioning issue.

**Gated survivor (surveyor's scan, cite-not-rederive):** UP token, t=300,
ask band 82: n=324, avg ask 82.52c, P(win) 87.04%, dev **+4.51c**, friction
at the cell (census map, frozen convention p25 spread + 156bps×ask) 2.29c →
margin **+2.22c**; dev − p50 FULL spread = +3.51c; z=2.42; 7/8 months;
flanks +0.65c (b80, n=376) / +4.03c (b84, n=322); med top-3 take depth 869
shares; n_stale = 0, fresh-book dev identical.

**Region R (pre-registered in round6_prereg.md §Region):** t=300, both
tokens, two-sided, favorite ask ∈ [0.82, 0.86). The four (token × band)
cells are DISJOINT episode sets. Probe G1 (pre-registered):

| arm                | n     | P(win) | avg ask | dev        | z        |
| ------------------ | ----- | ------ | ------- | ---------- | -------- |
| UP (bands 82+84)   | 646   | 0.8777 | 0.8350  | **+4.27c** | 3.31     |
| DOWN (bands 82+84) | 625   | 0.8640 | 0.8345  | **+2.95c** | 2.15     |
| POOLED             | 1,271 | 0.8710 | 0.8347  | **+3.62c** | **3.85** |

The DOWN arm is episodes where DOWN is the favorite — zero episode overlap
with the UP survivor. It cleared the pre-declared ≥ +1.5c corroboration bar
AND the region friction bar (+2.95 vs 2.3c) on its own. The effect is not
UP-specific.

**Pooled monthly (G1b), 2025-10 → 2026-05:**
+6.76 / +2.58 / +3.25 / +0.97 / +1.43 / +6.70 / +4.99 / +4.83c —
**8/8 months sign-positive**, first claim of the night to beat A-001's
6/8 honest ceiling. The survivor cell's "negative month" (2026-02, −3.40c
at UP-b82 alone) was band-slicing noise: UP pooled over b82+84 in 2026-02
is +4.10c, region-pooled +1.43c. Pre-declared G3 rule: 2026-02 sits
0.79 month-SEs from the pooled effect, 2026-01 1.01 — both within noise of
a constant effect. Caveat kept honest: those two months (+0.97, +1.43) are
inside the 1.30c fee — sign-consistency is 8/8, fee-clearing is 6/8.
Recent regime is the STRONG end (+6.70/+4.99/+4.83 for 03/04/05) — the
opposite of K-004's regime-death shape.

**Robustness already in hand:** n_stale = 0 in the survivor cell (no A-001
exposure; t=300 is not the 2026-01 endgame pocket). Dropping distrusted
2025-10 entirely: pooled dev (3.62×1271 − 6.76×84)/1187 = **+3.40c**,
z = 3.48, 7/7 months — the claim does not lean on the noisy month.

**The S-001 discriminator (G2, pre-registered with a kill rule attached):**
split R by favorite spread. One-tick books (spread ≤ 1.1c): n=997,
dev **+4.49c, z=4.36**. Wider books: n=274, dev +0.46c, z=0.21. The effect
lives ENTIRELY in one-tick books. Had it lived in wide books I was bound to
label it maker-sink and file a negative memo. Instead: the MID itself is
miscalibrated; a taker crossing a one-cent spread captures the deviation.
This is measured escape from the resting-quote sink, the first takeable one
on fair books this mission has found (PR-005's exemption was a suspect
fossil quote; these books are fresh, tight, and actively quoted).

**The dog-side mirror (same books, other token, from the published dump):**
dog asks at t=300 bands 16–18 are overpriced −5.39/−2.73c (UP dog) and
−5.58/−6.35c (DOWN dog) — the identical fact seen from the token the
lottery buyer holds.

**Cross-t decay (descriptive arithmetic on published cells, per prereg not
an independent confirmation):** R-pooled dev by t: **+3.62c (t=300) →
+2.73c (t=450, n=1,444) → +0.13c (t=600, n=1,283) → −0.83c (t=690,
n=1,004)** → endgame fair-to-negative (E-001). The mispricing decays
monotonically to efficiency as resolution approaches. This is exactly the
shape the mechanism in §3 predicts, and it makes the region claim cohere
with the existing verified map instead of contradicting it.

## 2. Comparison debt — the arithmetic, honestly (pre-registered G4)

371 token-cells at n ≥ 150 were scanned; 38 passed gate 1; 5 passed
adjacency; 1 passed everything.

Under H0 "every ask is fair" (p_true = avg ask per cell, thresholds =
each cell's own friction bar):

- Expected gate-1 passers: **77.6** vs 38 observed — the field is
  negative-shifted (asks sit above fair by spread-geometry, S-001's
  signature), so gate-1 passage is RARER than chance would produce.
- Expected cells with z ≥ 2.42: **2.9** (exact normal tail; the logistic
  approximation declared in the prereg gives 5.9 — it overstates this tail
  ~2x, both numbers on the record).
- Expected FULL-stack false survivors: **2.8 to 8.7** (bracket per prereg:
  flank-sign ¼; month gate between unconditional 0.145 and
  conditional-at-threshold ~0.45). Mirror-token correlation (~371
  token-cells ≈ ~2x-counted books) halves these: ~1.4–4.4.

**Conclusion I am bound to state: 1 observed full-stack survivor vs ≳1.4
expected under the null. The lone cell z=2.42 carries approximately zero
evidential weight. Memo 001's ghost (z=2.41, single cell, reversed on
holdout) would have been repeated here if the adjudication had stopped at
the gate output.**

Why the case survives its own debt arithmetic — the pooled region:

- The pooled z=3.85 has one-sided p ≈ 5.9e-5. The candidate space of
  token-pooled adjacent-band-pair regions in this scan is ~188 (≈47
  overlapping band-pairs × 4 t). Expected regions at z ≥ 3.85 under H0:
  **~0.011**; inflated 10x for boundary freedom (pair vs single vs triple,
  which flank to include): **≤ ~0.1**. Observed: 1.
- The one-tick stratum inside R: z=4.36 (p ≈ 6e-6) on a pre-registered
  split whose OTHER outcome was pre-committed to kill the memo.
- The DOWN arm alone (z=2.15) was never selected by any gate — it is the
  token mirror demanded by symmetry, on disjoint episodes.

The lone cell is noise-level; the region is not. The claim of this memo is
the region.

## 3. Mechanism — who donates, and why nobody corrects it

**Donor: mid-window counter-trend lottery buyers of the 14–18c dog.** After
a decisive first-five-minutes move (favorite 50 → 82–86c), reversion-hope
flow taker-buys the dog at 14–18c. Measured, not asserted: dog asks at
t=300 in bands 16–18 resolve 5–6c below price (both tokens, §1), the same
longshot-lottery donation channel E-002 verified at endgame (−2.9→−6.2c at
t≥885) — this is its mid-window expression, seen earlier and larger, on
99.6%-two-sided books. The lottery demand presses the dog ask; by the
one-tick mirror (fav ask = 1.01 − dog... route duality, K-004) the favorite
ask sits ~4c under its measured 87% frequency.

**Why it persists (why nobody lifts the favorite ask to fair):** the
corrector must taker-buy an 83.5c binary and hold ~10 minutes of BTC vol
with a measured 12.9% total-loss frequency, for +2.3c net per share
(§4) — ~$19 of expected profit per median top-3 fill (~$800). At endgame
the same correction is near-riskless (seconds of exposure) and E-001 shows
arbs DO hold the fav ask at fair there; at t=300 the risk-holding cost is
real and the absolute prize is beneath professional table stakes — S-001's
own attention-follows-prize logic, operating on time-to-resolution instead
of quote type. The measured cross-t decay (+3.62 → +2.73 → +0.13 → −0.83c)
is this mechanism's fingerprint: the discount dies exactly as the
correction risk dies.

G2 sharpens WHO is wrong: wide-spread (uncertainty-priced) books are FAIR
(+0.46c); one-tick, confidently-quoted books carry the whole error. Makers
are present and aggressive — they are quoting a miscalibrated consensus
level, not withdrawing. Anchoring on the post-move price as "the" fair
level, with the lottery flow subsidizing the anchor.

Confessed mechanism gap: the band boundaries (82 in, 80 and 86+ out) are
measured, not derived — the mechanism does not predict sharp edges, and
fav bands 56–66 at the same t lean the OTHER way (overpriced) in the dump,
which "chasers overpay early, lottery sellers underprice late" can
rationalize but was not pre-registered. The boundary story is the weakest
link in the mechanism component.

## 4. Glitch shape and loss tail (mandatory)

- Entry: taker-buy the favorite at its standing ask when two-sided, fav ask
  ∈ [0.82, 0.86), t = 300s. One-tick spread in 78% of fires; dev is
  measured VS THE ASK, so the only additional friction is the 156bps fee
  (1.30c at 83.5c) plus depth-walk beyond top-of-book (unpriced here —
  aggregates only, same limitation PR-002 carried).
- Exit: none — hold 10 minutes to settlement. No churn, no take-profit leg
  (LESSONS: one-shot take-profit adds churn without removing tail).
- Net at pooled point estimate: +3.62 − 1.30 = **+2.32c/share** (frozen
  conservative convention charging p25 spread as well: +1.32c pooled,
  +2.22c at the gated cell).
- **Loss tail:** structurally bounded at the stake by construction (binary,
  fully collateralized, no path dependence, no liquidation): −83.5c/share
  against +16.5c, loss frequency 12.9% pooled, worst month 15.7%
  (2026-01). This is a high-win-rate payoff shape and I price it as such:
  the entire edge is the frequency measurement — if true P(win) is 83.5%
  rather than 87.1%, the edge is exactly zero. No measured month is
  pooled-negative gross; after fee, 2026-01 is −0.33c net — the strategy
  as measured had ~1 net-losing month in 8. Loss months cluster with chop
  regimes (2026-01/02); a replicator or engine run must expect losing
  streaks at 13%/fire, ~5.3 fires/day.

## 5. Capacity

`friction_map_midwindow.csv`, t=300: band 82 med top-3 ask depth 956 sh
(p25 552), band 84 med 1,078 (p25 635) → ~**$800 median top-3 per fire**
at 83.5c ($460–530 at p25). Incidence 1,271 episodes / 8 months ≈ **5.3
fires/day** → ~$4.2k/day aggregate at median depth. Under the 3–4k
per-fire bar (~0.2–0.25x); depth-walk for a full clip unpriced (per-level
prices not in this extraction — same gap that capped PR-002 at 2/10).
Honest capacity: operator-scale supplement, not a table-stakes strategy,
unless the engine shows the book refills within the entry window.

## 6. Falsifiable claim + 000-baseline

**Falsifiable claim (one sentence, re-measurable on any disjoint episode
set):** two-sided books at t≈300 with favorite ask in [0.82, 0.86) resolve
to the favorite at a frequency exceeding ask + 1.5c (point estimate +3.6c,
n=1,271), token-symmetrically, with the deviation concentrated in
one-tick-spread books; fails if pooled dev ≤ 0 or if the one-tick stratum
falls inside fee.

**000-baseline a human could spec (family: midwindow-favorite-discount):**
taker-buy the favorite at ask when two-sided AND fav ask ∈ [0.82, 0.86) at
t=300; hold to settlement; sweep entry t ∈ {240, 300, 360, 450}; band
edges frozen. The engine's measured fees and depth-walk adjudicate the
+2.32c/share net prior. LESSONS priors to carry: high-win-rate payoff
shape; entry-time response must be a plateau (the measured +3.62 → +2.73c
across t=300→450 says it should be), not a spike.

## 7. Replication path (what is NOT consumed)

Everything above lives in the holdout. The **census 2,000-episode sample
is disjoint from the holdout by construction** (holdout manifest = all
resolved episodes NOT in the census sample) and carries the full 15s grid
around t=300. I did not touch it (prereg, declared reserve).

- Expected in-region n at t=300 exactly: 7.42% incidence × 2,000 ≈ 148;
  first-touch over t ∈ [240, 360] (9 grid points, K-001 episode-dedupe)
  plausibly 200–300.
- Power arithmetic (M-003 discipline, stated before the replicator runs):
  at true +3.6c, expected z ≈ 1.3 at n=148, ≈ 1.7 at n=250; z=2 rejection
  of zero needs n ≈ 350. **The replication is direction-and-magnitude
  powered as a point-estimate test, not a standalone z≥2 test.** Suggested
  pre-declared rule for the replicator (theirs to freeze, not mine):
  REPLICATED if pooled first-touch dev ≥ +2c with one-tick stratum
  positive; WEAKENED if dev ∈ (0, +2c); REVERSED if ≤ 0.
- Footnote for honesty: census aggregates for these cells technically
  exist on disk since round 1 (`calibration.csv`, n≈16–40/cell — C-001
  ruled the region unmeasurable at that density and nobody ever cited
  them). The replicator should re-derive from `checkpoints.parquet` with
  its own script per its contract; episode-level disjointness is what
  makes it a replication, and that holds.

This is the material difference from every prior kill: PR-002, K-004, and
PR-005 all died partly because NOTHING disjoint existed to replicate on.
Here a disjoint slice exists, is reserved, and is powered for a
point-estimate verdict.

## 8. How this differs from memo 001's ghost (required comparison)

Q-001: z=2.41, single census cell (n=560), gates invented around an
observed hot spot, mechanism resting on a false anchor (T-001), reversed
at 9.5x on holdout. Here: (i) the cell was found ON the full holdout —
there is no larger sample for it to reverse on at these t; the 9.5x
amplification that killed Q-001 is the sample this was FOUND in; (ii) the
gates predate the data by three rounds (prospecting, not mining) and their
author was the surveyor, not me; (iii) the corroborating structure —
token-mirror arm on disjoint episodes, 8/8 pooled months, one-tick
concentration — was pre-registered with kill rules attached, and one probe
(G4) came back AGAINST the lone cell and is printed above; (iv) the
mechanism's fair-value side is measured frequency vs standing ask, no
anchor assumption anywhere (T-001 clean); (v) Q-001's positives were
carried by two sparse months — here the recent three months are the
strongest and the claim survives deleting the worst-instrumented month.
What remains genuinely shared with Q-001 and cannot be argued away: no
disjoint-MONTH test is possible until the markets.parquet refresh —
disjoint-episode replication (§7) is the only currency, and I priced its
power honestly.

## 9. Confession (single most likely artifact path)

**Region-boundary selection.** Bands 82–84 in, 80 and 86 out — chosen
after seeing the dump's signs, exactly the freedom my 10x debt inflation
in §2 only roughly bounds. If the truth is a diffuse ~+1–2c favorite bias
smeared over bands 78–90, boundary-tuning on this sample would concentrate
it into the quoted +3.62c, and a disjoint sample would come back at
+1–2c — sign-right but WEAKENED, inside or near friction. The G2 one-tick
split and the DOWN arm make a pure-noise story expensive (they were
pre-registered and could have killed), but they share the same episodes as
the boundary choice, so they discount tuning less than a fresh sample
would. Second-place artifact: single-instrument dependence — one
extractor, 0.66% hard self-check; mitigated (n_stale=0, mirror invariant
0/130k violations, survives dropping 2025-10, effect 5x the mean transient
error) but not eliminated. The census replication kills both stories or
neither.

## 10. Ask

Mantis verdict on the REGION claim (§1, §6), with §2's lone-cell
concession already banked. If SURVIVES: replicator on the census slice per
§7 with a frozen point-estimate rule. Score components I'd defend:
edge-vs-friction on +2.32c net at 1.8x fee with the S-001 exemption
measured; evidence on z=3.85/8-of-8/token-mirror minus boundary debt;
replication 0 until run; mechanism donor measured at −5–6c on the dog
side with the decay fingerprint; capacity ~2/10 pending depth-walk.

---

## MANTIS VERDICT — SURVIVES (quota window 004–006 → 1/3, window closed)

**The falsifiable claim, restated in my words:** on BTC 15m up/down
episodes, a token that is two-sided with standing ask in [0.82, 0.86) at
t≈300s resolves to that token materially more often than the ask implies —
point estimate P(win) 87.10% vs 83.47c (= +3.62c gross, +2.32c net of the
156bps fee taking the standing ask), token-symmetric, sign-positive in
every measured month, and concentrated in one-tick-spread books (one-tick
+4.49c, wide +0.46c). The claim is the REGION; the lone gate-stack cell is
conceded noise (memo §2, correct).

Every load-bearing number reproduced independently to the digit
(G1a/G1b/G2 re-derived from `midwindow_checkpoints.parquet` with my own
SQL; friction and depth from both friction maps; prereg chain timestamps
verified birth=mtime: dump 08:25:26 → prereg 08:33:53 → probe 08:34:18 →
memo 08:38:49). Zero duplicate slugs in the pooled 1,271 — the arms are
genuinely episode-disjoint.

### Why this survives honest post-selection accounting (the memo's own

prereg does NOT earn the credit it implies)

1. **Demerit banked first: the prereg formalizes, it does not predict.**
   It was written 8 minutes AFTER the gate-stack dump, and all four region
   cells' devs (+4.51/+4.03/+2.31/+3.64c) were already public in that dump.
   G1's DOWN-arm "kill rule" (≥ +1.5c) was near-certain to pass by
   arithmetic on numbers already seen — it is restatement, not
   corroboration. §8(iii) overstates this. Only G2 (spread split) and the
   pooled month vector carried genuine kill risk. I therefore re-derived
   the evidence weight treating the ENTIRE region selection as post-hoc:
2. **The full candidate field contains 92 token-pooled 4c regions
   (n ≥ 300) across the four t values. R at t=300 is the unique z ≥ 3.85;
   expected count under H0 ≈ 0.003–0.03 even after ×10 inflation for
   boundary/width/arm freedom.** The field is otherwise cold (only one
   other region ≥ z=3 — see next point). A lone hot cell in a hot
   neighborhood is the lottery; a unique max with the #2 draw being the
   SAME band at the adjacent t is not.
3. **The decisive anti-noise fact (my probe, not the author's): the same
   band at t=450 reproduces on episodes the t=300 selection never touched.**
   Of the 1,444 t=450 in-region instances, 1,316 are fresh entrants — not
   in R at t=300 — and they alone show **+2.18c, z=2.26**. Boundary tuning
   on the t=300 draw cannot manufacture a deviation on disjoint episode
   instances. Joint noise probability of {unique field max at 3.85} ×
   {disjoint-instance neighbor arm at +2.18c} is ~4e-4. (The 128 persisted
   instances run +8.46c — persistence-conditioning, quoted for the record,
   not credited.)
4. **The memo's own confessed most-likely artifact is REFUTED, not merely
   discounted: there is no diffuse bias to concentrate.** Fav 78–90 at
   t=300 EXCLUDING R: **−0.79c** (n=2,523). Fav 66–82: −0.53c; 86–96:
   +0.10c. The deviation is a sharp island, not a smeared +1–2c halo that
   boundary-tuning sharpened. Consequence: the replication outcome space
   is close to binary — the island is real, or the whole thing is a
   sampling/instrument fluke; the "WEAKENED to +1–2c diffuse truth" branch
   has no measured support.
5. Friction/traps/capacity, verified: dev measured against the standing
   ask, so friction is fee 1.30c (+1c p25 spread under the frozen
   conservative convention → +1.32c net floor); one-tick stratum nets
   +3.19c. Selection binds (7.4% incidence). Not the fair-odds trap — the
   excess over entry price IS the measurement. 8/8 months sign-positive
   with the recent three strongest (anti-K-004 shape); honest caveat
   stands that 2026-01/02 sit inside fee — a chop regime pays ~zero net.
   Loss tail bounded at stake by construction, settles in 10 minutes, no
   unresolved inventory, 12.9% loss frequency priced. Capacity ~$800
   median top-3 per fire = 0.2–0.25x the bar, depth-walk unpriced —
   "it's small" is acceptable and it caps the score, not the verdict.
6. Residual demerits carried to scoring: region n_stale is 1, not the
   memo's 0 (cell-level claim was accurate; immaterial). The dog-side
   "measured donor" is the same books via the mirror — legitimate as flow
   identification, ZERO independent statistical weight (memo half-concedes
   this; I make it full). The sharp band edges are mechanically
   unexplained and flanks 78/86 lean negative — mechanism component gets
   docked for shape. No disjoint-MONTH test exists until the
   markets.parquet refresh; nothing tonight can cure that.

### Held-out re-measurement the replicator must run (frozen here; no re-tuning)

- **Data:** `census/checkpoints.parquet` ONLY (the 2,000-episode census
  sample, episode-disjoint from the holdout by construction, untouched by
  surveyor scan, memo, and this review). Own script, re-derived from the
  parquet — do not reuse `round6_gabagool_probe.sql` or cite
  `calibration.csv`.
- **Rule (K-001 episode-dedupe):** first-touch entry — for each
  (slug, token), the first 15s-grid checkpoint with t ∈ [240, 360] where
  the token is two-sided (bid>0, ask<1, ask>bid) and ask ∈ [0.82, 0.86);
  one entry per (slug, token); measure P(win) − ask-at-entry, pooled and
  split by spread stratum (one-tick = spr ≤ 0.011). Report the t=300-exact
  subset as a secondary read. Expected n ≈ 200–300 first-touch.
- **Frozen verdict rule (adopting the memo's §7 proposal unchanged):**
  REPLICATED if pooled first-touch dev ≥ +2.0c AND one-tick stratum dev
  > 0; WEAKENED if pooled dev ∈ (0, +2.0c); REVERSED if pooled dev ≤ 0.
  > Power is a point-estimate test (expected z ≈ 1.3–1.7 at true +3.6c),
  > declared before running — a REPLICATED here is direction-and-magnitude
  > evidence, not a standalone z ≥ 2 proof, and the cartographer must score
  > it as such.

### What makes me concede the kill

Pooled first-touch dev ≤ 0 on the census slice — the region was
selection-plus-instrument artifact and I will write the graveyard entry
myself. Also fatal: one-tick stratum ≤ 0 while wide books carry any
positive residue (the S-001 sink shape after all), or WEAKENED landing
inside the 1.3c fee (sign-right, sub-friction donation → S-001-class,
route to graveyard with the retest gated on post-refresh months).

— mantis, 2026-07-10, Foundry Phase 2 Round 6
