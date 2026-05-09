# Add a New Bot (Wallet + CLOB API Keys)

This guide shows how to add a new bot with its own wallet and CLOB API keys.

## 1) Export private key from MetaMask

1. Open MetaMask and select the account you want to use.
2. Go to **Account details** → **Export private key**.
3. Copy the private key (keep it secret).

## 2) Create/derive CLOB API keys with the CLI

Use the helper script to generate CLOB API credentials for that wallet:

```bash
npm run clob:api-key -- 0xYOUR_PRIVATE_KEY
```

It will print:

```
POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_API_PASSPHRASE=...
```

## 3) Create a per-bot env file

Create a new file, e.g. `.env.bot3`, and add at least:

```env
ENABLE_WEB_UI=true
WEB_UI_HOST=0.0.0.0
WEB_UI_PORT=3003
BOT_INSTANCE_ID=BOT_3

POLYMARKET_API_KEY=...
POLYMARKET_API_SECRET=...
POLYMARKET_API_PASSPHRASE=...
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
```

## 4) Run the bot

```bash
BOT_ENV=bot3 npm run trade:bot:btc -- --strategy <StrategyId>
```

Notes:

- `BOT_ENV=bot3` loads `.env.bot3` first, then `.env`.
- Keep shared settings (DB, logging, defaults) in `.env`.
