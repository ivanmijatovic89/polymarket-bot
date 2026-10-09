//! Number representations of the contract (21 §6.1, §18).
//!
//! - [`Decimal`]: job money, sizes, ratios and ticks as canonical decimal
//!   strings (N4), held as exact 1e6 micros. Never parsed through `f64`.
//! - [`OutDec`]: output money and sizes as JSON numbers rendered from
//!   fixed point at their quantization (N5), held as an exact scaled integer.
//! - [`SafeU64`] / [`SafeI64`]: integers bounded by ±(2^53 − 1) (N2).
//! - [`FiniteF64`]: feed values and strategy floats; finite and never -0 (N1).
//! - [`Sha256Hex`]: lowercase 64-hex digests.

use std::borrow::Cow;
use std::fmt;

use schemars::{json_schema, JsonSchema, Schema, SchemaGenerator};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::value::RawValue;

/// Largest integer exactly representable in an IEEE double (N2).
pub const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// Scale of [`Decimal`] (fixed point at 1e6 base units, 10 §2).
pub const MICROS_PER_UNIT: i64 = 1_000_000;

/// Pattern of a contract decimal string: canonical form, at most 6
/// fractional digits, no trailing zeros, no exponent, no `-0` (21 §6.1).
pub const DECIMAL_PATTERN: &str = r"^(0|-?[1-9][0-9]*|-?(0|[1-9][0-9]*)\.[0-9]{0,5}[1-9])$";

// ---------------------------------------------------------------------------
// Decimal (job side, string)
// ---------------------------------------------------------------------------

/// A job decimal string (21 §6.1, N4) held as exact micros.
///
/// Only the canonical text is accepted, so text and micros map one to one
/// and serialization reproduces the input bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Decimal {
    micros: i64,
}

/// Why a decimal string or number was rejected.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecimalError(pub String);

impl fmt::Display for DecimalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DecimalError {}

impl Decimal {
    pub const ZERO: Decimal = Decimal { micros: 0 };

    /// Builds a decimal from micros (any value is representable).
    pub const fn from_micros(micros: i64) -> Self {
        Decimal { micros }
    }

    /// The exact value in 1e6 base units.
    pub const fn micros(self) -> i64 {
        self.micros
    }

    pub const fn is_negative(self) -> bool {
        self.micros < 0
    }

    /// Parses the canonical text of [`DECIMAL_PATTERN`].
    pub fn parse(text: &str) -> Result<Self, DecimalError> {
        let err = || DecimalError(format!("invalid decimal string {text:?} (21 §6.1)"));
        let (neg, body) = match text.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, text),
        };
        let (int_part, frac_part) = match body.split_once('.') {
            Some((i, f)) => (i, Some(f)),
            None => (body, None),
        };
        if int_part.is_empty() || !int_part.bytes().all(|b| b.is_ascii_digit()) {
            return Err(err());
        }
        if int_part.len() > 1 && int_part.starts_with('0') {
            return Err(err());
        }
        let mut frac_micros: i64 = 0;
        if let Some(frac) = frac_part {
            if frac.is_empty()
                || frac.len() > 6
                || !frac.bytes().all(|b| b.is_ascii_digit())
                || frac.ends_with('0')
            {
                return Err(err());
            }
            for (i, b) in frac.bytes().enumerate() {
                frac_micros += i64::from(b - b'0') * 10_i64.pow(5 - i as u32);
            }
        }
        let mut int_val: i64 = 0;
        for b in int_part.bytes() {
            int_val = int_val
                .checked_mul(10)
                .and_then(|v| v.checked_add(i64::from(b - b'0')))
                .ok_or_else(err)?;
        }
        let abs = int_val
            .checked_mul(MICROS_PER_UNIT)
            .and_then(|v| v.checked_add(frac_micros))
            .ok_or_else(err)?;
        if neg && abs == 0 {
            return Err(err());
        }
        Ok(Decimal {
            micros: if neg { -abs } else { abs },
        })
    }
}

impl fmt::Display for Decimal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&render_scaled(i128::from(self.micros), 6))
    }
}

impl Serialize for Decimal {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Decimal {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = Cow::<'de, str>::deserialize(d)?;
        Decimal::parse(&text).map_err(D::Error::custom)
    }
}

impl JsonSchema for Decimal {
    fn inline_schema() -> bool {
        true
    }
    fn schema_name() -> Cow<'static, str> {
        "Decimal".into()
    }
    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "string", "pattern": DECIMAL_PATTERN })
    }
}

/// Renders `value / 10^scale` with minimal digits: no trailing zeros, no
/// exponent, `0` for zero.
fn render_scaled(value: i128, scale: u32) -> String {
    let pow = 10_i128.pow(scale);
    let abs = value.unsigned_abs();
    let int = abs / pow.unsigned_abs();
    let frac = abs % pow.unsigned_abs();
    let sign = if value < 0 { "-" } else { "" };
    if frac == 0 {
        return format!("{sign}{int}");
    }
    let mut frac_text = format!("{frac:0width$}", width = scale as usize);
    while frac_text.ends_with('0') {
        frac_text.pop();
    }
    format!("{sign}{int}.{frac_text}")
}

// ---------------------------------------------------------------------------
// OutDec (output side, JSON number)
// ---------------------------------------------------------------------------

/// An output value quantized at `DP` decimal places and emitted as a plain
/// JSON number (21 §18 N5): `units` × 10^-DP, exact.
///
/// Deserialization reads the raw number token and rejects any value that is
/// not exactly representable at `DP` places; it never goes through `f64`.
/// It therefore requires the `serde_json` text deserializer (`from_str`,
/// `from_slice`), not `from_value`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct OutDec<const DP: u32> {
    units: i64,
}

/// 2 decimal places (pnl, fees, shares, cost; 21 §11).
pub type OutDec2 = OutDec<2>;
/// 4 decimal places (average entry prices; 21 §11).
pub type OutDec4 = OutDec<4>;
/// 6 decimal places (exact fixed point; traces and ledgers, 22 §3.3, §4.2).
pub type OutDec6 = OutDec<6>;

impl<const DP: u32> OutDec<DP> {
    pub const ZERO: Self = OutDec { units: 0 };

    /// Value in units of 10^-DP.
    pub const fn from_units(units: i64) -> Self {
        OutDec { units }
    }

    pub const fn units(self) -> i64 {
        self.units
    }

    /// The value in 1e6 micros (exact for DP ≤ 6).
    pub fn micros(self) -> i64 {
        assert!(DP <= 6, "OutDec micros() needs DP <= 6");
        self.units * 10_i64.pow(6 - DP)
    }

    /// Quantizes micros half away from zero to DP places (D08, 21 §11).
    pub fn from_micros_half_away(micros: i64) -> Self {
        assert!(DP <= 6, "OutDec from_micros needs DP <= 6");
        let div = 10_i64.pow(6 - DP);
        let q = micros / div;
        let r = micros % div;
        let units = if 2 * r.abs() >= div {
            q + micros.signum()
        } else {
            q
        };
        OutDec { units }
    }

    /// Parses a JSON number token exactly.
    pub fn parse_json_number(text: &str) -> Result<Self, DecimalError> {
        let err = |why: &str| DecimalError(format!("invalid {DP}-dp number {text:?}: {why}"));
        let (mantissa, exp) = match text.find(['e', 'E']) {
            Some(pos) => {
                let e: i32 = text[pos + 1..].parse().map_err(|_| err("bad exponent"))?;
                (&text[..pos], e)
            }
            None => (text, 0),
        };
        let (neg, body) = match mantissa.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, mantissa),
        };
        let (int_part, frac_part) = body.split_once('.').unwrap_or((body, ""));
        if int_part.is_empty()
            || !int_part.bytes().all(|b| b.is_ascii_digit())
            || !frac_part.bytes().all(|b| b.is_ascii_digit())
            || (body.contains('.') && frac_part.is_empty())
        {
            return Err(err("not a JSON number"));
        }
        // digits × 10^(exp − frac_len) must be a multiple of 10^-DP.
        let digits = format!("{int_part}{frac_part}");
        let digits = digits.trim_start_matches('0');
        let shift = i64::from(exp) - frac_part.len() as i64 + i64::from(DP);
        let mut units: i128 = 0;
        if !digits.is_empty() {
            if digits.len() > 30 {
                return Err(err("too many digits"));
            }
            let mut v: i128 = digits.parse().map_err(|_| err("digits"))?;
            if shift >= 0 {
                for _ in 0..shift {
                    v = v.checked_mul(10).ok_or_else(|| err("out of range"))?;
                }
            } else {
                for _ in 0..(-shift) {
                    if v % 10 != 0 {
                        return Err(err("more decimal places than allowed"));
                    }
                    v /= 10;
                }
            }
            units = v;
        }
        let units = if neg { -units } else { units };
        if neg && units == 0 {
            return Err(err("negative zero (N1)"));
        }
        let units = i64::try_from(units).map_err(|_| err("out of range"))?;
        Ok(OutDec { units })
    }
}

impl<const DP: u32> fmt::Display for OutDec<DP> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&render_scaled(i128::from(self.units), DP))
    }
}

impl<const DP: u32> Serialize for OutDec<DP> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let raw = RawValue::from_string(self.to_string()).map_err(serde::ser::Error::custom)?;
        raw.serialize(s)
    }
}

impl<'de, const DP: u32> Deserialize<'de> for OutDec<DP> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = Box::<RawValue>::deserialize(d)?;
        OutDec::parse_json_number(raw.get()).map_err(D::Error::custom)
    }
}

impl<const DP: u32> JsonSchema for OutDec<DP> {
    fn inline_schema() -> bool {
        true
    }
    fn schema_name() -> Cow<'static, str> {
        format!("OutDec{DP}").into()
    }
    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        // `decimalScale` is the custom keyword of 21 §18 N6.
        json_schema!({ "type": "number", "decimalScale": DP })
    }
}

// ---------------------------------------------------------------------------
// Safe integers, finite floats, digests
// ---------------------------------------------------------------------------

/// Unsigned integer in `[0, 2^53 − 1]` (N2).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct SafeU64(u64);

impl SafeU64 {
    pub const fn new(v: u64) -> Option<Self> {
        if v <= MAX_SAFE_INTEGER {
            Some(SafeU64(v))
        } else {
            None
        }
    }
    pub const fn get(self) -> u64 {
        self.0
    }
}

impl<'de> Deserialize<'de> for SafeU64 {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = u64::deserialize(d)?;
        SafeU64::new(v)
            .ok_or_else(|| D::Error::custom(format!("integer {v} exceeds 2^53-1 (21 §18 N2)")))
    }
}

impl JsonSchema for SafeU64 {
    fn inline_schema() -> bool {
        true
    }
    fn schema_name() -> Cow<'static, str> {
        "SafeU64".into()
    }
    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_SAFE_INTEGER })
    }
}

/// Signed integer in `[-(2^53 − 1), 2^53 − 1]` (N2).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct SafeI64(i64);

impl SafeI64 {
    pub const fn new(v: i64) -> Option<Self> {
        if v.unsigned_abs() <= MAX_SAFE_INTEGER {
            Some(SafeI64(v))
        } else {
            None
        }
    }
    pub const fn get(self) -> i64 {
        self.0
    }
}

impl<'de> Deserialize<'de> for SafeI64 {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = i64::deserialize(d)?;
        SafeI64::new(v)
            .ok_or_else(|| D::Error::custom(format!("integer {v} outside ±(2^53-1) (21 §18 N2)")))
    }
}

impl JsonSchema for SafeI64 {
    fn inline_schema() -> bool {
        true
    }
    fn schema_name() -> Cow<'static, str> {
        "SafeI64".into()
    }
    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        let max = MAX_SAFE_INTEGER as i64;
        json_schema!({ "type": "integer", "minimum": -max, "maximum": max })
    }
}

/// A finite `f64` that is never `-0` (N1). For feed values and strategy
/// floats only, never money (R2).
#[derive(Clone, Copy, Debug, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct FiniteF64(f64);

impl FiniteF64 {
    pub fn new(v: f64) -> Option<Self> {
        if v.is_finite() && !(v == 0.0 && v.is_sign_negative()) {
            Some(FiniteF64(v))
        } else {
            None
        }
    }
    pub const fn get(self) -> f64 {
        self.0
    }
}

impl<'de> Deserialize<'de> for FiniteF64 {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = f64::deserialize(d)?;
        FiniteF64::new(v).ok_or_else(|| D::Error::custom("non-finite or -0 number (21 §18 N1)"))
    }
}

impl JsonSchema for FiniteF64 {
    fn inline_schema() -> bool {
        true
    }
    fn schema_name() -> Cow<'static, str> {
        "FiniteF64".into()
    }
    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "number" })
    }
}

/// Lowercase hex sha256 digest.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct Sha256Hex(String);

impl Sha256Hex {
    pub fn parse(s: &str) -> Option<Self> {
        (s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
            .then(|| Sha256Hex(s.to_owned()))
    }
    pub fn from_digest(bytes: &[u8; 32]) -> Self {
        let mut s = String::with_capacity(64);
        for b in bytes {
            s.push_str(&format!("{b:02x}"));
        }
        Sha256Hex(s)
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Sha256Hex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Sha256Hex {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = Cow::<'de, str>::deserialize(d)?;
        Sha256Hex::parse(&s).ok_or_else(|| D::Error::custom("expected 64 lowercase hex digits"))
    }
}

impl JsonSchema for Sha256Hex {
    fn inline_schema() -> bool {
        true
    }
    fn schema_name() -> Cow<'static, str> {
        "Sha256Hex".into()
    }
    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "string", "pattern": "^[0-9a-f]{64}$" })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_accepts_only_canonical_text() {
        for (t, m) in [
            ("0", 0),
            ("500", 500_000_000),
            ("0.07", 70_000),
            ("-1.5", -1_500_000),
            ("0.000001", 1),
            ("2000", 2_000_000_000),
        ] {
            let d = Decimal::parse(t).unwrap();
            assert_eq!(d.micros(), m, "{t}");
            assert_eq!(d.to_string(), t);
        }
        for bad in [
            "",
            "-0",
            "00",
            "01",
            "1.",
            ".5",
            "1.50",
            "1.0000001",
            "1e3",
            "+1",
            " 1",
            "-0.0",
            "1.0",
            "0x10",
        ] {
            assert!(Decimal::parse(bad).is_err(), "{bad:?} must be rejected");
        }
    }

    #[test]
    fn decimal_rejects_json_numbers() {
        assert!(serde_json::from_str::<Decimal>("500").is_err());
        assert!(serde_json::from_str::<Decimal>("0.07").is_err());
        assert_eq!(
            serde_json::from_str::<Decimal>("\"0.07\"")
                .unwrap()
                .micros(),
            70_000
        );
    }

    #[test]
    fn outdec_round_trips_exactly() {
        for t in ["0", "12.34", "-0.01", "123456789.99", "7"] {
            let v: OutDec2 = serde_json::from_str(t).unwrap();
            assert_eq!(serde_json::to_string(&v).unwrap(), t);
        }
        let v: OutDec2 = serde_json::from_str("12.40").unwrap();
        assert_eq!(v.units(), 1240);
        assert_eq!(serde_json::to_string(&v).unwrap(), "12.4");
        let v: OutDec4 = serde_json::from_str("1.5e-3").unwrap();
        assert_eq!(v.units(), 15);
        assert!(serde_json::from_str::<OutDec2>("0.001").is_err());
        assert!(serde_json::from_str::<OutDec2>("\"1.5\"").is_err());
        assert!(serde_json::from_str::<OutDec2>("-0").is_err());
    }

    #[test]
    fn outdec_quantizes_half_away_from_zero() {
        assert_eq!(OutDec2::from_micros_half_away(12_345_000).units(), 1235);
        assert_eq!(OutDec2::from_micros_half_away(-12_345_000).units(), -1235);
        assert_eq!(OutDec2::from_micros_half_away(12_344_999).units(), 1234);
        assert_eq!(OutDec4::from_micros_half_away(-50).units(), -1);
        assert_eq!(OutDec6::from_micros_half_away(-7).units(), -7);
    }

    #[test]
    fn safe_integers_and_floats() {
        assert!(serde_json::from_str::<SafeU64>("9007199254740991").is_ok());
        assert!(serde_json::from_str::<SafeU64>("9007199254740992").is_err());
        assert!(serde_json::from_str::<SafeU64>("-1").is_err());
        assert!(serde_json::from_str::<SafeI64>("-9007199254740992").is_err());
        assert!(serde_json::from_str::<FiniteF64>("-0.0").is_err());
        assert!(serde_json::from_str::<FiniteF64>("117234.51").is_ok());
    }
}
