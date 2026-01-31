# Running Multiple Bots and Accessing from Multiple Machines

## Setup: Running Two Bots Simultaneously

You can run multiple bot instances on different ports. Each bot runs its own embedded Web UI server.

### Terminal 1 - Bot 1 (TemplateDwellGate):
```bash
BOT_ENV=botA ENABLE_WEB_UI=true WEB_UI_HOST=0.0.0.0 WEB_UI_PORT=3001 BOT_INSTANCE_ID=TemplateDwellGate \
npm run trade:bot:btc -- \
  --strategy TemplateDwellGate
```

### Terminal 2 - Bot 2 (TemplateTimeWindowGate):
```bash
BOT_ENV=botB ENABLE_WEB_UI=true WEB_UI_HOST=0.0.0.0 WEB_UI_PORT=3002 BOT_INSTANCE_ID=TemplateTimeWindowGate \
npm run trade:bot:btc -- \
  --strategy TemplateTimeWindowGate \
  --param timeFilterAllowTradingAfterSeconds=180 \
  --param timeFilterDisableTradingAfterSeconds=600
```

**Per-bot env files**: create `.env.botA` and `.env.botB` with wallet/API creds + overrides. When `BOT_ENV=botA` is set, the bot loads `.env.botA` first, then `.env`.

**Note**: `WEB_UI_HOST=0.0.0.0` allows access from other machines on your LAN. For localhost-only access, use `WEB_UI_HOST=127.0.0.1`.

## Accessing the Bots

### Option 1: Direct Access to Bot Servers (Recommended)

Each bot server runs on its own port and can be accessed directly:

**On Mac (localhost or LAN IP):**
- Bot 1: `http://localhost:3001/` or `http://192.168.0.12:3001/`
- Bot 2: `http://localhost:3002/` or `http://192.168.0.12:3002/`

**On Windows (via LAN IP):**
- Bot 1: `http://192.168.0.12:3001/`
- Bot 2: `http://192.168.0.12:3002/`

Replace `192.168.0.12` with your Mac's actual LAN IP address (check with `ifconfig` on Mac or `ipconfig` on Windows).

### Option 2: Via Vite Dev Server (Development Only)

If you're running the Vite dev server for UI development:

**Start Vite dev server:**
```bash
npm run webui:dev
```

The Vite dev server will be accessible at:
- Mac: `http://localhost:5173/` or `http://192.168.0.12:5173/`
- Windows: `http://192.168.0.12:5173/`

The Vite dev server proxies WebSocket connections to the bot server on port 3001 (configured via `VITE_BOT_UI_PORT` env var, default: 3001). To access different bots, you'll need to change the proxy target or use direct access.

**Note**: The Vite dev server is primarily for UI development. For monitoring multiple bots, use direct access to each bot server.

## Security Note

Using `WEB_UI_HOST=0.0.0.0` exposes the bot UI to your local network. This is safe on a trusted LAN but:
- **Do NOT use on public Wi-Fi**
- **Ensure your firewall blocks incoming connections from the internet**
- **Consider using `127.0.0.1` for localhost-only access** if you don't need LAN access

For production or untrusted networks, use SSH tunneling:
```bash
# On Windows machine:
ssh -L 3001:localhost:3001 user@192.168.0.12
ssh -L 3002:localhost:3002 user@192.168.0.12
# Then access via http://localhost:3001/ and http://localhost:3002/
```
