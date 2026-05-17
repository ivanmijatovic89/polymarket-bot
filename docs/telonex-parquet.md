# Telonex Parquet Backtest (Current Stable Modes)

This document reflects the current supported setup after cleanup.

Supported `--input-mode` values:
- `recorded` (default)
- `telonex-paired-parquet`

## Mode 1: `recorded` (default, slug/database dataset)

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
--slug btc-updown-15m-1766364300 \
--comment "recorded" \
--batchUid recorded-v1
```

## Mode 2: `telonex-paired-parquet`

### 2.1 Generate `orderbook_pair` parquet via the Telonex pipeline

The standalone merge CLI has been removed; conversion now runs through the
Telonex pipeline (see `docs/telonex-sync-design.md`). After `telonex:sync` +
`telonex:download` have populated raw R2 files for the slug, convert with:

```bash
# converted file lands at data/events/telonex/paired/btc/15m/<slug>.parquet
npm run telonex:convert -- --converter paired --output local --limit 1
```

Or for a specific market only — the converter loops over markets that are
`upload_status='done'` and not yet converted for the chosen converter.

Output writes paired rows (`orderbook_pair`) with typed columns (`market`,
`up_asset_id`, `down_asset_id`, `up_bids`, `up_asks`, `down_bids`, `down_asks`)
used by the stable paired replay path.

### 2.2 Run backtest using `telonex-paired-parquet` mode

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
--comment "telonex-paired-parquet" \
--batchUid telonex-paired-parquet-v1 \
--input-mode telonex-paired-parquet \
data/events/telonex/paired/btc/15m/btc-updown-15m-1766364300.parquet
```

Important shell note:
- Keep `\` at the end of each line while splitting commands.
- If one line is missing `\`, the next `--flag` is treated as a new shell command.
