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
  a number, even if an experiment was abandoned.
- `<short-hypothesis>` — kebab-case, names the **idea being tested**, never a
  mechanism or a bare number: `002-persistence-filter`, not `002-v2` or
  `002-experiment`.
- Ids are local to their family. When a global reference is needed (index,
  batch uids), prefix the family: `book-imbalance/002-persistence-filter`.

`000-baseline` is reserved: every family starts with it — the baseline knob
sweep over the baseline code.

## Code files

A code file is named after the experiment that introduces it:

```text
src/strategies/research/<family>/000-baseline.ts
src/strategies/research/<family>/002-persistence-filter.ts
```

- `000-baseline.ts` always exists — experiment `000-baseline` introduces it
  and sweeps its knobs.
- An experiment that changes code introduces exactly **one** new file, named
  by its experiment id.
- An experiment that only changes params introduces **no** file — its `code`
  field references an existing file.
- Lineage lives in `FAMILY.json`, not in filenames: a code experiment records
  which file it branched from in its `basedOn` field.

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
`selectedParams`. Do not duplicate them into the pointer; duplicated data
drifts.

- Promotion = the Evaluator sets the experiment's `decision` to `promote` and
  moves the pointer. Nothing on disk is copied, renamed, or edited.
- A dethroned champion's record is **not** edited — its historical `promote`
  decision stays. Only the pointer moves.
- New code experiments are expected to branch from the current champion's
  file.
- Setting a family `active` is a separate, **user-only** action. The champion
  pointer never changes family status.

## Champion history is derived, not stored

There is no `championHistory` structure. The path to the current champion is
a query over the experiments array:

```text
experiments where decision = "promote", ordered by decidedAt
```

- The last entry of that ordering must equal the `champion` field — if it
  does not, the file is corrupted (this is a `research:check` invariant).
- `decidedAt` on each experiment is what makes the ordering possible; the
  Evaluator sets it when it records a decision.
- The **why** of each promotion (margin, coverage, reasoning) is prose in the
  FAMILY.md experiment log entry written at promotion time. `FAMILY.json`
  carries facts; `FAMILY.md` carries the explanation.

## Freeze rule

- A code file referenced by any experiment with a recorded result is
  **frozen**: never edit its behavior, never delete it — including in killed
  families. Recorded results must stay reproducible.
- Before its first result, a file is a draft and may be edited freely.
- A frozen file that needs different behavior = a new experiment with a new
  file.

## No versions

There are no `v1`/`v2` suffixes in filenames or ids. The experiment id already
identifies every piece of code uniquely, and the champion pointer identifies
the current best. "How many times the champion changed" is derivable from the
experiment log — it is not encoded in names.
