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

npm run trade:bot:btc -- \
  --strategy placeLimitOrderAndCancelAfterFewSec.v1 \
  --param triggerPrice=0.30 \
  --symbol btc --limit 1


# Indicator: TimeWindowVolatility

npm run trade:bot:btc -- \
  --strategy readVolatilityIndicator.v1 \
  --param logEveryMs=1000