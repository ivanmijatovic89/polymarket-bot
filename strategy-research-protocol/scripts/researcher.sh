#!/usr/bin/env bash
# Run the Researcher on one family (Claude session).
#
# Default: AUTONOMOUS — headless session that works the family continuously,
# streams readable reasoning live, never asks questions, and stops when the
# family is validated, killed, or nothing is actionable. Raw log + cost
# summary kept.
#
# Interactive: INTERACTIVE=1 opens the same contract in a normal Claude
# session you can steer and interrupt.
#
# Usage:
#   ./strategy-research-protocol/scripts/researcher.sh <family>
#   INTERACTIVE=1 ./strategy-research-protocol/scripts/researcher.sh <family>
#
# Env:
#   INTERACTIVE=1            steerable session instead of headless
#   LOG=somefile.jsonl       override the raw log path (default: researcher-<family>.jsonl)
#   PERM=acceptEdits         override permission mode (default: bypassPermissions —
#                            headless denies non-allowlisted commands instead of asking,
#                            which would break autonomy)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

if [ -z "${1:-}" ]; then
  echo "usage: researcher.sh <family>" >&2
  exit 1
fi
FAMILY="$1"
MODULE="strategy-research-protocol/modules/Researcher.md"
LOG="${LOG:-researcher-${FAMILY}.jsonl}"
PERM="${PERM:-bypassPermissions}"

# Session isolation: research sessions read ONLY the protocol docs. Exclude
# the repo root CLAUDE.md (its general git workflow contradicts the protocol
# branch policy in AGENTS.md) and user-level memory; disable auto-memory.
ROOT="$(pwd)"
SETTINGS="$(mktemp "${TMPDIR:-/tmp}/research-settings.XXXXXX.json")"
cat >"$SETTINGS" <<JSON
{
  "claudeMdExcludes": ["${ROOT}/CLAUDE.md", "${HOME}/.claude/CLAUDE.md"],
  "autoMemoryEnabled": false
}
JSON
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

INSTRUCTION="Execute the researcher per ${MODULE}. Family: '${FAMILY}'. \
Work continuously and autonomously: never ask questions; write the family \
files after every step; poll checkBatch (sleeping between checks) while \
backtests run; stop per the module's Session contract."

# One family = one session at a time (see SESSIONS.md).
# Lock lives outside the repo so it never dirties the tree; a dead PID means
# a crashed session and the lock is taken over.
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
trap 'rm -f "$LOCK" "$SETTINGS"' EXIT

if [ -n "${INTERACTIVE:-}" ]; then
  INSTRUCTION="Execute the researcher per ${MODULE}. Family: '${FAMILY}'. \
Same contract as autonomous mode, but I may steer between steps: narrate \
each step, and pause when I interrupt."
  claude --settings "$SETTINGS" --permission-mode "${PERM_INTERACTIVE:-acceptEdits}" "$INSTRUCTION"
  exit $?
fi

claude -p --settings "$SETTINGS" --permission-mode "$PERM" --output-format stream-json --verbose "$INSTRUCTION" \
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
