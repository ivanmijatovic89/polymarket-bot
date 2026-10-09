# 02 — Decision log

Entries D01–D35 come from the requirements sweep
(native/spec/research/requirements-sweep.json); D36+ were decided on
2026-10-09. **Status: frozen at gate 1 (D56).** "user" = decided by the user;
"lead" = decided by the lead, binding unless the user changes it. A new
decision or a change is a new entry (00 §3.2); an amendment that replaces a
decision line names the entry that caused it. Options and recommendations are
kept as the historical record; the **Decision** line is normative.

## D01. Start the new goal on a fresh branch and worktree from the current main, or continue the rust-engine WIP branch?

Options:
- Continue the WIP branch (fef5f199) and fix it until it compiles
- Fresh branch from main, spec committed first. Freeze the WIP branch as a read-only reference and port only reviewed pieces (fixed.rs, slug.rs, the telonex reader, parity tooling, golden fixtures).
- Fresh branch, ignore the WIP entirely

**Recommended:** Fresh branch from main with the spec committed first. Keep the WIP frozen as a reference and cherry-pick only reviewed modules and test fixtures.

Why: The WIP does not compile and was built against an incomplete spec (HashMap iteration, OS libm, env-read latencies, missing order states and rules snapshot). Main has also moved by 18 engine commits. Its fixed-point, slug and reader code and its TS-generated goldens are still useful test assets.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D02. How is the autonomous goal bounded: a wall-clock limit (e.g. 10 h), per-milestone time boxes, or user review gates?

Options:
- Global wall-clock limit
- Per-milestone time boxes
- No time limit; milestone proofs plus explicit user gates, with every milestone resumable from STATUS.md by a fresh session

**Recommended:** No time limit. User gates after spec freeze, after M2 parity, before realistic becomes default, and before any real order. Each milestone ends with a demo command, a commit and a STATUS.md entry that a new session can resume from.

Why: The user considers the 10 h limit unnecessary. The scope is multi-week, and decision gates prevent drift better than timers.

Decision: Accepted as recommended (2026-10-08): no wall-clock limit; user gates after spec freeze, after M2 parity, before realistic becomes default, before any real order. Amended (user, 2026-10-09): each goal-session run lasts at most 8 hours and then pauses, never stops or abandons; the user resumes it, and the new run resumes from STATUS.md (01 §9.4). Gate 1 was delegated to the lead (D56).

## D03. Integration strategy: one long-lived branch with a final PR, or incremental merges to main behind flags?

Options:
- Single PR at the end; switch the fleet to the branch for M5
- Incremental PRs to main: contract schemas, DB migrations, an inactive native worker shim and native queue, then the engine crates. Native dispatch disabled by default.

**Recommended:** Incremental, inactive by default. The fleet never switches branch. If a switch is ever needed, use the pause-GR, drain, switch, test, switch-back, resume runbook.

Why: GR daemons and pte run from the worker checkouts. Branch workers die on main-SHA jobs. Main changes weekly, and a 10k+ line PR cannot be reviewed.

Decision: Separate branch until gate 2 (parity proven); main untouched until then; parity runs locally, no fleet branch switch; after gate 2 one merge to main, then small PRs. Branch regularly syncs main (user, 2026-10-08). "Locally" means on worker-1 (D36); the branch has a draft PR that is never merged before gate 2 (D48); the rules-capture script is the one exception to "main untouched" (D37).

## D04. What happens to the TS engine during and after the migration?

Options:
- Keep evolving TS freely; re-check parity occasionally
- Pin a TS oracle commit per parity cycle; every engine-semantics PR on main must add an exerciser case or a PARITY.md entry; after acceptance, freeze TS to bug fixes and build new features Rust-first
- Delete TS after acceptance

**Recommended:** Pinned oracle plus a parity-entry rule during the migration. After acceptance, TS is frozen to bug fixes, new engine features are Rust-first, and a sunset review is set for a fixed date.

Why: A moving oracle makes ts-compat parity unverifiable, and maintaining two engines indefinitely doubles every feature.

Decision: Accepted as recommended (2026-10-08). Freeze point, exception and review date: D49.

## D05. Calibration needs real orders, and the TS live bot is blocked by CLOB V2 (#249). Which pieces move from stretch into core?

Options:
- Keep the CLOB V2 adapter and Recorder V4 input as stretch; calibration is outside this goal
- Promote Recorder V4 input only; calibrate later
- Promote both: Rust CLOB V2 adapter (user-activated only) and V4 input as hard prerequisites of a calibration milestone
- Fix TS #249 and calibrate with the TS bot

**Recommended:** Promote both. Change rule 8 to: the agent never places real orders, and the user launches calibration with an explicit flag and a compile-time feature.

Why: Client-side latency must be calibrated on the stack that will trade. Same-day calibration needs V4 (Telonex data lags 3+ days and has no trade prints), and fixing the TS bot would mean calibrating twice.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56). Refined by D44 (two builds).

## D06. Which markets must native v1 support?

Options:
- BTC 15m only
- BTC 5m + 15m
- Every symbol and timeframe Telonex has

**Recommended:** BTC 5m + 15m guaranteed (parity, benchmark, calibration). Other symbols and timeframes are accepted when data and feeds exist, but are flagged 'unvalidated' in the run row.

Why: Recorder V4 and calibration are BTC-only. Rules, feeds and Chainlink coverage differ per symbol.

Decision: BTC 5m and BTC 15m only for the start (user, 2026-10-08). Gate 2 parity covers BTC 15m only (D38).

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

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D09. Should every result-affecting setting be stored as structured engine provenance per run instead of being re-parsed from the cmd string?

Options:
- Keep parsing cmd
- Indexed `engine` column ('ts' | 'native-ts-compat' | 'native-realistic') plus engine_version, engine_commit, binary sha and a versioned `model_config` JSON column (latencies, jitter, seed, gap thresholds, PTB latency, rulesVersion, fill model, per-market starting capital)
- Fully normalized columns

**Recommended:** Indexed `engine` plus `engine_version` plus a `model_config` JSON column, via a hand-written migration mirrored in the dashboard schema. The producer resolves ModelConfig and the job carries it, and the binary never reads env for behavior. The output echoes engineVersion, profile and seed, and TS asserts they match the request. Extend inherits and enforces equality. The dashboard flags comparisons across engines.

Why: Worker .env files can silently change results today, a silent profile fallback is undetectable, and agents would compare TS, ts-compat and realistic numbers as if they were equal.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D10. The dashboard Market Simulator and native runs: block them now, or have Rust emit the simulator trace format now?

Options:
- Block native runs with a clear message (TS guard in resolveMarket)
- Implement the simulator TraceSink in this goal

**Recommended:** Block now. Make the simulator trace format a TraceSink in the milestone after parity.

Why: Today a native run either throws or silently replays a TS registry strategy with the same id and labels it as that run.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D11. Where are per-order and per-fill records and live per-market results stored?

Options:
- Gzipped JSONL ledger in R2 per run and slug
- New MySQL fill and order tables
- Live and paper windows stored as normal backtest_runs rows with input_mode='live' or 'paper'

**Recommended:** Opt-in ledger as gzipped JSONL in R2, plus live and paper windows as backtest_runs rows with input_mode='live' or 'paper', so live and backtest can be compared per slug with existing tools.

Why: Calibration needs order and fill granularity. Adding a MySQL fill table to a 7.6 GB table set is expensive.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D12. How are native market jobs gated and dispatched on the fleet?

Options:
- Keep the producer git-SHA gate on the shared queue
- Separate native queue; gate on worker shim version, protocolVersion, jobSchemaVersion and target triple; producer SHA and dirty flag kept as provenance only

**Recommended:** Separate native queue with version and target gates. v1 is aarch64-apple-darwin only, and workers refuse other targets. Keep the commit gate on aggregate jobs and TS jobs.

Why: The engine travels inside the hash-verified binary. The SHA gate forces branch switches and stalls the fleet on local branches.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D13. Shared candidate replay: how is a group stored and attributed?

Options:
- One run row with N candidates
- N backtest_runs rows (own submission_uid, shared batch_uid, new candidate_group_uid and candidate_index columns) written by one group aggregate job

**Recommended:** N rows written by one group aggregate, one transaction per run, idempotent per submission_uid. A candidate's strategy panic fails only that candidate; data and IO errors retry the market job. durationMs per candidate = group wall time / N, eventsProcessed = the full count, and every candidate gets the group's start and finish times. Each row's cmd is standalone-equivalent, and standalone --extend of one candidate must reproduce the group result.

Why: Existing dashboard, protocol tools, extend and walk-forward all key on run id and params. The leaderboard and wall clock must not count compute time N times.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56). Refined in 41 §7.4 (left to that document by D56): per-candidate `durationMs` = `floor(w × job interval / k)` for a job admitted with token weight `w`, which equals "group wall time / N" when `w = 1`.

## D14. What is the group submission syntax, and what do execution-model variants and mixed feed requirements do?

Options:
- `--candidates <file.json>` (explicit list, or {base, sweep, mode: coordinate|cartesian})
- `--param-grid` inline
- Mixed feed requirements: reject
- Mixed feed requirements: split automatically into sub-groups

**Recommended:** `--candidates <file.json>`. Reject duplicate normalized params and mixed feed or eligibility requirements in v1. Also allow candidates that differ only in ModelConfig (fill model, queue parameter, latency calibration id) for internal calibration and A/B use. One shared per-market seed derived from (run seed, slug).

Why: Calibration and the realistic A/B reports need execution variants on one market read. Mixed feeds change the eligible universe.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

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

Decision: Not in this goal (user, 2026-10-08). Timing amended by D39 (user, 2026-10-09): protocols move to Rust strategies right after M6, as milestone M11 (01 §6). The build-outside-the-sandbox design and the SDK-re-exports-only crate rule stand.

## D17. Artifact identity and trust: is the sha of a binary built on any machine acceptable, and what must hold before the live runtime loads a binary?

Options:
- Binary sha from any machine plus a source_hash for dedupe
- Only one canonical builder publishes
- Live requires a clean recorded commit, engine at or above the live-safe minimum, and a verified reproducible rebuild to the same sha

**Recommended:** Any machine with path remapping (--remap-path-prefix, pinned toolchain, --locked, one profile, ad-hoc codesign after strip), identity = binary sha, plus source_hash, target, rustc and engine commit columns. Live requires a reproducible rebuild from a clean commit that matches the sha.

Why: A test build contained 74 absolute /Users paths. A binary cannot be reviewed the way a 30 KB TS bundle can, so a reproducible rebuild is the only way to review it.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56). Refined by D44: the live real-order build is a separate variant linked by source hash (31 §5.5, §10).

## D18. Which build profile do strategy artifacts use?

Options:
- Fast: lto=false, codegen-units=16, panic=unwind, overflow-checks=true
- Current: thin LTO, cgu=1

**Recommended:** Fast profile for check, iterate and publish alike. Revisit only if the M5a benchmark shows replay CPU rather than parquet IO dominates.

Why: Measured warm rebuild 0.84 s vs 7.3 s. catch_unwind requires unwind, and overflow checks guard the fixed-point money math.

Decision: Amended at G1 (lead, 2026-10-09): the fast D18 profile (`iterate`, 31 §4.1) is used only for local checks and iteration. Every published, fleet and live binary uses the fastest-running reproducible profile (`artifact`) that the M5a measurement finds (16 §11.2, 31 §4.6), provided outputs stay byte-identical and rebuilds reproducible (D17). Build time is reported, not gated, until M11 sets a rebuild-time limit for agent authoring. `panic = "unwind"` and overflow checks stay in both profiles. Answers 31 Open question 3 (publish profile) and 12 Open question 2 (speed vs rebuild time).

## D19. Plugin scope of the first SDK release, and how TechnicalIndicators works when it is ported.

Options:
- Port all five plugins now
- Ship ExternalFeeds, DwellGate and TimeWindowGate; defer TA and Volatility
- TA candles from local Binance aggTrades files
- TA strategies stay on the TS engine

**Recommended:** Ship the three plugins that active authors use. When TA is ported, build candles from local aggTrades (extended preflight lookback), with no network calls inside the binary.

Why: Only inactive SplitSellRedeem.v5.x uses TA and Volatility, and TS TA fetches REST klines with a wall-clock wait, which is nondeterministic.

Decision: Amended at G1 (lead, 2026-10-09; project direction): all four plugins ship in v1 (TimeWindowVolatility, TechnicalIndicators, DwellGate, TimeWindowGate); the engine's feed view replaces the TS ExternalFeeds plugin (14 P-4). TechnicalIndicators builds candles from local Binance aggTrades with an extended preflight lookback and makes no network calls (14 §12.5).

## D20. Should a Rust port of a TS strategy keep the TS id, or get a distinct one?

Options:
- Same id, distinguished only by the engine column
- Distinct id (e.g. `overnight-opus55-lagsnipe.v15.rs`)

**Recommended:** Distinct id, and also store the engine and profile on the run row.

Why: The dashboard and protocol tools group by `strategy`, so a shared id would mix engines.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D21. Where do backtests get per-market ExchangeRules (tick, min size, fee schedule, taker delay, negRisk, version), and what happens when a snapshot is missing?

Options:
- Dated rules table compiled into the engine
- Per-market snapshot (raw Gamma plus CLOB market JSON) stored per condition_id by a backfill, plus V4 rawJson
- Missing snapshot: dated fallback with a flag
- Missing snapshot: skip the market

**Recommended:** Snapshot table per condition_id (producer backfill plus V4). Use the dated fallback when it is missing, marked rulesSource=fallback. tick_size_change events override in force. rulesVersion travels in the job and is stored on the run. Aggregation does not pool across fee eras.

Why: telonex_markets has no rules columns, and the Rust rules are hardcoded and marked 'not verified'.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56). Amended by D51: realistic runs across fee eras are allowed by default, with per-era statistics.

## D22. When the docs and observed data disagree on a fee era (formula, rate, start date), which one wins?

Options:
- Docs
- Charged amounts (on-chain fills or Data API usdc_size)

**Recommended:** Charged amounts. Update the dated table and docs/polymarket/index.md to match. Realistic cannot become default until a sample from every era matches to the rounding unit.

Why: The docs and Rust already disagree on era 1, era 2 and the boundaries, and WS fee_rate_bps was 0 on every print in a fee-charging era.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56). Charged-amount source: D53.

## D23. In the realistic profile, what happens to resting orders and in-flight intents at the end of the window, and may plugins see pre-window ticks?

Options:
- Copy TS (everything freezes at the window edge)
- Strategy called only inside the window; keep matching already-submitted orders until endMs, then expire everything; plugins observe pre-window ticks without strategy calls

**Recommended:** The second option, applied identically to every input mode, the simulator and live.

Why: TS gates differently per mode (V4 not gated, while the simulator gates V4), so backtest, simulator and live disagree today.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D24. Research backtests over markets we traded live: use books with our own orders removed, or leave those markets out?

Options:
- Use de-contaminated books everywhere
- Exclude own-activity markets from research
- De-contaminated for calibration; excluded from research universes by default

**Recommended:** De-contaminated for calibration. Exclude own-activity markets from research by default, and flag them in the catalog.

Why: Our own prints would otherwise count as market flow and fill the simulated order a second time.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D25. Who sends split, merge and redeem transactions in the Rust live runtime?

Options:
- Rust (alloy plus a relayer port)
- TS sidecar called through an async request and response

**Recommended:** TS sidecar for the on-chain tx. Rust models split and merge as async operations with latency and success or failure events, identical in paper and backtest.

Why: The relayer SDK exists only in TS, and the core must not block on chain calls.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D26. Live journal format?

Options:
- New ad-hoc JSONL
- Recorder V4 envelope (schemaVersion 4) extended with account, REST, timer and operator-command sources, plus an execution sidecar

**Recommended:** The extended V4 envelope, with a minimal V4/journal reader in the paper-mode milestone. Journal raw frames, rules, REST request and response pairs with send and ack times, clock-offset samples, binary sha, params, profile and seed.

Why: One Rust reader then replays both worker-2 recordings and live journals, and journal replay is the M8 proof (M7 delivers the reader foundation).

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D27. Which clock drives ctx.now in live and recorded or journal replay?

Options:
- Exchange timestamp
- Local receive time, with the exchange timestamp exposed separately

**Recommended:** Local receive time whenever the input has it (Telonex keeps the exchange time). GTD and expiry are checked against the estimated exchange time (local minus measured skew), and the skew is journaled at startup.

Why: Today live mixes exchange timestamps and Date.now(), and the Rust tick has no rule for which one drives decisions.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D28. Rust paper mode: simulate fills, or record decisions only?

Options:
- Simulate fills with the realistic profile
- Decisions only, like the TS dry-run

**Recommended:** Simulate fills with the realistic profile; decision-only mode as a flag.

Why: The TS dry-run never fills, splits or expires orders, so it is useless as a reference.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D29. At startup or after a crash, what happens to open orders and positions from a previous instance in the current market?

Options:
- Cancel orders and adopt positions read-only (flagged)
- Adopt orders and positions

**Recommended:** Cancel (cancel_market for the current condition ids), journal it, adopt positions read-only and flag them.

Why: Strategy state is lost on restart, so adopted orders would be invisible to the decision logic.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D30. Turn on the CLOB heartbeat dead-man switch, and enforce a single owner per API key?

Options:
- Heartbeat off
- Heartbeat on in real-order mode only, with a lockfile enforcing one process per key

**Recommended:** On in real-order mode only, with one owner per key enforced by a lockfile. Paper mode never sends heartbeats. Heartbeat-caused cancels map to order_done with a cause.

Why: Heartbeats are chained per key, and a missed one cancels all of that user's orders, including another bot's.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D31. What is live available cash?

Options:
- Virtual 500 USDC per market (as in TS)
- min(configured per-market allocation, CLOB collateral balance minus reservations across all still-open markets)

**Recommended:** The min() rule. Backtests keep isolated per-market capital equal to the same allocation. Also add session-level guards that do not reset on market rotation (session loss including settlement, wallet exposure, order-rate cap, kill switch), and fills are never dropped.

Why: A $100 wallet partly locked in unredeemed markets cannot back a 500 USDC virtual budget.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D32. Live behavior when the strategy panics (backtest: candidate-level failure row)?

Options:
- Skip that callback and continue (TS behavior)
- cancel_all for that market, stop calling the strategy until the next rotation, alert

**Recommended:** cancel_all, halt until rotation, alert.

Why: Continuing with a strategy whose state is corrupt while orders rest is the riskiest option.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56).

## D33. Which alert channel does the live runtime use?

Options:
- macOS notifications or SwiftBar only
- Phone push (Telegram bot or ntfy)
- Email

**Recommended:** Phone push plus a SwiftBar status line. Alert on kill switch, session loss stop, WS gap over a threshold, heartbeat failure, reconciliation mismatch, strategy panic and rejected-order bursts.

Why: No alerting exists today, and an unattended live run with real money needs one.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56). The push provider is a gate-4 question (01 §12.1 item 5). Scheduling (50 §15): push alerts and `status.json` cover supervision through calibration; the SwiftBar status line and the daily summary follow after G3.

## D34. How is the ~$100 calibration budget split, and what loss stops the run?

Options:
- Equal split
- Rules and latency $5 / taker $25 / maker $30, stop at $60 cumulative loss, over 2-4 days of worker-2-recorded BTC 5m/15m markets

**Recommended:** $5 / $25 / $30 with a $60 stop. Day 0 is rules probes (GTD lead, taker delay, tick, minimum sizes, post-only, batch cap), using non-marketable or $1 orders.

Why: Paired or round-trip probes remove directional variance, so loss budget and sample size are the binding limits.

Decision: Accepted as recommended (user, 2026-10-08): ~$5 rule probes / $25 taker / $30 maker, automatic stop at $60 loss; the user launches the bot, the agent never places real orders. No self-trade probe (D54); a maker-budget extension is a gate-4 question (01 §12.1 item 8).

## D35. Which frozen pass thresholds make `realistic` the default profile?

Options:
- Judgment after looking at results
- Pre-registered thresholds frozen before the live run

**Recommended:** Accept/reject agreement >= 99%. Fee error 0 at 1e-6 USDC. FOK/FAK agreement >= 95%. At least 90% of taker fills at the same VWAP, with mean |error| <= 0.25 tick. Maker filled-share ratio within [0.8, 1.25] at 95% CI. Median time to fill within ±30%. Per latency component: |median bias| <= 10 ms and p90 within ±20% (n >= 200). Pinned PnL error <= 0.5 cents per share, with a CI containing 0. The result applies only within the calibrated validity envelope (sizes up to ~10 shares, BTC, that host).

Why: Pre-registration prevents moving the goalposts, and $100 cannot validate size effects or edge.

Decision: Accepted as recommended (lead, 2026-10-08; confirmed at G1, D56). Proposed additions (feed-leg p99, settlement components, C9/C10, Telonex verdict) are a gate-4 question (01 §12.1 item 7).

## D36. Which machine hosts implementation, builds, parity runs and benchmarks?

**Decision (user, 2026-10-09):** worker-1 (Mac mini M4, 4P+6E, 16 GB, 77 GB free; all 31,186 BTC 15m telonex-delta files and the Binance day files present; Claude Code and Rust 1.89.0 via user-level rustup installed). All implementation, builds, parity runs and benchmarks run there, in the separate clone `/Users/worker-1/Sites/polymarket-bot-native`, never in the fleet's working copy `/Users/worker-1/Sites/polymarket-bot`. Data and `node_modules` MAY be symlinked from the fleet copy and are used read-only. The MacBook (m1-ivan, 2.6 GB free) is not used for engine work. worker-1 stays a fleet worker (markets and aggregate queues, concurrency 6) and runs Global Runtime sessions: dev builds may run alongside; benchmarks need both paused first (D47; pause GR runs before stopping any daemon, never kill in-flight sessions). Host rules: 01 §8.1.

## D37. Capture per-market exchange rules before gate 2?

**Decision (user, 2026-10-09):** yes. A small, engine-independent capture script (Gamma/CLOB rules before each market starts, 11 §13.2.1) is merged to main on its own (normal PR, CI green, merge) and runs on worker-1, writing local JSONL files that M3a imports into the rules table. One-time exception to "main untouched until gate 2". Delivered as M1 step 0 (01 §6). Answers 40 Open question 5.

## D38. BTC 5m data for parity?

**Decision (user, 2026-10-09):** the Telonex subscription has expired, so no new Telonex sync now. Gate 2 covers BTC 15m only (existing local data). BTC 5m telonex-delta parity and the Telonex trades follow-up (F2) wait until the user renews the subscription; Recorder V4 recordings are unaffected (BTC 5m is also covered by the V4 cell in M7). The agent never runs the production data pipeline. Answers old 01 Open question 5.

## D39. When do AI protocols move to authoring Rust strategies?

**Decision (user, 2026-10-09):** right after M6 (fleet integration), in parallel with live/calibration work, so the fleet-wide speedup arrives sooner (was: after the whole goal). Milestone M11 (01 §6); amends D16.

## D40. lagsnipe.v15 source

**Decision (lead, 2026-10-09):** port from the built artifact `304eceb3…` (complete and readable, 60 §6.2); no user input needed. Answers old 01 Open question 4.

## D41. Tick interest filter for new Rust strategies?

**Decision (lead, 2026-10-09):** yes, opt-in in the first SDK release (16 §9.4 TF-1…TF-7, 30 §4.1). The in-repo ts-compat ports never declare it, and a declaring strategy must pass the with/without equality check of `strategy:check`. Answers 16 Open question 1.

## D42. FOK/FAK BUY sized in shares under realistic and live?

**Decision (lead, 2026-10-09):** converted to collateral at the limit price (shares × limit), so a fill below the limit can return more shares, as on CLOB V2; the RF04 report shows shares received vs requested. ts-compat keeps share sizing. Answers 10 Open question 1 (option a).

## D43. V4-only feeds (Binance bookTicker, Chainlink TWAP, opening-TWAP price to beat) for strategies?

**Decision (lead, 2026-10-09):** follow-up (01 §10 F7). Readers decode them; the SDK does not offer them in v1 (14 §7.4). Answers 14 Open question 3.

## D44. Real-order capability vs artifact identity

**Decision (lead, 2026-10-09):** two builds from the same source (option b). The `standard` build (fleet, backtest, paper, agents) contains no order-sending code and physically cannot place orders. The `real-orders` build is a separate feature build for live, built by the user on the live host, linked to the backtested binary by source hash and identical decisions on replayed markets, and never published to the fleet (31 §5.5, §10; 50 §17). Refines D05 and D17. Answers 20 Open question 1 and 31 Open question 4.

## D45. Who writes the independent spec-conformance tests?

**Decision (lead, 2026-10-09):** Fable, started automatically by the launcher right after gate 1, in its own checkout on worker-1 with the engine sources blocked (60 §10.0 C0, CF-2). Answers 60 Open question 2.

## D46. Derived fast tape; re-converting the dataset

**Decision (lead, 2026-10-09):** the derived local tape (16 §7.5) is allowed on worker-1 with a 40 GB cap from M1 step 7. Fleet-wide use needs the user's yes at gate 2 with measured numbers. The original telonex-delta files and their R2 copies are never re-converted (no format version 2). Answers 16 Open question 2, 15 Open question 1 and old 01 Open question 3.

## D47. Unattended benchmark windows

**Decision (lead, 2026-10-09):** benchmarks run unattended on worker-1 only between 01:00 and 07:00 local time, with worker-1's fleet worker drained and its Global Runtime runs paused first, and never while a live or paper session runs. The nightly canary and extras (60 OR-16, LG-5) use the same window. Dev builds, tests and parity runs may run at any time. Answers 16 Open question 3 and 60 Open question 3.

## D48. GitHub CI before gate 2

**Decision (lead, 2026-10-09):** `native-engine` is pushed with a draft PR titled "DO NOT MERGE before gate 2", so GitHub CI checks every push; main is untouched. No GitHub macOS runner per PR: Linux CI plus the local macOS gate (60 LG-1) and the fleet check (LG-4). Answers 60 Open questions 1 and 4.

## D49. TS engine freeze and retirement

**Decision (lead, 2026-10-09):** "acceptance" in D04 is gate 2. From the G2 merge the TS engine takes only bug fixes, except features the AI protocols need before they move to Rust, which also get a Rust version and a parity test. The TS retirement review (F4) is about three months after gate 3. Answers old 01 Open questions 8 and 9.

## D50. Production database migrations after gate 2

**Decision (lead, 2026-10-09):** the agent runs `npm run db:migrate` after each merged migration PR and reports the result. Only additive migrations (42 §2); anything that drops or rewrites data needs the user. Answers old 01 Open question 11.

## D51. Realistic runs across fee eras

**Decision (lead, 2026-10-09):** allowed by default, with per-era statistics and a mixed-fee-era badge (option c). Amends D21. Answers 42 Open question 1.

## D52. Pre-2026-08-17 taker-delay rows as evidence

**Decision (lead, 2026-10-09):** the realistic profile uses the third-party rows D0–D3 (11 §6.2) and flags affected markets (`unverifiedRules`); only markets from 2026-08-17 11:00 UTC on count as gate-3 evidence. Answers 11 Open question 1 (option b).

## D53. Source of charged fees for the fee study

**Decision (lead, 2026-10-09):** free path first (the Polymarket Data API research dataset, 11 §14.1). Buying Telonex data needs the user. Eras that stay unverified are marked "fee unverified" and do not count toward gate 3. Refines D22. Answers 11 Open question 2.

## D54. Orders that would cross our own resting orders

**Decision (lead, 2026-10-09):** blocked before sending, identically in realistic backtests, paper and live; no self-trade probe in the calibration (D34). ts-compat keeps TS behavior (13 TC-C14). The engine-origin reject reason is `SelfCross` (10 N6, §10.2; check in 12 §7.4), carried by the realistic fix RF14 (13 §7.1). Answers 13 Open question 1.

## D55. Fleet for M6

**Decision (lead, 2026-10-09):** worker-1, worker-2 (about 3 slots, so its Recorder V4 timing stays clean) and milan-m1 (inventory alias of machines.json `m1-milan`) if available. m1-ivan (the MacBook) takes no native market jobs and acts only as producer. Answers old 01 Open question 7 and 40 Open questions 2–3.

## D56. Gate 1

**Decision (user → lead, 2026-10-09):** the user delegated gate 1 to the lead (user asleep). The spec is frozen after this consolidation (tag `native-spec-g1`, 01 §6 M0), and M1 starts without waiting. The user reviews 03-overview-for-user.md in the morning and may still change any decision; a change becomes a new entry (00 §3.2), and only the steps that depend on it are redone. Lead entries D01–D35 are confirmed; new: D41–D55; amended: D02, D03, D04, D16, D18, D19, D21, D22 (and notes on D05, D06, D13, D17, D26, D33–D35). Questions deferred to gate 4 are listed in 01 §12. Open questions of other documents answered here:

| Question (topic) | Answer |
|---|---|
| 10 OQ1 (FOK/FAK share sizing) | D42 |
| 11 OQ1 (pre-08-17 taker delay), OQ2 (charged-fee source) | D52, D53 |
| 12 OQ2 (speed vs rebuild time); 31 OQ3 (publish profile) | D18 |
| 13 OQ1 (self-trade probe) | D54 |
| 14 OQ3 (V4-only feeds) | D43 |
| 14 OQ6 (feed p99); 51 OQ2 (settlement components), OQ5 (C9/C10, Telonex verdict) | gate 4 |
| 15 OQ1 (format v2) | D46 (never re-convert) |
| 16 OQ1 (tick filter), OQ2 (tape disk), OQ3 (benchmark windows) | D41, D46, D47 |
| 20 OQ1; 31 OQ4 (real-order build) | D44 |
| 22 OQ1; 31 OQ2; 42 OQ2 (R2 buckets and tokens) | gate 4; interim rule in 01 §12.1 item 1 |
| 40 OQ1 (branch-phase schema) | moot: no native persistence before M3a (01 §8) |
| 40 OQ2, OQ3 (worker-2 slots, m1-ivan jobs) | D55 |
| 40 OQ5 (rules capture) | D37 |
| 42 OQ1 (mixed fee eras) | D51 |
| 50 OQ1–OQ4, OQ7; 51 OQ1, OQ3, OQ4 (live and calibration choices) | gate 4 |
| 60 OQ1 and OQ4 (CI), OQ2 (conformance author), OQ3 (nightly runs) | D48, D45, D47 |

Questions not listed here stay with their owning documents and block only the steps that depend on them (00 §3.2).

## D57. Content of the ts-compat `ModelConfig` before M3b

**Decision (lead, 2026-10-09, first implementation run):** until M3b the
ts-compat `ModelConfig` carries only the TypeScript latency parameters of the
job (delay, jitter and the next-tick semantics of 13 §5.1). The model configs
`uncalibrated-2026-10` and `realistic-default` land with the realistic profile
in M3b; until then CI item 6 of 21 §3 checks only
`native/contract/model-configs/ts-compat-default.json`. Rationale: the
realistic sections cannot be validated before their models exist, and a
placeholder would be hashed into run provenance.
