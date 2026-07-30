# Dataset

- Source: `telonex` datasets only, converter `delta-typed`
  (`--input-mode telonex-delta`)
- Read mode: `--read-from local-or-download-from-r2-to-local`
- Symbol: Bitcoin (btc) — slugs `btc-updown-15m-*`
- Timeframe: 15 min
- **Telonex eligible from: 2025-12-01T00:00:00Z** (the
  `TELONEX_DATASET_ELIGIBLE_FROM` floor; the series itself is recorded since
  2025-10-11, but markets below the floor are excluded from the universe)
- Feed coverage for THIS symbol/timeframe (btc 15m) — matters ONLY for
  variants that declare the feed:
  - **Binance aggTrades (BTCUSDT): from 2025-11-29** — covers the full
    eligible universe
  - **priceToBeat: from 2026-02-18 23:45** — the recording epoch of the
    btc 15m series specifically (other series have their own epochs);
    markets before it have no key
  - **Chainlink (crypto_prices, btcusd): from 2026-04-02** — coverage start
    for all symbols incl. btcusd; hard error on any market before that date
- **Protocol universe floor: ≥ 2026-04-02.** This protocol backtests only
  markets from 2026-04-02 onward — 4+ months of data (Apr, May, Jun, Jul, …,
  growing by ~96 new markets/day). Rationale: this market changes fast, so
  recent months carry the signal; going further back adds volume, not
  insight. Convenient side effect: from this floor, ALL external feeds
  (Binance, priceToBeat, Chainlink) are fully covered, so declaring a feed
  never shrinks the universe.

# Strategy

## Strategy description

The strategy tries to buy BOTH sides — UP and DOWN shares — such that the
total pair price is below $1 with fees included, so the pair can be merged
and the difference is profit. Example: 500 UP shares at avg price 0.32 +
500 DOWN shares at avg price 0.64 = avg pair price 0.96 (after fees); the
merge earns 500 × 0.04 = $20 USDT.

The strategy must not buy 500 shares of a side at once — it accumulates in
small increments, alternating sides, so the imbalance and the risk stay
small at all times.

The strategy must NOT be latency-dependent. Other bots run faster systems;
research showed the profitable bots using this strategy are not latency
sensitive — they trade one fill now, another seconds later. A variant must
survive independently of how backtest latency is tuned.

## Strategy rubrics

1. We only BUY, we do not SELL.
2. We build only for Bitcoin 15 min.
3. We merge only once per market (in market or after market).
4. All accounting is FEE-INCLUSIVE: maker fills cost $0 in fees; every
   taker fill budgets the full 0.07·p·(1−p)/share curve (we are tier-0,
   no fee refunds). A pair is "below $1" only after fees.
5. Exits are merge and redeem only (follows from rule 1: no sells, ever).

# Trading rubrics

- Not latency dependent — operational definition: a variant must be
  profitable at the measured live latency (~140 ms) and must not collapse
  as latency INCREASES (the standard eval sweeps latency upward).

# Backtesting

- Backtest runs must NOT emit `merge_positions` — the simulator cannot
  account for mid-market merges (verified: a full merge scores $0, a partial
  merge scores negative on a profitable trade). Pairs are valued at
  settlement, which measures the same edge correctly. Live merge timing is
  an execution detail, out of backtest scope.
- Every backtest run must pin its simulated latency explicitly with the
  `--latency-delay-ms` and `--latency-jitter-ms` flags. Flags — not the
  `BACKTEST_LATENCY_*` env vars — because flags land in the run's recorded
  `cmd`, making the latency auditable later. A run whose latency came from
  the ambient `.env` is not evidence.
- Every fleet submission must carry provenance: `--protocol pair-fable`
  and `--model <model-id>` (the model id this loop runs as — shown in the
  Mission Control run configuration). Runs without provenance cannot be
  compared across models or protocols later.
- The maker-fill model is CONSERVATIVE: the simulator fills a resting order
  only when the book trades THROUGH its price level (worst-queue assumption —
  you are last in line at your price; see src/trading/execution/
  BacktestExecution.ts). Live, takers also lift resting orders without the
  price moving through them. Since this strategy leans maker (maker fills pay
  $0 fees), backtests systematically UNDERSTATE maker fill rates — the safe
  direction of error, but it can make genuinely profitable passive variants
  look unprofitable. Keep this bias in mind when judging results and when
  comparing maker-style vs taker-style variants.
- Canonical run:

  ```bash
  npm run backtest -- --strategy <id> --input-mode telonex-delta \
    --read-from local-or-download-from-r2-to-local --symbol btc --timeframe 15m \
    --from-ms 1775088000000 \
    --latency-delay-ms 140 --latency-jitter-ms 20 \
    --protocol pair-fable --model <model-id>
  ```

  (`--from-ms 1775088000000` is the 2026-04-02 protocol floor; 140/20 ms is
  the measured live latency baseline — vary it deliberately, never
  ambiently.)

## Backtesting speed

- market speed: ~1.5 s per market per worker slot (older anchor measurement —
  re-verify once before relying on it for planning)
- fleet speed: ~22 active slots ⇒ the full protocol universe
  (≥ 2026-04-02 ≈ 11k markets, growing ~96/day) replays in roughly 15 min
  end-to-end when the fleet is idle

## Distributed backtesting (fleet)

Backtests are submitted to the BullMQ fleet (never run locally on the
producer). Active workers (ansible inventory):

| Machine | Chip | Backtest slots | Queues |
|---------|------|----------------|--------|
| worker-1 | Mac mini M4 | 8 | markets + aggregate |
| worker-2 | Mac mini M4 | 8 | markets |
| m1-milan | M1 | 6 | markets |

- m5-milan (12 slots) exists but is currently disabled in the inventory.
- m1-ivan (M1 Pro, 4 slots) is the PRODUCER and live-trading machine — models
  never run backtest workers on it.
- Workers self-update from origin/main and run committed code only (jobs are
  gated on the producer's commit SHA — push before submitting).

# Working rules

## Workspace (worktree)

- The agent works in its own git worktree `../polymarket-bot-pair-fable`,
  created by `protocols/pair/scripts/setup-model-worktree.sh fable <branch>
  pair-fable` (idempotent — safe to rerun). The worktree has a generated
  keyless `.env` (`DRY_RUN=true`) and `node_modules` + `data/` symlinked from
  the main checkout.
- Never run `npm install` / `npm ci` — dependencies are the human's job in
  the main checkout.
- A pre-commit hook enforces the write scopes below. Never bypass it
  (`--no-verify` is forbidden).

## Write scopes

- Your space is `protocols/pair-fable/`: `state/`, `memory/`, `tools/`, and
  `strategies/`. Strategy implementations live ONLY in
  `protocols/pair-fable/strategies/` — the registry auto-discovers them
  there fail-soft (a broken experiment logs a warning and is skipped, it
  cannot take down another protocol or the fleet). Strategy ids MUST start
  with `pair-fable-`. Validate with `npm run protocol:check -- pair-fable`
  before pushing strategy code.
- Never edit: `README.md`, `RULES.md`, `missions/` in this protocol, and
  anything under `protocols/pair/scripts/` — human-authored.
- ALL of `src/` is OFF-LIMITS — engine code is never changed by models, not
  even via a PR (the pre-commit hook enforces this). When you find an engine
  bug or want an engine improvement: record it in `state/PROPOSALS.md` with
  the exact repro and continue your work. The human reviews proposals and
  decides; you only touch engine code if the human explicitly hands you that
  fix.

## Human interface (Global Runtime)

- The loop runs under the Global Runtime; its session contract governs the
  status file, journal, inbox, and the session-result file. Follow it — the
  mission never overrides it.
- The journal is the human's progress feed: short, human-readable milestone
  entries, no raw tool output.
- Anything you want the human to decide goes in `state/PROPOSALS.md` (one
  entry: title, context, proposal, `status: proposed`). The human flips the
  status; act on `accepted`, drop `rejected`, never delete entries.

## Git discipline

- Commit messages start: `pair-fable: ...` (the protocol-name prefix from
  `protocols/README.md`).
- Save loop per unit of work: commit → `git pull --rebase origin main` →
  `git push origin HEAD:main`. (The worktree lives on a `wt/pair-fable`
  branch — a bare `git push` would publish that branch, which the fleet never
  runs; `HEAD:main` lands the commits on `origin/main`, the only branch
  workers self-update from.)
- Never force-push, never rewrite history.

# Memory system

Stateless — everything lives in files; after each step the memory system is
updated. The agent can be stopped at any time and a fresh session continues
from files alone.
