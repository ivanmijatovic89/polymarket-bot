# Polymarket Data — Overview

Every trade and every split / merge / redeem for the crypto up/down markets, pulled from Polymarket's public APIs into our own MySQL, so analysis is a SQL query instead of a few hundred thousand HTTP requests.

Scope: **BTC / ETH / SOL / XRP × 5m / 15m / 1h / 4h / 1d**, from a configurable backfill floor (default `2026-06-01`) to now.

This pipeline is **completely independent of the Telonex pipeline** — its own catalog, its own tables, no joins, no shared state. The two live side by side.

## Tables

| Table | What's in it |
|---|---|
| `polymarket_markets` | Catalog of every market we sync + per-market sync state |
| `polymarket_trades` | One row per fill side (maker **and** taker) |
| `polymarket_market_positions` | Final per-wallet outcome per market (`realized_pnl`, `avg_price`, …) |
| `polymarket_wallets` | Every wallet we've seen + its activity cursor |
| `polymarket_activity` | SPLIT / MERGE / REDEEM / REWARD / CONVERSION on our markets |

## Running a sync — the one command

Use the wrapper. It runs every stage in the right order, and you give it symbols/timeframes once:

```bash
# everything, all symbols and timeframes
npm run polymarket-data:sync

# a subset
npm run polymarket-data:sync -- --symbol btc --timeframe 5m,15m

# full backfill from the floor (ignores stored resume state)
npm run polymarket-data:sync -- --full

# see the plan without running it
npm run polymarket-data:sync -- --dry-run
```

`--symbol` and `--timeframe` take comma-separated lists (omit for all). The wrapper's flags:

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
| 4 | `polymarket-data:deep-backfill` | rebuild `partial` markets per-wallet via `/activity` | `--symbol`, `--timeframe`, `--slug`, `--limit`, `--latest`, `--wallet-concurrency`, `--dry-run` |
| 5 | `polymarket-data:sync-activity` | `/activity` → split/merge/redeem, per wallet | `--limit`, `--wallet`, `--min-trades`, `--concurrency`, `--full`, `--stale-after`, `--refresh-done`, `--retry-failed`, `--reset-processing`, `--dry-run` |
| — | `polymarket-data:verify` | audit DB vs API | `--symbol`, `--timeframe`, `--slug`, `--limit`, `--resample`, `--requeue` |

**Step 4 is not optional.** On real crypto markets ~15–20% (higher for BTC 5m) come back `partial` because `/trades` cannot page deep enough, and those markets are missing fills. `sync-trades` refuses to mark such a market `done`; `deep-backfill` is what completes them.

### How long it takes

The catalog, positions and trades stages are fast — a few API calls per market, so the whole BTC 5m+15m set is well under an hour. **Deep-backfill is the long pole:** each capped market is rebuilt wallet-by-wallet (hundreds of wallets), ~10–30s per market depending on `POLYMARKET_DATA_ACTIVITY_RPS`. An initial full backfill is a few hours; raise the RPS budgets (below) to go faster. This is a **one-time** cost — subsequent syncs only touch new markets and are minutes.

### Rate limits and tuning throughput

Budgets are requests/second, enforced by a shared token bucket across all workers; 429s are honoured with backoff and don't burn the retry budget. Documented API caps: `/trades` 20/s, general Data API (covers `/activity`) 100/s.

| Env var | Default | Cap | Raise it when |
|---|---|---|---|
| `POLYMARKET_DATA_ACTIVITY_RPS` | 60 | ~100/s | a big backfill is slow — this is the main lever (deep-backfill + activity) |
| `POLYMARKET_DATA_TRADES_RPS` | 15 | ~20/s | positions/trades feel slow |
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

This is an identity, not an approximation — it holds at **0.000% drift across every market synced so far**, from both the trades API and the deep-backfill path. That makes it a precise completeness test: if even one fill is missing, the left side drops below the right.

The pipeline uses it as the gate, not as a report:

- `sync-trades` marks a market `done` **only** if it reproduces Gamma's number; otherwise `partial`.
- `deep-backfill` may only claim `done` on the same condition.
- `verify` re-checks every market offline (one SQL statement, no API calls) and `--requeue` sends any failure back to `deep-backfill`.

```bash
npm run polymarket-data:verify              # audit
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
| `POLYMARKET_DATA_TRADES_RPS` | `10` | Request budget for `/trades` + `/v1/market-positions` |
| `POLYMARKET_DATA_ACTIVITY_RPS` | `20` | Request budget for `/activity` |
| `POLYMARKET_DATA_GAMMA_RPS` | `10` | Request budget for Gamma |
| `POLYMARKET_DATA_API_URL` | `https://data-api.polymarket.com` | Data API base |
| `POLYMARKET_DATA_GAMMA_API_URL` | `https://gamma-api.polymarket.com` | Gamma base |

See [Sync Design](./sync-design.md) for the API limits, the failure modes, and why each stage is shaped the way it is.
