# Dashboard Migration — Fastify → Next.js

## Goal

Replace the Fastify-served dashboard (`src/cli/dashboard.ts` + `src/backtest/dashboardRoutes.ts`, ~810 LOC) with a standalone Next.js 15 (App Router) application living in `dashboard/`.

Migration target: **1:1 feature parity first**, then enhance.

---

## Stack (decided)

- **Location**: `dashboard/` at repo root (sibling to `webui/`)
- **Framework**: Next.js 15 (App Router, RSC), TypeScript
- **Styling**: Tailwind CSS
- **UI kit**: shadcn/ui + TanStack Table (virtualized, for 100k+ rows)
- **Charts**: Recharts via shadcn chart components
- **Data**: Drizzle (shared schema from `src/db/schema.ts` via tsconfig path alias `@bot/*`) + ioredis (shared with bot)
- **Refresh**: TanStack Query polling Route Handlers (replaces HTMX `every Ns`)
- **Port**: 3001 (replaces Fastify at cut-over; runs on 3002 only during dev/parity-check window)

### Decisions locked in

| Topic               | Choice                                                      |
| ------------------- | ----------------------------------------------------------- |
| Port                | 3001 (3002 only during parallel-run verify)                 |
| Schema sharing      | tsconfig path alias `@bot/*` → `../src/*`                   |
| Polling             | TanStack Query (`refetchInterval`)                          |
| Bull Board          | Standalone Fastify proc on port 3003 (`npm run bull-board`) |
| `npm run dashboard` | Boots only Next.js dev server                               |

---

## Frontend approach — selective use of `frontend-design` skill

Not a blanket "build everything with the skill" — it's tuned for distinctive marketing-grade UI and can drift from shadcn's data-dense conventions. Use it where polish matters, plain shadcn where dense data wins.

| Part                                                       | Built with                              |
| ---------------------------------------------------------- | --------------------------------------- |
| App shell, navigation, layout, page structure              | `frontend-design` skill (once at start) |
| Stat cards / hero metrics on Overview                      | `frontend-design` skill                 |
| Empty states, error states, loading skeletons              | `frontend-design` skill                 |
| Progress bar, status pills, sparklines in tables           | `frontend-design` skill                 |
| **All data tables (workers, batches, trades, per-market)** | **shadcn + TanStack Table — no skill**  |
| Forms, filters, dropdowns                                  | shadcn primitives                       |
| Charts                                                     | Recharts + shadcn chart wrappers        |

**Rationale:** the dashboard is an internal data tool. 100k-row tables need virtualization and tight rows, not creative tretman. Apply design polish at the chrome and entry-point views; keep deep data screens utilitarian and uniform.

**Workflow:** invoke `/frontend-design` first to produce the layout + Overview cards/empty-states/skeletons. Then continue with plain shadcn for the tables and detail page. Re-invoke skill only if a new "showpiece" view appears (e.g., strategy comparison hero).

---

## What stays on Fastify

- **Bull Board** (`/admin/queues`) — integrates as Fastify/Express plugin. Easiest path: keep a tiny Fastify proc on its own port serving _only_ `/admin/queues`. Dashboard navbar links out to it. ~50 LOC of bootstrap.

Everything else moves.

---

## File-by-file mapping

### Bootstrap

| Fastify (today)                                       | Next.js                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [src/cli/dashboard.ts](src/cli/dashboard.ts) (64 LOC) | `dashboard/package.json` scripts (`next dev`, `next start`) — no custom bootstrap needed |

### Shared query layer (extract from `dashboardRoutes.ts`)

The HTML-string rendering goes away; the **data functions** are reusable. Move these to `dashboard/lib/queries/`:

| Source (current)                              | Target                             | LOC |
| --------------------------------------------- | ---------------------------------- | --- |
| `listWorkers()` lines 50–115                  | `dashboard/lib/queries/workers.ts` | ~65 |
| `queueCounts()` lines 117–128                 | `dashboard/lib/queries/queues.ts`  | ~12 |
| `countActiveChildrenForBatch()` lines 149–158 | `dashboard/lib/queries/batches.ts` | ~10 |
| `listActiveBatches()` lines 160–197           | `dashboard/lib/queries/batches.ts` | ~38 |
| `listHistoricalBatches()` lines 199–214       | `dashboard/lib/queries/batches.ts` | ~16 |
| `getBatchDetail()` lines 216–221              | `dashboard/lib/queries/batches.ts` | ~6  |

Plus shared types (`WorkerStats`, `ActiveBatchSummary`) move alongside.

### Routes (JSON API) → Next Route Handlers

These stay 1:1 for any external scripts that already curl them.

| Fastify route                               | Next Route Handler                              |
| ------------------------------------------- | ----------------------------------------------- |
| `GET /api/health` line 224                  | `dashboard/app/api/health/route.ts`             |
| `GET /api/workers` line 229                 | `dashboard/app/api/workers/route.ts`            |
| `GET /api/queues` line 241                  | `dashboard/app/api/queues/route.ts`             |
| `GET /api/batches/active` line 243          | `dashboard/app/api/batches/active/route.ts`     |
| `GET /api/batches/history?limit=N` line 248 | `dashboard/app/api/batches/history/route.ts`    |
| `GET /api/batches/:batchUid` line 254       | `dashboard/app/api/batches/[batchUid]/route.ts` |

### HTML pages → App Router pages

| Fastify (HTMX page + partials)                                                                                                                     | Next.js                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /` line 288 (shell) + `/partials/queues` line 338 + `/partials/workers` line 370 + `/partials/active` line 400 + `/partials/history` line 443 | `dashboard/app/page.tsx` — one server component composing four client components (`<QueueCounts />`, `<WorkersTable />`, `<ActiveBatches />`, `<RecentBatches />`), each polling its own Route Handler via SWR |
| `GET /batches/:batchUid` line 485 (shell) + `/partials/batch/:batchUid` line 501                                                                   | `dashboard/app/batches/[batchUid]/page.tsx` — server component for initial render, client subcomponent for 3s polling when active                                                                              |

### Throwaway code (delete after parity)

- `esc()` line 16 — JSX escapes automatically
- `PAGE_HEAD()` line 668 — replaced by `app/layout.tsx` + Tailwind
- `renderProgressBar()` line 701 — becomes `<ProgressBar />` shadcn-flavored component
- `renderChunkedSegments()` line 721 — becomes `<ChunkedSegmentsTable />` (TanStack Table)
- All inline `<style>` blocks — Tailwind classes

---

## Component breakdown (new code)

```
dashboard/
├── app/
│   ├── layout.tsx                       # nav + global styles
│   ├── page.tsx                         # Overview (SSR shell, CSR sections)
│   ├── batches/[batchUid]/page.tsx      # Batch detail
│   └── api/
│       ├── health/route.ts
│       ├── workers/route.ts
│       ├── queues/route.ts
│       └── batches/
│           ├── active/route.ts
│           ├── history/route.ts
│           └── [batchUid]/route.ts
├── components/
│   ├── QueueCountsCards.tsx             # 6 stat cards, polls /api/queues every 3s
│   ├── WorkersTable.tsx                 # TanStack Table, polls /api/workers every 3s
│   ├── ActiveBatchesTable.tsx           # polls /api/batches/active every 3s
│   ├── RecentBatchesTable.tsx           # polls /api/batches/history every 10s
│   ├── BatchDetailActive.tsx            # polls /api/batches/[uid] every 3s when active
│   ├── BatchDetailCompleted.tsx         # static render from DB row
│   ├── ProgressBar.tsx
│   └── ui/                              # shadcn primitives
├── lib/
│   ├── db.ts                            # Drizzle client (singleton via globalThis)
│   ├── redis.ts                         # ioredis (singleton via globalThis)
│   ├── queries/
│   │   ├── workers.ts
│   │   ├── queues.ts
│   │   └── batches.ts
│   └── jobIds.ts                        # re-export aggregateJobId or import from src/
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json                        # paths: "@bot/*": ["../src/*"]
└── README.md
```

---

## Schema sharing — pick one

| Option                                          | Pro                         | Con                                              | Recommend            |
| ----------------------------------------------- | --------------------------- | ------------------------------------------------ | -------------------- |
| **npm workspaces** (root + dashboard/ + webui/) | clean imports, dedupes deps | small refactor of root `package.json`            | ✅                   |
| **tsconfig paths `@bot/*`**                     | no package.json changes     | TS-only, doesn't help bundler resolve at runtime | OK for read-only RSC |
| **copy schema**                                 | zero setup                  | drift inevitable                                 | ❌                   |

Recommendation: **tsconfig path alias** to start (simpler), promote to workspace later if `dashboard/` grows imports beyond schema.

---

## Refresh strategy

Replace HTMX `hx-trigger="load, every 3s"` with client-side polling. Two reasonable choices:

| Approach           | Notes                                                 |
| ------------------ | ----------------------------------------------------- |
| **SWR**            | tiny, dead-simple, built-in `refreshInterval`         |
| **TanStack Query** | already paired with TanStack Table — fewer deps total |

Recommendation: **TanStack Query** since TanStack Table is already in the stack.

Server components do **initial SSR** for SEO-irrelevant pages just to avoid loading flicker; client components own the polling loop.

---

## Migration order (suggested execution)

1. **Scaffold** `dashboard/` — `pnpm create next-app`, Tailwind + shadcn init, tsconfig `@bot/*` alias, Drizzle + ioredis singletons, prove `/api/health` works on 3002 (1h)
2. **Extract queries** — move 6 functions from `dashboardRoutes.ts` to `dashboard/lib/queries/`, no behavior change (2h)
3. **Route handlers** — port 6 JSON endpoints (1h, mostly mechanical)
4. **`/frontend-design` pass** — produce app shell, navigation, layout, Overview stat cards, empty/error/loading states. One invocation, get shared design language locked in (1.5h)
5. **Overview page wiring** — `app/page.tsx` + 4 client components (`QueueCounts`, `WorkersTable`, `ActiveBatches`, `RecentBatches`) with TanStack Query polling (2.5h)
6. **Batch detail page** — `app/batches/[batchUid]/page.tsx` + active/completed subcomponents, ProgressBar, ChunkedSegments table (2h)
7. **Bull Board mini proc** — extract Bull Board mount into standalone `src/cli/bull-board.ts` (~50 LOC Fastify), port 3003, add `npm run bull-board` script (1h)
8. **Parallel-run verify** — both dashboards up (Fastify on 3001, Next on 3002), click through every view, compare numbers/states (1h)
9. **Cut-over commit** — see Cleanup section below (1.5h)

**Total: ~13.5h focused, call it ~2 days with breaks and design iteration.**

---

## Cleanup (part of cut-over commit, step 9)

### Files to delete

- [src/cli/dashboard.ts](src/cli/dashboard.ts) — Fastify bootstrap, fully replaced
- [src/backtest/dashboardRoutes.ts](src/backtest/dashboardRoutes.ts) — query logic moved to `dashboard/lib/queries/`, HTML rendering is gone

### Files to **not** delete (audit first)

Before deleting, grep for any other importers:

```bash
grep -rn "from.*dashboardRoutes\|registerDashboardRoutes" src/
grep -rn "from.*cli/dashboard" src/
```

Anything that imports `registerDashboardRoutes` outside of `src/cli/dashboard.ts` blocks the delete — port it first.

### Repo-root ad-hoc scripts (audit, don't auto-delete)

Untracked at repo root per current `git status`:

- `check-slug.ts`
- `inspect-all.mjs`, `inspect-all2.mjs`, `inspect-batch.mjs`, `inspect-coverage.mjs`, `inspect-emit.mjs`

These are not part of the dashboard migration. Surface them to the user during cut-over — either move under `scripts/` or `do-not-commit/`, or delete if they're stale debugging leftovers. **Do not silently include in this PR.**

### `package.json` changes

Remove (only if no other importers):

- `fastify` dependency
- `@bull-board/fastify` stays (used by new bull-board proc)
- `@bull-board/api` stays

Scripts:

- **Remove**: `"backtest:dashboard": "tsx src/cli/dashboard.ts"`
- **Add**: `"dashboard": "cd dashboard && npm run dev"` (or `next dev -p 3001`)
- **Add**: `"dashboard:build": "cd dashboard && npm run build"`
- **Add**: `"dashboard:start": "cd dashboard && npm run start"`
- **Add**: `"bull-board": "tsx src/cli/bull-board.ts"`

### `dashboard/` is its own npm project

- Add `dashboard/` to root `.gitignore` patterns for `node_modules`, `.next` (or rely on existing globs)
- `dashboard/package.json` owns Next, React 19, Tailwind, shadcn deps, TanStack Query, TanStack Table, Recharts, ioredis, drizzle-orm — independent versioning from root
- Root `tsconfig.json` should `exclude: ["dashboard"]` so root typecheck doesn't compile it
- Root ESLint should ignore `dashboard/` (it has its own Next eslint config)

### CI (`.github/workflows/quality.yml`)

Audit and update — current workflow runs Prettier + Typecheck + ESLint + WebUI + Docs build. After migration it should also:

- Run `dashboard/` typecheck and build in a separate job
- Stop expecting the Fastify dashboard to be reachable in any e2e step (if any)

---

## docs updates

Files that currently mention the dashboard or `backtest:dashboard` script (grepped):

- [docs/docs-inventory.md](docs/docs-inventory.md)
- [docs/live-trading/live-trading-bot.md](docs/live-trading/live-trading-bot.md)
- [docs/.vitepress/dist/](docs/.vitepress/dist/) — **regenerated by build, don't edit by hand**

### Required edits

1. **`docs/docs-inventory.md`** — update dashboard description to point at new `dashboard/` package and the `npm run dashboard` command. Add note about `npm run bull-board` as separate proc.
2. **`docs/live-trading/live-trading-bot.md`** — if it references the old `backtest:dashboard` script or `/admin/queues` path served by the same proc, update to the new split (dashboard on 3001, Bull Board on 3003).
3. **New page**: `docs/backtest/dashboard.md` — overview of the Next.js dashboard, how to run, how to extend (adding a new page, where queries live, how polling works). Link from the backtest sidebar.
4. **`docs/.vitepress/config.ts`** — register the new page in the sidebar.

### Root `CLAUDE.md` updates

The Commands section in `CLAUDE.md` does not currently mention `backtest:dashboard` but does describe the queue runner. Add a short subsection:

```bash
# Dashboard (Next.js, reads from MySQL + Redis)
npm run dashboard                       # next dev on :3001
npm run dashboard:build && npm run dashboard:start  # production
npm run bull-board                      # Bull Board UI on :3003 (separate proc)
```

Also add a one-liner under "Key source directories":

- `dashboard/` — Next.js 15 App Router dashboard for backtest results and live queue/worker status

### `README.md` / `queue/README.md` / `webui/README.md`

Grep these too at cut-over time — if any mentions "dashboard at 3001 / Fastify / HTMX", update.

### `dashboard/README.md` (new file)

Standard package readme: what it is, prerequisites (DB + Redis running), `npm install`, `npm run dev`, env vars it expects (likely `DATABASE_*` and `REDIS_*` from root `.env`), how to add a new page, where queries live.

---

## Open decisions before kickoff

All resolved — see "Decisions locked in" table above.

---

## Out of scope for this migration (future enhancements)

These were the _reason_ you're moving, but not part of parity:

- Strategy comparison view (multi-batch overlay)
- Filterable/sortable trade-level drilldown
- Charts (PnL curves, win-rate over time) via Recharts
- Saved searches / favorited batches
- Per-strategy aggregates across batches

Track these as separate plans after parity ships.
