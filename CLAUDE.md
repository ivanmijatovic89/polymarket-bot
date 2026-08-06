# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

All output must be in **English** — this includes PR titles and bodies, commit messages, code comments, and any generated text. Never use any other language in written artifacts, regardless of the language the user writes in.

## Environment

- Node.js **v20** (pinned via `engines`: `>=20 <21`)
- TypeScript, ES modules (`"type": "module"`). Run scripts with `tsx`.
- Plain Node + small helper modules — no NestJS / no framework
- MySQL via Drizzle ORM
- Prefer the Context7 MCP (`resolve-library-id`, `query-docs`) automatically when you need library/API docs, setup steps, or code generation — do not rely on training-data recall for third-party libs
- No test suite is configured (`npm test` exits with an error)

## Commands

```bash
# Live trading (dry-run by default — DRY_RUN=false enables real orders)
npm run trade:bot                      # uses TRADING_SYMBOL env
npm run trade:bot:btc                  # BTC/ETH/SOL/XRP shortcuts also exist
tsx src/cli/trading-bot.ts --strategy <id> [--param key=value ...]
tsx src/cli/trading-bot.ts --strategy-artifact <sha256> [--param key=value ...]   # external artifact

# External strategy artifacts (strategy source in an EXTERNAL repo; see
# docs/strategy/external-artifacts.md). Publish bundles + uploads once
# (idempotent, sha256 = identity); backtest/trade select with
# --strategy-artifact <sha> (mutually exclusive with --strategy).
npm run strategy:check   -- --repo /path/to/external-repo     # typecheck+lint with this repo's toolchain
npm run backtest -- --strategy-file /path/to/repo/strategies/my.v1.ts --input-mode telonex-delta --read-from local --symbol btc --limit 20   # auto-publishes
npm run strategy:publish -- --repo /path/to/external-repo --entrypoint strategies/my-strat.v1.ts   # explicit pre-publish (rarely needed)
npm run backtest -- --strategy-artifact <sha256> --input-mode telonex-delta --read-from local --symbol btc --limit 20   # exact sha reproduction
npm run artifacts:test                 # artifact bundler/loader/selection test suite

# Backtesting — replays Parquet with same strategy code as live
# Recorded mode (default; reads `markets` table + WS-recorded parquet)
npm run backtest -- --strategy <id> --param key=value "data/events/btc/<slug>.parquet"
npm run backtest -- --strategy <id> --symbol btc --limit 100 --random   # pull from DB
npm run backtest -- --strategy <id> --slug <slug1>,<slug2>              # specific slugs
# Useful flags: --latest, --dir <folder>, --order recorded|exchange_time, --time-driven
# Without --limit, DB-driven selection runs the FULL eligible universe (no silent 1000-row cap)

# Telonex mode (reads `telonex_markets` ⋈ `telonex_market_conversions`; requires --read-from)
npm run backtest -- --strategy <id> --input-mode telonex-delta --read-from local --symbol btc --timeframe 15m --limit 50
npm run backtest -- --strategy <id> --input-mode telonex-delta --read-from r2 --slug btc-updown-15m-1760140800
npm run backtest -- --strategy <id> --input-mode telonex-paired --read-from local --slug <slug>
npm run backtest:telonex:btc:15m -- --strategy <id> --limit 20   # shortcut
# --input-mode picks both the replayer AND the DB source:
#   recorded         → `markets` table, WS replay
#   telonex-delta    → telonex_markets ⋈ delta-typed conversion
#   telonex-paired   → telonex_markets ⋈ paired conversion
# --read-from local|r2|local-or-download-from-r2-to-local is required for telonex modes:
#   local        → telonex_market_conversions.local_path (must already be on disk)
#   r2           → streams r2_url from R2 every run (no local copy)
#   local-or-download-from-r2-to-local  → read local if present, else download r2_url to the canonical
#                  local path once (download-if-missing, per-worker), then read local
# --timeframe defaults to 15m; only valid with --symbol
# Set BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1 when using the TA plugin

# Pre-fetch converted parquet from R2 to its canonical local path, so backtests
# can then run with --read-from local (no per-tick R2 fetch). Uses the SAME
# eligibility as backtest (listEligibleTelonexMarkets, readFrom=r2). Read-only on
# the DB; writes only under data/events/telonex/ (atomic tmp→rename, skip-if-exists).
npm run telonex:download-converted-r2-to-local -- --converter delta-typed --symbol btc --timeframe 15m
npm run telonex:download-converted-r2-to-local -- --converter delta-typed --slug <slug1>,<slug2>
# --concurrency N forks N worker processes (parent coordinates, pull-based, no
# overlap, re-queues on child crash). Prints a pre-flight: r2 eligible / on local
# / to download. Flags: --symbol, --timeframe, --slug, --limit, --latest (needs
# --limit), --force (re-download), --dry-run (preflight only). See
# docs/datasets/telonex/download-converted-r2-to-local.md.

# Extend an existing telonex run with more markets (single backtest_runs row grows;
# strategy/params/symbol/timeframe/converter/readFrom inherited from parent)
npm run backtest -- --extend <runId>                          # all missing, oldest-first
npm run backtest -- --extend <runId> --limit 500              # 500 oldest missing
npm run backtest -- --extend <runId> --from-ms X --to-ms Y    # missing in window
npm run backtest -- --extend <runId> --latest --limit 200     # 200 newest missing
# Extension recomputes backtest_run_segments over UNION of existing + new
# markets in one DB transaction. batch_uid / submission_uid stay unchanged. Forbidden with
# --extend: --strategy, --param, --symbol, --timeframe, --input-mode, --read-from,
# --slug, --dir, --batchUid, --baselineId, positional file paths.

# Dataset sync — one command per machine role (scope is explicit; no default market)
npm run data:sync:main -- --market btc:15m [--fanout 6] [--dry-run] [--plan]
npm run data:sync:worker -- --market btc:15m
# main:   catalog → priceToBeat backfill → raw download → convert (local+R2) →
#         binance/crypto_prices download+upload → converted-pull (reconciles the
#         local set with conversions made by fanned-out workers)
# worker: converted parquet + binance + crypto_prices, R2 → local
# See docs/datasets/sync.md.

# Fleet (ansible; hosts in ops/ansible/inventory.ini, [producer] + [backtest_workers])
npm run fleet:status                    # inventory: git, sessions, cores, disk, datasets
npm run fleet:git:pull [-- --branch X] # pull code (+switch branch), deps, drain+restart — ~4-7s
npm run fleet:update                    # same, verbose per-step pre-flight — ~50s
npm run fleet:data:sync -- btc:15m      # run data:sync:worker everywhere ('-e data_sync_extra=--dry-run' = verdict)
npm run fleet:start | fleet:stop        # ensure workers running / drain them
npm run fleet:runtime:status | fleet:runtime:start | fleet:runtime:stop   # Global Runtime daemons (hosts with global_runtime_enabled=true)
# No command changes a machine's branch unless asked: fleet:update / fleet:start
# take `--branch <name>`, all three take `--branch <name>`.
# See docs/backtest/fleet/overview.md for the full command cheat sheet.

# Backtest worker (self-updating wrapper; --market-concurrency defaults to this
# machine's cores_for_backtest in dashboard/src/data/machines.json, else cores-2)
npm run worker:markets | worker:aggregate | worker:markets-and-aggregate

# Record live WS → Parquet
npm run record:live:btc                # or :eth :sol :xrp

# Parquet utilities
npm run verify:parquet -- <file.parquet>
npm run list:backtest-files -- --symbol btc
npm run scan:disconnect-events -- <dir> [--delete-files-where-disconnects-equal-or-greater=N]

# pte — global CLI (scripts/pte, symlinked into PATH; docs/reference/pte-cli.md).
# Runs any engine command with cwd = this repo from ANY directory — the way
# external protocol workspaces (polymarket-protocols/) invoke the engine.
#   pte backtest --strategy-file strategies/my.v1.ts --symbol btc --limit 20
#   pte strategy:check -- --repo "$PWD"

# Lint / format (no test runner)
npm run lint ; npm run lint:fix
npm run format ; npm run format:check

# Git workflow (branch protection on main)
# Direct push to main is blocked. Always:
#   1. Create a branch: git checkout -b <branch-name>
#   2. Push branch: git push -u origin <branch-name>
#   3. Open PR: gh pr create ...
#   4. Wait for CI (quality.yml: Prettier + Typecheck + ESLint + WebUI + Docs build)
#   5. Merge PR once all checks pass
# EXCEPTION: strategy-research sessions (working on src/strategies/research/
# families) commit and push directly to main, per the branch policy in
# strategy-research-protocol/AGENTS.md — remote backtest workers track origin/main.
# EXCEPTION: protocol workspaces (protocols/<name>/) commit and push directly to
# main with a "<name>: ..." prefix — see protocols/README.md. Shared src/
# changes from a protocol still go through a normal PR.

# Database (Drizzle + MySQL)
npm run db:generate                    # emit migration SQL into drizzle/
npm run db:migrate                     # apply migrations
npm run db:push                        # dev-only schema sync
npm run db:studio
npm run db:insert-parquet              # seed markets table from existing parquet filenames

# Relayer / SAFE + on-chain helpers
npm run relayer:deploy-safe | show-safe | approve | deposit-usdc | withdraw-usdc
npm run eoa:approve-ctf | eoa:approve
npm run check:balances
npm run clob:api-key -- 0xYOUR_PRIVATE_KEY
npm run redeem-watcher                 # background scanner; :relayer / :direct variants

# Research / reporting (direct tsx invocations)
npx tsx src/cli/pnl-report.ts [--symbol btc] [--limit 5000] [--json]
npm run export:trade-features -- --id <backtestId> --split 0.7
npm run rebuild:chunked-batch-stats    # re-derive stats for backtests with null

# Web UI (separate Vite package under webui/)
npm run webui:dev ; npm run webui:build

# Backtest dashboard (separate Next.js package under dashboard/, reads MySQL + Redis)
npm run dashboard                       # next dev on :3051 (3001 is the live WebUI)
npm run dashboard:build && npm run dashboard:start   # production
npm run bull-board                      # Bull Board UI on :3052 (separate proc)

```

## Architecture

**Core invariant**: live trading and backtesting run the *exact same* strategy logic over the *exact same* tick stream. Parquet captures raw WS events; backtest replays them deterministically via the shared `MarketEngine`.

### Three operating modes

| Mode | Entry | Data source |
|------|-------|-------------|
| Live trading | `src/cli/trading-bot.ts` | Polymarket market WS + user WS / REST poll |
| Backtest | `src/cli/backtest.ts` | Parquet files (by path, `--symbol`, `--slug`, or `--dir`) |
| Recording | `src/cli/record-live.ts` | Polymarket market WS → rotating Parquet |

### Data flow

```
Live WS  |  Parquet replay
        ↓
MarketEngine                                    (shared)
  → decodeMarketChannelMessage
  → MarketOrderBookEngine (per market) → OrderBookEngine (per assetId)
  → emits EngineTick only on `book` + `price_change`
        ↓
StrategyRunner                                  (shared)
  ├─ Strategy.onMarketTick(ctx, snapshot) → Intent[]
  └─ Strategy.onAccountEvent(ctx, event)  → Intent[]   (cascading fills)
  └─ PluginSet                             (tick-scoped, cached per tick)
        ↓
OrderManager  (validates, queues, de-dupes, enforces GTD min expiry, dry-run gate)
        ↓
LiveExecution (clob-client)  |  BacktestExecution (simulator)
        ↓
Portfolio                                       (shared state machine)
        ↑
AccountEvent sources: userWsAccountSource (primary) + restPollAccountSource (fallback)
```

### Key source directories

| Path | Responsibility |
|------|----------------|
| `src/market/` | `MarketEngine`, orderbook engines, market-channel decoder |
| `src/strategy/` | `Strategy` interface, `StrategyRunner` types, `strategyRegistry`, plugins, toolkit |
| `src/strategies/` | Concrete strategy implementations (30+; `split/`, `scalp/`, `signals/`, `templates/`) |
| `src/trading/` | `OrderManager`, `Portfolio`, `StrategyRunner`, `execution/`, `feeds/`, risk/fees/metrics |
| `src/parquet/` | `io/` (writer + schema), `replay/`, `indexer/`, `cli/` utilities |
| `src/polymarket/` | CLOB client, market WS, user WS (`ws/`), Gamma, RTDS, relayer, 15m slug resolution |
| `src/blockchain/` | On-chain helpers: balance/approval checks, balance tracker, ConditionalTokens |
| `src/db/` | Drizzle schema, helpers, seed-from-parquet script |
| `src/backtest/stats/` | `marketStats` + `BatchStats` domain object + `chunkedBatchStats` |
| `src/cli/` | Entry points + `helpers/` (argv parsing, parquet resolution) + `research/` |
| `src/config/env.ts` | Loads `.env` (+ `.env.$BOT_ENV` when set) via dotenv |
| `webui/` | Separate Vite/React package served by each bot process |
| `dashboard/` | Separate Next.js 15 (App Router) package — backtest dashboard reading MySQL + Redis. Mirrors the normalized backtest result schema locally; uses TanStack Query for polling. |
| `protocols/` | Self-contained autonomous protocol workspaces (journals, ops docs, strategies) — see `protocols/README.md`. Each is context for its own sessions only: do NOT read protocol internals in normal dev sessions unless explicitly asked. |

### Strategy system

Strategies live in `src/strategies/` and are **auto-discovered** — any file under `src/strategies/` (any depth) that does `export const definition` is registered automatically by `src/strategy/strategyRegistry.ts`; there is no list to edit. Protocol workspaces are discovered too: `protocols/<name>/strategies/**` registers the same way, but **fail-soft** (broken files are warned about and skipped, never fatal) and ids must start with `<name>-`; check one protocol with `npm run protocol:check -- <name>` (see `protocols/README.md`). **External artifact strategies** (source in an external repo, `--strategy-artifact <sha256>`) bypass the registry entirely: the producer/live bot loads a hash-verified ESM bundle and passes the definition explicitly through the same contract — engine imports stay external via `#pmb/*` (root package.json `imports`), allowlisted to `src/strategy/**`, `src/trading/feeds/**`, `src/market/**` (see `docs/strategy/external-artifacts.md`). Each `definition` has:

- `id` (string) — selected via `--strategy <id>`
- `schema` (Zod) — validates `--param key=value` pairs; unknown keys / invalid values error out
- `create(params)` → `{ strategy, pluginSet? }`

Strategies implement two hooks in `src/strategy/Strategy.ts` returning `Intent[]`:

- `onMarketTick(ctx, snapshot)` — fires only on `book` / `price_change`
- `onAccountEvent(ctx, event)` — fires on fills / order status changes (cascades within a tick)

Intent kinds: `place_limit`, `place_batch`, `cancel_order`, `cancel_all`, `split_positions`, `merge_positions`. Polymarket order types: `FOK | GTC | GTD` (GTD has a minimum expiry enforced by `OrderManager`).

JSON params pass through as strings: `--param assetIds='["a","b"]'`.

### Plugins & external feeds

Plugins (`src/strategy/plugins/`) are optional per-tick computations/data exposed via `ctx.plugins`. `StrategyRunner` caches the tick-scoped snapshot and reuses it for cascading `onAccountEvent`. Existing plugins: `TimeWindowVolatility`, `TechnicalIndicators`, `DwellGate`, `TimeWindowGate`, `DeribitVolatilityIndex`, `ExternalFeeds` (+ request-side).

External feeds are **strategy-driven**: a strategy opts in by registering `ExternalFeedsRequestPlugin` (or via legacy `strategy.requiredFeeds`). Live, `trading-bot.ts` only starts feed clients requested by the selected strategy. Symbols **follow the traded market by default**: `binanceWsSpotPrice: {}` / `rtdsCryptoPrices: {}` derive the pair from `TRADING_SYMBOL` live (and, for the binance feed, from the market slug in backtests); an explicitly configured symbol/list overrides the derivation. In **backtests**, the `binanceWsSpotPrice` sub-feed is fulfilled automatically from historical `data.binance.vision` aggTrades (as-of lookup, measured-latency offset, seeded with the last pre-window trade; missing day files are a hard error — see `docs/datasets/price-feeds/binance/feed.md`). Day files are distributed producer → R2 → workers: `binance:download-aggtrades -- --pair X --sync` (self-healing full-range, daily cron), `binance:upload-aggtrades-r2`, and on each worker `binance:download-aggtrades-r2-to-local`. The `polymarketPriceToBeat` sub-feed is also fulfilled in backtests, from `telonex_markets.price_to_beat` (Gamma `events[].eventMetadata`, backfilled by `telonex:sync-pricetobeat-and-final-price` — run it after `telonex:sync`; key appears ~2.7s after window start by default — the measured live p50 (p90 3.5s, max 5.4s; feeds:parity harness, 2026-07-21), tune via `BACKTEST_PRICE_TO_BEAT_LATENCY_MS`; markets before their series' recording epoch ⇒ absent key; markets settled <30h ago ⇒ absent key with a warning (pipeline-lag grace — Telonex catalogs daily and the backfill waits 3h after settle); post-epoch unbackfilled or inside a verified Polymarket-side hole ⇒ hard error, recoverable via `--refetch-nulls` if the stamp was a transient Gamma glitch; per-series epochs in `docs/datasets/data-coverage.md`). The `rtdsPolymarketCryptoPrices.chainlink` sub-feed is also fulfilled in backtests, from the Telonex `crypto_prices` channel (the Chainlink rounds Polymarket resolves with; coverage from 2026-04-02; **two-clock model** — visibility keys on Polymarket's broadcast time ~1s after the round time plus a measured bot leg (`BACKTEST_RTDS_CHAINLINK_LATENCY_MS`), while the emitted `tsMs` stays the round time; **hard error in EVERY unavailable case incl. pre-coverage markets AND in-window upstream data holes ≥5min** (`BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS`, data-driven; `0` accepts stale replay) — it is the resolution price; dataset commands `telonex:crypto-prices:{download --sync,upload-r2,download-r2-to-local}`; see `docs/datasets/price-feeds/chainlink/feed.md`). The remaining sub-feeds (`rtdsPolymarketCryptoPrices.binance`, `deribitVolatilityIndex`) are still live-only. **Synthetic feed ticks** (opt-in): `binanceWsSpotPrice: { tickOnUpdate: true }` and/or `rtdsCryptoPrices: { tickOnUpdate: true }` give the strategy an extra `onMarketTick` on every Binance aggTrade / Chainlink round (event_type `binance_agg_trade` / `chainlink_round`, unchanged book, re-stamped time), live and replay identically; the execution simulator never runs on synthetic ticks, and plugins skip them unless they declare `handlesSyntheticTicks = true` — see `docs/backtest/adr-binance-driven-ticks.md`.

### Parquet format

Recorded files: `data/events/<symbol>/<slug>.parquet` (override root with `RECORD_BASE_DIR`). One file per 15-minute market window. Filename uses the Gamma slug `<symbol>-updown-15m-<epochStart>`. Writers produce `*.parquet.tmp` and rename to `*.parquet` on close; SIGINT/SIGTERM rename to `*-terminated.parquet`.

Schema (`src/parquet/io/eventSchema.ts`, all GZIP columns):
- `ingest_seq` INT64 — per-market monotonic sequence (assigned locally)
- `ts_local_ms` INT64 — `Date.now()` at ingest
- `ts_exchange_ms` INT64 (optional) — parsed from message `timestamp`
- `event_type` UTF8 — includes synthetic `"disconnect"` rows with `ws_close_code`/`reason` in `raw_json`
- `raw_json` UTF8 — original WS message

Backtest heap-merges multiple files by `ingest_seq` (deterministic multi-asset replay). Orderbook-mode backtests process files sequentially (each file is a 15m episode).

### Execution modes

- **EOA** — signs orders directly with `PRIVATE_KEY`. Requires `CLOB_SIGNATURE_TYPE=0` (default).
- **Relayer / SAFE** — SAFE wallet funds positions, EOA signs. Set `CLOB_FUNDER=<safeAddress>`, `CLOB_SIGNATURE_TYPE=2`, and `POLYMARKET_BUILDER_API_{KEY,SECRET,PASSPHRASE}`. Control per-op mode with `POLYMARKET_TX_MODE_{SPLIT,MERGE,REDEEM}` = `relayer` | `direct`. Trading bot startup aborts if relayer mode is selected but balances/approvals are missing on either wallet.

Backtest latency simulation (intent → exchange-visible):
- `BACKTEST_LATENCY_DELAY` (ms, e.g. `140`) and `BACKTEST_LATENCY_JITTER` (ms symmetric).
- CLI flags `--latency-delay-ms` / `--latency-jitter-ms` override the env vars and land in the recorded `cmd` (auditable); forbidden with `--extend` — extensions inherit the latency recorded in the parent's `cmd` flags, and fall back to the current env with a warning when the parent recorded none.
- Delays apply to `placeLimit`, `placeBatch`, `cancelOrder`, `cancelAll` — so an order can fill before its cancel "arrives".
- Maker fills use a conservative "worst-queue" model (BUY @ P fills only when `bestAsk < P`).

## Critical gotchas

- **Fill-status semantics for sell/merge**: `USER_WS_FILL_AT_STATUS=MATCHED` updates positions fast, but **you must wait for `MINED`** before selling shares you just bought, or merging positions. Buy-both-sides strategies can run on `MATCHED` but any subsequent sell/merge still needs `MINED`.
- **First-order warmup (live only)**: `@polymarket/clob-client` lazily fetches tick-size / fee / negRisk on the first order per token. `LiveExecution.warmupMarket()` is called on trading-bot startup and on each 15m window rotation to pre-cache these. Strategies can gate with `isWarmed(ctx)` from `src/strategy/strategyToolkit.ts`. In backtests `ctx.warmup` is absent and `isWarmed` returns true.
- **Multi-bot env files**: set `BOT_ENV=botA` and the loader reads `.env.botA` **with override**, then `.env` — per-bot file wins over shell env. Useful for running multiple bots with distinct `WEB_UI_PORT`, `BOT_INSTANCE_ID`, keys, etc.
- **`src/index.ts` is a placeholder** — do not add runtime logic there.
- **Maker backtests**: the simulator fills when the book goes *through* the resting level; passive resting fills are not modeled beyond that.
- **`instanceof` on strategy plugins silently fails**: `strategyRegistry` loads strategy files via CJS `createRequire`, so plugin instances carry a different class identity than the same class imported via ESM elsewhere. `p instanceof SomePlugin` across that boundary returns `false` with no error (this once silently disabled live external feeds for the whole SplitSellRedeem family). Detect plugins structurally instead — e.g. `isExternalFeedsRequestPlugin` in `src/strategy/plugins/ExternalFeedsRequestPlugin.ts` (checks `id` + method surface); add a similar guard next to any new plugin class.
- **Symbol selection**: live scripts require `TRADING_SYMBOL` (falls back to `RECORD_SYMBOL`); recorder requires `RECORD_SYMBOL`. Both accept `BTC|ETH|SOL|XRP`.
- **Telonex eligibility — single source of truth**: all queries against `telonex_markets` / `telonex_market_conversions` must go through `src/db/telonexMarkets.ts` (`listEligibleTelonexMarkets`, `listEligibleTelonexSlugs`, `countEligibleTelonexMarkets`). Do NOT write inline SQL against these tables elsewhere — add a function to that module instead. The dashboard (`dashboard/src/lib/queries/`) imports from there.
- **Telonex market time**: use `telonex_markets.market_start_ms` (indexed bigint, derived from slug at sync time). `start_date_us` is NOT the market window start — verified empirically that 100% of 19,223 rows differ from the slug epoch (avg ~22h earlier; likely creation/announcement time). Never order/filter markets by `start_date_us`. `end_date_us` IS the market end and matches `market_start_ms + timeframe_ms` deterministically.
- **Telonex eligibility floor**: env `TELONEX_DATASET_ELIGIBLE_FROM` (ISO 8601 UTC, default `2025-12-01T00:00:00Z`). Loaded via `src/config/telonex.ts` as `TELONEX_DATASET_ELIGIBLE_FROM_MS`. Markets with `market_start_ms` below this are excluded from the eligible universe. Move the env var to ignore older markets without dropping rows.
- **Backtest extension (`--extend <runId>`)**: appends new markets to an existing `backtest_runs` row and recomputes `backtest_run_segments` over the union. The parent's `batch_uid` label and `submission_uid` stay unchanged (the extension flow gets its own internal submission uid in Redis only). `cmd` on the parent row is **NOT** modified — the original launch command stays as the permanent record of how the run was created. `--comment` is therefore rejected with `--extend` (the original launch's comment stays). Concurrent extends on the same run are blocked by the `extending_at` column (set atomically at enqueue, cleared in the merge transaction); a second invocation gets a clear error with a recovery hint. If a process crashes mid-extend, clear manually: `UPDATE backtest_runs SET extending_at = NULL WHERE id = <runId>`. Failed slugs can be retried by a subsequent `--extend`; the failure row is removed on success. Strategy/params/symbol/timeframe/converter/readFrom always inherit from the parent; pass them and you get a clear error.

## Key environment variables

Discovery / WS:
- `TRADING_SYMBOL`, `RECORD_SYMBOL` (BTC|ETH|SOL|XRP)
- `GAMMA_API_BASE_URL` (default `https://gamma-api.polymarket.com`)
- `POLYMARKET_WS_URL` (default `wss://ws-subscriptions-clob.polymarket.com/ws/market`)

Auth / wallet:
- `PRIVATE_KEY` (or `POLYMARKET_PRIVATE_KEY`), `POLYMARKET_API_KEY/SECRET/PASSPHRASE`
- Optional: `CLOB_FUNDER`, `CLOB_SIGNATURE_TYPE`, `CLOB_API_URL`, `CLOB_CHAIN_ID`

Trading-bot behavior:
- `DRY_RUN` (default `true` — safe by default; set `false` for real orders)
- `LOG_TRADES`, `LOG_TO_FILE`, `LOG_LEVEL`
- `ENABLE_WEB_UI`, `WEB_UI_HOST` (keep `127.0.0.1` locally), `WEB_UI_PORT`, `WEB_UI_REFRESH_MS`, `WEB_UI_ORDERBOOK_LEVELS`, `BOT_INSTANCE_ID`
- `USER_WS_FILL_AT_STATUS` (see gotcha above)
- `BOT_ENV` (loads `.env.$BOT_ENV` with override)

Backtest:
- `BACKTEST_LATENCY_DELAY`, `BACKTEST_LATENCY_JITTER`
- `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1` (TA plugin warmup)

Telonex:
- `TELONEX_API_KEY` (required for `telonex:sync`)
- `TELONEX_DATASET_ELIGIBLE_FROM` (ISO 8601 UTC; default `2025-12-01T00:00:00Z`; lower bound for eligible markets)
- `TELONEX_CONVERT_STALE_CLAIM_MINUTES` (default `120`; `in_progress` conversion claims older than this are treated as abandoned and re-claimed — raise it when converting large timeframes whose conversion legitimately runs long)
- `TELONEX_DATASET_MIN_AGE_DAYS` (default `3`; publication-lag guard — markets younger than this are neither cataloged by `telonex:sync` nor eligible, because Telonex/Binance publish their day files ~T+1/T+2; guarantees "eligible ⇒ complete dataset exists")

Database: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `DATABASE_NAME`.

Recorder: `RECORD_BASE_DIR` (default `data/events`), `RECORD_STATS_INTERVAL_MS`, `RECORD_MAX_INFLIGHT_APPENDS`, `RECORD_SKIP_IF_OLDER_MS`.

Relayer: `POLYMARKET_BUILDER_API_*`, `POLYMARKET_RELAYER_URL`, `POLYMARKET_RELAYER_CHAIN_ID`, `POLYMARKET_RELAYER_TX_TYPE`, `POLYMARKET_TX_MODE_SPLIT|MERGE|REDEEM`, `POLYMARKET_EOA_GAS_MULTIPLIER`.

Redeem watcher: `REDEEM_WATCH_INTERVAL_MS`, `REDEEM_LOOKBACK_HOURS`, `REDEEM_MAX_MARKETS_PER_TICK`, `REDEEM_STATE_PATH`.

## Additional docs

`docs/` contains the canonical VitePress documentation site. The `webui/` directory has its own README.

**Writing docs:** use the `docs-writer` skill when creating a NEW page under `docs/` — it enforces the Diátaxis type (tutorial / how-to / reference / explanation), frontmatter, and VitePress conventions. Editing an existing page does not need it. Every new page also needs a sidebar entry in `docs/.vitepress/config.ts`, otherwise it is invisible; run `npm --prefix docs run build` before committing (CI builds the site and fails on dead links).

**Telonex pipeline:** `docs/datasets/telonex/sync-design.md` is the authoritative design for the Telonex dataset ingestion pipeline (`sync-markets` → `download-raw-files` → `convert`). Read it before working on anything under `src/telonex/`. Existing Telonex usage doc: `docs/datasets/telonex/overview.md`.
