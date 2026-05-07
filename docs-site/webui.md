# Web UI

## Architecture

The UI is split into two parts:

1. **Embedded bot server** (`src/cli/webui/createTradingBotWebUiServer.ts`)
- serves static `webui/dist`
- streams bot snapshots/log deltas over `/ws`

2. **React client** (`webui/src/*`)
- connects via `useBotWs`
- renders orderbooks, portfolio, logs, plugin panels, status

## Build and Run

Frontend dev:

```bash
npm run webui:dev
```

Build for embedded serving:

```bash
npm run webui:build
```

Run bot with UI:

```bash
ENABLE_WEB_UI=true WEB_UI_HOST=127.0.0.1 WEB_UI_PORT=3001 npm run trade:bot:btc -- --strategy winnerLimit.v1
```

## Message Types

Defined in `webui/src/types.ts`:

- server snapshot messages (`type: snapshot`)
- command ack messages
- client command messages (cancel order, cancel all, refresh balance)

## Multi-Bot Usage

Assign unique ports:

- `WEB_UI_PORT=3001`, `BOT_INSTANCE_ID=botA`
- `WEB_UI_PORT=3002`, `BOT_INSTANCE_ID=botB`

## Vite Dev Proxy

Configured in `webui/vite.config.ts` using:

- `VITE_BOT_UI_HOST`
- `VITE_BOT_UI_PORT`
