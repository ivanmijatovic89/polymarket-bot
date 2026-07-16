# Polymarket Data — Overview

Every trade and every split / merge / redeem for the crypto up/down markets, pulled from Polymarket's public APIs into local Parquet and queried through DuckDB, so analysis is a SQL query instead of a few hundred thousand HTTP requests. MySQL holds only the small resumable catalog and wallet sync state.

Scope: **BTC / ETH / SOL / XRP × 5m / 15m / 1h / 4h / 1d**, from a configurable backfill floor (default `2026-06-01`) to now.

This pipeline is **completely independent of the Telonex pipeline** — its own catalog, its own tables, no joins, no shared state. The two live side by side.

Source selection and the blockchain fallback are documented in [API-First and RPC Fallback](./api-first-and-rpc-fallback.md).

Monthly Parquet compaction is an accepted design but intentionally deferred
until the hierarchical staging layout and one complete month are validated. The
implementation trigger and correctness contract are preserved in
[Monthly Parquet Compaction Plan](./monthly-compaction-plan.md).

Current market-level facts use human-readable Hive staging paths, for example:

```text
data/polymarket/staging/trades/symbol=btc/timeframe=5m/month=2026-06/<slug>.parquet
data/polymarket/staging/positions/symbol=btc/timeframe=5m/month=2026-06/<slug>.parquet
```

DuckDB derives `symbol`, `timeframe`, and `month` from those paths, so an agent
can filter the fact views directly without first joining the market catalog.
Per-wallet non-trade activity remains under `data/polymarket/facts/activity/`.

## Tables

| Table | What's in it |
|---|---|
| `polymarket_markets` | Catalog of every market we sync + per-market sync state |
| `polymarket_trades` | DuckDB view over Parquet; one row per fill side (maker **and** taker) |
| `polymarket_market_positions` | DuckDB view over Parquet; final per-wallet outcome per market (`realized_pnl`, `avg_price`, …) |
| `polymarket_wallets` | Every wallet we've seen + its activity cursor |
| `polymarket_activity` | DuckDB view over Parquet; SPLIT / MERGE / REDEEM / REWARD / CONVERSION on our markets |

## June 2026 backfill — results

One-time full backfill of **June 2026** (`--from 2026-06-01 --to 2026-07-01`), run one symbol+timeframe at a time (sequential — never two syncs at once), on a freshly truncated DB.

**Durations time the per-timeframe data stages** (catalog → positions → trades → deep-backfill → verify). The **activity** stage (split/merge/redeem) is run **once at the end** over the whole catalog instead of per-run: activity is wallet-based and global, and running it per-timeframe would make the coverage-rebase re-read every overlapping big trader's full history on each run (big traders appear in all timeframes). Its one-time cost is the separate row below the table.

- **Markets** — markets cataloged for that symbol+timeframe in June.
- **Done / Partial** — markets that reproduce Gamma's `volumeNum` exactly (`done`) vs. markets still awaiting recovery or investigation (`partial`). A market cannot become `done` until its persisted Parquet snapshot passes the same check.
- **Trade rows** — fill rows written to `polymarket_trades` (maker + taker).
- **Deep-backfilled** — markets that hit the `/trades` cap and were rebuilt per-wallet.
- **Duration** — wall-clock for the data stages of that run.

| Symbol | Timeframe | Markets | Done | Partial | Trade rows | Deep-backfilled | Duration |
|---|---|---:|---:|---:|---:|---:|---:|
| btc | 1d  | 30 | 30 | 0 | 223,279 | 22 | phased; 30–50s per deep market |
| btc | 4h  | — | | | | | _pending_ |
| btc | 1h  | — | | | | | _pending_ |
| btc | 15m | — | | | | | _pending_ |
| btc | 5m  | 6 samples | 6 | 0 | 46,850 | 6 | 1m 39s avg deep-backfill |
| eth | 1d  | — | | | | | |
| eth | 4h  | — | | | | | |
| eth | 1h  | — | | | | | |
| eth | 15m | — | | | | | |
| eth | 5m  | — | | | | | |
| sol | 1d  | — | | | | | |
| sol | 4h  | — | | | | | |
| sol | 1h  | — | | | | | |
| sol | 15m | — | | | | | |
| sol | 5m  | — | | | | | |
| xrp | 1d  | — | | | | | |
| xrp | 4h  | — | | | | | |
| xrp | 1h  | — | | | | | |
| xrp | 15m | — | | | | | |
| xrp | 5m  | — | | | | | |
| **TOTAL (data stages)** | | | | | | | |
| _+ activity (once, all)_ | | — | — | — | — | — | _pending_ |

_Current accepted dataset: **BTC 1d plus six BTC 5m benchmark markets**. BTC 1d contains 223,279 trade rows, 17,340 final-position rows, and 5,216 distinct trading wallets across 30 markets. The six 5m benchmarks add 46,850 trades, 11,694 positions, and 5,938 distinct trading wallets. The complete Parquet facts plus DuckDB catalog occupy about 8.1 MB. BTC 4h/1h/15m and the remaining 5m markets and symbols have not started under the accepted API-first Parquet path._

The earlier MySQL and `/activity`-based trade facts were deleted. The table above records only results produced by the accepted per-wallet `/trades` path and its guarded single-wallet overflow recovery.

## Running a sync — the one command

Use the wrapper. It runs every stage in the right order, and you give it symbols/timeframes once:

```bash
# everything, all symbols and timeframes
npm run polymarket-data:sync

# a subset
npm run polymarket-data:sync -- --symbol btc --timeframe 5m,15m

# a specific date range — e.g. just June (from June 1 up to July 1)
npm run polymarket-data:sync -- --symbol btc --timeframe 5m,15m --from 2026-06-01 --to 2026-07-01

# full backfill from the floor (ignores stored resume state)
npm run polymarket-data:sync -- --full

# see the plan without running it
npm run polymarket-data:sync -- --dry-run
```

`--symbol` and `--timeframe` take comma-separated lists (omit for all). `--from`/`--to` bound the market window (dates are market *start* times; `--to` is roughly inclusive of the boundary market). Note: the window scopes the **catalog** — the later stages then process whatever markets are `pending`. So on a fresh/truncated DB, a June-only catalog means the whole run stays within June; if the DB already holds markets from other dates, those get processed too. Truncate first when you want a run confined to an exact range.

The wrapper's flags:

| Flag | Default | Effect |
|---|---|---|
| `--symbol <a,b>` | all | symbols to sync |
| `--timeframe <a,b>` | all | timeframes to sync |
| `--from` / `--to <date>` | resume → now | catalog window |
| `--full` | off | catalog: rescan from the backfill floor |
| `--concurrency <n>` | 6 | positions/trades/activity workers |
| `--wallet-concurrency <n>` | 16 | deep-backfill per-market fan-out |
| `--stale-after <hours>` | 120 | activity: also refresh wallets not synced in N hours |
| `--resample <n>` | 10 | verify: markets to re-check against the live API |
| `--skip <stages>` | — | comma list: `markets,positions,trades,backfill,activity,verify` |
| `--dry-run` | off | print the commands, run nothing |

**Why one command, run sequentially:** every stage draws on the same Polymarket rate budget, so running stages (or several syncs) in parallel just trips 429s. The wrapper runs them one at a time on purpose — that is both correct and, at the default RPS, about as fast as the API allows. Don't launch two syncs at once.

### The stages, if you ever run them by hand

The wrapper just calls these in order; each is independent and resumable, and only processes what the previous one left `pending`.

| # | Command | Does | Key flags |
|---|---|---|---|
| 1 | `polymarket-data:sync-markets` | catalog from Gamma → `polymarket_markets` | `--symbol`, `--timeframe`, `--from`, `--to`, `--full`, `--dry-run` |
| 2 | `polymarket-data:sync-positions` | `/v1/market-positions` → participants + final PnL | `--symbol`, `--timeframe`, `--slug`, `--limit`, `--latest`, `--concurrency`, `--retry-failed`, `--reset-processing`, `--dry-run` |
| 3 | `polymarket-data:sync-trades` | `/trades` → every fill; marks `done` or `partial` | same as positions, plus `--retry-partial` |
| 4 | `polymarket-data:deep-backfill` | rebuild `partial` markets via per-wallet `/trades` | `--symbol`, `--timeframe`, `--slug`, `--limit`, `--latest`, `--wallet-concurrency`, `--dry-run` |
| 5 | `polymarket-data:sync-activity` | `/activity` → split/merge/redeem, per wallet | `--limit`, `--wallet`, `--min-trades`, `--concurrency`, `--full`, `--stale-after`, `--refresh-done`, `--retry-failed`, `--reset-processing`, `--dry-run` |
| — | `polymarket-data:verify` | audit DB vs API | `--symbol`, `--timeframe`, `--slug`, `--limit`, `--resample`, `--requeue` |

**Step 4 is not optional.** On real crypto markets ~15–20% (higher for BTC 5m) come back `partial` because `/trades` cannot page deep enough, and those markets are missing fills. `sync-trades` refuses to mark such a market `done`; `deep-backfill` is what completes them.

Each deep-backfilled market prints its measured network cost and duration:
`http_requests` counts actual HTTP attempts including retries, `elapsed` is
wall-clock time for that market, and `avg_rps` is the effective request rate.

### How long it takes, and what to sync first

The catalog, positions and trades stages are fast — a few API calls per market. **Deep-backfill is the long pole:** each capped market is rebuilt wallet-by-wallet (hundreds of wallets) under `POLYMARKET_DATA_TRADES_RPS`. So the total time is driven almost entirely by how many markets hit the `/trades` cap.

Measured cap-hit rate (share of markets needing deep-backfill), from real data:

| Timeframe | Markets that need deep-backfill | Notes |
|---|---|---|
| 1d | **0%** | few markets, all fit under the cap |
| 4h | **0%** | " |
| 1h | **0%** | " |
| 15m | ~3% overall | BTC ~7%, ETH/SOL/XRP ~0% |
| 5m | ~23% overall | **almost all of it is BTC 5m (~92%)**; ETH/SOL/XRP 5m ~0% |

So the work is very lopsided: **1h/4h/1d finish in minutes with no deep-backfill**, 15m is light, and the single heavy job is **BTC 5m**. A good order:

```bash
# 1) the fast timeframes — all symbols, no backfill, done in minutes
npm run polymarket-data:sync -- --timeframe 1h,4h,1d --from 2026-06-01 --to 2026-07-01

# 2) 15m — light backfill (mostly BTC)
npm run polymarket-data:sync -- --timeframe 15m --from 2026-06-01 --to 2026-07-01

# 3) 5m for the light symbols — also fast
npm run polymarket-data:sync -- --symbol eth,sol,xrp --timeframe 5m --from 2026-06-01 --to 2026-07-01

# 4) the long pole — BTC 5m — let it run (raise TRADES_RPS cautiously to speed it up)
npm run polymarket-data:sync -- --symbol btc --timeframe 5m --from 2026-06-01 --to 2026-07-01
```

You get complete, queryable data after step 1 and keep widening from there, instead of waiting on BTC 5m up front. The whole thing is a **one-time** cost — later syncs only touch new markets and take minutes.

### Rate limits and tuning throughput

Budgets are requests/second, enforced by a shared token bucket across all workers; 429s are honoured with backoff and don't burn the retry budget. Documented API caps: `/trades` 20/s, general Data API (covers `/activity`) 100/s.

| Env var | Default | Cap | Raise it when |
|---|---|---|---|
| `POLYMARKET_DATA_ACTIVITY_RPS` | 60 | ~100/s | non-trade wallet activity is slow |
| `POLYMARKET_DATA_TRADES_RPS` | 15 | ~20/s | positions, trades, or per-wallet deep-backfill are slow; try 18/s while watching for 429s |
| `POLYMARKET_DATA_GAMMA_RPS` | 10 | — | rarely; the catalog is already fast |

Set them in `.env`, e.g. `POLYMARKET_DATA_ACTIVITY_RPS=90`, and re-run. If you start seeing sustained 429 warnings, dial back.

## Extending the history

The backfill floor is just an env var:

```bash
POLYMARKET_DATA_BACKFILL_FROM=2026-01-01T00:00:00Z
```

Lower it, re-run stages 1→5, and the older markets show up as `pending` and get processed. Nothing already synced is touched or re-fetched. The same mechanism covers "a month has passed, sync again" — new markets appear at the top instead.

## Recurring sync

For markets and trades a plain re-run is fully incremental: `sync-markets` adds the new markets as `pending`, and `sync-positions` / `sync-trades` only claim `pending`, so already-synced markets are never re-processed.

Wallet **activity** needs one extra step. A wallet that is already `done` is not re-synced on a plain run — so its *new* splits/redeems (e.g. a redeem that happens after a market resolves) would be missed. Re-queue already-synced wallets so the recurring run picks them up:

```bash
# refresh wallets not synced in the last 5 days, then sync (cheap: resumes from each cursor)
npm run polymarket-data:sync-activity -- --stale-after 120 --concurrency 4
```

- `--stale-after <hours>` — re-queue `done` wallets whose last sync is older than N hours (a never-synced `done` counts as stale). The natural knob for a periodic job.
- `--refresh-done` — re-queue **all** `done` wallets (force a full refresh).
- `--wallet 0x…` — re-queue specific wallets.
- `--reset-processing` — free wallets stuck in `processing` after a hard kill (only when no other worker is running).
- `--min-trades N` scopes all of the above; `--limit 0` does the re-queue and syncs nothing (admin-only); `--dry-run` reports what would be re-queued without writing.

The refresh is cheap and idempotent — a re-queued wallet resumes from `cursor − 1h` and `dedup_key` drops anything already stored. So a full recurring pass is:

```bash
npm run polymarket-data:sync-markets
npm run polymarket-data:sync-positions -- --concurrency 6
npm run polymarket-data:sync-trades   -- --concurrency 6
npm run polymarket-data:deep-backfill -- --wallet-concurrency 16
npm run polymarket-data:sync-activity -- --stale-after 120 --concurrency 4
npm run polymarket-data:verify -- --resample 10
```

## How we know the data is complete

Gamma reports a `volumeNum` per market. It turns out that this is exactly the **traded share count with each match counted once**:

```
SUM(polymarket_trades.size) / 2  ==  polymarket_markets.volume_gamma
```

This is an identity, not an approximation — it matches to **0.000% across almost every market**, from both the trades API and the deep-backfill path. That makes it a precise completeness test: a real shortfall (missing fills) drops the left side below the right by far more than rounding. The tolerance is **absolute shares** (not a percentage — a relative % would hide real shortfalls on high-volume markets); see the [Completeness Contract ADR](/adr/polymarket-data-completeness-contract) for the full contract.

The pipeline uses it as the gate, not as a report:

- `sync-trades` marks a market `done` **only** if it reproduces Gamma's number; otherwise `partial`.
- `deep-backfill` may only claim `done` on the same condition.
- `verify` re-checks every market offline (one SQL statement, no API calls). A `partial` market failing the check is expected work; a **`done` market failing it is an integrity violation** — `verify` prints it loudly and **exits non-zero**, so the sync wrapper and CI surface it. `--requeue` sends failures back to `deep-backfill`. `verify --resample N` additionally re-pulls N markets from the live API and cross-checks row counts, share volume, and the participant identity set.

```bash
npm run polymarket-data:verify              # audit (exits non-zero on a broken `done` market)
npm run polymarket-data:verify -- --requeue # audit + send failures back for repair
npm run polymarket-data:deep-backfill       # repair
```

A note on what NOT to compare: the **USDC** total (`volume_traded`) is *not* Gamma's figure and will differ by a few percent — money moved, not shares matched. Comparing those two raises false alarms (it fooled us once during development).

## Example queries

Top traders on BTC 15m in a date range, by realized PnL:

```sql
SELECT p.wallet,
       SUM(p.realized_pnl) AS pnl,
       COUNT(DISTINCT p.market_id) AS markets
FROM polymarket_market_positions p
JOIN polymarket_markets m ON m.id = p.market_id
WHERE m.symbol = 'btc' AND m.timeframe = '15m'
  AND m.market_start_ms BETWEEN UNIX_TIMESTAMP('2026-07-01') * 1000
                            AND UNIX_TIMESTAMP('2026-08-01') * 1000
GROUP BY p.wallet
ORDER BY pnl DESC
LIMIT 50;
```

Most active bots by fill count, and how much of it was maker flow:

```sql
SELECT t.wallet,
       COUNT(*) AS fills,
       SUM(t.is_taker = 0) / COUNT(*) AS maker_share,
       COUNT(DISTINCT t.market_id) AS markets
FROM polymarket_trades t
JOIN polymarket_markets m ON m.id = t.market_id
WHERE m.symbol = 'btc' AND m.timeframe = '15m'
GROUP BY t.wallet
HAVING fills > 500
ORDER BY fills DESC;
```

Reconstruct one match with all its counterparties (one taker row, N maker rows share a `tx_hash`):

```sql
SELECT wallet, side, is_taker, size, price
FROM polymarket_trades
WHERE tx_hash = '0x…'
ORDER BY is_taker DESC;
```

Who splits/merges (the classic market-maker signature):

```sql
SELECT a.wallet, a.type, COUNT(*) AS n, ROUND(SUM(a.usdc_size)) AS usdc
FROM polymarket_activity a
WHERE a.type IN ('SPLIT', 'MERGE')
GROUP BY a.wallet, a.type
ORDER BY n DESC
LIMIT 50;
```

Gap check — markets we know about but haven't finished:

```sql
SELECT symbol, timeframe, trades_status, positions_status, COUNT(*)
FROM polymarket_markets
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2;
```

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `POLYMARKET_DATA_BACKFILL_FROM` | `2026-06-01T00:00:00Z` | Oldest market to sync |
| `POLYMARKET_DATA_MIN_CLOSE_AGE_MS` | `3600000` | Wait this long after a market closes before syncing it |
| `POLYMARKET_DATA_TRADES_RPS` | `15` | Request budget for `/trades` + `/v1/market-positions` |
| `POLYMARKET_DATA_ACTIVITY_RPS` | `60` | Request budget for non-trade `/activity` sync |
| `POLYMARKET_DATA_GAMMA_RPS` | `10` | Request budget for Gamma |
| `POLYMARKET_DATA_API_URL` | `https://data-api.polymarket.com` | Data API base |
| `POLYMARKET_DATA_GAMMA_API_URL` | `https://gamma-api.polymarket.com` | Gamma base |

See [Sync Design](./sync-design.md) for the API limits, the failure modes, and why each stage is shaped the way it is.
