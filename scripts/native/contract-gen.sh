#!/usr/bin/env bash
# native:contract:gen (21 §3 "TS types and validators"): re-export the schema
# bundle, then regenerate src/native/contract/generated.ts from it.
set -euo pipefail
cd "$(dirname "$0")/../.."
scripts/native/contract-export.sh
npx tsx src/native/contract/gen.ts --write
