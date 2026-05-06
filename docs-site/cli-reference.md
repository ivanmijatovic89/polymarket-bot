# CLI Reference

## Primary Commands (package scripts)

## Recording

- `npm run record:live`
- `npm run record:live:btc`
- `npm run record:live:eth`
- `npm run record:live:sol`
- `npm run record:live:xrp`

## Live Trading

- `npm run trade:bot`
- `npm run trade:bot:btc`
- `npm run trade:bot:eth`
- `npm run trade:bot:sol`
- `npm run trade:bot:xrp`

## Backtest

- `npm run backtest -- <args>`

Backtest flags (`src/cli/helpers/backtestArgs.ts`):

- `--order recorded|exchange_time`
- `--time-driven` / `--realtime`
- `--symbol <symbol>`
- `--slug <slug1[,slug2,...]>`
- `--dir <folder>` (repeatable)
- `--limit <N>`
- `--random`
- `--latest`
- `--comment <text>`
- `--batchUid <id>`
- `--baselineId <id>`

Strategy selection flags (shared):

- `--strategy <id>`
- `--param key=value` (repeatable)

## DB / Migrations

- `npm run db:generate`
- `npm run db:migrate`
- `npm run db:push`
- `npm run db:studio`
- `npm run db:insert-parquet`

## Parquet Tools

- `npm run list:backtest-files`
- `npm run verify:parquet`
- `npm run scan:disconnect-events`

## Research/Stats

- `npm run rebuild:chunked-batch-stats`
- `npm run rebuild:chunked-batch-stats:all`
- `npm run export:trade-features`
- `npx tsx src/cli/research/research-gate-on-backtests.ts ...`
- `npx tsx src/cli/pnl-report.ts ...`

## Relayer / Wallet Ops

- `npm run relayer:deploy-safe`
- `npm run relayer:show-safe`
- `npm run relayer:approve`
- `npm run relayer:deposit-usdc`
- `npm run relayer:withdraw-usdc`
- `npm run relayer:redeem-watcher`
- `npm run check:balances`
- `npm run clob:api-key -- <privateKey>`

## Web UI

- `npm run webui:dev`
- `npm run webui:build`
- `npm run webui:preview`

## Queue Runner

- `./queue/run-queue.sh`
- `./queue/run-queue.sh --jobs 8`
- `./queue/run-queue.sh --save-results`
