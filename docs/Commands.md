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
  --param targetPrice=0.40 --param sellWhenStatus=MINED \
  --symbol btc --limit 1
```