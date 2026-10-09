//! Fixed-point scalar types and rounding (10-domain-model.md §2–§3).
//!
//! `Price`, `Qty`, `Usdc` and `Rate` count integer 1e-6 units. Arithmetic is
//! always checked (T3): named cross-type operations return
//! `Result<_, Overflow>`, same-type operators panic with a typed [`Overflow`]
//! payload instead of wrapping, independent of the build profile.

use std::cmp::Ordering;
use std::fmt;
use std::ops::{Add, AddAssign, Neg, Sub, SubAssign};

/// 1e6 base units per whole unit (USDC, shares, rates).
pub const SCALE: i64 = 1_000_000;

/// Rounding mode of one arithmetic site (10 §3.1). There is deliberately no
/// `Default` (R-2) and no "half toward +inf" mode (R-1).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Rounding {
    Floor,
    Ceil,
    TowardZero,
    HalfAwayFromZero,
}

/// Typed arithmetic failure of fixed-point math (T2, T3).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, thiserror::Error)]
pub enum Overflow {
    #[error("fixed-point overflow")]
    Range,
    #[error("fixed-point division by zero")]
    DivisionByZero,
}

/// An `f64` that cannot become a fixed-point value: NaN, infinite, or outside
/// the `i64` micro range (T5).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, thiserror::Error)]
#[error("non-finite or out-of-range float")]
pub struct NonFinite;

/// Divides `num / den` on `i128` with an explicit rounding mode.
#[inline]
pub fn div_round_i128(num: i128, den: i128, mode: Rounding) -> Result<i128, Overflow> {
    if den == 0 {
        return Err(Overflow::DivisionByZero);
    }
    let (num, den) = if den < 0 {
        (num.checked_neg().ok_or(Overflow::Range)?, -den)
    } else {
        (num, den)
    };
    let q = num / den; // truncates toward zero
    let r = num % den; // same sign as num
    if r == 0 {
        return Ok(q);
    }
    let away = if num < 0 { q - 1 } else { q + 1 };
    Ok(match mode {
        Rounding::TowardZero => q,
        Rounding::Floor => {
            if num < 0 {
                q - 1
            } else {
                q
            }
        }
        Rounding::Ceil => {
            if num < 0 {
                q
            } else {
                q + 1
            }
        }
        Rounding::HalfAwayFromZero => {
            let twice = r.unsigned_abs() * 2;
            if twice >= den.unsigned_abs() {
                away
            } else {
                q
            }
        }
    })
}

/// `a × b / c` computed on `i128` with one rounding step (T2).
#[inline]
pub fn mul_div(a: i64, b: i64, c: i64, mode: Rounding) -> Result<i64, Overflow> {
    let v = div_round_i128(a as i128 * b as i128, c as i128, mode)?;
    i64::try_from(v).map_err(|_| Overflow::Range)
}

#[track_caller]
#[cold]
fn overflow_panic() -> ! {
    std::panic::panic_any(Overflow::Range)
}

macro_rules! fixed_type {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[repr(transparent)]
        #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
        pub struct $name(i64);

        impl $name {
            pub const ZERO: Self = Self(0);
            pub const MAX: Self = Self(i64::MAX);
            pub const MIN: Self = Self(i64::MIN);

            #[inline]
            pub const fn from_micros(micros: i64) -> Self {
                Self(micros)
            }
            #[inline]
            pub const fn micros(self) -> i64 {
                self.0
            }
            /// Whole units, exact.
            #[inline]
            pub fn from_units(units: i64) -> Result<Self, Overflow> {
                units.checked_mul(SCALE).map(Self).ok_or(Overflow::Range)
            }
            #[inline]
            pub const fn is_zero(self) -> bool {
                self.0 == 0
            }
            #[inline]
            pub const fn is_positive(self) -> bool {
                self.0 > 0
            }
            #[inline]
            pub const fn is_negative(self) -> bool {
                self.0 < 0
            }
            #[inline]
            pub fn checked_add(self, o: Self) -> Result<Self, Overflow> {
                self.0.checked_add(o.0).map(Self).ok_or(Overflow::Range)
            }
            #[inline]
            pub fn checked_sub(self, o: Self) -> Result<Self, Overflow> {
                self.0.checked_sub(o.0).map(Self).ok_or(Overflow::Range)
            }
            #[inline]
            pub fn checked_neg(self) -> Result<Self, Overflow> {
                self.0.checked_neg().map(Self).ok_or(Overflow::Range)
            }
            #[inline]
            pub fn checked_abs(self) -> Result<Self, Overflow> {
                self.0.checked_abs().map(Self).ok_or(Overflow::Range)
            }
            /// `self × num / den` with one rounding step.
            #[inline]
            pub fn mul_div(self, num: i64, den: i64, mode: Rounding) -> Result<Self, Overflow> {
                mul_div(self.0, num, den, mode).map(Self)
            }
            /// Converts a float (feeds, SDK helpers) with an explicit mode (T5, R2).
            pub fn from_f64(v: f64, mode: Rounding) -> Result<Self, NonFinite> {
                from_f64_micros(v, mode).map(Self)
            }
            /// Lossy view for analytics and logs only; never feeds money decisions (T1).
            #[inline]
            pub fn to_f64_lossy(self) -> f64 {
                self.0 as f64 / SCALE as f64
            }
            /// Parses decimal text exactly (T6, R1); see [`parse_decimal`].
            pub fn parse_decimal(s: &str) -> Result<Decimal<Self>, DecimalError> {
                parse_decimal(s).map(|d| Decimal { value: Self(d.micros), inexact: d.inexact })
            }
            /// Rounds to `dp` decimal places (0..=6), staying in micros (10 §4).
            #[inline]
            pub fn round_dp(self, dp: u32, mode: Rounding) -> Result<Self, Overflow> {
                round_micros_dp(self.0, dp, mode).map(Self)
            }
            #[inline]
            pub fn min(self, o: Self) -> Self {
                if self.0 <= o.0 { self } else { o }
            }
            #[inline]
            pub fn max(self, o: Self) -> Self {
                if self.0 >= o.0 { self } else { o }
            }
        }

        impl Add for $name {
            type Output = Self;
            #[inline]
            #[track_caller]
            fn add(self, o: Self) -> Self {
                match self.0.checked_add(o.0) {
                    Some(v) => Self(v),
                    None => overflow_panic(),
                }
            }
        }
        impl Sub for $name {
            type Output = Self;
            #[inline]
            #[track_caller]
            fn sub(self, o: Self) -> Self {
                match self.0.checked_sub(o.0) {
                    Some(v) => Self(v),
                    None => overflow_panic(),
                }
            }
        }
        impl Neg for $name {
            type Output = Self;
            #[inline]
            #[track_caller]
            fn neg(self) -> Self {
                match self.0.checked_neg() {
                    Some(v) => Self(v),
                    None => overflow_panic(),
                }
            }
        }
        impl AddAssign for $name {
            #[inline]
            #[track_caller]
            fn add_assign(&mut self, o: Self) {
                *self = *self + o;
            }
        }
        impl SubAssign for $name {
            #[inline]
            #[track_caller]
            fn sub_assign(&mut self, o: Self) {
                *self = *self - o;
            }
        }
        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}({})", stringify!($name), format_micros(self.0))
            }
        }
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&format_micros(self.0))
            }
        }
    };
}

fixed_type!(
    /// USDC per share, 1e-6 units; valid range `0..=1_000_000` (10 §2).
    Price
);
fixed_type!(
    /// Shares, 1e-6 units; signed (deltas may be negative).
    Qty
);
fixed_type!(
    /// Collateral (pUSD/USDC), 1e-6 units; signed.
    Usdc
);
fixed_type!(
    /// Dimensionless rate, 1e-6 units (`0.07` = `70_000`).
    Rate
);

impl Price {
    pub const ONE: Price = Price(SCALE);

    /// `1 − price`, the complementary outcome's price.
    #[inline]
    pub fn complement(self) -> Price {
        Price(SCALE - self.0)
    }

    /// `price × qty / 1e6` (R5, R6).
    #[inline]
    pub fn notional(self, qty: Qty, mode: Rounding) -> Result<Usdc, Overflow> {
        mul_div(self.0, qty.0, SCALE, mode).map(Usdc)
    }

    /// True when `self` is a whole multiple of `tick`.
    #[inline]
    pub fn is_on_tick(self, tick: Price) -> bool {
        tick.0 > 0 && self.0 % tick.0 == 0
    }

    /// Snaps to the tick grid with an explicit mode (R3).
    #[inline]
    pub fn to_tick(self, tick: Price, mode: Rounding) -> Result<Price, Overflow> {
        let n = div_round_i128(self.0 as i128, tick.0 as i128, mode)?;
        let v = n.checked_mul(tick.0 as i128).ok_or(Overflow::Range)?;
        i64::try_from(v).map(Price).map_err(|_| Overflow::Range)
    }
}

impl Qty {
    /// Shares bought with `usdc` at `price`: `usdc × 1e6 / price` (R7).
    #[inline]
    pub fn for_collateral(usdc: Usdc, price: Price, mode: Rounding) -> Result<Qty, Overflow> {
        mul_div(usdc.0, SCALE, price.0, mode).map(Qty)
    }

    /// Snaps to a multiple of `step` (R4).
    #[inline]
    pub fn to_step(self, step: Qty, mode: Rounding) -> Result<Qty, Overflow> {
        let n = div_round_i128(self.0 as i128, step.0 as i128, mode)?;
        let v = n.checked_mul(step.0 as i128).ok_or(Overflow::Range)?;
        i64::try_from(v).map(Qty).map_err(|_| Overflow::Range)
    }
}

impl Usdc {
    /// `usdc × rate / 1e6`.
    #[inline]
    pub fn mul_rate(self, rate: Rate, mode: Rounding) -> Result<Usdc, Overflow> {
        mul_div(self.0, rate.0, SCALE, mode).map(Usdc)
    }
}

/// Epoch time in ms, UTC (10 §2). Which clock it is is stated per field (12 §4).
#[repr(transparent)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct TsMs(pub i64);

/// Non-negative duration in ms (10 §2).
#[repr(transparent)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct DurMs(pub i64);

impl TsMs {
    #[inline]
    pub fn checked_add(self, d: DurMs) -> Result<TsMs, Overflow> {
        self.0.checked_add(d.0).map(TsMs).ok_or(Overflow::Range)
    }
    #[inline]
    pub fn checked_sub(self, d: DurMs) -> Result<TsMs, Overflow> {
        self.0.checked_sub(d.0).map(TsMs).ok_or(Overflow::Range)
    }
    /// `self − earlier` as a signed ms difference.
    #[inline]
    pub fn since(self, earlier: TsMs) -> Result<i64, Overflow> {
        self.0.checked_sub(earlier.0).ok_or(Overflow::Range)
    }
}

impl Add<DurMs> for TsMs {
    type Output = TsMs;
    #[inline]
    #[track_caller]
    fn add(self, d: DurMs) -> TsMs {
        match self.0.checked_add(d.0) {
            Some(v) => TsMs(v),
            None => overflow_panic(),
        }
    }
}

impl Sub<DurMs> for TsMs {
    type Output = TsMs;
    #[inline]
    #[track_caller]
    fn sub(self, d: DurMs) -> TsMs {
        match self.0.checked_sub(d.0) {
            Some(v) => TsMs(v),
            None => overflow_panic(),
        }
    }
}

impl fmt::Display for TsMs {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl fmt::Display for DurMs {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

fn from_f64_micros(v: f64, mode: Rounding) -> Result<i64, NonFinite> {
    if !v.is_finite() {
        return Err(NonFinite);
    }
    let scaled = v * SCALE as f64;
    let r = match mode {
        Rounding::Floor => scaled.floor(),
        Rounding::Ceil => scaled.ceil(),
        Rounding::TowardZero => scaled.trunc(),
        // `f64::round` rounds half away from zero, exactly.
        Rounding::HalfAwayFromZero => scaled.round(),
    };
    // 2^63 is exactly representable; anything at or above it is out of range.
    if !(-9_223_372_036_854_775_808.0..9_223_372_036_854_775_808.0).contains(&r) {
        return Err(NonFinite);
    }
    Ok(r as i64)
}

fn round_micros_dp(micros: i64, dp: u32, mode: Rounding) -> Result<i64, Overflow> {
    if dp >= 6 {
        return Ok(micros);
    }
    let step = 10i64.pow(6 - dp);
    let n = div_round_i128(micros as i128, step as i128, mode)?;
    i64::try_from(n * step as i128).map_err(|_| Overflow::Range)
}

/// Formats micros as an exact decimal: no exponent, no `-0`, trailing zeros
/// trimmed (`530000` → `0.53`, `0` → `0`).
pub fn format_micros(micros: i64) -> String {
    let neg = micros < 0;
    let abs = micros.unsigned_abs();
    let int = abs / SCALE as u64;
    let frac = abs % SCALE as u64;
    let mut s = String::with_capacity(24);
    if neg {
        s.push('-');
    }
    s.push_str(&int.to_string());
    if frac != 0 {
        let f = format!("{frac:06}");
        s.push('.');
        s.push_str(f.trim_end_matches('0'));
    }
    s
}

/// Formats micros with exactly `dp` decimals (0..=6) after the value is
/// already on that grid; returns `None` if it is not (R-3: never re-round).
pub fn format_micros_dp(micros: i64, dp: u32) -> Option<String> {
    let dp = dp.min(6);
    let step = 10i64.pow(6 - dp);
    if micros % step != 0 {
        return None;
    }
    let neg = micros < 0;
    let abs = micros.unsigned_abs();
    let int = abs / SCALE as u64;
    let frac = (abs % SCALE as u64) / step as u64;
    let mut s = String::with_capacity(24);
    if neg && abs != 0 {
        s.push('-');
    }
    s.push_str(&int.to_string());
    if dp > 0 {
        s.push('.');
        s.push_str(&format!("{:0width$}", frac, width = dp as usize));
    }
    Some(s)
}

/// Result of an exact decimal parse.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Decimal<T> {
    pub value: T,
    /// More than 6 significant fractional digits were rounded
    /// `HalfAwayFromZero` (diagnostic counter `inexact_decimal`, T6).
    pub inexact: bool,
}

/// Decimal text that is not a JSON number or does not fit in `i64` micros.
#[derive(Copy, Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum DecimalError {
    #[error("not a decimal number")]
    Syntax,
    #[error("decimal out of range")]
    Range,
}

/// Parsed micros of a decimal text.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct DecimalMicros {
    pub micros: i64,
    pub inexact: bool,
}

/// Parses the full JSON number grammar (sign, digits, fraction, exponent)
/// into micros. Up to 6 fractional digits are exact; more are rounded
/// `HalfAwayFromZero` and flagged `inexact` (T6, R1). Leading `+`, a bare
/// `.5`, and surrounding whitespace are rejected like JSON does.
pub fn parse_decimal(s: &str) -> Result<DecimalMicros, DecimalError> {
    let b = s.as_bytes();
    let mut i = 0usize;
    let neg = if b.first() == Some(&b'-') {
        i += 1;
        true
    } else {
        false
    };
    // Significant digits kept in an i128 (up to 36), the rest are sticky.
    const KEEP: u32 = 36;
    let mut mant: i128 = 0;
    let mut kept: u32 = 0;
    let mut sticky = false;
    let mut exp10: i64 = 0; // value = mant × 10^exp10 (before sign)
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        push_digit(
            b[i],
            &mut mant,
            &mut kept,
            &mut sticky,
            &mut exp10,
            false,
            KEEP,
        );
        i += 1;
    }
    let int_len = i - int_start;
    if int_len == 0 || (int_len > 1 && b[int_start] == b'0') {
        return Err(DecimalError::Syntax);
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let frac_start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            push_digit(
                b[i],
                &mut mant,
                &mut kept,
                &mut sticky,
                &mut exp10,
                true,
                KEEP,
            );
            i += 1;
        }
        if i == frac_start {
            return Err(DecimalError::Syntax);
        }
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        let eneg = match b.get(i) {
            Some(b'-') => {
                i += 1;
                true
            }
            Some(b'+') => {
                i += 1;
                false
            }
            _ => false,
        };
        let e_start = i;
        let mut e: i64 = 0;
        while i < b.len() && b[i].is_ascii_digit() {
            e = (e * 10 + (b[i] - b'0') as i64).min(1_000_000);
            i += 1;
        }
        if i == e_start {
            return Err(DecimalError::Syntax);
        }
        exp10 += if eneg { -e } else { e };
    }
    if i != b.len() {
        return Err(DecimalError::Syntax);
    }
    // micros = mant × 10^(exp10 + 6)
    let shift = exp10 + 6;
    let (abs, inexact) = if mant == 0 {
        (0i128, sticky)
    } else if shift >= 0 {
        if shift > 38 {
            return Err(DecimalError::Range);
        }
        let v = mant
            .checked_mul(10i128.pow(shift as u32))
            .ok_or(DecimalError::Range)?;
        (v, sticky)
    } else {
        let down = -shift;
        if down > 38 {
            // Far below one micro: rounds to zero (a tie is impossible).
            (0, true)
        } else {
            let den = 10i128.pow(down as u32);
            let q = mant / den;
            let r = mant % den;
            // Kept digits decide; sticky digits cannot move an integer
            // remainder below half to at-or-above half (den is even).
            let q = if r * 2 >= den { q + 1 } else { q };
            (q, r != 0 || sticky)
        }
    };
    let signed = if neg { -abs } else { abs };
    let micros = i64::try_from(signed).map_err(|_| DecimalError::Range)?;
    Ok(DecimalMicros { micros, inexact })
}

#[inline]
fn push_digit(
    d: u8,
    mant: &mut i128,
    kept: &mut u32,
    sticky: &mut bool,
    exp10: &mut i64,
    fractional: bool,
    keep: u32,
) {
    let v = (d - b'0') as i128;
    if *kept < keep {
        *mant = *mant * 10 + v;
        if *mant != 0 {
            *kept += 1;
        }
        if fractional {
            *exp10 -= 1;
        }
    } else {
        if v != 0 {
            *sticky = true;
        }
        if !fractional {
            *exp10 += 1;
        }
    }
}

/// Total order helper for sorting money values in tests and reports.
#[inline]
pub fn cmp_micros(a: i64, b: i64) -> Ordering {
    a.cmp(&b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_modes() {
        use Rounding::*;
        let cases: &[(i128, i128, Rounding, i128)] = &[
            (7, 2, Floor, 3),
            (-7, 2, Floor, -4),
            (7, 2, Ceil, 4),
            (-7, 2, Ceil, -3),
            (7, 2, TowardZero, 3),
            (-7, 2, TowardZero, -3),
            (5, 2, HalfAwayFromZero, 3),
            (-5, 2, HalfAwayFromZero, -3),
            (4, 3, HalfAwayFromZero, 1),
            (-4, 3, HalfAwayFromZero, -1),
            (5, 3, HalfAwayFromZero, 2),
            (7, -2, Floor, -4),
        ];
        for &(n, d, m, want) in cases {
            assert_eq!(div_round_i128(n, d, m).unwrap(), want, "{n}/{d} {m:?}");
        }
        assert_eq!(div_round_i128(1, 0, Floor), Err(Overflow::DivisionByZero));
    }

    // spec: 10 R-1, §4 Q3 (exact values, 2 dp half away from zero)
    #[test]
    fn output_ties_round_away_from_zero() {
        let cases = [
            (-1_005_000, -1_010_000),
            (-125_000, -130_000),
            (1_005_000, 1_010_000),
            (1_015_000, 1_020_000),
            (285_000, 290_000),
            (-2_675_000, -2_680_000),
        ];
        for (x, want) in cases {
            assert_eq!(
                Usdc::from_micros(x)
                    .round_dp(2, Rounding::HalfAwayFromZero)
                    .unwrap()
                    .micros(),
                want
            );
        }
        assert_eq!(format_micros_dp(-1_010_000, 2).unwrap(), "-1.01");
        assert_eq!(format_micros_dp(0, 2).unwrap(), "0.00");
        assert_eq!(format_micros_dp(1_234_500, 4).unwrap(), "1.2345");
        assert_eq!(format_micros_dp(1_234_567, 4), None);
    }

    #[test]
    fn named_products() {
        let p = Price::from_micros(530_000);
        assert_eq!(
            p.notional(Qty::from_micros(10_000_000), Rounding::Floor)
                .unwrap(),
            Usdc::from_micros(5_300_000)
        );
        assert_eq!(
            Qty::for_collateral(
                Usdc::from_micros(1_000_000),
                Price::from_micros(300_000),
                Rounding::Floor
            )
            .unwrap(),
            Qty::from_micros(3_333_333)
        );
        assert_eq!(
            Usdc::from_micros(1_000_000)
                .mul_rate(Rate::from_micros(70_000), Rounding::Ceil)
                .unwrap(),
            Usdc::from_micros(70_000)
        );
        assert_eq!(
            Qty::for_collateral(Usdc::from_micros(1), Price::ZERO, Rounding::Floor),
            Err(Overflow::DivisionByZero)
        );
        assert_eq!(
            Price::from_micros(535_000)
                .to_tick(Price::from_micros(10_000), Rounding::Floor)
                .unwrap()
                .micros(),
            530_000
        );
        assert_eq!(
            Price::from_micros(535_000)
                .to_tick(Price::from_micros(10_000), Rounding::Ceil)
                .unwrap()
                .micros(),
            540_000
        );
    }

    #[test]
    fn checked_ops_panic_with_typed_payload() {
        let r = std::panic::catch_unwind(|| Usdc::MAX + Usdc::from_micros(1));
        let payload = r.unwrap_err();
        assert_eq!(payload.downcast_ref::<Overflow>(), Some(&Overflow::Range));
        assert_eq!(
            Usdc::MAX.checked_add(Usdc::from_micros(1)),
            Err(Overflow::Range)
        );
    }

    // spec: 10 T6
    #[test]
    fn decimal_parse() {
        let p = |s: &str| parse_decimal(s).map(|d| (d.micros, d.inexact));
        assert_eq!(p("0.53"), Ok((530_000, false)));
        assert_eq!(p("12"), Ok((12_000_000, false)));
        assert_eq!(p("-0.000001"), Ok((-1, false)));
        assert_eq!(p("1e-7"), Ok((0, true)));
        assert_eq!(p("5e-7"), Ok((1, true)));
        assert_eq!(p("-5e-7"), Ok((-1, true)));
        assert_eq!(p("1E-6"), Ok((1, false)));
        assert_eq!(p("1.5e3"), Ok((1_500_000_000, false)));
        assert_eq!(p("0.30000000000000004"), Ok((300_000, true)));
        assert_eq!(p("0.0000015"), Ok((2, true)));
        assert_eq!(p("0.0000025"), Ok((3, true)));
        assert_eq!(
            p("0.00000149999999999999999999999999999999999999"),
            Ok((1, true))
        );
        assert_eq!(p("0"), Ok((0, false)));
        assert_eq!(p("-0"), Ok((0, false)));
        for bad in [
            "", "-", ".5", "+1", "01", "1.", "1e", "1e+", " 1", "1 ", "0x10", "NaN",
        ] {
            assert_eq!(p(bad), Err(DecimalError::Syntax), "{bad:?}");
        }
        assert_eq!(p("1e30"), Err(DecimalError::Range));
    }

    #[test]
    fn float_conversion() {
        assert_eq!(
            Price::from_f64(0.5349999, Rounding::HalfAwayFromZero)
                .unwrap()
                .micros(),
            535_000
        );
        assert_eq!(Price::from_f64(f64::NAN, Rounding::Floor), Err(NonFinite));
        assert_eq!(Usdc::from_f64(1e300, Rounding::Floor), Err(NonFinite));
    }

    #[test]
    fn formatting() {
        assert_eq!(format_micros(530_000), "0.53");
        assert_eq!(format_micros(0), "0");
        assert_eq!(format_micros(-1), "-0.000001");
        assert_eq!(format_micros(12_000_000), "12");
    }
}
