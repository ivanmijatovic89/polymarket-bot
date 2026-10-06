---
title: Recorder v4 on worker-2
description: Isolated compact recorder installation with a new R2 namespace and no deletion of existing archives.
---

# Recorder v4 on worker-2

V4 replaces the recorder's format and service, while reusing worker-2's existing Node 20 and SSH setup. Its isolated installation does not update the fleet checkout or restart backtest workers. The [V4 guide](./recorder-v4) describes the format, diagrams, feed coverage and commands. Previous V3 guides and deployment evidence remain in Git history; the supported operating instructions are on this page.

V4 is installed and starts automatically when worker-2 boots. For normal operation, use the commands below; the initial V3-to-V4 activation procedure is already complete. On October 6, the operator manually deleted the retired `recorder-v3/` and `recorder-v3-validation/` R2 prefixes. V4 does not depend on those recordings. Keep V3 disabled: its retained local spool can contain pending uploads that would recreate old objects if restarted.

## Separate installation

Use these V4 paths, leaving their existing V3 counterparts intact:

| Purpose                | V4 location                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| Release root           | `/Users/worker-2/Services/polymarket-recorder-v4/releases/<commit>`        |
| Explicit configuration | `/Users/worker-2/.config/polymarket-recorder-v4/production.env`            |
| Durable spool          | `/Users/worker-2/Library/Application Support/polymarket-recorder-v4/spool` |
| Logs                   | `/Users/worker-2/Library/Logs/polymarket-recorder-v4/recorder.log`         |
| LaunchDaemon label     | `com.polymarket.recorder-v4`                                               |
| R2 production prefix   | `recorder-v4`                                                              |
| Validation prefix      | `recorder-v4/validation/<unique-run-id>`                                   |

The SSH alias is `worker-2-ansible`. The existing Node binary is `/Users/worker-2/.nvm/versions/node/v20.20.2/bin/node`; verify its version before use. Never put the recorder in `/Users/worker-2/Sites/polymarket-bot`, which belongs to the backtest fleet. A pinned release means the service continues using that tested commit even while other checkouts change.

## Routine status, stop and start

Check the installed service and recent logs from the control Mac:

```bash
ssh worker-2-ansible 'launchctl print system/com.polymarket.recorder-v4'
ssh worker-2-ansible 'tail -n 80 /Users/worker-2/Library/Logs/polymarket-recorder-v4/recorder.log'
```

Expect `state = running` and a PID. The dashboard's `/recorders` page shows feed freshness, gaps, disk allowance and archive errors when its checkout includes V4. For a direct status snapshot independent of the dashboard:

```bash
ssh worker-2-ansible 'cat "/Users/worker-2/Library/Application Support/polymarket-recorder-v4/spool/status.json"'
```

Check that `updatedAtMs` is recent; a saved status file alone does not prove the process is still alive. Compare it with launchd state and current logs.

To stop collection and keep it stopped across reboots:

```bash
ssh -t worker-2-ansible 'sudo launchctl disable system/com.polymarket.recorder-v4 && sudo launchctl bootout system/com.polymarket.recorder-v4'
```

This unloads only the recorder. Allow its shutdown to finish before starting again. Stopping creates partial captures and preserves interrupted uploads for the next run; it does not delete archives or the spool. If the service was already unloaded, `bootout` reports that it cannot find the service; inspect status rather than deleting state.

To start an installed but unloaded V4 service, including after the stop above:

```bash
ssh -t worker-2-ansible 'sudo launchctl enable system/com.polymarket.recorder-v4 && sudo launchctl bootstrap system /Library/LaunchDaemons/com.polymarket.recorder-v4.plist'
```

`RunAtLoad` starts the recorder using its pinned release and existing V4 spool. If launchd already has the service loaded but it is idle, start that existing service instead:

```bash
ssh -t worker-2-ansible 'sudo launchctl kickstart system/com.polymarket.recorder-v4'
```

For a planned restart, use the stop command, wait for shutdown, then use the start command and check status. Enter administrator passwords only in the terminal. Do not run a second `npm run record:v4` process against the production spool, use a forced `kickstart -k` for a routine restart, or rerun the original activation installer. These commands control only the recorder; they do not update its release or manage fleet workers. Starting it resumes ordinary V4 capture and uploads. See the installed `man launchctl` for service-command semantics.

## Initial rollout preparation (completed)

1. Merge the reviewed V4 PR after all required checks pass. Choose its exact commit SHA.
2. Create a separate release checkout at that SHA and run `npm ci` with Node 20. Do not reuse or replace the fleet's `node_modules`. Verify the resulting HEAD and lockfile. If GitHub SSH is unavailable, a checksum-verified Git bundle can transfer the commit without bypassing SSH host-key checks.
3. Create the V4 configuration, spool and log directories owned by `worker-2`. Copy only the allowlisted feed/R2 credentials and Redis URL into a new mode-0600 configuration file. Never copy wallet/private-key fields or overwrite the V3 configuration.
4. Set `RECORDER_ID=worker-2-btc-v4`, `RECORDER_TIMEFRAMES=5m,15m`, `RECORDER_R2_PREFIX=recorder-v4`, and the exact V4 spool path above. Use the existing dashboard Redis. Keep the production 20 GiB free-space floor and 20 GiB spool limit unless measured requirements justify another explicit configuration.
5. Run a bounded controlled capture from the new release, initially with `--no-upload`, a separate validation spool and dashboard identity. Include a complete 15m market and a complete 5m market, their boundaries and finalization grace. Running two recorders concurrently adds feed traffic; keep overlap bounded.
6. Verify both durations using `record:v4:verify`. Upload only under the dedicated V4 validation prefix, read back full objects, download into a fresh validation cache and compare deterministic replay digests. Verify ordinary admission, gap rejection and explicit outage replay using the captured coverage. Resolve any unexplained differences before activation.
7. Render `ops/macos/recorder-v4/com.polymarket.recorder-v4.plist.template` with the exact user, Node binary, pinned release, environment file and log directory. Validate it with `plutil -lint`. Record the commit and paths used.

## Initial service switch (completed)

A system LaunchDaemon needs administrator installation. Prepare the concrete rendered file first. Supply the administrator password only in the user's own terminal.

Disable the existing V3 label persistently with `sudo launchctl disable system/com.polymarket.recorder-v3`, then stop it with `sudo launchctl bootout system/com.polymarket.recorder-v3` before starting V4. Disabling is essential: its preserved `RunAtLoad` plist must not start a second recorder after a reboot. Preserve its configuration, release, local spool, retry tasks and all R2 objects. A stopped V3 service will no longer process its pending resolution/upload tasks; inspect and report that backlog before stopping it. This is a fresh V4 capture, not an in-place spool migration.

Install the V4 plist as `/Library/LaunchDaemons/com.polymarket.recorder-v4.plist`, owned by `root:wheel`, mode 0644, enable `system/com.polymarket.recorder-v4`, then bootstrap its plist in the system launchd domain. Confirm that it runs as `worker-2`, points to the intended commit and configuration, and is the only continuous recorder taking new observations. Do not unload or modify the fleet services.

After activation, check the V4 dashboard heartbeat, both durations, every feed, free space, ingestion plus finalizer CPU/RSS, upload read-back, fresh download and replay. A startup message alone does not establish success. Keep a validation record of the first full markets and any gaps. Internet/provider outages remain visible incomplete coverage; no service configuration can guarantee no missing upstream messages.

The dashboard must also run the merged V4 code: V4 publishes `recorder:v4:*` Redis status, and the old V3 dashboard reader does not consume that namespace. Update the dashboard's own checkout through its normal workflow, preserving any user work. Updating the recorder's isolated release does not update a dashboard running from another checkout. Before dispatching V4 backtests, update the producer and backtest workers to a revision containing PR #290 through the normal fleet workflow. This recorder installation leaves their current checkouts and running jobs unchanged.

## Activated October 6 installation

Release `c90ac75dcdf3f5c4d113c9b2a69eca7268bcca05` is installed at the V4 release root and has completed controlled collection, verified uploads, cross-Mac replay and dashboard-reader validation. See the [validation report](./recorder-v4-validation). The rendered plist and guarded activation script are in `/Users/worker-2/Services/polymarket-recorder-v4/`. The script checks its validation marker, pinned checkout, configuration ownership, stopped validation process and automatic-clock setting before switching only the recorder services.

The operator completed administrator activation at 10:55 UTC on October 6 using:

```bash
ssh -t worker-2-ansible 'sudo /bin/zsh /Users/worker-2/Services/polymarket-recorder-v4/activate-recorder-v4.zsh'
```

V4 is running from the tested release; V3 is unloaded and persistently disabled. Both durations, all six feeds, the production R2 paths, archive read-back, local event cleanup and replay were checked after activation. See the validation report for startup partials and complete controlled captures. The separate dashboard and fleet rollout subsequently completed on October 6: all 17 market workers loaded the V4-capable commit, and a production V4 package completed a queued backtest successfully. See the [consumer rollout evidence](./recorder-v4-validation#dashboard-and-backtest-fleet-rollout-completed-october-6). Do not rerun the initial activation command on an already loaded service.

The one-time installer included rollback to V3 on a failed initial switch. That behavior is historical and must not be used for routine operation or future V4 updates now that the V3 archives have been retired. Keep the original installation files as deployment evidence.

## Updates and rollback

### Log maintenance

The bounded-log service template runs `scripts/recorder-service.mjs`, which owns
`recorder.log` and captures the recorder child’s stdout and stderr. It rotates at
8 MiB and retains three 8 MiB archives (`recorder.log.1` through `.3`): at most
32 MiB total. Rotation closes and reopens the logger’s own file; it does not
restart capture or truncate a file still owned by launchd. The child receives
SIGINT/SIGTERM and may finish its normal shutdown before the supervisor exits.
A failed child remains a failed service exit so launchd can restart it.

The recorder PID shown by the dashboard is the child PID; `launchctl print`
reports its supervisor PID. Check both the service state and the fresh recorder
heartbeat. An installation still pointing directly at `record-v4.ts` uses the
previous unbounded launchd log: prepare and validate the updated template, then
perform one planned service stop/install/start to activate bounded logs. Do not
rename or truncate that old open log. Existing logs or archives larger than
8 MiB must be archived separately while stopped before activating the supervisor.

To diagnose supervisor startup, run its rendered command in a terminal; launchd’s
stdout/stderr destinations are `/dev/null`, while all recorder output goes through
the bounded logger. Log retention is separate from recording cleanup. Never
remove spool state or R2 data to rotate a log.

### Prepared October 6 bounded-log update

The reviewed release `a94e9a6a3d151546b56fcf4572858fe518f2f0ca` is installed in the isolated release directory. Node 20 installation, typecheck, native DuckDB and 18 supervisor/updater checks passed on worker-2. Preparation leaves the existing recorder running. Activate this prepared update once from the control Mac:

```bash
ssh -t worker-2-ansible 'sudo /bin/zsh /Users/worker-2/Services/polymarket-recorder-v4/activate-update-a94e9a6a.zsh'
```

macOS requires an administrator password in that terminal. The wrapper verifies the updater checksum and supplies the exact pinned release, rendered plist and plist checksum. Its deployment record is `/Users/worker-2/Services/polymarket-recorder-v4/prepared-update-a94e9a6a.json`. This is a planned V4 stop/start, so captures crossing the restart can be partial. Afterward, verify fresh recorder status, both durations and uploads using the routine commands above. Preparation alone does not establish that activation succeeded.

### Changing the pinned release

Prepare a new pinned V4 release, install its dependencies and validate it before changing the service. Keep the V4 spool outside releases so it survives updates. Render the checked-in supervisor template with the exact worker-2 paths, then record the full release commit and rendered file's SHA-256 (`shasum -a 256 /absolute/rendered.plist`). Review the rendered file before supplying that checksum to the updater.

Copy the reviewed `ops/macos/recorder-v4/update-service.zsh` to the service root as `update-service.zsh`. With the existing V4 service running, execute this command from your terminal, replacing all three uppercase placeholders with the prepared values:

```bash
ssh -t worker-2-ansible 'sudo /bin/zsh /Users/worker-2/Services/polymarket-recorder-v4/update-service.zsh /ABSOLUTE/PATH/TO/RENDERED.plist FULL_40_CHARACTER_COMMIT RENDERED_PLIST_SHA256'
```

The updater accepts only the worker-2 V4 label, clean pinned checkout, Node 20, existing mode-0600 recorder configuration and exact supervisor template. Existing `recorder.log` and its three archives must be regular files owned by worker-2 and no larger than 8 MiB each. It refuses unsupported input before stopping capture. It preserves a root-owned copy of the previous V4 plist under a unique `service-update-<UTC>-<suffix>/` directory, disables and unloads V4, waits for its old process to exit, installs the reviewed plist and starts V4 again. It does not modify V3, fleet workers, the spool or R2.

Installation/start failures and handled interruption signals restore the previous V4 plist. If an old process remains alive after the shutdown grace period, the updater leaves V4 disabled and reports its backup path instead of starting an overlapping recorder. A machine crash or SIGKILL cannot run rollback: inspect the service, saved plist and `.service-update-lock/pid` before recovery; do not remove the lock while its updater is alive. Preserve the backup directory as deployment evidence.

A successful command confirms a stable launchd PID, not completed capture. Verify fresh dashboard heartbeat, both durations, feed freshness and archive progress using the status commands above. Run `node --test scripts/tests/recorder-service-update.test.mjs` to exercise the updater's guarded failure and rollback paths with mocked system commands; it never controls a real service and requires zsh.

If a future V4 update fails, stop it using the routine commands above and preserve its spool, plist and objects. Restore the previously tested V4 release and its rendered plist only after checking that the prior release can read the current V4 spool, then start and verify the service. V3 is retired and is not the rollback target. Never point either version at the other's state, recreate deleted V3 archives as a recovery step, or clear the spool to make startup succeed.

Do not use `rclone sync`, `aws s3 sync --delete`, bucket-wide cleanup, lifecycle changes, or an R2 delete command for this rollout. V4's storage adapter exposes GET/LIST/conditional PUT only, confined to `recorder-v4/`. Existing data outside that prefix is not part of the installation or rollback.
