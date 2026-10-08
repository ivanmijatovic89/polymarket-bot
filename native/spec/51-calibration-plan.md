# 51 — Calibration plan

This document specifies the ~$100 live calibration that validates the
`realistic` execution profile against real Polymarket executions. It defines
the prerequisites, the budget and stops, the probe designs, how the user
launches the run, how the live journal is joined with worker-2's Recorder V4
recording and the Telonex conversion of the same markets, how our own
orders are removed from those recordings, the analysis harness (pinned,
determinism and free-running modes), the metrics and the frozen thresholds
that decide, per input mode, whether `realistic` may become the default
profile (gate 3), and what $100 can and cannot calibrate. The live runtime it relies on is specified in
[50-live-runtime.md](50-live-runtime.md).

Normative keywords: MUST, SHOULD, MAY. Decisions referenced as Dnn are in
[02-decisions.md](02-decisions.md); this plan applies D05, D21, D22, D24,
D34 and D35 and does not reopen them.

## 1. Goal and non-goals

Goal: measure, with real orders at minimum sizes, the quantities the
realistic profile models (exchange rules, latency components, taker delay,
fees, taker fills, maker fills, settlement timing), fit a small number of
parameters, check that a free-running backtest of the probe strategy
reproduces what live did (Mode C, §11.3), and produce a versioned
calibration artifact plus a gate-3 report with one verdict per input mode
(recorder-v4/journal and telonex-delta, §12.4).

Non-goals: proving strategy edge or PnL significance; calibrating large
order sizes; calibrating any symbol other than BTC 5m/15m (D06).

The calibration is a measurement track, not a smoke test. Execution ground
truth comes only from raw exchange records (REST responses, user-WS frames,
REST trades, wallet activity), never from the bot's own accounting
(`research/approach-audit.json`, correctness judgment).

## 2. Roles and safety

- The **user** launches every real-order run and is the only person who
  builds or runs a binary with the `real-orders` feature (D05,
  50-live-runtime.md §17).
- The **agent** prepares the probe strategy, the config and the analysis
  code, rehearses everything in paper mode, and analyzes journals and
  recordings afterwards. It never places a real order and never starts a
  real-order run.
- **Gate 4** (G4, end of M9 in 01-scope-milestones.md) precedes the first
  real order: the user signs off the prerequisite checklist in §3 and the
  frozen pre-registration in §12. **Gate 3** (G3, end of M10) decides the
  default profile (§15).

## 3. Prerequisites

Every item MUST be done and its proof recorded in STATUS.md before gate 4,
except P13, which MUST exist before the gate 3 report.

| # | Prerequisite | Spec | Proof |
|---|---|---|---|
| P1 | Live runtime milestones M8 and M9 | 01-scope-milestones.md, 50-live-runtime.md §19 | 24 h paper run with replay identity; cross-artifact proof; golden vectors, mock-exchange tests, shadow mode |
| P2 | Recorder V4 input in Rust, incl. `last_trade_price`, `tick_size_change`, coverage gate | 15-inputs.md | V4 backtests of recorded BTC 5m/15m markets |
| P3 | Realistic profile: ExchangeRules snapshot, taker delay, queue-position FillModel with the cancel-ahead parameter, named LatencyModel components, settlement ReportModel | 11-exchange-rules.md, 13-execution-models.md | A/B reports per realistic fix |
| P4 | Analysis harness (§11: pinned Mode A, free-running Mode C, both input modes) with passing neutrality and sensitivity self-tests | this document | self-test report |
| P5 | Own-order removal (§10) | this document | unit tests on synthetic contamination |
| P6 | Probe strategy `calibration-probe.v1` (Rust, normal SDK) | §6 | ≥ 24 h paper rehearsal of all phases with budgets, tags and schedule checked |
| P7 | Fee ground truth for the current fee era: computed fee equals the charged fee to 1e-6 USDC on a historical sample (D22) | 11-exchange-rules.md | fee report |
| P8 | Wallet funded with ~$100 pUSD, approvals set, redeem verified on CLOB V2 (no split/merge needed by the probes) | 50-live-runtime.md §16 | balance-allowance read; one verified redeem |
| P9 | Hosts ready: worker-2 V4 coverage complete for both timeframes; automatic time on m1-ivan (or the chosen live host) and worker-2; fleet workers and GR stopped or capped on both | §7.1 | host checklist in the journal |
| P10 | Alerts and status file working | 50-live-runtime.md §15 | test push received |
| P11 | Live-vs-backtest decision parity baseline from ≥ 1 day of paper (probe strategy; lagsnipe.v15.rs as well once Chainlink paper is allowed, 50 §8.1 and Open question 7) | 50-live-runtime.md §13.5 | report |
| P12 | Pre-registration committed: thresholds (incl. C9/C10 and the telonex-delta rows), split rule, CI method, matching window, restore horizon, probe schedule, analysis code | §12 | commit sha written into the calibration config |
| P13 | Telonex-vs-V4 realism report: realistic on telonex-delta vs realistic on recorder-v4 on every worker-2 market both datasets cover (exerciser-realistic and lagsnipe.v15.rs): decision agreement, fill count, maker/taker split, per-market PnL delta with cluster-bootstrap CI. Moved from follow-up F2 into M7 (01 change requested, §17); at the latest it MUST exist before the G3 report | §12.4 | report |

## 4. Budget and stops (D34)

| Phase | Loss budget | Per-order cap | Notes |
|---|---|---|---|
| Rules + latency probes | $5 | GTC/GTD 5 shares; FAK $1 notional | expected cost < $2 |
| Taker probes | $25 | FAK/FOK legs ≤ 5 shares (≤ $5 notional) | ~$0.045 per fill at p ≈ 0.5 |
| Maker probes | $30 | 5 shares per order | ~$0.30 per fill (adverse selection) |
| **Global stop** | **$60 cumulative loss** | — | kill switch, state `halted` |

- Loss is the equity-based session loss of 50-live-runtime.md §10.3,
  measured from the baseline taken at calibration start. The session-risk
  ledger persists across restarts and days, so the $60 stop is cumulative
  over the whole calibration (50-live-runtime.md §10.5).
- Each order carries a probe tag (`rules`, `latency`, `taker`, `maker`,
  `maker-flatten`) in its meta. PnL is attributed to the tag of the order that
  opened the position. When a phase reaches its loss budget, that phase
  stops and the others continue; the global stop halts everything.
- `max_wallet_exposure_usdc` = $15 (open reservations plus cost of
  unresolved positions). The remaining ~$40 of the wallet is never at risk.
- Maker rebates, rewards and gas are reported separately and never offset
  the loss budget.

## 5. What the budget buys

| Measurement | Probe | Cost | Expected n | Resolves |
|---|---|---|---|---|
| Place/cancel latency components | far-from-touch 5-share post-only GTC, place then cancel | ~$0 | 2,000+ cycles | p50/p90/p99 per component |
| Taker delay, VWAP, fee, FOK/FAK outcomes | paired FAK BUY legs (§6.3) | ~$0.045 per fill | ~500 fills | p90; VWAP bias of ~0.1 tick |
| Maker fill/no-fill, filled-share ratio, time to fill | post-only 5-share pairs (§6.4) | ~$0.30 per fill | ~100 fills, 1,000+ episodes | filled-share ratio to about ±20% |
| Settlement (MATCHED → MINED → CONFIRMED) | every fill | free | ~600 | median and p90 |

Capital recycles every 5/15 minutes through resolution and redeem, so the
binding limits are the loss budget and directional variance. Paired legs
remove most of the variance (`sample-size-budget` in
`research/requirements-sweep.json`).

## 6. Probe designs

The probe strategy is an ordinary Rust strategy (30-strategy-sdk.md). It is
deterministic given its params, the calibration seed and the slug, so the
identical-decision replay of 50-live-runtime.md §13 covers it.

### 6.1 Day 0: rules probes (≤ $5, expected < $2)

Each rule is recorded as `verified` or `refuted` with the date and journal
evidence, and the result updates the rules table in 11-exchange-rules.md.
Rules that stay unverified remain flagged in the profile.

| # | Rule (docs or current model) | Probe | n |
|---|---|---|---|
| R1 | GTD expiration must be ≥ 3 min ahead | far GTD with expiration now+170 s (expect reject) and now+190 s (expect accept) | 5 each |
| R2 | GTD expires 60 s before its expiration | accepted far GTD; time of `CANCELLATION` vs expiration | 10 |
| R3 | Marketable orders on crypto up/down are held for the taker delay (150 ms since 2026-09-04), status `delayed`, not cancellable during it | marketable $1 FAK; POST status; ack → match interval; one cancel sent during the delay | 20 (shared with taker probes) |
| R4 | Non-marketable orders are not delayed | far post-only GTC returns `live` | from latency probes |
| R5 | Off-tick prices are rejected; `tick_size_change` changes the tick in force | off-tick far order; passive observation of tick changes, one far order at the new tick if one occurs | 5 |
| R6 | Minimums: 5 shares for GTC/GTD, $1 notional for FOK/FAK | 4.99 vs 5 shares; $0.99 vs $1 FAK | 3 each |
| R7 | FOK/FAK BUY is sized in pre-fee collateral; fee added on top; share amount truncated in 1e-6 units | compare received shares and cash delta with the shared ExchangeRules function | from taker probes |
| R8 | Post-only rejects when crossing, including at equality | post-only at the opposite best | 5 |
| R9 | Batch cap 15 | 15-order and 16-order batches of far post-only orders, then batch cancel | 2 each |
| R10 | Cancel responses (`canceled`, `not_canceled` reasons) for batch and market cancels | batch cancel with a missing id; market cancel | 5 |
| R11 | Heartbeat: orders cancelled 10–15 s after the last valid heartbeat | one far order, heartbeats paused for 30 s through the calibration-only operator command `heartbeat_pause` (50 §16, §8.2.9; real mode only, refused unless `calibration.allowHeartbeatPause = true`); cancel time and the `Canceled(HeartbeatLoss)` mapping (50 §8.2.4) | 3 |
| R12 | Minimum order age (`oas`) | cancel 0, 100 and 500 ms after ack | 5 each |
| R13 | Adapter facts (50-live-runtime.md Open question 6): order hash = `orderID`; meaning of `unmatched`; `matched_amount` units; heartbeat path | checked on every probe order | all |
| R14 | Fee formula and rounding equal the charged fee (D22) | every taker fill vs wallet activity | all taker fills |

### 6.2 Latency probes (rules + latency budget, ~$0)

- Order: post-only GTC BUY, 5 shares, at least 3 ticks below the best bid
  (reservation ≤ $0.25), on alternating outcomes.
- Cycle: place; wait for the REST ack, the user-WS `PLACEMENT`, and the
  `price_change` on our host's market WS that adds our size at our price;
  hold for a uniformly drawn 0.5–5 s; cancel; wait for the cancel ack,
  `CANCELLATION` and the book removal.
- Measured per cycle: decision → bytes written (client), write → REST ack,
  write → `PLACEMENT`, exchange timestamp of the inserting `price_change` −
  write time (exchange-visible placement), and the same three for the
  cancel.
- Rate: at most one cycle in flight per timeframe stream, about one cycle
  every 10 s, spread over all hours of each day. Target 2,000 cycles.
- **Transport A/B.** Cycles alternate HTTP/1.1 pool and single HTTP/2
  connection in a pre-registered interleave. The faster transport becomes
  the runtime default (50-live-runtime.md §18.3).
- These orders appear in worker-2's V4 book with known size, price and
  time. They are the ground truth for the own-order removal step (§10): its
  match precision and recall MUST be reported on them.

### 6.3 Taker probes ($25)

- Unit: a **pair** of FAK BUY orders, one per outcome, sent in the same
  callback, each sized to the same share count
  `N = max(2, ceil($1 / min(askUP, askDOWN)))` (amount per leg =
  N × ask). Windows where `min(ask) < 0.20` are skipped so N stays ≤ 5. A
  filled pair is a complete set: neutral direction, paid out at $1 per set.
- Variants, assigned by the seeded schedule:

| Variant | Price guard | Purpose | Share |
|---|---|---|---|
| T1 | best ask | touch fills, taker delay, fee | 50% |
| T2 | best ask + 2 ticks | multi-level sweeps, VWAP | 30% |
| T3 | FOK at best ask with size above top-level depth | kill outcome | 20% |

- A partial pair leaves an imbalance of at most N shares. It is flattened by
  FAK SELL once the shares are sellable (settlement gate,
  12-engine-core.md), unless less than 60 s remain in the window, in which
  case it is held to resolution.
- Expected: about $0.09 per pair (spread plus two fees at p ≈ 0.5), so about
  275 pairs and 550 taker fills for $25.

### 6.4 Maker probes ($30)

- Unit: a **pair** of post-only GTC BUY orders, 5 shares each, one per
  outcome.

| Variant | Price | Queue-ahead | Share |
|---|---|---|---|
| M1 join | best bid | displayed size | 40% |
| M2 improve | best bid + 1 tick (only if the spread ≥ 2 ticks) | 0 | 30% |
| M3 behind | best bid − 1 tick | displayed size of two levels | 30% |

- Horizon H ∈ {30 s, 120 s} (pre-registered mix). At H, or 60 s before the
  window end, unfilled remainders are cancelled.
- If both legs fill, the complete set is held to resolution. If one leg
  fills and the other has not by H, the other leg is cancelled and the
  filled shares are flattened by FAK SELL once sellable (tag
  `maker-flatten`, maker budget), unless less than 60 s remain.
- Every episode, filled or not, is a sample. Expected: about $0.30 adverse
  selection per filled 5-share order, so about 100 fills and more than 1,000
  episodes for $30.

### 6.5 Schedule

- Each window of each timeframe is assigned exactly one probe block
  (rules, latency, taker or maker) by a seeded draw from (calibration seed,
  slug). One block per market at a time means the probe's own orders never
  meet: the probe MUST NOT place an order that could cross its own resting
  order (self-trade behavior is undocumented, `research/early-audits.md` A9).
- Day 0: rules first, then latency. Days 1–3: latency 30%, taker 30%,
  maker 40% of windows. When a phase reaches its sample target (§5) or its
  loss budget, its weight is redistributed to the others in proportion.
- No new probe order in the first 5 s or the last 60 s of a window (except
  the R2 and flatten orders).
- Run length: 2–4 days of BTC 5m and 15m (D34), until all sample targets are
  met, the global stop trips, or the user stops it.

## 7. Run procedure

### 7.1 Before each day (operator checklist, journaled)

1. Pause GR runs, then stop GR and backtest workers on the live host and on
   worker-2, or cap them (`calibration-host-isolation` in the requirements
   sweep; fleet runbook in `docs/backtest/fleet/overview.md`). The V4
   recorder on worker-2 keeps running.
2. Confirm automatic time on both hosts and the V4 dashboard heartbeat for
   both timeframes.
3. Confirm the status file and a test push.

### 7.2 Launch (user only)

The user builds the `real-orders` variant on the live host with the
reproducible build (31-artifacts-build-publish.md §5.5), the TS launcher runs
the trust check (31 §10), and the binary starts as
`live --config <calibration config> --journal-dir <dir> --secrets-fd <n> --real-orders`
(20-binary-protocol.md §7). The calibration config holds the probe params,
budgets, `confirm_funder` and the pre-registration commit. The exact runbook
commands are written at M10 and checked at G4.

### 7.3 During the run

- Stops: global $60 stop, phase budgets, kill switch, alerts
  (50-live-runtime.md §10, §15). The user MAY stop and resume at any time;
  the session ledger persists.
- If V4 coverage on worker-2 has a gap, the operator SHOULD pause probes
  with the operator command `pause` (50 §16: from the next window on, new
  sessions run observe-only) and `resume` once coverage is back; affected
  markets are excluded from analysis anyway.
- After each day: per-market reconciliation report (50-live-runtime.md §14)
  and the join report (§9).

## 8. Data products

| Product | Source | Use |
|---|---|---|
| Live journal (inputs, execution records, clock and host samples) | live runtime | ground truth for orders, statuses, latencies |
| V4 packages of the same markets | worker-2 | books and trade prints for replay |
| Wallet activity (`usdc_size`, transaction hashes) | Data API, REST trades | fee and PnL ground truth |
| Join tables (orders, fills, prints, offsets, exclusions) | analysis harness | all metrics |
| Calibration artifact | analysis harness | committed file `native/calibration/<id>.json`, referenced by `execution.latency.calibrationId` (§13) |

## 9. Joining the journal with the recordings

- Scope: BTC 5m/15m markets that worker-2 recorded with complete V4
  coverage (`journal-v4-join` in the requirements sweep).
- Markets join on `condition_id`.
- Own trades join to V4 `last_trade_price` by `transaction_hash`. One print
  per transaction was measured (1,123 prints, 1,123 hashes in one 15m
  market), so the join is 1:1. V4 keeps transaction hashes and book hashes,
  but drops price_change hashes (`docs/datasets/recording/recorder-v4.md:230`).
- Book states align on book hash plus exchange timestamp.
- Clock offset per market = median of `receive_bot − receive_worker2` over
  identical public events (matched book hashes and transaction hashes). It
  absorbs both the clock difference and the network-path difference between
  the hosts; it is estimated, never assumed. Both values are in the join
  table.
- **Telonex-delta join.** The same markets are selected on Telonex only
  through the eligibility functions of `src/db/telonexMarkets.ts` (CLAUDE.md
  single-source rule). Telonex is exchange-clocked, so journal times map to
  it through the journal's exchange-time estimate (50 §5.3), and book states
  align by exchange timestamp. A market not eligible on Telonex by the G3
  report date is excluded from the telonex-delta rows only.
- A market is excluded when its coverage is incomplete, an own print cannot
  be matched, the offset is undefined (fewer than 20 identical events) or
  reconciliation failed (50-live-runtime.md §14). Exclusions are counted per
  reason and per input mode in the report.

## 10. Own-order removal (D24)

Recordings of markets we traded contain our own orders and prints. Without
removal, our prints would count as market flow and fill the simulated order
a second time, and our real taker orders would have consumed liquidity that
the simulated order needs.

1. **Prints.** For each own trade, find the V4 print by transaction hash and
   subtract our matched amount from it. The print is not deleted, because it
   can include other makers. (Telonex has no prints; step 1 does not apply.)
2. **Resting orders.** For each own order, find the `price_change` that
   inserted it: same asset, side and price, size increase ≥ our size, within
   `[send, send + max_placement_latency]` on the recording clock (send time
   mapped through the per-market offset on V4, through the exchange-time
   estimate on Telonex). From there, subtract our remaining size from that
   level until our order's cancel or final fill is observed the same way.
3. **Own taker consumption.** For each own taker match, the recording shows
   the consumed maker levels shrinking at the match. The removal restores
   our matched amount at each consumed level (price and size from the
   trade's `maker_orders[]`) from that decrease until the earliest of: the
   simulated own order consuming it, the level being emptied by others'
   trades, or `restore_horizon_ms` (pre-registered, default 2,000 ms, above
   the p99 placement latency). Without it, a simulated order that arrives
   later than the real one meets a book already depleted by our own real
   order. Every verdict also reports horizons 0 and 10,000 ms as
   sensitivity.
4. **Ambiguity.** If zero or more than one candidate event matches, the
   episode is flagged ambiguous and excluded.
5. **Catalog.** Markets with own activity are flagged in the market catalog
   and excluded from research universes by default (D24).

The step is deterministic, runs before any replay of a traded market, and
its precision and recall are measured on the latency probes (§6.2), per
input mode.

## 11. Analysis harness

### 11.1 Mode A: execution-pinned

The journaled intents are injected into the realistic simulator on the
decontaminated recording, with no strategy running
(`pinned-execution-harness` in the requirements sweep).

- **A1, arrival-pinned.** Each own order enters the simulated exchange at
  the recording position of its own insertion event (§10 step 2), and each
  own taker match at its print. Latency error is zero by construction, so A1
  isolates the fill model (queue, depletion, VWAP, partial fills). V4 only
  (Telonex has no prints to pin taker matches to).
- **A2, send-pinned.** Each intent enters at its journaled send time mapped
  to the recording clock, and the simulator samples the latency components
  from the model under test. A2 is the realistic profile as backtests use
  it.

The pinned verdict rows use A2. A1 is reported beside it to attribute each
error to the fill model or to the latency model.

### 11.2 Mode B: determinism

The probe strategy replays its own journal and MUST make identical decisions
(50-live-runtime.md §13). This proves determinism only; it is pass/fail and
gives no evidence about fill realism.

### 11.3 Mode C: free-running (end-to-end agreement)

Mode A pins the intents, so it cannot see the feedback in which fills change
later decisions (flatten legs, pending flags, capital). Mode C answers the
question the user cares about: if strategy S is backtested on market M, does
the backtest get what live got?

- The probe strategy `calibration-probe.v1` runs unpinned, with the live
  params and calibration seed, through the realistic simulator on the
  decontaminated recording of each live market, using the ModelConfig fitted
  on the fit half (§12.1); Mode C is evaluated on the evaluation half only.
  Its own simulated fills drive its later decisions.
- Scope: taker and maker blocks. Rules and latency blocks are excluded,
  because their decisions do not depend on fills and would inflate
  agreement.
- **Matching.** Per market, live intents (from the journal) and simulated
  intents are matched in time order when they have the same block, intent
  kind, outcome and side, a price within 1 tick, and
  |t_sim − t_live| ≤ `match_window_ms` after the §9 offset (pre-registered,
  default 1,000 ms). Each intent matches at most once.
- **Outputs per market:** recall (matched live intents / live intents),
  precision (matched simulated intents / simulated intents), fill agreement
  on matched orders (filled vs not, filled-quantity ratio), PnL error per
  share traded, and the first divergence with its cause (input difference,
  fill feedback, latency draw).
- **Context rows (reported, not thresholded).** The paper-vs-V4 free-running
  comparison of 50 §13.5 (P11) for the probe strategy and, once Chainlink
  paper is allowed (50 Open question 7), for lagsnipe.v15.rs. Paper fills are
  simulated, so these rows isolate host and input differences from execution
  effects.

### 11.4 Self-tests (MUST pass before any verdict)

- **Neutrality.** A synthetic "live" journal produced by the simulator itself
  on a V4 market, analyzed by the harness, shows zero error on every metric,
  in Modes A and C.
- **Sensitivity.** Adding +X ms to every placement in that synthetic journal
  measures +X ms (± 1 ms) in the placement component; removing a known
  fraction of fills is measured as that fraction; shifting the decision
  times by more than `match_window_ms` drops Mode C recall accordingly.

Precedent: `docs/datasets/price-feeds/parity-harness.md:69-77`.

### 11.5 Variants and readouts

- Execution variants (fill model, cancel-ahead value α ∈ {0, 0.5, 1},
  latency calibration id) run as one candidate group on one market read with
  one shared seed (D14, 41-candidate-groups.md).
- The queue model runs in prints mode on recorder-v4 (13 §6.5 Q4) and in
  no-prints mode on telonex-delta (13 §6.5 Q5). Two references are always
  included: `trade_through` (13 §6.5, the conservative reference variant)
  and the ts-compat worst-queue maker (13 TC-E5, the historical TS model).
- V4 readout: within hours of each live day.
- Telonex-delta readout: once the markets are eligible (3+ days,
  `TELONEX_DATASET_MIN_AGE_DAYS`), the same analysis runs on telonex-delta.
  It produces the telonex-delta verdict rows of §12.4; it is not
  information only. The G3 report therefore waits until the last
  calibration day's markets are eligible on Telonex.

## 12. Metrics and frozen thresholds (D35)

Everything in this section is pre-registered: committed before gate 4 with
its commit sha in the calibration config. A later change is reported as a
deviation next to the original result.

### 12.1 Statistical rules

- Unit of resampling: the market (episodes inside one market are
  correlated). 95% CIs come from a cluster bootstrap over markets, 10,000
  resamples, fixed seed.
- Fit/evaluate split: parameters are fitted on windows with an odd index in
  the run schedule and evaluated on even windows (controls for time of day
  and day). Both halves are reported; the verdict uses the evaluation half.
- Verdict per metric: PASS, FAIL, or INSUFFICIENT when n is below the
  minimum.

### 12.2 Thresholds

| # | Metric | Definition | Min n | Pass |
|---|---|---|---|---|
| **C9** | **Free-running decision agreement (Mode C, headline)** | recall and precision of §11.3 matching, pooled over evaluation markets | 50 markets with taker or maker blocks | both ≥ 90% (proposed, Open question 5) |
| **C10** | **Free-running PnL error (Mode C, headline)** | per market, (PnL_sim − PnL_live) / live shares traded | 50 markets | mean ≤ 1.0 ¢/share, 95% CI contains 0 (proposed, Open question 5) |
| C1 | Accept/reject agreement | share of orders where the simulator and live agree on accepted vs rejected and on the reject class | 1,000 orders | ≥ 99% |
| C2 | Fee exactness | per taker fill, \|computed fee − charged fee\| | all taker fills | 0 at 1e-6 USDC |
| C3 | FOK/FAK outcome | agreement on full / partial / killed | 200 orders | ≥ 95% |
| C4 | Taker VWAP | share of taker orders with identical VWAP; mean \|VWAP error\| in ticks | 200 orders | ≥ 90% and ≤ 0.25 tick |
| C5 | Maker filled shares | Σ simulated filled shares / Σ live filled shares over maker episodes | 100 live fills | 95% CI within [0.8, 1.25] |
| C6 | Maker time to fill | median simulated vs live time from send to first fill, episodes filled in both | 50 episodes | within ±30% |
| C7 | Latency components | per component (§12.3), model vs live: \|median bias\| and p90 relative error | 200 per component | ≤ 10 ms and within ±20% |
| C8 | Pinned PnL error (A2) | per market, (PnL_sim − PnL_live) / shares traded | 50 markets | mean ≤ 0.5 ¢/share, 95% CI contains 0 |

C1–C8 are the D35 thresholds. C9 and C10 extend them with the end-to-end
check; they head the G3 report.

Reported without a threshold: maker per-episode fill/no-fill agreement,
partial-fill counts, taker share-quantity error, FAILED/RETRYING counts,
reject-class confusion matrix, transport A/B, Mode C fill agreement and
first-divergence causes, the restore-horizon sensitivity (§10 step 3).

Ground-truth live PnL per market follows the wallet accounting rule (cash
flows including fees plus final payout, `docs/datasets/polymarket-research/accounting.md:26-44`),
never the bot's portfolio. PnL error is decomposed into fee, price,
quantity, missed-or-extra fills and settlement.

### 12.3 Latency components

Each component is a named, seeded empirical distribution in the
LatencyModel (13-execution-models.md §6.8), measured only as monotonic
intervals inside one process; cross-host comparisons use the §9 offset.

| Component | Measured by |
|---|---|
| client send (decision → bytes written) | every order |
| resting placement (write → exchange-visible) | latency probes |
| marketable placement incl. taker delay (write → match) | taker probes |
| cancel (write → removal / `CANCELLATION`) | latency probes |
| REST ack (write → response) | every request |
| user-WS delivery (match → fill frame received) | every fill |
| settlement MATCHED → MINED → CONFIRMED, FAILED rate | every fill |
| market-data delay, per input mode (exchange ts → receipt) | all market frames, both hosts |
| split / merge / redeem | not probed: stays at prior defaults, flagged unverified |

### 12.4 Verdict per input mode

Almost all fleet backtests run on telonex-delta, which has a different
cadence, inferred ticks (11 TT3) and no trade prints, so its maker model
runs in no-prints mode (13 Q5). A verdict computed only on V4 would approve
the profile for an input mode that no threshold checked. Therefore:

- **Two verdict tables.** C1 and C3–C10 are computed separately on
  recorder-v4 (the live-journal input class) and on telonex-delta, against
  the same live ground truth and with the same thresholds. C2 (fees) and C7
  (latency components) do not depend on the replayed input and are shared;
  C7's market-data-delay component is reported per input mode.
- **Telonex bias report.** P13 quantifies realistic-on-telonex vs
  realistic-on-V4 on every overlapping worker-2 market (a much larger n
  than the traded markets), for the exerciser and lagsnipe.v15.rs. It is
  reported with CIs next to the telonex-delta verdict table.
- **Decision per mode.** At G3 the user decides per input mode whether
  `realistic` becomes the default (§15). A mode whose verdict is FAIL or
  INSUFFICIENT keeps its current default unless the user decides otherwise
  explicitly; if the user accepts a mode with a measured bias, the
  calibration artifact records that bias and the runs that use it carry its
  `calibrationId` (13 §6.8).

## 13. Fitted parameters and the calibration artifact

- Only these parameters are fitted: the latency quantile tables per
  component, the maker cancel-ahead share α (`maker-queue-parameter` in the
  requirements sweep), and the settlement delay tables with the FAILED rate.
  Everything else comes from rules or structure, not from tuning.
- The result is a versioned calibration artifact: a committed JSON file
  `native/calibration/<id>.json` (13 §6.8: a committed, versioned parameter
  set that the producer resolves; no database table) holding id, date range,
  live host, stack (binary sha256 and source hash), input modes,
  order-size range, price range, timeframes, sample sizes, CIs, fitted
  parameters, per-metric verdicts per input mode, the measured telonex
  bias (§12.4), pre-registration commit and deviations. ModelConfig
  references it through `execution.latency.calibrationId`; the producer
  resolves the id into explicit component distributions in the job (21:
  the binary applies no defaults).
- The engine MUST warn when a run's sizes, prices, markets or host fall
  outside the artifact's validity envelope.
- Fitted values become realistic defaults only through a deliberate commit
  after gate 3, never automatically (precedent:
  `docs/datasets/price-feeds/parity-harness.md:52-58`).

## 14. What $100 can and cannot calibrate

| Can | Cannot |
|---|---|
| Exchange rules (§6.1) | Size effects above ~5–10 shares: walking the book, our share of the queue, impact |
| Fee formula and rounding for the current era | Fees of earlier eras (needs on-chain or Data API samples, D22) |
| Place, cancel, ack, delivery latency to p99 | Strategy edge or PnL significance |
| Taker delay, taker VWAP, FOK/FAK outcomes | Rare paths: RETRYING/FAILED settlement, rejects under load, outages |
| Settlement timing | Maker rewards and rebate tiers |
| Maker filled-share ratio to about ±20%, fill/no-fill agreement | A full queue-position model (its structure comes from V4 prints over many markets) |
| End-to-end decision agreement of a simple probe strategy at minimum sizes (Mode C) | End-to-end agreement of complex strategies with large orders (lagsnipe paper rows give input-side context only) |
| Telonex-vs-live and telonex-vs-V4 realism gap for the traded and overlapping markets | Market regimes outside the calibration days |
| | Another host, another network path, or another execution stack |
| | Split/merge/redeem latency (not probed) |

The maker threshold C5 needs a CI inside [0.8, 1.25]; with about 100 fills
the CI half-width is about ±20%, so C5 passes only if the point estimate is
close to 1. An INSUFFICIENT or borderline C5 is an expected outcome of this
budget (see Open questions). On telonex-delta, the no-prints queue mode is
expected to under-fill makers (a partly consumed level never fills us), so
a C5 FAIL there is a plausible, informative outcome rather than a harness
error.

## 15. Gate 3 report

The report (a gate report under `native/reports/`, 01-scope-milestones.md §7)
MUST contain, in this order:

1. The headline: C9 and C10 (Mode C) per input mode, with CIs.
2. The verdict tables of §12.2 per input mode (§12.4), with CIs for A1
   (V4 only) and A2.
3. The telonex bias report (P13) next to the telonex-delta table.
4. Prerequisite proofs; budget used per phase; sample sizes; exclusions per
   reason and input mode; self-test results.
5. Latency component table; fitted parameters; the realistic-vs-live error
   next to the TS-compat-vs-live, `trade_through`-vs-live and
   worst-queue-vs-live errors.
6. The live-vs-backtest decision parity baseline (50-live-runtime.md §13.5)
   and the Mode C context rows.
7. Deviations from the pre-registration; the validity envelope.

The user decides at gate 3, per input mode (§12.4). A FAIL or INSUFFICIENT
verdict means `realistic` does not become the default for that mode without
an explicit user decision.

## 16. Re-calibration triggers

The artifact is re-measured when any of these happens: one month has
passed; the live host or its network changes; the execution stack changes
(adapter, transport, signing); Polymarket changes a modeled rule (taker
delay, fee schedule, tick, GTD); or a run needs sizes outside the validity
envelope. Client-side components MUST be re-measured on any stack change.

## 17. Interfaces this document relies on

The plan assumes the following statements in documents owned elsewhere.
Where one is still missing there, this document's rule applies to the
calibration and the owner aligns its text.

| Assumption | Where it belongs |
|---|---|
| The telonex-vs-V4 realism report (P13) is an M7 deliverable, moved out of follow-up F2; F2 keeps only the Telonex `trades` ingestion | 01 M7 and 01 §10 F2 |
| Calibration artifacts are committed files `native/calibration/<id>.json` resolved through `execution.latency.calibrationId`; there is no calibration table | 13 §6.8 (already), 42 (no table), 50 §1 |
| Operator commands `pause`, `resume`, `heartbeat_pause` exist in the runtime's command vocabulary | 50 §16 (done), 20 §7, 12 §3.2 |
| The analysis harness (Modes A, B, C, both input modes, self-tests of §11.4) has conformance tests | 60 L12 |
| The G3 gate report is per input mode, with C9/C10 as headline | 01 §7, 60 G3 row |

## Open questions

1. **Maker budget extension.** If C5 is INSUFFICIENT or borderline, may the
   maker phase be extended beyond $30 (the global $60 stop would then need
   to change), or is a borderline C5 accepted with the envelope flagged?
   (User.)
2. **Settlement components and C7.** D35's per-component rule (|median bias|
   ≤ 10 ms) is meaningful for network components but not for settlement
   delays of seconds. Should settlement components use only the ±20% rule
   on median and p90, as the requirements sweep proposed? (User.)
3. **Live host for calibration.** The result is valid only for the host that
   produced it. Running the bot on m1-ivan matches today's live machine;
   running it on worker-2 next to the recorder would share one clock and
   network path and simplify the join, but calibrate a host that is not the
   live machine. If live trading may later move to a Linux server near
   Polymarket (50 Open question 3), calibration is repeated there. Which host
   for this calibration? (User.)
4. **Calibration dates and supervision.** Which 2–4 days, and is the user
   available to launch, watch alerts and stop the run during them? (User.)
5. **End-to-end check and Telonex verdict (additions to D35).** D35 froze
   eight thresholds, all measured on worker-2's V4 recordings. This plan adds
   (a) two end-to-end rows that run the probe strategy freely in a backtest
   and compare it with what live did: C9, at least 90% of the same decisions
   in both directions, and C10, an average PnL error of at most 1 cent per
   share; and (b) a separate verdict on Telonex data, which most fleet
   backtests use, with the same thresholds, so you decide per data source at
   gate 3. Do you accept these additions and the values 90% and 1 cent for
   the pre-registration frozen at gate 4? (User.)
