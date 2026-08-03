#!/usr/bin/env bash
# probe.sh — run one parameter set over an explicit slug list and print only the
# per-market rows. The tight loop for diagnosing a single blocking market.
#
#   protocols/pair-game-opus/tools/probe.sh "<slug,slug,...>" [--param k=v ...]
#
# Everything after the slug list is passed straight to run-backtest.ts, so any
# `--param` the strategy accepts works. `qty=1000` (the level target) is always
# injected. Prints the run id and one line per market: shares up/down and pnl.
set -euo pipefail
cd "$(dirname "$0")/../../.."
SLUGS="$1"
shift
RUN=$(npx tsx protocols/pair-game-opus/tools/run-backtest.ts \
  --strategy pair-game-opus-pair.v1 --param qty=1000 "$@" \
  --slug "$SLUGS" --sequential --label probe --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(!j.runId)process.exit(3);console.log(j.runId)})')
echo "run $RUN  params: $*"
npx tsx protocols/pair-game-opus/tools/results.ts --run "$RUN" --markets 2>/dev/null \
  | awk '/^  slug /{p=1} p'
