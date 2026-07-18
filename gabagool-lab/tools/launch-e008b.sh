#!/bin/bash
# launch-e008b.sh — materializes LEDGER §E008b (frozen s27; freeze at
# submit). 12 detached submissions: 6 arms × halves {h1 Apr, h2 May}
# at lat140/jitter0 on the g00 chassis (rc+c960 + fvGateMode=level,
# fvGateBps=0). Incumbent reference = runs 728/725 (NOT resubmitted).
#   structure: r1=[0.02] r12s=[0.01,0.02] r3m=[0.02,0.06,0.13]
#              r3d=[0.02,0.13,0.25]   (soloCap default 0.65)
#   solo-cap:  s75=soloCap 0.75, s85=soloCap 0.85 (ladder [0.02,0.13])
# clipShares is EXCLUDED by design (in-sim size scaling lies — see
# the freeze block). No free knobs here.
#
# Usage: launch-e008b.sh [--dry-run]
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
      echo "launch-e008b.sh: only --dry-run is accepted (got: $1)" >&2
      exit 1
      ;;
  esac
done

# Idempotence guard: refuse if ax7 flows are already queued.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--ax7" || true)
if [ "$existing" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e008b.sh: $existing ax7 flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

declare -a CODES=(r1 r12s r3m r3d s75 s85)
declare -a RUNGS=('[0.02]' '[0.01,0.02]' '[0.02,0.06,0.13]' '[0.02,0.13,0.25]' '[0.02,0.13]' '[0.02,0.13]')
declare -a SOLO=('0.65' '0.65' '0.65' '0.65' '0.75' '0.85')

for i in "${!CODES[@]}"; do
  code="${CODES[$i]}"
  rungs="${RUNGS[$i]}"
  solo="${SOLO[$i]}"
  for half in h1 h2; do
    if [ "$half" = "h1" ]; then
      win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
    else
      win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
    fi
    echo "=== E008b ax7${half}-${code} (rungs=${rungs} soloCap=${solo} on g00) ==="
    npx tsx gabagool-lab/tools/submit.ts \
      --exp E003-pair-accumulator \
      --suffix "ax7${half}-${code}" \
      --strategy glab.E003-pair-accumulator \
      --window "$win" \
      --lat 140 \
      --param "rungOffsets=${rungs}" \
      --param "soloCap=${solo}" \
      --param "pairCostCap=0.96" \
      --param "parityTolPct=2" \
      --param "completionMode=none" \
      --param "fvGateMode=level" \
      --param "fvGateBps=0" \
      --detach ${DRY}
  done
done
echo "=== all 12 E008b submissions issued (g00 incumbent = runs 728/725, reused) ==="
