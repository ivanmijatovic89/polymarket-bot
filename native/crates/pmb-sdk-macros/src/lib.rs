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
