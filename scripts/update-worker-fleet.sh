#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

INVENTORY="${ANSIBLE_INVENTORY:-$REPO_DIR/ops/ansible/inventory.ini}"
PLAYBOOK="$REPO_DIR/ops/ansible/update-workers.yml"

if [ ! -f "$INVENTORY" ]; then
  echo "[update-worker-fleet] missing inventory: $INVENTORY" >&2
  echo "[update-worker-fleet] copy ops/ansible/inventory.example.ini to ops/ansible/inventory.ini and edit hosts." >&2
  exit 1
fi

exec ansible-playbook -i "$INVENTORY" "$PLAYBOOK" "$@"
