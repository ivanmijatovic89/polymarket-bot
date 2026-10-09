//! Strategy params (30-strategy-sdk.md §9): the [`Params`] and
//! [`ParamEnum`] traits behind `#[derive(Params)]` / `#[derive(ParamEnum)]`,
//! and [`ParamError`].
//!
//! Params arrive either as CLI strings (`--param maxPrice=0.6`, i.e. a JSON
//! object of strings) or as typed JSON (`{"maxPrice":0.6}`, from the DB on
//! `--extend`, candidate files, `describe --params`); both forms, and a mix,
//! go through the same parser (20 §5.1). Parsing uses Rust semantics only,
//! never JS coercions (§9 rule 7, 00 R1). Every error is reported, with a
//! JSON-pointer path, in one [`ParamError`] (§9 rule 3). The normalized form
//! (§9 rule 6) is canonical JSON text: keys sorted bytewise, defaults
//! applied, `None` omitted, exact decimals for fixed-point values.

mod compare;
pub(crate) mod input;
pub(crate) mod support;
pub(crate) mod text;
pub(crate) mod value;

use crate::json;
pub use compare::{normalized_eq, normalized_eq_value};
use input::Input;
use std::fmt;
use support::ParamsFields;

/// A params struct (30 §9). Implemented by `#[derive(Params)]`.
///
/// Cross-field rules go in [`Params::validate`]: put `#[param(validate)]` on
/// the struct and write the impl yourself; the derive then provides
/// everything else:
///
/// ```
/// use pmb_sdk::prelude::*;
///
/// #[derive(Params, Debug)]
/// #[param(validate)]
/// pub struct Band {
///     /// Lowest entry price.
///     #[param(default = 0.10, min = 0.01, max = 0.99)]
///     pub min_price: Price,
///     /// Highest entry price.
///     #[param(default = 0.90, min = 0.01, max = 0.99)]
///     pub max_price: Price,
/// }
///
/// impl Params for Band {
///     fn validate(&self) -> Result<(), ParamError> {
///         if self.min_price > self.max_price {
///             return Err(ParamError::new("minPrice", "minPrice must not exceed maxPrice"));
///         }
///         Ok(())
///     }
/// }
///
/// let b = Band::from_cli(["maxPrice=0.6"]).unwrap();
/// assert_eq!(b.max_price, price!(0.6));
/// assert_eq!(b.normalized_json(), r#"{"maxPrice":0.6,"minPrice":0.1}"#);
/// assert!(Band::from_cli(["minPrice=0.7", "maxPrice=0.6"]).is_err());
/// ```
pub trait Params: ParamsFields {
    /// Cross-field rules (§9 rule 2). Runs after every field parsed; its
    /// paths are relative to this struct's params object.
    fn validate(&self) -> Result<(), ParamError> {
        Ok(())
    }

    /// Parses a JSON object whose values are typed JSON or CLI strings
    /// (20 §5.1). Numbers keep their exact decimal text.
    fn from_json_str(text: &str) -> Result<Self, ParamError> {
        let input = Input::from_json_text(text).map_err(|e| {
            ParamError::single(
                String::new(),
                ParamErrorKind::Syntax,
                format!("params are not valid JSON: {e}"),
            )
        })?;
        Self::from_input(&input)
    }

    /// Parses an already decoded JSON value. `serde_json` holds decimals as
    /// `f64`, so a fixed-point value is exact here only when it has at most
    /// 15 significant digits; [`Params::from_json_str`] is exact for any
    /// text.
    fn from_json_value(value: &json::Value) -> Result<Self, ParamError> {
        Self::from_input(&Input::from_value(value))
    }

    /// Parses `--param` arguments, each `key=value` (split at the first `=`).
    /// Values are CLI strings: JSON text for arrays and nested objects.
    fn from_cli<'a, I>(args: I) -> Result<Self, ParamError>
    where
        I: IntoIterator<Item = &'a str>,
    {
        Self::from_input(&Input::from_cli(args)?)
    }

    #[doc(hidden)]
    fn from_input(input: &Input) -> Result<Self, ParamError> {
        let mut errs = ParamError::default();
        let v = match input {
            Input::Object(entries) => support::parse_object::<Self>(entries, "", &mut errs),
            other => {
                return Err(ParamError::single(
                    String::new(),
                    ParamErrorKind::NotAnObject,
                    format!("expected a JSON object of params, got {}", other.describe()),
                ))
            }
        };
        match v {
            Some(v) if errs.is_empty() => Ok(v),
            _ => Err(errs),
        }
    }

    /// The normalized params (§9 rule 6): a compact JSON object with keys
    /// sorted bytewise, every non-`Option` field present, `None` omitted,
    /// fixed-point values as exact decimals, `f64` as the shortest
    /// round-trip decimal without exponent, `-0` as `0`. Parsing it back
    /// gives the same value (idempotent).
    fn normalized_json(&self) -> String {
        let mut out = String::new();
        support::write_struct(self, &mut out);
        out
    }

    /// The JSON Schema (draft 2020-12) of the normalized params (§9 rule 8,
    /// 20 §5.1 `paramsSchema`): types, defaults, bounds, enum values and doc
    /// comments as descriptions.
    fn params_schema() -> json::Value {
        support::root_schema::<Self>()
    }

    /// Every valid key, sorted (flattened structs included).
    fn keys() -> Vec<&'static str> {
        support::all_keys(&Self::KEY_TREE)
    }
}

/// An enum param whose value is a variant name (30 §9). Implemented by
/// `#[derive(ParamEnum)]`; `#[param(rename = "..")]` on a variant changes
/// its name.
///
/// ```
/// use pmb_sdk::prelude::*;
///
/// #[derive(ParamEnum, Clone, Copy, Debug, PartialEq, Eq)]
/// pub enum Leg {
///     Maker,
///     #[param(rename = "taker")]
///     Taker,
/// }
///
/// assert_eq!(Leg::VARIANTS, &["Maker", "taker"]);
/// assert_eq!(Leg::from_name("taker"), Some(Leg::Taker));
/// assert_eq!(Leg::Maker.name(), "Maker");
/// ```
pub trait ParamEnum: Sized + 'static {
    /// Variant names in declaration order.
    const VARIANTS: &'static [&'static str];
    /// The params name of this variant.
    fn name(&self) -> &'static str;
    /// The variant with this exact name (case-sensitive).
    fn from_name(name: &str) -> Option<Self>;
}

// D-PENDING: 30 §3 lists only Params, ParamEnum and ParamError; chose to
// also expose `pmb_sdk::params::{ParamIssue, ParamErrorKind, normalized_eq,
// normalized_eq_value}` for the per-issue path/message of 20 §5.1 and the
// comparison of §9 rule 10.
/// What a params issue is about (30 §9).
#[non_exhaustive]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum ParamErrorKind {
    /// The params text is not JSON, or a CLI argument is not `key=value`.
    Syntax,
    /// The params are not a JSON object.
    NotAnObject,
    /// A key appears more than once in one object.
    DuplicateKey,
    /// Keys that no field declares (§9 rule 3).
    UnknownKeys,
    /// A required param (no default, not `Option`) is absent (§9 rule 1).
    Missing,
    /// A value of the wrong type or syntax.
    InvalidValue,
    /// A value outside its type range or its `min`/`max` bounds.
    OutOfRange,
    /// A rule of [`Params::validate`].
    Custom,
}

impl ParamErrorKind {
    /// Stable snake_case label.
    pub const fn as_str(self) -> &'static str {
        match self {
            ParamErrorKind::Syntax => "syntax",
            ParamErrorKind::NotAnObject => "not_an_object",
            ParamErrorKind::DuplicateKey => "duplicate_key",
            ParamErrorKind::UnknownKeys => "unknown_keys",
            ParamErrorKind::Missing => "missing",
            ParamErrorKind::InvalidValue => "invalid_value",
            ParamErrorKind::OutOfRange => "out_of_range",
            ParamErrorKind::Custom => "custom",
        }
    }
}

/// One params problem: a JSON-pointer path (`""` is the params object
/// itself, `/maxPrice` a key, `/ids/0` an array item), its kind and a
/// message that names the rule and the fix (30 §17).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParamIssue {
    path: String,
    kind: ParamErrorKind,
    message: String,
}

impl ParamIssue {
    /// JSON pointer (RFC 6901) of the offending value.
    pub fn path(&self) -> &str {
        &self.path
    }
    pub fn kind(&self) -> ParamErrorKind {
        self.kind
    }
    pub fn message(&self) -> &str {
        &self.message
    }
}

/// Every problem of one params input, reported together (30 §9 rule 3,
/// 20 §5.1 `errors: [{path, message}]`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ParamError {
    issues: Vec<ParamIssue>,
}

impl ParamError {
    /// A cross-field rule failure for [`Params::validate`]. `field` is a
    /// params key (`"maxPrice"`) or a JSON pointer relative to the struct's
    /// object (`"/maxPrice"`, `""` for the whole object).
    pub fn new(field: &str, message: impl Into<String>) -> Self {
        let mut e = ParamError::default();
        e.push(field, message);
        e
    }

    /// Adds another cross-field issue (see [`ParamError::new`]).
    pub fn push(&mut self, field: &str, message: impl Into<String>) -> &mut Self {
        let path = if field.is_empty() || field.starts_with('/') {
            field.to_owned()
        } else {
            support::child_path("", field)
        };
        self.push_kind(path, ParamErrorKind::Custom, message.into());
        self
    }

    pub fn issues(&self) -> &[ParamIssue] {
        &self.issues
    }

    pub fn is_empty(&self) -> bool {
        self.issues.is_empty()
    }

    pub fn len(&self) -> usize {
        self.issues.len()
    }

    /// `[{"path": .., "message": ..}, ..]`, the `errors` array of a failed
    /// `describe` result (20 §5.1).
    pub fn to_json(&self) -> json::Value {
        json::Value::Array(
            self.issues
                .iter()
                .map(|i| {
                    let mut m = serde_json::Map::new();
                    m.insert("path".into(), json::Value::String(i.path.clone()));
                    m.insert("message".into(), json::Value::String(i.message.clone()));
                    json::Value::Object(m)
                })
                .collect(),
        )
    }

    pub(crate) fn single(path: String, kind: ParamErrorKind, message: String) -> Self {
        let mut e = ParamError::default();
        e.push_kind(path, kind, message);
        e
    }

    pub(crate) fn push_kind(&mut self, path: String, kind: ParamErrorKind, message: String) {
        self.issues.push(ParamIssue {
            path,
            kind,
            message,
        });
    }

    /// Appends `other`, whose paths are relative to the object at `prefix`.
    pub(crate) fn extend_prefixed(&mut self, prefix: &str, other: ParamError) {
        for mut i in other.issues {
            if !prefix.is_empty() {
                i.path = format!("{prefix}{}", i.path);
            }
            self.issues.push(i);
        }
    }
}

impl fmt::Display for ParamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (n, i) in self.issues.iter().enumerate() {
            if n > 0 {
                f.write_str("; ")?;
            }
            let path = if i.path.is_empty() { "params" } else { &i.path };
            write!(f, "{path}: {}", i.message)?;
        }
        Ok(())
    }
}

impl std::error::Error for ParamError {}
