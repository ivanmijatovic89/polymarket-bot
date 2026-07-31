# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 16)

## Current work

**Session 16 = design checkpoint (human ruling inbox 90d94c56), delivered
— awaiting human review (returned `wait`).** The ruling redirected the
lab: postpone E-029; design a continuous two-sided inventory accumulation
controller for btc-15m (maximize matched inventory, pair VWAP < $0.98,
small imbalance, use later price movement to complete, control
trending-market losses; 500–1,000 matched shares aspirational). No code
or large experiments this session, per the ruling.

Deliverable: **`memory/experiments/pair-v15.md`** — covers all five
ruling points: (1) precise comparison with every prior family incl. the
no-equivalence statement and which killed-family findings carry as design
constraints (none as dismissals); (2) full accounting + control math
(VWAP-ceiling invariant, imbalance band with graded asymmetric pricing,
capital reservation, end-of-window policy, trending-case loss bound);
(3) frozen success-metric set; (4) neutral controller first; (5)
directional = same controller with tiltTarget I* from a measured signal.
Proposed plan: E-030 Phase-0 geometry scan (no strategy code) → E-031
pair.v15.ts screen grid → cap sweep/FULL/S3/S4. Nothing pre-registered
or frozen yet — that happens after the human approves/amends the design.

## Next step

1. **On human approval/amendment of pair-v15.md**: pre-register E-030
   (frozen bars, design-ts commit BEFORE `tools/invscan.ts` code), then
   run the Phase-0 scan on the pinned 800 (`--latest 800 --to-ms
   1784762100000`), chunked foreground (--checkpoint + --time-budget-s).
2. Then E-031 per pair-v15.md §6 (strategy code + screen grid).
3. **E-029 is PARKED per the ruling** (not dead): FULL-universe
   replication of the E-028b frozen regions/first-touch policy; resume
   spec in pair-v14.md §Conclusions + replan-2026-07-31.md addendum.
4. Review gate M1–M4 (M5 done) before any champion/LIVE-CANDIDATE.

## Blockers

Waiting on human review of the pair-v15 controller design (ruling
90d94c56 explicitly ordered: write design, return wait).

## Needs human

- **Review pair-v15.md**, esp. §7's five design questions:
  (1) Phase-0 scan before strategy code? (recommended) (2) taker-heavier
  operation acceptable for the matched-inventory aspiration? (3) approve
  capPerMarket 500 level? (4) above-$1 salvage OFF in v15.0? (5) P*
  schema hard bound 0.98?
- **P-012**: convert eth/sol/xrp 15m telonex datasets (still 0
  conversions as of s15) — gates cross-symbol replication. Not blocking.
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
  (s13–s16: only protocol commits moved HEAD).
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
  (pair-v15 will add several) need the same treatment before reading
  decompositions.

## Inbox processed through

2026-07-31T13:16:53.539Z-90d94c56 (the strategic redirect; answered by
this session's design checkpoint).
