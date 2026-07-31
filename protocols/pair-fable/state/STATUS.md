# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 6, complete)

## Current work

Session 6 delivered (all evidence from this session's tool runs; session 5
died mid-scan and its 0-byte archive was regenerated from scratch):

1. **Scanner made session-death-proof.** `tools/bookscan.ts` gained
   `--checkpoint` (per-market JSONL persist + resume-by-slug, params
   enforced via header line) and `--time-budget-s` (clean partial exit).
   The 800-market scan ran as 4 foreground ~450s passes — the pattern for
   any long local job from now on (never background + wait; inbox
   dad421a6).
2. **Binding regression check PASSED exactly**: new scan's A stream and
   D's δ=0 stream reproduce the session-4 archive to every digit
   (199,542,943 events, moments 5039/4247, C p50 1.0368/1.0373, all
   percentiles/day tables). Archive:
   memory/experiments/data/bookscan-2026-07-31-s6-latest800.json.
3. **E-017 — pair-v7 (taker-lead pair) KILLED at Phase 0.** Maker
   completion leg fills fine (69–89%) — first family where it does — but
   best-gate total EV is +$0.02/mkt vs the $0.10 bar (optimistic proxy),
   entries rare, and the stranded-residue hypothesis refuted hard: the
   held side wins 2.2% (−0.16/share). Negative even at zero latency —
   adverse selection, not latency. pair-v7.md.
4. **E-018 — pair-v8 (deep-book maker δ-grid) KILLED at Phase 0.**
   Hold-all EV negative at every δ (best −$0.017 @ δ=0.05, ≤5/9 days
   positive); free-abort ≤ $0.043 everywhere. Mechanistic finding:
   zero-latency completion C p50 < 1 from δ=0.02 (down to 0.935 at 0.08)
   while 140ms C stays ~1.04 — the repricing wall eats exactly the δ
   cushion. pair-v8.md.
5. **P-010 filed**: buy-only pair mechanics on btc-15m are exhausted
   in-rules at 140ms (E-005/014/015/016/017/018); ruling requested —
   approve P-009 live fill-quality measurement, and/or widen strategy
   space / timeframes / symbols, and/or revisit the latency assumption.

## Next step (session 7)

The in-rules variant frontier is empty pending the P-010 ruling. Useful
non-blocked work, in order:

1. **M1–M5 hardening** (binding review gate, must land before any future
   promotion; findings in state/MISSION01-REVIEW.md): M1 cross-run
   params+latency identity in evaluate.ts, M2 machine-checkable design-ts
   rule for --param variants, M3 noise-aware champion/dethroning
   threshold, M4 engine-SHA awareness in cross-run comparison +
   team-workflow rule 4, M5 bound incrementSize. Fold m6–m11 into files
   as touched (m7 pnl-decomposition column on next results.ts touch).
2. **Sibling-memory review** (allowed per inbox c68ea4ce): read
   pair-opus/pair-sonnet memory/ + PROPOSALS for mechanisms or evidence
   we have not tried; record a comparison note in memory/.
3. Check INBOX for a P-010 ruling; if one arrives, it sets the research
   direction and supersedes 1–2 in priority.

## Blockers

None mechanical. Strategically: new in-rules variant work is blocked on
the P-010 ruling (M1–M5 + sibling review remain productive meanwhile).

## Needs human

- **P-010** (state/PROPOSALS.md): where to search next, now that buy-only
  pair mechanics on btc-15m are exhausted at 140ms with reproduced
  evidence. Options: approve P-009 live measurement / widen strategy
  space / other timeframes-symbols / latency-infrastructure ruling.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009 (all `proposed`).

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6, generalizes A4/A6). Long local jobs: use
  bookscan-style `--checkpoint`/`--time-budget-s` foreground chunking.
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (this session: origin/main had no new commits at session start).
- Queue submissions require a CLEAN tree: commit+push BEFORE launching.
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines, at
  most one evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front,
  analyze as results land (inbox c841c329).

## Inbox processed through

2026-07-31T01:56:42.590Z-dad421a6 (session 6 processed dad421a6 — the
generalized never-wait rule and the session-result.json mandate — by
building checkpoint/resume into bookscan.ts, running the scan as
foreground chunks, and adding both as standing guards above).
