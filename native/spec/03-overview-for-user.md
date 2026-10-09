# 03 — Overview for the project owner

A one-page summary in plain language. It is not normative: where it differs from the other documents in this folder, they win.

## What we are building and why

- A new trading engine in **Rust**, a compiled language that is much faster than TypeScript and uses every CPU core. It replaces only the engine: the part that replays market data, runs a strategy, decides orders, and simulates or sends them.
- **One engine for backtests and live trading**, so a backtest shows what the live bot would have done. Getting the two to agree is the whole point. It follows Polymarket's current rules (CLOB V2, per-market fees, the hold on instant orders, order expiry). Today's TypeScript live bot does not work on CLOB V2; the Rust live part fixes that.
- **Speed is the top priority**: the fastest backtests and the smallest delay in the live bot.

## What stays the same for you

- The same commands, dashboard, database, fleet, statistics, recorder and research tools. Your TypeScript strategies and AI protocol runs keep working on the old engine. Every Rust run is labeled with its engine, so results are never mixed by accident.
- The AI agent never places a real order. Fleet and agent builds of the engine cannot send orders at all; real orders need a separate build that only you make and launch.

## Where and how the work runs

- All engine work runs on **worker-1** (the Mac mini), in its own folder, separate from the fleet's folder. The fleet's market files are read, never changed. The MacBook is not used (its disk is full).
- worker-1 keeps doing fleet and AI-agent work. Speed tests run only between 01:00 and 07:00: the agent first pauses worker-1's AI-agent runs (a running session finishes, nothing is killed) and its fleet worker, and resumes them afterwards.
- The AI session works in runs of at most **8 hours**, then pauses. You resume it, and it continues from the progress file (STATUS.md). Work is saved in small steps that always build.
- Until gate 2 everything stays on a branch with a draft pull request marked "DO NOT MERGE before gate 2". One exception goes to main first: a small script that saves each market's exchange rules before it starts, because they cannot be recovered later.
- A separate AI (Fable), which cannot see the engine code, writes independent tests from this spec.

## Order of work

1. Plan frozen tonight (gate 1, decided by the lead for you). 2. Rules-saving script on main. 3. Engine and backtests on worker-1. 4. Copy-mode proof on 200+ BTC 15m markets (gate 2), then merge to main. 5. Database, speed work, realistic mode, candidate groups (many parameter sets in one pass), final speed test. 6. Fleet: worker-1, worker-2 and milan-m1 (if available); the MacBook only sends jobs. 7. AI protocols start writing Rust strategies, so the whole fleet gets faster. In parallel: 8. worker-2's recordings and paper trading (live data, no money). The real-order connection (gate 4) and your ~$100 calibration (gate 3) are a separate later goal (D70, decided by you on 2026-10-09); this goal places no real orders.

**Copy mode** reproduces the old engine to prove the new one is right. It is checked without simulated latency, and the old engine's risk-check and cancel bugs are not copied (D71). **Realistic mode** follows today's exchange rules and is checked against real trading. BTC 5m copy-mode checks on Telonex data wait until you renew Telonex; 5m is checked on worker-2's recordings meanwhile.

## Gates (work stops until you approve)

| Gate | When | What you see | You decide |
|---|---|---|---|
| G1 | Tonight | Decided by the lead for you; this page | Change any decision below in the morning |
| G2 | After the copy-mode proof | Same orders, fills and cancels as the old engine on 200+ BTC 15m markets (money within $0.0001 per market); every difference labeled; first speed numbers | Accept, merge to main, approve differences that change money |
| G4 (later goal) | Before any real order | 24+ hours of paper trading whose replay gives identical decisions, exchange-simulation tests, safety checklist, calibration plan | Answer the questions below; build the real-order version on the chosen Mac and run a short paper test with it; approve; you launch |
| G3 (later goal) | After calibration | Pass or fail on each pass mark fixed in advance | Make realistic mode the default |

## Decisions taken tonight that you may want to check (details in 02-decisions.md)

- New Rust strategies may say "wake me only when something relevant changed" (D41). Fleet and live binaries use the fastest-running build; the quick build is for local checks (D18).
- An instant BUY of N shares becomes a dollar amount at the limit price in realistic mode and live, as on the exchange (D42). The engine never sends an order that would trade against our own resting order (D54).
- A faster local copy of the market files on worker-1, up to 40 GB; fleet-wide only after your OK at gate 2; the original files are never re-converted (D46).
- Old engine: bug fixes only after gate 2, except features AI protocols still need (which also get a Rust version); retirement review about 3 months after gate 3 (D49). The agent runs database migrations that only add columns or tables (D50).
- Backtests across fee periods are allowed, with per-period statistics (D51). Instant-order hold times before 2026-08-17 are used but flagged and do not count for gate 3 (D52). Fees are checked with free data first; buying Telonex data needs you (D53).

## Questions for you at gate 4 (before any real order; asked when the later goal starts)

Separate storage keys per machine; a paper-trading key on an empty wallet; which Mac calibrates and trades; which wallet (recommended: a new one); alert app (recommended: ntfy); automatic restarts (recommended: up to 3 per hour); extra calibration pass marks; maker budget; calibration days.

## Speed, calibration and risks

- Earlier test: 1,000 BTC 15m markets took 617 s in TypeScript and 99.6 s in a first Rust prototype. The new design aims much higher; numbers are measured three times on an idle Mac, never assumed, and a speed change must never change a result.
- The $100 calibration replays the exact markets you traded and compares acceptances, fill prices, fees, fill rates and delays. It cannot prove a strategy makes money, and says nothing about large orders, other coins or another computer.
- Risks: only Rust strategies get faster; the old engine's bugs surface and must be explained; the calibration is small; a decision you change in the morning means redoing the work that depends on it.
