# 11 — Exchange rules

This document defines `ExchangeRules`: the per-market, time-varying exchange
parameters that decide whether an order is valid, when it matches, and what it
costs. It covers tick size, price bounds, size and amount precision, minimum
sizes by order type, the fee curve families with a dated fee table (no fee
before 2026-01-05), the taker delay dated by exchange time (250 → 50 → 150 ms),
GTD lead and early expiry, batch and cancel caps, negRisk and the market
version. It also defines the per-market rules snapshot that the producer
captures from Gamma and CLOB and how it is captured, the provenance vocabulary
(`RulesSource = snapshot | partial | fallback`), the dated fallback that lives
only in the engine, the two versions (`rulesTableVersion` compiled into the
engine, `snapshotParserVersion` of the TS extraction), the fee ground-truth
study, and which source wins when docs and observations disagree. The
realistic profile and the live adapter apply these rules; ts-compat uses the
fixed TS constants of §4. Matching, latency and queue models are in
`13-execution-models.md`, domain types and rounding in `10-domain-model.md`,
the job field that carries the rules in `21-job-and-output-contract.md`, the
snapshot table DDL in `42-persistence-and-stats.md`, and the pre-start capture
service in `40-fleet-integration.md` §16. Paths are relative to the repository
root. §17 lists the changes this document requires in documents it does not
own.

Binding decisions used here: D06 (BTC 5m/15m only), D21 (snapshot per
condition_id, dated fallback, the rules version travels in the job and is
stored on the run, no pooling across fee eras), D22 (charged amounts beat
docs; realistic is not the default until every era matches), D30
(heartbeat), D34 (day-0 rule probes), D35 (fee error 0 at 1e-6).

---

## 1. Scope

- **S1.** Rules are specified for BTC up/down 5m and 15m markets (D06). The
  realistic profile MUST refuse any other series, even one with a complete
  snapshot, until its fallback rows exist ("invalid input", exit 2).
- **S2.** Every rule value carries a verification status (§14). Realistic
  results record which unverified rules they used.

## 2. Sources and precedence

### 2.1 Source classes

| Class | Meaning | Examples |
|---|---|---|
| C | Charged or observed exchange behavior | on-chain fills, Data API `usdc_size`, our live journal, day-0 probes, recorded WS data |
| S | Per-market snapshot fields | Gamma market JSON, CLOB `/clob-markets/{condition_id}`, V4 bootstrap `rawJson` |
| L | Official changelog (dated) | docs.polymarket.com/changelog |
| P | Official docs pages (current) | /trading/fees, /trading/place-orders, /market-data/market-details, /concepts/order-lifecycle |
| T | Third-party reports | news articles, bot-developer blogs |
| A | Assumption | stated with its reason |

All docs pages were fetched on 2026-10-09.

### 2.2 Precedence

- **PR1.** A per-market value comes from a valid snapshot field (§13), and
  otherwise from the dated fallback (§5.3, §6.2, §7).
- **PR2.** For the fallback tables and for interpreting fields: **C > L > P >
  T > A** (D22). When C contradicts a table row, the row and
  `docs/polymarket/index.md` are updated and `rulesTableVersion` is bumped
  (§13.5).
- **PR3.** Fields known to be misleading MUST be ignored:
  - Gamma `takerBaseFee`/`makerBaseFee` (1000 in fixtures whose charged curve
    is 0.07; `src/research-data/fixtures/july-01-merge.json:17`).
  - CLOB `mbf`/`tbf`.
  - WS `last_trade_price.fee_rate_bps`: `"0"` on all 36,983 prints recorded
    2026-07-21..25, a fee-charging era (`data/events/btc/*.parquet`).
  - Gamma `secondsDelay` as a crypto taker-delay value (§6.3).

### 2.3 Known conflicts and their resolution

| # | Conflict | Resolution |
|---|---|---|
| K1 | The CLOB `itode` docs say "250 ms", but the changelog says 150 ms since 2026-09-04 14:00 UTC | L wins: §6.2 |
| K2 | Market-details says `orderMinSize` is "in USDC"; place-orders says book `min_order_size` is shares; repo docs say 5 shares for GTC/GTD and $1 for FOK/FAK (`docs/polymarket/index.md:198-207`) | Fallback per §7.4; day-0 probe decides |
| K3 | Order-lifecycle says the API "waits and returns the final result" for crypto delays; place-orders says it returns `delayed` with zero amounts | The live adapter handles both (`50-live-runtime.md`); day-0 probe decides |
| K4 | Era 1 formula: repo docs `0.25·p·(p(1−p))²` per share (`docs/polymarket/index.md:149`) vs WIP `0.25·(p(1−p))²` (`native/crates/pmb-core/src/rules.rs:134-160`) | Repo docs win: they match the changelog's "peaking at 1.56% at 50% probability". The WIP formula gives 3.125% and is a bug (§5.1). |
| K5 | Era 1 start 2026-01-05 (changelog) vs 2026-01-06 (repo docs, on-chain analysis) | L until C proves otherwise: the fee study FS (§14.1) decides |
| K6 | Era 2 rate 0.07 (docs, changelog Fee Structure V2 on 2026-03-30) vs 0.072 from 03-29/31 to ~05-08 (repo docs, on-chain analysis) | Unresolved: FS (§14.1) decides; until then the fallback row is flagged `unverified` (§5.3) |
| K7 | Cancel-id cap 1,000 (changelog 2026-06-15) vs 3,000 (older docs, TS `src/trading/cancellation.ts:69`) | L: 1,000 (§9) |

## 3. The `ExchangeRules` type

```rust
#[derive(Copy, Clone)]                        // ~128 bytes, no heap
pub struct ExchangeRules {
    pub tick: [Price; 2],                     // per outcome, in force
    pub min_size_resting: Qty,                // GTC/GTD minimum, shares
    pub min_notional_market: Usdc,            // FOK/FAK minimum
    pub fee: FeeCurve,
    pub taker_delay_enabled: bool,
    pub gtd: GtdRules,                        // min_lead, early_expiry
    pub max_place_batch: u8,
    pub max_cancel_ids: u16,
    pub neg_risk: bool,
    pub version: MarketVersion,               // V1 | V2
    pub min_order_age_s: Option<u32>,         // recorded, not modeled (§11)
    pub validate: bool,                       // false in ts-compat
}

pub struct RulesTimeline {                    // immutable, Arc-shared across candidates
    pub initial: ExchangeRules,
    pub changes: Vec<(TsMs /*exchange time*/, RulesChange)>,  // sorted
    pub provenance: RulesProvenance,          // §13.3: RulesSource + per-field provenance
    pub table_version: RulesTableVersion,     // §13.5
    pub fee_era: FeeEraId,                    // §5.3 row containing the market start
}
pub enum RulesChange {
    Tick { outcome: Outcome, tick: Price, origin: TickOrigin /* Event | Inferred */ },
    TakerDelay { delay: DurMs, cancelable: bool, row: DelayRowId },
}
```

| Field | Unit | Realistic source | ts-compat |
|---|---|---|---|
| `tick` | price | §7.5 | 0.01, never validated |
| `min_size_resting` | shares | snapshot `orderMinSize` / CLOB `mos`, else 5 | none |
| `min_notional_market` | USDC | fallback $1 (§7.4) | none |
| `fee` | — | §5 | §4 |
| `taker_delay_enabled` | — | CLOB `itode`, else true (fallback for crypto up/down) | false |
| taker delay value | ms | dated table keyed by exchange time (§6.2) | none |
| `gtd.min_lead` | ms | 180,000 | decision-time offset 60,000 |
| `gtd.early_expiry` | ms | 60,000 | 0 |
| `max_place_batch` | orders | 15 | unbounded |
| `max_cancel_ids` | ids | 1,000 | 3,000 |
| `neg_risk`, `version` | — | snapshot (§10) | not used |
| `min_order_age_s` | s | CLOB `oas` | not used |

- **X1.** Rules are looked up by **exchange time**: the time an order reaches
  the matching engine, a delayed order is re-checked, or a GTD order expires.
  The engine computes these times (`13-execution-models.md`). The lookup MUST
  be a forward-only cursor over `changes`, O(1) amortized, because events are
  time-ordered.
- **X2.** `RulesTimeline` is built once per market by the engine from: the
  captured fields in the job's `market.rules` (§13.4), the compiled dated
  tables of `ModelConfig.rules.rulesTableVersion` for every field that was not
  captured, and tick events in the input (§7.5). It is shared read-only by
  every candidate of a group (`41-candidate-groups.md`). The dated tables
  exist only in the engine; TS reads them through `describe` (§13.5) and never
  keeps a copy.

## 4. ts-compat rules (fixed, every date)

| Rule | ts-compat value | Evidence |
|---|---|---|
| Fee | `C × 0.07 × p(1−p)` on TAKER fills, rounded to 4 dp, result `< 0.0001` → 0, on **every date**, including before 2026-01-05 | `src/trading/fees.ts:10,18-42`; `src/trading/execution/BacktestExecution.ts:236` |
| Fee in the BUY reservation | 700 bps at the limit price unless post-only, even when the order will rest | `src/trading/capital.ts:16-28` |
| Tick, bounds, min size, precision | not validated (only `price > 0`, `size > 0`) | `src/trading/OrderManager.ts:756-780` |
| GTD | `expireAtMs >= decision now + 60_000`; expires exactly at `expireAtMs` | `src/trading/OrderManager.ts:189,770`; `src/trading/execution/BacktestExecution.ts:802-804` |
| Taker delay | none | — |
| Batch cap | none in the simulator | `native/crates/pmb-core/src/rules.rs:5-6` |
| Cancel-id cap | 3,000 | `src/trading/cancellation.ts:69` |
| Post-only | rejected if crossing at execution time (equality crosses; empty opposite side accepts) | `src/trading/execution/BacktestExecution.ts:37-54` |

ts-compat exists only for the trace parity gate. These values are never used
by realistic or live.

## 5. Fees

### 5.1 Curve families

```rust
pub enum FeeCurve {
    None,
    /// Era 1: fee = C × p × rate × (p(1−p))^exponent
    PriceWeighted { rate: Rate, exponent: u8, dp: u8 },
    /// Current: fee = C × rate × (p(1−p))^exponent   (feeType "crypto_fees_v2")
    Symmetric { rate: Rate, exponent: u8, dp: u8 },
}
```

- **FE1.** `Symmetric` is the current formula. P says
  `fee = C × feeRate × p × (1 − p)`, with 100 shares at $0.50 costing $1.75,
  and `feeSchedule.exponent` is "applied to the price component of the fee
  curve". Gamma JSON carries `feeType: "crypto_fees_v2"` and
  `feeSchedule {exponent: 1, rate: 0.07, takerOnly: true, rebateRate: 0.2}`
  (`src/research-data/fixtures/july-01-merge.json:17`,
  `june-04-terminal-merge.json:19`).
- **FE2.** `PriceWeighted` is era 1 (K4). With rate 0.25 and exponent 2, the
  fee as a fraction of notional is `0.25·(p(1−p))²`, which peaks at 1.5625% at
  p = 0.5, matching L ("peaking at 1.56% at 50% probability", 2026-01-05). The
  WIP evaluates `C × 0.25 × (p(1−p))²` (`rules.rs:87-103` fed by the
  `rules.rs:151-160` row). That is the `Symmetric` family with era-1
  parameters: 2× too high at p = 0.5 and asymmetric in the wrong direction. It
  MUST be replaced.
- **FE3.** Snapshot mapping:
  - `feesEnabled == false`, `rate == 0`, or no schedule → `None`.
  - `feeType == "crypto_fees_v2"` → `Symmetric{rate, exponent}`.
  - Missing or unknown `feeType` with a schedule present → the fee comes from
    the fallback row for the market's start (§5.3), provenance `fallback`,
    plus diagnostic `unknown_fee_type`.
  - `exponent` MUST be a non-negative integer ≤ 4. Anything else is invalid
    input.

### 5.2 Computation (realistic and live)

- **FC1.** The fee is computed once per fill record by `ExchangeRules` and
  stored on the `Fill` (`10-domain-model.md` §9.1): `C` is the fill quantity
  and `p` the fill price. Nothing downstream recomputes it.
- **FC2.** Taker only (`takerOnly: true`); makers pay 0. The fee is charged in
  USDC: added to the spend on a BUY, deducted from the proceeds on a SELL.
- **FC3.** Integer evaluation: `p` in micros, exact products on `i128`, with
  staged division keeping intermediate precision ≥ 1e-12 USDC. Truncating
  intermediates below 1e-12 is allowed. Then one `HalfAwayFromZero` rounding to
  `dp`:
  - realistic `dp = 5`: P, "rounded to 5 decimal places". The minimum fee is
    0.00001, and smaller amounts round to zero. This is just the rounding:
    exact < 0.000005 → 0.
  - ts-compat `dp = 4`: results below 0.0001 → 0, as in `src/trading/fees.ts:20-24`.
- **FC4.** Unknown and verified by the fee study FS (§14.1): the direction of the
  5 dp rounding (assumed half-up, which equals half-away for fees ≥ 0), and
  whether the exchange computes the fee per maker match or per taker order
  (assumed per fill record: one per maker price level in the simulator, one
  per trade/maker order in live). Era-1 `dp` is assumed 5.
- **FC5.** Maker rebates (20% for crypto, per P) and taker rebate tiers (from
  ~2026-05-27, `docs/polymarket/index.md:181-183`) are not part of `fill.fee`
  or PnL. They are reported separately later (D35).

Test vectors (exact decimal, `HalfAwayFromZero`):

| C | p | Era 1 PriceWeighted(0.25, 2) | Era 3 Symmetric(0.07, 1) | ts-compat | WIP era 1 (wrong) |
|---|---|---|---|---|---|
| 100 | 0.50 | 0.78125 | 1.75000 | 1.7500 | 1.56250 |
| 10 | 0.53 | 0.08222 | 0.17437 | 0.1744 | 0.15513 |
| 800 | 0.60 | 6.91200 | 13.44000 | 13.4400 | 11.52000 |
| 6 | 0.64 | 0.05096 | 0.09677 | 0.0968 | 0.07963 |
| 5 | 0.01 | 0.00000 | 0.00347 | 0.0035 | 0.00012 |
| 5 | 0.99 | 0.00012 | 0.00347 | 0.0035 | 0.00012 |
| 0.05 | 0.01 | 0.00000 | 0.00003 | 0 | 0.00000 |

### 5.3 Dated fallback fee table (BTC up/down)

The fallback is keyed by **market start time**. A fee schedule is a market
property (per-market Gamma `feeSchedule`), and the changelog phrases rollouts
as "for markets created after". The taker delay is a matching-engine setting
and is keyed differently (§6).

| Row | Markets starting | Curve | rate | exp | dp | Status until FS (§14.1) |
|---|---|---|---|---|---|---|
| F0 | before 2026-01-05T00:00Z (`1767571200000`) | `None` | — | — | — | L (2026-01-05 entry). Boundary conflict K5; `unverified` |
| F1 | 2026-01-05 → 2026-03-30T00:00Z (`1774828800000`) | `PriceWeighted` | 0.25 | 2 | 5 (A) | L (peak 1.56%) plus the repo docs' on-chain formula; `unverified` |
| F2 | 2026-03-30 → ~2026-05-08 (`1778198400000`, approximate) | `Symmetric` | 0.07 (P/L) | 1 | 5 | Conflict K6 (0.072 claimed); `unverified` |
| F3 | from ~2026-05-08 | `Symmetric` | 0.07 | 1 | 5 | P plus S (June/July 2026 snapshots); `unverified` until FS checks it on the local research dataset |

- BTC 5m markets launched on 2026-02-12 with taker fees "following the
  15-minute curve" (L), so F1 applies from their first market.
- **FT1. Output.** Each realistic market output records (21 §11, persisted
  per 42):
  - `feeEra`: the id of the row above whose window contains the market start
    (`F0`…`F3`), whether the curve came from a snapshot or the fallback;
  - `feeCurve`: the canonical text of the `FeeCurve` actually used, e.g.
    `none`, `price_weighted:0.25:2:5`, `symmetric:0.07:1:5`;
  - `feeSource`: the provenance of the fee field (§13.3).

  ts-compat outputs carry `null` for all three: its fee is the §4 constant.
- **FT2. No pooling (D21), made concrete.** Two markets are poolable only
  when their `feeCurve` values are identical. Eras whose curves are equal
  (F2 and F3 if FS confirms 0.07) therefore pool, and a curve taken from a
  snapshot that differs from its era's row does not. Required behavior:
  - the producer, at submit of a realistic run, reports the market count per
    `feeCurve` of the selection (the captured fee fields through the FE3
    mapping, which the JC4 fixtures cover, where present; else the dated
    table exported by `describe`, §13.5) and warns when more than one curve
    is present;
  - batch stats and segments of a realistic run that spans more than one
    `feeCurve` are reported per curve, and any run-level figure that mixes
    curves is flagged `mixedFeeCurves` (42 owns the mechanism);
  - comparisons between runs (`baseline_id`, dashboard) warn when the two
    runs' curve sets differ.

## 6. Taker delay

### 6.1 Semantics (realistic and live)

- **TD1.** It applies to an order that is **marketable at exchange arrival**
  (it would match the opposite best: BUY price ≥ best ask, SELL price ≤ best
  bid) on a market with `taker_delay_enabled`. Non-marketable orders are not
  delayed. Post-only orders are never delayed, because a marketable post-only
  order is rejected (§11).
- **TD2.** The order is accepted with status `delayed`. On REST it returns zero
  amounts and no trade ids. It is held for `delay` ms of exchange time.
- **TD3.** When the delay ends, the exchange re-runs validation against the
  state at that moment: market state, balance and allowance, risk, and the
  tick in force. If that fails, the order is rejected. Otherwise it matches
  the book at that moment. The remainder of a resting type rests (status
  `unmatched` → `live`). The remainder of a market type is killed
  (docs.polymarket.com/concepts/order-lifecycle).
- **TD4.** During the window a cancel fails with `NotCancelableDuringDelay` in
  eras where the order is irrevocable (§6.2). The order continues.
- **TD5.** The window is measured in exchange time. The simulator schedules the
  release at the exact time (`13-execution-models.md`). Delay and network
  latency add up: arrival = send + place latency, match = arrival + delay.

### 6.2 Dated delay table (keyed by exchange arrival time)

| Row | From | To | Delay | Cancellable in window | Status / source |
|---|---|---|---|---|---|
| D0 | first market | ~2026-02-15 (`1771113600000`, approximate) | 500 ms | unknown | T (protos.com, 2026-02-20: the 500 ms taker delay on BTC 5m markets was removed "this month"). Mechanism details unknown. |
| D1 | ~2026-02-15 | 2026-02-25 (`1771977600000`, time of day unknown) | 0 | — | T |
| D2 | 2026-02-25 | 2026-06-05 (`1780617600000`) | 250 ms | yes | T (rollout across 5m/15m/1h crypto) |
| D3 | 2026-06-05 | 2026-08-17T11:00Z (`1786964400000`) | 250 ms | no | T (report dated 2026-06-03: irrevocable from June 5) plus P (order-lifecycle "held for 250 ms… cannot be canceled") |
| D4 | 2026-08-17T11:00Z | 2026-09-04T14:00Z (`1788530400000`) | 50 ms | no | L |
| D5 | 2026-09-04T14:00Z | — | 150 ms | no | L |

- **TD6.** Rows D0–D3 are third-party, and the realistic profile uses them with
  `verification = ThirdParty`. Every market where at least one order hit such
  a row records it in `unverifiedRules` (§14). `research/early-audits.md` dated
  250 ms "from about 2026-06-05", which conflates D2 and D3. See Open
  questions.
- **TD7.** The WIP has `taker_delay_ms = 0` in every row and keys the delay by
  market start (`native/crates/pmb-core/src/rules.rs:142-176`). Both are wrong.

### 6.3 Per-market flag

- `taker_delay_enabled` comes from CLOB `itode` (a boolean, omitted when
  false) when a CLOB snapshot exists. Without one, the fallback is `true` for
  BTC up/down.
- Gamma `secondsDelay` is an integer number of seconds and describes
  sports-style delays (P example: 0). It cannot express 150 ms and is not
  evidence about the crypto delay. It MUST be recorded. If it is > 0 on a BTC
  market, `secondsDelay × 1000` replaces the dated value for that market,
  flagged `unexpected_seconds_delay`.

## 7. Tick size, bounds, precision, minimum sizes

### 7.1 Valid ticks (P, place-orders)

| Tick | Price decimals | Size decimals | Amount decimals |
|---|---|---|---|
| 0.1 | 1 | 2 | 3 |
| 0.01 | 2 | 2 | 4 |
| 0.005 | 3 | 2 | 5 |
| 0.0025 | 4 | 2 | 6 |
| 0.001 | 3 | 2 | 5 |
| 0.0001 | 4 | 2 | 6 |

P limits the 0.0025 tick to World Cup markets. Any tick outside this set is
invalid input.

### 7.2 Price validity

- **TK1.** The price MUST be a multiple of `tick[outcome]` in force at exchange
  arrival, and again after the taker delay (TD3). Otherwise the order is
  rejected with `InvalidTick`.
- **TK2.** `tick ≤ price ≤ 1 − tick`, otherwise `PriceOutOfBounds`. Source:
  `research/early-audits.md` A7. P only states tick conformance, so this bound
  is a day-0 probe item.

### 7.3 Size and amount precision

- **TK3.** Share sizes (resting orders and market SELLs) MUST have at most the
  size decimals (2). Collateral amounts (market BUYs) MUST have at most the
  amount decimals of the tick. A violation is `SizePrecision` /
  `AmountPrecision`. The engine never rounds silently. The official SDK rounds
  shares down, and our SDK makes that explicit (`10-domain-model.md` R4). The
  live adapter therefore signs exactly what the core validated.
- **TK4.** Signing amounts (`makerAmount`/`takerAmount`) follow P's rounding
  recipe ("round up to amount decimals + 4, then down to amount decimals").
  They are computed in the live adapter (`50-live-runtime.md`). The
  simulator's fill arithmetic is in `13-execution-models.md`.
- **TK5.** Fills carry up to 6 decimals (`10-domain-model.md` T4).

### 7.4 Minimum sizes

| Order class | Minimum | Fallback value | Status |
|---|---|---|---|
| GTC/GTD (resting) | `min_size_resting` shares | 5 (Gamma `orderMinSize: 5` in every fixture; CLOB `mos`) | S/P. Unit conflict K2. |
| FOK/FAK (market) | `min_notional_market` | $1 notional (`docs/polymarket/index.md:202-203`) | A, conflict K2: day-0 probe |

- **MS1.** Checked at exchange arrival. A market BUY compares its collateral
  amount. A market SELL compares `shares × price` (A).
- **MS2.** Trade prints are no evidence for minimums: one order produces
  several prints, and 10.5% of 36,983 recorded prints are below $1.

### 7.5 Tick in force

- **TT1. Initial tick.** Per outcome, from a **pre-start** snapshot (V4
  bootstrap `rawJson`, frozen at market start, `src/recorder-v4/coordinator.test.ts:643-670`;
  a producer pre-start fetch; CLOB `mts`), else the fallback 0.01. A
  post-start snapshot's `orderPriceMinTickSize` MUST NOT be used as the
  initial tick. Evidence:
  - In 15 of 36 recorded BTC 15m markets (`data/events/btc/*.parquet`,
    2026-07-21..25), both outcomes switched 0.01 → 0.001 between 427 s and
    898 s after start, with the book at the extremes (best bid 0.99 / best ask
    1 on one outcome). None switched back.
  - A post-resolution July snapshot shows 0.001
    (`src/research-data/fixtures/july-01-merge.json:17`), while June snapshots
    show 0.01 (`june-04-terminal-merge.json:19`).
- **TT2. Tick events.** A `tick_size_change` (live WS; recorded by V4,
  `src/recorder-v4/marketFrame.ts:49,85`) sets `tick[outcome]` from the event's
  exchange timestamp, `origin = Event`. Duplicate events are idempotent: the
  recordings carry each change twice per outcome.
- **TT3. Inference on Telonex-delta.** Telonex-delta has no tick events
  (`src/telonex/converters/deltaTyped.ts`). When a book or price_change level
  of an outcome has a price that is not on the current tick, the tick switches
  at that row's exchange time to the coarsest valid tick (§7.1) containing the
  price, `origin = Inferred`, and diagnostic `tick_inferred` is counted. The
  tick never coarsens back. Evidence that this occurs: 19 of 111 June-2026 BTC
  15m Telonex files contain sub-cent levels. Known limitation: inference lags
  the real change until the first sub-cent level appears. During that gap a
  sub-cent order is rejected in the backtest but accepted live. This is part
  of the calibration validity envelope (`51-calibration-plan.md`).
- **TT4.** Resting orders that were valid under the old tick stay valid after
  a refinement (0.01 multiples are 0.001 multiples). A coarsening event has
  never been observed. If one arrives, resting orders are left unchanged and
  the event is counted (`tick_coarsened`).

## 8. GTD

- **GT1.** `expire_at_ms` is the stated exchange expiration, sent as
  `floor(expire_at_ms / 1000)` seconds (`10-domain-model.md` §7.4).
- **GT2.** Checked at exchange arrival: `stated_s × 1000 ≥ arrival + 180_000`,
  otherwise `GtdLeadTooShort`. P: "must be at least 3 minutes in the future".
- **GT3.** Effective expiry is `stated_s × 1000 − 60_000` in exchange time
  (P: "expire one minute before their stated expiration"). The simulator
  expires the order at exactly that time.
- **GT4.** Market orders use expiration `0` (adapter).
- **GT5.** This removes a TS live/backtest mismatch: TS live sends the floor of
  `expireAtMs` without adding 60 s, so TS live orders expired 60 s before the
  same backtest order (`src/trading/execution/LiveExecution.ts:189-191`;
  `research/early-audits.md` A2).

## 9. Batch, cancel caps, rate limits

| Rule | Realistic / live | Source |
|---|---|---|
| Orders per `place_batch` | 1–15. Above 15, the whole intent is rejected with `BatchTooLarge` and every order gets `OrderRejected`, as TS live does (`src/trading/execution/LiveExecution.ts:166-178`). | L (2025-08-21), P |
| Batch results | Per entry. `success: true` with `errorMsg` is a rejection (adapter) | `research/early-audits.md` A12 |
| Ids per `cancel_batch` | ≤ 1,000. Above that, `CancelFailed(TooManyIds)` for the whole intent. `cancel_market` and `cancel_all` use their own endpoints and have no id cap. | L (2026-06-15) |
| Request rate | Not modeled by the simulator. Live and paper apply a client-side limiter (`50-live-runtime.md`). L (2026-06-01): `POST /orders` and `DELETE /orders` 2,000 per 10 s burst. | L |

## 10. negRisk and market version

- **V1.** `version` comes from Gamma `version`: `v1` (CTF) or `v2` (Protocol
  V2). Any other value is unsupported (P) and is invalid input.
- **V2.** The version selects:
  - the asset ids: `clobTokenIds` (a JSON string) for v1, `positionIds` (an
    array) for v2. Both fields can be present, so the choice follows
    `version`, not field presence.
  - the signing domain:

| Order book | Domain version | `verifyingContract` |
|---|---|---|
| `version: "v2"` | "3" | `0xe3333700cA9d93003F00f0F71f8515005F6c00Aa` |
| CTF, `neg_risk: false` | "2" | `0xE111180000d2663C0091e4f400237545B87B996B` |
| CTF, `neg_risk: true` | "2" | `0xe2222d279d744050d28e00520010520000310F59` |

  - the balance asset type and the split/merge path (TS sidecar, D25).
- **V3.** Matching and accounting in the core do not depend on the version.
  Only the producer's asset-id mapping (`10-domain-model.md` M2) and the live
  adapter read it.
- **V4.** Every BTC 15m fixture has `version: "v1"` and `negRisk: false`. A
  `neg_risk: true` market is out of scope (D06), and the producer refuses it.

## 11. Other order rules

| Rule | Realistic / live behavior | Source / status |
|---|---|---|
| Post-only | GTC/GTD only. Checked at exchange arrival against the book then in force: BUY `price ≥ best ask` or SELL `price ≤ best bid` → rejected whole with `PostOnlyWouldCross`, no partial fill. An empty opposite side is accepted. | P; TS behavior (`src/trading/execution/BacktestExecution.ts:37-54`, tests `BacktestExecution.postOnly.test.ts:116-185`) |
| Order acceptance window | Orders are accepted from Gamma `acceptingOrdersTimestamp` (about 24 h before start in fixtures) until market end. An order arriving at or after end → `MarketClosed`. Resting orders at end → `Canceled(MarketClosed)`. | A; day-0 probe. The strategy is only called inside its window anyway (D23, `12-engine-core.md`). |
| Minimum order age (`oas`, seconds) | Captured and journaled, not modeled until the probes establish what it means | S (CLOB schema "Minimum order age in seconds") |
| Self-trade | Undocumented. What happens when our taker order meets our own resting order is decided in `13-execution-models.md`, and probed on day 0. | `research/early-audits.md` A9 |
| Rewards and rebates | Excluded from fills and PnL | FC5 |

Session-level live rules are specified in `50-live-runtime.md`:

- heartbeat: `POST /v1/heartbeats` every 5 s; 10 s without one cancels all of
  the user's orders; chained per key (D30).
- HTTP 425 with `Retry-After`; the 2-minute post-only mode (503); cancel-only
  and trading-disabled states (`research/early-audits.md` A11-A12).
- the V2 order struct (`research/early-audits.md` A14).

## 12. Profiles at a glance

| Aspect | ts-compat | realistic | live / paper |
|---|---|---|---|
| Rules source | constants (§4) | `RulesTimeline` (snapshot → fallback) | rules fetched before the first tick, journaled (§13.6) |
| Validation | none beyond `> 0` | §7–§9, §11 at exchange arrival | the same check runs in the core before sending; the exchange is final |
| Fee | 700 bps, 4 dp, all dates | §5 | charged amount from the trade (reconciled, `50-live-runtime.md`) |
| Taker delay | none | §6 | real |
| GTD | 60 s decision-time check, exact expiry | §8 | real |

## 13. Per-market rules snapshot

### 13.1 Snapshot rows

Append-only. One row per fetched response body, several rows per market. The
DDL is in `42-persistence-and-stats.md` §3.3 and MUST carry these columns
(§17).

| Column | Meaning |
|---|---|
| `condition_id`, `slug`, `market_start_ms` | market keys |
| `origin` | `gamma` (Gamma `/markets/slug/{slug}`), `clob` (CLOB `/clob-markets/{condition_id}`), `v4_bootstrap` (the Gamma body Recorder V4 froze at market start), `live_gamma`, `live_clob` (fetched by the live runtime, §13.6). The origin fixes the body format: Gamma for `gamma`, `v4_bootstrap` and `live_gamma`; CLOB for `clob` and `live_clob`. |
| `fetched_at_ms` | wall-clock receive time of the response. For `v4_bootstrap`: the receive time of the `market_metadata` frame that the bootstrap froze (`src/recorder-v4/coordinator.ts:350-352`). |
| phase | derived, not stored separately: `pre_start` iff `fetched_at_ms < market_start_ms`, else `post_start` (the same rule as `40-fleet-integration.md` §16). 42 MAY store it as a generated column. |
| `raw_json` | verbatim body, kept so that a parser change re-parses without re-fetching (§13.5) |
| `raw_sha256` | sha256 of the body; unique together with (`condition_id`, `origin`) |
| `parsed` | the normalized fields of §13.4 that this body provides; a field the body lacks is absent |
| `snapshot_parser_version` | version of the extraction that produced `parsed` (§13.5) |

A Gamma body is about 5 KB (the one in
`src/research-data/fixtures/july-01-merge.json:17` is 5,343 bytes), so 30k
historical markets add about 150 MB.

### 13.2 Capture

All writers are TS and go through `src/db/exchangeRules.ts` (42 §3.3). They
read public endpoints only and hold no credentials.

| Id | Market set | Command and schedule | Rows written |
|---|---|---|---|
| RC1 | Upcoming BTC 5m/15m markets | `npm run rules:capture-prestart -- --market btc:5m,btc:15m --watch`, a launchd service on worker-1; schedule, retries and monitoring in 40 §16 | `gamma`, `clob`; `pre_start` |
| RC2 | Markets recorded by Recorder V4 | `npm run rules:import-v4 -- --timeframe 5m,15m [--from-ms X] [--to-ms Y]`, idempotent, then after every V4 catalog sync. It reads the raw bootstrap JSON, not the strategy-context allowlist (`src/recorder-v4/replay/package.ts:94-102` omits `feeType`, `version`, `secondsDelay`). V4 fetches only Gamma (`src/recorder-v4/markets.ts:127`), so the CLOB-only fields (`itode`, `oas`, CLOB `mts`) stay uncaptured. | `v4_bootstrap`; `pre_start` |
| RC3 | Historical Telonex markets: every eligible BTC 5m/15m market (about 30k; the pre-flight prints the exact count) | `npm run rules:backfill -- --symbol btc --timeframe 5m,15m [--from-ms X] [--to-ms Y] [--limit N] [--concurrency 4] [--dry-run]`. One-time and resumable: markets that already have a `gamma` row are skipped. At most 10 requests/s by default, so about an hour for 30k markets. Market selection goes through `listEligibleTelonexMarkets` (CLAUDE.md single-source rule). | `gamma`; `post_start` |
| RC4 | Historical markets, CLOB side | `npm run rules:backfill -- --probe-clob` first fetches `/clob-markets/{condition_id}` for 20 closed markets spread over the months of the universe and reports whether closed markets are still served, and with which fields. Only if they are does RC3 run with `--with-clob`. The probe result goes into the M3 report. | `clob`; `post_start` |
| RC5 | New markets after RC3 | `telonex:sync-pricetobeat-and-final-price` already fetches each market's Gamma body; it additionally stores that body through `src/db/exchangeRules.ts`. No extra request. | `gamma`; `post_start` |
| RC6 | Live markets | the live runtime (§13.6); TS ingests the journaled bodies | `live_gamma`, `live_clob` |

- **RC-G1. Nothing writes to production before gate 2.** The table and every
  writer ship in M3, after the gate-2 merge (01 §8, D03). Whether RC1 may run
  earlier, writing only local JSONL files that M3 imports with
  `npm run rules:import-jsonl`, is `40-fleet-integration.md` Open question 5.
- **RC-G2. M3 step order.** (1) the migration (42); (2) the RC4 probe; (3) RC2
  and RC3, plus the CLOB side if RC4 found it served; (4) the RC5 hook; (5)
  the RC1 service on worker-1 (40 §16); (6) the proof of §13.7; (7) the fee
  study (§14.1). RF01 and the other realistic A/B reports of
  `13-execution-models.md` §7.1 run only after step 6, and RF01 only after
  step 7 (or with the FS1 fallback).

### 13.3 Resolution and provenance

Selection among captured rows (RS1–RS3) runs in the producer, in
`src/db/exchangeRules.ts`. Filling the gaps from the dated tables and
classifying the result (RS4) runs in the engine, because only the engine has
the tables (X2).

- **RS1.** For each field: the newest `pre_start` value. Else, for
  **time-invariant** fields only (fee fields, `negRisk`, `version`, minimum
  size, taker-delay flag, `secondsDelay`, `oas`, `acceptingOrdersTimestamp`),
  the newest `post_start` value. Else the field is not sent, and the engine
  uses the dated fallback. The time-invariance of the fee fields is checked
  by FS5 (§14.1).
- **RS2.** The initial tick comes only from `pre_start` (TT1). Without one,
  the field is not sent and the engine uses the fallback 0.01 plus TT3
  inference.
- **RS3.** When Gamma and CLOB disagree: CLOB wins for tick, minimum size,
  fee parameters and the delay flag (the matching engine's own view). Gamma
  wins for `version`, `negRisk` and `feeType`. Every disagreement is counted
  in `market.rules.disagreements` and logged.
- **RS4. One provenance vocabulary**, computed by the engine and used
  everywhere (00 glossary, 21 §7 and §17, 42 §3.4; §17 below):

  ```rust
  pub enum RulesSource { Snapshot, Partial, Fallback }   // "snapshot" | "partial" | "fallback"
  pub enum FieldSource {
      Captured { origin: Origin, phase: Phase },          // Origin = §13.1 origin values
      Fallback { table: RulesTableVersion },
  }
  ```

  - `Snapshot`: every required field of §13.4 is captured `pre_start`.
  - `Partial`: at least one field is captured, and at least one required
    field is `post_start` or fallback.
  - `Fallback`: no field is captured.

  D21's flag `rulesSource=fallback` means "not `Snapshot`": `Partial` and
  `Fallback` markets are both flagged in outputs, run views and A/B reports.
  Which origin a captured field came from is per-field provenance, never a
  `RulesSource` value.

### 13.4 Job carriage: `market.rules`

The per-market job field is `market.rules` (21 §5). The run-level part is
`ModelConfig.rules` (21 §6). This document owns both shapes.

```jsonc
// ModelConfig.rules: run level, stored in model_config, inherited by --extend
{ "rulesTableVersion": "rules-table-v1", "missingSnapshot": "dated_fallback" }

// market.rules: per market, captured values only. Example: a V4-recorded
// market before RC1 existed (Gamma pre_start, no CLOB body), so the engine
// fills takerDelayEnabled from the table and classifies it Partial (§13.7).
{ "snapshotParserVersion": 1,
  "captured": {
    "tick":           { "value": "0.01", "origin": "v4_bootstrap", "phase": "pre_start", "snapshotId": 812 },
    "minSizeResting": { "value": "5", "origin": "v4_bootstrap", "phase": "pre_start", "snapshotId": 812 },
    "feesEnabled":    { "value": true, "origin": "v4_bootstrap", "phase": "pre_start", "snapshotId": 812 },
    "feeType":        { "value": "crypto_fees_v2", "origin": "v4_bootstrap", "phase": "pre_start", "snapshotId": 812 },
    "feeSchedule":    { "value": { "rate": "0.07", "exponent": 1, "takerOnly": true }, "origin": "v4_bootstrap", "phase": "pre_start", "snapshotId": 812 },
    "negRisk":        { "value": false, "origin": "v4_bootstrap", "phase": "pre_start", "snapshotId": 812 },
    "version":        { "value": "v1", "origin": "v4_bootstrap", "phase": "pre_start", "snapshotId": 812 }
  },
  "disagreements": 0 }
```

| Field | Required for `Snapshot` | Gamma field | CLOB field | Engine use |
|---|---|---|---|---|
| `tick` | yes (`pre_start` only, RS2) | `orderPriceMinTickSize` | `mts` | initial tick of both outcomes (TT1) |
| `minSizeResting` | yes | `orderMinSize` | `mos` | §7.4 |
| `feesEnabled`, `feeType`, `feeSchedule` | yes | `feesEnabled`, `feeType`, `feeSchedule {rate, exponent, takerOnly}` | `fd {r, e, to}` (`50-live-runtime.md` §6.2) | §5.1 FE3 |
| `takerDelayEnabled` | yes | — | `itode` (absent from a CLOB body = false) | §6.3 |
| `negRisk` | yes | `negRisk` | negRisk flag | §10 |
| `version` | yes | `version` | — | §10 |
| `secondsDelay` | no | `secondsDelay` | — | §6.3 |
| `minOrderAgeS` | no | — | `oas` | §11 (recorded only) |
| `acceptingOrdersTimestampMs` | no | `acceptingOrdersTimestamp` | — | §11 |

The fields of PR3 (`takerBaseFee`, `makerBaseFee`, `mbf`, `tbf`) and
`feeSchedule.rebateRate` are never extracted. Money and rate values are
decimal strings (21 §6 representation rules).

- **JC1.** The producer sends only captured values. It never sends a
  fallback value and keeps no copy of the dated tables. A field without a
  captured value is absent from `captured`.
- **JC2.** The engine fills every absent field from the compiled tables of
  `ModelConfig.rules.rulesTableVersion`, computes `RulesSource` and the
  per-field provenance (RS4), and validates the captured values (known field
  names, types, a tick from §7.1, `exponent` per FE3, `version` per V1).
  Anything else is `invalid_input` (exit 2). `missingSnapshot` has one value
  in v1, `dated_fallback`.
- **JC3.** The binary never fetches anything (`20-binary-protocol.md` G3).
- **JC4.** The mapping above and RS3 are implemented twice: in TS
  (`src/db/exchangeRules.ts`, for snapshot rows) and in the Rust live runtime
  (§13.6). Both run one shared fixture suite under `native/fixtures/rules/`
  (raw bodies → expected `parsed` values, RS3 choices and FE3 `feeCurve`
  text) and report the same
  `snapshotParserVersion`. A mapping change bumps it in both.

### 13.5 Versions

| Version | Identifies | Format, owner | Recorded | On mismatch |
|---|---|---|---|---|
| `rulesTableVersion` | everything compiled from this document: the dated tables (§5.3, §6.2), fallback values (§7.4, §6.3, TT1 0.01), constants (§8, §9), the FE3 mapping and the RS4 required-field set | `rules-table-v<N>`, engine | `ModelConfig.rules`, so `model_config` on the run (D09); echoed per market | the engine refuses a version it does not compile (`invalid_input`, exit 2) |
| `snapshotParserVersion` | the extraction from raw bodies (§13.4 mapping, RS3) | integer, `src/db/exchangeRules.ts` (and the live runtime, JC4) | per snapshot row; in `market.rules`; echoed per market | none: provenance only, never a reason to refuse a job |

- **VR1.** `N` increases with any change to the table data or to how the
  engine interprets captured fields. A change of rule semantics in engine
  code is also an engine-semantics change (`engineVersion` bump and CONTRACT
  entry, `30-strategy-sdk.md`).
- **VR2.** `describe` lists `capabilities.rulesTables`: for each table
  version the binary supports, the full dated tables (fee rows with windows
  and `feeCurve` text, delay rows, fallback constants), the RS4
  required-field set and the verification status of each rule id (§14). This
  is constant data, so `describe` stays pure (`20-binary-protocol.md` §5.1),
  and TS (producer warnings, `rules:coverage`, dashboard labels) reads it from
  there instead of keeping a copy.
- **VR3.** The producer sets `ModelConfig.rules.rulesTableVersion` to the
  newest version the binary lists, or to the parent's on `--extend`, and
  refuses at submit (never at job time) when the binary does not list it.
  Old artifacts therefore keep working with the versions they compiled
  (`20-binary-protocol.md` §3).
- **VR4.** An engine release SHOULD keep every earlier table version
  compiled (a few hundred bytes of const data each), so a new artifact can
  reproduce an old run's rules. Dropping one is a CONTRACT entry.
- **VR5.** A parser change re-parses the stored raw bodies
  (`npm run rules:reparse`, no re-fetch) and bumps `snapshotParserVersion`.
  An `--extend` sends its new markets with the current parser version, which
  is visible per market and changes nothing for the markets already
  persisted.

### 13.6 Live

Before the first tick of each market, the live runtime fetches Gamma and CLOB
(`50-live-runtime.md` §6.2), journals both raw bodies (D26), normalizes them
with the Rust implementation of §13.4 (JC4), builds the same `RulesTimeline`
with the same fallback and RS4 classification, and applies
`tick_size_change` as it arrives. TS ingests the journaled bodies as
`live_gamma` and `live_clob` rows (RC6). This replaces the TS lazy warmup
(`src/trading/execution/LiveExecution.ts:118-142`).

### 13.7 Proof of capture (M3)

Expected `RulesSource` per market set:

| Market set | Expected | Why |
|---|---|---|
| Telonex history before Recorder V4 coverage | `partial` | RC3 `post_start` Gamma gives the time-invariant fields; the initial tick is the fallback 0.01 plus TT3; `takerDelayEnabled` is the fallback `true` unless RC4 finds closed markets served |
| V4-recorded markets before RC1 started | `partial` | RC2 gives `pre_start` Gamma including the tick; the CLOB-only `takerDelayEnabled` is the fallback |
| Markets covered by RC1 | `snapshot` | Gamma and CLOB `pre_start` |
| No Gamma body obtainable (fetch failed, 404) | `fallback` | nothing captured |

Proof, recorded in the M3 report:

1. `npm run rules:coverage -- --symbol btc --timeframe 5m,15m` prints, per
   month and timeframe, the eligible market count and how many would resolve
   to `snapshot`, `partial` and `fallback` (it applies the RS1–RS3 selection
   of `src/db/exchangeRules.ts` and the RS4 rule to the table exported by
   `describe`), plus RS3 disagreement counts. Target: `fallback` ≤ 1% of
   eligible markets in every month.
2. The same picture in SQL for audit:

   ```sql
   SELECT FROM_UNIXTIME(market_start_ms DIV 1000, '%Y-%m') AS month, origin,
          (fetched_at_ms < market_start_ms) AS pre_start,
          COUNT(DISTINCT condition_id) AS markets
   FROM exchange_rules_snapshots
   GROUP BY month, origin, pre_start
   ORDER BY month, origin, pre_start;
   ```

3. A realistic run of 50 markets from each row of the table above echoes the
   expected `RulesSource` for every market.

### 13.8 Output fields

Each realistic market output (21 §11) carries
`rules = { source, rulesTableVersion, snapshotParserVersion, feeEra, feeCurve, feeSource, unverifiedRules }`
(FT1, RS4, §14). ts-compat outputs carry `rules: null`. 42 persists at least
`rules_source enum('snapshot','partial','fallback')`, `fee_era`, `fee_curve`
and `unverified_rules` per market row (§17).

## 14. Verification registry

Every rule value has
`Verification = Charged | Observed{date, evidence} | Changelog | Docs | ThirdParty | Assumed`.
The registry is a const table in the engine, versioned with
`rulesTableVersion`. `describe` exposes it (VR2), and each realistic market
output lists the ids of rules its orders touched whose status is
`ThirdParty`, `Assumed`, or flagged `unverified` (`unverifiedRules`, §13.8).

| Rule id | Value | Status today | How it gets verified |
|---|---|---|---|
| `fee.f0`–`fee.f3` | §5.3 | L / P / conflicts K5, K6; all `unverified` | Fee study FS (§14.1) |
| `fee.rounding` | 5 dp, half-up, per fill record | P (dp) / A (direction, granularity) | FS; calibration (D35: fee error 0 at 1e-6) |
| `delay.d0`–`delay.d3` | §6.2 | T | Not probe-able (historical). See Open questions. |
| `delay.d5` | 150 ms, irrevocable | L | Day-0 probe: POST status `delayed`, cancel attempt in the window |
| `delay.response` | K3 | conflict | Day-0 probe |
| `gtd.lead`, `gtd.early` | 180 s / 60 s | P | Day-0 probe |
| `tick.bounds` | `[tick, 1 − tick]` | A | Day-0 probe |
| `tick.change` | 0.01 → 0.001 at extremes | Observed (2026-07 recordings) | Ongoing V4 data |
| `min.resting`, `min.market` | 5 shares / $1 | S/P / A, K2 | Day-0 probe |
| `market_buy.collateral` | FOK/FAK BUY in collateral; floor share truncation | P | Day-0 probe (`$1` orders) |
| `post_only.cross` | §11 | P | Day-0 probe |
| `batch.cap`, `cancel.cap` | 15 / 1,000 | L | Day-0 probe (batch), docs (cancel) |
| `market.closed` | §11 | A | Day-0 probe |
| `self_trade` | unknown | — | Day-0 probe |

Day-0 probes are part of the calibration plan (D34, `51-calibration-plan.md`).
`realistic` cannot become the default until every fee era matches charged
amounts to the rounding unit (D22, gate 3).

### 14.1 Fee ground-truth study (FS, D22)

The study checks every fee row of §5.3 (formula, rate, rounding, start and
end dates) against fees that were actually charged, and resolves K5, K6 and
FC4.

- **FS1. When.** M3 step 7 (RC-G2), before the RF01 A/B report
  (`13-execution-models.md` §7.1). F3 can be checked at once from data
  already on disk. If F1 or F2 data cannot be obtained in M3 (FS3), RF01
  ships with those rows flagged `unverified` (they then appear in
  `unverifiedRules`), and their check becomes a gate-3 prerequisite (D22).
- **FS2. Command.**
  `npm run native:fee-study -- --from 2026-01-01 --to <date> --per-era 300 --source research-data [--source telonex-onchain]`.
  It writes `native/reports/fees-D22.md` (summary and a verdict per row and
  per FS5 question) and `native/reports/fees-D22.csv` (one row per sampled
  fill: era, slug, transaction hash, occurrence index, side, liquidity role,
  price, size, charged fee, computed fee per candidate formula). It reads
  local data only and writes only these two files.
- **FS3. Sources**, in order of preference (the user chooses, Open
  question 2):
  1. The local research dataset (`npm run research:sql`, BTC 15m;
     `docs/datasets/polymarket-research/schema.md`). `trades` give price,
     size, side and `is_taker`; activity `usdc_size` already includes the fee
     charged over trade notional
     (`docs/datasets/polymarket-research/accounting-audit.md:33-35`). The
     charged fee of a taker fill is therefore |`usdc_size` − size × price| of
     its matched activity occurrence (multiset matching as in
     `accounting-audit.md:44-47`). The audit observed this on BUYs only, so
     the first sample also checks that a SELL's `usdc_size` is net of the
     fee. Free. It covers June 2026 onward today
     (F3). For F1, F2 and the boundaries,
     `npm run research:sync -- --from 2026-01-01 --to 2026-06-01` extends it
     from the public Data API, if the API still serves that history; this is
     checked first on 3 days per era.
  2. Telonex `onchain_fills` (coverage columns in `src/db/schema.ts:424-425`).
     Paid; used only if source 1 cannot serve F1 or F2.
- **FS4. Sample.** For each of F1, F2 and F3: at least 300 taker fills from
  at least 30 markets, stratified by price (bins of 0.1 from 0.05 to 0.95,
  at least 20 fills per bin where they exist) and by side (BUY and SELL). For
  each boundary (2026-01-05/06, 2026-03-29…31, ~2026-05-08): every market
  starting within ±48 h, at least 5 taker fills each, to place the boundary
  to the market. Wallets in a taker-rebate tier (from ~2026-05-27, FC5) are
  excluded or identified, because a rebate netted into the charged amount
  would read as a formula error. BTC 5m is checked only if its research
  family is enabled; otherwise it inherits the 15m result (L: "following the
  15-minute curve").
- **FS5. Questions.** Per row: the formula family and rate (K6); the start
  and end dates (K5); the decimal places and rounding direction (FC4);
  whether the fee is charged per maker match or per taker order (FC4); and
  whether post-start Gamma fee fields agree with the charged fee (the RS1
  time-invariance assumption).
- **FS6. Pass rule.** A row is verified when the computed fee equals the
  charged fee to the micro-USDC for at least 99% of its sample and every
  other fill has a named cause (rebate tier, data defect). A failing row is
  corrected per PR2 (new `rulesTableVersion`, `docs/polymarket/index.md`
  updated) and the study re-runs. A verified row's status becomes `Charged`.

## 15. Performance

- **PF1.** `ExchangeRules` is `Copy`, has no heap fields and is about 128
  bytes. `RulesTimeline` is built once per market, shared by `Arc` across
  candidates and threads, and read through a forward-only cursor (X1). There
  is no hashing and no allocation per order.
- **PF2.** Fee evaluation is integer-only and branch-light: at most 4
  multiplications on `i128` and one rounding division. Validation is a few
  integer compares and a modulo. Neither SHOULD appear in a profile above 1%
  of replay time (`16-performance-and-parallelism.md`).
- **PF3.** ts-compat sets `validate = false`, which skips the rule checks
  entirely and keeps the parity path as fast as possible.

## 16. WIP salvage (`native/crates/pmb-core/src/rules.rs`)

| Item | Verdict |
|---|---|
| `curve_fee` integer evaluation (`rules.rs:87-103`) | Keep as the `Symmetric` kernel. Add `PriceWeighted`. Keep the 1e-12 intermediate precision (FC3). |
| Era table (`rules.rs:129-171`) | Replace: the era-1 row uses the wrong family (FE2), the delay is 0 everywhere, and the delay is keyed by market start (TD7). The fee is keyed by market start (§5.3); the delay moves to its own exchange-time table (§6.2). |
| `ts_compat()` (`rules.rs:183-198`) | Keep the values. Move them to §4 constants with `validate = false`. |
| `crypto_updown()` GTD and batch constants (`rules.rs:203-214`) | Keep 180 s / 60 s / 15. |
| `validate_against_rules` (`rules.rs:245-272`) | Rewrite: add the market-order minimum (it exempts FOK/FAK, `rules.rs:260-267`), precision checks, and the per-outcome tick from the timeline. The WIP keeps the tick in two places (`market.rs:87,317` vs `rules.rs:246`), so a tick change never reaches validation. Return enum reasons, not `String`s. |
| `FeeSchedule` as `f64` (`model.rs:385-392`) | Replace with `FeeCurve` (integers, §5.1). |

## 17. Changes required in other documents

These rules are owned here; the named owners align their text.

| Owner | Required change |
|---|---|
| 00 glossary | "Rules snapshot / `rulesSource`": `snapshot \| partial \| fallback` (RS4), replacing `captured \| fallback`. |
| 20 §5.1 | `describe.capabilities.rulesTables` per VR2 (versions, dated tables, verification statuses). |
| 21 §5 | The job field is `market.rules` with the §13.4 shape (`captured` values only). There is no `MarketJobData.exchangeRules`; this document used that name before. |
| 21 §6 | `ModelConfig.rules = { rulesTableVersion, missingSnapshot }` (§13.4), replacing `rulesVersion`. |
| 21 §7, §17 | `rules.source` vocabulary `snapshot \| partial \| fallback`; the producer sends no normalized fallback snapshot (JC1); `v4_raw` becomes the origin `v4_bootstrap` of a captured field. |
| 21 §10, §11 | Echo `rulesSource`, `rulesTableVersion` and `snapshotParserVersion`; `EngineMarketOutput.rules` per §13.8 (`feeEra`, `feeCurve`, `feeSource`, `unverifiedRules`). |
| 42 §3.3 | Snapshot table per §13.1: one body per row, `origin enum('gamma','clob','v4_bootstrap','live_gamma','live_clob')`, `raw_json`, `raw_sha256`, `parsed`, `snapshot_parser_version`, phase derived from `fetched_at_ms < market_start_ms`; unique (`condition_id`, `origin`, `raw_sha256`). |
| 42 §3.4 | `rules_source enum('snapshot','partial','fallback')`, `fee_era`, `fee_curve`, `unverified_rules` on `backtest_run_markets`; `model_config.rules.rulesTableVersion` instead of `rulesVersion`; per-curve batch stats and segments and the `mixedFeeCurves` flag (FT2). |
| 40 §16 | Rows carry `origin` `gamma` / `clob` (§13.1). |
| 01 M3 | The step order of RC-G2, including the fee study as step 7 before RF01. |
| 13 §7.1 | RF01 runs after RC-G2 step 7, or with F1/F2 flagged `unverified` (FS1). |

## Open questions

1. **Historical taker-delay rows D0–D3 (500 ms / none / 250 ms cancellable /
   250 ms irrevocable).** Before 2026-08-17 the delay of instant orders is
   known only from news articles and developer blogs, not from Polymarket's
   own changelog, and that period covers most of our Telonex history (Dec
   2025 – Aug 2026). Live test orders cannot check the past. Two options:
   - (a) The realistic profile uses them as specified and flags the markets
     (`unverifiedRules`).
   - (b) Same as (a), but those markets do not count as evidence for gate 3
     (realistic as default), and only markets from 2026-08-17 11:00 UTC on
     (official changelog rows) are counted.

   The user should choose at gate 1.
2. **Where the real charged fees come from (FS3).** To check the historical
   fee formulas we need fees that were actually charged in each fee period
   (January–March, March–May, and May onward). The plan (§14.1) uses the free
   research dataset this repository already downloads from the public
   Polymarket Data API: it covers June 2026 onward today, and would be
   extended back to January with `research:sync`, if the API still serves
   that history. The alternative is to buy Telonex's on-chain fills channel.
   Is the free path acceptable, with Telonex bought only if the Data API
   cannot serve January–May? If neither happens, realistic results for
   markets before June stay marked "fee unverified", and those periods cannot
   count toward making realistic the default (D22).
