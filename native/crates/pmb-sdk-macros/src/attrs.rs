//! Helpers shared by the derives: doc comments, key naming, field type
//! classification (30 §9).

use crate::literal::FixedKind;
use syn::{Attribute, Expr, ExprLit, GenericArgument, Lit, Meta, PathArguments, Type};

/// Doc comment text of an item (`///` lines joined by `\n`, trimmed). The
/// JSON Schema uses it as `description` (30 §9 rule 8).
pub(crate) fn doc_string(attrs: &[Attribute]) -> String {
    let mut lines = Vec::new();
    for attr in attrs {
        if !attr.path().is_ident("doc") {
            continue;
        }
        if let Meta::NameValue(nv) = &attr.meta {
            if let Expr::Lit(ExprLit {
                lit: Lit::Str(s), ..
            }) = &nv.value
            {
                let v = s.value();
                for line in v.lines() {
                    lines.push(line.strip_prefix(' ').unwrap_or(line).trim_end().to_owned());
                }
            }
        }
    }
    lines.join("\n").trim().to_owned()
}

/// `max_price` → `maxPrice` (30 §9 rule 4). A raw identifier prefix is
/// dropped (`r#type` → `type`).
pub(crate) fn camel_case(ident: &str) -> String {
    let ident = ident.strip_prefix("r#").unwrap_or(ident);
    let mut out = String::with_capacity(ident.len());
    for (i, part) in ident.split('_').filter(|p| !p.is_empty()).enumerate() {
        if i == 0 {
            out.push_str(part);
        } else {
            let mut cs = part.chars();
            if let Some(c) = cs.next() {
                out.extend(c.to_uppercase());
                out.push_str(cs.as_str());
            }
        }
    }
    out
}

/// What the derive knows about a field type from its spelling. The runtime
/// behavior always comes from the `ParamValue` impl of the real type; the
/// kind only decides how literals in `default`/`min`/`max` are compiled.
#[derive(Clone)]
pub(crate) enum Kind {
    Bool,
    Int,
    Float,
    Fixed(FixedKind),
    Dur,
    Str,
    /// `Option<T>` with the inner kind and type.
    Opt(Box<Kind>, Box<Type>),
    Vec,
    /// A `#[derive(ParamEnum)]` enum, a nested `#[derive(Params)]` struct, or
    /// a type alias the derive cannot see through.
    Other,
}

impl Kind {
    pub(crate) fn of(ty: &Type) -> Kind {
        let Type::Path(tp) = ty else {
            return Kind::Other;
        };
        if tp.qself.is_some() {
            return Kind::Other;
        }
        let Some(seg) = tp.path.segments.last() else {
            return Kind::Other;
        };
        let name = seg.ident.to_string();
        let single_arg = || -> Option<&Type> {
            let PathArguments::AngleBracketed(a) = &seg.arguments else {
                return None;
            };
            if a.args.len() != 1 {
                return None;
            }
            match a.args.first() {
                Some(GenericArgument::Type(t)) => Some(t),
                _ => None,
            }
        };
        match name.as_str() {
            "bool" => Kind::Bool,
            "i8" | "i16" | "i32" | "i64" | "isize" | "u8" | "u16" | "u32" | "u64" | "usize" => {
                Kind::Int
            }
            "f64" => Kind::Float,
            "DurMs" => Kind::Dur,
            "String" => Kind::Str,
            "Option" => match single_arg() {
                Some(inner) => Kind::Opt(Box::new(Kind::of(inner)), Box::new(inner.clone())),
                None => Kind::Other,
            },
            "Vec" => Kind::Vec,
            other => match FixedKind::from_ident(other) {
                Some(k) => Kind::Fixed(k),
                None => Kind::Other,
            },
        }
    }

    /// The kind bounds apply to: the field itself, or the inner type of an
    /// `Option` (bounds are checked when the value is present).
    pub(crate) fn scalar(&self) -> &Kind {
        match self {
            Kind::Opt(inner, _) => inner,
            k => k,
        }
    }

    pub(crate) fn is_numeric(&self) -> bool {
        matches!(self, Kind::Int | Kind::Float | Kind::Fixed(_) | Kind::Dur)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 30 §9 rule 4
    #[test]
    fn camel_case_keys() {
        assert_eq!(camel_case("max_price"), "maxPrice");
        assert_eq!(camel_case("size"), "size");
        assert_eq!(camel_case("stake_min_usd"), "stakeMinUsd");
        assert_eq!(camel_case("r#type"), "type");
        assert_eq!(camel_case("ema_2x"), "ema2x");
    }
}
