# pair-fable tools

Executable helpers the protocol builds for itself. Conventions:

- TypeScript, run with `tsx protocols/pair-fable/tools/<name>.ts` from the
  repo root. ES modules, same style as `src/cli/`.
- Reuse engine modules (`src/db/*`, `src/config/env.ts`) — never inline SQL
  against `telonex_markets` / `telonex_market_conversions` (CLAUDE.md gotcha:
  eligibility lives in `src/db/telonexMarkets.ts` only).
- Tools are read-only on the database unless their whole point is a
  submission. Nothing here mutates engine state.
- Every tool prints machine-parsable output (JSON with `--json`, terse tables
  otherwise) — sessions and, later, parallel agents consume it.
- RULES pins are ENFORCED by the launch tools, not remembered by the caller:
  canonical latency flags (`--latency-delay-ms 140 --latency-jitter-ms 20`
  unless deliberately swept), provenance (`--protocol pair-fable --model
  <model-id>`), the 2026-04-02 universe floor (`--from-ms 1775088000000`),
  input mode `telonex-delta`, read mode `local-or-download-from-r2-to-local`.

Built:

| Tool | Purpose |
| --- | --- |
| `sql.ts` | Read-only ad-hoc SQL against the backtest MySQL (`tsx protocols/pair-fable/tools/sql.ts "SELECT ..."`); refuses non-SELECT statements. For verification queries; recurring reads become dedicated tools. |

Planned (built by PLAN items, listed here so names stay stable):

| Tool | Purpose | PLAN item |
| --- | --- | --- |
| `run-backtest.ts` | Canonical single/batch launcher with pins + deliberate overrides | `tools-launch-and-smoke` |
| `smoke.ts` | Local `--sequential` smoke run of a strategy on a few markets | `tools-launch-and-smoke` |
| `results.ts` | Read a run/batch from DB → capital-aware summary | `tools-results-and-compare` |
| `compare.ts` | Compare two or more runs on the same universe | `tools-results-and-compare` |
| `fleet.ts` | Queue depth / worker / run-progress status | `tools-results-and-compare` |
| `refresh-capabilities.ts` | Engine-change discovery vs memory SHAs | `capability-refresh-procedure` |
