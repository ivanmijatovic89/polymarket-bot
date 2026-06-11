# Research

Strategy research workspace. The database (`backtest_runs`) holds the **numeric truth**;
these markdown files hold the **reasoning** — hypotheses, decisions, and lessons.

## Running a research session

In a fresh Claude Code session, invoke **`/strategy-research`** (`.claude/commands/strategy-research.md`).
It loads this workspace + memory, knows what's been tried, and drives the loop below
(generate → implement → sweep → validate OOS → judge GROSS-first → record the lesson)
the same way each time.

## The loop

```
CREATE → TEST → DECIDE → (back to CREATE)
```

- **CREATE** — write a candidate spec (hypothesis / mechanism / knobs-as-ranges), then
  implement + register the strategy in `src/strategy/strategyRegistry.ts`.
- **TEST** — expand the knobs into a parameter sweep, run on data, read the verdict vs a baseline.
- **DECIDE** — kill / iterate / promote, and record the lesson here.

## Rules (so we don't fool ourselves)

- Judge a strategy as a **portfolio of its experiments** (the _shape_ of the sweep), never one run.
  A single lucky run is noise; a coherent winning _region_ is signal.
- Compare against a **baseline**, net of fees, with latency on. Watch **GROSS** (PnL before fees)
  separately — it tells you whether the edge exists before execution cost eats it.
- Keep markdown **compact**. Exact metrics live in `backtest_runs`; reference runs by `batch_uid`.

## Operational notes

- Backtests run in the persistent tmux workers, which load the strategy registry **once at startup**.
  After adding/renaming a strategy, **restart the workers** before running, or every market fails
  with `unknown strategy id`.
- Standard run: `--input-mode telonex-delta --read-from local --limit 1000 --symbol btc --timeframe 15m --latest`.

## Families

| family                 | status      | one-line                                                     |
| ---------------------- | ----------- | ------------------------------------------------------------ |
| `spike-reaction/`      | 🔴 KILLED   | reaction to fast mid spikes — edge real but ≈ execution cost |
| `orderbook-imbalance/` | 🟡 PROPOSED | lean with resting-size imbalance (next to build)             |
