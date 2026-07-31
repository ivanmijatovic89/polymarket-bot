# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 15)

## Current work

Session 15 = the mandated self-check + strategic replan, both delivered
and executed. Nothing is in flight (both scans completed in-session).

**Self-check verdict: no drift**, but v1-family knob work is exhausted —
next increments must open new terms/universes (memory/replan-2026-07-31.md,
incl. the identity coverage map).

**E-028 VERDICT: POSITIVE-SIGNAL** (pair-v14 calibration scan,
tools/calib.ts on pinned 800; design-ts 276e1dd BEFORE tool code).
First positive frozen-bar result in lab history: minutes 0–9 ×
ask ≥ 0.90 has fee-incl taker edge +2.2¢/share, ≥2 SE in both split
halves, executable at 140ms. PLUS market fact: longshots (all bands
≤ 0.55) overpriced −3..−4¢/share at 2–5 SE — the unconditional
explanation of every family's gate-invariant per-dollar loss.
Caveat found post-hoc: the estimand is dwell-time weighted.

**E-028b VERDICT: KILL naive one-shot policy** (first-touch readout,
design-ts ca848c0 BEFORE code): edge +0.9..+1.3¢/share, z 0.73/0.75/1.24
— no frozen region reaches 2 SE at n=800. Point estimates consistently
positive (R3 both halves +, 6/9 days) but underpowered. Favorite-side
edge UNRESOLVED, not dead. pair-v14.md §Results; archives
memory/experiments/data/calib{,-ft}-2026-07-31-latest800.json(l).

## Next step

1. **E-029 (session 16): pre-register FIRST, then run** — replicate the
   SAME frozen regions + first-touch policy on the FULL universe
   (~10.7k markets; ~9,900 are true OOS for the region selection).
   Local chunked scan: `tools/calib.ts --first-touch` needs only the
   universe selection widened (no --latest pin; keep --to-ms 1784762100000
   so the OOS split vs the pinned 800 is clean). ~5–6 h total —
   chunk with --checkpoint + --time-budget-s across sessions, foreground
   only (standing guard). SE shrinks ~3.6× ⇒ decisive on ±1¢/share.
2. After E-029: if positive → scope proposal to human (one-sided
   buy-and-redeem exploiting variant; pre-declared in pair-v14.md
   §Follow-ups) + in-family uses (completion pricing, start-side
   choice). If zero → assemble the class-level ASSESSMENT
   (replan decision item 3) — every identity term then measured.
3. Review gate M1–M4 (M5 done): required BEFORE first champion
   promotion / LIVE-CANDIDATE — none imminent.

## Blockers

None. E-029 runs locally on data already on disk.

## Needs human

- **P-012**: convert eth/sol/xrp 15m telonex datasets (re-verified s15:
  still 0 conversions) — gates cross-symbol replication. Not blocking.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6). Long local jobs: `--checkpoint` +
  `--time-budget-s` foreground chunking (calib/mktselect/bookscan/
  fillprobe all support it).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine commits
  (s13–s15: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push via
  `git push origin HEAD:main` from the wt/pair-fable worktree).
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference for v1-b: run 914.
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines, at
  most one evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), each config as its OWN command.
- Class kills need an identity argument (evaluator.md §Kill standards);
  N failures kill a family only. Scan-estimand lesson from E-028:
  pre-register the POLICY-relevant estimand (one decision per market),
  not only the pooled one — dwell-time weighting can manufacture or
  hide edges.
- Fill model: calibrated by E-025 (acceptable capacity bound at ToB).
  HF ToB axis deprioritized on measured economics (~$8.5/mkt gross).
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s15: still only pair-fable has memory.
- zsh does not word-split unquoted vars; spell out args in submission
  loops. Quote bare `===` in echo (`=word` expansion).
- Smoke cannot catch latency-race bugs: any strategy with taker/burst
  paths needs a mechanical post-run integrity check (CAP-BREACH).
- Anatomy/results tooling understands fill modes S/R/A. New fill modes
  need the same treatment before reading decompositions.

## Inbox processed through

2026-07-31T08:30:52.409Z-d904e17d (recorded in memory/market-context.md).
