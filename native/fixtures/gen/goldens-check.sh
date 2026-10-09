#!/usr/bin/env bash
# native:goldens:check (60 §7.1 GF-4): regenerates every golden from the TS
# oracle in memory and fails on any content difference (the header's
# contentPin is ignored). Dataset-backed telonex markets are checked only
# where <repo>/data has them; committed fixtures are always checked.
set -euo pipefail
cd "$(dirname "$0")/../../.."
for gen in book_gen telonex_crafted_gen telonex_book_gen; do
  npx tsx "native/fixtures/gen/${gen}.ts" --check
done
