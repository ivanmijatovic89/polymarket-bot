//! The params input tree. JSON numbers keep their exact source text so
//! fixed-point params are parsed from decimal text, never through `f64`
//! (30 §9 table, 10 §2 T6, 00 R2).

use super::{ParamError, ParamErrorKind};
use serde::de::{Deserialize, Deserializer, MapAccess, Visitor};
use serde_json::value::RawValue;
use std::fmt;

/// One params value: typed JSON, or a CLI string (`Input::String`), which
/// each field type parses with its own rule (30 §9 table).
#[derive(Clone, Debug, PartialEq)]
pub enum Input {
    Null,
    Bool(bool),
    /// The exact JSON number text (`0.53`, `1e-7`, `20.0`).
    Number(Box<str>),
    String(String),
    Array(Vec<Input>),
    /// Entries in input order; duplicates are kept and reported by the
    /// struct parser.
    Object(Vec<(String, Input)>),
}

/// Object entries with their raw values, duplicates kept.
struct Entries(Vec<(String, Box<RawValue>)>);

impl<'de> Deserialize<'de> for Entries {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Entries;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a JSON object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Entries, A::Error> {
                let mut out = Vec::new();
                while let Some(k) = m.next_key::<String>()? {
                    let v: Box<RawValue> = m.next_value()?;
                    out.push((k, v));
                }
                Ok(Entries(out))
            }
        }
        d.deserialize_map(V)
    }
}

impl Input {
    /// Parses JSON text, keeping number text exact.
    pub fn from_json_text(text: &str) -> Result<Input, serde_json::Error> {
        let raw: Box<RawValue> = serde_json::from_str(text)?;
        Input::from_raw(&raw)
    }

    fn from_raw(raw: &RawValue) -> Result<Input, serde_json::Error> {
        let t = raw.get().trim();
        Ok(match t.as_bytes().first() {
            Some(b'{') => {
                let Entries(es) = serde_json::from_str(t)?;
                let mut out = Vec::with_capacity(es.len());
                for (k, v) in es {
                    out.push((k, Input::from_raw(&v)?));
                }
                Input::Object(out)
            }
            Some(b'[') => {
                let items: Vec<Box<RawValue>> = serde_json::from_str(t)?;
                let mut out = Vec::with_capacity(items.len());
                for v in &items {
                    out.push(Input::from_raw(v)?);
                }
                Input::Array(out)
            }
            Some(b'"') => Input::String(serde_json::from_str(t)?),
            Some(b't') => Input::Bool(true),
            Some(b'f') => Input::Bool(false),
            Some(b'n') => Input::Null,
            // serde_json validated the token: a JSON number.
            _ => Input::Number(t.into()),
        })
    }

    /// An object of CLI strings from `key=value` arguments (split at the
    /// first `=`), and a `Syntax` issue for every argument that is not
    /// `key=value` (reported together with the object's issues, 30 §9
    /// rule 3).
    pub fn from_cli<'a, I>(args: I) -> (Input, ParamError)
    where
        I: IntoIterator<Item = &'a str>,
    {
        let mut errs = ParamError::default();
        let mut out = Vec::new();
        for arg in args {
            match arg.split_once('=') {
                Some((k, v)) if !k.is_empty() => {
                    out.push((k.to_owned(), Input::String(v.to_owned())))
                }
                _ => errs.push_kind(
                    String::new(),
                    ParamErrorKind::Syntax,
                    format!(
                        "--param {} is not key=value; write it as --param key=value",
                        quoted(arg)
                    ),
                ),
            }
        }
        (Input::Object(out), errs)
    }

    /// A short description of the value for messages (`"abc"`, `0.5`,
    /// `an array`).
    pub fn describe(&self) -> String {
        match self {
            Input::Null => "null".into(),
            Input::Bool(b) => b.to_string(),
            Input::Number(n) => truncate(n),
            Input::String(s) => quoted(s),
            Input::Array(_) => "an array".into(),
            Input::Object(_) => "an object".into(),
        }
    }
}

/// JSON-quoted text, cut at 64 characters.
pub(crate) fn quoted(s: &str) -> String {
    let mut out = String::new();
    super::text::write_json_str(&mut out, &truncate(s));
    out
}

fn truncate(s: &str) -> String {
    const MAX: usize = 64;
    match s.char_indices().nth(MAX) {
        Some((i, _)) => format!("{}...", &s[..i]),
        None => s.to_owned(),
    }
}
