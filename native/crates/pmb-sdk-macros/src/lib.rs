//! Proc macros of the strategy SDK (30-strategy-sdk.md). Strategies use them
//! through `pmb_sdk` (`use pmb_sdk::prelude::*;`), never directly: every
//! expansion names its runtime through `::pmb_sdk::__private`.
//!
//! - `#[derive(Params)]`, `#[derive(ParamEnum)]`: typed strategy params
//!   (30 §9).
//! - `price!`, `qty!`, `usdc!`: exact decimal literals to fixed point at
//!   compile time, never through `f64` (30 §6, 10 §2).
//! - `cid!`: a client order id checked at compile time (30 §6, 10 §6).
//! - `meta!`: intent meta of scalar values (30 §7.2).
//!
//! Errors name the field, the rule and the fix (30 §17).

use proc_macro::TokenStream;

mod attrs;
mod literal;
mod param_enum;
mod params;
mod values;

use literal::FixedKind;

fn emit(r: syn::Result<proc_macro2::TokenStream>) -> TokenStream {
    r.unwrap_or_else(syn::Error::into_compile_error).into()
}

/// Derives `pmb_sdk::Params` for a struct of named fields (30 §9).
///
/// Keys are the camelCase field names (`max_price` → `maxPrice`). Field
/// options, in `#[param(..)]`:
///
/// | Option | Meaning |
/// |---|---|
/// | `default = <literal or expr>` | Value when the key is absent. Fixed-point literals (`Price`, `Qty`, `Usdc`, `Rate`) are parsed from their digits at compile time; a string literal on a `#[derive(ParamEnum)]` field names a variant (checked at compile time). Not allowed on `Option` fields (they default to `None`). |
/// | `default` | `Default::default()` (for example an empty `Vec`). |
/// | `min = <lit>`, `max = <lit>` | Inclusive bounds of a numeric field (or of the value inside an `Option`). |
/// | `exclusive_min = <lit>`, `exclusive_max = <lit>` | Exclusive bounds (Zod `.positive()` is `exclusive_min = 0`). |
/// | `rename = "key"` | Another key (30 §9 rule 4). |
/// | `flatten` | Merge the keys of a nested `#[derive(Params)]` struct into this object (rule 5); key collisions fail compilation. |
///
/// A field without `default` is required, except `Option` fields. Doc
/// comments become schema descriptions.
///
/// Value rules beyond the 30 §9 table, so that normalized params survive
/// TS storage (`JSON.parse`/`JSON.stringify` of `backtest_runs.params`):
/// integers (and `DurMs`) stay within ±(2^53 - 1) (21 §18 N2), and
/// fixed-point values have at most 15 significant digits. An `Option`
/// field is `None` when absent, `null`, or the string `"null"`; for
/// `Option<String>` that includes a typed `"null"` string, because a mixed
/// params object cannot tell a CLI string from a typed one. On the struct, `#[param(validate)]`
/// leaves `impl Params for T { fn validate(&self) .. }` to the author for
/// cross-field rules; without it the derive writes an empty `impl Params`.
#[proc_macro_derive(Params, attributes(param))]
pub fn derive_params(input: TokenStream) -> TokenStream {
    emit(params::derive(syn::parse_macro_input!(
        input as syn::DeriveInput
    )))
}

/// Derives `pmb_sdk::ParamEnum` for a unit-only enum (30 §9).
#[proc_macro_derive(ParamEnum, attributes(param))]
pub fn derive_param_enum(input: TokenStream) -> TokenStream {
    emit(param_enum::derive(syn::parse_macro_input!(
        input as syn::DeriveInput
    )))
}

/// `price!(0.53)`: a `Price` from an exact decimal literal (30 §6).
#[proc_macro]
pub fn price(input: TokenStream) -> TokenStream {
    emit(values::fixed(input.into(), FixedKind::Price))
}

/// `qty!(5)`: a `Qty` from an exact decimal literal (30 §6).
#[proc_macro]
pub fn qty(input: TokenStream) -> TokenStream {
    emit(values::fixed(input.into(), FixedKind::Qty))
}

/// `usdc!(1.25)`: a `Usdc` from an exact decimal literal (30 §6).
#[proc_macro]
pub fn usdc(input: TokenStream) -> TokenStream {
    emit(values::fixed(input.into(), FixedKind::Usdc))
}

/// `cid!("entry")`: a `ClientOrderId` checked at compile time (30 §6).
#[proc_macro]
pub fn cid(input: TokenStream) -> TokenStream {
    emit(values::cid(input.into()))
}

/// `meta! { "edge" => 0.031, "leg" => "entry" }`: a `Meta` (30 §7.2).
#[proc_macro]
pub fn meta(input: TokenStream) -> TokenStream {
    emit(values::meta(input.into()))
}
