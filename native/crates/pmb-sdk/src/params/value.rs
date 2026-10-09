//! Field types of params structs and their parse/normalize/schema rules
//! (the table of 30 §9).

use super::input::Input;
use super::support::child_index;
use super::text::{write_f64, write_json_str};
use super::{ParamError, ParamErrorKind};
use crate::json::Value;
use pmb_core::fixed::{format_micros, parse_decimal, DecimalError};
use pmb_core::{DurMs, Price, Qty, Rate, Usdc};
use std::fmt::Write;

/// A type that can be a params field (30 §9 table). Implemented for the
/// supported scalars, `Option<T>`, `Vec<T>`, and by the derives for
/// `#[derive(ParamEnum)]` enums and nested `#[derive(Params)]` structs.
#[diagnostic::on_unimplemented(
    message = "`{Self}` cannot be a params field",
    note = "params fields are bool, integers, f64, Price, Qty, Usdc, Rate, DurMs, String, \
            #[derive(ParamEnum)] enums, #[derive(Params)] structs, and Option/Vec of them \
            (30-strategy-sdk.md §9)"
)]
pub trait ParamValue: Sized {
    /// `Option<T>`: absent keys are `None` and not required.
    const OPTIONAL: bool = false;

    /// Parses one value; on failure records issues at `path` and returns
    /// `None`.
    fn parse(input: &Input, path: &str, errs: &mut ParamError) -> Option<Self>;

    /// Appends the normalized JSON of the value (30 §9 rule 6).
    fn write_normalized(&self, out: &mut String);

    /// True when the value is omitted from a normalized object (`None`).
    fn is_absent(&self) -> bool {
        false
    }

    /// The value of an absent key without a default: `Some(None)` for
    /// `Option`, else `None` (the param is required).
    fn absent() -> Option<Self> {
        None
    }

    /// JSON Schema of the type.
    fn schema() -> Value;

    /// JSON Schema with bounds (`minimum` etc., as normalized number text).
    fn schema_bounded(bounds: &[(&'static str, &'static str)]) -> Value {
        let mut s = Self::schema();
        if let Value::Object(m) = &mut s {
            for (k, text) in bounds {
                m.insert((*k).to_owned(), number_value(text));
            }
        }
        s
    }

    /// What a valid value looks like, for messages ("a finite number").
    fn expected() -> String;
}

/// Numbers that `min`/`max` bounds compare: the field itself, or the value
/// inside an `Option`.
pub trait BoundView {
    type Inner: PartialOrd + ParamValue;
    fn bound_view(&self) -> Option<&Self::Inner>;
}

impl<T: BoundView<Inner = T> + PartialOrd + ParamValue> BoundView for Option<T> {
    type Inner = T;
    fn bound_view(&self) -> Option<&T> {
        self.as_ref()
    }
}

/// A JSON number value from normalized number text.
pub(crate) fn number_value(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or(Value::Null)
}

pub(crate) fn invalid<T: ParamValue>(
    input: &Input,
    path: &str,
    errs: &mut ParamError,
    kind: ParamErrorKind,
    note: &str,
) -> Option<T> {
    errs.push_kind(
        path.to_owned(),
        kind,
        format!("expected {}, got {}{note}", T::expected(), input.describe()),
    );
    None
}

fn schema_of(pairs: &[(&str, Value)]) -> Value {
    let mut m = serde_json::Map::new();
    for (k, v) in pairs {
        m.insert((*k).to_owned(), v.clone());
    }
    Value::Object(m)
}

impl ParamValue for bool {
    fn parse(input: &Input, path: &str, errs: &mut ParamError) -> Option<Self> {
        match input {
            Input::Bool(b) => Some(*b),
            // Rust semantics: only these two strings (§9 rule 7).
            Input::String(s) if s == "true" => Some(true),
            Input::String(s) if s == "false" => Some(false),
            _ => invalid(input, path, errs, ParamErrorKind::InvalidValue, ""),
        }
    }
    fn write_normalized(&self, out: &mut String) {
        out.push_str(if *self { "true" } else { "false" });
    }
    fn schema() -> Value {
        schema_of(&[("type", "boolean".into())])
    }
    fn expected() -> String {
        "true or false".into()
    }
}

/// Largest integer magnitude any payload may carry, `2^53 - 1` (21 §18 N2).
/// Normalized params are stored by TS (`backtest_runs.params`, read back by
/// `JSON.parse` on `--extend`, `--params-from-run` and the D14 duplicate
/// check), so every integer param stays within it.
pub(crate) const SAFE_INT: i128 = (1 << 53) - 1;

/// Most significant digits a fixed-point param may have: every decimal of
/// at most 15 significant digits survives a round trip through a JSON
/// number (an IEEE double) unchanged, so normalized params stay idempotent
/// through TS storage (30 §9 rule 6, 21 §18).
pub(crate) const MAX_SIG_DIGITS: u32 = 15;

/// The valid range of an integer type intersected with `±SAFE_INT`.
pub(crate) const fn safe_range(min: i128, max: i128) -> (i128, i128) {
    let lo = if min < -SAFE_INT { -SAFE_INT } else { min };
    let hi = if max > SAFE_INT { SAFE_INT } else { max };
    (lo, hi)
}

fn range_note(lo: i128, hi: i128) -> String {
    format!(" (out of range: this param is from {lo} to {hi}; params integers stay within ±(2^53 - 1), 21 §18 N2)")
}

/// Exact value of a JSON number whose exact value is an integer (`20`,
/// `20.0`, `2e1`). `InvalidValue` when it has a fraction, `OutOfRange` when
/// it is integral but beyond `i128`.
fn integral_value(n: &str) -> Result<i128, ParamErrorKind> {
    let (neg, rest) = match n.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, n),
    };
    let (mant, exp) = match rest.find(['e', 'E']) {
        Some(i) => (
            &rest[..i],
            rest[i + 1..]
                .parse::<i64>()
                .map_err(|_| ParamErrorKind::OutOfRange)?,
        ),
        None => (rest, 0),
    };
    let (int, frac) = mant.split_once('.').unwrap_or((mant, ""));
    let mut digits: String = int.chars().chain(frac.chars()).collect();
    let mut exp = exp
        .checked_sub(frac.len() as i64)
        .ok_or(ParamErrorKind::OutOfRange)?;
    while exp < 0 && digits.ends_with('0') {
        digits.pop();
        exp += 1;
    }
    if exp < 0 {
        return Err(ParamErrorKind::InvalidValue);
    }
    let digits = digits.trim_start_matches('0');
    if digits.is_empty() {
        return Ok(0);
    }
    if digits.len() as i64 + exp > 39 {
        return Err(ParamErrorKind::OutOfRange);
    }
    let mut s = String::with_capacity(digits.len() + exp as usize + 1);
    if neg {
        s.push('-');
    }
    s.push_str(digits);
    s.extend(std::iter::repeat_n('0', exp as usize));
    s.parse::<i128>().map_err(|_| ParamErrorKind::OutOfRange)
}

/// The issue kind of a CLI integer string that Rust `FromStr` of the field
/// type rejected: a valid integer outside the type is `OutOfRange`.
fn int_error_kind(s: &str, e: &std::num::ParseIntError) -> ParamErrorKind {
    use std::num::IntErrorKind;
    match e.kind() {
        IntErrorKind::PosOverflow | IntErrorKind::NegOverflow => ParamErrorKind::OutOfRange,
        _ if s.parse::<i128>().is_ok() => ParamErrorKind::OutOfRange,
        _ => ParamErrorKind::InvalidValue,
    }
}

/// Parses an integer param of a type whose `±SAFE_INT`-clamped range is
/// `lo..=hi` (30 §9 table, 21 §18 N2). CLI strings use Rust `FromStr` of
/// the field type through `from_str`.
fn parse_int<T: ParamValue>(
    input: &Input,
    path: &str,
    errs: &mut ParamError,
    (lo, hi): (i128, i128),
    from_str: fn(&str) -> Result<i128, std::num::ParseIntError>,
    make: fn(i128) -> T,
) -> Option<T> {
    let v = match input {
        // CLI string: Rust `FromStr` (§9 table).
        Input::String(s) => from_str(s).map_err(|e| int_error_kind(s, &e)),
        // Typed JSON: a number whose exact value is an integer.
        // D-PENDING: 30 §9 says "integer"; chose to accept any JSON number
        // with an integral exact value (20.0, 2e1), consistent with rule 10,
        // while CLI strings keep Rust FromStr ("20.0" is rejected).
        Input::Number(n) => integral_value(n),
        _ => Err(ParamErrorKind::InvalidValue),
    };
    match v {
        Ok(v) if (lo..=hi).contains(&v) => Some(make(v)),
        Ok(_) | Err(ParamErrorKind::OutOfRange) => invalid(
            input,
            path,
            errs,
            ParamErrorKind::OutOfRange,
            &range_note(lo, hi),
        ),
        Err(kind) => invalid(input, path, errs, kind, ""),
    }
}

macro_rules! int_param {
    ($($t:ty),*) => {$(
        impl ParamValue for $t {
            fn parse(input: &Input, path: &str, errs: &mut ParamError) -> Option<Self> {
                parse_int(
                    input,
                    path,
                    errs,
                    safe_range(<$t>::MIN as i128, <$t>::MAX as i128),
                    |s| s.parse::<$t>().map(|v| v as i128),
                    // In range by the check in `parse_int`.
                    |v| v as $t,
                )
            }
            fn write_normalized(&self, out: &mut String) {
                let _ = write!(out, "{}", self);
            }
            fn schema() -> Value {
                // Every integer param stays within ±(2^53 - 1) (21 §18 N2).
                let (lo, hi) = safe_range(<$t>::MIN as i128, <$t>::MAX as i128);
                schema_of(&[
                    ("type", "integer".into()),
                    ("minimum", (lo as i64).into()),
                    ("maximum", (hi as i64).into()),
                ])
            }
            fn expected() -> String {
                concat!("an integer (", stringify!($t), ")").into()
            }
        }
        impl BoundView for $t {
            type Inner = $t;
            fn bound_view(&self) -> Option<&$t> {
                Some(self)
            }
        }
    )*};
}

int_param!(i8, i16, i32, i64, isize, u8, u16, u32, u64, usize);

impl ParamValue for f64 {
    fn parse(input: &Input, path: &str, errs: &mut ParamError) -> Option<Self> {
        let text = match input {
            Input::Number(n) => &**n,
            // CLI string: Rust `FromStr`, finite only (§9 table, rule 7).
            Input::String(s) => s.as_str(),
            _ => return invalid(input, path, errs, ParamErrorKind::InvalidValue, ""),
        };
        match text.parse::<f64>() {
            // -0 normalizes to 0 (§9 table).
            Ok(v) if v.is_finite() => Some(if v == 0.0 { 0.0 } else { v }),
            // A number beyond the f64 range (`1e400`); `inf`, `NaN` and
            // `Infinity` have no digit and stay invalid (§9 rule 7).
            Ok(_) if text.bytes().any(|b| b.is_ascii_digit()) => invalid(
                input,
                path,
                errs,
                ParamErrorKind::OutOfRange,
                " (beyond the f64 range)",
            ),
            _ => invalid(input, path, errs, ParamErrorKind::InvalidValue, ""),
        }
    }
    fn write_normalized(&self, out: &mut String) {
        write_f64(out, *self);
    }
    fn schema() -> Value {
        schema_of(&[("type", "number".into())])
    }
    fn expected() -> String {
        "a finite number".into()
    }
}

impl BoundView for f64 {
    type Inner = f64;
    fn bound_view(&self) -> Option<&f64> {
        Some(self)
    }
}

/// Significant digits of the exact decimal `micros / 1e6`.
pub(crate) fn significant_digits(micros: i64) -> u32 {
    let mut m = micros.unsigned_abs();
    if m == 0 {
        return 1;
    }
    while m % 10 == 0 {
        m /= 10;
    }
    m.ilog10() + 1
}

/// Exact decimal parse into micros (10 §2 T6), at most 6 decimal places
/// and 15 significant digits, within `lo..=hi`.
fn parse_fixed<T: ParamValue>(
    input: &Input,
    path: &str,
    errs: &mut ParamError,
    lo: i64,
    hi: i64,
    range_note: &str,
    make: fn(i64) -> T,
) -> Option<T> {
    let text = match input {
        Input::Number(n) => &**n,
        Input::String(s) => s.as_str(),
        _ => return invalid(input, path, errs, ParamErrorKind::InvalidValue, ""),
    };
    match parse_decimal(text) {
        Ok(d) if d.inexact => invalid(
            input,
            path,
            errs,
            ParamErrorKind::InvalidValue,
            " (more than 6 decimal places)",
        ),
        Ok(d) if d.micros < lo || d.micros > hi => {
            invalid(input, path, errs, ParamErrorKind::OutOfRange, range_note)
        }
        Ok(d) if significant_digits(d.micros) > MAX_SIG_DIGITS => invalid(
            input,
            path,
            errs,
            ParamErrorKind::InvalidValue,
            " (more than 15 significant digits: a JSON number keeps at most 15 exactly, so \
             stored params would change; 30 §9 rule 6)",
        ),
        Ok(d) => Some(make(d.micros)),
        Err(DecimalError::Range) => {
            invalid(input, path, errs, ParamErrorKind::OutOfRange, range_note)
        }
        Err(DecimalError::Syntax) => invalid(input, path, errs, ParamErrorKind::InvalidValue, ""),
    }
}

macro_rules! fixed_param {
    ($t:ty, $lo:expr, $hi:expr, $range_note:expr, $expected:expr, $schema_extra:expr) => {
        impl ParamValue for $t {
            fn parse(input: &Input, path: &str, errs: &mut ParamError) -> Option<Self> {
                parse_fixed(input, path, errs, $lo, $hi, $range_note, <$t>::from_micros)
            }
            fn write_normalized(&self, out: &mut String) {
                out.push_str(&format_micros(self.micros()));
            }
            fn schema() -> Value {
                let mut pairs: Vec<(&str, Value)> =
                    vec![("type", "number".into()), ("decimalScale", 6.into())];
                pairs.extend($schema_extra);
                schema_of(&pairs)
            }
            fn expected() -> String {
                $expected.into()
            }
        }
        impl BoundView for $t {
            type Inner = $t;
            fn bound_view(&self) -> Option<&$t> {
                Some(self)
            }
        }
    };
}

// Ranges: 10 §2. `decimalScale` is the custom schema keyword of 21 §18 N6.
fixed_param!(
    Price,
    0,
    1_000_000,
    " (a price is from 0 to 1)",
    "a price from 0 to 1 with at most 6 decimal places",
    [("minimum", Value::from(0)), ("maximum", Value::from(1))]
);
fixed_param!(
    Rate,
    0,
    1_000_000,
    " (a rate is from 0 to 1)",
    "a rate from 0 to 1 with at most 6 decimal places",
    [("minimum", Value::from(0)), ("maximum", Value::from(1))]
);
fixed_param!(
    Qty,
    i64::MIN,
    i64::MAX,
    " (out of the i64 micro range)",
    "a share quantity with at most 6 decimal places",
    []
);
fixed_param!(
    Usdc,
    i64::MIN,
    i64::MAX,
    " (out of the i64 micro range)",
    "a USDC amount with at most 6 decimal places",
    []
);

// D-PENDING: 30 §9 lists DurMs with the fixed-point types ("at most 6 dp"),
// but DurMs is integer milliseconds (10 §2); chose a non-negative integer of
// ms (typed JSON integral number or Rust FromStr integer string), at most
// 2^53 - 1 (21 §18 N2).
impl ParamValue for DurMs {
    fn parse(input: &Input, path: &str, errs: &mut ParamError) -> Option<Self> {
        parse_int(
            input,
            path,
            errs,
            (0, SAFE_INT),
            |s| s.parse::<i64>().map(i128::from),
            // In 0..=2^53 - 1 by the check in `parse_int`.
            |v| crate::__private::dur_ms(v as i64),
        )
    }
    fn write_normalized(&self, out: &mut String) {
        let _ = write!(out, "{self}");
    }
    fn schema() -> Value {
        schema_of(&[
            ("type", "integer".into()),
            ("minimum", 0.into()),
            ("maximum", (SAFE_INT as i64).into()),
        ])
    }
    fn expected() -> String {
        "a non-negative integer number of milliseconds".into()
    }
}

impl BoundView for DurMs {
    type Inner = DurMs;
    fn bound_view(&self) -> Option<&DurMs> {
        Some(self)
    }
}

impl ParamValue for String {
    fn parse(input: &Input, path: &str, errs: &mut ParamError) -> Option<Self> {
        match input {
            // CLI strings are taken verbatim (§9 table).
            Input::String(s) => Some(s.clone()),
            _ => invalid(input, path, errs, ParamErrorKind::InvalidValue, ""),
        }
    }
    fn write_normalized(&self, out: &mut String) {
        write_json_str(out, self);
    }
    fn schema() -> Value {
        schema_of(&[("type", "string".into())])
    }
    fn expected() -> String {
        "a string".into()
    }
}

impl<T: ParamValue> ParamValue for Option<T> {
    const OPTIONAL: bool = true;

    fn parse(input: &Input, path: &str, errs: &mut ParamError) -> Option<Self> {
        match input {
            // Typed `null` and the CLI string "null" are None (§9 table).
            Input::Null => Some(None),
            // D-PENDING: a mixed object cannot tell a CLI string from a typed
            // string, so Option<String> also reads "null" as None.
            Input::String(s) if s == "null" => Some(None),
            _ => T::parse(input, path, errs).map(Some),
        }
    }
    fn write_normalized(&self, out: &mut String) {
        match self {
            Some(v) => v.write_normalized(out),
            None => out.push_str("null"),
        }
    }
    fn is_absent(&self) -> bool {
        self.is_none()
    }
    fn absent() -> Option<Self> {
        Some(None)
    }
    fn schema() -> Value {
        Self::schema_bounded(&[])
    }
    // Rule 8: an Option field accepts null; its bounds apply to the value.
    fn schema_bounded(bounds: &[(&'static str, &'static str)]) -> Value {
        schema_of(&[(
            "anyOf",
            Value::Array(vec![
                T::schema_bounded(bounds),
                schema_of(&[("type", "null".into())]),
            ]),
        )])
    }
    fn expected() -> String {
        format!("{} or null", T::expected())
    }
}

impl<T: ParamValue> ParamValue for Vec<T> {
    fn parse(input: &Input, path: &str, errs: &mut ParamError) -> Option<Self> {
        let parsed;
        let items = match input {
            Input::Array(items) => items,
            // CLI: JSON array text (--param ids='["a","b"]', §9 table).
            Input::String(text) => match Input::from_json_text(text) {
                Ok(Input::Array(items)) => {
                    parsed = items;
                    &parsed
                }
                _ => {
                    return invalid(
                        input,
                        path,
                        errs,
                        ParamErrorKind::InvalidValue,
                        " (pass JSON array text, e.g. --param key='[\"a\",\"b\"]')",
                    )
                }
            },
            _ => return invalid(input, path, errs, ParamErrorKind::InvalidValue, ""),
        };
        let mut out = Vec::with_capacity(items.len());
        let mut ok = true;
        for (i, item) in items.iter().enumerate() {
            match T::parse(item, &child_index(path, i), errs) {
                Some(v) => out.push(v),
                None => ok = false,
            }
        }
        ok.then_some(out)
    }
    fn write_normalized(&self, out: &mut String) {
        out.push('[');
        for (i, v) in self.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            v.write_normalized(out);
        }
        out.push(']');
    }
    fn schema() -> Value {
        schema_of(&[("type", "array".into()), ("items", T::schema())])
    }
    fn expected() -> String {
        format!("a JSON array whose items are each {}", T::expected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 30 §9 table (typed JSON integers by exact value), 21 §18 N2
    #[test]
    fn integral_value_is_exact() {
        use ParamErrorKind::{InvalidValue, OutOfRange};
        assert_eq!(integral_value("20"), Ok(20));
        assert_eq!(integral_value("20.0"), Ok(20));
        assert_eq!(integral_value("2e1"), Ok(20));
        assert_eq!(integral_value("2.50e1"), Ok(25));
        assert_eq!(integral_value("-0"), Ok(0));
        assert_eq!(integral_value("-3"), Ok(-3));
        assert_eq!(integral_value("0.5"), Err(InvalidValue));
        assert_eq!(integral_value("25e-1"), Err(InvalidValue));
        assert_eq!(integral_value("1e99"), Err(OutOfRange));
        assert_eq!(integral_value("1e99999999999999999999"), Err(OutOfRange));
        assert_eq!(integral_value("1e38"), Ok(10i128.pow(38)));
        assert_eq!(integral_value("1e39"), Err(OutOfRange));
    }

    // spec: 30 §9 rule 6 (fixed point within 15 significant digits)
    #[test]
    fn significant_digit_count() {
        assert_eq!(significant_digits(0), 1);
        assert_eq!(significant_digits(1), 1);
        assert_eq!(significant_digits(-530_000), 2);
        assert_eq!(significant_digits(12_000_001), 8);
        assert_eq!(significant_digits(5_000_000_000_000_000), 1);
        assert_eq!(significant_digits(i64::MAX), 19);
    }
    // spec: 21 §18 N2
    #[test]
    fn safe_ranges() {
        assert_eq!(safe_range(i8::MIN as i128, i8::MAX as i128), (-128, 127));
        assert_eq!(safe_range(0, u64::MAX as i128), (0, SAFE_INT));
        assert_eq!(
            safe_range(i64::MIN as i128, i64::MAX as i128),
            (-SAFE_INT, SAFE_INT)
        );
    }
}
