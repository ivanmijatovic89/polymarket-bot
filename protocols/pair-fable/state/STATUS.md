# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 7, complete)

## Current work

Session 7 delivered (evidence from this session's tool runs):

1. **M1–M5 status corrected: they were ALREADY DONE.** Session 6's STATUS
   listed the review-gate hardening as next-step work, but mission-02
   session 1 implemented it (commit 4809a8e, ancestor of HEAD, journal
   entry exists). Re-verified this session by execution: the Mission-01
   exemplar evaluate.ts command (mixed maxPairCost 0.95/0.98) now returns
   MECHANICAL-FAIL with the M1 params-identity message, the M4 cross-run
   engine-SHA warning fires, m6's taker-trend note appears in S3, M2/M3
   code paths present (design-ts sanity vs earliest run; champion bar
   ev > 2×SE(n)), M5 `.max(100)` bound on incrementSize in pair.v0.ts:41.
   **The champion-promotion gate is satisfied.** Only m7 (pnl-decomposition
   column) remains, folded on the next results.ts touch.
2. **Sibling-memory review done — nothing to mine.** Actual siblings are
   `protocols/pair/` (the human's design template; no memory) and
   `protocols/pair-codex/` (Codex loop, NOT started: only
   RULES/VISION/mission-01). pair-opus/pair-sonnet (named in session-6
   STATUS) do not exist. Findings + recheck procedure recorded in
   memory/siblings.md; INDEX.md digest refreshed (was stale re E-017/018).
3. **P-010 enriched with ruling-relevant data** (addendum in
   state/PROPOSALS.md): the backtestable dataset is btc-15m ONLY (25,842
   done conversions; 10,747 post-floor = run 870 exactly); eth/sol/xrp-15m
   cataloged but unconverted (~24.6–25.6k each); 5m cataloged ~44k/symbol
   unconverted; 1h/4h/1d not cataloged at all — option 3 requires
   human-run data:sync + a RULES amendment (RULES pins btc-15m). Option 1
   (P-009) has design precedent in the parent plan's P2.5 micro live probe.

## Next step

**Blocked on the P-010 ruling.** The in-rules variant frontier is empty
(E-005/014/015/016/017/018, all pre-registered and reproduced), M1–M5 are
done, and the sibling review found nothing new. Remaining unblocked work is
make-work (re-testing killed families on new data windows), which the
mission's self-check forbids. When the ruling arrives in the inbox, it sets
the research direction:

- Option 1 (P-009 live probe) → human executes; loop designs the
  measurement protocol and analyzes.
- Option 2 (widen strategy space) → RULES amendment, then new family
  design against the recorded residue economics.
- Option 3 (other timeframes/symbols) → human runs data pipeline first
  (see P-010 addendum), RULES amendment, then port the Phase-0 scan
  discipline to the new universe.
- Option 4 (latency ruling) → re-evaluate E-015/E-018 economics at the
  granted latency (bookscan archives already carry zero-latency streams).

## Blockers

Research direction requires the P-010 human ruling (see Needs human). No
mechanical blockers.

## Needs human

- **P-010** (state/PROPOSALS.md, addendum 2026-07-31): where to search
  next — approve P-009 live measurement / widen strategy space / other
  timeframes-symbols (data-pipeline prerequisite documented) / latency
  ruling. Any subset unblocks research.
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
  (this session: origin/main == local HEAD dc29089 at session start, no
  drift).
- Queue submissions require a CLEAN tree: commit+push BEFORE launching.
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines, at
  most one evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front,
  analyze as results land (inbox c841c329).
- Sibling-memory recheck is cheap (`ls protocols/*/memory`): do it at
  session start once the Codex loop launches (memory/siblings.md).

## Inbox processed through

2026-07-31T01:56:42.590Z-dad421a6 (no newer entries existed at session-7
start; session 7 awaited a P-010 ruling that had not yet arrived).
