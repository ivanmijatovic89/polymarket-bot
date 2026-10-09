#!/usr/bin/env bash
# native:contract:check (21 §3 CI items 1, 2 and 6): fail when the committed
# schema bundle, hash fixture or generated TS types differ from what
# pmb-contract generates now, then run the TS contract tests (fixtures
# validate in TS; TS reproduces contractSha256 and modelConfigSha256).
set -euo pipefail
cd "$(dirname "$0")/../.."
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}" # 01 §8.1 H4
(cd native && cargo run -q --locked -p pmb-contract --bin export-schema -- --check)
npx prettier --log-level warn --check native/contract src/native/contract
npx tsx src/native/contract/gen.ts --check
npx tsx --test src/native/contract/*.test.ts
