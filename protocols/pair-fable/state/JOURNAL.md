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

## 2026-07-30 — session 10 (loop): evaluator closed on the full universe

- **The full-universe run landed clean**: run 870, all 10,747 protocol-floor
  markets, 0 failures, ~13.4 min of fleet time.
- **The definitive evaluation ran end-to-end** on real data and produced the
  right verdict at every stage: screen ADVANCE for the deeper-gate variant
  direction, full-universe FAIL for v0 defaults (ev −2.24/market), latency
  sweep correctly NA on a negative base (with the taker-drift warning), and
  the out-of-sample stage correctly answers "wait ~5 days — no markets exist
  past the design timestamp yet". PLAN `evaluator-design` is now passed with
  evidence.
- **Most valuable finding**: v0's loss is *stationary* — monthly EV sits in
  a −2.21..−2.26 band across all four months and 0 of 16 weeks are positive.
  The baseline loses by mechanism (unpaired residue), not by market phase.
  That is good news for research: any variant that turns even one week
  positive is a real signal, not regime luck. v0 defaults: time-scoped KILL
  (E-005); the family continues via the recorded variant ideas.
- **Fifth-session self-check** (sessions 6–10 vs mission): no drift — tools,
  baseline strategy, and evaluator all land on mission goals 3/4/5 with
  run-verified evidence; 7 of 9 PLAN items passed. Session 9's contract
  failure (waiting on an in-flight fleet run + missing session-result file)
  is corrected permanently: never end a session waiting on the fleet; always
  write the result file. Remaining: capability-refresh procedure, then the
  Mission-02 review / READY.

## 2026-07-30 — session 11: capability self-upgrade built and drift-tested

- **`tools/refresh-capabilities.ts` built** — the mission's "engine keeps
  evolving" answer. Every capability note now declares which engine paths its
  claims depend on (a new `watches:` header, added to all six notes); the tool
  diffs each note's verified SHA against origin/main over exactly those paths
  and reports CURRENT / STALE (with the changed files) / ERROR. The human
  trigger is one read-only command:
  `npx tsx protocols/pair-fable/tools/refresh-capabilities.ts`.
- **Drift detection verified for real, not assumed**: today's clean state
  reports all 6 notes CURRENT (exit 0). Simulating an older baseline flags
  exactly the right notes — the last src/cli commit stales only
  backtest-cli.md with its 3 changed files; a deeper baseline stales the two
  notes watching src/strategy and fires the "uncovered" sweep on package.json
  (changed in the surveyed area, watched by nobody). Typo'd watch paths and
  missing headers surface as ERROR instead of hiding drift.
- **`memory/process/capability-refresh.md` written**: when to run (human
  announcement, session-start guard before research work, after any rebase
  that pulls in engine commits), the note header contract, and the fold-back
  procedure — re-read changed code, re-verify behavioral claims by running,
  only then bump the note's SHA; engine bugs go to PROPOSALS, never fixed
  in src/. Limitations recorded honestly (path-granular; a brand-new
  subsystem outside the surveyed area stays invisible until the watch list is
  extended — that extension is part of absorbing the first note about it).
- One PLAN item left: `mission-02-review-and-ready`.

## 2026-07-30 — session 12: READY — mission 01 complete, pending review

- **Final audit passed**: every one of the 19 evidence runs (852–870) was
  re-verified in MySQL this session — all completed with the exact market
  counts recorded in PLAN evidence, zero failures, provenance columns set.
  `protocol:check` passes and `refresh-capabilities` reports all six
  capability notes CURRENT against origin/main. One gap surfaced and was
  fixed: the promised team-workflow document did not exist yet.
- **`memory/process/team-workflow.md` written** — how parallel agent loops
  (other models, sibling `protocols/pair-*` workspaces) will cooperate: the
  shared MySQL is the coordination medium (every run is attributable via the
  provenance columns), loops read each other's memory but write only their
  own, verified engine facts are imported by citation instead of re-tested,
  a ledger scan precedes any new variant family so loops complement rather
  than duplicate, and portfolio admission is cross-model via the same
  independence rule. One decision left to the human: confirming
  cross-protocol read access.
- **`state/READY.md` written** — the mission completion report: what was
  delivered (tools, memory, parity map, evaluator, baseline with its
  stationary-loss finding, 8 proposals), 7 honest unknowns/risks (headline:
  the live side is code-verified only — no live process was ever started),
  and seven proposed Mission-02 amendments A1–A7 with reasons (pin the EV
  target's unit/universe/capital level; capital levels as strategy params;
  reference the verified independence definition; codify the fleet-wait
  rule; LIVE-CANDIDATE requires the evidence bar incl. ~4–5 days of
  out-of-sample markets; forbid `--extend`; session-start capability guard).
- **Mission 01 is READY**: all 9 PLAN items passed with run-verified
  evidence. Returning `wait` — the human reviews READY.md and answers via
  the inbox; on "READY accepted" the next session returns `complete`.

## 2026-07-31 — sessions 13–14: READY ACCEPTED — Mission 01 COMPLETE

- **The human accepted READY** after commissioning an independent review
  (24 verifier agents, ~475 tool calls, 115 reproduced checks): verdict
  **APPROVE WITH NOTES** — every load-bearing number reproduced against the
  live database and the code; no Mission 01 conclusion was invalidated.
  Archived at `state/MISSION01-REVIEW.md`.
- **The review's notes become Mission 02's opening gate**: M1–M5 (cross-run
  params+latency identity in evaluate.ts, machine-checkable design-ts for
  param variants, noise-aware champion/dethroning threshold, engine-SHA
  awareness in comparisons and run reuse, incrementSize bound) must be
  implemented and verified before the first champion promotion or
  LIVE-CANDIDATE. Session 13 bound this into `missions/02-research.md`
  (commit 7448316) but died before updating state; session 14 finished the
  bookkeeping.
- **Cross-protocol read ruling recorded as BINDING** in
  `memory/process/team-workflow.md`: pair-* loops may read each other's
  `memory/**` and `state/PROPOSALS.md`; writes stay own-protocol
  (hook-enforced). Rule 4 (run reuse) carries the pending M4 engine-SHA
  amendment for early Mission 02.
- **Mission 01 closes**: 9/9 PLAN items passed with run-verified evidence,
  19 fleet runs (852–870), 6 capability notes, 9 tools, the evaluator
  pipeline, the v0 baseline (an honest stationary-loss KILL), and 8 engine
  proposals — two of which (P-001, P-008) the human already fixed upstream.
  Returning `complete`. On to research.

## 2026-07-31 — Mission 02, session 1

- Implemented and verified the full MISSION01-REVIEW gate M1–M5 (commit
  4809a8e): evaluate.ts now machine-enforces cross-run params/latency
  identity, engine-SHA consistency, a design-ts sanity check, and an
  SE-scaled (noise-aware) champion bar; folded minors m6/m8/m9/m10/m11.
  The Mission-01 exemplar that mixed configs now correctly FAILS MECHANICAL.
  The champion-promotion blocker is cleared.
- First research increment: pair-v1 (join-only starts, aggressive maker
  repair, 3-min end-of-window cutoff) — frozen at 6a1ecde, smoked (run 871),
  screened on an identical 800-market universe vs a fresh v0 baseline
  (runs 872/873 vs 874). Structural fixes recover +0.61 ev/market with
  per-dollar improving too (win rate 21%→52%); best config ev −1.07 — still
  negative, ITERATE. New lead: repair legs cross the spread (taker share
  13–16%) — v2 will fix repair pricing.

## 2026-07-31 — session 2 (mission 02)

- Built `tools/anatomy.ts`: exact per-market pnl decomposition (paired vs
  residue; recon err ≤0.01, 0 bad rows), S/R fill-mode stats, taker
  attribution bounds, doom-hazard-by-minute. Findings on 872/873/874 in
  pair-v1.md §Anatomy.
- Headline finding: v1's loss is ENTIRELY unpaired residue — 344/345
  residue markets lose (~$4.4 each, held to ~0); pairs earn +$0.54/market
  vs doom −$2.15. Repair rate 80% vs ~94% break-even. Doom hazard is flat
  across start minutes ⇒ start-delay variant killed before launch. Taker
  fees are minor in pnl ($68 of −$1202) — a parity/S3 concern only.
- Key code insight: v1's repair leg stops chasing at the START gate though
  completion is profitable to pair cost <1.00. → pair-v2 family ("repair
  persistence"): chase-to-breakeven (0.995 const), no repair cooldown,
  repair quotes ≤ ask−2 ticks. Same 6 params, no new tunables.
- Pre-registered (freeze commit 0f0f423 = design-ts 2026-07-31T00:06:47Z):
  v2-a (defaults), v2-b (0.95), plus v1 gate-curve points v1-c (0.96) /
  v1-d (0.93). Smoke: run 875 PASS (v2 converts 1 of v1's 3 smoke dooms).
- Launched 4 screens (latest-800 @ 140/20) vs baseline 874; evaluating
  when they land.
- Screens landed (876 v2-a, 877 v2-b, 878 v1-c 0.96, 879 v1-d 0.93; one
  relaunch round — the engine's dirty-tree guard refused queue submissions
  after mid-session state edits; guard added to STATUS).
- **pair-v2 KILLED (twice-replicated)**: repair persistence is EV-neutral —
  doom savings repaid exactly in pair margin (efficient pricing). Taker
  guard ineffective. E-008/E-009.
- **Gate curve REFUTED as a profit path**: ev monotone (−1.50 → −0.55 at
  0.93) but p/100 flat ~−8/100 everywhere — pure volume shrink; doom rate
  gate-invariant ~50%. E-010/E-011.
- Axis switch recorded: completion mechanics exhausted; next is START
  SELECTION (contested vs decided windows via spot/priceToBeat feeds).
  Session 3 first validates the hypothesis from data (dooms vs early-window
  spot–priceToBeat distance) before any v3 code.

## 2026-07-31 — mission 02, session 3 (part 1: contested axis killed, cadence model found)

- Built `tools/contested.ts`: joins every start fill to Binance aggTrades
  spot + priceToBeat, per-start doom analysis with pre-registered verdicts
  (pair-v3.md written BEFORE running).
- **pair-v3 (contested-start gate) KILLED at Phase 0**: doom rate is flat
  (~17–35%) across the entire |spot−ptb| and drift range on runs 872 AND
  873, including the last-start-only view; market-level correlation is
  INVERTED (contested quartile dooms 61% vs 38% for decided). Doom is
  unpredictable from start-time market state. No strategy code was written
  (guard 2 upheld). LEDGER E-012.
- **Cadence model**: derived the family's exact P&L algebra
  (pnl/played = inc·[g_sh(S−q) − avgE·q]). incrementSize provably cancels
  (residue-quantum idea killed without runs). Break-even start rate S* =
  q(1+avgE/g_sh): 8.2 @ gate 0.98 but only 2.88 @ 0.93 vs actual 1.64 —
  the cadence gap at tight gates is only ~1.8×. Gate×cadence is the one
  untested combination; pre-registered v1-e/f/g (ttl 61, cooldown 5 at
  gates 0.98/0.95/0.93) with a decisive q-terminal vs per-start-hazard
  discrimination — the latter would kill the whole one-order pair
  mechanism at any tuning.
- Next: commit (design-ts), smoke, launch the three screens.

## 2026-07-31 — mission 02, session 3 (part 2: three kills and a law)

- Cadence probe (runs 881/882/883, ttl 61 / cooldown 5 at gates
  0.98/0.95/0.93): start rate moved <1% at every gate — S is FILL-LIMITED
  (crossings are market-given, requoting faster captures nothing).
  Cadence-param axis killed per pre-registered rule (E-013).
- Built pair-v4 (both-sides start quoting — the one structural way to
  capture more crossings at top-of-book). Pre-registered the honest
  opposing force: every runaway now catches a resting start. Smoke 884
  PASS, freeze 28f1f8b, screens 885/886/887: the opposing force won — q
  co-inflated with S (×1.50 vs ×1.41 at gate 0.98), ev worse at every
  gate despite pair margin g_sh rising ~50% from double-fill races.
  Family killed (E-014).
- **The law that fell out of the six-run cross-section: per-start EV ≈
  −0.06/share, invariant to gate, cadence, sides, repair policy, entry
  discipline, and start-state selection.** Under worst-queue every maker
  fill is a trade-through — pure adverse selection — and no knob in the
  maker-accumulation class touches its price. Class KILLED (time-scoped
  2026-07). This closes v0→v4 with a mechanism-level explanation for
  every prior kill.
- Filed P-009: only a live benign-fill-share measurement can tell whether
  −0.06/share is a sim floor or a market fact (needs human, real orders).
- Session 4 axes (Phase-0 data scans BEFORE code, inside buy-only RULES):
  taker pair-arb moment frequency; maker-leg + immediate-taker-completion
  economics from recorded books.
- 8 runs this session (880–887: 2 smokes, 6 screens), 3 experiments, 3
  pre-registered kills, 0 unverified claims.

## 2026-07-31 — mission 02, session 4 (mid-session)

- Last session closed the book on the whole "rest orders and accumulate
  pairs" approach, so today we measure two fresh ideas against raw market
  data before writing any strategy code: (1) do moments ever exist where
  you can just buy both sides instantly for under $1 all-in, and (2) when
  our resting order gets hit, can we still buy the other side fast enough
  to lock a cheap pair?
- Wrote the measurement rules and pass/fail bars down first (committed
  2e9bfef), then built the scanner (4c77666). A quick 10-market test
  suggests idea 1's moments vanish within a millisecond, and idea 2's
  completion usually costs MORE than $1 — but the same test hints that
  simply holding what we bought at the dip may pay. Full 800-market scan
  is running now; verdicts when it lands.

## 2026-07-31 — mission 02, session 4 (results)

- Both fresh ideas died cleanly against the full 800-market data, before
  any strategy code was written.
- Idea 1 (buy both sides instantly when the pair costs under $1): those
  moments are real — worth about $1.90 per market to someone with zero
  latency — but they vanish within a millisecond. At our speed exactly 1
  of 1,943 chances was reachable. The money exists; it belongs to
  colocated speed traders. Killed (evidence: pair-v5.md).
- Idea 2 (when our resting order gets hit, immediately buy the other
  side): by the time our order is filled, the other side has already
  repriced — completing the pair costs MORE than $1 in 97.6% of cases,
  even before our 140ms delay is counted. Killed (pair-v6.md).
- The morning's tease that "just holding the dip-bought side" might pay
  was small-sample noise: on the full data it loses about 3 cents per
  share. Useful anyway — we now know WHY every variant so far loses ~6
  cents per entry, broken into its parts.
- Not out of ideas: two untested in-rules approaches remain — paying the
  taker fee on the FIRST leg (then resting the cheap second leg), and
  resting orders deeper in the book. Next session measures both the same
  way (data first, code only if the data says yes), plus the scheduled
  every-fifth-session self-audit.

## 2026-07-31 — mission 02, session 5 (self-audit + pre-registration)

- Scheduled every-fifth-session audit. Verdict: the loop is healthy but the
  idea space is narrowing. Five sessions produced 16 experiments, every
  claim reproduced, and each kill now costs less than the last (yesterday's
  two needed zero fleet time). Not drifting into trivia — but only two
  untested in-rules ideas remain, so the honest risk is running out of
  road, not wasting time on it.
- The review gate (M1–M5 hardening) stays correctly parked: it binds before
  the first promotion, and nothing is close to promotable yet. If either
  of today's ideas survives its data scan, that hardening happens BEFORE
  the family can be promoted.
- Today's plan, same data-first discipline: wrote pass/fail bars for both
  remaining ideas and committed them before the scanner code. Idea 1
  (pair-v7): pay the taker fee on the first leg, rest the cheap second
  leg. Idea 2 (pair-v8): rest orders deeper below the best bid — better
  prices in crashes, but worse company.
- If BOTH die on the data, the conclusion is that buy-only pair mechanics
  on BTC-15m are exhausted under our simulator's pessimistic fill model,
  and the next move is a proposal to the human: measure real fill quality
  live (P-009) and/or widen the allowed strategy space.

## 2026-07-31 — mission 02, session 6 (both remaining ideas killed on the data)

- Re-ran the big data scan that died with session 5. First rebuilt the
  scanner so it saves progress to disk as it goes — a killed session now
  loses minutes, not the whole scan. The rebuilt scan reproduced every
  session-4 number exactly before I trusted the new parts.
- Idea 1 (pay the taker fee up front, rest the cheap second leg): the
  entry moments are rare, and when the second leg never fills we are
  stuck holding a side that wins only 2% of the time — the cheap price
  was cheap for a reason. Loses money even with zero delay. Killed
  (pair-v7.md).
- Idea 2 (rest orders deeper below the best bid): better prices in bigger
  crashes, but those crashes are informed — the held positions lose at
  every depth tried. Striking detail: a zero-delay trader COULD complete
  these pairs profitably; our 140ms eats exactly the cushion. Killed
  (pair-v8.md).
- That empties the in-rules idea list: every way of buying both sides of
  BTC-15m markets now has reproduced evidence of losing at our speed.
  Wrote the escalation asking the human to pick where we search next —
  live fill-quality measurement, wider strategy space, other
  timeframes/coins, or faster infrastructure (P-010).
- Next: the promotion-machinery hardening the independent reviewer
  required (M1–M5), and reading the sibling labs' notes for angles we
  have not tried.

## 2026-07-31 — mission 02, session 7 (housekeeping done — waiting on your ruling)

- Good news first: the promotion-machinery hardening the reviewer demanded
  (M1–M5) turned out to be already done — session 1 built it and session 6's
  status note had simply forgotten. I re-ran the checks today to be sure:
  the evaluator now really does reject mixed-config comparisons and demands
  a noise-beating out-of-sample edge before anything can be called champion
  (verified via commit 4809a8e).
- Read the sibling labs' notes for ideas we haven't tried: there aren't
  any yet. The other pair workspaces are your design template and a Codex
  loop that hasn't started — no research memory exists outside ours.
- Added the data facts to the "where next" question (P-010): only BTC-15m
  is backtestable today; ETH/SOL/XRP and 5-minute markets are cataloged but
  not converted, and hourly+ markets aren't cataloged at all — so widening
  the universe starts with a data-pipeline run on your side.
- That empties the to-do list honestly: every in-rules idea is killed with
  reproduced evidence, the hardening gate is satisfied, and the siblings
  have nothing to borrow. Pausing for your P-010 decision — any of its four
  options restarts research immediately.

## 2026-07-31 — session 8 (mission 02)

Your ruling landed: the "whole approach is dead" conclusion is withdrawn,
and you pointed at the term we never attacked — how much a stranded share
is allowed to lose. That number was our own choice all along (~$0.44).
Recorded the correction and the new rule: killing a whole class of ideas
now needs a mathematical argument, not a pile of failed variants.
First new idea is in the oven: never pay more than a hard ceiling (15–45
cents) for ANY share, so a stranded share can only lose the ceiling, and
every completed pair earns at least 1 − 2×ceiling. Seven ceiling levels
submitted to the fleet on the standard 800-market test window.
Results land this session or the next one picks them up.

## 2026-07-31 — session 9 (mission 02)

The hard-ceiling idea failed at every level, but it failed in a very
informative way: the cheaper we bought, the CLOSER we got to break-even,
and at the 15-cent ceiling we were only ~3 cents per market short —
within measurement noise (details: pair-v9.md §Result). Two doors are
open at that edge: ceilings below 15 cents, and keeping our completion
bid alive ~100% of the time instead of ~90% (a settings change, no new
code). Both are now running on the fleet.
Also built the ruling's next idea: when we're stuck holding one side, a
new module buys the other side instantly the moment that either locks in
a guaranteed profit, or cuts a doomed position's loss. Seven versions of
that are running too. Next session reads all twelve results.

## 2026-07-31 — session 10 (mission 02)

Caught our own bug before it could mislead us: the new "complete the pair
instantly" module could fire the same buy several times before the first
one finished, so it sometimes spent triple the per-market budget. The
affected results were discarded, the fix is in, and the results reader
now raises an automatic alarm whenever any run overspends its cap. The
four affected tests were resent to the fleet (run ids in STATUS).
One finding survived the bug: the module's "lock in a profit early"
trigger almost never fires at profitable prices — our existing repair
order already captures those moments first.
The cheap-ceiling idea is now fully closed: ceilings below 15 cents just
trade less and still lose slightly, and keeping the completion bid alive
100% of the time (instead of ~90%) changed nothing at all (pair-v9.md).
You told us a profitable bot does ~700 trades per window versus our ~4 —
recorded in memory/market-context.md; that whole regime is unexplored.
Next: read the resent module tests, then two fresh fronts — choosing
markets by order-book character, and varying order size with price.
Late-session update: the fleet was fast enough to answer everything
today. The resent module tests came back clean and the verdict is in:
cutting a doomed position's loss WORKS mechanically (stranded losses
nearly vanish) but the money just moves — by the time a side is
provably doomed, completing the pair costs almost exactly what the doom
would have lost (details: pair-v10.md). Both of the ruling's completion
ideas are now answered on this strategy family. The lesson we take
forward: the fixable waste is not in how we exit a bad position, it is
in which markets we enter at all — that test (judging markets by their
order-book character in the first 3 minutes) is designed, frozen, and
ready to run next session.

## 2026-07-31 — session 11 (mission 02)

Tested the "pick better markets" idea: we measured five order-book
characteristics (spread, depth, activity, choppiness, price richness) in
each market's first 3 minutes and asked whether any of them predicts
which markets our strategy wins in. Answer: no — none of the patterns
held up on the held-out half of the data, and no market subset was even
break-even (details: pair-v11.md). Interesting side-fact: the book looks
almost identical at the start of every market, so "spread" carries no
information here at all.
We also ran our best variant over the full four months of history as a
permanent baseline: it loses $1.07 per market with remarkable
consistency — every month, every week (run 914). Whatever fixes this, it
won't be a lucky time window.
Next: you told us a profitable bot does ~700 trades per window; before
chasing that, we designed a measurement (frozen today) of how much maker
volume our simulator's pessimistic fill rule may be hiding — that
decides whether "the market gives us so few fills" is real or an
artifact of our model.

## Session 12 — 2026-07-31

Ran the measurement we froze last session: how many fills would a bot
that always keeps a bid at the top of the book actually get — under our
simulator's pessimistic rule vs. an optimistic upper bound. The gap is
enormous: about 29× at realistic latency (and the optimistic bound
counts cancellations as trades, so truth is somewhere in between). So
"the market gives us very few fills" is a fact about our fill model,
not necessarily about the market — the 700-trades bot you mentioned is
plausible within the raw book activity we see (hf-fill-probe.md).
Practical rule adopted: no high-frequency strategy code until the fill
model is calibrated — we filed a proposal (P-011) and froze the next
measurement: our 36 live-recorded markets contain actual trade prints,
which tell us how much of the optimistic bound is real trading.
Next: run that trade-print calibration, then design the position-sizing
experiment (the last untested lever from your ruling).

## Session 13 — 2026-07-31

Ran the trade-print calibration and the fill-model question is settled,
in the opposite direction from what session 12's gap suggested: 99% of
the "activity" the optimistic bound counted was cancellations, not
trades. Actual trading confirms our simulator's pessimistic rule is a
fair bound — and the 700-trades bot you mentioned almost certainly
counts order placements, because 700 is roughly ALL the trades that
happen in a whole window (hf-fill-probe.md §E-025). High-frequency
quoting is now a dead end on economics: the whole top-of-book pie is
worth about $8.5 per market before costs. The proposal for engine work
(P-011) is withdrawn — nothing to fix.
Also closed half of the sizing axis by argument: buying more when cheap
just reweights price bands we already measured as losing everywhere.
The other half is genuinely new — averaging down on a stranded side to
make its completion cheaper — so we wrote that strategy (pair-v12),
smoke-tested it, and put a 5-run sweep on the fleet (pair-v12.md).
Next: read the sweep — first the sanity config that must reproduce v1
exactly, then whether averaging down helps or just doubles the losses.

## Session 14 — 2026-07-31

Read the averaging-down sweep. The sanity config reproduced v1 to a
fifth of a cent, so the code is trusted — and the answer is a clean no.
Averaging down does what it promised: it completes more pairs and even
rescues some stranded sides (52 saves vs 1 in the parent). But the
trigger only fires after the held side has fallen, which is exactly the
markets already dying — so every dollar it commits loses about 20 cents,
across every setting we tried (pair-v12.md §Result E-026). Buying the
dip on a doomed side is just a bigger doomed position. Killed the
module; that closes the sizing axis on this strategy family.
Next: the last unexplored axis from your ruling — letting the policy
change with the clock (different rules early vs late in the 15-minute
window). Designing that scan now, from data we already have.
Also finished the clock-based scan the same day: profitability by
start-minute is negative in every minute of the window, at both gate
settings, so "different rules early vs late" has nothing to grab onto
(pair-v13.md §Result E-027). That was the last of the six directions
from your ruling — all six are now measured dead on this strategy
family. Next session is the scheduled self-check: step back and decide
where the search goes now. One input for that decision needs you: only
BTC-15m data is converted for backtesting — converting ETH/SOL/XRP
would open cross-symbol replication (proposal P-012).

## Session 15 — 2026-07-31

Scheduled self-check session. Verdict: we're not wasting time, but the
old strategy family truly has nothing left — so we asked the one
question about this market we had never asked directly: when the order
book quotes a price, is that price actually fair?
Answer, from 800 markets: no. Cheap sides ("longshots") are overpriced
by 3–4 cents a share — which finally explains WHY every variant we
killed lost money: they all bought cheap sides by design (pair-v14.md).
The mirror of that looked like our first real edge: heavy favorites
early in the window seemed underpriced by ~2 cents. But a careful
re-measure — buying once per market like a real bot would, instead of
averaging over time — shrinks it to ~1 cent, within noise at this
sample size. Not dead, not proven: we need ~13× more markets to decide.
Next: rerun the same frozen measurement on the full 10,700-market
history (data already on disk, costs nothing but local compute). If the
favorite edge is real, we'll bring you a scope question — exploiting it
means buying one side and holding, not pairing.

## Session 16 — 2026-07-31

You redirected us: pause the favorite-edge follow-up, and instead design
a controller that buys BOTH sides all through the window, building a big
matched stack of UP+DOWN below $0.98 combined, with the imbalance kept
small at every moment. This session is the design, on paper only, as
ordered — no code, no experiments.
The design is written (pair-v15.md): why none of our fifteen dead
variants actually was this controller (they all held ~10 shares at a
time; this holds hundreds and lets early cheap buys pay for later
completions), the exact buying/price/imbalance/capital rules, what
"success" will be measured as, and the worst-case loss in a market that
trends and never comes back.
One hard fact to keep in view: our fill measurements say ~610 shares per
market is what top-of-book patience realistically captures (hf-fill-probe.md),
so the 500–1,000 matched aspiration needs bigger orders and some paying
of the spread — the design says how, and the first experiment measures
whether the market's back-and-forth actually supplies enough cheap
two-sided flow.
Waiting on your review — five specific questions are at the end of the
design file.

## Session 17 — 2026-07-31

Built and tested the big two-sided accumulation controller you approved.
It does what the design promised mechanically: it keeps buying both sides
all window and ends with 5–10× more matched inventory than any earlier
version, at pair prices comfortably below $0.98. But it loses money the
same way the family always has: the markets that trend one way leave a
stranded side, and those strands eat more than the pairs earn (all 10
test configurations negative; details in pair-v15.md §9).
One genuinely new result: letting the controller finish a doomed pair
even above $1 cut the stranded losses roughly in half per market — the
first knob that ever improved the per-dollar economics beyond noise
(run 929). The fix it points to: complete stranded sides earlier and
cheaper, on a sliding price limit that loosens as time runs out.
Next session designs and tests exactly that.

## Session 18 — 2026-07-31

Tested the sliding completion price limit designed last session, then a
version that combines it with the above-$1 doomed-market backstop. The
sliding limit does fire earlier and cheaper exactly as intended, but
three very different completion policies all end up losing the same
amount — completing stranded sides differently just moves the same
dollars around, so that knob is now exhausted (pair-v15.md §10.5).
Two lasting gains: we finally measured this family's run-to-run noise —
three times larger than we had assumed, so future "improvements" must
clear a higher bar — and the small-band configuration with the backstop
is the family's cheapest loss per dollar yet (run 943), continuing a
real, steady per-dollar improvement across the whole program.
Next: stop paying market-taker prices to fix imbalance at all — make
the lagging side's resting bid more aggressive inside the tolerance
band, so pairs complete at maker prices before they ever strand.

## Session 19 — 2026-07-31

Tested the idea from last session: make the lagging side's resting bid
more aggressive so imbalance gets fixed at cheap maker prices instead
of expensive taker prices. It works exactly as designed but almost
never gets the chance — the price grid only allows a one-cent
improvement, and our own taker completion usually wins the race to the
same dip. Killed at the measured bar (pair-v15.md §11.5).
Then tested whether simply trading BIGGER helps — 2× and 4× larger
orders, up to $1,000 per market. Inventory scales beautifully (we hit
the originally-imagined ~200 matched shares per market) but the loss
per dollar stays exactly the same: size is a volume knob, not an edge
(§12.2).
That closes every "HOW to accumulate" knob this family has: completion
policy, quote aggression, and size all converged on the same ~$5–6
lost per $100, all of it paid completing one-way markets.
Next: stop asking HOW and start asking WHICH — measure whether
observable market features (spread, depth, early movement) predict the
losing markets, and firm up the one price region that ever measured
positive, before writing any new strategy code.

## Session 20 — 2026-07-31

Asked whether the first three minutes of a market's order book can
predict which markets will hurt us — including two new "early movement"
measures. Answer: no; nothing survives validation (pair-v15.md §13.2).
Then took the one price region that had ever measured positive — buying
near-certain favorites early — and re-tested it on 9,947 older markets
it had never seen, twelve times the data. The edge vanished: it was an
accident of the small sample. And the bigger picture is now sharp:
every price band below 80 cents is overpriced by 1.5–3 cents a share,
favorites are priced exactly fair — buying this market at the asking
price pays a measured toll everywhere, which explains in one stroke why
every buying variant loses (pair-v14.md E-035).
The flip side: whoever is SELLING at those prices collects that toll.
That mirror idea — sell both sides instead of buying them — is a scope
question for you, written up as P-013.
Next: your P-013 call, and designing a probe of the very-high-activity
regime you flagged.
Late addition: your mid-session mission amendments arrived while the
scans ran. Understood and adopted: the "bigger size doesn't help"
conclusion is officially reopened until we test $2,000 per market and
genuinely chase the 500–1,000 matched-share range — that test (E-036)
is queued as the next session's first action, and each session now
closes with the required alignment gate (this one: YELLOW —
diagnostics, both informing the controller).

## Session 21 — 2026-07-31

Ran the scale test you made binding: pushed the controller to $2,000
per market and order sizes up to 300 shares, five 800-market runs on
the fleet, all landed within the session (pair-v15.md §14.2).
The inventory goal is reachable: at the biggest size the controller
matches 600–700 share pairs per market — inside your 500–1,000 range.
But the economics do not improve with scale — they slip: the loss per
$100 invested stays around −5 to −6 everywhere, and the step from
100- to 200-share orders makes it measurably worse, not better.
One caveat we attached in advance: at these sizes the simulator's
fill assumptions are generous, so reality would be worse, not better.
The scale question is now closed both ways you asked for — the range
is reached, and the reason it doesn't pay is on record.
Next: probing the very-high-activity regime you flagged (many small
orders per window), the last untested controller axis; your P-013
sell-side call still pending.

## Session 22 — 2026-07-31

Started the high-activity probe you flagged: does the controller miss
fills because it quotes too slowly? Promoted the two hard-coded pacing
knobs (requote cooldown, order lifetime) into tunable parameters and
pre-registered a 6-run grid (pair-v15.md §15).
One real bug found on the way: order lifetimes under 60 seconds are
silently rejected by the engine's order manager, so the "very fast"
corner of the grid was impossible — floor raised to 61s and the grid
amended before submission (runs 965–967 caught it).
All 6 runs submitted to the fleet together; results below when read.
Also noted: your streamlined Mission 02 draft arrived — it is marked
INACTIVE, so I continue under the current mission text.
Result: speed is not the problem. Letting the controller requote with
zero delay, or refresh orders faster, changes its fill count by under
one percent; even the widest change moved economics not at all
(pair-v15.md §15.4). The controller misses fills because its own
price-safety ceiling refuses to bid when the pair is expensive —
which is deliberate — not because it is slow. That answers your
high-activity question for this design: more speed buys nothing.
With that, every knob of the neutral controller has now been measured:
the −5 to −6 per $100 loss is the price of completing the losing side
in one-way markets, and nothing in HOW we buy moves it.
Next: the directional version you asked for as step two — same
controller, but allowed a bounded lean toward the side that is
winning, so it stops paying to complete the loser in trends.

## Session 23 — 2026-07-31 — E-038: the directional controller (in flight)

Started step two of your priority order: the same controller, now
allowed a bounded lean. When one side's price clearly leads, the
controller may hold up to a chosen number of extra shares on that
side instead of paying to complete the loser (commit ceae123).
A lean of zero reproduces the neutral controller exactly — that is
the built-in honesty check against the last neutral run.
Six configurations submitted together: no lean, three lean sizes
toward the winner, one lean toward the loser (to settle the sign
question), and one requiring a stronger leader before leaning.
Results below when the fleet finishes.
Session closing while the fleet works (the six runs need ~25 more
minutes; the rule is to never sit waiting). Next session reads the
results and gives the verdict on whether leaning toward the winner
finally dents the one-way-market loss.

## Session 24 — 2026-07-31 — Leaning toward the winner works, but we pay full price for it

Read the six directional runs. Leaning toward the leading side is
clearly better than not leaning, and leaning toward the LOSING side
is much worse — so the "who is winning" signal in the order book is
real (run 981 vs 982). The catch: the extra shares we lean with are
bought late, at expensive prices that already reflect how likely the
leader is to win — so the total loss barely moves; only the
per-dollar numbers improve. The typical market is now slightly
profitable; the remaining damage comes from markets where the
leader flips and the controller chases both sides at high prices.
Next (already submitted, six new runs): only allow the lean when the
price is still cheap, and only lean after the leader has held its
lead for a while — attacking the expensive-purchase and flip-chasing
problems directly.

## Session 25 — 2026-07-31 — The 90-cent ceiling is the best single change so far

First ran the required five-session audit (sessions 20–24): four
GREEN, one YELLOW, all gates present, one 11-minute time-to-evidence
(the day new strategy code had to be written first). The scale
question was closed properly; the plan stays on the directional
controller.
Then read the six ceiling runs. Refusing to buy the leading side
above 90 cents is the biggest single improvement on record: about
$1.90 less loss per market, and the typical market is now its most
profitable ever (run 986). Tightening the ceiling further to 80 or
70 cents buys nothing — those mid-priced purchases were fairly
priced; only the above-90-cent chasing was poison.
A separate patience filter (ignore split-second leader flickers)
also helps on its own, but combining it with a tight ceiling
backfires — with the expensive chases already blocked, patience only
delays the good cheap purchases.
Next (already running on the fleet): a finer ceiling scan around 90
cents, plus a real patience test — requiring ten seconds of
sustained leadership, which the old parameter limit never allowed.
Late addition, important: a run repeated with zero changes swung by
about $1.40 per market — our yardstick was too coarse, and today's
"best change ever" is only suggestive until re-measured. Two extra
identical runs are already queued to size the measurement error
properly; the structural findings (what the controller buys and
where) are unaffected. Honest bookkeeping beats a good headline.

## Session 26 — 2026-07-31

The noise check we set up last session came back, and it changes how
we read results at this capital level. We re-ran the exact same
configuration three times and got nearly identical numbers — but
yesterday's "winner", also the exact same configuration, sits far
outside that cluster. Digging into individual markets shows why: at
$500 per market, a single market's outcome can flip by ±$200 on
order-timing luck alone, so an 800-market average wobbles by more
than the effects we have been chasing.
So yesterday's headline — that capping the price we pay for the
tilted side earns about +$1.9 per market — is withdrawn: it was most
likely luck. Today's finer price-cap grid is unreadable for the same
reason. What the cap mechanically does to fills and spending is
still true; whether it makes money is simply not answerable on 800
markets.
The fix: judge money questions on the full ~11,000-market history,
where this noise shrinks about fourfold. A four-run full-history
batch re-asking the price-cap question properly is now on the fleet;
next session reads it.
One bookkeeping correction: the review-gate fixes the last audit
listed as outstanding were in fact implemented and verified days ago.

## Session 27 — 2026-07-31

While the full-history price-cap batch from last session works
through the fleet, we built the next planned idea: a version of the
controller that decides which side to lean toward by looking at the
actual Bitcoin price versus the market's strike price, instead of at
the betting odds. The odds are the crowd's opinion; the spot price
is the physical thing the market settles on, and we can see it a
beat before the crowd finishes repricing. If that beat is real, the
same tilted purchases should happen at better prices.
The new strategy runs cleanly end to end, and switching the lean on
and off visibly changes its behavior on identical test markets — so
the price signal is genuinely reaching the decisions. The experiment
to judge it (three signal strengths plus a no-lean reference, all on
the full history) is written down and locked; it launches as soon as
the current batch finishes, since one of its settings depends on
that batch's answer.
The first quarter of the running batch also landed: on the full four
months, the current tilted controller loses about $15 per market —
worse than the recent-weeks screens suggested, and steady across
every month. The recent window was a slightly friendly slice, not a
trend change. This is exactly why money verdicts now happen on full
history.
Late in the session the full-history batch finished and gave a clean
answer: capping the price we pay when chasing the leading side makes
no difference to profit — none at all at the resolution the full
history provides. Last session's suspicion is now confirmed twice
over: the "+$1.9 per market" cap benefit we briefly believed was
order-timing luck on a small sample. The cap is removed. The good
news is methodological: two identical full-history runs landed
within $0.21 per market of each other, so this instrument can now
tell a real $0.75 effect from luck — the 800-market screens never
could.
With that settled, the new spot-price-versus-strike controller went
straight to the fleet: four full-history runs — no lean at all, and
three lean-trigger strengths. A small pilot batch on the fleet also
uncovered that about 1% of markets are missing their strike price on
Polymarket's side (an outage in their records, not ours); those
markets are excluded and bookkept. Next session reads the four runs.
They answer two questions at once: is the physical price signal
better than the crowd's odds, and — for the first time decisively —
does leaning toward a winner add any money at all versus staying
neutral.

## Session 28 — 2026-08-01

The four full-history runs came back and answered both questions.
First: yes, the physical signal (Bitcoin's live price versus the
strike) is better than the crowd's odds at picking which side to lean
toward — but mostly because the crowd-based lean was actively losing
money, about $1.30 per market, which the new signal avoids by leaning
less often and less wrongly. Second: leaning still does not add
confirmed profit over staying neutral.

The autopsy found something more interesting than either headline:
when the new signal does lean, the leaned side goes on to WIN in
88–90% of markets. The signal genuinely sees the future a little. We
lose anyway because of HOW we buy the lean — the controller chases
the winning side with aggressive market orders at rising prices, and
that chasing costs slightly more than the winnings. Good eyes,
expensive hands.

So this session built a variant with patient hands: it only acquires
the lean through resting quotes, never by chasing. The known risk —
registered in advance as the kill condition — is that patient orders
on a winning side mostly get filled when the price briefly turns
against it, which could poison the 88% hit rate. Seven full-history
runs are now on the fleet: two testing the patient-hands variant, two
probing how rare a decisive price move should be before we lean, and
three sweeping the core price-discipline knob of the neutral
controller, which had never been tested at the decisive instrument.

Also of note: a second, independent lab ("pair-opus") was started by
the human on the same problem with a clean slate. We can read each
other's notes; it will be interesting to see where they diverge from
us. Next session reads the seven runs.

## Session 29 — 2026-07-31

The seven big overnight tests from last session are still grinding
through the fleet (about ninety minutes to go at close), so instead of
idling I dissected where the current neutral strategy actually loses
its money, using yesterday's full-history baseline run. Three findings,
all on file. First, our completions are priced fairly by the market:
paying up to finish a doomed pair costs the same, in expectation, as
holding the stranded side to the end — which finally explains why the
earlier price-ceiling experiment changed nothing; there was never an
edge to find in HOW we finish pairs. Second, the entire loss traces to
one flow: our passive buy orders get picked off. Fifty-eight percent
of the shares the market gives us end up on the side that loses, about
three cents lost per share — and that is precisely the term the
in-flight tilt experiments are trying to fix, so we now know exactly
which number to watch when they land. Third, the later in the
15-minute window a passive fill happens, the more toxic it is — two to
three times worse in the closing minutes — which prices a "quote
tighter as the clock runs down" idea for the neutral track. Next
session: read the seven test results against their pre-registered
bars, plus the scheduled five-session review.

## Session 30 — 2026-07-31

The seven big tests are still working through the fleet (they finish
overnight), so this session did the scheduled five-session review and
one more piece of homework on the wait. The review passed cleanly:
every one of the last five sessions worked directly on the
controller, every claim traced to a run, and the one rosy number that
appeared in that stretch was withdrawn on noise grounds before it
could mislead us.
The homework: we asked whether our passive buys are more toxic at
some price levels than others — maybe quoting only cheap sides, or
only expensive sides, would dodge the losses. Answer: no. The market
picks us off at about the same three cents per share whether we bid
at 25 cents or 75 cents. There is no free fix in where we price; any
cure has to come from an outside signal saying which side to lean —
which is precisely what the patient-hands variant now on the fleet
uses. Next session reads all seven results against their
pre-registered bars.

## Session 31 — 2026-07-31 (late)

The seven big overnight runs were still grinding through the fleet when
this session started, so their verdicts wait one more session — the last
of them should finish within the hour. Instead of idling, I built the
next idea for the neutral strategy: our resting quotes should demand a
bigger discount as the 15-minute window ages, because we measured last
session that fills late in the window are two-to-three times more likely
to be on the losing side. Implemented it, and the small-sample check did
its job: the first version's discount was accidentally multiplied by how
much inventory we already held, choking off buying almost from the start.
Fixed it so the discount is a clean per-share concession that ramps with
age; verified early behavior stays identical and only late buying gets
choosier. Next session: read the seven verdicts first, then send this
new variant to the fleet.

## Session 32 — 2026-08-01 (just after midnight)

The loop restarted only two minutes after the last session closed, so
the seven overnight runs were of course still going — nothing to read
yet. Two useful things came out of the short window anyway. First, I
worked out when results actually appear: not one by one as each run
finishes, but all at once shortly after the whole fleet queue empties,
because a handful of known-bad markets keep retrying at the back of the
queue and every run's summary waits for them. That means all seven
verdicts arrive together, a bit over an hour from now, and future
sessions can stop guessing per-run arrival times. Second, I wrote out
the exact launch commands for the new late-window-discount variant —
one version for each way the price-gate experiment could come out — so
the next session can read the verdicts and fire the follow-up within
minutes.

## Session 33 — 2026-08-01 (early morning)

The loop restarted the moment the last session ended, still about an
hour before the seven overnight runs report. So this session finished
the other half of the preparation: the previous session pre-wrote the
launch commands for what comes after the verdicts; this one pre-wrote
the verdict-reading itself. Every comparison and check is now a tested,
copy-paste command in one runbook — and "tested" means each query was
run against results we already know and reproduced them exactly, so
there is no risk of a typo quietly producing a wrong verdict. When the
results land, the next session should go from "they're in" to
"here are the verdicts, here is the follow-up in the fleet" in a few
minutes. Nothing new to conclude about the strategy itself yet.

## Session 34 — 2026-08-01 (early morning)

Still roughly an hour before the seven overnight runs report, so this
session used the wait to compute something the mission has always asked
for but no session had actually measured: how often the neutral
strategy hits its pair-price target. The answer explains a lot. On the
full-history baseline run, only about one market in five finishes with
a pair cost under the $0.98 target — but the markets where the strategy
trades the most are also the ones where it buys cheapest, and the
busiest slice (about 4% of markets) is actually profitable. Nearly the
entire loss comes from the mid-activity majority: choppy-less markets
where completions never arrive and the strategy quietly accumulates on
the losing side. So the loss is not spread everywhere — it lives in one
regime. That suggests a new idea for the backlog: let the controller
watch its own completion rate inside each market and pull back its
quotes when completions stop arriving. Filed for after the pending
verdicts; the readout and the already-built late-window variant stay
first in line.

Update, same session: the wait stretched on, so the idea did not stay
filed — it became code. The new variant watches how fast the strategy is
completing pairs inside each market; when the pace falls behind, it
demands progressively cheaper prices before buying more. Sanity runs
confirm it behaves exactly as designed: untouched in the opening
minutes, then it visibly pulls back only in the markets that have gone
quiet. Two additional checks strengthened the case: the early-warning
signal reads even cleaner a couple of minutes later (supporting the
gradual form over an on/off switch), and the whole loss-concentration
pattern replicates on a second independent full-history run. The
variant is ready to launch as soon as the pending price-target verdict
says which price center to build the test around.

Second update, same session: while still waiting for the fleet, the new
variant got a full pre-flight. Every planned setting was exercised on
real markets and behaved exactly as drawn: untouched early minutes
everywhere, progressively stronger pull-back at higher doses, and an
earlier trigger when configured. One deeper measurement changed the
design before it was frozen: markets that fall behind and later catch
up still bleed in the late minutes, so a "once warned, stay careful"
variant was added and verified too. The loss-concentration pattern also
replicated on a second independent full run. Everything is banked as
copy-paste commands; the moment the pending verdicts land, both new
variants can be fired at the full history within minutes.

Final update, same session: the fleet finished earlier than predicted,
the session was still alive, and all seven verdicts got read tonight.
The headline is big: the price-discipline experiment came back a clear,
clean winner — telling the strategy to only build inventory when the
pair can be had for $0.92 instead of $0.96 cuts the average loss per
market by about 40%, the largest confirmed improvement this lab has
ever measured. The honest caveat: per dollar put at risk, nothing
improved — the strategy simply sits out more of the bad flow. And the
best setting sits at the edge of what was tested, so an even tighter
probe is already running. The two tilt experiments resolved too:
widening the direction signal's dead zone does nothing, and buying the
likely winner with patient orders instead of chasing beats the chasing
version — though still not the neutral strategy. Everything learned
tonight is already back in the fleet: eight full-history runs — the two
new throttle variants rebuilt around the winning price target, plus the
tighter-target probe — should report around 3am. Next session audits
the last five sessions, then reads them.

## Session 35 — 2026-08-01

Started with the scheduled every-fifth-session review of our own work:
the last five sessions all stayed on the assigned program, three
experiments were closed with the agreed rules, nothing was declared
finished without evidence, and the promotion safeguards are still in
place. Clean bill of health.

Last night's eight full-history runs were still about two hours from
finishing, so instead of waiting we designed and launched the next
experiment. It tests the one promising thread from yesterday: leaning
our inventory gently toward the side our price signal favors — but only
buying that lean patiently, never chasing it — now combined with the
tighter buying discipline that produced our best result so far. Four
runs ask how strong the lean should be and whether waiting a few
seconds for the signal to prove itself helps. One run got submitted
twice by accident; the duplicate stays in as a free measurement of
run-to-run noise and won't influence any verdict.

All thirteen runs (yesterday's eight plus these five) finish together
around 05:00 UTC. Next session reads them all and follows the
pre-agreed decision rules.

## Session 36 — 2026-08-01 ~01:55Z

The thirteen overnight runs are still grinding through the fleet
(results land together around 05:00 UTC), so no verdicts were possible
yet. Rather than wait idle, we re-measured our baseline picture on the
new, tighter buying discipline — the standing numbers all dated from
the old setting.

Good news first: the tighter discipline moved us visibly toward the
mission's price target. Three in ten markets now finish with a pair
cost under $0.98 (up from two in ten), and nearly a quarter under
$0.95 (up from under one in ten). The structure of the losses is
unchanged: markets where accumulation stalls early still carry
essentially all of them.

The most useful finding: about half the damage now arrives AFTER the
stall is already visible five minutes in — more than before. That is
precisely the moment one of the in-flight experiments starts throttling
its buying, so its potential payoff is larger than we estimated when we
designed it. We wrote down how to read its results before seeing them,
so the interpretation can't bend to fit the outcome.

Next session reads all thirteen results and applies the pre-agreed
decision rules.

## Session 37 — 2026-08-01 (~01:40–02:00Z)

The thirteen experiment results are still about three hours from
landing, so this was another short waiting-room session. We used it to
fix a subtle measurement problem before it could bite: two of the
pre-agreed pass/fail rules for the tilt experiment were written using
reference numbers from the OLD buying discipline, not the current one.

Re-measuring on the current baseline changed both numbers materially.
Our passive buying is now MORE lopsided toward the eventual loser than
before (about 62/38, was 58/42) — the tighter price cap helped profits
by simply doing less of the toxic buying, not by making it fairer. And
the participation drop we had guessed at was far smaller than guessed.
Both corrected numbers are now written down next to the rules they
feed, before any results arrived.

We also mapped, minute by minute, where the remaining damage sits:
about half of it comes from buys made in the back half of the window,
which is exactly the part one of the pending experiments throttles.

Next session: the results land around 04:45Z; read all thirteen and
apply the pre-agreed rules.
