#!/usr/bin/env bash
# Serialize fleet lifecycle commands (pull / update / start / stop) so two of
# them never race for the same worker sessions — the class of bug that showed
# up as START_FAILED when a pull and a start ran at once. Data commands
# (fleet:data:sync) are independent and are NOT locked.
#
# Portable (no flock — macOS lacks it): an atomic `mkdir` is the lock, a
# trap releases it, and a stale lock from a `kill -9` is detected by checking
# whether the recorded PID is still alive.

FLEET_LOCK_DIR="${FLEET_LOCK_DIR:-/tmp/polymarket-fleet.lock}"

acquire_fleet_lock() {
  local label="$1"
  if ! mkdir "$FLEET_LOCK_DIR" 2>/dev/null; then
    local holder_pid holder_label
    holder_pid="$(cat "$FLEET_LOCK_DIR/pid" 2>/dev/null || echo '')"
    holder_label="$(cat "$FLEET_LOCK_DIR/label" 2>/dev/null || echo 'a fleet command')"
    if [ -n "$holder_pid" ] && kill -0 "$holder_pid" 2>/dev/null; then
      echo "[fleet-lock] '$holder_label' (pid $holder_pid) is already running — wait for it to finish." >&2
      echo "[fleet-lock] fleet lifecycle commands must not overlap (they'd race for the same worker sessions)." >&2
      exit 1
    fi
    # Holder is gone (killed hard) — reclaim the stale lock.
    echo "[fleet-lock] reclaiming stale lock from '$holder_label' (pid ${holder_pid:-unknown}, no longer running)." >&2
    rm -rf "$FLEET_LOCK_DIR"
    mkdir "$FLEET_LOCK_DIR" 2>/dev/null || { echo "[fleet-lock] could not acquire lock" >&2; exit 1; }
  fi
  echo "$$" >"$FLEET_LOCK_DIR/pid"
  echo "$label" >"$FLEET_LOCK_DIR/label"
  # Release on any exit of the wrapper.
  trap 'rm -rf "$FLEET_LOCK_DIR"' EXIT
}
