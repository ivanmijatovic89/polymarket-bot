#!/usr/bin/env bash
set -euo pipefail

# Script can live in ./queue/run-queue.sh
# Always run from project root so relative paths are correct.
cd "$(dirname "$0")/.."

# -------------------------
# Config
# -------------------------
JOBS_DIR="queue"
APPROVE_DIR="$JOBS_DIR/approve"
PENDING_DIR="$JOBS_DIR/pending"
RUNNING_DIR="$JOBS_DIR/running"
DONE_DIR="$JOBS_DIR/done"
FAILED_DIR="$JOBS_DIR/failed"   # optional but recommended

# We keep batch logs under: queue/logs/results/<batch-name>/{out.log,err.log}
LOG_DIR="$JOBS_DIR/logs/results"

# Parallelism + poll interval
JOBS="${JOBS:-4}"     # override: JOBS=8 ./queue/run-queue.sh
POLL="${POLL:-2}"     # seconds between checks when pending is empty

# -------------------------
# Ensure dirs exist
# -------------------------
mkdir -p "$APPROVE_DIR" "$PENDING_DIR" "$RUNNING_DIR" "$DONE_DIR" "$FAILED_DIR" "$LOG_DIR"

# -------------------------
# One-runner lock (macOS-friendly): mkdir is atomic
# -------------------------
LOCK_DIR="$JOBS_DIR/.runner.lock"

if mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$$" > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
else
  echo "❌ Another queue runner is already running."
  if [[ -f "$LOCK_DIR/pid" ]]; then
    echo "Lock PID: $(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  fi
  echo "If it's stale (crash/reboot), remove it:"
  echo "  rm -rf $LOCK_DIR"
  exit 1
fi

# -------------------------
# Ensure GNU parallel citation is accepted (prevents noisy output)
# -------------------------
parallel --citation >/dev/null 2>&1 || true

echo "Queue runner started."
echo "Watching: $PENDING_DIR  (JOBS=$JOBS, POLL=${POLL}s)"
echo "Joblog:   $LOG_DIR/parallel.log"
echo "Batch logs under: $LOG_DIR/<batch-name>/{out.log,err.log}"
echo "Stop: Ctrl+C"

# -------------------------
# Main loop
# -------------------------
while true; do
  # Pick next pending batch file. For deterministic order, name files like 0001-..., 0002-...
  file="$(ls -1 "$PENDING_DIR"/*.txt 2>/dev/null | head -n 1 || true)"

  if [[ -z "${file}" ]]; then
    sleep "$POLL"
    continue
  fi

  base="$(basename "$file")"
  claimed="$RUNNING_DIR/$base"

  # If a file with the same name is already in running, we skip (prevents accidental overwrite).
  if [[ -e "$claimed" ]]; then
    echo "⚠️  Skipping '$file' because '$claimed' already exists."
    echo "    Resolve by moving/removing '$claimed' (likely from a previous interrupted run)."
    sleep "$POLL"
    continue
  fi

  # Atomic claim: pending -> running (clean name, no timestamp)
  mv "$file" "$claimed"
  echo
  echo "==> Processing batch: $claimed"

  # Batch log folder: queue/logs/results/<batch-name>/
  # If file is v5-grid.txt => folder v5-grid
  batch_name="${base%.txt}"
  batch_log_dir="$LOG_DIR/$batch_name"
  mkdir -p "$batch_log_dir"

  # Filter out blank lines and comment lines:
  # - ignores empty/whitespace-only lines
  # - ignores lines starting with optional whitespace then '#'
  filtered="$RUNNING_DIR/$base.filtered"
  grep -Ev '^[[:space:]]*$|^[[:space:]]*#' "$claimed" > "$filtered" || true

  if [[ ! -s "$filtered" ]]; then
    echo "⚠️  No runnable commands after filtering comments/blank lines."
    rm -f "$filtered"
    mv "$claimed" "$DONE_DIR/$base"
    echo "✅ Done -> $DONE_DIR/$base"
    continue
  fi

  # Run the batch with GNU parallel.
  # Each line must be a FULL shell command.
  # bash -lc makes it behave like your interactive shell (npm, env vars, &&, etc.)
  # We capture combined stdout/stderr for the whole batch into:
  #   queue/logs/results/<batch-name>/out.log
  #   queue/logs/results/<batch-name>/err.log
  set +e
  parallel \
    -j "$JOBS" \
    --bar --eta \
    --joblog "$LOG_DIR/parallel.log" \
    bash -lc '{}' \
    :::: "$filtered" \
    > "$batch_log_dir/out.log" \
    2> "$batch_log_dir/err.log"
  exit_code=$?
  set -e

  rm -f "$filtered"

  if [[ $exit_code -eq 0 ]]; then
    mv "$claimed" "$DONE_DIR/$base"
    echo "✅ Done -> $DONE_DIR/$base"
  else
    mv "$claimed" "$FAILED_DIR/$base"
    echo "❌ Failed (exit=$exit_code) -> $FAILED_DIR/$base"
    echo "Check:"
    echo "  - Joblog:   $LOG_DIR/parallel.log"
    echo "  - Batch:    $batch_log_dir/err.log"
  fi
done
