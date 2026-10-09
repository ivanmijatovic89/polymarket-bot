//! `#[derive(ParamEnum)]` (30 §9): a unit-only enum whose params value is
//! the variant name (`#[param(rename = "..")]` overrides it).

use crate::attrs::doc_string;
use proc_macro2::TokenStream;
use quote::quote;
use syn::spanned::Spanned;
use syn::{Data, DeriveInput, Fields, LitStr};

pub(crate) fn derive(input: DeriveInput) -> syn::Result<TokenStream> {
    let name = &input.ident;
    if !input.generics.params.is_empty() || input.generics.where_clause.is_some() {
        return Err(syn::Error::new(
            input.generics.span(),
            "#[derive(ParamEnum)] does not support generic parameters",
        ));
    }
    for attr in &input.attrs {
        if attr.path().is_ident("param") {
            return Err(syn::Error::new(
                attr.span(),
                "#[derive(ParamEnum)] has no enum-level #[param] options; rename variants with \
                 #[param(rename = \"...\")] on the variant",
            ));
        }
    }
    let Data::Enum(data) = &input.data else {
        return Err(syn::Error::new(
            name.span(),
            "#[derive(ParamEnum)] works on enums with unit variants only",
        ));
    };
    if data.variants.is_empty() {
        return Err(syn::Error::new(
            name.span(),
            "#[derive(ParamEnum)] needs at least one variant",
        ));
    }
    let mut idents = Vec::new();
    let mut names: Vec<String> = Vec::new();
    for v in &data.variants {
        if !matches!(v.fields, Fields::Unit) {
            return Err(syn::Error::new(
                v.fields.span(),
                "#[derive(ParamEnum)] variants carry no data: a params enum value is one name",
            ));
        }
        let mut rename: Option<LitStr> = None;
        for attr in &v.attrs {
            if !attr.path().is_ident("param") {
                continue;
            }
            attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("rename") {
                    rename = Some(meta.value()?.parse()?);
                    Ok(())
                } else {
                    Err(meta.error("unknown #[param] option; the only variant option is rename"))
                }
            })?;
        }
        let n = match &rename {
            Some(s) if s.value().is_empty() => {
                return Err(syn::Error::new(
                    s.span(),
                    "a variant name must be non-empty",
                ))
            }
            Some(s) => s.value(),
            None => v.ident.to_string(),
        };
        if names.contains(&n) {
            return Err(syn::Error::new(
                v.span(),
                format!("variant name {n:?} is used twice; rename one variant"),
            ));
        }
        names.push(n);
        idents.push(v.ident.clone());
    }
    let doc = doc_string(&input.attrs);
    let p = quote!(::pmb_sdk::__private);
    Ok(quote! {
        const _: () = {
            impl ::pmb_sdk::ParamEnum for #name {
                const VARIANTS: &'static [&'static str] = &[#(#names),*];
                fn name(&self) -> &'static str {
                    match self {
                        #(Self::#idents => #names,)*
                    }
                }
                fn from_name(__pmb_name: &str) -> ::core::option::Option<Self> {
                    match __pmb_name {
                        #(#names => ::core::option::Option::Some(Self::#idents),)*
                        _ => ::core::option::Option::None,
                    }
                }
            }

            impl #p::ParamValue for #name {
                fn parse(
                    __pmb_in: &#p::Input,
                    __pmb_path: &str,
                    __pmb_errs: &mut ::pmb_sdk::ParamError,
                ) -> ::core::option::Option<Self> {
                    #p::parse_enum::<Self>(__pmb_in, __pmb_path, __pmb_errs)
                }
                fn write_normalized(&self, __pmb_out: &mut ::std::string::String) {
                    #p::write_json_str(__pmb_out, ::pmb_sdk::ParamEnum::name(self))
                }
                fn schema() -> #p::Value {
                    #p::enum_schema::<Self>(#doc)
                }
                fn expected() -> ::std::string::String {
                    #p::enum_expected::<Self>()
                }
            }
        };
    })
}
