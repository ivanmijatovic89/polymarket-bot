# pair-opus

A second, independent lab on the same strategy as `pair-fable`, started clean:
one short mission, the working toolkit, the verified engine facts, and none of
the accumulated process. Runs as a Global Runtime loop.

| Path | Owner | Purpose |
| --- | --- | --- |
| `RULES.md` | human | The constitution: dataset, strategy rubrics, fleet, scopes. |
| `missions/01-pair-builder.md` | human | The mission. |
| `memory/PRIOR-WORK.md` | human | What the sibling lab already measured. |
| `memory/capabilities/` | agent | Verified facts about the engine (carried over). |
| `tools/` | agent | Launcher, smoke, results, compare, fleet, sql, anatomy. |
| `strategies/` | agent | Strategy files — ids must start with `pair-opus-`. |
| `state/` | agent | STATUS / JOURNAL / INBOX, plus PROPOSALS and LIVE-CANDIDATE. |

## One-time setup

```bash
protocols/pair/scripts/setup-model-worktree.sh opus main pair-opus
```

## Launch

The daemon and dashboard are usually already running; start them only if not.

```bash
npm run global-runtime
```

```bash
npm run dashboard
```

Then create the loop. Drop `--auth-home` to use the default Claude login, or
point it at another profile if the main account is near its limit:

```bash
npm run mission -- create \
  --name "pair-opus pair builder" \
  --provider claude --model claude-opus-5 --effort high \
  --access full-access \
  --auth-home ~/.claude-balsa \
  --workspace ../polymarket-bot-pair-opus \
  --mission protocols/pair-opus/missions/01-pair-builder.md \
  --status-file protocols/pair-opus/state/STATUS.md \
  --journal-file protocols/pair-opus/state/JOURNAL.md \
  --inbox-file protocols/pair-opus/state/INBOX.md \
  --read-only protocols/pair-opus/RULES.md \
  --read-only protocols/pair-opus/memory/PRIOR-WORK.md \
  --read-only protocols/pair-opus/state/PROPOSALS.md \
  --read-only protocols/pair-opus/state/LIVE-CANDIDATE.md \
  --max-sessions 50 --delay 20 \
  --start
```

Watch it at `http://127.0.0.1:3051/mission-control`. Steer it with
`npm run mission -- inbox <id> "..."`, pause with `pause <id>`, continue with
`resume <id>`, and raise the budget with `extend <id> --max-sessions <n>`.

## Notes

- This lab shares the fleet and the results database with `pair-fable`. Runs
  are tagged `protocol=pair-opus`, so results never mix.
- Both labs may read each other's `memory/`; each writes only its own folder,
  which the pre-commit hook enforces.
- `full-access` means the session is not sandboxed. Run it on a machine you are
  comfortable with that on.
