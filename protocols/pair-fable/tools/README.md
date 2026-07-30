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
| `fleet.ts` | Read-only fleet/queue status (`tsx protocols/pair-fable/tools/fleet.ts [--json]`): queue counts for both BullMQ queues, worker heartbeats (alive = hb age <30s) with SHA/processed/lastMarket, active batches with child progress. Built early by `fleet-round-trip`; the `tools-results-and-compare` item may extend it. |
| `run-backtest.ts` | THE canonical launcher — never call `npm run backtest` directly for protocol runs. Injects every RULES pin (telonex-delta, read-from local-or-download, btc/15m, floor `--from-ms`, latency 140/20, provenance), hard-errors on unknown flags (the raw CLI silently drops typos), refuses `--extend` (P-001: latency not replayed), pre-checks HEAD∈origin/main for queue submissions (SHA-gate hang prevention), and generates a unique `--batchUid` per launch so the run id is recovered deterministically from `backtest_runs.batch_uid` (P-003 workaround) with headline stats + capital units attached. `--sweep-latency 140,300,600` fans one run per latency. `--dry-run` prints the composed argv. Result JSON on stdout with `--json`; child output streams to stderr. Deliberate escapes: `--override-floor`, `--latency-delay-ms/-jitter-ms` (auditable — flags land in `cmd`). |
| `smoke.ts` | The MANDATORY pre-fleet gate: `tsx protocols/pair-fable/tools/smoke.ts --strategy <id> [--param k=v] [--limit N≤20] [--json]`. Runs `protocol:check` for `pair-fable-*` strategies (registry is fail-soft — a broken file otherwise surfaces as "unknown strategy"), then delegates to `run-backtest.ts --sequential` (valid for unpushed code). Prints `SMOKE PASS/FAIL` + run id + headline stats; exit 0 only on PASS (row exists, status completed, 0 failures, markets > 0). PASS means "runs and persists sane rows", not "strategy is good". |

Planned (built by PLAN items, listed here so names stay stable):

| Tool | Purpose | PLAN item |
| --- | --- | --- |
| `results.ts` | Read a run/batch from DB → capital-aware summary | `tools-results-and-compare` |
| `compare.ts` | Compare two or more runs on the same universe | `tools-results-and-compare` |
| `refresh-capabilities.ts` | Engine-change discovery vs memory SHAs | `capability-refresh-procedure` |
