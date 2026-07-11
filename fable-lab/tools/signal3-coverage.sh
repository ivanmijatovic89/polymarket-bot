#!/bin/sh
# SIGNAL-003 pre-read coverage accounting (knowledge/SIGNAL-FILLS.md §2).
# Outcome-free BY CONSTRUCTION: every grep is count-only (-c / -o on
# integer tokens) and never prints log content — the engine's end-of-run
# summary block contains PnL aggregates, so printing arbitrary matched
# lines from a shard log would be an outcome exposure. Run over ALL shard
# logs BEFORE the one-shot signal3-scan.ts read; every check must be clean.
#
# Checks per shard log:
#   launches   — must be 1 (single launch; >1 means an append/relaunch mixed logs)
#   pinned     — must be 1 (latency env line DELAY=0 JITTER=0)
#   hook       — must be 1 (D18 touch_or_better hook active)
#   loaded     — markets loaded (sum across shards must be 8,516)
#   completed  — engine per-market completions (must equal loaded)
#   failures   — engine-reported failed markets (must be 0)
#   fillLines  — [diag-fill] lines (informational; no-fill markets are
#                expected at ~4% per run 472's 479/500 played)
#   fillMkts   — distinct slugs with any fill line (informational)
#
# Usage: sh fable-lab/tools/signal3-coverage.sh fable-lab/logs/SIGNAL-003-shard[0-5].log
set -eu
[ "$#" -ge 1 ] || { echo "usage: signal3-coverage.sh <shard-log> [...]"; exit 1; }

totLoaded=0; totCompleted=0; totFail=0; totFills=0; totFillMkts=0; bad=0
for LOG in "$@"; do
  launches=$(grep -c 'latency env: BACKTEST_LATENCY' "$LOG" || true)
  pinned=$(grep -c 'latency env: BACKTEST_LATENCY_DELAY=0 BACKTEST_LATENCY_JITTER=0' "$LOG" || true)
  hook=$(grep -c 'D18 fill-mode hook active: makerFillMode=touch_or_better' "$LOG" || true)
  loaded=$(grep -oE 'Loaded [0-9]+ file' "$LOG" | head -1 | grep -oE '[0-9]+' || echo 0)
  completed=$(grep -cE '^\[backtest\]\[[0-9]+/[0-9]+\] finished in' "$LOG" || true)
  failures=$(grep -v '^\[diag-fill\]' "$LOG" | grep -icE 'error|failed|exception' || true)
  fills=$(grep -c '^\[diag-fill\]' "$LOG" || true)
  fillMkts=$(grep '^\[diag-fill\]' "$LOG" | awk '{split($2,kv,"="); print kv[2]}' | sort -u | wc -l | tr -d ' ')
  echo "$LOG: launches=$launches pinned=$pinned hook=$hook loaded=$loaded completed=$completed failures=$failures fillLines=$fills fillMkts=$fillMkts"
  [ "$launches" -eq 1 ] || { echo "  BAD: launches != 1"; bad=1; }
  [ "$pinned" -eq 1 ] || { echo "  BAD: latency pin line missing"; bad=1; }
  [ "$hook" -eq 1 ] || { echo "  BAD: D18 hook line missing"; bad=1; }
  [ "$completed" -eq "$loaded" ] || { echo "  BAD: completed != loaded"; bad=1; }
  [ "$failures" -eq 0 ] || { echo "  BAD: failures != 0"; bad=1; }
  totLoaded=$((totLoaded + loaded)); totCompleted=$((totCompleted + completed))
  totFail=$((totFail + failures)); totFills=$((totFills + fills)); totFillMkts=$((totFillMkts + fillMkts))
done
echo "TOTAL: loaded=$totLoaded completed=$totCompleted failures=$totFail fillLines=$totFills fillMkts=$totFillMkts"
[ "$totLoaded" -eq 8516 ] || { echo "BAD: total loaded != 8516"; bad=1; }
[ "$bad" -eq 0 ] && echo "COVERAGE CLEAN — one-shot read may proceed" || { echo "COVERAGE DIRTY — do NOT read"; exit 2; }
