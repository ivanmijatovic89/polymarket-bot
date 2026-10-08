# 03 — Overview for the project owner

A one-page summary for the owner, with no engineering background needed. It is not normative: where it differs from the other documents in this folder, they win.

## What we are building and why

- A new trading engine written in **Rust**, a compiled language that runs much faster than TypeScript and can use every CPU core at once. It replaces only the engine: the code that replays market data, runs a strategy, decides orders, and simulates or sends them.
- **One engine for both jobs.** The same code runs backtests and live trading, so a backtest shows what the live bot would have done on that market. Getting backtest and live to agree is the whole point.
- It is designed from Polymarket's rules as they are today: CLOB V2 (Polymarket's current exchange version), per-market fees, the hold on instant orders, and order-expiry rules. It does not copy the old engine. Today's TypeScript live bot does not work on CLOB V2, and the Rust live part fixes that.
- **Speed is the top priority:** the fastest possible backtests and the smallest possible delay in the live bot.

## What stays the same for you

- The same commands (`npm run backtest ...`), dashboard, database tables, fleet, batch statistics, recorder and research tools. They get exactly the results they get today.
- Your TypeScript strategies and AI protocol runs keep working on the old engine, unchanged. Every Rust run is labeled with its engine in the database, so results from the two engines are never mixed by accident.
- Until gate 2, all work stays on a separate branch. Main and the fleet are not touched.
- The AI agent never places a real order. Real orders need a special build plus a launch flag that only you use.

## Order of work

1. Freeze the plan (now). 2. Build the engine and backtest on this MacBook. 3. Copy-mode proof against the old engine (gate 2), then one merge to main. 4. Save Rust runs to the database, do the speed work, build realistic mode and candidate groups, run the final speed benchmark. 5. Run on the 4-Mac fleet. 6. Read worker-2's Recorder V4 recordings, then paper trading (live market data, simulated fills, no money). 7. Connect to Polymarket for real orders (gate 4). 8. You run the ~$100 calibration (gate 3).

The engine has two modes. **Copy mode** ("ts-compat") reproduces the old engine's behavior, to prove the new one was built right. **Realistic mode** follows today's exchange rules and is checked against real trading.

## How you will know it works: four gates (work stops until you approve)

| Gate | When | What you see | You decide |
|---|---|---|---|
| G1 | Now | This spec, the decision list, the open questions | Freeze the plan |
| G2 | After the copy-mode proof | On 200+ real BTC markets: the same orders, fills and cancels as the old engine (same sides, prices and sizes; money within $0.0001 per market). Every difference is listed and labeled as an old-engine bug, a Rust bug (always fixed) or an intended change. You approve any difference that changes money. First speed numbers. | Accept, and merge to main |
| G4 | Before any real order | 24+ hours of paper trading whose replay gives identical decisions; tests against a simulated exchange; the safety checklist (kill switch, loss limits, phone alerts); the calibration plan with its pass marks fixed in advance | Approve; you launch |
| G3 | After calibration | The calibration report: pass or fail on each pass mark agreed in advance | Make realistic mode the default |

G4 comes before G3 in time. There is no deadline, and no result that makes us abandon the project: problems are fixed until the gate passes.

## Expected speed, and how it is measured

- In an earlier test, 1,000 BTC 15m markets with lagsnipe took 617 s in TypeScript and 99.6 s in a first Rust prototype (6× faster), both with 8 processes. The new design is estimated at roughly 8–20 s for the same work on this MacBook (30–75× faster), plus about 2 s to start a run and save it. These are estimates, not promises.
- Where the speed comes from: one long-running program per Mac that uses all cores, instead of one Node process per core; price feeds and market files decoded once and shared; a faster local copy of the market files (needs disk, see questions); candidate groups, which test many parameter sets in one pass over each market; letting new strategies skip updates where nothing relevant changed; and thread counts tuned for each chip, because M4 and M1 Macs mix fast and slow cores differently.
- Live: our own code should take well under 1 ms from receiving a price to having an order ready. The internet round trip to Polymarket (70–380 ms) dominates. The bigger live gain is that the engine never waits for an order reply before it handles the next price.
- **Measured, not assumed.** Fixed sets of 1,000 markets run on an idle Mac, three times each, TypeScript and Rust on the same markets. Time, markets per second, CPU and memory are recorded at every milestone, and any slowdown over 10% must be explained. A speed change must never change a result: outputs stay byte-for-byte identical at any thread count and on every Mac.
- **Only strategies written in Rust get faster.** The AI protocols' TypeScript strategies (about 80% of today's fleet work) keep today's speed until the follow-up project in which protocols write Rust strategies.

## What the $100 calibration does

- You run the bot with real money at minimum order sizes for 2–4 days, while worker-2 records the same markets. The budget is about $5 to check exchange rules with tiny orders, $25 for instant (taker) orders and $30 for resting (maker) orders. The bot stops automatically at $60 total loss, and at most $15 is at risk at any moment.
- Afterwards we replay those exact markets through the backtest and compare them with what really happened: which orders were accepted or rejected, fill prices, fees to the cent, how often resting orders filled, and each delay. The pass marks are fixed before the run, so nobody can move the goalposts.
- It cannot prove that a strategy makes money. It also says nothing about larger orders (above about 5–10 shares), other coins, or a different computer or network.

## Main risks

- Expectations: the fleet as a whole gets no faster until protocols write Rust strategies.
- The old engine has bugs of its own. Copy mode will surface them, each one must be explained, and you approve every one that changes money.
- The calibration is small. Maker fill rates come out only to about ±20%, and some rules before mid-August 2026 are known only from news reports, not confirmed by Polymarket.
- Data and disk: BTC 5m data is not ready for the copy-mode proof, and this MacBook has only 2.5 GB of free disk.
- An AI that writes both the code and its tests can repeat its own mistakes. A separate session that never sees the engine code writes independent tests.
- AI sessions can stop mid-task. Work moves in small steps that always build, and a progress file lets any new session pick up where the last one stopped.
- Real money live: kill switch, session loss limits, phone alerts, open orders cancelled after a restart, and real orders only when you launch them.
