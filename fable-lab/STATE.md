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

- U8: final fresh-context charter review completed. Verdict: no charter
  violations, grounding confirmed on all spot-checks, tools bind to real
  columns. All findings applied this session:
  - M1: main stage keeps the probe batchUid (extension semantics) — fixed
    in LIFECYCLE §3, RUNBOOK §4.
  - M2: holdout window now frozen on BOTH bounds (template, spec parser,
    submit.ts `--to-ms`, universe.ts note); verified on fixture.
  - S1: robustness battery tooling built — submit.ts stages `lat`
    (env-prefixed latency point) + `grid` (neighborhood cell), new
    `battery.ts` comparison table; validated against run 295.
  - S2: `submit.ts --stage holdout --execute` mechanically refuses unless
    validate-experiment.ts passes.
  - S3: sample-vs-population std note added to EPISTEMOLOGY §1.
  - S4: `--converter` removed from LIFECYCLE fixed-flags (derived from
    input mode; no such CLI flag).
  - N1: placeholder detection broadened to any `<...>` in the spec section
    (template now fails with 6 errors; fixture passes).
  - N2: LESSONS reordered E1-E5.
  - Self-found: holdout `--limit` truncation (eligibility default 1000)
    fixed earlier in U8.

## Charter status: FULFILLED — fable-lab/DONE created.

A fresh session operating this system starts at `protocol/sessions/SCIENTIST.md`
(the operator starts at `RUNBOOK.md`). Tonight's constraints (no evidence
backtests) mean no experiments are registered yet; EXP-001 is the first
Scientist session's job.

## Notes for a fresh session
- Read `CHARTER.md` first; it is binding. Operator-fixed scope: BTC 15m
  up/down only, telonex-delta replay defaults, no evidence backtests tonight.
- Branch: `fable-protocol`. Write only inside `fable-lab/`. Commit + push
  after every unit.

## Operator update — charter v2 (2026-07-09)

The build-phase charter is superseded: CHARTER.md is now v2 (perpetual).
Key changes: mission is perpetual (never create DONE — it is the operator's
kill-switch now); local sequential evidence backtests are ALLOWED (background
only, committed code only, holdout rules unchanged); protocol changes require
motivating evidence (evolution governor). First assignment: drive the top
IDEAS.md idea end-to-end through the system. The "no evidence backtests
tonight" note above is obsolete.

## Operator update — Phase A added (2026-07-09)

Charter v2 now defines Phase A (bounded hardening & simplification: fresh-
context adversarial reviews + paper walkthrough, max 3 sessions, complexity
must not grow) BEFORE Phase B (perpetual research loop). Start with Phase A.
