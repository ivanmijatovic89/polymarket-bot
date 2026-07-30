# JOURNAL — pair-fable

## 2026-07-30 — Session 2 (smoke-local-backtest)

- Ran the first real backtests of the protocol: the canonical RULES-pinned
  command (telonex-delta, btc 15m, 2026-04-02 floor, 140/20 ms latency,
  `--protocol pair-fable --model claude-fable-5`) with `--sequential` on 5
  markets (run 852) and 1 market (run 853, exit code 0 captured exactly).
- Verified in MySQL: provenance columns land, `cmd` records the latency
  flags and floor, per-market rows and segment stats match the printed
  summary exactly. Small runs get all/daily/weekly/monthly segments;
  `last_n` needs ≥500 markets.
- Watched the maker fill model do what the code survey predicted: a resting
  10-share bid at 0.10 filled all-at-once, fee-free, only when the losing
  side collapsed through the level. Fill on the losing side in 5/5 markets —
  a nice reminder that cheap resting bids are adverse-selection magnets,
  relevant to the pair strategy's increment design.
- Local speed anchor confirmed: ~1.5 s/market sequential on the producer.
- Filed P-003: sequential backtests never print their run id or batchUid —
  automation has to fish the run out of the DB afterwards.
- Built the first tool: `tools/sql.ts`, a read-only SQL runner used for all
  of today's DB verification.
- Next: fleet round-trip (submit ~20 markets to the workers, measure real
  fleet throughput).

## 2026-07-30 — Session 1 (initializer)

- Read RULES and mission 01; confirmed I am the initializer (no PLAN.json).
- Surveyed the engine with five parallel code readers (backtest CLI, result
  storage/metrics, strategy system, execution simulator, fleet/queues) and
  spot-checked the load-bearing claims by hand.
- Key findings worth the human's eye:
  - `--extend` does not replay the parent run's latency despite comments
    claiming it — filed as proposal P-001; until fixed, latency-pinned runs
    are treated as non-extendable.
  - Invested-capital per market is computed during replay but never stored —
    filed as P-002; capital-aware units may need it (a protocol-side
    workaround exists for no-sell strategies and will be verified).
  - Good news for the strategy: the engine's `ctx.metrics.position` already
    computes exactly our pair quantities (mergeable shares, pair average
    price, merge PnL, imbalance), maker fills cost $0 in fees, and
    settlement automatically values held pairs at $1 — no merge intent
    needed in backtests, exactly as RULES prescribes.
- Wrote `state/PLAN.json`: 10 single-session items — two run-verification
  items (local smoke, fleet round-trip), parity boundary map, capital-aware
  units, two tool-building items, a baseline pair strategy to prove the loop
  end-to-end, evaluator design, the capability-refresh procedure, and the
  final READY review.
- Created the memory system (`memory/INDEX.md` + `capabilities/` seeded with
  evidence-tagged notes, `experiments/`, `process/`) and the `tools/`
  skeleton with naming and conventions.
