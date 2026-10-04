# Research dataset implementation evidence

## Objective and scope

Build the API-only BTC 15-minute research dataset from main, including the full
June–September 2026 backfill (UTC market-window start, end exclusive 2026-10-01),
local SQL, trustworthy monthly rankings, wallet histories, documentation and tests.
Blockchain download, verification and enrichment are excluded. Preserve strategy
parity. Work on `codex/polymarket-v2-research-data`.

## Completion checklist

- [x] Establish cash accounting, settlement and API PnL comparison rules.
- [x] Implement typed V2 ingestion, retries, cursor checkpointing and rate limits.
- [x] Implement market discovery, participant coverage and full-lifecycle activity.
- [x] Publish permanent Parquet snapshots with resumable state and provenance.
- [x] Implement offline DuckDB queries, strict leaderboards and wallet drill-downs.
- [x] Test pagination, repeated fills, fees, split/merge/redeem, missing data,
      interruption, idempotency, incremental refresh and concurrent readers.
- [ ] Complete and verify a 96-window day; benchmark time, requests and disk.
- [ ] Sample July/August/September, report four-month duration and disk estimates.
- [ ] Complete June–September ingestion; explain all gaps and discrepancies.
- [ ] Demonstrate monthly leaderboards, cross-month comparison and wallet research.
- [x] Document schema, accounting, operation, recovery and agent workflows.
- [ ] Pass repository checks, open and attach a PR, inspect CI results.

## Current environment

- Base main: `0bcdc81c07f8a1e760df8c515da50188fca8f082`.
- Worktree: `/Users/mijat/.codex/worktrees/polymarket-v2-research-data/polymarket-bot`.
- Runtime: `/Users/mijat/.nvm/versions/node/v20.19.6/bin` (host default is Node 26).
- Permanent dataset: `/Users/mijat/Sites/polymarket-bot/data/polymarket-research-v2`.
- Available disk at planning: approximately 29 GiB; measure again before backfill.

## Observations, 2026-10-04

Live API sample `btc-updown-15m-1781049600` (June 10 UTC):

- 3,563 all-side trade rows; 539 trading wallets; four requests, 2.12 seconds.
- Market-anchored OPEN and CLOSED position walks yielded 137 unique wallets.
  403 trading wallets were absent. Wallet-scoped requests recovered the tested
  missing traders' closed positions. Market positions cannot discover all traders.
- The earliest trade precedes the 15-minute window by about ten hours. Select
  market cohorts by slug-derived window start; fetch the full market lifecycle.
- For wallet `0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82`, activity cash profit is
  82.377961; summed API position PnL is 82.5311 (difference -0.153139).
- For wallet `0xeebde7a0e019a63e6b476eb425505b7b3e6eba30`, activity cash profit is
  -100.446775; API position PnL is -100.3381 (difference -0.108675).
- A weighted-average-cost calculation truncating its average to six decimals
  after each purchase reproduces three of four token-level API PnL values at
  their served four-decimal precision. The fourth differs by one micro-unit of
  average cost. This is evidence of lossy/order-sensitive API PnL, not permission
  to round cash flows until they agree. Keep both values and their discrepancy.
- Closed-position entry fee totals match the extra cash charged over trade
  notional in the two all-buy examples. Do not subtract fees twice.
- Historical redemption rows in this sample have an empty token ID and combine
  outcomes. Support both legacy combined and newer per-outcome redemption rows.

Probe inputs currently live at `/tmp/polymarket-v2-planning-20261004`. Transfer
small regression fixtures into the source tree; large raw probe files are not
repository artifacts. Current official API contract:
https://data-api.polymarket.com/v2/openapi.json

## Implementation and validation checkpoint

Implemented the isolated `src/research-data` pipeline and CLI commands `sync`,
`coverage`, `leaderboard`, `wallet`, `sql`, `verify`, `rebuild`, and `benchmark`.
No live/backtest execution code was changed. Source facts remain immutable, and
raw API fields are retained alongside typed columns. New snapshots include SHA-256
file digests; local accounting rebuilds retain original source timestamps.

The first live June 1 benchmark is running with the initial wallet-scoped OPEN
implementation, 6 workers and 12 requests/second. It has 96 catalog markets,
469,728 all-side trade rows, 5,232 trading wallets and 6,743 wallet-condition
batches. All 96 market taker-volume comparisons passed. At 1,435 seconds,
5,350/6,743 wallet batches had completed, with 16,904 requests and 5 retries.
These are interim measurements, not the final benchmark.

A separate comparison of all 96 market-scoped OPEN walks matched all 5,829
available wallet-scoped OPEN records checked (same balance, total/realized/
unrealized PnL and fees). New downloads use market-scoped OPEN plus wallet-scoped
CLOSED. Market-scoped CLOSED is still unsuitable for participant coverage.
This removes thousands of requests from each day. The original running benchmark
continues unchanged so its duration remains measurable.

The current CLI defaults are 12 workers and 32 shared requests/second, with
independent endpoint caps below the official limits (18/second positions and
activity, 27/second trades and Gamma listings, 9/second status). `Retry-After`
pauses all workers. The running June benchmark still uses its original settings.
Official rate limits: https://docs.polymarket.com/api-reference/rate-limits

Accounting handles overlapping OPEN/CLOSED position views without double counting,
and records synthetic zero balances for resolved losing positions separately.
Six-decimal WAC replay explains additional mixed BUY/SELL discrepancies. A saved
June 1 fixture contains an explained 109-trade history and a three-trade case
with a larger unexplained difference; the latter remains excluded. Unknown
balances, unsupported actions and unexplained economics are not rounded away.

Passed locally: feature regression/integration tests, root TypeScript/ESLint,
global-runtime tests, strategy artifact tests, trading tests, feed coverage tests,
research protocol/index checks, WebUI typecheck/build, Dashboard typecheck/tests/
build, and docs build. Final source changes require another formatter/typecheck/
feature test pass before committing. No PR is open yet.

## Next action

1. Finish the running June 1 download. Rebuild its accounting locally using the
   latest version, then run file/SQL verification and inspect all issue classes.
2. Benchmark local queries and persist the final report. Sample July, August and
   September using the optimized downloader and report a realistic full-range
   duration/disk estimate before starting the four-month backfill.
3. Complete the backfill, demonstrate monthly/cross-month/wallet queries, document
   remaining upstream limitations, and open a PR with final validation evidence.

Runtime observation handles (not required to resume from disk): initial download
exec session 4830, process PID 81905. Always check the root lock and process before
assuming an observation timeout means the downloader stopped. Progress/state is
under `work/2026-06-01`; repeat the sync command to resume only if it has stopped.
