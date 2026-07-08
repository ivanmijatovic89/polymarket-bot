# Naming and Identity

One rule set covers every name and identifier in the research system, in the
order they build on each other: family slug → experiment id → code file →
registry id → batchUid — plus the champion pointer and the code freeze rule.
There are **no version numbers** anywhere in this system — see "No versions"
at the end.

## Family slug

A family is named after its **primary decision driver** — the core reason its
strategies enter, skip, or exit. One family = one driver.

Lowercase kebab-case, short, driver-first:

```text
good:  book-imbalance  spread-compression  liquidity-wall  late-market-snipe
bad:   orderbook  plugins  research-lab  experiment-1  BookImbalance  book_imbalance
```

**Name the decision, not the data source.** `orderbook` is where the data
comes from, not why the strategy acts. Data sources, mechanisms, and themes
belong in `tags`:

```json
{
  "family": "book-imbalance",
  "tags": ["orderbook", "imbalance", "entry-signal"]
}
```

**New family or new experiment?** Ask: what is the primary decision driver?

- Same driver as an existing family (new params, filters, gates, exits) → an
  **experiment** inside that family.
- A genuinely different driver → a **new family**.

**Duplicates.** Renaming an idea does not make it new — same driver = same
family:

```text
late-entry ≈ wait-longer ≈ enter-near-end
book-pressure ≈ orderbook-imbalance ≈ bid-ask-skew
```

A near-duplicate is valid only if it adds a new **independent** driver
(`late-entry` alone = duplicate; `late-entry + spread-stability` = new).
When creating a family, write its normalized synonyms into `duplicateKeys` in
`src/strategies/research/<family>/FAMILY.json` so future proposals can catch
the overlap through the generated index.

## Experiment id

```text
<NNN>-<short-hypothesis>
```

- `NNN` — three digits, sequential per family, starting at `000`. Never reuse
  a number, even if an experiment was aborted.
- `<short-hypothesis>` — kebab-case, names the **idea being tested**, never a
  mechanism or a bare number: `002-persistence-filter`, not `002-v2` or
  `002-experiment`.
- Ids are local to their family. When a global reference is needed (index,
  batch uids), prefix the family: `book-imbalance/002-persistence-filter`.
- The id is the join key between FAMILY.json (`"id"`) and the FAMILY.md
  Research log (`### <id>`).

`000-baseline` is reserved: every family starts with it — the baseline
coordinate search over the baseline code.

## Code files

A code file is named after the experiment that introduces it:

```text
src/strategies/research/<family>/000-baseline.ts
src/strategies/research/<family>/002-persistence-filter.ts
```

- `000-baseline.ts` always exists — experiment `000-baseline` introduces it
  and searches its knobs.
- An experiment that changes code introduces exactly **one** new file, named
  by its experiment id.
- An experiment that only changes params introduces **no** file — its `code`
  field references an existing file.
- Lineage lives in `FAMILY.json`, not in filenames: a code experiment records
  which experiment it branched from in its `basedOn` field.

## Registry id

`definition.id` (the id used with `--strategy` and recorded in backtest
results) is derived mechanically from the path:

```text
<family>.<experiment-id>

liquidity-wall/000-baseline.ts           → 'liquidity-wall.000-baseline'
liquidity-wall/002-persistence-filter.ts → 'liquidity-wall.002-persistence-filter'
```

No creativity allowed: file path in, registry id out. Ids are globally unique
because family slugs are.

## Batch UID

A batchUid is the human-chosen grouping label a backtest submission gets
(`--batchUid <id>`). It is how results are grouped later — in the dashboard,
in the database, and from `src/strategies/research/<family>/FAMILY.json`.

Exact per-run tracking uses `submissionUids` (auto-generated, identical in
Redis and `backtest_runs.submission_uid`), recorded in FAMILY.json at submit
time. The batchUid groups; the submissionUids identify.

Format:

```text
<family>--<experiment-id>[--<suffix>]
```

The name builds itself from the family slug and experiment id above. No
creativity allowed. One experiment normally produces SEVERAL batchUids
(smoke, one per coordinate pass, refinements, re-runs) — that is expected.

| suffix         | meaning                                           | example                                           |
| -------------- | ------------------------------------------------- | ------------------------------------------------- |
| `--smoke`      | smoke test; never evidence, never freezes code    | `book-imbalance--000-baseline--smoke`             |
| `--pN-<param>` | coordinate-search pass N sweeping `<param>`       | `book-imbalance--000-baseline--p1-enterThreshold` |
| `--refine`     | refinement mini-grid before the final verdict     | `book-imbalance--000-baseline--refine`            |
| `--rN`         | re-run after a bug / bad data / broken submission | `book-imbalance--002-persistence-filter--r2`      |

A single-run experiment (`kind: variation` with fixed `params`) uses the bare
`<family>--<experiment-id>` label.

Rules:

- All cells of one pass share that pass's batchUid — the batch answers "how
  did this pass do", each run inside answers "how did this value do".
- Never reuse a batchUid for a different effective experiment or different
  params. A re-run gets the next `--rN`.
- FAMILY.json records which batchUids count; superseded batchUids stay in the
  database as history.
- Stage extensions (`extendBacktest`) grow existing runs and do NOT change
  the batchUid.

## Champion pointer

The family champion is a **pointer in `FAMILY.json`**, never a file operation.
It stores only the experiment id:

```json
"champion": "002-persistence-filter"
```

Everything else is resolved through the experiment record — champion code =
that experiment's `code`, champion params = that experiment's
`outcome.bestParams`. Do not duplicate them into the pointer; duplicated data
drifts.

- Promotion = the Researcher moves the pointer as a consequence of an
  `outcome.verdict` of `success` that beats the current champion. Nothing on
  disk is copied, renamed, or edited.
- The pointer may only reference an `evaluated` experiment with verdict
  `success` (schema invariant).
- A dethroned champion's record is **not** edited — its historical outcome
  stays. Only the pointer moves.
- The **why** of each promotion is prose in the FAMILY.md Research log entry
  written when the verdict is consumed. `FAMILY.json` carries facts;
  `FAMILY.md` carries the explanation.
- New code experiments are expected to branch from the current champion's
  file.
- Setting a family `live` is a separate, **user-only** action. The champion
  pointer never changes family status by itself; the Researcher sets
  `validated` only when a champion passes the final stage gate
  ([`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md)).

## Freeze rule

- A code file referenced by any experiment with a recorded **evidence** result
  is **frozen**: never edit its behavior, never delete it — including in
  killed families. Recorded results must stay reproducible.
- Smoke runs (batchUid `--smoke`) are NOT evidence and do NOT freeze the
  file. Before its first evidence result, a file is a draft and may be edited
  freely.
- A frozen file that needs different behavior = a new experiment with a new
  file.

## No versions

There are no `v1`/`v2` suffixes in filenames or ids. The experiment id already
identifies every piece of code uniquely, and the champion pointer identifies
the current best. "How many times the champion changed" is readable from the
Research log — it is not encoded in names.
