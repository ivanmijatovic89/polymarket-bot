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

## Verdicts (append-only)
