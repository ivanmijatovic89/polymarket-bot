#!/usr/bin/env bash
#
# Self-updating launcher for the backtest worker.
#
# The worker exits with code 75 when it picks up a job built on a newer commit
# than the code it loaded (a new/changed strategy that isn't in its in-memory
# registry). On that signal we pull the new code and relaunch — so neither this
# machine nor any remote worker ever runs a stale strategy registry.
#
# Any other exit code (0 = clean shutdown / Ctrl-C, non-zero = crash) stops the
# loop and is propagated, so tmux/systemd see the real status.
#
# Usage (drop-in replacement for `npm run backtest:worker --`):
#   ./scripts/run-worker.sh --queues markets --market-concurrency 5
#
set -uo pipefail

SELF_UPDATE_EXIT_CODE=75
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

TSX="$REPO_DIR/node_modules/.bin/tsx"
if [ ! -x "$TSX" ]; then
  echo "[run-worker] tsx not found at $TSX — run 'npm install' first." >&2
  exit 1
fi

WORKER_PID=""
forward_signal() {
  # Ctrl-C / SIGTERM: forward to the worker so it drains, then stop looping.
  if [ -n "$WORKER_PID" ]; then
    kill -TERM "$WORKER_PID" 2>/dev/null || true
  fi
}
trap forward_signal INT TERM

while true; do
  # Capture the commit the worker is ABOUT to load. The loop guard below
  # compares against this, not against pre-pull HEAD, so a commit made locally
  # (not yet pushed) still triggers a clean restart: the pull is a no-op but the
  # relaunch picks up the newer local HEAD.
  launch_sha="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

  # Run the worker directly under tsx so its exit code reaches us verbatim
  # (npm would rewrite it).
  "$TSX" src/cli/backtestWorker.ts "$@" &
  WORKER_PID=$!
  wait "$WORKER_PID"
  code=$?
  WORKER_PID=""

  if [ "$code" -ne "$SELF_UPDATE_EXIT_CODE" ]; then
    echo "[run-worker] worker exited code=$code — stopping."
    exit "$code"
  fi

  echo "[run-worker] update requested — syncing code…"
  git fetch --quiet || echo "[run-worker] git fetch failed (offline?) — continuing"
  if ! git pull --ff-only --quiet; then
    echo "[run-worker] git pull --ff-only failed (diverged/dirty/wrong branch)" >&2
  fi
  after="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

  # CRITICAL loop guard: a restart only helps if it loads a DIFFERENT commit
  # than the worker just ran. If HEAD still equals what we launched with, we
  # cannot reach the commit the job needs (dirty tree, diverged/wrong branch,
  # offline, or an unpushed producer commit on another machine). Relaunching
  # would just exit 75 again — an infinite loop. Stop with a clear error.
  if [ "$after" = "$launch_sha" ]; then
    echo "[run-worker] ERROR: update requested but HEAD is unchanged (still ${after:0:8})." >&2
    echo "[run-worker] The worker cannot reach the commit its jobs need. Push the commit," >&2
    echo "[run-worker] clean the tree, or switch to the tracked branch, then restart." >&2
    exit 1
  fi

  # Reinstall deps only when the lockfile actually changed across the update.
  if ! git diff --quiet "$launch_sha" "$after" -- package-lock.json 2>/dev/null; then
    echo "[run-worker] package-lock.json changed — running npm install"
    npm install
  fi

  echo "[run-worker] relaunching worker on ${after:0:8}"
done
