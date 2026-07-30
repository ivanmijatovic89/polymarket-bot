✅ binance agg - integrated.
✅ open_price - price_to_beat.
✅ crypto_prices - pay telonex - make inguestion pipeline.

- štelovanje 03:00

10. trades + activity || RPC logs

11. THE GAME:
    write protocol rules for the game.

12.

# Goal:

- loop 24/7
- find profitable strategy so i can make 200$ per day.

3.

# Tasks:

✅ backtest_runs - add: protocol, model
✅ mac mini m4 as main ( database + redis )
✅ reboot mac mini after power failure.

2.

# ✅ Syncer

## Main Device:

- ✅ catalog (telonex_markets)
- ✅ orderbook + convert
- ✅ binance agg
- ✅ crypto_prices
- ✅ price_to_beat
- ✅ Make one script to sync all DATA. / dry-run

## Workers:

- ✅ orderbook
- ✅ binance agg
- ✅ crypto_prices
- ✅ Make one script to sync all DATA / dry-run

## Fleet:

- ✅ check each machine STATUS
  - on/off
  - worker runing ? how many cores?
  - branch + commit
  - telenox dataset
    - converted files on local
    - binance agg
    - crypto_prices
- ✅ git
  - START fleet ...
  - UPDATE fleet ...
- ✅ data
  - npm run fleet:data -- btc:15m -e data_sync_extra='--dry-run'
