#!/bin/zsh

set -euo pipefail

readonly artifact_dir="${0:A:h}"
readonly daemon_dir="/Library/LaunchDaemons"
readonly helper_path="/usr/local/libexec/polymarket-start-worker-1-at-boot"

print "Administrator access is required to install boot services."
sudo -v

sudo /bin/mkdir -p /usr/local/libexec
sudo /usr/bin/install -o root -g wheel -m 0755 \
  "${artifact_dir}/start-worker-at-boot.zsh" \
  "${helper_path}"

for plist in \
  com.polymarket.mysql84.plist \
  com.polymarket.redis.plist \
  com.polymarket.backtest-worker.plist; do
  sudo /usr/bin/install -o root -g wheel -m 0644 \
    "${artifact_dir}/${plist}" \
    "${daemon_dir}/${plist}"
done

print "Migrating MySQL from a login service to a boot service..."
/opt/homebrew/bin/brew services stop mysql@8.4
sudo /bin/launchctl bootout system/com.polymarket.mysql84 2>/dev/null || true
sudo /bin/launchctl bootstrap system "${daemon_dir}/com.polymarket.mysql84.plist"

for attempt in {1..30}; do
  /usr/bin/nc -z 127.0.0.1 3306 && break
  (( attempt == 30 )) && { print -u2 "MySQL did not become ready"; exit 1; }
  /bin/sleep 1
done

print "Migrating Redis from a login service to a boot service..."
/opt/homebrew/bin/brew services stop redis
sudo /bin/launchctl bootout system/com.polymarket.redis 2>/dev/null || true
sudo /bin/launchctl bootstrap system "${daemon_dir}/com.polymarket.redis.plist"

for attempt in {1..30}; do
  /usr/bin/nc -z 127.0.0.1 6379 && break
  (( attempt == 30 )) && { print -u2 "Redis did not become ready"; exit 1; }
  /bin/sleep 1
done

print "Installing the backtest worker boot service..."
/bin/mkdir -p /Users/worker-1/Sites/polymarket-bot/logs/workers
sudo /bin/launchctl bootout system/com.polymarket.backtest-worker 2>/dev/null || true
sudo /bin/launchctl bootstrap system "${daemon_dir}/com.polymarket.backtest-worker.plist"

print "Installation completed."
