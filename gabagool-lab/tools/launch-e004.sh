#!/bin/bash
# launch-e004.sh — materializes LEDGER §E004's launch plan (freeze at submit).
# 6 detached submissions: completion arms {c990: cap 0.99, c970: cap 0.97,
# cfree: free} × halves {h1 Apr, h2 May}, lat140, on the frozen E003 file.
# The maker-only control arm is NOT submitted — it reuses the E003 runs at
# the seeded parityTolPct (determinism basis: u17b p001≡E002 4-dp match).
#
# Usage: launch-e004.sh --tol <parityTolPct> [--dry-run]
#   --tol is REQUIRED and must be the value written in LEDGER §E004 at
#   freeze (E003's agreeing region, or 10 if E003's advance rule failed).
# Run ONLY after: E003 judged + LEDGER §E004 marked frozen with the seed.
set -euo pipefail
cd "$(dirname "$0")/../.."

TOL=""
DRY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tol)
      TOL="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY="--dry-run"
      shift
      ;;
    *)
      echo "launch-e004.sh: only --tol <v> and --dry-run are accepted (got: $1)" >&2
      exit 1
      ;;
  esac
done
if [ -z "$TOL" ]; then
  echo "launch-e004.sh: --tol <parityTolPct> is required (the E004 freeze seed)" >&2
  exit 1
fi
case "$TOL" in
  0.1|2|10|20|40) ;;
  *)
    echo "launch-e004.sh: --tol must be one of the E003 grid {0.1,2,10,20,40} (got: $TOL)" >&2
    echo "  (the maker-only control reuses an E003 run — an off-grid seed has no control run)" >&2
    exit 1
    ;;
esac

# Idempotence guard: refuse if E004 (ax2) flows are already in the queue.
existing=$(npx tsx gabagool-lab/tools/agg-inspect.ts 2>/dev/null | grep -c -- "--ax2h" || true)
if [ "$existing" -gt 0 ] && [ -z "$DRY" ]; then
  echo "launch-e004.sh: $existing ax2 flow(s) already queued — refusing to double-submit." >&2
  exit 1
fi

declare -a MODES=(cap cap free)
declare -a CAPS=(0.99 0.97 -)
declare -a CODES=(c990 c970 cfree)

for i in "${!CODES[@]}"; do
  mode="${MODES[$i]}"
  cap="${CAPS[$i]}"
  code="${CODES[$i]}"
  for half in h1 h2; do
    if [ "$half" = "h1" ]; then
      win="2026-04-01T00:00:00Z..2026-04-30T23:59:59.999Z"
    else
      win="2026-05-01T00:00:00Z..2026-05-31T23:59:59.999Z"
    fi
    echo "=== E004 ax2${half}-${code} (completionMode=${mode} cap=${cap} tol=${TOL}) ==="
    if [ "$cap" = "-" ]; then
      npx tsx gabagool-lab/tools/submit.ts \
        --exp E003-pair-accumulator \
        --suffix "ax2${half}-${code}" \
        --strategy glab.E003-pair-accumulator \
        --window "$win" \
        --lat 140 \
        --param "parityTolPct=${TOL}" \
        --param "completionMode=${mode}" \
        --detach ${DRY}
    else
      npx tsx gabagool-lab/tools/submit.ts \
        --exp E003-pair-accumulator \
        --suffix "ax2${half}-${code}" \
        --strategy glab.E003-pair-accumulator \
        --window "$win" \
        --lat 140 \
        --param "parityTolPct=${TOL}" \
        --param "completionMode=${mode}" \
        --param "completionCap=${cap}" \
        --detach ${DRY}
    fi
  done
done
echo "=== all 6 submissions issued (maker-only control = reused E003 runs) ==="
