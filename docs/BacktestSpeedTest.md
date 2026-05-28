I prepare 10 markets for speed testing in folder `/data/events/btc-speed-test-10`

# SLUGS:
btc-updown-15m-1769825700
btc-updown-15m-1769875200
btc-updown-15m-1769910300
btc-updown-15m-1769949000
btc-updown-15m-1770067800
btc-updown-15m-1770368400
btc-updown-15m-1770471000
btc-updown-15m-1770513300
btc-updown-15m-1770528600
btc-updown-15m-1770563700

When you run backtest you can set
BACKTEST_LATENCY_JITTER=0
so all stats are the same...

# Convert to `delta and delta-typed`
npm run telonex:convert -- \
  --converter delta-typed \
  --converter delta \
  --output local \
  --slug "btc-updown-15m-1769825700,btc-updown-15m-1769875200,btc-updown-15m-1769910300,btc-updown-15m-1769949000,btc-updown-15m-1770067800,btc-updown-15m-1770368400,btc-updown-15m-1770471000,btc-updown-15m-1770513300,btc-updown-15m-1770528600,btc-updown-15m-1770563700"

# TEST 1 ( mac vs mac + pc storage vs PC)
# Macbook
```
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
  --comment "local-3000" \
  --batchUid local-3000 \
  --dir "data/events/btc-speed-test-10"
```

# Test 2 Macbook Delta
```
# DELTA (raw-json market-event parquet) -> normal recorded replay via --dir
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
  --comment "delta-local-3000" \
  --batchUid delta-local-3000 \
  --dir "data/events/telonex/delta/btc/15m"
```

# Test 3 Mackbook delta-typed
```
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
  --comment "delta-typed-local-3000" \
  --batchUid delta-typed-local-3000 \
  --input-mode telonex-delta --read-from local \
  data/events/telonex/delta-typed/btc/15m/*.parquet
```


# Macbook ( PC Storage)
```
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
  --comment "test-pc-network-3000" \
  --batchUid test-pc-network-3000 \
  --dir "/Volumes/polymarket-bot/data/events/btc"
```
# PC
```
npm run backtest -- --strategy SplitSellRedeem.v5 --param splitShares=10 --param sellSize=10 --param timeFilterAllowTradingAfterSeconds=240 --param timeFilterDisableTradingAfterSeconds=600 --param dwellTrackPrice=bid --param dwellSecondsRequired=40 --param dwellRangeFrom=0.20 --param dwellRangeTo=0.35 --comment "local-3000" --batchUid local-3000 --dir "data/events/btc"
```


# TEST 2 ( RECORD VS TELONEX )
## RECORD
```
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
  --comment "local-3000" \
  --batchUid local-3000 \
  --slug btc-updown-15m-1766364300
```

# TELONEX
```
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
  --comment "local-3000" \
  --batchUid local-3000 \
  --input-mode telonex-paired --read-from local src/parquet/samples/btc-updown-15m-1766364300/telonex/paired-parquet/btc-updown-15m-1766364300.parquet
```