# Native engine — status

## Current state

- Host / clone: worker-1 /Users/worker-1/Sites/polymarket-bot-native
- Branch: native-engine (pushed; draft PR https://github.com/ivanmijatovic89/polymarket-bot/pull/309 "DO NOT MERGE before gate 2: Rust trading engine")
- Spec: native-spec-g1 @ 4966db5e1b79643cfc3f1237af69e7f17de447cc (+ D entries since: D57–D69)
- Milestone / step: M1 / steps 2–6 in parallel (workflow wave 1); steps 0 and 1 done
- Oracle pin: main@ad2f11b8 (merged 2026-10-09 11:50; the only change since 9463830d is the rules capture, outside the OR-2 engine paths)
- Binaries: none yet
- Data roots: symlinks data/{events,binance,telonex} → fleet copy (read-only); data/native-tapes, data/strategy-artifacts local
- Rules capture: running since 2026-10-09 09:48Z (LaunchAgent `com.pmb.rules-capture`, pinned checkout /Users/worker-1/pmb-rules-capture/app @ ad2f11b8, output /Users/worker-1/pmb-rules-capture/prestart); PC8 item 3 (`--report --days 1` ≥ 99%) due after 2026-10-10 09:48Z
- Paused: none. Benchmarks that need a paused fleet are deferred for this run by the user's rule (no pause/stop of the fleet worker or Global Runtime until the user confirms the pause procedure); M1 baselines run alongside the fleet and are labeled `non-idle`
- Last proof: workspace gates after the leftover tidy (2026-10-09 11:55): `cargo fmt --all --check && cargo clippy --workspace --all-targets --locked -- -D warnings && cargo test --workspace --locked` → green (pmb-core 41, pmb-book 3, pmb-contract 8+6, pmb-replay golden 1)
- Benchmark (fixed set): none yet
- Waiting on user: none (spec questions collected for D entries after wave 1)
- Next action: M1 steps 2–5 in parallel workstreams (feeds, plugins, core+execution, contract, builder, TS side), then binary/SDK/strategies

## Milestone plans

### M0 (closed 2026-10-09)

- [x] Spec frozen and tagged `native-spec-g1` (4966db5e) by the lead (D56); `native/spec` on this branch is byte-identical to the tag (`git diff native-spec-g1 HEAD -- native/spec` empty before D57)
- [x] Link check (proof 1)

### M1 (started 2026-10-09)

- [x] 1.0 Rules capture (D37): PR #308 squash-merged as ad2f11b8 (CI green), deployed per PC7 2026-10-09 09:48Z; PC8 item 3 pending (24 h)
- [x] 1.1 Bootstrap: workspace, STATUS.md, native CI job, `native:ci:local`, conformance checkout — eb32c9dd; draft PR #309
- [ ] 1.2 Contract, inputs, books, feeds
- [ ] 1.3 Core
- [ ] 1.4 Execution
- [ ] 1.5 Binary, SDK, canonical builder, Rust test strategies
- [ ] 1.6 TS side and T15 cells
- [ ] 1.7 Benchmark baseline (non-idle this run)

## Log (newest first)

### 2026-10-09 12:45 — lead decisions D58–D69

- Added D58–D68 (compat-latency defaults, ts-compat `RulesView`, empty `place_batch`, `sim-{key}` exchange ids, cancel-failure strings, OR-7 audit scope, size-mismatched inputs under MS-5, cargo-deny ignores and targets, `selftest` before `serve`, ts-compat clock passed to `on_market_event`, RNG-6 top-of-range mapping) and D69 (clarifications from the conformance triage A-03…A-20, GF-2 header placement, MS-2 vs Chainlink coverage, S5 shortfall, PE-R1…R3 fields). No item needs the user.
- A-09: the conformance vectors `cs-08`/`cs-10` assume tick N−1 for callbacks of tick N's execution step; the spec says tick N (12 §5.3). Sent back to the conformance author (CF-4).
- FYI for the user (not blocking): the fleet dataset file `btc-updown-15m-1765684800` differs in size from its `telonex_market_conversions` row; native parity skips it (D64).

### 2026-10-09 12:35 — tooling merged; conformance C1 merged; pmb-core review

- Merged into native-engine: `native/PARITY.md` (60 §3.1 layout, standing PE-R1…R3; ws/paritymd), `npm run native:goldens:check` (GF-4, generator convention `--out-dir <dir>`; ws/goldens), `npm run native:oracle:env-audit` (OR-7; currently exits 1 on two unlisted variables, `BACKTEST_LATENCY_DELAY`/`_JITTER` read by `src/backtest/simulator/resolveMarket.ts:72-73` — open question, see below; ws/envaudit), `native/deny.toml` + a cargo-deny step in the native-quality CI job (`cargo deny --manifest-path native/Cargo.toml --locked check` → advisories/bans/licenses/sources ok locally with cargo-deny 0.20.2; RUSTSEC-2026-0190 anyhow ignored until the `=1.0.98` pin is bumped; ws/deny), and the read-only data inventory `native/reports/data-inventory-20261009-worker-1.md` (27,614 eligible BTC 15m files all local; 6 BTC 5m (F1, 2026-02-12); Binance 2025-11-29…2026-09-18 and Chainlink 2026-04-02…2026-09-18 without gaps; S15-CL universe 15,219 markets with every input local; ws/inventory).
- Conformance C1 (Fable, D45) done and pushed as `native-conformance` @ e6dbfb20; merged (only `native/conformance/`). `cargo test --manifest-path native/conformance/Cargo.toml` → 86 data tests pass, 151 skeletons ignored until C2. Its PLAN.md lists spec ambiguities A-01…A-20 for triage (60 §10.3). `native/conformance/` added to `.prettierignore` (CF-4: the implementation session never reformats conformance files).
- Independent review of the first run's pmb-core domain code (no edits): 38 findings (14 major), saved for the core fix stage; highlights: unchecked `Price::complement` (10 T3), `transition` accepts forbidden 10 §8.2 rows, no CancelState transitions, missing `exchange_id`/`CancelFailed` cid payloads, reason codes vs TS strings, rules timeline from captured `market.rules` missing.

### 2026-10-09 11:50 — M1.0 rules capture merged and deployed

- PR https://github.com/ivanmijatovic89/polymarket-bot/pull/308: CI green (Root, Dashboard, Docs, WebUI), `npm run rules:capture:test` 24/24 locally; squash-merged → main@ad2f11b8 (user-approved merge, D37).
- Deployment (11 PC7): `git clone` of ad2f11b8 at /Users/worker-1/pmb-rules-capture/app, `npm ci` (Node v20.20.2), plist rendered from `ops/macos/rules-capture/com.pmb.rules-capture.plist.template`, `plutil -lint` OK, `launchctl bootstrap gui/501 …` → pid 85636; first ticks 09:48:05Z (2 markets, 4 requests ok) and 09:49:05Z (ok 2); `status.json` fresh.
- origin/main merged into native-engine (bc03975f); oracle pin main@ad2f11b8.
- Wave-1 workflow started (worktrees `.claude/worktrees/ws-{core,feeds,plugins,contract,builder,sdk,ts}`; ws-exec is created from ws/core by the skeleton step).

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
