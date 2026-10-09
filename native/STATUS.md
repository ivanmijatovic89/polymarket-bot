# Native engine — status

## Current state

- Host / clone: worker-1 /Users/worker-1/Sites/polymarket-bot-native
- Branch: native-engine (local commits only: worker-1 cannot push, the lead copies the branch to GitHub and opens the draft PR "DO NOT MERGE before gate 2")
- Spec: native-spec-g1 @ 4966db5e1b79643cfc3f1237af69e7f17de447cc (+ D entries since: D57)
- Milestone / step: M1 / step 1 (bootstrap)
- Oracle pin: main@9463830d (branch base; synced 2026-10-09)
- Binaries: none yet
- Data roots: symlinks data/{events,binance,telonex} → fleet copy (read-only); data/native-tapes, data/strategy-artifacts local
- Rules capture: not deployed yet (branch `rules-capture` in progress, M1 step 0)
- Paused: none. Benchmarks that need a paused fleet are deferred for this run by the user's rule (no pause/stop of the fleet worker or Global Runtime until the user confirms the pause procedure); M1 baselines run alongside the fleet and are labeled `non-idle`
- Last proof: M0 link check (01 §6 M0 proof 1) → no dead links
- Benchmark (fixed set): none yet
- Waiting on user: see below
- Next action: M1 step 1 bootstrap commit, then steps 2–4 in parallel crates

### Waiting on user

- **Fable unavailable (D45, 60 §10.0 C0).** Spawning the conformance author with `model: "fable"` fails with "Fable 5.1 requires usage credits" (HTTP 429, 2026-10-09 03:35 and 03:41). The conformance checkout `/Users/worker-1/Sites/polymarket-bot-conformance` (branch `native-conformance` from origin/main, `.claude/settings.local.json` read-denies per CF-2) is ready. Needed: usage credits for Fable at claude.ai/settings/usage, or a decision to use another model as the independent author. C1 has not started; nothing else is blocked until M2 step 3.

## Milestone plans

### M0 (closed 2026-10-09)

- [x] Spec frozen and tagged `native-spec-g1` (4966db5e) by the lead (D56); `native/spec` on this branch is byte-identical to the tag (`git diff native-spec-g1 HEAD -- native/spec` empty before D57)
- [x] Link check (proof 1)

### M1 (started 2026-10-09)

- [ ] 1.0 Rules capture PR (D37) on local branch `rules-capture`
- [ ] 1.1 Bootstrap: workspace, STATUS.md, native CI job, `native:ci:local`, conformance checkout
- [ ] 1.2 Contract, inputs, books, feeds
- [ ] 1.3 Core
- [ ] 1.4 Execution
- [ ] 1.5 Binary, SDK, canonical builder, Rust test strategies
- [ ] 1.6 TS side and T15 cells
- [ ] 1.7 Benchmark baseline (non-idle this run)

## Log (newest first)

### 2026-10-09 07:25 — session limit pause (03:42–07:20)

- At 03:42 every agent of this run stopped with "You've hit your session limit · resets 7:20am" (HTTP 429): rules capture (uncommitted work kept in its worktree), pmb-core domain, pmb-contract, pmb-book/replay, pmb-feeds, TS parity tooling, canonical builder. None had committed. The launcher iterations 2–7 exited after 30 s on the same limit.
- Resumed at 07:21 with at most three agents at a time to stay inside the limit: rules capture (finish and prove), pmb-core domain types.

### 2026-10-09 — M0 close

- Proof: `cd native/spec && grep -oh '\b[0-9][0-9]-[A-Za-z0-9-]*\.md' *.md | sort -u | while read -r f; do [ -f "$f" ] || echo "dead link: $f"; done` → prints nothing
- Tag `native-spec-g1` exists on origin (4966db5e); this branch carries the same spec bytes
