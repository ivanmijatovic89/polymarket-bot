# fable-lab strategies

Strategy code for Fable experiments lives HERE (not under `src/strategies/`),
one file per experiment version:

```
fable-lab/strategies/<mechanism>/EXP-NNN.ts     id: fable-exp-NNN
```

Why: the pre-commit hook allows commits only inside `fable-lab/`, and
evidence runs must be on committed+pushed code. Since operator patch
a10b59d (U54/D33) the engine registry auto-discovers this directory too,
so FLEET workers resolve `fable-exp-*` ids straight from pushed code —
evidence stages run on the fleet as bare engine commands with `--detach`
(U58). Local smoke/debug/parity runs go through the
`fable-lab/tools/run-backtest.ts` wrapper (`--sequential`, idempotent
registry injection, D8 latency pins printed). `tools/submit.ts` builds
the correct command for either path automatically.

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
