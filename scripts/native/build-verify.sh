#!/usr/bin/env bash
# Builder part of native:verify:local (60 LG-1, 31 §7.6), run on worker-1
# before every milestone proof. Meant to be called from
# scripts/native/verify-local.sh.
#
#   scripts/native/build-verify.sh
#
# 1. Builder unit and end-to-end tests (src/strategy/artifacts/native/).
# 2. Reproducibility proof: the proof package from two directories and two
#    target directories gives one sha (31 §4.3, D17). Moving the engine
#    checkout is covered by the e2e tests.
# 3. Once native/strategies exists (31 §2.3): strategy:check, the engine-CI
#    subset (--ci), and the canonical local-only builds of every bin with
#    the parity-check binary next to each (31 §7.5, 60 §8.1); every build
#    runs selftest and the describe checks (31 §4.4).
# The profile-independence check of 31 §7.6 (iterate vs artifact vs
# parity-check results on the fixture markets) needs the `run` subcommand
# and the fixtures of 60 §12; it is reported as pending until they exist.
#
# Builds run at background QoS with the host's CARGO_BUILD_JOBS (31 §4.5).
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "== builder tests (31 §4, §5, §7)"
npm run -s artifacts:native:test

echo "== builder reproducibility proof (31 §4.3, D17)"
scripts/native/build-repro-proof.sh

if [ -f native/strategies/Cargo.toml ]; then
  echo "== native/strategies: strategy:check (31 §7.1)"
  npm run -s strategy:check -- --repo native/strategies
  echo "== native/strategies: engine-CI subset (31 §7.6)"
  npm run -s strategy:check -- --ci --repo native/strategies
  for src in native/strategies/src/bin/*.rs; do
    bin="$(basename "$src" .rs)"
    echo "== canonical local-only build: $bin (31 §7.5, 60 §8.1)"
    npm run -s strategy:publish -- --local-only --parity-check --repo native/strategies --bin "$bin"
  done
  echo "PENDING: profile-independence check (31 §7.6) needs the run subcommand and the fixture markets (60 §12)"
else
  echo "PENDING: native/strategies does not exist yet (31 §2.3); strategy:check, canonical builds and the profile-independence check start with it"
fi
echo "native build verify OK"
