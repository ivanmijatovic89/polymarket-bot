//! `pmb-sdk`: the strategy SDK of the native engine (30-strategy-sdk.md).
//!
//! It is the only crate a strategy depends on (30 §1 P1). `use
//! pmb_sdk::prelude::*;` brings in the curated surface (§3); nothing of the
//! engine core is glob re-exported. It holds: the strategy definition and
//! context re-exported from `pmb-engine` by name (§4, §5, §8), values, their
//! §6 methods and compile-time macros (§6), the SDK version (§2), the author
//! order builders (§7) and intent meta (§7.2), params (§9) with the bridge to
//! the runtime, requirements (§10), deterministic [`collections`] and
//! [`math`] (§11), logging (§13), the pure [`toolkit`] helpers (§14), the
//! testkit (feature `testkit`, §15) and [`strategy_main!`] (§4 rule 1).
//!
//! The example strategy of 30 §4:
//!
//! ```
//! use pmb_sdk::prelude::*;
//!
//! #[derive(Params, Clone, Debug)]
//! pub struct LagParams {
//!     /// Shares per entry order.
//!     #[param(default = 5)]
//!     pub size: Qty,
//!     /// Highest entry price.
//!     #[param(default = 0.60, min = 0.01, max = 0.99)]
//!     pub max_price: Price,
//! }
//!
//! pub struct Lag { p: LagParams, entered: bool }
//!
//! impl Strategy for Lag {
//!     type Params = LagParams;
//!     const ID: &'static str = "example-lag.v1";
//!
//!     fn requirements(_p: &LagParams) -> Requirements {
//!         Requirements::new()
//!     }
//!
//!     fn new(p: &LagParams, _market: &MarketInfo) -> Self {
//!         Lag { p: p.clone(), entered: false }
//!     }
//!
//!     fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult {
//!         if self.entered { return Ok(()); }
//!         let Some(ask) = ctx.book(Outcome::Up).best_ask() else { return Ok(()) };
//!         if ask.price <= self.p.max_price {
//!             out.place(Order::buy(Outcome::Up, ask.price, self.p.size).fok().cid(cid!("entry")));
//!             self.entered = true;
//!         }
//!         Ok(())
//!     }
//! }
//! # fn main() {}
//! ```
//!
//! `status` (30 §4 rule 8) from the prelude alone:
//!
//! ```
//! use pmb_sdk::prelude::*;
//!
//! #[derive(Params, Clone, Debug)]
//! pub struct NoParams;
//!
//! pub struct Quiet { ticks: i64 }
//!
//! impl Strategy for Quiet {
//!     type Params = NoParams;
//!     const ID: &'static str = "example-quiet.v1";
//!     fn requirements(_p: &NoParams) -> Requirements { Requirements::new() }
//!     fn new(_p: &NoParams, _m: &MarketInfo) -> Self { Quiet { ticks: 0 } }
//!     fn on_tick(&mut self, _ctx: &Ctx, _out: &mut Intents) -> StrategyResult {
//!         self.ticks += 1;
//!         Ok(())
//!     }
//!     fn status(&self, out: &mut StatusMeta) {
//!         out.push("ticks", StatusValue::I64(self.ticks));
//!     }
//! }
//!
//! let mut m = StatusMeta::new();
//! Quiet { ticks: 3 }.status(&mut m);
//! assert_eq!(m.to_json(), r#"{"ticks":3}"#);
//! ```
//!
//! Params alone:
//!
//! ```
//! use pmb_sdk::prelude::*;
//!
//! #[derive(Params, Clone, Debug)]
//! pub struct LagParams {
//!     /// Shares per entry order.
//!     #[param(default = 5)]
//!     pub size: Qty,
//!     /// Highest entry price.
//!     #[param(default = 0.60, min = 0.01, max = 0.99)]
//!     pub max_price: Price,
//! }
//!
//! let p = LagParams::from_cli(["maxPrice=0.55"]).unwrap();
//! assert_eq!(p.size, qty!(5));
//! assert_eq!(p.max_price, price!(0.55));
//! assert_eq!(p.normalized_json(), r#"{"maxPrice":0.55,"size":5}"#);
//!
//! let err = LagParams::from_cli(["maxPrice=1.5", "sise=3"]).unwrap_err();
//! assert_eq!(err.issues()[0].path(), "/maxPrice");
//! assert_eq!(err.issues()[1].message(), r#"unknown params "sise"; valid params: maxPrice, size"#);
//! ```
//!
//! Compile-time checks (30 §6, §9 rules 1, 5):
//!
//! ```compile_fail
//! let _ = pmb_sdk::price!(0.1234567); // more than 6 decimals
//! ```
//! ```compile_fail
//! let _ = pmb_sdk::price!(1.5); // a price is from 0 to 1
//! ```
//! ```compile_fail
//! let _ = pmb_sdk::price!(-0.5); // a price is not negative
//! ```
//! ```compile_fail
//! let _ = pmb_sdk::usdc!(9223372036854.775808); // beyond i64 micros
//! ```
//! ```compile_fail
//! let _ = pmb_sdk::qty!(5u32); // no type suffix
//! ```
//! ```compile_fail
//! let _ = pmb_sdk::qty!(0x10); // decimal literals only
//! ```
//! ```compile_fail
//! let _ = pmb_sdk::cid!(""); // 1 to 256 bytes
//! ```
//! ```compile_fail
//! let _ = pmb_sdk::cid!("tab\there"); // printable ASCII only
//! ```
//! ```compile_fail
//! let _ = pmb_sdk::meta! { "a" => 1, "a" => 2 }; // unique keys
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(default = 0.5, max = 0.4)] // default violates the bound
//!     x: pmb_sdk::prelude::Price,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(default = 0.1234567)] // more than 6 decimals
//!     x: pmb_sdk::prelude::Price,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(default = 9007199254740992)] // beyond ±(2^53 - 1), 21 §18 N2
//!     x: u64,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(max = -9007199254740992)] // beyond ±(2^53 - 1), 21 §18 N2
//!     x: i64,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(default = 1234567890.123456)] // 16 significant digits
//!     x: pmb_sdk::prelude::Usdc,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(default = 9007199254740992)] // beyond 2^53 - 1 ms
//!     x: pmb_sdk::prelude::DurMs,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(default = 1)] // an Option defaults to None
//!     x: Option<i64>,
//! }
//! ```
//! ```compile_fail
//! type MaybeQty = Option<pmb_sdk::prelude::Qty>;
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(default = Some(pmb_sdk::qty!(5)))] // an Option, through an alias
//!     x: MaybeQty,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(maximum = 1)] // unknown option
//!     x: i64,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     a_b: i64,
//!     #[param(rename = "aB")] // key used twice
//!     c: i64,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct Base { size: i64 }
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     size: i64,
//!     #[param(flatten)] // `size` collides with Base::size
//!     base: Base,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::ParamEnum)]
//! enum Mode { Fast, Slow }
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(default = "Medium")] // not a variant name
//!     mode: Mode,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     x: f32, // not a params field type
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(min = 1)] // bounds need a numeric field
//!     name: String,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P<T> { x: T } // params are plain data, no generics
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P(i64); // named fields only
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::Params)]
//! struct P {
//!     #[param(min = 5, max = 1)] // empty range
//!     x: i64,
//! }
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::ParamEnum)]
//! enum Mode { Fast(u8), Slow } // unit variants only
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::ParamEnum)]
//! enum Mode { Fast, #[param(rename = "Fast")] Slow } // names must be unique
//! ```
//! ```compile_fail
//! #[derive(pmb_sdk::ParamEnum)]
//! enum Mode { #[param(rename = "a", rename = "b")] Fast } // one rename
//! ```
//! ```compile_fail
//! let k = "edge";
//! let _ = pmb_sdk::meta! { k => 1 }; // keys are string literals
//! ```
//! ```compile_fail
//! let _ = pmb_sdk::cid!(
//!     "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\
//!      0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\
//!      0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\
//!      0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef!"
//! ); // 257 bytes
//! ```

// The derives expand to `::pmb_sdk::...` paths; this lets them work inside
// this crate's own unit tests too.
extern crate self as pmb_sdk;

pub mod collections;
mod log;
pub mod math;
mod meta;
mod order;
pub mod params;
mod requirements;
#[cfg(feature = "testkit")]
pub mod testkit;
pub mod toolkit;
mod values;

/// The `pmb-sdk` version this binary was built with (SemVer, independent of
/// the engine's `engineVersion`), reported by `describe` as `sdkVersion`
/// (30 §2, 20 §3).
pub const SDK_VERSION: &str = env!("CARGO_PKG_VERSION");

// D-PENDING: 30 §3 lists Meta and meta! only; chose to also expose
// `pmb_sdk::MetaValue` (not in the prelude), the value type of the public
// `Meta::set` / `Meta::get` signatures.
pub use meta::{Meta, MetaValue};
// D-PENDING: 30 §3 names no type for the value between `buy_spend` and
// `.fok()`/`.fak()`, nor the bound of `Intents::place`; chose to expose
// `SpendOrder` and the sealed `PlaceableOrder` here, outside the prelude.
pub use order::{PlaceableOrder, SpendOrder};
pub use params::{ParamEnum, ParamError, Params};
pub use pmb_sdk_macros::{cid, meta, price, qty, usdc, ParamEnum, Params};

/// JSON values for [`Meta::json`] (30 §3): a re-export of
/// `serde_json::Value`, the only third-party item the SDK exposes.
pub mod json {
    pub use serde_json::Value;
}

/// The entry point of a strategy binary (30 §4 rule 1): expands to the
/// `main` running every subcommand of 20 for the strategy type, through the
/// runtime monomorphized over it (never boxed), and reports this SDK's
/// version as `sdkVersion` (20 §3). One call per bin.
///
/// ```ignore
/// pmb_sdk::strategy_main!(Lag);
/// ```
///
/// In a `cargo test` build of the bin the generated `main` is not called;
/// it does not warn.
#[macro_export]
macro_rules! strategy_main {
    ($strategy:ty $(,)?) => {
        const _: () = $crate::__private::assert_selftest_ready::<
            <$strategy as $crate::prelude::Strategy>::Params,
        >();
        #[cfg_attr(test, allow(dead_code))]
        fn main() {
            $crate::__private::runtime_main::<$strategy>($crate::__private::MainOptions {
                sdk_version: $crate::SDK_VERSION,
            })
        }
    };
}

/// `use pmb_sdk::prelude::*;` (30 §3). Types are those of
/// 10-domain-model.md and of the engine, re-exported by name (P1: never a
/// glob of the core).
pub mod prelude {
    // Definition (30 §4).
    pub use crate::strategy_main;
    pub use pmb_engine::strategy::{
        EventFlags, Interests, Strategy, StrategyError, StrategyResult, TickInterest,
    };
    // Context (30 §5).
    pub use pmb_core::fill::{Capital, Position, SettlementStatus};
    pub use pmb_core::state::OrderState;
    pub use pmb_core::{MarketInfo, Symbol, Timeframe};
    pub use pmb_engine::strategy::{
        BookView, Ctx, Level, OrderView, PortfolioView, RulesView, TickCause, TickInfo,
    };
    // Values (30 §6).
    pub use pmb_core::{
        ClientOrderId, DurMs, ExchangeOrderId, OrderType, Outcome, Price, Qty, Rate, Rounding,
        Side, TsMs, Usdc,
    };
    pub use pmb_sdk_macros::{cid, meta, price, qty, usdc};
    // The 30 §6 methods the core types lack, in scope without a name.
    pub use crate::values::{ClientOrderIdExt as _, OutcomeExt as _, PriceExt as _, TsMsExt as _};
    // Intents (30 §7).
    pub use crate::meta::Meta;
    // D-PENDING: 30 §4 rule 8 has `Strategy::status(&self, out: &mut Meta)`
    // take the 30 §7.2 `Meta`, but the engine trait takes its own scalar
    // meta; chose to export that type as `StatusMeta` (with `StatusValue`)
    // so `status` can be overridden from a pmb-sdk-only package, until the
    // engine trait takes the SDK `Meta` (crossStreamNeeds).
    pub use crate::order::{IntentsExt as _, LimitOrder, MarketableOrder, Order};
    pub use pmb_engine::strategy::{Meta as StatusMeta, MetaValue as StatusValue};
    // D-PENDING: `CancelRef` is not in the 30 §3 list; it is the item type
    // of the engine buffer's `cancel_batch` until the 30 §7 signature
    // lands (see `order.rs`).
    pub use pmb_engine::strategy::{CancelRef, Intents};
    // Events (30 §8).
    pub use pmb_core::event::{
        CancelCause, CancelFailReason, DoneReason, MergeFailReason, RejectReason, SplitFailReason,
    };
    pub use pmb_core::fill::Liquidity;
    pub use pmb_engine::strategy::{AccountEvent, FillView};
    // Params (30 §9).
    pub use crate::params::{ParamEnum, ParamError, Params};
    pub use pmb_sdk_macros::{ParamEnum, Params};
    // Requirements (30 §10). TODO(feeds-merge): see `requirements.rs`.
    pub use crate::requirements::{
        BidOrAsk, DwellGateConfig, FeedOptions, Requirements, TechnicalIndicatorsConfig,
        TimeWindowGateConfig, TimeWindowVolatilityConfig, VolPrice,
    };
    pub use crate::requirements::{FeedOptionsExt as _, RequirementsExt as _};
    // Feeds / plugins (30 §5, 14). TODO(feeds-merge): `PricePoint`,
    // `PriceToBeat` and the plugin snapshot types come with the merged
    // feed wiring; these two are the engine's current stand-ins.
    pub use pmb_engine::feeds_view::FeedsView;
    pub use pmb_engine::plugins_view::PluginsView;
    // Logging (30 §13).
    pub use crate::{debug, error, info, trace, warn};
}

/// Targets of the macro expansions. Not part of the SDK API: no stability
/// guarantee, never used by hand.
#[doc(hidden)]
pub mod __private {
    pub use crate::log::{log_enabled, log_line, LogLevel};
    pub use crate::meta::{Meta, MetaValue};
    pub use crate::params::input::Input;
    pub use crate::params::runtime::{runtime_from_json, runtime_normalized};
    pub use crate::params::support::{assert_selftest_ready, selftest_params, SelftestReady};
    pub use crate::params::support::{
        check_bound, enum_default, enum_expected, enum_schema, field, has_name, key_collision,
        merge_validate, parse_enum, parse_struct, schema_default, schema_describe, struct_expected,
        struct_schema, write_field, write_struct, BoundOp, KeyTree, ParamsFields, SchemaDefs,
    };
    pub use crate::params::text::write_json_str;
    pub use crate::params::value::{BoundView, ParamValue};
    pub use pmb_core::{ClientOrderId, DurMs, Price, Qty, Rate, Usdc};
    pub use pmb_runtime::params::ParamError as RuntimeParamError;
    pub use pmb_runtime::{main_with as runtime_main, MainOptions, StrategyParams};
    pub use serde_json::Value;

    /// The JSON object type of the runtime's params seam.
    pub type JsonMap = serde_json::Map<String, Value>;

    /// A `DurMs` of `ms` milliseconds. The one place the SDK builds a
    /// `DurMs` from its integer, used by the params derive with values it
    /// checked at compile time (non-negative, at most 2^53 - 1).
    // D-PENDING: 30 P7 forbids public fields, but pmb-core's `DurMs(pub
    // i64)` has one; chose to route every SDK construction through this
    // function so a checked core constructor needs one change here.
    pub const fn dur_ms(ms: i64) -> DurMs {
        DurMs(ms)
    }

    /// `cid!` expansion: the literal was validated at compile time (10 §6).
    // D-PENDING: 30 §6 requires cids of at most 24 bytes to be built without
    // allocation; pmb-core's ClientOrderId is a Box<str>, so this allocates
    // until the core type gains an inline or static representation.
    pub fn cid_from_literal(s: &'static str) -> ClientOrderId {
        match ClientOrderId::new(s) {
            Ok(c) => c,
            Err(e) => unreachable!("cid! literal {s:?} was validated at compile time: {e}"),
        }
    }
}
