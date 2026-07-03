# Research Memory

Research memory is the file-based record that lets the next human or agent
continue without reading chat history. This file is authoritative for what
each memory file stores, who writes every field, and when.

## The model

- **Files store knowledge; the database owns operational state.** What was
  tried, with what params, what resulted, what it means — files. Whether a
  batch is still computing — database, queried via
  [`strategy-research-protocol/tools/checkBatch.md`](./tools/checkBatch.md),
  never stored in files.
- **FAMILY.json = exact facts** (state + numbers), written by agents flipping
  the state they own and by the Evaluator recording judgment.
- **FAMILY.md = reasoning** (prose), written once at proposal time plus an
  append-only Research log written only by the Researcher.
- **The family folder is the memory unit.** Agents always read both files;
  each is small. The experiment id is the join key: `"id": "001-..."` in
  FAMILY.json ↔ `### 001-...` in the FAMILY.md Research log.

```text
src/strategies/research/<family>/FAMILY.md      reasoning + Research log
src/strategies/research/<family>/FAMILY.json    state + numbers
src/strategies/research/<family>/*.ts           strategy code (frozen after results)
src/strategies/research/INDEX.json              generated rollup — never hand-edit
strategy-research-protocol/LESSONS.md           cross-family lessons — append-only
```

[`strategy-research-protocol/LESSONS.md`](./LESSONS.md) is the fourth memory
surface: lessons that generalize beyond one family get promoted there by the
Researcher (mandatory check at kill/validated) and are required reading for
ProposeFamily and the Researcher.

Exact shapes are enforced by `strategy-research-protocol/schemas/` and
validated by `npm run research:check`.

## Writer matrix

| surface                                          | who writes                        | what                                                                                                      |
| ------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| FAMILY.md proposal sections                      | ProposeFamily, once               | Thesis, Signal definition, Edge economics, Experiment roadmap, Duplicate notes                            |
| FAMILY.md Research log                           | Researcher only                   | one dated `### <experiment-id>` entry per evaluated experiment, ending with `Lesson:`                     |
| FAMILY.json experiment specs + lifecycle it owns | Researcher                        | new experiment records, `queued`/`running`/`aborted`, `retryOnlyIf`, `verdictSummary` on kill             |
| FAMILY.json judgment fields                      | Evaluator                         | pass `best`/`note`, `outcome`, `evaluated`, `champion`, family `validated`, `verdictSummary` on validated |
| FAMILY.json creation                             | ProposeFamily                     | the initial file with one queued `000-baseline`                                                           |
| INDEX.json                                       | `buildStrategyIndex` script only  | generated rollup                                                                                          |
| LESSONS.md                                       | Researcher (or user), append-only | cross-family lessons; ban-worthy ones also add a CONSTRAINTS.md line                                      |
| family `live` status                             | user only                         | —                                                                                                         |

The Evaluator never writes FAMILY.md. The Researcher never writes `best`,
`outcome`, or any verdict.

## FAMILY.json — family-level fields

| field            | meaning                                                                  | written by                                                                                     | when                    |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------- |
| `schemaVersion`  | literal `2`                                                              | ProposeFamily                                                                                  | creation                |
| `artifactType`   | literal `strategy-family-index`                                          | ProposeFamily                                                                                  | creation                |
| `family`         | kebab slug, equals folder name                                           | ProposeFamily                                                                                  | creation                |
| `status`         | `proposed` / `researching` / `validated` / `killed` / `live`             | see status owners in [`strategy-research-protocol/schemas/statuses.ts`](./schemas/statuses.ts) | at each transition      |
| `coreIdea`       | one-sentence idea                                                        | ProposeFamily                                                                                  | creation                |
| `duplicateKeys`  | normalized synonyms for dedup                                            | ProposeFamily; Researcher may extend                                                           | creation / on discovery |
| `retryOnlyIf`    | concrete revisit condition, e.g. "replay gains queue-position semantics" | Researcher                                                                                     | at kill                 |
| `champion`       | experiment id of current champion, or null                               | Evaluator                                                                                      | at promotion            |
| `verdictSummary` | one sentence for the INDEX rollup                                        | Researcher (kill) / Evaluator (validated)                                                      | at kill / validated     |
| `tags`           | discovery tags                                                           | ProposeFamily                                                                                  | creation                |
| `experiments[]`  | experiment records, see below                                            | —                                                                                              | —                       |

## FAMILY.json — experiment-level fields

| field             | meaning                                                         | written by                                                        | when                                              |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| `id`              | `NNN-kebab-hypothesis`, sequential, never reused                | Researcher                                                        | spec time                                         |
| `kind`            | `param-search` \| `variation`                                   | Researcher                                                        | spec time                                         |
| `code`            | strategy file this experiment runs                              | Researcher                                                        | spec time                                         |
| `basedOn`         | experiment this branches from (null for baseline)               | Researcher                                                        | spec time                                         |
| `hypothesis`      | one sentence: the idea being tested                             | Researcher                                                        | spec time, BEFORE running                         |
| `successCriteria` | plain-sentence bar; default "pass the next stage's gate"        | Researcher                                                        | spec time, BEFORE running                         |
| `params`          | fixed params (single run; XOR with `search`)                    | Researcher                                                        | spec time                                         |
| `search`          | coordinate-search spec `{mode, defaults, passes[], refine}`     | Researcher (`refine` grid: Evaluator request, Researcher submits) | spec time; passes appended as the search proceeds |
| `batchUid`        | grouping label for single-run experiments (null in search mode) | Researcher                                                        | at submit                                         |
| `submissionUids`  | run handles for single-run experiments                          | Researcher                                                        | at submit                                         |
| `baselineId`      | comparison-anchor run id, passed as `--baselineId`              | Researcher                                                        | at submit                                         |
| `coverage`        | `{selection, markets, fromMs, toMs}`, grows with extensions     | Researcher                                                        | at submit / extend                                |
| `status`          | `queued` / `running` / `evaluated` / `aborted`                  | Researcher (all but `evaluated`) / Evaluator (`evaluated`)        | at each transition                                |
| `gateLog`         | gate decisions in climb order `{stage, decision, at, note}`     | Evaluator                                                         | at each gate decision                             |
| `submittedAt`     | ISO timestamp                                                   | Researcher                                                        | at first submit                                   |
| `decidedAt`       | ISO timestamp                                                   | Evaluator                                                         | at verdict                                        |
| `abortReason`     | why an aborted experiment died                                  | Researcher                                                        | at abort                                          |
| `outcome`         | judgment block, see below                                       | Evaluator                                                         | at verdict                                        |

## FAMILY.json — pass fields (`search.passes[]`)

Pass state is derived — no status enum: empty `submissionUids` = not
submitted; `submissionUids` set + `best` null = awaiting judgment; `best`
set = judged.

| field            | meaning                                               | written by | when             |
| ---------------- | ----------------------------------------------------- | ---------- | ---------------- |
| `param`          | the one param this pass sweeps                        | Researcher | pass spec        |
| `values`         | values tested, e.g. `[0.3, 0.4, 0.5]`                 | Researcher | pass spec        |
| `batchUid`       | `<family>--<exp>--pN-<param>`                         | Researcher | at submit        |
| `submissionUids` | exact run handles (same in Redis and `backtest_runs`) | Researcher | at submit        |
| `best`           | winning value — judgment, not blind argmax            | Evaluator  | at pass judgment |
| `note`           | one line, e.g. "flat — param doesn't matter"          | Evaluator  | at pass judgment |

`search.refine` (optional, Evaluator-requested mini-grid, batchUid
`<family>--<exp>--refine`) mirrors this shape with `params` as a
values-per-param map and `best` as the winning cell.

## FAMILY.json — outcome fields

| field          | meaning                                                                                        | written by | when       |
| -------------- | ---------------------------------------------------------------------------------------------- | ---------- | ---------- |
| `verdict`      | `success` / `fail` / `inconclusive` vs the quoted successCriteria                              | Evaluator  | at verdict |
| `bestParams`   | full winning param set (defaults + pass winners)                                               | Evaluator  | at verdict |
| `metrics`      | `netEvPerMarket`, `grossEvPerMarket`, `markets`, `trades`, `trainNetEv`, `testNetEv`           | Evaluator  | at verdict |
| `reason`       | one factual sentence with numbers, no narrative                                                | Evaluator  | at verdict |
| `stageReached` | highest [`strategy-research-protocol/STAGE-GATES.md`](./STAGE-GATES.md) gate passed (0 = none) | Evaluator  | at verdict |
| `gatesVersion` | STAGE-GATES.md version used for judgment                                                       | Evaluator  | at verdict |

Metric vocabulary: verdicts are judged on `netEvPerMarket` (= evPerMarketTotal,
net of fees). Gross is diagnostic only.

## FAMILY.md — sections

| section            | contains                                                                                                                                                                             | written by      | when                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ---------------------------- |
| Thesis             | who is on the other side, why the mispricing exists, why it survives arbitrage                                                                                                       | ProposeFamily   | once, at proposal            |
| Signal definition  | precise formulas over recorded fields only                                                                                                                                           | ProposeFamily   | once, at proposal            |
| Edge economics     | why the edge should be structurally fat, citing measured comparables — the pre-run kill test                                                                                         | ProposeFamily   | once, at proposal            |
| Experiment roadmap | ranked, unqueued, mechanism-distinct ideas (at least 5)                                                                                                                              | ProposeFamily   | once; Researcher may extend  |
| Duplicate notes    | near-duplicate reasoning, matches `duplicateKeys`                                                                                                                                    | ProposeFamily   | once, at proposal            |
| Research log       | append-only, one dated `### <experiment-id>` entry per evaluated experiment: what ran, key numbers quoted from FAMILY.json, interpretation, decision, mandatory final `Lesson:` line | Researcher only | after consuming each verdict |

Prose and numbers do not compete: numbers live in FAMILY.json; the Research
log quotes them and explains what they mean. Never state a number only in
prose.

## Log-before-acting

A Researcher may not queue a new experiment and may not kill the family while
any evaluated experiment lacks its Research-log entry. Write the lesson
first, then act. `npm run research:check` enforces this (the single most
recently evaluated experiment may transiently lack an entry while nothing
else is in flight).

## Update triggers

Update memory at every one of these moments — the next agent must be able to
continue from files alone:

- a family is proposed → both files created, `000-baseline` queued
- an experiment is specced → record with hypothesis + successCriteria, `queued`
- a submission happens → `running`, batchUid + submissionUids + coverage + baselineId recorded
- coverage is extended (stage climb) → `coverage` updated
- a pass is judged → `best` + `note`
- a gate is judged → `gateLog` entry (`go`/`recycle`)
- an experiment is judged → `outcome`, `evaluated`, possibly `champion`
- the verdict is consumed → Research-log entry with `Lesson:`; if the lesson
  generalizes → LESSONS.md entry (and a CONSTRAINTS.md line when ban-worthy)
- a family is killed → `killed` + `retryOnlyIf` + `verdictSummary` + closing
  log entry + mandatory LESSONS.md check
- a family is validated → `validated` + `verdictSummary` + mandatory
  LESSONS.md check
- family metadata changed → rebuild INDEX.json (`npm run research:build-index`)

## Consistency rules

- Research conclusions must never live only in chat history.
- FAMILY.md and FAMILY.json must not contradict each other; on conflict the
  JSON facts win and the log entry is corrected.
- Do not hand-edit INDEX.json.
- Do not put unqueued future ideas in FAMILY.json — the roadmap lives in
  FAMILY.md until an idea becomes a real experiment.
- Every result must be retrievable later: batchUids + submissionUids in the
  JSON are the pointers into `backtest_runs`.
- A killed family needs a concrete `retryOnlyIf`, never "maybe try later".

## Final memory check

Before finishing any research step, verify:

- FAMILY.json records the structured state change.
- FAMILY.md Research log records the lesson (if a verdict was consumed).
- `npm run research:check` passes.
- INDEX.json was rebuilt if family metadata changed.
- The next agent can continue from files alone.
