# native/strategies

The in-repo native strategy package (31 §2.3, 01 §4.1). It is a standalone
Cargo package (its own `[workspace]` table), **not** a member of the engine
workspace in `native/` (31 §2.1). Its only dependency is `pmb-sdk`
(`../crates/pmb-sdk`); its only dev-dependency is `pmb-sdk` with the
`testkit` feature (31 §2.2, D16).

| Bin                           | Strategy id           | TS twin                                                           | Spec                      |
| ----------------------------- | --------------------- | ----------------------------------------------------------------- | ------------------------- |
| `src/bin/engine-exerciser.rs` | `engine-exerciser.rs` | `src/strategies/testing/engine-exerciser.ts` (`engine-exerciser`) | 60 §5.1–§5.7, 30 §18, D20 |
| `src/bin/feed-exerciser.rs`   | `feed-exerciser.rs`   | `src/strategies/testing/feed-exerciser.ts` (`feed-exerciser`)     | 60 §5.8, 14 §13 V-3       |

Layout (31 §2.2):

- Each bin holds its `impl Strategy`, its single `strategy_main!` call and
  its testkit tests (`#[cfg(test)]`, run by `cargo test`).
- `src/lib.rs` holds only code both bins run: the engine exerciser schedule
  (`src/exerciser.rs`), which the feed exerciser runs on real ticks when
  `trade: true`. An edit to one bin therefore leaves the other bin's source
  hash unchanged (31 §5.2, §5.6).
- `fixtures/feed-exerciser-plugin-config.json` is the TS twin's
  `FEED_EXERCISER_PLUGIN_CONFIG` in its JSON shape. The Rust tests build the
  expected plugin configs from it; the TS twin is expected to assert its
  constant against the same file.

## Status

- **Manifest staged.** The manifest is committed as `Cargo.toml.pending`,
  so `native/strategies/` is not a Cargo package yet. The CI step "Strategy
  package" (`.github/workflows/quality.yml`) and `scripts/native/ci-local.sh`
  key on `native/strategies/Cargo.toml`, so they stay off and every gate
  stays green (00 R12). The package cannot build before the `pmb-sdk` facade
  of `30-strategy-sdk.md` (`Strategy`, `Ctx`, `Intents`, `Requirements`,
  `testkit`) exists in `native/crates/`.
- **Activation**, in one change on the branch that already has the facade:
  `git mv Cargo.toml.pending Cargo.toml` (drop its staging comment), add
  `Cargo.lock` with `strategy:sync-lock` (a subset of `native/Cargo.lock`,
  31 §2.2, §3), adjust any facade name that differs from the checklist
  below, then run the commands below.
- `engine-exerciser.rs` implements schedule v1 (60 §5.2) and the account
  callback A0 (60 §5.4) with `EXERCISER_SCHEDULE_VERSION = 1`, as the TS
  twin. Schedule v2 (60 §5.3, A1–A3, per-order meta) is M2 (01 §4.1): add
  rows to `SCHEDULE` and `TRIGGERS`, attach the meta in `Writer`, bump the
  version in both twins (60 §5.7). Open before v2: rows `x17` and `x18`
  cannot be written with the SDK builders (30 §7.1), see the D-PENDING note
  at `SCHEDULE`.
- `feed-exerciser.rs`: `trade: false` returns no intents; `trade: true` runs
  the engine exerciser schedule on real ticks only, as the TS twin does, so
  both follow `EXERCISER_SCHEDULE_VERSION` (v1 until M2; 60 §5.8 says v2).
- Verification so far: `cargo fmt --all --check`,
  `cargo clippy --all-targets -- -D warnings` (plus the determinism lints of
  `native/build/clippy`, forbidden) and `cargo test` passed against a
  throwaway, uncommitted mock of the checklist below. The mock is layered on
  the real `ws/sdk` params derive and value macros, makes every config and
  view `#[non_exhaustive]` or private-field (30 §1 P7), and runs a
  zero-latency stand-in for the testkit. The expected traces still need the
  real testkit, which runs the real engine (30 §15).

Once the facade exists and the manifest is active:

```bash
cd native/strategies
cargo fmt --all --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked          # lib unit tests + both bins' testkit tests
```

## Facade checklist

Every `pmb-sdk` item the two strategies and their tests use. Names follow
30 §3–§10 and §15; where 30 does not fix a name or signature, the choice is
marked _(choice)_. Every struct is used only through constructors,
builders, accessors and field reads, so the code compiles whether the SDK
types are `#[non_exhaustive]` or have private fields (30 §1 P7).

### Definition (30 §4)

- `Strategy` with `type Params`, `const ID: &'static str`,
  `fn requirements(p: &Self::Params) -> Requirements`,
  `fn new(p: &Self::Params, market: &MarketInfo) -> Self`,
  `fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult`,
  `fn on_event(&mut self, ctx: &Ctx, event: &AccountEvent, out: &mut Intents) -> StrategyResult`;
  `interests` left at its default.
- `StrategyResult`; `MarketInfo` (type only).
- `pmb_sdk::strategy_main!(Type)` with a type defined in the bin (30 §4).
  In a `cargo test` build of the bin the generated `main` is unused and must
  not warn.

### Context (30 §5)

- `Ctx::now() -> TsMs`, `Ctx::tick() -> &TickInfo` with the public field
  `synthetic: bool`, `Ctx::book(Outcome) -> &BookView`,
  `Ctx::portfolio() -> &PortfolioView`. Author code writes `&Ctx` and
  `&AccountEvent` with elided lifetimes, also inside `fn` pointer types.
- `BookView::best_bid()`, `BookView::best_ask() -> Option<Level>`;
  `Level::price` (field read).
- `PortfolioView::position(Outcome) -> Position` with the field `qty: Qty`
  (read); `PortfolioView::open_orders()` iterator (only `.next()` is used).

### Values (30 §6)

- `Price`, `Qty`, `Usdc`, `TsMs`, `DurMs`, `Rounding::{Floor, Ceil, HalfAwayFromZero}`,
  `Outcome::{Up, Down}`, `Side::Buy` (tests), `ClientOrderId`.
- `Price: Copy + Ord` (`clamp`), `Price + Price`, `Price - Price` whose result
  may be below 0 before clamping (bid 0.01 − 0.05).
- `Price::snap(self, tick: Price, mode: Rounding) -> Price` _(choice:
  infallible; pmb-core today has `to_tick(..) -> Result<Price, Overflow>`)_.
- `Price::from_f64(f64, Rounding) -> Result<Price, _>` (tests).
- `Qty: Copy + Ord` (`min`, `<`, `<=`).
- `TsMs + DurMs -> TsMs`; `const fn TsMs::from_ms(i64) -> TsMs` and
  `const fn DurMs::from_ms(i64) -> DurMs` (panics on a negative value, so a
  bad constant fails compilation; 10 §2 `DurMs >= 0`) _(choice: 30 names no
  constructor; pmb-core today has public tuple fields, which P7 rules out)_.
- `ClientOrderId::indexed(prefix: &str, n: u64) -> ClientOrderId` _(choice:
  return and integer types)_; `ClientOrderId::as_str() -> &str`.
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
  `qty: Qty` (reads) _(choice: 30 §8 lists `order` inside `FillView`;
  `ws/core` puts `order` on the `Fill` variant instead)_.
- `OrderView::cid() -> &ClientOrderId` (30 §5.2) _(`ws/core` today returns an
  interned key and resolves the text through `PortfolioView::cid_str`)_.

### Params (30 §9, as implemented on `ws/sdk`)

- `#[derive(Params)]` on a unit struct and on a named struct;
  `#[param(default = true)]` on a `bool`; a field without a default is
  required. No custom `validate`.
- Tests: `Params::from_cli`, `Params::normalized_json`, `ParamError::issues()`,
  `ParamIssue::path()`.

### Requirements (30 §10)

- `Requirements::new()` and by-value builders `binance_spot(FeedOptions)`,
  `chainlink(FeedOptions)`, `price_to_beat()`,
  `time_window_volatility(TimeWindowVolatilityConfig)`,
  `dwell_gate(DwellGateConfig)`, `time_window_gate(TimeWindowGateConfig)`,
  `technical_indicators(TechnicalIndicatorsConfig)`;
  `Requirements: Clone + PartialEq + Debug` (tests compare values).
- `FeedOptions: Default + Clone + PartialEq + Debug` with the by-value
  builder `tick_on_update(bool) -> FeedOptions` _(choice: 30 §10 describes
  the fields `symbol`, `tick_on_update`, not how they are set)_.
- Plugin configs, each `Clone + PartialEq + Debug` (tests compare values;
  not required to be `Copy`, so a later non-`Copy` field stays a minor bump,
  30 §2) _(choice: 30 names the types only)_:
  - `TimeWindowVolatilityConfig::new(impl IntoIterator<Item = (impl Into<String>, DurMs)>)`,
    tracking the mid, the TS default `trackPrice` (so no `VolPrice` type
    outside the 30 §3 prelude is needed; bid or ask tracking would be a
    by-value builder taking `BidOrAsk`, unused here);
  - `DwellGateConfig::new(from: Price, to: Price, required: DurMs, track: BidOrAsk)`;
  - `TimeWindowGateConfig::new(allow_after: DurMs, disable_after: DurMs)`;
  - `TechnicalIndicatorsConfig::default()`;
  - `BidOrAsk::{Bid, Ask}`.

### Testkit (30 §15, feature `testkit`) _(choice: 30 lists capabilities only)_

- `pmb_sdk::testkit::{TestMarket, Profile}`.
- `TestMarket::btc_15m(TsMs)`, by-value `profile(Profile::TsCompat)` and
  `starting_capital(Usdc)`.
- `&mut self` inputs, each returning `&mut Self`:
  - `book(at: TsMs, outcome: Outcome, bids: &[(Price, Qty)], asks: &[(Price, Qty)])`:
    a full book (one `book` tick);
  - `price_change(at: TsMs, outcome: Outcome, side: Side, price: Price, size: Qty)`:
    one level (one `price_change` tick); `Side::Buy` is the bid ladder;
  - `binance_trade(at: TsMs, price: f64)`: one Binance aggTrade (a synthetic
    tick when `tick_on_update` is requested);
  - `price_to_beat(at: TsMs, value: f64)`: the price-to-beat key.
- `TestMarket::run::<S: Strategy>(&self, params: &S::Params) -> TestRun`.
- `TestRun::trace() -> &[pmb_sdk::json::Value]`: the canonical parity trace
  records of 22 §3.2 at level `decisions`, header first, including the
  `tick` records with `seq` and `cause`.
- `pmb_sdk::json::Value` with `FromStr`, indexing by key, `as_u64`, `as_i64`,
  `as_f64`, `as_str`, `as_object` and object access.
