#!/bin/bash
# launch-e005-shapes.sh — materializes LEDGER §E005's SHAPE sub-axis
# launch plan (freeze at submit). 6 detached submissions: shapes
# {rb: [0.02,0.06], rc: [0.02,0.13], rd: [0.01,0.02,0.05,0.13]} ×
# halves {h1 Apr, h2 May}, lat140, clip 6, parityTolPct=2 (E003 SEED,
# judged u27), completionMode=none (axis isolation per §E004).
# The reference shape ra=[0.01,0.03] is NOT submitted — it IS E003
# runs 682/683 (identical file/params/window/lat; same determinism
# basis as E004's control reuse: u17b 4-dp match + u30 to-the-digit
# reproduction).
#
# Cap arms (ax4) are NOT launched here — only after the shape
# sub-judgment + the pre-registered cap-grid finalization rule have
# been written to the LEDGER (two-stage rule, §E005).
#
# Usage: launch-e005-shapes.sh [--dry-run]
# Run ONLY after: E004 judged (worker free) + LEDGER §E005 marked
# frozen at this launch.
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
      echo "launch-e005-shapes.sh: only --dry-run is accepted (got: $1)" >&2
      exit 1
      ;;
  esac
done

# Idempotence guard: refuse if E005 shape (ax3) flows are already queued.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--ax3h" || true)
if [ "$existing" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e005-shapes.sh: $existing ax3 flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

declare -a CODES=(rb rc rd)
declare -a OFFSETS=('[0.02,0.06]' '[0.02,0.13]' '[0.01,0.02,0.05,0.13]')

for i in "${!CODES[@]}"; do
  code="${CODES[$i]}"
  offs="${OFFSETS[$i]}"
  for half in h1 h2; do
    if [ "$half" = "h1" ]; then
      win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
    else
      win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
    fi
    echo "=== E005 ax3${half}-${code} (rungOffsets=${offs} tol=2 completion=none) ==="
    npx tsx gabagool-lab/tools/submit.ts \
      --exp E003-pair-accumulator \
      --suffix "ax3${half}-${code}" \
      --strategy glab.E003-pair-accumulator \
      --window "$win" \
      --lat 140 \
      --param "rungOffsets=${offs}" \
      --param "parityTolPct=2" \
      --param "completionMode=none" \
      --detach ${DRY}
  done
done
echo "=== all 6 shape submissions issued (ra reference = reused E003 runs 682/683) ==="
