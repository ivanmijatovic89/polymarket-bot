# pair-fable memory — INDEX

Entry point for every session. Read this file first, then follow pointers.
Memory is the ONLY continuity between sessions — conversation history does
not survive. Written for AI consumption: dense, factual, evidence-tagged.

## Layout

| Path | Contents |
| --- | --- |
| `INDEX.md` | This file: conventions + map + current-knowledge digest. |
| `capabilities/` | Engine knowledge, one file per subsystem. What the engine can do, verified. |
| `experiments/` | Mission-02 land: `LEDGER.md` (one line per experiment) + one file per variant family. |
| `process/` | How-we-work: evaluator spec, capability-refresh procedure, team workflow. |

## Conventions (binding)

1. **Every claim carries an evidence tag**:
   - `[code <path>:<lines> @ <short-sha>]` — verified by reading code at that commit.
   - `[run <backtestRunId> | <date>]` — verified by executing (the strongest tag).
   - `[db <query summary> | <date>]` — verified by querying the database.
   - `[doc <path> | UNVERIFIED]` — from docs only; must be upgraded or removed
     before anything depends on it.
2. **Negative results are time-scoped.** Never write "X does not work". Write
   "X was not profitable on <universe / date-range> with <run evidence>". The
   market changes; a wrong "does not work" note buries a profitable idea
   forever. Re-testing an old negative on new data is legitimate; re-testing a
   *verified engine fact* is waste.
3. **Capability notes carry a `verified:` header** (date + repo SHA). The
   capability-refresh procedure (see `process/`) re-checks notes whose SHA is
   behind origin/main in the surveyed paths.
4. **Update memory after every step, not at session end.** A session can die
   at any moment; files must always be continuable.
5. **Shared future**: parallel agent loops (other models) will read this
   memory. Write so a stranger can act on it: no session-local shorthand, no
   pointers into conversation context.

## Current-knowledge digest

(One paragraph per area, updated whenever the underlying files change.
Pointers, not content.)

- **Engine capabilities**: seeded from the initializer's code survey —
  `capabilities/backtest-cli.md`, `capabilities/metrics-storage.md`,
  `capabilities/strategy-system.md`, `capabilities/simulator.md`,
  `capabilities/fleet.md`. Status: local sequential path RUN-VERIFIED
  (runs 852/853, 2026-07-30) AND fleet path RUN-VERIFIED (runs 854/855,
  2026-07-30 — submission mechanics, SHA self-update observed live,
  machine attribution, sustained speed ~870 markets/min over 27 slots).
  Tools: `tools/sql.ts` (read-only DB queries), `tools/fleet.ts`
  (queue/worker/batch status), `tools/run-backtest.ts` (THE canonical
  launcher — RULES pins injected, unknown flags fatal, `--extend` refused
  per P-001, unique-batchUid run recovery per P-003, HEAD∈origin/main
  pre-check for queue runs, `--sweep-latency` fan-out; run-verified runs
  857/858/859 — the sweep path live-verified 2026-07-30),
  `tools/smoke.ts` (mandatory pre-fleet gate: protocol:check +
  sequential run + PASS/FAIL verdict; run-verified runs 857/860),
  `tools/results.ts` (run/batch summary: 'all'-segment headline + capital
  units + profitPer100 distribution + failures; verified against direct SQL
  on run 857), `tools/compare.ts` (fair multi-run compare on the slug
  intersection: Δ vs baseline, movers, daily pnl + Pearson correlation,
  latency-sweep auto-detect; verified on 856v857 identical-universe,
  854v855 partial-overlap vs SQL join, 858v859 real latency sweep), all
  reading through shared `tools/lib/runQueries.ts` (one code path for
  numbers; camelCase units keys). Protocol runs NEVER call
  `npm run backtest` directly — always via these tools.
- **Parity boundary**: mapped in `capabilities/parity.md` (2026-07-30 @
  e96b246) — shared core (MarketEngine/StrategyRunner/OrderManager/Portfolio,
  identical risk walls), the simulated boundary per intent/event, resolved
  survey questions (place_batch cap live-only → P-005; FOK = visible depth,
  exchange internals parked), 8 binding strategy conventions (cancel with both
  ids, batches ≤15, no MINED gates, fill-chunking indifference, on-grid
  prices, meta stamping), and the 8-point live-trust evidence bar. Proposals
  P-005/P-006/P-007 filed from this work.
- **Evaluator**: capital-aware units DESIGNED and RUN-VERIFIED in
  `process/evaluator.md` (2026-07-30, run 856) — cost==invested for
  no-sell/no-split/no-merge strategies (winning side incl.), 6 unit formulas
  + SQL skeleton, binding intent_meta stamping convention (dedup +
  price-improvement caveats proven), capital levels only via strategy-param
  sweeps (no cash model). Stage pipeline / promotion criteria still open
  (PLAN `evaluator-design`).
- **Experiments**: none yet (mission 02).
