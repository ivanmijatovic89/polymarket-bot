#!/usr/bin/env bash
# native:contract:export (21 §3 "Schema files"): regenerate the JSON Schema
# bundle native/contract/schema/v1/*.schema.json and the hash fixture
# native/contract/fixtures/hashes.json from pmb-contract, then format them
# with Prettier (the drift checks compare parsed JSON, so formatting is
# Prettier's alone).
set -euo pipefail
cd "$(dirname "$0")/../.."
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}" # 01 §8.1 H4
(cd native && cargo run -q --locked -p pmb-contract --bin export-schema)
npx prettier --log-level warn --write native/contract/schema native/contract/fixtures/hashes.json
