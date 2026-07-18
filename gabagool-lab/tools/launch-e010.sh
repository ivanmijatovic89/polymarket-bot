#!/bin/bash
# launch-e010.sh — materializes LEDGER §E010 (freeze at submit).
# 6 detached submissions: 3 window arms × halves {h1 Apr, h2 May} at
# lat140/jitter0 on the g00 chassis (rc+c960 + fvGateMode=level,
# fvGateBps=0, soloCap 0.65). Incumbent reference = runs 728/725
# (NOT resubmitted).
#   arms: w5 / w10 / w20 = momWindowSec {5, 10, 20},
#         momVetoMode=fall, momMinDrop=0.01 (fixed — A44's signature
#         is any fall; one tick is the floor)
# Launch preconditions (§E010 identity requirements): A/A vs run 728
# 20/20 exact on the launch SHA + veto-on smoke with ms > 0. Do NOT
# run this script before both are recorded in JOURNAL.
#
# Usage: launch-e010.sh [--dry-run]
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
      echo "launch-e010.sh: only --dry-run is accepted (got: $1)" >&2
      exit 1
      ;;
  esac
done

# Idempotence guard: refuse if ax8 flows are already queued.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--ax8" || true)
if [ "$existing" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e010.sh: $existing ax8 flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

declare -a CODES=(w5 w10 w20)
declare -a WINSEC=('5' '10' '20')

for i in "${!CODES[@]}"; do
  code="${CODES[$i]}"
  winsec="${WINSEC[$i]}"
  for half in h1 h2; do
    if [ "$half" = "h1" ]; then
      win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
    else
      win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
    fi
    echo "=== E010 ax8${half}-${code} (momWindowSec=${winsec} on g00) ==="
    npx tsx gabagool-lab/tools/submit.ts \
      --exp E003-pair-accumulator \
      --suffix "ax8${half}-${code}" \
      --strategy glab.E003-pair-accumulator \
      --window "$win" \
      --lat 140 \
      --param "rungOffsets=[0.02,0.13]" \
      --param "pairCostCap=0.96" \
      --param "parityTolPct=2" \
      --param "completionMode=none" \
      --param "fvGateMode=level" \
      --param "fvGateBps=0" \
      --param "momVetoMode=fall" \
      --param "momWindowSec=${winsec}" \
      --param "momMinDrop=0.01" \
      --detach ${DRY}
  done
done
echo "=== all 6 E010 submissions issued (g00 incumbent = runs 728/725, reused) ==="
