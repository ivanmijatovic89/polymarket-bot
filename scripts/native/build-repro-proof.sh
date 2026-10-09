#!/usr/bin/env bash
# Builder reproducibility proof (31 §4.3, §5.1; D17): create the std-only
# proof package twice at two different directory depths, build each with
# `strategy:publish --local-only` into its own fresh target directory, and
# require identical sha256s. Writes the artifact into the local cache
# data/strategy-artifacts/native/ (31 §6.1); touches neither R2 nor any DB.
#
#   CARGO_BUILD_JOBS=3 scripts/native/build-repro-proof.sh [work dir under /private/tmp]
set -euo pipefail
cd "$(dirname "$0")/../.."
WORK="${1:-$(mktemp -d /private/tmp/pmb-builder-repro.XXXXXX)}"
mkdir -p "$WORK"
A="$WORK/a"
B="$WORK/b/deeper/nested"
scripts/native/build-proof-package.sh "$A" >/dev/null
scripts/native/build-proof-package.sh "$B" >/dev/null
# The sha of the bytes each build produced (gate 5 line), not the printed
# cache sha: source-hash dedupe (31 §5.6 step 2) would print the earlier sha.
sha_of() {
  npm run -s strategy:publish -- --local-only --repo "$1/strategies" --bin builder-proof \
    --target-dir "$2" >"$2.log" 2>&1 || { cat "$2.log" >&2; return 1; }
  grep -o 'sha256=[0-9a-f]\{64\}' "$2.log" | head -1 | cut -d= -f2
}
# Fresh target directories whose paths differ in length as well as content:
# the linker's debug map once made the bytes depend on that length.
SHA_A="$(sha_of "$A" "$WORK/target-a")"
SHA_B="$(sha_of "$B" "$WORK/b/deeper/target-of-a-longer-path")"
echo "package A: $A/strategies -> $SHA_A"
echo "package B: $B/strategies -> $SHA_B"
if [ -z "$SHA_A" ] || [ "$SHA_A" != "$SHA_B" ]; then
  echo "REPRO FAIL: the two builds differ" >&2
  exit 1
fi
echo "REPRO OK: identical sha256 from two directories"
