---
title: Install a Backtest Worker
description: Set up a Mac mini or sibling machine to run backtest worker jobs safely.
---

# Install a Backtest Worker

Use this guide to prepare a Mac mini or other sibling machine that only consumes
backtest market jobs. A markets-only worker needs Redis access and, when replay
data is read from R2, read-only R2 credentials. It does not need database
credentials or Polymarket trading keys.

To configure the always-on machine that hosts MySQL, Redis, and the producer,
see [Set Up the Producer Host](/backtest/fleet/producer-host-setup).

::: warning Keep worker checkouts clean
Long-running workers self-update with `git pull --ff-only`. Keep the worker on a
tracked branch with no local edits. Do experimental work in a separate checkout.
:::

## Prerequisites

- macOS with administrator access.
- Network access from your main machine to the worker, preferably through
  Tailscale.
- Access to the GitHub repository.
- A Redis URL shared with the producer.
- R2 credentials if workers will read parquet from R2.

## 1. Keep the Mac Awake

Run these commands on the worker:

```bash
sudo pmset -a sleep 0 displaysleep 10 disksleep 0
sudo pmset -a powernap 0
sudo pmset -a autorestart 1
pmset -g
```

Expected important values:

```text
sleep          0
displaysleep   10
disksleep      0
powernap       0
autorestart    1
```

## 2. Enable SSH Access

On the worker, check whether Remote Login is enabled:

```bash
sudo systemsetup -getremotelogin
```

If it is off, enable it in macOS:

```text
System Settings -> General -> Sharing -> Remote Login -> ON
```

Get the worker username and IP address:

```bash
whoami
ipconfig getifaddr en0
tailscale ip -4
```

From your main machine, test SSH:

```bash
ssh worker-1@xxx.xxx.xx.xx
```

Replace `worker-1` with the worker username and `xxx.xxx.xx.xx` with the
worker's Tailscale IP address.

## 3. Configure Passwordless SSH

Run these commands on your main machine, not on the worker.

Create a dedicated SSH key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_polymarket_macbook_to_workers -C "polymarket-macbook-to-workers"
```

Copy the public key to the worker:

```bash
cat ~/.ssh/id_ed25519_polymarket_macbook_to_workers.pub | ssh worker-1@xxx.xxx.xx.xx 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys'
```

Test the key:

```bash
ssh -i ~/.ssh/id_ed25519_polymarket_macbook_to_workers worker-1@xxx.xxx.xx.xx
```

Add a host alias to `~/.ssh/config` on the main machine:

```text
Host worker-1
    HostName xxx.xxx.xx.xx
    User worker-1
    IdentityFile ~/.ssh/id_ed25519_polymarket_macbook_to_workers
    IdentitiesOnly yes
```

Now connect with:

```bash
ssh worker-1
```

If SSH still asks for a password, inspect which key is offered:

```bash
ssh -v worker-1
```

Look for this key in the debug output:

```text
Offering public key: /Users/YOUR_USER/.ssh/id_ed25519_polymarket_macbook_to_workers
```

## 4. Install System Tools

Run these commands on the worker.

Install Homebrew:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Install Git, NVM, tmux, htop, and Tailscale:

```bash
brew install git nvm tmux htop
brew install --cask tailscale
open -a Tailscale
```

Configure NVM:

```bash
mkdir -p ~/.nvm
touch ~/.zprofile ~/.zshrc

grep -qxF 'eval "$(/opt/homebrew/bin/brew shellenv)"' ~/.zprofile || echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile

grep -qxF 'export NVM_DIR="$HOME/.nvm"' ~/.zshrc || cat <<'EOF' >> ~/.zshrc
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"
EOF

source ~/.zprofile
source ~/.zshrc
```

Install Node.js 20:

```bash
nvm install 20
nvm use 20
nvm alias default 20

node --version
npm --version
```

Optional shell prompt:

```bash
brew install starship
grep -qxF 'eval "$(starship init zsh)"' ~/.zshrc || echo 'eval "$(starship init zsh)"' >> ~/.zshrc
source ~/.zshrc
```

Optional history search with arrow keys:

```bash
cat >> ~/.zshrc <<'EOF'

# Up/down arrows search history matching the typed prefix
bindkey "^[[A" history-beginning-search-backward
bindkey "^[[B" history-beginning-search-forward
EOF

source ~/.zshrc
```

## 5. Clone the Project

Run these commands on the worker:

```bash
mkdir -p ~/Sites
cd ~/Sites

git clone https://github.com/ivanmijatovic89/polymarket-bot.git
cd polymarket-bot
```

If the repository already exists, update it instead:

```bash
cd ~/Sites/polymarket-bot
git pull --ff-only
```

## 6. Install Dependencies

Run these commands in the repository root on the worker:

```bash
npm ci
npm --prefix webui ci
```

## 7. Configure Worker Environment

Create `.env`:

```bash
cp .env.worker .env
```

Fill in only the values required by a markets-only worker:

```bash
REDIS_URL=redis://...

R2_ENDPOINT=...
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

Leave `DATABASE_*`, `PRIVATE_KEY`, and Polymarket API keys empty on a
markets-only worker. The aggregate worker writes final results to MySQL; sibling
market workers should only consume market replay jobs.

## 8. Verify the Install

Run:

```bash
npm run code:typecheck
npm run dashboard:build
```

## 9. Prewarm Replay Data

If the worker should use local replay files, prewarm converted Telonex parquet
from R2:

```bash
npm run telonex:download-converted-r2-to-local -- --symbol btc --timeframe 15m --converter delta-typed --concurrency 8
```

Skip this step when jobs use `--read-from r2` or
`--read-from local-or-download-from-r2-to-local`.

## 10. Start the Worker

Start a markets-only worker through the self-updating wrapper:

```bash
npm run worker:markets
```

Market concurrency defaults to this machine's `cores_for_backtest` from
`dashboard/src/data/machines.json` (else `cores - 2`); override it only after
the worker is verified:

```bash
npm run worker:markets -- --market-concurrency 8
```

Run aggregate workers only on machines that have database credentials:

```bash
npm run worker:markets-and-aggregate
```

## 11. Update Workers Proactively

Worker self-update is still the correctness fallback, but sibling workers can
also be updated before they receive a new-code job. The full workflow is in
[Worker Fleet Ansible](/backtest/fleet/update).

Copy the example inventory and edit it for your worker hosts:

```bash
cp ops/ansible/inventory.example.ini ops/ansible/inventory.ini
```

Then run:

```bash
npm run fleet:update
npm run fleet:start
```

The playbook manages a tmux session named `polymarket-backtest-worker` by
default. If a worker is currently running manually in another terminal or tmux
pane, stop that process once before switching to the managed session.

## 12. Enable Unattended Recovery

This optional setup allows a dedicated Mac worker to recover automatically after
a reboot or power outage.

The verified Worker2 implementation is stored in
[`ops/macos/worker-2`](https://github.com/ivanmijatovic89/polymarket-bot/tree/main/ops/macos/worker-2).

### Enable restart after power loss

Run:

```bash
sudo pmset -a autorestart 1
pmset -g custom | grep autorestart
```

Expected output:

```text
autorestart          1
```

### Disable FileVault

Automatic login is unavailable while FileVault is enabled.

Open:

```text
System Settings → Privacy & Security → FileVault
```

Select **Turn Off FileVault**, enter the administrator password, and wait until
the following command confirms completion:

```bash
fdesetup status
```

Expected output:

```text
FileVault is Off.
```

Disabling FileVault reduces protection against physical access. Use this setup
only for a dedicated worker in a physically secure location.

### Enable automatic login

Tailscale's macOS application starts after a desktop user logs in. Automatic
login is therefore required for unattended Tailscale recovery.

Open:

```text
System Settings → Users & Groups
```

Set **Automatically log in as** to the worker account and enter its password.

Verify:

```bash
defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser
test -f /etc/kcpassword && echo "Automatic-login credential exists"
```

Do not display or copy the contents of `/etc/kcpassword`.

### Install the worker boot service

The Worker2 files assume:

```text
macOS user:  worker-2
repository:  /Users/worker-2/Sites/polymarket-bot
queues:      markets
```

Update these values before using the files on another machine.

Install:

```bash
chmod +x ops/macos/worker-2/*.zsh
./ops/macos/worker-2/install.zsh
```

The installer:

1. Confirms FileVault is off.
2. Confirms automatic login is configured.
3. Confirms `autorestart 1`.
4. Installs a system launchd boot service.
5. Starts an idempotent boot helper.

At boot, the helper:

1. Reads `REDIS_URL` from the worker's `.env`.
2. Waits for Tailscale and the producer host's Redis.
3. Checks whether `polymarket-backtest-worker` already exists.
4. Starts a markets-only worker when necessary.
5. Verifies that the tmux session remains alive before reporting success.

The boot command does not hardcode concurrency:

```bash
./scripts/run-worker.sh --queues markets
```

`run-worker.sh` resolves `cores_for_backtest` from
`dashboard/src/data/machines.json`, falling back to `CPU cores - 2` for an
unknown machine.

### Verify

```bash
sudo launchctl print system/com.polymarket.backtest-worker
tmux has-session -t polymarket-backtest-worker
grep "market-concurrency not given" \
  logs/workers/polymarket-backtest-worker.log | tail -n 1
tail -n 100 logs/workers/worker-2-boot.log
```

The launchd helper is one-shot. After a successful start, this is expected:

```text
state = not running
last exit code = 0
```

The tmux worker continues running independently.

### Test recovery

1. Confirm there are no active backtest jobs.
2. Reboot the worker without manually logging in.
3. Verify Tailscale and the worker return automatically.
4. Perform a physical power-loss test only after the reboot test succeeds:
   unplug the worker, wait approximately 30 seconds, and restore power.
5. Verify that exactly one worker supervisor is running.

The boot helper does not use permanent `KeepAlive`, so an intentional
`npm run fleet:stop` remains stopped until an explicit start or the next boot.
