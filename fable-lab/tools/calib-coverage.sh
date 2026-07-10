#!/bin/sh
# CAL-001 per-offset UP coverage recompute (amendment #11 verdict wording).
#
# Frozen spec (STATE.md session 22, commit d2881ea): over `[diag-calib]`
# lines, denominator = distinct slugs with any UP line; coverage(off) =
# fraction of those slugs with a UP line at that offset; offsets
# 30/150/300/450/600/750/850. Outcome-free: reads slug/asset/off only —
# never bid/ask/outcomes.
#
# Session-22 STATE said "exact script in git history" but only the prose
# spec was committed; this file materializes it (session 23, U43ae).
#
# Usage: sh fable-lab/tools/calib-coverage.sh fable-lab/logs/CAL-001-discovery-v3.log
set -eu
LOG="${1:?usage: calib-coverage.sh <run-log>}"

awk '/\[diag-calib\]/{
  s=""; a=""; o=""
  for(i=1;i<=NF;i++){
    split($i,kv,"=")
    if(kv[1]=="slug")s=kv[2]; else if(kv[1]=="asset")a=kv[2]; else if(kv[1]=="off")o=kv[2]
  }
  if(a!="UP"||s==""||o=="")next
  slugs[s]=1
  seen[s" "o]=1
} END{
  n=0; for(s in slugs)n++
  split("30 150 300 450 600 750 850",offs," ")
  print "denominator (distinct slugs with any UP line): "n
  for(j=1;j<=7;j++){
    o=offs[j]; c=0
    for(s in slugs)if((s" "o) in seen)c++
    printf "off=%-4s covered=%d coverage=%.4f\n", o, c, (n?c/n:0)
  }
}' "$LOG"
