# Tool: runBacktest

## Purpose

Create new backtest runs for one strategy experiment: the smoke test, the
cells of a coordinate-search pass, or a single fixed-params run.

## Use When

- An experiment is `queued` and ready for its smoke test or first pass.
- A judged pass needs the next pass submitted.
- A refinement grid is needed before the final verdict.

## Do Not Use When

- You are adding coverage to an existing run (stage climb) — use
  [`strategy-research-protocol/tools/extendBacktest.md`](./extendBacktest.md).
- You only need to check completion — use
  [`strategy-research-protocol/tools/checkBatch.md`](./checkBatch.md).
- You only need to inspect results — use
  [`strategy-research-protocol/tools/getBacktestResults.md`](./getBacktestResults.md).

## Inputs

- Strategy id (`<family>.<experiment-id>`).
- Strategy params (`--param key=value`, one per param).
- `--batchUid` per [`strategy-research-protocol/rules/NAMING.md`](../rules/NAMING.md).
- `--baselineId <runId>` — the experiment's comparison anchor (champion's
  best run, or the 000-baseline best run). Required on every evidence run
  once the family has any judged run; the very first 000-baseline pass has
  no anchor yet and omits it.
- Market selection profile (see below).
- `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1` env when the strategy uses the
  TechnicalIndicators plugin
  ([`strategy-research-protocol/ENGINE.md`](../ENGINE.md)).

## Precondition

Submit preconditions (clean tree, committed and pushed, worker fleet
synced) per [`strategy-research-protocol/SESSIONS.md`](../SESSIONS.md) (Preconditions);
workers run committed code only
([`strategy-research-protocol/ENGINE.md`](../ENGINE.md#workers-run-committed-code-only)).

## Protocol Defaults

- `symbol=btc`, `timeframe=15m`, `input-mode=telonex-delta`,
  `converter=delta-typed`
- one market equals one BTC 15 minute up/down episode
- read source: **ALWAYS** `--read-from local-or-download-from-r2-to-local`
  (reads local when present, downloads once when missing — works on every
  machine, prewarmed or not). Never use plain `local` or `r2` for protocol
  runs. The `npm run backtest:research:btc:15m` shortcut has this baked in;
  do NOT use `backtest:telonex:btc:15m`, which hardcodes `local`.

## Selection profiles

Stage sizes come from
[`strategy-research-protocol/STAGE-GATES.md`](../STAGE-GATES.md):

- **Smoke** (stage 0): `--latest --limit 10 --sequential`, batchUid suffix
  `--smoke`. Never evidence; never freezes code.
- **Screen** (stage 1): `--latest --limit 1000` — coordinate passes run here.
- **Confirm / full-history** (stages 2-3): do NOT create new runs; extend the
  winning run with `extendBacktest`.

## Coordinate-search passes

One pass sweeps ONE param; every other param stays at the declared defaults /
previous winners. Each value is one submission; all submissions of a pass
share the pass batchUid:

```bash
npm run backtest:research:btc:15m -- --strategy book-imbalance.000-baseline \
  --latest --limit 1000 \
  --batchUid book-imbalance--000-baseline--p1-enterThreshold \
  --baselineId <runId> \
  --param enterThreshold=0.3 --param dwellTicks=3 --param takeProfitTicks=2

# ... one command per value of enterThreshold (0.4, 0.5, 0.6), same batchUid
```

For a single-run experiment (`kind: variation` with fixed `params`), submit
exactly one run under the bare `<family>--<experiment-id>` batchUid.

Re-runs after a bug get the next `--rN` suffix — never reuse a batchUid for
different effective params.

## Implementation

Current implementation: CLI

```bash
npm run backtest:research:btc:15m -- --strategy <strategy-id> [flags]
# equivalent explicit form:
npm run backtest -- --input-mode telonex-delta \
  --read-from local-or-download-from-r2-to-local \
  --symbol btc --timeframe 15m --strategy <strategy-id> [flags]
```

Common flags: `--param k=v`, `--limit n`, `--latest`, `--random`,
`--from-ms`, `--to-ms`, `--sequential`, `--detach`, `--batchUid`,
`--baselineId`.

For evidence runs prefer the normal BullMQ worker path. Use `--sequential`
only for smoke tests, local debugging, or parity checks.

## Source Of Truth

- [`docs/backtest/running-backtests.md`](../../docs/backtest/running-backtests.md)
- [`docs/datasets/telonex/backtest.md`](../../docs/datasets/telonex/backtest.md)
- [`docs/backtest/parallelization.md`](../../docs/backtest/parallelization.md)
- [`docs/backtest/fleet/self-update.md`](../../docs/backtest/fleet/self-update.md)

## Output

- Submitted runs, one per command.
- `submissionUid` per submission and the shared `batchUid` — both must be
  captured at submit time.

## After Success

Update FAMILY.json immediately (see
[`strategy-research-protocol/MEMORY.md`](../MEMORY.md)):

- record `batchUid` + `submissionUids` on the pass (or on the experiment for
  single runs), plus `baselineId`, `coverage`, `submittedAt`
- set experiment status `running` (first evidence submission also flips the
  family to `researching`)

Smoke runs update nothing — they are not memory.

## If It Fails

- Fix invalid strategy id, params, dataset selection, or environment issue
  and resubmit; a broken evidence submission is superseded under a `--rN`
  batchUid.
- If the experiment cannot run at all, set it `aborted` with `abortReason`.
