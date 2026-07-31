# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 14)

## Current work

Session 14 closed both open experiments; nothing is in flight.

**E-026 VERDICT: KILL** (pair-v12 averaging-down family, axis 4b).
Regression gate PASS (run 916 ≡ 872, Δev 0.0019 ≤ 0.01; M4 SHA warning
cleared — commit range 6a1ecde..99e3ff8 touches only protocols/). All
live configs much worse than parent: ev −2.04..−2.65 vs −1.50 (bar was
Δ ≥ +0.05 to iterate). Mechanism works (pairsPnl 384→1,684, residue
wins 1→52, monotone in A-exposure) but the trigger self-selects adverse
drift: every A-dollar loses −0.18..−0.27 at every δ×imb, Δresidue ≈
−2×Δpairs. CAP-BREACH clean, daily corr vs 872 0.86–0.99.
pair-v12.md §Result E-026; runs 916–920.

**E-027 VERDICT: KILL** (pair-v13 axis-5 start-timing + size-vs-time;
design-ts 743d0be BEFORE tool code; tools/minuteev.ts on runs 872+873,
no new fleet runs). No minute bucket or contiguous region ≥ 2 SE above
0 in either run; cumulative "forbid starts before m" never positive at
any m; doom-by-minute structureless. Completion-vs-time stays bounded
by E-020b (scoped in the design). pair-v13.md §Result E-027.

**ALL SIX ruling axes (inbox 8758567d) are now answered-negative on the
v1 family** — 1: E-019/E-021; 2+3: E-020/E-020b; 4a: reweighting
argument / 4b: E-026; 5: E-027; 6: E-022. All family-scoped kills; no
class kill claimed (per §Kill standards).

## Next step

1. **Session 15 = self-check session (every fifth) + STRATEGIC REPLAN.**
   The ruling's axis list is exhausted; the ruling itself says "derive
   more from the identity". Inputs for the replan, all in memory:
   - Measured constants: per-start adverse selection ≈ −0.06/share
     (E-014); doom unpredictable across 3 signal spaces (E-012 start
     state, E-022 liquidity structure, E-027 time-of-window); L_s
     attacks all negative (E-019/E-021 ceilings, E-026 avg-down);
     completion slack ≈ +$30/800 (E-020b); HF ToB gross ceiling
     ≈ $8.5/mkt (E-025); per-dollar loss ≈ −8/100 gate-invariant
     (E-011).
   - Candidate directions to weigh: (a) cross-symbol replication —
     BLOCKED on P-012 (only btc-15m converted; eth/sol/xrp 15m + all
     5m cataloged but unconverted, verified via
     countEligibleTelonexMarkets = 0); (b) identity-derived axes not
     yet tried (e.g. sell-side/exit mechanics, non-pair mechanisms
     using the feeds — check RULES scope first); (c) assemble the
     identity-coverage argument toward a class-level assessment and put
     it to the human; (d) revisit deprioritized-not-killed items
     (HF economics, 4a reopen conditions).
   - Audit recent sessions against goal 1 per the mission self-check.
2. Review gate M1–M4 (M5 done in v12 schema): required BEFORE first
   champion promotion / LIVE-CANDIDATE — none imminent.

## Blockers

None for session 15 (replan proceeds on btc-15m evidence).

## Needs human

- **P-012 (new)**: convert eth/sol/xrp 15m telonex datasets (producer
  ops, hours + storage) to open cross-symbol replication. Not blocking,
  but it gates direction (a) of the replan.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6). Long local jobs: `--checkpoint` +
  `--time-budget-s` foreground chunking (mktselect/bookscan/fillprobe).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (sessions 13–14: only protocol commits moved HEAD; verified via
  git diff --name-only on the run-SHA range in E-026).
- Queue submissions require a CLEAN tree pushed to origin/main (push via
  `git push origin HEAD:main` from the wt/pair-fable worktree).
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference for v1-b: run 914
  (no expiry — FULL runs don't drift).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines, at
  most one evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), each config as its OWN command (zsh word-splitting
  broke a loop in s13).
- Class kills need an identity argument (evaluator.md §Kill standards,
  binding per inbox 8758567d); N failures kill a family only.
- Fill model: calibrated by E-025 (acceptable capacity bound at ToB).
  HF ToB axis deprioritized on measured economics (~$8.5/mkt gross).
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s14: still only pair-fable has memory.
- zsh does not word-split unquoted vars; spell out args in submission
  loops. Quote bare `===` in echo (`=word` expansion).
- Smoke cannot catch latency-race bugs (≤20 quiet markets): any strategy
  with taker/burst-capable paths needs a mechanical post-run integrity
  check (CAP-BREACH is the template).
- Anatomy/results tooling understands fill modes S/R/A ('A' = avg-down,
  added s14). New fill modes need the same treatment before reading
  decompositions.

## Inbox processed through

2026-07-31T08:30:52.409Z-d904e17d (recorded in memory/market-context.md).
