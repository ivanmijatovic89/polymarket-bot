#!/usr/bin/env bash
# Serialize fleet lifecycle commands (pull / update / start / stop) so two of
# them never race for the same worker sessions — the class of bug that showed
# up as START_FAILED when a pull and a start ran at once. Data commands
# (fleet:data:sync) are independent and are NOT locked.
#
# Portable (no flock — macOS lacks it): an atomic `mkdir` is the lock, a
# trap releases only a lock still owned by this PID, and a second atomic
# directory serializes stale-lock reclamation.

FLEET_LOCK_DIR="${FLEET_LOCK_DIR:-/tmp/polymarket-fleet.lock}"

release_fleet_lock() {
  local holder_pid
  holder_pid="$(cat "$FLEET_LOCK_DIR/pid" 2>/dev/null || echo '')"
  [ "$holder_pid" = "$$" ] || return 0
  rm -f "$FLEET_LOCK_DIR/pid" "$FLEET_LOCK_DIR/label"
  rmdir "$FLEET_LOCK_DIR" 2>/dev/null || true
}

write_fleet_lock_owner() {
  local label="$1"
  printf '%s\n' "$$" >"$FLEET_LOCK_DIR/pid"
  printf '%s\n' "$label" >"$FLEET_LOCK_DIR/label"
  trap release_fleet_lock EXIT
}

acquire_fleet_lock() {
  local label="$1"
  if mkdir "$FLEET_LOCK_DIR" 2>/dev/null; then
    write_fleet_lock_owner "$label"
    return 0
  fi

  local holder_pid holder_label reclaim_dir current_pid
  holder_pid="$(cat "$FLEET_LOCK_DIR/pid" 2>/dev/null || echo '')"
  holder_label="$(cat "$FLEET_LOCK_DIR/label" 2>/dev/null || echo 'a fleet command')"

  # A creator writes ownership immediately after mkdir. Never delete a lock
  # whose metadata is not visible yet: that was the acquisition race this
  # helper exists to prevent. An interrupted incomplete lock is intentionally
  # fail-closed and can be inspected/removed manually.
  if [ -z "$holder_pid" ]; then
    echo "[fleet-lock] lock exists without owner metadata — refusing to reclaim it automatically: $FLEET_LOCK_DIR" >&2
    exit 1
  fi
  if kill -0 "$holder_pid" 2>/dev/null; then
    echo "[fleet-lock] '$holder_label' (pid $holder_pid) is already running — wait for it to finish." >&2
    echo "[fleet-lock] fleet lifecycle commands must not overlap (they'd race for the same worker sessions)." >&2
    exit 1
  fi

  # Only one contender may inspect/delete a stale lock. Re-read ownership
  # after acquiring this guard so a changed/live lock is never removed.
  reclaim_dir="${FLEET_LOCK_DIR}.reclaim"
  if ! mkdir "$reclaim_dir" 2>/dev/null; then
    echo "[fleet-lock] another process is reclaiming the stale lock — retry shortly." >&2
    exit 1
  fi
  current_pid="$(cat "$FLEET_LOCK_DIR/pid" 2>/dev/null || echo '')"
  if [ "$current_pid" != "$holder_pid" ] || [ -z "$current_pid" ]; then
    rmdir "$reclaim_dir" 2>/dev/null || true
    echo "[fleet-lock] lock ownership changed while reclaiming — retry shortly." >&2
    exit 1
  fi
  if kill -0 "$current_pid" 2>/dev/null; then
    rmdir "$reclaim_dir" 2>/dev/null || true
    echo "[fleet-lock] lock holder became live while reclaiming — retry shortly." >&2
    exit 1
  fi

  echo "[fleet-lock] reclaiming stale lock from '$holder_label' (pid $holder_pid, no longer running)." >&2
  rm -f "$FLEET_LOCK_DIR/pid" "$FLEET_LOCK_DIR/label"
  if ! rmdir "$FLEET_LOCK_DIR" 2>/dev/null; then
    rmdir "$reclaim_dir" 2>/dev/null || true
    echo "[fleet-lock] stale lock contains unexpected files; refusing to remove it: $FLEET_LOCK_DIR" >&2
    exit 1
  fi
  if ! mkdir "$FLEET_LOCK_DIR" 2>/dev/null; then
    rmdir "$reclaim_dir" 2>/dev/null || true
    echo "[fleet-lock] another process acquired the lock first — retry shortly." >&2
    exit 1
  fi
  write_fleet_lock_owner "$label"
  rmdir "$reclaim_dir" 2>/dev/null || true
}
