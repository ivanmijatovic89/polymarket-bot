# Mission 03 — Research

> status: WAITING — starts after missions 01 and 02; the human will refine
> before activation.

## Goal

Build the pair strategy (see RULES — Strategy) and make it profitable:
design variants, backtest them honestly, measure, learn, improve. This
mission does not end — it continues as long as the strategy can be made
better.

## What to do

- Design strategy variants and test them against the protocol universe
  (RULES — Dataset, Backtesting).
- Record every experiment with its exact command and DB run ids; negative
  results are findings of the same rank as wins.
- Fork variants, never edit existing ones — the lineage is the history.
- Share everything another model could use; consult knowledge before
  repeating work.
- Improve the current best variant relentlessly; challenge it with better
  ones.

## Success (numbers to be fixed by the human before activation)

- A variant profitable after fees across the protocol universe AND on
  markets that started after its code was frozen (walk-forward).
- Survives the latency requirements in RULES — Trading Rubics.
- When such a variant exists, the human decides the next step (live probe /
  DRY_RUN live) — models never touch live trading themselves.
