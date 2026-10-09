//! Exact decimal arithmetic for the spec tables.
//!
//! The spec defines fees (11 §5.2 FC3) and output quantization (10 §4) in
//! exact decimal with one `HalfAwayFromZero` rounding. This tiny arbitrary
//! precision decimal (digit vector plus scale) lets the tests evaluate those
//! formulas exactly, without `f64` and without an external crate.

use std::cmp::Ordering;
use std::fmt;

/// Rounding modes of 10 §3.1. There is deliberately no "half toward +∞"
/// (R-1: that is JS `Math.round`, which MUST NOT be emulated).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rounding {
    Floor,
    Ceil,
    TowardZero,
    HalfAwayFromZero,
}

/// `(-1)^neg × mant × 10^-scale`, `mant` little-endian base-10 digits.
#[derive(Clone, Debug)]
pub struct Dec {
    neg: bool,
    mant: Vec<u8>,
    scale: u32,
}

impl Dec {
    /// Parses plain decimal text: optional sign, digits, optional fraction.
    /// No exponent (the spec's job JSON forbids it, 21 §6.1; T6 exponent
    /// acceptance is a separate engine rule and is not needed for tables).
    pub fn parse(text: &str) -> Dec {
        let (neg, rest) = match text.strip_prefix('-') {
            Some(r) => (true, r),
            None => (false, text),
        };
        let (int, frac) = match rest.split_once('.') {
            Some((a, b)) => (a, b),
            None => (rest, ""),
        };
        assert!(
            !int.is_empty() || !frac.is_empty(),
            "empty decimal {text:?}"
        );
        assert!(
            int.chars().all(|c| c.is_ascii_digit()) && frac.chars().all(|c| c.is_ascii_digit()),
            "not a plain decimal: {text:?}"
        );
        let mut mant: Vec<u8> = int
            .bytes()
            .chain(frac.bytes())
            .rev()
            .map(|b| b - b'0')
            .collect();
        trim(&mut mant);
        Dec {
            neg: neg && !mant.is_empty(),
            mant,
            scale: frac.len() as u32,
        }
    }

    pub fn from_i64(v: i64) -> Dec {
        Dec::parse(&v.to_string())
    }

    pub fn is_zero(&self) -> bool {
        self.mant.is_empty()
    }

    pub fn is_negative(&self) -> bool {
        self.neg
    }

    pub fn mul(&self, other: &Dec) -> Dec {
        let mut out = vec![0u32; self.mant.len() + other.mant.len() + 1];
        for (i, a) in self.mant.iter().enumerate() {
            for (j, b) in other.mant.iter().enumerate() {
                out[i + j] += (*a as u32) * (*b as u32);
            }
        }
        let mut carry = 0u32;
        let mut mant = Vec::with_capacity(out.len());
        for v in out {
            let t = v + carry;
            mant.push((t % 10) as u8);
            carry = t / 10;
        }
        assert_eq!(carry, 0);
        trim(&mut mant);
        Dec {
            neg: (self.neg != other.neg) && !mant.is_empty(),
            mant,
            scale: self.scale + other.scale,
        }
    }

    pub fn pow(&self, n: u32) -> Dec {
        let mut acc = Dec::parse("1");
        for _ in 0..n {
            acc = acc.mul(self);
        }
        acc
    }

    pub fn add(&self, other: &Dec) -> Dec {
        let scale = self.scale.max(other.scale);
        let a = self.rescaled(scale);
        let b = other.rescaled(scale);
        if a.neg == b.neg {
            let mut mant = add_mag(&a.mant, &b.mant);
            trim(&mut mant);
            Dec {
                neg: a.neg && !mant.is_empty(),
                mant,
                scale,
            }
        } else {
            match cmp_mag(&a.mant, &b.mant) {
                Ordering::Equal => Dec {
                    neg: false,
                    mant: vec![],
                    scale,
                },
                Ordering::Greater => {
                    let mut mant = sub_mag(&a.mant, &b.mant);
                    trim(&mut mant);
                    Dec {
                        neg: a.neg,
                        mant,
                        scale,
                    }
                }
                Ordering::Less => {
                    let mut mant = sub_mag(&b.mant, &a.mant);
                    trim(&mut mant);
                    Dec {
                        neg: b.neg,
                        mant,
                        scale,
                    }
                }
            }
        }
    }

    pub fn sub(&self, other: &Dec) -> Dec {
        self.add(&other.neg())
    }

    pub fn neg(&self) -> Dec {
        Dec {
            neg: !self.neg && !self.mant.is_empty(),
            mant: self.mant.clone(),
            scale: self.scale,
        }
    }

    /// Same value with at least `scale` fractional digits.
    fn rescaled(&self, scale: u32) -> Dec {
        assert!(scale >= self.scale);
        let extra = (scale - self.scale) as usize;
        let mut mant = vec![0u8; extra];
        mant.extend_from_slice(&self.mant);
        if self.mant.is_empty() {
            mant.clear();
        }
        Dec {
            neg: self.neg,
            mant,
            scale,
        }
    }

    /// One rounding step to `dp` fractional digits (10 R-3: exactly one).
    pub fn round(&self, dp: u32, mode: Rounding) -> Dec {
        if self.scale <= dp {
            return self.rescaled(dp);
        }
        let dropped = (self.scale - dp) as usize;
        let kept: Vec<u8> = self.mant.iter().skip(dropped).copied().collect();
        let dropped_digits: Vec<u8> = self.mant.iter().take(dropped).copied().collect();
        let dropped_nonzero = dropped_digits.iter().any(|d| *d != 0);
        let first_dropped = dropped_digits.last().copied().unwrap_or(0); // most significant dropped digit
        let round_away = match mode {
            Rounding::Floor => dropped_nonzero && self.neg,
            Rounding::Ceil => dropped_nonzero && !self.neg,
            Rounding::TowardZero => false,
            Rounding::HalfAwayFromZero => first_dropped >= 5,
        };
        let mut mant = kept;
        if round_away {
            mant = add_mag(&mant, &[1]);
        }
        trim(&mut mant);
        Dec {
            neg: self.neg && !mant.is_empty(),
            mant,
            scale: dp,
        }
    }

    /// Numeric comparison.
    pub fn cmp_num(&self, other: &Dec) -> Ordering {
        let scale = self.scale.max(other.scale);
        let a = self.rescaled(scale);
        let b = other.rescaled(scale);
        match (a.neg, b.neg) {
            (false, true) => Ordering::Greater,
            (true, false) => Ordering::Less,
            (false, false) => cmp_mag(&a.mant, &b.mant),
            (true, true) => cmp_mag(&b.mant, &a.mant),
        }
    }

    pub fn eq_num(&self, other: &Dec) -> bool {
        self.cmp_num(other) == Ordering::Equal
    }

    /// Exact decimal text with exactly `self.scale` fractional digits, no
    /// exponent, no `-0` (10 Q2).
    pub fn to_plain(&self) -> String {
        let mut digits: Vec<u8> = self.mant.clone();
        while (digits.len() as u32) <= self.scale {
            digits.push(0);
        }
        let mut s = String::new();
        if self.neg && !self.mant.is_empty() {
            s.push('-');
        }
        // Little-endian: the first `scale` digits are the fraction.
        let scale = self.scale as usize;
        let int_part: String = digits[scale..]
            .iter()
            .rev()
            .map(|d| (b'0' + d) as char)
            .collect();
        s.push_str(&int_part);
        if scale > 0 {
            s.push('.');
            let frac: String = digits[..scale]
                .iter()
                .rev()
                .map(|d| (b'0' + d) as char)
                .collect();
            s.push_str(&frac);
        }
        s
    }

    /// Value in 1e-6 units when it is representable there exactly.
    pub fn to_micros(&self) -> Option<i64> {
        if self.scale > 6 {
            let r = self.round(6, Rounding::TowardZero);
            if !r.eq_num(self) {
                return None;
            }
            return r.to_micros();
        }
        let r = self.rescaled(6);
        let mut v: i64 = 0;
        for d in r.mant.iter().rev() {
            v = v.checked_mul(10)?.checked_add(*d as i64)?;
        }
        Some(if r.neg { -v } else { v })
    }
}

impl fmt::Display for Dec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_plain())
    }
}

fn trim(mant: &mut Vec<u8>) {
    while mant.last() == Some(&0) {
        mant.pop();
    }
}

fn add_mag(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(a.len().max(b.len()) + 1);
    let mut carry = 0u8;
    for i in 0..a.len().max(b.len()) {
        let t = a.get(i).copied().unwrap_or(0) + b.get(i).copied().unwrap_or(0) + carry;
        out.push(t % 10);
        carry = t / 10;
    }
    if carry > 0 {
        out.push(carry);
    }
    out
}

/// `a - b` for `a >= b` in magnitude.
fn sub_mag(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(a.len());
    let mut borrow = 0i8;
    for i in 0..a.len() {
        let mut t = a[i] as i8 - b.get(i).copied().unwrap_or(0) as i8 - borrow;
        if t < 0 {
            t += 10;
            borrow = 1;
        } else {
            borrow = 0;
        }
        out.push(t as u8);
    }
    assert_eq!(borrow, 0);
    out
}

fn cmp_mag(a: &[u8], b: &[u8]) -> Ordering {
    let la = a.iter().rposition(|d| *d != 0).map_or(0, |p| p + 1);
    let lb = b.iter().rposition(|d| *d != 0).map_or(0, |p| p + 1);
    if la != lb {
        return la.cmp(&lb);
    }
    for i in (0..la).rev() {
        if a[i] != b[i] {
            return a[i].cmp(&b[i]);
        }
    }
    Ordering::Equal
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_print() {
        assert_eq!(Dec::parse("0.07").to_plain(), "0.07");
        assert_eq!(Dec::parse("-1.005").to_plain(), "-1.005");
        assert_eq!(Dec::parse("5").to_plain(), "5");
        assert_eq!(Dec::parse("-0").to_plain(), "0");
    }

    #[test]
    fn mul_and_round() {
        let p = Dec::parse("0.53");
        let q = Dec::parse("10");
        assert_eq!(p.mul(&q).to_plain(), "5.30");
        let one_minus = Dec::parse("1").sub(&p);
        assert_eq!(one_minus.to_plain(), "0.47");
        let v = Dec::parse("1.005").round(2, Rounding::HalfAwayFromZero);
        assert_eq!(v.to_plain(), "1.01");
        let v = Dec::parse("-1.005").round(2, Rounding::HalfAwayFromZero);
        assert_eq!(v.to_plain(), "-1.01");
        let v = Dec::parse("-1.004").round(2, Rounding::HalfAwayFromZero);
        assert_eq!(v.to_plain(), "-1.00");
        assert_eq!(
            Dec::parse("0.0000003").round(6, Rounding::Ceil).to_plain(),
            "0.000001"
        );
        assert_eq!(
            Dec::parse("0.0000003")
                .round(6, Rounding::HalfAwayFromZero)
                .to_plain(),
            "0.000000"
        );
        assert_eq!(
            Dec::parse("-0.0000003")
                .round(6, Rounding::Floor)
                .to_plain(),
            "-0.000001"
        );
        assert_eq!(
            Dec::parse("-0.0000003")
                .round(6, Rounding::TowardZero)
                .to_plain(),
            "0.000000"
        );
    }

    #[test]
    fn micros() {
        assert_eq!(Dec::parse("5.4744").to_micros(), Some(5_474_400));
        assert_eq!(Dec::parse("-0.000001").to_micros(), Some(-1));
        assert_eq!(Dec::parse("0.0000005").to_micros(), None);
    }
}
