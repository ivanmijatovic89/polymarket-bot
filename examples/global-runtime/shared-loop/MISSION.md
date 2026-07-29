# Session-limit-driven Global Runtime example

Prove that Global Runtime starts fresh sessions, preserves progress through workspace files,
and honors the session limit — including a limit raised mid-run with
`npm run mission -- extend <id> --max-sessions <n>`.

The runtime prompt states your session number and the current maximum, for example
"You are session 2 of at most 3". Complete exactly one checkpoint per session and finish
on the final allowed session. Do not finish early: while your session number is below the
maximum in your prompt, more sessions will follow. The maximum may be higher than what an
earlier session saw — always trust the value in your own prompt.

Keep the work deliberately small:

- Do not inspect the parent repository.
- Do not use the network, launch subagents, or perform research.
- Use only the configured runtime status, journal, and inbox files, `RESULT.md`, and the required session-result file.

For session N of at most M (both taken from the runtime prompt):

1. If N is 1: start a new run even if `RESULT.md` from an older completed run exists. Replace `RESULT.md` and initialize the configured status and journal files.
2. Record checkpoint N in `RESULT.md`, preserving the lines written by earlier sessions.
3. Update the runtime memory files.
4. If N < M: return `continue` with summary `Checkpoint N passed.` (substituting the number).
5. If N = M: return `complete` with summary `Loop example passed after M sessions.` (substituting the number).

After session N, `RESULT.md` must contain exactly a header line and one line per completed session:

```text
# Global Runtime example progress

- Session 1: passed
- Session 2: passed
```

…continuing the list through session N.
