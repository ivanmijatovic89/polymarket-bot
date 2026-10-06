---
title: Recorder v4 on worker-2
description: Isolated compact recorder installation with a new R2 namespace and no deletion of existing archives.
---

# Recorder v4 on worker-2

V4 replaces the recorder's format and service, while reusing worker-2's existing Node 20 and SSH setup. It does not update the fleet checkout or restart backtest workers. The [V4 guide](./recorder-v4) describes the format, feed coverage and commands. Previous V3 deployment evidence remains in the [historical worker-2 report](./recorder-v3-worker-2-validation).

## Separate installation

Use these V4 paths, leaving their existing V3 counterparts intact:

| Purpose | V4 location |
| --- | --- |
| Release root | `/Users/worker-2/Services/polymarket-recorder-v4/releases/<commit>` |
| Explicit configuration | `/Users/worker-2/.config/polymarket-recorder-v4/production.env` |
| Durable spool | `/Users/worker-2/Library/Application Support/polymarket-recorder-v4/spool` |
| Logs | `/Users/worker-2/Library/Logs/polymarket-recorder-v4/recorder.log` |
| LaunchDaemon label | `com.polymarket.recorder-v4` |
| R2 production prefix | `recorder-v4` |
| Validation prefix | `recorder-v4/validation/<unique-run-id>` |

The SSH alias is `worker-2-ansible`. The existing Node binary is `/Users/worker-2/.nvm/versions/node/v20.20.2/bin/node`; verify its version before use. Never put the recorder in `/Users/worker-2/Sites/polymarket-bot`, which belongs to the backtest fleet. A pinned release means the service continues using that tested commit even while other checkouts change.

## Prepare before switching services

1. Merge the reviewed V4 PR after all required checks pass. Choose its exact commit SHA.
2. Create a separate release checkout at that SHA and run `npm ci` with Node 20. Do not reuse or replace the fleet's `node_modules`. Verify the resulting HEAD and lockfile. If GitHub SSH is unavailable, a checksum-verified Git bundle can transfer the commit without bypassing SSH host-key checks.
3. Create the V4 configuration, spool and log directories owned by `worker-2`. Copy only the allowlisted feed/R2 credentials and Redis URL into a new mode-0600 configuration file. Never copy wallet/private-key fields or overwrite the V3 configuration.
4. Set `RECORDER_ID=worker-2-btc-v4`, `RECORDER_TIMEFRAMES=5m,15m`, `RECORDER_R2_PREFIX=recorder-v4`, and the exact V4 spool path above. Use the existing dashboard Redis. Keep the production 20 GiB free-space floor and 20 GiB spool limit unless measured requirements justify another explicit configuration.
5. Run a bounded controlled capture from the new release, initially with `--no-upload`, a separate validation spool and dashboard identity. Include a complete 15m market and a complete 5m market, their boundaries and finalization grace. Running two recorders concurrently adds feed traffic; keep overlap bounded.
6. Verify both durations using `record:v4:verify`. Upload only under the dedicated V4 validation prefix, read back full objects, download into a fresh validation cache and compare deterministic replay digests. Verify ordinary admission, gap rejection and explicit outage replay using the captured coverage. Resolve any unexplained differences before activation.
7. Render `ops/macos/recorder-v4/com.polymarket.recorder-v4.plist.template` with the exact user, Node binary, pinned release, environment file and log directory. Validate it with `plutil -lint`. Record the commit and paths used.

## Controlled service switch

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

V4 is running from the tested release; V3 is unloaded and persistently disabled. Both durations, all six feeds, the production R2 paths, archive read-back, local event cleanup and replay were checked after activation. See the validation report for startup partials and complete controlled captures. The primary dashboard and fleet checkouts were left unchanged and require the merged V4 code before displaying V4 status or dispatching V4 backtests. Do not rerun the initial activation command on an already loaded service.

For a future prepared installation, enter the administrator password only in the terminal. Command failure or HUP/INT/TERM during the switch attempts to disable V4 and restore the prior V3 service. Preserve both spools and inspect launchd status if installation fails; do not resolve a service issue by deleting R2 data.

## Updates and rollback

Prepare a new pinned V4 release, install its dependencies and validate it before changing the service. Stop the service before replacing the rendered plist. Keep the V4 spool outside releases so it survives updates.

If V4 startup or validation fails, first run `sudo launchctl disable system/com.polymarket.recorder-v4` and boot out its loaded service. Preserve its spool, plist and objects. If temporary V3 capture is desired, run `sudo launchctl enable system/com.polymarket.recorder-v3` and bootstrap `/Library/LaunchDaemons/com.polymarket.recorder-v3.plist` with its original pinned release and original V3 spool. Explicitly disabling V4 and enabling V3 also makes that rollback persist across reboots. V4 intentionally does not read those old archives. Never point either version at the other's state.

Do not use `rclone sync`, `aws s3 sync --delete`, bucket-wide cleanup, lifecycle changes, or an R2 delete command for this rollout. V4's storage adapter exposes GET/LIST/conditional PUT only, confined to `recorder-v4/`. Existing data outside that prefix is not part of the installation or rollback.
