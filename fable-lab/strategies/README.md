# fable-lab strategies

Strategy code for Fable experiments lives HERE (not under `src/strategies/`),
one file per experiment version:

```
fable-lab/strategies/<mechanism>/EXP-NNN.ts     id: fable-exp-NNN
```

Why: the pre-commit hook allows commits only inside `fable-lab/`, evidence
runs must be on committed code, and the engine registry auto-discovers only
`src/strategies/**`. `fable-lab/tools/run-backtest.ts` bridges the gap by
injecting every strategy in this directory into the in-process registry
before handing off to the standard backtest CLI (DECISIONS D7). Consequence:
**all fable runs go through `tools/run-backtest.ts` and are `--sequential`**
(queue workers would never see these strategies). `tools/submit.ts` builds
the correct command automatically.

Rules (same as SCIENTIST.md):
- Files export `const definition = { id, schema, create }` exactly like
  `src/strategies/` files; imports reference engine modules by relative path
  (`../../../src/...`).
- Replay-safety (CAPABILITIES §3): no `Math.random()`; time from
  `tick.snapshot.timestamp` only; deterministic `clientOrderId`s; gate on
  `fill` events, never order status; never emit `merge_positions`; batch ≤15;
  stay inside hardcoded risk limits.
- Once a version has decisive results the file is FROZEN — new insight goes
  into a new EXP file.

`_fixtures/wrapper-noop.ts` (id `fable-fixture-noop`) is a permanent loader
fixture: it proves on every run that injection works, and is the smoke target
for wrapper plumbing. Never quote its results.

Live deployment note: a confirmed strategy is reproduced live by copying the
file under `src/strategies/fable/` on a normal branch/PR (operator step) —
the code is engine-compatible by construction.
