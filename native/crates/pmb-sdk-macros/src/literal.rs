//! Compile-time parsing of numeric literals (30 §6, §9 rule 1).
//!
//! Fixed-point values are computed from the literal's source digits with
//! integer arithmetic only (never through `f64`, 00 R2, 10 §2 T6). A value
//! that is not a whole number of 1e-6 units, or that is outside the type's
//! range (10 §2), is a compile error.

use proc_macro2::{Span, TokenStream};
use quote::{format_ident, quote};
use syn::parse::{Parse, ParseStream};
use syn::{Expr, ExprLit, ExprUnary, Lit, Token, UnOp};

/// Scale of every fixed-point type: 1e6 units per whole unit (10 §2 T4).
pub(crate) const SCALE_DIGITS: u32 = 6;

/// Largest integer magnitude a params value may have, `2^53 - 1`
/// (21 §18 N2); the runtime enforces the same bound (`pmb-sdk` params).
pub(crate) const SAFE_INT: i64 = (1 << 53) - 1;

/// Most significant digits of a fixed-point params value: at most 15
/// survive a round trip through a JSON number (30 §9 rule 6).
pub(crate) const MAX_SIG_DIGITS: u32 = 15;

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

/// The fixed-point scalar types of 10 §2 that literals can produce.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum FixedKind {
    Price,
    Qty,
    Usdc,
    Rate,
}

impl FixedKind {
    pub(crate) fn from_ident(s: &str) -> Option<Self> {
        Some(match s {
            "Price" => FixedKind::Price,
            "Qty" => FixedKind::Qty,
            "Usdc" => FixedKind::Usdc,
            "Rate" => FixedKind::Rate,
            _ => return None,
        })
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            FixedKind::Price => "Price",
            FixedKind::Qty => "Qty",
            FixedKind::Usdc => "Usdc",
            FixedKind::Rate => "Rate",
        }
    }

    /// Valid range in micros (10 §2): `Price` and `Rate` are `0..=1_000_000`,
    /// `Qty` and `Usdc` are signed `i64`.
    pub(crate) fn range(self) -> (i128, i128) {
        match self {
            FixedKind::Price | FixedKind::Rate => (0, 1_000_000),
            FixedKind::Qty | FixedKind::Usdc => (i64::MIN as i128, i64::MAX as i128),
        }
    }

    fn range_text(self) -> &'static str {
        match self {
            FixedKind::Price | FixedKind::Rate => "0 to 1",
            FixedKind::Qty | FixedKind::Usdc => {
                "-9223372036854.775808 to 9223372036854.775807 (i64 micros)"
            }
        }
    }

    /// `::pmb_sdk::__private::<Kind>::from_micros(<micros>)`, usable in const
    /// contexts.
    pub(crate) fn ctor(self, micros: i64) -> TokenStream {
        let ty = format_ident!("{}", self.name());
        quote!(::pmb_sdk::__private::#ty::from_micros(#micros))
    }
}

/// A numeric literal with an optional leading minus sign: `0.53`, `5`,
/// `-1.25`, `1e-3`.
pub(crate) struct NumLit {
    neg: bool,
    lit: Lit,
}

impl Parse for NumLit {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let neg = input.peek(Token![-]);
        if neg {
            input.parse::<Token![-]>()?;
        }
        let lit: Lit = input.parse()?;
        match lit {
            Lit::Int(_) | Lit::Float(_) => Ok(NumLit { neg, lit }),
            other => Err(syn::Error::new(
                other.span(),
                "expected a numeric literal such as 0.53 or 5",
            )),
        }
    }
}

/// Why a decimal literal cannot become a scaled integer.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DecError {
    Syntax,
    /// Not a whole number of `10^-scale` units.
    TooPrecise,
    Range,
}

impl NumLit {
    /// Reads `-0.5` / `0.5` / `5` from an attribute expression.
    pub(crate) fn from_expr(e: &Expr) -> Option<NumLit> {
        match e {
            Expr::Lit(ExprLit {
                lit: lit @ (Lit::Int(_) | Lit::Float(_)),
                ..
            }) => Some(NumLit {
                neg: false,
                lit: lit.clone(),
            }),
            Expr::Unary(ExprUnary {
                op: UnOp::Neg(_),
                expr,
                ..
            }) => match NumLit::from_expr(expr) {
                Some(n) if !n.neg => Some(NumLit { neg: true, ..n }),
                _ => None,
            },
            Expr::Group(g) => NumLit::from_expr(&g.expr),
            Expr::Paren(p) => NumLit::from_expr(&p.expr),
            _ => None,
        }
    }

    pub(crate) fn span(&self) -> Span {
        self.lit.span()
    }

    pub(crate) fn is_float(&self) -> bool {
        matches!(self.lit, Lit::Float(_))
    }

    /// The literal as written, for messages.
    pub(crate) fn source(&self) -> String {
        let raw = match &self.lit {
            Lit::Int(i) => i.to_string(),
            Lit::Float(f) => f.to_string(),
            other => quote!(#other).to_string(),
        };
        if self.neg {
            format!("-{raw}")
        } else {
            raw
        }
    }

    /// Sign and base-10 digits (`1.5e3`, no suffix, no underscores).
    fn digits(&self) -> syn::Result<(bool, String)> {
        let (digits, suffix, raw) = match &self.lit {
            Lit::Int(i) => (
                i.base10_digits().to_owned(),
                i.suffix().to_owned(),
                i.to_string(),
            ),
            Lit::Float(f) => (
                f.base10_digits().to_owned(),
                f.suffix().to_owned(),
                f.to_string(),
            ),
            _ => unreachable!("NumLit holds only numeric literals"),
        };
        if !suffix.is_empty() {
            return Err(syn::Error::new(
                self.span(),
                format!(
                    "remove the type suffix `{suffix}`: write a plain decimal literal such as 0.53"
                ),
            ));
        }
        let unsigned = raw.trim_start_matches('-');
        if ["0x", "0o", "0b"].iter().any(|p| unsigned.starts_with(p)) {
            return Err(syn::Error::new(
                self.span(),
                "use a decimal literal (hex, octal and binary literals are not accepted)",
            ));
        }
        // A literal forwarded through `macro_rules!` may itself be negative.
        match digits.strip_prefix('-') {
            Some(rest) => Ok((!self.neg, rest.to_owned())),
            None => Ok((self.neg, digits)),
        }
    }

    /// The exact value times `10^scale` (fixed point: scale 6).
    pub(crate) fn scaled(&self, scale: u32) -> syn::Result<Result<i128, DecError>> {
        let (neg, digits) = self.digits()?;
        Ok(scaled_decimal(&digits, scale).map(|v| if neg { -v } else { v }))
    }

    /// An integer literal (no fraction, no exponent).
    pub(crate) fn integer(&self) -> syn::Result<i128> {
        if self.is_float() {
            return Err(syn::Error::new(
                self.span(),
                format!("expected an integer literal, got `{}`", self.source()),
            ));
        }
        match self.scaled(0)? {
            Ok(v) => Ok(v),
            Err(_) => Err(syn::Error::new(
                self.span(),
                format!("integer literal `{}` is out of range", self.source()),
            )),
        }
    }

    /// The literal as the nearest `f64` (for `f64` params only; rustc reads
    /// float literals the same way).
    pub(crate) fn to_f64(&self) -> syn::Result<f64> {
        let (neg, digits) = self.digits()?;
        let v: f64 = digits.parse().map_err(|_| {
            syn::Error::new(self.span(), format!("`{}` is not a number", self.source()))
        })?;
        if !v.is_finite() {
            return Err(syn::Error::new(
                self.span(),
                format!("`{}` is not a finite f64", self.source()),
            ));
        }
        Ok(if neg { -v } else { v })
    }

    /// Exact micros of a fixed-point literal, range-checked for `kind`
    /// (10 §2; 30 §6: more than 6 decimals or out of range fails compilation).
    pub(crate) fn fixed_micros(&self, kind: FixedKind) -> syn::Result<i64> {
        let v = match self.scaled(SCALE_DIGITS)? {
            Ok(v) => v,
            Err(DecError::TooPrecise) => {
                return Err(syn::Error::new(
                    self.span(),
                    format!(
                        "`{}` has more than 6 decimal places: {} is fixed point at 1e-6 \
                         (10-domain-model.md §2); round the literal to 6 decimals",
                        self.source(),
                        kind.name()
                    ),
                ))
            }
            Err(DecError::Syntax) => {
                return Err(syn::Error::new(
                    self.span(),
                    format!(
                        "`{}` is not a decimal literal; write digits with an optional \
                         fraction and exponent, such as 0.53 or 5e-3",
                        self.source()
                    ),
                ))
            }
            Err(DecError::Range) => i128::MAX,
        };
        let (lo, hi) = kind.range();
        if v < lo || v > hi {
            return Err(syn::Error::new(
                self.span(),
                format!(
                    "`{}` is out of range for {}: expected a value from {}",
                    self.source(),
                    kind.name(),
                    kind.range_text()
                ),
            ));
        }
        Ok(v as i64)
    }

    /// Tokens of the literal without suffix: `5`, `-5`.
    pub(crate) fn int_tokens(&self) -> TokenStream {
        let lit = &self.lit;
        if self.neg {
            quote!(-#lit)
        } else {
            quote!(#lit)
        }
    }
}

/// Parses decimal digits (`12`, `0.53`, `2.`, `1.5e-3`) into
/// `value × 10^scale`, exactly. Leading and trailing zeros are not
/// significant: they never overflow the mantissa (`0.5000…0` with any
/// number of zeros is `0.5`).
pub(crate) fn scaled_decimal(text: &str, scale: u32) -> Result<i128, DecError> {
    let b = text.as_bytes();
    let mut i = 0;
    let mut digits: Vec<u8> = Vec::with_capacity(b.len());
    let mut frac_digits: i64 = 0;
    while i < b.len() && b[i].is_ascii_digit() {
        digits.push(b[i] - b'0');
        i += 1;
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            digits.push(b[i] - b'0');
            frac_digits += 1;
            i += 1;
        }
    }
    if digits.is_empty() {
        return Err(DecError::Syntax);
    }
    let mut exp: i64 = 0;
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        let neg = match b.get(i) {
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
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            exp = (exp * 10 + (b[i] - b'0') as i64).min(100_000);
            i += 1;
        }
        if i == start {
            return Err(DecError::Syntax);
        }
        if neg {
            exp = -exp;
        }
    }
    if i != b.len() {
        return Err(DecError::Syntax);
    }
    // value = digits × 10^exp10; trailing zeros move into the exponent.
    let mut exp10 = exp - frac_digits;
    while digits.last() == Some(&0) {
        digits.pop();
        exp10 += 1;
    }
    let Some(first) = digits.iter().position(|&d| d != 0) else {
        return Ok(0);
    };
    let sig = &digits[first..];
    let shift = exp10 + scale as i64;
    if shift < 0 {
        // The last significant digit is below 10^-scale.
        return Err(DecError::TooPrecise);
    }
    if sig.len() as i64 + shift > 38 {
        return Err(DecError::Range);
    }
    // At most 38 digits: fits an i128.
    let mant = sig.iter().fold(0i128, |m, &d| m * 10 + d as i128);
    mant.checked_mul(10i128.pow(shift as u32))
        .ok_or(DecError::Range)
}

/// Formats a value scaled by 1e6 as an exact decimal (`530000` → `0.53`).
pub(crate) fn format_micros(v: i128) -> String {
    let neg = v < 0;
    let abs = v.unsigned_abs();
    let int = abs / 1_000_000;
    let frac = abs % 1_000_000;
    let mut s = String::new();
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

/// Formats an `f64` the way the runtime normalizes it (shortest round-trip,
/// no exponent, `-0` → `0`; 30 §9 table).
pub(crate) fn format_f64(v: f64) -> String {
    if v == 0.0 {
        "0".to_owned()
    } else {
        format!("{v}")
    }
}

/// Tokens of an `f64` value as an unsuffixed literal (with a leading `-`).
pub(crate) fn f64_tokens(v: f64) -> TokenStream {
    let lit = proc_macro2::Literal::f64_unsuffixed(v.abs());
    if v.is_sign_negative() && v != 0.0 {
        quote!(-#lit)
    } else {
        quote!(#lit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 30 §6 (exact decimal literals), 10 §2 T6
    #[test]
    fn scaled_decimal_is_exact() {
        assert_eq!(scaled_decimal("0.53", 6), Ok(530_000));
        assert_eq!(scaled_decimal("12", 6), Ok(12_000_000));
        assert_eq!(scaled_decimal("2.", 6), Ok(2_000_000));
        assert_eq!(scaled_decimal("0.000001", 6), Ok(1));
        assert_eq!(scaled_decimal("0.5300000", 6), Ok(530_000));
        assert_eq!(scaled_decimal("1e-6", 6), Ok(1));
        assert_eq!(scaled_decimal("1.5E3", 6), Ok(1_500_000_000));
        assert_eq!(scaled_decimal("0.0000001", 6), Err(DecError::TooPrecise));
        assert_eq!(scaled_decimal("1e-7", 6), Err(DecError::TooPrecise));
        assert_eq!(scaled_decimal("1e40", 6), Err(DecError::Range));
        assert_eq!(scaled_decimal("0", 6), Ok(0));
        assert_eq!(scaled_decimal("0.0e999", 6), Ok(0));
        assert_eq!(scaled_decimal("", 6), Err(DecError::Syntax));
        assert_eq!(scaled_decimal("1e", 6), Err(DecError::Syntax));
        assert_eq!(
            scaled_decimal("9223372036854.775807", 6),
            Ok(i64::MAX as i128)
        );
        // Insignificant zeros never overflow the mantissa.
        assert_eq!(
            scaled_decimal("0.50000000000000000000000000000000000000000", 6),
            Ok(500_000)
        );
        assert_eq!(
            scaled_decimal("0000000000000000000000000000000000000000001", 6),
            Ok(1_000_000)
        );
        assert_eq!(
            scaled_decimal("1000000000000000000000000000000000000000e-40", 6),
            Ok(100_000)
        );
        assert_eq!(
            scaled_decimal("1.0000000000000000000000000000000000000001", 6),
            Err(DecError::TooPrecise)
        );
        assert_eq!(
            scaled_decimal("100000000000000000000000000000000000000001", 6),
            Err(DecError::Range)
        );
        assert_eq!(scaled_decimal("1e-100000000", 6), Err(DecError::TooPrecise));
        assert_eq!(scaled_decimal("1e100000000", 6), Err(DecError::Range));
        assert_eq!(scaled_decimal(".", 6), Err(DecError::Syntax));
    }

    #[test]
    fn formats() {
        assert_eq!(format_micros(530_000), "0.53");
        assert_eq!(format_micros(-1), "-0.000001");
        assert_eq!(format_micros(5_000_000), "5");
        assert_eq!(format_f64(-0.0), "0");
        assert_eq!(format_f64(20.0), "20");
        assert_eq!(format_f64(1e-7), "0.0000001");
    }
}
