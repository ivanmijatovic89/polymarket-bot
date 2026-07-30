# STATUS — pair-fable / mission 01

Updated: 2026-07-30 (session 5 — PLAN `metrics-and-capital-units`)

## Current work

PLAN item `metrics-and-capital-units` DONE (passes:true with evidence).
Nothing in flight.

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
- `metrics-and-capital-units`: probe strategy pair-fable-probe-capital-v0 +
  run 856 (3 markets, 22 taker fills, both sides, winning-side settlement).
  cost==invested CONFIRMED to the cent; pnl identity exact; taker fee curve
  verified; intent_meta dedup proven (8 fills → 7 meta entries);
  meta=intent≠execution (price improvement observed). Capital units + SQL +
  meta convention in memory/process/evaluator.md; P-002 sharpened.

## Next step

Take PLAN item `tools-launch-and-smoke`: build tools/run-backtest.ts
(canonical launcher enforcing RULES pins, flag validation against the
silent-typo hazard, latency sweeps) and tools/smoke.ts (mandatory pre-fleet
local gate). Machine-parsable output; recover run ids via DB (P-003
workaround pattern from backtest-cli.md).

## Blockers

None.

## Needs human

Nothing blocking. When convenient, review PROPOSALS (7 open):
- P-001 (extend drops parent latency — latency-pinned runs non-extendable
  until fixed)
- P-002 (persist buy notional — sharpened with exact columns; pair-fable no
  longer blocked, priority low)
- P-003 (sequential runs print no run id)
- P-004 (producer machine unexpectedly runs 5 worker slots — needs ruling)
- P-005 (place_batch >15 backtests fine but is rejected wholesale live)
- P-006 (cancel_order works by clientOrderId in backtest but orderId live —
  either-only is a silent no-op in one mode)
- P-007 (live cancelOrder swallows API errors and always reports 'canceled')

## Inbox processed through

(none — no inbox file / entries yet)
