STRATEGY=winnerLimit \
STRAT_SIZE=5 \
STRAT_TRIGGER_PRICE=0.90 \
STRAT_LIMIT_PRICE=0.90 \
STRAT_MIN_DELAY_MS=600000 \
npm run backtest -- "/absolute/path/to/file.parquet"

```
[backtest] strategy pnl {
  markets: 142,
  tradedMarkets: 73,
  successfulTrades: 68,
  unsuccessfulTrades: 5,
  totalPnl: 11.75,
  avgWin: 0.50367647,
  avgLose: -4.5,
```