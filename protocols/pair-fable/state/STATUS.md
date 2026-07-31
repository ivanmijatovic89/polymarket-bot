# STATUS — pair-fable / mission 02 (research loop)

Updated: 2026-07-31 (mission-02 session 20 close)

## Current work

**Session 20 executed E-034 + E-035** (both designed→frozen→run→concluded
this session, designs BEFORE code per M2: d4da4e1 → E-034, 7154ff8 →
E-035). All local analysis — zero fleet runs. Headlines:

- **E-034 (WHICH axis — market selection by early book/motion features):
  FAIL both bars.** mktselect v2 (F1–F5 + new F6 range/F7 net-drift,
  min 0–3) vs v15 runs 948/952 on the pinned 800. Integrity PASS (F1–F5
  ≡ E-022 archive exactly). No B1 (economics) or B2 (2-SE separation)
  pass on the primary run; 952-only fires are config noise. Early
  one-way-ness is invisible in minutes 0–3. pair-v15.md §13.2.
- **E-035 (tilt firm-up, §5 gate): TILT-REJECT — REFUTED.** E-028b's
  frozen favorite regions re-measured on ALL 9,947 pre-pinned markets
  (true OOS, 12.4× n, 6-shard parallel calib scan ~55 min): all three
  regions NEGATIVE (z −0.98..−1.41); R3's CI excludes the old +0.0126.
  Region search: 25,135 (minute × band) rectangles, ZERO positive —
  ask-side WHEN axis also answered-negative. **Market fact upgraded:**
  every ask band < 0.80 overpriced −1.5..−3.2¢/sh (z to −12.7, raw
  mispricing ≈ 1–1.5¢ beyond fee), favorites exactly fair. §5
  directional gate CLOSED-NEGATIVE; E-029 resolved-negative (no longer
  parked). pair-v14.md §Result E-035.

**Axis scoreboard after s20:** HOW converged (−5..−6/$100 doom premium,
19 configs); WHICH dead (E-034); tilt dead + ask-side WHEN dead (E-035).
The buy-at-ask toll is measured positive-nowhere across (minute × band)
at n≈10k. The program's remaining live directions are below.

## Next step

1. **P-013 (NEW, needs human):** sell-side mirror program scope ruling —
   E-035's band curve says the measured edge belongs to whoever RESTS
   the overpriced asks; split→sell-both-sides is the mirror controller.
   Pending the ruling, the lab may run read-only Phase-0 (fee-model
   capability check: does the engine charge maker/resting fills 0? +
   sell-side episode scan via bookscan machinery) as autonomous backlog
   work. NO sell-side strategy code without the ruling.
2. **High-activity regime probe (inbox d904e17d, unexplored):** the
   known-profitable operator does ~700 trades/window vs our ~4–12.
   Design question for next session: what measurable claim about the
   100×-activity regime can the engine support, given worst-queue fill
   conservatism (E-025 calibrated at ToB only)? Frame as analysis-first;
   name the fill-model caveat in any design.
3. **Cross-symbol replication:** still gated on P-012 (eth/sol/xrp
   conversions, 0 rows).
4. v15 family: no further HOW/WHICH/tilt spend without a new measured
   signal (guard-4 verdict stands). Review gate M1–M5: ALL IMPLEMENTED
   (4809a8e).

## Blockers

None. Fleet idle (untouched this session). No in-flight local work —
E-035 scan COMPLETE (all shards done, merged, analyzed, archived).

## Needs human

- **P-013 (new)**: sell-side mirror program scope ruling (see PROPOSALS).
- **P-012**: convert eth/sol/xrp 15m telonex datasets — gates
  cross-symbol replication. Not blocking.
- Carried: P-002/P-003/P-005/P-006/P-007/P-009/P-010 (all `proposed`).
  P-009/P-010 (fill-model realism / live probe) gained relevance from
  E-035 + the d904e17d activity question.

## Standing session guards

- Never end a session waiting on ANY in-flight work (fleet, local scan,
  background task, monitor) — record how to resume in STATUS, return
  `continue` (inbox dad421a6). Long local jobs: `--checkpoint` +
  `--time-budget-s` foreground chunking; NEW s20 pattern: shard big
  scans with calib-style `--offset` into N parallel processes per
  foreground batch (6-way ≈ 3 mkts/s aggregate, ~4× single-process).
- Write .global-runtime/session-result.json BEFORE the final message,
  every session, no exceptions.
- Never `--extend` (P-001). Fresh FULL runs for OOS growth.
- Run `tools/refresh-capabilities.ts` when a rebase pulls engine
  commits (s13–s20: only protocol commits moved HEAD).
- Queue submissions require a CLEAN tree pushed to origin/main (push
  via `git push origin HEAD:main`); commit state snapshots before
  submitting.
- Do not push strategy-semantics changes while that strategy's jobs are
  queued/running — workers track origin/main; serialize push → submit.
- Screens baseline 874 (v0) and parents 872/873/879 remain valid ≤
  2026-08-06 (evaluator.md §Universes). FULL reference v1-b: run 914.
  v15 SAME-SHA (4a5982e) baselines: **948** (center) / **952** (corner)
  on the pinned 800. **v15 noise floor 0.15 ⇒ ev bar 0.30, per-$100 bar
  0.54** (937v938).
- JOURNAL entries are for the HUMAN: plain language, 3–6 short lines,
  ≤ 1 evidence pointer per conclusion (inbox 330fa938, permanent).
- Pre-registered grids of 3+ configs: submit the WHOLE grid up front
  (inbox c841c329), each config its OWN command with LITERAL args,
  verify queue depth with fleet.ts after every detached submit batch.
- Class kills need an identity argument (evaluator.md §Kill standards);
  N failures kill a family only. Verdict bars must name comparison
  PAIRS. Positive signals measured ON discovery data need disjoint
  confirmation before any build decision (E-028 → E-035 lesson: the
  only "positive" region in lab history was selection noise).
- Fill model: calibrated by E-025 (acceptable capacity bound at ToB).
  Guard-7 whole-size fill optimism: larger-q results depth-optimistic.
- Sibling-memory recheck at session start (`ls protocols/*/memory`) —
  2026-07-31 s20: still only pair-fable has memory.
- Smoke cannot catch latency-race bugs (CAP-BREACH check) AND cannot
  demonstrate RARE fill modes (escalate to a 200-mkt Stage B instead).
- Schema refines can invalidate a frozen grid corner — when freezing a
  grid, check every cell against the schema refines first.
- The backtest sim is NOT bit-deterministic (latency jitter): identical
  configs differ run-to-run — noise floors come from duplicate pairs.

## Inbox processed through

2026-07-31T13:44:57.732Z-93482fcb (pair-v15 approval with amendments;
executed as E-030 s17, E-031/E-031b s18, E-032/E-033 s19, E-034/E-035
s20).
