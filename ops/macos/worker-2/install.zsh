#!/bin/zsh

set -euo pipefail

readonly artifact_dir="${0:A:h}"
readonly daemon_dir="/Library/LaunchDaemons"
readonly helper_path="/usr/local/libexec/polymarket-start-worker-2-at-boot"
readonly expected_user="worker-2"

if [[ "$(/usr/bin/fdesetup status)" != "FileVault is Off." ]]; then
  print -u2 "FileVault must be fully disabled before installing unattended startup."
  exit 1
fi

auto_login_user="$(/usr/bin/defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)"
if [[ "${auto_login_user}" != "${expected_user}" || ! -f /etc/kcpassword ]]; then
  print -u2 "Automatic login must be enabled for ${expected_user} before installation."
  exit 1
fi

print "Administrator access is required to install the boot service."
sudo -v

sudo /usr/bin/pmset -a autorestart 1
sudo /bin/mkdir -p /usr/local/libexec
sudo /usr/bin/install -o root -g wheel -m 0755 \
  "${artifact_dir}/start-worker-at-boot.zsh" \
  "${helper_path}"
sudo /usr/bin/install -o root -g wheel -m 0644 \
  "${artifact_dir}/com.polymarket.backtest-worker.plist" \
  "${daemon_dir}/com.polymarket.backtest-worker.plist"

/bin/mkdir -p /Users/worker-2/Sites/polymarket-bot/logs/workers
sudo /bin/launchctl bootout system/com.polymarket.backtest-worker 2>/dev/null || true
sudo /bin/launchctl bootstrap system "${daemon_dir}/com.polymarket.backtest-worker.plist"

print "Installation completed."
