# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 18 close)

## Current work

**Session 18 executed E-031 + E-031b** (graded completion frontier and
its doom-backstop combination; designs frozen BEFORE code: 57e3b86 →
3f75b61 (v15.1), 0026a13 → 3d5934a (v15.2)). Smokes 933/934/941 PASS;
10×800 fleet runs total (935–940 grid, 942/943 combo), 0 failures,
recon clean everywhere. Full evidence: pair-v15.md §10.4–§10.5, LEDGER
E-031/E-031b. Headlines:

- **v15 family noise floor MEASURED: 0.15 ev/mkt** (937 vs 938 exact
  duplicate) — 3× the evaluator default; family real-delta bar = 0.30.
  E-030's salvage conclusion survives the corrected bar.
- **Completion-policy axis CONVERGED** (family-level, time-scoped):
  doom-only (929), graded-1.10 (939), graded+backstop (942) all at ev
  −3.20..−3.23 at center; graded completions substitute 1:1 for
  backstop dollars. Family default going forward: doom backstop alone
  (doomUnitMax=0.99, debtCap=0) — guard-2 simplicity.
- **Corner + backstop (943) = family per-dollar best: −5.19/$100**, ev
  −1.68. Cumulative completion-program progress 925→943: Δper-$100
  +2.15 (~7× Δ-noise), still negative.
- Loss now localized in the doom-completion premium; strands ≈ 0.

## Next step

1. **E-032 — in-band lag-side maker aggression** (next mechanism from
   the identity, hypothesis in pair-v15.md §10.5.5): R fills ≈ 0 in
   every v15 run — the lag quote joins bestBid while ι ≤ 1, so all
   completions that matter pay taker premium. Grade the lag maker quote
   INSIDE the band (knee at ι = 0). Design + spec frozen in pair-v15.md
   BEFORE code (M2), smoke, then screen grid vs baselines 929/942/943
   at the 0.30 noise bar. Also worth a corner variant (the consistent
   family frontier).
2. Backlog after E-032: larger q into displayed depth (E-025
   capture-vs-size, 300–450-sh ToB exists); directional tilt I* ≠ 0
   (still needs a ≥ 2 SE signal first — E-028 favorite region
   unresolved); Stage D cap sweep {100,500,1000,2000} only when some
   config goes positive (none yet).
3. Review gate M1–M5: ALL IMPLEMENTED (commit 4809a8e; verified this
   session — evaluate.ts/compare.ts/team-workflow/capability-refresh all
   carry the checks; team-workflow header note fixed s18). Gate is
   satisfied pending "verified in anger" on the first real
   champion-promotion attempt.
4. E-029 favorite replication stays PARKED per ruling.

## Blockers

None. Fleet idle (verified post-E-031b), all runs read and archived.

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
  commits (s13–s18: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main` from the wt/pair-fable worktree).
- **Do not push strategy-semantics changes while that strategy's jobs
  are queued/running** — workers track origin/main; serialize push →
  submit (s18 practice).
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run 914.
  v15 baselines: 929 (doom-only center), 939 (graded-only center),
  942 (combo center), 943 (combo corner, per-$ best), 931/940 (neutral
  corner). **v15 noise floor 0.15 ⇒ bar 0.30** (937v938).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines,
  ≤ 1 evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), each config its OWN command with LITERAL args (zsh
  does not word-split unquoted vars — 3 silent failures in s17), verify
  queue depth with fleet.ts after every detached submit batch.
- Class kills need an identity argument (evaluator.md §Kill standards);
  N failures kill a family only. Verdict bars must name comparison
  PAIRS, not "any config vs one baseline" (E-031 lesson §10.4.5).
- Fill model: calibrated by E-025 (acceptable capacity bound at ToB).
  HF ToB axis deprioritized on measured economics.
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s18: still only pair-fable has memory.
- Smoke cannot catch latency-race bugs: strategies with taker/burst
  paths need the mechanical post-run integrity check (CAP-BREACH).
- Anatomy/results tooling understands fill modes S/R/A/C/V/D (D added
  s18 — doom-backstop attribution for v15.2+).
- Schema refines can invalidate a frozen grid corner (E-030 A1) — when
  freezing a grid, check every cell against the schema refines first.

## Inbox processed through

2026-07-31T13:44:57.732Z-93482fcb (pair-v15 approval with amendments;
executed as E-030 s17, E-031/E-031b s18).
