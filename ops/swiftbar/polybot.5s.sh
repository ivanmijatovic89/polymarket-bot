#!/bin/bash
# <xbar.title>Polymarket bot</xbar.title>
# <xbar.version>v1.0</xbar.version>
# <xbar.author>Ivan Mijatovic</xbar.author>
# <xbar.desc>Live worker fleet and backtest batch progress from the dashboard on :3051.</xbar.desc>
# <xbar.dependencies>node</xbar.dependencies>
# <swiftbar.refreshOnOpen>true</swiftbar.refreshOnOpen>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
#
# Launcher only. SwiftBar runs plugins with a bare PATH that does not include
# nvm, so `#!/usr/bin/env node` in the .mjs would resolve to nothing (or to the
# ancient /usr/local/bin/node v16). Resolve a modern node here, then exec.

set -euo pipefail

# This file is symlinked into SwiftBar's plugin folder, so BASH_SOURCE points at
# the symlink — walk it back to the repo before looking for polybot.mjs.
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

pick_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$major" -ge 18 ] 2>/dev/null; then
      command -v node
      return 0
    fi
  fi
  local candidate
  for candidate in "$HOME"/.nvm/versions/node/v*/bin/node; do
    [ -x "$candidate" ] || continue
    case "$candidate" in
      *"/v1"[0-7]"."*|*"/v"[0-9]"."*) continue ;;
    esac
    echo "$candidate"
  done | sort -V | tail -n 1
}

NODE="$(pick_node)"

if [ -z "$NODE" ]; then
  echo ":questionmark.circle: — | sfsize=12"
  echo "---"
  echo "node 18+ not found"
  echo "Edit ops/swiftbar/polybot.5s.sh to point at your node binary"
  exit 0
fi

exec "$NODE" "$DIR/polybot.mjs"
