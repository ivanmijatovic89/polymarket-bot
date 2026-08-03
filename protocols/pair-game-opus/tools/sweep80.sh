#!/usr/bin/env bash
# sweep80.sh — one parameter set over the first N markets, in four parallel
# chunks, printing only the markets that fail.
#
#   protocols/pair-game-opus/tools/sweep80.sh <tag> <N> [--param k=v ...]
#
# The chunk files are rebuilt every time, so N may change between calls. Pass
# the --param flags LITERALLY: zsh does not word-split a variable holding them,
# and a sweep that silently drops them reproduces the baseline.
set -uo pipefail
cd "$(dirname "$0")/../../.."
TAG="$1"; shift
N="$1"; shift
mkdir -p /tmp/pg
npx tsx protocols/pair-game-opus/tools/universe.ts --first "$N" --slugs-only \
  | tr ',' '\n' | grep btc >"/tmp/pg/sw_$TAG.lines"
TOTAL=$(wc -l <"/tmp/pg/sw_$TAG.lines")
PER=$(( (TOTAL + 3) / 4 ))
for i in 1 2 3 4; do
  rm -f "/tmp/pg/sw${TAG}_$i.rows"
  sed -n "$(( (i-1)*PER+1 )),$(( i*PER ))p" "/tmp/pg/sw_$TAG.lines" | paste -sd, - >"/tmp/pg/sw_${TAG}_$i.slugs"
  if [ -s "/tmp/pg/sw_${TAG}_$i.slugs" ]; then
    protocols/pair-game-opus/tools/probe2.sh "sw${TAG}_$i" \
      "$(cat "/tmp/pg/sw_${TAG}_$i.slugs")" "$@" >"/tmp/pg/sw${TAG}_$i.log" 2>&1 &
  fi
done
wait
echo "=== $TAG ($TOTAL markets) params: $*"
cat /tmp/pg/sw${TAG}_*.rows 2>/dev/null \
  | awk '$1 ~ /^btc-updown/ {n++; split($9,a,"/");
      if (a[1]+0<1000 || a[2]+0<1000 || $3+0<=0 || $4/1000>0.98)
        {f++; print "  FAIL", $1, a[1]"/"a[2], "pnl="$3, "cost="$4}}
    END {printf "  scored %d  failures %d\n", n, f+0}'
