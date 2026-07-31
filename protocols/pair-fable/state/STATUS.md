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

## MID-SESSION MISSION AMENDMENTS (f8b19a4 + 08a85f4, 2026-07-31 ~18:40)

The human amended missions/02-research.md while s20's scans ran. Binding
changes now in force: (1) research priority order — neutral controller,
then directional controller; selection/favorite/one-shot work is
supporting-diagnostic ONLY and may not become the main line; (2) the
scale question may NOT be declared answered/converged/dead until the
**$2,000 capital level** is tested AND the 500–1,000 matched-share range
is approached or mechanically explained — **E-033's SCALE-NEUTRAL
verdict is hereby QUALIFIED: it covers q ≤ 100 / B ≤ 1000 / M ≈ 231
only; the binding scale check is still open**; (3) 10-minute
time-to-evidence target per session; (4) every-session alignment gate in
STATUS (see below) with GREEN/YELLOW/RED and consecutive-YELLOW limit;
(5) every-fifth-session audit replaces the old self-check (next audit
due session 25 under the new template).

## Next step (priority order per amended mission)

1. **E-036 (GREEN, next session's first action): the binding scale
   check.** Pre-register minimally (hypothesis/config/metric/verdict),
   then run: pinned 800 @ 140/20, γ=0, doomUnitMax=0.99, grid aimed at
   $2,000 caps and 500–1,000 matched shares, e.g. 4 configs submitted
   together: {q=100,I_b=160,B=2000}, {q=200,I_b=320,B=2000},
   {q=300,I_b=480,B=2000}, {q=200,I_b=320,B=1000}; band:q ratio held at
   1.6 per E-033. **Schema bounds VERIFIED s20 (pair.v15.ts:64–78):
   capPerMarket ≤ 2000 OK, but orderSize ≤ 100 and imbalanceBand ≤ 200
   BLOCK the q=200/300 cells — E-036's frozen design must include a
   deliberate bound raise (e.g. orderSize ≤ 400, imbalanceBand ≤ 800;
   M5's spirit kept — bounds stay, raised with the depth argument
   named) committed BEFORE submission, and cannot run while v15 jobs
   are queued (fleet currently idle).**
   Baselines: 948/952/956/957 (same SHA 4a5982e if unchanged; else
   fresh same-SHA baseline). Metrics: §3 set + matched-share
   distribution vs the 500–1,000 aspiration; verdict bars: per-$100
   0.54 / ev 0.30 vs the E-033 trend, PLUS the mission's (a)/(b)
   disjunction — approach the range or mechanically explain why not
   (guard-7 depth optimism MUST be named: q ≥ 200 vs ToB depth 300–450
   makes whole-size fills increasingly optimistic — this may BE the
   mechanical evidence (b)).
   Launch command shape (verify schema first):
   `npx tsx protocols/pair-fable/tools/run-backtest.ts --strategy
   pair-fable-v15 --param capPerMarket=2000 --param orderSize=200
   --param imbalanceBand=320 --param pairTarget=0.96 --param
   doomUnitMax=0.99 --param lagAggr=0 --latest 800 --to-ms
   1784762100000 --queue --json` (one per config).
2. **P-013 (needs human):** sell-side mirror scope ruling (PROPOSALS).
   Under the amended priority rules this is explicitly a program-change
   question — no sell-side work beyond the filed proposal without the
   ruling.
3. **High-activity regime probe (inbox d904e17d):** design AFTER E-036;
   frame as neutral-controller cadence work (GREEN) with the fill-model
   caveat named (E-025 calibrated at ToB only).
4. **Cross-symbol replication:** gated on P-012. v15 HOW/WHICH/tilt: no
   further spend without a new measured signal (guard-4 stands, scale
   axis EXCEPTED per the amendment). M1–M5: ALL IMPLEMENTED (4809a8e).

## Alignment gate — session 20 (first gate under 08a85f4)

- **Classification:** supporting-diagnostic (E-034 selection; E-035
  directional-tilt signal gate).
- **Direct mission contribution:** closed the §5 directional-controller
  signal question with evidence — the only candidate tilt signal is
  refuted OOS (E-035, 9,947 markets; commits 7154ff8→1c782a9), so the
  directional controller has NO measured signal to build on; closed the
  WHICH axis (E-034, d4da4e1→d524070). Both were the pre-amendment
  STATUS plan; both directly inform controller math (what NOT to build).
- **Time to evidence:** ~5 min (session start ≈18:08, E-034 design
  commit 18:11:58, first scan execution ≈18:13). Target met.
- **Throughput:** 2 experiments completed; 10,747 market-replays
  analyzed locally (800 mktselect + 9,947 calib); E-035 sharded 6-way
  (~3 mkts/s aggregate); E-034's 800-market scan ran single-process
  (~13 min) — reason: launched before the amendment existed; mktselect
  supports checkpoint but not offset-sharding yet. Zero fleet runs
  (analysis-only session; fleet idle by design — no controller grid was
  justified until the diagnostic verdicts landed).
- **Scale progress:** none this session (diagnostics). Open gap: $2,000
  untested, best matched-share M mean 231 (E-033) vs 500–1,000 target.
  E-036 (next) attacks exactly this gap.
- **Next-session priority:** E-036 scale-check grid (GREEN,
  neutral-controller); commands above.
- **Verdict:** **YELLOW** (supporting diagnostics that directly inform
  controller/directional math; first consecutive YELLOW — s19 was GREEN
  controller testing). Next session MUST be GREEN (E-036 satisfies
  this).
- Previous verdicts for consecutive-YELLOW enforcement: s19 GREEN
  (retro-classified: E-032/E-033 controller grids), s20 YELLOW.

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
