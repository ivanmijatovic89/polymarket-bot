#!/usr/bin/env bash
# Propose one new strategy family (Claude, headless): readable reasoning live +
# raw log + cost summary.
#
# Usage:
#   ./strategy-research-protocol/scripts/propose-family.sh
#       → autonomous (Claude invents a new family)
#   ./strategy-research-protocol/scripts/propose-family.sh "fade large resting walls"
#       → seeded (develops the family around your idea)
#
# Env:
#   LOG=somefile.jsonl       override the raw log path (default: propose-family.jsonl)
#   PERM=acceptEdits         override permission mode (default: bypassPermissions —
#                            headless denies non-allowlisted commands instead of asking,
#                            and the module needs Bash for typecheck + research:check)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

MODULE="strategy-research-protocol/modules/ProposeFamily.md"
if [ -n "${1:-}" ]; then
  INSTRUCTION="Execute propose-family per ${MODULE}. Run with seed: '${1}'."
else
  INSTRUCTION="Execute propose-family per ${MODULE}. Run autonomous (no seed)."
fi
LOG="${LOG:-propose-family.jsonl}"
PERM="${PERM:-bypassPermissions}"

# Session isolation: protocol sessions read ONLY the protocol docs — exclude
# the repo root CLAUDE.md and user-level memory; disable auto-memory (same
# rationale as researcher.sh; see SESSIONS.md).
ROOT="$(pwd)"
SETTINGS="$(mktemp "${TMPDIR:-/tmp}/research-settings.XXXXXX.json")"
cat >"$SETTINGS" <<JSON
{
  "claudeMdExcludes": ["${ROOT}/CLAUDE.md", "${HOME}/.claude/CLAUDE.md"],
  "autoMemoryEnabled": false
}
JSON
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
trap 'rm -f "$SETTINGS"' EXIT

# stdout = clean stream-json → tee raw to LOG, then pretty-print via jq.
# stderr → appended to LOG (kept, but not fed to jq so it can't break parsing).
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
