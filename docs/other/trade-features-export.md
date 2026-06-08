# Trade Features Export

This CLI exports trade features from a normalized backtest run. It hydrates
ordered market stats from `backtest_run_markets`, uses `intentMeta[0]` per
market, skips `pnl === 0`, and writes both CSV and JSON outputs.

## Usage

```bash
npm run export:trade-features -- --id 240
```

Optional split ratio (SEARCH/TEST, default 0.7):

```bash
npm run export:trade-features -- --id 240 --split 0.7
```

## Output

Files are written to:

```
data/research-backtest/{ID}/
```

Example for `--id 240`:

- `data/research-backtest/240/ALL_trades_features.csv`
- `data/research-backtest/240/ALL_trades_features.json`
- `data/research-backtest/240/SEARCH_trades_features.csv`
- `data/research-backtest/240/SEARCH_trades_features.json`
- `data/research-backtest/240/TEST_trades_features.csv`
- `data/research-backtest/240/TEST_trades_features.json`

Feature-only subfolders (same split, only relevant columns):

- `data/research-backtest/240/orderbook/ALL_trades_features.*`
- `data/research-backtest/240/orderbook/SEARCH_trades_features.*`
- `data/research-backtest/240/orderbook/TEST_trades_features.*`
- `data/research-backtest/240/netChange/ALL_trades_features.*`
- `data/research-backtest/240/netChange/SEARCH_trades_features.*`
- `data/research-backtest/240/netChange/TEST_trades_features.*`
- `data/research-backtest/240/highLowRange/ALL_trades_features.*`
- `data/research-backtest/240/highLowRange/SEARCH_trades_features.*`
- `data/research-backtest/240/highLowRange/TEST_trades_features.*`
- `data/research-backtest/240/ta/ALL_trades_features.*`
- `data/research-backtest/240/ta/SEARCH_trades_features.*`
- `data/research-backtest/240/ta/TEST_trades_features.*`

## Column schema

Base columns:

- `slug`
- `isWin` (true if pnl > 0)
- `pnl`

Windows metrics (one per window):

- `netChange_{window}`
- `highLowRange_{window}`

Windows used: `1s, 3s, 5s, 10s, 20s, 30s, 45s, 60s, 120s, 180s, 220s`

Orderbook levels (1..10):

- `ob_{level}_upBidDepth`
- `ob_{level}_downBidDepth`
- `ob_{level}_weakBidSide`
- `ob_{level}_weakBidRatio`
- `ob_{level}_isMyOrderOnWeakBidSide`

Technical indicators:

- `ta_tf1h_rv20`
- `ta_tf1h_rv80`
- `ta_tf1h_bbWidth`
- `ta_tf1h_atr14Pct`
- `ta_tf1h_wickRatio`
- `ta_tf1h_hlRangePct`
- `ta_tf1h_rv20Over80`
- `ta_tf15m_rv20`
- `ta_tf15m_atr14Pct`
- `ta_tf15m_wickRatio`
- `ta_tf15m_hlRangePct`
- `ta_meta_session`
- `ta_meta_dayOfWeekUTC`
- `ta_meta_hourOfDayUTC`

## Notes

- Uses only `intentMeta[0]` for each market.
- If a metric/level/indicator is missing, CSV uses empty cells and JSON uses `null`.
- Markets with `pnl === 0` are excluded.
- SEARCH/TEST split keeps the original order (no randomization).
