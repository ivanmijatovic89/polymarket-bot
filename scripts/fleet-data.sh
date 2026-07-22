#!/usr/bin/env bash
set -euo pipefail

# Runs data:sync:worker on every fleet machine via ansible.
#
# Usage:
#   npm run fleet:data -- btc:15m                        # one or more pairs, comma-separated
#   npm run fleet:data -- btc:15m --limit worker-1       # extra ansible args after the pairs
#   npm run fleet:data -- btc:15m -e data_sync_extra='--dry-run'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MARKETS="${1:-}"
if [ -z "$MARKETS" ]; then
  echo "usage: $0 <symbol:timeframe[,symbol:timeframe...]> [extra ansible-playbook args]" >&2
  echo "  e.g. $0 btc:15m" >&2
  exit 1
fi
shift

INVENTORY="${ANSIBLE_INVENTORY:-$REPO_DIR/ops/ansible/inventory.ini}"
PLAYBOOK="$REPO_DIR/ops/ansible/data-sync-workers.yml"
ANSIBLE_CONFIG_FILE="${ANSIBLE_CONFIG:-$REPO_DIR/ops/ansible/ansible.cfg}"

if [ ! -f "$INVENTORY" ]; then
  echo "[fleet-data] missing inventory: $INVENTORY" >&2
  echo "[fleet-data] copy ops/ansible/inventory.example.ini to ops/ansible/inventory.ini and edit hosts." >&2
  exit 1
fi

ANSIBLE_CONFIG="$ANSIBLE_CONFIG_FILE" ansible-playbook -i "$INVENTORY" "$PLAYBOOK" \
  -e "data_sync_markets=$MARKETS" "$@"
