#!/usr/bin/env bash
# ladder.sh — score a contiguous range of levels on the shipped defaults.
#
#   protocols/pair-game-opus/tools/ladder.sh <from> <to> [parallel] [outdir]
#
# Runs `play-level --level N` for every N in the range, at most `parallel` at a
# time, and prints one PASS/FAIL line per level with its run id. Each level is
# its own persisted run, which is what RULES counts as evidence; the range form
# just makes re-verifying the whole ladder after a parameter change one command.
set -uo pipefail
cd "$(dirname "$0")/../../.."
FROM=$1; TO=$2; PAR=${3:-5}; OUT=${4:-/tmp/ladder}
mkdir -p "$OUT"
for L in $(seq "$FROM" "$TO"); do
  while [ "$(jobs -rp | wc -l)" -ge "$PAR" ]; do sleep 2; done
  ( npx tsx protocols/pair-game-opus/tools/play-level.ts --level "$L" --json \
      > "$OUT/lvl$L.json" 2> "$OUT/lvl$L.err"; echo $? > "$OUT/lvl$L.code" ) &
done
wait
for L in $(seq "$FROM" "$TO"); do
  node -e '
    const fs=require("fs");const l=process.argv[1],o=process.argv[2];
    let j=null;try{j=JSON.parse(fs.readFileSync(`${o}/lvl${l}.json`,"utf8"))}catch{}
    if(!j){console.log(`level ${l}: NO REPORT`);process.exit(0)}
    const bad=(j.results||[]).filter(m=>!m.pass).map(m=>`${m.slug}(${m.upShares}/${m.downShares},pair ${(m.pairCost||0).toFixed(3)})`).join(" ");
    const worst=Math.max(0,...(j.results||[]).map(m=>m.pairCost||0));
    console.log(`level ${l}: ${j.verdict} run=${(j.runs||[]).join(",")} worstPair=${worst.toFixed(3)}${bad?" failed="+bad:""}`);
  ' "$L" "$OUT"
done
