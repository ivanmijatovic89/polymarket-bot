#!/bin/zsh
# Update only the existing worker-2 V4 service. No recorder state or archive operations.
set -euo pipefail

readonly service_root=/Users/worker-2/Services/polymarket-recorder-v4
readonly installed_plist=/Library/LaunchDaemons/com.polymarket.recorder-v4.plist
readonly service_target=system/com.polymarket.recorder-v4
readonly expected_user=worker-2
readonly env_file=/Users/worker-2/.config/polymarket-recorder-v4/production.env
readonly log_dir=/Users/worker-2/Library/Logs/polymarket-recorder-v4
readonly required_uid=0
readonly stop_wait_seconds=75
readonly launchctl_bin=/bin/launchctl
readonly plutil_bin=/usr/bin/plutil
readonly plist_buddy=/usr/libexec/PlistBuddy
readonly git_bin=/usr/bin/git
readonly stat_bin=/usr/bin/stat
readonly install_bin=/usr/bin/install
readonly ps_bin=/bin/ps
readonly sleep_bin=/bin/sleep

fail() { print -u2 -- "[recorder-v4-update] $*"; exit 1; }
[[ $# -eq 3 ]] || fail 'Usage: sudo zsh update-service.zsh /absolute/rendered.plist EXPECTED_COMMIT EXPECTED_PLIST_SHA256'
[[ $EUID -eq $required_uid ]] || fail 'Run this prepared update as root using sudo.'
[[ "$(/usr/bin/uname -s)" == Darwin ]] || fail 'This updater requires macOS.'
readonly candidate=$1
readonly expected_commit=$2
readonly expected_hash=$3
[[ "$candidate" == /* && -f "$candidate" && ! -L "$candidate" ]] || fail 'Candidate must be an absolute regular plist file.'
[[ "$expected_commit" =~ '^[a-f0-9]{40}$' ]] || fail 'Expected commit must be a full lowercase Git SHA.'
[[ "$expected_hash" =~ '^[a-f0-9]{64}$' ]] || fail 'Expected plist checksum must be a lowercase SHA-256.'
[[ -d "$service_root" && ! -L "$service_root" ]] || fail 'The existing V4 service root is required.'
[[ -f "$installed_plist" && ! -L "$installed_plist" ]] || fail 'The existing V4 service plist must be a regular file.'
readonly release="$service_root/releases/$expected_commit"
[[ -d "$release" && ! -L "$release" ]] || fail 'The exact pinned V4 release is missing.'
[[ -f "$env_file" && ! -L "$env_file" ]] || fail 'The existing production configuration must be a regular file.'
[[ "$("$stat_bin" -f '%Su:%Lp' "$env_file")" == "$expected_user:600" ]] || fail 'Production configuration must belong to worker-2 with mode 0600.'
[[ "$("$stat_bin" -f '%Su:%Lp' "$installed_plist")" == 'root:644' ]] || fail 'Installed V4 plist must belong to root with mode 0644.'
[[ "$("$git_bin" -c "safe.directory=$release" -C "$release" rev-parse HEAD)" == "$expected_commit" ]] || fail 'Release HEAD differs from the reviewed commit.'
[[ -z "$("$git_bin" -c "safe.directory=$release" -C "$release" status --porcelain --untracked-files=all)" ]] || fail 'The pinned release has local changes.'
for file in "$release/scripts/recorder-service.mjs" "$release/scripts/lib/bounded-log.mjs" "$release/src/cli/record-v4.ts" "$release/node_modules/tsx/package.json"; do
  [[ -f "$file" ]] || fail "Required release file missing: $file"
done

check_logs() {
  [[ -d "$log_dir" && ! -L "$log_dir" ]] || fail 'The existing V4 log directory must be a real directory.'
  [[ "$("$stat_bin" -f '%Su' "$log_dir")" == "$expected_user" ]] || fail 'The log directory must belong to worker-2.'
  local file
  for file in "$log_dir/recorder.log" "$log_dir/recorder.log.1" "$log_dir/recorder.log.2" "$log_dir/recorder.log.3"; do
    [[ ! -L "$file" ]] || fail 'Log files must not be symbolic links.'
    if [[ -e "$file" ]]; then
      [[ -f "$file" ]] || fail 'Log destinations must be regular files.'
      [[ "$("$stat_bin" -f '%Su' "$file")" == "$expected_user" ]] || fail 'Existing logs must belong to worker-2.'
      [[ "$("$stat_bin" -f '%z' "$file")" -le 8388608 ]] || fail 'Existing log exceeds 8 MiB; archive it deliberately while stopped before retrying.'
    fi
  done
}
check_logs
"$plutil_bin" -lint "$candidate" >/dev/null

process_alive() { "$ps_bin" -p "$1" -o pid= >/dev/null 2>&1; }
service_pid() {
  "$launchctl_bin" print "$service_target" 2>/dev/null | /usr/bin/awk '$1 == "pid" && $2 == "=" { print $3; exit }'
}
wait_for_exit() {
  local pid=$1 attempts=0
  [[ -z "$pid" ]] && return 0
  while process_alive "$pid"; do
    (( attempts >= stop_wait_seconds )) && return 1
    "$sleep_bin" 1
    attempts=$((attempts + 1))
  done
}
wait_for_started() {
  local attempts=0 stable=0 previous='' pid=''
  while (( attempts < 30 )); do
    pid="$(service_pid || true)"
    if [[ "$pid" =~ '^[0-9]+$' ]] && process_alive "$pid"; then
      if [[ "$pid" == "$previous" ]]; then stable=$((stable + 1)); else stable=1; fi
      (( stable >= 3 )) && return 0
    else
      stable=0
    fi
    previous=$pid
    "$sleep_bin" 1
    attempts=$((attempts + 1))
  done
  return 1
}
readonly old_pid="$(service_pid || true)"
[[ "$old_pid" =~ '^[0-9]+$' ]] && process_alive "$old_pid" || fail 'V4 must currently be running; inspect its state before applying an update.'

readonly lock_dir="$service_root/.service-update-lock"
/bin/mkdir "$lock_dir" 2>/dev/null || fail 'Another updater or an interrupted update owns .service-update-lock; inspect it before retrying.'
print -r -- "$$" > "$lock_dir/pid"
stage=''
backup=''
transition=0
completed=0
stopping_pid=''

on_exit() {
  local result=$1 current_pid=''
  trap - EXIT INT TERM HUP
  set +e
  if (( ! completed && transition > 0 )); then
    print -u2 -- '[recorder-v4-update] Update interrupted; restoring the previous V4 service.'
    if (( transition == 1 )); then
      "$launchctl_bin" enable "$service_target" || result=1
    else
      "$launchctl_bin" disable "$service_target" >/dev/null 2>&1
      current_pid="$(service_pid || true)"
      if "$launchctl_bin" print "$service_target" >/dev/null 2>&1; then
        "$launchctl_bin" bootout "$service_target" || result=1
      fi
      if wait_for_exit "$current_pid" && wait_for_exit "$stopping_pid" && wait_for_exit "$old_pid"; then
        if "$install_bin" -o root -g wheel -m 0644 "$backup" "$installed_plist" &&
          "$launchctl_bin" enable "$service_target" &&
          "$launchctl_bin" bootstrap system "$installed_plist" && wait_for_started; then
          print -u2 -- '[recorder-v4-update] Previous V4 service restored. Recorder state was preserved.'
        else
          print -u2 -- "[recorder-v4-update] Rollback needs operator attention. Preserved plist: $backup"
          result=1
        fi
      else
        print -u2 -- "[recorder-v4-update] A previous process is still alive. V4 remains disabled to prevent overlapping writers. Preserved plist: $backup"
        result=1
      fi
    fi
  fi
  /bin/rm -f "$lock_dir/pid"
  /bin/rmdir "$lock_dir" 2>/dev/null
  exit "$result"
}
trap 'on_exit $?' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

stage="$(/usr/bin/mktemp -d "$service_root/service-update-$(/bin/date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
readonly staged_plist="$stage/reviewed.plist"
backup="$stage/previous-v4.plist"
"$install_bin" -o root -g wheel -m 0600 "$candidate" "$staged_plist"
actual_hash="$(/usr/bin/shasum -a 256 "$staged_plist" | /usr/bin/awk '{ print $1 }')"
[[ "$actual_hash" == "$expected_hash" ]] || fail 'Rendered plist checksum differs from the reviewed file.'
"$plutil_bin" -lint "$staged_plist" >/dev/null
readonly node_bin="$("$plist_buddy" -c 'Print :ProgramArguments:0' "$staged_plist")"
[[ "$node_bin" == /Users/worker-2/.nvm/versions/node/v20.*/bin/node && -f "$node_bin" && -x "$node_bin" ]] || fail 'The service must use worker-2 Node 20.'
[[ "$(/usr/bin/env -i PATH=/usr/bin:/bin "$node_bin" --version)" == v20.* ]] || fail 'The selected Node binary is not Node 20.'
"$plutil_bin" -convert json -o - "$staged_plist" | /usr/bin/env -i PATH=/usr/bin:/bin "$node_bin" --input-type=module -e '
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
const [node, release, envFile, logDir] = process.argv.slice(1);
const expected = {
 Label: "com.polymarket.recorder-v4", UserName: "worker-2", GroupName: "staff",
 ProgramArguments: [node, `${release}/scripts/recorder-service.mjs`, "--log-file", `${logDir}/recorder.log`, "--", "--import", "tsx", `${release}/src/cli/record-v4.ts`, "--env-file", envFile],
 WorkingDirectory: release, StandardOutPath: "/dev/null", StandardErrorPath: "/dev/null",
 RunAtLoad: true, KeepAlive: { SuccessfulExit: false }, ThrottleInterval: 60, ExitTimeOut: 60, ProcessType: "Standard"
};
if (!isDeepStrictEqual(JSON.parse(readFileSync(0, "utf8")), expected)) {
 console.error("The prepared plist does not exactly match the reviewed V4 supervisor template."); process.exit(1);
}
' "$node_bin" "$release" "$env_file" "$log_dir"
[[ "$("$plist_buddy" -c 'Print :Label' "$installed_plist")" == com.polymarket.recorder-v4 ]] || fail 'The installed service is not V4.'
[[ "$("$plist_buddy" -c 'Print :UserName' "$installed_plist")" == "$expected_user" ]] || fail 'The installed V4 service user differs.'
old_release="$("$plist_buddy" -c 'Print :WorkingDirectory' "$installed_plist")"
[[ "$old_release" == "$service_root"/releases/* ]] || fail 'The installed V4 release is outside the isolated release root.'
"$install_bin" -o root -g wheel -m 0600 "$installed_plist" "$backup"
print -r -- "[recorder-v4-update] Preserved previous V4 plist: $backup"

transition=1
"$launchctl_bin" disable "$service_target"
stopping_pid="$(service_pid || true)"
[[ "$stopping_pid" =~ '^[0-9]+$' ]] && process_alive "$stopping_pid" || fail 'V4 stopped during validation; inspect its state before retrying.'
transition=2
"$launchctl_bin" bootout "$service_target"
wait_for_exit "$stopping_pid" || fail 'The recorder did not exit within its shutdown grace period.'
wait_for_exit "$old_pid" || fail 'The old recorder did not exit within its shutdown grace period.'
check_logs
"$install_bin" -o root -g wheel -m 0644 "$staged_plist" "$installed_plist"
"$launchctl_bin" enable "$service_target"
"$launchctl_bin" bootstrap system "$installed_plist"
wait_for_started || fail 'The updated V4 service did not remain running.'
completed=1
print -r -- "[recorder-v4-update] V4 is running from $expected_commit. Verify fresh dashboard heartbeat, both market durations and archive progress."
