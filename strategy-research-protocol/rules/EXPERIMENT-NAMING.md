# Experiment Naming and Code Files

One rule set covers experiment ids, strategy code files, registry ids, the
champion pointer, and the freeze rule. There are **no version numbers**
anywhere in this system — see "No versions" at the end.

Family naming is defined in
[`strategy-research-protocol/rules/FAMILY-NAMING.md`](./FAMILY-NAMING.md).

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
