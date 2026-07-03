# TASKS — Strategy Research Protocol v2 implementation plan

Status: **IMPLEMENTED** (2026-07-03) — all 17 build tasks landed; kept as the
design record. Implementation deviations from the letter of this plan:

- Stage monotonicity (task 2) is enforced in `scripts/research-check.ts`
  (which reads the STAGE-GATES.md config block) instead of hardcoding policy
  numbers into the Zod schema.
- Two fields were added beyond the section-1 inventory: experiment-level
  `batchUid`/`submissionUids` (single-run experiments have no passes to carry
  them) and `abortReason` (aborted experiments record why).

Remaining user actions (section 4): delete the old-format families under
`src/strategies/research/`, then `npm run research:build-index`.

This file supersedes `TODO.md` and is self-contained: a fresh session must be
able to understand the design below without the original chat history.

All paths are relative to `strategy-research-protocol/` unless stated otherwise.

## 0. Locked design decisions

### Principles

1. **Files store knowledge; the DB owns operational state.** Never mirror
   operational state (e.g. "batch finished") into files — query it with tools
   (`checkBatch`). There is deliberately NO "backtested" status, no sync
   daemon, and no change to the aggregate worker.
2. **FAMILY.json = exact facts** (state + numbers). **FAMILY.md = reasoning**
   (prose). The family folder is the memory unit. Agents always read both
   files; the experiment id is the join key between them.
3. **Writer rules.** The Researcher writes all FAMILY.md content and the JSON
   state it owns (experiment specs, `queued`/`running`/`aborted`,
   `retryOnlyIf` on kill). The Evaluator writes the JSON judgment fields
   (`best`, `outcome`, `evaluated`, `champion`, family `validated`) and never
   writes FAMILY.md. Programs only read family files, except
   `buildStrategyIndex` which writes `INDEX.json`.
4. **LLM judgment only at boundaries** (propose / judge / kill). Everything
   mechanical is a deterministic script.
5. **Pre-declared contracts.** Every experiment declares `hypothesis` and
   `successCriteria` (plain sentences) BEFORE submission. The Evaluator must
   quote the `successCriteria` in its verdict.
6. **Concurrency.** At most ONE experiment per family in `queued`/`running` at
   any time. Parallelism comes from many families. A Researcher session works
   on exactly ONE family and never touches another family's files.
7. **Workers run committed code.** Commit (and push when workers are remote)
   before submitting any run.
8. **Smoke runs** (batchUid suffix `--smoke`, `--sequential --limit 10`) never
   count as evidence and never trigger the freeze rule.
9. **`validated` is not terminal for research.** A family whose champion
   passed the final gate keeps receiving challenger experiments; the champion
   pointer moves if a challenger beats it and passes the gates itself.
   Research on a family ends only through `killed` or user decision.
10. **A negative baseline does not imply kill.** The family stays
    `researching` and the roadmap continues, governed by the stopping rules in
    `STAGE-GATES.md`.

### Statuses and owners

Experiment lifecycle (single enum, one owner per transition):

| status      | meaning                                       | set by     |
| ----------- | --------------------------------------------- | ---------- |
| `queued`    | spec AND code complete, ready to submit       | Researcher |
| `running`   | submitted; batchUid + submissionUids recorded | Researcher |
| `evaluated` | outcome fully written                         | Evaluator  |
| `aborted`   | permanently failed / superseded, with reason  | Researcher |

Verdict (`success` / `fail` / `inconclusive`) lives inside `outcome` and only
exists once `evaluated`. It answers exactly: "did it meet its pre-declared
successCriteria".

Family lifecycle:

| status        | meaning                                                     | set by        |
| ------------- | ----------------------------------------------------------- | ------------- |
| `proposed`    | folder exists, nothing submitted                            | ProposeFamily |
| `researching` | first submission happened, no terminal call                 | Researcher    |
| `validated`   | a champion passed the final stage gate (research continues) | Evaluator     |
| `killed`      | dead end; concrete `retryOnlyIf` required                   | Researcher    |
| `live`        | trading real money                                          | user only     |

### Roles

- **ProposeFamily** — creates one family: FAMILY.md proposal sections,
  FAMILY.json with exactly one queued `000-baseline`, and `000-baseline.ts`.
  The Edge economics section acts as a pre-run kill test at proposal time.
  The roadmap must contain at least 5 mechanism-distinct ideas (needed by the
  empirical-kill rule).
- **Researcher** — drives one family per session in stateless iterations:
  read both files → the resume-guide state table implies the next action → do
  it → write files → exit. Free reasoning within the rules; the state table is
  a resume guide, not a controller. Specs and codes experiments, submits runs
  and stage extensions, writes every Research-log entry and `Lesson:` line
  (log-before-acting rule), decides continue-or-kill per `STAGE-GATES.md`.
- **Evaluator** — sole reader of raw backtest results. Judges each pass
  (writes `best`; judgment, not blind argmax: prefer stable plateaus over
  isolated spikes, flag flat params, distrust thin samples) and each
  experiment (writes `outcome`, quotes `successCriteria`). May request a
  refinement grid or a stage extension before the final verdict. Moves the
  `champion` pointer and sets family `validated`.
- **User** — flips `live`; may kill anything at any time.

### Coordinate parameter search (default for `param-search` experiments)

- Declared in the experiment record: `search.mode = "coordinate"`, `defaults`
  (justified in FAMILY.md), params ordered by expected impact.
- One pass sweeps ONE param; the others stay at defaults / previous winners.
- Pass batchUid: `<family>--<exp>--pN-<param>`.
- Pass state is DERIVED from fields — no status enum: no `submissionUids` =
  not submitted; `submissionUids` present + `best` null = awaiting judgment;
  `best` set = judged.
- Optional final refinement mini-grid around the found optimum (2–3 values per
  param), only at the Evaluator's request.
- Pre-declared abort rule for dead baselines (e.g. "if every cell of pass 1
  has netEvPerMarket < −$0.50, abort the experiment").

### Run identity

- `batchUid` — human grouping label:
  `<family>--<experiment-id>[--pN-<param> | --smoke | --rN]`.
- `submissionUids` — exact tracking handles, identical in Redis and
  `backtest_runs.submission_uid`; completion checks key on them.
- `baselineId` — run id of the current comparison anchor (champion's best
  cell, or `000-baseline`'s best cell). Passed as `--baselineId` on
  submission, stored on the experiment.

## 1. Field inventory

### FAMILY.json — family level

| field            | meaning                                               | writer                                    |
| ---------------- | ----------------------------------------------------- | ----------------------------------------- |
| `schemaVersion`  | literal `2`                                           | ProposeFamily                             |
| `artifactType`   | literal `strategy-family-index`                       | ProposeFamily                             |
| `family`         | kebab slug, equals folder name                        | ProposeFamily                             |
| `status`         | family lifecycle status                               | see status table                          |
| `coreIdea`       | one-sentence idea (for INDEX dedup)                   | ProposeFamily                             |
| `duplicateKeys`  | normalized synonyms for dedup                         | ProposeFamily/Researcher                  |
| `retryOnlyIf`    | concrete revisit condition; required when `killed`    | Researcher                                |
| `champion`       | experiment id of current champion, or null            | Evaluator                                 |
| `verdictSummary` | one sentence written at kill/validated (INDEX rollup) | Researcher (kill) / Evaluator (validated) |
| `tags`           | discovery tags                                        | ProposeFamily                             |
| `experiments[]`  | the experiment records                                | see below                                 |

### FAMILY.json — experiment level

| field                       | meaning                                                                           | writer                 |
| --------------------------- | --------------------------------------------------------------------------------- | ---------------------- |
| `id`                        | `NNN-kebab-hypothesis`, sequential, never reused                                  | Researcher             |
| `kind`                      | `param-search` \| `variation`                                                     | Researcher             |
| `code`                      | strategy file this experiment runs (`000-baseline.ts`, …)                         | Researcher             |
| `basedOn`                   | experiment id this branches from (null for baseline)                              | Researcher             |
| `hypothesis`                | one-sentence idea being tested, written BEFORE running                            | Researcher             |
| `successCriteria`           | plain-sentence bar, written BEFORE running; default: "pass the next stage's gate" | Researcher             |
| `params`                    | fixed params for a single run (XOR with `search`)                                 | Researcher             |
| `search`                    | coordinate-search spec: `{ mode, defaults, passes[] }`                            | Researcher             |
| `baselineId`                | comparison anchor run id                                                          | Researcher             |
| `coverage`                  | `{ selection, markets, fromMs, toMs }`, grows with extensions                     | Researcher             |
| `status`                    | experiment lifecycle status                                                       | see status table       |
| `submittedAt` / `decidedAt` | ISO timestamps                                                                    | Researcher / Evaluator |
| `outcome`                   | judgment block, exists only when `evaluated`                                      | Evaluator              |

### FAMILY.json — pass level (`search.passes[]`)

| field            | meaning                                      | writer     |
| ---------------- | -------------------------------------------- | ---------- |
| `param`          | the one param this pass sweeps               | Researcher |
| `values`         | values tested                                | Researcher |
| `batchUid`       | `<family>--<exp>--pN-<param>`                | Researcher |
| `submissionUids` | exact run handles for this pass              | Researcher |
| `best`           | winning value (judgment, not blind argmax)   | Evaluator  |
| `note`           | one line, e.g. "flat — param doesn't matter" | Evaluator  |

### FAMILY.json — outcome block

| field          | meaning                                                                        | writer    |
| -------------- | ------------------------------------------------------------------------------ | --------- |
| `verdict`      | `success` \| `fail` \| `inconclusive` vs successCriteria                       | Evaluator |
| `bestParams`   | full winning param set                                                         | Evaluator |
| `metrics`      | `{ netEvPerMarket, grossEvPerMarket, markets, trades, trainNetEv, testNetEv }` | Evaluator |
| `reason`       | one factual sentence (numbers, no narrative)                                   | Evaluator |
| `stageReached` | highest stage whose gate was passed                                            | Evaluator |
| `gatesVersion` | STAGE-GATES.md version used for judgment                                       | Evaluator |

Metric vocabulary: judge on `netEvPerMarket` (= evPerMarketTotal, net of
fees). Gross is diagnostic only, never a verdict basis.

### FAMILY.md — sections

Frontmatter stays minimal: `artifactType: strategy-family`, `family: <slug>`.

Write-once at proposal time (ProposeFamily):

1. **Thesis** — who is on the other side of the trade, why the mispricing
   exists, why it has not been arbitraged away.
2. **Signal definition** — precise formulas over recorded fields only.
3. **Edge economics** — expected gross edge magnitude vs the fee/cost floor;
   if plausible gross edge < costs, the family must not be proposed.
4. **Experiment roadmap** — ranked, unqueued, mechanism-distinct ideas (≥5).
5. **Duplicate notes** — near-duplicate reasoning, matches `duplicateKeys`.

Living section (Researcher only):

6. **Research log** — append-only; one dated `### <experiment-id>` entry per
   evaluated experiment: what ran, key numbers (quoted from JSON), the
   interpretation, the decision, and a mandatory final `Lesson:` line.
   Rule: no new experiment may be queued and no kill recorded while an
   evaluated experiment lacks its entry (log-before-acting).

## 2. STAGE-GATES.md — go/kill decision rules (new file)

The intro line of the file anchors the model for LLM readers, as orientation
only (the rules in this file are authoritative where they differ):

> This file adapts the Stage-Gate model (Cooper) to strategy research:
> stages of increasing data investment, gates with pre-declared go/kill
> criteria between them.

Frontmatter carries `version: 1`; all tunable numbers live in a config block
at the top so the user can adjust without touching modules.

### Part 1 — the stages (per champion-candidate experiment)

| stage          | coverage                                | gate to advance                                                                               | mechanism                              |
| -------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| 0 smoke        | ~10 markets                             | runs without errors; never evidence                                                           | `--sequential`, `--smoke`              |
| 1 screen       | latest 1000                             | best cell `netEvPerMarket > 0` on the test split                                              | coordinate search runs here            |
| 2 confirm      | 3000 total (same run + 2000 next-older) | still positive; train/test consistent                                                         | `extendBacktest --latest --limit 2000` |
| 3 full history | ~9000+ total                            | positive overall AND stable across monthly chunks (no sign-flip regimes) → family `validated` | `extendBacktest`                       |
| live           | —                                       | user judgment; dry-run first                                                                  | out of protocol scope                  |

- Extensions grow coverage backward contiguously (newest missing first), so
  stage 1's most-relevant recent data is always included.
- Advancing happens inside ONE experiment record: coverage grows, `outcome`
  records `stageReached`.
- No forward-holdout stage in v1 — the user observes the live dry-run instead;
  a stage 4 (fresh markets postdating all decisions) may be added later.
- Flow A: baseline finds no positive EV → family stays `researching`, the
  roadmap continues.
- Flow B: an experiment passes the stage-1 gate → advance stage by stage; on
  passing the final gate the family becomes `validated` AND research continues
  (challengers keep coming; the champion pointer moves only if a challenger
  passes the gates itself).

### Part 2 — stopping rules (when a family may be killed)

Config: `minExperiments: 20`.

- **Structural kill** — allowed at any experiment count. Requires a numeric
  ceiling argument in the closing log entry: e.g. "at zero-noise entries the
  max gross edge is $X/mkt; the fee floor is $Y > X". If the mechanism cannot
  pay costs at its theoretical best, more experiments cannot fix it.
- **Empirical kill** — results keep failing but no ceiling is proven.
  Requires ALL of: every mechanism-distinct roadmap idea tried, at least
  `minExperiments` experiments evaluated, and no improvement trend across the
  recent experiments.
- Every kill records `retryOnlyIf` (concrete, testable condition) and a
  closing Research-log entry with a `Lesson:` line.

## 3. Build tasks (ordered)

Each task should land with `npm run lint` clean and typecheck passing.

1. **`schemas/statuses.ts` — rewrite.** New enums with ownership
   doc-comments: `ExperimentStatus` (queued/running/evaluated/aborted),
   `Verdict` (success/fail/inconclusive), `FamilyStatus`
   (proposed/researching/validated/killed/live), keep `Slug`, `ExperimentId`,
   `ExperimentKind`. Delete `Decision` and `ResultRef` (replaced by
   batchUid/submissionUids fields).
2. **`schemas/FAMILY.json.ts` — rewrite.** `Pass`, `Search`, `Coverage`,
   `Outcome`, `Experiment`, `FamilyIndex` schemas per the field inventory.
   Invariants (superRefine): unique experiment ids; `000-baseline` exists and
   uses `000-baseline.ts`; `params` XOR `search`; at most one experiment in
   queued/running; `evaluated` ⇒ `outcome` present; `killed` ⇒ `retryOnlyIf`
   present; `champion` must reference an evaluated experiment with verdict
   `success`; `basedOn` references an existing id; `stageReached` consistent
   with `coverage.markets` (stage monotonicity).
3. **`schemas/FAMILY.md.ts` — rewrite.** New required H2 sections (Thesis,
   Signal definition, Edge economics, Experiment roadmap, Duplicate notes,
   Research log). Parse Research-log `### <experiment-id>` headings and
   validate: each maps to a known experiment id and contains a `Lesson:`
   line; every evaluated experiment has an entry (exported check used by
   research:check with the log-before-acting exception window).
4. **`STAGE-GATES.md` — new.** Content per section 2 above, including the
   one-line Stage-Gate (Cooper) orientation anchor.
5. **`schemas/INDEX.json.ts` + `scripts/buildStrategyIndex.ts` — update.**
   Rollup gains `verdictSummary`, champion `outcome.metrics` summary, and
   `stageReached`, so ProposeFamily dedup/inspiration works from INDEX alone.
6. **`scripts/research-check.ts` — new** (+ root `package.json` script
   `research:check`). Validates every family folder: both schemas, cross-file
   invariants (log entries, one-active-experiment, champion consistency,
   MD/JSON id matching, folder name = family slug).
7. **`scripts/check-batch.ts` — new** (+ `tools/checkBatch.md` +
   root `package.json` script `research:check-batch`). Input: family +
   experiment (reads submissionUids from FAMILY.json) or explicit
   submissionUids. Output: finished/total per pass, overall complete yes/no.
   Read-only against DB/Redis.
8. **`MEMORY.md` — rewrite.** The field tables from section 1 (field /
   meaning / writer / when / example), the writer matrix, update triggers,
   and the join-key rule (experiment id links JSON ↔ MD log).
9. **`README.md` — rewrite lifecycle sections.** New loop description, the
   two diagrams as mermaid (architecture: 3 agents + folder + workers + DB;
   status machines with owners), links to STAGE-GATES.md and new modules.
10. **`rules/BATCH-UID.md` — update.** Pass suffix `--pN-<param>`, smoke
    suffix `--smoke`, re-run suffix `--rN`; one experiment = many batches is
    now normal.
11. **`rules/EXPERIMENT-NAMING.md` — update.** Smoke runs excluded from the
    freeze rule; verdict/status vocabulary updated; champion pointer
    mechanics unchanged.
12. **`tools/runBacktest.md` — update.** `--baselineId` on every experiment
    submission; record submissionUids at submit time; per-pass submission
    profile; smoke profile; stage coverage profiles (1000/3000/9000).
13. **`tools/getBacktestResults.md` — update.** Evaluation output: per-cell
    sorted table with net/gross EV and train/test split; reference checkBatch
    for completion.
14. **`modules/ProposeFamily.md` — update.** New artifact shapes, Edge
    economics gate, roadmap ≥5 mechanism-distinct ideas, successCriteria +
    hypothesis required on the seeded baseline experiment.
15. **`modules/Researcher.md` — new.** Iteration contract (read → state table
    → one action → write → exit), resume-guide table, log-before-acting rule,
    stage advancement, stopping rules, commit/push precondition, one-family
    scope, JSON fields it may write.
16. **`modules/Evaluator.md` — new.** Sole raw-results reader; judgment
    guidance (plateau over spike, flat params, thin samples, abort rule);
    pass judgment (`best` + `note`); experiment judgment (`outcome`, quote
    successCriteria); refinement/extension requests; champion + `validated`;
    never writes MD.
17. **Small updates.** `modules/index.md` (new module list), `GLOSSARY.md`
    (pass, verdict, stage, gate, smoke run, submissionUid, baselineId,
    coordinate search), `AGENTS.md` (role map), `tools/index.md` (checkBatch),
    `scripts/propose-family.sh` (review against new ProposeFamily.md),
    `examples/FAMILY.md` + `examples/FAMILY.json` (regenerate in the new
    format, including one worked Research-log entry), delete `TODO.md`.

## 4. User actions / out of scope

- Delete the 12 test families under `src/strategies/research/` (user does
  this; they predate this design).
- Future candidates, deliberately NOT in v1: forward-holdout stage,
  cross-symbol stages (ETH/SOL/XRP), live dry-run protocol, autonomous
  multi-family loop.

## 5. Open items

None — the design is locked. `STAGE-GATES.md` is the confirmed name for the
go/kill decision rules file.
