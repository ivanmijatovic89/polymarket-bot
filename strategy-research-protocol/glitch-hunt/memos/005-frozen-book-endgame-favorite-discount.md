# Anomaly Memo 005 — Frozen-book endgame favorite discount (+ the mid-window sweep came back empty-and-underpowered)

Round 5, 2026-07-10, gabagool. Pre-registration:
`census/round5_prereg.md` (on disk before the first hypothesis query;
verify mtimes: prereg 06:59 → probe `census/round5_probe.sql` → this
memo). Targets were gap items 1 and 2. Items 3/4 untouched;
memorylessness family untouched (M-003 open gate); prev-window outcome
used nowhere (K-004 ban).

Instruments: `census/checkpoints.parquet` (Part A),
`census/endgame_checkpoints.parquet` + `census/friction_map.csv`
(Part B). All cuts below are the prereg's declared cells except two
items explicitly labeled POST-PREREG (a control and a confession
check), both counted in the debt ledger.

---

## PART B FIRST — the finding: stale-quote endgame pocket (gap item 2)

### Invariant

At t ∈ {885, 897, 899}, books whose last recorded event is more than
60s old (stale := age_ms > 60,000), standing ask taken at its quote,
settled at resolution, both tokens, all 8 months pooled
(2025-10..2026-05 holdout, 17,126 episodes):

| ask band | n (t=899) | avg ask | P(win)    | gross     | net (156bps) | z        | p50 age |
| -------- | --------- | ------- | --------- | --------- | ------------ | -------- | ------- |
| ≤4c      | 30        | 2.2c    | 3.3%      | +1.1c     | +1.1c        | +0.3     | 135s    |
| 4–20c    | 98        | 12.9c   | 3.1%      | **−9.9c** | −10.1c       | **−5.7** | 280s    |
| 20–80c   | 1,007     | 50.5c   | 49.9%     | −0.7c     | −1.5c        | −0.4     | 2,305s  |
| 80–96c   | 100       | 87.8c   | **97.0%** | **+9.3c** | **+7.9c**    | **+5.4** | 280s    |
| >96c     | 24        | 98.3c   | 95.8%     | −2.5c     | −4.0c        | −0.6     | 135s    |

The numbers are essentially identical at t=885 and t=897 (same frozen
episodes: +9.29/+9.25/+9.25 gross across the three t) — the three t
rows are ONE observation set, effective n = 100 episodes for the
favorite cell, ~98 for the longshot mirror.

The 80–96c and 4–20c rows are the same books seen from the two token
sides (n 100 vs 98): **a book frozen with an 87c favorite resolves to
that favorite 97% of the time.** Under martingale pricing with freezes
independent of the market, P(win | last quote 87.7c) should be 87.7%.
It is 97.0%. Note this is NOT explained by "the price is old and has
since diffused" — diffusion alone preserves the conditional mean; the
9.3c gap requires either non-random freezing or a book that had
already stopped tracking before it stopped updating.

The 20–80c row is the placebo and it behaves: books frozen near 50/50
(median age 38 minutes — effectively never-quoted episodes) resolve
50/50, gross −0.7c. The structure lives exactly where the freeze
caught a directional state.

### Fresh-book control (POST-PREREG, labeled, in the ledger)

Same cells, age_ms < 60,000 — the treatment check the prereg should
have declared and didn't:

| t   | band         | n     | gross     | net   |
| --- | ------------ | ----- | --------- | ----- |
| 899 | 80–96c fresh | 630   | **−2.3c** | −3.7c |
| 899 | 4–20c fresh  | 647   | −6.4c     | −6.6c |
| 885 | 80–96c fresh | 1,606 | +0.4c     | −1.0c |
| 885 | 4–20c fresh  | 1,703 | −2.7c     | −2.8c |

Staleness is the treatment: the same displayed 80–96c ask is fairly-
to-over-priced when fresh (consistent with E-001) and ~9c underpriced
when frozen — an **+11.6c swing at t=899** attributable to book age.
The longshot side deepens from −6.4c fresh to −9.9c stale (consistent
with A-001's re-pricing of E-002's 2026-01).

### Where the pocket lives (B-i, descriptive)

Stale share at t=897 by month: 2025-10 0.1%, **2025-11 2.0%,
2025-12 6.8%, 2026-01 15.3%** (p90 age 327s), then 2026-02..05 at
0.0–0.3%. Episodes frozen across the ENTIRE endgame grid (age>60s at
all six checkpoints): 40 (Nov) → 173 (Dec) → 333 (Jan) → ~0 after.
2026-01 is not unique, it is the peak of a Nov→Jan continuum that
disappears in February. The d-band favorite cell decomposes:
2026-01 n=80 gross +9.5c, 2025-12 n=14 +5.0c, 2025-11 n=3 +10.7c —
the effect exists in both sizable pocket months, positive in each age
bucket (60–120s: +10.2c jan / >120s: +8.0c jan, +5.4c other) and at
all three t.

### Mechanism (if the books are real)

- WHO donates: the owner of an abandoned resting ask. Mid-window, spot
  moves decisively away from the strike; quoting attention leaves the
  now-boring market; the last standing ask fossilizes at the
  pre-move price. The 87c fossil on a token that has meanwhile become
  a ~97% winner is a 9c/share gift to any taker.
- WHY nobody collects: the prize is ~$130 at best ask (med ask_sz 149
  shares × 87.8c), ~$1,540 in the top 3 (1,756 shares) — beneath bot
  table stakes for a monitor-every-dead-book operation; taker
  attention in these markets demonstrably follows activity (S-001's
  entire pattern is donations at resting quotes). This is the first
  measured shape that is NOT an S-001 sink: a standing stale ask is
  takeable by definition — S-001-EXEMPT per the gap map.
- WHY it's symmetric: the frozen longshot ask (4–20c mirror, −9.9c) is
  the same fossil seen from the losing side — buying it is paying 13c
  for a token the market had already condemned before going quiet.

### Glitch shape

Entry: taker-buy the favorite-side standing stale ask (book age >
120s, ask ∈ [0.80, 0.96]) at t=885, IOC at the quote. Exit: hold ≤15s
to settlement — no exit path needed, no churn (LESSONS take-profit
trap n/a). Loss tail: bounded per share at the ask paid (−87.8c worst
case), measured tail frequency 3/100; the tail is inside the
calibration measurement, not an unmeasured conditional (contrast
OL-001, where P(win|filled) was unobservable). Expectancy at measured
numbers: +7.9c net per share.

BUT the fill is the load-bearing fiction risk: if the frozen book is a
RECORDING gap rather than a market state, the real ask at t=885 is
~97-99c; an IOC at 87c then fills only when the real ask has moved
BELOW 87 — i.e., exclusively when the favorite is collapsing. The
fiction scenario converts the strategy from +7.9c/share to
adverse-selection-only fills. A backtest on this data CANNOT
adjudicate that — it would fill against the recorded (possibly
fictional) book and reproduce +7.9c by construction. This is why the
finding is not promotable from recorded data alone, independent of n.

### Capacity

Med best-ask 149 shares ≈ $130; med top-3 1,756 shares ≈ $1,540 —
below the 3–4k bar at best ask, marginal at top-3 (top-3 fills walk
the fossil book, prices unmeasured here). Frequency: ~100 in-band
episodes per ~3,000-episode pocket month, and the pocket is
REGIME-EXTINCT since February 2026 (stale share 0.0–0.3%). Capacity
score would be near-floor today regardless of validity.

### Confession (the most likely artifact)

**Recorder gap, not market state.** The freeze months (Nov→Dec→Jan,
then abruptly ~zero) and the run structure — frozen episodes come in
contiguous multi-window runs (2026-01: 333 episodes in 121 runs, mean
2.8 consecutive windows ≈ 40-minute outages; 2025-12: 55 runs × 3.1)
— look like feed/recorder infrastructure incidents that were FIXED in
early February, not like a market behavior that stopped. Supporting
ambiguity: of 632 books stale at t=885, 626–629 are still frozen at
897/899 (only 3–6 resume) — the freezes almost never end within the
window, so no post-gap `book` snapshot exists inside our range to
contradict the reconstruction (2026-01's endgame hard self-check is an
unremarkable 1.1–1.4% precisely because resumptions are absent, not
because the books are verified). From recorded data alone,
"market went silent" and "we went deaf" are indistinguishable. The one
discriminating fact we DO have: martingale says even a recorder gap
independent of the market should measure gross ≈ 0 (an old fair price
is still a fair forecast), and we measure +9.3c/−9.9c — so EITHER the
last recorded quotes were already off-market before the gap (fossil
asks, takeable, glitch real) OR outages correlate with volatile spot
moves (plausible: load-driven feed failure during exactly the moves
that decide these markets — kills independence AND takeability).
Load-correlated outage is the artifact I would bet on.

### Disposition under my own prereg — NOT PROMOTED

The prereg's CANDIDATE gate required a pre-declared cell at n ≥ 200
with net ≥ +2c. The favorite cell delivers n = 100 (episodes, after
collapsing the three t). **Fails the declared n floor** — the round-4
pattern repeats: the prereg kills its author's promotion. The DEAD
clause technically fires for the pooled question (all n≥200 cells:
primaries −1.4c ± 2.8, 20–80c splits ≤ 0). Per the gap map's baked-in
caution and the above, the correct filing is:

1. **Pre-registered future-pocket target (locked, no re-tuning):** on
   any post-refresh month with endgame freezes (stale share > 2% at
   t=897), the rule "book age > 120s at t=885, standing ask in
   [0.80, 0.96], taker-buy, hold to settlement" FIRES iff pooled gross
   ≥ +4c at n ≥ 60 in-band episodes AND the 4–20c mirror ≤ −4c AND the
   20–80c placebo within ±2c of 0. Any change to the age threshold,
   band edges, or t restarts the comparison clock.
2. **Operator verification lead (one question, outside this mission's
   data):** do trade prints exist INSIDE the frozen intervals?
   Polymarket trade history (data-api) or any recorded trade channel
   for, e.g., the 333 frozen 2026-01 episodes would settle
   recorder-gap vs market-dormancy in one afternoon. Trades printing
   while our book stood frozen → artifact, quarantine the pocket and
   flag ALL Nov–Jan stale rows as reconstruction fiction (this would
   also retroactively harden A-001's distrust flag). True silence →
   the pocket is real, and the prereg in (1) is live.

Power scope for the negative parts (M-003 discipline): the pooled
primary (−1.4c ± 2.76c) cannot rule out pooled effects below ~4c; the
≤4c and >96c bands (n 24–30, CI half-widths 7–26c) are unmeasured,
not null.

---

## PART A — friction-priced mid-window sweep t 75–765 (gap item 1, frozen spec): ZERO SURVIVORS, and the real result is a coverage number

Executed exactly as frozen (episode-level, 2c ask bands, both tokens,
n ≥ 150, priced vs p25_spread + 156bps×ask at the same friction cell,
adjacency + 6/8-month gates, p50-spread column per S-001, no
prev-outcome axis). Mirror join for DOWN cells at band 98−b declared
in the prereg; residual ±one-band ask-vs-mid offset confessed.

- Coverage (the headline): the grid holds **4,534 populated cells /
  181,686 token-rows; only 29 cells (0.64%) reach n ≥ 150**, holding
  5,359 rows (3.0%). At census density the frozen spec's own floor
  leaves 97% of the mid-window mass formally unscanned. At n≈150 and
  p≈0.5 the 95% CI half-width is ±2.6–4.0c: this sweep could only ever
  have flagged ~3c+ effects in the handful of dense cells (bands
  46–54 at t ≤ 150; bands 90–98 at t ≥ 600).
- Gate 1 (deviation > friction): 2/29 cells pass — DOWN t=75 band 50
  (dev +2.48c, margin +0.69c, z=0.64) and DOWN t=90 band 50 (+1.97c,
  margin +0.18c, z=0.50). Both are noise on their face (z < 0.7; under
  the null, several gate-1 passers were expected among 29 cells).
- Gates 2–3 kill both: adjacency sign-flips violently (t=75 flanks
  +4.16c / −6.00c; t=90 flanks −10.42c / −2.97c) and months agree only
  4/8, with monthly devs swinging −32.5c..+22.9c at n=11–34/month.
  **Full-stack survivors: 0.** No cell earns the S-001 maker-sink
  label either (the only dev > p50 spread cells are the two flukes
  above).
- Round-6 interleave pre-registration (the sweep's product, since
  survivors were to be the target): with zero survivors there is no
  target-cell bias to carry. Round 6 extracts holdout t ∈ {300, 450,
  600, 690} (gap item 3, grid fixed in round 3) and runs THIS EXACT
  gate stack — same bands, floors, friction pricing, adjacency and
  month gates, S-001 column — as a first scan at ~9.5x density, where
  n ≥ 150 becomes attainable for cells with census n ≥ ~16. The two
  census gate-1 flukes are NOT carried (wrong t, failed gates, named
  noise).

## Comparison-debt ledger

- Part A: 4,534 cells computed, 29 evaluated against gates (all
  reported in aggregate), 2 gate-1 cells detailed + their 16 monthly
  sub-cells (declared axis). Expected full-stack false survivors
  across 29 cells ≈ 0.5; observed 0.
- Part B declared: 3 primaries + 60 split cells (3t × 2 age × 5 band ×
  2 month-groups; 57 populated) + 15 band-marginal rollups of the same
  splits + 48 descriptive stale-share rows + 2 declared artifact
  tables. Effective independent evidence cells ≈ 21 (three t's are one
  observation). Expected |z| ≥ 2 flukes among ~21 independent cells
  ≈ 1; the paired +5.4/−5.7 mirror is not a fluke shape — it is
  either real or systematically manufactured by the artifact named in
  the confession.
- POST-PREREG items (confessed, counted): 6 fresh-control cells,
  1 run-clustering table, 1 d-band month decomposition (7 rows).
- Prior evidence reused, not re-derived: E-001, E-002, A-001, S-001
  cited from ATLAS.

## Falsifiable claim (one sentence)

On any future resolved month whose endgame stale share exceeds 2% at
t=897, standing asks with book age > 120s at t=885 in band
[0.80, 0.96] resolve-win at least 4c above their quote (measured here:
+9.3c gross, n=100, z=5.4, 3/3 pocket months positive) while the
4–20c mirror stays at least 4c below — unless trade prints inside the
frozen intervals show the books were recording fiction, in which case
every Nov-2025..Jan-2026 stale row on this atlas is quarantined with
it.

---

## MANTIS VERDICT — Round 5 (2026-07-10)

**KILL** (both parts; Part B killed-to-preregistration with an UPGRADED
operator lead — see the new evidence below, which the atlas must carry).

### Part A — KILL affirmed as written

1. Reproduced exactly: 29/4,534 cells at n ≥ 150 (0.64%), 2 gate-1
   passers (DOWN t=75/90 band 50, margins +0.69/+0.18c at z=0.64/0.50 —
   inside the ~expected fluke count for 29 draws), both destroyed by the
   frozen adjacency gate (flanks +4.16/−6.00c and −10.42/−2.97c) and
   4/8-month agreement. Full-stack survivors: 0.
2. "Zero survivors, coverage-limited" IS the honest framing: at n≈150,
   CI half-width ±2.6–4.0c means the sweep could only ever see ~3c+
   effects in 29 dense cells; M-003 power discipline followed. "Efficient
   region" would have been the dishonest claim; the memo did not make it.
3. Round-6 re-registration is clean of target-cell bias: the gate stack
   was frozen in round 3 BEFORE any mid-window measurement existed, round
   6 runs on holdout episodes disjoint from the census sample at t values
   the census sweep did not headline, zero cells are carried, and the two
   gate-1 flukes are named and dropped. Approved as a first scan.

### Part B — the measurement SURVIVED every attack I ran; the memo dies anyway

Attacks that FAILED (recorded here because they harden the ghost):

- **Reproduction:** t=899 stale 80–96c: n=100, avg ask 87.75, P(win)
  97.0%, +9.25c gross — to the digit.
- **Run-clustering (the effective-n attack):** the 100 favorite-cell
  episodes collapse to **83 outage runs (70 singletons, max run 4)**;
  run-level mean edge +10.2c, sd 11.8c, **z_runs = 7.9**. Episodes ≠
  runs was the right question and the answer is: the n is real. Note the
  multi-window-run outage signature (2.8 windows/run) belongs to the
  full stale set — i.e. to the 38-minute-old 20–80c placebo books — NOT
  to this cell: the favorite cell is dominated by single-window,
  mid-window freezes (all 100 froze in-window; 0 pre-open).
- **Feed-alive cross-check (NEW instrument — the memo's "market went
  silent and we went deaf are indistinguishable from recorded data" is
  OVERSTATED):** during episode E's frozen tail, the successor market's
  file (epoch+900) records the same wall-clock on the same feed. Run on
  all 100 episodes: **67 neighbor-alive** (successor file received
  events inside the exact frozen interval — recorder demonstrably alive
  while the book stood still), 26 neighbor-silent (ambiguous: outage OR
  unquoted successor), 7 no-next-file. Edge by feed state: **alive
  +9.63c (n=67, 65/67 win, standalone z≈4.6) / silent +7.54c (n=26)** —
  the effect does NOT live in the outage-compatible subset. 2 of the 3
  losing episodes are in the alive subset (the tail is not parked in the
  ambiguous stratum). Consequence: machine-level recorder outage is
  REFUTED for two-thirds of the cell; gabagool's own confessed bet
  (load-correlated feed outage) is now the DISFAVORED branch. The
  surviving artifact scenario narrows to a per-market subscription drop
  (our sub for that one market dying while neighbors lived, Nov→Jan,
  fixed early Feb) — coherent, undischargeable from book data, and
  exactly what the operator trade-print check discriminates.

Why it still dies (numbered):

1. **Replication is structurally unevaluable — twice over.** The pocket
   is Nov-2025→Jan-2026, entirely inside the already-measured holdout;
   the resolved universe ends 2026-05; the pocket is regime-extinct
   after January (stale share 0.0–0.3% for 4 straight months). There is
   no disjoint slice for the replicator to spend, and mission criterion
   4 cannot be met by any query available to this mission. Precedent
   binds: PR-002 (+2.51c net, 6/6 months) and K-004 both died on exactly
   this — replication 0/25 → kill-to-preregistration, not SURVIVES.
2. **The load-bearing question is operator-only.** After my feed-alive
   check, the only remaining discriminator (sub-drop fiction vs real
   fossil, and whether an IOC at the fossil quote fills) is trade prints
   inside the frozen intervals — data this mission cannot observe. A
   SURVIVES buys a replication slice that cannot move the answer; that
   is a donation, not a test.
3. **The author's own prereg kills promotion three ways:** n=100 vs the
   declared n ≥ 200 CANDIDATE floor; the declared direction (H_glitch:
   positive edge concentrated in LOW bands) came back REVERSED (4–20c =
   −9.9c); and the winning band was pre-declared "NOT glitch-shaped
   regardless of sign — mission criterion 2 fails by construction"
   (win capped at +12.2c vs loss tail −87.8c/share, 3/100 measured).
   The memo's "Glitch shape" section re-frames that band post-hoc;
   demerit noted. The finding is a (very strong: z=5.4 vs ~1 expected
   |z|≥2 fluke in ~21 cells) OBSERVED cell, not a predicted one.
4. **Capacity is near-zero even if fully real:** ~$130 at best ask,
   ~$1,540 top-3 (fossil-book walk unpriced) vs the 3–4k bar; ~100
   in-band episodes per pocket month; zero pocket months in the last
   four resolved. Rubric capacity ≈ 1/10 today.
5. Prereg integrity: PASS with one blemish — ordering verified on disk
   (prereg birth=mtime 07:05:17 → probe 07:06:19 → memo 07:12:38; the
   two post-prereg items confessed and ledgered; behavioral tell present
   again: the prereg killed its author's promotion). The memo's stated
   "06:59" for the prereg is wrong by 6 minutes; ordering unaffected.

**retryOnlyIf (binding, two arms):**
(i) **Operator trade-print check** (the memo's lead, now upgraded to
high priority by the feed-alive result) on the Nov–Jan frozen intervals
— start with the 67 neighbor-alive favorite-cell episodes: if trade
prints are ABSENT inside those intervals, the books were real, the
+9.3c fossil discount was a genuine historical money glitch (still
capacity- and regime-dead), and the locked future-pocket prereg below
goes LIVE as written; if prints EXIST inside frozen intervals,
quarantine every Nov–Jan stale row on this atlas and retroactively
harden A-001.
(ii) **The locked future-pocket prereg may FIRE on numbers alone only
if it also passes a feed-integrity gate:** on the new pocket, the
adjacent-window feed-alive check must pass AND trade prints inside the
new frozen intervals must be checked before the fire counts — a future
per-market sub-drop reproduces "gross ≥ +4c, n ≥ 60, mirror ≤ −4c" by
construction, so the numeric criteria alone are re-mineable fiction,
not proof. No change to the age threshold, band edges, or t (clock
restarts per the memo's own lock).

Quota window 004–006: 0/3 SURVIVES consumed; one remains for memo 006.

— mantis
