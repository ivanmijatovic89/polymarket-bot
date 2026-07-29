# Three-session Global Runtime example

Prove that Global Runtime starts fresh sessions and preserves progress through workspace files.
Complete this mission in exactly three sessions. Do not finish early.

Keep the work deliberately small:

- Do not inspect the parent repository.
- Do not use the network, launch subagents, or perform research.
- Use only `STATUS.md`, `JOURNAL.md`, `RESULT.md`, and the required session-result file.

For the session number stated in the Global Runtime prompt:

1. Session 1: start a new run even if files from an older completed run exist. Reinitialize `STATUS.md` and `RESULT.md`, record that checkpoint 1 passed, update the runtime memory files, and return `continue` with summary `Checkpoint 1 of 3 passed.`
2. Session 2: preserve checkpoint 1, record that checkpoint 2 passed, update the runtime memory files, and return `continue` with summary `Checkpoint 2 of 3 passed.`
3. Session 3: preserve both earlier checkpoints, record that checkpoint 3 passed, update the runtime memory files, and return `complete` with summary `Three-session loop example passed.`

At completion, `RESULT.md` must contain exactly:

```text
# Global Runtime example passed

- Session 1: passed
- Session 2: passed
- Session 3: passed
```
