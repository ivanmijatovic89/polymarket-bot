# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 19, mid-session)

## Current work

**Session 19 is executing E-032** (in-band lag-side maker aggression,
v15.3). Done so far this session:

- Design frozen BEFORE code (pair-v15.md §11, commit 8daa2a4): guard-2
  swap debtCap→lagAggr (E-031b: debtCap indistinguishable), knee-at-0
  lag grading, 7-config grid with IN-GRID γ=0 baselines, bars at the
  0.30 family noise bar.
- §11.3 amendment (efe76b2): first smokes 944/945 showed R=0 — the
  graded improvement is sub-tick in tight books and floorToGrid erased
  it. Fix: round-to-nearest-grid on the maker target (ceiling keeps
  floor semantics).
- §11.4 amendment (bfe8a42): re-smoke 946 still R=0 at 10-mkt scale;
  synthetic-tick probe verified R placement logic is correct; S0 R-fill
  bar escalated to a 200-mkt Stage B diagnostic.
- v15.3 code committed (4a5982e), pushed to origin/main.
- Stage B diagnostic run 947 PASS (200 mkts, recon 0, costMax 191 ≤
  501, R fills = 1 ≥ 1, SHA uniform 4a5982e).
- **7-config §11.2 grid SUBMITTED and IN FLIGHT** (batch_uid LIKE
  'pf15-e032-2%', submitted ~15:42Z, ~5600 markets, expect ~10-15 min):
  center (P*=0.96, I_b=40, q=25) × γ ∈ {0, 0.25, 0.5, 1} + corner
  (P*=0.94, I_b=20, q=20) × γ ∈ {0, 0.5, 1}; all B=500,
  doomUnitMax=0.99. Queue verified (waiting 4591, active 27 after
  submit).

## Next step (if this session ended before results)

1. `SELECT id, batch_uid, status FROM backtest_runs WHERE batch_uid
   LIKE 'pf15-e032-2%' ORDER BY id` — 7 runs expected. Read each with
   anatomy.ts + results/units; record §11.2 frozen readouts and verdict
   (bars in pair-v15.md §11.2: ADVANCE / LEVER-CONFIRMED / LEVER-DEAD;
   verdict PAIRS are within-grid γ>0 vs γ=0 same-corner at one SHA;
   bar 0.30 ev, 0.54 per-$100).
2. Then LEDGER row E-032, pair-v15.md §11.5 results section,
   STATUS/JOURNAL update.
3. Backlog after E-032: larger q into displayed depth (E-025
   capture-vs-size, 300–450-sh ToB exists); directional tilt I* ≠ 0
   (needs ≥ 2 SE signal first); Stage D cap sweep {100,500,1000,2000}
   only when some config goes positive.
4. Review gate M1–M5: ALL IMPLEMENTED (4809a8e). E-029 stays PARKED.

## Blockers

None.

## Needs human

- **P-012**: convert eth/sol/xrp 15m telonex datasets (still 0
  conversions) — gates cross-symbol replication. Not blocking.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6). Long local jobs: `--checkpoint` +
  `--time-budget-s` foreground chunking.
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine
  commits (s13–s19: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main` from the wt/pair-fable worktree).
- **Do not push strategy-semantics changes while that strategy's jobs
  are queued/running** — workers track origin/main; serialize push →
  submit.
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run 914.
  v15 baselines: 929 (doom-only center), 939 (graded-only center),
  942 (combo center), 943 (combo corner, per-$ best), 931/940 (neutral
  corner). **v15 noise floor 0.15 ⇒ bar 0.30** (937v938). NOTE: 929–943
  are v15.0–v15.2 SHAs — E-032 verdicts use within-grid pairs at
  4a5982e only.
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines,
  ≤ 1 evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), each config its OWN command with LITERAL args,
  verify queue depth with fleet.ts after every detached submit batch.
- Class kills need an identity argument (evaluator.md §Kill standards);
  N failures kill a family only. Verdict bars must name comparison
  PAIRS, not "any config vs one baseline" (E-031 lesson §10.4.5).
- Fill model: calibrated by E-025 (acceptable capacity bound at ToB).
  HF ToB axis deprioritized on measured economics.
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s19: still only pair-fable has memory.
- Smoke cannot catch latency-race bugs: strategies with taker/burst
  paths need the mechanical post-run integrity check (CAP-BREACH).
- Smoke also cannot demonstrate RARE fill modes (E-032 lesson: R fills
  ≈ 1/200 markets — a 10-mkt smoke zero is uninformative; escalate to
  a 200-mkt Stage B diagnostic instead of blocking on the smoke bar).
- Anatomy/results tooling understands fill modes S/R/A/C/V/D.
- Schema refines can invalidate a frozen grid corner (E-030 A1) — when
  freezing a grid, check every cell against the schema refines first.
- The backtest sim is NOT bit-deterministic (latency jitter): identical
  configs differ run-to-run — that is WHY the noise floor is measured
  from duplicate pairs (937v938; smokes 944v945 confirm).

## Inbox processed through

2026-07-31T13:44:57.732Z-93482fcb (pair-v15 approval with amendments;
executed as E-030 s17, E-031/E-031b s18, E-032 s19).
