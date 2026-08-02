# dashboard/

Next.js 15 (App Router) dashboard for the backtest pipeline. Reads MySQL +
Redis directly — there is no API layer in the bot to maintain.

## Prerequisites

- Node 20
- MySQL reachable with `DATABASE_*` env vars from the bot's root `.env`
- Redis reachable at `REDIS_URL`

The bot's root `.env` is auto-loaded by `next.config.ts`, so no separate
config is needed for local dev.

## Run

```bash
# from repo root
npm run dashboard            # next dev on 0.0.0.0:3051 (override: DASHBOARD_PORT=3055 npm run dashboard)
npm run dashboard:build
npm run dashboard:start      # next start on :3051
npm run dashboard:typecheck

# Bull Board (raw queue inspector) runs as a separate proc:
npm run bull-board           # http://127.0.0.1:3052/admin/queues (override: BULL_BOARD_PORT)
```

If `npm run dashboard` does not start on Windows because the port argument is
not parsed correctly, run the Next.js dev server directly:

```bash
cd dashboard
npx next dev --hostname 0.0.0.0 --port 3051
```

For remote dev access over Tailscale/LAN, allow the browser origin that will
open the dashboard:

```bash
DASHBOARD_ALLOWED_DEV_ORIGINS=100.100.49.80 npm run dashboard
```

## Layout

```
dashboard/
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # nav + providers
│   │   ├── page.tsx                   # Fleet
│   │   ├── batches/[batchUid]/page.tsx
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── workers/route.ts
│   │       ├── queues/route.ts
│   │       └── batches/
│   │           ├── active/route.ts
│   │           ├── history/route.ts
│   │           └── [batchUid]/route.ts
│   ├── components/                    # client components, plain Tailwind
│   └── lib/
│       ├── db.ts                      # singleton drizzle client
│       ├── redis.ts                   # singleton ioredis (for SCAN/HGETALL)
│       ├── queue.ts                   # bullmq queue singletons
│       ├── schema.ts                  # mirror of backtest result tables
│       └── queries/                   # workers / queues / batches
├── next.config.ts
└── package.json
```

## Adding a page

1. Create `src/app/<route>/page.tsx` (server component).
2. If you need polling, drop a client component into `src/components/` that
   calls a route handler with `useQuery({ refetchInterval: N })`.
3. Add a route handler in `src/app/api/<route>/route.ts` that calls a
   function in `src/lib/queries/`.

## Schema drift

`src/lib/schema.ts` mirrors `polymarket-bot/src/db/schema.ts` for the
backtest result tables. If the source schema changes, mirror the relevant
columns here. Read-only; the dashboard never writes.
