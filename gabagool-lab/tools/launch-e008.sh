#!/bin/bash
# launch-e008.sh — materializes LEDGER §E008-fv-gate's launch plan
# (freeze at submit). 8 detached submissions: fvGateBps
# {0, 5, 9, 15} (grid from the u55 pre-registered calibration;
# θ0 = sign-only endpoint) × halves {h1 Apr, h2 May} on the rc+c960
# chassis (rungOffsets [0.02,0.13], pairCostCap 0.96, parityTolPct 2,
# completionMode none, clip 6, requoteDelta 0.02), fvGateMode=level,
# lat140, jitter 0. The gate-off reference is NOT submitted — it IS
# runs 708/703 (parameter-identical cell; A/A-verified reuse basis,
# run 723 = 20/20 exact).
#
# Usage: launch-e008.sh [--dry-run]
# Run ONLY after: §E008 draft + calibration committed (they are;
# freeze stamps at this launch — no free knobs here).
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
      echo "launch-e008.sh: only --dry-run is accepted (got: $1)" >&2
      exit 1
      ;;
  esac
done

# Idempotence guard: refuse if E008 (ax6) flows are already queued.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--ax6h" || true)
if [ "$existing" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e008.sh: $existing ax6 flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

declare -a CODES=(g00 g05 g09 g15)
declare -a BPS=('0' '5' '9' '15')

for i in "${!CODES[@]}"; do
  code="${CODES[$i]}"
  bps="${BPS[$i]}"
  for half in h1 h2; do
    if [ "$half" = "h1" ]; then
      win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
    else
      win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
    fi
    echo "=== E008 ax6${half}-${code} (fvGateBps=${bps} level gate on rc+c960 chassis) ==="
    npx tsx gabagool-lab/tools/submit.ts \
      --exp E003-pair-accumulator \
      --suffix "ax6${half}-${code}" \
      --strategy glab.E003-pair-accumulator \
      --window "$win" \
      --lat 140 \
      --param "rungOffsets=[0.02,0.13]" \
      --param "pairCostCap=0.96" \
      --param "parityTolPct=2" \
      --param "completionMode=none" \
      --param "fvGateMode=level" \
      --param "fvGateBps=${bps}" \
      --detach ${DRY}
  done
done
echo "=== all 8 fv-gate submissions issued (gate-off reference = reused runs 708/703) ==="
