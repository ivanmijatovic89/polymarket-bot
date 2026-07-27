# Pair — vision (v6, final)

> Status: DESIGN FINAL. Red-teamed by three independent reviews (architecture,
> ops, methodology) on 2026-07-26.
>
> **CURRENT PHASE: P0 — definition** (update this line as phases advance)
>
> - [ ] P0 — the human defines MISSION.md (strategy + constitution) + safety kit
> - [ ] P1 — expedition: Fable explores + proposes the team system, GPT reviews
> - [ ] P2 — research, both agents, 24/7
> - [ ] P2.5 — micro live probe (~$50)
> - [ ] P3 — more models, only if earned

## Goal

Make **one strategy** profitable on **BTC 15m**, run it live, earn real money —
then keep improving it forever. The human defines the strategy and the
constitution and gates every money step; the AI does everything else —
including designing how the team works.

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

## Layer 1 — The constitution (human law, in MISSION.md, never violated)

1. **Scope**: this strategy, BTC 15m, until profitable → live → scale.
2. **Honesty**: every claim carries its exact repro (backtest command + DB run
   id). The neutral eval tool launches all scoring runs itself (fixed slug
   set, pinned latency env) — self-reported numbers don't exist. Holdout
   embargo enforced in the eligibility layer. **Walk-forward promotion**: a
   champion must stay positive on markets that started after its code froze
   (~96 new markets/day make this free). Standard eval includes an
   edge-vs-latency sweep. Strategy variants are **forked, never edited**.
3. **Write scopes**: `models/<name>/` is that agent's only private space
   (STATUS.md, INBOX.md, scratch); everything else in `protocols/pair/` is
   shared; MISSION.md is human-only; `src/` changes go through a normal PR.
4. **Sharing obligation**: anything you learn or build that another agent
   could use goes in the shared space, not in your corner. One home, one
   memory.
5. **Human interface**: keep `STATUS.md` current (heartbeat = its last-commit
   time); acknowledge `INBOX.md` at unit start; stop gracefully on
   `models/<name>/DONE`.
6. **Registry fixed points**: runnable strategies live in `strategies/`, ids
   start with `pair-`.
7. **Safety kit** (mechanical, in `protocols/pair/scripts/` — a directory the
   pre-commit hook itself protects, so agents cannot edit their guardrails):
   generated keyless `.env` with `DRY_RUN=true` hardcoded; `node_modules` +
   `data/` symlinked from the main checkout (agents never run
   `npm install`/`ci`); pre-commit scope hook + secret scan; hardened save
   loop; main is revert-only; backtests go to the fleet only, per-agent daily
   budget, human keeps queue priority; repo private before launch.

## Layer 2 — The team's own system (designed by the models, not by us)

How work is divided, how experiments are recorded, how knowledge is formatted,
what tools exist — **the team designs this itself**, the way earlier protocols
did their best work. The bootstrap is a relay:

- **Expedition (first Fable session(s))**: explore the engine hands-on, write
  `ENGINE.md` from scratch (AI-format digest of what this protocol needs,
  citing docs/ and source — no inherited material), build the first tools,
  and **propose the team's working conventions** in a team-owned document.
- **Review (first GPT session)**: read, verify, amend or dispute the
  conventions. From then on they belong to the team, versioned in the folder,
  changed whenever the team finds better — constitution permitting.

### Starting proposal (the team may adopt, reshape, or replace it — documenting why)

A pull-queue system that fits the constitution and two-agent concurrency:
`tasks/` (one file per task; agents add follow-ups each session, the human
adds via INBOX or directly; claim by marker; nobody must claim what they
don't understand), `experiments/` (one append-only file per experiment:
hypothesis, parent variant, run ids, verdict, model), `knowledge/` (flat
distilled findings, including negative results), `tools/`, and one strategy
lineage in `strategies/`. Isolation per piece of work — one writer per file —
keeps the push-to-main loop conflict-free.

## Roles

**Every model researches.** Both hunt for what makes the strategy better;
experiments carry their author's name, so it stays visible who finds what.
Verification is a task type, not somebody's job — and it is adversarial:
refutations are wins; a deterministic re-run proves determinism, not truth,
so real verification uses a different method (latency sweep, different data
path).

- **fable** — Claude Code ($200 Max): near-24/7 (honestly: dark when quota
  windows reset).
- **gpt** — Codex ($20 ≈ hours/day): same rights, from day one.
- **opus** — tactical sessions (shares Fable's budget).
- **Advisors** (Perplexity/Grok/…): consulted for ideas; suggestions enter
  the shared space as unverified leads.

A weak model cannot damage the lineage: variants are never edited, only
forked — a bad variant is a new file that loses in eval.

## Mission control

- Per-agent `STATUS.md`; heartbeat = last-commit time.
- `INBOX.md` steering with mandatory ack; `touch models/<a>/DONE` to stop.
- The human checks liveness manually for now (STATUS.md commit times); an
  external watchdog gets built when the need is real.
- Drift self-check: every N units re-read MISSION, note "still on course?".

## Phases

**P0 (human + assistant)**: MISSION.md — strategy definition + the
constitution above — plus the safety kit and a seeded knowledge note on the
merge-accounting hole. **P1 (expedition)**: Fable explores, writes ENGINE.md,
builds tools, proposes the team system; GPT reviews and joins. **P2
(research)**: both agents on the shared work, full speed. **P2.5 (micro live
probe)**: ~$50, one pair at a time, ~a week — measures whether sub-$1 pairs
are actually capturable against live competition, the one question no
backtest can answer, and calibrates the simulator. **P3**: more models only
if they earn their place.

## End goal

Honest, calibrated backtest profit → DRY_RUN live → small real size → scale.
Champion changes only via walk-forward eval + human approval.
