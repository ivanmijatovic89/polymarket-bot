# Open decisions (draft)

Generated from the requirements sweep (native/spec/research/requirements-sweep.json).
Status: DRAFT — each decision is resolved with the user before the spec freezes.

## D01. Start the new goal on a fresh branch and worktree from the current main, or continue the rust-engine WIP branch?

Options:
- Continue the WIP branch (fef5f199) and fix it until it compiles
- Fresh branch from main, spec committed first. Freeze the WIP branch as a read-only reference and port only reviewed pieces (fixed.rs, slug.rs, the telonex reader, parity tooling, golden fixtures).
- Fresh branch, ignore the WIP entirely

**Recommended:** Fresh branch from main with the spec committed first. Keep the WIP frozen as a reference and cherry-pick only reviewed modules and test fixtures.

Why: The WIP does not compile and was built against an incomplete spec (HashMap iteration, OS libm, env-read latencies, missing order states and rules snapshot). Main has also moved by 18 engine commits. Its fixed-point, slug and reader code and its TS-generated goldens are still useful test assets.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D02. How is the autonomous goal bounded: a wall-clock limit (e.g. 10 h), per-milestone time boxes, or user review gates?

Options:
- Global wall-clock limit
- Per-milestone time boxes
- No time limit; milestone proofs plus explicit user gates, with every milestone resumable from STATUS.md by a fresh session

**Recommended:** No time limit. User gates after spec freeze, after M2 parity, before realistic becomes default, and before any real order. Each milestone ends with a demo command, a commit and a STATUS.md entry that a new session can resume from.

Why: The user considers the 10 h limit unnecessary. The scope is multi-week, and decision gates prevent drift better than timers.

Decision: Accepted as recommended (2026-10-08): no wall-clock limit; user gates after spec freeze, after M2 parity, before realistic becomes default, before any real order.

## D03. Integration strategy: one long-lived branch with a final PR, or incremental merges to main behind flags?

Options:
- Single PR at the end; switch the fleet to the branch for M5
- Incremental PRs to main: contract schemas, DB migrations, an inactive native worker shim and native queue, then the engine crates. Native dispatch disabled by default.

**Recommended:** Incremental, inactive by default. The fleet never switches branch. If a switch is ever needed, use the pause-GR, drain, switch, test, switch-back, resume runbook.

Why: GR daemons and pte run from the worker checkouts. Branch workers die on main-SHA jobs. Main changes weekly, and a 10k+ line PR cannot be reviewed.

Decision: Separate branch until gate 2 (parity proven); main untouched until then; parity runs locally, no fleet branch switch; after gate 2 one merge to main, then small PRs. Branch regularly syncs main (user, 2026-10-08).

## D04. What happens to the TS engine during and after the migration?

Options:
- Keep evolving TS freely; re-check parity occasionally
- Pin a TS oracle commit per parity cycle; every engine-semantics PR on main must add an exerciser case or a PARITY.md entry; after acceptance, freeze TS to bug fixes and build new features Rust-first
- Delete TS after acceptance

**Recommended:** Pinned oracle plus a parity-entry rule during the migration. After acceptance, TS is frozen to bug fixes, new engine features are Rust-first, and a sunset review is set for a fixed date.

Why: A moving oracle makes ts-compat parity unverifiable, and maintaining two engines indefinitely doubles every feature.

Decision: Accepted as recommended (2026-10-08).

## D05. Calibration needs real orders, and the TS live bot is blocked by CLOB V2 (#249). Which pieces move from stretch into core?

Options:
- Keep the CLOB V2 adapter and Recorder V4 input as stretch; calibration is outside this goal
- Promote Recorder V4 input only; calibrate later
- Promote both: Rust CLOB V2 adapter (user-activated only) and V4 input as hard prerequisites of a calibration milestone
- Fix TS #249 and calibrate with the TS bot

**Recommended:** Promote both. Change rule 8 to: the agent never places real orders, and the user launches calibration with an explicit flag and a compile-time feature.

Why: Client-side latency must be calibrated on the stack that will trade. Same-day calibration needs V4 (Telonex data lags 3+ days and has no trade prints), and fixing the TS bot would mean calibrating twice.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D06. Which markets must native v1 support?

Options:
- BTC 15m only
- BTC 5m + 15m
- Every symbol and timeframe Telonex has

**Recommended:** BTC 5m + 15m guaranteed (parity, benchmark, calibration). Other symbols and timeframes are accepted when data and feeds exist, but are flagged 'unvalidated' in the run row.

Why: Recorder V4 and calibration are BTC-only. Rules, feeds and Chainlink coverage differ per symbol.

Decision: BTC 5m and BTC 15m only for the start (user, 2026-10-08).

## D07. What measurable criteria declare the migration a success, or stop it?

Options:
- Report only
- Explicit thresholds for parity, throughput and calibration

**Recommended:** ts-compat: 100% identical order, fill and cancel sequences on the exerciser and lagsnipe.v15 over 200+ markets, with zero unclassified mismatches. At least 4x fleet throughput (market-candidates per hour on 4 Macs) on 1,000 markets (the earlier prototype measured 6.19x). Realistic becomes default only on the calibration thresholds. If mismatches stay unclassified after a full cycle, stop and report.

Why: The user asks for odds of live parity. Only fixed targets make that verifiable.

Decision: No stop criteria (user, 2026-10-08). ts-compat parity is a gate: mismatches are fixed until it passes, never a reason to abandon. Speed is measured and reported, no minimum threshold.

## D08. Per-market money quantization in the output: keep 2 dp or switch to 4 dp (the column scale)?

Options:
- 2 dp, half-away-from-zero on fixed-point, in both profiles (JS tie differences documented)
- 4 dp plus an explicit flat threshold in the TS stats and a stats version bump

**Recommended:** Keep 2 dp, half-away-from-zero. Record the negative-tie difference from JS as intended in PARITY.md. Emitted values must already be at or below the column scale, so fresh and extended runs agree. Judge parity on unrounded trace values.

Why: This keeps results comparable with every historical run. 4 dp changes win, loss and flat classification and needs a stats migration.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D09. Should every result-affecting setting be stored as structured engine provenance per run instead of being re-parsed from the cmd string?

Options:
- Keep parsing cmd
- Indexed `engine` column ('ts' | 'native-ts-compat' | 'native-realistic') plus engine_version, engine_commit, binary sha and a versioned `model_config` JSON column (latencies, jitter, seed, gap thresholds, PTB latency, rulesVersion, fill model, per-market starting capital)
- Fully normalized columns

**Recommended:** Indexed `engine` plus `engine_version` plus a `model_config` JSON column, via a hand-written migration mirrored in the dashboard schema. The producer resolves ModelConfig and the job carries it, and the binary never reads env for behavior. The output echoes engineVersion, profile and seed, and TS asserts they match the request. Extend inherits and enforces equality. The dashboard flags comparisons across engines.

Why: Worker .env files can silently change results today, a silent profile fallback is undetectable, and agents would compare TS, ts-compat and realistic numbers as if they were equal.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D10. The dashboard Market Simulator and native runs: block them now, or have Rust emit the simulator trace format now?

Options:
- Block native runs with a clear message (TS guard in resolveMarket)
- Implement the simulator TraceSink in this goal

**Recommended:** Block now. Make the simulator trace format a TraceSink in the milestone after parity.

Why: Today a native run either throws or silently replays a TS registry strategy with the same id and labels it as that run.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D11. Where are per-order and per-fill records and live per-market results stored?

Options:
- Gzipped JSONL ledger in R2 per run and slug
- New MySQL fill and order tables
- Live and paper windows stored as normal backtest_runs rows with input_mode='live' or 'paper'

**Recommended:** Opt-in ledger as gzipped JSONL in R2, plus live and paper windows as backtest_runs rows with input_mode='live' or 'paper', so live and backtest can be compared per slug with existing tools.

Why: Calibration needs order and fill granularity. Adding a MySQL fill table to a 7.6 GB table set is expensive.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D12. How are native market jobs gated and dispatched on the fleet?

Options:
- Keep the producer git-SHA gate on the shared queue
- Separate native queue; gate on worker shim version, protocolVersion, jobSchemaVersion and target triple; producer SHA and dirty flag kept as provenance only

**Recommended:** Separate native queue with version and target gates. v1 is aarch64-apple-darwin only, and workers refuse other targets. Keep the commit gate on aggregate jobs and TS jobs.

Why: The engine travels inside the hash-verified binary. The SHA gate forces branch switches and stalls the fleet on local branches.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D13. Shared candidate replay: how is a group stored and attributed?

Options:
- One run row with N candidates
- N backtest_runs rows (own submission_uid, shared batch_uid, new candidate_group_uid and candidate_index columns) written by one group aggregate job

**Recommended:** N rows written by one group aggregate, one transaction per run, idempotent per submission_uid. A candidate's strategy panic fails only that candidate; data and IO errors retry the market job. durationMs per candidate = group wall time / N, eventsProcessed = the full count, and every candidate gets the group's start and finish times. Each row's cmd is standalone-equivalent, and standalone --extend of one candidate must reproduce the group result.

Why: Existing dashboard, protocol tools, extend and walk-forward all key on run id and params. The leaderboard and wall clock must not count compute time N times.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D14. What is the group submission syntax, and what do execution-model variants and mixed feed requirements do?

Options:
- `--candidates <file.json>` (explicit list, or {base, sweep, mode: coordinate|cartesian})
- `--param-grid` inline
- Mixed feed requirements: reject
- Mixed feed requirements: split automatically into sub-groups

**Recommended:** `--candidates <file.json>`. Reject duplicate normalized params and mixed feed or eligibility requirements in v1. Also allow candidates that differ only in ModelConfig (fill model, queue parameter, latency calibration id) for internal calibration and A/B use. One shared per-market seed derived from (run seed, slug).

Why: Calibration and the realistic A/B reports need execution variants on one market read. Mixed feeds change the eligible universe.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D15. Should sweep results store per-market rows for every candidate, or only for the best ones? What retention policy applies to old runs and artifacts?

Options:
- Full per-market rows for every candidate
- Segments for all candidates; per-market rows only for the top-5 and promoted candidates (others re-run on demand)
- Plus a retention policy (e.g. drop market rows of unpromoted runs older than N days; keep segments)

**Recommended:** Segments for all, rows for the top-5 and promoted, results moved out of Redis as chunks finish, a hard cap on candidates x markets per group, and a retention policy for unpromoted runs, R2 traces and ledgers. Live journals are kept long-term in a private bucket.

Why: 100 candidates x 5.5k markets is about 6.6 GB of Redis on a 16 GB Mac, and the DB already grows by 2M+ rows a week.

Decision: Keep per-market rows for every candidate for now; a cleanup/retention script comes later (user, 2026-10-08).

## D16. Will sandboxed Global Runtime agents write Rust strategies in this goal, and which dependencies may strategy crates use?

Options:
- Yes, built inside the sandbox (vendored crates, offline)
- Yes, built in a step outside the sandbox
- Not in this goal (only the implementation session builds, on m1-ivan)
- Crates: free choice / only SDK re-exports

**Recommended:** Not in this goal. Design a build step outside the sandbox now (shared target dir per machine, capped -j). Strategy crates use only SDK re-exports, with no extra crates.

Why: The sandbox blocks crates.io and ~/.cargo, and GR hosts run 8 backtest slots. Extra crates break offline builds and add nondeterminism (rand, wall clock).

Decision: Not in this goal. polymarket-protocols will author new strategies in Rust, but only as a follow-up goal after the engine is finished (user, 2026-10-08). Design the build/publish step so it fits later.

## D17. Artifact identity and trust: is the sha of a binary built on any machine acceptable, and what must hold before the live runtime loads a binary?

Options:
- Binary sha from any machine plus a source_hash for dedupe
- Only one canonical builder publishes
- Live requires a clean recorded commit, engine at or above the live-safe minimum, and a verified reproducible rebuild to the same sha

**Recommended:** Any machine with path remapping (--remap-path-prefix, pinned toolchain, --locked, one profile, ad-hoc codesign after strip), identity = binary sha, plus source_hash, target, rustc and engine commit columns. Live requires a reproducible rebuild from a clean commit that matches the sha.

Why: A test build contained 74 absolute /Users paths. A binary cannot be reviewed the way a 30 KB TS bundle can, so a reproducible rebuild is the only way to review it.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D18. Which build profile do strategy artifacts use?

Options:
- Fast: lto=false, codegen-units=16, panic=unwind, overflow-checks=true
- Current: thin LTO, cgu=1

**Recommended:** Fast profile for check, iterate and publish alike. Revisit only if the M6 benchmark shows replay CPU rather than parquet IO dominates.

Why: Measured warm rebuild 0.84 s vs 7.3 s. catch_unwind requires unwind, and overflow checks guard the fixed-point money math.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D19. Plugin scope of the first SDK release, and how TechnicalIndicators works when it is ported.

Options:
- Port all five plugins now
- Ship ExternalFeeds, DwellGate and TimeWindowGate; defer TA and Volatility
- TA candles from local Binance aggTrades files
- TA strategies stay on the TS engine

**Recommended:** Ship the three plugins that active authors use. When TA is ported, build candles from local aggTrades (extended preflight lookback), with no network calls inside the binary.

Why: Only inactive SplitSellRedeem.v5.x uses TA and Volatility, and TS TA fetches REST klines with a wall-clock wait, which is nondeterministic.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D20. Should a Rust port of a TS strategy keep the TS id, or get a distinct one?

Options:
- Same id, distinguished only by the engine column
- Distinct id (e.g. `overnight-opus55-lagsnipe.v15.rs`)

**Recommended:** Distinct id, and also store the engine and profile on the run row.

Why: The dashboard and protocol tools group by `strategy`, so a shared id would mix engines.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D21. Where do backtests get per-market ExchangeRules (tick, min size, fee schedule, taker delay, negRisk, version), and what happens when a snapshot is missing?

Options:
- Dated rules table compiled into the engine
- Per-market snapshot (raw Gamma plus CLOB market JSON) stored per condition_id by a backfill, plus V4 rawJson
- Missing snapshot: dated fallback with a flag
- Missing snapshot: skip the market

**Recommended:** Snapshot table per condition_id (producer backfill plus V4). Use the dated fallback when it is missing, marked rulesSource=fallback. tick_size_change events override in force. rulesVersion travels in the job and is stored on the run. Aggregation does not pool across fee eras.

Why: telonex_markets has no rules columns, and the Rust rules are hardcoded and marked 'not verified'.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D22. When the docs and observed data disagree on a fee era (formula, rate, start date), which one wins?

Options:
- Docs
- Charged amounts (on-chain fills or Data API usdc_size)

**Recommended:** Charged amounts. Update the dated table and docs/polymarket/index.md to match. Realistic cannot become default until a sample from every era matches to the rounding unit.

Why: The docs and Rust already disagree on era 1, era 2 and the boundaries, and WS fee_rate_bps was 0 on every print in a fee-charging era.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D23. In the realistic profile, what happens to resting orders and in-flight intents at the end of the window, and may plugins see pre-window ticks?

Options:
- Copy TS (everything freezes at the window edge)
- Strategy called only inside the window; keep matching already-submitted orders until endMs, then expire everything; plugins observe pre-window ticks without strategy calls

**Recommended:** The second option, applied identically to every input mode, the simulator and live.

Why: TS gates differently per mode (V4 not gated, while the simulator gates V4), so backtest, simulator and live disagree today.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D24. Research backtests over markets we traded live: use books with our own orders removed, or leave those markets out?

Options:
- Use de-contaminated books everywhere
- Exclude own-activity markets from research
- De-contaminated for calibration; excluded from research universes by default

**Recommended:** De-contaminated for calibration. Exclude own-activity markets from research by default, and flag them in the catalog.

Why: Our own prints would otherwise count as market flow and fill the simulated order a second time.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D25. Who sends split, merge and redeem transactions in the Rust live runtime?

Options:
- Rust (alloy plus a relayer port)
- TS sidecar called through an async request and response

**Recommended:** TS sidecar for the on-chain tx. Rust models split and merge as async operations with latency and success or failure events, identical in paper and backtest.

Why: The relayer SDK exists only in TS, and the core must not block on chain calls.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D26. Live journal format?

Options:
- New ad-hoc JSONL
- Recorder V4 envelope (schemaVersion 4) extended with account, REST, timer and operator-command sources, plus an execution sidecar

**Recommended:** The extended V4 envelope, with a minimal V4/journal reader in the paper-mode milestone. Journal raw frames, rules, REST request and response pairs with send and ack times, clock-offset samples, binary sha, params, profile and seed.

Why: One Rust reader then replays both worker-2 recordings and live journals, and journal replay is the M7 proof.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D27. Which clock drives ctx.now in live and recorded or journal replay?

Options:
- Exchange timestamp
- Local receive time, with the exchange timestamp exposed separately

**Recommended:** Local receive time whenever the input has it (Telonex keeps the exchange time). GTD and expiry are checked against the estimated exchange time (local minus measured skew), and the skew is journaled at startup.

Why: Today live mixes exchange timestamps and Date.now(), and the Rust tick has no rule for which one drives decisions.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D28. Rust paper mode: simulate fills, or record decisions only?

Options:
- Simulate fills with the realistic profile
- Decisions only, like the TS dry-run

**Recommended:** Simulate fills with the realistic profile; decision-only mode as a flag.

Why: The TS dry-run never fills, splits or expires orders, so it is useless as a reference.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D29. At startup or after a crash, what happens to open orders and positions from a previous instance in the current market?

Options:
- Cancel orders and adopt positions read-only (flagged)
- Adopt orders and positions

**Recommended:** Cancel (cancel_market for the current condition ids), journal it, adopt positions read-only and flag them.

Why: Strategy state is lost on restart, so adopted orders would be invisible to the decision logic.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D30. Turn on the CLOB heartbeat dead-man switch, and enforce a single owner per API key?

Options:
- Heartbeat off
- Heartbeat on in real-order mode only, with a lockfile enforcing one process per key

**Recommended:** On in real-order mode only, with one owner per key enforced by a lockfile. Paper mode never sends heartbeats. Heartbeat-caused cancels map to order_done with a cause.

Why: Heartbeats are chained per key, and a missed one cancels all of that user's orders, including another bot's.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D31. What is live available cash?

Options:
- Virtual 500 USDC per market (as in TS)
- min(configured per-market allocation, CLOB collateral balance minus reservations across all still-open markets)

**Recommended:** The min() rule. Backtests keep isolated per-market capital equal to the same allocation. Also add session-level guards that do not reset on market rotation (session loss including settlement, wallet exposure, order-rate cap, kill switch), and fills are never dropped.

Why: A $100 wallet partly locked in unredeemed markets cannot back a 500 USDC virtual budget.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D32. Live behavior when the strategy panics (backtest: candidate-level failure row)?

Options:
- Skip that callback and continue (TS behavior)
- cancel_all for that market, stop calling the strategy until the next rotation, alert

**Recommended:** cancel_all, halt until rotation, alert.

Why: Continuing with a strategy whose state is corrupt while orders rest is the riskiest option.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D33. Which alert channel does the live runtime use?

Options:
- macOS notifications or SwiftBar only
- Phone push (Telegram bot or ntfy)
- Email

**Recommended:** Phone push plus a SwiftBar status line. Alert on kill switch, session loss stop, WS gap over a threshold, heartbeat failure, reconciliation mismatch, strategy panic and rejected-order bursts.

Why: No alerting exists today, and an unattended live run with real money needs one.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D34. How is the ~$100 calibration budget split, and what loss stops the run?

Options:
- Equal split
- Rules and latency $5 / taker $25 / maker $30, stop at $60 cumulative loss, over 2-4 days of worker-2-recorded BTC 5m/15m markets

**Recommended:** $5 / $25 / $30 with a $60 stop. Day 0 is rules probes (GTD lead, taker delay, tick, minimum sizes, post-only, batch cap), using non-marketable or $1 orders.

Why: Paired or round-trip probes remove directional variance, so loss budget and sample size are the binding limits.

Decision: Accepted as recommended (user, 2026-10-08): ~$5 rule probes / $25 taker / $30 maker, automatic stop at $60 loss; the user launches the bot, the agent never places real orders.

## D35. Which frozen pass thresholds make `realistic` the default profile?

Options:
- Judgment after looking at results
- Pre-registered thresholds frozen before the live run

**Recommended:** Accept/reject agreement >= 99%. Fee error 0 at 1e-6 USDC. FOK/FAK agreement >= 95%. At least 90% of taker fills at the same VWAP, with mean |error| <= 0.25 tick. Maker filled-share ratio within [0.8, 1.25] at 95% CI. Median time to fill within ±30%. Per latency component: |median bias| <= 10 ms and p90 within ±20% (n >= 200). Pinned PnL error <= 0.5 cents per share, with a CI containing 0. The result applies only within the calibrated validity envelope (sizes up to ~10 shares, BTC, that host).

Why: Pre-registration prevents moving the goalposts, and $100 cannot validate size effects or edge.

Decision: Accepted as recommended (lead, 2026-10-08; user may change at gate 1).

## D36. Which machine hosts implementation, builds, parity runs and benchmarks?

**Decision (user, 2026-10-09):** worker-1 (Mac mini M4, 4P+6E, 16 GB, 77 GB free, all 31,186 BTC 15m telonex-delta files and Binance day files present, Claude Code installed). The MacBook has only 2.6 GB free disk. The goal session runs on worker-1 in its own checkout; Rust toolchain 1.89.0 is installed there via rustup (user-level). The fleet worker and Global Runtime on worker-1 are paused while benchmarks run.

## D37. Capture per-market exchange rules before gate 2?

**Decision (user, 2026-10-09):** yes. A small, engine-independent capture script (Gamma/CLOB rules before each market starts) is merged to main on its own and runs on worker-1, writing local files imported into the rules table in M3a. One-time exception to "main untouched until gate 2".

## D38. BTC 5m data for parity?

**Decision (user, 2026-10-09):** the Telonex subscription has expired, so no new Telonex sync now. Gate 2 covers BTC 15m only (existing local data). BTC 5m parity and the Telonex trades follow-up wait until the user renews the subscription; Recorder V4 recordings are unaffected.

## D39. When do AI protocols move to authoring Rust strategies?

**Decision (user, 2026-10-09):** right after M6 (fleet integration), in parallel with live/calibration work, so the fleet-wide speedup arrives sooner.

## D40. lagsnipe.v15 source

**Decision (lead, 2026-10-09):** port from the built artifact `304eceb3…` (complete and readable); no user input needed.
