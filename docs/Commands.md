# Run backtest on parallel queue
```bash
./queue/run-queue.sh
```

# buyBothSidesAndMerge

```bash
npm run trade:bot:btc -- \
  --strategy buyBothSidesAndMerge.v1 \
  --param triggerPrice=0.30  \
  --symbol btc
```

# basicFak

```bash
npm run trade:bot:btc -- \
  --strategy basicFak.v1 \
  --param targetPrice=0.40 \
  --param sellWhenStatus=MINED \
  --symbol btc --limit 1
```

# placeLimitOrderAndCancelAfterFewSec
```bash
npm run trade:bot:btc -- \
  --strategy placeLimitOrderAndCancelAfterFewSec.v1 \
  --param triggerPrice=0.30 \
  --symbol btc --limit 1
```

# Indicator: TimeWindowVolatility
```bash
npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=1000
```

# External FEED
```bash
npm run trade:bot:btc -- \
  --strategy readExternalFeedsExample.v1 \
  --param logEveryMs=1000
```

# Mesure Latency ⚡️

```bash
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

```bash
ENABLE_WEB_UI=true WEB_UI_HOST=127.0.0.1 WEB_UI_PORT=3001 \
  npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=1000
```

Then open `http://127.0.0.1:3001/`.

## Two bots in parallel (same strategy, different params)

Bot A:
```bash
ENABLE_WEB_UI=true WEB_UI_PORT=3001 BOT_INSTANCE_ID=botA \
  npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=500
```

Bot B:
```bash
ENABLE_WEB_UI=true WEB_UI_PORT=3002 BOT_INSTANCE_ID=botB \
  npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=1500
```

Open:
- `http://127.0.0.1:3001/`
- `http://127.0.0.1:3002/`


# Backtests

```bash
npm run backtest --  --strategy SplitSellRedeem.v1 --param splitShares=100 --param triggerBidBelow=0.07 --param sellPrice=0.08 --param sellSize=10 --symbol btc --limit 600 --random --comment "search grid for dwell start"  --batchUid "123123"
```

# Backtest from PC
1. Open Finder > Go > Connect to server
2. add permission to iterm
Open System Settings → Privacy & Security → Files and Folders → Select iTerm → Enable Network Volumes
3. remove --symbol so it can load from network


```bash
npm run backtest -- \
  --strategy SplitSellRedeem.v5 \
  --param splitShares=10 \
  --param sellSize=10 \
  --param timeFilterAllowTradingAfterSeconds=240 \
  --param timeFilterDisableTradingAfterSeconds=600 \
  --param dwellTrackPrice=bid \
  --param dwellSecondsRequired=40 \
  --param dwellRangeFrom=0.20 \
  --param dwellRangeTo=0.35 \
  --comment "test-pc-network" \
  --batchUid test-pc-network \
  "/Volumes/polymarket-bot/data/events/btc/btc-updown-15m-1770606000.parquet"
```
or by directory ( folder )
```bash
npm run backtest -- \
  --strategy SplitSellRedeem.v5 \
  --param splitShares=10 \
  --param sellSize=10 \
  --param timeFilterAllowTradingAfterSeconds=240 \
  --param timeFilterDisableTradingAfterSeconds=600 \
  --param dwellTrackPrice=bid \
  --param dwellSecondsRequired=40 \
  --param dwellRangeFrom=0.20 \
  --param dwellRangeTo=0.35 \
  --comment "test-pc-network-4175" \
  --batchUid test-pc-network-4175 \
  --dir "/Volumes/polymarket-bot/data/events/btc-pc-4175"
```

# Parallel backtesting ( old )

```bash
parallel -j 6 --bar --eta --joblog logs/parallel.log > /dev/null < src/strategies/split/backtest-jobs.txt
```


Backtest wait for TechnicalIndicators Plugin

You must set `BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1` so it will wait for TA plugin
```bash
BACKTEST_WAIT_FOR_TECHNICAL_INDICATORS=1 npm run backtest -- --strategy SplitSellRedeem.v5.3-technical-indicators --param splitShares=10 --param sellSize=10 --param timeFilterAllowTradingAfterSeconds=240 --param timeFilterDisableTradingAfterSeconds=600 --param dwellTrackPrice=bid --param dwellSecondsRequired=40 --param dwellRangeFrom=0.20 --param dwellRangeTo=0.35 --symbol btc --limit 1350 --latest --comment "TA - da bi posle mogao da poredis zasto gubis a zasto dobijas" --batchUid TA-getter-do-not-delete
```


# Deposit
```bash
npm run relayer:deposit-usdc -- --to 0x5e16B6b5e9a4d3DF14E87B7af41E9d2251FcF909 --amount 10
```

# Withdrow
```bash
npm run relayer:withdraw-usdc -- --to 0xD6882F5fCb931a076141d695A8335D88dFb2359f --amount 4
```

# Check balances
```bash
npm run check:balances
```

# Redeem watcher (background)

Continuously scans recent BTC/ETH/SOL/XRP 15m markets for resolution and redeems any SAFE-held outcome tokens automatically.

```bash
npm run relayer:redeem-watcher
```

# Get PNL from activity endpoints
```bash
npx tsx src/cli/pnl-report.ts --symbol btc --limit 5000
```

# scen folder with parquet files, count disconects and delete them
```bash
npm run -s scan:disconnect-events -- data/events_4_batch_555/btc --delete-files-where-disconnects-equal-or-greater=3 --delete-files-with-last-event-disconnect
```

# make features csv file from backtests (database)
```bash
npm run export:trade-features -- --id 240 --split 0.7
```

# test feature filter on [TEST,SEARCH,ALL]_trades_features.json
```bash
npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/240 --filter "netChange_45s>0.05&highLowRange_20s<20"
```