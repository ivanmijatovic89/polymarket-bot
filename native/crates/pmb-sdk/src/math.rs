//! `f64` math on the pure-Rust `libm` (30 §11): the replacement for the
//! `f64` methods that call the OS libm (`exp`, `ln`, `powf`, trigonometric
//! and hyperbolic functions), whose results may differ between the macOS
//! versions of the fleet (10 §12, 14 P-2). `sqrt`, `abs`, `floor`, `ceil`,
//! `round`, `trunc`, `mul_add`, `powi`, `min` and `max` are exact or
//! IEEE-specified and stay on `f64`.

macro_rules! unary {
    ($($(#[$m:meta])* $name:ident => $libm:ident;)*) => {$(
        $(#[$m])*
        #[inline]
        pub fn $name(x: f64) -> f64 {
            libm::$libm(x)
        }
    )*};
}

unary! {
    /// `e^x` (replaces `f64::exp`).
    exp => exp;
    /// `2^x` (replaces `f64::exp2`).
    exp2 => exp2;
    /// `e^x - 1`, accurate near 0 (replaces `f64::exp_m1`).
    exp_m1 => expm1;
    /// Natural logarithm (replaces `f64::ln`).
    ln => log;
    /// `ln(1 + x)`, accurate near 0 (replaces `f64::ln_1p`).
    ln_1p => log1p;
    /// Base-2 logarithm (replaces `f64::log2`).
    log2 => log2;
    /// Base-10 logarithm (replaces `f64::log10`).
    log10 => log10;
    /// Cube root (replaces `f64::cbrt`).
    cbrt => cbrt;
    sin => sin;
    cos => cos;
    tan => tan;
    asin => asin;
    acos => acos;
    atan => atan;
    sinh => sinh;
    cosh => cosh;
    tanh => tanh;
    asinh => asinh;
    acosh => acosh;
    atanh => atanh;
    /// Error function (no `f64` method exists).
    erf => erf;
    /// Complementary error function.
    erfc => erfc;
}

/// `x^y` (replaces `f64::powf`).
#[inline]
pub fn powf(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}

/// `sqrt(x² + y²)` without overflow (replaces `f64::hypot`).
#[inline]
pub fn hypot(x: f64, y: f64) -> f64 {
    libm::hypot(x, y)
}

/// Four-quadrant arctangent of `y / x` (replaces `f64::atan2`).
#[inline]
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}

/// Logarithm of `x` in `base` (replaces `f64::log`).
#[inline]
pub fn log(x: f64, base: f64) -> f64 {
    libm::log(x) / libm::log(base)
}

/// `(sin x, cos x)` (replaces `f64::sin_cos`).
#[inline]
pub fn sin_cos(x: f64) -> (f64, f64) {
    libm::sincos(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 30 §11 (pure-Rust libm). Bit-exact goldens: a change of the
    // libm implementation that changes a result fails here, before it can
    // change a strategy decision on part of the fleet.
    #[test]
    fn goldens() {
        let cases: &[(f64, u64)] = &[
            // libm 0.2.16 is 1 ulp above the correctly rounded e here; the
            // goldens pin reproducibility, not correct rounding.
            (exp(1.0), 0x4005bf0a8b14576a),
            (exp(-0.5), 0x3fe368b2fc6f960a),
            (ln(2.0), 0x3fe62e42fefa39ef),
            (ln_1p(1e-10), 0x3ddb7cdfd9d1d693),
            (exp_m1(1e-10), 0x3ddb7cdfd9dda4e3),
            (log10(1000.0), 0x4008000000000000),
            (log2(8.0), 0x4008000000000000),
            (powf(2.0, 0.5), 0x3ff6a09e667f3bcd),
            (powf(10.0, -4.0), 0x3f1a36e2eb1c432d),
            (cbrt(27.0), 0x4008000000000000),
            (hypot(3.0, 4.0), 0x4014000000000000),
            (sin(1.0), 0x3feaed548f090cee),
            (cos(1.0), 0x3fe14a280fb5068c),
            (tanh(0.5), 0x3fdd9353d7568af3),
            (atan2(1.0, 1.0), 0x3fe921fb54442d18),
            (erf(0.5), 0x3fe0a7ef5c18edd2),
        ];
        let mut bad = Vec::new();
        for (i, &(got, want)) in cases.iter().enumerate() {
            if got.to_bits() != want {
                bad.push(format!("case {i}: {got:?} = {:#018x}", got.to_bits()));
            }
        }
        assert!(bad.is_empty(), "{}", bad.join("\n"));
        let (s, c) = sin_cos(1.0);
        assert_eq!((s, c), (sin(1.0), cos(1.0)));
        assert_eq!(log(8.0, 2.0), 3.0);
    }
}
