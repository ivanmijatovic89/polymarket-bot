# Chainlink crypto_prices — Operations Runbook

Day-to-day operation of the [Chainlink crypto_prices feed](./chainlink-crypto-prices-feed.md)
dataset. Mirrors the [Binance aggTrades runbook](./binance-aggtrades-operations.md)
— same three-command producer→R2→worker topology.

## Daily producer cron (data machine)

```bash
npm run telonex:crypto-prices:download -- --asset btcusd --sync   # coverage start → yesterday, missing only
npm run telonex:crypto-prices:upload-r2 -- --asset btcusd        # mirror new files to R2
```

- `--sync` is self-healing: it always scans the FULL expected range
  (2026-04-02 → yesterday UTC) and downloads whatever is missing — a day that
  failed, was unpublished, or was deleted locally is retried next run.
- Requires `TELONEX_API_KEY`. Watch the `downloads-remaining=` log if the plan
  meters downloads.
- Add more assets by duplicating both lines with `--asset ethusd` etc.

## Worker machines (before backtests / own cron)

```bash
npm run telonex:crypto-prices:download-r2-to-local -- --asset btcusd
```

Pulls missing day files from `r2://…/telonex/crypto_prices/<asset_id>/` to the
canonical local paths (atomic, size-drift aware). The backtest feed loader
never touches the network — a missing file is a hard per-market error whose
message names this exact command.

## Incident checklists

**Backtest fails "missing Telonex crypto_prices day file(s)"** — run the
worker pull above; if the file isn't on R2 either, run the producer download
for the named range, then `upload-r2`.

**Backtest fails "not available yet (~publication lag)"** — the market is too
fresh; Telonex publishes daily after midnight UTC. Re-run the producer `--sync`
later, mirror, pull, retry.

**Backtest fails "market predates crypto_prices coverage"** — data cannot
exist before 2026-04-02. Exclude those markets
(`--from-ms 1775001600000`) or drop the `rtdsCryptoPrices` request from the
strategy.

**Download aborts with 403** — download limit exhausted or subscription
lapsed. Progress is saved; re-run `--sync` after the limit resets. Check the
Telonex dashboard/plan.

**Backtest fails "hole in the oracle series"** — the market window contains
an upstream feed outage ≥5min (34 known gaps Apr–Jul 2026, see data-coverage).
The data does not exist anywhere. Exclude the market from the batch, or set
`BACKTEST_RTDS_CHAINLINK_MAX_GAP_MS=0` to accept replaying on the frozen
last-known price (what live bots saw). If the hole is NOT in the known census
window, inspect the day file (`npm run verify:parquet -- <path>`) and consider
a `--force` re-download.

**Suspected corrupt/regenerated day file** — `--force` re-download on the
producer; the size-drift check propagates the fix through R2 to every worker
on their next pull.

## Re-measuring the replay latency

```bash
npm run telonex:crypto-prices:record-rtds -- --asset btcusd --hours 24   # on the trading machine
# next day:
npm run telonex:crypto-prices:verify -- --asset btcusd --date <D> --check-asof
```

The verify output prints `BACKTEST_RTDS_CHAINLINK_LATENCY_MS candidate (p50)`
— override the env var if your machine/network differs from the documented
default. The `--resolution-check` mode needs no recording and can run any
time as a dataset health check.
