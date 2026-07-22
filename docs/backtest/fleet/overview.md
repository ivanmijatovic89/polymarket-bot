---
title: Distributed Workers
description: Run the backtest worker pool across multiple machines — a shared Redis, markets-only siblings, and self-updating code — without changing application code.
---

# Distributed Workers

[Parallelization](/backtest/parallelization) covers the **local** BullMQ worker
pool. The same architecture scales to **multiple machines** — your desktop, a
laptop, a friend's box, a small cloud server — with no application changes: only
`.env` values differ per machine. A shared Redis hands jobs to whichever worker
is free, and each worker keeps itself on the right code automatically.

::: tip Code stays in sync on its own
Workers detect when a job needs newer code, pull, and relaunch — see
[Worker Self-Update](/backtest/fleet/self-update). Launch every machine's
worker through `./scripts/run-worker.sh` so this works.
:::


## Command cheat sheet

Everything fleet- and data-related in one place. Human-typed commands use the
`npm run` form; extra flags go after `--`.

| Command | What it does | Docs |
| --- | --- | --- |
| `npm run fleet:status` | Inventory of every machine: git, sessions, disk, datasets (what each machine HAS) | [Fleet Status](/backtest/fleet/status) |
| `npm run fleet:data:sync -- btc:15m -e data_sync_extra='--dry-run'` | Verdict: what is MISSING per machine vs R2/upstream, `FLEET SYNCED` yes/no | [Sync Fleet Data](/backtest/fleet/data-sync) |
| `npm run fleet:data:sync -- btc:15m` | Pull datasets R2 → local on every worker | [Sync Fleet Data](/backtest/fleet/data-sync) |
| `npm run fleet:update` | Fast-forward every worker checkout to origin/main | [Update Fleet](/backtest/fleet/update) |
| `npm run fleet:start` | Update + start the managed tmux worker session everywhere | [Start the Fleet](/backtest/fleet/start) |
| `npm run fleet:stop` | Stop workers everywhere — graceful drain, force only after the grace period | [Stop the Fleet](/backtest/fleet/stop) |
| `npm run data:sync:main -- --market btc:15m` | Producer: catalog → raw → convert → feeds → R2 (+ local reconcile) | [Machine Roles & Sync](/datasets/sync) |
| `npm run data:sync:worker -- --market btc:15m` | This machine only: pull all datasets R2 → local | [Machine Roles & Sync](/datasets/sync) |
| `npm run worker:markets` | Start a markets-only backtest worker (self-updating wrapper) | [Self-Update](/backtest/fleet/self-update) |
| `npm run worker:aggregate` | Aggregate-only worker (needs DB credentials) | [Self-Update](/backtest/fleet/self-update) |
| `npm run worker:markets-and-aggregate` | Both queues in one process (producer / DB host) | [Self-Update](/backtest/fleet/self-update) |

Typical daily rhythm: `data:sync:main` → `fleet:data:sync` → `fleet:data:sync --dry-run`
until it prints `✅ FLEET SYNCED` → run batches.

## Architecture sketch

```
[Shared Redis host — e.g. small cloud droplet]
└── Redis (password + TLS, or private Tailscale network)
└── (optional) telonex sync cron, redeem-watcher

[Your Mac — producer + aggregator + worker]
├── npm run backtest -- ...                              # enqueue batches
├── ./scripts/run-worker.sh --queues markets,aggregate   # consume both queues
└── npm run dashboard

[Sibling machines — workers only]
└── ./scripts/run-worker.sh --queues markets
    ↳ no DB credentials, no Polymarket keys — just Redis + R2 read access
```

## Setup

### 1. Pick a Redis host

Redis is the only shared dependency. Three common choices:

| Option | Cost | Notes |
| --- | --- | --- |
| **Self-hosted droplet** (e.g. Hetzner CX-class) | ~€5–7/mo | Cheap, you own the box; fine for one team. |
| **Managed Redis** (DigitalOcean, etc.) | ~$12–15/mo | Less ops; managed backups and TLS by default. |
| **Tailscale + local Redis** | €0 | Free, but the host machine must stay online for siblings to reach it. |

::: warning Secure it before exposing it
Set a strong `requirepass`, and only bind Redis to a public interface once
firewall rules are in place. Prefer TLS (`rediss://`) or restrict access to a
private Tailscale tailnet.
:::

### 2. Place the aggregator on a DB-reachable machine

Workers on the **aggregate** queue need MySQL credentials — they finalize each
batch into the `backtest_runs` table and its child tables. Keep aggregation on
machines that can reach the database; let everyone else run markets only.

::: code-group
```bash [DB host — both queues]
npm run worker:markets-and-aggregate
```
```bash [sibling — markets only]
npm run worker:markets
```
:::

A sibling physically cannot write to MySQL: its `.env` has no `DATABASE_*`
values.

### 3. Onboard a sibling machine

```bash
git clone https://github.com/<you>/polymarket-bot
cd polymarket-bot
npm install
cp .env.example .env
# Fill in only:
#   REDIS_URL=rediss://default:<password>@<redis-host>:<port>
#   R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY  (read-only)
# Leave DATABASE_* and trading keys empty.
npm run worker:markets
```

That is the whole onboarding. The sibling cannot trade with your keys, cannot
write to your database, and can only read parquet from R2.

::: tip Keep sibling checkouts clean
Self-update relies on `git pull --ff-only`. Keep each worker's checkout on the
tracked branch with no local edits, so a pull always fast-forwards. Do
experimental work in a separate clone. See
[Worker Self-Update](/backtest/fleet/self-update#the-one-rule-commit-and-push-first).
:::

### 4. Parquet access

Workers need the parquet files to replay markets. In `--read-from r2` mode the
producer embeds the R2 URL in each job, and workers stream it on demand — a
valid choice for distributed runs. `--read-from local` would require syncing
`data/events/` to every machine, which is impractical across boxes.
`--read-from local-or-download-from-r2-to-local` is the middle ground: each
worker reads its canonical local file if present, else downloads it from R2 to
that path once and reuses it on subsequent runs — so it works across boxes
(per-worker, no central sync) while avoiding re-streaming every run.

## Keeping code in sync

This is handled automatically — full detail in
[Worker Self-Update](/backtest/fleet/self-update). In short:

- Every job carries the producer's commit SHA; a worker runs jobs whose code it
  already has and **pulls + relaunches** when a job needs newer code.
- **Commit and push before launching a backtest.** Uncommitted code never
  reaches workers (the producer blocks a dirty tree), and a commit you forgot to
  push cannot be fetched by remote workers.

A couple of operational conventions still apply:

- Run database schema **migrations manually on the producer** before pushing
  strategy code that needs them. Workers never run `db:migrate`.
- Avoid shipping **engine** changes (`runSingleMarket` semantics, plugin
  behavior) during an active batch — finish the run first so results stay
  consistent across markets.

## Scaling beyond ~30k-market batches

The aggregate worker calls `job.getChildrenValues()`, which loads every child's
`MarketStats` into memory at once. At ~12 KB per market that is comfortable up
to roughly 30k markets per batch (a few hundred MB).

Beyond that, the right move is to **persist each market to a dedicated table** as
it finishes and have the aggregator query the table back. That is a separate
change (schema migration + per-row insert in the market processor), worth doing
only once you actually hit the ceiling.

## Trust model

This is a **trusted-friends** model: a malicious worker could return bogus
`marketStats` and silently contaminate a batch. The current mitigation is
social, not technical. A future option is spot-rerun verification — the producer
re-runs a random 1–5% of children locally and diffs the results — but that
doubles cost on the verified slice and is overkill for a small, trusted team.

## See also

- [Worker Self-Update](/backtest/fleet/self-update) — how workers stay on the right code
- [Parallelization (BullMQ)](/backtest/parallelization) — the local worker pool and dashboard
- [Running Backtests](/backtest/running-backtests) — flags, env, execution modes
