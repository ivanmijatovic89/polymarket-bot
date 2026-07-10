#!/usr/bin/env bash
# CAL-001 integrity battery (checklist §1, outcome-free).
# Aggregates the checks sessions 11-27 ran by hand on the discovery log.
# Reads ONLY instrument fields (slug/epoch/asset/off/ts/bid/ask) and engine
# progress lines — never outcomes, never PnL, never the DB.
# Usage: bash fable-lab/tools/calib-integrity.sh <log-file>
set -euo pipefail

LOG="${1:?usage: calib-integrity.sh <log-file>}"
FAIL=0

check() { # check <name> <ok:0|1> <detail>
  if [ "$2" -eq 0 ]; then echo "PASS  $1: $3"; else echo "FAIL  $1: $3"; FAIL=1; fi
}

# --- latency pin (D8/U41) ---
LAT=$(grep -m1 '\[fable\] latency env:' "$LOG" || true)
if echo "$LAT" | grep -q 'BACKTEST_LATENCY_DELAY=0 BACKTEST_LATENCY_JITTER=0'; then
  check latency 0 "$LAT"
else
  check latency 1 "line missing or not 0/0: '$LAT'"
fi

# --- error lines ---
ERRS=$(grep -ci 'error\|failed\|exception' "$LOG" || true)
check errors "$([ "$ERRS" -eq 0 ]; echo $?)" "$ERRS error/failure/exception lines"

# --- progress: final index + contiguity + duplicate replay files ---
# (portable awk: no gawk match-array; parse the [N/8516] prefix by splitting)
awk '
  /^\[backtest\]\[[0-9]+\/[0-9]+\]/ {
    line=$0;
    sub(/^\[backtest\]\[/, "", line);
    n=line; sub(/\/.*/, "", n);
    total=line; sub(/^[0-9]+\//, "", total); sub(/\].*/, "", total);
    cnt++;
    # each index appears on 2+ lines (replay + finished); a gap is a jump past prev+1 or backwards
    if (cnt>1 && n+0 != prev && n+0 != prev+1) gaps++;
    prev=n+0; last=n+0;
    if ($0 ~ /\.parquet/) {
      f=$0; sub(/.*[ =]([^ ]*\.parquet).*/, "", f);
      for (i=1; i<=NF; i++) if ($i ~ /\.parquet$/) { if (seen[$i]++) dupfile++ }
    }
  }
  END {
    printf "PROGRESS last=%d/%s gaps=%d dupfiles=%d\n", last, total, gaps+0, dupfile+0
  }' "$LOG"

# --- diag-calib sample-level checks in one awk pass ---
awk '
  /^\[diag-calib\]/ {
    slug=""; epoch=""; asset=""; off=""; ts=""; bid=""; ask="";
    for (i=1; i<=NF; i++) {
      split($i, kv, "=");
      if      (kv[1]=="slug")  slug=kv[2];
      else if (kv[1]=="epoch") epoch=kv[2];
      else if (kv[1]=="asset") asset=kv[2];
      else if (kv[1]=="off")   off=kv[2];
      else if (kv[1]=="ts")    ts=kv[2];
      else if (kv[1]=="bid")   bid=kv[2];
      else if (kv[1]=="ask")   ask=kv[2];
    }
    if (slug=="" || asset=="" || off=="" || ts=="" || bid=="" || ask=="") { malformed++; next }
    lines++;

    # slug epoch == epoch field
    se=slug; sub(/^btc-updown-15m-/, "", se);
    if (se != epoch) epochmismatch++;
    if (epoch+0 > maxepoch) maxepoch=epoch+0;

    # frozen offsets only
    if (off!="30" && off!="150" && off!="300" && off!="450" && off!="600" && off!="750" && off!="850") badoff++;

    # ts in [off, 900]
    if (ts+0 < off+0 || ts+0 > 900) tsbounds++;

    # crossed book
    if (bid+0 > ask+0) crossed++;

    # asset counts
    acount[asset]++;

    # dedupe (slug,asset,off) + per-market cap
    t=slug SUBSEP asset SUBSEP off;
    if (cnt[t]++) dup++;
    mkt[slug]++;

    # mirror + pairing store
    key=slug SUBSEP off;
    if (asset=="UP")   { ub[key]=bid; ua[key]=ask; useen[key]=1 }
    else               { db[key]=bid; da[key]=ask; dseen[key]=1 }

    # ts monotonicity per (slug,asset) across increasing offsets:
    # offsets arrive in increasing order per market in the log; check ts non-decreasing
    sk=slug SUBSEP asset;
    if (sk in lastts && ts+0 < lastts[sk]) tsmono++;
    lastts[sk]=ts+0;
  }
  END {
    over14=0; for (s in mkt) if (mkt[s] > 14) over14++;
    paired=0; deviants=0; oneside=0;
    for (k in useen) {
      if (!(k in dseen)) { oneside++; continue }
      paired++;
      eb=sprintf("%.4f", 1-ua[k]); ea=sprintf("%.4f", 1-ub[k]);
      if (sprintf("%.4f", db[k]) != eb || sprintf("%.4f", da[k]) != ea) { deviants++; devlist=devlist " " k }
    }
    for (k in dseen) if (!(k in useen)) oneside++;
    gsub(SUBSEP, "/", devlist);
    printf "SAMPLES lines=%d malformed=%d\n", lines, malformed+0;
    printf "BALANCE UP=%d DOWN=%d\n", acount["UP"]+0, acount["DOWN"]+0;
    printf "EPOCH max=%d mismatches=%d (frozen upper bound 1772323200; no lower bound)\n", maxepoch, epochmismatch+0;
    printf "FIELDS badoff=%d tsbounds=%d crossed=%d\n", badoff+0, tsbounds+0, crossed+0;
    printf "DEDUPE duptuples=%d marketsOver14Lines=%d\n", dup+0, over14+0;
    printf "MIRROR paired=%d deviants=%d oneSided=%d devkeys:%s\n", paired, deviants, oneside+0, devlist;
    printf "TSMONO violations=%d\n", tsmono+0;
  }' "$LOG"

echo "---"
echo "Expected on a clean final log: errors=0, last=8516/8516, gaps=0, dupfiles=0,"
echo "malformed=0, UP==DOWN, mismatches=0, max<1772323200, badoff=0, tsbounds=0,"
echo "crossed=0, duptuples=0, over14=0, oneSided=0, tsmono=0,"
echo "deviants=1 (known: btc-updown-15m-1764846000/850) — NEW deviants must be disclosed."
exit $FAIL
