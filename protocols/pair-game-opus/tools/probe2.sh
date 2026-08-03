#!/usr/bin/env bash
# probe2.sh — probe.sh with the error channel kept.
#
#   protocols/pair-game-opus/tools/probe2.sh <tag> "<slugs>" [--param k=v ...]
#
# Writes /tmp/pg/<tag>.json (raw run-backtest JSON), /tmp/pg/<tag>.err (stderr)
# and /tmp/pg/<tag>.rows (per-market table). probe.sh swallows stderr, so a run
# that dies for an environmental reason looks identical to one that produced no
# report; this keeps the two apart.
set -uo pipefail
cd "$(dirname "$0")/../../.."
TAG="$1"; shift
SLUGS="$1"; shift
mkdir -p /tmp/pg
npx tsx protocols/pair-game-opus/tools/run-backtest.ts \
  --strategy pair-game-opus-pair.v1 --param qty=1000 "$@" \
  --slug "$SLUGS" --sequential --label "probe-$TAG" --json \
  >"/tmp/pg/$TAG.json" 2>"/tmp/pg/$TAG.err"
RUN=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).runId||"")}catch{console.log("")}' "/tmp/pg/$TAG.json")
if [ -z "$RUN" ]; then
  echo "$TAG: NO RUN — see /tmp/pg/$TAG.err"
  tail -5 "/tmp/pg/$TAG.err"
  exit 1
fi
echo "$TAG: run $RUN  params: $*"
npx tsx protocols/pair-game-opus/tools/results.ts --run "$RUN" --markets 2>/dev/null \
  | awk '/^  slug /{p=1} p' >"/tmp/pg/$TAG.rows"
