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
| `run-backtest.ts` | THE canonical launcher — never call `npm run backtest` directly for protocol runs. Injects every RULES pin (telonex-delta, read-from local-or-download, btc/15m, floor `--from-ms`, latency 140/20, provenance), hard-errors on unknown flags (the raw CLI silently drops typos), refuses `--extend` (P-001: latency not replayed), pre-checks HEAD∈origin/main for queue submissions (SHA-gate hang prevention), and generates a unique `--batchUid` per launch so the run id is recovered deterministically from `backtest_runs.batch_uid` (P-003 workaround) with headline stats + capital units attached. `--sweep-latency 140,300,600` fans one run per latency. `--dry-run` prints the composed argv. No `--limit` = FULL universe: an explicit huge limit is injected because the engine's eligibility query silently caps at 1000 oldest markets (P-008; run 864 was bitten). Result JSON on stdout with `--json`; child output streams to stderr. Deliberate escapes: `--override-floor`, `--latency-delay-ms/-jitter-ms` (auditable — flags land in `cmd`). |
| `smoke.ts` | The MANDATORY pre-fleet gate: `tsx protocols/pair-fable/tools/smoke.ts --strategy <id> [--param k=v] [--limit N≤20] [--json]`. Runs `protocol:check` for `pair-fable-*` strategies (registry is fail-soft — a broken file otherwise surfaces as "unknown strategy"), then delegates to `run-backtest.ts --sequential` (valid for unpushed code). Prints `SMOKE PASS/FAIL` + run id + headline stats; exit 0 only on PASS (row exists, status completed, 0 failures, markets > 0). PASS means "runs and persists sane rows", not "strategy is good". |
| `lib/runQueries.ts` | Shared read-only query module (not a CLI): `openDb`, run identity by ids/batch-uid/label/protocol, `fetchHeadline` (the kind='all' segment), `fetchUnits` (capital units incl. `unitsValid` = split_cost==0 guard), `fetchMarkets`, `fetchSegments`, `fetchFailures`, `parseLatencyFromCmd` (null ⇒ env-sourced ⇒ not RULES-grade evidence), `quantile`. run-backtest.ts, results.ts, compare.ts and sql.ts all report through this one code path. Units keys are camelCase (`investedTotal`, `profitPer100`, …) everywhere. |
| `results.ts` | Run/batch summary from MySQL: `tsx protocols/pair-fable/tools/results.ts (--run id[,id…] \| --batch-uid X \| --label L [--limit N] \| --last N) [--markets] [--segments daily\|weekly\|monthly\|last_n] [--json]`. Per run: identity + cmd-parsed latency, the 'all'-segment headline, capital units per `memory/process/evaluator.md` (investedTotal/Max/AvgPlayed, capital-weighted profitPer100 + per-market median/p10/p90 distribution), failure rows, optional per-market table and segment breakdowns. Flags `UNITS-INVALID` when split_cost≠0 and `ENV-SOURCED` latency. Exit 2 on any bad flag or empty selector match. |
| `compare.ts` | Fair multi-run comparison: `tsx protocols/pair-fable/tools/compare.ts --runs a,b[,c…] [--movers N] [--json]`. First run = baseline. Deltas are computed ONLY on the slug INTERSECTION of the runs (full-run totals shown for context); reports universe overlap, per-run common-universe stats (pnl, ev/mkt total-denominator, profitPer100, won/lost/flat, maker/taker), Δ vs baseline, biggest per-market \|Δpnl\| movers (2-run case), daily-pnl buckets + positive-day fraction + pairwise Pearson correlation (≥3 common days; the variant-independence measure). Auto-detects a latency sweep (same strategy+params, distinct cmd-recorded latencies) and orders rows by latency — the RULES upward-sweep view. Jitter makes identical-config runs differ slightly; judge deltas against that noise floor (observed ±0.05 on 3 markets). |

| `evaluate.ts` | The executable form of `memory/process/evaluator.md`: stage verdicts for one variant. `tsx protocols/pair-fable/tools/evaluate.ts --full-run <id> [--design-ts <ms\|ISO>] [--sweep-runs a,b,c,d] [--screen-run <id> --screen-baseline <id>] [--noise-ev f] [--json]`. Computes mechanical checks, headline+units, weekly walk-forward (engine `computeWalkForwardForRun`, partial weeks <300 markets dropped), monthly EV table, design-ts OOS split, latency-sweep verdict on the slug intersection (+ taker-share-vs-latency warning), screen verdict vs noise floor, and the overall stage verdict (KILL/ITERATE/CANDIDATE/CHAMPION-ELIGIBLE per evaluator.md). Verdicts are data: exit 0 whenever evaluable, exit 2 on bad flags/missing runs. |

Planned (built by PLAN items, listed here so names stay stable):

| Tool | Purpose | PLAN item |
| --- | --- | --- |
| `refresh-capabilities.ts` | Engine-change discovery vs memory SHAs | `capability-refresh-procedure` |
