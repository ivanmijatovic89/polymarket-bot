//! Value macros `price!`, `qty!`, `usdc!`, `cid!`, `meta!` (30 §3, §6, §7.2).

use crate::literal::{FixedKind, NumLit};
use proc_macro2::TokenStream;
use quote::quote;
use syn::parse::{Parse, ParseStream, Parser};
use syn::punctuated::Punctuated;
use syn::{Expr, LitStr, Token};

/// `price!(0.53)`, `qty!(5)`, `usdc!(-1.25)`: the literal's source text is
/// parsed at compile time into micros (30 §6); more than 6 decimals or an
/// out-of-range value fails compilation. Expands to a const-evaluable
/// `from_micros` call.
pub(crate) fn fixed(input: TokenStream, kind: FixedKind) -> syn::Result<TokenStream> {
    let mac = kind.name().to_ascii_lowercase();
    let lit: NumLit = syn::parse2(input).map_err(|e| {
        syn::Error::new(
            e.span(),
            format!("{mac}! takes one decimal literal, for example {mac}!(0.53) ({e})"),
        )
    })?;
    let micros = lit.fixed_micros(kind)?;
    Ok(kind.ctor(micros))
}

/// `cid!("entry")`: a client order id checked at compile time, 1–256 bytes
/// of printable ASCII (10 §6, 30 §6).
pub(crate) fn cid(input: TokenStream) -> syn::Result<TokenStream> {
    let s: LitStr = syn::parse2(input).map_err(|e| {
        syn::Error::new(
            e.span(),
            format!("cid! takes one string literal, for example cid!(\"entry\") ({e})"),
        )
    })?;
    let v = s.value();
    if v.is_empty() {
        return Err(syn::Error::new(
            s.span(),
            "client order id is empty: cid! needs 1 to 256 bytes of printable ASCII (10 §6)",
        ));
    }
    if v.len() > 256 {
        return Err(syn::Error::new(
            s.span(),
            format!(
                "client order id is {} bytes long: cid! accepts at most 256 bytes (10 §6)",
                v.len()
            ),
        ));
    }
    if let Some((i, c)) = v.char_indices().find(|(_, c)| !(' '..='~').contains(c)) {
        return Err(syn::Error::new(
            s.span(),
            format!(
                "client order id has {c:?} at byte {i}: cid! accepts printable ASCII only \
                 (0x20..=0x7e, 10 §6)"
            ),
        ));
    }
    Ok(quote!(::pmb_sdk::__private::cid_from_literal(#s)))
}

struct MetaEntry {
    key: LitStr,
    value: Expr,
}

impl Parse for MetaEntry {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let key: LitStr = input.parse().map_err(|e| {
            syn::Error::new(
                e.span(),
                "meta! keys are string literals: meta! { \"edge\" => 0.031, \"leg\" => \"entry\" }",
            )
        })?;
        input.parse::<Token![=>]>()?;
        let value: Expr = input.parse()?;
        Ok(MetaEntry { key, value })
    }
}

/// `meta! { "edge" => 0.031, "leg" => "entry", "n" => 3 }` builds a `Meta` of
/// scalar values (30 §7.2). Keys are string literals and must be unique,
/// checked at compile time.
pub(crate) fn meta(input: TokenStream) -> syn::Result<TokenStream> {
    let entries = Punctuated::<MetaEntry, Token![,]>::parse_terminated.parse2(input)?;
    let mut seen: Vec<String> = Vec::with_capacity(entries.len());
    for e in &entries {
        let k = e.key.value();
        if seen.contains(&k) {
            return Err(syn::Error::new(
                e.key.span(),
                format!("meta! key {k:?} is given twice; keys of one meta object must be unique"),
            ));
        }
        seen.push(k);
    }
    if entries.is_empty() {
        return Ok(quote!(::pmb_sdk::__private::Meta::new()));
    }
    let n = entries.len();
    let pushes = entries.iter().map(|e| {
        let k = &e.key;
        let v = &e.value;
        quote!(__pmb_meta.__push_literal(#k, ::pmb_sdk::__private::MetaValue::from(#v));)
    });
    Ok(quote!({
        let mut __pmb_meta = ::pmb_sdk::__private::Meta::with_capacity(#n);
        #(#pushes)*
        __pmb_meta
    }))
}
