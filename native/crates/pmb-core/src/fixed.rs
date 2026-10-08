//! Fixed-point money and quantities.
//!
//! Every price, share quantity and USDC amount is an integer count of
//! 1e-6 units (Polymarket's on-chain base unit). Floats appear only at the
//! edges (JSON params, feed prices, analytics).

use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::{Add, AddAssign, Neg, Sub, SubAssign};

pub const SCALE: i64 = 1_000_000;

macro_rules! fixed_type {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[derive(Copy, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub i64);

        impl $name {
            pub const ZERO: Self = Self(0);
            pub const fn from_micros(m: i64) -> Self { Self(m) }
            pub const fn micros(self) -> i64 { self.0 }
            /// Rounds to the nearest micro unit (half away from zero).
            pub fn from_f64(v: f64) -> Self { Self((v * SCALE as f64).round() as i64) }
            pub fn to_f64(self) -> f64 { self.0 as f64 / SCALE as f64 }
            pub fn is_zero(self) -> bool { self.0 == 0 }
            pub fn is_positive(self) -> bool { self.0 > 0 }
            pub fn abs(self) -> Self { Self(self.0.abs()) }
            pub fn min(self, o: Self) -> Self { if self.0 <= o.0 { self } else { o } }
            pub fn max(self, o: Self) -> Self { if self.0 >= o.0 { self } else { o } }
        }
        impl Add for $name { type Output = Self; fn add(self, o: Self) -> Self { Self(self.0 + o.0) } }
        impl Sub for $name { type Output = Self; fn sub(self, o: Self) -> Self { Self(self.0 - o.0) } }
        impl Neg for $name { type Output = Self; fn neg(self) -> Self { Self(-self.0) } }
        impl AddAssign for $name { fn add_assign(&mut self, o: Self) { self.0 += o.0 } }
        impl SubAssign for $name { fn sub_assign(&mut self, o: Self) { self.0 -= o.0 } }
        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "{}({})", stringify!($name), self.to_f64()) }
        }
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "{}", self.to_f64()) }
        }
    };
}

fixed_type!(
    /// Price of one share in USDC (0..=1), 1e-6 units.
    Price
);
fixed_type!(
    /// Share quantity, 1e-6 units.
    Qty
);
fixed_type!(
    /// USDC amount, 1e-6 units.
    Usdc
);

/// Rounding used when an exact product is not representable.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Round {
    Down,
    Up,
    Nearest,
}

fn div_round(num: i128, den: i128, r: Round) -> i64 {
    let q = num.div_euclid(den);
    let rem = num.rem_euclid(den);
    let out = match r {
        Round::Down => q,
        Round::Up => {
            if rem == 0 {
                q
            } else {
                q + 1
            }
        }
        Round::Nearest => {
            if rem * 2 >= den {
                q + 1
            } else {
                q
            }
        }
    };
    out as i64
}

impl Price {
    pub const ONE: Price = Price(SCALE);
    /// `1 - price` (the complementary outcome price).
    pub fn complement(self) -> Price {
        Price(SCALE - self.0)
    }
    /// Notional of `qty` shares at this price.
    pub fn notional(self, qty: Qty, r: Round) -> Usdc {
        Usdc(div_round(self.0 as i128 * qty.0 as i128, SCALE as i128, r))
    }
    /// True if this price is an exact multiple of `tick`.
    pub fn on_tick(self, tick: Price) -> bool {
        tick.0 > 0 && self.0 % tick.0 == 0
    }
}

impl Qty {
    /// Shares purchasable with `usdc` at `price`.
    pub fn for_usdc(usdc: Usdc, price: Price, r: Round) -> Qty {
        if price.0 <= 0 {
            return Qty::ZERO;
        }
        Qty(div_round(usdc.0 as i128 * SCALE as i128, price.0 as i128, r))
    }
    /// Truncates to a multiple of `step` (e.g. 0.01 shares).
    pub fn floor_to(self, step: Qty) -> Qty {
        if step.0 <= 0 {
            return self;
        }
        Qty(self.0.div_euclid(step.0) * step.0)
    }
}

impl Usdc {
    /// Rounds to `dp` decimal places (dp <= 6).
    pub fn round_dp(self, dp: u32, r: Round) -> Usdc {
        let step = 10i64.pow(6 - dp.min(6));
        Usdc(div_round(self.0 as i128, step as i128, r) * step)
    }
    /// Multiplies by a rate expressed in basis points.
    pub fn mul_bps(self, bps: i64, r: Round) -> Usdc {
        Usdc(div_round(self.0 as i128 * bps as i128, 10_000, r))
    }
}

/// Parses a decimal string ("0.53", "12", "1e-3" not supported) into micro units.
pub fn parse_micros(s: &str) -> Option<i64> {
    let s = s.trim();
    let (neg, s) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s),
    };
    let (int, frac) = match s.split_once('.') {
        Some((i, f)) => (i, f),
        None => (s, ""),
    };
    if int.is_empty() && frac.is_empty() {
        return None;
    }
    let mut v: i64 = if int.is_empty() { 0 } else { int.parse().ok()? };
    v = v.checked_mul(SCALE)?;
    let mut frac_v: i64 = 0;
    let mut digits = 0;
    let mut round_up = false;
    for (i, ch) in frac.chars().enumerate() {
        let d = ch.to_digit(10)? as i64;
        if i < 6 {
            frac_v = frac_v * 10 + d;
            digits += 1;
        } else if i == 6 {
            round_up = d >= 5;
        }
    }
    while digits < 6 {
        frac_v *= 10;
        digits += 1;
    }
    v += frac_v + i64::from(round_up);
    Some(if neg { -v } else { v })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_products() {
        assert_eq!(parse_micros("0.53"), Some(530_000));
        assert_eq!(parse_micros("12"), Some(12_000_000));
        assert_eq!(parse_micros(".5"), Some(500_000));
        assert_eq!(parse_micros("0.0000015"), Some(2));
        let p = Price(530_000);
        assert_eq!(p.notional(Qty(10_000_000), Round::Down), Usdc(5_300_000));
        assert_eq!(Qty::for_usdc(Usdc(1_000_000), Price(300_000), Round::Down), Qty(3_333_333));
        assert_eq!(Usdc(123_456).round_dp(4, Round::Nearest), Usdc(123_500));
        assert_eq!(Usdc(123_456).round_dp(5, Round::Nearest), Usdc(123_460));
        assert!(Price(530_000).on_tick(Price(10_000)));
        assert!(!Price(535_000).on_tick(Price(10_000)));
    }
}
