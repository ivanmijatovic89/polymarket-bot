//! `pmb-sdk`: the strategy SDK of the native engine (30-strategy-sdk.md).
//!
//! It is the only crate a strategy depends on (30 §1 P1). `use
//! pmb_sdk::prelude::*;` brings in the curated surface (§3); nothing of the
//! engine core is glob re-exported. This revision holds the parts that do
//! not depend on the engine: values and their compile-time macros (§6),
//! intent meta (§7.2), params (§9), deterministic [`collections`] and
//! [`math`] (§11), and the pure [`toolkit`] helpers (§14). The strategy
//! trait, context, intents, events, requirements, logging and the runtime
//! entry point are added with the engine.
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
pub mod math;
mod meta;
pub mod params;
pub mod toolkit;

pub use meta::Meta;
pub use params::{ParamEnum, ParamError, Params};
pub use pmb_sdk_macros::{cid, meta, price, qty, usdc, ParamEnum, Params};

/// JSON values for [`Meta::json`] (30 §3): a re-export of
/// `serde_json::Value`, the only third-party item the SDK exposes.
pub mod json {
    pub use serde_json::Value;
}

/// `use pmb_sdk::prelude::*;` (30 §3). Value types are those of
/// 10-domain-model.md, re-exported by name (P1: never a glob of the core).
pub mod prelude {
    pub use crate::meta::Meta;
    pub use crate::params::{ParamEnum, ParamError, Params};
    pub use pmb_core::{
        ClientOrderId, DurMs, ExchangeOrderId, OrderType, Outcome, Price, Qty, Rate, Rounding,
        Side, TsMs, Usdc,
    };
    pub use pmb_sdk_macros::{cid, meta, price, qty, usdc, ParamEnum, Params};
}

/// Targets of the macro expansions. Not part of the SDK API: no stability
/// guarantee, never used by hand.
#[doc(hidden)]
pub mod __private {
    pub use crate::meta::{Meta, MetaValue};
    pub use crate::params::input::Input;
    pub use crate::params::support::{
        check_bound, enum_default, enum_expected, enum_schema, field, has_name, key_collision,
        merge_validate, parse_enum, parse_struct, schema_default, schema_describe, struct_expected,
        struct_schema, write_field, write_struct, BoundOp, KeyTree, ParamsFields,
    };
    pub use crate::params::text::write_json_str;
    pub use crate::params::value::{BoundView, ParamValue};
    pub use pmb_core::{ClientOrderId, DurMs, Price, Qty, Rate, Usdc};
    pub use serde_json::Value;

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
