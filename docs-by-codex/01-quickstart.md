# Quickstart

## Prerequisites

- Node.js v20
- npm
- `.env` configured from `env.example` / `.env.example`

Install dependencies:

```bash
npm install
npm --prefix webui install
```

## Most Common Workflows

### 1) Record live market stream to parquet

```bash
npm run record:live:btc
```

Output goes to `data/events/<symbol>/` unless `RECORD_BASE_DIR` overrides.

### 2) Backtest strategy on parquet files

```bash
npm run backtest -- --strategy winnerLimit.v1 data/events/btc/<slug>.parquet
```

From DB by symbol:

```bash
npm run backtest -- --strategy SplitSellRedeem.v3 --symbol btc --limit 100 --latest
```

### 3) Run live trading bot

Dry-run (safe default behavior):

```bash
TRADING_SYMBOL=BTC DRY_RUN=true npm run trade:bot -- --strategy winnerLimit.v1
```

Real orders:

```bash
TRADING_SYMBOL=BTC DRY_RUN=false npm run trade:bot -- --strategy winnerLimit.v1
```

### 4) Web UI

```bash
ENABLE_WEB_UI=true WEB_UI_HOST=127.0.0.1 WEB_UI_PORT=3001 npm run trade:bot:btc -- --strategy winnerLimit.v1
```

Open: `http://127.0.0.1:3001`

## Baseline Validation Checklist

- `npm run lint` passes.
- `record-live` writes valid parquet files.
- `backtest` runs at least one file end-to-end.
- live bot starts, connects market WS, and processes ticks.
- strategy appears in runtime logs and produces expected intents/events.
