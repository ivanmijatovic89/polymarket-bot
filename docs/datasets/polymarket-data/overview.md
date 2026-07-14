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

## Running a sync

Stages are independent and resumable. Run them in this order; each one only processes what the previous one left for it.

```bash
# 1. Catalog: discover markets (Gamma series → polymarket_markets)
npm run polymarket-data:sync-markets -- --symbol btc --timeframe 15m

# 2. Positions: who was in each market, and how they finished
npm run polymarket-data:sync-positions -- --symbol btc --timeframe 15m --concurrency 4

# 3. Trades: every fill
npm run polymarket-data:sync-trades -- --symbol btc --timeframe 15m --concurrency 4

# 4. Deep-backfill: rebuild markets the /trades cap couldn't fully expose
npm run polymarket-data:deep-backfill -- --symbol btc --timeframe 15m --wallet-concurrency 16

# 5. Activity: splits / merges / redeems, per wallet, biggest traders first
npm run polymarket-data:sync-activity -- --limit 500 --concurrency 4

# Audit at any time — does the DB match the API?
npm run polymarket-data:verify -- --resample 5
```

Common flags: `--symbol`, `--timeframe`, `--slug a,b`, `--limit N`, `--latest`, `--concurrency N`, `--dry-run`, `--retry-failed`, `--retry-partial`, `--reset-processing`.

**Step 4 is not optional.** On a real BTC 15m sample, ~12% of markets came back `partial` because `/trades` cannot page deep enough, and those markets were missing ~12% of their fills. `sync-trades` refuses to mark such a market `done`; `deep-backfill` is what completes them.

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
