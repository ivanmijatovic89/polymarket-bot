---
title: Research Operations and Upgrades
description: Run, recover, verify and upgrade the local research downloader.
---

# Operations and upgrades

## Files and ownership

Each data root belongs to one market family, recorded in `dataset.json`. Existing
roots without that file are recognized as BTC 15-minute datasets. `--market`
cannot repurpose a root. The family registry contains the later BTC 5-minute and
ETH options, but they are deliberately disabled. Enabling another family requires
its own root, tests and a shared API request budget with other scheduled work.
Do not start four independent downloaders that each assume the full IP limit.

`index.json` selects the immutable generation for each published day. Six Parquet
files, query provenance, checksums and the day report are stored under
`snapshots/YYYY-MM-DD/<generation>/`. Only a verified generation replaces that
day in the index. Other readers can continue using the prior generation.

`as_of` is the activity cutoff. Trades, positions and resolutions are observations
made during fetching; the API does not provide an atomic historical snapshot of
all endpoints. A refresh replaces the day's active source files and derived
results, rather than appending duplicate rows.

## Failure and recovery

| Situation | Behavior and action |
| --- | --- |
| Network error / HTTP 429 / server error | Bounded retries; honor `Retry-After`. If exhausted, keep checkpoints and exit nonzero. Rerun `research:update`. |
| Two writers | The second invocation cannot obtain `sync.lock`. A scheduled invocation reports `already_running`; manual work fails visibly. |
| Stopped process | A later invocation can reclaim a local lock only after proving its PID no longer exists. |
| Interrupted same-day update | Reuse the saved cutoff, cursor pages and completed-day generations. |
| Failed new generation | Leave the previous published generation active. |
| Missing source market | Preserve the gap in coverage; the updater reports failure and retries the missing day next time. |
| Less than the disk reserve | Stop before further writes; default reserve is 5 GiB. Free space deliberately and rerun. |
| Bad checksums or independent identities | Stop publication; inspect `research:verify` and the failing day report. |

An unreadable or foreign-host lock is not automatically deleted. Inspect its
owner before removing anything. `sync-lock-recovery` is a short-lived guard for
stale-lock recovery; if a crash leaves it behind, first confirm that no downloader
or recovery process is running, then remove that empty guard and retry.

The scheduled task retries on the next daily trigger or login. To retry sooner,
run `research:update` manually. Check `research:status` after a failure; a quiet
terminal alone is not a success signal.

## Retention and readers

Automatic updates mark their generations as managed. Cleanup keeps:

- the active generation of every day;
- one previous managed generation for each day;
- generations created before managed retention or by an explicit manual sync;
- any snapshot directory listed in `retention-pins.json`.

The pin file is a JSON array of relative snapshot directory paths, for example:

```json
["snapshots/2026-06-01/00000000-0000-0000-0000-000000000000"]
```

Use a real directory from the index when pinning research evidence. Historical
backfill and audit snapshots are not deleted by the new cleanup policy.

Repository query and verification commands register a reader before loading the
index and release it on close. While a reader is live, cleanup is deferred.
Dead local reader records can be removed automatically; ambiguous records retain
data conservatively. A long-running reader can temporarily prevent disk cleanup.
Queries opened directly in external DuckDB should pin their source generations
first because external readers do not register these leases.

Completed update caches are removed; the original API row payloads remain in
Parquet. Runtime releases and historical/manual audit generations are retained
intentionally and can be removed later after checking their use and provenance.

## Verification

```bash
npm run research:data:test
npm run research:verify -- --from 2026-10-01 --to 2026-10-06
```

Verification checks SHA-256 digests, scheduled windows, participant summaries,
cash and settlement identities, activity/trade occurrences and saved volume
checks. `valid` means local integrity checks passed. Internal reconciliation
fields are diagnostic; they do not control the normal all-wallet leaderboard.

To recalculate derived tables after an accounting change without downloading:

```bash
npm run research:rebuild -- --from 2026-06-01 --to 2026-07-01
```

Rebuild preserves source observations and source timestamps. It cannot recover
missing upstream facts. A manual `sync --refresh` is required for newer source data.

## Upgrade the scheduled system

1. Make changes on a branch; update calculation/schema documentation when behavior changes.
2. Run feature tests, typecheck, lint, docs build and the required PR checks.
3. Merge the reviewed release.
4. Rerun `research:schedule ... --activate` from the clean released checkout with Node 20.
5. Inspect `schedule.json`, `research:status` and `launchctl print gui/$(id -u)/com.polymarket.research.btc-15m`.

The job is pinned to the installed commit and Node executable. A Git pull alone
does not replace its runtime. Keep that Node version installed, or reinstall
with another supported Node 20 executable. Runtime dependencies have their own
lockfile and do not depend on a disposable worktree's `node_modules`.

To disable the trigger without deleting data:

```bash
launchctl bootout "gui/$(id -u)/com.polymarket.research.btc-15m"
```

Also remove its plist from `~/Library/LaunchAgents/` if it should remain disabled
after the next login. This does not erase Parquet or terminate unrelated jobs.

## Backups and restore

Retaining old generations on the same disk is not a backup. The local operational
check on October 6, 2026 found no configured Time Machine destination; the research
directory itself was not excluded. No separate backup of this API dataset was
identified in the project's configuration. Recorder V4's R2 archive contains
separate recording data and must not be assumed to protect these research files.
A backup destination still needs to be selected before a second copy can be set up.

A consistent data backup needs `dataset.json` (if present), a captured `index.json`,
and the complete snapshot directories referenced by that index. Include any
additional generations pinned for studies, the pin file and study SQL/reports.
Capture from a filesystem snapshot, or pause the schedule and wait until the
writer has finished while making the copy, so retention cannot remove files
mid-copy. `raw_json`, checksums and query provenance reside within each generation;
temporary request caches are unnecessary for restoring published research.

Save `update-config.json` and `schedule.json` as operational records. Restore into
a separate root, keep its schedule disabled, and run coverage, verification and
a small local query there before using it. When moving to a new path or machine,
install the schedule anew with the new absolute root and supported Node 20;
do not blindly reactivate copied absolute paths. Do not copy a running
`sync.lock`, reader leases or an in-progress update state into an active restore.

A local restore smoke test on October 6 copied the October 5 published generation
and a one-day index into a separate temporary root. All 96 markets passed
verification and all 3,073 observed wallets remained queryable. This checks the
restore procedure for one day; it is not an off-device backup of the full dataset.

A refresh from the API may rebuild data after a disk loss, but cannot guarantee
recovery of the exact historical source observations used by a previous study.

## Follow-up scope

The [project research skill](./research-skill) is available for wallet studies
and strategy investigations. A separate agent runtime is optional future work.
Additional market families remain a later, separately tested rollout. Keep
calculation rules in these docs rather than copying them into agent prompts.
