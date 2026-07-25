# Protocol workspaces

A **protocol** is a long-running autonomous research effort (an AI shift or a
series of sessions) with its own mission, journal, and experimental strategies.
Each protocol is fully self-contained in `protocols/<name>/` and lives **on
main** — nothing accumulates on private branches.

## Registry

| Protocol | Directory | Status | Notes |
|----------|-----------|--------|-------|
| _(none yet — new protocols register here)_ | | | |

Legacy protocols predate this structure and are NOT migrated:
`strategy-research-protocol/` (main), `gabagool-knowledge-and-lab/` (pointer on
main, content on `gabagool-knowledge` / `gabagool-lab` branches), and the
`fable-protocol` branch (`fable-lab/`, closed). They run out their lives where
they are; this folder's rules apply from the next protocol onward.

## Layout

```
protocols/<name>/
  CLAUDE.md                 # context for sessions launched with cwd here
  .claude/settings.json     # committed — session isolation (see below)
  MISSION.md                # what the protocol researches, stop conditions
  OPS.md                    # how to start/stop/watch the shift
  strategies/               # runnable strategies — auto-discovered by the registry
  ...                       # journal, knowledge base, tools — the protocol's business
```

## Per-protocol session isolation (every protocol needs this)

Protocol sessions must see the protocol's own `CLAUDE.md`, not the root one
(and vice versa: normal dev sessions must not wander into protocol internals).
The working pattern — verified empirically, see
`strategy-research-protocol/.claude/settings.json` for the original:

1. Commit `protocols/<name>/.claude/settings.json`:

   ```json
   {
     "claudeMdExcludes": ["**/polymarket-bot*/CLAUDE.md", "**/.claude/CLAUDE.md"],
     "autoMemoryEnabled": false
   }
   ```

   The `polymarket-bot*` glob (not `polymarket-bot`) matters: shift worktrees
   are named `polymarket-bot-<name>`, and the root `CLAUDE.md` must be excluded
   there too. The protocol's own `CLAUDE.md` (nested deeper) stays loaded.
   `autoMemoryEnabled: false` because the protocol's journal IS its memory.

2. **Launch scripts `cd` into `protocols/<name>/` before invoking `claude`.**
   Settings files load only from the session's starting cwd (no upward walk),
   while `CLAUDE.md` discovery DOES walk up — which is exactly why the
   excludes are needed.

3. **Never pass the settings via the `--settings` CLI flag** — it silently
   ignores `claudeMdExcludes` (verified on Claude Code 2.1.187). Only the
   cwd-scoped committed file works.

Shared shift conventions (keep them uniform across protocols):

- **Graceful stop**: the shift checks for `protocols/<name>/DONE` between
  units and exits when it appears (`touch` it to stop).
- **Pre-push self-check**: run `npm run protocol:check -- <name>` (from the
  repo root) before pushing strategy changes — it typechecks and lints ONLY
  this protocol plus its `src/` imports, so another protocol's broken code on
  main can never block you. This is the only check there is — protocol
  strategies have no CI gate. (`code:typecheck:protocols` /
  `code:eslint:protocols` check all protocols at once — repo-health tools, not
  the shift gate.)

## Rules

1. **Everything lives in the protocol's folder, on main.** The single exception
   used to be `src/strategies/` — no longer: strategies go in
   `protocols/<name>/strategies/` and `src/strategy/strategyRegistry.ts`
   auto-discovers them there.
2. **Strategy ids are namespaced by folder**: they must start with `<name>-`
   (e.g. `fable-exp-041`). The registry skips non-conforming ids with a
   warning. Ownership comes solely from the containing folder — another
   protocol appearing later can never invalidate your existing ids; a true id
   collision resolves deterministically to the namespace owner (longest
   matching protocol-name prefix).
3. **Protocol strategies load fail-soft.** A broken file is warned about and
   skipped — a protocol can only break itself, never the fleet or another
   protocol. Check compile/lint health with `npm run protocol:check -- <name>`
   (the pre-push self-check above; there is no CI job for `protocols/**`).
4. **Commits go straight to main**, message prefixed `<name>: ...`. Shared
   `src/` changes are the exception — those go through a normal PR like any
   other code change.
5. **A running shift gets its own worktree** (`git worktree add
   ../polymarket-bot-<name>`) so it never collides with interactive work in the
   main checkout. The worktree is a desk, not a home — delete it when the shift
   stops. Its save loop, per unit:

   ```bash
   # run from the protocol's own directory (the session cwd — see isolation
   # above), so `git add .` stages exactly protocols/<name>/ and nothing else
   git add . && git commit -m "<name>: ..."
   until git pull --rebase origin main && git push origin HEAD:main; do sleep 5; done
   ```

   Rebases are always clean because each protocol writes only its own folder.
6. **Interactive sessions need none of that** — work in the main checkout on
   `main`, commit, push.

## Why main-only

Fleet workers self-update from `origin/main`, so anything on main is instantly
runnable fleet-wide; protocols read each other's folders because everything is
on one branch; and no work is ever trapped on a drifting branch. CI noise is
handled by scoping (`quality.yml` ignores `protocols/**` on main pushes;
Prettier/ESLint don't cover it), and fleet safety by the fail-soft registry.
