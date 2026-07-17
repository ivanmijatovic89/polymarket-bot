#!/bin/bash
# launch-e005-caps.sh — materializes LEDGER §E005's CAP sub-axis after
# the shape sub-judgment (u36) and the pre-registered cap-grid
# decision (u36b: KEEP {0.96, 0.97, 0.98}; bind table from the winner
# pair 698/699 recorded in §E005 BEFORE this launcher existed).
# 6 detached submissions: pairCostCap {0.96, 0.97, 0.98} × halves
# {h1 Apr, h2 May} on the WINNING shape rc = [0.02, 0.13], lat140,
# clip 6, parityTolPct=2, completionMode=none. The cap reference
# 0.99 is NOT submitted — it IS the rc shape pair (698/699,
# pairCostCap file default 0.99), reused on the standing determinism
# basis (u17b 4-dp, u30/u35 to-the-digit reproductions).
#
# Usage: launch-e005-caps.sh [--dry-run]
# Run ONLY after: shape sub-judgment + cap-grid decision committed
# (both are — this launcher hardcodes their outputs; no free knobs).
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
      echo "launch-e005-caps.sh: only --dry-run is accepted (got: $1)" >&2
      exit 1
      ;;
  esac
done

# Idempotence guard: refuse if E005 cap (ax4) flows are already queued.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--ax4h" || true)
if [ "$existing" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e005-caps.sh: $existing ax4 flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

declare -a CODES=(c960 c970 c980)
declare -a CAPS=('0.96' '0.97' '0.98')

for i in "${!CODES[@]}"; do
  code="${CODES[$i]}"
  cap="${CAPS[$i]}"
  for half in h1 h2; do
    if [ "$half" = "h1" ]; then
      win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
    else
      win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
    fi
    echo "=== E005 ax4${half}-${code} (shape rc=[0.02,0.13] pairCostCap=${cap} tol=2 completion=none) ==="
    npx tsx gabagool-lab/tools/submit.ts \
      --exp E003-pair-accumulator \
      --suffix "ax4${half}-${code}" \
      --strategy glab.E003-pair-accumulator \
      --window "$win" \
      --lat 140 \
      --param "rungOffsets=[0.02,0.13]" \
      --param "pairCostCap=${cap}" \
      --param "parityTolPct=2" \
      --param "completionMode=none" \
      --detach ${DRY}
  done
done
echo "=== all 6 cap submissions issued (cap-0.99 reference = reused rc runs 698/699) ==="
