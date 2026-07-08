# Sessions — how protocol work is launched and run

The module contracts define WHAT each role does; this file defines HOW a
session running a role comes to life: launch modes, isolation, locking,
branch policy, and preconditions. Any new launch script must follow the
checklist at the end.

## Launch modes

One session = one family. The Researcher launches in two modes, same
contract ([`modules/Researcher.md`](./modules/Researcher.md)):

- **Autonomous (default):** `scripts/researcher.sh <family>` — a headless
  Claude session that works the family continuously and streams everything
  it does. The operator watches; the session never asks questions. It waits
  for backtests by polling `checkBatch` and stops when the Session contract
  says so (validated, killed, nothing actionable, or its runaway brake).
- **Interactive:** `INTERACTIVE=1 scripts/researcher.sh <family>` — the
  same contract in a normal Claude session the operator can steer and
  interrupt.

`scripts/propose-family.sh ["seed"]` creates one family and exits.

## Session isolation

Protocol sessions read ONLY the protocol docs — this folder is a session's
ENTIRE instruction set. The mechanism: **every protocol session starts with
this folder as its working directory** (the operator by the OPERATOR.md
rule; the launch scripts `cd` here right before launching Claude), and
Claude Code loads `.claude/settings*.json` ONLY from the starting directory
(no upward walk — verified empirically; `--settings` on the CLI does NOT
apply `claudeMdExcludes`, so a flag-passed file cannot do this job). The
committed [`.claude/settings.json`](./.claude/settings.json) therefore
governs every protocol session:

- `claudeMdExcludes` (globs, machine-independent): the repo root
  `CLAUDE.md` and the user-level `~/.claude/CLAUDE.md` are NOT loaded. The
  repo-wide git workflow (branch + PR) does not apply here — the branch
  policy below does. If a session ever needs a fact that lives only in the
  root CLAUDE.md, the fix is to add that fact to its proper home in this
  folder, never to remove the exclusion. The folder's own `CLAUDE.md` (a
  one-line `@AGENTS.md` import) still auto-loads, giving every session the
  role map and ownership table without being told.
- `autoMemoryEnabled: false` (+ `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in the
  scripts): sessions keep NO private memory between runs. The family
  files, LESSONS.md, and CONSTRAINTS.md are the only memory — a conclusion
  that lives anywhere else breaks resumability and auditability
  ([`MEMORY.md`](./MEMORY.md)).
- `permissions.deny Read` on `**/logs/*.jsonl`: raw session logs are NOT
  research memory — a session never reads its predecessors' transcripts;
  the family files are the only handoff.

Because worker sessions run with this folder as cwd, their instruction
reminds them: the repo root is the parent directory, and repo paths in the
docs (`src/...`, `docs/...`) are relative to that root.

## Disposability and the lock

Sessions are disposable: **every step is written to the family files
immediately**, so a killed or crashed session loses nothing — the next one
resumes from files alone.

One family = one session at a time — enforced. Launch scripts take a
per-family lock (`$TMPDIR/research-locks/<family>.lock`, PID inside;
outside the repo so it never dirties the tree). A second session on a
locked family refuses to start; a lock whose PID is dead is taken over.

## Branch policy

```text
researchBranch: main
```

Research sessions commit directly on `main` and push before submitting
remote-worker backtests — remote workers track `origin/main`. If this ever
becomes a bottleneck, the alternative is a long-lived `research` branch
merged at family checkpoints; switching means editing the setting above and
pointing the workers at the branch. Change it here and nowhere else.

## Preconditions

- `npm run research:check` passes before starting work.
- Tree clean before any submission; commit and push, then sync the worker
  fleet ([`tools/syncWorkerFleet.md`](./tools/syncWorkerFleet.md)).
- Database credentials in `.env` (completion checks query MySQL; see
  [`tools/checkBatch.md`](./tools/checkBatch.md)).
- Dashboard running on `:3051` — REQUIRED for judging
  ([`tools/getBacktestResults.md`](./tools/getBacktestResults.md) reads
  results through its API). The operator starts it (`npm run dashboard`);
  a session must NEVER start or restart it — if it is down, report and
  stop.

## Writing a new launch script

Any script that starts a protocol session must:

1. Do its own file work with repo-root-anchored paths, and point its
   instruction at ONE module contract
   (`Execute ... per strategy-research-protocol/modules/<Role>.md`),
   including the cwd reminder (working dir = this folder; repo root = its
   parent).
2. `cd` into `strategy-research-protocol/` right before launching Claude
   (so the committed `.claude/settings.json` isolation applies — a
   `--settings` flag does NOT apply claudeMdExcludes) and export
   `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
3. Take the per-family lock when the role works on a family; clean up lock
   and settings file on exit (`trap`).
4. Stream readable output, keep the raw `.jsonl` log under the family's
   `logs/` folder (gitignored; Read-denied to sessions), and print the cost
   summary (copy the plumbing from `scripts/researcher.sh`).
5. Default to autonomous permissions (`bypassPermissions` for headless —
   headless DENIES non-allowlisted commands instead of asking, which would
   break autonomy) with a `PERM` override.
