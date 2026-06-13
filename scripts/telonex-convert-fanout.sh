#!/usr/bin/env bash
#
# Fan out `npm run telonex:convert` across N tmux panes.
#
# The converter claims markets with `SELECT ... FOR UPDATE SKIP LOCKED`, so any
# number of independent processes cooperate safely on the same queue — each pane
# pulls the next market that still needs the requested converter. Conversion is
# CPU-bound single-threaded JavaScript, so multiple PROCESSES (this launcher) are
# how you get real parallelism — raising a single process's --concurrency only
# overlaps I/O. This opens one tmux window with N tiled panes running the same
# command so you can watch all workers at once.
#
# Usage:
#   ./scripts/telonex-convert-fanout.sh <num-panes> [telonex:convert args]
#
# Examples:
#   ./scripts/telonex-convert-fanout.sh 6 --converter delta-typed
#   ./scripts/telonex-convert-fanout.sh 4 --converter delta-typed --slug-pattern 'btc-updown-15m-%'
#   ./scripts/telonex-convert-fanout.sh 8 --converter delta-typed --output both --slug-pattern 'btc-updown-5m-%'
#
# Unlike telonex:download, --slug-pattern is OPTIONAL here; without it the
# converter processes every eligible 'done' market. All args after the pane
# count are forwarded verbatim to telonex:convert.
#
# Runs in its own tmux session `polymarket-telonex-converter`. Kill the whole
# fan-out with: tmux kill-session -t polymarket-telonex-converter
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PANES="${1:-}"
if ! [[ "$PANES" =~ ^[0-9]+$ ]] || [ "$PANES" -lt 1 ]; then
  echo "usage: $0 <num-panes> [telonex:convert args]" >&2
  echo "  e.g. $0 6 --converter delta-typed --slug-pattern 'btc-updown-15m-%'" >&2
  exit 1
fi
shift

# Build the per-pane command, quoting each forwarded arg so patterns survive the
# trip through tmux send-keys.
CMD="npm run telonex:convert --"
for a in "$@"; do
  CMD+=" $(printf '%q' "$a")"
done

SESSION="polymarket-telonex-converter"
WINDOW="convert"

# Create (or reuse) a dedicated session, then a fresh window for this run.
if tmux has-session -t "$SESSION" 2>/dev/null; then
  first_pane="$(tmux new-window -t "$SESSION" -n "$WINDOW" -c "$REPO_DIR" -P -F '#{pane_id}')"
else
  tmux new-session -d -s "$SESSION" -n "$WINDOW" -c "$REPO_DIR"
  first_pane="$(tmux list-panes -t "$SESSION:$WINDOW" -F '#{pane_id}' | head -n1)"
fi

# Track the window by id, not name: once the panes start `npm`, tmux's
# automatic-rename would change the window name and break name-based targeting.
WINDOW_ID="$(tmux display-message -p -t "$first_pane" '#{window_id}')"
tmux set-window-option -t "$WINDOW_ID" automatic-rename off >/dev/null
tmux rename-window -t "$WINDOW_ID" "$WINDOW"

panes=("$first_pane")
for ((i = 1; i < PANES; i++)); do
  p="$(tmux split-window -t "$first_pane" -c "$REPO_DIR" -P -F '#{pane_id}')"
  panes+=("$p")
  tmux select-layout -t "$first_pane" tiled >/dev/null
done

idx=1
for p in "${panes[@]}"; do
  tmux select-pane -t "$p" -T "cv-$idx" 2>/dev/null || true
  tmux send-keys -t "$p" "$CMD" C-m
  idx=$((idx + 1))
done

echo "[telonex-convert-fanout] launched $PANES panes in tmux $SESSION:$WINDOW"
echo "[telonex-convert-fanout] cmd: $CMD"

# Attach if we're outside tmux; otherwise just jump to the new window.
if [ -z "${TMUX:-}" ]; then
  tmux attach -t "$SESSION"
else
  tmux select-window -t "$WINDOW_ID"
fi
