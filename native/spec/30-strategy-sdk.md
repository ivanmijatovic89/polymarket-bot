# 30 — Strategy SDK (`pmb-sdk`)

This document specifies the author-facing Rust API that every native strategy
is written against: the curated, semver'd `pmb-sdk` prelude, the `Strategy`
trait and its lifecycle, the typed context, intent builders, account events,
the `Params` derive, feed and plugin requirements, determinism and isolation
rules, fault semantics, logging and the testkit. It is written for two kinds
of authors: the implementation session that ports `engine-exerciser` and
`lagsnipe.v15`, and AI agents in polymarket-protocols, who start authoring
Rust strategies right after M6 (D39). It is also the surface the independent
conformance tests are written against from gate 1 on (60 §10.0 C1). The
types and semantics behind the API are owned elsewhere: values, ids, orders,
events and reasons by `10-domain-model.md`;
ordering, cascades and fault handling by `12-engine-core.md`; rules by
`11-exchange-rules.md`; feeds and plugins by `14-feeds-and-plugins.md`. This
document fixes how strategies see and drive them. Build, identity and
publishing are in `31-artifacts-build-publish.md`.

Keywords MUST/SHOULD/MAY are normative. "TS" means the current TypeScript
engine on `main`.

## 1. Design principles

| # | Principle | Evidence / reason |
|---|---|---|
| P1 | `pmb-sdk` is the **only** crate a strategy depends on. It re-exports a curated surface; it MUST NOT `pub use pmb_core::*`. Order manager, portfolio internals, simulator, fill/latency models, replay, feed sources and all I/O are unreachable. | WIP re-exports the whole core (`native/crates/pmb-sdk/src/lib.rs:3`); TS keeps a `#pmb` allowlist as its SDK boundary (`docs/strategy/external-artifacts.md:164-173`). |
| P2 | Strategy code is mode- and profile-agnostic. No accessor reveals live/paper/backtest, the execution profile, the seed or the candidate index. Only data values (`rules()`, books, fills, and the `now()` clock rule of §5) may differ between modes and profiles. | One core for live and backtest (01, D23); WIP intent `native/crates/pmb-core/src/strategy.rs:1-3`. |
| P3 | Author code needs no lifetimes, no generic parameters, no trait objects and no `async`. Every signature an author writes uses owned values or `&T` with elided lifetimes. | AI authors (requirements-sweep `curated-sdk-surface`). |
| P4 | Deterministic by construction: no wall clock, no environment, no randomness, no hash-order iteration, no OS libm in decision paths (§11). | Requirements-sweep `cross-machine-determinism`; 10 §12. |
| P5 | Speed: the engine allocates nothing per callback on behalf of the strategy, calls the strategy through static dispatch, and shares books, feeds and plugin outputs across candidates by reference (§16). | 01 §2; WIP returns a fresh `Vec<Intent>` per callback and boxes the strategy (`strategy.rs:39-49`). |
| P6 | Builders enforce only **structural** invariants (things the Polymarket API cannot express). Every value check that depends on rules or the profile is done by the engine and surfaces as a typed rejection (§7.1). | One rejection taxonomy for simulator and live adapter (10 §10.2). |
| P7 | Every public enum is `#[non_exhaustive]`; every public struct has private fields or is `#[non_exhaustive]`. Additions are minor releases. | §2. |
| P8 | Fixed-point integers for money, prices and sizes (`10-domain-model.md` §2); `f64` only for feed prices, plugin analytics and strategy-internal math; no implicit conversion between them. | 00 R2. |

## 2. Versioning and stability

- `pmb-sdk` MUST follow SemVer, versioned independently of the engine
  (`engineVersion`). Its version is embedded in every binary and reported by
  `describe` as `sdkVersion` (`20-binary-protocol.md` §3).
- The SDK stays `0.x` while the engine is built. It MUST be released as
  `1.0.0` before any author outside `native/strategies/` uses it (M11, right
  after M6, D39; 31 §12); from then on:

| Change | Bump |
|---|---|
| New type, method, builder option, enum variant (enums are non-exhaustive), plugin/feed config field with a default | minor |
| Bug fix with no source impact | patch |
| Removal, rename, signature change, new required trait item without default | major (preceded by `#[deprecated]` for at least one minor) |
| Engine behavior change (fill model, ordering, rules) | none for the SDK; `engineVersion` bump plus a CONTRACT changelog entry (§17) |

- Because each binary embeds its engine (`31`), an engine change reaches an
  existing strategy only when it is rebuilt (`31` §7.4). Strategy source that
  compiles against SDK `1.x` MUST compile against every later `1.y`.
- Before `1.0.0`, a rename or removal of a public item named in this document
  updates the conformance tests that use it (60 §10) in the same change, with
  a CONTRACT changelog entry (§17).

## 3. Prelude

`use pmb_sdk::prelude::*;` MUST be sufficient for a typical strategy. Type
names are those of `10-domain-model.md`; the SDK re-exports them unchanged and
adds author-facing views.

| Area | Items |
|---|---|
| Definition | `Strategy`, `StrategyResult`, `StrategyError`, `Interests`, `TickInterest`, `strategy_main!` |
| Context | `Ctx`, `TickInfo`, `TickCause`, `MarketInfo`, `Symbol`, `Timeframe`, `BookView`, `Level`, `PortfolioView`, `Position`, `Capital`, `OrderView`, `OrderState`, `SettlementStatus`, `RulesView` |
| Values (10 §2, §3, §5, §6) | `Price`, `Qty`, `Usdc`, `Rate`, `Rounding`, `TsMs`, `DurMs`, `Outcome`, `Side`, `OrderType`, `ClientOrderId`, `ExchangeOrderId`; macros `price!`, `qty!`, `usdc!`, `cid!` |
| Intents | `Intents` (the engine-owned buffer, 10 §11 P3, 12 §6.1), `Order`, `LimitOrder`, `MarketableOrder`, `Meta`, `meta!` |
| Events (10 §10) | `AccountEvent` (author view, §8), `FillView`, `Liquidity`, `RejectReason`, `DoneReason`, `CancelCause`, `CancelFailReason`, `SplitFailReason`, `MergeFailReason` |
| Params | `Params` (trait + derive), `ParamEnum` (derive), `ParamError` |
| Requirements | `Requirements`, `FeedOptions`, `TimeWindowVolatilityConfig`, `TechnicalIndicatorsConfig`, `DwellGateConfig`, `TimeWindowGateConfig`, `BidOrAsk` |
| Feeds / plugins (14) | `FeedsView`, `PricePoint`, `PriceToBeat`, `PluginsView` and the four plugin snapshot types |
| Logging | `error!`, `warn!`, `info!`, `debug!`, `trace!` (all take `ctx` first) |
| Modules (not glob-imported) | `pmb_sdk::math` (pure-Rust libm), `pmb_sdk::collections` (deterministic maps and sets), `pmb_sdk::toolkit` (§14), `pmb_sdk::testkit` (feature `testkit`, §15), `pmb_sdk::json` (re-export of `serde_json::Value`, only for `Meta::json`) |

Nothing else is public. Third-party crates are not re-exported except
`serde_json::Value` above (D16: strategy crates use only SDK re-exports).

## 4. Strategy definition and lifecycle

```rust
use pmb_sdk::prelude::*;

#[derive(Params, Clone, Debug)]
pub struct LagParams {
    /// Shares per entry order.
    #[param(default = 5)]
    pub size: Qty,
    /// Highest entry price.
    #[param(default = 0.60, min = 0.01, max = 0.99)]
    pub max_price: Price,
}

pub struct Lag { p: LagParams, entered: bool }

impl Strategy for Lag {
    type Params = LagParams;
    const ID: &'static str = "example-lag.v1";

    fn requirements(_p: &LagParams) -> Requirements {
        Requirements::new().binance_spot(FeedOptions::default()).price_to_beat()
    }

    fn new(p: &LagParams, _market: &MarketInfo) -> Self {
        Lag { p: p.clone(), entered: false }
    }

    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult {
        if self.entered { return Ok(()); }
        let Some(ask) = ctx.book(Outcome::Up).best_ask() else { return Ok(()) };
        if ask.price <= self.p.max_price {
            out.place(Order::buy(Outcome::Up, ask.price, self.p.size).fok().cid(cid!("entry")));
            self.entered = true;
        }
        Ok(())
    }
    // on_event, interests and status keep their defaults (no intents, all, nothing).
}

pmb_sdk::strategy_main!(Lag);
```

Rules:

1. One strategy type per binary. `strategy_main!(T)` expands to the runtime
   entry point (every subcommand of `20-binary-protocol.md`). The runtime MUST
   be generic over `T` (monomorphized, static dispatch); it MUST NOT box the
   strategy. This is the 12 §14 P6 default; M-DSP confirms it on throughput,
   which alone decides under the amended D18 (`31` §4.1).
2. `ID` MUST match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, MUST NOT equal any TS
   registry id or any JS artifact id (checked at publish, `31` §7.2), and a Rust
   port of a TS strategy MUST use `<ts-id>.rs` (D20). Ids come from code, not
   from bin names (bin names cannot contain dots).
3. `requirements(&Params)` and `interests(&Params)` are pure functions of the
   params. They are evaluated by `describe` before any market exists (producer
   eligibility) and again at job start; the engine MUST fail the job if the two
   results differ.
4. An instance is created per (candidate, market) by `new`, after the market's
   `MarketInfo` and rules are known and before its first callback, and dropped
   when the market ends. Strategies MUST NOT carry state across markets (TS
   creates per market, `src/trading/StrategyRunner.ts:294-301`; live rotation
   creates a fresh instance, `50-live-runtime.md`).
5. `on_tick` fires on strategy ticks only: `book`/`price_change` and opted-in
   synthetic feed ticks, inside the strategy window (D23). Which inputs tick and
   the window rule are owned by `12-engine-core.md`.
6. `on_event` fires for account events of this candidate in the cascade order
   of `12-engine-core.md` (breadth-first FIFO, as TS
   `StrategyRunner.ts:551,689`). Intents written during `on_event` join the
   cascade.
7. `Strategy: Send + 'static` is REQUIRED (instances may be created on any
   pool thread, `16-performance-and-parallelism.md` §5); `Sync` is NOT
   required. An instance is only ever called from one thread at a time.
8. `on_event` (default: no intents), `interests` (default: all) and `status`
   (default: nothing) have default implementations. `fn status(&self, out: &mut Meta)`
   MAY expose debug values to the paper/live state stream and to opt-in traces
   (`50`, `22`). It takes `&self`, is called at most about once per second, and
   is never called on fleet runs.

### 4.1 Interests

`fn interests(p: &Params) -> Interests` lets the engine skip callbacks the
strategy ignores. `Interests` holds a set of event flags (default: all) and a
`TickInterest` (default: `All`).

| Event flag | Events covered (10 §10.1) |
|---|---|
| `FILLS` | `Fill` |
| `LIFECYCLE` | `OrderSubmitted`, `OrderAccepted`, `OrderDelayed`, `OrderOpen`, `CancelAcked`, `OrderDone` |
| `REJECTIONS` | `OrderRejected`, `CancelFailed` |
| `SPLIT_MERGE` | `PositionsSplit`, `SplitFailed`, `PositionsMerged`, `MergeFailed` |
| `SETTLEMENT` | `SettlementUpdate` |
| `STREAM` | `StreamStatus` (live only) |

| `TickInterest` | `on_tick` is called on a real strategy tick only when (16 §9.4 TF-1, TF-2) |
|---|---|
| `All` | always (default) |
| `TopOfBook` | first in-window tick of the market; or the best bid or ask price of either outcome changed; or an account event was delivered, a requested feed's visible value changed or a requested plugin's output changed since the last `on_tick` |
| `TopOfBookAndSize` | as `TopOfBook`, plus a change of the size at a best level |

Rules:

- A strategy that omits an event flag or declares a tick interest MUST behave
  exactly as if every skipped callback had returned no intents and changed no
  state. Only the callback is skipped: counting, books, matching, feeds,
  plugins, portfolio state, traces and outputs are unaffected (16 §9.4 TF-3).
  A strategy whose logic depends on time passing between book changes MUST
  NOT declare a tick interest.
- `strategy:check` runs each fixture with the declared interests and with
  all interests (event flags and `TickInterest::All`) and requires identical
  output (`31` §7.1 gate 7).
- The tick interest is offered to new Rust strategies (D41). The engine
  evaluates it from the book's top-change bit (16 BK-7) and the feed and
  plugin change generations (14 P-13). The ts-compat ports of §18 MUST NOT
  declare it.
- Synthetic feed ticks are opted into per feed (`tick_on_update`, §10) and are
  always delivered, whatever the tick interest.

## 5. Context (`Ctx`)

`Ctx` is a stack value holding references into engine state, built once per
callback. Authors write `ctx: &Ctx`. Every accessor is infallible and O(1)
unless stated.

| Accessor | Returns | Semantics | TS equivalent |
|---|---|---|---|
| `now()` | `TsMs` | The tick time `tick.ts` of 12 §4.2 (D27); inside `on_event`, the decision stamp of 12 §4.2. Profile rule in §5.0. | `tick.snapshot.timestamp` |
| `tick()` | `&TickInfo` | `seq` (strategy-tick index, as the trace `seq`), `cause` (`Book`, `PriceChange`, `BinanceAggTrade`, `ChainlinkRound`), `synthetic`, `exchange_ts: Option<TsMs>`. Inside `on_event` it is the last dispatched strategy tick, which can be synthetic (12 §6.5). | `tick.msg`, `lastMarket` |
| `event_clock()` | `TsMs` | TS `PortfolioSnapshot.nowMs` semantics (set by the first input, advanced only by account events). For ports only; new code MUST use `now()`. | `src/strategy/Strategy.ts:350`; approach-audit (OrderManager subsystem) |
| `market()` | `&MarketInfo` | `slug()`, `condition_id()`, `symbol()` (`Btc`), `timeframe()` (`M5`, `M15`), `start_ms()`, `end_ms()` (window `[start, end)`; start from the slug epoch, never Gamma `startDate`), `token_id(Outcome) -> &str`, `elapsed_ms(now)`, `remaining_ms(now)` (10 §5). | raw Gamma `ctx.market` (`src/strategy/StrategyContext.ts:19`), `parseGammaMarketStartMs` (`src/strategy/strategyToolkit.ts:16-27`), 34 `Date.parse(endDate)` uses (requirements-sweep `curated-sdk-surface`) |
| `book(Outcome)` | `&BookView` | Book of one outcome as defined by the input and profile (`13-execution-models.md` decides whether own resting orders are visible). | `tick.snapshot` |
| `portfolio()` | `&PortfolioView` | This candidate's positions, capital and orders. | `PortfolioSnapshot` (`src/strategy/Strategy.ts:347-378`) |
| `feeds()` | `&FeedsView` | Latest **visible** value of each requested feed (visibility clocks in `14`). Unrequested feeds are always `None`. | `ctx.plugins.externalFeeds` |
| `plugins()` | `&PluginsView` | Tick-scoped plugin snapshot (`12`, 14 P-4: account callbacks see the snapshot of the last tick). Unrequested plugins are `None`. | `ctx.plugins` |
| `rules()` | `&RulesView` | `tick()`, `min_order_size()`, `price_bounds()`, `fee_schedule()`, `taker_delay()`, `gtd_min_lead()`, `gtd_early_expiry()`, `batch_cap()`, `source()` (`Snapshot`, `Partial` or `Fallback`, 11 RS4) per `11-exchange-rules.md`. | none (hardcoded in TS) |
| `gtd_expiration(lifetime: DurMs)` | `TsMs` | `now() + gtd_early_expiry + lifetime`, the docs' "now + 60 + N" recipe (10 §7.4 GD3). | none |
| `warmed()` | `bool` | Always `true`, in every mode (12 §6.5): a session starts only after its exchange rules are loaded, which replaces the TS lazy per-token warmup. Kept only so that ports of TS `isWarmed` gates translate line by line; new code need not call it. | `isWarmed` (`src/strategy/strategyToolkit.ts:51-56`) |

Not exposed: raw Gamma JSON, wallet balance (TS `ctx.balance`; live capital is
in `Capital`, D31), WebUI metrics (TS `ctx.metrics`, read by 4 strategies;
provided as pure toolkit functions only if a port needs them), mode, profile,
seed, candidate index.

### 5.0 Clock rule per profile

`now()` is `tick.ts` of 12 §4.2 (12 §6.5):

| Profile / mode | `now()` |
|---|---|
| realistic backtest, paper, live | The loop clock `now`: monotone non-decreasing across ticks and callbacks. |
| ts-compat | The TS tick timestamp per input mode (12 §4.1, 13 TC-C11). It can **step back** after a synthetic tick; on `telonex-delta` by up to the gap between the clamped synthetic stamp and the next real tick's exchange time (14 §12.3, `docs/backtest/adr-binance-driven-ticks.md:67-73`). Inside `on_event` it is the last tick's timestamp (13 TC-C8). |

Reason: ts-compat parity needs the TS value. The lagsnipe oracle drives all of
its time logic from `tick.snapshot.timestamp`: the Binance and mid series, the
`Math.floor(now / 1e3)` volatility buckets, the cooldown and the remaining
seconds (`data/strategy-artifacts/304eceb3…ab8.mjs:115,126-154,225`). A monotone
`now()` in ts-compat would move decisions near those thresholds.

Consequences for authors: code MUST tolerate a non-monotone `now()` (as TS
strategies do today). The time arithmetic of §6 has no operator that can panic
on a backward step. `CONTRACT.md` states the rule in each profile section
(§17).

### 5.1 `BookView`

`best_bid()`, `best_ask() -> Option<Level>` (O(1)); `bids()` (descending) and
`asks()` (ascending) iterators of `Level { price: Price, size: Qty }`;
`depth_through(side, limit: Price) -> Qty`; `mid(Rounding) -> Option<Price>`;
`spread() -> Option<Price>`; `updated_at() -> TsMs`; `is_stale() -> bool`
(true between a data gap and the next full book; the strategy gets no ticks
for a stale book, `50-live-runtime.md`, `15-inputs.md`). Levels are
outcome-indexed contiguous fixed-point arrays (10 §11); no token-id lookups.

### 5.2 `PortfolioView`

| Method | Returns |
|---|---|
| `position(Outcome)` | `Position { qty: Qty, avg_entry: Option<Price>, cost_basis: Usdc }` (10 §9.3) |
| `sellable(Outcome)` | settled, unreserved shares (10 §9.2, §9.4 C2; equals `qty` in ts-compat) |
| `capital()` | `Capital { starting, cash, reserved }` with `available()` (10 §9.4; pending commitments are in `reserved`, as TS `CapitalSnapshot`, `src/strategy/Strategy.ts:337-345`) |
| `realized_pnl()` | `Usdc` |
| `order(&ClientOrderId)` | `Option<&OrderView>`: cid, outcome, side, price, size, remaining, filled, order type, post-only, `state: OrderState` (10 §8), `settlement: Option<SettlementStatus>`, `created_at`, `expire_at` |
| `open_orders()` | iterator of `&OrderView` in submission order |
| `orders()` | all orders of this market including terminal ones, in submission order |

`OrderView::settled_at_least(SettlementStatus)` replaces
`isOrderTradeStatusAtLeast` (`src/strategy/strategyToolkit.ts:41-49`);
`OrderView::ts_state()` gives the TS lifecycle string mapping of 10 §8.4.

## 6. Values

- `Price`, `Qty`, `Usdc`, `Rate`, `TsMs`, `DurMs` and `Rounding`
  (`Floor`, `Ceil`, `TowardZero`, `HalfAwayFromZero`) are the types of
  `10-domain-model.md` §2–§3, with their rules: no `From<f64>`/`Into<f64>`;
  `from_f64(v, Rounding) -> Result<_, NonFinite>` and `to_f64_lossy()` are the
  only float conversions. `to_f64_lossy()` MUST return the `f64` nearest to
  the exact decimal value (`micros as f64 / 1e6`, correctly rounded), which
  equals TS `Number` of the same decimal text (60 §6.2 LP-2). Cross-type
  arithmetic only through named operations with an explicit `Rounding`
  (`Price::notional(Qty, Rounding) -> Usdc`,
  `Qty::for_collateral(Usdc, Price, Rounding) -> Qty`). Same-type overflow
  panics (overflow checks are on, D18; §12).
- Time arithmetic: `TsMs + DurMs -> TsMs`, `TsMs - DurMs -> TsMs`,
  `a.ms_since(b) -> i64` (signed, negative when `a < b`) and
  `a.saturating_since(b) -> DurMs` (clamped at 0). There is deliberately no
  `TsMs - TsMs -> DurMs` operator: `DurMs` is non-negative (10 §2), and
  `now()` can step back in ts-compat (§5.0), so such an operator would turn a
  clock artefact into a strategy panic.
- Literal macros `price!(0.53)`, `qty!(5)`, `usdc!(1.25)` parse the literal's
  source text at compile time (no float) and fail compilation on more than 6
  decimals or out-of-range values.
- Tick helpers: `price.snap(tick, Rounding)`; `Price::clamp_probability(f64)`
  clamps a float to `[0, 1]` before conversion (TS `safeProbabilityPrice`,
  `src/strategy/strategyToolkit.ts:7-10`).
- `Outcome::{Up, Down}` = index 0/1 (10 §5 M1); `opposite()`. `Side::{Buy, Sell}`.
- `ClientOrderId`: 1–256 bytes of printable ASCII (10 §6). `cid!("x1")` is
  checked at compile time; `ClientOrderId::new(&str) -> Result<_, StrategyError>`;
  `ClientOrderId::indexed("r", n)` builds `r{n}`. Building a cid of at most 24
  bytes MUST NOT allocate; the engine interns cids on submission (10 §6).
  Cids are unique per active order (dedupe semantics in `12`).
- `ExchangeOrderId` is the opaque exchange (or simulator) order id carried by
  events (10 §6).

## 7. Intents

Strategies write intents into `out: &mut Intents`, an engine-owned buffer
reused across callbacks. Buffer order is submission order. Intent payloads are
those of 10 §7.3.

| Builder | Intent (TS kind, `src/strategy/Strategy.ts:29-149`) |
|---|---|
| `Order::buy(o, price, qty)` / `Order::sell(o, price, qty)` → `LimitOrder` (GTC by default); `.gtd(expire_at)`; `.post_only()`; `.fok()` / `.fak()` → `MarketableOrder` | `PlaceLimit` with `OrderSize::Shares` (TS `place_limit` FOK/GTC/GTD; FAK is new) |
| `Order::buy_spend(o, max_price, usdc).fok()` / `.fak()` | `PlaceLimit` with `OrderSize::Collateral` (CLOB V2 market BUY, 10 §7.2 O2) |
| options on every order: `.cid(ClientOrderId)`, `.meta(Meta)`, `.note(&'static str)` | `cid`, `meta`, `note` (10 §7.2) |
| `out.place(order)` | `PlaceLimit` (`place_limit`) |
| `out.place_batch([o1, o2, ...])` | `PlaceBatch` (`place_batch`) |
| `out.cancel(&ClientOrderId)`, `out.cancel_exchange_id(&ExchangeOrderId)` | `CancelOrder` (`cancel_order`) |
| `out.cancel_batch([&ClientOrderId, ...])` | `CancelBatch` (`cancel_batch`) |
| `out.cancel_market(Some(o))` / `out.cancel_market(None)` | `CancelMarket` (one outcome / the whole condition) |
| `out.cancel_all()` | `CancelAll` |
| `out.split(qty)`, `out.merge(qty)` | `SplitPositions`, `MergePositions` (the session's Up/Down pair is implicit, 10 §7.3 N3) |

### 7.1 What builders check and what the engine checks

- Structural, enforced by types: GTD requires an expiry (constructor
  argument); `post_only()` exists only on `LimitOrder` (GTC/GTD); FOK/FAK never
  rest; collateral sizing exists only on market BUYs (10 §7.2 O1).
- Everything else is checked by the engine and reported as `OrderRejected`
  (or `SplitFailed`/`MergeFailed`) with a typed reason from 10 §10.2:
  positivity, tick alignment, minimum size, price bounds, GTD lead, batch cap,
  funding, risk limits, inventory (`11`, `12`, `13`), and orders that could
  match this candidate's own orders, rejected `SelfCross` (no TS string) in
  realistic, paper and live, never in ts-compat (D54; 10 N6, 12 §7.4). A
  placement of a cid that has an active order is not rejected: it is dropped
  silently and counted (`duplicate_active_cid`, 12 §7.6). Builders MUST NOT
  duplicate these checks, so the simulator and the live adapter share one
  rejection taxonomy.
- Share-sized market BUYs (`Order::buy(..).fok()` / `.fak()`): in the
  realistic profile, paper and live they are converted to collateral at the
  limit price and can **receive more shares than requested** when they fill
  below the limit (10 §7.2 O2, D42). The
  rustdoc of `fok()`/`fak()` and the CONTRACT MUST say so. ts-compat sizes
  them in shares, as TS does (10 §7.2 O3). A strategy that needs an exact
  spend uses `buy_spend`.
- Per-callback intent limits and the cascade budget are owned by `12`.
  Exceeding them is a hard candidate failure, never a silent drop (TS drops the
  whole queue, `StrategyRunner.ts:574-584`).

### 7.2 Meta

`meta! { "edge" => 0.031, "leg" => "entry", "n" => 3 }` builds a `Meta` of
scalar values (`bool`, `i64`, `f64`, string); `Meta::json(key, json::Value)`
is the escape hatch for nested values. The engine serializes meta once at
placement into the session meta store and never parses it again (10 §7.5).
The first meta per cid in fill order becomes `intentMeta` in `MarketStats`,
with the size cap, ordering and non-finite-number rules of
`21-job-and-output-contract.md`. Key order is not significant. Meta key names
used by research tools (`windowsMetrics`, `orderbookLevels`,
`technicalIndicators`, 21) are strategy-chosen; a port that emits them MUST
keep the names.

## 8. Account events

The SDK's `AccountEvent` is a `#[non_exhaustive]` author view over the events
of 10 §10.1. Core events are small `Copy` values holding keys (10 §10.1 V3);
the runtime resolves those keys per callback, without allocation, so the
author gets references:

| Variant | Author-facing fields | TS kind |
|---|---|---|
| `OrderSubmitted` | `order: &OrderView` | `order_submitted` |
| `OrderRejected` | `cid`, `order: Option<&OrderView>`, `reason: RejectReason` | `order_rejected` |
| `OrderAccepted` | `order`, `exchange_id: Option<&ExchangeOrderId>` | `order_accepted` |
| `OrderDelayed` | `order`, `release_at: TsMs` | none (new) |
| `OrderOpen` | `order` | `order_open` |
| `Fill` | `fill: &FillView` (`order`, `outcome`, `side`, `price`, `qty`, `fee: Usdc` as charged, `liquidity`, `at`, `exchange_ts`) | `fill` |
| `SettlementUpdate` | `order`, `fill: Option<&FillView>`, `status: SettlementStatus` (`Failed` reverses the fill, 10 §9.2) | `ws_order_update` |
| `OrderDone` | `order`, `reason: DoneReason`, `filled: Option<Qty>` | `order_done` |
| `CancelAcked` | `op`, `order` (non-terminal: the exchange confirmed the cancel, 10 §10.1 V1a; realistic, paper and live only) | none (new) |
| `CancelFailed` | `op`, `order: Option<&OrderView>`, `reason: CancelFailReason` | `cancel_failed` |
| `PositionsSplit` / `SplitFailed` | `size`, `cost` / `requested`, `reason` | `positions_split` / `split_failed` |
| `PositionsMerged` / `MergeFailed` | `size` / `requested`, `reason` | `positions_merged` / `merge_failed` |
| `StreamStatus` | `source`, `connected` | `account_stream_status` (live only) |

Every event has `at()` (engine delivery time, 10 §10.1 V2). Reason enums
expose `as_ts_str()` with the TS strings listed in 10 §10.2; ts-compat parity
compares the reason code only (22 §3.4).

## 9. Params

Params are declared with `#[derive(Params)]` (proc macro in
`pmb-sdk-macros`, re-exported by `pmb-sdk`). Params are runtime-only: one
binary serves every sweep; params affect nothing outside the strategy except
through `requirements` and `interests`.

| Field type | Typed JSON accepted | CLI string accepted | Normalized JSON |
|---|---|---|---|
| `bool` | `true`/`false` | `"true"`/`"false"` only | boolean |
| `i64`, `u32`, … | integer | Rust `FromStr` integer | number |
| `f64` | finite number | Rust `FromStr`, finite | number, shortest round-trip, `-0` → `0` |
| `Price`, `Qty`, `Usdc`, `Rate`, `DurMs` | number or decimal string, at most 6 dp (parsed from decimal text, 10 §2 T6) | decimal string, at most 6 dp | number (exact decimal) |
| `String` | string | verbatim | string |
| `#[derive(ParamEnum)]` enum | variant name | variant name | string |
| `Option<T>` | absent, `null` or `T` | absent, `"null"` or `T` | absent when `None` (rule 6), else `T` |
| `Vec<T>` | array | JSON array text (`--param ids='["a","b"]'`, as CLAUDE.md) | array |
| nested `Params` struct | object | JSON object text | object |

Rules:

1. Defaults: `#[param(default = <literal>)]`; fixed-point defaults are parsed
   from the literal's source text at compile time. A field without a default is
   required (except `Option`, default `None`).
2. Validation: `#[param(min = .., max = ..)]`; enums through `ParamEnum`;
   cross-field rules in `fn validate(&self) -> Result<(), ParamError>` (trait
   method, default `Ok`).
3. Unknown keys MUST be rejected; the error lists the unknown keys and the
   valid keys. All errors are reported together, with JSON-pointer paths
   (`20-binary-protocol.md` §5.1).
4. Keys are camelCase by default (`max_price` → `maxPrice`), overridable with
   `#[param(rename = "..")]`, so `--param` names match TS conventions.
5. Composition: `#[param(flatten)] base: EntryDepthParams` (TS strategies extend
   other versions' schemas, requirements-sweep `typed-param-schema`). Key
   collisions MUST fail at compile time when detectable, otherwise at describe.
6. Normalization: a JSON object with keys sorted bytewise; every non-`Option`
   field present with its default applied; an `Option` field that is `None` is
   **omitted** (an input `null` normalizes to absent); numbers canonical as in
   the table, with integral values written without a fraction or exponent
   (`20`, not `20.0`). Omission matches TS: Zod drops absent `.optional()`
   fields, and the Drizzle `json` column (`src/db/schema.ts:110`) serializes
   with `JSON.stringify`, so lagsnipe's `stakeMinUsd`
   (`z.coerce.number().finite().positive().optional()`,
   `data/strategy-artifacts/304eceb3…ab8.mjs:16`) is missing from stored TS
   params when unset. Normalization MUST accept both CLI strings and typed JSON
   (fresh run, `--extend`, `--params-from-run`, candidate files) and MUST be
   idempotent: `normalize(normalize(p)) == normalize(p)` (requirements-sweep
   `params-normalization-idempotent`). The normalized object is what is stored
   in `backtest_runs.params`, compared for duplicate candidates (D14) and shown
   in the dashboard. The generated JSON Schema (rule 8) lists `Option` fields
   as not required and accepting `null`.
7. Parsing uses Rust semantics only. JS coercions are not reproduced: `"0x10"`,
   `" 5"`, `"1_000"`, `"Infinity"` are rejected, and `"false"` is false (Zod
   `z.coerce.boolean` would make it true).
8. JSON Schema (draft 2020-12) is generated from the derive: types, defaults,
   bounds, enum values and doc comments as descriptions. `describe` returns it
   as `paramsSchema` (20 §5.1) and the publisher stores it (`31` §6.2).
9. Ports: for every parity param set, the Rust normalized params MUST equal the
   TS Zod-normalized params as JSON values (rule 10)
   (`src/cli/helpers/strategyArgs.ts:331-350`), so the same runs compare.
   Golden PG-1, a test of the `native/strategies` package (`31` §7.1 gate 4,
   run by engine CI, `31` §7.6) with the TS values committed as fixtures, also
   reported by `60`: (a) the stored `backtest_runs.params` of the 60 §6.3
   lagsnipe run normalizes, through the Rust `Params` derive, to an equal
   value; (b) an input with `stakeMinUsd` set normalizes to the TS-normalized
   value of the same input; (c) `"stakeMinUsd": null` (typed JSON) and
   `stakeMinUsd=null` (CLI string) both normalize to the field being absent.
   Each case also checks idempotence.
10. Comparison: wherever normalized params are compared (rule 9, D14 duplicate
    candidates, `--extend` in 31 §8), objects compare by key set and values
    recursively, and numbers compare by exact decimal value, so `20` equals
    `20.0` and `1e-4` equals `0.0001`. A naive `serde_json::Value` equality is
    not enough (it treats an integer and a float as different numbers).

## 10. Requirements: feeds and plugins

`Requirements` is plain data (`Clone + Eq + Ord + Hash + Serialize`) built
from params alone, because `describe` runs before any market is selected
(producer eligibility and coverage preflights).

| Builder | Feed / plugin (semantics in `14-feeds-and-plugins.md`) | `describe.requiredFeeds` (TS shape, `src/strategy/plugins/ExternalFeedsRequestPlugin.ts:5-36`) |
|---|---|---|
| `.binance_spot(FeedOptions)` | Binance aggTrades last price | `binanceWsSpotPrice: { symbol?, tickOnUpdate? }` |
| `.chainlink(FeedOptions)` | Chainlink rounds, two-clock visibility | `rtdsCryptoPrices: { chainlinkSymbols?, tickOnUpdate? }` |
| `.price_to_beat()` | price-to-beat | `polymarketPriceToBeat: { enabled: true }` |
| `.time_window_volatility(cfg)` | TimeWindowVolatility | none (plugin) |
| `.technical_indicators(cfg)` | TechnicalIndicators, candles from local aggTrades only, no network (D19) | none (its aggTrades lookback joins the feed preflight, 14 §12.5) |
| `.dwell_gate(cfg)` | DwellGate | none |
| `.time_window_gate(cfg)` | TimeWindowGate | none |

- `FeedOptions { symbol: Option<..>, tick_on_update: bool }`: the symbol
  follows the traded market unless overridden; `tick_on_update` opts into
  synthetic strategy ticks for that feed.
- Not offered in v1: RTDS Binance, Deribit (out of scope), and the V4-only
  `binanceBookTicker`, Chainlink TWAP and `chainlink-opening-twap` (a
  follow-up, D43; 14 §7.4). Adding them later is a minor release.
- All four plugins are offered (D19 as amended at gate 1; 01 §4).
- Plugins are engine-owned; strategies cannot register custom plugins in v1
  (no protocol uses one, requirements-sweep `curated-sdk-surface`). A strategy
  computes its own indicators in its own state. Engine ownership lets
  candidates with equal canonical plugin configs share one computation (41 §5,
  14 P-6); shared and unshared results MUST be identical.
- The testkit fails a test that reads a feed or plugin the strategy did not
  request (it would always be `None` in production).

## 11. Determinism and isolation

N candidates run in one process (`41`), many markets run concurrently on a
thread pool (`16`), and the same job must produce byte-identical output on
every fleet Mac (`20` G5, `40`, `60`).

| Rule | Provided alternative | Enforcement |
|---|---|---|
| No `std::collections::{HashMap, HashSet}` with `RandomState`, no `RandomState` | `collections::{Map, Set}` (BTreeMap/BTreeSet) and `collections::{DetHashMap, DetHashSet}` (fixed hasher, deterministic iteration for identical insert sequences) | clippy `disallowed_types` |
| No wall clock (`SystemTime::now`, `Instant::now`), no `thread::sleep` | `ctx.now()` | `disallowed_methods` |
| No threads (`thread::spawn`, `thread::scope`), no sync primitives (`Mutex`, `RwLock`, atomics, `OnceLock`, `LazyLock`), no `thread_local!` | none needed (single-threaded instance) | `disallowed_types`, `disallowed_macros` |
| No environment, args, filesystem, network, processes (`std::env`, `std::fs`, `std::net`, `std::process`) | params; `Requirements` | `disallowed_methods`, `disallowed_types` |
| No stdout, stderr or stdin (`print!`, `println!`, `eprint!`, `eprintln!`, `dbg!`, `std::io::std*`): stdout carries protocol JSON (20 G1) | logging macros (§13) | `print_stdout`, `print_stderr`, `dbg_macro`, `disallowed_methods` |
| No OS libm in `f64` math (`exp`, `exp2`, `exp_m1`, `ln`, `ln_1p`, `log*`, `powf`, `cbrt`, `hypot`, trigonometric and hyperbolic functions). `sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `mul_add`, `powi`, `min`, `max` are allowed. | `pmb_sdk::math::*` (pure-Rust libm) | `disallowed_methods` (the fleet runs different macOS versions; 10 §12, 14 P-2) |
| No `unsafe` | — | `[lints.rust] unsafe_code = "forbid"` in the package manifest (`31` §2.2) |
| No interception of engine fault handling (`catch_unwind`, `panic::set_hook`, `resume_unwind`, `process::exit`, `abort`) | `Err(StrategyError)` | `disallowed_methods` |
| No global mutable state; no pointer-address-dependent logic | strategy fields | types above; review |
| No randomness | none in v1 (TS authors use none: 0 `Math.random` uses, requirements-sweep `determinism-isolation-lints`). A future `ctx.rng()` MUST derive from the per-market seed (10 §6 I1), never from the candidate index. | no crate available (D16) |

- The lint configuration is engine-owned: `strategy:check` sets
  `CLIPPY_CONF_DIR` to the engine's directory and passes the determinism lints
  with `-F` (forbid), so neither a repository `clippy.toml` nor an in-source
  `#[allow]` can weaken them (`31` §7.1).
- Lints are a convention guard, not a security boundary (as the TS allowlist,
  `docs/strategy/external-artifacts.md:200`). The proofs are behavioral:
  `strategy:check` and publish run the group-equivalence smoke (run-group of
  `[p, p]` and of reversed candidates equals standalone runs) and the interests
  A/B (§4.1); `20` §8 and `60` add the cross-machine and thread-count checks.

## 12. Fault semantics

Fault handling is owned by `12-engine-core.md` (20 G7). The author-visible
contract:

- The engine wraps every call into strategy code (`Params` validation,
  `requirements`, `interests`, `new`, callbacks, `status`) in
  `catch_unwind(AssertUnwindSafe(..))`; every build profile (`31` §4.2) keeps
  `panic = "unwind"` and overflow checks on strategy and engine code (D18).
  The runtime's panic
  hook records message, remapped source location, candidate, callback kind and
  tick `seq`, and suppresses the default stderr print.

| Failure | Backtest `run` / `run-group` / `serve` | Paper / live (D32) |
|---|---|---|
| Panic in a callback or `new` | That candidate × market fails with error class `strategy_fault`, cause `panic` (20 §4; failure row for that candidate only); the instance is poisoned and dropped inside `catch_unwind`; other candidates continue (D13). | the market's orders are canceled (`CancelMarket`, cause `StrategyPanic`, 12 §11), no further calls until the next market, alert (D33); fresh instance at rotation; repeated-panic escalation per `50-live-runtime.md`. |
| `Err(StrategyError)` returned | Same as panic, cause `error`, without unwinding; the message is preserved. | Same as panic. |
| Fixed-point overflow in strategy code | Panic (overflow checks), as above. | As above. |
| Invalid params, or a panic in `requirements`/`interests` | `describe` fails before enqueue (20 §4, §5.1). | Launch refused. |
| Intent or cascade limit exceeded | Candidate failure, cause `cascade_limit` (§7.1, 12 §6.3). | As a panic (12 §6.3). |
| Process abort (stack overflow, double panic, OOM) | The process dies; crash attribution and retry per 20 §6 S5 and `40`. Authors MUST bound recursion. | Supervisor restart per `50`. |
| Callback never returns | Job deadline kills the process (20, `40`). | Watchdog per `50`. |

Engine panics outside strategy wrappers are engine faults (20 §4
`engine_fault`); they are never attributed to a candidate.

## 13. Logging

- Macros `error!(ctx, ..)`, `warn!(ctx, ..)`, `info!(ctx, ..)`, `debug!(ctx, ..)`,
  `trace!(ctx, ..)`. A disabled level costs one branch; arguments are not
  evaluated or formatted.
- The level comes from the process log setting (`PMB_LOG`, the only
  verbosity knob, 20 G2) or the live config, never from strategy params. Default:
  off for strategy logs on fleet runs, `info` for local `--sequential` runs and
  paper/live. Logs never affect results.
- Lines go to stderr in the NDJSON log format of 20 G1, tagged with strategy
  id, candidate index, slug and tick `seq`. At most 1,000 lines per candidate ×
  market, then one truncation line (TS forwards every stderr line to the worker
  console, `src/strategy/artifacts/native.ts:158`).

## 14. Toolkit

`pmb_sdk::toolkit` holds pure helpers with golden tests: tick snapping and
clamping, window helpers (`in_last(ctx, ms)`, `elapsed_fraction(ctx)`), book
helpers (VWAP for a size, depth within N ticks), settlement helpers, and
`round_dp(x: f64, k: u32) -> f64`: the exact decimal expansion of `x` rounded
to `k` decimals with `HalfAwayFromZero` (10 §3), parsed back to the nearest
`f64`. It is the contract of TS `Number(x.toFixed(k))`, common in strategy
meta (60 §6.2 LP-3); `format!("{:.k}")` (ties to even) and
`(x * 10^k).round()` (inexact product) do not meet it.
`pmb_sdk::math` wraps a pure-Rust libm. Helpers are added only when an in-repo
port or an active author pattern needs them; each addition is a minor release.

## 15. Testkit and local runs

- `pmb_sdk::testkit` (feature `testkit`, dev-dependency only) MUST run the real
  engine core (order manager, portfolio, simulator, plugins) in-process; it
  MUST NOT contain a second, simplified simulator.
- It provides: a market builder (`TestMarket::btc_15m(start_ms)`), scripted
  inputs (book snapshots, price changes, trade prints, feed updates, time
  advance, data gaps), profile selection, inspection of intents per callback,
  account events, the canonical trace (`22`) and the final `MarketStats`,
  loading of the committed fixture markets of `60-verification.md`, and the
  helpers `assert_group_equivalent(&[params..])` and
  `assert_interests_equivalent(params)`.
- It works offline with no DB, R2 or Redis (TS authors build `StrategyRunner`
  plus `BacktestExecution` in tests today, requirements-sweep
  `testkit-and-local-run`).
- `testkit::bench(params, fixture)` reports ns per callback and allocations per
  callback, so authors and `strategy:check` can report strategy cost (§16).
  Numbers are meaningful only in an optimized build: `strategy:check` runs it
  with `cargo test --profile iterate` (`31` §7.1), and in a build with
  `debug_assertions` on it reports allocations only and marks the timings
  invalid.
- Fast local checks use the testkit and `strategy:check` (`iterate` profile,
  `31` §4.1). A local single-market backtest without the fleet,
  `pte backtest --strategy-file <pkg>/src/bin/<name>.rs --local-only --sequential --slug <slug> --trace <out.jsonl>`,
  builds the `artifact` profile, exactly the bytes a publish would produce,
  and keeps them in the local cache (`31` §7.5). Decisions and outputs do not
  depend on the profile (`31` §7.6).

## 16. Performance requirements

| # | Requirement | Reason |
|---|---|---|
| S1 | `Ctx` is built on the stack from references; books, portfolio, feeds and plugin outputs are never cloned per callback. | Callbacks run per tick × candidate. |
| S2 | `Intents` is an engine-owned buffer reused across callbacks; builders are stack values. | WIP allocates a `Vec` per callback (`strategy.rs:39-43`). |
| S3 | Books are outcome-indexed contiguous fixed-point arrays with O(1) best levels. | WIP keys assets by `Arc<str>` with linear string compares (`model.rs:13-24`; 10 §11). |
| S4 | Plugin outputs are computed once per tick per distinct canonical config and shared across candidates by reference. | 41 §5. |
| S5 | `Interests` skips callbacks a strategy ignores. | Every order produces several lifecycle callbacks. |
| S6 | Disabled logging costs one branch. | §13. |
| S7 | Meta is serialized once at placement and stored by id; cids up to 24 bytes are built without allocation and interned by the engine. | WIP stores `BTreeMap<String, serde_json::Value>` per intent and clones it into events (`model.rs:95`, 10 §10.1 V3). |
| S8 | Params are parsed once per candidate; strategies receive a typed struct. No JSON on the hot path. | WIP `create(&serde_json::Value)` (`strategy.rs:49`). |
| S9 | Static dispatch: the runtime is monomorphized over the strategy type; the candidate instances of a group live in one contiguous `Vec<T>`. Consequence: the engine's generic hot loop is code-generated in the strategy bin crate, so its optimization settings are the profile-wide ones of the `artifact` profile (`31` §4.2), not per-package overrides. | WIP `Box<dyn Strategy>` (`strategy.rs:49`). |
| S10 | Event views (§8) are built by key lookup per callback, without allocation. | 10 §10.1 V3. |
| S11 | Strategy CPU cost is measured: `strategy:check` prints ns/callback from `testkit::bench` on the fixture markets; `16-performance-and-parallelism.md` §13.4 reports the engine vs strategy share in the benchmark. | 01 §2 S5: measure and report. |
| S12 | The tick interest (§4.1) is evaluated by the engine once per event on the shared book; a skipped `on_tick` costs a candidate a few compares and skips building its plugin snapshot and feed view (16 §9.4 TF-3, TF-7). | Only 1.2% of ticks change a best price (16 §2.2). |

## 17. Author documentation

- `pmb-sdk` MUST ship rustdoc with a runnable example for every builder and
  accessor, the example strategy of §4, and `CONTRACT.md` (also rendered as the
  rustdoc module `pmb_sdk::contract`): the Rust counterpart of the TS
  ENGINE-CONTRACT (polymarket-protocols `_shared/ENGINE-CONTRACT.md`), with one
  section per profile (callback ordering, cascades, clocks including the
  `now()` rule of §5.0, plugin timing, fill and settlement timing,
  collateral-sized market BUYs, capital, GTD expiry, known limitations),
  sourced from `10`–`14`.
- Every engine-semantics change bumps `engineVersion` and adds a CONTRACT
  changelog entry in the same commit (`60` checks that the entry exists).
- Error messages from the derive, the builders, `describe` and
  `strategy:check` MUST name the field, the rule and the fix, because agents
  will act on them without a human (after M6, D39), through the build results
  of `31` §11.
- `pmb-sdk` `1.0.0`, its rustdoc and a complete `CONTRACT.md` for both
  profiles are deliverables of M11 (01 §6, `31` §12); before then only
  `native/strategies/` uses the SDK.

## 18. In-repo ports (this goal)

| Port | Id | Requirements |
|---|---|---|
| Engine exerciser | `engine-exerciser.rs` | Implements the exerciser of `60-verification.md` §5 exactly, including cids; no params, feeds or plugins. |
| lagsnipe.v15 | `overnight-opus55-lagsnipe.v15.rs` | Same param keys and normalized params as TS (§9 rules 9–10, golden PG-1), same feeds and plugins, `now()` per §5.0, all interests (no tick interest, §4.1). Ported from the readable oracle bundle of artifact `304eceb3…` (`data/strategy-artifacts/304eceb3…ab8.mjs`; D40, 60 §6.2), keeping its `f64` expression order; meta numbers through `toolkit::round_dp` (§14, 60 LP-3). |

Both live in the `native/strategies/` package and go through the same build
and publish pipeline as external strategies (`31` §2.3).

## Changes required in other documents

None open: every item was applied in the gate-1 consolidation.

## Open questions

None. Gate-1 answers applied here: tick interest for new strategies (D41,
§4.1), collateral sizing of share-sized FOK/FAK BUYs (D42, §7.1), self-cross
blocking (D54, §7.1), V4-only feeds as a follow-up (D43, §10), all four
plugins (D19, §10), lagsnipe port from the bundle (D40, §18).
