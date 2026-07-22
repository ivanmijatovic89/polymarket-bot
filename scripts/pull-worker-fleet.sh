#!/usr/bin/env bash
set -euo pipefail

# Fast code pull on every fleet machine: fetch + fast-forward the branch each
# worker is already on. No branch switching, no restart, no npm install —
# use `npm run fleet:update` for those.
#
# Usage:
#   npm run fleet:git:pull                                # pull the branch each worker is on
#   npm run fleet:git:pull -- --branch feat/my-branch     # switch the fleet, then pull
#   npm run fleet:git:pull -- --branch main --limit worker-1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

INVENTORY="${ANSIBLE_INVENTORY:-$REPO_DIR/ops/ansible/inventory.ini}"
PLAYBOOK="$REPO_DIR/ops/ansible/pull-workers.yml"
ANSIBLE_CONFIG_FILE="${ANSIBLE_CONFIG:-$REPO_DIR/ops/ansible/ansible.cfg}"

if [ ! -f "$INVENTORY" ]; then
  echo "[fleet-pull] missing inventory: $INVENTORY" >&2
  echo "[fleet-pull] copy ops/ansible/inventory.example.ini to ops/ansible/inventory.ini and edit hosts." >&2
  exit 1
fi

# bash 3.2 (macOS) treats "${arr[@]}" on an empty array as unbound under
# `set -u`, hence the ${arr[@]+...} guard at the call site below.
BRANCH_ARG=()
if [ "${1:-}" = "--branch" ]; then
  if [ -z "${2:-}" ]; then
    echo "[fleet-pull] --branch needs a branch name" >&2
    exit 1
  fi
  BRANCH_ARG=(-e "pull_branch=$2")
  shift 2
fi

source "$SCRIPT_DIR/lib/fleet-lock.sh"
acquire_fleet_lock "fleet:git:pull"

started_at="$(date +%s)"
rm -f /tmp/fleet-pull-summary.txt
set +e
ANSIBLE_CONFIG="$ANSIBLE_CONFIG_FILE" ansible-playbook -i "$INVENTORY" "$PLAYBOOK" ${BRANCH_ARG[@]+"${BRANCH_ARG[@]}"} "$@"
code=$?
set -e

if [ -f /tmp/fleet-pull-summary.txt ]; then
  echo
  cat /tmp/fleet-pull-summary.txt
fi

elapsed=$(( $(date +%s) - started_at ))
printf '[fleet-pull] elapsed=%02d:%02d:%02d\n' $((elapsed / 3600)) $(((elapsed % 3600) / 60)) $((elapsed % 60))
exit "$code"
