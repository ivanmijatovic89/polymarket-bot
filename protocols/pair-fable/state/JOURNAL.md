# JOURNAL — pair-fable

## 2026-07-30 — Session 4 (parity-boundary-map)

- Wrote the live/backtest parity boundary map (memory/capabilities/parity.md)
  by reading both execution adapters, the shared OrderManager/StrategyRunner,
  the user-WS account source, and the Telonex replayer line by line.
- The good news: the core really is shared — MarketEngine, StrategyRunner,
  OrderManager (including the risk walls), Portfolio, and the strategy code
  are literally the same classes in both modes.
- Resolved both open questions from the initial survey, and both turned out
  to be parity traps rather than curiosities:
  - A batch of more than 15 orders backtests perfectly but is rejected
    WHOLESALE live (the cap lives only in LiveExecution) — filed P-005.
  - Cancels work by clientOrderId in backtest but by orderId live; setting
    only one id makes the cancel a silent no-op in the other mode — filed
    P-006. Convention going forward: always set both.
- Nastiest find: live cancelOrder swallows API errors and reports 'canceled'
  regardless, so a failed cancel leaves a resting order the bot believes is
  gone — filed P-007. Matters for a maker strategy that reprices constantly.
- Distilled 8 binding conventions for pair-fable strategies (batch ≤15, both
  cancel ids, no MINED gates, indifference to fill chunking, on-grid prices,
  meta stamping, risk-wall headroom) and an 8-point evidence bar a backtest
  must clear before a variant is trusted live (full universe, upward latency
  sweep, jitter reproducibility, pair-vs-windfall pnl decomposition, monthly
  stability, rubric audit, capital realism, live dry-run gate).
- Housekeeping: session 2's PLAN.json edit had corrupted the file (invalid
  JSON) — repaired and re-validated.
- Next: capital-aware units and the cost==invested verification
  (metrics-and-capital-units).

## 2026-07-30 — Session 3 (fleet-round-trip)

- First fleet submissions of the protocol: two canonical RULES-pinned
  batches — 20 markets (run 854) and 200 markets (run 855), both completed
  with zero failures and zero manual intervention.
- The fleet is fast: 200 markets replayed in 13.8 seconds of processing —
  about 870 markets/minute sustained across 27 worker slots. The full
  protocol universe (~11k markets since 2026-04-02) should replay in
  roughly 13-16 minutes, confirming the RULES planning anchor.
- Watched the commit-SHA self-update mechanism work live: workers sat on an
  older commit, bounced the first jobs, pulled, and every machine was on the
  submitted SHA within ~19 seconds. Lesson recorded: small batches finish
  before slower-updating machines join (run 854 landed on only 2 of 4
  machines).
- Built `tools/fleet.ts` — programmatic queue counts, worker heartbeats, and
  active-batch progress straight from BullMQ/Redis (no dashboard needed).
- Surprise finding for the human: the PRODUCER machine is running 5 backtest
  worker slots (it took 26 of run 855's markets), which contradicts the
  RULES fleet table (22 slots, producer excluded). Filed as P-004 — nothing
  touched, awaiting a ruling.
- Next: the live/backtest parity boundary map (parity.md).

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
