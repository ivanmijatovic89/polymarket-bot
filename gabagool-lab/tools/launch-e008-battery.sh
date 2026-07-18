#!/bin/bash
# launch-e008-battery.sh — materializes LEDGER §E008 BATTERY
# ADDENDUM (pre-registered s26 u70; freeze at submit). 12 detached
# submissions: cells {g00 (fvGateBps=0), g05 (fvGateBps=5)} × lat
# {0, 500, 1000} × halves {h1 Apr, h2 May}, jitter 0, params
# verbatim from the ax6 arms (rungOffsets [0.02,0.13], pairCostCap
# 0.96, parityTolPct 2, completionMode none, clip 6, requoteDelta
# 0.02, fvGateMode=level). The lat140 cells are NOT submitted —
# they ARE runs 728/725 (g00) and 726/727 (g05). Ungated same-lat
# references are the §E005 battery (714/709, 710/711, 712/713).
#
# Usage: launch-e008-battery.sh [--dry-run]
# Run ONLY after: §E008 battery addendum committed (it is — this
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
      echo "launch-e008-battery.sh: only --dry-run is accepted (got: $1)" >&2
      exit 1
      ;;
  esac
done

# Idempotence guard: refuse if battery (ax6bat) flows are already queued.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--ax6bat" || true)
if [ "$existing" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e008-battery.sh: $existing ax6bat flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

declare -a CODES=(g00 g05)
declare -a BPS=('0' '5')

for i in "${!CODES[@]}"; do
  code="${CODES[$i]}"
  bps="${BPS[$i]}"
  for lat in 0 500 1000; do
    for half in h1 h2; do
      if [ "$half" = "h1" ]; then
        win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
      else
        win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
      fi
      echo "=== E008 battery ax6bat${half}-${code} lat${lat} (fvGateBps=${bps} level gate on rc+c960) ==="
      npx tsx gabagool-lab/tools/submit.ts \
        --exp E003-pair-accumulator \
        --suffix "ax6bat${half}-${code}" \
        --strategy glab.E003-pair-accumulator \
        --window "$win" \
        --lat "$lat" \
        --param "rungOffsets=[0.02,0.13]" \
        --param "pairCostCap=0.96" \
        --param "parityTolPct=2" \
        --param "completionMode=none" \
        --param "fvGateMode=level" \
        --param "fvGateBps=${bps}" \
        --detach ${DRY}
    done
  done
done
echo "=== all 12 battery submissions issued (lat140 = reused 728/725/726/727; ungated refs = E005 battery) ==="
