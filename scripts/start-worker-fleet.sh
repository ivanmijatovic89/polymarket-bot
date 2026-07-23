#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

INVENTORY="${ANSIBLE_INVENTORY:-$REPO_DIR/ops/ansible/inventory.ini}"
UPDATE_PLAYBOOK="$REPO_DIR/ops/ansible/update-workers.yml"
START_PLAYBOOK="$REPO_DIR/ops/ansible/start-workers.yml"
ANSIBLE_CONFIG_FILE="${ANSIBLE_CONFIG:-$REPO_DIR/ops/ansible/ansible.cfg}"

if [ ! -f "$INVENTORY" ]; then
  echo "[start-worker-fleet] missing inventory: $INVENTORY" >&2
  echo "[start-worker-fleet] copy ops/ansible/inventory.example.ini to ops/ansible/inventory.ini and edit hosts." >&2
  exit 1
fi

BRANCH_ARG=()
if [ "${1:-}" = "--branch" ]; then
  if [ -z "${2:-}" ]; then
    echo "[start-worker-fleet] --branch needs a branch name" >&2
    exit 1
  fi
  BRANCH_ARG=(-e "backtest_branch=$2")
  shift 2
fi

source "$SCRIPT_DIR/lib/fleet-lock.sh"
acquire_fleet_lock "fleet:start"

started_at="$(date +%s)"
set +e
echo "[start-worker-fleet] phase=update"
ANSIBLE_CONFIG="$ANSIBLE_CONFIG_FILE" ansible-playbook -i "$INVENTORY" "$UPDATE_PLAYBOOK" ${BRANCH_ARG[@]+"${BRANCH_ARG[@]}"} "$@"
code=$?
if [ "$code" -eq 0 ]; then
  echo "[start-worker-fleet] phase=start"
  ANSIBLE_CONFIG="$ANSIBLE_CONFIG_FILE" ansible-playbook -i "$INVENTORY" "$START_PLAYBOOK" ${BRANCH_ARG[@]+"${BRANCH_ARG[@]}"} "$@"
  code=$?
else
  echo "[start-worker-fleet] update failed - skipping start phase" >&2
fi
set -e
finished_at="$(date +%s)"
elapsed=$((finished_at - started_at))
printf '[start-worker-fleet] elapsed=%02d:%02d:%02d exit=%d\n' \
  $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60)) "$code"
exit "$code"
