#!/usr/bin/env bash
# Fable night shift: a greenfield, autonomous protocol-design session.
#
# Fable designs and builds its OWN strategy-research system ("Fable Protocol")
# from first principles, grounded in what the engine actually supports.
# It works on branch `fable-protocol`, writes ONLY inside `fable-lab/`
# (enforced by a worktree-scoped pre-commit hook), runs in an isolated git
# worktree so the main checkout stays free for other sessions, and resumes
# from its own state files if killed — relaunching continues the work.
#
# Usage (run from the MAIN checkout, not the worktree):
#   ./scripts/fable-night-shift.sh            # start / resume the night shift
#   MAX_RUNS=50 ./scripts/fable-night-shift.sh
#
# Overnight launch (recommended): tmux keeps it alive if the terminal closes,
# caffeinate keeps the Mac awake — tmux alone does NOT prevent system sleep:
#   tmux new -s fable
#   caffeinate -is ./scripts/fable-night-shift.sh
#   # detach: Ctrl+B then D    reattach: tmux attach -t fable
#
# The account/model used is whatever this terminal's `claude` CLI is set to;
# permission mode is passed by this script (bypassPermissions).
#
# Stop it: create fable-lab/DONE in the worktree (the session does this itself
# when the charter is fulfilled), or Ctrl+C the loop.
#
# Morning review:
#   cd ../polymarket-bot-fable && git log --oneline main..fable-protocol
#   # read fable-lab/STATE.md first, then the runbook it wrote.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1
ROOT="$(pwd)"

BRANCH="fable-protocol"
WT="${ROOT}/../polymarket-bot-fable"
LAB="fable-lab"
MAX_RUNS="${MAX_RUNS:-30}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-20}"
PERM="${PERM:-bypassPermissions}"

# ---------------------------------------------------------------- setup ----
if ! git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git branch "${BRANCH}" main
  echo "[night-shift] created branch ${BRANCH} from main"
fi

if [ ! -d "$WT" ]; then
  git worktree add "$WT" "${BRANCH}"
  echo "[night-shift] created worktree ${WT}"
fi

# Worktree-scoped hooks (shared .git/hooks would fire on the main checkout too).
git config extensions.worktreeConfig true
git -C "$WT" config --worktree core.hooksPath "${LAB}/.hooks"

mkdir -p "${WT}/${LAB}/.hooks" "${WT}/${LAB}/logs"

cat >"${WT}/${LAB}/.hooks/pre-commit" <<'HOOK'
#!/usr/bin/env bash
# Mechanical write-scope guard for the fable night shift.
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "fable-protocol" ]; then
  echo "[guard] commits allowed only on fable-protocol (on: $branch)" >&2
  exit 1
fi
bad="$(git diff --cached --name-only | grep -vE '^fable-lab/' || true)"
if [ -n "$bad" ]; then
  echo "[guard] BLOCKED — staged files outside fable-lab/:" >&2
  echo "$bad" >&2
  echo "[guard] unstage them; the night shift may write only inside fable-lab/." >&2
  exit 1
fi
exit 0
HOOK
chmod +x "${WT}/${LAB}/.hooks/pre-commit"

if [ ! -f "${WT}/${LAB}/.gitignore" ]; then
  printf 'logs/\n' >"${WT}/${LAB}/.gitignore"
fi

# Local runtime plumbing the worktree needs but git doesn't carry.
[ -e "${WT}/node_modules" ] || ln -s "${ROOT}/node_modules" "${WT}/node_modules"
[ -e "${WT}/data" ] || ln -s "${ROOT}/data" "${WT}/data"
[ -f "${WT}/.env" ] || { [ -f "${ROOT}/.env" ] && cp "${ROOT}/.env" "${WT}/.env"; }

# ---------------------------------------------------------------- charter ----
if [ ! -f "${WT}/${LAB}/CHARTER.md" ]; then
  cat >"${WT}/${LAB}/CHARTER.md" <<'CHARTER'
# Fable Protocol — Night-Shift Charter

You are Fable, working alone through the night. You have been given an empty
folder (`fable-lab/`) and one mission:

**Design and build, from first principles, YOUR OWN research system for
finding profitable trading strategies on this engine — the system you would
want, not the one that already exists.**

The existing system (`strategy-research-protocol/`) is one human-guided design.
You are explicitly NOT bound by its architecture, its stage/gate design, its
memory model, its role split, or its conclusions. Tomorrow the two systems
compete on the same engine; tonight you build yours.

## Ground truth: the engine (Phase 0 — mandatory, before any design)

Everything you design MUST be supported by the engine as it exists today. Your
first work unit is a deep engine study — read the code and docs, not just
summaries:

- `strategy-research-protocol/ENGINE.md` — the engine contract overview
- `docs/engine/*`, `docs/backtest/*`, `docs/datasets/telonex/*`
- the source itself when docs are ambiguous: `src/backtest/`, `src/trading/`,
  `src/market/`, `src/strategy/`, `src/db/`, `dashboard/src/app/api/`

Write your findings to `fable-lab/engine/CAPABILITIES.md`: what the engine
supports (order types, fill simulation model and its assumptions, fee model,
tick semantics, episode boundaries, dataset shape, DB schema, dashboard API,
worker fleet rules) and — equally important — what it does NOT support. Every
capability claim gets a file citation. Every element of your protocol design
must trace back to this document. If you cannot ground a design element in the
engine, redesign it or drop it.

You MAY read `strategy-research-protocol/tools/*.md` as documentation of the
engine's operational interfaces (how runs are submitted, how results are
stored). Do NOT import the old system's research conclusions (its LESSONS.md,
family verdicts, measured numbers) — you build your epistemology from scratch.

## What you build (your call, but it must be complete)

You decide the architecture. A complete system answers at least:

- How are strategy ideas generated, deduplicated, and prioritized?
- How is an experiment specified so that bias cannot creep in after results
  arrive? (You grade your own homework — design mechanical protection.)
- How much data buys how much belief? What are the decision points, and what
  exactly do they decide? Justify every threshold from first principles.
- What is remembered, where, and how does a fresh session with zero context
  resume and continue? (Files are the only memory that survives you.)
- How do results turn into transferable knowledge?
- What tools make the loop FAST? Build them — real, working scripts in
  `fable-lab/tools/` (results readers over MySQL/dashboard API, batch
  analyzers, submission helpers, validators). Working tools beat documented
  intentions. Use the dependencies already installed; do not add new ones.
- What would the morning operator do, step by step, to start driving research
  with your system? Write that runbook.

## Hard constraints (mechanically enforced where possible)

1. Write ONLY inside `fable-lab/` (pre-commit hook enforces this; never bypass
   it, never use `--no-verify`).
2. Stay on branch `fable-protocol`. Never merge to or touch `main`.
3. NO evidence backtests tonight. Tokens go to thinking and building, not to
   waiting on replays. The ONLY execution allowed: validating that a tool you
   built actually works — type-checks, read-only DB/API queries, and at most a
   ≤10-market `--sequential` smoke to prove plumbing. A smoke is NEVER
   evidence; record no EV conclusions from it. No worker-fleet submissions
   (workers run `origin/main` code only — your branch cannot use them).
4. No live trading, no order placement of any kind, no touching
   `strategy-research-protocol/` or `src/strategies/research/`.
5. Commit after EVERY completed unit of work (the hook checks scope), and push
   the branch (`git push -u origin fable-protocol`) so nothing is lost.

## Resumability contract (you may be killed at any moment)

- Keep `fable-lab/STATE.md` current: what is done, what is in progress, what
  is next — updated as part of every commit, not at the end.
- Keep `fable-lab/ROADMAP.md`: the ordered plan of work units, checked off.
- A fresh session with no memory of you must be able to read CHARTER.md +
  STATE.md + ROADMAP.md and continue within minutes. Assume it will happen.
- When (and only when) the charter is fulfilled — engine study done, system
  designed and documented, tools built and validated, runbook written, a final
  self-review pass done — create the file `fable-lab/DONE` and stop.

## Working style

Work in self-contained units (think → write files → validate → commit → update
STATE.md). Prefer finishing one thing over starting three. When you face a
design fork, decide, and record the rejected option and why in
`fable-lab/DECISIONS.md` — your morning reader needs your reasoning, not just
your conclusions. Never ask questions; there is nobody here. It is your lab.
CHARTER

  git -C "$WT" add "${LAB}/CHARTER.md" "${LAB}/.gitignore" "${LAB}/.hooks/pre-commit"
  git -C "$WT" commit -m "fable-lab: night-shift charter + write-scope guard" >/dev/null
  git -C "$WT" push -u origin "${BRANCH}" 2>/dev/null || echo "[night-shift] push failed (offline?) — continuing, session will retry"
  echo "[night-shift] charter committed"
fi

# ------------------------------------------------------------------ loop ----
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1

INSTRUCTION="Read fable-lab/CHARTER.md and execute it. You are in an isolated \
git worktree on branch fable-protocol; the repo root is your working \
directory. If fable-lab/STATE.md exists, resume from it instead of starting \
over. Work continuously and autonomously; never ask questions; commit and \
push after every unit of work; stop only when fable-lab/DONE is warranted."

run=0
while [ "$run" -lt "$MAX_RUNS" ]; do
  if [ -f "${WT}/${LAB}/DONE" ]; then
    echo "[night-shift] DONE marker found — charter fulfilled. Stopping."
    break
  fi
  run=$((run + 1))
  LOG="${WT}/${LAB}/logs/night-$(date +%Y%m%d-%H%M%S).jsonl"
  echo "[night-shift] run ${run}/${MAX_RUNS} — log: ${LOG}"

  (
    cd "$WT" || exit 1
    claude -p --permission-mode "$PERM" --output-format stream-json --verbose "$INSTRUCTION" \
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

  [ -f "${WT}/${LAB}/DONE" ] && { echo "[night-shift] DONE — stopping."; break; }
  echo "[night-shift] relaunching in ${SLEEP_BETWEEN}s (Ctrl+C to stop)"
  sleep "$SLEEP_BETWEEN"
done

echo "[night-shift] finished after ${run} run(s). Review: cd ${WT} && git log --oneline main..${BRANCH}"
