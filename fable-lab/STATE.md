# STATE — Fable Protocol lab

_Last updated: session 2 (first research session under charter v2), unit U9._

## Done
- U0-U8 (session 1): system built and verified — engine study
  (`engine/CAPABILITIES.md`), protocol (`protocol/*`), tools (`tools/*`),
  runbook, role contracts. See ROADMAP.md and git history for detail.
- Charter v2.2 (operator): mission is perpetual, local sequential evidence
  runs allowed (background, committed code), protocol changes need motivating
  evidence, never create DONE.
- U9 (session 2): protocol reconciled to charter v2 — DECISIONS D7.
  - `tools/run-backtest.ts`: registry-injection wrapper; strategies now live
    in `fable-lab/strategies/<mechanism>/EXP-NNN.ts` (see strategies/README.md);
    wrapper refuses non-sequential runs. Validated: 2-market smoke with
    injected `fable-fixture-noop`, 100,850 events, batchUid
    EXP-000-wrapper-smoke.
  - `tools/submit.ts`: all stages route through the wrapper + `--sequential`;
    verified command output for smoke/probe/holdout against the fixture spec.
  - Docs updated to local-sequential reality: LIFECYCLE §2-§3, SCIENTIST.md,
    RUNBOOK §0-§3, protocol/README.md loop paragraph, EPISTEMOLOGY §3 compute
    anchor (~1.1s/market measured, no-op strategy, local data).
  - Plumbing re-verified this session: `universe.ts` → 18,635 eligible
    markets (2025-11-30 → 2026-06-14), holdout boundary 1777237200000
    (2026-04-26T21:00Z).

## In progress
- U10: register EXP-001 (expiry certainty discount, `tail-overpricing`, top
  of IDEAS.md) — spec + strategy + smoke.

## Next
- U11: EXP-001 probe (500 random exploration markets, local sequential,
  background), then Judge verdict per LIFECYCLE §5; spec EXP-002 while the
  probe replays.

## Notes for a fresh session
- Boot per `protocol/sessions/SCIENTIST.md` (charter scope → protocol map →
  registry INDEX + LESSONS → this file).
- Branch `fable-protocol`; write only inside `fable-lab/`; commit + push
  after every unit; evidence runs local `--sequential` in the background via
  `tools/submit.ts`; never create `fable-lab/DONE`.
