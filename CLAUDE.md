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

# Backtesting — replays Parquet with same strategy code as live
npm run backtest -- --strategy <id> --param key=value "data/events/btc/<slug>.parquet"
npm run backtest -- --strategy <id> --symbol btc --limit 100 --random   # pull from DB
npm run backtest -- --strategy <id> --slug <slug1>,<slug2>              # specific slugs
# Useful flags: --latest, --dir <folder>, --order recorded|exchange_time, --time-driven
# Set BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1 when using the TA plugin

# Record live WS → Parquet
npm run record:live:btc                # or :eth :sol :xrp

# Parquet utilities
npm run verify:parquet -- <file.parquet>
npm run list:backtest-files -- --symbol btc
npm run scan:disconnect-events -- <dir> [--delete-files-where-disconnects-equal-or-greater=N]

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

# Parallel backtest queue (folder-watched runner)
./queue/run-queue.sh --jobs 8 [--save-results]
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
| `src/backtest/stats/` | `marketStats` + `batchStats` + `chunkedBatchStats` (written to DB per run) |
| `src/cli/` | Entry points + `helpers/` (argv parsing, parquet resolution) + `research/` |
| `src/config/env.ts` | Loads `.env` (+ `.env.$BOT_ENV` when set) via dotenv |
| `webui/` | Separate Vite/React package served by each bot process |
| `queue/` | Folder-watched GNU-parallel runner (`approve → pending → running → done|failed`) |

### Strategy system

Strategies live in `src/strategies/` and must be registered in `src/strategy/strategyRegistry.ts`. Each exports a `definition` with:

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

External feeds are **live-only** (not in backtests) and opt-in via `strategy.requiredFeeds`. `trading-bot.ts` only starts feed clients requested by the selected strategy. Available under `ctx.plugins.externalFeeds`: `rtdsPolymarketCryptoPrices`, `binanceWsSpotPrice`, `polymarketPriceToBeat`, `deribitVolatilityIndex`.

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
- Delays apply to `placeLimit`, `placeBatch`, `cancelOrder`, `cancelAll` — so an order can fill before its cancel "arrives".
- Maker fills use a conservative "worst-queue" model (BUY @ P fills only when `bestAsk < P`).

## Critical gotchas

- **Fill-status semantics for sell/merge**: `USER_WS_FILL_AT_STATUS=MATCHED` updates positions fast, but **you must wait for `MINED`** before selling shares you just bought, or merging positions. Buy-both-sides strategies can run on `MATCHED` but any subsequent sell/merge still needs `MINED`.
- **First-order warmup (live only)**: `@polymarket/clob-client` lazily fetches tick-size / fee / negRisk on the first order per token. `LiveExecution.warmupMarket()` is called on trading-bot startup and on each 15m window rotation to pre-cache these. Strategies can gate with `isWarmed(ctx)` from `src/strategy/strategyToolkit.ts`. In backtests `ctx.warmup` is absent and `isWarmed` returns true.
- **Multi-bot env files**: set `BOT_ENV=botA` and the loader reads `.env.botA` **with override**, then `.env` — per-bot file wins over shell env. Useful for running multiple bots with distinct `WEB_UI_PORT`, `BOT_INSTANCE_ID`, keys, etc.
- **`src/index.ts` is a placeholder** — do not add runtime logic there.
- **Maker backtests**: the simulator fills when the book goes *through* the resting level; passive resting fills are not modeled beyond that.
- **Symbol selection**: live scripts require `TRADING_SYMBOL` (falls back to `RECORD_SYMBOL`); recorder requires `RECORD_SYMBOL`. Both accept `BTC|ETH|SOL|XRP`.

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

Database: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `DATABASE_NAME`.

Recorder: `RECORD_BASE_DIR` (default `data/events`), `RECORD_STATS_INTERVAL_MS`, `RECORD_MAX_INFLIGHT_APPENDS`, `RECORD_SKIP_IF_OLDER_MS`.

Relayer: `POLYMARKET_BUILDER_API_*`, `POLYMARKET_RELAYER_URL`, `POLYMARKET_RELAYER_CHAIN_ID`, `POLYMARKET_RELAYER_TX_TYPE`, `POLYMARKET_TX_MODE_SPLIT|MERGE|REDEEM`, `POLYMARKET_EOA_GAS_MULTIPLIER`.

Redeem watcher: `REDEEM_WATCH_INTERVAL_MS`, `REDEEM_LOOKBACK_HOURS`, `REDEEM_MAX_MARKETS_PER_TICK`, `REDEEM_STATE_PATH`.

## Additional docs

`docs/` contains: `ARCHITECTURE.md` + `ARCHITECTURE_DIAGRAMS.md`, `MultipleBots.md`, `MeasureLatency.md`, `ParallelBacktestRunner.md`, `GenerateJobsFromGridStrategyParams.md`, `chunked-batch-stats.md`, `rebuild-chunked-batch-stats.md`, `research-gate-on-backtests.md`, `save-intent-metrics.md`, `scan-disconnect-events.md`, `trade-features-export.md`, `DepositApproveWithdrawCheckBalance.md`, `AddNewBot.md`, `Commands.md`. The `queue/` and `webui/` directories have their own READMEs.

**Telonex pipeline:** `docs/telonex-sync-design.md` is the authoritative design for the Telonex dataset ingestion pipeline (`sync-markets` → `download-raw-files` → `convert`). Read it before working on anything under `src/telonex/`. Existing Telonex usage doc: `docs/telonex-parquet.md`.
