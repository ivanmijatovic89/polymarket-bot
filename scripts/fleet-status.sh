#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

INVENTORY="${ANSIBLE_INVENTORY:-$REPO_DIR/ops/ansible/inventory.ini}"
PLAYBOOK="$REPO_DIR/ops/ansible/status-workers.yml"
ANSIBLE_CONFIG_FILE="${ANSIBLE_CONFIG:-$REPO_DIR/ops/ansible/ansible.cfg}"

if [ ! -f "$INVENTORY" ]; then
  echo "[fleet-status] missing inventory: $INVENTORY" >&2
  echo "[fleet-status] copy ops/ansible/inventory.example.ini to ops/ansible/inventory.ini and edit hosts." >&2
  exit 1
fi

ANSIBLE_CONFIG="$ANSIBLE_CONFIG_FILE" ansible-playbook -i "$INVENTORY" "$PLAYBOOK" "$@"
