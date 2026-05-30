# Distributed Workers (future)

The [Parallelization](./parallelization) page covers the **local** BullMQ
worker pool that PR2 added. This page describes how the same architecture
extends to **multiple machines** — your home PC, your laptop, a sibling
machine, a small cloud server — without changing any application code. Only
`.env` values change.

::: warning Status
This page is forward-looking. The current PR2 code already supports remote
workers (the `--queues=markets` flag exists, jobs are self-contained, no
worker needs MySQL access). What's deferred to a later PR is the
self-update mechanism (workers pulling new commits on push) and the pm2
ecosystem config. Treat this page as a roadmap.
:::

## Architecture sketch

```
[~€7/mes Hetzner CX33 droplet]
└── Redis (auth + TLS or Tailscale)
└── (optional) telonex sync cron, redeem-watcher

[Your Mac — producer + aggregator + worker]
├── npm run backtest -- ...
├── npm run backtest:worker -- --queues=markets,aggregate
└── npm run backtest:dashboard

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

## What's still missing for "press the button and let brat help"

PR4 will add the safety net:

- **commitSha matching** — every job already carries the producer's git SHA;
  the worker compares it with its own checkout before processing and
  self-updates if they differ (`git pull && npm install && pm2 restart`).
- **pm2 ecosystem config** — `ecosystem.config.cjs` so siblings can
  `pm2 start ecosystem.config.cjs && pm2 startup && pm2 save` once.
- **Polling fallback** — workers poll `origin/main` every 5 minutes so they
  pick up commits even when no batch is running.
- **Git lock** — guards against concurrent self-updates on the same box.
- **Parquet LRU/TTL cache** — bounds disk usage on sibling machines that
  download from R2.

Conventions documented alongside PR4:

- DB schema migrations run **manually** on the producer (your Mac) before
  pushing strategy code that needs them. Workers never run `db:migrate`.
- Engine changes (`runSingleMarket` semantics, plugin behavior) should not
  ship during an active batch — finish the run first.
- Siblings keep a clean checkout; experimental code lives in a separate
  clone so the worker's `git reset --hard origin/main` is safe.

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
