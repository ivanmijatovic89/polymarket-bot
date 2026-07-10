# ANOMALY MEMO 004 — Prev-winner momentum tax: real at 1.4–2.2c, structurally untakeable; gap pointer 3 KILLED per pre-registration. Plus the staleness audit: 2025-10/11 are regime, 2026-01 endgame is the stale month

Author: gabagool. Round 4, Foundry Phase 2. Date: 2026-07-10.
Data: `replication/holdout_checkpoints.parquet` (holdout ONLY — the round-3
prior was measured on holdout ∪ census; this round is one instrument),
prev-window settlement from `census/outcomes_all.csv` joined on epoch−900
(17,113/17,126 episodes covered), `census/endgame_checkpoints.parquet` for
the audit. Light duckdb only; no surveyor drilldown consumed.
**Pre-registration written to disk BEFORE any hypothesis query:**
`census/round4_prereg.md`. Probe script: `census/round4_probe.sql`.

This memo does two pre-declared things and nothing else:
(a) resolves gap pointer 3 (prev-window-agreement whisper): **KILL** —
the whisper is real and grew (peak −1.92c, z=−3.3 at t=45), but it fails
two of my own pre-registered growth gates and, decisively, the only
SCOPE-expressible harvest route nets negative at every t;
(b) delivers gap pointer 1 (staleness confounder audit) with a verdict
the map was not expecting: **2025-10/11's sign flips are NOT
instrumentation — the actual staleness pocket is 2026-01 endgame**, and
one E-002 month number needs a restatement.

## Part A — the prev-winner momentum tax (gap pointer 3)

### Invariant

Tokens on the side that won the PREVIOUS 15m window, priced 0.50–0.66 at
ask, systematically resolve below their price in the first minute of the
new window. Holdout-only, episode-level, one row per (episode, token, t),
two-sided books, taker-buy at best ask vs settlement:

| t   | class       | n      | avg ask | P(win) | edge       | z     |
| --- | ----------- | ------ | ------- | ------ | ---------- | ----- |
| 15  | prev-winner | 7,736  | 0.5362  | 0.5237 | **−1.26c** | −2.22 |
| 15  | prev-loser  | 12,092 | 0.5474  | 0.5476 | +0.01c     | 0.02  |
| 30  | prev-winner | 7,568  | 0.5469  | 0.5297 | **−1.72c** | −3.00 |
| 30  | prev-loser  | 10,642 | 0.5560  | 0.5522 | −0.38c     | −0.79 |
| 45  | prev-winner | 7,334  | 0.5533  | 0.5341 | **−1.92c** | −3.30 |
| 45  | prev-loser  | 9,739  | 0.5611  | 0.5572 | −0.38c     | −0.76 |
| 60  | prev-winner | 7,033  | 0.5572  | 0.5432 | **−1.41c** | −2.37 |
| 60  | prev-loser  | 8,982  | 0.5646  | 0.5599 | −0.47c     | −0.89 |

The conditioning contrast (prev-winner minus prev-loser) is −1.27c to
−1.54c across t. On fresh books only (age_ms < 60,000) the effect
DEEPENS: −1.96 / −2.17 / −1.61c at t=30/45/60 — this is not a stale-quote
artifact. The round-3 prior (−1.06c at t=15 on the union sample, z=−1.99)
is confirmed and larger away from the open. Note also n: prev-loser
tokens appear in the 0.50–0.66 band ~1.4x as often as prev-winner tokens —
the book prices the just-lost side as favorite more often, which is
PR-002's re-centering fact (90.5%) seen from a non-banned variable.

### Verdict against the pre-registration (census/round4_prereg.md)

GROW required six gates; three failed:

1. edge ≤ −1.0c at every t ∈ {30,45,60} — PASS (−1.72/−1.92/−1.41).
2. deepening, edge(60) ≤ edge(15) − 0.5c — **FAIL**: −1.41 vs required
   ≤ −1.76. The effect peaks at t=45 and shallows into t=60.
3. z ≤ −2.0 at t=60 — PASS (−2.37).
4. ≥ 6/8 months negative at t=60 — **FAIL**: 5/8 (2025-11 +0.53,
   2026-03 +0.69, 2026-05 +0.94; negatives: 2025-10 −4.37, 2025-12
   −3.11, 2026-01 −2.18, 2026-02 −3.67, 2026-04 −0.45). At the
   non-decision t=45 it is 7/8 (only 2026-05 +0.85, n=404) — but t=60
   was the declared decision point and I am not migrating it post-hoc.
5. contrast intact — PASS (prev-loser −0.47c at t=60).
6. harvest — **FAIL**, decisively, below.

The KILL clause ("< 6/8 months negative at t=60") fires. **Killed.**

### The harvest test — why even the real part is untakeable

A negative edge on buying X is only money if the expressible mirror
clears friction. The mirror: in episodes where the prev-winner token is
in-band, taker-buy the OPPOSITE (prev-loser) token at its own ask:

| t   | n     | avg opp ask | P(opp wins) | gross      | fee (156bps) | net        |
| --- | ----- | ----------- | ----------- | ---------- | ------------ | ---------- |
| 15  | 7,736 | 0.4799      | 0.4763      | −0.36c     | 0.75c        | −1.11c     |
| 30  | 7,568 | 0.4676      | 0.4703      | +0.27c     | 0.73c        | −0.46c     |
| 45  | 7,334 | 0.4610      | 0.4659      | **+0.49c** | 0.72c        | **−0.23c** |
| 60  | 7,033 | 0.4569      | 0.4568      | −0.00c     | 0.71c        | −0.71c     |

Best leg (t=45): gross z = 0.84, net −0.23c. The 1.9c overpricing of the
prev-winner ask coexists with a fair-to-slightly-rich complement ask —
the gap between them is the spread, and crossing it consumes the
donation. Identical structure to E-002: the donation empties into
resting quotes (here: resting bids/asks on the complement side), which
SCOPE cannot price.

Power scope on the harvest null (M-003 lesson, mandatory): at t=45 the
gross se is 0.58c → gross 95% CI [−0.65c, +1.63c], net CI upper bound
**+0.91c**. This kill rules out a ≥1c-net harvest; it CANNOT rule out a
sub-1c one. Ruling out 0.5c net at z=2 needs ~29k in-cell episodes —
4x more than the resolved universe holds. The kill is therefore
"untakeable at any size worth the desk's time on current data", not
"proven zero".

Power scope on the calibration fact itself: t=60 edge 95% CI
[−2.57c, −0.25c]; t=45 [−3.06c, −0.78c]. The prev-winner overpricing is
real with high confidence at t=30–45; what died is the pre-registered
growth shape and any expressible route to it.

### Shape (pre-declared secondary, t=60, 4c bands 0.34–0.66)

Churny, not a clean region: prev-winner cells run −3.24 / −2.79 / +0.37 /
−0.90 / −0.61 / **−3.71 (z=−3.42)** / −0.01 / −1.41 / +2.39 across bands
32→64. The band-52 hot cell is flanked by −0.61 and −0.01 — a lone cell
by the mission's own adjacency discipline. Prev-loser side shows its own
lone cells (band 32: +6.35, z=2.36, n=333; band 56: −2.65, z=−2.52).
~18 shape cells scanned → ~0.9 expected |z|>2 flukes; I got 4 lone ones
and no contiguous run. The pooled band effect is real; its sub-band
structure is noise at this n. This corroborates KILL: a mechanism-bearing
region should not sign-churn across adjacent bands.

### Mechanism (named, even for a kill — it goes on the map)

WHO donates: momentum/continuation buyers of the side that just won the
previous window — post-resolution chasers who taker-buy the winning side
in the first 30–60s of the new window at 0.50–0.66. The new window's
outcome is (approximately) independent of the old one, so they pay
~1.4–2.2c above measured frequency. WHY it persists: the correction
trade is maker-only. Taking the complement at ask costs the full spread
plus 0.71–0.75c fee against a ≤2c mispricing (measured: best net −0.23c),
so no taker is ever paid to correct the prev-winner ask; the chasers'
donation is collected by whoever RESTS on the complement side. Third
confirmed instance of the same structural sink (E-002 ch.1 longshot
lottery flow, ch.2/OL-001 favorite dumpers, now early-window momentum
chasers): **this market's donations are all collected at resting quotes,
never at takeable ones.**

### Glitch shape / capacity

None claimable — harvest fails friction, so no entry/exit path exists
under SCOPE. Nothing to size. (The maker-side collection of this
donation shares OL-001's unmeasurable fill-conditioning problem and is
NOT filed as a second operator lead: unlike OL-001's 8/8-month +2.3–2.5c
standing margin, this one's takeable mirror is only 0.2–0.5c from fair —
there is no margin budget for adverse selection.)

## Part B — staleness confounder audit (gap pointer 1)

Book age by month (p50/p90 seconds; % of books younger than 60s):

| month   | t=15 p50/p90 | t=15 fresh% | t=897 p50/p90   | t=897 fresh% |
| ------- | ------------ | ----------- | --------------- | ------------ |
| 2025-10 | 0.1 / 1.0    | 99.6        | 0.8 / 5.6       | 99.9         |
| 2025-11 | 0.0 / 0.2    | 97.1        | 0.3 / 1.7       | 98.0         |
| 2025-12 | 0.0 / 0.2    | 94.7        | 0.2 / 1.0       | 93.2         |
| 2026-01 | 0.0 / 1.2    | 92.2        | 0.1 / **326.6** | **84.7**     |
| 2026-02 | 0.0 / 0.1    | 99.9        | 0.1 / 0.3       | 99.9         |
| 2026-03 | 0.0 / 0.1    | 100.0       | 0.0 / 0.2       | 100.0        |
| 2026-04 | 0.0 / 0.3    | 99.9        | 0.1 / 0.4       | 99.8         |
| 2026-05 | 0.0 / 0.1    | 99.8        | 0.0 / 0.3       | 99.7         |

Three audit findings, each with direct scoring consequences:

1. **2025-10/11 sign-flipping is regime/sampling, NOT instrumentation.**
   Their books are among the freshest in the dataset at both t=15 and
   t=897. The pre-declared re-cuts confirm it: PR-002's locked cell on
   age<60s books is numerically unchanged (2025-10: −9.6c on 40/40
   already-fresh episodes; 2025-11: −1.08c on 26/26); this round's
   primary at t=45/60 moves < 0.1c in both months under the filter.
   Consequence: **no staleness footnote rescues any month-consistency
   count on the atlas.** 2025-10/11's known defect stays what it was
   (delta-churn self-check error, 11.1%/4.7% raw/hard at endgame — a
   reconstruction issue, not quote age), and 6/8-month consistency
   remains the honest ceiling for full-window claims. PR-002's evidence
   line stands as scored.
2. **The real staleness pocket is 2026-01 endgame**: 15.3% of t=897
   books are older than 60s (p90 = 327s — five-minute-dead books inside
   the last 3 seconds). Any sub-2c endgame effect in 2026-01
   specifically should carry the same distrust the atlas already
   assigns 2025-10.
3. **E-002 channel 1 restated on fresh books**: 2026-01 moves from
   −4.14c (n=744) to **−1.09c** (n=493) — a third of its in-band endgame
   rows are stale, and they carried most of that month's donation.
   Every other month moves < 0.3c (fresh-book column: −8.14 / −6.72 /
   −3.39 / −1.09 / −3.20 / −3.21 / −3.92 / −4.61). E-002's standing
   falsifiable claim ("longshot 4–20c at t ≥ 885 stays ≤ −1c") survives
   in **8/8 months on fresh books** — the channel is robust, but its
   pooled magnitude was mildly overstated and the atlas row "6/8 months
   ≤ −1.3c" should be restated as "7/8 ≤ −3c, 2026-01 −1.09c fresh".

## Falsifiable claim

On ≥ 2 newly resolved months (> 2026-05, after the markets.parquet
refresh), same join (prev outcome via epoch−900), same bands: (a) the
prev-winner token at ask 0.50–0.66 stays ≤ −1c gross at t ∈ {30,45}
(the calibration fact persists); (b) the complement-at-ask harvest leg
stays below 156bps×ask net (the untakeability persists). If (a) holds
and (b) FAILS — the harvest clears fee with z ≥ 2 — pointer 3 reopens
as a live anomaly, not before.

retryOnlyIf (proposed for the map): reopen only on (i) the disjoint-month
test above, or (ii) a maker-side instrument that can price fills —
i.e. the same engine-gated route as OL-001. No re-slicing of bands/t on
2025-10..2026-05: the resolved universe is spent on this question
(harvest CI needs 4x the data that exists).

**000-baseline question a human could spec later** (engine, not this
mission): taker-buy the prev-LOSER side at t=45 when the prev-winner
side's ask is 0.50–0.66 — the engine's measured fees/slippage decide
whether the −0.23c net point estimate is really negative; sweep entry
t ∈ {30,45,60}. Low priority: the standing margin here is ≤0.5c gross,
an order of magnitude thinner than OL-001's prior.

## Confession — most likely artifact routes

1. **The decision-point choice saved/killed this memo.** Had I
   pre-registered t=45 instead of t=60, gates 1–5 would all PASS (7/8
   months, z=−3.3). The honest statement: the pre-registration was
   written blind and I am honoring it, but a replicator re-running with
   t=45 as the declared point would call this GROW-shaped-but-untakeable
   rather than KILL. The harvest failure is decision-point-independent,
   which is why the kill is safe either way.
2. **Prev-window join semantics.** outcomes_all result_id was verified
   against census up_won (0=UP, 2,000/2,000 consistent), but a missing
   or mis-slugged previous window silently drops episodes (13 dropped);
   if drops correlated with volatile hours, the momentum-chaser
   population could be under/over-sampled. Unlikely at 0.08% loss.
3. **Composition within the 16c band.** Prev-winner and prev-loser
   in-band populations have slightly different avg asks (0.536 vs 0.547
   at t=15); the 4c-band table bounds this — the contrast survives
   within most sub-bands — but a fine-grained matched-ask restatement
   was not pre-declared and was not run.
4. **Both-tokens-in-band double counting.** Near-50/50 books put both
   tokens in 0.50–0.66; those episodes contribute one row to each class,
   so the two class rows are not fully independent samples. The
   contrast is within-episode there, which if anything strengthens it.
5. **Fee convention.** 156bps × price is the mission convention. The
   harvest kill is robust to it only above ~0.5c true fee at these
   prices (gross +0.49c max); a true fee under ~0.5c would flip the
   best harvest leg marginally positive — same caveat class as memo
   003's confession 5.

## Comparison-debt ledger (everything run this round)

Sanity (non-hypothesis): result_id semantics check, prev-join coverage.
Hypothesis cells: 8 primary (4t × 2 classes) + 16 month cells (t=45/60
× 8) + 4 harvest legs + 18 shape cells (4c bands × 2 classes) = 46.
Audit cells: 16 age-by-month rows, PR-002 8 months × {all, fresh},
E-002 8 months × {all, fresh}, primary fresh restatement 3 pooled + 4
month cells. All pre-declared in round4_prereg.md before the first
query; nothing else was run; nothing reported was selected from a wider
set than stated. |z| ≥ 2 readings: the primary at t=30/45/60 (the
declared target), and 4 lone shape cells (band-36/52 prev-winner,
band-32/56 prev-loser) — all dismissed on the pre-declared adjacency
axis; ~0.9 lone flukes were expected among 18 shape cells.

## Reproduce

`census/round4_probe.sql` end-to-end (duckdb, 2 threads, from
glitch-hunt/). Pre-registration: `census/round4_prereg.md`.

---

## MANTIS VERDICT — KILL (affirmed and scoped; quota untouched, 0/3 consumed)

Round 4, 2026-07-10. Every load-bearing number reproduced independently
(primary 8 cells, 16 month cells, 4 harvest legs, age table, PR-002 recut,
E-002 recut — all exact to the reported precision).

KILL:

1. **Pointer-3 kill is CORRECT and decision-point-independent.**
   Pre-registered gates 2 and 4 fail as stated (edge(60)=−1.41c vs
   required ≤−1.76c; 5/8 months at t=60 — reproduced). The t=45
   confession is moot: gate 6 fails at EVERY t, and t=45 is itself the
   best harvest leg (gross +0.49c, z=0.84, vs 0.72c fee → −0.23c net,
   reproduced). Structural check the memo asserted but did not show: the
   two taker routes to shorting the prev-winner — buy complement at its
   ask vs mint-and-sell prev-winner at its bid — are the SAME route in
   this dataset (opp_ask = 1 − w_bid; gross identical to the cent at all
   four t: −0.36/+0.27/+0.49/−0.00), and the memo priced the cheaper fee
   leg (0.72c vs 0.84c). There is no unexplored expressible harvest.
   Power scope verified: harvest net 95% CI upper +0.91c (se 0.58c) —
   the kill rules out ≥1c-net, not sub-1c, exactly as stated.
2. **Pre-registration integrity: accepted.** File order prereg 06:38:55
   → probe 06:43:31 → memo 06:45:01, mtime = birthtime (no post-hoc
   edit); band 0.50–0.66 and the "deepens with t" gate were inherited
   from the round-3 gap map, not chosen this round. The decisive
   evidence is behavioral: the prereg killed its author's own result
   when declaring t=45 would have passed gates 1–5. Retrofitted preregs
   do not fail.
3. **What dies beyond the pointer — two claims:**
   (a) "The round-3 prior is confirmed" as independent evidence.
   Holdout-only is ~90% of the round-3 union sample that mined the t=15
   whisper; this is instrument cleanup on overlapping episodes, not
   out-of-sample confirmation. The t=30/45/60 depth is new cells, same
   episodes. No independent confirmation of this effect exists or can
   exist on 2025-10..2026-05.
   (b) **The E-002 restatement AS WRITTEN — cell conflation.** The atlas
   row "6/8 months ≤ −1.3c (max +0.07c)" is the t=780+840 pooled cell
   (memo 003 line 101), while the memo's proposed replacement
   "7/8 ≤ −3c" is the t≥885 cell. Mantis recut of the ACTUAL 780+840
   cell on fresh books: 2026-01 −1.23c → **−0.22c** (n 1,255→1,126),
   2026-02 −0.43c, 2026-05 +0.19c — the correct restatement of that row
   is WEAKER, not stronger. Cartographer instruction: restate the two
   cells separately — t≥885 monthly fresh is 8/8 ≤ −1.09c (verified:
   −8.14/−6.72/−3.39/−1.09/−3.20/−3.21/−3.92/−4.61; E-002's standing
   falsifiable claim survives), and the 780+840 channel has 3/8 fresh
   months inside fee (2026-01 −0.22, 2026-02 −0.43, 2026-05 +0.19).
   Do not paste the t≥885 numbers over the 780/840 row.
4. **Verified into the map (cite, do not re-derive), with one caveat
   the memo underplays.** Calibration fact: prev-winner in-band
   −1.26/−1.72/−1.92/−1.41c at t=15/30/45/60 (n=7.0–7.7k), deepening on
   fresh books (−1.96/−2.17/−1.61), t=45 CI [−3.06,−0.78]. Caveat:
   regime concentration — at the declared t=60 the last three resolved
   months are +0.69/−0.45/+0.94 and 2026-05 is positive at every t;
   the tax lives in 2025-10..2026-02 (+2026-04 at t=45), and the
   distrusted 2025-10 carries the deepest cells (−3.73/−4.37).
   Falsifiable claim (a) is genuinely at risk on new months. Staleness
   audit: verified exact, including the negative result (2025-10/11
   regime, not instrumentation; PR-002 footnote stands; 2026-01 endgame
   is the stale pocket, 84.7% fresh, p90 327s). One immaterial
   overstatement: primary 2025-11 t=60 moves 0.19c under the age
   filter, not "<0.1c".

retryOnlyIf (binding, memo's proposal adopted with a tightening):
reopen pointer 3 only on (i) ≥2 newly resolved months >2026-05 where
prev-winner in-band stays ≤ −1c gross at t∈{30,45} AND the complement
harvest leg clears 156bps×ask net at z≥2 on those months alone; or
(ii) an engine-side maker-fill instrument (same gate class as OL-001).
No re-slicing of bands/t/decision-points on 2025-10..2026-05 — the
harvest question needs ~29k in-cell episodes and the resolved universe
holds ~7k.

— mantis, round 4 (memo 004 = 1st of quota window 004–006; SURVIVES
budget intact)
