#!/usr/bin/env bash
# Pair-protocol external watchdog (protocols/pair/VISION.md §Mission control).
# Runs OUTSIDE the agent loop (launchd) so a dead shift cannot silence its own
# alarm — the previous shift generation died silently and went unnoticed for a
# week.
#
# Checks, per agent:
#   - heartbeat: last commit touching agents/<a>/STATUS.md on origin/main
#     older than PAIR_HEARTBEAT_MAX_AGE_S (default 3h) → alert
#   - tmux session "pair-<a>" missing → alert
# Plus machine checks: free disk below PAIR_MIN_DISK_GB (default 15) → alert.
#
# Alerts: macOS notification always; push to phone via ntfy.sh when
# PAIR_NTFY_TOPIC is set (topic name = anything secret-ish you subscribe to in
# the ntfy app).
#
# Usage:
#   protocols/pair/scripts/watchdog.sh [agents...]        # one check pass (default: fable gpt)
#   protocols/pair/scripts/watchdog.sh --install [agents...]  # install launchd job (every 15 min)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HEARTBEAT_MAX_AGE_S="${PAIR_HEARTBEAT_MAX_AGE_S:-10800}"
MIN_DISK_GB="${PAIR_MIN_DISK_GB:-15}"
NTFY_TOPIC="${PAIR_NTFY_TOPIC:-}"
PLIST="$HOME/Library/LaunchAgents/com.polymarket-bot.pair-watchdog.plist"

if [[ "${1:-}" == "--install" ]]; then
  shift
  AGENTS="${*:-fable gpt}"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.polymarket-bot.pair-watchdog</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string>
    <string>$ROOT/protocols/pair/scripts/watchdog.sh</string>
$(for a in $AGENTS; do echo "    <string>$a</string>"; done)
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/pair-watchdog.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/pair-watchdog.log</string>
$([[ -n "$NTFY_TOPIC" ]] && cat <<ENV_EOF
  <key>EnvironmentVariables</key><dict>
    <key>PAIR_NTFY_TOPIC</key><string>$NTFY_TOPIC</string>
  </dict>
ENV_EOF
)
</dict></plist>
PLIST_EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "[watchdog] installed launchd job (every 15 min) for agents: $AGENTS"
  echo "[watchdog] log: ~/Library/Logs/pair-watchdog.log"
  exit 0
fi

AGENTS=("${@:-fable gpt}")
[[ "${#AGENTS[@]}" -eq 1 && "${AGENTS[0]}" == "fable gpt" ]] && AGENTS=(fable gpt)

ALERTS=()

alert() { ALERTS+=("$1"); }

# --- per-agent checks ---------------------------------------------------------
cd "$ROOT"
git fetch origin main --quiet 2>/dev/null || alert "git fetch failed (network/auth?)"

NOW="$(date +%s)"
for a in "${AGENTS[@]}"; do
  status_path="protocols/pair/agents/${a}/STATUS.md"
  last_commit_ts="$(git log -1 --format=%ct "origin/main" -- "$status_path" 2>/dev/null || true)"
  if [[ -z "$last_commit_ts" ]]; then
    alert "agent '$a': no STATUS.md commits on origin/main yet"
  else
    age=$(( NOW - last_commit_ts ))
    if (( age > HEARTBEAT_MAX_AGE_S )); then
      alert "agent '$a': heartbeat stale $((age/3600))h$(( (age%3600)/60 ))m (STATUS.md last committed $(date -r "$last_commit_ts" '+%d %b %H:%M'))"
    fi
  fi
  if ! tmux has-session -t "pair-${a}" 2>/dev/null; then
    alert "agent '$a': tmux session 'pair-${a}' not running"
  fi
done

# --- machine checks -------------------------------------------------------------
free_gb="$(df -g / | awk 'NR==2 {print $4}')"
if (( free_gb < MIN_DISK_GB )); then
  alert "disk low: ${free_gb}GB free (< ${MIN_DISK_GB}GB)"
fi

# --- report -------------------------------------------------------------------
if [[ "${#ALERTS[@]}" -eq 0 ]]; then
  echo "[watchdog] $(date '+%F %T') all green (${AGENTS[*]})"
  exit 0
fi

MSG="pair watchdog: $(printf '%s; ' "${ALERTS[@]}")"
echo "[watchdog] $(date '+%F %T') ALERT: $MSG" >&2
osascript -e "display notification \"${MSG//\"/}\" with title \"pair watchdog\"" 2>/dev/null || true
if [[ -n "$NTFY_TOPIC" ]]; then
  curl -fsS -m 10 -d "$MSG" "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null || echo "[watchdog] ntfy push failed" >&2
fi
exit 1
