# STATE — Fable Protocol lab

_Last updated: session 3, unit U12._

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

- U10: EXP-001 (expiry certainty discount, `tail-overpricing`) registered:
  spec `protocol/registry/experiments/EXP-001-expiry-certainty-discount.md`
  + strategy `strategies/tail-overpricing/EXP-001.ts` (id `fable-exp-001`).
  Validator passes. Smoke ran green (EXP-001-smoke, 10 markets, 9 entered —
  plumbing only, never evidence). Bug found via smoke and fixed:
  `tools/lib/spec.ts` field() regex truncated wrapped fields (`$` under `m`
  flag) — only 2 of 4 --param pairs reached the command; now uses true
  end-of-input; re-validated positive+negative fixtures.

- U11a (while probe ran): EXP-002 (UP+DOWN dutch-book scan, `sum-mispricing`)
  registered: spec + strategy `strategies/sum-mispricing/EXP-002.ts`
  (id `fable-exp-002`), validator passes. Its smoke exposed two findings:
  - LESSONS E6: recorded books can be SELF-CROSSED (UP bid 0.40 > UP ask
    0.37, btc-updown-15m-1764461700) — apparent dutch books are replay
    artifacts; EXP-002 now guards against crossed books (pre-registration,
    before any decisive run). Guarded smoke: 0 entries in 10 markets.
  - LESSONS E7 / DECISIONS D8: ambient `.env` sets BACKTEST_LATENCY_DELAY=140
    — silently applied to all runs. submit.ts now pins DELAY=0/JITTER=0 on
    every stage (lat stage keeps its own). First EXP-001 probe launch was
    VOID (killed ~365/500, nothing persisted, noted in the experiment file);
    relaunched pinned.
  - `strategies/_fixtures/debug-book.ts` added (diagnostic fixture, places a
    debug pair on first crossed-gap tick; batchUid EXP-000-debug only).

- U11b-d (session 2, verified in git): entry-check.ts prediction tool;
  EXP-003 (post-jump stale ladder) registered with green smoke.

- U12 (session 3): EXP-001 probe JUDGED — **advance**. The relaunched probe
  was killed by session SIGTERM at 379/500 but persisted cleanly (run 301,
  batchUid EXP-001-probe, N=379, 0 failures). Judged at N=379 per D9
  (exogenous truncation ≠ bias). Readout: EV/market=1.94 CI95=[0.71,3.17],
  t=3.08, win rate 0.9697 vs mean entry ask 0.9343 → prediction HELD,
  bias classification clean (taker-only, fees charged). Fresh-context Judge
  verdict appended verbatim to the experiment file. New: LESSONS E8
  (session death kills child runs; check DB before voiding), DECISIONS D9
  (truncated-unbiased samples are judged), D10 (evidence runs launch
  detached via `setsid nohup`).

## In progress
- U13: EXP-001 stage MAIN — extend run 301 to full exploration window
  (`submit.ts EXP-001 --stage main --parent-run 301`), launched DETACHED
  (D10), log `logs/EXP-001-main.log`. ~13k markets ≈ multiple hours. On
  completion: results.ts + entry-check.ts → then battery (lat curve
  {0,150,300}, robustness grid) per spec before the main Judge.
- EXP-002 probe: launch detached after main is confirmed running (CPU
  contention affects wall time only, not results — event-time replay).

## Next
- EXP-002 probe verdict; EXP-003 probe; per verdicts iterate/kill/advance
  per EPISTEMOLOGY §3; next ideas in IDEAS.md queue.

## Notes for a fresh session
- Boot per `protocol/sessions/SCIENTIST.md` (charter scope → protocol map →
  registry INDEX + LESSONS → this file).
- Branch `fable-protocol`; write only inside `fable-lab/`; commit + push
  after every unit; evidence runs local `--sequential` in the background via
  `tools/submit.ts`; never create `fable-lab/DONE`.
