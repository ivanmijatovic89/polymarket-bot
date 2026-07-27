# Pair protocol — safety kit

Guard scripts for the `protocols/pair/` agents (design: `protocols/pair/VISION.md`
§Safety kit). They live inside the protocol for self-containment, and the
pre-commit hook **protects this directory from agent commits** (its own path is
on the blocked list), so agents cannot weaken their guardrails through the
normal commit flow. Only the human edits these files.

## setup-agent-worktree.sh

```bash
protocols/pair/scripts/setup-agent-worktree.sh fable            # create/refresh agent worktree
protocols/pair/scripts/setup-agent-worktree.sh gpt main --no-install
```

Creates `../polymarket-bot-pair-<agent>` with:

- **Generated minimal `.env`** — `DRY_RUN=true` hardcoded; whitelisted keys
  only (DB, Redis, R2, telonex floor). It NEVER copies the root `.env`, which
  holds live trading keys. No `PRIVATE_KEY`, no `POLYMARKET_*`, no `CLOB_*`,
  no RPC.
- **Worktree-scoped pre-commit hook** (`hooks/pre-commit` via
  `core.hooksPath`; agent identity pinned in `git config pair.agent`).
- **Own `npm ci`** — no `node_modules` symlink shared with the live checkout.

Hardening still recommended (manual, once): create a scoped MySQL user for
agents instead of the root app user —

```sql
CREATE USER 'pair_agent'@'%' IDENTIFIED BY '<generated>';
GRANT SELECT ON polymarket.* TO 'pair_agent'@'%';
GRANT SELECT, INSERT, UPDATE ON polymarket.backtest_runs TO 'pair_agent'@'%';
GRANT SELECT, INSERT, UPDATE ON polymarket.backtest_run_markets TO 'pair_agent'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON polymarket.backtest_run_segments TO 'pair_agent'@'%';
```

then put its credentials in the generated `.env` instead of the app user's.
(R2 keys are the shared data-bucket keys — write-capable; acceptable exposure,
it's datasets, not money.)

## hooks/pre-commit

Blocks, in every agent worktree: commits outside `protocols/pair/**`; edits to
the human-authored files (`VISION.md`, `DECISIONS.md`, `RULES.md`,
`MISSION.md`); writes into another agent's `agents/<x>/` folder; and staged
content matching secret patterns (64-hex keys, PEM blocks, credential
assignments).

## watchdog.sh

```bash
protocols/pair/scripts/watchdog.sh fable gpt              # one check pass
protocols/pair/scripts/watchdog.sh --install fable gpt    # launchd job, every 15 min
PAIR_NTFY_TOPIC=<secret-topic> protocols/pair/scripts/watchdog.sh --install fable gpt  # + phone push
```

Runs OUTSIDE the agent loop (launchd) so a dead shift cannot silence its own
alarm. Alerts on: stale `STATUS.md` heartbeat on origin/main (default > 3h),
missing `pair-<agent>` tmux session, low disk. Alert = macOS notification (+
ntfy.sh push to your phone when `PAIR_NTFY_TOPIC` is set — subscribe to the
topic in the ntfy app). Log: `~/Library/Logs/pair-watchdog.log`.

## Live-bot kill-switch

`src/strategy/strategyRegistry.ts` honors `STRATEGY_PROTOCOL_DISCOVERY=off`:
the process skips ALL `protocols/**` strategy discovery. **Set it in every
live-trading env file** (`.env`, `.env.bot1`, `.env.bot2`) so agent-pushed
code can never execute inside a wallet-holding process:

```
STRATEGY_PROTOCOL_DISCOVERY=off
```

Backtest workers (the fleet) must NOT set it — they need protocol strategies.
