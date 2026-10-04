---
title: Recorder v3 — worker-2 installation
description: Reuse the existing fleet host while keeping recorder releases, credentials, state, and service independent of backtest updates.
---

# Recorder v3 — worker-2 installation

Worker-2 is already a configured fleet machine. Reuse its SSH access, macOS account, installed Node 20, network access, and power settings. Give the recorder a separate pinned checkout, dependency directory, configuration, spool, and launchd service. No VM, container, additional server, or second fleet worker is needed.

This is installation guidance, not a record of completed deployment. The October 4 inspection was read-only; no dependencies, recorder files, or service were installed on worker-2. Its running tests were left untouched.

## Why a separate checkout is useful

The backtest checkout at `/Users/worker-2/Sites/polymarket-bot` belongs to the fleet. `scripts/run-worker.sh` can fetch/pull and reinstall dependencies when a job needs newer code. Fleet update commands also operate on that checkout and can restart its backtest session. Sharing those changing files with a continuously running recorder would make its loaded code and later compression subprocesses depend on unrelated fleet updates.

Use an independent Git clone for each recorder release and install its own dependencies. Do not symlink `node_modules` from the fleet checkout. [npm ci](https://docs.npmjs.com/cli/v10/commands/npm-ci) removes an existing dependency directory before installing from the lockfile; run it only in a new recorder release directory. Release pinning protects files and dependency versions. It does not reserve CPU, RAM, disk, or bandwidth on the shared machine.

The recorder is not a BullMQ backtest worker. It needs neither `run-worker.sh` nor a new fleet inventory entry. Reuse the dashboard's Redis endpoint through `RECORDER_REDIS_URL`; Redis is for status publication, not recorder job execution.

## Read-only inspection: October 4, 2026, 21:41–21:43 UTC

| Item                        | Observed state                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Host                        | Mac mini M4, 10 cores, 16 GiB RAM; macOS 26.6.2                                        |
| Fleet checkout              | `main` at `0bcdc81c07f8a1e760df8c515da50188fca8f082`, tracked files clean              |
| Active sessions             | `polymarket-backtest-worker`, `polymarket-global-runtime`                              |
| Backtest concurrency        | Explicitly **6**; machine registry default is **8**                                    |
| Node used by active worker  | `/Users/worker-2/.nvm/versions/node/v20.20.2/bin/node`                                 |
| Other/default Node          | `/Users/worker-2/.local/bin/node`, v26.8.1                                             |
| Load                        | Approximately 9.3 / 9.6 / 9.6 across the three load averages                           |
| CPU                         | Short samples approximately 78–83% busy; six compute processes active                  |
| Memory                      | Approximately 15 GiB used, 1.95 GiB compressed, 710 MiB swap allocated                 |
| Free disk                   | Approximately 95.3 GiB on the data volume                                              |
| Power settings              | Sleep and disk sleep disabled; powernap off; restart after power loss enabled          |
| Backtest boot service       | Installed; one-shot helper exited successfully, tmux worker continues running          |
| Recorder service            | Not installed/loaded                                                                   |
| Redis and R2                | Existing configuration fields present; endpoint TCP connections succeeded              |
| Public feed endpoints       | TLS connections succeeded for market WS, PolyBolt, Binance, Gamma, and website PTB     |
| Polymarket feed credentials | No supported CLOB/Polymarket credential fields in the worker checkout's `.env`         |
| Administrator access        | Noninteractive `sudo` requested a password; network-time settings could not be queried |

These short samples are not a recording benchmark. Allocated swap alone does not prove active swapping; the two-second sample showed no new swap-in/out. Successful TCP/TLS handshakes do not establish authenticated feed access, Redis publication permission, R2 upload/read-back permission, or PTB availability. No credential values were printed.

The installed backtest boot helper does not explicitly pin Node 20. Its eventual shell selection must be checked separately before a planned reboot; the currently running worker was confirmed to use Node 20. Do not run that installer, reboot, or change fleet concurrency as part of recorder preparation. The recorder service below names its Node executable explicitly.

## Stage 1: prepare when the current test workload has headroom

The initial inspection found a busy machine. Finish the current test batch or arrange a separate capacity decision before dependency installation or the recording validation. Do not infer spare capacity from the recorder's earlier laptop measurements. Keep the current six-worker setting during the first controlled coexistence check; if receipt delays, CPU contention, or memory pressure are unacceptable, drain work and explicitly choose a smaller backtest allocation before trying again.

The commands below run **on worker-2 as `worker-2`**, with no fleet update command. This revision is the recorder implementation whose CI and local capture/replay validation passed:

```bash
set -euo pipefail
umask 077
recorder_revision=d6fdb59a581e8608085ef78eed284a428012bae1
recorder_root=/Users/worker-2/Services/polymarket-recorder
recorder_release="$recorder_root/releases/$recorder_revision"
recorder_config=/Users/worker-2/.config/polymarket-recorder
recorder_state='/Users/worker-2/Library/Application Support/polymarket-recorder'
recorder_node=/Users/worker-2/.nvm/versions/node/v20.20.2/bin/node
export PATH="$(dirname "$recorder_node"):/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
"$recorder_node" --version

mkdir -p "$recorder_root/releases" "$recorder_config" \
  "$recorder_state/spool" "$recorder_state/validation-spool" "$recorder_state/logs"
chmod 700 "$recorder_config" "$recorder_state"

# A new independent clone: this command must not target the backtest checkout.
git clone --no-checkout git@github.com:ivanmijatovic89/polymarket-bot.git "$recorder_release"
git -C "$recorder_release" checkout --detach "$recorder_revision"
test "$(git -C "$recorder_release" rev-parse HEAD)" = "$recorder_revision"
cd "$recorder_release"
HUSKY=0 npm ci --no-audit --no-fund
"$recorder_node" --import tsx src/cli/record-v3.ts --help
```

The path and revision assignments above are reused in subsequent blocks; keep the same shell or set them again. If the release directory already exists, inspect its identity and contents instead of deleting it or rerunning installation underneath a running recorder. Keep the default Node version unchanged. Do not omit development dependencies: this deployment uses `tsx` from the locked install. Dashboard/WebUI builds and the entire test suite belong in CI/local validation, not on the loaded recorder host.

GitHub authentication for this independent clone remains a deployment check. If unavailable on worker-2, transfer a verified source release from the control machine without including its `.env`, data, or dependency directories; do not repurpose the running fleet checkout.

## Stage 2: dedicated configuration

Create `$recorder_config/production.env` with mode `0600`. Fill values through a trusted local editor or a secure, allowlisted transfer from the existing tested configuration. Do not copy or source the complete trading `.env`.

```dotenv
RECORDER_ID=worker-2-btc
RECORDER_TIMEFRAMES=5m,15m
RECORDER_SPOOL_DIR="/Users/worker-2/Library/Application Support/polymarket-recorder/spool"
RECORDER_UPLOAD=true
RECORDER_R2_PREFIX=recorder-v3
RECORDER_MAX_SPOOL_BYTES=21474836480
RECORDER_MIN_FREE_BYTES=21474836480
RECORDER_MAX_PENDING_BYTES=16777216
RECORDER_STATUS_ENABLED=true
RECORDER_REDIS_URL=replace-with-existing-dashboard-redis-url

POLYMARKET_API_KEY=replace-with-tested-feed-api-key
POLYMARKET_API_SECRET=replace-with-tested-feed-api-secret
POLYMARKET_API_PASSPHRASE=replace-with-tested-feed-api-passphrase

R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET=replace-me
R2_ACCESS_KEY_ID=replace-me
R2_SECRET_ACCESS_KEY=replace-me
```

The recorder needs CLOB credentials to authenticate PolyBolt, but no wallet/private key, database settings, or trading process. Existing worker R2 credentials may be read-only; confirm that the selected recorder credentials can upload and read back objects under its prefixes. Configure authenticated dashboard publication with the same Redis used by the dashboard. Keep credentials out of Git, shell history, command arguments, and logs.

Create a separate `$recorder_config/validation.env` containing the same required credentials, but change these fields:

```dotenv
RECORDER_ID=worker-2-btc-validation
RECORDER_SPOOL_DIR="/Users/worker-2/Library/Application Support/polymarket-recorder/validation-spool"
RECORDER_R2_PREFIX=recorder-v3-validation/worker-2-UNIQUE_RUN_ID
RECORDER_MAX_SPOOL_BYTES=2147483648
```

Replace `UNIQUE_RUN_ID` with a fresh UUID or timestamp. Keep the 20 GiB free-space floor. Verify both files are `0600` and contain no `RECORDER_DURATION_SECONDS` in the production file. Exported variables override file values; the foreground command below uses a clean environment to make the selected file authoritative.

The initial production spool limit is 20 GiB, with a 20 GiB filesystem free-space floor. These are stop thresholds, not reserved disk capacity or retention targets. Uploaded event files are deleted only after verified archival. Pending uploads, unfinished journals, and small operational/resolution metadata remain as required. Backtest download caches are separate and are not managed by recorder cleanup.

## Stage 3: clock and bounded validation

Before recording, an administrator should confirm automatic network time is enabled and the clock is synchronized. The read-only inspection could not query the setting through passwordless sudo:

```bash
sudo systemsetup -getusingnetworktime
sudo systemsetup -getnetworktimeserver
```

Do not change the clock while capture is running. Then run both durations in a bounded foreground session:

```bash
cd "$recorder_release"
env -i HOME=/Users/worker-2 USER=worker-2 LOGNAME=worker-2 \
  PATH="$(dirname "$recorder_node"):/usr/bin:/bin:/usr/sbin:/sbin" \
  "$recorder_node" --import tsx src/cli/record-v3.ts \
  --env-file "$recorder_config/validation.env" --duration-seconds 2100
```

Run the foreground session from the worker console or a dedicated tmux session named `polymarket-recorder-validation`, never from the backtest session. A clean 35-minute interval can include a complete 15m market, several 5m markets, and finalization grace. If testing recovery interrupts it, extend the observation until both durations have a complete subsequent market. Stop the foreground process with Ctrl+C, allow shutdown to finish, and restart with the same validation spool. Do not run simultaneous owners of either spool.

Validate real authenticated subscriptions, exact opening references and website comparisons, coverage gaps, market rotation, shutdown/restart, and dashboard status. Measure the ingestion process **and** its compression child under the intended backtest load. The child has a 512 MiB V8 old-space limit, not a 512 MiB total memory cap; [Node memory metrics](https://nodejs.org/docs/latest-v20.x/api/process.html#processmemoryusage) distinguish RSS, heap, and native/external memory.

The deployment gate requires no unexplained local clock/event-loop gaps, no growing archive backlog or resource-stop condition, and acceptable coexistence with the running jobs. Upstream feed/PTB gaps remain recorded and assessed separately; a connected socket or successful shell exit is insufficient. The capture clock monitor flags pauses over two seconds and wall/monotonic-clock disagreement over 250 ms; those are detection thresholds, not acceptable latency targets.

From the control/backtest machine, use the [archive download and backtest commands](./recorder-v3#find-and-download-archived-markets) to download the validation prefix into an independent cache. Verify every package, replay complete 5m and 15m markets with the needed feeds, inspect saved backtest results, and confirm that the worker spool's archived event files have been deleted only after matching verified archive receipts. Exercise resolution sidecar refresh as results become available. This keeps replay verification CPU off worker-2 during recording.

## Stage 4: render and install the recorder service

Proceed only after the bounded validation is complete and its process has stopped. Production uses its own spool and the prefix `recorder-v3`. The existing template runs the recorder directly with an explicit Node executable; it does not invoke a login shell, NVM default, tmux worker launcher, or fleet updater.

Render without activating anything:

```bash
recorder_plist="$recorder_root/com.polymarket.recorder-v3.plist"
sed \
  -e 's|__USER__|worker-2|g' \
  -e "s|__NODE20__|$recorder_node|g" \
  -e "s|__CHECKOUT__|$recorder_release|g" \
  -e "s|__ENV_FILE__|$recorder_config/production.env|g" \
  -e "s|__LOG_DIR__|$recorder_state/logs|g" \
  "$recorder_release/ops/macos/recorder-v3/com.polymarket.recorder-v3.plist.template" \
  > "$recorder_plist"
plutil -lint "$recorder_plist"
```

Review the rendered paths, user, label, and log destination. The substitutions above use the fixed paths in this guide; XML-special characters in alternative paths require proper XML escaping. Confirm the source revision, dependency install, config permissions, log/spool ownership, available space, and absence of another recorder process before activation.

The following administrator commands **install and start** the service immediately because the template has `RunAtLoad`. They require interactive administrator authentication on this machine; do not send the password through chat or place it in a command:

```bash
sudo install -o root -g wheel -m 0644 "$recorder_plist" \
  /Library/LaunchDaemons/com.polymarket.recorder-v3.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.polymarket.recorder-v3.plist
launchctl print system/com.polymarket.recorder-v3
```

Use this first-install block only when that service is absent. A loaded service must be stopped/unloaded before replacing its definition. Never use `ops/macos/worker-2/install.zsh` for the recorder: it installs the backtest service and has unrelated power/login prerequisites.

The recorder has its own label, `com.polymarket.recorder-v3`. Failed exits are retried with a 60-second throttle; a successful clean stop remains stopped until explicitly started or the service loads again. The backtest boot helper is a different one-shot service: its `state = not running`, `last exit code = 0` can be healthy while tmux jobs continue.

After activation, check **More → Recorders**, the production spool's `status.json`, service PID/revision, current feed arrivals, both market durations, and production R2 objects. Dashboard status is the selected monitoring channel; there are no Slack notifications. The dashboard server itself must run a revision containing the recorder pages and opening-reference diagnostics; worker-2 only publishes status and does not need a dashboard build/server.

## Stop, update, and roll back

Signal only the recorder:

```bash
sudo launchctl kill SIGTERM system/com.polymarket.recorder-v3
```

Watch the log/status until shutdown finishes and the PID exits. Do not delete journals or force-clear a spool lock while a process is alive. After it has stopped, unload its definition before an update:

```bash
sudo launchctl bootout system/com.polymarket.recorder-v3
```

Prepare the next release in another directory with its own dependencies; keep one tested prior release for rollback. Stop and unload the service, render its plist for the new release, lint/install/bootstrap it, and confirm recovery and uploads using the unchanged production spool. A rollback uses the same sequence with the previous compatible release. Do not `git pull` or run `npm ci` inside a release used by an active recorder. Future releases that change spool/schema compatibility require their documented migration procedure.

Set an explicit log-rotation policy before leaving the installation unattended: the template writes `recorder.log` but does not cap or rotate it. A simple maintenance option is to stop the recorder cleanly, rotate/compress the closed log, then restart; coordinate this known capture gap. Retained log files are separate from unuploaded recordings. Preserve the configuration, spool, archive receipts, and pending resolution tasks during every update.

Reboot recovery and the real 24-hour resolution confirmation are later operational checks. Schedule any reboot when backtest jobs can safely finish. Do not interpret the current short inspection, successful TLS probes, or prior laptop soak as completion of worker-2 validation.
