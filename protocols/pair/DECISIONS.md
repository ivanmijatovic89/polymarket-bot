# Pair — settled decisions

Working log of decisions made during the design phase (2026-07-26/27), for ANY
session — Claude, Codex/GPT, or human — picking this up. Each of these
survived multiple rounds of debate: do not reopen without new evidence.
Canonical design: `VISION.md` (v6). Everything lives on PR #159
(`feat/protocols-workspace`) until the human merges it.

## Decisions

1. **Order of work**: P0 human defines MISSION (strategy + constitution) →
   P1 expedition (Fable explores the engine, writes ENGINE.md, proposes the
   team's working system; GPT reviews/amends) → P2 research 24/7, both
   models → P2.5 micro live probe (~$50) → P3 more models only if earned.
   Phase tracker checklist sits at the top of VISION.md.
2. **One team, one backlog** — no per-model competition, no per-model
   knowledge silos. Models are interchangeable workers; attribution is
   metadata (commit stamps + `backtest_runs` columns). Isolation is per work
   item: variants are forked, never edited. **Both models research as
   equals** — the human explicitly rejected a GPT-as-verifier-only role;
   verification is a task type anyone picks up.
3. **The team designs its own system in P1.** The tasks/experiments/knowledge
   pull-queue sketch in VISION is a *starting proposal* the team may adopt,
   reshape, or replace (documenting why). The human strongly prefers minimal
   prescription — constitution fixed, methodology free.
4. **No `merge_positions` in backtests (hard rule).** Verified 2026-07-26 on
   current main: the simulator mis-accounts mid-episode merges (full merge →
   $0, partial merge → negative on a profitable trade). Settlement values
   pairs at $1 correctly, so hold-to-settlement is the honest measure. The
   human chose this rule INSTEAD of fixing the simulator. Live merge
   mechanics (MINED wait, gas, capital recycling) are measured by the live
   probe.
5. **Guardrails live outside `protocols/`** (in `scripts/`): everything under
   `protocols/**` is agent-writable via the direct-push-to-main policy, so a
   guard placed here could be edited by the agents it guards.
   `protocol:check` stays in `scripts/` for exactly this reason.
6. **Engine truth lives in `docs/`; this protocol keeps an `ENGINE.md`
   digest** (AI-format, cites docs/source, never forks them). Generic
   discoveries get upstreamed to docs. Seed material:
   `fable-lab/engine/CAPABILITIES.md` (branch `fable-protocol`, dated Jul 11,
   partially stale — verify-then-write).
7. **Old protocols are NOT migrated** (strategy-research-protocol, gabagool,
   fable stay where they are). Their reusable value: engine audit (above) and
   tools as port-on-demand raw material.
8. **Safety kit before launch** (from a three-review red-team on 2026-07-26):
   - launcher GENERATES a keyless agent `.env` with `DRY_RUN=true` hardcoded
     (the old shift scripts copied the root `.env` containing real keys and
     `DRY_RUN=false` — never repeat that);
   - per-worktree `npm ci` (no `node_modules` symlink shared with the live
     checkout);
   - pre-commit scope hook + secret scan; save loop stages explicit paths,
     handles wedged rebases (abort + recover); main is revert-only;
   - external launchd watchdog with phone push — the previous shift
     generation died silently ~Jul 17-18 and went unnoticed for a week;
   - live bots never load protocol strategies (discovery kill-switch);
   - backtests go to the fleet only; per-agent daily budget; human keeps
     queue priority;
   - repo flips to **private** before launch (currently public).
9. **Registry support already shipped** on the same branch: discovery of
   `protocols/*/strategies/` and `protocols/*/models/*/strategies/`
   (fail-soft, folder-owned ids, deterministic collision resolution; 12 tests
   in `src/strategy/protocolStrategyDiscovery.test.ts`). Per-protocol check:
   `npm run protocol:check -- pair`.

## Still open (as of 2026-07-27)

- MISSION.md — needs the human's strategy definition (pair threshold,
  maker/taker, unpaired-leg handling, sizing, numeric meaning of
  "profitable") + the constitution written out.
- Safety kit scripts (item 8) — not yet built.
- Repo → private — human's action.
- PR #159 merge — human's call.
