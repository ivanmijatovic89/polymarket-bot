# Research dataset implementation evidence

> Historical evidence: the studies below used the original strict audit population.
> Normal research now includes all observed wallets. See the [current overview](./overview)
> and [profit calculation](./accounting); use `--strict` and `audit-*.sql` only to
> reproduce the earlier reconciliation-based selections.


## Objective and scope

Build the API-only BTC 15-minute research dataset from main, including the full
June–September 2026 backfill (UTC market-window start, end exclusive 2026-10-01),
local SQL, trustworthy monthly rankings, wallet histories, documentation and tests.
Blockchain download, verification and enrichment are excluded. Preserve strategy
parity. Work on `codex/polymarket-v2-research-data`.

## Final dataset and research review

All 122 days and 11,712 windows are published and verified. The complete dataset
has 37,120,045 participant trades, 41,171,117 activities and 6,535,035 position
rows, using 6.62 GiB of active Parquet. All source generations match the final
verification reports. There are no missing windows or pending-resolution rows;
100,037 wallet/market pairs retain explicit unresolved quality. Of 146 volume
warning markets, 115 are corroborated and 31 remain unresolved.

All monthly inventories and the fixed June-wallet follow-ups are reviewed.
September's active candidate reconciles at 3,560.216249 USDC and changes from
all-maker to mostly taker executions. The June leader retains one unresolved
September market. No verified four-month total is invented for either candidate.
Every monthly top-100 ranking was checked against underlying whole-wallet
eligibility and exact cash plus settlement value; the top-20 SQL agrees.

A repeated full-range sync skipped all 122 days with network access forbidden
and left the index unchanged. All 41 feature tests and root TypeScript/ESLint
pass after merging main through `72032083`. The full-range query and download
measurements, source limitations and evidence paths are in
[completion evidence](./completion-evidence). The downloader and independent
validator exited normally after their work finished.

The checkpoints below retain their historical scope, versions and pending work.
Use the final completion report for current dataset status.

## Complete August audit and fixed-wallet follow-up

All 31 August days and 2,976 windows are published and independently verified.
The monthly study contains 8,070,073 participant trade rows and 17,874 wallets.
Strict whole-wallet exclusions remove 5,557 wallets accounting for 90.4% of trade
rows; 69,273 wallet/market pairs remain unresolved. Of 134 market-volume warnings,
103 are corroborated and 31 remain unresolved. Local integrity passes with these
explicit quality flags; this is not complete accounting for every wallet.

The [August study](./monthly-wallet-study#august-follow-up-observed-behavior-unresolved-profit)
keeps the June selection fixed. The two detailed candidates have 117 and 57
unresolved markets, so neither receives a strict August profit or rank. Their
served execution profiles remain available. Among the fixed June top 20, nine
are unresolved, nine have no observed August trading and two reconcile; the
comparison retains the losing result and does not select replacement winners.

The audit independently cross-checks excluded-wallet counts and trade totals,
disjoint issue combinations, complete-row fields and daily totals. Snapshot-bound
SQL, results and review records are under `logs/monthly-accounting-audit/2026-08/`
and `logs/monthly-wallet-study/follow-up-2026-08/`. No accounting tolerances changed.
At this study's snapshot, 98 days through September 6 were published and checked;
September 7 was downloading. Final September research, full-range verification,
benchmarks and feature acceptance remain pending.

## Downloader version 10: unresolved aggregate publication

The August 20 restart introduces an explicit unresolved source-volume state.
Stable repeated trade feeds with an uncorroborated aggregate discrepancy can be
saved without stopping later days. Every observed participant in the affected
market is unresolved and excluded from strict cohort rankings. The existing
corroborated classification remains available only when its full proof passes.
Repeat-feed inconsistencies remain fatal. Source facts, money and completed
generations are unchanged; local rebuild and verification retain/check the flags.

All 41 feature tests pass, including continuation to a later day, whole-wallet
exclusion despite a separate complete market, unresolved counterparty handling,
rebuild preservation and rejection of altered repeat evidence. The [API guide](./api-limitations#august-20-retain-unresolved-aggregate-gaps-and-continue)
describes the August 20 discrepancy. Operational evidence is retained under
`logs/aug20-recovery-20261005/` in the permanent data root.

June through August monthly studies are complete, including explicitly unresolved
August results. September ingestion and follow-up, final full-range verification
and feature acceptance remain pending. Continuous AI polling stays paused;
scheduled checkpoints monitor the separate downloader and validator.

## Complete June and first monthly study

All June days are now published and independently verified: 2,880 windows,
12,240,106 participant trade rows and 30,091 observed wallets. The study snapshot
also contains July 1–2 and August 1 (33 published days). July–September ingestion
continues. Six June market-volume warnings remain visible and independently
corroborated. Strict accounting excludes 2,274 wallets with 50.1% of observed June
trade rows; those source facts remain queryable.

The [complete June study](./monthly-wallet-study) follows the previously recorded
selection rule. The eligible profit leader has economic PnL 54,166.546621 USDC
across 2,772 markets. The most broadly active other top-20 wallet is June rank 11,
with 8,387.540539 USDC across 2,795 markets. Local SQL checks reconcile both
rankings to source trade counts, activity cash, daily totals and market profiles.
Saved queries and generation metadata are under `logs/monthly-wallet-study/june/`.
Later-month results and strategy generalization remain unproven.

June 30's version-8 resumed download published 367,198 trades and 402,767
activities across all 96 windows, with 48,776 complete and 569 unresolved
wallet/market pairs. It took 376.787 seconds with 11,329 requests and no retries;
this reused cached trade pages and is not a fresh benchmark. All seven opening
participants retain exactly their independently probed cash/economic/native PnL
and trade counts (`logs/volume-mismatch-20260630/publication-invariants.json`).
All 37 feature tests and all four CI jobs pass on implementation commit `c22ff04e`.

## Downloader version 8: opening-burst evidence independent of volume

June 1–29, July 1 and August 1 are published and independently verified (31
days). June 30 stopped on a 29.411755-share source aggregate discrepancy: five
opening fills, complete matching repeat feeds and seven reconciled participants.
The discrepancy is 0.113% of the market's volume, so the version-7 percentage gate
rejected it despite the corroborating evidence. Version 8 removes that gate while
retaining all structural, repeat-feed and wallet-accounting requirements. The
source aggregate stays visibly unreconciled. Accounting version 6 is unchanged.
See the [June 30 evidence](./api-limitations#june-30-evidence-and-the-percentage-gate).
All 37 feature tests, root TypeScript/ESLint, formatting and the docs build pass.
The live seven-participant candidate passes the new evidence validator; its
full-day publication and verification are still pending at this checkpoint.

July downloads continued while June 30 was investigated. Full June publication,
monthly research and the remaining July–September backfill are still required.
The study selection rule was recorded before complete June was available in
`logs/monthly-wallet-study/selection-plan.json`: inspect June's profit leader and
the most broadly active wallet among its other top-20 eligible wallets, then
follow the same candidates through later months. A prepared local study runner
checks full-month verification before producing results.

The monthly population report and tests passed all four CI jobs on `11651e9e`.
A separate 155-history diagnostic tested two interpretations of lifetime WAC;
neither reproduced the selected native PnL values. It made no accounting change.
Six inspected histories also have native purchase-quantity contradictions.
Evidence is in `logs/native-denominator-audit-20261004/`.

## Downloader version 7: corroborated opening bursts

June 19 published and independently verified, bringing coverage to June 1–19,
July 1 and August 1 (21 days). It has 49,025 complete and 320 unresolved
wallet/market histories; its 1.960783-share warning passed all checks.

June 20 stopped on a 29.411745-share aggregate discrepancy. Fresh complete trade
walks reproduce the facts, and the difference equals 15 opening fills within 31
seconds, followed by more than 22 hours without trades. All eight involved
wallets reconcile. Downloader version 7 extends the source-warning rule to this
isolated opening burst, including transactions matched by several makers. It
retains the 0.1% relative bound and every participant's accounting checks, without
selecting a matching subset or asserting order within a second. Accounting
version 6 is unchanged. Evidence is in `logs/volume-mismatch-20260620/`.

All 36 feature tests, root TypeScript/ESLint, docs build and all four CI jobs pass
on `1f90b9e3`. June 20 is now published and independently verified: all 96 windows,
367,779 trades, 402,688 activities, 48,298 complete and 322 unresolved wallet/market
histories. The resumed run took 402.652 seconds and is not a fresh benchmark.
The 15-fill warning and original quantities are retained. All eight involved
wallets remain complete, with cash PnL, economic PnL, native PnL and trade counts
identical to the independent probe (`publication-invariants.json` in the evidence
directory above). Full day verification is in
`logs/volume-policy-20261004/live-2026-06-20.json`.

June 21 then completed a fresh version 7 download in 389.376 seconds (6.49
minutes), with 11,591 requests and zero retries. All 96 windows and 342,288 trades
pass offline verification; 49,260 wallet/market histories are complete and 316
remain explicitly unresolved. There are no source-volume warnings on this day.
The fresh-day benchmark is `logs/downloader-v7-20261004/fresh-june21-benchmark.json`.

Twenty-three days are published and verified (June 1–21, July 1 and August 1).
June 22 is downloading. Full June–September coverage and monthly research remain
required; this checkpoint does not satisfy the full-range objective.

## Downloader version 6: corroborated source warnings

June 17 is now published and independently verified with all 96 market windows:
58,989 complete and 351 unresolved wallet/market histories. Its resumed writer
ran concurrently with the validator after spill isolation; neither crashed.
All four CI jobs passed for the spill fix `7bedb52b`. This is live regression
evidence, not a claim that every possible native failure is eliminated.

June 18 stopped on another early-trade aggregate discrepancy (3.000001 shares).
Downloader version 6 adds the bounded corroboration policy documented in
[API limitations](./api-limitations). Source warnings persist in Parquet,
checksummed repeat-feed evidence and query reports. They do not change cash
calculations or exclude otherwise reconciled wallets. The new tests exercise
successful publication, offline re-verification, retained eligibility, rebuild,
changed feeds, incomplete counterparties and corrupted evidence.

The live June 16 resume is now published and independently verified: all 96
windows, 55,452 complete and 335 unresolved wallet/market histories, and
73,623,586 Parquet bytes. The 1.960784-share warning appears in Parquet and
reports; both early counterparties remain complete with unchanged cash PnL
(+0.926494 and -0.960784 USDC). `verify.valid` is true while
`all_source_aggregates_reconciled` is false. The unrelated 335 wallet-accounting
gaps retain their existing strict exclusions. Evidence is in
`logs/volume-policy-20261004/live-2026-06-16.json` under the permanent root.

All 34 feature tests, root TypeScript/ESLint, docs build and all four CI jobs pass
for `5ad946c8`; all four CI jobs also pass on documentation commit `5c2cc104`.
June 18 is now published and independently verified with all 96 windows,
437,719 trades, 58,987 complete and 304 unresolved wallet/market histories. Its
3.000001-share source warning passed the same repeated-feed and counterparty
checks; both counterparties remain complete. The resumed run took 493.533 seconds
and is not counted as a fresh benchmark. Evidence is in
`logs/volume-policy-20261004/live-2026-06-18.json`.

Twenty days are published (June 1–18, July 1 and August 1). June 19 is downloading;
its 1.960783-share early-trade discrepancy is undergoing the same automatic checks.
A local-query benchmark over 7,357,257 June 1–17 trade rows measured first-query
times of 134.20 ms for trade/wallet counts, 61.31 ms for the top-100 ranking query
and 39.18 ms for a 1,000-row activity timeline, without flushing the OS cache.
See [benchmark evidence](./benchmark-evidence) for scope and repeat timings.
Full June–September coverage, full-range query benchmarks and actual monthly
research remain pending. Accounting remains version 6.

## Downloader version 5: isolated DuckDB spill files

The concurrent downloader and offline validator both terminated in native DuckDB
while processing June 17. Their independent in-memory instances used the same
working-directory spill location. Downloader version 5 gives every writer,
reader, rebuild and verifier its own temporary directory and removes only the
files owned by that instance. The crash stack and shared spill-file inventory
are saved under `logs/duckdb-spill-20261004/` in the permanent root.

All 31 feature tests and root TypeScript/ESLint pass, including a regression that
forces two databases to spill concurrently, closes one, and verifies the other's
remaining spilled data. The shared-directory collision is the working diagnosis;
live concurrent download/verification after the fix remains to be checked.
Downloader version 5 also samples its own DuckDB spill usage in the observed peak
working-disk metric. Accounting remains version 6 and no rebuild is required.

The user authorized treating the corroborated June 16 aggregate discrepancy as
a visible source warning without automatically excluding otherwise reconciled
wallets. The bounded acceptance rule and independent verification still need to
be implemented; original trades and strict wallet-accounting checks are retained.

## Latest checkpoint: source exceptions on June 16–17

June 1–15, July 1 and August 1 are published and verified (17 days). The June 16
run stopped on a reproducible 1.960784-share disagreement between the detailed
taker feed and the API volume aggregate. Different page sizes and independent
wallet requests reproduce the facts; the suspected earliest trade is retained.
Its checkpoint is preserved and the backfill continues from June 17. June 16
must be resolved before complete-June ranking can proceed.

June 17 exposed a separate Gamma list omission. Direct market/event lookups
recover that market, so downloader version 4 adds a direct slug fallback and
retries incomplete catalogs on resume. All 30 feature tests and root
TypeScript/ESLint pass. Accounting remains version 6. Details and evidence paths
are in [API limitations](./api-limitations); the full-range objective remains open.

## Downloader version 3 live measurement

At approximately 18:55 UTC on October 4, fourteen days are published and verified:
June 1–12, July 1 and August 1. June 13 is downloading. Downloader version 3
resumed the existing June 11 checkpoints, then completed a fresh June 12 day in
452.419 seconds (7.54 minutes): all 96 markets, 369,592 trades, 13,494 requests,
eight retries and 71,127,720 Parquet bytes. Integrity checks pass; 272 unresolved
wallet-market histories remain explicitly excluded from strict cohort rankings.

The live observation has 27.3% less elapsed time per request than the pooled eight
earlier fresh June version 2 days, but workloads differ. The 14–23-hour planning
range is retained; a linear projection using only June 12 is 15.33 hours for 122
equally sized days. Full measurements and caveats are in
[benchmark evidence](./benchmark-evidence). All 26 feature tests, local checks
and all four CI jobs pass for implementation commit `42efdbc0`.

The downloader resumed at 18:44:49 UTC with accounting version 6 and no rebuild.
The validator records source revision `42efdbc0` and rechecked all published
generations. Promotion, regression, CI and live benchmark evidence are saved in
`logs/request-pacing-20261004/`. Full-range ingestion and monthly research are
still required; the goal and draft PR remain open.

## Downloader version 3 pre-promotion checkpoint

As of October 4, 2026 at approximately 18:43 UTC, twelve days are published and
independently verified: June 1–10, July 1 and August 1. June 11 is downloading.
A request-scheduling correction removes cross-endpoint waiting caused by future
global-slot reservations; the same endpoint and global limits remain active.
All 26 feature tests and root TypeScript/ESLint pass. The concurrency regression
also fails against the old implementation for the expected starvation assertion.
See [benchmark evidence](./benchmark-evidence) for the fake-transport comparison;
live version 3 timing is still pending, so the 14–23-hour planning range remains.

Main through `1aeea7c0` is integrated in merge commit `85d49cda`. Both the research
dataset and recorder-v3 CI test steps are retained, and all four CI jobs passed
on that merge. The feature still makes no changes to live/backtest strategy paths.
Accounting remains version 6; the scheduling change needs no dataset rebuild.

## Accounting version 6 checkpoint

As of October 4, 2026 at approximately 18:19 UTC, ten days are published and
independently verified: June 1–8, July 1 and August 1. The full backfill resumed
on June 9 after a bounded offline accounting rebuild. All source-file hashes,
snapshot cutoffs, wallet/market membership and monetary totals stayed unchanged;
19 unresolved histories became complete under the new terminal-merge rounding
rule. The before/after audit is
`logs/weekly-audit-20260601-20260608/rebuild-v6-invariants.json` in the data root.

All 24 feature tests, root TypeScript/ESLint and docs build pass, and all four CI
jobs pass on implementation commit `ef61a7f3`. The validator now records that
source revision and has checked all ten new generations. Its live state file
remains authoritative for process IDs, coverage and subsequent progress.

The first complete week's audit also measures selection effects: 790 of 13,018
observed wallets remain excluded from strict June 1–7 rankings, representing
1,243,100 of 3,341,212 trade rows (37.2%). One highly active wallet's full weekly
cohort became eligible after the terminal-merge correction; the remaining native
purchase-quantity and activity gaps are still unresolved. These are weekly
results, not complete-month research. Full June–September ingestion, monthly
comparison and detailed selected-wallet research remain required.

Earlier checkpoints below retain their original accounting versions and sample
measurements. Use current coverage and generation-bound verification for analysis.

## Completion checklist

- [x] Establish cash accounting, settlement and API PnL comparison rules.
- [x] Implement typed V2 ingestion, retries, cursor checkpointing and rate limits.
- [x] Implement market discovery, participant coverage and full-lifecycle activity.
- [x] Publish permanent Parquet snapshots with resumable state and provenance.
- [x] Implement offline DuckDB queries, strict leaderboards and wallet drill-downs.
- [x] Test pagination, repeated fills, fees, split/merge/redeem, missing data,
      interruption, idempotency, incremental refresh and concurrent readers.
- [x] Complete and verify a 96-window day; benchmark time, requests and disk.
- [x] Sample July/August/September, report four-month duration and disk estimates.
- [x] Complete June–September ingestion; explain all gaps and discrepancies. The exception guide distinguishes failed checks, supporting evidence and unknown upstream causes.
- [x] Demonstrate monthly leaderboards, cross-month comparison and wallet research.
- [x] Document schema, accounting, operation, recovery and agent workflows.
- [x] Pass repository checks, open and attach a PR, inspect CI results.

## Current environment

- Initial base main: `0bcdc81c07f8a1e760df8c515da50188fca8f082`; subsequently
  integrated main through `1aeea7c0` in merge commit `85d49cda`, and through
  `72032083` during final review.
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
build, and docs build. Current feature suite: 22 tests. Commits `9858d27e` and `9a6f689e` are pushed.
The latest formatter, TypeScript/ESLint, feature tests and docs build pass. Draft PR: https://github.com/ivanmijatovic89/polymarket-bot/pull/272 (attached to the task). All four CI jobs passed for commit `9a6f689e`.

## Initial download checkpoint and next actions (historical)

- June 1, July 1 and August 1 are published with accounting version 5 and pass
  file-integrity plus independent SQL verification. Their complete/unresolved
  wallet-market counts are 58,248/732, 49,868/492 and 38,179/347 respectively.
- Fresh August 1: 409.844 seconds, 9,325 requests, 13 retries, 49,952,243 Parquet
  bytes. The July run resumed and is not used as a fresh benchmark.
- The planning estimate reported before starting backfill was 14–22 hours and
  6–10 GiB plus temporary workspace. Free disk was 24.3 GiB, with a 5 GiB reserve.
  See [benchmark evidence](./benchmark-evidence) for assumptions and measurements.
- The full June–September backfill is now running with 16 workers and a 60-rps
  shared ceiling; endpoint caps remain active. Existing sample days are skipped.
- June 2 is now published and independently verified: 96 markets, 476,018 trades,
  515,903 activities, 62,413 complete and 490 unresolved wallet/market pairs.
  Fresh elapsed time was 650.827 seconds, with 14,667 requests and 10 retries;
  Parquet uses 90,696,153 bytes. The strict daily ranking excludes 205 wallets.
  The updated measured planning range is 14–23 hours and 6–11 GiB. June 3 is
  downloading; the four-month run is still active.
- After completion, run `verify` and coverage over the full June–September range;
  inspect every issue class, benchmark larger local queries and demonstrate
  monthly/cross-month/wallet research. Update docs and the PR with actual totals.
- All four CI jobs passed for `da9bbbd8` (current implementation). The PR remains
  draft until required backfill and final evidence are complete.
- All four CI jobs also passed for documentation commit `daa16b60`.
- Complete holder walks and fresh wallet activity/OPEN-position requests for
  three June 1 gaps recovered no missing rows. The new [API exception evidence](./api-limitations)
  records the observations, overlapping issue counts, large SPLIT-history native
  PnL differences and reproducible audit SQL. Accounting criteria are unchanged.
- A two-calendar-month synthetic Parquet test now verifies missing-day and
  missing-window guards, exclusion of a wallet's complete cohort when a loss is
  unresolved, independent monthly eligibility, cross-month aggregation and a
  July redemption attributed to its June market. All 22 feature tests, root
  type checking and the added test's lint pass. This validates query behavior;
  actual full-month data and research demonstrations remain pending.
- Runnable SQL now covers separate monthly top-20 rankings, a fixed June
  candidate list followed through September, and a wallet's per-market profile
  with execution details grouped by outcome. The two-month synthetic fixture
  exercises the saved SQL files. A preview against the current 480-window
  dataset correctly suppresses all monthly ranks; the selected wallet profile
  has 397 market rows with matching trade/role/outcome counts and explicitly
  incomplete four-month coverage. Preview evidence is under
  `logs/query-previews-20261004/`. All 22 tests, type checking, lint and docs build
  pass. These previews do not satisfy the pending full-month demonstration.

Permanent root: `/Users/mijat/Sites/polymarket-bot/data/polymarket-research-v2`.
Active log: `logs/june-september-progress.log`. The process PID is in `sync.lock`;
always inspect the actual process before treating a tool observation timeout as
process failure. On failure, repair the bounded issue and resume the same command:

```bash
npm run research:sync -- --root /Users/mijat/Sites/polymarket-bot/data/polymarket-research-v2 --from 2026-06-01 --to 2026-10-01 --concurrency 16 --rps 60
```

Verification evidence for the samples is under `logs/2026-06-01-accounting-v5.json`,
`logs/2026-07-01-accounting-v5.json` and `logs/august-01-verification.json`.
The August benchmark is `logs/august-01-benchmark.json`. The goal remains active;
do not mark complete merely because implementation/CI or sample days are done.

June 2 evidence: `logs/june-02-verification.json`, `logs/june-02-benchmark.json`,
and `logs/june-02-leaderboard.json`. Bounded API exception probes and saved source
pages are under `logs/api-exception-probes/` in the permanent root.

## Automatic validation during this backfill

A task-specific local watcher completed its run from
`operations/validate-backfill.mts` under the permanent data root. It uses the
existing verification and query functions, makes no Polymarket requests, and
does not modify published snapshots or restart the downloader.

It saves generation-bound verification under `logs/backfill-validation/days/`.
When every day in a month has passed those checks, it saves the month's coverage
and strict leaderboard under `logs/backfill-validation/months/`. If a missing
market prevents ranking, it records the error. After all 122 requested days pass,
it runs full-range verification, coverage, the monthly comparison SQL and a local
query benchmark. Generated reports still require the final exception audit and
detailed wallet research before goal completion.

The watcher's initial pass verified June 1–4, July 1 and August 1 with no integrity
errors. June 5 was downloading at that checkpoint. Its current phase and process
IDs are in `logs/backfill-validation/state.json`; progress is in
`logs/backfill-validation-watcher.log`. Check the actual processes before treating
an observation timeout as failure. A validator error is distinct from a downloader
failure, and neither should trigger a duplicate running sync.
