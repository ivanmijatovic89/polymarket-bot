# Shared worker-control helpers, inlined into the pull/stop playbook shells via
# {{ lookup('file', ...) }} — single source of truth, no extra SSH round trip.
# Pure POSIX-ish sh; no GNU-only flags (macOS ships BSD tools).

# Echo the tmux binary path, or empty if none found.
resolve_tmux() {
  _t="$(command -v tmux || true)"
  for _c in /opt/homebrew/bin/tmux /usr/local/bin/tmux /usr/bin/tmux; do
    [ -n "$_t" ] && break
    [ -x "$_c" ] && _t="$_c"
  done
  printf '%s' "$_t"
}

# List PIDs of NODE processes running the worker entrypoint. The comm check
# excludes an editor/tail/grep someone has open on that file; BSD xargs has no
# -r, so callers must guard on empty (kill_strays does).
strays() {
  pgrep -f 'cli/backtestWorker[.]ts' 2>/dev/null | while read -r _pid; do
    [ "$(ps -o comm= -p "$_pid" 2>/dev/null | sed 's:.*/::')" = node ] && echo "$_pid"
  done
}

# kill_strays SIGNAL — signal every stray, no-op when there are none.
kill_strays() {
  _pids="$(strays)"
  [ -n "$_pids" ] && echo "$_pids" | xargs kill "-$1" 2>/dev/null || true
}

# worker_alive TMUX SESSION — 0 if the managed session or any stray is up.
worker_alive() {
  { [ -n "$1" ] && "$1" has-session -t "$2" 2>/dev/null; } && return 0
  [ -n "$(strays)" ] && return 0
  return 1
}

# drain_workers TMUX SESSION GRACE — Ctrl-C the session and SIGTERM strays,
# then wait up to GRACE seconds. Returns 0 if everything exited, 1 if not.
drain_workers() {
  { [ -n "$1" ] && "$1" has-session -t "$2" 2>/dev/null && "$1" send-keys -t "$2" C-c 2>/dev/null; } || true
  kill_strays TERM
  _waited=0
  while [ "$_waited" -lt "$3" ] && worker_alive "$1" "$2"; do
    sleep 2
    _waited=$((_waited + 2))
  done
  worker_alive "$1" "$2" && return 1 || return 0
}

# hard_stop TMUX SESSION — kill the managed session and SIGKILL strays.
hard_stop() {
  { [ -n "$1" ] && "$1" kill-session -t "$2" 2>/dev/null; } || true
  kill_strays KILL
}
