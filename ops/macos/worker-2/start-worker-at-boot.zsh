#!/bin/zsh

set -u

readonly repo_dir="/Users/worker-2/Sites/polymarket-bot"
readonly env_file="${repo_dir}/.env"
readonly tmux_bin="/opt/homebrew/bin/tmux"
readonly session_name="polymarket-backtest-worker"
readonly worker_log="${repo_dir}/logs/workers/polymarket-backtest-worker.log"
readonly max_attempts=120

if "${tmux_bin}" has-session -t "${session_name}" 2>/dev/null; then
  print "$(date -Iseconds) ${session_name} is already running"
  exit 0
fi

if [[ ! -r "${env_file}" ]]; then
  print -u2 "$(date -Iseconds) cannot read ${env_file}"
  exit 75
fi

redis_url="$(/usr/bin/awk -F= '$1 == "REDIS_URL" { sub(/^[^=]*=/, ""); print; exit }' "${env_file}")"
redis_url="${redis_url#\"}"
redis_url="${redis_url%\"}"
redis_url="${redis_url#\'}"
redis_url="${redis_url%\'}"

if [[ -z "${redis_url}" ]]; then
  print -u2 "$(date -Iseconds) REDIS_URL is missing from ${env_file}"
  exit 75
fi

redis_authority="${redis_url#*://}"
redis_authority="${redis_authority%%/*}"
redis_host_port="${redis_authority##*@}"
redis_host="${redis_host_port%%:*}"
redis_port="6379"

if [[ "${redis_host_port}" == *:* ]]; then
  redis_port="${redis_host_port##*:}"
  redis_port="${redis_port%%\?*}"
fi

if [[ -z "${redis_host}" || -z "${redis_port}" ]]; then
  print -u2 "$(date -Iseconds) could not parse the Redis host and port"
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

/bin/mkdir -p "${repo_dir}/logs/workers"

readonly worker_command="exec /bin/zsh -lic 'exec ./scripts/run-worker.sh --queues markets >> ${worker_log} 2>&1'"
"${tmux_bin}" new-session -d -s "${session_name}" -c "${repo_dir}" "${worker_command}"

print "$(date -Iseconds) started ${session_name}; run-worker.sh will resolve market concurrency"
