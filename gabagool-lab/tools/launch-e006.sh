#!/bin/bash
# launch-e006.sh — materializes LEDGER §E006-quote-stability's launch
# plan (freeze at submit). 8 detached submissions: requoteDelta
# {0.05, 0.10, 0.20, 0.45} × halves {h1 Apr, h2 May} on the E005
# chassis (rungOffsets [0.02,0.13], pairCostCap 0.96, parityTolPct 2,
# completionMode none, clip 6), lat140, jitter 0. The reference delta
# 0.02 is NOT submitted — it IS runs 708/703 (parameter-identical
# cell; standing determinism basis).
#
# Usage: launch-e006.sh [--dry-run]
# Run ONLY after: §E006 proposal committed (it is; freeze stamps at
# this launch — no free knobs here).
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
      echo "launch-e006.sh: only --dry-run is accepted (got: $1)" >&2
      exit 1
      ;;
  esac
done

# Idempotence guard: refuse if E006 (ax5) flows are already queued.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--ax5h" || true)
if [ "$existing" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e006.sh: $existing ax5 flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

declare -a CODES=(q05 q10 q20 q45)
declare -a DELTAS=('0.05' '0.10' '0.20' '0.45')

for i in "${!CODES[@]}"; do
  code="${CODES[$i]}"
  delta="${DELTAS[$i]}"
  for half in h1 h2; do
    if [ "$half" = "h1" ]; then
      win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
    else
      win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
    fi
    echo "=== E006 ax5${half}-${code} (requoteDelta=${delta} on rc+c960 chassis) ==="
    npx tsx gabagool-lab/tools/submit.ts \
      --exp E003-pair-accumulator \
      --suffix "ax5${half}-${code}" \
      --strategy glab.E003-pair-accumulator \
      --window "$win" \
      --lat 140 \
      --param "rungOffsets=[0.02,0.13]" \
      --param "pairCostCap=0.96" \
      --param "parityTolPct=2" \
      --param "completionMode=none" \
      --param "requoteDelta=${delta}" \
      --detach ${DRY}
  done
done
echo "=== all 8 quote-stability submissions issued (delta-0.02 reference = reused runs 708/703) ==="
