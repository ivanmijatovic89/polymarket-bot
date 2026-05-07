# polymarket-bot Web UI (Phase 1)

This folder contains the **read-only monitoring UI** for `src/cli/trading-bot.ts`.

Key idea: the **bot process** runs a tiny HTTP + WebSocket server, and the browser renders everything.

## What you get in Phase 1

- Status (symbol, slug, candle time left, WS attempt/events)
- UP/DOWN orderbooks (top N levels)
- Logs (two modes):
  - **text**: pre-formatted human lines
  - **json**: structured `LogRecord` objects

No buttons / no trading controls yet.

## How it works (high-level)

### Runtime pieces

- **Bot process**: `src/cli/trading-bot.ts`
  - builds the snapshot via `getState()`
  - collects logs into ring buffers
- **Embedded UI server**: `src/cli/webui/createTradingBotWebUiServer.ts`
  - serves static assets from `webui/dist/`
  - hosts WebSocket endpoint at `/ws`
  - pushes **snapshot + log deltas** every `WEB_UI_REFRESH_MS` (default 250ms)
- **Frontend**: this `webui/` React app
  - connects to `/ws`
  - renders components (`StatusBar`, `OrderbookPanel`, `LogsPanel`)

### Data flow

1. The bot maintains the live market snapshot internally via `MarketEngine` → `StrategyRunner`.
2. The UI server periodically calls `getState()` and sends a compact `snapshot`.
3. Logs are streamed as **append-only deltas** to keep the UI cheap.

## Development

### Install

From repo root:

```bash
npm --prefix webui install
```

### Run UI dev server (frontend only)

```bash
npm run webui:dev
```

Note: the bot’s embedded server serves built assets from `webui/dist`. The Vite dev server is only for iterating on UI locally.

### Build UI for the bot server

```bash
npm run webui:build
```

This produces `webui/dist/`, which the bot server serves.

## Running the bot with the Web UI

Example:

```bash
ENABLE_WEB_UI=true WEB_UI_HOST=127.0.0.1 WEB_UI_PORT=3001 \
  npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=1000
```

Open: `http://127.0.0.1:3001/`

### Multi-bot

Run multiple bot **processes** and use different ports:

```bash
ENABLE_WEB_UI=true WEB_UI_PORT=3001 BOT_INSTANCE_ID=botA npm run trade:bot:btc -- --strategy readVolatilityIndicator.v1 --param logEveryMs=500
ENABLE_WEB_UI=true WEB_UI_PORT=3002 BOT_INSTANCE_ID=botB npm run trade:bot:btc -- --strategy readVolatilityIndicator.v1 --param logEveryMs=1500
```

## Environment variables (UI server)

- `ENABLE_WEB_UI` (default: `false`): enables the embedded UI server
- `WEB_UI_HOST` (default: `127.0.0.1`): bind host
- `WEB_UI_PORT` (required if enabled): bind port
- `WEB_UI_REFRESH_MS` (default: `250`): snapshot/delta push interval
- `WEB_UI_ORDERBOOK_LEVELS` (default: `8`): levels per side in the orderbook snapshot
- `BOT_INSTANCE_ID` (optional): shown in the UI title

## WebSocket message contract

The server sends JSON messages shaped like:

```ts
type WsSnapshotMsg = {
  type: 'snapshot'
  snapshot: BotUiSnapshot
  logsText?: { from: number; to: number; lines: string[] }
  logsJson?: { from: number; to: number; records: LogRecord[] }
}
```

The UI currently only needs server→client messages (read-only).


