# JOURNAL — pair-fable

## 2026-07-30 — Session 8 (baseline-pair-strategy)

- First real strategy of the protocol: `pair-fable-v0`
  (`protocols/pair-fable/strategies/pair.v0.ts`). The simplest honest version
  of the RULES idea — one small resting GTD bid at a time, always on the side
  with fewer shares, gated so the projected fee-inclusive pair cost stays
  ≤ 0.98, $50 capital cap per market, no sells, no cancels, no merges. Its job
  was to prove the whole research loop, and it did: protocol:check → local
  smoke (run 861, PASS) → push → 50-market fleet batch (run 862, 4 machines,
  21.8 s, zero failures) → results/compare tooling → memory. Every step ran
  through the tools built in earlier sessions, no manual glue.
- Behavior verified in the stored rows, not assumed: both sides accumulate,
  imbalance never exceeded one increment (max |up−down| = 10 over all 55
  markets), capital cap binds exactly at $50, split_cost 0 everywhere,
  289 of 291 fleet fills were maker at $0 fees. One instructive nuance:
  1 fill still executed as taker because the book drifted across the 140 ms
  simulated latency — "maker by construction" must always be re-checked in
  the data (`trades_taker`), never trusted from code.
- The baseline is mechanically sound but NOT profitable, as expected:
  EV −2.43/market, profit per $100 invested −8.94 on the 50 oldest
  protocol-floor markets. The loss anatomy is now written down
  (memory/experiments/pair-v0.md): completed pairs earn at most $0.02 each
  while unpaired residue can lose the whole increment, and resting bids fill
  preferentially on the side the market moves against. That asymmetry — not
  the pair gate — is what mission 02 variants must attack; six concrete
  variant ideas are recorded. Experiment ledger opened (E-001).
- Remaining mission-01 items: evaluator-design, capability-refresh-procedure,
  mission-02 review + READY.

## 2026-07-30 — Session 7 (tools-results-and-compare)

- Built the reading half of the research loop. `tools/results.ts` turns any
  run (by id, batch-uid, label, or "last N protocol runs") into the standard
  summary: headline stats from the authoritative 'all' segment, the
  capital-aware units from the evaluator spec, the per-market profit-per-$100
  distribution (median/p10/p90 — the capital-weighted number alone can be
  dominated by big-notional markets), failures, and optional per-market /
  daily-segment breakdowns.
- `tools/compare.ts` compares runs FAIRLY: all deltas are computed only on
  the markets both runs actually replayed (slug intersection), never on raw
  totals across different universes. It auto-detects a latency sweep and
  orders rows by latency (the RULES upward-sweep view), shows the biggest
  per-market movers, and computes daily-pnl correlation between runs — the
  future variant-independence measure.
- All numbers now flow through one shared query module
  (`tools/lib/runQueries.ts`) used by the launcher, smoke gate, results,
  compare, and the ad-hoc SQL tool — no more duplicate SQL to drift apart.
- Verification was strict: results.ts checked line-by-line against direct
  SQL (run 857, exact match incl. hand-computed quantiles); compare.ts
  checked three ways — identical universes (856 vs 857), partial overlap
  cross-checked against a SQL JOIN (854 vs 855: common sums match exactly),
  and a REAL latency sweep 140 vs 600 ms (runs 858/859) which also
  live-verified the launcher's `--sweep-latency` path for the first time.
  fleet.ts queue counts were cross-checked against Bull Board's API — exact
  match. The refactored smoke gate re-verified end-to-end (run 860, PASS).
- Useful calibration number: two identical-config runs differ by ±0.05 pnl
  on 3 markets from latency jitter alone — that is the noise floor to judge
  small comparison deltas against.
- Next: `baseline-pair-strategy` — the first honest pair-fable-v0, proving
  the full loop strategy → smoke → fleet → results → memory.

## 2026-07-30 — Session 6 (tools-launch-and-smoke)

- Five-session self-check first (mission requirement): sessions to date map
  cleanly onto mission goals — capabilities and parity run-verified (runs
  852–856), capital units settled, 7 proposals filed, no drift, no circling.
  4 of 10 plan items done with 15 runtime sessions of headroom; no plan
  correction needed.
- Built `tools/run-backtest.ts`, the canonical launcher. It injects every
  RULES pin automatically, hard-errors on unknown flags (the raw CLI
  silently drops typos — `--lattest` now dies loudly), refuses `--extend`
  (P-001: extensions would silently drop the pinned latency), refuses
  below-floor universes unless `--override-floor`, and pre-checks that HEAD
  is on origin/main before any fleet submission (an unpushed commit would
  hang the batch with no error). `--sweep-latency 140,300,600` launches the
  standard upward latency sweep in one command.
- Solved the "sequential runs print no run id" problem (P-003) at the tool
  layer: every launch gets a generated unique `--batchUid`, and the run is
  recovered deterministically from the DB by that value — verified live
  (run 857), with headline stats and capital-aware units attached to the
  result JSON.
- Built `tools/smoke.ts`, the mandatory pre-fleet gate: protocol:check for
  pair-fable strategies, then a small sequential RULES-pinned run, then a
  strict PASS/FAIL verdict. Verified both directions: probe strategy →
  SMOKE PASS (run 857, 3 markets, 0 failures); nonexistent strategy →
  SMOKE FAIL, exit 1.
- Next: `tools-results-and-compare` (results.ts + compare.ts, extend
  fleet.ts if needed).

## 2026-07-30 — Session 5 (metrics-and-capital-units)

- Settled the big open accounting question with a purpose-built probe
  strategy (`pair-fable-probe-capital-v0` — 6 alternating FOK taker buys on
  both sides plus one crossing GTC, every order stamped with intent meta) run
  on 3 markets with RULES pins: run 856.
- **`cost` IS invested capital** for our no-sell strategies, verified to the
  cent on all 3 markets including the winning side: stored cost equals buy
  notional plus taker fees, and pnl equals mergeable + winning shares minus
  cost, exactly. Settlement never touches the stored basis. "Profit per $100
  invested" is now a plain SQL query — no engine change needed (P-002
  sharpened accordingly, priority lowered).
- Proved the intent_meta channel end-to-end: one market produced 8 fills from
  7 orders (the crossing GTC ate 2 book levels) and stored exactly 7 meta
  entries — dedup by clientOrderId works, order-level analytics survive
  fill chunking. Also caught price improvement in the sim (limit 0.62 filled
  at 0.60): meta records intent, cost records truth — invested must never be
  computed from meta.
- Verified the taker fee curve exactly: 0.07·p·(1−p)·share (0.9408 observed
  on a printed 56-share fill at 0.60).
- Wrote the capital-units half of memory/process/evaluator.md: 6 unit
  formulas over stored columns (with SQL), the scope guard they depend on,
  the binding meta-stamping convention, and the rule that capital levels are
  swept via a mandatory per-market stake-cap param (there is no cash model).
- Next: build the launcher + smoke tools (tools-launch-and-smoke).

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

## 2026-07-30 — session 8 (loop): evaluator designed, verified, and armed

- **The evaluation system is designed and executable.** evaluator.md now
  specifies the full pipeline: smoke → cheap screen (latest 800 markets) →
  full universe + weekly walk-forward → upward latency sweep
  (140/300/600/1000 ms) → out-of-sample-by-design (a variant is judged on
  markets that did not exist when it was designed — a holdout nobody can
  peek at). Plus: capital grid, portfolio independence rule, overfitting
  guards. tools/evaluate.ts computes every stage verdict; verified end-to-end.
- **Measured, not assumed:** noise floor between identical runs is Δev
  0.0008/market (essentially deterministic); variant-independence measure
  verified (two v0 param variants correlate 0.9989 — same bet, correctly
  caught); NEW finding — v0's taker share climbs 1.4%→9.1% as latency grows,
  so "maker-only by construction" must be judged by fill counts, not intent.
- **Engine trap found:** a backtest launched with no --limit silently runs
  only the 1000 OLDEST markets, not the full universe (P-008 filed; our
  launcher now injects an explicit limit — the trap can't bite us again).
  The true universe is 10,747 markets.
- A true full-universe run of pair-fable-v0 (10.7k markets) was in flight at
  session end (~7k done, 0 failures); next session reads it, runs the
  definitive evaluation, and closes the PLAN item.
