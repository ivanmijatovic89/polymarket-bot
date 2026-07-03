#!/usr/bin/env bash
# Run ONE Researcher iteration for one family (Claude, headless): readable
# reasoning live + raw log + cost summary.
#
# Usage:
#   ./strategy-research-protocol/scripts/researcher.sh <family>
#
# Env:
#   LOG=somefile.jsonl       override the raw log path (default: researcher-<family>.jsonl)
#   PERM=bypassPermissions   override permission mode (default: acceptEdits)
set -uo pipefail

if [ -z "${1:-}" ]; then
  echo "usage: researcher.sh <family>" >&2
  exit 1
fi
FAMILY="$1"
MODULE="strategy-research-protocol/modules/Researcher.md"
INSTRUCTION="Execute one researcher iteration per ${MODULE}. Family: '${FAMILY}'."
LOG="${LOG:-researcher-${FAMILY}.jsonl}"
PERM="${PERM:-acceptEdits}"

# One family = one session at a time (see RUNNING.md). Lock lives outside the
# repo so it never dirties the tree; a dead PID means a crashed session and
# the lock is taken over.
LOCKDIR="${TMPDIR:-/tmp}/research-locks"
mkdir -p "$LOCKDIR"
LOCK="$LOCKDIR/${FAMILY}.lock"
if [ -f "$LOCK" ]; then
  OLDPID="$(cat "$LOCK" 2>/dev/null || true)"
  if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null; then
    echo "another session is already working on '${FAMILY}' (pid ${OLDPID})" >&2
    exit 1
  fi
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

claude -p --permission-mode "$PERM" --output-format stream-json --verbose "$INSTRUCTION" \
  2>>"$LOG" \
  | tee -a "$LOG" \
  | jq -Rj '
      (try fromjson catch null) as $e
      | if $e == null then empty
        elif $e.type=="assistant" then
          ( $e.message.content[]?
            | if   .type=="text"     then .text
              elif .type=="tool_use" then "\n[36m▶ " + .name + "[0m " + ((.input|tostring)[0:200]) + "\n"
              else empty end )
        elif $e.type=="user" then
          ( $e.message.content[]?
            | if .type=="tool_result"
              then "[90m  ↳ " + (((.content // "") | if type=="array" then (.[0].text // "") else tostring end)[0:200]) + "[0m\n"
              else empty end )
        else empty end
    '

echo
echo "=== cost / tokens ==="
grep '"type":"result"' "$LOG" | tail -1 | jq '{
  cost_usd:      .total_cost_usd,
  input_tokens:  .usage.input_tokens,
  output_tokens: .usage.output_tokens,
  cache_read:    .usage.cache_read_input_tokens,
  cache_write:   .usage.cache_creation_input_tokens,
  turns:         .num_turns,
  duration_s:    (.duration_ms/1000)
}'
