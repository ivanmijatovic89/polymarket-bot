#!/bin/bash
# launch-e005-battery.sh — materializes LEDGER §E005's BATTERY
# ADDENDUM (pre-registered u39): latency battery on the surviving
# cell rc+cap0.96. 6 detached submissions: lat {0, 500, 1000} ×
# halves {h1 Apr, h2 May}, jitter 0, params verbatim from runs
# 708/703 (rungOffsets [0.02,0.13], pairCostCap 0.96, parityTolPct 2,
# completionMode none, clip 6). The lat140 cells are NOT submitted —
# they ARE runs 708/703.
#
# Usage: launch-e005-battery.sh [--dry-run]
# Run ONLY after: §E005 battery addendum committed (it is — this
# launcher hardcodes its values; no free knobs).
set -euo pipefail
cd "$(dirname "$0")/../.."

DRY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY="--dry-run"
      shift
      ;;
    *)
      echo "launch-e005-battery.sh: only --dry-run is accepted (got: $1)" >&2
      exit 1
      ;;
  esac
done

# Idempotence guard: refuse if battery (bath) flows are already queued.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--bath" || true)
if [ "$existing" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e005-battery.sh: $existing battery flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

for lat in 0 500 1000; do
  for half in h1 h2; do
    if [ "$half" = "h1" ]; then
      win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
    else
      win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
    fi
    echo "=== E005 battery bat${half}-c960 lat${lat} (rc=[0.02,0.13] cap=0.96 tol=2 none) ==="
    npx tsx gabagool-lab/tools/submit.ts \
      --exp E003-pair-accumulator \
      --suffix "bat${half}-c960" \
      --strategy glab.E003-pair-accumulator \
      --window "$win" \
      --lat "$lat" \
      --param "rungOffsets=[0.02,0.13]" \
      --param "pairCostCap=0.96" \
      --param "parityTolPct=2" \
      --param "completionMode=none" \
      --detach ${DRY}
  done
done
echo "=== all 6 battery submissions issued (lat140 = reused runs 708/703) ==="
