# RULES — pair-opus

The constitution. The mission may not weaken anything here.

# Dataset

- Source: `telonex` datasets only, converter `delta-typed`
  (`--input-mode telonex-delta`)
- Read mode: `--read-from local-or-download-from-r2-to-local`
- Symbol: Bitcoin (btc) — slugs `btc-updown-15m-*`
- Timeframe: 15 min
- **Protocol universe floor: ≥ 2026-04-02** (`--from-ms 1775088000000`).
  About 10,700 markets and growing ~96/day. From this floor every external
  feed (Binance spot, priceToBeat, Chainlink) is fully covered, so declaring
  a feed never shrinks the universe.

# Strategy

## What we are building

Buy BOTH sides of the same market — UP and DOWN — so that the two prices
together come to less than $1.00 including fees. A completed pair always
settles at exactly $1.00, whichever side wins, so **a pair bought under $1
cannot lose**. Example: 500 UP at 0.32 plus 500 DOWN at 0.64 is a pair at
0.96, worth $1.00 at settlement — $20 on 500 pairs.

Accumulate in increments over the 15-minute window rather than in one shot,
buying each side when it is cheap. All losses in this strategy come from
shares that never get paired.

## Rubrics

1. We only BUY. We never sell.
2. BTC 15-minute markets only.
3. Merge at most once per market (in market or after).
4. All accounting is FEE-INCLUSIVE: maker fills cost $0; every taker fill
   budgets the full 0.07·p·(1−p)/share curve (tier-0, no refunds). A pair is
   "under $1" only after fees.
5. Exits are merge and redeem only (follows from rule 1).
6. **A deliberate imbalance is allowed.** The strategy may intentionally end
   a market holding more of one side than the other, when that is a chosen
   position rather than an accident. Unpaired inventory must be sized and
   bounded on purpose; it must never be the residue of a pairing attempt that
   failed.
7. Not latency dependent: a variant must work at the measured live latency
   (~140 ms) and must not collapse as latency increases.

# Backtesting

- Never emit `merge_positions` in backtests — the simulator cannot account
  for mid-market merges. Pairs are valued at settlement, which measures the
  same edge correctly.
- Every run pins latency explicitly with `--latency-delay-ms 140
  --latency-jitter-ms 20` and carries `--protocol pair-opus --model <model>`.
  The tools do this for you.
- The maker-fill model is CONSERVATIVE: a resting order fills only when the
  book trades THROUGH its price. Live, takers also lift resting orders
  without the price moving through them, so backtests understate maker fills.
  That is the safe direction of error, but it can make a genuinely profitable
  passive variant look unprofitable.
- Canonical run (the launcher applies the pins):

  ```bash
  npx tsx protocols/pair-opus/tools/run-backtest.ts --strategy <id> --full
  ```

## Fleet

Backtests go to the BullMQ fleet, never run locally on the producer except
for smoke tests. Workers self-update from `origin/main` and run committed
code only — push before submitting. A full-universe run (~10,700 markets)
takes roughly 30–40 minutes of fleet time; an 800-market screen a couple of
minutes.

# Working rules

## Workspace

- Own git worktree `../polymarket-bot-pair-opus`, created by
  `protocols/pair/scripts/setup-model-worktree.sh opus main pair-opus`.
  Generated keyless `.env` with `DRY_RUN=true`; `node_modules` and `data/`
  symlinked from the main checkout.
- Never run `npm install` / `npm ci`.
- A pre-commit hook enforces the write scopes. Never bypass it.

## Write scopes

- Your space is `protocols/pair-opus/`: `state/`, `memory/`, `tools/`,
  `strategies/`. Strategy files live ONLY in `protocols/pair-opus/strategies/`
  and their ids MUST start with `pair-opus-`. Validate with
  `npm run protocol:check -- pair-opus` before pushing strategy code.
- Never edit `README.md`, `RULES.md`, or `missions/` — human-authored.
- All of `src/` is OFF-LIMITS. If you find an engine bug, record it in
  `state/PROPOSALS.md` with a repro and carry on; the human decides.

## Git

- Commit messages start `pair-opus: ...`.
- Per unit of work: commit → `git pull --rebase origin main` →
  `git push origin HEAD:main`. The worktree branch is never what the fleet
  runs; `HEAD:main` is.
- Never force-push, never rewrite history.

# Memory

Stateless. Everything lives in files; a fresh session continues from files
alone.
