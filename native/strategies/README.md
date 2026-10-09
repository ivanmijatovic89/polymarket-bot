# native/strategies

The in-repo native strategy package (31 §2.3, 01 §4.1). It is a standalone
Cargo package (its own `[workspace]` table), **not** a member of the engine
workspace in `native/` (31 §2.1). Its only dependency is `pmb-sdk`
(`../crates/pmb-sdk`); its only dev-dependency is `pmb-sdk` with the
`testkit` feature (31 §2.2, D16).

| Bin | Strategy id | TS twin | Spec |
|---|---|---|---|
| `src/bin/engine-exerciser.rs` | `engine-exerciser.rs` | `src/strategies/testing/engine-exerciser.ts` (`engine-exerciser`) | 60 §5.1–§5.7, 30 §18, D20 |
| `src/bin/feed-exerciser.rs` | `feed-exerciser.rs` | `src/strategies/testing/feed-exerciser.ts` (`feed-exerciser`) | 60 §5.8, 14 §13 V-3 |

The `Strategy` impls live in the library (`src/exerciser.rs`,
`src/feed_exerciser.rs`) so that the testkit tests in `tests/` can name the
strategy types; each bin only calls `pmb_sdk::strategy_main!` once (31 §2.2).

## Status

- **Does not build yet.** It is written against the `pmb-sdk` facade of
  `30-strategy-sdk.md`, which does not exist in `native/crates/` yet. Until it
  does, the package stays out of every workspace and every CI gate.
- `engine-exerciser.rs` implements schedule v1 (60 §5.2) and the account
  callback A0 (60 §5.4) with `EXERCISER_SCHEDULE_VERSION = 1`, as the TS twin.
  Schedule v2 (60 §5.3, A1–A3, per-order meta) is M2: add rows to `SCHEDULE`
  and `TRIGGERS`, attach the meta in `Writer`, bump the version in both twins
  (60 §5.7).
- `feed-exerciser.rs`: `trade: false` only. `trade: true` (schedule v2 on real
  ticks) is M2 and is refused by params validation (`describe` fails before
  enqueue) and, as a backstop, by an assert in `new` (00 R14).
- `Cargo.lock` (31 §2.2: a subset of `native/Cargo.lock`) is added with
  `strategy:sync-lock` once `pmb-sdk` exists.
- The code was type-checked, clippy-clean (`-D warnings` plus the
  determinism lints of `native/build/clippy`) and its schedule logic run
  against a throwaway mock of the checklist below layered on the real
  `ws/sdk` params derive and value macros. The mock is not committed.

Once the facade exists:

```bash
cd native/strategies
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked          # unit tests + tests/exerciser_schedule.rs + tests/feed_exerciser.rs
```

## Facade checklist

Every `pmb-sdk` item the two strategies and their tests use. Names follow
30 §3–§10 and §15; where 30 does not fix a name or signature, the choice is
marked *(choice)*.

### Definition (30 §4)

- `Strategy` with `type Params`, `const ID: &'static str`,
  `fn requirements(p: &Self::Params) -> Requirements`,
  `fn new(p: &Self::Params, market: &MarketInfo) -> Self`,
  `fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult`,
  `fn on_event(&mut self, ctx: &Ctx, event: &AccountEvent, out: &mut Intents) -> StrategyResult`
  (overridden by the engine exerciser), `interests` left at its default.
- `StrategyResult`; `MarketInfo` (type only).
- `pmb_sdk::strategy_main!(path::to::Type)`: accepts a path to a type
  defined in the package library *(choice: 30 §4 shows a local type)*.

### Context (30 §5)

- `Ctx::now() -> TsMs`, `Ctx::tick() -> &TickInfo` with the public field
  `synthetic: bool`, `Ctx::book(Outcome) -> &BookView`,
  `Ctx::portfolio() -> &PortfolioView`. Author code writes `&Ctx` and
  `&AccountEvent` with elided lifetimes, also inside `fn` pointer types.
- `BookView::best_bid()`, `BookView::best_ask() -> Option<Level>`;
  `Level::price` (field).
- `PortfolioView::position(Outcome) -> Position` with the field `qty: Qty`;
  `PortfolioView::open_orders()` iterator (only `.next()` is used).

### Values (30 §6)

- `Price`, `Qty`, `Usdc`, `TsMs`, `DurMs`, `Rounding::{Floor, Ceil}`,
  `Outcome::{Up, Down}`, `Side::Buy` (tests), `ClientOrderId`.
- `Price: Copy + Ord` (`clamp`), `Price + Price`, `Price - Price` whose result
  may be below 0 before clamping (bid 0.01 − 0.05).
- `Price::snap(self, tick: Price, mode: Rounding) -> Price` *(choice:
  infallible; pmb-core today has `to_tick(..) -> Result<Price, Overflow>`)*.
- `Qty: Copy + Ord` (`min`, `<`, `<=`).
- `TsMs + DurMs -> TsMs`; `DurMs(i64)` and `TsMs(i64)` tuple constructors,
  usable in `const` *(choice: 30 names no constructor)*.
- `ClientOrderId::indexed(prefix: &str, n: u64) -> ClientOrderId` *(choice:
  return and integer types)*; `ClientOrderId::as_str() -> &str`.
- `price!`, `qty!`, `usdc!` (const-evaluable, as on `ws/sdk`), `cid!`.

### Intents (30 §7)

- `Order::buy(Outcome, Price, Qty) -> LimitOrder`, `Order::sell(..)`.
- `LimitOrder::post_only() -> LimitOrder`, `LimitOrder::gtd(TsMs) -> LimitOrder`,
  `LimitOrder::fok() -> MarketableOrder`; `.cid(ClientOrderId) -> Self` on
  both order types.
- `Intents::place(order)` for `LimitOrder` and `MarketableOrder`;
  `Intents::place_batch([LimitOrder; N])`; `Intents::cancel(&ClientOrderId)`;
  `Intents::cancel_batch([&ClientOrderId; N])`;
  `Intents::cancel_market(Option<Outcome>)`; `Intents::cancel_all()`;
  `Intents::split(Qty)`; `Intents::merge(Qty)`.

### Account events (30 §8)

- `AccountEvent::Fill { fill, .. }` (non-exhaustive enum).
- `FillView` fields `order: &OrderView`, `outcome: Outcome`, `price: Price`,
  `qty: Qty` *(choice: 30 §8 lists `order` inside `FillView`; `ws/core` puts
  `order` on the `Fill` variant instead)*.
- `OrderView::cid() -> &ClientOrderId` (30 §5.2) *(`ws/core` today returns an
  interned key and resolves the text through `PortfolioView::cid_str`)*.

### Params (30 §9, as implemented on `ws/sdk`)

- `#[derive(Params)]` on a unit struct and on a named struct;
  `#[param(default = true)]` on a `bool`; a field without a default is
  required.
- `#[param(validate)]` on the struct plus
  `impl Params for T { fn validate(&self) -> Result<(), ParamError> }`
  *(ws/sdk's mechanism; 30 §9 rule 2 names only the method)*;
  `ParamError::new(field, message)`.
- Tests: `Params::from_cli`, `Params::normalized_json`, `ParamError::issues()`,
  `ParamIssue::path()`, `ParamIssue::message()`.

### Requirements (30 §10)

- `Requirements::new()` and by-value builders `binance_spot(FeedOptions)`,
  `chainlink(FeedOptions)`, `price_to_beat()`,
  `time_window_volatility(TimeWindowVolatilityConfig)`,
  `dwell_gate(DwellGateConfig)`, `time_window_gate(TimeWindowGateConfig)`,
  `technical_indicators(TechnicalIndicatorsConfig)`;
  `Requirements: Clone + PartialEq + Debug` (tests compare values).
- `FeedOptions { symbol, tick_on_update }` with public fields, `Default` and
  `Clone` (struct-update syntax, so not `#[non_exhaustive]`).
- Plugin configs *(choice: the `ws/plugins` shapes; 30 names the types only)*:
  `TimeWindowVolatilityConfig::new(impl IntoIterator<Item = (impl Into<String>, i64)>, VolPrice)`
  with `VolPrice::Mid` (missing from the 30 §3 prelude list, which has only
  `BidOrAsk`); `DwellGateConfig { from: Price, to: Price, required_ms: i64, track_price: BidOrAsk }`;
  `BidOrAsk::Bid`; `TimeWindowGateConfig { allow_after_ms: i64, disable_after_ms: i64 }`;
  `TechnicalIndicatorsConfig::default()`.

### Testkit (30 §15, feature `testkit`) *(choice: 30 lists capabilities only)*

- `pmb_sdk::testkit::{TestMarket, Profile}`.
- `TestMarket::btc_15m(TsMs)`, by-value `profile(Profile::TsCompat)` and
  `starting_capital(Usdc)`.
- `TestMarket::book(&mut self, at: TsMs, outcome: Outcome, bids: &[(Price, Qty)], asks: &[(Price, Qty)])`:
  a full book (one `book` tick).
- `TestMarket::price_change(&mut self, at: TsMs, outcome: Outcome, side: Side, price: Price, size: Qty)`:
  one level (one `price_change` tick); `Side::Buy` is the bid ladder.
- `TestMarket::run::<S: Strategy>(&self, params: &S::Params) -> TestRun`.
- `TestRun::trace() -> &[pmb_sdk::json::Value]`: the canonical parity trace
  records of 22 §3.2 at level `decisions`, header first.
- `pmb_sdk::json::Value` with `FromStr`, indexing by key, `as_u64`,
  `as_f64` and object access.
