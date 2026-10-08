#!/bin/zsh
# First installation of the independent catalog only. Never controls the capture service.
set -euo pipefail
readonly service_root=/Users/worker-2/Services/polymarket-recorder-v4-catalog
readonly target=system/com.polymarket.recorder-v4-catalog
readonly installed=/Library/LaunchDaemons/com.polymarket.recorder-v4-catalog.plist
readonly env_file=/Users/worker-2/.config/polymarket-recorder-v4-catalog/production.env
readonly log_dir=/Users/worker-2/Library/Logs/polymarket-recorder-v4-catalog
fail() { print -u2 -- "[recorder-catalog-install] $*"; exit 1; }
[[ $# -eq 3 ]] || fail 'Usage: sudo zsh install-service.zsh ABSOLUTE_PLIST FULL_COMMIT PLIST_SHA256'
[[ $EUID -eq 0 && "$(/usr/bin/uname -s)" == Darwin ]] || fail 'Requires macOS and sudo.'
readonly candidate=$1 commit=$2 expected_hash=$3
[[ "$commit" =~ '^[a-f0-9]{40}$' && "$expected_hash" =~ '^[a-f0-9]{64}$' ]] || fail 'Invalid commit or checksum.'
[[ "$candidate" == /* && -f "$candidate" && ! -L "$candidate" ]] || fail 'Expected a regular absolute candidate file.'
[[ ! -e "$installed" && ! -L "$installed" ]] || fail 'Catalog service is already installed; inspect before updating.'
if /bin/launchctl print "$target" >/dev/null 2>&1; then fail 'Catalog service is already loaded.'; fi
readonly release="$service_root/releases/$commit"
[[ -d "$release" && ! -L "$release" ]] || fail 'Pinned catalog release is missing.'
[[ "$(/usr/bin/git -c "safe.directory=$release" -C "$release" rev-parse HEAD)" == "$commit" ]] || fail 'Release commit differs.'
[[ -z "$(/usr/bin/git -c "safe.directory=$release" -C "$release" status --porcelain --untracked-files=all)" ]] || fail 'Release must be clean.'
[[ -f "$env_file" && ! -L "$env_file" && "$(/usr/bin/stat -f '%Su:%Lp' "$env_file")" == worker-2:600 ]] || fail 'Catalog config must be a regular worker-2-owned mode-0600 file.'
[[ -d "$log_dir" && ! -L "$log_dir" && "$(/usr/bin/stat -f '%Su' "$log_dir")" == worker-2 ]] || fail 'Catalog log directory must belong to worker-2.'
for suffix in '' .1 .2 .3; do
  file="$log_dir/catalog.log$suffix"
  [[ ! -L "$file" ]] || fail 'Log symlinks are not allowed.'
  if [[ -e "$file" ]]; then
    [[ -f "$file" && "$(/usr/bin/stat -f '%Su' "$file")" == worker-2 && "$(/usr/bin/stat -f '%z' "$file")" -le 8388608 ]] || fail 'Invalid existing bounded catalog log.'
  fi
done
readonly stage="$(/usr/bin/mktemp -d /private/tmp/recorder-catalog-install.XXXXXX)"
trap '/bin/rm -f "$stage/reviewed.plist" "$stage/reviewed.json"; /bin/rmdir "$stage"' EXIT
/usr/bin/install -o root -g wheel -m 0600 "$candidate" "$stage/reviewed.plist"
[[ "$(/usr/bin/shasum -a 256 "$stage/reviewed.plist" | /usr/bin/awk '{print $1}')" == "$expected_hash" ]] || fail 'Plist checksum differs.'
/usr/bin/plutil -lint "$stage/reviewed.plist" >/dev/null
/usr/bin/plutil -convert json -o "$stage/reviewed.json" "$stage/reviewed.plist"
readonly node_bin="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$stage/reviewed.plist")"
[[ "$node_bin" == /Users/worker-2/.nvm/versions/node/v20.*/bin/node && -x "$node_bin" ]] || fail 'Expected worker-2 Node 20.'
[[ "$(/usr/bin/env -i PATH=/usr/bin:/bin "$node_bin" --version)" == v20.* ]] || fail 'Node 20 required.'
for file in scripts/recorder-service.mjs scripts/lib/bounded-log.mjs src/cli/recorder-v4-catalog.ts node_modules/tsx/package.json; do
  [[ -f "$release/$file" ]] || fail "Missing release file: $file"
done
/usr/bin/env -i PATH=/usr/bin:/bin "$node_bin" --input-type=module - "$stage/reviewed.json" "$node_bin" "$release" "$env_file" "$log_dir" <<'JS'
import { readFileSync } from 'node:fs';
const [file, node, release, envFile, logDir] = process.argv.slice(2);
const { validateCatalogServicePlist } = await import(`${release}/scripts/lib/catalog-service-plist.mjs`);
validateCatalogServicePlist(JSON.parse(readFileSync(file, 'utf8')), { node, release, envFile, logDir });
JS
/usr/bin/install -o root -g wheel -m 0644 "$stage/reviewed.plist" "$installed"
/bin/launchctl enable "$target"
/bin/launchctl bootstrap system "$installed"
print -- '[recorder-catalog-install] Catalog installed. Verify fresh MySQL catalog status and both durations. Capture service was not changed.'
