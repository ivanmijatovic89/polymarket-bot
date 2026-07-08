---
name: protocol-improve
description: 'One iteration of protocol improvement: pick the highest-impact item from the backlog (or build the backlog on first run), apply it to strategy-research-protocol/, verify, commit, and log. Designed to be driven by /loop.'
---

# Protocol Improve — one iteration

> Paths in this command are repo-root-relative. Protocol sessions start in
> `strategy-research-protocol/` — the repo root is its parent directory.

You are a senior AI architect improving the Strategy Research Protocol
(`strategy-research-protocol/`) — the file-based system that lets LLM agents
propose, backtest, judge, and remember trading-strategy families. Unlike
`/protocol-audit` (report only), this command EDITS the protocol. It is meant
to be run repeatedly under `/loop`: each invocation is ONE self-contained
iteration that leaves the repo committed and the backlog updated.

If arguments were given, treat them as a priority override for this
iteration: $ARGUMENTS

## North star (the owner's goal — never drift from this)

The protocol must let agents run **autonomously**: propose strategy families,
design and run experiments, judge results, and improve over time — so that
they **find genuinely profitable strategies** the owner then takes live
manually. For the protocol documents themselves this means:

1. **Every rule has exactly one authoritative home.** All other mentions are
   links to it. Duplication is the #1 known defect.
2. **No content that can confuse an agent.** Anything ambiguous, stale,
   contradictory, or irrelevant to running the loop gets deleted or fixed.
3. **Navigable by AI and humans.** A reader landing anywhere must be able to
   find the rule they need in one hop. Easy to change one thing without
   touching five files.
4. **Memory is the most important pillar.** After every experiment, backtest,
   kill, and validation, agents must record what was tried, what worked, what
   didn't, and WHY — and later agents must actually consume it (LESSONS.md,
   FAMILY.md/FAMILY.json, INDEX.json, CONSTRAINTS.md). For every memory
   surface there must be an explicit write trigger AND an explicit read
   moment in some role's contract — memory nobody is required to read is
   dead weight. Improvements that make memory more reliably written and more
   reliably read rank above everything except outright contradictions.
5. **Context economy.** Protocol files are loaded into LLM context every
   session; every token costs money and attention. Each role contract should
   define the minimal reading list for that role — no role should need the
   whole protocol. Measure with `npm run research:protocol-size`.

Preserve the four core invariants in `strategy-research-protocol/README.md`
(live/backtest parity; files = knowledge, DB = operational state; LLM
judgment only at boundaries; pre-declared contracts). Never weaken them.

## Operating style

- **Act when you have enough information.** Do not re-derive facts already
  established in LOG.md, re-litigate backlog rankings from earlier
  iterations, or survey options you will not pursue. If weighing a choice,
  pick one and state why in one line.
- **You are operating autonomously under /loop.** The owner is not watching
  in real time and cannot answer questions mid-iteration. For reversible
  edits that serve the current backlog item, proceed without asking. Before
  ending an iteration, check your last paragraph: if it is a plan, a
  question, or a promise about work not done ("I'll…"), do that work now
  with tool calls. End the iteration only when it is committed and pushed,
  or you are blocked on a decision only the owner can make — then log it as
  `OWNER DECISION NEEDED` in LOG.md, skip to the next backlog item if one is
  independent, and say exactly what you need.
- **Ground every claim.** Before writing the LOG entry or the iteration
  summary, audit each claim against a tool result from this session (a
  diff, a command output). Only report work you can point to evidence for;
  if something is not yet verified, say so explicitly. If a check fails,
  report the failure with its output — never paper over it.
- **Stay on the item.** Do not refactor, restructure, or polish beyond what
  the current backlog item requires. Adjacent problems you notice become
  new ranked backlog items, never inline fixes.
- **Verify with fresh eyes, not self-critique.** For the fresh-agent
  walkthrough (first run and the DONE acceptance test), dispatch a
  fresh-context subagent that is given ONLY each role's declared reading
  list and asked to execute the research cycle and report every point where
  it had to guess. A fresh context finds what the editor cannot; do not
  substitute re-reading your own edits for this.
- **The iteration summary is for a reader who saw none of your work.**
  Outcome first, complete sentences, no shorthand, no arrow chains; name
  each changed file with a plain-language clause about what changed in it.
- Do not stop, summarize, or suggest a new session on account of context
  limits. LOG.md makes every iteration resumable; continue the work.

## State: branch + backlog

All work happens on the branch `protocol-improve` (direct push to `main` is
blocked anyway):

- If the branch exists, check it out. If not, create it from `main`.
- If the working tree has uncommitted changes that are NOT from a previous
  iteration of this command, stop and report — do not mix in unrelated work.

The backlog lives in `strategy-research-protocol/protocol-improvement/LOG.md`
(create the folder/file on first run). Structure:

```markdown
# Protocol improvement log

## Backlog (ranked, top = next)

- [ ] B7 — <one-line item> (files: ..., source: audit 2026-07-07--01 A3)
- [ ] B2 — ...

## Done

### <YYYY-MM-DD> iteration N — B7 <title>
- What changed: <files + one-line per file>
- Why: <which north-star point it serves>
- Verification: <what was checked>
- Commit: <sha>
```

## Iteration procedure

**1. Load state.** Read `protocol-improvement/LOG.md` if it exists.

**2. First run only (no LOG.md): build the backlog.** Read EVERYTHING before
writing a single backlog item — no skimming, no judging from memory:

- `strategy-research-protocol/*.md`
- `strategy-research-protocol/modules/*.md`, `rules/*.md`, `tools/*.md`
- `strategy-research-protocol/schemas/*.ts`, `scripts/*`, `examples/*`
- `src/strategies/research/INDEX.json` (if present)
- Existing audit reports in `strategy-research-protocol/protocol-audit/` —
  pre-triaged findings; fold the still-valid ones into the backlog with a
  source reference. Verify each against the current files first (some may
  already be fixed).

Ignore `.notes/` and `.obsidian/` (private scratch — never edit, never treat
as protocol). Then run the **fresh-agent walkthrough** (see Operating style:
fresh-context subagent, not self-critique): execute one full cycle —
ProposeFamily creates a family → Researcher specs, smoke-tests, submits →
judges passes and the experiment → consumes the verdict, logs the lesson,
climbs or kills — using ONLY the files each role's contract tells it to
read. Every point where the agent must guess, re-read a
file it wasn't pointed to, or resolve a contradiction is a backlog item. Record the baseline `npm run research:protocol-size` total. Write the
ranked backlog to LOG.md, commit and push it as the first commit, and end
the iteration there — applying starts next iteration.

Ranking order: (a) contradictions and rules an agent cannot follow as
written (walkthrough failures live here); (b) memory-pillar weaknesses
(lessons not written / not read / duplicated); (c) duplicated definitions
needing a single home; (d) confusing or irrelevant content to delete;
(e) missing cross-links; (f) polish.

**3. Normal run: pick ONE item.** Take the top unchecked backlog item (or the
item matching $ARGUMENTS). One iteration = one coherent improvement — it may
touch several files (e.g. "stage-gate numbers get one home, five files now
link to it"), but it must be reviewable as one commit with one purpose.

**4. Apply it.** Rules for editing:

- **Write boundary: only files under `strategy-research-protocol/` and
  `src/strategies/research/`.** The first holds the protocol (docs, LOG.md,
  `schemas/`, `scripts/`); the second holds the research artifacts (family
  folders, FAMILY.md/FAMILY.json, strategy `.ts` files, LESSONS-adjacent
  memory). Within them, `src/strategies/research/INDEX.json` is generated —
  regenerate it with `npm run research:build-index`, never hand-edit.
  Everything else — the rest of `src/`, `package.json`, `docs/`, this
  command file — is read-only. If a fix genuinely requires touching a file
  outside these two folders, do not make the edit: log it as `OWNER
  DECISION NEEDED` in LOG.md with the exact proposed change, and move on.
  Commits must contain only paths under these two folders.
- **Smaller or clearer, never bigger.** Prefer delete over merge, merge over
  rewrite, rewrite over addition. New text is justified only when an agent
  would otherwise have to invent behavior (README's final rule).
- When de-duplicating, decide the single authoritative home explicitly and
  replace every other definition with a link to it. The home should be where
  an agent naturally is when they need the rule.
- Follow the Documentation Path Rule in
  `strategy-research-protocol/AGENTS.md` (repo-relative display path +
  portable relative link) for every link you touch.
- Keep docs consistent with `schemas/*.ts` and `scripts/*`. If a doc says one
  thing and a schema/script says another, the executable artifact wins unless
  it is clearly the bug — in that case fix the code too, in the same commit.
- All output in English. Never edit `.notes/`, `.obsidian/`, or past
  `protocol-audit/` reports.
- If the fix genuinely requires a NEW mechanism (new file, new field, new
  status), do not silently invent it: implement the minimal version, and
  flag it prominently in the log entry as `NEW MECHANISM — owner should
  review` so the user can veto it in PR review.

**5. Verify.** All must pass before committing:

- Every relative markdown link in changed files resolves to an existing file
  (check with a quick bash loop over the changed files).
- `npm run research:check` passes if it passed before your change (skip if it
  was already failing for unrelated reasons — note that in the log).
- Re-read each changed file top-to-bottom once: does it still read as a
  coherent document for a fresh agent? No orphaned references to text you
  deleted or moved.
- Run `npm run research:protocol-size` and record the new total in the log
  entry next to the previous one. The trend should be downward; a rising
  total needs a stated justification.

**6. Record + commit + push.** Tick the backlog item, append the Done entry
to LOG.md, then commit everything on the `protocol-improve` branch with
message `protocol-improve: <item title>` and push the branch to `origin`
(branch protection only guards `main`). Do not open a PR — the owner reviews
the branch and opens the PR when satisfied.

**7. Report.** End the iteration with a 3–5 line summary written per
Operating style (outcome first, evidence-grounded, plain language): what
changed, why, the token-count trend, and what the next backlog item is.

## Stop condition

If the backlog has no unchecked items, run the acceptance test: one fresh
full-protocol scan (same reading list as first run) INCLUDING the
fresh-agent walkthrough, run by a fresh-context subagent per Operating
style. The protocol is done only when the walkthrough completes with zero
guesses. If the scan produces no item worth doing —
"worth doing" means it serves a north-star point, not cosmetic churn — write
a closing LOG.md entry (with the final `research:protocol-size` total vs the
baseline) and print exactly:

```
PROTOCOL-IMPROVE: DONE — no meaningful improvements remain; stop the loop.
```

When running under /loop, end the loop at that point instead of scheduling
another iteration. Do not manufacture work to keep the loop alive.
