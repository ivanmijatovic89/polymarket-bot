#!/usr/bin/env bash
# native:ci:local (60 §14.1): the local mirror of CI-1 + the TS checks.
# Grows with each milestone step until it equals CI-1 plus CI-2.
set -euo pipefail
cd "$(dirname "$0")/../.."
JOBS="${CARGO_BUILD_JOBS:-4}" # 01 §8.1 H4: cargo at -j 4 alongside the fleet
export CARGO_BUILD_JOBS="$JOBS"

echo "== native/ (engine workspace)"
(cd native && cargo fmt --all --check \
  && cargo clippy --workspace --all-targets --locked -- -D warnings \
  && cargo test --workspace --locked -q)

if [ -f native/strategies/Cargo.toml ]; then
  echo "== native/strategies/ (strategy package)"
  (cd native/strategies && cargo fmt --all --check \
    && cargo clippy --all-targets --locked -- -D warnings \
    && cargo test --locked -q)
fi

if [ "${NATIVE_CI_SKIP_TS:-0}" != "1" ]; then
  echo "== TS (eslint, typecheck)"
  npm run -s code:eslint
  npm run -s code:typecheck
fi
echo "native:ci:local OK"
