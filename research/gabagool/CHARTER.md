# Gabagool Knowledge Shift — Charter

You are working alone, one session in a relay. Your folder is
`research/gabagool/` and your mission is:

**Build the definitive, verified knowledge base about ONE strategy concept —
the "gabagool" strategy — so that the Strategy Research Protocol can attack
it with maximal priors and minimal wasted experiments.**

The concept, pinned: a passive two-sided maker on Polymarket crypto up/down
binary markets that accumulates BOTH the UP and DOWN tokens over the window
whenever each side gets temporarily cheap, targeting a combined average pair
cost < $1.00, holds to resolution, and redeems the winning leg. Pair legs
fill at different times; unpaired inventory is directional risk and is THE
risk. The reference implementation is the wallet behind
https://polymarket.com/@gabagool22 (active ~Nov 2025–Feb 2026, now inactive)
and its successors. Prior reverse-engineering lives in
`GABAGOOL-INVESTIGATION.md` at the repo root — it is your starting prior,
not gospel (it corrected itself several times; extend and re-verify it).

You produce knowledge, measurements, and testable hypotheses — NOT strategy
code, NOT evidence backtests, NOT a new research protocol. The lab that
consumes your output already exists (`strategy-research-protocol/`).

## Phase 0 — required reading (first unit, before anything else)

1. `GABAGOOL-INVESTIGATION.md` (repo root) — the prior investigation.
2. `MISSION.md` + `PLAYBOOK.md` (repo root) — the goal ladder and the games
   (A structural mispricings, B Binance fair-value lag, E liquidity rewards,
   F own-the-open, G endgame, J resolution mechanics are all adjacent).
3. `strategy-research-protocol/SCOPE.md`, `ENGINE.md`, `STAGE-GATES.md`,
   `LESSONS.md` — what the lab can test and how it judges.
4. `src/strategies/research/spread-capture/FAMILY.md` and
   `src/strategies/research/endgame-panic-bid/FAMILY.md` — the two closest
   existing families. spread-capture is the SELL-side mirror of this exact
   concept (its roadmap item #6, "bid-side mirror", IS the gabagool
   baseline, unimplemented) and it was measured gross-negative under the
   conservative fill model — adverse selection on the first fill, not
   fees, was the loss channel. endgame-panic-bid has the resting-maker-bid
   + hold-to-redemption primitive and its own adverse-selection result.
5. `../polymarket-bot-fable/fable-lab/knowledge/LESSONS.md` and
   `EDGE-SPACE.md` (sibling worktree, read-only) — 32 lessons from a prior
   autonomous campaign that killed 42 ideas on BTC 15m, including a maker
   family. Know what is already dead and WHY before proposing anything.
6. `docs/datasets/telonex/overview.md` + the binance aggTrades feed doc
   under `docs/datasets/` — what historical data exists (19k+ markets;
   Binance spot is now replayable in backtests — this is NEW and neither
   prior campaign had it).

Output: `research/gabagool/PRIORS.md` — every load-bearing claim already
made, each tagged `verified` / `reported` / `contested`, with source. This
file is the checklist the rest of the shift works through.

## Deliverables (everything else serves these)

- `STRATEGY-BRIEF.md` — the build spec: mechanism, fair-value options,
  quoting policy options, leg-risk policies, sizing/cadence, exit/endgame
  handling, with tradeoffs and evidence links. The single most important file.
- `HYPOTHESES.md` — ranked, testable hypotheses. Each: mechanism statement,
  parameter ranges (justified by forensics/measurements), expected metrics,
  kill criteria, and which SRP family it belongs to.
- `METRICS.md` — the metric catalogue for this concept: pair cost, pair
  completion rate, unpaired-inventory exposure, fills/market, per-market
  PnL distribution INCLUDING tails, capital usage, latency sensitivity.
- `VENUE-MECHANICS.md` — verified venue facts: current fee schedule for
  crypto up/down series (and its history), liquidity/maker rewards terms
  and whether these markets qualify, tick size, min order size, rate
  limits, GTD minimum expiry, resolution source/precision/timing, negRisk.
- `wallets/<handle>.md` — one forensic dossier per target wallet (list
  below) + `wallets/_META.md` — the cross-wallet synthesis: who still runs
  this on which books, what changed since Feb, what the current meta is.
- `measurements/<slug>.md` — own-data measurement notes (scripts +
  method + numbers), raw pulls under `data/` (gitignored).
- `ENGINE-GAPS.md` — what the engine/backtest cannot yet express for this
  concept (from READING code/docs, not from testing). Known already —
  verify and quantify, do not rediscover: maker fills are fee-free,
  all-or-nothing at full size, and granted only when price goes THROUGH
  the level (`worst_queue` in `src/trading/execution/BacktestExecution.ts`
  — so in-sim size scaling lies and fills are the adverse subset); taker
  fee 156 bps (`src/trading/fees.ts`); matched up/down pairs auto-credit
  at $1 in `src/backtest/stats/marketStats.ts` (no merge needed);
  `polymarketPriceToBeat` (the strike) is live-only; maker/liquidity
  rewards are not modeled at all.
- `OPEN-QUESTIONS.md`, and at the end `LAB-HANDOFF.md` — 2–4 concrete
  family seeds for `strategy-research-protocol/scripts/propose-family.sh`,
  each naming the decision driver, the baseline sweep, and the priors.

## Workstreams (seed STATE.md with these; extend as you learn)

A. **Literature** — what this is called and what is known: two-sided
   quoting with inventory control (Avellaneda–Stoikov and successors),
   adverse selection (Glosten–Milgrom), queue/fill models, prediction-market
   microstructure, market making on bounded-payoff assets near expiry.
   Each note ends with "implications for BTC-15m implementation".
B. **Venue mechanics** — verify on primary sources (Polymarket docs/API,
   this repo's code): fees NOW + fee history for these series, liquidity
   rewards terms (does two-sided quoting on 15m crypto earn rewards? how
   much per day at min size?), tick/min-size/rate limits, resolution rules.
C. **Wallet forensics** — primary data over anyone's blog. Endpoints (from
   the investigation): `data-api /trades` (market-wide, offset cap 4000),
   `data-api /activity?user=<proxyWallet>` (fills + REDEEM/SPLIT/MERGE,
   exact usdcSize), on-chain OrderFilled/subgraph for exactness. Targets:
   - https://polymarket.com/@gabagool22 (the archetype — deep-dive: level
     offsets vs mid, order sizes, inter-fill gaps, per-market capital,
     pair-completion rate, hold vs merge vs sell, PnL/market distribution)
   - `0xb55f…64d4` — the incumbent flagship from the investigation (extend
     the 337-market analysis; is it still printing? on which books?)
   - https://polymarket.com/@powerwinner
   - https://polymarket.com/@bonereaper
   - https://polymarket.com/@0xaaaaa
   - https://polymarket.com/@doggystyie
   - https://polymarket.com/@drfc4eybh7i8
   - https://polymarket.com/@0xce25e214d5cfe4f459cf67f08df581885aae7fdc-1777575398144
   - https://polymarket.com/@badfallen
   Per wallet: is it gabagool-style? books/timeframes, cadence, size
   ladder, pair completion, avg pair cost, exit style, PnL incl. tails,
   active period, estimated capital. Resolve handle→address first (profile
   page or public API; record how).
D. **Own-data measurements** — small, local, sampled (≤300 markets per
   script run; this is priors-building, not validation — the lab owns
   validation). Scripts in `research/gabagool/scripts/` (tsx; DuckDB or
   parquet readers already in node_modules; read-only outside the folder).
   Priority list:
   1. Sum-of-best-asks < $1 scan on recent BTC 15m markets: frequency,
      depth, duration (Game A number).
   2. **Passive-fill reality gap**: from Telonex tick data of markets in
      gabagool's active window, compute which of his ACTUAL fills (from
      data-api) would have been granted under the engine's conservative
      worst-queue rule (a resting BUY at P fills only when bestAsk < P).
      This single number tells the lab how much the backtest understates
      passive fills — it decides whether a sim-profitable variant exists.
   3. Endgame reversal table: P(flip) by (spot distance, seconds left).
   4. Open dynamics: spreads/depth/flow in the first 60s vs rest.
   5. Spread & depth lifecycle over the 15m window.
E. **Synthesis** — update STRATEGY-BRIEF/HYPOTHESES/METRICS continuously,
   not at the end. When workstreams stop changing them materially, write
   `SATURATION.md`, then `LAB-HANDOFF.md`, then create `DONE`.

## Operator claims to verify (reported, not yet verified)

- gabagool did up to ~700 fills in a single 15m market.
- ~$34k deployed per 15m market for ~$30–120 profit, win rate ~99%.
- Active Nov→Feb (or slightly longer), then stopped entirely.
- A current large wallet trades ALL crypto symbols and timeframes with a
  simpler, more loss-tolerant version (~$8M/day figure — volume or PnL?).

## Method rules

- Every external claim gets a source link and a confidence tag. Public
  writeups about gabagool are presumed wrong until data-checked (the
  operator and the prior investigation both found most of them wrong).
- Primary data (API pulls, own parquet, repo code) beats secondary text.
- Contradictions with PRIORS.md are ledgered explicitly in the journal and
  in the note that found them.
- Raw pulls → `data/` (gitignored); derived tables and findings → committed
  markdown with the producing script named.
- No meta-work: no new tooling beyond simple pull/analyze scripts, no
  protocol redesign, no audits of audits (the fable-lab retro showed this
  failure mode). The deliverables list above is the whole job.
- English only, in every file.

## Hard constraints (mechanically enforced where possible)

1. Write ONLY inside `research/gabagool/` (pre-commit hook enforces; never
   bypass it, never `--no-verify`).
2. Stay on branch `gabagool-knowledge`. Never merge to or touch `main`.
3. NO evidence backtests and NO worker-fleet submissions. The only engine
   execution allowed: a ≤10-market `--sequential` smoke to prove a
   measurement script's plumbing — never record EV conclusions from it.
4. No live trading, no order placement, no on-chain transactions, no DB
   writes. `.env` credentials are for READ-ONLY queries.
5. Do not modify `src/`, `strategy-research-protocol/`, or the fable
   worktree. Read them freely.
6. No new npm dependencies.
7. Commit after EVERY completed unit (hook checks scope) and push the
   branch (`git push -u origin gabagool-knowledge`) so nothing is lost.

## Resumability contract (you may be killed at any moment)

- `STATE.md` — current status digest + the work queue, updated as part of
  every commit: what is done, in progress, next. A fresh session must be
  able to continue from CHARTER.md + STATE.md alone within minutes.
- `JOURNAL.md` — append-only plain-language narration (the operator's
  `tail -f` window). Timestamped entries: what you did, what you found,
  what surprised you.
- Work in self-contained units (~30–60 min): think → pull/measure → write
  files → commit → update STATE. Prefer finishing one unit over starting
  three. Never ask questions; there is nobody here.
