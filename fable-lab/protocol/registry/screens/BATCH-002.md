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
