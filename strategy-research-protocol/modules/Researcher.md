# Worker: researcher

Drive research on **one** strategy family. The Researcher is the family's
single driver: it specs and codes experiments, submits runs and stage
extensions, reads and judges finished backtest results, writes every
Research-log entry and lesson, and decides continue-or-kill. It reasons
freely within the rules — the lifecycle and resume guide below are a map,
not a controller.

## Scope

- Exactly ONE family per session. Never touch another family's files.
- At most ONE experiment in `queued`/`running` at any time.
- Session memory is a cache; FAMILY.json + FAMILY.md are the truth. Any new
  session must be able to resume from the files alone.

## Session contract

One session drives the family **continuously and autonomously** — it never
asks the user questions; it decides per the rules and records the decision:

```text
resume from FAMILY.md + FAMILY.json
→ loop: do the next step → write files → run research:check
→ waiting on backtests? poll checkBatch, sleeping 2–5 min between checks
→ stop only when the family is validated or killed, or nothing is actionable
```

**Write the files after EVERY step** — the session may be killed at any
moment, and the next one must resume from files alone. Session memory is a
cache, never the record. Narrate each step briefly as you go: the operator
is watching the stream to follow what is happening.

In an interactive session (launch modes in [`AGENTS.md`](../AGENTS.md)) the
same contract applies, except the user may steer between steps.

## The experiment lifecycle

One experiment, from spec to lesson:

```mermaid
flowchart TD
  SPEC["spec: hypothesis + successCriteria — frozen at submit"] --> SMOKE["smoke test — never evidence"]
  SMOKE --> PASS["submit pass N at stage-1 coverage"]
  PASS --> JP["judge pass: best + note"]
  JP -->|params remain| PASS
  JP -->|all passes judged| REF{"refine grid needed?"}
  REF -->|yes| RG["submit + judge search.refine"] --> GATE
  REF -->|no| GATE{"judge gate at current coverage"}
  GATE -->|"go — more stages"| EXT["gateLog go → extend winning run"] --> GATE
  GATE -->|"go — final stage"| VAL["outcome + champion + validated"]
  GATE -->|recycle| OUT["gateLog recycle → outcome"]
  VAL --> LOG["Research-log entry + Lesson:"]
  OUT --> LOG
  LOG --> NEXT["next experiment from roadmap, or kill"]
```

**`outcome` is written exactly ONCE, when the climb ends** — the final gate
passes, a gate recycles, or the experiment aborts. Until then the
experiment stays `running` and the climb state lives in `gateLog`. Never
write `outcome` mid-climb: `research:check` enforces
`outcome.stageReached == highest gateLog go stage`, so an early outcome
breaks when the next gate is judged. The verdict is still judged against
the pre-declared `successCriteria` — e.g. criteria "pass the stage-1 gate"
plus a recycle at stage 2 is verdict `success` with `stageReached: 1`.

## Resume guide — observed state → next action

Rows are in priority order; the first matching row wins.

| observed state                                 | next action                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| any `evaluated` experiment lacks its log entry | write the Research-log entry with `Lesson:` — nothing else is legal (log-before-acting)                    |
| experiment `queued`, no smoke done             | smoke test, then submit pass 1 (or the single run)                                                         |
| smoke fails                                    | fix the draft code (not frozen yet) and retry; `aborted` + `abortReason` if unfixable                      |
| experiment `running`, work in flight           | `checkBatch`; INCOMPLETE → poll (sleep 2–5 min between checks); COMPLETE → judge what finished (see below) |
| runs `partial`/`failed`                        | re-submit the broken cells under `--rN` ([NAMING.md](../rules/NAMING.md))                                  |
| pass judged (`best` set), params remain        | submit the next pass with winners fixed                                                                    |
| all passes judged, gate not yet judged         | judge the gate at current coverage (optionally submit `search.refine` first)                               |
| gateLog `go` recorded, extension not submitted | extend the winning run ([extendBacktest](../tools/extendBacktest.md))                                      |
| extension complete                             | judge the next gate at the new coverage                                                                    |
| final gate passed                              | write `outcome`, move `champion`, set family `validated` + `verdictSummary`                                |
| gate recycled                                  | write `outcome`, status `evaluated`                                                                        |
| verdict logged, family continues               | read LESSONS.md, spec the next experiment from the roadmap                                                 |
| roadmap exhausted + stopping rules met         | kill: `killed`, `retryOnlyIf`, `verdictSummary`, closing log entry                                         |
| family validated / killed / nothing actionable | stop and summarize the session                                                                             |

**What just finished?** No field stores what was in flight — derive it from
FAMILY.json: a pass with `submissionUids` set and `best` null → judge that
pass; `search.refine` with `submissionUids` set and `best` null → judge the
refine; `coverage` grown past the last judged gate's stage → judge the gate
at the new coverage.

## Inputs

- `src/strategies/research/<family>/FAMILY.md` + `FAMILY.json` — the memory.
- [`strategy-research-protocol/LESSONS.md`](../LESSONS.md) — cross-family
  lessons; required reading before speccing any experiment.
- [`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md) — gates,
  flows, stopping rules.
- [`strategy-research-protocol/MEMORY.md`](../MEMORY.md) — field tables and
  writer rules.
- Rules: [`NAMING.md`](../rules/NAMING.md) — ids, batchUids, champion
  pointer, freeze rule.
- Tools: [`runBacktest`](../tools/runBacktest.md),
  [`extendBacktest`](../tools/extendBacktest.md),
  [`checkBatch`](../tools/checkBatch.md),
  [`getBacktestResults`](../tools/getBacktestResults.md),
  [`syncWorkerFleet`](../tools/syncWorkerFleet.md).

## Judging results

Read raw results via
[`getBacktestResults`](../tools/getBacktestResults.md) only for work that
[`checkBatch`](../tools/checkBatch.md) reports COMPLETE. For a pass, reduce
the batch to a per-cell table sorted by `netEvPerMarket` with markets and
trade counts per cell. Dig as deep as the results warrant: segments,
per-market outliers, monthly chunks, distributions.

Judge on `netEvPerMarket` (net of fees) — the only verdict metric. Gross is
diagnostic: it explains, it never passes a gate.

**A pass** gets `best` + `note` in FAMILY.json. Judgment, not blind argmax:

- Prefer a stable plateau over an isolated spike — a value whose neighbors
  are also good beats a lonely peak with a cliff next to it.
- Flag flat responses in `note` ("flat — param doesn't matter") and stop
  spending passes on that param.
- Distrust cells with few trades or few markets; a great number on thin
  volume is noise.

**A gate** gets one `gateLog` entry (`{stage, decision, at, note}`) appended
at the moment of the decision, with the measured numbers in `note` — e.g.
`"netEv +0.04 at 1000 mkts, 1840 trades"`. Decisions, criteria, and the
advisory rule (distribution concerns inform, they never block) per
[`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md).

**The experiment** gets the full `outcome` when its climb ends:

- `verdict` — `success` / `fail` / `inconclusive`, **quoting the
  successCriteria verbatim**. `inconclusive` is for genuinely unjudgeable
  results (broken data, too little volume), not a soft fail.
- `bestParams` — defaults + pass winners, the complete runnable set.
- `metrics` — `netEvPerMarket`, `grossEvPerMarket`, `markets`, `trades`
  (`trainNetEv`/`testNetEv` stay null — no train/test split in gates v1).
- `reason` — one factual sentence with numbers, no narrative.
- `stageReached` + `gatesVersion` — per STAGE-GATES.md as of now.
- Status → `evaluated`, `decidedAt` set.

On verdict `success` that beats the current champion, move the `champion`
pointer ([`NAMING.md`](../rules/NAMING.md)); on
passing the final gate, also set the family `validated` + `verdictSummary`.

Patterns spotted in the raw results ("this cell looks interesting") may
extend the Experiment roadmap and steer the next spec — record them in the
Research-log entry. They never change a verdict. If the bar itself was
wrong, say so in the log entry, still judge against it, and spec a better
experiment.

## Bias containment

The Researcher generates hypotheses AND grades them, so the protection
against motivated interpretation is mechanical, not organizational:

- `hypothesis` and `successCriteria` are **frozen once the experiment is
  `running`** — never edited after first submission. The bar exists before
  the numbers do. Judging against criteria invented after seeing results is
  how noise becomes "edge".
- Every judgment **quotes the measured numbers it was decided on** (pass
  `note`, gateLog `note`, `outcome.reason`) — any decision is verifiable
  from the files alone; a fudged gate is self-incriminating.
- Gate criteria and stopping rules have ONE home:
  [`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md). Never
  invent or soften them.
- `gateLog` and the Research log are append-only; past judgments are never
  rewritten.

## Log-before-acting

While any `evaluated` experiment lacks its Research-log entry, the ONLY
legal action is writing that entry. The entry: what ran, the key numbers
quoted from FAMILY.json, the interpretation, the decision taken, and the
`Lesson:` line — written for the next agent, rich enough to steer future
proposals. During a climb no log entry is due — the gateLog notes carry the
numbers; the entry is written once, when the experiment is `evaluated`.

After writing the entry, run the promotion check: does this lesson
generalize beyond the family? If yes, append it to
[`strategy-research-protocol/LESSONS.md`](../LESSONS.md); if it is a
permanent ban on future proposals, also add one line to
[`strategy-research-protocol/CONSTRAINTS.md`](../CONSTRAINTS.md). The check
is mandatory (not the promotion) at every kill and every validation.

## Speccing an experiment

- Next sequential `NNN-<short-hypothesis>` id; `basedOn` the experiment it
  branches from (usually the champion).
- `hypothesis` and `successCriteria` are contracts written BEFORE any run;
  default criteria: "pass the next stage's gate".
- `kind: param-search` → coordinate `search` with justified `defaults` and
  passes ordered by expected impact. `kind: variation` → one new frozen-safe
  `.ts` file named by the experiment id (branch from the champion's file),
  fixed `params`.
- `baselineId` = the current champion's best run (or 000-baseline's best) so
  the dashboard comparison is anchored.

## Submitting

1. Preconditions per [`AGENTS.md`](../AGENTS.md) (Session preconditions):
   clean tree, committed and pushed to the research branch, worker fleet
   synced.
2. Smoke test first (`--smoke`, never evidence).
3. Submit per [`runBacktest`](../tools/runBacktest.md); record `batchUid`,
   `submissionUids`, `coverage`, `submittedAt` in FAMILY.json immediately;
   status `running`; family `researching` on first submission.
4. Stage climbs use [`extendBacktest`](../tools/extendBacktest.md) on the
   winning run — coverage grows, batchUid stays.
5. An optional refinement mini-grid before the gate goes into
   `search.refine` (values-per-param, batchUid `<family>--<exp>--refine`).

## Killing a family

Only per the stopping rules in
[`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md) —
structural kill (numeric ceiling argument) or empirical kill (roadmap
exhausted + `minExperiments` + no trend). A kill records `retryOnlyIf`
(concrete, testable), `verdictSummary` (one sentence), and a closing log
entry. Then rebuild INDEX.json.

## Forbidden

- Writing family `live` (user-only).
- Judging smoke runs (`--smoke`) or incomplete batches; declaring `success`
  on gross numbers or on thin samples.
- Editing frozen strategy files
  ([`NAMING.md`](../rules/NAMING.md) freeze rule),
  past log entries, or past gateLog entries.
- Running more than one active experiment, or touching other families.
- Writing numbers only in prose — every number in the log entry is quoted
  from FAMILY.json ([`MEMORY.md`](../MEMORY.md)).

## Final Self-Check

- Everything judged this iteration is recorded in the files;
  `npm run research:check` passes.
- Every judgment written quotes the measured numbers; the verdict quotes
  the successCriteria; `stageReached`/`gatesVersion` match STAGE-GATES.md.
- `outcome` exists only on experiments whose climb has ended; champion /
  `validated` / `verdictSummary` updated when warranted, and only then.
- Any consumed verdict has its log entry with a `Lesson:`.
- INDEX.json rebuilt if family metadata changed.
- A fresh session could continue from the files alone.
