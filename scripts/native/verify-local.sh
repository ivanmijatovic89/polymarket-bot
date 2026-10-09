#!/usr/bin/env bash
# native:verify:local (60 §14 LG-1). Starts as native:ci:local; gains the
# canonical builds, selftest, fixture parity and the DET suite in M1 steps 5-6.
set -euo pipefail
cd "$(dirname "$0")/../.."
scripts/native/ci-local.sh
