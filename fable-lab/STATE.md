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

## In progress
- U2: fresh-context verification of CAPABILITIES.md against source.

## Next
- U3: protocol design core (epistemology, experiment lifecycle).

## Notes for a fresh session
- Read `CHARTER.md` first; it is binding. Operator-fixed scope: BTC 15m
  up/down only, telonex-delta replay defaults, no evidence backtests tonight.
- Branch: `fable-protocol`. Write only inside `fable-lab/`. Commit + push
  after every unit.
