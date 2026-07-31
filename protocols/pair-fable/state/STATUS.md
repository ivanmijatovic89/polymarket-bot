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

**E-020b READ AND CLOSED in-session** (runs 910/911/912/913 vs control
897; fleet drained, no in-flight work): **KILL the taker-completion
module on the v1 base** — every config within ±0.05 of control (Δ
−0.03/+0.02/+0.02/+0.02). Mechanistic result recorded in pair-v10.md
§Result E-020b: doom salvage cuts stranding 341→29 residue markets but
the dollars transfer into pairsPnl (completion at ask ≈ 1−heldBid saves
only ~1¢/share); profit-lock C=0.99 fires 124× at ≤1¢ margin and fees
eat it. Ruling axes 2+3 answered on the v1 family.

**E-021 READ AND CLOSED in-session** (runs 904/905/907/908/909): KILL —
both E-019 carve-outs closed, **ruling axis 1 (absolute ceiling,
maker-rest) is DONE on this universe**. Low-X all ≤ 0 with the
doom-vs-d* gap never crossing zero (+1.1..+1.7pp; ev→0 only because
activity vanishes); duty-cycle gain measured ZERO (cd0 ≡ cd25 at both
X=0.12 and X=0.15 — identical completion counts). pair-v9.md §Result
E-021, LEDGER E-021.

## Next step

Nothing in flight. Session 11 starts fresh with E-022 (pre-registered
this session, pair-v11.md — ruling axis 6, liquidity-structure MARKET
selection):

1. Build the E-022 Phase-0 tool (extend bookscan.ts or new
   `tools/mktselect.ts`): 5 frozen features (spread, depth, book-sum,
   oscillation, quote intensity) over minutes 0–3 of each pinned-800
   parquet; join to run 872 per-market pnl; split-half validation +
   economics bar — ALL frozen in pair-v11.md, do not add features
   post-hoc. Local scan ~30 min: use --checkpoint/--time-budget-s
   chunking if needed.
2. Then axis 4 (size laddering) design, and/or the HF Phase-0 bookscan
   probe for the d904e17d question (how much maker volume a
   high-frequency quoter could capture vs what worst-queue says —
   measurement before any strategy code; would also bound guard-6
   optimism for E-013's fill-limited claim).
3. Consider a FULL run of v1-b (family best, screen ev −1.07): the only
   FULL to date is 870 (v0, E-005). A v1-b FULL would set the S2
   walk-forward reference that any E-022 selection overlay will be
   measured against (overlay claims need per-week stability, not just
   the 9-day pinned screen).

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
