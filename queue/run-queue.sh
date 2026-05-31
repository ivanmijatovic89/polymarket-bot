#!/usr/bin/env bash
set -euo pipefail

# Script can live in ./queue/run-queue.sh
# Always run from project root so relative paths are correct.
cd "$(dirname "$0")/.."

# -------------------------
# Defaults
# -------------------------
# JOBS=1: each backtest now uses the in-batch BullMQ worker pool (PR2) and
# consumes all available cores by itself; running multiple batches in
# parallel here would just oversubscribe CPU. Pass --jobs N to override
# for small or --sequential batches that don't benefit from BullMQ.
SAVE_RESULTS=0
JOBS=1
POLL=2

# -------------------------
# Parse CLI flags
# -------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --save-results)
      SAVE_RESULTS=1
      shift
      ;;
    --jobs|-j)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --jobs"; exit 1; }
      JOBS="$1"
      [[ "$JOBS" =~ ^[0-9]+$ ]] && [[ "$JOBS" -ge 1 ]] || { echo "--jobs must be a positive integer"; exit 1; }
      shift
      ;;
    --help|-h)
      echo "Usage: ./queue/run-queue.sh [--save-results] [--jobs N]"
      echo
      echo "Options:"
      echo "  --save-results       Save batch stdout/stderr to queue/logs/results/"
      echo "  --jobs, -j N         Number of parallel jobs (default: 4)"
      echo
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# -------------------------
# Config
# -------------------------
JOBS_DIR="queue"
APPROVE_DIR="$JOBS_DIR/approve"
PENDING_DIR="$JOBS_DIR/pending"
RUNNING_DIR="$JOBS_DIR/running"
DONE_DIR="$JOBS_DIR/done"
FAILED_DIR="$JOBS_DIR/failed"

LOG_DIR="$JOBS_DIR/logs"              # small, always on
RESULTS_DIR="$JOBS_DIR/logs/results"  # big, optional

# -------------------------
# Ensure dirs exist
# -------------------------
mkdir -p "$APPROVE_DIR" "$PENDING_DIR" "$RUNNING_DIR" "$DONE_DIR" "$FAILED_DIR" "$LOG_DIR"
[[ "$SAVE_RESULTS" == "1" ]] && mkdir -p "$RESULTS_DIR"

# -------------------------
# One-runner lock (macOS-friendly): mkdir is atomic
# -------------------------
LOCK_DIR="$JOBS_DIR/.runner.lock"

if mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$$" > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
else
  echo "❌ Another queue runner is already running."
  [[ -f "$LOCK_DIR/pid" ]] && echo "Lock PID: $(cat "$LOCK_DIR/pid")"
  echo "If stale (crash/reboot), remove it:"
  echo "  rm -rf $LOCK_DIR"
  exit 1
fi

# -------------------------
# Ensure GNU parallel citation is accepted (prevents noisy output)
# -------------------------
parallel --citation >/dev/null 2>&1 || true

echo "Queue runner started."
echo "Watching: $PENDING_DIR"
echo "Parallel jobs: $JOBS"
echo "Poll interval: ${POLL}s"
echo "Joblog: $LOG_DIR/parallel.log"
if [[ "$SAVE_RESULTS" == "1" ]]; then
  echo "Batch results: ENABLED  -> $RESULTS_DIR/<batch>/{out.log,err.log}"
else
  echo "Batch results: DISABLED (use --save-results)"
fi
echo "Stop: Ctrl+C"

# -------------------------
# Main loop
# -------------------------
while true; do
  # Pick next pending batch file. For deterministic order, name files like 0001-..., 0002-...
  file="$(ls -1 "$PENDING_DIR"/*.txt 2>/dev/null | head -n 1 || true)"

  [[ -z "$file" ]] && sleep "$POLL" && continue

  base="$(basename "$file")"
  claimed="$RUNNING_DIR/$base"

  # If a file with the same name is already in running, we skip (prevents accidental overwrite).
  if [[ -e "$claimed" ]]; then
    echo "⚠️  '$base' already exists in running/. Skipping."
    echo "    Resolve by moving/removing '$claimed' (likely from a previous interrupted run)."
    sleep "$POLL"
    continue
  fi

  # Atomic claim: pending -> running (clean name, no timestamp)
  mv "$file" "$claimed"
  echo
  echo "==> Processing batch: $base"

  # Filter out blank lines and comment lines:
  # - ignores empty/whitespace-only lines
  # - ignores lines starting with optional whitespace then '#'
  filtered="$RUNNING_DIR/$base.filtered"
  grep -Ev '^[[:space:]]*$|^[[:space:]]*#' "$claimed" > "$filtered" || true

  if [[ ! -s "$filtered" ]]; then
    echo "⚠️  Empty batch after filtering."
    rm -f "$filtered"
    mv "$claimed" "$DONE_DIR/$base"
    continue
  fi

  batch_name="${base%.txt}"
  batch_log_dir="$RESULTS_DIR/$batch_name"

  set +e
  if [[ "$SAVE_RESULTS" == "1" ]]; then
    mkdir -p "$batch_log_dir"
    parallel \
      -j "$JOBS" \
      --bar --eta \
      --joblog "$LOG_DIR/parallel.log" \
      bash -lc '{}' \
      :::: "$filtered" \
      > "$batch_log_dir/out.log" \
      2> "$batch_log_dir/err.log"
    exit_code=$?
  else
    parallel \
      -j "$JOBS" \
      --bar --eta \
      --joblog "$LOG_DIR/parallel.log" \
      bash -lc '{}' \
      :::: "$filtered"
    exit_code=$?
  fi
  set -e

  rm -f "$filtered"

  if [[ $exit_code -eq 0 ]]; then
    mv "$claimed" "$DONE_DIR/$base"
    echo "✅ Done: $base"
  else
    mv "$claimed" "$FAILED_DIR/$base"
    echo "❌ Failed: $base (exit=$exit_code)"
    echo "See: $LOG_DIR/parallel.log"
    [[ "$SAVE_RESULTS" == "1" ]] && echo "Batch stderr: $batch_log_dir/err.log"
  fi
done
