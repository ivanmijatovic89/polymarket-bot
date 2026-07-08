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
#   LOG=somefile.jsonl       override the raw log path
#                            (default: src/strategies/research/logs/propose-family.jsonl — gitignored)
#   PERM=acceptEdits         override permission mode (default: bypassPermissions —
#                            rationale in SESSIONS.md, launcher checklist)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

MODULE="strategy-research-protocol/modules/ProposeFamily.md"
if [ -n "${1:-}" ]; then
  INSTRUCTION="Execute propose-family per ${MODULE}. Run with seed: '${1}'. Your working directory is strategy-research-protocol/; the repo root is its parent, and repo paths in the docs (src/..., docs/...) are relative to that root."
else
  INSTRUCTION="Execute propose-family per ${MODULE}. Run autonomous (no seed). Your working directory is strategy-research-protocol/; the repo root is its parent, and repo paths in the docs (src/..., docs/...) are relative to that root."
fi
mkdir -p src/strategies/research/logs
LOG="${LOG:-$(pwd)/src/strategies/research/logs/propose-family.jsonl}"
PERM="${PERM:-bypassPermissions}"

# Session isolation: the session is launched from strategy-research-protocol/
# so it inherits that folder's COMMITTED .claude/settings.json (root CLAUDE.md
# + user memory excluded, auto-memory off, log reads denied). Settings load
# ONLY from the starting directory — verified; see SESSIONS.md.
ROOT="$(pwd)"
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

# stdout = clean stream-json → tee raw to LOG, then pretty-print via jq.
# stderr → appended to LOG (kept, but not fed to jq so it can't break parsing).
cd strategy-research-protocol || exit 1
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
