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
npm run dashboard            # next dev on 127.0.0.1:3051 (override: DASHBOARD_PORT=3055 npm run dashboard)
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
npx next dev --hostname 127.0.0.1 --port 3051
```

The dashboard binds loopback by default and deliberately stays there: it has
no login of its own, while its Mission Control proxy holds `GLOBAL_RUNTIME_TOKEN`
and can command every Global Runtime daemon in the fleet. Reach it remotely
through `tailscale serve` or an SSH tunnel rather than binding a public
interface. If you do set `DASHBOARD_HOST`, understand that anyone who can
reach the port controls the fleet.

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
│   │   ├── page.tsx                   # Overview
│   │   ├── fleet/page.tsx             # Full Fleet
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

## Backtest filters

The `/backtests` page filters finalized runs by protocol, model, strategy,
symbol, and status. Every dropdown supports typing to find an option, arrow-key
navigation, Enter to select, and Escape to dismiss. Individual filters have a
clear button; Clear filters resets all filters while preserving sorting and
rows per page. Runs without metadata remain visible with the corresponding
filter set to Any.

Protocol narrows the available models; protocol and model narrow strategies.
Changing protocol clears model and strategy, and changing model clears strategy.
Strategy versions use natural ordering (v2 before v10). Filter options come from
recorded run metadata across all pages.

Use **Filter by value** to choose Markets total, Markets played, EV / played,
EV / total, or PnL, then `>` or `<` and a number. Press **Add condition** or Enter;
click an active condition to remove it. Conditions combine with AND, so
`Markets total > 150` and `PnL < 100` must both match. Negative and decimal values
are supported. Comparisons are strict and use stored precision before display
rounding. Markets total matches the displayed total, including selected markets
that were not persisted. Clear filters also removes all numeric conditions.

Pagination shows the matching count, Previous/Next, and page numbers above and
below the table. Choose 25, 50, 100, 200, or 500 rows per page. Sorting supports
creation time, Markets total, PnL, EV per played/total market, and win rate in either direction.
Filtering and sorting apply in the database before pagination, with run ID as a
stable tiebreaker. Invalid page numbers are clamped to the available range.

Filters, sort, page size, and page are saved in the URL and browser history.
Changing a filter, sort, or page size returns to page 1. Navigating pages carries
the highest run ID seen as a `snapshot` parameter, so newly completed runs do
not shift the pages being browsed. Refresh results returns to page 1 and includes
new runs. Existing run statistics can still change if a run is extended.

`GET /api/batches/history` accepts these URL parameters and returns `batches`,
`total`, `page`, `pageCount`, `limit`, and `snapshot`. Overview and Fleet retain
their compact recent-run tables without pagination controls.

## Adding a page

1. Create `src/app/<route>/page.tsx` (server component).
2. If you need polling, drop a client component into `src/components/` that
   calls a route handler with `useQuery({ refetchInterval: N })`.
3. Add a route handler in `src/app/api/<route>/route.ts` that calls a
   function in `src/lib/queries/`.

The live Fleet endpoints (`/api/workers`, `/api/queues`, and
`/api/batches/active`) use a two-second process-local cache. This keeps the
three-second UI polling responsive while coalescing reads from the Fleet page,
navigation badge, Health page, SwiftBar, and future overview widgets. Identical
React Query keys also let in-dashboard consumers share their browser-side
result.

## Schema drift

`src/lib/schema.ts` mirrors `polymarket-bot/src/db/schema.ts` for the
backtest result tables. If the source schema changes, mirror the relevant
columns here. Read-only; the dashboard never writes.
