# BATCH-002 — mechanism-gap screens (post-signal-map)

_Frozen session 61, 2026-07-11, per SCREENING.md (D49 + amendments).
Context: SIGNAL-001's pre-committed barren branch fired (SIGNAL-MAP §3:
zero buyer-favorable candidates on the feature plane; SIGNAL-002 NULL on
cross-episode axes) — this batch therefore aims at MECHANISM-level gaps,
plus one disclosed warm-mirror shot. Freeze = this commit; strategies
`strategies/screens/SCR-005/006/007*.ts` committed alongside; cells are
the schema defaults. Fleet sample rule: `--random --to-ms 1772323199999`
(discovery only), latency pinned per D8; N=500 default, SCR-006 N=2000
under the D49-amendment-2 low-incidence exception. All three run
worst-queue (fleet-runnable; no touch mode in this batch). Maker
screens inherit D14 model-conditionality._

## Mini-specs (frozen)

### SCR-005 — deep resting bid / overshoot catcher (IDEAS #18)
- mechanism: GTC bids `depth=0.10` below mid-implied fair, both sides,
  60-750s, hold fills to settlement. A worst-queue fill = the market
  swept ≥10c through pre-move fair inside a 15m binary; the bet is that
  sweeps of that size overshoot (liquidity vacuum) more than they
  inform.
- not-a-reskin: EXP-006/007/E19 quoted 1-3c from fair (regime-gated);
  the 5-15c distance regime is unmeasured. Taker-after-move is
  E10/E21/E22 (different instrument: they paid the adjusted ask; this
  is filled AT the swept price, zero fee).
- aim: unaimed (mechanism gap on the distance continuum).
- strategy: `screens/SCR-005-deep-bid.ts` (`fable-scr-005`), defaults.
- prediction: EV per played market > 0 (worst-queue; model-conditional
  per D14 — a kill closes the punch-through-backtestable version).
- kill: default bars (q̂/t over all N per D49 amendment 1).

### SCR-006 — late favorite after wide range (IDEAS #19)
- mechanism: one FOK taker buy of the favorite (ask ∈ [0.65, 0.98]) at
  the first valid tick ≥ 850s when the running UP-mid range ≥ 0.30
  (range trusted only if first observed tick ≤ 60s).
- aim: DISCLOSED warm-mirror shot — SIGNAL-001 DOWN o850 HI range q4
  d=+4.51c z=+3.10 n=255 (WARM, sub-bar, licenses nothing by the frozen
  map rules; screens are allowed unaimed or weakly-aimed ideas). The
  screen re-samples the same discovery window that produced the warm
  cell — IN-SAMPLE OVERLAP DISCLOSED: survival here is NOT independent
  confirmation; graduation (full lifecycle, reserve) is the real
  out-of-sample test. Kill-biased as all screens. The 0.30 range
  threshold is a pre-freeze judgment value (the scan's q4 boundary is
  rank-based and unpublished); no post-results tuning.
- not-a-reskin: EXP-001/E14 killed UNCONDITIONAL tail-taking at
  minAsk=0.95; CAL-001/E20 scanned path-unconditional fixed-time state.
  This conditions on realized range (a path feature outside every CAL
  axis) and buys 0.65-0.98, not the 0.95+ tail.
- strategy: `screens/SCR-006-range-favorite.ts` (`fable-scr-006`),
  defaults.
- sample-size deviation (D49 amendment 2): N=2000. Incidence arithmetic:
  favorite-side HI-ask at 850s with range ≥ ~q4 ≈ 5-15% of markets
  (scan cell n=255 per side-quintile over 8,127; both-side favorite
  gate with an absolute threshold lands in that band) → expected played
  ≈ 100-300 at N=2000 vs ~25-75 at N=500, which could not reach the
  SURVIVE bar (minority ≥ 30 at winRate ~0.8 needs ≥ ~150 played).
- prediction: winRate(played) > mean entry ask + fee drag (EV per
  played market > 0 net of the 156 bps fee).
- kill: default bars.
- E14 skew rule applies: SURVIVE additionally needs minority-outcome
  count ≥ 30.

### SCR-007 — filled-maker instant lock (IDEAS #20)
- mechanism: GTC bids `delta=0.02` below fair both sides (30-870s); on
  a maker fill at p, immediately FOK-buy the other side at its current
  ask a (same-tick book; engine passes lastMarket to onAccountEvent).
  The pair settles at $1 → PnL per locked pair = 1 − p − a − fee(hedge
  leg). Bet: at the sweep instant the opposite ask lags (transient
  two-sided dislocation conditional on our fill). Unhedged residue (FOK
  misses, hedge-ask > 0.98, depth 0) stays directional and is expected
  to LOSE per E16 — included in the screen's EV, disclosed.
- not-a-reskin: EXP-002/E9 measured STANDING top-of-book ask sums (none
  < 1 net of fees in uncrossed states, zero entries at N=500). This
  measures FILL-CONDITIONAL transient sums — a state the standing scan
  never sampled. Unlike EXP-006/007/E19/SCR-004*, the maker fill's
  information content is neutralized when the lock completes (pair is
  outcome-neutral); the bet is book-latency, not direction.
- aim: unaimed (mechanism gap: settlement-channel × maker-channel
  interaction).
- strategy: `screens/SCR-007-fill-lock.ts` (`fable-scr-007`), defaults.
- prediction: EV per played market > 0 (worst-queue on the maker leg;
  model-conditional per D14; note the model is CONSERVATIVE for the
  maker leg but the hedge leg pays real taker fee at the recorded ask —
  no simulator favor on the hedge side).
- kill: default bars.

## Feasibility smokes (counts only, no PnL — E15/EXP-006 discipline)

_Run 2026-07-11 session 61, oldest-15 discovery markets, local
`--sequential`, latency pinned 0/0 (in-log), batchUids
`SCR-00X-smoke2`. Counts: SCR-005 3/15 played (5 maker fills — deep
bids fill rarely, as designed); SCR-006 4/15 entered (oldest markets
are wide-range-heavy; discovery-wide incidence expected lower, the
N=2000 deviation stands); SCR-007 14/15 played, both legs live (hedge
FOK fired 255 times against ~360 maker-leg events). All plumbing
green; NO cell modified post-smoke (cells are the schema defaults).
Disclosure per BATCH-001 precedent: the engine's end-of-run summary
prints pnl lines for smoke samples; read for plumbing verification
only, cells unchanged after reading._

## Pre-verdict submission note (2026-07-11, session 62 — recorded BEFORE any verdict read)

The session-61 submission double-enqueued SCR-005: runs 462 and 463 both
carry batchUid `SCR-005-screen`, identical cmd (spec-conformant: random
500, `--to-ms 1772323199999`, `fable-scr-005`), distinct submission
uids, created 7s apart (18:48:53 / 18:49:00 db-local). Resolution, fixed
OUTCOME-BLIND (no statistic of either run read at the time of this
note): **run 462 (first enqueued, lowest id) is canonical; run 463 is
VOID** — its statistics are never read, by this batch or any future
work. Rationale: the freeze says N=500, so pooling would be a post-hoc
sample-size change; picking by enqueue order is the only rule available
before outcomes are seen. SCR-006 / SCR-007 aggregates were still
in-flight (Redis waiting-children) at the time of this note.

## Verdicts (append-only after runs complete)

_Read 2026-07-11 session 62 via `tools/results.ts` (q̂/t over ALL N —
the D49-amendment-1 convention). Runs: SCR-005 = 462 (canonical per the
pre-verdict note; 463 VOID, never read), SCR-006 = 464, SCR-007 = 465.
All three cmds verified spec-conformant (random, --to-ms 1772323199999,
frozen strategy ids, N per spec); one run per batchUid after the 462/463
resolution; 0 failures in all three._

| screen | run | N | played | EV/mkt | q̂ | t | winRate(played) | wins/losses | maker/taker | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| SCR-005 deep bid | 462 | 500 | 22 | −0.20 | −0.0218 | −0.49 | 0.3636 | 8/14 | 27/0 | **kill** |
| SCR-006 range favorite | 464 | 2000 | 774 | +0.2215 | +0.0165 | +0.74 | 0.8915 | 690/84 | 0/774 | **kill** (default) |
| SCR-007 fill lock | 465 | 500 | 398 | −6.8046 | −0.1418 | −3.17 | 0.4196 | 167/227 | 1488/363 | **kill** |

- **SCR-005 — kill.** Branches fired: q̂ ≤ 0 AND prediction contradicted
  (EV per played = −100/22 ≈ −4.55, winRate 0.36). Only 22/500 markets
  ever filled a 10c-deep bid; when they did, the sweep was informative,
  not overshoot. Model-conditional per D14 (worst-queue): closes the
  punch-through-backtestable version of the 5-15c distance regime.
- **SCR-006 — kill (default outcome).** No explicit kill branch fires
  (q̂ > 0; prediction held: EV per played = +443.07/774 ≈ +0.57 net of
  fees; E14 minority count 84 ≥ 30 — adequately powered), but SURVIVE
  requires t ≥ +1.5 and t = +0.74. Per the frozen bars kill is the
  default when SURVIVE is not earned. Interpretation, bounded: the warm
  SIGNAL-001 cell (d=+4.51c, z=+3.10, n=255) diluted to +0.57c/share on
  a 4× larger partially-overlapping re-draw of the same window — the
  scan figure behaves like a winner's-curse-inflated local maximum, and
  even its in-sample replay cannot clear a t=1.5 bar. No graduation; the
  in-sample-overlap disclosure makes even this weak positive
  non-confirmatory by construction.
- **SCR-007 — kill.** Branches fired: q̂ ≤ 0, t ≤ −1 (t = −3.17), and
  prediction contradicted (EV per played ≈ −8.55, winRate 0.42, CI95
  excludes 0). The opposite-side ask does NOT lag a maker fill
  favorably: locking pairs at fill-time books 1 − p − a − fee < 0 on
  average — fill-conditional transient sums are ADVERSE, sharpening
  E9 (standing sums never < 1) with a fill-conditional measurement.
  Model-conditional per D14 on the maker leg; the hedge leg had no
  simulator favor (real ask + fee), and the loss is dominated by the
  economics of the pair itself.

_Checker note (2026-07-11, batch checker finding 2): run 465 shows
wins+losses = 394 vs played = 398 — results.ts counts only markets with
nonzero PnL as wins/losses (4 played markets settled flat), while
winRate uses the played denominator (167/398 = 0.4196). Tool-convention
quirk faithfully transcribed, not an error. Full checker report:
`knowledge/AUDIT-2026-07-11-BATCH-002-CHECKER.md`._

## Post-verdict decomposition of run 465 (idea-generation mining, session 62)

_Read AFTER the kill was judged and checker-verified; licenses nothing,
cited only by E27/D50. Group-by over `backtest_run_markets` (run 465) by
hedge completeness:_

| group | markets | maker fills | taker fills | mean PnL | total PnL |
|---|---|---|---|---|---|
| fully locked (taker ≥ maker) | 21 | 44 | 44 | −23.68 | −497.37 |
| partially hedged | 179 | 847 | 319 | −12.56 | −2,248.91 |
| zero hedged | 198 | 597 | 0 | −3.31 | −656.00 |
| no maker fill | 102 | 0 | 0 | 0.00 | 0.00 |

Hedge intensity made losses monotonically worse (≈ −11.3 per fully
locked pair): the locks were the poison, not the directional residue.
Structural cause: same-tick mirror books (CAL-001 amendment #12) make
"the opposite ask lags" impossible by construction — see E27 and D50.
