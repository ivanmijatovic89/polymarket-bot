# Distributed Workers (future)

The [Parallelization](./parallelization) page covers the **local** BullMQ
worker pool that PR2 added. This page describes how the same architecture
extends to **multiple machines** — your home PC, your laptop, a sibling
machine, a small cloud server — without changing any application code. Only
`.env` values change.

::: warning Status
Mostly implemented. Remote workers are supported (the `--queues=markets` flag
exists, jobs are self-contained, no worker needs MySQL access), and the
**worker self-update loop is now live** (see "Worker self-update" below) — run
workers via `scripts/run-worker.sh`. The Redis/Tailscale hosting and sibling
onboarding sections remain an operational roadmap.
:::

## Architecture sketch

```
[~€7/mes Hetzner CX33 droplet]
└── Redis (auth + TLS or Tailscale)
└── (optional) telonex sync cron, redeem-watcher

[Your Mac — producer + aggregator + worker]
├── npm run backtest -- ...
├── npm run backtest:worker -- --queues=markets,aggregate
└── npm run dashboard

[Sibling machines — workers only]
└── npm run backtest:worker -- --queues=markets
   ↳ no DB credentials, no Polymarket keys, just Redis + R2 read
```

## Setup outline

### 1. Pick a Redis host

Three viable options:

| Option                            | Cost      | Notes |
| --------------------------------- | --------- | ----- |
| **Hetzner CX33 droplet, self-hosted** | ~€7/mes | Recommended balance: cheap, you own the box, fine for one team. |
| **DO / DO Managed Redis**         | $12–15/mes| Less ops; managed backups + TLS by default. |
| **Tailscale + brew Redis on home PC** | €0    | Free, but the home PC has to stay on for siblings to reach it. |

Set a strong password (Redis `requirepass`), bind to the public interface
only after firewall rules are in place, and either enable TLS (`rediss://`)
or restrict access to a Tailscale tailnet.

### 2. Aggregator placement

Workers that consume the **aggregate** queue need MySQL credentials because
they finalize the batch into the `backtests` table. Restrict aggregation to
DB-reachable machines:

```bash
# On your Mac (DB host) — accepts both queues
npm run backtest:worker -- --queues=markets,aggregate

# On sibling machines — markets only, no DB envs in their .env
npm run backtest:worker -- --queues=markets
```

Siblings physically cannot insert into MySQL because their `.env` doesn't
contain `DATABASE_*` values.

### 3. Onboard a sibling machine

Steps for a trusted friend:

```bash
git clone https://github.com/<you>/polymarket-bot
cd polymarket-bot
npm install
cp .env.example .env
# fill in only:
#   REDIS_URL=rediss://default:<pass>@your-droplet:6380
#   R2_ENDPOINT=...
#   R2_BUCKET=...
#   R2_ACCESS_KEY_ID=...
#   R2_SECRET_ACCESS_KEY=...   (read-only is enough)
# leave DATABASE_* empty
npm run backtest:worker -- --queues=markets
# (recommended) use pm2 for autostart on reboot
```

That's the full onboarding. They cannot trade with your keys, can't write
to your database, and can only read parquet files from R2.

### 4. Parquet access

For sibling workers to replay markets they need the parquet files. In
`--read-from r2` mode the producer passes the R2 URL inside `marketResolution`
already, and workers download on demand. For `--read-from local` you'd have
to sync the `data/events/` directory to every worker, which is impractical —
prefer R2 for distributed runs.

## Worker self-update (implemented)

Workers now self-update instead of failing on stale code. The mechanism is a
per-job commit gate plus a thin relauncher — **no pm2, no extra daemon**.

### How it works

Each market job carries the producer's `commitSha`. Before replaying a market,
the worker compares that against the SHA it **loaded its code at** — captured
once at process start as `WORKER_LAUNCH_SHA`, not a live `git rev-parse`. The
launch SHA is what reflects the in-memory strategy registry, so this is correct
even on the producer's own machine where files on disk change under the running
worker after a commit.

The decision (`classifyJobCommit` in `src/backtest/workerIdentity.ts`):

- **same commit** → run the job normally.
- **worker behind its upstream** → the job's code is reachable by pulling, so
  the worker:
  1. releases the job with `job.moveToDelayed(...)` — **no attempt consumed**,
     and the job stays out of the "active" set so it never counts as stalled
     (respecting `maxStalledCount: 1`);
  2. signals its supervisor over IPC (`{ type: 'update-requested' }`);
  3. the supervisor drains all children and exits with code **75**.
- **worker already at its upstream tip** but the job wants a different commit
  (unpushed / diverged producer) → fail fast with a clear message. This is the
  loop guard: pulling can't help, so don't restart-loop.

### The relauncher

`scripts/run-worker.sh` wraps the worker:

```bash
./scripts/run-worker.sh --queues markets --market-concurrency 5
```

It runs the worker, and on exit code **75** it does `git fetch && git pull
--ff-only` (plus `npm install` only if `package-lock.json` changed) and
relaunches. Any other exit code stops the loop and is propagated, so tmux /
systemd see the real status. `--ff-only` means a dirty or diverged checkout is
never clobbered — it just logs and relaunches on current code.

This replaces the bare `npm run backtest:worker` in `.tmuxinator.yml`.

### Producer guard

`npm run backtest` (BullMQ path) **blocks on an uncommitted working tree**
(override with `BACKTEST_ALLOW_DIRTY=1`). Uncommitted strategy code is invisible
to the commit gate — the SHA still points at the old commit — so a dirty tree
would silently run stale code on every worker. Committing first is mandatory for
distributed runs.

### Still optional / future

- **Polling fallback** — workers only check on a job arrival; an idle box won't
  update until the next job. For this workflow that's fine (the job is what
  forces the check). Add a periodic `git fetch` compare if you ever want idle
  boxes to pre-warm.
- **Parquet LRU/TTL cache** — bounds disk usage on sibling machines that
  download from R2.

### Conventions

- DB schema migrations run **manually** on the producer (your Mac) before
  pushing strategy code that needs them. Workers never run `db:migrate`.
- Engine changes (`runSingleMarket` semantics, plugin behavior) should not
  ship during an active batch — finish the run first (otherwise workers
  mid-batch see a moving target).
- Siblings keep a clean checkout so `git pull --ff-only` always fast-forwards;
  experimental code lives in a separate clone.

## Scaling beyond ~30k-market batches

The aggregate worker calls `job.getChildrenValues()` which loads every
child's `MarketStats` into memory at once. At ~12 KB per market, that's
fine up to roughly 30k markets per batch (a few hundred MB).

Beyond that, the right move is to **persist each market straight to a
dedicated table** as it finishes and have the aggregator SQL-query the
table back. That's a separate PR (schema migration + per-row insert in
the market processor) and only worth doing when you actually hit the
ceiling.

## Trust model

This is the "trusted friends" model: workers can return bogus `marketStats`
that would silently contaminate your batch. The current mitigation is
social, not technical. A future PR could add spot-rerun verification (the
producer re-runs a random 1–5% of children locally and diffs the result),
but that doubles the cost on the verified slice and is overkill for now.
