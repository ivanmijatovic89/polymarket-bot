# Binance aggTrades — Operations Runbook

Checklist-style companion to the [feature doc](./binance-aggtrades-feed.md).
Everything here assumes the standard layout: one **producer** (data machine
with internet access to `data.binance.vision` and R2 write access) and N
**workers** (backtest machines that read day files from local disk only).

## Daily crons

```bash
# Producer (order matters: download before upload):
npm run binance:download-aggtrades -- --pair BTCUSDT --sync
npm run binance:upload-aggtrades-r2 -- --pair BTCUSDT

# Each worker:
npm run binance:download-aggtrades-r2-to-local -- --pair BTCUSDT
```

All three are idempotent and self-healing: `--sync` re-scans the full
expected range (eligibility floor − 1 day → yesterday) and fills any hole;
both mirror hops skip-if-exists **with size comparison**, so a regenerated
file propagates producer → R2 → workers on the next cycle without flags.

Exit codes to alert on:

| Code | Meaning | Action |
|---|---|---|
| `0` | up to date / downloaded | none |
| `1` | download/upload failure, or 404s past the publication lag | read the summary line; see below |
| `2` | bad invocation, missing local dir, or **empty R2 listing** | check pair spelling / `R2_BUCKET` / whether the producer upload ever ran |

## Adding a pair (ETH/SOL/XRP)

1. Producer: `binance:download-aggtrades -- --pair ETHUSDT --sync`
   (first run backfills from the eligibility floor — hundreds of files).
2. Producer: `binance:upload-aggtrades-r2 -- --pair ETHUSDT`.
3. Workers: add `--pair ETHUSDT` to the pull cron. Note: the pull **exits 2
   while the producer hasn't uploaded yet** — sequence the rollout producer
   first, and don't `&&`-chain pairs in one cron line if that would skip the
   remaining pairs on a bootstrap failure.

Strategies need no change — `binanceWsSpotPrice: {}` follows the traded
market automatically.

## After a converter fix (regenerated day files)

1. Producer: re-download the affected days with
   `binance:download-aggtrades -- --pair X --from A --to B --force`.
2. Nothing else, usually: the next upload cron detects the size drift and
   re-uploads; the next worker pull detects it again and re-downloads.
3. **Exception**: if a regenerated file could plausibly land on the identical
   byte size (the drift check is size-based), force both hops:
   `binance:upload-aggtrades-r2 -- --pair X --force`, then on workers
   `binance:download-aggtrades-r2-to-local -- --pair X --force`.

## Error messages → what they mean

| Message (grep-able fragment) | Cause | Fix |
|---|---|---|
| `missing Binance aggTrades day file(s)` (backtest, per market) | worker disk lacks the day file | worker: run the R2 pull; producer: direct download with the printed `--from/--to` |
| `contain no trades up to` (backtest, per market) | day file empty/corrupt up to the window end — or the pair wasn't listed yet | re-download with `--force`; if the pair is newly listed, the data is correct and those markets can't use the feed |
| `no <PAIR> trades inside [...] replays on the single pre-window price` (warn) | quiet gap longer than the lookback, or a truncated day file | check the named parquet with `verify:parquet`; for liquid pairs treat as suspicious |
| `dump not found ... past the ~1-day publication lag` | mistyped pair, or a genuine Binance-side gap | fix the pair; a real gap doesn't block other days (run still exits 1 so it stays visible) |
| `not published yet (~1-day lag) — skipped` (warn) | yesterday's dump not out yet | nothing — the next `--sync` retries |
| `no day files under r2://...` (exit 2) | wrong `R2_BUCKET`/pair, or producer never uploaded | fix env / run the producer upload |
| `size drift ... re-uploading` / `re-downloading` (warn) | regenerated file propagating | expected after a converter fix; investigate if it appears without one |
| `size mismatch ... downloaded N bytes, expected M` | truncated R2 stream | auto-retried (3×); if persistent, check connectivity/R2 status |

## Fresh markets and the publication lag

Binance publishes daily dumps with a ~1-day lag, so markets **younger than
about a day cannot be backtested with the feed** — they hard-error on the
missing day file until the dump lands and the crons pick it up. This is by
design (no silent feed-less replay); plan research batches accordingly.

## Env quick reference

| Var | Where | Notes |
|---|---|---|
| `R2_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY` | producer + workers | same bucket everywhere |
| `TELONEX_DATASET_ELIGIBLE_FROM` | producer (drives `--sync` range) + backtest eligibility | moving it back triggers automatic backfill on the next `--sync` |
| `BACKTEST_BINANCE_FEED_LATENCY_MS` / `_LOOKBACK_MS` | workers | defaults measured/sane; keep unset unless re-measured |
| `BINANCE_DATA_BASE_DIR` | anywhere | default `data/binance` under the repo root |
