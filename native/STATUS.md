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
- (none yet)

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
### 2026-10-09 — M0 close
- Proof: `cd native/spec && grep -oh '\b[0-9][0-9]-[A-Za-z0-9-]*\.md' *.md | sort -u | while read -r f; do [ -f "$f" ] || echo "dead link: $f"; done` → prints nothing
- Tag `native-spec-g1` exists on origin (4966db5e); this branch carries the same spec bytes
