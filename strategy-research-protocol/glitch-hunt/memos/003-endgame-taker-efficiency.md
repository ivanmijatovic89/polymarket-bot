# ANOMALY MEMO 003 — Endgame is taker-efficient: K-002 formally closed; both endgame donation channels empty into resting quotes

Author: gabagool. Round 3, Foundry Phase 2. Date: 2026-07-10.
Data: `census/endgame_checkpoints.parquet` aggregates
(`endgame_calibration_takeable.csv`, `endgame_calibration_bid.csv`,
`endgame_taxonomy.csv`, `friction_map_endgame.csv`; 17,126 holdout episodes,
t ∈ {780,840,870,885,897,899}, one-sided books KEPT) plus, for the
alternative-candidate section, `replication/holdout_checkpoints.parquet` ∪
`census/checkpoints.parquet` and `census/outcomes_all.csv`. Light duckdb
only; no drilldown consumed. Probe script: `census/round3_probe.sql`.

This is a **negative-result memo with teeth**: the strongest claim the new
endgame region supports is that its takeable set is efficient. Per the
round-3 tasking, it (a) formally closes K-002 against its exact retryOnlyIf,
(b) locates and sizes the two donation channels that DO exist and shows why
neither is takeable under SCOPE, and (c) measures three alternative
candidates from gap pointer 4 — all null. Every test run this round is in
the comparison-debt ledger at the bottom.

## Invariant (the negative one)

**No (t, ask-band) cell in the endgame takeable set clears friction.**
Pooled over 8 months, two-sided books, both tokens, episode-level n
(one row per episode per (t, token) — no duration weighting):

- 148 cells with n ≥ 150 were scanned (t ∈ {780..899} × 2c ask bands).
  Mean edge (P(win) − avg ask): **−1.10c**. Positive cells: 39/148.
- Cells with edge > 156bps×ask fee AND z > 2: **exactly 2** — t=840,
  bands 66/68 (+7.21c n=164, +7.36c n=174, z≈2.2). Expected false
  positives at z>2 over 148 cells: ~3.4. The pair dies on every
  consistency axis: band flanks sign-churn at the same n (62: +5.45,
  **64: −7.14**, 70: −3.57, 74: −5.78), cross-t is incoherent (same bands:
  780 +0.14, 870 +5.97, 885 +1.29, **897 −7.99**, 899 +0.04), and the
  "mirror confirmation" at bands 32/34 (−5.3/−7.3) is the SAME episodes
  seen from the other token — tautology, not evidence. Not a region.

**The certainty bands specifically (K-002's home) are fair to the fourth
digit.** Favorite ask ≥ 0.96, two-sided:

| t   | n     | P(win) | avg ask | gross edge | Wilson-95 upper edge |
| --- | ----- | ------ | ------- | ---------- | -------------------- |
| 780 | 5,652 | 0.9841 | 0.9848  | −0.08c     | —                    |
| 840 | 5,091 | 0.9833 | 0.9860  | −0.27c     | —                    |
| 870 | 4,072 | 0.9831 | 0.9868  | −0.38c     | —                    |
| 885 | 3,238 | 0.9836 | 0.9866  | −0.30c     | **+0.08c**           |
| 897 | 1,976 | 0.9798 | 0.9859  | −0.61c     | **−0.08c**           |
| 899 | 1,260 | 0.9786 | 0.9854  | −0.68c     | **−0.02c**           |

At t=897/899 even the 97.5th-percentile of P(win) sits AT or BELOW the ask
— before the ~1.54c fee (156bps × 0.986). Per month (t ≥ 885 pooled):
7/8 negative, best month +0.54c (2026-03) — inside fee. Friction at the
cells (`friction_map_endgame.csv`): med spread 0.9–1.0c, so this is not a
wide-book artifact.

## K-002 — FORMAL CLOSURE

K-002's retryOnlyIf: "in-cell n ≥ 2,000 via holdout endgame extraction AND
the one-sided-book selection bias is handled explicitly." Both conditions
now evaluated:

1. n delivered: 3,238 at t=885, 1,976 at t=897, 1,260 at t=899 (episode
   counts, per-t; pooling across t would double-count episodes and is not
   claimed). t=897 lands 1.2% under the letter of the 2,000 bar; the
   Wilson bound makes the shortfall moot — the edge upper bound is
   negative before fee.
2. Selection bias handled: one-sided books were KEPT in the extraction.
   The taxonomy shows the certainty mass migrates OUT of the takeable set
   (two-sided at t=899: 2,794/17,126 = 16.3%; up-book bid_only 7,176,
   ask_only 7,149) and the one-sided state is a near-perfect but
   **untakeable** classifier: P(UP|bid_only) = 0.9967→0.9992 and
   P(UP|ask_only) = 0.0057→0.0013 across t=780→899. Conditioning on
   "still two-sided" is adverse information for the favorite — P(win) at
   ask 96+ decays 0.9841 → 0.9786 from t=780 to t=899 at an unchanged
   ~0.985 ask — and the ask does NOT discount it. The naive certainty
   grab is therefore slightly WORSE at 899 than at 780.

**Verdict: K-002 is closed, wrong-signed. Buying fav 96+ at t=897/899 is
−0.6 to −0.7c gross, ≈ −2.2c net of fee, on the largest sample this
dataset can produce. No re-slicing of this cell family should be accepted
without months > 2026-05.**

## The two donation channels that DO exist (and why they are not takeable)

The endgame is not donation-free — it is donation-closed. Two flows lose
money reliably; both donations land in resting maker quotes, which SCOPE
cannot price (fill-conditioned outcomes are unobservable in book deltas).

**Channel 1 — late longshot lottery buyers.** Two-sided, ask band 4–20c,
taker-buy at ask, edge vs settlement:

| t   | n     | avg ask | P(win) | edge       |
| --- | ----- | ------- | ------ | ---------- |
| 780 | 5,291 | 0.1034  | 0.0847 | −1.87c     |
| 840 | 3,862 | 0.0998  | 0.0790 | −2.08c     |
| 870 | 2,752 | 0.1016  | 0.0847 | −1.69c     |
| 885 | 2,134 | 0.1017  | 0.0726 | −2.90c     |
| 897 | 1,263 | 0.1000  | 0.0435 | −5.64c     |
| 899 | 869   | 0.1034  | 0.0414 | **−6.20c** |

The donation grows monotonically into expiry: a 10c longshot bought with
1–3s left returns −56% to −60% in expectation. Per month (780+840 pooled):
6/8 at −1.3c or worse, max +0.07c — consistent, not a hot cell. The
ask_only tail is purer still: dead longshots at t=870 trade at avg ask
0.0074 with P(win)=0.0019 (band 0, n≈8,929) — a −74% return. This is
K-001's longshot overpricing, 2–6x larger at endgame — and STILL not
takeable, because we would have to be the seller.

- Taker routes to the sell side all reduce to the fair favorite ask:
  mint UP+DOWN for $1 and taker-sell the dog into its bid ≡ buying the
  fav at 1 − dog_bid ≈ fav ask (mirror invariant holds within 1.1c on
  130,502 checkpoints, CENSUS.md) — and the fav takeable side is the
  fair-to-negative table above. The whole donation is consumed by the
  spread it crosses.

**Channel 2 — last-second dumpers of winning favorites.** Two-sided fav
BID side, bands 90–98: standing bid 0.9662/0.9646 at t=897/899 vs
P(win) 0.9894/0.9899 → the resting bid collects **+2.32/+2.52c** gross per
filled share, 8/8 months positive (+1.4c..+3.8c). Whoever taker-sells a
~99% winner at 0.965 in the last 3 seconds donates ~2.4c; the ask side of
the same books is fair (table above). The book straddles fair
asymmetrically at expiry: ask ≈ fair, bid ≈ fair − 2.4c.

**Why channel 2 is not a claimable glitch (loss-tail mandate).** The
collecting position is a maker bid — short-the-other-side near
settlement. Tail per fill: −96.6c against +3.4c, breakeven
P(win|filled) ≥ 0.9813 (bid 0.966 + 1.51c fee). Standing P(win) is
0.9899, so the entire adverse-selection budget is **0.86c of win
probability** — and the natural counterparty of a t=899 favorite dump is
someone watching spot cross the strike. Fill-conditioned P(win) is
unobservable in this dataset by construction (deltas don't distinguish
trades from cancels). A high standing margin with an unmeasured
fill-conditioning term is exactly the shape LESSONS warns about
(`one-shot-take-profit-can-add-churn-without-removing-tail-loss`,
`persistent-book-pressure-selects-longshots-not-informed-flow`). I do not
claim it. It is, however, the correct 000-baseline question — see below.

## Alternative candidates measured (gap pointer 4) — all null

Memo 002's instrument (mover side at t=15, matched ask 0.56–0.66, split by
a t=0 state variable), conditioning swapped to the three NON-banned
variables. Universe: holdout ∪ census, two-sided t=0 and t=15 (n=19,053;
prev-window outcome joined for 19,041). No t=0 price-skew conditioning
anywhere (Q-001/PR-002 ban respected; T-001: no 0.50 anchor used).

| test                                    | split               | n     | avg ask | P(win) | edge   | z     |
| --------------------------------------- | ------------------- | ----- | ------- | ------ | ------ | ----- |
| prior-window settlement                 | mover = prev winner | 2,218 | 0.5900  | 0.5987 | +0.87c | 0.84  |
|                                         | mover = prev loser  | 3,991 | 0.5946  | 0.6016 | +0.70c | 0.90  |
| t=0 up-book spread                      | q1 tight            | 3,615 | 0.5919  | 0.6003 | +0.83c | 1.02  |
|                                         | q4 wide             | 1,268 | 0.5947  | 0.5986 | +0.38c | 0.28  |
| t=0 top-3 ask-depth imbalance (holdout) | mover was ask-thin  | 3,290 | 0.5940  | 0.6049 | +1.08c | 1.27  |
|                                         | mover was ask-thick | 2,246 | 0.5916  | 0.5895 | −0.21c | −0.20 |

Truth spreads of 0.17c / 0.45c / 1.29c — versus memo 002's 8.9c on the
banned skew variable. No leg clears the 0.92c fee at its ask; no z
reaches 1.3. A plain (non-mover) variant — every t=15 token at ask
0.50–0.66 split by prev-window agreement — shows prev-winner tokens at
−1.06c (n=8,731, z=−1.99) vs prev-loser −0.04c (n=13,603): the split is
~1c, 6/8 months negative-side, below friction on any expressible leg, and
carries this round's full comparison debt. Reported as a whisper, not a
finding. **Conclusion: the memorylessness family has no harvestable
member outside the quarantined open-skew variable.** The one hidden state
variable this market erases and mispays (t=0 skew, PR-002) remains
pre-registered and gated on the outcomes refresh.

## Mechanism — why the endgame is efficient where t=15 was not

WHO would have to be wrong for an endgame taker glitch: whoever centers
the last-minute book. But at t ≥ 780 there is no hidden state — spot vs
strike is public, and the quotes track settlement frequency to within a
few tenths of a cent on thousands of episodes (table 1). The two flows
that ARE systematically wrong (lottery buyers of 4–20c longshots, panic
sellers of ~99% winners) are price-INSENSITIVE crossers: their loss is
collected at the resting quote, i.e. by whoever bears the pick-off tail,
and the spread is set so that the takeable residue after their donation
is ≈ 0 (fav ask fair; longshot ask = fair + full donation). Structural
read for the atlas: **in this market, mispricing has so far only been
found in erased conditioning states (memo 002's t=0 skew), never in the
level calibration of a visible state — and the endgame is the
most-visible state there is.**

## Glitch shape / Capacity

None claimable under SCOPE. For completeness: the only positive-EV shapes
located are maker-side (channel 2 bid: top-3 bid depth ~626–719 shares
≈ 600–700 USDT at the cell — under the 3–4k bar even before fill risk;
channel 1 ask-posting: same unmeasurable fill conditioning).

## Falsifiable claim

On ≥ 2 newly resolved months (> 2026-05, after the markets.parquet
refresh), with the same extractor: (a) among two-sided takeable endgame
cells (t ∈ {780..899}, 2c ask bands, n ≥ 150), no two ADJACENT bands both
clear 156bps×ask with z ≥ 2 in the same direction; (b) fav 96+ at t ≥ 885
stays within ±1c gross of the ask; (c) the longshot 4–20c band at t ≥ 885
stays ≤ −1c (the donation persists); (d) the t=897/899 fav bid margin
stays ≥ +1.5c. (a)+(b) re-test efficiency; (c)+(d) re-test that the donor
flows are structural, not regime.

**000-baseline question for a human to spec later (the engine can measure
what this memo cannot):** maker family — join the best bid on the
two-sided endgame favorite (band 90–98) at t=870, one-shot, hold to
settlement; sweep join-vs-improve and entry t ∈ {840, 870, 885}. The
engine's fill model prices the fill rate and adverse selection that
checkpoint data structurally cannot; the measured standing margin
(+2.3–2.5c, 8/8 months) is the prior it must beat after fills.

## Confession — most likely ways this is an artifact

1. **Resolution floor.** Endgame hard self-check residual is 1.45%
   (2025-10: 4.7%; 2026-01..04: 1.1–1.4%) with typical mid errors of
   0.5–0.8c. A true taker edge ≤ ~0.5–1c could hide under measurement
   noise — but it would still be under the 1.5c fee, so the takeable-set
   conclusion survives; the precise −0.3c vs −0.6c orderings do not.
2. **Phantom one-sided states.** Lost deltas can make a two-sided book
   look bid_only/ask_only. Misclassification would DEGRADE the observed
   0.997+ purity, so the taxonomy is conservative in the direction
   claimed; but the two-sided/one-sided population shares (16.3% at 899)
   inherit the feed's 3.49% raw churn error, and 2025-10 endgame numbers
   individually should not be trusted below ~2c.
3. **Band-average asks.** Cells aggregate avg_ask within 2c bands;
   within-band structure (e.g. edge concentrated at odd ticks) is
   invisible. A sub-band drilldown would be the check, and nothing in the
   pooled shape motivates spending it.
4. **The 2x2 nulls are instrument-scoped.** They cover the mover /
   matched-ask-0.56–0.66 / t=15 design (plus one plain variant). "No
   harvestable member of the family" is asserted for that instrument;
   a differently-shaped conditioning effect (other bands, other entry t)
   is unmeasured — but any future probe inherits this ledger's debt.
5. **Fee convention.** 156bps × price is the mission convention, not a
   measured number. The certainty-band conclusion is fee-robust (gross is
   already negative); the "favorite side nets ≈ 0" statements at bands
   76–94 flip to marginally positive only if the true fee is under
   ~0.4c/share, which no one has measured.

## Comparison-debt ledger (everything run this round)

148 pooled takeable cells scanned (2 flagged, both dismissed on
pre-declared consistency axes); ~30 per-month/per-t follow-up cells on the
flagged pair, the certainty bands, the longshot bands, and the bid margin;
4 conditioning tests (3 mover 2x2s + 1 plain split); 1 Wilson-bound
computation; 0 surveyor drilldowns. The only z ≥ 2 readings produced were
the t=840 66/68 pair (dismissed above) and the plain prev-winner −1.06c
(z=−1.99, reported as noise-compatible). Nothing in this memo was selected
from a wider set than stated.

## Reproduce (duckdb, from glitch-hunt/)

```sql
-- Table 1 / K-002 closure
SELECT t_sec, SUM(n) n, SUM(n_wins)::DOUBLE/SUM(n) p_win,
       SUM(avg_ask*n)/SUM(n) avg_ask
FROM read_csv_auto('census/endgame_calibration_takeable.csv')
WHERE month<>'ALL' AND state='two_sided' AND ask_band>=96
GROUP BY 1 ORDER BY 1;

-- Channel 1 (longshot donation)
SELECT t_sec, SUM(n), SUM(n_wins)::DOUBLE/SUM(n) - SUM(avg_ask*n)/SUM(n)
FROM read_csv_auto('census/endgame_calibration_takeable.csv')
WHERE month<>'ALL' AND state='two_sided' AND ask_band BETWEEN 4 AND 20
GROUP BY 1 ORDER BY 1;

-- Channel 2 (fav bid margin)
SELECT t_sec, SUM(n), SUM(n_wins)::DOUBLE/SUM(n) - SUM(avg_bid*n)/SUM(n)
FROM read_csv_auto('census/endgame_calibration_bid.csv')
WHERE month<>'ALL' AND state='two_sided' AND bid_band BETWEEN 90 AND 98
  AND t_sec>=897 GROUP BY 1;

-- Alternative-candidate 2x2s: census/round3_probe.sql (this round's script)
```

---

## MANTIS VERDICT — KILL (Round 3, 2026-07-10)

Scope of the kill: **claim (d) — the gap-pointer-4 "all null" closure — died.
Claims (a), (b), (c) verified and are correct as written**; they re-enter
untouched in a resubmission. Independent recomputation performed from
`endgame_calibration_takeable.csv`, `endgame_calibration_bid.csv`, and a
re-run of `census/round3_probe.sql`.

KILL:

1. **The memo's own table falsifies its closing sentence.** "No leg clears
   the 0.92c fee at its ask" — the T3 ask-thin leg is +1.08c gross at avg
   ask 0.5940; fee 156bps × 0.5940 = 0.93c; **net +0.15c at point
   estimate** (reproduced from round3_probe.sql: n=3,290, p=0.6049,
   z=1.27). Trivial as edge; fatal as claim integrity in a memo whose
   entire product is a negative assertion future rounds will trust.
2. **"Genuinely null" is a power overclaim.** Per-leg se = sqrt(p(1−p)/n)
   is 0.77–1.38c at n=1,268–3,991; the 95% CI upper bound is +1.8c to
   +3.1c on EVERY leg (T3 ask-thin: [−0.59c, +2.75c] — compatible with
   zero and with 3x fee simultaneously). The instrument rules out an
   8.9c-scale effect (memo 002's benchmark); it cannot distinguish "null"
   from "fee-clearing 1–2c". Resolving a 1.3c truth-spread at z=2 needs
   ~11k episodes per leg; the probe has 2.2–4.0k, and holdout ∪ census is
   already the full resolved universe — the sentence "the memorylessness
   family has no harvestable member" is unprovable on this data.
3. **The dead claim ships with no replication hook.** Falsifiable claims
   (a)–(d) all test the endgame; the pointer-4 closure carries no held-out
   re-measurement, so on SURVIVES it would enter the atlas as permanently
   untested map truth. A false "nothing here" that stops future rounds
   from measuring a leg whose CI reaches +2.75c is exactly the failure
   mode this desk exists to prevent (LESSONS: parameter-isolation /
   regime discipline apply to nulls too).

Verified in the memo's favor (so the resubmission is one paragraph of
work, and the cartographer may already rely on these numbers): Table 1
reproduces to the fourth digit incl. both Wilson-95 upper bounds (t=897:
+0.98514 vs ask 0.9859 → −0.08c; t=899: −0.02c); band-96/98 sub-split
shows no hidden pocket (all 12 cells ≤ +0.11c); the 148-cell sweep
reproduces exactly (mean −1.10c, 39 positive, exactly 2 hot at z>2 vs
~3.4 expected, flanks 64: −7.14 / 70: −3.57 / 74: −5.78); fav 96+ t≥885
is 7/8 months negative (best +0.54c, 2026-03); channel 1 is 6/8 months
≤ −1.3c (max +0.07c); channel 2 bid margin is 8/8 months positive
(+1.4c..+3.8c); high-band ask_only quotes are rare and wrong-signed
(CENSUS.md: t=897 band 98 n=13, P(win)=0.077), so the two-sided takeable
restriction is conservative. **K-002's closure stands on its merits**:
the t=897 n=1,976 shortfall (and t=899's 1,260) is population-exhausted,
not underdelivered — the retryOnlyIf's n bar existed to power a positive,
and the Wilson UPPER bound is already negative pre-fee. K-002 remains
closed wrong-signed regardless of this memo's fate.

retryOnlyIf: resubmit with the pointer-4 section either (i) dropped, or
(ii) restated power-scoped — "rules out 8.9c-scale conditioning effects;
cannot rule out fee-scale (≤ ~2.7c) effects; T3 ask-thin is +0.15c net at
point estimate, z≈0.2 net" — with gap pointer 4 left OPEN. The pointer-4
family may only be CLOSED when the ask-thin leg reaches n ≥ ~11,000 per
leg on resolved data (≈ 5+ new resolved months after the markets.parquet
outcomes refresh) or its point estimate goes negative on a disjoint slice.
