You are an expert Node.js and TypeScript developer.

Project: `/Users/mijat/Sites/polymarket-bot`

## Response Language

- Always respond to the user in English, regardless of the language used in the user's message.
- Preserve non-English text only when quoting user-provided text, editing localized content, or explicitly translating.

## Mission-Critical Invariant

This repo has one hard rule:

- Live trading and backtests MUST run the same strategy logic on the same tick stream semantics.
- Any change that introduces live/backtest divergence is a bug.

When in doubt, preserve determinism and parity.

## Environment

- Node.js v20 (`>=20 <21`)
- TypeScript + ESM (`"type": "module"`)
- WebSocket lib: `ws`
- No framework (no NestJS, no heavy app framework)
- Plain Node + small helper modules

## Mandatory Tooling Rule (Context7)

Always use Context7 MCP for:

- code generation tasks,
- setup/configuration steps,
- library/API docs lookups.

Do not rely on memory for third-party API behavior when Context7 can confirm it.

## Repo Shape (high-level)

- `src/cli/`
  - `trading-bot.ts` (live)
  - `backtest.ts` (parquet replay)
  - `record-live.ts` (WS -> parquet)
- `src/market/`
  - shared market decoding + orderbook engine (`MarketEngine`)
- `src/trading/`
  - `StrategyRunner`, `OrderManager`, `Portfolio`, live/backtest execution adapters
- `src/strategy/`
  - strategy interfaces, registry, plugins
- `src/strategies/`
  - concrete strategies (`split`, `scalp`, `signals`, templates)
- `src/polymarket/`
  - WS clients, Gamma, CLOB helpers, relayer integrations
- `src/parquet/`
  - schema/writer/indexer + parquet CLI tools
- `src/backtest/stats/`
  - market/batch/chunked stats
- `src/db/`
  - Drizzle schema/helpers
- `webui/`
  - Vite/React monitoring UI served by bot process
- `queue/`
  - batch queue runner (`approve -> pending -> running -> done/failed`)

## Data + File Handling Rules

Large artifacts exist in this repo. Read intentionally:

- Read in full by default:
  - source code (`src/**/*.ts`), docs (`docs/**/*.md`), config files.
- Do NOT fully load unless explicitly needed:
  - `data/**` (can be huge GB-scale parquet/data dumps),
  - `node_modules/**`,
  - build outputs (`webui/dist/**`),
  - binary assets (`*.png`),
  - very large generated outputs (huge JSON/CSV/result dumps).
- For large artifacts, use structural inspection only (metadata, head/tail, schema/sample).

## Architecture Rules To Preserve

1. Market ticks
- Strategy ticks are driven by `MarketEngine` and only meaningful market events (`book`, `price_change`).

2. Strategy parity
- Strategy code path must remain shared between live and backtest.
- Avoid adding logic that exists only in one runtime unless explicitly required and documented.

3. Intent lifecycle
- Intents go through `OrderManager` (validation/risk), then execution adapter.
- Keep event semantics deterministic (`order_submitted`, `order_accepted`, fills, done/rejected).

4. Portfolio correctness
- Preserve idempotency and reconciliation logic (fills/order updates can be out-of-order).

5. Episode/window semantics
- Market rotation and 15m window boundaries are central.
- Do not break slug/window handling for up/down 15m markets.

## Strategy Development Contract

When adding/updating strategy:

- Define strict Zod schema.
- Register in `src/strategy/strategyRegistry.ts`.
- Use deterministic `clientOrderId` patterns.
- Keep on-market and on-account behavior explicit.
- If using plugins/external feeds, keep behavior safe when plugin data is missing.

## External Feeds and Plugins

- External feeds are live-only; strategy must tolerate absence in backtest.
- Plugin snapshots are tick-scoped and should remain cheap to access from strategy context.

## Commands (common)

- `npm run trade:bot:btc -- --strategy <id> ...`
- `npm run backtest -- --strategy <id> ...`
- `npm run record:live:btc`
- `npm run lint`
- `npm run webui:dev`

## Coding Style

- Keep code simple, explicit, and composable.
- Prefer small helper functions over deep abstraction.
- Avoid hidden side effects.
- Use clear names aligned with trading domain semantics.
- Keep logs informative for live debugging and replay analysis.

## Safety / Non-goals

- Do not introduce framework migration.
- Do not change existing user edits unless requested.
- Do not optimize by sacrificing determinism/reproducibility.

## Practical Review Checklist (before finishing a change)

- Does this keep live/backtest behavior aligned?
- Does this alter tick ordering or event timing semantics?
- Are order/fill/account events still idempotent and consistent?
- Are strategy params validated and backwards-compatible?
- Are docs/commands updated if behavior changed?
