# Backtest Parallelization

Run a single batch across all of your machine's CPU cores by default, with the
same code path that later scales to multiple machines. The producer (the
`npm run backtest` command) enqueues every market as a child job in a BullMQ
**FlowProducer** flow; one or more worker daemons consume the queue; when all
children settle, the **aggregate parent job** sorts results back into input
order and writes normalized result rows to MySQL.

## What you need running

Three independent long-running things on the machine that runs the producer:

| What       | How to start                            |
| ---------- | --------------------------------------- |
| Redis      | `brew services start redis`             |
| Worker     | `npm run backtest:worker`               |
| Dashboard  | `npm run dashboard` → http://127.0.0.1:3051 (Next.js) |

The producer itself (`npm run backtest -- ...`) is invoked per-batch and exits
when the aggregator finishes (or right after enqueue if you pass `--detach`).

## Quick start

```bash
# one-time setup
brew install redis
brew services start redis
npm install

# in one terminal: long-running worker + dashboard
npm run backtest:worker      # consumes both queues by default
npm run dashboard            # http://127.0.0.1:3051 (Next.js)
npm run bull-board           # http://127.0.0.1:3052/admin/queues

# in another terminal: run a batch as usual
npm run backtest -- \
  --strategy SplitSellRedeem.v5 \
  --param splitShares=10 --param sellSize=10 \
  --input-mode telonex-delta --read-from local \
  --symbol btc --limit 10
```

The producer streams live progress and exits when the aggregator finalizes the
batch into MySQL. The dashboard shows worker stats, queue depth, active
batches and the recent history at all times.

## How it works

```
[npm run backtest]
   │
   │  1. pre-resolves every market (DB lookups + Gamma fallback)
   │     so workers never touch MySQL or Polymarket APIs
   │  2. enqueues 1 aggregate parent + N market children atomically
   │     via FlowProducer
   │
   ▼
Redis queues   (markets queue + aggregate queue)
   │
   ▼
[backtest worker daemons]
   │  N parallel children → runSingleMarket(...)
   │  per-market return values (MarketStats + execution metadata)
   │  stay in Redis until the aggregator consumes them
   │
   ▼  (after every child settles)
[aggregate worker]
   │  sorts children by idx (preserves streak / segment invariants),
   │  computes run summary stats as the `all` segment + per-segment stats,
   │  inserts normalized backtest result rows,
   │  removes children jobs from Redis to bound memory
   ▼
MySQL rows in `backtest_runs`, `backtest_run_markets`,
`backtest_run_failures`, and `backtest_run_segments`.
```

### Per-market observability

Every market job reports its own `execution` metadata, stored on its
`backtest_run_markets` row:

```ts
marketStats[i].execution = {
  workerName: "Ivans-MacBook-Pro-2.local-12345#3",
  startedAtMs: 1780142882515,
  finishedAtMs: 1780142883710,
  durationMs: 1195,
  eventsProcessed: 14628,
  eventsByType: { book: 60, price_change: 14568 },
  commitSha: "4b0be181e18baef2142acb82dec9a46be8d24cfa",
}
```

The aggregator doesn't use these for math; they exist so the dashboard can
show "which worker did this market, how long did it take, how many events
went through it". Old rows with no `execution` field still aggregate fine.

## Modes

### Default (BullMQ, parallel)

```bash
npm run backtest -- ...
```

Requires Redis + at least one worker daemon. Producer blocks until the
aggregator finishes; **Ctrl+C detaches** from the live view but the batch
keeps running in the queue — re-attach by opening
`http://127.0.0.1:3051/batches/<uid>` in the dashboard.

### Detach immediately

```bash
npm run backtest -- ... --detach
```

Producer enqueues the flow, prints the `batchUid`, and exits. The aggregator
worker will finalize the batch into MySQL as soon as the children settle. No
need to keep a producer process alive for long batches.

### Sequential fallback

```bash
npm run backtest -- ... --sequential
```

Bypasses BullMQ entirely; runs the loop in-process. Useful when:

- You want a quick smoke test without starting a worker daemon.
- You are doing bit-identical verification against a baseline.
- You are running on a machine with no Redis.

## Worker daemon

`npm run backtest:worker` runs a small **supervisor** process. For the
market queue it forks **N single-concurrency child Node processes** via
`child_process.fork`. Each child has its own event loop, so N children give
you real CPU parallelism across N cores. The aggregate queue (concurrency 1,
I/O-bound) runs in-process on the supervisor.

::: tip Run via the self-updating wrapper
For long-lived workers (local or remote), launch through
`./scripts/run-worker.sh` instead of `npm run backtest:worker` — same flags.
The wrapper relaunches the supervisor on new code so a worker never runs a
stale strategy registry. See
[worker self-update](/backtest/worker-self-update).
:::

::: warning Why N processes instead of `concurrency: N` on one Worker
A BullMQ `Worker` with `concurrency: N` runs N async callbacks on **one**
Node event loop. JavaScript is single-threaded, so CPU-bound replay work
serializes — `concurrency: 8` looks like 8 parallel jobs to BullMQ but
only saturates ~1 core. To get real parallelism in Node, you need
separate processes (or `worker_threads`). The supervisor does the
former so a single `npm run backtest:worker -- --market-concurrency 8`
actually uses 8 cores.
:::

Useful flags:

```bash
npm run backtest:worker -- \
  --queues markets,aggregate \   # default; restrict remote machines to "markets"
  --market-concurrency 8 \       # default: os.cpus().length - 1 (one child per slot)
  --aggregate-concurrency 1      # default: 1 (in-process on supervisor)
```

Each machine is identified by an immutable `machineId` — the first 12 hex
chars of the hardware UUID from
[`node-machine-id`](https://www.npmjs.com/package/node-machine-id). There is
no flag or env override: two invocations on the same box always produce the
same id, and two different machines can never collide. Persisted rows in
`backtest_run_markets.machine_id` use this id directly.

The supervisor and each child publish a live Redis heartbeat under the key
`backtest:worker:<machineId>#<childId>` (children) or `<machineId>#supervisor`
(the markets supervisor) / `<machineId>#aggregator` (an aggregate-only process).
The dashboard surfaces each row with its own `processedTotal`,
`eventsTotal`, `lastMarket`, and 60-second heartbeat — the `#childId` suffix
is **not** persisted to MySQL.

Graceful shutdown:

1. Supervisor catches `SIGINT` / `SIGTERM`, forwards the signal to every
   child, waits up to 30 seconds, then SIGKILLs stragglers.
2. Children release the BullMQ blocking poll, close their Redis
   connection, and exit within ~5 seconds (`process.exit(0)` backstop).
3. If the supervisor dies first, children detect IPC disconnect and
   self-exit so they don't orphan.

pm2 / systemd `kill_timeout` should be set to at least 30 seconds.

## Dashboard

`npm run dashboard` starts the Next.js dashboard at
`http://127.0.0.1:3051`. It lives in the `dashboard/` package (separate
from the bot's `src/`) and reads MySQL + Redis directly. Routes:

| Path                            | What                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| `/`                             | Overview: queue counts, workers list, active batches, history.      |
| `/batches/<batchUid>`           | Per-batch detail: live progress (active) or stats + per-market grid (completed). |
| `/api/health`                   | Health JSON.                                                        |
| `/api/workers`                  | Live worker stats (processed counts, heartbeat, current job).       |
| `/api/queues`                   | Per-queue waiting/active/completed/failed counts.                   |
| `/api/batches/active`           | Aggregate parent jobs that haven't finalized yet.                   |
| `/api/batches/history?limit=N`  | Recent finalized batches from MySQL.                                |
| `/api/batches/:uid`             | Finalized batch metadata plus stats from the `all` segment.         |

For raw queue/job inspection, run Bull Board as a separate process:

```
npm run bull-board        # http://127.0.0.1:3052/admin/queues
```

Both procs are read-only relative to MySQL; you can run them on the same
machine as the producer or anywhere with network access to Redis + MySQL.

## Invariants & guarantees

1. **Per-market isolation** — each child job calls `runSingleMarket` with a
   fresh `Runner` / `Portfolio` / `OrderManager`. No state crosses markets.
2. **Sort by idx before every aggregation** — the aggregator sorts children
   results by their producer-assigned `idx` before passing to
   `computeBatchStats`. Segment computation then sorts by
   `marketStartMs` ascending so streak and per-segment logic stays
   bit-identical regardless of which worker finishes when.
3. **Workers don't touch MySQL** — the producer pre-resolves every market and
   passes the resolved meta/resolution in the job payload. The aggregate
   worker is the only worker that needs DB credentials; restrict it to
   DB-reachable machines with `--queues=aggregate`.
4. **Workers don't touch Polymarket APIs** — same as above; the Gamma
   fallback happens in the producer, not in workers.
5. **Bit-identical with sequential** — set `BACKTEST_LATENCY_JITTER=0` and
   `--sequential` and `--market-concurrency=N` produce byte-equal
   `marketStats` (excluding the new optional `execution` field) and run
   summary columns. See `npm run backtest:verify-diff`. The persisted shape
   is documented in [Backtest Result Storage](/backtest/statistics/result-storage).

## Verifying bit-identical behavior

`src/cli/verify-backtest-diff.ts` (exposed via `npm run backtest:verify-diff`)
loads two backtest runs by `batchUid` and reports the first structural
difference in `marketStats` (excluding the `execution` field) and run summary
columns.

```bash
# baseline (sequential, in-process)
npm run backtest -- --sequential --batchUid v-seq ...

# parallel (workers must be running)
npm run backtest -- --batchUid v-par ...

npm run backtest:verify-diff -- --baseline v-seq --candidate v-par
```

Expected output when behavior matches:

```
✅ marketStats (excluding execution): bit-identical
✅ run summary columns: bit-identical
candidate marketStats with execution metadata: N/N
```

With `BACKTEST_LATENCY_JITTER=0` (and no `Math.random()` in strategy code),
the diff must be bit-identical. Any mismatch points at non-determinism — fix
it before treating the BullMQ path as equivalent to the sequential one.

## Operational notes

- `removeOnComplete: false` is intentional: child results stay in Redis until
  the aggregator pulls them. After a successful aggregate insert the children
  are removed explicitly so memory stays bounded.
- `attempts: 3` with exponential backoff handles transient parquet/R2/Redis
  hiccups. `ignoreDependencyOnFailure: true` lets the batch finalize with
  partial results when some children give up; the failures land in
  `backtest_run_failures` for audit.
- `lockDuration: 10 minutes` is the upper bound per market; if a strategy
  has an infinite-loop bug it will be reaped instead of stalling the queue.
- The producer's git SHA is attached to every job (`commitSha` field). A market
  worker runs any job whose commit its loaded code already contains, and
  **self-updates** (pull + relaunch) when a job needs a newer commit — see
  [worker self-update](/backtest/worker-self-update).
  Worker heartbeats publish the loaded commit and whether it matches
  `origin/main`.

## Environment

```env
REDIS_URL=redis://localhost:6379
# Bull Board (raw queue inspector) — separate proc on its own port.
BULL_BOARD_PORT=3052
# BULL_BOARD_HOST=127.0.0.1
```

`REDIS_URL` is required for the worker and dashboard daemons. The Next.js
dashboard port defaults to 3051 (3001 is reserved for the live WebUI); override via `DASHBOARD_PORT`.
The producer
falls back to `localhost:6379` if it isn't set and pings Redis up front so
you get a clear error rather than a hang.
