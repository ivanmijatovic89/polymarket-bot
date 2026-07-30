# STATUS — pair-fable / mission 01

Updated: 2026-07-30 (loop session 7 / journal session 8 — PLAN
`baseline-pair-strategy`)

## Current work

PLAN item `baseline-pair-strategy` DONE (passes:true with evidence, runs
861/862). Nothing in flight. The research loop is now proven END-TO-END:
strategy code → protocol:check → smoke gate → push → fleet batch → results/
compare → memory.

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
- `tools-results-and-compare`: tools/lib/runQueries.ts (one query path for
  all tools), tools/results.ts, tools/compare.ts — all verified against
  direct SQL (runs 856-860 incl. real latency sweep 858v859). Jitter noise
  floor: ±0.05 pnl on 3 markets.
- `baseline-pair-strategy`: pair-fable-v0 @ bcca2c8
  (protocols/pair-fable/strategies/pair.v0.ts) — lesser-side GTD maker
  accumulation, projected-pair-avg ≤0.98 gate, $50 cap param, meta stamped.
  Smoke run 861 PASS; fleet run 862 (50 mkts, 21.8s, 0 failures, provenance
  + latency pins in cmd). Behavior invariants verified in SQL (imbalance ≤
  increment, split_cost 0, cap binds at exactly $50, 290/1 maker/taker).
  NOT profitable (EV −2.43/mkt, p/100 −8.94 — expected for the baseline);
  loss anatomy + 6 variant ideas in memory/experiments/pair-v0.md; ledger
  E-001. Learned: placement-time maker check ≠ maker guarantee (1/291 fills
  went taker via latency drift).

## Next step

Take PLAN item `evaluator-design`: complete memory/process/evaluator.md —
stage pipeline (cheap screen → full universe → upward latency sweep →
temporal holdout/walk-forward), promotion criteria, overfitting guards,
variant-independence measure; dry-run the pipeline once on the
baseline-pair-strategy results (runs 861/862 exist as material; a full-
universe or sweep run of pair-fable-v0 can be launched cheaply via
tools/run-backtest.ts — 50 mkts took 21.8s, full universe ~15 min).

## Blockers

None.

## Needs human

Nothing blocking. When convenient, review PROPOSALS (7 open):
- P-001 (extend drops parent latency — launcher REFUSES --extend until fixed)
- P-002 (persist buy notional — sharpened; priority low)
- P-003 (sequential runs print no run id — mitigated at tool layer; low)
- P-004 (producer machine unexpectedly runs 5 worker slots — needs ruling;
  seen again in run 862: 5 markets on 8955f8d87c59)
- P-005 (place_batch >15 fine in backtest but rejected wholesale live)
- P-006 (cancel_order id-space mismatch backtest vs live)
- P-007 (live cancelOrder swallows API errors, always reports 'canceled')

## Inbox processed through

(none — no inbox file / entries yet)
