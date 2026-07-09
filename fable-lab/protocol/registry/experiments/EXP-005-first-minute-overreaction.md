# EXP-005 — first-minute overreaction

## Spec

- **Registered:** 2026-07-09 (commit: the first commit touching this file — the
  validator checks it against run creation times)
- **Idea:** IDEAS.md entry 6 "First-minute overreaction"  **Parent lineage:** none
- **lineage_cells:** 1
- **Mechanism class:** `time-structure`
- **Prior note:** registered AFTER LESSONS E10 (EXP-003 found fast jumps
  priced exactly fairly mid-episode), which lowers this idea's prior; the
  EXP-003 Judge explicitly ruled that result funds neither momentum nor
  reversal at the jump trigger, so the first-minute regime remains an open,
  cheap question — this probe is the decisive test, and kill is the
  expected outcome.
- **Hypothesis (who loses and why):** Traders who anchor the opening quotes
  before the book has found the window's baseline overpay for early
  direction: within the first minute, implied probability that has already
  moved far from 0.5 reflects overreaction to the first ticks of the spot
  move rather than 15 minutes of remaining two-sided risk. Fading it (buying
  the cheap side) collects the overshoot. If early deviations are instead
  informative (spot genuinely moved), the cheap side wins no more often than
  its ask implies.
- **Falsifiable prediction:** Conditional on |UP mid − 0.5| ≥ 0.15 within
  the first 60s of the episode (first recorded tick ≤ 30s — late-start
  guard, CAPABILITIES §2; entry ask in [0.05, 0.5]; uncrossed book —
  LESSONS E6), the faded (cheap) side's realized win rate exceeds the mean
  entry ask (win rate > mean(entryAsk) from intent_meta, gross EV/share > 0
  pre-fee). If win rate <= mean ask, early deviations are informative or
  fairly priced and the mechanism is contradicted. Secondary diagnostic:
  entered fraction must be substantial; near-zero entries = design failure
  (deviations of 0.15 in the first minute may simply be rare), not evidence.
- **Strategy:** `fable-lab/strategies/time-structure/EXP-005.ts`, id `fable-exp-005`
- **Primary parameter cell:** `--param minDev=0.15 --param maxElapsedSec=60 --param maxFirstTickSec=30 --param minAsk=0.05 --param maxAsk=0.5 --param shares=100`
- **Robustness neighborhood:** minDev ∈ {0.10, 0.15, 0.20} × maxElapsedSec ∈
  {30, 60, 120}; other params fixed; judged on sign-smoothness only.
- **Simulator-bias exposure (CAPABILITIES §4):** Taker-only FOK entry
  clamped to visible depth at bestAsk — pessimistic side (156 bps taker fee;
  cheap-side asks near 0.15-0.35 sit in the mid fee zone). Optimistic
  dependencies: costless settlement, recorded-book trust (E6 guard), and
  the late-start guard depends on `ts_exchange_ms`-derived tick timestamps
  being honest about when recording began — the firstTickSec distribution
  in intent_meta is the diagnostic.
- **Windows (computed by tools/universe.ts at registration):**
  - Exploration: `market_start_ms` < 1777237200000 (2026-04-26T21:00:00Z)
  - Holdout: `market_start_ms` >= 1777237200000 and <= 1781429400000, one-shot
    (upper bound = last eligible market at registration; markets accruing
    later belong to no window)
- **Sample rules:** probe = `--random --limit 500 --to-ms 1777237200000`;
  main = extend to full exploration window; holdout = full holdout window.
- **Decision rules (copied from EPISTEMOLOGY at registration):**
  - probe kill: q̂ ≤ 0 with t ≤ −1, or prediction contradicted
  - main advance: t ≥ 2 on primary cell (lineage_cells=1, p-bar 0.023) +
    battery pass + bias classification not simulator-favored
  - holdout confirm: t ≥ 2 on holdout alone
- **Latency curve points:** delay ∈ {0, 150, 300}, jitter 0

## Runs (append-only)

- 2026-07-09 — smoke (EXP-005-smoke, 10 markets): green plumbing, 4/10
  entered — healthy entry rate at the primary cell; never evidence.

- 2026-07-09 — run 312, batchUid `EXP-005-probe`, N=500, latency pinned
  DELAY=0/JITTER=0 (D8). Decisive readout, verbatim:

  ```
  === results: run 312  batch EXP-005-probe ===
  strategy fable-exp-005  params {"maxAsk":0.5,"minAsk":0.05,"minDev":0.15,"shares":100,"maxElapsedSec":60,"maxFirstTickSec":30}
  status completed  mode telonex-delta/delta-typed/local-or-download-from-r2-to-local
  N=500  played=156  skipped=344  failures=0
  pnlTotal=20.05  EV/market=0.0401  CI95=[-1.8033, 1.8835]
  std=21.0303  q=0.0019  t=0.0426
  winRate(played)=0.3462 (54/102)
  fees=60.6  fee/grossWins=0.0245  maker/taker=0/156 (makerShare=0)
  days=140  positiveDayFrac=0.3143  best=2026-04-09:121.42  worst=2025-12-27:-108
  ```

  Prediction check (`tools/entry-check.ts --exp EXP-005 --batch
  EXP-005-probe`): entered 156 (31%, substantial), mean entry ask 0.3583,
  win rate 0.3462, margin −0.0121, gross EV/share −0.01212 — PREDICTION
  CONTRADICTED.


## Verdicts (append-only)

- 2026-07-09 — stage probe, fresh-context Judge (JUDGE.md), verbatim:

  - stage: probe
  - decision: kill
  - read: N=500 q=0.0019 t=0.0426 EV/market=0.0401 CI95=[-1.8033, 1.8835]
  - prediction check: CONTRADICTED. The spec requires the faded side's win
    rate to exceed the mean entry ask (win rate > mean(entryAsk), gross
    EV/share > 0 pre-fee). Measured: win rate 0.3462 vs mean entry ask
    0.3583 (difference −0.0121), gross EV/share −0.01212 pre-fee. The
    secondary design-failure clause does not apply: 156/500 = 31% entered,
    substantial.
  - battery: n/a at probe (spec runs the robustness battery at Stage 2 only)
  - simulator-bias classification: clean — taker-only FOK entries
    (maker/taker = 0/156, makerShare=0) clamped to visible depth with the
    full 156 bps taker fee applied is the pessimistic side of the
    simulator; none of the optimistic dependencies (maker fills in thin
    books) contribute to the result.
  - lineage-adjusted bar: lineage_cells=1, so the bar is unadjusted (t ≥ 2,
    p ≤ 0.023). Not met and not relevant to the kill: t = 0.0426 is
    indistinguishable from zero, and the probe kill rule triggers on the
    prediction clause regardless.
  - required next step: append this verdict to EXP-005; close the lineage
    (no iterate — the mechanism itself, not the implementation, failed) and
    distill the mechanism-level lesson (first-minute deviations ≥0.15 are
    fairly-to-informatively priced) into LESSONS.md citing EXP-005.
  - reasoning: The spec's probe kill rule is disjunctive — "q̂ ≤ 0 with
    t ≤ −1, or prediction contradicted" — and the second clause fires
    cleanly: the mechanism's entire claim was that early large deviations
    are overreactions, operationalized as win rate > mean entry ask on the
    faded side, and the mechanical check shows the cheap side wins slightly
    *less* often than its ask implies (0.3462 vs 0.3583, gross EV/share
    −0.012 pre-fee, before the 156 bps taker fee makes it strictly worse).
    The marginally positive net EV/market (0.0401, t=0.04, CI spanning
    ±1.8) is pure noise and cannot rescue a contradicted mechanism; iterate
    is reserved for "prediction holds but implementation leaks PnL", which
    is explicitly not the case here. This is also the outcome the spec
    itself anticipated ("kill is the expected outcome" given LESSONS E10):
    early deviations look informative or fairly priced, consistent with
    EXP-003's finding that fast moves are priced fairly. With the
    tie-breaking rule that ambiguity goes against advancement, and no
    ambiguity even present, the verdict is kill.
