# STATUS — pair-fable / mission 01

Updated: 2026-07-30 (session 4 — PLAN `parity-boundary-map`)

## Current work

PLAN item `parity-boundary-map` DONE (passes:true with evidence). Nothing in
flight.

## Completed

- Initializer: PLAN.json (10 items), memory/tools skeletons, capability
  notes seeded, proposals P-001/P-002 filed.
- `smoke-local-backtest`: canonical sequential backtest run-verified (runs
  852/853); tools/sql.ts; P-003.
- `fleet-round-trip`: canonical fleet batches run-verified (runs 854/855,
  EXIT=0, no intervention); tools/fleet.ts; ~870 markets/min over 27 slots;
  P-004.
- `parity-boundary-map`: memory/capabilities/parity.md written @ e96b246 —
  shared core, per-intent simulated-boundary table, both survey open
  questions resolved (place_batch cap live-only; FOK = visible depth,
  exchange internals parked), 8 binding strategy conventions, 8-point
  live-trust evidence bar. Filed P-005/P-006/P-007. Also repaired PLAN.json
  (session 2's edit had left it invalid JSON — parity item lost its
  id/opening brace).

## Next step

Take PLAN item `metrics-and-capital-units`: design capital-aware units
(invested/market, profit per $100, EV at capital levels), test the
cost==invested hypothesis on a real run (needs a multi-buy run incl.
winning-side settlement — run 852 only covered the losing-side single-buy
case), define the intent_meta stamping convention, update P-002.

## Blockers

None.

## Needs human

Nothing blocking. When convenient, review PROPOSALS (7 open):
- P-001 (extend drops parent latency — latency-pinned runs non-extendable
  until fixed)
- P-002 (persist invested capital)
- P-003 (sequential runs print no run id)
- P-004 (producer machine unexpectedly runs 5 worker slots — needs ruling)
- P-005 (NEW: place_batch >15 backtests fine but is rejected wholesale live)
- P-006 (NEW: cancel_order works by clientOrderId in backtest but orderId
  live — either-only is a silent no-op in one mode)
- P-007 (NEW: live cancelOrder swallows API errors and always reports
  'canceled' — resting exposure can silently persist)

## Inbox processed through

(none — no inbox file / entries yet)
