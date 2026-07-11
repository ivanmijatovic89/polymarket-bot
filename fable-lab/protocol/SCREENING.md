# SCREENING — the batch screening tier (operator mandate, 2026-07-11)

_Motivating evidence (governor): the operator's exploration mandate,
throughput calibration target (≥20 screens/night) and batch-economics
note (STATE.md operator updates 2026-07-11; charter §Data reality). The
prior per-idea path cost a full spec + validator + smoke + fresh-context
Judge per idea — ~10 ideas in the lab's whole life. This tier preserves
the bias protections that matter (pre-committed prediction and kill rule,
no post-hoc cell choice) and cuts everything that was per-idea ceremony._

## What a screen is

A screen is a CHEAP, KILL-BIASED first contact between a mechanism idea
and data: one strategy file, one frozen mini-spec row, one fleet run
(N = 500), one verdict line. Screens replace nothing downstream: a
survivor graduates into the FULL experiment lifecycle (spec freeze at
LIFECYCLE §2, grid, main, holdout) with its screen admissible as
probe-stage evidence.

## Mechanics

1. **Batch file** `protocol/registry/screens/BATCH-NNN.md` — one file per
   sitting. Per screen, a frozen mini-spec block (the bias-critical
   fields, nothing else):
   - `id` SCR-NNN-<k>, mechanism one-liner
   - `not-a-reskin:` one line naming the nearest dead class (E9-E23 /
     EDGE-SPACE §1) and the distinguishing element (D5 discipline)
   - `invariants:` one line naming the recorded-data invariants the
     premise touches and why it survives them (D50, motivated by E27:
     SCR-007's premise required the two books to disagree transiently,
     which the same-tick mirror invariant — CAL-001 am. #12 — forbids;
     the run was derivably dead at freeze). Current list in E27(c):
     mirror books, self-crossed books, boundary leak, worst-queue =
     informative punch-through, results.ts zero-PnL convention.
   - `aim:` the SIGNAL-MAP zone it targets, or `unaimed` (mechanism-level
     gap) — unaimed is allowed, the map is an aiming aid not a gate
   - `strategy:` file + params (the primary cell, chosen before results)
   - `prediction:` the sign/shape the mechanism requires
   - `kill:` the default bar (below) or a stricter one
2. **Freeze = the commit.** The batch file AND all strategy files are
   committed and pushed BEFORE any submission (submit.ts enforces a clean
   tree for fleet runs anyway — the same commit is the freeze anchor).
3. **Sample rule (all screens):** fleet `--detach`, `--random --limit 500`,
   `--to-ms 1772323199999` (DISCOVERY window only — strictly before
   2026-03-01). The 5,460-market reserve and the holdout stay untouched by
   every screen, preserving both for survivor confirmation and
   CONFIRM-010. Latency pinned per D8.
   _Low-incidence exception (D49 amendment 2, 2026-07-11): a screen whose
   gate incidence makes N=500 structurally unable to reach the SURVIVE
   bar (expected played < ~100) may pre-freeze N up to 2000, stating its
   incidence arithmetic in the mini-spec. Same window, same randomness —
   only the size changes, and only BEFORE the freeze commit._
4. **Batch verdict:** ONE results table for the whole batch (runs read via
   `tools/results.ts` / `tools/battery.ts` semantics), appended to the
   batch file. Per screen one verdict line: kill / survive / park-design
   (plumbing failure: 0 entries where entries were structurally expected).
   Journal one line per screen (operator mandate).
5. **Verification depth (batch-scaled):** no per-screen fresh-context
   Judge. ONE fresh-context checker per batch verdict table, checking:
   numbers match DB, each verdict follows its own frozen bar, no
   post-results spec edits (git diff of the batch file since freeze
   commit). Survivors additionally get the full Judge at graduation
   (unchanged rigor where it pays — operator mandate).
   _Amendment 4 (2026-07-11, E28/D51): the checker must RE-VERIFY every
   "in-log" / "verified" claim in the batch file against the artifact it
   cites (grep the named log lines: latency env, D18 hook, failure
   count) — sessions 61-62 wrote "latency pinned (in-log)" claims that
   the logs contradict; a claim without its pasted artifact line is a
   finding._

## Verdict bars (frozen; a screen states deviations pre-freeze or gets the default)

_q̂ and t are computed over ALL N sampled markets (the results.ts
convention), not played-only — pinned 2026-07-11 after the BATCH-001
touch checker flagged the ambiguity (its finding 4: both readings
killed all three runs, but a survive-adjacent case needs the population
fixed pre-freeze). A mini-spec may still pin played-only pre-freeze; it
must then say so explicitly._

- **KILL (default outcome):** q̂ ≤ 0, or prediction contradicted, or
  t ≤ −1, or (win-rate-skewed cell per E14 with minority-outcome count
  < 30 AND q̂ not positive at t ≥ +1.5). _Explicitly (D49 amendment 3,
  2026-07-11, motivated by the BATCH-002 checker finding 1 — SCR-006
  landed at q̂>0 ∧ −1<t<+1.5 ∧ prediction held, a region no enumerated
  branch covered): a screen that earns neither SURVIVE nor PARK-DESIGN
  is KILLED. The enumerated branches are illustrations of the default,
  not its boundary; there is no fourth outcome._
- **SURVIVE:** q̂ > 0 AND t ≥ +1.5 AND prediction held AND (if skewed per
  E14) minority-outcome count ≥ 30. Survival buys a full registration,
  not a belief — no "edge found" language at screen grade.
- **PARK-DESIGN:** structurally fill-less/entry-less runs (the EXP-006
  smoke lesson); one redesign attempt allowed inside the same batch, else
  dead.
- Maker-mechanism screens inherit D14/D18 conditionals unchanged
  (worst-queue kills are model-conditional; touch-mode screens need
  `touch` in batchUid and support kill/escalate only). Touch mode cannot
  run on the fleet (the D18 hook is wrapper-local) — touch screens run
  local `--sequential` and say so in the mini-spec.

## What screens may NOT do

- Touch the reserve or holdout (sample rule is mechanical: --to-ms).
- Advance anything to holdout directly (graduation goes through the full
  lifecycle).
- Be cited as measured edge (screen survival is probe-grade evidence
  under EPISTEMOLOGY §3 stage-1 semantics, nothing more).
- Skip the ideas ledger: every screen idea gets an IDEAS.md entry line
  (dedupe memory), added in the freeze commit.
