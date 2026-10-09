#!/bin/zsh
# Runs the Rust-engine goal session headless until a deadline or a STOP file.
# Usage: native/goal/run-goal.sh <deadline "YYYY-MM-DD HH:MM" local time>
# The first iteration starts from native/goal/PROMPT.md; later iterations
# resume the same conversation with --continue (rate limits, early end of turn).
set -u
cd "$(dirname "$0")/../.." || exit 1
REPO="$PWD"
GOAL_DIR="$REPO/native/goal"
LOG_DIR="$GOAL_DIR/logs"
mkdir -p "$LOG_DIR"

DEADLINE_STR="${1:?deadline required, e.g. \"2026-10-09 10:15\"}"
DEADLINE=$(date -j -f "%Y-%m-%d %H:%M" "$DEADLINE_STR" +%s) || exit 1
KILL_AT=$((DEADLINE + 600))
MODEL="${GOAL_MODEL:-claude-opus-5-5}"
EFFORT="${GOAL_EFFORT:-ultracode}"

log() { print -r -- "[$(date '+%F %T')] $*" | tee -a "$LOG_DIR/launcher.log"; }

iter=0
while :; do
  now=$(date +%s)
  if [[ -f "$GOAL_DIR/STOP" ]]; then log "STOP file present: $(head -c 300 "$GOAL_DIR/STOP")"; break; fi
  if (( now >= DEADLINE )); then log "deadline reached"; break; fi
  iter=$((iter + 1))
  remaining_min=$(( (DEADLINE - now) / 60 ))
  # GOAL_RESUME=1: continue the previous conversation from the first iteration.
  if (( iter == 1 )) && [[ "${GOAL_RESUME:-0}" != 1 ]]; then
    prompt="$(cat "$GOAL_DIR/PROMPT.md")

Deadline: $DEADLINE_STR local time ($remaining_min minutes from now)."
    args=(-p "$prompt")
  else
    prompt="Continue the Rust engine goal from native/STATUS.md and native/goal/PROMPT.md. Deadline: $DEADLINE_STR local time ($remaining_min minutes from now). Twenty minutes before it, wrap up: commit, push, update STATUS.md."
    args=(-p --continue "$prompt")
  fi
  log "iteration $iter start ($remaining_min min left)"
  started=$(date +%s)
  claude "${args[@]}" --model "$MODEL" --effort "$EFFORT" --permission-mode bypassPermissions \
    --output-format stream-json --verbose >"$LOG_DIR/iter-$iter.jsonl" 2>"$LOG_DIR/iter-$iter.err" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if (( $(date +%s) >= KILL_AT )); then
      log "kill-at reached, interrupting pid $pid"
      kill -INT "$pid" 2>/dev/null; sleep 20; kill -TERM "$pid" 2>/dev/null
      break
    fi
    sleep 30
  done
  wait "$pid" 2>/dev/null
  code=$?
  dur=$(( $(date +%s) - started ))
  log "iteration $iter exit=$code after ${dur}s"
  # Fast failures usually mean a rate limit: back off before resuming.
  if (( dur < 120 )); then sleep 600; else sleep 30; fi
done
log "launcher finished"
