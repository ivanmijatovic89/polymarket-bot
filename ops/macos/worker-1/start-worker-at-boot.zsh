#!/bin/zsh

set -u

readonly repo_dir="/Users/worker-1/Sites/polymarket-bot"
readonly tmux_bin="/opt/homebrew/bin/tmux"
readonly session_name="polymarket-backtest-worker"
readonly worker_log="${repo_dir}/logs/workers/polymarket-backtest-worker.log"
readonly max_attempts=120
readonly startup_check_delay=2

if "${tmux_bin}" has-session -t "${session_name}" 2>/dev/null; then
  print "$(date -Iseconds) ${session_name} is already running"
  exit 0
fi

attempt=1
while (( attempt <= max_attempts )); do
  if /usr/bin/nc -z 127.0.0.1 3306 && /usr/bin/nc -z 127.0.0.1 6379; then
    break
  fi

  if (( attempt == 1 || attempt % 12 == 0 )); then
    print "$(date -Iseconds) waiting for MySQL and Redis (attempt ${attempt}/${max_attempts})"
  fi

  /bin/sleep 5
  (( attempt += 1 ))
done

if (( attempt > max_attempts )); then
  print -u2 "$(date -Iseconds) MySQL or Redis did not become ready"
  exit 75
fi

if ! /bin/mkdir -p "${repo_dir}/logs/workers"; then
  print -u2 "$(date -Iseconds) could not create the worker log directory"
  exit 75
fi

readonly worker_command="exec /bin/zsh -lic 'exec ./scripts/run-worker.sh --queues markets,aggregate >> ${worker_log} 2>&1'"
start_result="started ${session_name}"
if ! "${tmux_bin}" new-session -d -s "${session_name}" -c "${repo_dir}" "${worker_command}"; then
  if "${tmux_bin}" has-session -t "${session_name}" 2>/dev/null; then
    start_result="${session_name} was started by another launcher"
  else
    print -u2 "$(date -Iseconds) failed to create ${session_name}"
    exit 75
  fi
fi

/bin/sleep "${startup_check_delay}"
if ! "${tmux_bin}" has-session -t "${session_name}" 2>/dev/null; then
  print -u2 "$(date -Iseconds) ${session_name} exited during startup"
  exit 75
fi

print "$(date -Iseconds) ${start_result}"
