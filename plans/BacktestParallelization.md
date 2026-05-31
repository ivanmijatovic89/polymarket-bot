# Backtest Parallelization — Implementation Plan

## Goal

Speed up backtest from **119min → ~15min** on user's MacBook M1 Pro for a typical 3000-market batch, with an architecture that later extends to distributed workers (home PC, laptop, brat's PC, drugar's PC) **without code refactor** — only `.env` change.

Cost target: **€0/mes for local-only**. Optional ~€7/mes Hetzner CX33 droplet when distributed is enabled.

## Stack

| Component                 | Technology                                                     |
| ------------------------- | -------------------------------------------------------------- |
| Queue + workers           | **BullMQ**                                                     |
| Queue storage             | **Redis** (local via `brew install redis`)                     |
| Job orchestration         | **FlowProducer** (parent aggregate job + children market jobs) |
| Process manager           | **pm2** (recommended for daemons)                              |
| Dashboard                 | **Bull Board** + custom Fastify views                          |
| HTTP server for dashboard | **Fastify**                                                    |

Required new npm dependencies:

- `bullmq`
- `@bull-board/api`
- `@bull-board/fastify`
- `fastify`
- (`ioredis` installed transitively via bullmq)

## Final architecture (after all PRs)

Three independent long-running processes (managed by pm2):

```
[User's Mac — three pm2 processes]
├── 1. Redis (brew services, auto-start)
│
├── 2. Dashboard daemon — always on, independent
│     pm2 start "tsx src/cli/dashboard.ts" --name dashboard
│     ↳ http://localhost:3001
│       ├── Active batches (live)
│       ├── Workers (live stats)
│       ├── Historical batches (from MySQL)
│       └── Bull Board (raw queue/job views)
│
├── 3. Worker daemon — always on
│     pm2 start "tsx src/cli/backtestWorker.ts" --name worker
│     ↳ pulls market jobs + aggregate jobs
│     ↳ self-updates on commit changes (PR4)
│
└── npm run backtest -- ...    ← user-triggered
      ├── Pre-resolves markets
      ├── flowProducer.add({ parent + children })
      ├── If TTY: shows live terminal progress (waitUntilFinished)
      ├── If --detach or no TTY: prints batchUid, exits
      └── Aggregator handles final insert into MySQL

[Future: brat / drugar / kućni PC]
└── pm2 start backtestWorker --queues=markets
      ↳ no DB credentials, just Redis + R2 read
```

## Core invariants

1. **Per-market isolation**: each market has fresh runner/portfolio/orderManager.
2. **Sort by idx BEFORE every aggregation**: `computeBatchStats` (streak logic) and `computeChunkedBatchStats` ([96, 200, 300] chunks) depend on input order.
3. **Workers don't touch MySQL**: only the aggregator worker writes (and it runs only on DB-accessible machines via `--queues=aggregate` flag).
4. **Workers don't touch Polymarket APIs**: producer pre-resolves all Gamma/DB lookups.
5. **Job payload is self-contained**: `filePath`, `marketMeta`, `marketResolution`, `strategyId`, `strategyParams`, `commitSha`, latency params, batchUid.
6. **Bit-identical**: with `BACKTEST_LATENCY_JITTER=0`, `--workers 1` and `--workers 8` must match.

## What we don't do

- ❌ Hetzner droplet setup (local Redis for Phase 1)
- ❌ Tailscale, brat onboarding
- ❌ Schema migration to separate `backtest_market_stats` table
- ❌ Workers writing directly to MySQL
- ❌ R2 result store
- ❌ AI agent loop
- ❌ MySQL migration to cloud

All deferred items can be PR5+ later without changing PR1-PR4 code.

---

# Per-market observability — built in from day one

Every market job, when completed, returns an enriched `MarketStats` that includes execution metadata:

```ts
type MarketStats = {
  // ... existing fields (marketId, slug, pnl, trades, finalOutcome, etc.)

  // NEW execution metadata
  execution: {
    workerName: string // e.g. "macbook-pro-pid-12345"
    workerHost: string // hostname
    startedAt: number // unix ms when worker picked it up
    finishedAt: number // unix ms when result returned
    durationMs: number // finishedAt - startedAt
    eventsProcessed: number // total ticks from parquet replay
    eventsByType: Record<string, number> // { book: 1, price_change: 4823, ... }
    commitSha: string // git sha worker was on
  }
}
```

This is persisted into the existing `backtests.market_stats` JSON column as part of normal flow. **No schema change**, just additional fields per market. Visible in the dashboard per-market view.

### Why no separate table

User explicitly does not want schema migrations now. The JSON column already supports arbitrary additional fields, and 3000 markets × ~12KB per entry is ~36MB per batch row — well within MySQL JSON column limits.

If batches grow beyond ~50k markets and JSON row size becomes problematic, **then** we migrate to a dedicated table (PR5+).

---

# Version tracking — simpler than RUN_MARKET_VERSION

User pushed back on hardcoded `RUN_MARKET_VERSION = 1` constant: it adds a manual bump step and is redundant with `commitSha`.

**Revised approach**: drop `RUN_MARKET_VERSION` entirely. Use only `commitSha`.

Logic:

- Producer reads `git rev-parse HEAD` and tags every job with `commitSha`.
- Worker, before processing job, compares `job.data.commitSha` with its own `git rev-parse HEAD`.
- If different → worker triggers self-update (PR4) and exits for pm2 restart. Job returns to queue.

Since **any code change** (engine, strategy, plugins, anything) produces a new commit SHA, this catches all incompatibilities automatically. No manual version bumps. No drift between code change and "did I update the version constant?".

For the rare case of an explicit engine-breaking change where you want to **fail jobs early instead of self-update**, that's done via a producer-side runtime check before enqueue (not a constant in the code). Out of scope for v1 — commitSha matching handles every realistic scenario.

---

# PR1 — Extract `runSingleMarket()`

**Risk**: Low. Pure refactor.

## Goal

Move per-market logic out of `backtest.ts` into a standalone, side-effect-free module.

## Files

### NEW `src/backtest/runSingleMarket.ts` (~170 LOC)

Single function that does what the current `for` loop body does. Now also captures execution metadata.

```ts
export type RunSingleMarketInput = {
  idx: number
  filePath: string
  slug: string
  marketMeta: GammaMarketMeta | undefined
  marketResolution: MarketResolution | null
  strategyId: string
  strategyParams: Record<string, unknown>
  inputMode: 'recorded' | 'telonex-delta' | 'telonex-paired'
  order: 'recorded' | 'exchange_time'
  timeDriven: boolean
  latency: { delayMs: number; jitterMs: number }
  // Provided by worker at execution time:
  workerName: string
  workerHost: string
  commitSha: string
}

export type RunSingleMarketOutput = {
  idx: number
  slug: string
  marketStats: MarketStats | null
  durationMs: number
  eventsProcessed: number
  eventsByType: Record<string, number>
  failedReason?: string
}

export async function runSingleMarket(input: RunSingleMarketInput): Promise<RunSingleMarketOutput>
```

Internally:

- `startedAt = Date.now()`
- Runs replay (telonex-delta / telonex-paired / recorded)
- Tracks events count and `byType` map
- On finish, populates `marketStats.execution = { workerName, workerHost, startedAt, finishedAt, durationMs, eventsProcessed, eventsByType, commitSha }`
- Returns full output

### MODIFY `src/cli/backtest.ts`

Replace per-market loop body with `await runSingleMarket(input)`. All else unchanged.

For PR1, `workerName` / `workerHost` / `commitSha` are filled with placeholder values (`"sequential-local"` / hostname / current git SHA). PR2 replaces these with actual worker identity.

### MODIFY `src/backtest/stats/marketStats.ts` (~10 LOC)

Add `execution` field to the `MarketStats` type. Optional in the type, populated by `runSingleMarket`.

## Verification

1. Run baseline batch (50 markets) on current code, save `backtests` row JSON.
2. Apply PR1.
3. Re-run with `BACKTEST_LATENCY_JITTER=0`.
4. Diff `marketStats` (excluding the new `execution` field), `batchStats`, `chunkedBatchStats`. **Must be bit-identical.**

---

# PR2 — BullMQ FlowProducer + dashboard + workers

**Risk**: Medium. New infrastructure.

## Pre-requisites (one-time)

```bash
brew install redis
brew services start redis
```

## New dependencies

```bash
npm install bullmq @bull-board/api @bull-board/fastify fastify
```

## Files

### NEW `src/backtest/queue.ts` (~80 LOC)

Singleton helpers for Queue / FlowProducer / QueueEvents / connection.

Job options:

```ts
{
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: false,
  removeOnFail: false,
}
```

Worker options:

```ts
{
  lockDuration: 10 * 60 * 1000,
  stalledInterval: 30000,
  maxStalledCount: 1,
}
```

### NEW `src/cli/backtestWorker.ts` (~150 LOC)

Long-running worker daemon. CLI flags:

```bash
tsx src/cli/backtestWorker.ts \
  --queues=markets,aggregate \      # default: markets,aggregate (on Mac)
  --market-concurrency 7 \           # default: os.cpus().length - 1
  --aggregate-concurrency 1 \        # default: 1
  --worker-name <name>               # default: <hostname>-<pid>
```

Pre-startup checks:

- Node.js version matches `engines.node` in `package.json` (currently `>=20 <21`).
- `requireEnv(['REDIS_URL'])` plus any other required vars (e.g. R2 keys if telonex r2 mode).
- Redis ping.
- Exits with clear error message if any check fails.

Worker behavior:

- If `markets` in queues: `new Worker('backtests', marketProcessor, { concurrency })`.
- If `aggregate` in queues: `new Worker('backtest-aggregate', aggregateProcessor, { concurrency: 1 })`.
- After each job completes successfully:
  - `HINCRBY worker:<name>:processed 1`
  - `HINCRBY worker:<name>:events_total <eventsProcessed>`
  - `HSET worker:<name>:last_market <slug>`
  - `HSET worker:<name>:last_finished_at <timestamp>`
- Heartbeat: `SET worker:<name>:heartbeat <timestamp> EX 60` every 5 seconds.
- Per-job log prefix: `[worker=<name> batch=<batchUid> idx=<idx>]`.
- SIGINT/SIGTERM: graceful close, waits for in-flight.

### NEW `src/backtest/marketProcessor.ts` (~30 LOC)

Thin wrapper:

```ts
async function marketProcessor(job: Job): Promise<RunSingleMarketOutput> {
  return runSingleMarket({
    ...job.data,
    workerName: process.env.WORKER_NAME!,
    workerHost: os.hostname(),
    commitSha: getCurrentGitSha(),
  })
}
```

### NEW `src/backtest/aggregateProcessor.ts` (~120 LOC)

```ts
async function aggregateProcessor(job: Job): Promise<void> {
  const childrenValues = await job.getChildrenValues()
  const failedChildren = await job.getFailedChildrenValues()

  const successful = Object.values(childrenValues).filter(
    (v): v is RunSingleMarketOutput => v !== null && v.marketStats !== null,
  )

  // SORT BY IDX — critical
  successful.sort((a, b) => a.idx - b.idx)
  const sortedMarketStats = successful.map((s) => s.marketStats!)

  const batchStats = computeBatchStats(sortedMarketStats, job.data.initialCapital)
  const chunkedBatchStats = computeChunkedBatchStats(
    sortedMarketStats,
    job.data.initialCapital,
    [96, 200, 300],
  )

  await insertBacktestRun({
    batchUid: job.data.batchUid,
    ...job.data.metadata,
    batchStats,
    chunkedBatchStats,
    marketStats: sortedMarketStats,
    failedMarkets: Object.entries(failedChildren).map(([jobId, reason]) => ({
      jobId,
      reason: String(reason),
    })),
  })

  // Cleanup: remove children from Redis to prevent memory growth
  const childJobIds = Object.keys(childrenValues)
  await Promise.allSettled(childJobIds.map((id) => marketQueue.remove(id)))
}
```

### NEW `src/cli/dashboard.ts` (~80 LOC) — separate process

Standalone dashboard daemon. Not started by `backtest` command — runs continuously via pm2.

```bash
tsx src/cli/dashboard.ts                  # default port 3001
tsx src/cli/dashboard.ts --port 8080
```

Sets up Fastify server with:

- Bull Board adapter mounted at `/admin/queues` (raw queue/job inspection — both queues).
- Custom UI mounted at `/` (the user-facing dashboard pages).
- Custom JSON endpoints for the UI to consume.

### NEW `src/backtest/dashboardRoutes.ts` (~350 LOC)

JSON endpoints + minimal HTML pages.

**Endpoints**:

```
GET /api/workers
→ {
    workers: [
      {
        name: "macbook-pro-pid-12345",
        host: "macbook-pro",
        heartbeatAgeMs: 3500,
        alive: true,
        processedTotal: 1247,
        eventsTotal: 12847203,
        lastMarket: "btc-updown-15m-1760140800",
        lastFinishedAt: 1748542315000,
        currentJob: { batchUid, idx, slug, startedAtMs }  // if processing
      }
    ]
  }

GET /api/batches/active
→ {
    batches: [
      {
        batchUid,
        strategyId,
        comment,
        startedAt,
        totalMarkets,
        completedMarkets,
        failedMarkets,
        etaMs,
        flowParentJobId
      }
    ]
  }

GET /api/batches/history?limit=50
→ Reads from MySQL `backtests` table, returns recent finalized batches with summary stats.

GET /api/batches/:batchUid
→ Detail: progress + per-market list (idx, slug, status, workerName, durationMs, eventsProcessed)

GET /api/batches/:batchUid/markets
→ All children jobs for this batch, paginated. Per-market detail.

GET /api/batches/:batchUid/stream  (SSE)
→ Server-sent events stream of progress updates while batch active. Subscribes to QueueEvents internally.
```

**HTML pages** (minimal, no React/build step — just server-rendered HTML + HTMX for live updates):

- `/` — overview: active batches + worker list + history quick links
- `/batches` — list of historical batches
- `/batches/:batchUid` — single batch detail with live progress, per-market grid
- `/workers` — workers detail view
- `/admin/queues` — Bull Board (raw)

Each page uses HTMX `hx-get` polling every 2-3 seconds to refresh active data. No SPA framework needed; simple, lightweight, no build pipeline.

### MODIFY `src/cli/backtest.ts`

- Add `--detach` flag (default: `false` if stdout is TTY, `true` if not).
- Pre-resolve markets (existing logic, refactored into helper).
- Read git SHA, build `marketContexts`.
- Construct FlowProducer flow with `ignoreDependencyOnFailure: true`.
- If `--detach`: print `batchUid` + dashboard URL, exit 0.
- Else: subscribe to `QueueEvents('backtests')` for child completion events. Show terminal progress bar. `await flow.job.waitUntilFinished(new QueueEvents('backtest-aggregate'))`. Print final summary.
- **If Ctrl+C interrupts during wait**: print "batch continues in background. View at http://localhost:3001/batches/<batchUid>". Exit 0.

### MODIFY `src/cli/helpers/backtestArgs.ts`

Add `--detach` flag.

### MODIFY `.env.example`

```
REDIS_URL=redis://localhost:6379
DASHBOARD_PORT=3001
```

### MODIFY `src/config/env.ts`

Add `requireEnv(keys: string[]): void` helper for fail-fast validation.

### MODIFY `src/db/backtests.ts`

Add `failed_markets` JSON column to `backtests` schema. Drizzle migration in `drizzle/`.

### MODIFY `package.json` scripts

```json
{
  "backtest:worker": "tsx src/cli/backtestWorker.ts",
  "backtest:dashboard": "tsx src/cli/dashboard.ts"
}
```

Note: no `backtest:status` or `backtest:resume` scripts. Replaced by dashboard.

## What's removed compared to previous plan

- ❌ `RUN_MARKET_VERSION` constant — redundant with commitSha.
- ❌ `npm run backtest:status` CLI — view in dashboard.
- ❌ `npm run backtest:resume` CLI — open `/batches/:batchUid` in browser.
- ❌ `--dashboard` flag on `backtest` command — dashboard is independent daemon.
- ❌ Auto-discovery of batchUid by CLI — not needed; dashboard lists all.

## Verification

With `BACKTEST_LATENCY_JITTER=0`:

1. PR1 baseline saved.
2. Worker with `--market-concurrency=1` → diff vs PR1 baseline (excluding `execution` field). Bit-identical.
3. Worker with `--market-concurrency=7` → same. Bit-identical.
4. Large batch (3000 markets) wall-clock measured. Target ~15min.
5. Dashboard endpoints respond. `/workers` shows live counts. `/batches/:uid` shows progress.
6. Ctrl+C during `npm run backtest` (non-detach) → terminal exits cleanly, batch continues, dashboard reflects it.
7. Browser to `/batches/:uid` → can watch finish without knowing batchUid in advance (it's listed on `/`).

## Determinism audit

Before verification, grep codebase for non-determinism sources:

- `Math.random()` in `src/strategies/`, `src/strategy/`, `src/trading/`
- `Date.now()` in replay path (should only appear in latency simulation, not in core logic)
- Iteration over Map/Set that depends on key order

Fix or document each. If a strategy uses unseeded `Math.random()`, exclude it from bit-identical test and note.

---

# PR3 — Queue runner default + VitePress docs

**Risk**: Trivial.

## Files

### MODIFY `queue/run-queue.sh`

Default `JOBS=1`. Comments updated.

### MODIFY `queue/README.md`

Note change.

### NEW `docs-site/backtest/parallelization.md`

VitePress page (matching project's existing docs structure). Covers:

- Why parallel + how it works locally.
- Install Redis.
- Start worker daemon (with pm2 example).
- Start dashboard daemon (with pm2 example).
- Running backtest (no flag changes — defaults to parallel).
- Where to find live progress (dashboard URL).

### NEW `docs-site/backtest/distributed-future.md`

Forward-looking doc (no code yet). Covers:

- Hetzner CX33 setup pattern (when ready).
- Bratov machine onboarding pattern.
- `--queues=markets` separation for security.
- Aggregator placement constraint.
- Trust model.
- R2 result store option for 100k+ batches.

### MODIFY `docs-site/.vitepress/config.ts` (or equivalent)

Add new pages to sidebar / nav.

### NO changes to root `README.md`

User does not use root README. All docs go to `docs-site/`.

---

# PR4 — Self-update + commitSha tagging + pm2 + safety

**Risk**: Medium-high.

## Files

### MODIFY `src/cli/backtestWorker.ts`

Add self-update:

```ts
import { execSync } from 'child_process'
import { existsSync, writeFileSync, unlinkSync } from 'fs'

const LOCK_FILE = '/tmp/backtest-worker-update.lock'

function getCurrentGitSha(): string {
  return execSync('git rev-parse HEAD').toString().trim()
}

async function selfUpdate(reason: string): Promise<never> {
  if (existsSync(LOCK_FILE)) {
    log('Self-update lock held by another worker, waiting then exiting')
    while (existsSync(LOCK_FILE)) await sleep(5000)
    process.exit(0)
  }
  writeFileSync(LOCK_FILE, String(process.pid))
  try {
    log(`Self-update: ${reason}`)
    execSync('git fetch origin main', { stdio: 'inherit' })
    execSync('git reset --hard origin/main', { stdio: 'inherit' })
    execSync('npm install', { stdio: 'inherit' })
  } finally {
    unlinkSync(LOCK_FILE)
  }
  log('Self-update complete, exiting for pm2 restart')
  process.exit(0)
}

// Pre-job SHA check inside marketProcessor wrapper
async function marketProcessorWithVersionCheck(job: Job) {
  const localSha = getCurrentGitSha()
  if (job.data.commitSha !== localSha) {
    await worker.pause()
    await worker.close()
    selfUpdate(`job ${job.id} has commitSha ${job.data.commitSha}, local ${localSha}`)
  }
  return marketProcessor(job)
}

// Background polling every 5 min
setInterval(
  async () => {
    try {
      execSync('git fetch origin main --quiet')
      const remoteSha = execSync('git rev-parse origin/main').toString().trim()
      if (remoteSha !== getCurrentGitSha()) {
        log(`Background poll detected new commit ${remoteSha}`)
        await worker.pause()
        await worker.close()
        selfUpdate('background polling detected new commit')
      }
    } catch (err) {
      log(`Background poll error: ${err}`)
    }
  },
  5 * 60 * 1000,
)
```

### NEW `ecosystem.config.cjs` (project root)

pm2 manages three processes:

```js
module.exports = {
  apps: [
    {
      name: 'redis',
      script: 'redis-server',
      args: ['/usr/local/etc/redis.conf'],
      autorestart: true,
    },
    {
      name: 'backtest-worker',
      script: 'src/cli/backtestWorker.ts',
      interpreter: './node_modules/.bin/tsx',
      autorestart: true,
      kill_timeout: 30000,
      max_memory_restart: '2G',
      env: { NODE_ENV: 'production' },
      error_file: 'logs/worker-err.log',
      out_file: 'logs/worker-out.log',
      time: true,
    },
    {
      name: 'backtest-dashboard',
      script: 'src/cli/dashboard.ts',
      interpreter: './node_modules/.bin/tsx',
      autorestart: true,
      env: { NODE_ENV: 'production', DASHBOARD_PORT: 3001 },
      error_file: 'logs/dashboard-err.log',
      out_file: 'logs/dashboard-out.log',
      time: true,
    },
  ],
}
```

Redis usually managed by `brew services` on Mac (not pm2). Including it here is optional / for distributed worker setups.

### NEW `src/utils/parquetCache.ts` (~80 LOC)

For r2-mode workers:

- Cache dir: `~/.cache/backtest-parquet` (configurable).
- TTL cleanup: files older than 7 days.
- LRU eviction beyond configurable size (default 10GB).
- Worker daemon runs cleanup once per hour.

### MODIFY `docs-site/backtest/parallelization.md`

Add sections:

- pm2 setup with `ecosystem.config.cjs`.
- Self-update behavior.
- Conventions:
  - DB schema migrations run manually on Mac before pushing code that needs them.
  - Don't push engine changes during active batches.
  - Brat doesn't edit code in the worker clone.

## Verification

1. Start worker via pm2.
2. Push trivial commit (e.g., comment in code).
3. Wait 5 min, or trigger a batch.
4. Confirm worker pulled, restarted via pm2, resumed.
5. Verify Bull Board shows no dropped jobs.

---

# Verification protocol (all PRs)

For every PR:

1. Run small batch (50 markets) on current code → save `backtests` row JSON.
2. Apply PR.
3. Re-run with `BACKTEST_LATENCY_JITTER=0`.
4. Diff `marketStats` (excluding `execution` field), `batchStats`, `chunkedBatchStats`. Bit-identical or stop.

For PR2 specifically:

- Both `concurrency=1` and `concurrency=7` produce same result as PR1 baseline.

For PR4:

- Real-commit self-update test.

---

# Operational concerns covered

| Concern                                           | Where                                                        |
| ------------------------------------------------- | ------------------------------------------------------------ |
| Per-market job timeout (infinite loop protection) | PR2: `lockDuration: 10min`                                   |
| Cleanup after batch (Redis memory)                | PR2: aggregator removes children after success               |
| Node.js version mismatch                          | PR2: worker startup check                                    |
| .env validation                                   | PR2: `requireEnv` at startup                                 |
| Git lock for concurrent updates                   | PR4: file lock                                               |
| Worker startup health checks                      | PR2: Redis ping                                              |
| Parquet cache disk growth                         | PR4: TTL + LRU cleanup                                       |
| Determinism audit                                 | PR2: grep + manual review                                    |
| Failed markets visibility                         | PR2: `failed_markets` JSON in `backtests` + dashboard view   |
| Producer crash recovery                           | PR2: dashboard lists active batches; user re-attaches by URL |
| Worker logs format                                | PR2: `[worker=<name> batch=<uid> idx=<idx>]`                 |
| Per-market observability (worker, time, events)   | PR1+PR2: `execution` field in `MarketStats`                  |
| Graceful shutdown                                 | PR2: BullMQ `close()`; PR4: pm2 `kill_timeout: 30s`          |
| Workers don't need MySQL                          | PR2: `--queues=markets` separation                           |
| Workers don't need Polymarket API keys            | PR2: producer pre-resolves                                   |
| Dashboard auto-discovers batches                  | PR2: lists active flow parents from Redis                    |
| No batchUid memorization                          | PR2: dashboard lists all; click URL                          |

# Residual risks (accepted)

| Risk                                                          | Mitigation                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| Aggregator memory scales linearly with batch size (~12KB × N) | OK up to ~30k markets. Schema migration PR5+ if larger.     |
| Aggregator runs only on DB-accessible machines                | By design. Mac sleep → aggregator pauses until back online. |
| Redis crash mid-batch                                         | Workers reconnect; restart batch if jobs lost.              |
| macOS sleep mid-shutdown                                      | `caffeinate -i` during active batches.                      |
| Brat returns wrong results (Byzantine)                        | Trusted-friends model. Spot-rerun is PR5+ if needed.        |
| R2 outage blocks workers                                      | Workers fail gracefully, jobs retry, dashboard surfaces.    |

---

# Implementation timing

Realistic with AI-assisted dev and focused user collaboration:

| PR        | Code              | Verification         | Iterations | Realistic total      |
| --------- | ----------------- | -------------------- | ---------- | -------------------- |
| PR1       | ~30 min           | ~30 min              | 1-2        | **1-2 hours**        |
| PR2       | ~2-3 hours        | ~2 hours             | 3-5        | **5-8 hours**        |
| PR3       | ~45 min           | ~15 min              | minimal    | **1 hour**           |
| PR4       | ~1 hour           | ~2 hours             | 2-3        | **3-5 hours**        |
| **Total** | **~5 hours code** | **~5 hours testing** | —          | **1-3 focused days** |

Not 20 min (volume), not 2-3 weeks (that was human-dev estimate).

# Recommended execution order

**Phase 1 — Local speedup**:

- PR1 (extraction) → verify → merge.
- PR2 (BullMQ + dashboard + workers) → verify → merge.
- Result: parallelized backtest on Mac. €0/mes. 119min → ~15min. Dashboard at http://localhost:3001.

**Phase 2 — Distributed-ready (when ready)**:

- PR3 (queue defaults + VitePress docs) → merge.
- PR4 (self-update + pm2 + parquet cache) → merge.
- Optional: Hetzner droplet, brat onboarding.

---

# Decisions locked

- Stack: BullMQ + Redis + Fastify + Bull Board + HTMX for dashboard UI.
- Pattern: FlowProducer (parent aggregate + children markets).
- Pre-resolve: Producer does all DB/Gamma lookups before enqueue.
- Aggregator placement: `--queues=aggregate` on DB-accessible machines only.
- Process manager: pm2 for worker + dashboard daemons.
- Self-update: commitSha matching + 5min polling fallback. **No `RUN_MARKET_VERSION` constant.**
- No `backtest:status` or `backtest:resume` CLI — all via dashboard at fixed URL.
- Dashboard runs as **separate always-on daemon**, not auto-started by `backtest` command.
- Per-market `execution` metadata persisted in existing `marketStats` JSON (no schema migration now).
- Documentation: **`docs-site/` (VitePress)**. Root README untouched.
- Verification: bit-identical with `BACKTEST_LATENCY_JITTER=0`.
- Cost target: €0/mes Phase 1; ~€7/mes Hetzner CX33 Phase 2.

# Open items (deferred PR5+)

- Smoke test for new strategies pre-push.
- Sentry / error tracking.
- Prometheus metrics (Bull Board sufficient v1).
- Result validation / anti-cheat for distributed.
- Schema migration to `backtest_market_stats` table for 100k+ batches.
- AI agent strategy generator + evaluator integration.
