#!/usr/bin/env bash
#
# Fan out `npm run telonex:download` across N tmux panes.
#
# The downloader claims markets with `SELECT ... FOR UPDATE SKIP LOCKED`, so any
# number of independent processes cooperate safely on the same queue — each pane
# just pulls the next unclaimed market. This launcher opens one tmux window with
# N tiled panes, each running the same command, so you can watch all workers at
# once.
#
# Usage:
#   ./scripts/telonex-download-fanout.sh <num-panes> --slug-pattern '<pat>[,<pat>...]' [extra args]
#
# Examples:
#   ./scripts/telonex-download-fanout.sh 6 --slug-pattern 'btc-updown-15m-%'
#   ./scripts/telonex-download-fanout.sh 4 --slug-pattern 'btc-updown-15m-%,eth-updown-15m-%' --limit 500
#
# Runs in its own tmux session `polymarket-telonex-downloader`. Kill the whole
# fan-out with: tmux kill-session -t polymarket-telonex-downloader
#
# Any extra args after the slug-pattern are forwarded verbatim to telonex:download
# (e.g. --concurrency, --limit, --channel). --slug-pattern is required.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PANES="${1:-}"
if ! [[ "$PANES" =~ ^[0-9]+$ ]] || [ "$PANES" -lt 1 ]; then
  echo "usage: $0 <num-panes> --slug-pattern '<pat>[,<pat>...]' [extra telonex:download args]" >&2
  exit 1
fi
shift

# --slug-pattern must be present in the forwarded args (downloader requires it).
case " $* " in
  *" --slug-pattern "*) : ;;
  *)
    echo "error: --slug-pattern is required, e.g. --slug-pattern 'btc-updown-15m-%'" >&2
    exit 1
    ;;
esac

# Build the per-pane command, quoting each forwarded arg so patterns survive the
# trip through tmux send-keys.
CMD="npm run telonex:download --"
for a in "$@"; do
  CMD+=" $(printf '%q' "$a")"
done

SESSION="polymarket-telonex-downloader"
WINDOW="download"

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
  tmux select-pane -t "$p" -T "dl-$idx" 2>/dev/null || true
  tmux send-keys -t "$p" "$CMD" C-m
  idx=$((idx + 1))
done

echo "[telonex-download-fanout] launched $PANES panes in tmux $SESSION:$WINDOW"
echo "[telonex-download-fanout] cmd: $CMD"

# Attach if we're outside tmux; otherwise just jump to the new window.
if [ -z "${TMUX:-}" ]; then
  tmux attach -t "$SESSION"
else
  tmux select-window -t "$WINDOW_ID"
fi
