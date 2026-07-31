# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 11)

## Current work

Session 11 executed E-022 and closed it, plus the v1-b FULL reference:

**E-022 KILL (axis 6, market selection — no new runs).** Built
`tools/mktselect.ts` (minutes 0–3 replay with early abort, ~25 min for
the pinned 800), computed the 5 frozen features, joined to run 872
(join check: evAllJoined −1.5019 ≡ 872's headline). Verdict per the
frozen criteria: no feature trend reproduces across split-halves; ZERO
contiguous-quintile rules reach ev ≥ 0 at ≥25% retention even on the
exploration half (best bucket −1.02, ~4 SE below zero); doom rate flat
43–56% everywhere (market-level E-012 replication). Transferable
finding: F1 spread and F3 book-sum are DEGENERATE at window start
(quintile edges 0.0100–0.0102 — the btc-15m book is tick-constrained
~always in min 0–3). pair-v11.md §Result E-022; archive
memory/experiments/data/mktselect-2026-07-31-latest800.{json,jsonl}.

**E-023 reference (run 914).** v1-b (maxPairCost=0.95) FULL universe,
10,747 markets, failures 0: ev −1.0700 (screen was −1.0669 — stationary
at full scale), p/100 −8.24, monthly ev −0.96..−1.12, 0/16 positive
weeks. This is the S2 walk-forward baseline for any future v1-family
overlay. pair-v1.md §FULL run 914.

Ruling axes 1/2/3/6 are now ALL answered-negative on the v1 family
(E-019/E-021, E-020/E-020b, E-022). Remaining in-rules levers: axis 4
(size laddering), axis 5 (time-varying policy), HF regime.

## Next step

Nothing in flight (fleet drained; run 914 read and recorded).

1. **E-024 (pre-registered this session, memory/experiments/
   hf-fill-probe.md — execute next)**: measure worst-queue (W) vs
   optimistic front-of-queue (O) maker-capture ceiling of an
   always-quoting top-of-book bid, both sides, 0ms + 140ms variants,
   pinned 800. Frozen verdicts: O ≤ 2×W ⇒ fill-limited is a market
   fact (HF maker axis closes); O ≥ 3×W ⇒ fill model materially
   binding ⇒ proposal for queue-aware fill model BEFORE any HF strategy
   code. Tool: extend mktselect/bookscan pattern; use
   --checkpoint/--time-budget-s chunking (expect ~25–35 min local).
2. Then axis 4 (size laddering) design — needs its own pre-registration
   (size as f(price), multi-round accumulation; mind review-gate M5
   incrementSize bound), informed by E-024's read on fill availability.
3. Axis 5 (time-varying policy) remains undesigned.

## Blockers

None.

## Needs human

- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6). Long local jobs: `--checkpoint` +
  `--time-budget-s` foreground chunking (mktselect/bookscan pattern).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (this session: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push via
  `git push origin HEAD:main` from the wt/pair-fable worktree).
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference for v1-b: run 914
  (no expiry — FULL runs don't drift).
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
