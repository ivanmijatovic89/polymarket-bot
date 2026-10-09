//! `#[derive(Params)]` (30 §9).
//!
//! The derive emits three impls that target `::pmb_sdk::__private`:
//! `ParamsFields` (parsing, normalization and schema of the fields),
//! `ParamValue` (so the struct can be nested or flattened) and, unless the
//! container says `#[param(validate)]`, an empty `impl Params` that keeps
//! the default `validate`.

use crate::attrs::{camel_case, doc_string, Kind};
use crate::literal::{
    f64_tokens, format_f64, format_micros, significant_digits, FixedKind, NumLit, MAX_SIG_DIGITS,
    SAFE_INT,
};
use proc_macro2::{Span, TokenStream};
use quote::{format_ident, quote};
use syn::spanned::Spanned;
use syn::{Data, DeriveInput, Expr, ExprLit, Field, Fields, Ident, Lit, LitStr, Token, Type};

// D-PENDING: 30 §9 rule 2 names only min/max; chose to add exclusive_min and
// exclusive_max (JSON Schema exclusiveMinimum/exclusiveMaximum) because TS
// ports use Zod `.positive()` (lagsnipe.v15 sigma, stakeUsd, ...).
const FIELD_OPTIONS: &str = "default, min, max, exclusive_min, exclusive_max, rename, flatten";

#[derive(Copy, Clone, PartialEq, Eq)]
enum BoundOp {
    Min,
    Max,
    ExclusiveMin,
    ExclusiveMax,
}

impl BoundOp {
    fn attr(self) -> &'static str {
        match self {
            BoundOp::Min => "min",
            BoundOp::Max => "max",
            BoundOp::ExclusiveMin => "exclusive_min",
            BoundOp::ExclusiveMax => "exclusive_max",
        }
    }
    fn schema_key(self) -> &'static str {
        match self {
            BoundOp::Min => "minimum",
            BoundOp::Max => "maximum",
            BoundOp::ExclusiveMin => "exclusiveMinimum",
            BoundOp::ExclusiveMax => "exclusiveMaximum",
        }
    }
    fn variant(self) -> Ident {
        format_ident!(
            "{}",
            match self {
                BoundOp::Min => "Min",
                BoundOp::Max => "Max",
                BoundOp::ExclusiveMin => "ExclusiveMin",
                BoundOp::ExclusiveMax => "ExclusiveMax",
            }
        )
    }
    fn is_lower(self) -> bool {
        matches!(self, BoundOp::Min | BoundOp::ExclusiveMin)
    }
}

/// A compile-time number, for checking literal defaults against literal
/// bounds. Fixed-point values are micros.
#[derive(Copy, Clone, PartialEq, PartialOrd)]
enum Num {
    I(i128),
    F(f64),
}

impl Num {
    fn cmp_ok(self, op: BoundOp, bound: Num) -> bool {
        match op {
            BoundOp::Min => self >= bound,
            BoundOp::Max => self <= bound,
            BoundOp::ExclusiveMin => self > bound,
            BoundOp::ExclusiveMax => self < bound,
        }
    }
}

struct Bound {
    op: BoundOp,
    /// Typed tokens of the bound value (the scalar type of the field).
    tokens: TokenStream,
    /// Normalized text, for messages and the schema.
    text: String,
    num: Num,
    span: Span,
}

enum DefaultSpec {
    /// `#[param(default)]`: `Default::default()`.
    Bare(Span),
    Expr(Expr),
}

/// A default compiled to typed tokens.
struct CompiledDefault {
    tokens: TokenStream,
    /// The compile-time value of a numeric literal default.
    num: Option<Num>,
    /// The variant name of a `#[derive(ParamEnum)]` default.
    enum_name: Option<LitStr>,
}

impl CompiledDefault {
    fn new(tokens: TokenStream, num: Option<Num>) -> Self {
        CompiledDefault {
            tokens,
            num,
            enum_name: None,
        }
    }
}

struct FieldSpec {
    ident: Ident,
    ty: Type,
    key: String,
    key_span: Span,
    doc: String,
    flatten: bool,
    default: Option<CompiledDefault>,
    bounds: Vec<Bound>,
}

pub(crate) fn derive(input: DeriveInput) -> syn::Result<TokenStream> {
    let name = &input.ident;
    if !input.generics.params.is_empty() || input.generics.where_clause.is_some() {
        return Err(syn::Error::new(
            input.generics.span(),
            "#[derive(Params)] does not support generic parameters or where clauses: \
             params are plain data (30-strategy-sdk.md §1 P3)",
        ));
    }
    let (fields, is_unit): (Vec<&Field>, bool) = match &input.data {
        Data::Struct(s) => match &s.fields {
            Fields::Named(n) => (n.named.iter().collect(), false),
            Fields::Unit => (Vec::new(), true),
            Fields::Unnamed(u) => {
                return Err(syn::Error::new(
                    u.span(),
                    "#[derive(Params)] needs named fields: each field is one --param key",
                ))
            }
        },
        _ => {
            return Err(syn::Error::new(
                name.span(),
                "#[derive(Params)] works on structs; use #[derive(ParamEnum)] for an enum \
                 of named choices",
            ))
        }
    };
    let custom_validate = parse_container(&input)?;
    let doc = doc_string(&input.attrs);

    let mut specs = Vec::with_capacity(fields.len());
    for f in fields {
        specs.push(parse_field(f)?);
    }
    for (i, a) in specs.iter().enumerate() {
        if a.flatten {
            continue;
        }
        if let Some(b) = specs[..i].iter().find(|b| !b.flatten && b.key == a.key) {
            return Err(syn::Error::new(
                a.key_span,
                format!(
                    "params key {:?} is used by fields `{}` and `{}`; give one of them \
                     another name with #[param(rename = \"...\")] (30 §9 rule 5)",
                    a.key, b.ident, a.ident
                ),
            ));
        }
    }

    let p = quote!(::pmb_sdk::__private);
    let name_str = name.to_string();

    let mut parse_stmts = Vec::new();
    let mut ctor_fields = Vec::new();
    let mut write_stmts = Vec::new();
    let mut schema_stmts = Vec::new();
    let mut own_keys = Vec::new();
    let mut collision_msgs = Vec::new();
    let mut flattened = Vec::new();

    for (i, f) in specs.iter().enumerate() {
        let var = format_ident!("__pmb_f{}", i);
        let ident = &f.ident;
        let ty = &f.ty;
        ctor_fields.push(quote!(#ident: #var?));
        if f.flatten {
            parse_stmts.push(quote! {
                let #var: ::core::option::Option<#ty> =
                    <#ty as #p::ParamsFields>::__parse_fields(__pmb_obj, __pmb_path, __pmb_used, __pmb_errs);
                if let ::core::option::Option::Some(__pmb_v) = &#var {
                    #p::merge_validate(__pmb_v, __pmb_path, __pmb_errs);
                }
            });
            write_stmts.push(quote! {
                <#ty as #p::ParamsFields>::__write_fields(&self.#ident, __pmb_out);
            });
            schema_stmts.push(quote! {
                <#ty as #p::ParamsFields>::__schema_fields(__pmb_props, __pmb_required, __pmb_defs);
            });
            flattened.push(quote!(&<#ty as #p::ParamsFields>::KEY_TREE));
            continue;
        }
        let key = &f.key;
        own_keys.push(key.clone());
        collision_msgs.push(format!(
            "params key {key:?} of `{name_str}` is also defined by a struct flattened into the \
             same params object; give one of them another name with #[param(rename = \"...\")] \
             (30 §9 rule 5)"
        ));
        let default_arg = match &f.default {
            Some(d) => {
                let t = &d.tokens;
                quote!(::core::option::Option::Some(|| -> #ty { #t }))
            }
            None => quote!(::core::option::Option::None::<fn() -> #ty>),
        };
        parse_stmts.push(quote! {
            let #var: ::core::option::Option<#ty> =
                #p::field::<#ty, _>(__pmb_obj, __pmb_path, #key, __pmb_used, __pmb_errs, #default_arg);
        });
        for b in &f.bounds {
            let op = b.op.variant();
            let bt = &b.tokens;
            let text = &b.text;
            parse_stmts.push(quote! {
                if let ::core::option::Option::Some(__pmb_v) = &#var {
                    #p::check_bound::<#ty>(__pmb_v, &#bt, #p::BoundOp::#op, #text, __pmb_path, #key, __pmb_errs);
                }
            });
        }
        write_stmts.push(quote! {
            #p::write_field::<#ty>(&self.#ident, #key, __pmb_out);
        });
        let bound_pairs = f.bounds.iter().map(|b| {
            let k = b.op.schema_key();
            let t = &b.text;
            quote!((#k, #t))
        });
        let doc = &f.doc;
        let default_stmt = f.default.as_ref().map(|d| {
            let t = &d.tokens;
            quote!(#p::schema_default::<#ty>(&mut __pmb_s, &(#t));)
        });
        let has_default = f.default.is_some();
        schema_stmts.push(quote! {
            {
                let mut __pmb_s = <#ty as #p::ParamValue>::schema_bounded(&[#(#bound_pairs),*], __pmb_defs);
                #p::schema_describe(&mut __pmb_s, #doc);
                #default_stmt
                __pmb_props.push((#key, __pmb_s));
                if !#has_default && !<#ty as #p::ParamValue>::OPTIONAL {
                    __pmb_required.push(#key);
                }
            }
        });
    }

    let construct = if is_unit {
        quote!(::core::option::Option::Some(Self))
    } else {
        quote!(::core::option::Option::Some(Self { #(#ctor_fields),* }))
    };

    let params_impl = if custom_validate {
        quote!()
    } else {
        quote!(impl ::pmb_sdk::Params for #name {})
    };

    let collision_check = if flattened.is_empty() {
        quote!()
    } else {
        quote! {
            const _: () = if let ::core::option::Option::Some(__pmb_m) =
                #p::key_collision(&<#name as #p::ParamsFields>::KEY_TREE)
            {
                ::core::panic!("{}", __pmb_m)
            };
        }
    };

    let enum_checks = specs.iter().filter_map(enum_default_check);
    let option_checks = specs.iter().filter_map(option_default_check);

    Ok(quote! {
        const _: () = {
            impl #p::ParamsFields for #name {
                const KEY_TREE: #p::KeyTree = #p::KeyTree {
                    own: &[#(#own_keys),*],
                    collisions: &[#(#collision_msgs),*],
                    flattened: &[#(#flattened),*],
                };
                const NAME: &'static str = #name_str;
                const DOC: &'static str = #doc;

                fn __parse_fields(
                    __pmb_obj: &[(::std::string::String, #p::Input)],
                    __pmb_path: &str,
                    __pmb_used: &mut [bool],
                    __pmb_errs: &mut ::pmb_sdk::ParamError,
                ) -> ::core::option::Option<Self> {
                    #(#parse_stmts)*
                    #construct
                }

                fn __write_fields(
                    &self,
                    __pmb_out: &mut ::std::vec::Vec<(&'static str, ::std::string::String)>,
                ) {
                    #(#write_stmts)*
                }

                fn __schema_fields(
                    __pmb_props: &mut ::std::vec::Vec<(&'static str, #p::Value)>,
                    __pmb_required: &mut ::std::vec::Vec<&'static str>,
                    __pmb_defs: &mut #p::SchemaDefs,
                ) {
                    #(#schema_stmts)*
                }

                fn __validate(&self) -> ::core::result::Result<(), ::pmb_sdk::ParamError> {
                    <Self as ::pmb_sdk::Params>::validate(self)
                }
            }

            #params_impl

            // The runtime's params seam (30 §9, 20 §5.1), so the type can be
            // `Strategy::Params` of a binary (`strategy_main!`).
            impl #p::StrategyParams for #name {
                fn from_json(
                    __pmb_obj: &#p::JsonMap,
                ) -> ::core::result::Result<Self, ::std::vec::Vec<#p::RuntimeParamError>> {
                    #p::runtime_from_json::<Self>(__pmb_obj)
                }
                fn to_normalized(&self) -> #p::JsonMap {
                    #p::runtime_normalized(self)
                }
                fn json_schema() -> #p::Value {
                    <Self as ::pmb_sdk::Params>::params_schema()
                }
            }

            impl #p::ParamValue for #name {
                fn parse(
                    __pmb_in: &#p::Input,
                    __pmb_path: &str,
                    __pmb_errs: &mut ::pmb_sdk::ParamError,
                ) -> ::core::option::Option<Self> {
                    #p::parse_struct::<Self>(__pmb_in, __pmb_path, __pmb_errs)
                }
                fn write_normalized(&self, __pmb_out: &mut ::std::string::String) {
                    #p::write_struct(self, __pmb_out)
                }
                fn schema(__pmb_defs: &mut #p::SchemaDefs) -> #p::Value {
                    #p::struct_schema::<Self>(__pmb_defs)
                }
                fn expected() -> ::std::string::String {
                    #p::struct_expected::<Self>()
                }
            }
        };
        #collision_check
        #(#enum_checks)*
        #(#option_checks)*
    })
}

/// Container options: `#[param(validate)]` only.
// D-PENDING: 30 §9 rule 2 makes `validate` a trait method with a default,
// but the derive implements the trait; chose a container opt-in
// `#[param(validate)]` that leaves `impl Params` (with `validate`) to the
// author.
fn parse_container(input: &DeriveInput) -> syn::Result<bool> {
    let mut validate = false;
    for attr in &input.attrs {
        if !attr.path().is_ident("param") {
            continue;
        }
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("validate") {
                validate = true;
                Ok(())
            } else {
                Err(meta.error(
                    "unknown #[param] option on a params struct; the only struct option is \
                     `validate` (then write `impl Params for .. { fn validate(&self) .. }`)",
                ))
            }
        })?;
    }
    Ok(validate)
}

fn parse_field(f: &Field) -> syn::Result<FieldSpec> {
    let ident = f.ident.clone().expect("named field");
    let ty = f.ty.clone();
    let kind = Kind::of(&ty);
    let mut default: Option<DefaultSpec> = None;
    let mut raw_bounds: Vec<(BoundOp, NumLit)> = Vec::new();
    let mut rename: Option<LitStr> = None;
    let mut flatten: Option<Span> = None;

    for attr in &f.attrs {
        if !attr.path().is_ident("param") {
            continue;
        }
        attr.parse_nested_meta(|meta| {
            let path = &meta.path;
            let dup = |what: &str| meta.error(format!("#[param({what})] is given twice"));
            if path.is_ident("default") {
                if default.is_some() {
                    return Err(dup("default"));
                }
                default = Some(if meta.input.peek(Token![=]) {
                    DefaultSpec::Expr(meta.value()?.parse()?)
                } else {
                    DefaultSpec::Bare(path.span())
                });
                Ok(())
            } else if let Some(op) = [
                BoundOp::Min,
                BoundOp::Max,
                BoundOp::ExclusiveMin,
                BoundOp::ExclusiveMax,
            ]
            .into_iter()
            .find(|op| path.is_ident(op.attr()))
            {
                if raw_bounds.iter().any(|(o, _)| *o == op) {
                    return Err(dup(op.attr()));
                }
                let lit: NumLit = meta.value()?.parse().map_err(|e| {
                    syn::Error::new(
                        e.span(),
                        format!(
                            "{} takes a numeric literal, e.g. {} = 0.01",
                            op.attr(),
                            op.attr()
                        ),
                    )
                })?;
                raw_bounds.push((op, lit));
                Ok(())
            } else if path.is_ident("rename") {
                if rename.is_some() {
                    return Err(dup("rename"));
                }
                rename = Some(meta.value()?.parse()?);
                Ok(())
            } else if path.is_ident("flatten") {
                flatten = Some(path.span());
                Ok(())
            } else {
                Err(meta.error(format!(
                    "unknown #[param] option; valid field options: {FIELD_OPTIONS}"
                )))
            }
        })?;
    }

    let doc = doc_string(&f.attrs);

    if let Some(span) = flatten {
        if default.is_some() || !raw_bounds.is_empty() || rename.is_some() {
            return Err(syn::Error::new(
                span,
                "#[param(flatten)] cannot be combined with default, bounds or rename: the \
                 flattened struct's own field options apply",
            ));
        }
        if !matches!(kind, Kind::Other) {
            return Err(syn::Error::new(
                ty.span(),
                "#[param(flatten)] needs a field whose type is a #[derive(Params)] struct",
            ));
        }
        return Ok(FieldSpec {
            ident,
            ty,
            key: String::new(),
            key_span: span,
            doc,
            flatten: true,
            default: None,
            bounds: Vec::new(),
        });
    }

    let (key, key_span) = match &rename {
        Some(s) => {
            let k = s.value();
            if k.is_empty() || k.contains('=') {
                return Err(syn::Error::new(
                    s.span(),
                    "a params key must be non-empty and must not contain `=` (it is passed as \
                     --param key=value)",
                ));
            }
            (k, s.span())
        }
        None => (camel_case(&ident.to_string()), ident.span()),
    };

    let bounds = compile_bounds(&kind, &ty, raw_bounds)?;
    let default = match default {
        None => None,
        Some(d) => Some(compile_default(&kind, &ty, &ident, d)?),
    };
    if let Some(CompiledDefault { num: Some(dv), .. }) = &default {
        for b in &bounds {
            if !dv.cmp_ok(b.op, b.num) {
                return Err(syn::Error::new(
                    b.span,
                    format!(
                        "the default of `{ident}` violates {} = {} (30 §9 rule 2); change the \
                         default or the bound",
                        b.op.attr(),
                        b.text
                    ),
                ));
            }
        }
    }

    Ok(FieldSpec {
        ident,
        ty,
        key,
        key_span,
        doc,
        flatten: false,
        default,
        bounds,
    })
}

fn compile_bounds(kind: &Kind, ty: &Type, raw: Vec<(BoundOp, NumLit)>) -> syn::Result<Vec<Bound>> {
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    let scalar = kind.scalar();
    if !scalar.is_numeric() {
        return Err(syn::Error::new(
            raw[0].1.span(),
            "min/max/exclusive_min/exclusive_max apply only to numeric fields (integers, f64, \
             Price, Qty, Usdc, Rate, DurMs) or Option of them",
        ));
    }
    let scalar_ty: &Type = match kind {
        Kind::Opt(_, inner) => inner,
        _ => ty,
    };
    let mut out = Vec::with_capacity(raw.len());
    for (op, lit) in raw {
        let span = lit.span();
        let (tokens, text, num) = match scalar {
            Kind::Fixed(k) => {
                let m = params_fixed_micros(&lit, *k)?;
                (k.ctor(m), format_micros(m as i128), Num::I(m as i128))
            }
            Kind::Dur => {
                let v = lit.integer()?;
                let ms = i64::try_from(v)
                    .ok()
                    .filter(|v| (0..=SAFE_INT).contains(v))
                    .ok_or_else(|| {
                        syn::Error::new(
                            span,
                            "a DurMs bound is a non-negative integer number of milliseconds, \
                             at most 9007199254740991 (21 §18 N2)",
                        )
                    })?;
                (
                    quote!(::pmb_sdk::__private::dur_ms(#ms)),
                    ms.to_string(),
                    Num::I(v),
                )
            }
            Kind::Int => {
                let v = params_integer(&lit)?;
                let t = lit.int_tokens();
                (
                    quote!({ let __pmb_b: #scalar_ty = #t; __pmb_b }),
                    v.to_string(),
                    Num::I(v),
                )
            }
            Kind::Float => {
                let v = lit.to_f64()?;
                let t = f64_tokens(v);
                (
                    quote!({ let __pmb_b: #scalar_ty = #t; __pmb_b }),
                    format_f64(v),
                    Num::F(v),
                )
            }
            _ => unreachable!("checked numeric"),
        };
        out.push(Bound {
            op,
            tokens,
            text,
            num,
            span,
        });
    }
    let lower: Vec<&Bound> = out.iter().filter(|b| b.op.is_lower()).collect();
    let upper: Vec<&Bound> = out.iter().filter(|b| !b.op.is_lower()).collect();
    if lower.len() > 1 {
        return Err(syn::Error::new(
            lower[1].span,
            "give either min or exclusive_min, not both",
        ));
    }
    if upper.len() > 1 {
        return Err(syn::Error::new(
            upper[1].span,
            "give either max or exclusive_max, not both",
        ));
    }
    if let (Some(lo), Some(hi)) = (lower.first(), upper.first()) {
        let ok = match (lo.op, hi.op) {
            (BoundOp::Min, BoundOp::Max) => lo.num <= hi.num,
            _ => lo.num < hi.num,
        };
        if !ok {
            return Err(syn::Error::new(
                hi.span,
                format!(
                    "the bounds leave no valid value: {} = {} and {} = {}",
                    lo.op.attr(),
                    lo.text,
                    hi.op.attr(),
                    hi.text
                ),
            ));
        }
    }
    Ok(out)
}

fn compile_default(
    kind: &Kind,
    ty: &Type,
    ident: &Ident,
    d: DefaultSpec,
) -> syn::Result<CompiledDefault> {
    let expr = match d {
        DefaultSpec::Bare(span) => {
            if matches!(kind, Kind::Opt(..)) {
                return Err(option_default_error(span));
            }
            return Ok(CompiledDefault::new(
                quote!(::core::default::Default::default()),
                None,
            ));
        }
        DefaultSpec::Expr(e) => e,
    };
    if matches!(kind, Kind::Opt(..)) {
        return Err(option_default_error(expr.span()));
    }
    let mismatch = |what: &str| {
        syn::Error::new(
            expr.span(),
            format!(
                "the default of `{ident}` must be {what} for a field of type `{}`",
                quote!(#ty)
            ),
        )
    };
    if let Some(n) = NumLit::from_expr(&expr) {
        return match kind {
            Kind::Fixed(k) => {
                let m = params_fixed_micros(&n, *k)?;
                Ok(CompiledDefault::new(k.ctor(m), Some(Num::I(m as i128))))
            }
            Kind::Dur => {
                let v = n.integer()?;
                let ms = i64::try_from(v)
                    .ok()
                    .filter(|v| (0..=SAFE_INT).contains(v))
                    .ok_or_else(|| {
                        syn::Error::new(
                            n.span(),
                            "a DurMs default is a non-negative integer number of milliseconds, \
                             at most 9007199254740991 (21 §18 N2)",
                        )
                    })?;
                Ok(CompiledDefault::new(
                    quote!(::pmb_sdk::__private::dur_ms(#ms)),
                    Some(Num::I(v)),
                ))
            }
            Kind::Int => {
                let v = params_integer(&n)?;
                Ok(CompiledDefault::new(n.int_tokens(), Some(Num::I(v))))
            }
            Kind::Float => {
                let v = n.to_f64()?;
                Ok(CompiledDefault::new(f64_tokens(v), Some(Num::F(v))))
            }
            Kind::Bool => Err(mismatch("`true` or `false`")),
            Kind::Str => Err(mismatch("a string literal")),
            Kind::Vec => Err(mismatch("an expression such as `vec![..]`")),
            Kind::Other | Kind::Opt(..) => Ok(CompiledDefault::new(quote!(#expr), None)),
        };
    }
    if let Expr::Lit(ExprLit { lit, .. }) = &expr {
        match (lit, kind) {
            (Lit::Bool(_), Kind::Bool) => return Ok(CompiledDefault::new(quote!(#expr), None)),
            (Lit::Str(s), Kind::Str) => {
                return Ok(CompiledDefault::new(
                    quote!(::std::string::String::from(#s)),
                    None,
                ))
            }
            (Lit::Str(s), Kind::Other) => {
                // A ParamEnum variant name; checked at compile time by
                // `enum_default_check`.
                return Ok(CompiledDefault {
                    tokens: quote!(::pmb_sdk::__private::enum_default::<#ty>(#s)),
                    num: None,
                    enum_name: Some(s.clone()),
                });
            }
            (_, Kind::Fixed(_) | Kind::Dur | Kind::Int | Kind::Float) => {
                return Err(mismatch("a numeric literal"))
            }
            (_, Kind::Bool) => return Err(mismatch("`true` or `false`")),
            (_, Kind::Str) => return Err(mismatch("a string literal")),
            _ => {}
        }
    }
    Ok(CompiledDefault::new(quote!(#expr), None))
}

/// An integer literal of a params default or bound, within ±(2^53 - 1)
/// like every params integer (21 §18 N2).
fn params_integer(lit: &NumLit) -> syn::Result<i128> {
    let v = lit.integer()?;
    if v.unsigned_abs() > SAFE_INT as u128 {
        return Err(syn::Error::new(
            lit.span(),
            format!(
                "`{}` is beyond ±9007199254740991: params integers stay within ±(2^53 - 1) \
                 because stored params are read back as JSON numbers (21 §18 N2)",
                lit.source()
            ),
        ));
    }
    Ok(v)
}

/// A fixed-point literal of a params default or bound: at most 6 decimals,
/// in range, and at most 15 significant digits (30 §9 rule 6).
fn params_fixed_micros(lit: &NumLit, kind: FixedKind) -> syn::Result<i64> {
    let m = lit.fixed_micros(kind)?;
    if significant_digits(m) > MAX_SIG_DIGITS {
        return Err(syn::Error::new(
            lit.span(),
            format!(
                "`{}` has more than 15 significant digits: a JSON number keeps at most 15 \
                 exactly, so stored params would change (30 §9 rule 6); shorten the literal",
                lit.source()
            ),
        ));
    }
    Ok(m)
}

// D-PENDING: 30 §9 rule 1 gives Option fields the default None and rule 6
// omits None; an explicit Some default would make `null` normalize to absent
// and absent re-parse to Some (not idempotent); chose to reject a default on
// an Option field at compile time.
fn option_default_error(span: Span) -> syn::Error {
    syn::Error::new(
        span,
        "an Option field defaults to None and is omitted from normalized params when None \
         (30 §9 rules 1 and 6); remove the default, or use a non-Option field with a default",
    )
}

/// `const _: () = assert!(..)` that a field with a default is not an
/// `Option` under another spelling (a type alias, a path the derive cannot
/// see through): the syntactic check of `compile_default` catches only
/// `Option<..>` written out (30 §9 rules 1 and 6).
fn option_default_check(f: &FieldSpec) -> Option<TokenStream> {
    f.default.as_ref()?;
    let ty = &f.ty;
    let msg = format!(
        "field `{}` has #[param(default)] but its type is an Option: an Option field defaults \
         to None and is omitted from normalized params when None (30 §9 rules 1 and 6); \
         remove the default, or use a non-Option field with a default",
        f.ident
    );
    Some(quote! {
        const _: () = ::core::assert!(
            !<#ty as ::pmb_sdk::__private::ParamValue>::OPTIONAL,
            #msg
        );
    })
}

/// `const _: () = assert!(..)` that a string default of a ParamEnum field
/// names a variant.
fn enum_default_check(f: &FieldSpec) -> Option<TokenStream> {
    let lit = f.default.as_ref()?.enum_name.as_ref()?;
    let ty = &f.ty;
    let msg = format!(
        "the default {:?} of field `{}` is not a variant name of its #[derive(ParamEnum)] type",
        lit.value(),
        f.ident
    );
    Some(quote! {
        const _: () = ::core::assert!(
            ::pmb_sdk::__private::has_name(<#ty as ::pmb_sdk::ParamEnum>::VARIANTS, #lit),
            #msg
        );
    })
}
