# 10 — Domain model

This document fixes the vocabulary every other part of the engine uses: the
fixed-point scalar types and the rounding direction of every arithmetic
operation, the output quantization at the `MarketStats` boundary, outcome and
asset indexing, identifiers, the run and market seeds and every random draw,
intents and order types (including FAK), the order state machine, fills and
settlement statuses, and account events. It is
normative for the engine core, the execution adapters (simulator, paper, CLOB
V2) and the strategy SDK. It does not define processing order, clocks or
cascades (`12-engine-core.md`), fill/latency models (`13-execution-models.md`),
exchange parameters (`11-exchange-rules.md`) or JSON contracts
(`21-job-and-output-contract.md`). Paths are relative to the repository root;
WIP paths are under `native/crates/`.

Binding decisions used here: D08 (2 dp output, half-away-from-zero), D09
(seed and model provenance on the run), D14 (one per-market seed from run seed
and slug), D18 (build profile, as amended at gate 1), D21 (per-market rules),
D23 (window end), D27 (clock), D31 (capital), D42 (market BUYs sized in
collateral, O2), D54 (self-crossing orders blocked, N6), and the anti-drift
rules (idiomatic Rust, no JS emulation, fixed point 1e6).

---

## 1. Conventions

1. One **session** = one binary market (one condition id) × one strategy
   candidate. A live market rotation starts a new session; a candidate group
   runs N sessions over one shared, read-only market input
   (`41-candidate-groups.md`).
2. Type names in this document are normative; module layout is free.
3. "ts-compat" and "realistic" are the two execution profiles. Where they
   differ, this document gives both columns. The ts-compat column exists only
   to reproduce the TS order/fill/cancel sequence (`60-verification.md`); it is
   never a design reference.

## 2. Fixed-point scalar types

| Type | Meaning | Unit | Valid range | Notes |
|---|---|---|---|---|
| `Price` | USDC per share | 1e-6 USDC (micros) | `0..=1_000_000` | Order prices must also satisfy the tick and bounds rules of `11-exchange-rules.md`. |
| `Qty` | Shares | 1e-6 share | signed `i64` | Order sizes and positions are `>= 0`; deltas may be negative. |
| `Usdc` | Collateral (pUSD/USDC) | 1e-6 USDC | signed `i64` | Cash, notional, fees, PnL. |
| `Rate` | Dimensionless rate | 1e-6 | `0..=1_000_000` | Fee rates (`0.07` = `70_000`). |
| `TsMs` | Epoch time | ms, UTC | `i64` | Exchange or local time; which one is meaningful is stated per field (`12-engine-core.md`). |
| `DurMs` | Duration | ms | `i64 >= 0` | Latencies, delays, GTD lead. |

Rules:

- **T1.** `Price`, `Qty`, `Usdc`, `Rate` MUST be `#[repr(transparent)]`
  newtypes over `i64`, `Copy`, with no implicit conversion: no `From<f64>`, no
  `Into<f64>`, no arithmetic between different types except the named
  operations of T2. A lossy `to_f64_lossy()` MAY exist for analytics and logs.
  It MUST NOT feed decisions that money parity depends on.
- **T2.** Cross-type arithmetic exists only as named functions that take an
  explicit `Rounding` (§3): `Price::notional(Qty, Rounding) -> Result<Usdc, Overflow>`,
  `Qty::for_collateral(Usdc, Price, Rounding) -> Result<Qty, Overflow>`,
  `Usdc::mul_rate(Rate, Rounding) -> Result<Usdc, Overflow>`, and one primitive
  `mul_div(a: i64, b: i64, c: i64, Rounding) -> Result<i64, Overflow>` computed
  on `i128` (a zero divisor is a typed error too). Same-type `+ - neg cmp`
  exist as operators and as `checked_add`/`checked_sub`/`checked_neg`.
- **T3.** Overflow MUST NOT wrap, and this MUST NOT depend on the build
  profile. The newtypes implement every operation with explicit checked
  integer arithmetic (`i64::checked_*`, `i128` for products): the named
  functions return `Result<_, Overflow>`, and the operators call the checked
  form and panic with a typed `Overflow` payload (`#[track_caller]`) instead of
  wrapping. `overflow-checks` in `Cargo.toml` is then only a safety net for
  non-money integers, and turning it off (published, fleet and live binaries
  use the fastest-running reproducible build, D18 as amended at gate 1,
  measured in `16-performance-and-parallelism.md` §11.2) changes no money
  result. Overflow is classified by where the operand came from:
  - job or input values: rejected at parsing with `invalid_input` or
    `data_defect` (`20-binary-protocol.md` §4);
  - strategy values: validation bounds every price (`0..=1_000_000`) and
    size (risk `maxOrderSize`, `12-engine-core.md`) before any arithmetic
    runs, so an absurd value is an `OrderRejected` (`InvalidPrice`,
    `InvalidSize`, `RiskMaxOrderSize`), not an overflow;
  - an overflow panic raised inside strategy code (its own fixed-point math)
    is a `strategy_fault`, caught per callback (`20-binary-protocol.md` G7);
  - anything else is an engine invariant violation: `engine_fault`.
  The checked forms compile to one add plus one never-taken branch. Book
  replay mostly assigns level sizes rather than adding them, so the cost is
  expected to be negligible; the M5a benchmark confirms it
  (`16-performance-and-parallelism.md`).
- **T4.** Why 1e6: USDC/pUSD and CTF outcome shares both have 6 decimals on
  chain. Fill sizes need all 6: 14,344 of 36,983 recorded `last_trade_price`
  prints (39%) have more than 2 decimals (measured on
  `data/events/btc/*.parquet`, 2026-07-21..25), and partial fills truncate on
  chain (`docs/polymarket/index.md:219-238`, 6 requested, 5.994806 received).
- **T5.** `f64` is allowed for feed prices (Binance, Chainlink, price to beat),
  plugin analytics and strategy-internal math. Turning an `f64` into a
  fixed-point value requires `from_f64(v, Rounding) -> Result<_, NonFinite>`.
- **T6.** Decimal text MUST be parsed exactly: up to 6 fractional digits is
  exact. More digits are rounded `HalfAwayFromZero` and counted in the
  diagnostic counter `inexact_decimal`. The parser MUST accept the full JSON
  number grammar, including exponents: TS `JSON.stringify(0.0000001)` emits
  `1e-7`, and the WIP `parse_micros` rejects it (`pmb-core/src/fixed.rs:136`).
  Money-bearing fields of the job JSON MUST be parsed from their decimal text,
  never through an `f64`.

## 3. Rounding

### 3.1 Modes

```rust
pub enum Rounding { Floor, Ceil, TowardZero, HalfAwayFromZero }
```

- **R-1.** There is no "half toward +∞" mode. That is JS `Math.round`, and
  emulating it is forbidden. The WIP `Round::Nearest` is half toward +∞
  (`pmb-core/src/fixed.rs:80-86`, `div_euclid` plus `rem*2 >= den`), and the
  WIP test `pnl_rounds_half_up_like_math_round` asserts the JS result
  (`pmb-core/src/stats/tests.rs:142-162`: −1.005 → −1.00). Both MUST be
  replaced: −1.005 → −1.01.
- **R-2.** Every rounding site names its mode. `Rounding` has no `Default`.
- **R-3.** One rounding per output. An output value is computed from exact
  state (micros, or an exact rational on `i128`) with exactly one rounding
  step. A value already rounded to a grid is never rounded again to a coarser
  grid. This prevents double rounding.

### 3.2 Policy

1. Where an exchange rule defines the arithmetic (`11-exchange-rules.md`), the
   realistic profile and the live adapter follow it exactly.
2. Otherwise rounding is **conservative**: amounts we pay or reserve round up,
   amounts and shares we receive round down.
3. Output quantization uses `HalfAwayFromZero` (§4).
4. ts-compat uses `HalfAwayFromZero` wherever TS used floats without explicit
   rounding. This is the closest integer match to an IEEE result, and parity
   tolerances absorb the remainder (`60-verification.md`).

### 3.3 Operation table

| # | Operation | Formula | Realistic / live | ts-compat | Notes |
|---|---|---|---|---|---|
| R1 | Decimal text → fixed | exact | exact; > 6 dp `HalfAwayFromZero` | same | T6 |
| R2 | `f64` → fixed (SDK helpers, feeds) | `v × 1e6` | caller-chosen | `HalfAwayFromZero` | Never implicit |
| R3 | Price → tick (SDK helper) | `p / tick` | BUY `Floor`, SELL `Ceil` | same | Never more aggressive than asked; the caller passes the mode |
| R4 | Shares → size step (0.01) | `q / step` | `Floor` | — (TS has no step) | Never larger than asked |
| R5 | BUY notional (cost, reservation) | `p × q / 1e6` | `Ceil` | `HalfAwayFromZero` | Cash moved by a realistic fill, maker fills from the signed amounts included: `13-execution-models.md` §6.4.1 |
| R6 | SELL notional (proceeds) | `p × q / 1e6` | `Floor` | `HalfAwayFromZero` | as R5 |
| R7 | Shares bought with collateral (FOK/FAK BUY fill) | `usdc × 1e6 / p` | `Floor` per fill, at the size precision of 11 §7.3 | n/a | CTF `calculateTakingAmount` truncates (`docs/polymarket/index.md:227`); per level: 13 §6.4.1 |
| R8 | Taker fee | 11 §5 | exact intermediate ≥ 1e-12 USDC, then `HalfAwayFromZero` to the fee dp; below the minimum → 0 | 4 dp `HalfAwayFromZero`; `< 0.0001` → 0 (`src/trading/fees.ts:18-24`) | Fee ≥ 0, so half-up = half-away |
| R9 | BUY reservation | notional + max fee | `Ceil` notional + max fee over every reachable fill price (§9.4) | `HalfAwayFromZero` notional + fee at limit, 700 bps, 0 if post-only (`src/trading/capital.ts:16-28`) | |
| R10 | Average-cost removal on SELL | `basis × sold / qty` | `HalfAwayFromZero`; a full close removes the whole basis | same | No residual basis on a closed position |
| R11 | Realized PnL of a SELL | proceeds − fee − removed basis | exact sum of rounded parts | same | |
| R12 | Split cost / merge proceeds / settlement | `size × 1`, `qty × payout` | exact | exact | No rounding |
| R13 | GTD seconds | `floor(expire_at_ms / 1000)` | `Floor` | n/a (TS backtest uses ms) | 11 §8 |
| R14 | Average entry price (output) | `Σ(p×q) / Σq` | one `HalfAwayFromZero` step from the exact rational to 4 dp | same | R-3 |
| R15 | Output money and shares | micros → 2 dp | `HalfAwayFromZero` | same | §4 |
| R16 | Latency samples | ms | `HalfAwayFromZero` to integer ms, clamped at 0 (§6.1 RNG-6) | same | distributions in `13-execution-models.md` |

The TS `round2` is not a 2 dp rounding: it rounds to 8 dp
(`src/trading/utils/rounding.ts:10-12`). It MUST NOT be emulated. Its residue
(≤ 5e-9 per operation) is below every tolerance in `60-verification.md`.

## 4. Output quantization (`MarketStats` boundary)

| Field | Quantization | Mode | DB column (`src/db/schema.ts:202-214`) |
|---|---|---|---|
| `pnl`, `feesPaid`, `cost`, `splitCost` | 2 dp | `HalfAwayFromZero` | decimal(14,4) |
| `upShares`, `downShares`, `mergableShares` | 2 dp | `HalfAwayFromZero` | decimal(18,6) |
| `avgEntryPriceUp`, `avgEntryPriceDown` | 4 dp, or `null` when there are no buys | `HalfAwayFromZero` | decimal(10,6) |
| `tradeCount`, `tradeAsMaker`, `tradeAsTaker` | integer | — | int |

- **Q1.** Every emitted value is at or below its column scale (D08), so a fresh
  run and a `--extend` that recomputes from DB decimals agree.
- **Q2.** JSON emission formats the quantized integer as an exact decimal: no
  exponent, no `-0`, no `f64` round trip (`21-job-and-output-contract.md`).
- **Q3.** These are the same dp as TS (`src/backtest/stats/marketStats.ts:186-198`),
  but the tie rule differs on purpose. TS computes
  `Math.round(x * 100) / 100` on an IEEE double. Measured with Node 20:

| Exact value | TS output | Rust output | Cause |
|---|---|---|---|
| −1.005 | −1.00 | −1.01 | JS ties go toward +∞ |
| −0.125 | −0.12 | −0.13 | JS ties go toward +∞ |
| 1.005 | 1.00 | 1.01 | `1.005*100` = 100.49999… in binary |
| 1.015 | 1.01 | 1.02 | binary representation |
| 0.285 | 0.28 | 0.29 | binary representation |
| −2.675 | −2.67 | −2.68 | both causes |

A third cause adds to these: the TS unrounded value carries accumulated float
error, so a true tie may arrive as x.xx4999…. Every such case is an
**intended difference** recorded once in `PARITY.md` (D08). Parity is judged on
unrounded trace values. The final stats are compared at 2 dp, and a 0.01
difference is accepted only when the unrounded values agree within tolerance
and straddle a rounding boundary (`60-verification.md`). This matters because
batch stats classify won/lost/flat by the sign of the **rounded** pnl
(`src/backtest/stats/batchStats.ts:194-235`).

## 5. Market, outcomes and assets

- **M1.** `enum Outcome { Up = 0, Down = 1 }` (`#[repr(u8)]`). All per-outcome
  state is stored as `[T; 2]` indexed by `Outcome`: books, positions, ticks,
  reservations. Token-id strings never appear in the hot path.
- **M2.** The token-id → `Outcome` mapping comes from the job's
  `marketResolution.tokenMap {UP, DOWN}`, which is authoritative. It is checked
  against `marketMeta` (`outcomes` plus `clobTokenIds` for version `v1`,
  `positionIds` for `v2`; 11 §10). A mismatch is invalid input (exit 2). Gamma
  index 0 is YES/UP (docs.polymarket.com/market-data/market-details, fetched
  2026-10-09). The parity trace uses the same indexes (22 §3.3).
- **M3.** Input readers map rows to `Outcome` by token id and never by column
  position. The Telonex `asset_index` points at the row's own
  `asset0_id`/`asset1_id` columns in file order, not UP/DOWN
  (`pmb-replay/src/telonex.rs:1-10,243-311`). A row with an unknown token is
  dropped and counted (`15-inputs.md`).
- **M4.** `TokenId` is a decimal U256 (up to 78 digits), parsed once into a
  32-byte value. `ConditionId` is a 32-byte value parsed from `0x`-hex.
- **M5.** `MarketInfo` (immutable, shared read-only across candidates):

| Field | Type | Source |
|---|---|---|
| `slug` | string | job |
| `symbol`, `timeframe` | enum | parsed from slug (BTC; 5m/15m, D06) |
| `condition_id` | `ConditionId` | job / first book event |
| `tokens` | `[TokenId; 2]` | M2 |
| `window` | `[start_ms, end_ms)` | slug epoch + timeframe; gating rules in `12-engine-core.md` (D23) |
| `version` | `V1 \| V2` | rules snapshot (11 §10) |
| `neg_risk` | bool | rules snapshot (11 §10) |

- **M6.** The final outcome (`FinalOutcome`, from the job's resolution) is used
  only for settlement. It MUST NOT be reachable from strategy code.

## 6. Identifiers

| Id | Rust type | Assigned by | Scope | Rules |
|---|---|---|---|---|
| Client order id | `ClientOrderId` (string) interned as `CidKey(u32)` | strategy | session | 1–256 bytes of printable ASCII. Existing conventions embed 78-digit token ids, e.g. `${name}:${slug}:${favAssetId}:buy`. Interned on first use; the string is kept only for I/O. |
| Order key | `OrderKey(u32)` | engine | session | One per **submission**: dense, starting at 0, assigned in intent-processing order. It is the generation id: a reused cid gets a new `OrderKey`. TS keyed pending submissions by object identity (`src/trading/OrderManager.ts:108-117`) and the WIP by cid (`pmb-core/src/order_manager.rs:183`, which breaks cancel-and-replace dedupe). `OrderKey` replaces both. |
| Exchange order id | `ExchangeOrderId` | exchange / simulator | session | Live: the exchange order hash, kept in a side table keyed by `OrderKey`. Simulator: not stored, rendered as `sim-{order_key}` at I/O. The core never uses it as a key; cancel-by-exchange-id resolves through the side table. |
| Fill key | `FillKey { order: OrderKey, seq: u32 }` | adapter | session | `seq` starts at 1 per order and strictly increases in delivery order. Raw exchange fill identity (per-maker legs, WS/REST dedupe) is owned by `50-live-runtime.md` §8.2.5; see I3. |
| Trade sequence | `TradeSeq(u32)` | adapter | session | One per exchange trade. Live: per trade id. Simulator: one per match event, so a taker match across several levels at one exchange time is one trade, and each maker fill of our resting order is one trade (`13-execution-models.md` §6.7: one `SettlementUpdate` per trade). Dense from 0 in the order the adapter first observes the trade. Keys settlement updates and the settlement draws (§6.1). |
| Cancel operation | `CancelOp { seq: CancelSeq(u32), kind: CancelKind }` | engine | session | One per cancel intent the engine processes, including one that fails at once, dense from 0 in intent-processing order. `CancelKind = Order \| Batch \| Market \| All`. A deferred cancel keeps the `CancelOp` of its intent. Keys `CancelAcked`, `CancelFailed`, `CancelCause::Strategy` and the cancel-latency draws. |
| Operation key | `OpKey(u32)` | engine | session | Split and merge operations. |
| Meta id | `MetaId(u32)` | engine | session | Index into the session's meta store (§7.5). |

- **I1.** No identifier and no RNG draw may derive from the wall clock, job
  `idx`, worker, thread, or position in a candidate group. Seeds and draws are
  defined in §6.1.
- **I2.** Identifier strings are formatted only at I/O boundaries (trace,
  journal, live REST, WebUI).
- **I3. Fill granularity.** The live adapter keeps raw legs with the ids of
  `50-live-runtime.md` §8.2.5 (maker `{tradeId}:M:{ourOrderId}`, taker leg
  `{tradeId}:T:{makerOrderId}`) in the journal and ledger, and dedupes WS and
  REST copies on those ids. It emits **one core `Fill` per (own order, trade,
  price level)**: taker legs of one trade at the same price are summed into
  one `Fill` (VWAP unchanged). This matches the simulator's one fill per (own
  order, level) (`13-execution-models.md` §4.5), so `tradeCount`,
  `tradeAsMaker` and `tradeAsTaker` keep the TS meaning
  (`src/trading/execution/BacktestExecution.ts:146-170`) and live, paper and
  backtest rows of the same slug are comparable (D11). TS live keyed a taker
  fill by `tradeId` and a maker fill by `${tradeId}:${makerOrderId}`
  (`src/polymarket/ws/userWsAccountSource.ts:312,336`); that shape is not
  kept. The legs of one trade arrive in one message, so the aggregate is
  emitted exactly once, when its first source arrives.

### 6.1 Seeds and random draws

The realistic simulator draws execution latencies, market-data receipt
delays, feed latencies, settlement delays and failure outcomes, and
ts-compat draws the optional compat jitter (`13-execution-models.md` §5.1,
§6.8; `12-engine-core.md` §4.3; `14-feeds-and-plugins.md` F-51). Everything below is normative; changing
any constant, tag, encoding or mapping changes realistic results and is an
engine-semantics change (`engineVersion` bump plus a CONTRACT changelog entry,
`30-strategy-sdk.md`).

- **RNG-1. Run seed.** `run_seed` is an integer in `[0, 2^53 − 1]`, so it is
  exact as a JSON number in TS and fits the `bigint` run column
  (`42-persistence-and-stats.md`). It is chosen by the producer: the value of
  the CLI flag `--seed <n>` (decimal digits only; anything else, or a value
  outside the range, is refused at submit), else **0**. A fixed default keeps
  every command reproducible from its text and gives two runs compared through
  `baseline_id` the same draws (common random numbers). Robustness across
  latency realizations is checked by re-running with other seeds. The
  producer stores it in `ModelConfig.seed` as a JSON integer and in
  `backtest_runs.seed`; `--extend` and every candidate of a group inherit it
  (D09, D14). The binary never chooses a seed.
- **RNG-2. Market seed.**
  `market_seed = LE64(SHA-256("pmb-seed/v1" ‖ LE64(run_seed) ‖ UTF-8(slug))[0..8])`,
  where `LE64` is the 8-byte little-endian encoding (read back as `u64` from
  the first 8 digest bytes) and `‖` is concatenation. Nothing else enters it:
  not `idx`, candidate index, profile, strategy, worker or time (I1).
- **RNG-3. Stream seed.** Each stream has a fixed ASCII tag. The tags and
  the entity each component uses are owned by `13-execution-models.md` §6.8
  (`place`, `cancel`, `ack`, `cancelAck`, `fillReport`, `mined`,
  `confirmed`, `failed`, `chainSplit`, `chainMerge`, `md_cmd`, `md_row`,
  `settlement_failure`, `chain_failure`, `compat_jitter`) and by
  `14-feeds-and-plugins.md` F-51 (`feed.binance`, `feed.chainlink`,
  `feed.priceToBeat`). There are two kinds of stream:
  - (a) per-market streams (every 13 tag, and `feed.priceToBeat`):
    `stream_seed(tag) = LE64(SHA-256("pmb-stream/v1" ‖ LE64(market_seed) ‖ ASCII(tag))[0..8])`,
    computed once per session and tag;
  - (b) run-level feed streams (`feed.binance`, `feed.chainlink`; one live
    connection delivers each element once to every market, so overlapping
    5m and 15m markets of one run draw the same latency for it, 14 F-51):
    `feed_stream_seed(tag) = LE64(SHA-256("pmb-feed-stream/v1" ‖ LE64(run_seed) ‖ ASCII(tag))[0..8])`.
- **RNG-4. Entity key.** A draw belongs to one entity, a `u64`. Per-market
  execution streams use `entity = (kind << 32) | id`, with kind `1` =
  `OrderKey`, `2` = `CancelSeq`, `3` = `TradeSeq`, `4` = `OpKey`, `5` =
  execution-command sequence, `6` = input row index of the market file
  (`12-engine-core.md` §4.3). Which entity a component uses is fixed in the
  13 §6.8 table. Feed streams use the element identities of 14 F-51
  (Binance `agg_trade_id`, a hashed Chainlink row key, price-to-beat entity
  0), without the kind packing; their tags keep them disjoint from execution
  streams.
- **RNG-5. Draw.** Draw `i` (`i = 0, 1, …`) of an entity is the `(i+1)`-th
  output of SplitMix64 started from state `h`:
  ```text
  mix64(z): z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
            z = (z ^ (z >> 27)) * 0x94D049BB133111EB
            return z ^ (z >> 31)
  G = 0x9E3779B97F4A7C15
  h          = mix64(stream_seed ^ mix64(entity + G))
  draw(i)    = mix64(h + G * (i + 1))
  ```
  All arithmetic here is explicit `wrapping_*` on `u64` (the T3 rule is for
  money, not hashing). A draw is a pure function of (stream, entity, i), never
  of call order, so fixing one component never shifts another and A/B
  variants keep per-order draws aligned. Cost: three `mix64` calls (a few
  nanoseconds) per draw, no state, no allocation, no locking across threads.
- **RNG-6. Mappings.**
  - Uniform integer in `[0, n)`, `n ≥ 1`: for `i = 0, 1, …`, accept
    `u = draw(i)` when `u < n × floor(2^64 / n)` (computed on `u128`) and
    return `u mod n`. Exact and unbiased; a retry happens with probability
    below `n / 2^64`.
  - Integer uniform in `[a, b]`: `a +` uniform integer in `[0, b − a + 1)`.
    The compat jitter in `[−j, j]` is this with `a = −j`, `b = j`.
  - Bernoulli with probability `p` (a `Rate`, 1e-6 units): uniform integer in
    `[0, 1_000_000)` `< p`. Integer only.
  - Open unit interval: `u = ((draw(i) >> 11) + 0.5) × 2^−53`, exact in `f64`
    and never 0 or 1.
  - Continuous distributions use one `u` (draw 0) through the inverse CDF, so
    one quantile maps monotonically across parameter changes: `empirical` by
    linear interpolation in its quantile table; `lognormal` as
    `exp(mu + sigma × Φ⁻¹(u))` with Φ⁻¹ by Wichura's AS241 (PPND16) on the
    pure-Rust `libm` (D-2). Exception: the `md_cmd` stream gives one entity
    several sub-samples; sub-sample `k` uses draw index `k` (13 §6.8) as its
    single `u`.
  - A continuous sample becomes integer ms with `HalfAwayFromZero` (Rust
    `f64::round`, exact) and is clamped to `[0, 2^31 − 1]`. Any truncation of
    tails is a parameter of the component in 13, not of this mapping.
- **RNG-7. Golden vectors** (slug `btc-updown-15m-1780272000`; computed with
  an independent implementation; SplitMix64 itself checks against the
  reference outputs `0xe220a8397b1dcdaf`, `0x6e789e6aa1b965f4` from state 0).
  They are committed as a unit test and belong to the determinism suite
  (`60-verification.md` §9):

| Input | Value |
|---|---|
| `market_seed(run_seed = 0)` | `0xeb300da7cf82ecde` |
| `market_seed(run_seed = 123)` | `0x735cf00eaa5d23b2` |
| `market_seed(run_seed = 2^53 − 1)` | `0x2b93662d0e90152f` |
| `stream_seed("place")`, run seed 0 | `0xffc27cae89ae3033` |
| `stream_seed("compat_jitter")`, run seed 0 | `0x0162432c20a594c5` |
| `place`, entity `OrderKey(0)` = `0x0000000100000000`: `draw(0)`, `draw(1)` | `0x7ac83cc051482e69`, `0x6af33a6533ac1ffa` |
| `place`, entity `OrderKey(0)`: open-interval `u` | `0.4796178788685956` |
| `place`, entity `OrderKey(1)`: `draw(0)` | `0x610af8c6b7bb80bd` |
| `compat_jitter`, `j = 100`, command 0, 1, 2 (kind 5): jitter | `−34`, `−78`, `−52` |
| `md_row`, run seed 0, row 0 (kind 6): `draw(0)` | `0xbe885d470957411b` |
| `feed_stream_seed("feed.binance")`, run seed 0 | `0x9416e0f7dd99bfb2` |
| `feed.binance`, `agg_trade_id = 3_000_000_000`: `draw(0)` | `0x3d2083a3f2c7d945` |
| `feed.chainlink`, row (`timestamp_us = 1780272000000000`, `server_timestamp_us = 1780272001012345`): entity (14 F-51), `draw(0)` | `0x21f0f8efcd0a5519`, `0x4469676c00a02960` |
| `feed.priceToBeat`, run seed 0 (per-market stream), entity 0: `draw(0)` | `0xf00c88f6376b1577` |

## 7. Orders and intents

### 7.1 Order types

| `OrderType` | Class | Rests | Post-only allowed | Size unit (realistic/live) | Size unit (ts-compat) |
|---|---|---|---|---|---|
| `Gtc` | resting | remainder | yes | shares | shares |
| `Gtd` | resting, with expiry | remainder until effective expiry | yes | shares | shares |
| `Fok` | market | never | no | BUY: collateral; SELL: shares | shares |
| `Fak` | market | never; remainder killed | no | BUY: collateral; SELL: shares | not produced by TS strategies (no oracle); realistic semantics apply |

The WIP model already has FAK (`pmb-core/src/model.rs:66-78`). TS has no FAK
(`src/strategy/Strategy.ts:13`, `src/trading/execution/LiveExecution.ts:37-42`).

### 7.2 `OrderRequest`

| Field | Type | Rules |
|---|---|---|
| `cid` | `CidKey` | required |
| `outcome` | `Outcome` | required |
| `side` | `Buy \| Sell` | required |
| `price` | `Price` | Resting: the limit price. Market: the worst acceptable price (BUY maximum, SELL minimum). |
| `size` | `OrderSize` | `Shares(Qty)` or `Collateral(Usdc)` (below) |
| `order_type` | `OrderType` | required |
| `post_only` | bool | resting types only |
| `expire_at_ms` | `Option<TsMs>` | required for GTD, ignored otherwise (§7.4) |
| `meta` | `Option<MetaId>` | §7.5 |
| `note` | `Option<&'static str>` | log and trace only; never affects behavior |

`OrderSize`:

- **O1.** Resting orders and market SELLs MUST use `Shares`.
- **O2.** A realistic, paper or live FOK/FAK BUY is sized in collateral, the
  pre-fee USD amount to spend, with the fee added on top (CLOB V2;
  docs.polymarket.com/trading/place-orders, fetched 2026-10-09). An
  `OrderSize::Shares(q)` on a market BUY is converted to
  `Collateral(price.notional(q, Floor))`, floored to the amount decimals of the
  tick (11 §7). The order can then receive **more** than `q` shares when it
  fills below the limit price. This is the documented exchange behavior
  (D42), and the SDK MUST say so next to `buy_spend`
  (`30-strategy-sdk.md`). The RF04 A/B report shows shares received vs
  requested per market (`13-execution-models.md` §7.1).
- **O3.** ts-compat sizes a FOK BUY in shares, as TS does
  (`src/trading/execution/BacktestExecution.ts:395-418`).

### 7.3 Intents

| Intent | Payload | Realistic / live limits | ts-compat | TS kind |
|---|---|---|---|---|
| `PlaceLimit` | one `OrderRequest` | — | — | `place_limit` |
| `PlaceBatch` | 1..=N `OrderRequest` | N ≤ batch cap (15, 11 §9). Entries are validated, funded and answered independently. | no cap in the TS simulator | `place_batch` |
| `CancelOrder` | `OrderRef` | — | TS semantics (13) | `cancel_order` |
| `CancelBatch` | `Vec<OrderRef>` | ≤ cancel-id cap (1000, 11 §9) | ≤ 3000 (`src/trading/cancellation.ts:69`) | `cancel_batch` |
| `CancelMarket` | `Option<Outcome>` filter | Market scope is the session's condition id. A request naming another market fails with `CancelFailed`. | TS semantics | `cancel_market` |
| `CancelAll` | — | — | — | `cancel_all` |
| `SplitPositions` | `size: Qty` (full sets; costs `size` USDC) | async operation (D25) | instant (TS) | `split_positions` |
| `MergePositions` | `size: Qty` | async operation (D25) | instant (TS) | `merge_positions` |

- **N1.** `OrderRef = Cid(CidKey) | Exchange(ExchangeOrderId) | Both`. `Both`
  MUST agree, otherwise the cancel fails with `ConflictingRefs`.
- **N2.** There is one placement path: `PlaceLimit` is a batch of one. TS
  duplicates about 140 lines between the two paths
  (`src/trading/execution/BacktestExecution.ts:330-476` vs `495-628`).
- **N3.** The TS split and merge intents carry `assetIdA`/`assetIdB`, and split
  also carries `costPerShare`, which is only logged
  (`src/strategy/Strategy.ts:94-113`). A session always splits and merges the
  pair (UP, DOWN), so Rust drops these fields. The trace renders them.
- **N4.** A split of `size <= 0` emits `SplitFailed(InvalidSize)`. A merge of
  `size <= 0` emits `MergeFailed(InvalidSize)` in realistic. TS silently drops
  it, and ts-compat keeps that (`src/trading/OrderManager.ts:411`).
- **N5.** Validation order, dedupe and funding are defined in
  `12-engine-core.md`. Exchange-rule validation is defined in
  `11-exchange-rules.md`. A placement of a cid with an active generation is
  dropped silently and counted (`duplicate_active_cid`, 12 §7.6); it is not a
  reject reason.
- **N6. No self-crossing orders** (D54; realistic, paper and live; not
  ts-compat, because TS has no such check, 13 TC-C14). The engine rejects with
  `SelfCross` any order that could match one of the session's own orders at
  the exchange. Own orders are the non-terminal orders of every type
  (`InFlight`, `Delayed`, `Live`, `Unknown`; an in-flight FOK/FAK can still
  meet an own order that arrives before it) whose cancel the exchange has not
  acknowledged (`CancelState::Acked`), plus the earlier entries of the same
  batch. A new order on outcome `o` at price `p` crosses an own order at
  price `q` when: BUY vs own SELL on `o` with `p ≥ q`; SELL vs own BUY on
  `o` with `p ≤ q`; BUY vs own BUY on the other outcome with `p + q ≥ 1`
  (mint match); SELL vs own SELL on the other outcome with `p + q ≤ 1`
  (merge match). A market order's price, new or own, is its worst
  acceptable price. The check
  runs in engine validation (12 §7), so the exchange's undocumented
  self-trade behavior is never exercised and not probed.

### 7.4 GTD expiry semantics

Rule ids are `GD1`–`GD4` (they were `G1`–`G4`, which clashed with the gate
names).

- **GD1.** `expire_at_ms` is the **stated exchange expiration**: the value the
  live adapter sends, in whole seconds `floor(expire_at_ms / 1000)` (R13). This
  keeps the meaning of the TS field, which live already sends as
  `Math.floor(expireAtMs / 1000)` (`src/trading/execution/LiveExecution.ts:189-191,318-320`),
  and matches the Polymarket API.
- **GD2.** Effective expiry = stated − early-expiry offset. The offset is 60 s
  in realistic and live, and 0 in ts-compat, where TS expires at `expireAtMs`
  exactly. Minimum lead and the arrival-time check are in 11 §8.
- **GD3.** The SDK provides
  `gtd_expiration_for_lifetime(now, lifetime) = now + early_expiry + lifetime`,
  the docs' recipe "now + 60 + N".
- **GD4.** Consequence: exerciser case `x3` (`expireAtMs = tick ts + 120000`,
  60 §5.2) is accepted in ts-compat and rejected in realistic
  (lead < 3 min). This is intended and documents the rule.

### 7.5 Intent meta

- **E1.** Each order may carry a JSON object. It is stored once per session in
  the meta store as pre-serialized JSON (`Box<serde_json::value::RawValue>`),
  addressed by `MetaId`. Events never clone it.
- **E2.** Meta is materialized only for `intentMeta`: the first fill per cid, in
  fill order, unfilled orders excluded. It is never parsed by the engine. The
  size cap and the overflow behavior are in `21-job-and-output-contract.md`.

## 8. Order state machine

### 8.1 States

```rust
enum OrderState {
    InFlight,              // accepted by the engine, sent, not yet at the exchange / acked
    Delayed,               // at the exchange, held in the taker-delay window
    Live,                  // resting; filled may be > 0 (partially filled)
    Unknown,               // live only: ambiguous REST outcome, awaiting reconciliation
    Filled, Canceled(CancelCause), Expired, Killed, Rejected(RejectReason), // terminal
}
enum CancelState { None, Deferred, InFlight, Acked, Failed, Unknown }   // orthogonal to OrderState
```

- `Deferred`: a cancel by cid targets an `InFlight` order that has no exchange
  id yet (realistic and live). The engine holds the cancel and sends it when
  the order is acknowledged. If the order goes terminal first, the cancel
  resolves silently.
- `Acked` (realistic and live): the exchange confirmed the cancel (live: the
  order id is in the REST `canceled` list), but the authoritative final
  filled size has not arrived yet. The order stays non-terminal, fills
  matched before the cancel can still arrive, and the reservation is held
  (S3). The terminal `OrderDone(Canceled, filled)` follows from the user-WS
  `CANCELLATION` or a REST order read (`50-live-runtime.md` §8.2.4). This is
  why `OrderDone` can always carry the exchange's filled quantity. ts-compat
  never enters `Acked`: TS terminates the order at once.
- `Unknown` (order or cancel): the live adapter got a timeout, 5xx or reset
  with no definitive answer. It is never retried blindly: REST reconciliation
  of open orders and trades resolves it (`50-live-runtime.md`).

### 8.2 Transitions

| From | Input | To | Events (in order) |
|---|---|---|---|
| — | intent passes engine validation, dedupe, risk and funding | `InFlight` | `OrderSubmitted` |
| — | intent fails in the engine | no order | `OrderRejected{origin: Engine}`, with no `OrderSubmitted` before it (TS: `src/trading/OrderManager.ts:664-706`) |
| `InFlight` | exchange rejects at arrival (rules, post-only cross, market closed) | `Rejected` | `OrderRejected{origin: Exchange}` |
| `InFlight` | arrives, not marketable (resting type) | `Live` | `OrderAccepted`, `OrderOpen` |
| `InFlight` | arrives marketable, taker delay = 0 | match | `OrderAccepted`, `Fill`×n, then `OrderOpen` (GTC/GTD remainder) or `OrderDone` |
| `InFlight` | arrives marketable, taker delay > 0 | `Delayed` | `OrderAccepted`, `OrderDelayed` |
| `Delayed` | delay ends; re-validation fails | `Rejected` | `OrderRejected{origin: Exchange}` |
| `Delayed` | delay ends; still marketable | match | `Fill`×n, then `OrderOpen` or `OrderDone` |
| `Delayed` | delay ends; no longer marketable | `Live` (resting) / `Killed` (market) | `OrderOpen` / `OrderDone(Killed, filled=0)` |
| `Delayed` | cancel arrives, non-cancellable era (11 §6) | `Delayed` | `CancelFailed(NotCancelableDuringDelay)` |
| `Live` | maker fill, remainder > 0 | `Live` | `Fill` |
| `Live` | maker fill completes the size | `Filled` | `Fill`, `OrderDone(Filled)` |
| `Live` | cancel arrives at the exchange (ts-compat) | `Canceled(cause)` | `OrderDone(Canceled, filled)` |
| `Live` | cancel arrives at the exchange (realistic, live) | `Live` with `CancelState::Acked` on `CancelAcked`, then `Canceled(cause)` on `OrderDone` | `CancelAcked` (REST answer), then `OrderDone(Canceled, filled)` (user-WS cancellation or REST read). They may be delivered in either order (13 §6.7); a `CancelAcked` delivered after the order is terminal is recorded in the ledger and journal and not delivered to the strategy. |
| `Live` | effective GTD expiry | `Expired` | `OrderDone(Expired, filled)` |
| `Live` | window end (D23), market close, heartbeat loss, kill switch, rotation | `Canceled(cause)` | `OrderDone(Canceled(cause), filled)` |
| market order | fill complete | `Filled` | `Fill`×n, `OrderDone(Filled)` |
| FOK | insufficient liquidity at match time | `Killed` | `OrderDone(Killed, filled=0)` |
| FAK | partial or zero fill | `Killed` | `Fill`×k, `OrderDone(Killed, filled)` |
| `Unknown` | reconciliation finds the order open / filled / absent | `Live` / terminal / `Rejected(NotFoundAfterAmbiguous)` | the matching events, journaled |
| any terminal | late fill (live: trade after cancellation) | unchanged | `Fill`, applied and flagged `late` |

### 8.3 Invariants

- **S1.** Terminal states are absorbing. Each `OrderKey` gets exactly one
  terminal event (`OrderDone` or `OrderRejected`).
- **S2.** `filled <= size` for share-sized orders, and collateral spent ≤ amount
  for collateral-sized orders.
- **S3.** `OrderDone.filled: Option<Qty>` is the authoritative cumulative fill
  when present. The simulator always sets it. In live it can be absent when
  neither the user-WS cancellation nor the bounded REST read delivered the
  size (`50-live-runtime.md` §8.2.4). The order is then terminal for the strategy, but
  its reservation is held until an authoritative quantity arrives (TS rule,
  `src/trading/Portfolio.ts:210-297`).
- **S4.** A cid maps to at most one non-terminal order. Reuse after a terminal
  state creates a new `OrderKey` (§6).
- **S5.** Fills are never dropped, including late fills, fills past a cascade
  limit, and fills for an order whose ack has not arrived yet: they are
  buffered by exchange id and applied on ack (`12-engine-core.md`,
  `50-live-runtime.md`).
- **S6.** Only orders placed by this session produce strategy events. Foreign
  orders on the same key are invisible to the core (`50-live-runtime.md`).

### 8.4 Mapping to TS lifecycle strings (trace and SDK compatibility)

| Rust | TS `OrderLifecycleState` (`src/strategy/Strategy.ts:151-159`) |
|---|---|
| `InFlight`, `Delayed`, `Unknown` | `requested` |
| `Live` with `filled == 0` / `> 0` | `open` / `partially_filled` |
| `Filled`, `Canceled`, `Expired`, `Killed`, `Rejected` | same names |

The ts-compat sequence quirks (MATCHED status at acceptance, cancel bound by
cid, silent no-op on cancelling an unknown order, delayed actions run on the
next tick) are listed in `13-execution-models.md`. They change when events are
emitted, not the state set above.

## 9. Fills, settlement, positions, capital

### 9.1 `Fill`

| Field | Type | Notes |
|---|---|---|
| `key` | `FillKey` | §6 |
| `trade` | `TradeSeq` | the exchange trade this fill belongs to (§6; several fills can share one trade) |
| `outcome`, `side` | `Outcome`, `Side` | Our side. For maker fills, taken from our own order (live: `maker_orders[]` filtered by owner, `src/polymarket/ws/userWsAccountSource.ts:283-326`). |
| `price` | `Price` | execution price |
| `qty` | `Qty` | |
| `fee` | `Usdc` | Computed once by `ExchangeRules` (11 §5): 0 for makers. Portfolio, stats and traces only ever sum `fill.fee`. TS recomputes it from `feeRateBps` in four places (`src/trading/Portfolio.ts:894-899`, `src/backtest/stats/marketStats.ts:128-134`, `src/backtest/simulator/traceWriter.ts:219-224`, `src/trading/capital.ts:30-40`). |
| `liquidity` | `Maker \| Taker` | |
| `at` | `TsMs` | time the fill becomes visible to the engine (`12-engine-core.md`) |
| `exchange_ts` | `Option<TsMs>` | match time when known |
| `late` | bool | arrived after the order was terminal |

The trade id, transaction hash and per-maker-level details live in the journal
and ledger side tables (`22-trace-ledger-journal.md`), not in the core struct.

### 9.2 Settlement status

```rust
enum SettlementStatus { Matched, Mined, Confirmed, Retrying, Failed }
```

| Status | Terminal | Rank (TS `TradeStatusRank`) |
|---|---|---|
| `Matched` | no | 1. The user-WS status `MATCHED_NOT_BROADCASTED` normalizes to `Matched` (same rank, not sellable under a `Mined` gate; a no-op when the trade is already `Matched`). The raw status stays in the journal and ledger (`50-live-runtime.md` §8.2.4). TS does not know it (`src/polymarket/ws/userWsAccountSource.ts:42`). There is no separate variant: no rule and no strategy decision depends on the difference, and the simulator never produces it. |
| `Retrying` | no | keeps the previous rank (TS drops it as rank 0, a bug: `src/polymarket/ws/userWsAccountSource.ts:41-48,243-246`) |
| `Mined` | no | 2 |
| `Confirmed` | yes, success | 3 |
| `Failed` | yes, failure | — |

Statuses are per trade (docs.polymarket.com/concepts/order-lifecycle, fetched
2026-10-09). A trade is atomic: a status change applies to every fill of that
trade, and the adapter delivers one `SettlementUpdate` per such fill, in fill
order, so each fill carries its own status.

- **F1.** `Failed` reverses the fill: position, cash, fee and realized PnL
  return to their pre-fill values, and the order's filled quantity drops. The
  reversal is an event (§10), never silent.
- **F2.** Sellable inventory for SELL and merge counts only shares whose fill
  status is ≥ `sell_gate` (ModelConfig; realistic and live default `Mined`, per
  the CLAUDE.md MINED gotcha), minus shares reserved by open SELL orders and
  pending merges. ts-compat has no engine-level gate: TS allows naked sells
  (`src/trading/Portfolio.ts:925`), a sequence quirk listed in 13.
- **F3.** The simulator produces the status progression from a calibrated
  report model (`13-execution-models.md`). ts-compat reproduces the TS synthetic
  statuses.

### 9.3 Position

- `Position { qty: Qty, cost_basis: Usdc }` per outcome, average-cost basis
  (R10). Realistic invariants: `qty >= 0`, `cost_basis >= 0`, and
  `qty == 0 ⇒ cost_basis == 0`.
- BUY fees are added to cost basis. SELL fees reduce proceeds. Fees are paid in
  USDC on both sides, never in shares (`docs/polymarket/index.md:111`).

### 9.4 Capital

- `Capital { starting: Usdc, cash: Usdc, reserved: Usdc }`, with
  `available = cash − reserved`. The starting allowance follows D31 (backtest:
  per-market allowance; live: the min() rule).
- **C1.** A BUY reservation MUST be an upper bound on the cash the order can
  consume, including fees, at any reachable fill price:
  - Share-sized BUY: `Ceil(limit × q)` + fee at the limit price. The fee at a
    better price can be higher, but the notional saving always exceeds it for
    the fee curves of 11 §5.
  - Collateral-sized BUY: `amount` + the maximum fee over fill prices in
    `[tick, limit]` for that amount. For the exponent-1 curve that is
    `amount × rate × (1 − tick)`.
  - Post-only resting orders reserve notional only.
  - One exception to the bound: fees are rounded per fill (11 §5), so several
    fills can cost up to half a fee unit (0.000005 USDC) per fill more than
    the reserved fee. This dust is charged to cash. It MUST NOT reject, kill
    or stop an order that was already accepted, and it is reported in the
    diagnostics counter `reservation_dust`.
- **C2.** Realistic: open SELL orders reserve shares, as the exchange computes
  "balance minus open order size minus filled"
  (docs.polymarket.com/concepts/order-lifecycle).
- **C3.** A reservation is released only on an authoritative final quantity (S3).
- **C4.** PnL is cash-based:
  `pnl = cash_end − starting + Σ_o qty_o × payout_o`. The cost-basis
  decomposition (realized + settlement value − remaining basis) MUST equal it,
  checked by a debug assertion and a property test. TS breaks this identity
  for in-market merges (`src/trading/Portfolio.ts:562`; classified as a TS bug,
  `research/approach-audit.json`), and the WIP double-counts split cost in
  realistic (`pmb-core/src/stats.rs:241-246` plus `portfolio.rs:549-560`).

## 10. Account events

### 10.1 Variants

| Rust variant | Payload | Emitted by | TS kind | In the parity trace (22 §3.2) |
|---|---|---|---|---|
| `OrderSubmitted` | `order: OrderKey` | engine | `order_submitted` | yes |
| `OrderRejected` | `order: Option<OrderKey>`, `cid`, `reason: RejectReason` | engine / adapter | `order_rejected` | yes (reason code compared, 22 §3.4) |
| `OrderAccepted` | `order`, `exchange_id` (live) | adapter | `order_accepted` | yes |
| `OrderDelayed` | `order`, `release_at` | adapter | — (new) | realistic only |
| `OrderOpen` | `order` | adapter | `order_open` | yes |
| `Fill` | `Fill` | adapter | `fill` | yes |
| `SettlementUpdate` | `order`, `fill: Option<FillKey>`, `status`, `size_matched` | adapter / report model | `ws_order_update` | yes (`settlement_update`, both profiles) |
| `OrderDone` | `order`, `reason: DoneReason`, `filled: Option<Qty>` | adapter / engine | `order_done` | yes |
| `CancelAcked` | `op: CancelOp`, `order: OrderKey` | adapter | — (new; trace and ledger kind `cancel_acked`) | realistic and live only; never in a ts-compat trace (`22-trace-ledger-journal.md` §3.2) |
| `CancelFailed` | `op: CancelOp`, `order: Option<OrderKey>`, `reason` | engine / adapter | `cancel_failed` | yes |
| `PositionsSplit` | `op: OpKey`, `size`, `cost` | adapter | `positions_split` | yes |
| `SplitFailed` | `op`, `requested`, `reason` | adapter / engine | `split_failed` | yes |
| `PositionsMerged` | `op`, `size` | adapter | `positions_merged` | yes |
| `MergeFailed` | `op`, `requested`, `reason` | adapter / engine | `merge_failed` | yes |
| `StreamStatus` | `source`, `connected` | live adapter | `account_stream_status` | no |

- **V1.** `SettlementUpdate{status: Failed}` carries the reversal of F1. In
  ts-compat, `fill: None` reproduces the TS acceptance-time `MATCHED` update
  with `sizeMatched = 0` (`src/trading/execution/BacktestExecution.ts:378-392`).
  In realistic and live, `fill` is always set (one update per fill, §9.2).
- **V1a.** `CancelAcked` is non-terminal: it sets `CancelState::Acked` and
  changes nothing else (`12-engine-core.md` §9.2). One is emitted per order
  the exchange confirms as canceled, including each order confirmed by a
  `cancel_market` or `cancel_all` answer. The strategy sees it under the
  lifecycle interest (`30-strategy-sdk.md` §4.1).
- **V2.** Every event carries `at: TsMs`, the engine time at which it is
  delivered. Which clock that is, and how events are queued and cascaded, is
  defined in `12-engine-core.md` (D27).
- **V3.** Events are small `Copy` values that reference keys. The order, its
  meta and its strings are read through the session state, never cloned into
  the event. TS events alias mutable state (`src/trading/Portfolio.ts:594-595`)
  and the WIP clones the full order with its meta
  (`pmb-core/src/model.rs:283-286`). Neither is carried over.

### 10.2 Reason enums

All reasons are enums. TS strings are produced only at the trace and I/O
boundary.

| Enum | Variants (TS string where one exists) |
|---|---|
| `RejectReason` (engine origin) | `InvalidPrice` (`invalid_price`), `InvalidSize` (`invalid_size`), `UnknownOutcome` (`missing_assetId`), `PostOnlyRequiresResting` (`post_only_requires_gtc_or_gtd`), `GtdRequiresExpiry` (`gtd_requires_expireAtMs`), `GtdExpiryTooSoon{min_offset_ms}` (`gtd_expireAtMs_too_soon(min_offset_ms=60000)`), `InsufficientCapital{required, available}` (`insufficient_capital(required=X,available=Y)`), `InsufficientInventory{required, available}`, `RiskMaxOpenOrders{max}` (`risk_max_open_orders(max=100)`), `RiskMaxOrderSize{max}`, `RiskMaxAbsPosition{max}`, `RiskLossStop{realized}`, `BatchTooLarge{max}` (`batch_too_large(max_15_orders)`), `SelfCross{resting: OrderKey}` (N6; no TS string, never in a ts-compat trace), `MetaTooLarge`, `StrategyHalted`, `KillSwitch`. Not a reason: duplicate active cids are dropped silently (N5). |
| `RejectReason` (exchange origin) | `InvalidTick{price, tick}`, `PriceOutOfBounds{min, max}`, `SizeBelowMinimum{min}`, `NotionalBelowMinimum{min}`, `SizePrecision`, `AmountPrecision`, `PostOnlyWouldCross` (`post_only_would_cross`), `GtdLeadTooShort{min_lead_ms}`, `MarketClosed`, `TradingRestricted{mode}` (`mode = PostOnly | CancelOnly | Disabled | Restarting`; `Restarting` is HTTP 425, `50-live-runtime.md` §8.2.8), `RateLimited{retry_after_ms}`, `InsufficientExchangeBalance`, `NotFoundAfterAmbiguous`, `Unmapped(code)` (raw text in the journal only) |
| `DoneReason` | `Filled`, `Canceled(CancelCause)`, `Expired`, `Killed` |
| `CancelCause` | `Strategy(CancelOp)`, `Rotation`, `WindowEnd`, `MarketClosed`, `HeartbeatLoss`, `KillSwitch`, `StrategyPanic` (D32), `Operator`, `Exchange` |
| `CancelFailReason` | `UnknownClientOrder` (`unknown_client_order`), `ConflictingRefs`, `MissingExchangeOrderId` (`missing_exchange_order_id`), `NotCancelableDuringDelay`, `ExchangeNotCanceled(code)`, `TooManyIds`, `Ambiguous` |
| `SplitFailReason` / `MergeFailReason` | `InvalidSize`, `InsufficientCollateral`, `InsufficientPairs`, `TxFailed`, `Ambiguous` |

TS reason strings are asserted in TS tests (`src/trading/runnerConfig.test.ts:147-166`,
`src/trading/capital.test.ts:155-188`), and the simulator parses
`insufficient_capital(...)` by regex (`src/backtest/simulator/contracts.ts:186-197`).
The trace renderer MUST reproduce those exact formats. Numbers in them are
printed as exact decimals with trailing zeros trimmed.

## 11. Performance requirements on domain types

Speed is the top priority. These rules make the hot path allocation-free and
cache-friendly:

- **P1.** Scalars are 8-byte `Copy` values. `Outcome` is a `u8`. Keys are `u32`.
  `AccountEvent` and `Intent` (without batch storage) SHOULD be ≤ 64 bytes,
  checked with `static_assertions`.
- **P2.** Orders live in a per-session slab `Vec<Order>` indexed by `OrderKey`,
  so lookup is O(1). Cid lookup uses a fixed-seed hasher map from `CidKey` to
  the current `OrderKey`. `Order` holds no `String`, no `Option<String>`, no
  `serde_json::Value`.
- **P3.** No allocation per callback in steady state. Strategies write intents
  into an engine-owned, reusable buffer (`Intents`, `30-strategy-sdk.md` §7;
  capacity retained across callbacks). The WIP returns a fresh `Vec<Intent>`
  per callback (`pmb-core/src/strategy.rs:39-43`).
- **P4.** Token ids, condition ids, slugs and cid strings are parsed or
  interned once at session start or first use, and never compared in the hot
  path. The WIP compares `Arc<str>` token ids on every event
  (`pmb-core/src/market.rs:155-157`).
- **P5.** Immutable market data (`MarketInfo`, the rules timeline of
  `11-exchange-rules.md`, decoded events, feed series) is `Send + Sync` and
  shared read-only across candidates and threads (`Arc`). Per-candidate state
  (orders, positions, capital) is owned and needs no locks. Random draws are
  stateless functions of the stream seeds (§6.1), so they need no per-thread
  generator and no synchronization. This is what allows the thread-level
  parallelism of `16-performance-and-parallelism.md`.
- **P6.** `Price` is a bounded integer, so books MAY use a dense price ladder
  indexed by `price / finest_tick` (≤ 10,000 slots) instead of a `BTreeMap`.
  `16-performance-and-parallelism.md` chooses based on measurement.
- **P7.** Cross-type math is `i128` multiply-divide with no floats. The fee
  curve uses integer evaluation (11 §5).

## 12. Determinism requirements on domain types

- **D-1.** No iteration over `std::collections::HashMap`/`HashSet` may affect
  decisions or output. Lookups through fixed-seed hashers are allowed.
  Iteration that matters uses `Vec` (insertion order) or `BTreeMap`.
- **D-2.** Fixed-point arithmetic is exact and platform-independent. `f64`
  math that affects decisions (plugins) uses the pure-Rust `libm`
  (`12-engine-core.md`, `14-feeds-and-plugins.md`).
- **D-3.** Event, fill and order key order is a pure function of the input and
  the run seed (I1, §6.1).
- **D-4.** Money results do not depend on build flags (T3): the same job gives
  the same bytes with `overflow-checks` on or off.

## 13. WIP salvage notes (domain only)

| WIP item | Verdict |
|---|---|
| `pmb-core/src/fixed.rs` newtypes, `parse_micros`, `notional`, `for_usdc` | Keep the shape. Replace `Round` with `Rounding` (§3.1), add exponent parsing (T6), make rounding explicit everywhere (`from_f64` currently rounds implicitly, `fixed.rs:25`), and make every operation explicitly checked (T3). |
| RNG | The WIP has none. §6.1 is new code (about 60 lines plus AS241). |
| `pmb-core/src/model.rs` `OrderType` (FAK), intent enums | Keep as a starting point. Replace `Arc<str>` ids with keys (§6), add `OrderSize`, drop `cost_per_share`, replace `OrderState` with §8 (no `InFlight`/`Delayed`/`Unknown` today, `model.rs:180-191`), add `SettlementUpdate` (`model.rs:282-352` has no trade status). |
| `pmb-core/src/model.rs` `FeeSchedule` as `f64` (`model.rs:385-392`) | Replace with the integer `FeeCurve` of 11 §5. |
| `pmb-core/src/stats/tests.rs:142-162` | Rewrite to `HalfAwayFromZero` (R-1). |

## 14. Changes required in other documents

None open: every item was applied in the gate-1 consolidation.

## Gate-4 questions

None owned here (list: 01 §12.1).

## Open questions

None. Former Open question 1 (share-sized FOK/FAK BUYs) is decided by D42:
they are converted to collateral at the limit price in realistic, paper and
live (O2); ts-compat keeps share sizing (O3).
