# Strategy research protocol

How AI workers research trading strategies for this bot. Workers are stateless:
each reads files, does one job, writes files. The **files are the memory** — a
fresh worker can pick up from them with no prior session.

The research families themselves live in `src/strategies/research/<family>/`
(code + artifacts together). This folder holds the **rules, schemas, and tools**.

## What's here

| File             | What it is                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `README.md`      | This overview.                                                                                    |
| `DECISIONS.md`   | Every locked design decision, with the reasoning. The source of truth for how the protocol works. |
| `CONTEXT.md`     | "The game" — venue, instrument, data, costs. Every worker reads this first.                       |
| `CONSTRAINTS.md` | Hard rules a strategy must never break. You curate it over time.                                  |
| `NAMING.md`      | How to name a family and its experiments.                                                         |
| `modules/`       | One file per worker — the worker's instructions (e.g. `ProposeFamily.md`).                        |
| `schemas/`       | Zod schemas for `FAMILY.json`, `INDEX.json`, and `FAMILY.md` (validation + types).                |
| `examples/`      | A filled-in example family, so you can see the shapes.                                            |
| `scripts/`       | Tools: `buildIndex.ts` (regenerate the index) and `run-worker.sh` (run a worker headless).        |

## The artifacts (per family, under `src/strategies/research/<family>/`)

- `FAMILY.json` — the structured record: status + the experiment queue. **Source of truth.**
- `FAMILY.md` — the reasoning: core idea, ranked "Experiments to try", and the lessons learned.
- `Strategy.ts` (and more) — the code. Auto-discovered; no registry to edit.

`src/strategies/research/INDEX.json` is a **generated** rollup of all the
`FAMILY.json` files — the map workers read to see what already exists. Never
edit it by hand.

## Tools

**Run a worker** (e.g. propose a new family):

```bash
./strategy-research-protocol/scripts/run-worker.sh
# or with a seed idea:
./strategy-research-protocol/scripts/run-worker.sh "Execute propose-family per strategy-research-protocol/modules/ProposeFamily.md. Run with seed: '<idea>'."
```

Shows the reasoning live, saves a log, and prints token/cost at the end.

**Rebuild the index** — run this after any worker writes or changes a `FAMILY.json`:

```bash
npm run research:build-index          # regenerate src/strategies/research/INDEX.json
npm run research:build-index -- --check   # fail if the index is stale (for CI)
```

## The loop (in brief)

```
PROPOSE a family  →  RUN its experiment (backtest)  →  JUDGE the result  →  ROUTE
                                                                            │
                        promote ◀── pass        fail ──▶ try the next experiment
                                                          (or kill the family)
```

See `DECISIONS.md` for the full design and `modules/` for each worker's exact job.
