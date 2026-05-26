# Telonex Parquet Backtest (Current Stable Modes)

This document reflects the current supported setup after cleanup.

Supported `--input-mode` values:

- `recorded` (default) — reads `markets` table + WS-recorded parquet
- `telonex-paired` — reads `telonex_markets` ⋈ `telonex_market_conversions` (`converter='paired'`)
- `telonex-delta` — reads `telonex_markets` ⋈ `telonex_market_conversions` (`converter='delta-typed'`)

Telonex modes require `--read-from local|r2`:

- `local` → reads `telonex_market_conversions.local_path`
- `r2` → reads `telonex_market_conversions.r2_url` directly (no local download)

`--read-from` is rejected when used with `--input-mode=recorded`.

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

## Mode 2: `telonex-paired`

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

### 2.2 Run backtest using `telonex-paired` mode

```bash
# By slug — file path resolved from telonex_market_conversions
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
--comment "telonex-paired" \
--batchUid telonex-paired-v1 \
--input-mode telonex-paired --read-from local \
--slug btc-updown-15m-1766364300
```

Or with an explicit file path:

```bash
--input-mode telonex-paired --read-from local \
data/events/telonex/paired/btc/15m/btc-updown-15m-1766364300.parquet
```

## Mode 3: `telonex-delta`

### 3.1 Generate typed delta parquet via the Telonex pipeline

Use this when you want live-style `book` / `price_change` tick cadence without
storing a full `raw_json` payload per parquet row.

```bash
# converted file lands at data/events/telonex/delta-typed/btc/15m/<slug>.parquet
npm run telonex:convert -- --converter delta-typed --output local --limit 1
```

Output stores one typed parquet row per strategy-visible `book` or
`price_change` event. The book levels and price changes are stored in flat
repeated primitive columns, so `asset_id`, `side`, `price`, and `size` are not
packed into `raw_json` or a delimited string.

### 3.2 Run backtest using `telonex-delta` mode

```bash
# Symbol-based sample, local files
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
--comment "telonex-delta" \
--batchUid telonex-delta-v1 \
--input-mode telonex-delta --read-from local \
--symbol btc --timeframe 15m --limit 50 --random
```

Or stream directly from R2 by slug:

```bash
--input-mode telonex-delta --read-from r2 \
--slug btc-updown-15m-1766364300
```

Important shell note:

- Keep `\` at the end of each line while splitting commands.
- If one line is missing `\`, the next `--flag` is treated as a new shell command.
