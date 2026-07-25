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
  CLAUDE.md        # context for sessions launched with cwd here
  MISSION.md       # what the protocol researches, stop conditions
  OPS.md           # how to start/stop/watch the shift
  strategies/      # runnable strategies — auto-discovered by the registry
  ...              # journal, knowledge base, tools — the protocol's business
```

## Rules

1. **Everything lives in the protocol's folder, on main.** The single exception
   used to be `src/strategies/` — no longer: strategies go in
   `protocols/<name>/strategies/` and `src/strategy/strategyRegistry.ts`
   auto-discovers them there.
2. **Strategy ids are namespaced**: they must start with `<name>-` (e.g.
   `fable-exp-041`). The registry skips non-conforming ids with a warning.
3. **Protocol strategies load fail-soft.** A broken file is warned about and
   skipped — a protocol can only break itself, never the fleet or another
   protocol. Check compile/lint health with `npm run code:typecheck:protocols`
   and `npm run code:eslint:protocols` (both also run as the non-blocking
   `Protocols Quality` CI job).
4. **Commits go straight to main**, message prefixed `<name>: ...`. Shared
   `src/` changes are the exception — those go through a normal PR like any
   other code change.
5. **A running shift gets its own worktree** (`git worktree add
   ../polymarket-bot-<name>`) so it never collides with interactive work in the
   main checkout. The worktree is a desk, not a home — delete it when the shift
   stops. Its save loop, per unit:

   ```bash
   git add protocols/<name>/ && git commit -m "<name>: ..."
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
