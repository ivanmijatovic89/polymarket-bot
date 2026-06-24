#!/usr/bin/env bash
# Run a research worker headless: readable reasoning live + raw log + cost summary.
#
# Usage:
#   ./strategy-research-protocol/scripts/run-worker.sh
#       → default: propose-family, autonomous (no seed)
#   ./strategy-research-protocol/scripts/run-worker.sh "Execute propose-family per ... Run with seed: '<idea>'."
#       → custom instruction
#
# Env:
#   LOG=somefile.jsonl   override the raw log path (default: worker-run.jsonl)
#   PERM=bypassPermissions   override permission mode (default: acceptEdits)
set -uo pipefail

INSTRUCTION="${1:-Execute propose-family per strategy-research-protocol/modules/ProposeFamily.md. Run autonomous (no seed).}"
LOG="${LOG:-worker-run.jsonl}"
PERM="${PERM:-acceptEdits}"

# stdout = clean stream-json → tee raw to LOG, then pretty-print via jq.
# stderr → appended to LOG (kept, but not fed to jq so it can't break parsing).
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
