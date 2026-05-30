# Backtest Parallelization

Run a single batch across all of your machine's CPU cores by default, with the
same code path that later scales to multiple machines. The producer (the
`npm run backtest` command) enqueues every market as a child job in a BullMQ
**FlowProducer** flow; one or more worker daemons consume the queue; when all
children settle, the **aggregate parent job** sorts results back into input
order and writes a single `backtests` row.

## What you need running

Three independent long-running things on the machine that runs the producer:

| What       | How to start                            |
| ---------- | --------------------------------------- |
| Redis      | `brew services start redis`             |
| Worker     | `npm run backtest:worker`               |
| Dashboard  | `npm run backtest:dashboard` → http://127.0.0.1:3001 |

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
npm run backtest:dashboard   # http://127.0.0.1:3001

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
   │  sorts children by idx (preserves streak / chunk invariants),
   │  computes batchStats + chunkedBatchStats,
   │  inserts the single `backtests` row,
   │  removes children jobs from Redis to bound memory
   ▼
MySQL row in `backtests` (unchanged shape, new optional execution metadata
inside each marketStats entry; new `failed_markets` JSON column).
```

### Per-market observability

Every market job now reports its own `execution` metadata, stored in the same
`market_stats` JSON column the producer already used:

```ts
marketStats[i].execution = {
  workerName: "Ivans-MacBook-Pro-2.local-12345",
  workerHost: "Ivans-MacBook-Pro-2.local",
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
`http://127.0.0.1:3001/batches/<uid>` in the dashboard.

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

`npm run backtest:worker` is a small CLI that wires up one or two BullMQ
`Worker` instances against the shared Redis connection. Useful flags:

```bash
npm run backtest:worker -- \
  --queues markets,aggregate \   # default; restrict remote machines to "markets"
  --market-concurrency 7 \       # default: os.cpus().length - 1
  --aggregate-concurrency 1 \    # default: 1
  --worker-name my-mac           # default: <hostname>-<pid>
```

Aggregator concurrency should almost always be 1: the aggregator finalizes a
batch with one big MySQL write. Market concurrency should be as close to your
core count as your other workload allows (we leave one core free by default).

The worker writes per-instance stats to Redis hashes
(`backtest:worker:<name>`) so the dashboard can show `processedTotal`,
`eventsTotal`, `lastMarket`, `commitSha`, and a 60-second heartbeat key
(`backtest:worker:<name>:heartbeat`).

Graceful shutdown: `SIGINT` / `SIGTERM` cause `worker.close()` to wait for
in-flight jobs (up to the BullMQ `lockDuration`, currently 10 minutes) before
exiting. pm2 / systemd should give it at least 30 seconds of `kill_timeout`.

## Dashboard

`npm run backtest:dashboard` starts a Fastify server on
`http://127.0.0.1:3001` (override with `DASHBOARD_PORT`) with:

| Path                 | What                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `/`                  | HTMX overview: queue counts, workers list, active batches, history. |
| `/admin/queues`      | Bull Board: raw queue + job inspection (markets + aggregate).       |
| `/api/health`        | Health JSON.                                                        |
| `/api/workers`       | Live worker stats (processed counts, heartbeat, current job).       |
| `/api/queues`        | Per-queue waiting/active/completed/failed counts.                   |
| `/api/batches/active`| Aggregate parent jobs that haven't finalized yet.                   |
| `/api/batches/history?limit=N` | Recent finalized batches from MySQL.                      |
| `/api/batches/:uid`  | Full row from `backtests` for one batch.                            |

The dashboard is read-only relative to MySQL; you can run it on the same
machine as the producer or anywhere with network access to Redis + MySQL.

## Invariants & guarantees

1. **Per-market isolation** — each child job calls `runSingleMarket` with a
   fresh `Runner` / `Portfolio` / `OrderManager`. No state crosses markets.
2. **Sort by idx before every aggregation** — the aggregator sorts children
   results by their producer-assigned `idx` before passing to
   `computeBatchStats` / `computeChunkedBatchStats`. This keeps streak and
   chunk logic bit-identical regardless of which worker finishes when.
3. **Workers don't touch MySQL** — the producer pre-resolves every market and
   passes the resolved meta/resolution in the job payload. The aggregate
   worker is the only worker that needs DB credentials; restrict it to
   DB-reachable machines with `--queues=aggregate`.
4. **Workers don't touch Polymarket APIs** — same as above; the Gamma
   fallback happens in the producer, not in workers.
5. **Bit-identical with sequential** — set `BACKTEST_LATENCY_JITTER=0` and
   `--sequential` and `--market-concurrency=N` produce byte-equal
   `marketStats` (excluding the new optional `execution` field),
   `batchStats`, and `chunkedBatchStats`. See `npm run backtest:verify-diff`.

## Verifying bit-identical behavior

```bash
# baseline (sequential, in-process)
npm run backtest -- --sequential --batchUid v-seq ...

# parallel (workers must be running)
npm run backtest -- --batchUid v-par ...

npm run backtest:verify-diff -- --baseline v-seq --candidate v-par
```

The diff helper ignores the `execution` field and reports any structural
difference in `marketStats`, `batchStats`, or `chunkedBatchStats`. With
`BACKTEST_LATENCY_JITTER=0` the result must be bit-identical.

## Operational notes

- `removeOnComplete: false` is intentional: child results stay in Redis until
  the aggregator pulls them. After a successful aggregate insert the children
  are removed explicitly so memory stays bounded.
- `attempts: 3` with exponential backoff handles transient parquet/R2/Redis
  hiccups. `ignoreDependencyOnFailure: true` lets the batch finalize with
  partial results when some children give up; the failures land in the new
  `failed_markets` JSON column for audit.
- `lockDuration: 10 minutes` is the upper bound per market; if a strategy
  has an infinite-loop bug it will be reaped instead of stalling the queue.
- The producer's git SHA is attached to every job (`commitSha` field) so a
  later PR can self-update workers whose checkout drifted.

## Environment

```env
REDIS_URL=redis://localhost:6379
DASHBOARD_PORT=3001
# DASHBOARD_HOST=127.0.0.1
```

`REDIS_URL` is required for the worker and dashboard daemons. The producer
falls back to `localhost:6379` if it isn't set and pings Redis up front so
you get a clear error rather than a hang.
