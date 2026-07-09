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

- U4: memory model complete — registry (INDEX.md generated), knowledge/
  LESSONS.md, boot sequence in sessions/SCIENTIST.md, resume path in
  RUNBOOK.md §6.
- U5: tools built AND validated this session:
  - `universe.ts` ran against live DB: 18,635 eligible BTC 15m markets
    (2025-11-30 → 2026-06-14), 25% holdout boundary 2026-04-26T21:00Z.
  - `runs.ts` + `results.ts` ran against run 294 (existing) and run 295.
  - `validate-experiment.ts`: fixture passes (incl. --run 295 cross-checks:
    params match, spec-commit-before-run, holdout count); unfilled template
    fails with 5 errors (negative test).
  - `submit.ts`: printed correct commands for all 4 stages; `--execute`
    ran the ONE allowed ≤10-market sequential smoke (run 295, batch
    EXP-000-smoke, template.v1, 509k events replayed, no trades — plumbing
    proof only, no EV conclusions).
  - `index-registry.ts` regenerated INDEX.md.
- U6: sessions/SCIENTIST.md (role contract) + sessions/JUDGE.md (verdict
  subagent prompt), applying docs/reference/prompting-claude-fable-5.md.
- U7: RUNBOOK.md (morning operator guide).

## In progress
- U8: final self-review (fresh-context verifier against CHARTER), then DONE.

## Next
- (after U8 fixes) create fable-lab/DONE.

## Notes for a fresh session
- Read `CHARTER.md` first; it is binding. Operator-fixed scope: BTC 15m
  up/down only, telonex-delta replay defaults, no evidence backtests tonight.
- Branch: `fable-protocol`. Write only inside `fable-lab/`. Commit + push
  after every unit.
