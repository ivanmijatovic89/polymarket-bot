# Round 5 pre-registration — gabagool (written BEFORE any hypothesis query)

Date: 2026-07-10. Targets: gap item 1 (friction-priced mid-window sweep,
t 75–765, spec FROZEN from round 3 — restated below without alteration)
and gap item 2 (2026-01 stale-quote endgame pocket, the S-001-EXEMPT
shape). Items 3 and 4 are not touched. The memorylessness family is not
probed (OPEN-GATED per M-003 retryOnlyIf). The prev-window-outcome axis
appears NOWHERE below (K-004 retryOnlyIf ban).

Queries run before this file existed: two schema DESCRIBEs and CSV
header `head`s only (checkpoints.parquet, endgame_checkpoints.parquet,
friction_map.csv, outcomes_all.csv). No outcome, edge, or age
distribution was queried.

## Part A — friction-priced mid-window sweep (frozen spec)

Universe: `census/checkpoints.parquet` ONLY (2,000 census episodes; the
holdout has no coverage at 60 < t < 780 — that is round 6's job).
Unit: one row per (episode, token, t) — episode-level, no duration
weighting (K-001). Tokens: UP (ask = up_best_ask, win = up_won) and
DOWN (ask = down_best_ask, win = NOT up_won). Row eligibility: all four
of up_best_bid, up_best_ask, down_best_bid, down_best_ask non-null and
0 < bid < ask < 1 on the traded token (two-sided both books — matches
the prior instrument convention; the selection effect this induces is
confessed in the memo).

Grid: t_sec ∈ {75, 90, …, 765} (47 checkpoints). Cell = (token, t_sec,
2c ask band), band = LEAST(floor(ask×50)×2, 98). Cell floor n ≥ 150
episodes.

Edge: dev = P(token wins) − avg ask. Fee = 156bps × avg ask.
Friction price of a cell = p25_spread + fee, from `friction_map.csv`
(source='census') joined at (t_sec, band_key) where band_key = ask band
for UP tokens and 98 − ask band for DOWN tokens (mirror identity: a
DOWN ask at a is the UP bid at 1−a, so the down-book cell lives at
up-mid band ≈ 98 − band; the residual ±one-band offset between ask band
and mid band is confessed, not corrected). If the friction row has
n < 30, the cell is FRICTION-UNPRICED: reported, ineligible to survive.

Survivor gates (all three required; frozen — no others added or removed):

1. dev > friction price at the cell (positive taker-buy edge; negative
   deviations are the complement token's positive cell by mirror and
   are covered by sweeping both tokens — route duality, K-004: no
   second door exists and none will be priced).
2. Adjacent-band sign agreement: bands b−2 and b+2 at the same
   (token, t) both have sign(dev) = sign(dev_cell). A neighbor with
   n < 50 counts as FAILING (conservative).
3. ≥ 6/8-month sign consistency: a month agrees iff its cell n ≥ 10
   AND its dev sign matches the pooled sign; ≥ 6 of the 8 calendar
   months must agree.

No z gate (the frozen spec has none); z is reported per cell as
information only.

Round-4 additions (do not alter the gates):
(a) secondary column per surviving/near cell: dev − med_spread (p50
FULL spread at the friction row). If 0 < dev ≤ med_spread the cell
is labeled MAKER-SINK on sight (S-001) and routed accordingly (fat + month-stable → OL-class operator lead; thin → graveyard note),
NOT proposed as a taker glitch.
(b) prev-window outcome is BANNED as an axis (K-004 retryOnlyIf).

Axes are exactly (token, t, band, month). No re-banding, no extra
conditioning variables, no post-hoc t sub-grids.

Disposition (pre-committed): survivors are NOT memo claims at census
density — n ≥ 150 at p≈0.5 gives 95% CI half-width ≈ ±2.6c, so this
sweep can only flag ~3c+ deviations. Survivors become the pre-registered
round-6 interleave target list (locked verbatim in the memo; round 6
extracts holdout t ∈ {300,450,600,690} per gap item 3 and re-measures at
~9.5x n with NO re-tuning). Zero survivors → the region is reported
scanned-at-census-density with the power scope above (M-003: a negative
claim needs power arithmetic); sub-3c structure remains formally
unscanned until round 6.

Capacity column (reporting only, no gate): med_top3_ask at the friction
row for UP cells; med_top3_bid at the mirrored row for DOWN cells
(down-ask depth = up-bid depth by book complementarity).

## Part B — stale-quote endgame pocket (gap item 2, S-001-EXEMPT)

Universe: `census/endgame_checkpoints.parquet` (17,126 holdout
episodes, one-sided books kept). Stale := age_ms > 60,000.

B-i (descriptive, no gates): share of stale rows by month × t ∈
{780, 840, 870, 885, 897, 899}; p90 age per month at t=897. Question:
is 2026-01 unique or just the worst of a continuum.

B-ii (the edge question): taker-buy the STANDING STALE ASK, hold to
settlement. Row eligibility per token side: ask non-null, ask_sz > 0,
0 < ask < 1, state ∈ {two_sided, ask_only}, age_ms > 60,000,
t ∈ {885, 897, 899}. Edge_net = P(token wins) − avg ask − 156bps × avg
ask.

Primary cells: per t, pooled both tokens, all asks. Pre-declared
secondary splits (the ONLY splits that will be reported as evidence):

- age bucket: 60–120s vs >120s;
- coarse ask band: ≤4c / 4–20c / 20–80c / 80–96c / >96c;
- month group: 2026-01 vs all-other-months pooled.

Direction, declared before looking: H_glitch = information arrives
after quote death, so stale asks are systematically cheap on eventual
winners → positive net edge, concentrated in LOW ask bands (the only
glitch-shaped cell: loss tail bounded at the ask paid). H_adverse
(the prior, from A-001's own re-pricing of E-002: removing 2026-01
stale rows moved the 4–20c cell from −4.14c to −1.09c, i.e. the stale
subset carried EXTRA negative buy-edge) = surviving stale asks are
picked-over leftovers standing ABOVE fair → edge ≤ 0. The prior favors
H_adverse. High ask bands (≥80c) are declared NOT glitch-shaped
regardless of sign: win capped at 1−ask, loss tail = ask (mission
criterion 2 fails by construction there).

Claim thresholds:

- CANDIDATE iff some pre-declared cell with n ≥ 200 shows net edge
  ≥ +2c AND the other age bucket at the same (t, band) has the same
  sign AND at least one adjacent pre-declared t agrees in sign. Even
  then, per the gap map's baked-in caution, the finding is filed as a
  pre-registered target for FUTURE stale pockets (post-refresh months),
  not a living anomaly — the population is essentially one month.
- DEAD iff every cell with n ≥ 200 has net edge ≤ 0 or its 95% CI
  covers 0. Power scope mandatory either way: per-cell 95% CI and the
  smallest effect detectable at z=2.
- 2c effects and below: the A-001 DISTRUST FLAG requires fresh-book
  recuts for sub-2c 2026-01 endgame effects; this analysis is BY
  CONSTRUCTION on stale books and is exempted by the gap map for the
  staleness question itself, but any sub-2c result here will not be
  cited as a market fact — only as pocket description.

Artifact check (mandatory, descriptive): recorder-gap vs market
dormancy is the load-bearing ambiguity — if age_ms measures OUR feed
going quiet rather than the market going quiet, the "standing" quote
may not have existed and taking it is fiction. Checks from the same
parquet only: (1) among rows stale at t=885, the age at t=897/899 of
the same episode (age growing by exactly the t-gap ⇒ freeze continued;
age reset ⇒ events resumed mid-endgame); (2) count of episodes whose
book never updates across all six endgame checkpoints. Whatever these
show, the recorder-gap confession stands in the memo — it cannot be
fully discharged from recorded data alone.

## Comparison-debt ledger commitment

Every cell inspected in Parts A and B is counted in the memo's ledger,
including friction-unpriced and n-floor-failing cells. Expected false
survivors under each gate stack are computed and reported next to any
survivor count. No cut not listed in this file is reported as evidence;
anything beyond it is confession-only. One surveyor drilldown is
available via the boss; if used, its question is appended to this file
BEFORE it runs, with its own gates.
