//! Intent meta (30 §7.2, 10 §7.5): a flat JSON object of scalar values that
//! the engine serializes once at placement and never parses again.

use crate::json;
use crate::params::text::{write_f64, write_json_str};
use pmb_core::fixed::format_micros;
use pmb_core::{DurMs, Price, Qty, Rate, TsMs, Usdc};
use std::borrow::Cow;
use std::fmt::Write;

/// One meta value. Built through `From`: `bool`, integers, `f64`, strings,
/// the fixed-point types (an exact decimal number), `TsMs`/`DurMs`
/// (integer ms), `Option<T>` (`None` is `null`) and `json::Value` (the
/// escape hatch for nested values).
///
/// An integer beyond ±(2^53 - 1) becomes [`MetaValue::Float`], the nearest
/// `f64`: no integer in a payload exceeds ±(2^53 - 1) (21 §18 N2), and a
/// JSON reader (TS `intentMeta`) holds the value as that `f64` anyway.
///
/// ```
/// use pmb_sdk::MetaValue;
///
/// assert_eq!(MetaValue::from(3_u64), MetaValue::Int(3));
/// assert_eq!(MetaValue::from(i64::MAX), MetaValue::Float(9223372036854775807.0));
/// ```
// D-PENDING: 30 §7.2 lists bool, i64, f64 and string scalars; chose to also
// accept Price/Qty/Usdc/Rate (exact decimal numbers, no lossy f64 detour),
// TsMs/DurMs (integers), Option<T> (null), and to turn integers beyond
// ±(2^53 - 1) into the nearest f64 (21 §18 N2) instead of failing.
#[non_exhaustive]
#[derive(Clone, Debug, PartialEq)]
pub enum MetaValue {
    Null,
    Bool(bool),
    Int(i64),
    /// Non-finite values serialize as `null` (21 §16).
    Float(f64),
    /// Micros of a fixed-point value, serialized as an exact decimal.
    Decimal(i64),
    Str(Cow<'static, str>),
    Json(json::Value),
}

impl From<bool> for MetaValue {
    fn from(v: bool) -> Self {
        MetaValue::Bool(v)
    }
}

/// Largest integer magnitude in any payload, `2^53 - 1` (21 §18 N2).
const SAFE_INT: i128 = (1 << 53) - 1;

impl MetaValue {
    /// `Int` within ±(2^53 - 1), else the nearest `f64` (21 §18 N2).
    fn int(v: i128) -> MetaValue {
        if (-SAFE_INT..=SAFE_INT).contains(&v) {
            // In range of i64 by the check above.
            MetaValue::Int(v as i64)
        } else {
            MetaValue::Float(v as f64)
        }
    }
}

macro_rules! meta_int {
    ($($t:ty),*) => {$(
        impl From<$t> for MetaValue {
            fn from(v: $t) -> Self {
                MetaValue::int(v as i128)
            }
        }
    )*};
}
meta_int!(i8, i16, i32, i64, isize, u8, u16, u32, u64, usize);

impl From<f64> for MetaValue {
    fn from(v: f64) -> Self {
        MetaValue::Float(v)
    }
}

impl From<&'static str> for MetaValue {
    fn from(v: &'static str) -> Self {
        MetaValue::Str(Cow::Borrowed(v))
    }
}

impl From<String> for MetaValue {
    fn from(v: String) -> Self {
        MetaValue::Str(Cow::Owned(v))
    }
}

impl From<&String> for MetaValue {
    fn from(v: &String) -> Self {
        MetaValue::Str(Cow::Owned(v.clone()))
    }
}

macro_rules! meta_fixed {
    ($($t:ty),*) => {$(
        impl From<$t> for MetaValue {
            fn from(v: $t) -> Self {
                MetaValue::Decimal(v.micros())
            }
        }
    )*};
}
meta_fixed!(Price, Qty, Usdc, Rate);

impl From<TsMs> for MetaValue {
    fn from(v: TsMs) -> Self {
        MetaValue::from(v.0)
    }
}

impl From<DurMs> for MetaValue {
    fn from(v: DurMs) -> Self {
        MetaValue::from(v.0)
    }
}

impl From<json::Value> for MetaValue {
    fn from(v: json::Value) -> Self {
        MetaValue::Json(v)
    }
}

impl<T: Into<MetaValue>> From<Option<T>> for MetaValue {
    fn from(v: Option<T>) -> Self {
        v.map_or(MetaValue::Null, Into::into)
    }
}

impl MetaValue {
    fn write_json(&self, out: &mut String) {
        match self {
            MetaValue::Null => out.push_str("null"),
            MetaValue::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            MetaValue::Int(i) => {
                let _ = write!(out, "{i}");
            }
            MetaValue::Float(f) => write_f64(out, *f),
            MetaValue::Decimal(m) => out.push_str(&format_micros(*m)),
            MetaValue::Str(s) => write_json_str(out, s),
            MetaValue::Json(v) => out.push_str(&v.to_string()),
        }
    }
}

/// Intent meta: `meta! { "edge" => 0.031, "leg" => "entry", "n" => 3 }`
/// (30 §7.2). Key order is not significant; a key set twice keeps the last
/// value. Also the output of `Strategy::status` (30 §4 rule 8).
///
/// ```
/// use pmb_sdk::prelude::*;
///
/// let mut m = meta! { "edge" => 0.031, "leg" => "entry", "n" => 3 };
/// m.set("limit", price!(0.53));
/// m.json("levels", pmb_sdk::json::Value::from(vec![1, 2]));
/// assert_eq!(
///     m.to_json_string(),
///     r#"{"edge":0.031,"leg":"entry","n":3,"limit":0.53,"levels":[1,2]}"#
/// );
/// ```
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Meta {
    entries: Vec<(Cow<'static, str>, MetaValue)>,
}

impl Meta {
    pub const fn new() -> Self {
        Meta {
            entries: Vec::new(),
        }
    }

    pub fn with_capacity(n: usize) -> Self {
        Meta {
            entries: Vec::with_capacity(n),
        }
    }

    /// Sets `key` to a scalar value, replacing an earlier value of the key.
    pub fn set(
        &mut self,
        key: impl Into<Cow<'static, str>>,
        value: impl Into<MetaValue>,
    ) -> &mut Self {
        let key = key.into();
        let value = value.into();
        match self.entries.iter_mut().find(|(k, _)| *k == key) {
            Some(e) => e.1 = value,
            None => self.entries.push((key, value)),
        }
        self
    }

    /// Sets `key` to a nested JSON value (30 §7.2 escape hatch).
    pub fn json(&mut self, key: impl Into<Cow<'static, str>>, value: json::Value) -> &mut Self {
        self.set(key, MetaValue::Json(value))
    }

    pub fn get(&self, key: &str) -> Option<&MetaValue> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Removes every entry, keeping the allocation (for `status` reuse).
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// The meta as one compact JSON object, keys in insertion order.
    pub fn to_json_string(&self) -> String {
        let mut out = String::new();
        self.write_json(&mut out);
        out
    }

    /// Appends the JSON object to `out` (the engine's placement path,
    /// 10 §7.5 E1).
    pub fn write_json(&self, out: &mut String) {
        out.push('{');
        for (i, (k, v)) in self.entries.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            write_json_str(out, k);
            out.push(':');
            v.write_json(out);
        }
        out.push('}');
    }

    /// `meta!` push of a key that the macro proved unique at compile time.
    #[doc(hidden)]
    pub fn __push_literal(&mut self, key: &'static str, value: MetaValue) {
        self.entries.push((Cow::Borrowed(key), value));
    }
}
