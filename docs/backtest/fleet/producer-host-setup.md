---
title: Set Up the Producer Host
description: Configure the Mac that hosts MySQL and Redis to recover automatically after a power failure and start its backtest worker at boot.
---

# Set Up the Producer Host

The producer host is the always-on Mac that provides the shared infrastructure
for the backtest fleet. In the current setup, Worker1 has three roles:

- MySQL host for backtest results and application data.
- Redis host for BullMQ queues and worker coordination.
- Backtest worker for the `markets` and `aggregate` queues.

`data:sync:main` is intentionally **not** started automatically. Run it manually
when upstream data should be synchronized:

```bash
npm run data:sync:main -- --market btc:15m
```

## What this setup provides

After a power failure, the intended startup sequence is:

```text
Power returns
  -> macOS starts automatically
  -> launchd starts MySQL and Redis before desktop login
  -> macOS logs in as worker-1 and Tailscale starts
  -> the worker boot helper waits for ports 3306 and 6379
  -> the polymarket-backtest-worker tmux session starts
```

The worker helper is idempotent. If the tmux session already exists, it exits
without starting a duplicate. It is not a permanent `KeepAlive` supervisor, so
an intentional `npm run fleet:stop` remains stopped until the next explicit
start or machine boot.

## Important scope

The installer configures startup only. It does **not**:

- Install Homebrew, MySQL, Redis, Node.js, or tmux.
- Copy or restore MySQL or Redis data.
- Change database users, passwords, Redis configuration, or `.env` values.
- Disable FileVault or configure automatic login.
- Start `data:sync:main`.

Before using it, MySQL and Redis must already work locally with the desired data
and configuration.

## 1. Check the machine

Run on the producer host:

```bash
pmset -g custom | grep autorestart
fdesetup status
brew services list
```

Enable automatic restart after a power failure if necessary:

```bash
sudo pmset -a autorestart 1
```

Expected output includes:

```text
autorestart          1
```

FileVault affects unattended recovery. With FileVault off, macOS can finish
booting without a disk-unlock password. With FileVault on, the Mac may power on
but wait for the disk to be unlocked before the services can start.

For fully unattended recovery, confirm that FileVault is off:

```bash
fdesetup status
```

Then open:

```text
System Settings → Users & Groups
```

Set **Automatically log in as** to `worker-1` and enter the account password.
This login is required because Tailscale's macOS application starts with the
desktop user session. MySQL, Redis, and the system worker helper do not depend on
desktop login.

Verify automatic login without displaying its credential:

```bash
defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser
test -f /etc/kcpassword && echo "Automatic-login credential exists"
```

Expected output identifies `worker-1` and confirms the credential exists. Never
display or copy the contents of `/etc/kcpassword`.

::: warning Physical access
With FileVault off and automatic login enabled, anyone with physical access can
restart Worker1 and access its desktop. Use this setup only when the dedicated
producer host is physically secure.
:::

## 2. Install the required software

Skip packages that are already installed:

```bash
brew install mysql@8.4 redis tmux
```

Start and configure MySQL and Redis normally first. Confirm both ports are
available before installing their boot services:

```bash
nc -z 127.0.0.1 3306 && echo "MySQL is reachable"
nc -z 127.0.0.1 6379 && echo "Redis is reachable"
```

## 3. Review the boot-service files

Worker1 uses the files in
[`ops/macos/worker-1`](https://github.com/ivanmijatovic89/polymarket-bot/tree/main/ops/macos/worker-1):

| File | Purpose |
| --- | --- |
| [`install.zsh`](https://github.com/ivanmijatovic89/polymarket-bot/blob/main/ops/macos/worker-1/install.zsh) | Installs and activates all three system boot services. |
| [`com.polymarket.mysql84.plist`](https://github.com/ivanmijatovic89/polymarket-bot/blob/main/ops/macos/worker-1/com.polymarket.mysql84.plist) | Runs MySQL 8.4 as `worker-1` at system boot. |
| [`com.polymarket.redis.plist`](https://github.com/ivanmijatovic89/polymarket-bot/blob/main/ops/macos/worker-1/com.polymarket.redis.plist) | Runs Redis as `worker-1` at system boot. |
| [`com.polymarket.backtest-worker.plist`](https://github.com/ivanmijatovic89/polymarket-bot/blob/main/ops/macos/worker-1/com.polymarket.backtest-worker.plist) | Runs the one-shot worker boot helper as `worker-1`. |
| [`start-worker-at-boot.zsh`](https://github.com/ivanmijatovic89/polymarket-bot/blob/main/ops/macos/worker-1/start-worker-at-boot.zsh) | Waits for MySQL and Redis, then starts the managed tmux worker. |

The current files assume:

```text
macOS user:  worker-1
repository:  /Users/worker-1/Sites/polymarket-bot
tmux binary: /opt/homebrew/bin/tmux
queues:      markets,aggregate
```

Update every affected path and username before using these files on a different
producer machine.

## 4. Install the boot services

Run on Worker1 from the repository root:

```bash
chmod +x ops/macos/worker-1/install.zsh ops/macos/worker-1/start-worker-at-boot.zsh
./ops/macos/worker-1/install.zsh
```

Enter the Worker1 administrator password when macOS requests it. The installer:

1. Copies the launchd definitions into `/Library/LaunchDaemons`.
2. Moves MySQL and Redis from login-time Homebrew services to system boot
   services.
3. Waits for each service to return before continuing.
4. Registers the backtest worker boot helper.

The MySQL and Redis processes still run as the `worker-1` user, preserving
ownership of their existing Homebrew data directories.

::: warning Brief service interruption
Running the installer restarts MySQL and Redis. Do it when no important
backtests or data synchronization jobs are active.
:::

## 5. Verify the live setup

The user-level Homebrew services should now show `none`; this is expected
because launchd manages the system-level jobs:

```bash
brew services list
```

Inspect the system services:

```bash
sudo launchctl print system/com.polymarket.mysql84
sudo launchctl print system/com.polymarket.redis
sudo launchctl print system/com.polymarket.backtest-worker
```

Expected state:

- MySQL: `state = running`.
- Redis: `state = running`.
- Backtest boot helper: `state = not running` and `last exit code = 0` after it
  starts or finds the tmux session. The helper is intentionally one-shot.

Confirm connectivity and worker uniqueness:

```bash
nc -z 127.0.0.1 3306
nc -z 127.0.0.1 6379
tmux has-session -t polymarket-backtest-worker
ps -axo command | grep -c '[b]ash ./scripts/run-worker.sh --queues markets,aggregate'
```

The last command should print `1`.

From the main MacBook, verify the fleet view:

```bash
npm run fleet:status -- --limit worker-1
```

## 6. Test recovery

Test in this order:

1. Confirm that no important backtest or sync job is running.
2. Reboot Worker1 normally.
3. Wait for SSH to return, then repeat the verification commands above.
4. Confirm that the other machines can query MySQL and Redis through Worker1's
   Tailscale address.
5. Only after the normal reboot succeeds, perform a controlled power-loss test:
   disconnect Worker1's power, wait approximately 30 seconds, and reconnect it.

Worker1 hosts the shared MySQL and Redis services, so Worker2 and other machines
will temporarily lose their database and queue connections while it reboots.

### Verified Worker1 recovery

The setup was verified with both a normal reboot and a real power interruption:

- macOS powered on and logged in as `worker-1` automatically.
- MySQL and Redis started as system services without desktop-login dependency.
- Tailscale returned without manual interaction.
- The `markets,aggregate` worker started exactly once.
- MySQL queries and Redis `PING` succeeded from the main MacBook through
  Worker1's Tailscale address.

During the physical power-loss test, Tailscale returned approximately 31 seconds
after boot and the managed backtest worker returned approximately 34 seconds
after boot. These timings are observations, not fixed startup delays.

## Logs and troubleshooting

Worker boot logs:

```bash
tail -n 100 logs/workers/worker-1-boot.log
tail -n 100 logs/workers/polymarket-backtest-worker.log
```

Redis logs:

```bash
tail -n 100 /opt/homebrew/var/log/redis.log
```

MySQL errors are stored in the MySQL data directory:

```bash
ls -1 /opt/homebrew/var/mysql/*.err
tail -n 100 /opt/homebrew/var/mysql/*.err
```

If the worker does not start, verify MySQL and Redis first. The boot helper will
not create the tmux session until both local ports are reachable.

## Environment routing

On the producer host, local services should use loopback addresses:

```dotenv
DATABASE_HOST=localhost
REDIS_URL=redis://...@localhost:6379
```

Sibling workers and the main MacBook should use Worker1's Tailscale address for
`DATABASE_HOST` and `REDIS_URL`. Do not copy the producer's complete `.env` to
markets-only workers; give each machine only the credentials required by its
role.
