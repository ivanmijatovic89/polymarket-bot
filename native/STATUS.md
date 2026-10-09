# Native engine — status

## Current state

- Host / clone: worker-1 /Users/worker-1/Sites/polymarket-bot-native
- Branch: native-engine (pushed; draft PR https://github.com/ivanmijatovic89/polymarket-bot/pull/309 "DO NOT MERGE before gate 2: Rust trading engine")
- Spec: native-spec-g1 @ 4966db5e1b79643cfc3f1237af69e7f17de447cc (+ D entries since: D57)
- Milestone / step: M1 / steps 2–5 in parallel (step 0 PR open, step 1 bootstrap done)
- Oracle pin: main@9463830d (branch base; synced 2026-10-09)
- Binaries: none yet
- Data roots: symlinks data/{events,binance,telonex} → fleet copy (read-only); data/native-tapes, data/strategy-artifacts local
- Rules capture: PR https://github.com/ivanmijatovic89/polymarket-bot/pull/308 open (branch `rules-capture`, PC8 items 1–2 proven 2026-10-09 05:24Z); not deployed yet
- Paused: none. Benchmarks that need a paused fleet are deferred for this run by the user's rule (no pause/stop of the fleet worker or Global Runtime until the user confirms the pause procedure); M1 baselines run alongside the fleet and are labeled `non-idle`
- Last proof: workspace gates after the leftover tidy (2026-10-09 11:55): `cargo fmt --all --check && cargo clippy --workspace --all-targets --locked -- -D warnings && cargo test --workspace --locked` → green (pmb-core 41, pmb-book 3, pmb-contract 8+6, pmb-replay golden 1)
- Benchmark (fixed set): none yet
- Waiting on user: none
- Next action: M1 steps 2–5 in parallel workstreams (feeds, plugins, core+execution, contract, builder, TS side), then binary/SDK/strategies

## Milestone plans

### M0 (closed 2026-10-09)

- [x] Spec frozen and tagged `native-spec-g1` (4966db5e) by the lead (D56); `native/spec` on this branch is byte-identical to the tag (`git diff native-spec-g1 HEAD -- native/spec` empty before D57)
- [x] Link check (proof 1)

### M1 (started 2026-10-09)

- [ ] 1.0 Rules capture PR (D37): branch `rules-capture` pushed, PR #308 open; merge after CI, then deploy (PC7)
- [x] 1.1 Bootstrap: workspace, STATUS.md, native CI job, `native:ci:local`, conformance checkout — eb32c9dd; draft PR #309
- [ ] 1.2 Contract, inputs, books, feeds
- [ ] 1.3 Core
- [ ] 1.4 Execution
- [ ] 1.5 Binary, SDK, canonical builder, Rust test strategies
- [ ] 1.6 TS side and T15 cells
- [ ] 1.7 Benchmark baseline (non-idle this run)

## Log (newest first)

### 2026-10-09 11:55 — resume on the $200 plan; leftovers tidied

- Carried from the first run's subagent worktrees after build/test: pmb-core `market.rs` (10 §5) and `rules.rs` (11), pmb-contract types and contract fixtures (21) — commit ce013502. The untracked pmb-engine `ledger.rs` draft referenced a missing `crate::rules::CoreRules` and was set aside (kept as input for the core step, not committed).
- Removed the six stale `.claude/worktrees/agent-*` worktrees and their `worktree-agent-*` branches; `worktree-agent-ab3cec00…` commits (ids, seeds, orders) were already in `native-engine` (c7325f73), its market identity commit and uncommitted rules were carried above.
- Pushed branches already existed on origin; opened PR #308 (rules capture, D37) and draft PR #309 (`native-engine`, D48).
- Fable retry (D45): conformance author C1 started with `model: fable` in `/Users/worker-1/Sites/polymarket-bot-conformance` (branch `native-conformance`); the "usage credits" error came from the exhausted $20 plan. Removed from "Waiting on user".

### 2026-10-09 07:25 — session limit pause (03:42–07:20)

- At 03:42 every agent of this run stopped with "You've hit your session limit · resets 7:20am" (HTTP 429): rules capture (uncommitted work kept in its worktree), pmb-core domain, pmb-contract, pmb-book/replay, pmb-feeds, TS parity tooling, canonical builder. None had committed. The launcher iterations 2–7 exited after 30 s on the same limit.
- Resumed at 07:21 with at most three agents at a time to stay inside the limit: rules capture (finish and prove), pmb-core domain types.

### 2026-10-09 — M0 close

- Proof: `cd native/spec && grep -oh '\b[0-9][0-9]-[A-Za-z0-9-]*\.md' *.md | sort -u | while read -r f; do [ -f "$f" ] || echo "dead link: $f"; done` → prints nothing
- Tag `native-spec-g1` exists on origin (4966db5e); this branch carries the same spec bytes
