---
name: strategy-research
description: 'Run the strategy-research loop for this Polymarket 15m up/down bot — generate a strategy idea, implement it, sweep params, validate out-of-sample, judge it ruthlessly (GROSS vs net vs baseline), and record the lesson. Use when the user wants to find/research/test a new trading strategy or continue the research workflow.'
---

# Strategy Research Loop

You are running the **strategy-research workflow** for this Polymarket 15-minute crypto
up/down trading bot. Your job is to take a trading idea from hypothesis to a recorded
verdict — and to **leave reusable knowledge** whether it wins or loses.

The canonical workspace and rules live in `research/README.md`. Read it first. Numeric
truth lives in the `backtest_runs` DB table (reference by `batch_uid`); `research/`
markdown holds the *reasoning*.

## Mission & mindset

- **Goal:** discover profitable strategies; reject bad ideas *fast* but leave a lesson; improve promising ones systematically.
- **The user's attention is the bottleneck, not compute.** Machine-generate, machine-build, machine-run the cheap gate; the user reads only ranked numeric survivors. Never make the user reverse-engineer prose specs to gate ideas.
- **Do not fool yourself.** The two killers are (1) overfitting / multiple-testing and (2) edge that doesn't survive execution cost. Bend everything toward defeating those.
- **One run is never a verdict.** Judge a strategy as a *portfolio of its experiments* — the *shape* of a sweep (a coherent winning region = signal; one lucky cell = noise).
- **GROSS first.** Always look at GROSS PnL (= net + fees) separately. It tells you whether an edge exists *before* execution cost eats it. On this venue, taker fees are roughly the size of most micro-edges — many ideas are gross-break-even and die on fees.

## The loop

```
CREATE → TEST → DECIDE → (record lesson) → repeat
```

### 0. Start of session — load memory

Before proposing anything, read what's already been tried so you don't re-invent dead ideas:
- `research/README.md` and every `research/families/*/family.md` (status + lessons).
- The user's cross-session memory (`~/.claude/projects/.../memory/MEMORY.md`).

Tell the user the current state (which families are KILLED/SHELVED/open) and propose the next move.

### 1. CREATE — idea → spec → registered strategy

**Ideas come from the market's structure, not generic trading lore.** This market = 15m
binary "<coin> up or down", two tokens (UP/DOWN), each pays $1 if right, with an order book
per token. Renewable idea sources:
- **Order-book-only signals** (backtestable today): spike reaction, **order-book imbalance**, convergence-near-expiry, passive wide-spread maker.
- **Pricing-model signals** (need spot/vol feeds — NOT in backtest yet; flag as a data-plumbing project): fair-value gap, spot-lead lag. External feeds are live-only.

Write a **spec** (compact): `hypothesis` · `mechanism` · `knobs as RANGES` · `pre-mortem (how it dies)` · `baseline to beat`. Knobs are ranges because one strategy must become a *sweep* of ~10–20 experiments, never a single run.

**Implement:**
- File: `src/strategies/signals/<Name>.vN.ts`. Mirror an existing one (e.g. `OrderbookImbalance.v1.ts`).
- Zod `ConfigSchema` (the param *contract*: keys, types, hard bounds), `definition` with unique `id`, `create`.
- **Reuse the exit state-machine** (take-profit / stop / maxHold / late-window bailout + `sellMarketable`) from `SpikeMomentum`/`OrderbookImbalance` rather than rewriting.
- Register in `src/strategy/strategyRegistry.ts` (import + add to the map).
- `npx tsc --noEmit` must be clean.
- Order-book only, no external feeds. Note the live caveat: buy-then-sell needs MINED before selling (backtest books on fill).

### ⚠️ 2. WORKER RESTART RULE (do not skip)

Backtests execute in the **persistent tmux backtest workers** (`backtestWorker.ts` /
`backtestWorkerChild.ts`), which load the strategy registry **once at startup**. A newly
added or renamed strategy is invisible to running workers → every market fails with
`[strategy] unknown strategy id="..."`.

**After adding/renaming a strategy, STOP and ask the user to restart (reset) the tmux backtest
workers. Wait for their confirmation before running.** Changing only `--param` values does NOT
need a restart. The user does not want this auto-fixed.

### 3. TEST — sweep, then validate

**Backtest command (telonex, BTC 15m, last N markets):**
```bash
npm run backtest -- \
  --strategy <Id> \
  --param key=value ... \
  --comment "<short note>" \
  --batchUid <unique-id> \
  --input-mode telonex-delta --read-from local \
  --limit 1000 --symbol btc --timeframe 15m --latest
```
- Run **one at a time, in the background**; wait for each to finish, then launch the next.
- After launching, verify it's healthy: `completed=N failed=0`. If you see `unknown strategy`, the workers are stale → kill the run, ask for a restart.
- `--batchUid` must be unique per run (failed rows block reuse — bump the suffix).

**The funnel (gates):**
1. **Smoke** — small `--limit` (e.g. 20). Does it trade, not crash, not do something insane?
2. **Signal sweep** — vary the knobs (a coarse grid, ~8–20 combos). Read the **GROSS surface**. Is there a *coherent* region that beats baseline, or just noise? Apply prior lessons (e.g. let winners run → bigger takeProfit; tighter stop).
3. **Validation (out-of-sample)** — freeze the best params, run on data you did NOT tune on. **Use multiple windows** — one OOS window can be regime luck. Two ways:
   - Fresh run on an older window (`--to-ms`/no `--latest`), isolated stats; or
   - **Extend** the tuning run backward and *difference*: `npm run backtest -- --extend <runId> --limit 1000` adds the previous 1000 markets (frozen params inherited). Capture the run's `pnlTotal`/`marketsPlayed` BEFORE extending, then `OOS = post − pre` to isolate the new chunk. (`--extend` merges stats over the union, so differencing is how you see the OOS chunk alone.)

**Reading results from the DB** (the run output only shows progress). Write a tiny ESM script *inside the repo* and run with `tsx`:
```ts
import { getDb, closeDb } from './src/db/index.js'
import { backtestRuns } from './src/db/schema.js'
import { eq } from 'drizzle-orm'
async function main(){ const db=getDb()
  const r:any=(await db.select().from(backtestRuns).where(eq(backtestRuns.batchUid,'<uid>')))[0]
  const gross=Number(r.pnlTotal)+Number(r.totalFeesPaid)
  console.log({net:r.pnlTotal,fees:r.totalFeesPaid,gross,ev:r.evPerMarketPlayed,win:r.winRatePct,played:r.marketsPlayed})
}
main().then(async()=>{await closeDb();process.exit(0)}) }
```
Key columns: `pnlTotal` (net), `totalFeesPaid`, `evPerMarketPlayed`, `winRatePct`, `marketsPlayed`, `tradesMaker/Taker`, `pnlAvgWin/Lose`, `qualitySystem`, `capitalFinal`. GROSS = `pnlTotal + totalFeesPaid`.

### 4. DECIDE — kill / shelve / iterate / promote

- **Pre-register the bar before you run** (e.g. "net-positive across the full N markets, not just the recent window"). When the result lands, **do not move the goalposts.**
- **Structural fixes before signal-fitting.** A maker-exit / fee change is structural (low overfit risk). **Adding a gate is signal-fitting** — on a thin edge with limited data, a gate that "rescues" profitability is far more likely fitting noise. Do structural first; gates last, only if needed, with strict OOS discipline.
- **Thin edge + gate = overfitting.** If a strategy is gross-break-even and the one safe lever (fees) doesn't tip it → shelve it. Don't gate your way to a fake profit.
- Outcomes: **promote** (clears bar OOS → more windows / latency stress / paper), **iterate** (clear data-pointed next experiment), **kill** (no gross edge), **shelve** (real but too thin / fee-bound).

### 5. RECORD — leave the lesson

- Update `research/families/<family>/family.md`: status, candidates table (with `batch_uid`s), the lesson, what would re-open it. **Keep it compact** — numbers live in the DB.
- Update the user's cross-session memory bullet for the family.
- **Correct the record honestly** if a later result deflates an earlier one (e.g. a one-window "pass" that more data overturns). Honesty over a nice number.

## Interaction style (how this should feel)

- Drive the loop proactively. Do the analysis inline (don't spawn subagents).
- At each fork, present a tight read of the numbers + a recommendation, and offer the user a small set of options to choose from. Let them steer.
- Be the honest one: name overfitting risk, thin edges, regime luck, and your own misses.
- A good stopping point is after a DECIDE + record — everything's banked, nothing lost by pausing.

## Cheat-sheet

- **Size semantics:** `size` is *shares*, not USDT. Cash per market ≈ `size × entryPrice`; each share pays $1 if right. Early exit P&L ≈ `size × (exitPrice − entryPrice)`. Backtest bankroll = $1,000, one position at a time.
- **Fee math:** `fees ≈ taker trades × per-trade taker fee`. Maker fills are far cheaper. Cutting trades (e.g. a longer dwell/persistence filter) cuts fees as much as cutting fee rate.
- **Latency stress:** `BACKTEST_LATENCY_DELAY` / `BACKTEST_LATENCY_JITTER` (ms) — a real edge must survive intent→fill delay.
- **Hard-won lessons so far:** see memory + `research/families/`. spike-reaction = KILLED (edge ≈ execution cost). orderbook-imbalance = SHELVED (real but too thin, fee-bound; maker take-profit misses fills the taker captured). Don't re-propose these without a structurally fatter signal or a cheaper fee/venue.
