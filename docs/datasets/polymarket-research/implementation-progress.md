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
- [x] Complete and verify a 96-window day; benchmark time, requests and disk.
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

The June 1 benchmark completed and passed file-integrity and independent SQL
verification. It downloaded 469,728 trades, 506,900 activities and 72,229 position
rows across 96 markets and 5,232 wallets. The initial 6-worker/12-rps implementation
took 1,877.259 seconds with 21,141 requests and five retries. Its rebuilt Parquet
uses 88,052,503 bytes; measured peak working disk was 1,045,940,575 bytes. Local
queries took roughly 8–19 ms on the first execution (OS cache not flushed).

Accounting version 4 has 58,215 complete and 765 unresolved wallet/market pairs.
The strict daily leaderboard excludes 225 entire wallets. Detailed measurements
and the overlapping issue counts are in [benchmark evidence](./benchmark-evidence).

A separate comparison of all 96 market-scoped OPEN walks matched all 5,829
available wallet-scoped OPEN records checked (same balance, total/realized/
unrealized PnL and fees). New downloads use market-scoped OPEN plus wallet-scoped
CLOSED. Market-scoped CLOSED is still unsuitable for participant coverage.
This removes thousands of requests from each day. The original baseline is retained for comparison.

The current CLI defaults are 12 workers and 32 shared requests/second, with
independent endpoint caps below the official limits (18/second positions and
activity, 27/second trades and Gamma listings, 9/second status). `Retry-After`
pauses all workers. The completed June baseline used its original settings.
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
build, and docs build. Current feature suite: 21 tests. Commits `9858d27e` and `9a6f689e` are pushed.
The latest formatter, TypeScript/ESLint, feature tests and docs build pass. Draft PR: https://github.com/ivanmijatovic89/polymarket-bot/pull/272 (attached to the task). All four CI jobs passed for commit `9a6f689e`.

## Current download and next actions

- June 1 and July 1 are published, rebuilt with accounting version 5 and pass
  file-integrity plus independent SQL verification. June has 58,248 complete /
  732 unresolved wallet/market pairs. July has 49,868 complete / 492 unresolved.
- The July run reused its trade cache after the empty-market investigation.
  Its wallet phase completed in 495 seconds; the resumed process made 11,151
  requests with two retries. It is not a fresh full-day benchmark.
- A fresh August 1 run is now active: 16 workers, global ceiling 60 rps, endpoint
  caps unchanged. This is the timing sample needed before launching backfill.
- July/August/September targeted probes cover 12 markets and 57 wallet/market
  histories; 56 passed version 4 accounting, one remains unresolved.
- A refresh-after-rebuild regression confirms that old hard-linked source
  Parquet files are never overwritten. A failed non-empty-market volume check
  also leaves the previous published generation active.
- After August finishes, verify its snapshot, measure queries and extrapolate
  duration/storage with explicit caveats. Check free disk, then start the full
  June–September sync if the saved-data checks pass and capacity is sufficient.
- Finish discrepancy classification, monthly/cross-month/wallet examples, final
  docs and PR validation. Keep the PR draft until the goal's required evidence
  and actual backfill are complete.

Permanent root: `/Users/mijat/Sites/polymarket-bot/data/polymarket-research-v2`.
The active process logs to `logs/august-01-progress.log` under that root. Its PID
is in `sync.lock`; always check the actual process before treating a tool timeout
as process failure. June/July downloads and rebuilds have finished. Verification
outputs are saved under `logs/2026-06-01-accounting-v5.json` and
`logs/2026-07-01-accounting-v5.json`.
