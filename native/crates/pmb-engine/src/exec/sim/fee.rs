//! Fee models (13 §4.4 `FeeModel`): `Fee700Bps4dp` (13 §5.1, TC-E7) and the
//! seam for the realistic per-market fee curve (13 §6.9, M3b). The fee of a
//! fill is computed once here and carried by `Fill.fee` (12 §9.5, 10 §9.1).

use pmb_core::fill::Liquidity;
use pmb_core::rules::{ExchangeRules, FeeCurve};
use pmb_core::{Price, Qty, Usdc};

/// Fee per fill, reservation fee and fee bound (13 §4.4).
pub trait FeeModel {
    /// Fee of one fill (13 §4.5 unit) of `qty` shares at `price` as
    /// `liquidity`, under the rules in force at the match.
    fn fill_fee(&self, rules: &ExchangeRules, liquidity: Liquidity, price: Price, qty: Qty)
        -> Usdc;
    /// Fee part of a share-sized BUY reservation at the limit price
    /// (10 §9.4 C1, R9); 0 for post-only resting orders.
    fn reservation_fee(
        &self,
        rules: &ExchangeRules,
        limit: Price,
        qty: Qty,
        post_only: bool,
    ) -> Usdc;
}

/// `models.fee = flat_700bps_4dp` (13 §5.1, TC-E7; 11 §4): `0.07 × p ×
/// (1 − p) × size` from the exact integer value, rounded once
/// `HalfAwayFromZero` to 4 dp; a result below 0.0001 is 0 (10 R8). Every
/// TAKER fill pays, MAKER fills pay 0, on every date. JS float tie behavior
/// is not emulated (R1): exact 4-dp ties may differ from TS by 0.0001
/// (standing parity entry PE-R3, 60 §3.5).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct Fee700Bps4dp;

impl Fee700Bps4dp {
    /// The curve of 11 §4: symmetric, 700 bps, exponent 1, 4 dp.
    pub const CURVE: FeeCurve = FeeCurve::TS_COMPAT;

    /// The ts-compat taker fee of `qty` at `price` (10 R8). `HalfAwayFromZero`
    /// to 4 dp already maps every value below 0.00005 to 0 and every value in
    /// `[0.00005, 0.0001)` to the 0.0001 minimum, so the TS floor
    /// (`src/trading/fees.ts:18-24`: round, then `< 0.0001 → 0`) needs no
    /// second step. Zero for `price ∉ (0, 1)` or `qty ≤ 0`.
    pub fn taker_fee(price: Price, qty: Qty) -> Usdc {
        // A ts-compat fill is bounded by recorded sizes in micros; the
        // `i128` product cannot overflow for any `i64` qty at p ∈ (0, 1).
        Self::CURVE
            .taker_fee(price, qty)
            .expect("ts-compat fee fits i128 for every i64 quantity")
    }
}

impl FeeModel for Fee700Bps4dp {
    #[inline]
    fn fill_fee(
        &self,
        _rules: &ExchangeRules,
        liquidity: Liquidity,
        price: Price,
        qty: Qty,
    ) -> Usdc {
        match liquidity {
            Liquidity::Taker => Self::taker_fee(price, qty),
            Liquidity::Maker => Usdc::ZERO,
        }
    }

    /// 700 bps at the limit price unless post-only, even when the order will
    /// rest (11 §4, `src/trading/capital.ts:16-28`).
    #[inline]
    fn reservation_fee(
        &self,
        _rules: &ExchangeRules,
        limit: Price,
        qty: Qty,
        post_only: bool,
    ) -> Usdc {
        if post_only {
            Usdc::ZERO
        } else {
            Self::taker_fee(limit, qty)
        }
    }
}

/// The fee axis (13 §7.3 `models.fee`), enum-dispatched (13 §4.4).
/// `schedule` (13 §6.9) is added with the realistic profile in M3b.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Fees {
    /// `flat_700bps_4dp`.
    Flat700Bps4Dp(Fee700Bps4dp),
}

impl FeeModel for Fees {
    #[inline]
    fn fill_fee(
        &self,
        rules: &ExchangeRules,
        liquidity: Liquidity,
        price: Price,
        qty: Qty,
    ) -> Usdc {
        match self {
            Fees::Flat700Bps4Dp(m) => m.fill_fee(rules, liquidity, price, qty),
        }
    }
    #[inline]
    fn reservation_fee(
        &self,
        rules: &ExchangeRules,
        limit: Price,
        qty: Qty,
        post_only: bool,
    ) -> Usdc {
        match self {
            Fees::Flat700Bps4Dp(m) => m.reservation_fee(rules, limit, qty, post_only),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Price {
        Price::parse_decimal(s).expect("price").value
    }
    fn q(s: &str) -> Qty {
        Qty::parse_decimal(s).expect("qty").value
    }
    fn usdc(s: &str) -> Usdc {
        Usdc::parse_decimal(s).expect("usdc").value
    }

    #[test]
    fn converted_fees_test_ts_curve() {
        // spec: 13 §5.1 TC-E7, 11 §4; converted from src/trading/fees.test.ts (60 §7.3)
        let f = Fee700Bps4dp::taker_fee;
        assert_eq!(f(p("0.5"), q("1")), usdc("0.0175"));
        assert_eq!(f(p("0.5"), q("100")), usdc("1.75"));
        assert_eq!(f(p("0.3"), q("1")), usdc("0.0147"));
        assert_eq!(f(p("0.3"), q("100")), usdc("1.47"));
        assert_eq!(f(p("0.05"), q("1")), usdc("0.0033"));
        assert_eq!(f(p("0.05"), q("100")), usdc("0.3325"));
    }

    #[test]
    fn converted_fees_test_symmetry() {
        // spec: 11 §4 (symmetric curve); fees.test.ts "fee is symmetric"
        for c in ["0.05", "0.1", "0.2", "0.3", "0.4", "0.45"] {
            let a = p(c);
            assert_eq!(
                Fee700Bps4dp::taker_fee(a, q("100")),
                Fee700Bps4dp::taker_fee(a.complement(), q("100")),
                "asymmetric at p={c}"
            );
        }
    }

    #[test]
    fn converted_fees_test_bounds_and_floor() {
        // spec: 10 R8 (4 dp HalfAwayFromZero; < 0.0001 → 0); fees.test.ts bounds and floor
        let f = Fee700Bps4dp::taker_fee;
        assert_eq!(f(p("0"), q("100")), Usdc::ZERO);
        assert_eq!(f(p("1"), q("100")), Usdc::ZERO);
        assert_eq!(f(Price::from_micros(-100_000), q("100")), Usdc::ZERO);
        assert_eq!(f(p("1.1"), q("100")), Usdc::ZERO);
        assert_eq!(f(p("0.123"), q("7")), usdc("0.0529"));
        assert_eq!(f(p("0.5"), q("0.005")), usdc("0.0001"));
        assert_eq!(f(p("0.5"), q("0.002")), Usdc::ZERO);
        assert_eq!(f(p("0.5"), Qty::ZERO), Usdc::ZERO);
        assert_eq!(f(p("0.5"), Qty::from_micros(-1)), Usdc::ZERO);
    }

    #[test]
    fn maker_pays_zero_and_reservation_skips_post_only() {
        // spec: 13 §5.1 TC-E7 (MAKER fills pay 0; reservation at the limit, 0 if post-only)
        let r = ExchangeRules::ts_compat();
        let m = Fees::Flat700Bps4Dp(Fee700Bps4dp);
        assert_eq!(
            m.fill_fee(&r, Liquidity::Maker, p("0.5"), q("10")),
            Usdc::ZERO
        );
        assert_eq!(
            m.fill_fee(&r, Liquidity::Taker, p("0.5"), q("10")),
            usdc("0.175")
        );
        assert_eq!(
            m.reservation_fee(&r, p("0.5"), q("10"), false),
            usdc("0.175")
        );
        assert_eq!(m.reservation_fee(&r, p("0.5"), q("10"), true), Usdc::ZERO);
    }

    #[test]
    fn exact_ties_round_half_away_from_zero() {
        // spec: 10 R8 (exact value, one HalfAwayFromZero step), 60 §3.5 PE-R3
        // p = 0.50, C = 10.02: 0.07 × 0.25 × 10.02 = 0.17535 exactly → 0.1754.
        assert_eq!(
            Fee700Bps4dp::taker_fee(p("0.5"), q("10.02")),
            usdc("0.1754")
        );
    }
}
