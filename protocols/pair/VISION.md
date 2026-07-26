# Pair — vision (v4, agreed design)

> Status: DESIGN AGREED — next: MISSION.md (needs the human's precise strategy
> definition), seat safety kit, then Fable solo launch. Red-teamed by three
> independent reviews (architecture, ops, methodology) on 2026-07-26.

## Goal

Make **one strategy** profitable on **BTC 15m**, run it live, earn real money —
then keep improving it forever. The human defines the strategy and the
invariants and gates every money step; the models do everything else.

## The strategy (fixed by the human)

Buy both sides — UP and DOWN — when the combined price is below $1; pairs are
worth $1 at settlement. Structural/microstructure edge, not predictive. Precise
definition lives in `MISSION.md`.

**Backtest rule (hard):** experiments must NOT emit `merge_positions` — the
simulator cannot account for mid-episode merges (verified 2026-07-26: full
merge scores $0, partial merge scores negative on a profitable trade). Pairs
are valued at settlement, which the simulator does correctly. Live merge
mechanics (MINED wait, gas, capital recycling) are execution details measured
by the live probe, not by backtests. The eval marks merge-containing runs
invalid.

## Structure

```
protocols/pair/
  MISSION.md              # the one human-authored doc: strategy, invariants,
                          #   eval command, rules. Only the human edits it.
  commons/
    knowledge/<id>/       # one DIRECTORY per finding — append-only:
      claim.md            #   written once by the discoverer (claim + repro:
                          #   exact backtest command + DB run id + model)
      evidence-<seat>-N.md#   added by others; status is DERIVED from evidence
                          #   files, never hand-edited
    bugs/<id>/            # same scheme
    tools/                # starts empty; a seat promotes a tool here when
                          #   it's useful to others
  models/
    fable/                # one folder per SEAT (model line, stable across
      STATUS.md           #   versions: fable/ survives Fable 5 → 5.5)
      INBOX.md            # human → seat channel; ack required at unit start
      JOURNAL / tools/    # the seat designs its own record-keeping
      strategies/         # ids pair-fable-* (registry-discovered)
    gpt/                  # same shape (Codex harness, AGENTS.md boot)
```

Seat = whatever runs concurrently, named by model line. Exact model version is
metadata: stamped on every commit (`pair: [opus-4.8] u42 ...`) and already in
`backtest_runs`.

## Roles (quota reality, not aspiration)

- **fable** — the main 24/7 worker (Claude Code, $200 Max). "24/7" honestly
  means: dark when quota windows reset.
- **gpt** — daily **verifier/reviewer** (Codex, $20 ≈ a few hours/day): audits
  the champion, replicates findings, disputes entries. Not a 24/7 peer.
- **opus** — tactical seat, scheduled sessions only (shares Fable's budget).
- **Advisors** (Perplexity/Grok/…): a worker may consult them; suggestions
  enter the commons as `unverified`.

## Knowledge rules

Confirmation is natural, never bureaucratic: (1) **independent
double-discovery** — same finding found in a seat's own work → add evidence
file → confirmed; (2) **verify-on-dependence** — before building a decision on
an entry, re-run its repro. But a deterministic re-run proves determinism, not
truth: real confirmation of execution-realism claims needs a **different
method** (latency sweep, different data path). Verifier duty is adversarial —
refutations are wins; a refutation rate near zero means verification is
decorative. Engine facts belong in `docs/` (canonical, outlives protocols);
the commons holds only strategy-specific knowledge.

## Eval & promotion (mechanical, not prose)

- Seats **nominate** a strategy id; the **neutral eval tool** launches the
  runs itself (fixed slug set, pinned latency env) — self-reported numbers
  don't exist; the leaderboard derives from DB run ids.
- **Holdout embargo enforced in the eligibility layer**, not in rules text.
- **Walk-forward promotion**: ~96 new BTC 15m markets arrive per day; a
  champion must stay positive on markets that started AFTER its code was
  frozen. Kills the winner's curse for free.
- **Latency honesty**: the standard eval includes an edge-vs-latency sweep —
  a structural edge decays smoothly; a stale-book artifact cliffs.
- Champion lineage: every experiment declares its parent variant; each seat's
  STATUS.md names its current champion (strategy id + eval run id).

## Mission control

- Per-seat `STATUS.md` (5 lines); heartbeat = the file's **last-commit time**
  (git does not preserve mtimes).
- `INBOX.md` steering with mandatory ack; `touch DONE` for graceful stop.
- **External watchdog** (launchd, outside the agent loop): stale heartbeat /
  dead tmux / low disk → push notification to the phone. Non-negotiable — the
  previous generation of shifts died silently and unnoticed for a week.
- Drift self-check: every N units the seat re-reads MISSION and journals a
  short "still on course?" note.
- Phase 2: a page in the existing dashboard (:3051) reading the DB + status
  files.

## Safety kit (mechanical invariants)

All guard scripts live OUTSIDE `protocols/` (in `scripts/`), so seats cannot
edit their own guardrails — anything under `protocols/**` is seat-writable by
design.

1. Launcher **generates** a minimal seat `.env`: `DRY_RUN=true` hardcoded, no
   private/relayer/API keys, scoped DB user. Never copies the root `.env`.
2. Per-worktree `npm ci` — no `node_modules` symlink shared with the live
   checkout.
3. Worktree **pre-commit scope hook**: a seat can only commit
   `models/<seat>/` + `commons/`; never MISSION.md, never `src/`; secret-scan
   included. Save loop stages explicit paths, never `git add .`.
4. Hardened save loop (wedged rebase → abort + recover, not retry forever);
   **main is revert-only** once seats run — no history rewrites.
5. Live bots never load protocol strategies (discovery kill-switch env).
6. Seats submit backtests to the fleet only — never local workers on the
   live-trading machine. Per-seat daily market budget; human runs keep queue
   priority.
7. Repo goes **private** before launch (a public repo leaks the champion's
   parameters to competitors; a leaked secret is irrevocable).

## Phases

P0 — MISSION.md + safety kit + seeded commons entry documenting the
merge-accounting hole. P1 — **Fable solo**, battle-tests everything.
P1.5 — **micro live probe** (~$50, one pair at a time, ~a week): measures
whether sub-$1 pairs are actually capturable against live competition — the
one question no backtest volume or model consensus can answer — and calibrates
the simulator against reality. P2 — + gpt verifier seat. P3 — more seats only
if P2 proves value.

## End goal

Honest, calibrated backtest profit → DRY_RUN live → small real size → scale.
Champion changes only via walk-forward eval + human approval.
