//! Author-facing methods of the value types (30 §6) that the core types do
//! not carry yet. The traits are brought into scope anonymously by the
//! prelude, so `use pmb_sdk::prelude::*;` gives the method syntax of §6
//! (`now.ms_since(t)`, `price.snap(tick, mode)`, `Price::clamp_probability(x)`,
//! `o.opposite()`, `ClientOrderId::indexed("r", n)`); the trait names are
//! not part of the SDK surface (§3).
//!
//! ```
//! use pmb_sdk::prelude::*;
//!
//! let (a, b) = (TsMs(1_000), TsMs(1_250));
//! assert_eq!(a.ms_since(b), -250); // a clock step back is no panic (§5.0)
//! assert_eq!(a.saturating_since(b), DurMs(0));
//! assert_eq!(b.saturating_since(a), DurMs(250));
//!
//! assert_eq!(price!(0.534).snap(price!(0.01), Rounding::Floor), price!(0.53));
//! assert_eq!(Price::clamp_probability(1.2), 1.0);
//! assert_eq!(Outcome::Up.opposite(), Outcome::Down);
//! assert_eq!(ClientOrderId::indexed("r", 7).as_str(), "r7");
//! ```

// D-PENDING: 30 §6 lists ms_since, saturating_since, snap, clamp_probability,
// opposite and indexed as methods of the 10 §2 types, which pmb-core does
// not have; chose SDK extension traits imported anonymously by the prelude,
// to be removed once pmb-core carries them as inherent methods.

use pmb_core::{ClientOrderId, DurMs, Outcome, Price, Rounding, TsMs};

/// `TsMs` time arithmetic of 30 §6. Neither method can panic, whatever the
/// order of its operands: `now()` can step back in ts-compat (§5.0).
pub trait TsMsExt {
    /// `self - earlier` in ms, signed: negative when `self < earlier`
    /// (saturating at the `i64` range).
    fn ms_since(self, earlier: TsMs) -> i64;
    /// `self - earlier` as a duration, clamped at 0 when `self < earlier`.
    fn saturating_since(self, earlier: TsMs) -> DurMs;
}

impl TsMsExt for TsMs {
    #[inline]
    fn ms_since(self, earlier: TsMs) -> i64 {
        self.0.saturating_sub(earlier.0)
    }
    #[inline]
    fn saturating_since(self, earlier: TsMs) -> DurMs {
        crate::__private::dur_ms(self.0.saturating_sub(earlier.0).max(0))
    }
}

// D-PENDING: 30 §6 gives `price.snap(tick, Rounding)` and
// `Price::clamp_probability(f64)` without return types; chose an infallible
// snap that panics on a non-positive tick or overflow (as same-type overflow
// does), and a clamp that stays f64 (no implicit rounding mode, P8).
/// Tick helpers of 30 §6.
pub trait PriceExt {
    /// The multiple of `tick` next to `self` in the direction of `mode`
    /// (`Floor`: at or below, `Ceil`: at or above, `TowardZero`,
    /// `HalfAwayFromZero`: nearest, ties up). Exact integer arithmetic.
    ///
    /// # Panics
    ///
    /// When `tick` is not positive, or on fixed-point overflow (same-type
    /// overflow panics, 30 §6, D18).
    fn snap(self, tick: Price, mode: Rounding) -> Price;

    /// `v` clamped to `[0, 1]`, and `0` when `v` is not finite: TS
    /// `safeProbabilityPrice` (`src/strategy/strategyToolkit.ts:7-10`).
    /// The result stays an `f64`; convert it with
    /// `Price::from_f64(v, Rounding)` and an explicit mode (30 §6, P8).
    fn clamp_probability(v: f64) -> f64;
}

impl PriceExt for Price {
    #[track_caller]
    fn snap(self, tick: Price, mode: Rounding) -> Price {
        assert!(
            tick.micros() > 0,
            "Price::snap: the tick must be positive, got {} micros",
            tick.micros()
        );
        match self.to_tick(tick, mode) {
            Ok(p) => p,
            Err(e) => panic!("Price::snap({}, {}): {e}", self.micros(), tick.micros()),
        }
    }

    fn clamp_probability(v: f64) -> f64 {
        if v.is_finite() {
            v.clamp(0.0, 1.0)
        } else {
            0.0
        }
    }
}

/// `Outcome::opposite` of 30 §6.
pub trait OutcomeExt {
    /// The other outcome: `Up` ↔ `Down`.
    fn opposite(self) -> Outcome;
}

impl OutcomeExt for Outcome {
    #[inline]
    fn opposite(self) -> Outcome {
        self.other()
    }
}

// D-PENDING: 30 §6 names `ClientOrderId::indexed("r", n)` without types;
// chose `(prefix: &str, n: u64) -> ClientOrderId` that panics when the
// result is not a valid cid (a programming error, like overflow).
/// `ClientOrderId::indexed` of 30 §6.
pub trait ClientOrderIdExt {
    /// The cid `{prefix}{n}` (`indexed("r", 7)` is `r7`).
    ///
    /// # Panics
    ///
    /// When the result is not a valid cid (10 §6: 1 to 256 bytes of
    /// printable ASCII), i.e. when `prefix` has a non-printable byte or is
    /// longer than 236 bytes.
    fn indexed(prefix: &str, n: u64) -> ClientOrderId;
}

impl ClientOrderIdExt for ClientOrderId {
    #[track_caller]
    fn indexed(prefix: &str, n: u64) -> ClientOrderId {
        // D-PENDING: 30 §6 forbids allocation for cids of at most 24 bytes;
        // pmb-core's ClientOrderId is a Box<str>, so this allocates once.
        // The text is assembled on the stack.
        let mut buf = [0u8; 20];
        let mut i = buf.len();
        let mut v = n;
        loop {
            i -= 1;
            buf[i] = b'0' + (v % 10) as u8;
            v /= 10;
            if v == 0 {
                break;
            }
        }
        let digits = &buf[i..];
        let mut text = [0u8; pmb_core::ids::CID_MAX_LEN];
        let len = prefix.len() + digits.len();
        assert!(
            len <= text.len(),
            "ClientOrderId::indexed: {prefix:?} + {n} is {len} bytes; a cid has at most 256 (10 §6)"
        );
        text[..prefix.len()].copy_from_slice(prefix.as_bytes());
        text[prefix.len()..len].copy_from_slice(digits);
        // Valid UTF-8: a str followed by ASCII digits.
        let s = std::str::from_utf8(&text[..len]).unwrap_or_default();
        match ClientOrderId::new(s) {
            Ok(c) => c,
            Err(e) => panic!("ClientOrderId::indexed({prefix:?}, {n}): {e} (10 §6)"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // spec: 30 §6 (time arithmetic without a panicking operator), §5.0
    #[test]
    fn time_arithmetic_never_panics() {
        let (a, b) = (TsMs(1_000), TsMs(4_000));
        assert_eq!(b.ms_since(a), 3_000);
        assert_eq!(a.ms_since(b), -3_000);
        assert_eq!(a.ms_since(a), 0);
        assert_eq!(b.saturating_since(a), DurMs(3_000));
        assert_eq!(a.saturating_since(b), DurMs(0));
        assert_eq!(TsMs(i64::MIN).ms_since(TsMs(i64::MAX)), i64::MIN);
        assert_eq!(TsMs(i64::MAX).ms_since(TsMs(i64::MIN)), i64::MAX);
        assert_eq!(TsMs(i64::MIN).saturating_since(TsMs(i64::MAX)), DurMs(0));
        assert_eq!(
            TsMs(i64::MAX).saturating_since(TsMs(i64::MIN)),
            DurMs(i64::MAX)
        );
    }

    // spec: 30 §6 (tick helpers), 10 §3 (rounding modes)
    #[test]
    fn snap_and_clamp() {
        let p = |m: i64| Price::from_micros(m);
        let tick = p(10_000);
        assert_eq!(p(534_000).snap(tick, Rounding::Floor), p(530_000));
        assert_eq!(p(534_000).snap(tick, Rounding::Ceil), p(540_000));
        assert_eq!(
            p(535_000).snap(tick, Rounding::HalfAwayFromZero),
            p(540_000)
        );
        assert_eq!(
            p(534_999).snap(tick, Rounding::HalfAwayFromZero),
            p(530_000)
        );
        assert_eq!(p(539_999).snap(tick, Rounding::TowardZero), p(530_000));
        assert_eq!(p(530_000).snap(tick, Rounding::Ceil), p(530_000));
        assert_eq!(p(999_000).snap(p(1_000), Rounding::Ceil), p(999_000));
        assert!(std::panic::catch_unwind(|| p(1).snap(p(0), Rounding::Floor)).is_err());
        assert!(std::panic::catch_unwind(|| p(1).snap(p(-1), Rounding::Floor)).is_err());

        assert_eq!(Price::clamp_probability(0.53), 0.53);
        assert_eq!(Price::clamp_probability(-0.1), 0.0);
        assert_eq!(Price::clamp_probability(1.5), 1.0);
        assert_eq!(Price::clamp_probability(f64::NAN), 0.0);
        assert_eq!(Price::clamp_probability(f64::INFINITY), 0.0);
        assert_eq!(Price::clamp_probability(f64::NEG_INFINITY), 0.0);
    }

    // spec: 30 §6 (Outcome::opposite, ClientOrderId::indexed)
    #[test]
    fn outcome_and_cid_helpers() {
        assert_eq!(Outcome::Up.opposite(), Outcome::Down);
        assert_eq!(Outcome::Down.opposite(), Outcome::Up);
        assert_eq!(ClientOrderId::indexed("r", 0).as_str(), "r0");
        assert_eq!(ClientOrderId::indexed("r", 42).as_str(), "r42");
        assert_eq!(
            ClientOrderId::indexed("leg-", u64::MAX).as_str(),
            "leg-18446744073709551615"
        );
        assert_eq!(ClientOrderId::indexed("", 5).as_str(), "5");
        let long = "x".repeat(236);
        assert_eq!(ClientOrderId::indexed(&long, u64::MAX).as_str().len(), 256);
        let too_long = "x".repeat(237);
        assert!(std::panic::catch_unwind(|| ClientOrderId::indexed(&too_long, u64::MAX)).is_err());
        assert!(std::panic::catch_unwind(|| ClientOrderId::indexed("tab\t", 1)).is_err());
        assert!(std::panic::catch_unwind(|| ClientOrderId::indexed("é", 1)).is_err());
    }
}
