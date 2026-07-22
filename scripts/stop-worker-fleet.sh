#!/usr/bin/env bash
set -euo pipefail

# Stops the managed backtest worker session on every fleet machine.
#
# Default is graceful: Ctrl-C makes each worker drain its in-flight market
# jobs, then the session exits on its own. Sessions still alive after the
# grace period are killed and reported distinctly.
#
# Usage:
#   npm run fleet:stop
#   npm run fleet:stop -- --limit worker-1
#   npm run fleet:stop -- -e stop_grace_seconds=300
#   npm run fleet:stop -- -e stop_force=true      # kill immediately, no drain

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

INVENTORY="${ANSIBLE_INVENTORY:-$REPO_DIR/ops/ansible/inventory.ini}"
PLAYBOOK="$REPO_DIR/ops/ansible/stop-workers.yml"
ANSIBLE_CONFIG_FILE="${ANSIBLE_CONFIG:-$REPO_DIR/ops/ansible/ansible.cfg}"

if [ ! -f "$INVENTORY" ]; then
  echo "[fleet-stop] missing inventory: $INVENTORY" >&2
  echo "[fleet-stop] copy ops/ansible/inventory.example.ini to ops/ansible/inventory.ini and edit hosts." >&2
  exit 1
fi

source "$SCRIPT_DIR/lib/fleet-lock.sh"
acquire_fleet_lock "fleet:stop"

started_at="$(date +%s)"
rm -f /tmp/fleet-stop-summary.txt
set +e
ANSIBLE_CONFIG="$ANSIBLE_CONFIG_FILE" ansible-playbook -i "$INVENTORY" "$PLAYBOOK" "$@"
code=$?
set -e

if [ -f /tmp/fleet-stop-summary.txt ]; then
  echo
  cat /tmp/fleet-stop-summary.txt
fi

elapsed=$(( $(date +%s) - started_at ))
printf '[fleet-stop] elapsed=%02d:%02d:%02d\n' $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60))
exit "$code"
