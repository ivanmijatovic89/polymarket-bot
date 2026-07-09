# STATE — Fable Protocol lab

_Last updated: session 1, unit U1 (synthesis done, verification pending)._

## Done
- U0: scaffolding (ROADMAP.md, STATE.md, DECISIONS.md) — committed, pushed.
- U1 (synthesis): four fresh-context subagent audits of the engine
  (backtest execution, market data/ticks, strategy subsystem, data/results
  pipeline) → raw notes in `engine/notes/*`; synthesized
  `engine/CAPABILITIES.md`. Main-session spot-check: confirmed
  `runSingleMarket.ts:145` uses `intentExecutionMode: 'immediate'`
  (old ENGINE.md "queued" claim outdated).

- U2: adversarial fresh-context verification of CAPABILITIES.md — all
  load-bearing claims CONFIRMED; 3 citation errors fixed; 5 nuances folded
  in (batch ≤15 live-only; maker fills emit no status events; mid-episode
  merge is a PnL leak; maxLossStop allows exits; BACKTEST_ALLOW_DIRTY escape
  hatch + commit-SHA framing for fleet).
- U3 (partial): DECISIONS D1-D6; protocol/EPISTEMOLOGY.md; LIFECYCLE.md;
  README.md (map); IDEAS.md (6 mechanism classes, 6 seeded ideas);
  templates/EXPERIMENT.md; knowledge/LESSONS.md (engine lessons E1-E5).

## In progress
- U3/U4 wrap-up: registry skeleton (INDEX.md), memory/resume checks.

## Next
- U5: tools (universe, results, preregister/validate, submit, index-registry).
- U6: sessions/SCIENTIST.md + JUDGE.md. U7: RUNBOOK.md. U8: final review.

## Notes for a fresh session
- Read `CHARTER.md` first; it is binding. Operator-fixed scope: BTC 15m
  up/down only, telonex-delta replay defaults, no evidence backtests tonight.
- Branch: `fable-protocol`. Write only inside `fable-lab/`. Commit + push
  after every unit.
