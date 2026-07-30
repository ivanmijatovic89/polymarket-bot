# STATUS — pair-fable / mission 01

Updated: 2026-07-30 (session 6 — PLAN `tools-launch-and-smoke`)

## Current work

PLAN item `tools-launch-and-smoke` DONE (passes:true with evidence, run 857).
Five-session self-check performed this session: no drift, no plan correction
needed. Nothing in flight.

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
- `tools-launch-and-smoke`: tools/run-backtest.ts (canonical launcher — pins
  injected, unknown flags fatal, --extend refused per P-001, --override-floor
  escape, HEAD∈origin/main pre-check, --sweep-latency fan-out, deterministic
  run recovery via unique --batchUid = P-003 mitigation) + tools/smoke.ts
  (mandatory pre-fleet gate: protocol:check + sequential run + PASS/FAIL).
  Run-verified both ways: run 857 SMOKE PASS; nonexistent strategy → FAIL
  exit 1. All 4 PLAN steps evidenced.

## Next step

Take PLAN item `tools-results-and-compare`: build tools/results.ts (run/batch
summary incl. capital units — much of the SQL already exists in
run-backtest.ts's recovery query, factor accordingly), tools/compare.ts
(multi-run EV deltas, per-segment stability, latency-sweep table), extend
tools/fleet.ts only if gaps appear. Verify results.ts by hand against direct
SQL for run 857; verify compare.ts on two real runs (e.g. 856 vs 857).

## Blockers

None.

## Needs human

Nothing blocking. When convenient, review PROPOSALS (7 open):
- P-001 (extend drops parent latency — launcher now REFUSES --extend until
  fixed)
- P-002 (persist buy notional — sharpened; priority low)
- P-003 (sequential runs print no run id — mitigated at tool layer via
  unique batchUid; engine print still nice-to-have, priority low)
- P-004 (producer machine unexpectedly runs 5 worker slots — needs ruling)
- P-005 (place_batch >15 backtests fine but is rejected wholesale live)
- P-006 (cancel_order works by clientOrderId in backtest but orderId live —
  either-only is a silent no-op in one mode)
- P-007 (live cancelOrder swallows API errors and always reports 'canceled')

## Inbox processed through

(none — no inbox file / entries yet)
