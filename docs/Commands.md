# buyBothSidesAndMerge

```
npm run trade:bot:btc -- \
  --strategy buyBothSidesAndMerge.v1 \
  --param triggerPrice=0.30  \
  --symbol btc
```

# basicFak

```
npm run trade:bot:btc -- \
  --strategy basicFak.v1 \
  --param targetPrice=0.40 \
  --param sellWhenStatus=MINED \
  --symbol btc --limit 1
```

# placeLimitOrderAndCancelAfterFewSec
```
npm run trade:bot:btc -- \
  --strategy placeLimitOrderAndCancelAfterFewSec.v1 \
  --param triggerPrice=0.30 \
  --symbol btc --limit 1
```

# Indicator: TimeWindowVolatility
```
npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=1000
```

# External FEED
```
npm run trade:bot:btc -- \
  --strategy readExternalFeedsExample.v1 \
  --param logEveryMs=1000
```

# Mesure Latency ⚡️

```
npm run trade:bot:btc -- \
  --strategy measureLatency.v1 \
  --param side=up \
  --param size=100 \
  --param price=0.01 \
  --param totalCycles=20 \
  --param delayMs=3000
```

# Web UI (Phase 1)

The bot can expose a read-only local Web UI (per process) on `127.0.0.1:<port>`.

## Single bot

```
ENABLE_WEB_UI=true WEB_UI_HOST=127.0.0.1 WEB_UI_PORT=3001 \
  npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=1000
```

Then open `http://127.0.0.1:3001/`.

## Two bots in parallel (same strategy, different params)

Bot A:
```
ENABLE_WEB_UI=true WEB_UI_PORT=3001 BOT_INSTANCE_ID=botA \
  npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=500
```

Bot B:
```
ENABLE_WEB_UI=true WEB_UI_PORT=3002 BOT_INSTANCE_ID=botB \
  npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=1500
```

Open:
- `http://127.0.0.1:3001/`
- `http://127.0.0.1:3002/`
