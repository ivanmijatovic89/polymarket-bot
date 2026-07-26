# Pair — vision (v5, final design)

> Status: DESIGN FINAL. Next: MISSION.md (needs the human's precise strategy
> definition) + safety kit, then both agents launch. Red-teamed by three
> independent reviews (architecture, ops, methodology) on 2026-07-26.

## Goal

Make **one strategy** profitable on **BTC 15m**, run it live, earn real money —
then keep improving it forever. The human defines the strategy and the
invariants and gates every money step; the AI does everything else.

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

## The model: one team, one backlog, interchangeable workers

There is no per-model competition and no per-model knowledge silo. Models
(Fable via Claude Code, GPT via Codex, later others) are **interchangeable
labor with different capability profiles**, all working ONE backlog toward ONE
strategy lineage. Attribution is metadata: every commit, experiment, and
`backtest_runs` row records which model did the work.

Isolation is **per piece of work, not per model**: one writer per task file,
per experiment file, per variant file. Two agents never edit the same file by
construction — that is what keeps the continuous push-to-main loop
conflict-free.

## Structure

```
protocols/pair/
  MISSION.md            # human-authored: strategy, invariants, eval command,
                        #   rules, role profiles. Only the human edits it.
  ENGINE.md             # AI-format digest: what THIS protocol needs to know
                        #   about the engine, citing docs/ and source. Docs
                        #   stay canonical; generic discoveries get upstreamed;
                        #   the digest cites, never forks.
  tasks/                # THE shared backlog — one file per task. Sources:
                        #   (1) agents themselves — every session writes down
                        #   the follow-up ideas its work generated (main
                        #   source; research makes more questions than
                        #   answers), (2) the human (directly or via INBOX),
                        #   (3) the P0 seed batch from the MISSION talk.
                        #   Claim = write a claim marker; done tasks point at
                        #   their experiment verdict. An agent with nothing
                        #   claimable generates hypotheses from knowledge/ +
                        #   the champion's weak spots.
  experiments/<id>.md   # one file per experiment: hypothesis, parent variant,
                        #   exact run command + DB run ids, verdict, model.
                        #   Append-only; written by whoever claimed the task.
  strategies/           # ONE shared lineage: pair-e001.ts, pair-e002.ts, ...
                        #   HARD RULE: never edit an existing variant — fork it
                        #   into a new id. Lineage is the history.
  knowledge/            # flat files: distilled durable findings, INCLUDING
                        #   negative results ("tried X, doesn't work, run id").
  bugs/                 # flat files: suspected engine/data bugs + repro.
  tools/                # shared tools; a model promotes a tool here when it's
                        #   useful to others.
  agents/
    fable/              # THIN: STATUS.md, INBOX.md, scratch notes. Nothing
    gpt/                #   else lives here — no strategies, no knowledge.
```

## The working loop (any agent, any session)

1. Boot: read MISSION.md + ENGINE.md + own INBOX.md (ack anything new).
2. Look at `tasks/`, claim the next task matching your profile.
3. Fork the relevant variant into a new strategy id; submit backtests to the
   fleet; never run local workers on the live machine.
4. Write `experiments/<id>.md` with run ids and an honest verdict; mark the
   task done; distill any durable lesson (wins AND failures) into
   `knowledge/`; add follow-up tasks that emerged.
5. Update own `STATUS.md` (5 lines: alive-at, current work, champion id +
   eval run id, last lesson); commit → pull --rebase → push (hardened loop).

Duplicated work is structurally impossible (claimed is claimed); a fresh agent
months from now catches up by reading `knowledge/` + the champion's lineage,
never by replaying journals.

## Roles (quota reality)

**Every model researches.** Nobody is locked to a role — both hunt for what
makes the strategy better, and the experiments they author carry their name,
so it stays visible who finds what. Verification is a TASK TYPE on the shared
backlog, not somebody's job; MISSION sets a minimum mix (the backlog must not
starve verification/replication tasks) and any agent can pick them up.

- **fable** — Claude Code ($200 Max): near-24/7 (honestly: dark when quota
  windows reset).
- **gpt** — Codex ($20 ≈ hours/day): same backlog, same rights, from day one.
- **opus** — tactical sessions (shares Fable's budget), when a third opinion
  is worth the tokens.
- **Advisors** (Perplexity/Grok/…): consulted for ideas; suggestions enter
  `tasks/` or `knowledge/` as unverified leads.

A weak model cannot damage the lineage: variants are never edited, only
forked — a bad variant is a new file that loses in eval.

## Eval & promotion (mechanical, not prose)

- Agents **nominate** a variant; the **neutral eval tool** launches the runs
  itself (fixed slug set, pinned latency env) — self-reported numbers don't
  exist; results derive from DB run ids.
- **Holdout embargo enforced in the eligibility layer**, not in rules text.
- **Walk-forward promotion**: ~96 new BTC 15m markets arrive per day; a
  champion must stay positive on markets that started AFTER its code was
  frozen.
- **Latency honesty**: the standard eval includes an edge-vs-latency sweep —
  a structural edge decays smoothly; a stale-book artifact cliffs.
- Verification tasks are adversarial — refutations are wins; re-running a
  deterministic repro proves determinism, not truth, so real verification
  uses a different method (latency sweep, different data path).

## Mission control

- Per-agent `STATUS.md`; heartbeat = the file's **last-commit time**.
- `INBOX.md` steering with mandatory ack; `touch agents/<a>/DONE` to stop.
- **External watchdog** (launchd, outside the agent loop): stale heartbeat /
  dead tmux / low disk → push notification. Non-negotiable — the previous
  generation of shifts died silently and went unnoticed for a week.
- Drift self-check: every N units re-read MISSION, journal a "still on
  course?" note.

## Safety kit (mechanical invariants)

Guard scripts live OUTSIDE `protocols/` (in `scripts/`) — anything under
`protocols/**` is agent-writable by design, and agents must not be able to
edit their own guardrails.

1. Launcher **generates** a minimal agent `.env`: `DRY_RUN=true` hardcoded, no
   private/relayer/API keys, scoped DB user. Never copies the root `.env`.
2. Per-worktree `npm ci` — no `node_modules` symlink shared with the live
   checkout.
3. Worktree **pre-commit scope hook**: agents commit only inside
   `protocols/pair/` (never MISSION.md, never `src/`); secret-scan included;
   explicit path staging, never `git add .` from repo root.
4. Hardened save loop (wedged rebase → abort + recover, not retry forever);
   **main is revert-only** once agents run.
5. Live bots never load protocol strategies (discovery kill-switch env).
6. Backtests go to the fleet only; per-agent daily market budget; human runs
   keep queue priority.
7. Repo goes **private** before launch.

## Phases

P0 — MISSION.md + ENGINE.md (seeded from fable-lab's CAPABILITIES.md,
verify-then-write) + safety kit + seeded knowledge entry on the
merge-accounting hole. P1 — **both agents from day one, both researching**
on the shared backlog. P1.5 — **micro live probe**
(~$50, one pair at a time, ~a week): measures whether sub-$1 pairs are
actually capturable against live competition and calibrates the simulator.
P2 — more models only if they earn their place.

## Evolution clause

The system above is the **starting operating system**, deliberately
prescriptive so the team learns the human's intent by working inside it. Once
it runs smoothly, agents may propose changes to the process itself (as tasks
tagged `process`), with reasoning and evidence from lived units. Process
changes take effect only when the human folds them into MISSION/VISION —
self-governance is earned, not assumed.

## End goal

Honest, calibrated backtest profit → DRY_RUN live → small real size → scale.
Champion changes only via walk-forward eval + human approval.
