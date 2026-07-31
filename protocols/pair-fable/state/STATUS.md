# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 10)

## Current work

Session 10 read both session-9 grids and found an implementation bug:

**E-020 (pair-v10 taker-completion, runs 897–903): partially INVALID.**
The FOK cooldown was tick-denominated; 25 ticks pass inside the 140 ms
fill latency in fast tape, so the module burst duplicate FOKs against a
stale portfolio — cap breaches $92–160 vs capPerMarket=50 (worst: 320
UP vs 50 DOWN shares). Runs 900–903 (C=0.99, D=0.05, D=0.10, joint)
are contaminated; NOT evidence about the module. Two clean findings
stand: regression gate PASS (897), and C ≤ 0.95 is TRIGGER-DEAD on the
v1 base (~3 firings/800 mkts — v1's own repair rest pre-empts the
profit-lock region). Details pair-v10.md §Result E-020.

**Fix shipped** (commit eaf8038, pushed to main; workers self-updated):
one-FOK-in-flight gate (`state.openIsFok`), smoke PASS run 906 (max
invested 49.00 ≤ cap with both triggers). results.ts now flags
CAP-BREACH mechanically (invested_max > 1.1×capPerMarket param).

**In flight: E-020b** (fixed code, same pinned 800-market window
--from-ms 1784043000000 --to-ms 1784762100000, 140/20 ms, code eaf8038,
design-ts in pair-v10.md §E-020b, submitted ~09:01Z):

- C=0.99 → pf10b-20260731T090107-pr10ey
- D=0.05 → pf10b-20260731T090117-3p3mv1
- D=0.10 → pf10b-20260731T090125-rhvl6c
- C=0.99 D=0.10 (joint, amended from C=0.95+D=0.10 — C=0.95 measured
  trigger-dead) → pf10b-20260731T090133-x0bj36

**To resume**: run ids via `batch_uid LIKE 'pf10b-20260731%'`; readouts
+ verdict bars unchanged from pair-v10.md §Pre-registered verdicts, plus
CAP-BREACH must be absent for a run to be readable.

**E-021 (pair-v9 low-X + duty, runs 904/905/907/908/909): read, one run
pending at session end.** X=0.08/0.10/0.12 all ≤ 0 (−0.02/−0.02/−0.04);
doom-vs-d* gap stays +1.1..+1.8pp at every X (does not cross zero — ev
approaches 0 only because activity vanishes); duty cycle measured a
nothing-burger (X=0.12 cd0 ≡ cd25, 29 completions both). Run 909
(X=0.15 cd0, batch pf9x-20260731T084524-92n2kk) was still aggregating —
if its ev ≤ 0 (expected: 908 showed duty adds nothing), the
pre-registered verdict closes BOTH E-019 carve-outs and axis 1
(absolute-ceiling, maker-rest) dies on this universe. Read it, fill the
PENDING row in pair-v9.md §Result E-021, update LEDGER E-021 scope.

## Next step

1. Read run 909 → finalize E-021 verdict in pair-v9.md + LEDGER.
2. Read E-020b (4 pf10b runs) → apply frozen verdicts: doom salvage is
   the live question (contaminated E-020 hint: residue term flipped
   +350/+503 while landing ≈ control ev DESPITE burst waste — a clean
   single-shot version might clear control).
3. Then: design the remaining ruling axes — priority per session-10
   self-check: axis 6 (liquidity-structure market selection) has a cheap
   Phase-0 (reanalysis: per-market book features from parquet vs
   per-market pnl on run 872 — NOTE this is market-level selection, NOT
   E-012's per-start doom prediction, different claim); then axis 4
   (size laddering). Also cheap: HF Phase-0 bookscan probe for the
   d904e17d question (how much maker volume could a high-frequency
   quoter capture vs what worst-queue says — measurement before any
   strategy code).

## Self-check (session 10, every-5th per mission)

On track, no trivia drift: sessions 6–10 executed the human ruling's
priority order exactly (axis 1 → E-019/E-021 dead; axes 2+3 → E-020/b in
flight), all grids pre-registered, every verdict tool-audited. One
process failure: the E-020 bug shipped because smoke (≤20 mkts) cannot
surface fast-tape latency races — mitigated mechanically (CAP-BREACH
check) and by pattern (any future taker module must gate on its own
in-flight order). Goal-1 distance: best known config remains ev ≈ −1.1
(v1-b); the ceiling family converges to no-trade, not profit — the
identity's completion term (doom salvage) and the undesigned axes 4/6
are the remaining in-rules levers, plus the unexplored HF regime
(market-context.md). Session budget: 10/50 used, burn rate fine.

## Blockers

None.

## Needs human

- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6). Long local jobs: bookscan-style
  `--checkpoint`/`--time-budget-s` foreground chunking.
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (this session: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push via
  `git push origin HEAD:main` from the wt/pair-fable worktree).
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines, at
  most one evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329).
- Class kills need an identity argument (evaluator.md §Kill standards,
  binding per inbox 8758567d); N failures kill a family only.
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s10: still only pair-fable has memory.
- zsh does not word-split unquoted vars; spell out args in submission
  loops.
- Smoke cannot catch latency-race bugs (≤20 quiet markets): any strategy
  with taker/burst-capable paths needs a mechanical post-run integrity
  check (CAP-BREACH is the template).

## Inbox processed through

2026-07-31T08:30:52.409Z-d904e17d (recorded in memory/market-context.md).
