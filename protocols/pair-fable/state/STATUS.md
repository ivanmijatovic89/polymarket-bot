# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 17)

## Current work

**Session 17 executed E-030** (the approved pair-v15 controller, per
ruling 93482fcb): design amended + §8 spec frozen (design-ts 9935e4e)
BEFORE code (1dcd1dd), `strategies/pair.v15.ts` implemented, staged
validation complete — smoke 921 PASS, diagnostic 922 PASS all frozen
bars, screen grid runs 923–932 (10 configs, pinned 800, all completed,
0 failures). **Verdict ITERATE** — full evidence in pair-v15.md §9 +
LEDGER E-030. Key numbers: accumulation machine works (matched 43–139
sh/mkt at pair VWAP 0.93–0.96), all configs negative (best neutral
−1.83 ev/mkt, run 931), loss = strand tax (pairs +2,072 vs residue
−4,777 on run 925); salvage lever = first per-dollar improvement
beyond noise in family history (929 vs 925: Δev +0.60, strands 450→3,
per-$100 −5.73 family best). anatomy.ts now understands C/V fill modes.

## Next step

1. **E-031 — graded completion frontier** (the localized lever):
   replace the C/V binary with a recovery-debt ceiling X(t, ι) rising
   from P_lock toward salvageMax with time-elapsed and persistent
   imbalance (ruling amendment 5's bounded-debt math). Design + exact
   spec frozen in pair-v15.md BEFORE code changes (M2), then smoke →
   screen grid vs baselines 925/929/931. Include a duplicate-config
   pair to MEASURE the v15 family noise floor (taker-heavy; 0.05
   default unverified).
2. If E-031 finds a positive or near-positive config: Stage D cap
   sweep {100, 500, 1000, 2000} (q scaled 10/25/50/100, I_b scaled),
   then FULL + S3 latency sweep + S4 OOS per evaluator pipeline.
3. Backlog (mechanism, from the identity): directional tilt I* ≠ 0
   (needs a ≥2 SE signal first, §5); lag-side maker aggression inside
   the band (R-path never fills — 0–2 R fills/run); larger q into
   displayed depth (E-025 capture-vs-size); E-029 favorite replication
   stays PARKED per ruling.
4. Review gate M1–M4 (M5 done) before any champion/LIVE-CANDIDATE.

## Blockers

None. Fleet idle, all E-030 runs read and archived.

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
  commits (s13–s17: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main` from the wt/pair-fable worktree).
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run 914.
  v15 screen baselines: 925 (neutral center), 929 (salvage), 931
  (best neutral corner).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines,
  ≤ 1 evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), each config as its OWN command with LITERAL args —
  **zsh does not word-split unquoted vars; a helper-loop violation of
  this cost 3 silent submission failures in s17 (detached submissions
  hide schema errors). After every detached submit batch, verify with
  fleet.ts that the batch count matches.**
- Class kills need an identity argument (evaluator.md §Kill
  standards); N failures kill a family only. Pre-register the
  POLICY-relevant estimand, not only the pooled one (E-028 lesson).
- Fill model: calibrated by E-025 (acceptable capacity bound at ToB).
  HF ToB axis deprioritized on measured economics.
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s15: still only pair-fable has memory.
- Smoke cannot catch latency-race bugs: strategies with taker/burst
  paths need the mechanical post-run integrity check (CAP-BREACH).
- Anatomy/results tooling understands fill modes S/R/A/C/V (C/V added
  s17 — exact taker attribution for v15+).
- Schema refines can invalidate a frozen grid corner (E-030 A1: q ≤
  I_b rejected the I_b=20 × q=25 cell) — when freezing a grid, check
  every cell against the schema refines first.

## Inbox processed through

2026-07-31T13:44:57.732Z-93482fcb (pair-v15 approval with amendments;
executed as E-030 this session).
