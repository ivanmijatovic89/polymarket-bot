# STATUS — pair-fable / mission 01

Updated: 2026-07-30 (session 6 — PLAN `tools-results-and-compare`)

## Current work

PLAN item `tools-results-and-compare` DONE (passes:true with evidence, runs
857/858/859/860 + SQL cross-checks). Nothing in flight.

## Completed

- Initializer: PLAN.json (10 items), memory/tools skeletons, capability
  notes seeded, proposals P-001/P-002 filed.
- `smoke-local-backtest`: canonical sequential backtest run-verified (runs
  852/853); tools/sql.ts; P-003.
- `fleet-round-trip`: canonical fleet batches run-verified (runs 854/855,
  EXIT=0, no intervention); tools/fleet.ts; ~870 markets/min over 27 slots;
  P-004.
- `parity-boundary-map`: memory/capabilities/parity.md @ e96b246 — shared
  core, simulated-boundary table, 8 conventions, live-trust bar;
  P-005/P-006/P-007; repaired PLAN.json.
- `metrics-and-capital-units`: probe strategy + run 856. cost==invested
  CONFIRMED to the cent; taker fee curve verified; intent_meta dedup proven.
  Capital units in memory/process/evaluator.md; P-002 sharpened.
- `tools-launch-and-smoke`: tools/run-backtest.ts (canonical launcher) +
  tools/smoke.ts (mandatory pre-fleet gate). Run-verified run 857 + FAIL path.
- `tools-results-and-compare`: tools/lib/runQueries.ts (shared query module —
  run-backtest/sql/smoke refactored onto it, one code path for all numbers),
  tools/results.ts (headline + capital units + p/100 distribution + failures;
  verified against direct SQL on run 857), tools/compare.ts (slug-intersection
  fair compare, Δ vs baseline, movers, daily pnl + Pearson, latency-sweep
  auto-detect; verified on 856v857, 854v855-vs-SQL-JOIN, 858v859 real sweep).
  fleet.ts counts match Bull Board API exactly. --sweep-latency now
  live-verified (runs 858/859); smoke re-verified post-refactor (run 860).
  Jitter noise floor observed: ±0.05 pnl on 3 markets for identical configs.

## Next step

Take PLAN item `baseline-pair-strategy`: implement pair-fable-v0 (alternating
small-increment maker BUY accumulation both sides, fee-inclusive pair<$1 gate,
no sells/merges, capital-cap param per evaluator.md convention, intent_meta
stamping per convention). Gate: smoke.ts → push → small fleet batch (~50
markets) via run-backtest.ts → read via results.ts → sanity-check behavior →
learnings into memory/experiments/.

## Blockers

None.

## Needs human

Nothing blocking. When convenient, review PROPOSALS (7 open):
- P-001 (extend drops parent latency — launcher REFUSES --extend until fixed)
- P-002 (persist buy notional — sharpened; priority low)
- P-003 (sequential runs print no run id — mitigated at tool layer; low)
- P-004 (producer machine unexpectedly runs 5 worker slots — needs ruling)
- P-005 (place_batch >15 fine in backtest but rejected wholesale live)
- P-006 (cancel_order id-space mismatch backtest vs live)
- P-007 (live cancelOrder swallows API errors, always reports 'canceled')

## Inbox processed through

(none — no inbox file / entries yet)
