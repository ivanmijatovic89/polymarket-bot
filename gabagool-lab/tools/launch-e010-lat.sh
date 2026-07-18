#!/bin/bash
# launch-e010-lat.sh — materializes LEDGER §E010 success-criteria (4):
# the pre-committed latency survival battery for an ADVANCING window
# cell. 6 detached submissions: the advancing arm × lat {0, 500, 1000}
# × halves {h1 Apr, h2 May}, jitter 0, params verbatim from the ax8
# arm (g00 chassis: rungOffsets [0.02,0.13], pairCostCap 0.96,
# parityTolPct 2, completionMode none, fvGateMode=level, fvGateBps=0;
# veto: momVetoMode=fall, momMinDrop=0.01, momWindowSec = the arm).
# The lat140 cells are NOT submitted — they ARE the arm's §E010 runs.
# Same-lat g00 references are the §E008 battery (738/733 lat0,
# 734/735 lat500, 736/737 lat1000) — NOT resubmitted.
#
# Usage: launch-e010-lat.sh --window <5|10|20> [--dry-run]
# Run ONLY after the §E010 judgment records that this window arm
# ADVANCES under frozen rule (3) (EL-DISTINCT better than g00 in BOTH
# halves). No advancing arm → this script must never run.
set -euo pipefail
cd "$(dirname "$0")/../.."

DRY=""
WINSEC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY="--dry-run"
      shift
      ;;
    --window)
      WINSEC="${2:-}"
      shift 2
      ;;
    *)
      echo "launch-e010-lat.sh: only --window <5|10|20> and --dry-run are accepted (got: $1)" >&2
      exit 1
      ;;
  esac
done

case "$WINSEC" in
  5|10|20) ;;
  *)
    echo "launch-e010-lat.sh: --window must be 5, 10 or 20 (the §E010 arm grid); got: '${WINSEC}'" >&2
    exit 1
    ;;
esac
code="w${WINSEC}"

# Idempotence guard: refuse if battery (ax8bat) flows are already queued.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--ax8bat" || true)
if [ "$existing" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e010-lat.sh: $existing ax8bat flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

# Ordering guard: refuse while the §E010 lat140 battery itself is still
# in flight (judgment must precede the latency battery).
pending=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--ax8h" || true)
if [ "$pending" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e010-lat.sh: $pending ax8 lat140 flow(s) still queued — judge §E010 first." >&2
  exit 1
fi

for lat in 0 500 1000; do
  for half in h1 h2; do
    if [ "$half" = "h1" ]; then
      win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
    else
      win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
    fi
    echo "=== E010 battery ax8bat${half}-${code} lat${lat} (momWindowSec=${WINSEC} fall-veto on g00) ==="
    npx tsx gabagool-lab/tools/submit.ts \
      --exp E003-pair-accumulator \
      --suffix "ax8bat${half}-${code}" \
      --strategy glab.E003-pair-accumulator \
      --window "$win" \
      --lat "$lat" \
      --param "rungOffsets=[0.02,0.13]" \
      --param "pairCostCap=0.96" \
      --param "parityTolPct=2" \
      --param "completionMode=none" \
      --param "fvGateMode=level" \
      --param "fvGateBps=0" \
      --param "momVetoMode=fall" \
      --param "momWindowSec=${WINSEC}" \
      --param "momMinDrop=0.01" \
      --detach ${DRY}
  done
done
echo "=== all 6 battery submissions issued (lat140 = the arm's §E010 runs, reused; g00 same-lat refs = 738/733, 734/735, 736/737) ==="
