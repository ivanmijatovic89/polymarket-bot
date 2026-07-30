# Proposals — pair-fable

Engine bugs, improvement suggestions, and rubric questions, recorded as they
arise (RULES: Human interface). One entry per proposal. The human flips
`status:`; the agent acts on `accepted`, drops `rejected`, never deletes
entries.

Entry format:

```
## P-NNN: <title>
- status: proposed | accepted | rejected
- date: YYYY-MM-DD
- context: <what was being done when this arose>
- proposal: <the concrete ask, with exact repro for bugs>
```

<!-- entries below, newest last -->

## P-001: `--extend` silently drops the parent run's simulated latency
- status: proposed
- date: 2026-07-30
- context: Initializer code survey of the backtest CLI (spot-checked by hand).
- proposal: The comment at `src/cli/helpers/backtestArgs.ts` (extend-conflict
  block, ~line 484) says "Extension jobs must replay with the same simulated
  latency as the parent run (whose cmd records it)" — but no code reads the
  parent's latency. `--latency-delay-ms/--latency-jitter-ms` are forbidden
  with `--extend`, and `src/cli/backtest.ts:565-570` then resolves latency
  from env (`BACKTEST_LATENCY_DELAY` default 0). Repro: launch a run with
  `--latency-delay-ms 140`, then `--extend <runId>` in a shell without the
  env var — extension markets replay at 0 ms while the parent ran at 140 ms,
  mixed inside one run with no audit trail. CLAUDE.md also states extensions
  "replay the parent's latency", which the code does not implement. Suggested
  fix: parse latency out of the parent's `cmd` (or persist latency as run
  columns) and stamp it into extension jobs. Until then this protocol treats
  latency-pinned runs as non-extendable.

## P-002: Persist per-market invested capital (buy notional) on backtest_run_markets
- status: proposed
- date: 2026-07-30
- context: Initializer survey of stats/storage while designing capital-aware
  evaluation units (mission 01 goal 5; mission 02 goal 2 makes them mandatory).
- proposal: `computeMarketStats` already accumulates
  `totalUpBuySize/totalUpBuyCost/totalDownBuySize/totalDownBuyCost`
  (src/backtest/stats/marketStats.ts:107-137) but discards them after
  computing the entry-price VWAPs. Stored `cost` is only the REMAINING cost
  basis; `avg_entry_price × shares` ≠ invested for any strategy that sells or
  merges. Persisting buy notional (e.g. `buy_cost_up`, `buy_cost_down`, or a
  single `invested` column) would make "invested per market" and "profit per
  $100 invested" derivable for every strategy, historical comparisons
  included, with no replay-time behavior change. For pair-fable's no-sell
  strategies `cost` may serve as a workaround (to be verified in PLAN
  `metrics-and-capital-units`), but the general fix belongs in the engine.

