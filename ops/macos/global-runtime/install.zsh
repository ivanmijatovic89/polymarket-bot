#!/bin/zsh

# Install the Global Runtime daemon as a launchd system daemon (issue #213).
#
#   ./install.zsh --user <account> [--repo-dir /Users/<account>/Sites/polymarket-bot]
#
# Renders the two templates for this machine, installs the boot helper and
# plist, and bootstraps the service. Requires an admin (sudo) session. Meant
# for always-on machines (worker-1/worker-2 style Mac minis); on laptops the
# daemon is usually run manually in tmux instead.

set -euo pipefail

readonly artifact_dir="${0:A:h}"
readonly daemon_dir="/Library/LaunchDaemons"
readonly helper_path="/usr/local/libexec/polymarket-start-global-runtime-at-boot"
readonly plist_name="com.polymarket.global-runtime.plist"

user=""
repo_dir=""
while (( $# > 0 )); do
  case "$1" in
    --user) user="${2:-}"; shift 2 ;;
    --repo-dir) repo_dir="${2:-}"; shift 2 ;;
    *) print -u2 "unknown option: $1"; exit 64 ;;
  esac
done

if [[ -z "${user}" ]]; then
  print -u2 "--user is required (the account the daemon runs as)"
  exit 64
fi
if [[ -z "${repo_dir}" ]]; then
  repo_dir="/Users/${user}/Sites/polymarket-bot"
fi

# --- Preflight ---------------------------------------------------------------
if [[ ! -d "${repo_dir}" ]]; then
  print -u2 "repo directory ${repo_dir} does not exist"
  exit 64
fi
if [[ ! -f "${repo_dir}/.env" ]]; then
  print -u2 "${repo_dir}/.env is missing — the daemon needs DATABASE_* and GLOBAL_RUNTIME_* settings"
  exit 64
fi
if ! /usr/bin/grep -qE '^GLOBAL_RUNTIME_TOKEN=..+' "${repo_dir}/.env"; then
  print -u2 "GLOBAL_RUNTIME_TOKEN is not set in ${repo_dir}/.env — required for tailnet daemons (openssl rand -hex 32, same value fleet-wide)"
  exit 64
fi
if ! sudo -u "${user}" /bin/zsh -lic 'command -v claude || command -v codex' >/dev/null 2>&1; then
  print -u2 "neither claude nor codex CLI is on ${user}'s PATH — install and log in before enabling the daemon"
  exit 64
fi

print "Administrator access is required to install the boot service."
sudo -v

# --- Render + install --------------------------------------------------------
tmp_dir="$(mktemp -d)"
trap '/bin/rm -rf "${tmp_dir}"' EXIT

/usr/bin/sed -e "s|__USER__|${user}|g" -e "s|__REPO_DIR__|${repo_dir}|g" \
  "${artifact_dir}/com.polymarket.global-runtime.plist.template" > "${tmp_dir}/${plist_name}"
/usr/bin/sed -e "s|__REPO_DIR__|${repo_dir}|g" \
  "${artifact_dir}/start-global-runtime-at-boot.zsh.template" > "${tmp_dir}/start-global-runtime-at-boot.zsh"

sudo /usr/bin/pmset -a autorestart 1
sudo /bin/mkdir -p /usr/local/libexec
sudo /usr/bin/install -o root -g wheel -m 0755 \
  "${tmp_dir}/start-global-runtime-at-boot.zsh" "${helper_path}"
sudo /usr/bin/install -o root -g wheel -m 0644 \
  "${tmp_dir}/${plist_name}" "${daemon_dir}/${plist_name}"

sudo -u "${user}" /bin/mkdir -p "${repo_dir}/logs/global-runtime"
sudo /bin/launchctl bootout "system/com.polymarket.global-runtime" 2>/dev/null || true
sudo /bin/launchctl bootstrap system "${daemon_dir}/${plist_name}"

print "Installation completed. Attach with: tmux attach -t polymarket-global-runtime"
