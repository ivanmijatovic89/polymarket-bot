#!/usr/bin/env bash
# Gabagool knowledge shift: an autonomous research loop that builds the
# definitive knowledge base about ONE strategy concept — the "gabagool"
# two-sided accumulation strategy on Polymarket crypto up/down markets.
#
# It does NOT write strategy code and does NOT run evidence backtests.
# It reads, measures, verifies, and synthesizes — so that the Strategy
# Research Protocol lab can attack the concept with maximal priors.
#
# Pattern: clone of scripts/fable-night-shift.sh (proven over 69 sessions).
# Works on branch `gabagool-knowledge`, writes ONLY inside `research/gabagool/`
# (enforced by a worktree-scoped pre-commit hook), runs in an isolated git
# worktree so the main checkout stays free for other sessions, and resumes
# from its own state files if killed — relaunching continues the work.
#
# Usage (run from the MAIN checkout, not the worktree):
#   ./gabagool-knowledge-and-lab/gabagool-knowledge-shift.sh            # start / resume
#   MAX_RUNS=10 ./gabagool-knowledge-and-lab/gabagool-knowledge-shift.sh
#   MODEL=fable ./gabagool-knowledge-and-lab/gabagool-knowledge-shift.sh   # pin the model
#
# Account: the loop uses whatever `claude` profile this shell has. Pass
# CLAUDE_CONFIG_DIR to choose the account per launch, e.g.:
#   CLAUDE_CONFIG_DIR=$HOME/.claude-balsa MODEL=fable ./gabagool-knowledge-and-lab/gabagool-knowledge-shift.sh
#
# MAX_RUNS is the BUDGET knob. Overnight launch (recommended):
#   tmux new -s gaba
#   caffeinate -is ./gabagool-knowledge-and-lab/gabagool-knowledge-shift.sh
#   # detach: Ctrl+B then D    reattach: tmux attach -t gaba
#
# Stop it: touch ../polymarket-bot-gabagool/research/gabagool/DONE
# (operator kill-switch, checked before each relaunch) or Ctrl+C the loop.
# Sessions MAY create DONE themselves, but only at knowledge saturation
# (defined in the charter), never because a session feels "done enough".
#
# Rate-limit resilience: a run that ends in under MIN_RUN_SECS is treated as
# a failed launch (out of tokens, API error) — the loop backs off FAIL_SLEEP
# seconds instead of hammering, so it survives token-exhaustion windows and
# resumes automatically when the weekly limit resets.
#
# Morning review:
#   cd ../polymarket-bot-gabagool && git log --oneline main..gabagool-knowledge
#   # read research/gabagool/STATE.md, then STRATEGY-BRIEF.md / HYPOTHESES.md
#   tail -f ../polymarket-bot-gabagool/research/gabagool/JOURNAL.md   # live
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1
ROOT="$(pwd)"

BRANCH="gabagool-knowledge"
WT="${ROOT}/../polymarket-bot-gabagool"
LAB="research/gabagool"
MAX_RUNS="${MAX_RUNS:-40}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-20}"
MIN_RUN_SECS="${MIN_RUN_SECS:-120}"
FAIL_SLEEP="${FAIL_SLEEP:-900}"
PERM="${PERM:-bypassPermissions}"
MODEL="${MODEL:-}"

# ---------------------------------------------------------------- setup ----
git fetch origin main --quiet 2>/dev/null || echo "[gaba-shift] fetch failed (offline?) — using local refs"

if ! git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  BASE="main"
  git show-ref --verify --quiet "refs/remotes/origin/main" && BASE="origin/main"
  git branch "${BRANCH}" "${BASE}"
  echo "[gaba-shift] created branch ${BRANCH} from ${BASE}"
fi

if [ ! -d "$WT" ]; then
  git worktree add "$WT" "${BRANCH}"
  echo "[gaba-shift] created worktree ${WT}"
fi

# Worktree-scoped hooks (shared .git/hooks would fire on the main checkout too).
git config extensions.worktreeConfig true
git -C "$WT" config --worktree core.hooksPath "${LAB}/.hooks"

mkdir -p "${WT}/${LAB}/.hooks" "${WT}/${LAB}/logs"

cat >"${WT}/${LAB}/.hooks/pre-commit" <<'HOOK'
#!/usr/bin/env bash
# Mechanical write-scope guard for the gabagool knowledge shift.
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "gabagool-knowledge" ]; then
  echo "[guard] commits allowed only on gabagool-knowledge (on: $branch)" >&2
  exit 1
fi
bad="$(git diff --cached --name-only | grep -vE '^research/gabagool/' || true)"
if [ -n "$bad" ]; then
  echo "[guard] BLOCKED — staged files outside research/gabagool/:" >&2
  echo "$bad" >&2
  echo "[guard] unstage them; this shift may write only inside research/gabagool/." >&2
  exit 1
fi
exit 0
HOOK
chmod +x "${WT}/${LAB}/.hooks/pre-commit"

if [ ! -f "${WT}/${LAB}/.gitignore" ]; then
  printf 'logs/\ndata/\ntmp/\n' >"${WT}/${LAB}/.gitignore"
fi

# Local runtime plumbing the worktree needs but git doesn't carry.
[ -e "${WT}/node_modules" ] || ln -s "${ROOT}/node_modules" "${WT}/node_modules"
[ -e "${WT}/data" ] || ln -s "${ROOT}/data" "${WT}/data"
[ -f "${WT}/.env" ] || { [ -f "${ROOT}/.env" ] && cp "${ROOT}/.env" "${WT}/.env"; }

# ---------------------------------------------------------------- charter ----
if [ ! -f "${WT}/${LAB}/CHARTER.md" ]; then
  cat >"${WT}/${LAB}/CHARTER.md" <<'CHARTER'
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
`gabagool-knowledge-and-lab/INVESTIGATION.md` — it is your starting prior,
not gospel (it corrected itself several times; extend and re-verify it).

You produce knowledge, measurements, and testable hypotheses — NOT strategy
code, NOT evidence backtests, NOT a new research protocol. The lab that
consumes your output already exists (`strategy-research-protocol/`).

## Phase 0 — required reading (first unit, before anything else)

1. `gabagool-knowledge-and-lab/INVESTIGATION.md` — the prior investigation.
2. `gabagool-knowledge-and-lab/MISSION.md` + `gabagool-knowledge-and-lab/PLAYBOOK.md`
   — the goal ladder and the games
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
CHARTER

  git -C "$WT" add "${LAB}/CHARTER.md" "${LAB}/.gitignore" "${LAB}/.hooks/pre-commit"
  git -C "$WT" commit -m "gabagool-knowledge: shift charter + write-scope guard" >/dev/null
  git -C "$WT" push -u origin "${BRANCH}" 2>/dev/null || echo "[gaba-shift] push failed (offline?) — continuing, session will retry"
  echo "[gaba-shift] charter committed"
fi

# ------------------------------------------------------------------ loop ----
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

INSTRUCTION="Read research/gabagool/CHARTER.md and execute it. You are in an \
isolated git worktree on branch gabagool-knowledge; the repo root is your \
working directory. Resume from research/gabagool/STATE.md (if it does not \
exist yet, this is the first session: create it, then start Phase 0). Work \
continuously and autonomously; never ask questions; commit and push after \
every unit of work. Create research/gabagool/DONE only at knowledge \
saturation as the charter defines it; otherwise, when your session naturally \
ends, the loop relaunches a successor that continues from your files."

MODEL_ARGS=()
[ -n "$MODEL" ] && MODEL_ARGS=(--model "$MODEL")

# Operator kill-switch OUTSIDE the agent's write scope (a session once
# deleted the in-folder DONE as "stray"): touch this file to stop the loop
# after the current session; remove it before relaunching.
STOP_FILE="${ROOT}/logs/gabagool-knowledge.STOP"

run=0
while [ "$run" -lt "$MAX_RUNS" ]; do
  if [ -f "${WT}/${LAB}/DONE" ] || [ -f "$STOP_FILE" ]; then
    echo "[gaba-shift] stop marker found (DONE or ${STOP_FILE}) — stopping."
    break
  fi
  run=$((run + 1))
  LOG="${WT}/${LAB}/logs/shift-$(date +%Y%m%d-%H%M%S).jsonl"
  echo "[gaba-shift] run ${run}/${MAX_RUNS} — log: ${LOG}"
  RUN_STARTED=$(date +%s)

  (
    cd "$WT" || exit 1
    claude -p --permission-mode "$PERM" --output-format stream-json --verbose "${MODEL_ARGS[@]}" "$INSTRUCTION" \
      2>>"$LOG" \
      | tee -a "$LOG" \
      | jq -Rj '
          (try fromjson catch null) as $e
          | if $e == null then empty
            elif $e.type=="assistant" then
              ( $e.message.content[]?
                | if   .type=="text"     then .text
                  elif .type=="tool_use" then "\n[36m▶ " + .name + "[0m " + ((.input|tostring)[0:200]) + "\n"
                  else empty end )
            elif $e.type=="user" then
              ( $e.message.content[]?
                | if .type=="tool_result"
                  then "[90m  ↳ " + (((.content // "") | if type=="array" then (.[0].text // "") else tostring end)[0:200]) + "[0m\n"
                  else empty end )
            else empty end
        '
  )

  echo
  echo "=== run ${run} cost / tokens ==="
  grep '"type":"result"' "$LOG" | tail -1 | jq '{
    cost_usd:      .total_cost_usd,
    input_tokens:  .usage.input_tokens,
    output_tokens: .usage.output_tokens,
    cache_read:    .usage.cache_read_input_tokens,
    turns:         .num_turns,
    duration_s:    (.duration_ms/1000)
  }' 2>/dev/null || echo "(no result line — session may have been killed)"
  RUN_COST=$(grep '"type":"result"' "$LOG" | tail -1 | jq -r '.total_cost_usd // 0' 2>/dev/null || echo 0)
  TOTAL_COST=$(echo "${TOTAL_COST:-0} + ${RUN_COST:-0}" | bc)

  { [ -f "${WT}/${LAB}/DONE" ] || [ -f "$STOP_FILE" ]; } && { echo "[gaba-shift] stop marker — stopping."; break; }

  RUN_SECS=$(( $(date +%s) - RUN_STARTED ))
  if [ "$RUN_SECS" -lt "$MIN_RUN_SECS" ]; then
    echo "[gaba-shift] run lasted only ${RUN_SECS}s — likely rate limit / launch failure; backing off ${FAIL_SLEEP}s"
    sleep "$FAIL_SLEEP"
  else
    echo "[gaba-shift] relaunching in ${SLEEP_BETWEEN}s (Ctrl+C to stop)"
    sleep "$SLEEP_BETWEEN"
  fi
done

echo "[gaba-shift] finished after ${run} run(s) — total cost this invocation: \$${TOTAL_COST:-0} (API-equivalent)"
echo "[gaba-shift] review: cd ${WT} && git log --oneline main..${BRANCH}"
