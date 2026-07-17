#!/bin/bash
# launch-e003.sh — materializes LEDGER §E003's frozen launch plan verbatim.
# 10 detached submissions: parityTolPct {0.1,2,10,20,40} × halves {h1,h2}.
# Run ONLY after: E002 judged + EVALUATION v1.1 frozen + E003 marked frozen.
# Pass --dry-run to print producer commands without enqueueing.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Only --dry-run may be passed through (a stray flag double-launched
# the whole batch once — s3 u15; submit.ts now also rejects unknowns).
EXTRA="${1:-}"
if [ -n "$EXTRA" ] && [ "$EXTRA" != "--dry-run" ]; then
  echo "launch-e003.sh: only --dry-run is accepted (got: $EXTRA)" >&2
  exit 1
fi

# Idempotence guard: refuse if E003 flows are already in the queue.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c "glab--E003" || true)
if [ "$existing" -gt 0 ] && [ "$EXTRA" != "--dry-run" ]; then
  echo "launch-e003.sh: $existing E003 flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

declare -a TOLS=(0.1 2 10 20 40)
declare -a CODES=(p001 p020 p100 p200 p400)

for i in "${!TOLS[@]}"; do
  tol="${TOLS[$i]}"
  code="${CODES[$i]}"
  for half in h1 h2; do
    if [ "$half" = "h1" ]; then
      win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
    else
      win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
    fi
    echo "=== E003 ax1${half}-${code} (parityTolPct=${tol}) ==="
    npx tsx gabagool-lab/tools/submit.ts \
      --exp E003-pair-accumulator \
      --suffix "ax1${half}-${code}" \
      --strategy glab.E003-pair-accumulator \
      --window "$win" \
      --lat 140 \
      --param "parityTolPct=${tol}" \
      --detach ${EXTRA}
  done
done
echo "=== all 10 submissions issued ==="
