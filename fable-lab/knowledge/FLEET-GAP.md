# FLEET-GAP — the worker fleet cannot run fable-lab strategies (operator memo)

_Written: 2026-07-11, session 48 (U53). Status: **OPEN** — blocks charter
constraint 3's fleet mandate until an operator-side patch lands._

## The one-paragraph version

The charter (constraint 3, updated 2026-07-09/11) directs all evidence runs
through the distributed worker fleet with `--detach`. That path is
mechanically unusable for this lab's strategies: the engine's strategy
registry auto-discovers only `src/strategies/**`, our strategies live in
`fable-lab/strategies/**` (the pre-commit hook blocks commits anywhere
else), and nothing in the worker code path loads them. A fleet job for any
`fable-exp-*` id would fail on every worker with `unknown strategy id`.
Local `--sequential` through the registry-injection wrapper (DECISIONS D7)
remains the only executable evidence path. A ~5-line operator-side patch
closes the gap; options below.

## Evidence (all verified this session)

1. **Registry scope.** `src/strategy/strategyRegistry.ts` builds the
   registry at module load by walking `STRATEGIES_DIR = join(dirname, '..',
   'strategies')` — i.e. `src/strategies/` only (strategyRegistry.ts:24,
   the `walk()` at :39). No env var, no secondary directory, no reference
   to `fable-lab` anywhere under `src/`
   (`grep -rn "fable" src/ --include='*.ts'` → no hits).
2. **Worker resolution path.** Fleet children run
   `src/cli/backtestWorkerChild.ts` → `makeMarketProcessor`
   (`src/backtest/marketProcessor.ts`) → `runSingleMarket`
   (`src/backtest/runSingleMarket.ts:16,116`), which calls
   `getStrategyDefinition(strategyId)`; unknown ids throw
   (`strategyRegistry.ts:109`). Job data carries only `strategyId` +
   `strategyParams` (`src/backtest/jobTypes.ts`) — no code, no path.
3. **The lab cannot self-fix.** The pre-commit hook
   (`fable-lab/.hooks/pre-commit`) blocks any staged file outside
   `fable-lab/`; charter constraint 1 forbids bypassing it. A shim or
   symlink under `src/strategies/` is therefore uncommittable, and workers
   only run committed code (`scripts/run-worker.sh` pulls; commit gate in
   `src/backtest/commitGate.ts`).
4. **Local reproduction** (same registry code path a worker child
   executes): `npx tsx src/cli/backtest.ts --strategy fable-exp-001 ...
   --sequential --limit 1` → `[backtest] [strategy] unknown strategy
   id="fable-exp-001"`, at argument-parse time, before any enqueue or DB
   write (strategy resolution happens in `buildStrategyFromCliArgs`,
   declared at `src/cli/helpers/strategyArgs.ts:57`, resolving at :74).

The wrapper (`fable-lab/tools/run-backtest.ts`) closes the gap ONLY
in-process: it mutates the exported registry object, then hands off to the
CLI main. With `--detach` the parent would validate and enqueue fine — and
every worker would then fail the jobs. This is why D7 enforced
`--sequential`; the constraint is the engine's, not (any longer) the
charter's.

## What already works fine on the fleet path (no action needed)

- **D8 latency pinning survives.** `BACKTEST_LATENCY_DELAY/JITTER` are read
  from the SUBMITTER's env at enqueue time and shipped inside job data
  (`src/cli/backtest.ts:557-558`; job data at :1008, consumed verbatim by
  `marketProcessor.ts`; the same env-derived values also drive the
  sequential in-process path at :757). Worker machines'
  ambient `.env` (the E7 trap) cannot alter a submitted run's semantics.
  Note the jitter default is `'20'` when unset — submit.ts's explicit
  `JITTER=0` pin is load-bearing on any path.
- **Commit discipline is already mechanical.** Workers defer jobs built on
  commits they don't have and self-update (`marketProcessor.ts`,
  `run-worker.sh`), matching charter constraint 3's committed-and-pushed
  rule.

## Minimal patch options (operator-side, in preference order)

1. **Registry walks `fable-lab/strategies/` when present** — in
   `discoverStrategies()`, also walk
   `join(dirname, '..', '..', 'fable-lab', 'strategies')` if the directory
   exists (same `DEFINITION_EXPORT` source pre-check, same loader). ~5
   lines, no behavior change when the directory is absent. CAVEAT (from
   the U53 verifier): `discoverStrategies()` throws at module load on a
   malformed definition or duplicate id (strategyRegistry.ts:82-91), so a
   bad or colliding file committed under `fable-lab/strategies/` would
   crash EVERY engine process at import on that clone — including live
   trading bots. Loading lab strategies is inert only while they are
   well-formed and non-colliding; the lab's validator + smoke discipline
   makes that the normal case, but the coupling is real and worth knowing
   before patching. This makes
   workers, the bare CLI, and the wrapper all see the same registry, and
   the lab can then emit plain `npm run backtest -- --detach` commands.
2. **Env-configured extra discovery dir** (e.g.
   `STRATEGY_EXTRA_DIRS=fable-lab/strategies`) — same effect, but every
   worker machine's env must be kept in sync; a missing var silently
   reverts to the gap. More moving parts, same outcome.
3. **Worker-side preload of the wrapper's injection logic** — couples
   `src/` to `fable-lab/` internals; worst option.

Not viable without operator action: anything the lab could commit (hook
scope), anything env-based (worker machines' env is operator-managed).

## What the lab does when the patch lands (pre-committed intent)

Wake-up gate 3 (STATE.md) tests the gap each session with a
side-effect-free probe that imports the same registry module a worker
child resolves against (starts no run, writes nothing):

```bash
npx tsx -e "import('./src/strategy/strategyRegistry.js').then(m =>
  console.log('fable-exp-001' in m.strategyRegistry ? 'RESOLVED' : 'GAP'))"
```

Verified 2026-07-11: prints `GAP`. When it prints `RESOLVED`, a session
will, as ONE unit and before any fleet evidence run:

1. Reconcile `tools/submit.ts`: replace the hard `--sequential` with
   per-stage routing — smokes/debug stay local `--sequential` (charter),
   evidence stages (probe/main/lat/grid/holdout) emit the bare engine CLI
   with `--detach`, keeping the D8 env pins, E18 boundary−1 bounds, and
   the dirty-tree/committed-code requirement (charter: workers pull from
   origin — verify push state before submitting, e.g.
   `git status --porcelain` empty and `git rev-parse HEAD` ==
   `origin/fable-protocol`).
2. Build the capacity tool the charter suggests (live worker/machine
   counts via the :3051 dashboard API; throughput ≈ markets × 1.75s /
   active slots) and size batches with it. Deferred now because it has no
   consumer until submissions are possible (evolution governor: no
   motivating use).
3. Re-verify D8 on the fleet path empirically (one smoke-scale detached
   run; check the persisted run's latency fields), then re-run
   `tools/holdout-lock-audit.ts` after the first fleet evidence run (D32
   standing procedure).

Until then, evidence runs continue local-sequential per D7/D10 — the
charter's fleet mandate is acknowledged and blocked, not ignored
(DECISIONS D33).
