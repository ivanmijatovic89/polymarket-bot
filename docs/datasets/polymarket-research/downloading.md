---
title: Download and Nightly Update
description: One nightly command for missing days and a seven-day refresh.
---

# Download and nightly update

The daily job runs at **03:00 Europe/Belgrade**. Data days are complete UTC days.
On October 6, for example, the seven-day window is September 29 through October 5.
There is no separate weekly or monthly job.

## One command

Use Node 20 with repository dependencies installed and choose a permanent directory:

```bash
export POLYMARKET_RESEARCH_DATA_DIR=/absolute/path/to/polymarket-research-v2
npm run research:update -- --from 2026-06-01
```

One update:

1. Finds missing days or missing market windows since `--from`.
2. Downloads those days, including yesterday if it is new.
3. Refreshes already published days within the last seven complete UTC days.
4. Verifies each new generation before publishing it.
5. Cleans up eligible old managed generations and temporary request pages.

A newly downloaded day is already fresh and is not downloaded a second time by
the refresh phase. Existing older days outside the seven-day window are skipped.
A day with missing market windows remains visible in coverage and causes the
update to report failure until a later attempt can fill it.

The shared wallet queue groups up to 20 market conditions across refresh days.
It keeps the same wallet, market and time filters on every cursor page. It reuses
completed compressed pages, bounds the in-memory working set and falls back to
ordinary fetching for newly discovered wallets or conditions. All API requests
share one limiter. OPEN positions are fetched by market; CLOSED positions remain
wallet-scoped because market-scoped CLOSED results omit some exited traders.

## Install the macOS schedule

After the release has passed tests and CI, run from a clean checkout:

```bash
npm run research:schedule -- --root "$POLYMARKET_RESEARCH_DATA_DIR" --from 2026-06-01 --activate
```

The installer checks Node 20 and the Mac's Europe/Belgrade system timezone. It
builds a versioned runtime inside the permanent dataset root, installs its pinned
DuckDB dependency, smoke-tests the bundle and validates the launchd plist. The
job does not depend on keeping a Codex worktree open. Omitting `--activate`
prepares and validates a separate runtime without registering the job or changing
its active configuration. An invalid configuration or failed build leaves the
installed release unchanged. Activation refuses to unload an active downloader;
handled activation failures restore its previous configuration, plist and
schedule metadata. A process kill or machine crash can interrupt rollback:
inspect those files and `launchctl print` before retrying installation.

The saved job is `com.polymarket.research.btc-15m`. It runs at 03:00 local time,
and also checks at login. A completed scheduled date is skipped, so login does
not repeatedly refresh the same day. If the Mac sleeps through 03:00, launchd
runs it when the Mac wakes. If powered off, login catch-up handles the missing
days. The job cannot download while the machine is off. Keep the system timezone
at Europe/Belgrade or reinstall the schedule for the intended local time.

This is an ordinary local Node process, not an AI automation or monitoring loop.

## Read its status

```bash
npm run research:status
npm run research:coverage -- --from 2026-06-01 --to 2026-10-01
```

The latest state is `update-state.json`. The most recent scheduled stdout and
progress are `logs/nightly/latest.json` and `logs/nightly/latest.log`. Completed
run reports live in `logs/updates/` (the last 30 attempts that completed).
An interrupted same-day run reuses its cutoff, completed days and shared cache.
A new-date attempt replans current gaps and the recent window.

For older source corrections, use a manual range:

```bash
npm run research:sync -- --from 2026-06-01 --to 2026-07-01 --refresh
```

That explicit manual refresh is kept as audit evidence and is not automatically
pruned. See [operations](./operations) for retention, failures and upgrades.
