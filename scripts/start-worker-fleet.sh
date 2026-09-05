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

# ansible-playbook exit codes are bit flags: 2 = one or more hosts failed,
# 4 = one or more hosts were unreachable. An offline machine must not stop the
# fleet: Ansible drops it from the play and finishes the reachable hosts, so
# the start phase still has work to do. Only a real failure (dirty tree, no
# fast-forward, missing repo) skips the start phase.
unreachable_only() {
  [ "$1" -ne 0 ] && [ $(($1 & ~4)) -eq 0 ]
}

started_at="$(date +%s)"
set +e
echo "[start-worker-fleet] phase=update"
ANSIBLE_CONFIG="$ANSIBLE_CONFIG_FILE" ansible-playbook -i "$INVENTORY" "$UPDATE_PLAYBOOK" ${BRANCH_ARG[@]+"${BRANCH_ARG[@]}"} "$@"
update_code=$?
code=$update_code
if [ "$update_code" -eq 0 ] || unreachable_only "$update_code"; then
  if unreachable_only "$update_code"; then
    echo "[start-worker-fleet] warning: some hosts were unreachable during update (see PLAY RECAP above) - continuing with the reachable ones" >&2
  fi
  echo "[start-worker-fleet] phase=start"
  ANSIBLE_CONFIG="$ANSIBLE_CONFIG_FILE" ansible-playbook -i "$INVENTORY" "$START_PLAYBOOK" ${BRANCH_ARG[@]+"${BRANCH_ARG[@]}"} "$@"
  start_code=$?
  # Keep both phases visible in the exit status: an unreachable host stays
  # reported (exit 4) even when every reachable worker started cleanly.
  code=$((update_code | start_code))
else
  echo "[start-worker-fleet] update failed - skipping start phase" >&2
fi
set -e
finished_at="$(date +%s)"
elapsed=$((finished_at - started_at))
printf '[start-worker-fleet] elapsed=%02d:%02d:%02d exit=%d\n' \
  $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60)) "$code"
exit "$code"
