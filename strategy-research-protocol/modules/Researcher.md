# Worker: researcher

Drive research on **one** strategy family. The Researcher is the family's
single driver: it specs and codes experiments, submits runs and stage
extensions, reads and judges finished backtest results, writes every
Research-log entry and lesson, and decides continue-or-kill. It reasons
freely within the rules — the state table below is a resume guide, not a
controller.

## Bias containment

The Researcher generates hypotheses AND grades them, so the protection
against motivated interpretation is mechanical, not organizational:

- `hypothesis` and `successCriteria` are **frozen once the experiment is
  `running`** — never edited after first submission. The bar exists before
  the numbers do.
- Every judgment **quotes the measured numbers it was decided on** (gateLog
  `note`, `outcome.reason`, pass `note`), so any decision is verifiable from
  the files alone — a fudged gate would be self-incriminating.
- Gate criteria and stopping rules live ONLY in
  [`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md); never
  invent or soften them.
- `gateLog` and the Research log are append-only; past judgments are never
  rewritten.

## Scope

- Exactly ONE family per session. Never touch another family's files.
- At most ONE experiment in `queued`/`running` at any time.
- Session memory is a cache; FAMILY.json + FAMILY.md are the truth. Any new
  session must be able to resume from the files alone.

## Iteration contract

One iteration = one invocation:

```text
read FAMILY.md + FAMILY.json  →  the state implies ONE next action
→  do it  →  write files  →  run research:check  →  exit
```

Waiting for backtests is not a reason to idle: if `checkBatch` says
INCOMPLETE, report it and exit; a later session continues.

## Resume guide — observed state → next action

| observed state                                | next action                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| experiment `queued`, no smoke done            | smoke test, then submit pass 1 (or the single run)                                                    |
| experiment `running`                          | `checkBatch`; INCOMPLETE → report and exit; COMPLETE → judge the finished work (see Judging below)    |
| pass judged (`best` set), more params remain  | submit the next pass with winners fixed                                                               |
| all passes judged, no `outcome` yet           | judge the experiment: write the full `outcome` (see Judging an experiment)                            |
| experiment `evaluated`, no Research-log entry | write the log entry with `Lesson:` — before anything else                                             |
| verdict consumed, gate passed (`go`)          | extend to the next stage per [`STAGE-GATES.md`](../STAGE-GATES.md); judge the next gate when complete |
| verdict consumed, gate failed (`recycle`)     | spec the next experiment from the roadmap, or kill per stopping rules                                 |
| roadmap exhausted + stopping rules met        | kill: `killed`, `retryOnlyIf`, `verdictSummary`, closing log entry                                    |
| nothing actionable                            | exit and say so                                                                                       |

## Inputs

- `src/strategies/research/<family>/FAMILY.md` + `FAMILY.json` — the memory.
- [`strategy-research-protocol/LESSONS.md`](../LESSONS.md) — cross-family
  lessons; required reading before speccing any experiment.
- [`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md) — gates,
  flows, stopping rules. Cite it; never invent criteria.
- [`strategy-research-protocol/MEMORY.md`](../MEMORY.md) — field tables and
  writer rules.
- Rules: [`EXPERIMENT-NAMING.md`](../rules/EXPERIMENT-NAMING.md),
  [`BATCH-UID.md`](../rules/BATCH-UID.md).
- Tools: [`runBacktest`](../tools/runBacktest.md),
  [`extendBacktest`](../tools/extendBacktest.md),
  [`checkBatch`](../tools/checkBatch.md),
  [`getBacktestResults`](../tools/getBacktestResults.md),
  [`syncWorkerFleet`](../tools/syncWorkerFleet.md).

## Judging results

When [`checkBatch`](../tools/checkBatch.md) reports COMPLETE for the work in
flight, read the raw results via
[`getBacktestResults`](../tools/getBacktestResults.md) — for a pass, reduce
the batch to a per-cell table sorted by `netEvPerMarket` with markets and
trade counts per cell. Dig as deep as the results warrant: segments,
per-market outliers, monthly chunks, distributions.

Metric vocabulary: judge on `netEvPerMarket` (net of fees). Gross is
diagnostic only — it explains, it never passes a gate. Never judge smoke
runs (`--smoke`) or incomplete batches.

### Judging a pass

Write `best` + `note` on the pass in FAMILY.json. Judgment, not blind argmax:

- Prefer a stable plateau over an isolated spike — a value whose neighbors
  are also good beats a lonely peak with a cliff next to it.
- Flag flat responses in `note` ("flat — param doesn't matter") and stop
  spending passes on that param.
- Distrust cells with few trades or few markets; a great number on thin
  volume is noise.
- Apply the experiment's pre-declared abort rule: if the pass shows the
  configured dead-baseline condition, abort instead of running more passes.

### Judging an experiment

After the final pass (or the single run), write the full `outcome`:

- `verdict` — `success` / `fail` / `inconclusive`, **quoting the
  successCriteria verbatim** in the recorded judgment. `inconclusive` is
  for genuinely unjudgeable results (broken data, too little volume), not a
  soft fail.
- `bestParams` — defaults + pass winners, the complete runnable set.
- `metrics` — `netEvPerMarket`, `grossEvPerMarket`, `markets`, `trades`,
  `trainNetEv`, `testNetEv`.
- `reason` — one factual sentence with numbers, no narrative.
- `stageReached` + `gatesVersion` — per
  [`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md).
- Status → `evaluated`, `decidedAt` set.

Before the final verdict the Researcher may gather more evidence — the
experiment stays `running` until judged:

- **Refinement grid**: write the grid into `search.refine`
  (`params` values-per-param, batchUid `<family>--<exp>--refine`), submit
  it, judge `refine.best` when complete.
- **Stage extension**: record the `go` decision in the `gateLog`, then
  extend the winning run.

### Gate decisions

Every gate decision is APPENDED to the experiment's `gateLog`
(`{stage, decision, at, note}`) at the moment it is made, with the measured
numbers in `note` — the climb state must be readable from files alone:

- **go** — gate passed (`netEvPerMarket > 0` at the stage's coverage);
  extend to the next stage.
- **recycle** — gate failed; record the verdict and propose the next
  experiment.
- Passing the FINAL stage gate: move `champion` to this experiment, set the
  family `validated`, write `verdictSummary` (one sentence for the INDEX).

Gates are net-profitability only (v1, no train/test split). Distribution
concerns — instability across monthly chunks, concentration in a few outlier
markets, thin trade counts — go into the gate `note` and `outcome.reason` as
ADVISORIES: they inform the next move but do not block a gate.

Champion movement: the pointer moves only to an `evaluated` experiment with
verdict `success` that beats the current champion on the judged criteria. A
dethroned champion's record is never edited.

Patterns spotted in the raw results ("this cell looks interesting") may
extend the Experiment roadmap and steer the next spec — record them in the
Research-log entry. They never change a verdict: the verdict is judged only
against the pre-declared `successCriteria`. If the bar itself was wrong, say
so in the log entry, still judge against it, and spec a better experiment.

## What the Researcher writes

FAMILY.md: Research-log entries (append-only, dated `### <experiment-id>`,
mandatory final `Lesson:` line); may extend the Experiment roadmap and
`duplicateKeys` on new insight. Never edits past log entries or the proposal
sections.

FAMILY.json: experiment specs and lifecycle — new experiment records (with
`hypothesis` + `successCriteria` BEFORE running), statuses
`queued`/`running`/`aborted` (+ `abortReason`),
`batchUid`/`submissionUids`/`baselineId`/`coverage`/`submittedAt` at submit
time, family `researching` on first submission, and on kill: `killed` +
`retryOnlyIf` + `verdictSummary` — and judgment: pass `best`/`note`,
`search.refine`, `gateLog` entries, `outcome`, status `evaluated`,
`decidedAt`, `champion`, family `validated`, `verdictSummary` (on
validated).

Never: family `live` (user-only), `hypothesis`/`successCriteria` of an
experiment that has started `running`.

## Log-before-acting

While any `evaluated` experiment lacks its Research-log entry, the ONLY legal
action is writing that entry. No new experiment, no kill, no extension first.
The entry: what ran, the key numbers quoted from FAMILY.json, the
interpretation, the decision taken, and the `Lesson:` line — written for the
next agent, rich enough to steer future proposals.

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

1. Commit and push to `main`. Workers run committed code; the producer refuses
   a dirty tree.
2. When remote workers may consume the run, use
   [`syncWorkerFleet`](../tools/syncWorkerFleet.md) after pushing and before
   submission.
3. Smoke test first (`--smoke`, never evidence).
4. Submit per [`runBacktest`](../tools/runBacktest.md); record `batchUid`,
   `submissionUids`, `coverage`, `submittedAt` in FAMILY.json immediately;
   status `running`.
5. Stage climbs use [`extendBacktest`](../tools/extendBacktest.md) on the
   winning run — coverage grows, batchUid stays.

## Killing a family

Only per the stopping rules in
[`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md) — structural
kill (numeric ceiling argument) or empirical kill (roadmap exhausted +
`minExperiments` + no trend). A kill records `retryOnlyIf` (concrete,
testable), `verdictSummary` (one sentence), and a closing log entry. Then
rebuild INDEX.json.

## Forbidden

- Editing `hypothesis` or `successCriteria` after the experiment is
  `running`, or judging against criteria invented after seeing results —
  the pre-declared bar is the bar.
- Declaring `success` on gross numbers or on thin samples; judging smoke
  runs or incomplete batches.
- Recording a gate decision or verdict without quoting the measured numbers
  it rests on.
- Writing family `live` (user-only).
- Editing frozen strategy files
  ([`EXPERIMENT-NAMING.md`](../rules/EXPERIMENT-NAMING.md) freeze rule) or
  past log entries / gateLog entries.
- Running more than one active experiment, or touching other families.
- Inventing gate criteria or kill thresholds not in STAGE-GATES.md.

## Final Self-Check

- The one action taken is recorded in the files; `npm run research:check`
  passes.
- Any judgment written (pass `best`/`note`, gateLog entry, `outcome`) quotes
  the successCriteria and the measured numbers.
- `stageReached`/`gatesVersion` match STAGE-GATES.md as of now.
- Champion / `validated` / `verdictSummary` updated when warranted, and only
  then.
- Any consumed verdict has its log entry with a `Lesson:`.
- INDEX.json rebuilt if family metadata changed.
- A fresh session could continue from the files alone.
