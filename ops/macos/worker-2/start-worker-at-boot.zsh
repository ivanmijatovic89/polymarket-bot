#!/bin/zsh

set -u

readonly repo_dir="/Users/worker-2/Sites/polymarket-bot"
readonly tmux_bin="/opt/homebrew/bin/tmux"
readonly session_name="polymarket-backtest-worker"
readonly worker_log="${repo_dir}/logs/workers/polymarket-backtest-worker.log"
readonly max_attempts=120
readonly startup_check_delay=2
readonly redis_endpoint_marker="POLYMARKET_REDIS_ENDPOINT"

if "${tmux_bin}" has-session -t "${session_name}" 2>/dev/null; then
  print "$(date -Iseconds) ${session_name} is already running"
  exit 0
fi

if ! resolver_output="$(
  cd "${repo_dir}" &&
    /bin/zsh -lic 'exec ./node_modules/.bin/tsx ./src/cli/resolveRedisEndpoint.ts'
)"; then
  print -u2 "$(date -Iseconds) could not resolve REDIS_URL through the application environment loader"
  exit 75
fi

redis_endpoint_line="${resolver_output##*$'\n'}"
if [[ "${redis_endpoint_line}" != "${redis_endpoint_marker}"$'\t'*$'\t'* ]]; then
  print -u2 "$(date -Iseconds) Redis endpoint resolver returned unexpected output"
  exit 75
fi

redis_endpoint="${redis_endpoint_line#*$'\t'}"
redis_host="${redis_endpoint%%$'\t'*}"
redis_port="${redis_endpoint#*$'\t'}"

if [[ -z "${redis_host}" || -z "${redis_port}" || "${redis_host}" == "${redis_endpoint}" ]]; then
  print -u2 "$(date -Iseconds) Redis endpoint resolver returned an invalid host or port"
  exit 75
fi

attempt=1
while (( attempt <= max_attempts )); do
  if /usr/bin/nc -z "${redis_host}" "${redis_port}"; then
    break
  fi

  if (( attempt == 1 || attempt % 12 == 0 )); then
    print "$(date -Iseconds) waiting for Redis at ${redis_host}:${redis_port} (attempt ${attempt}/${max_attempts})"
  fi

  /bin/sleep 5
  (( attempt += 1 ))
done

if (( attempt > max_attempts )); then
  print -u2 "$(date -Iseconds) Redis did not become reachable"
  exit 75
fi

if ! /bin/mkdir -p "${repo_dir}/logs/workers"; then
  print -u2 "$(date -Iseconds) could not create the worker log directory"
  exit 75
fi

readonly worker_command="exec /bin/zsh -lic 'exec ./scripts/run-worker.sh --queues markets >> ${worker_log} 2>&1'"
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

print "$(date -Iseconds) ${start_result}; run-worker.sh will resolve market concurrency"
