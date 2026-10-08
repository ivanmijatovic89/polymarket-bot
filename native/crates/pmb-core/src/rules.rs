//! Exchange rules and taker fees.
//!
//! Two profiles exist (see GOAL.md):
//! - [`ProfileKind::TsCompat`] reproduces the TypeScript engine (hardcoded
//!   700 bps crypto fee, 4 dp rounding, no tick / min-size validation, GTD
//!   offset 60 s, no batch cap in the backtest).
//! - [`ProfileKind::Realistic`] follows the Polymarket docs: the fee comes from
//!   the market's dated `feeSchedule`, rounded to 5 dp; orders are validated
//!   against tick size, min size and price bounds; GTD needs a 3 min lead and
//!   expires 60 s early; batches are capped at 15.

use crate::fixed::{Price, Qty, Round, Usdc, SCALE};
use crate::model::{ExchangeRules, FeeSchedule, OrderRequest, OrderType, TsMs};
use serde::{Deserialize, Serialize};

/// Which engine behavior to reproduce.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProfileKind {
    /// Today's TypeScript behavior, quirks included (parity proof only).
    #[default]
    TsCompat,
    /// Documented exchange behavior.
    Realistic,
}

/// TS `POLYMARKET_CRYPTO_TAKER_FEE_BPS`.
pub const TS_CRYPTO_TAKER_FEE_BPS: i64 = 700;
/// Polymarket's documented max orders per batch request.
pub const POLYMARKET_MAX_BATCH: usize = 15;

/// How a taker fee is computed. Makers never pay.
///
/// `fee = shares × rate × (p × (1 − p))^exponent`, rounded half-up to
/// `round_dp` decimals; a fee that rounds to zero is zero (this is also the
/// "minimum fee" rule: 0.0001 at 4 dp, 0.00001 at 5 dp).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FeeModel {
    None,
    Curve {
        /// Rate in 1e-6 units (0.07 → 70_000).
        rate_micros: i64,
        exponent: u32,
        round_dp: u32,
    },
}

impl FeeModel {
    /// TS: 700 bps, exponent 1, 4 dp.
    pub const fn ts_compat() -> FeeModel {
        FeeModel::Curve {
            rate_micros: TS_CRYPTO_TAKER_FEE_BPS * 100,
            exponent: 1,
            round_dp: 4,
        }
    }

    /// Builds the model from a market fee schedule. Non-integer exponents are
    /// rounded to the nearest integer (all published schedules use 1 or 2).
    pub fn from_schedule(s: Option<&FeeSchedule>) -> FeeModel {
        match s {
            None => FeeModel::None,
            Some(s) if s.rate <= 0.0 => FeeModel::None,
            Some(s) => FeeModel::Curve {
                rate_micros: (s.rate * SCALE as f64).round() as i64,
                exponent: s.exponent.round().clamp(0.0, 8.0) as u32,
                round_dp: s.round_dp.min(6),
            },
        }
    }

    /// Taker fee in USDC for `size` shares at `price`.
    pub fn taker_fee(&self, price: Price, size: Qty) -> Usdc {
        match *self {
            FeeModel::None => Usdc::ZERO,
            FeeModel::Curve {
                rate_micros,
                exponent,
                round_dp,
            } => curve_fee(price, size, rate_micros, exponent, round_dp),
        }
    }
}

/// Exact integer evaluation of `size × rate × (p(1−p))^e`, rounded half-up
/// to `dp` decimals. Intermediate values are kept in 1e-12 USDC units.
fn curve_fee(price: Price, size: Qty, rate_micros: i64, exponent: u32, dp: u32) -> Usdc {
    let p = price.micros() as i128;
    let s = SCALE as i128;
    if rate_micros <= 0 || size.micros() <= 0 || p <= 0 || p >= s {
        return Usdc::ZERO;
    }
    // p(1-p) in 1e-12 units.
    let base = p * (s - p);
    // rate × size in 1e-12 USDC units.
    let mut acc = rate_micros as i128 * size.micros() as i128;
    for _ in 0..exponent {
        acc = acc * base / 1_000_000_000_000;
    }
    let unit = 10i128.pow(12 - dp.min(6));
    let rounded_units = (acc + unit / 2) / unit; // half-up (acc >= 0)
    Usdc::from_micros((rounded_units * 10i128.pow(6 - dp.min(6))) as i64)
}

/// Worst-case USDC needed to buy `size` at `price` (notional + taker fee
/// unless post-only). Used for capital reservation.
pub fn buy_commitment(fee: &FeeModel, price: Price, size: Qty, post_only: bool) -> Usdc {
    if !size.is_positive() {
        return Usdc::ZERO;
    }
    let notional = price.notional(size, Round::Nearest);
    if post_only {
        notional
    } else {
        notional + fee.taker_fee(price, size)
    }
}

/// One dated row of a market family's rules.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct DatedRules {
    /// Applies to markets starting at or after this time (epoch ms, UTC).
    pub from_ms: TsMs,
    pub fee: Option<FeeSchedule>,
    /// Hold applied to marketable orders before matching (0 = none).
    pub taker_delay_ms: i64,
}

/// 2026-01-05T00:00:00Z.
pub const CRYPTO_FEES_START_MS: TsMs = 1_767_571_200_000;
/// 2026-03-30T00:00:00Z.
pub const CRYPTO_FEES_V2_MS: TsMs = 1_774_828_800_000;

/// Crypto up/down (5m / 15m) schedule, oldest first.
///
/// - Before 2026-01-05: no taker fee.
/// - 2026-01-05 .. 2026-03-30: rate 0.25, exponent 2. Source: third-party
///   reports of the launch schedule (not in the current Polymarket docs).
/// - From 2026-03-30: rate 0.07, exponent 1 (docs.polymarket.com/trading/fees,
///   checked 2026-07-28 per `src/trading/fees.ts`).
///
/// `taker_delay_ms` is 0 everywhere: the delay value for marketable crypto
/// orders is not verified yet. The simulator supports it; set it here (or
/// override `ExchangeRules::taker_delay_ms`) once confirmed.
pub const CRYPTO_UPDOWN_SCHEDULE: &[DatedRules] = &[
    DatedRules {
        from_ms: i64::MIN,
        fee: None,
        taker_delay_ms: 0,
    },
    DatedRules {
        from_ms: CRYPTO_FEES_START_MS,
        fee: Some(FeeSchedule {
            rate: 0.25,
            exponent: 2.0,
            taker_only: true,
            round_dp: 5,
        }),
        taker_delay_ms: 0,
    },
    DatedRules {
        from_ms: CRYPTO_FEES_V2_MS,
        fee: Some(FeeSchedule {
            rate: 0.07,
            exponent: 1.0,
            taker_only: true,
            round_dp: 5,
        }),
        taker_delay_ms: 0,
    },
];

/// The schedule row in force for a market starting at `market_start_ms`.
pub fn dated_rules(schedule: &[DatedRules], market_start_ms: TsMs) -> Option<&DatedRules> {
    schedule.iter().rev().find(|r| market_start_ms >= r.from_ms)
}

pub const TICK_001: Price = Price::from_micros(10_000);

impl ExchangeRules {
    /// Rules as the TS backtest applies them: 0.01 tick (unused), no min size,
    /// no batch cap, 700 bps / 4 dp fee, GTD min offset 60 s, no taker delay.
    pub fn ts_compat() -> ExchangeRules {
        ExchangeRules {
            tick_size: TICK_001,
            min_order_size: Qty::ZERO,
            max_batch: usize::MAX,
            fee: Some(FeeSchedule {
                rate: TS_CRYPTO_TAKER_FEE_BPS as f64 / 10_000.0,
                exponent: 1.0,
                taker_only: true,
                round_dp: 4,
            }),
            taker_delay_ms: 0,
            gtd_min_lead_ms: 60_000,
            gtd_early_expiry_ms: 0,
        }
    }

    /// Documented rules for a crypto up/down market starting at `market_start_ms`.
    /// `min_order_size` should come from the market's Gamma metadata when known
    /// (5 shares is the common value).
    pub fn crypto_updown(market_start_ms: TsMs, min_order_size: Qty) -> ExchangeRules {
        let row = dated_rules(CRYPTO_UPDOWN_SCHEDULE, market_start_ms);
        ExchangeRules {
            tick_size: TICK_001,
            min_order_size,
            max_batch: POLYMARKET_MAX_BATCH,
            fee: row.and_then(|r| r.fee),
            taker_delay_ms: row.map_or(0, |r| r.taker_delay_ms),
            gtd_min_lead_ms: 180_000,
            gtd_early_expiry_ms: 60_000,
        }
    }

    /// Rules for `profile`.
    pub fn for_profile(
        profile: ProfileKind,
        market_start_ms: TsMs,
        min_order_size: Qty,
    ) -> ExchangeRules {
        match profile {
            ProfileKind::TsCompat => ExchangeRules::ts_compat(),
            ProfileKind::Realistic => ExchangeRules::crypto_updown(market_start_ms, min_order_size),
        }
    }

    pub fn fee_model(&self) -> FeeModel {
        FeeModel::from_schedule(self.fee.as_ref())
    }

    /// Lowest valid limit price.
    pub fn min_price(&self) -> Price {
        self.tick_size
    }

    /// Highest valid limit price.
    pub fn max_price(&self) -> Price {
        Price::ONE - self.tick_size
    }
}

/// Exchange-side order validation (realistic profile only; the TS engine
/// does none of this).
pub fn validate_against_rules(rules: &ExchangeRules, req: &OrderRequest) -> Result<(), String> {
    if !req.price.on_tick(rules.tick_size) {
        return Err(format!(
            "invalid_tick_size(price={},tick={})",
            req.price, rules.tick_size
        ));
    }
    if req.price < rules.min_price() || req.price > rules.max_price() {
        return Err(format!(
            "price_out_of_bounds(price={},min={},max={})",
            req.price,
            rules.min_price(),
            rules.max_price()
        ));
    }
    // Market-style orders (FOK/FAK) are sized in collateral for BUYs on the
    // exchange; the min-size rule applies to resting limit orders.
    if req.order_type.can_rest() && req.size < rules.min_order_size {
        return Err(format!(
            "size_below_min(size={},min={})",
            req.size, rules.min_order_size
        ));
    }
    if req.order_type == OrderType::Gtd && req.expire_at_ms.is_none() {
        return Err("gtd_requires_expireAtMs".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(v: f64) -> Price {
        Price::from_f64(v)
    }
    fn q(v: f64) -> Qty {
        Qty::from_f64(v)
    }

    #[test]
    fn ts_fee_matches_documented_curve_and_4dp_rounding() {
        let f = FeeModel::ts_compat();
        // 0.07 * 0.5 * 0.5 * 100 = 1.75
        assert_eq!(f.taker_fee(p(0.5), q(100.0)), Usdc::from_f64(1.75));
        // 0.07 * 0.6 * 0.4 * 800 = 13.44 (TS capital test: 493.44 reservation)
        assert_eq!(f.taker_fee(p(0.6), q(800.0)), Usdc::from_f64(13.44));
        // symmetric
        assert_eq!(f.taker_fee(p(0.3), q(7.0)), f.taker_fee(p(0.7), q(7.0)));
        // zero at bounds / invalid
        assert_eq!(f.taker_fee(p(0.0), q(7.0)), Usdc::ZERO);
        assert_eq!(f.taker_fee(p(1.0), q(7.0)), Usdc::ZERO);
        assert_eq!(f.taker_fee(p(0.5), Qty::ZERO), Usdc::ZERO);
        // 0.07*0.01*0.99*0.1 = 0.0000693 -> rounds to 0.0001
        assert_eq!(f.taker_fee(p(0.01), q(0.1)), Usdc::from_f64(0.0001));
        // 0.07*0.01*0.99*0.05 = 0.00003465 -> below min -> 0
        assert_eq!(f.taker_fee(p(0.01), q(0.05)), Usdc::ZERO);
        // 0.07*0.53*0.47*10 = 0.17437 -> 0.1744
        assert_eq!(f.taker_fee(p(0.53), q(10.0)), Usdc::from_f64(0.1744));
    }

    #[test]
    fn realistic_fee_uses_dated_schedule_and_5dp() {
        let before = ExchangeRules::crypto_updown(CRYPTO_FEES_START_MS - 1, q(5.0));
        assert_eq!(before.fee_model(), FeeModel::None);
        assert_eq!(before.fee_model().taker_fee(p(0.5), q(100.0)), Usdc::ZERO);

        let v1 = ExchangeRules::crypto_updown(CRYPTO_FEES_START_MS, q(5.0));
        // 100 * 0.25 * (0.25)^2 = 1.5625
        assert_eq!(v1.fee_model().taker_fee(p(0.5), q(100.0)), Usdc::from_f64(1.5625));
        // 10 * 0.25 * (0.53*0.47)^2 = 0.15512... -> 5 dp
        let fee = v1.fee_model().taker_fee(p(0.53), q(10.0)).to_f64();
        let expected = (10.0f64 * 0.25 * (0.53f64 * 0.47).powi(2) * 1e5).round() / 1e5;
        assert!((fee - expected).abs() < 1e-9, "{fee} vs {expected}");

        let v2 = ExchangeRules::crypto_updown(CRYPTO_FEES_V2_MS + 1, q(5.0));
        // 10 * 0.07 * 0.2491 = 0.17437 (5 dp keeps it)
        assert_eq!(v2.fee_model().taker_fee(p(0.53), q(10.0)), Usdc::from_f64(0.17437));
        assert_eq!(v2.max_batch, 15);
        assert_eq!(v2.gtd_min_lead_ms, 180_000);
        assert_eq!(v2.gtd_early_expiry_ms, 60_000);
    }

    #[test]
    fn buy_commitment_includes_fee_unless_post_only() {
        let f = FeeModel::ts_compat();
        assert_eq!(buy_commitment(&f, p(0.6), q(800.0), false), Usdc::from_f64(493.44));
        assert_eq!(buy_commitment(&f, p(0.6), q(800.0), true), Usdc::from_f64(480.0));
        assert_eq!(buy_commitment(&f, p(0.6), Qty::ZERO, false), Usdc::ZERO);
    }

    #[test]
    fn rules_validation() {
        let r = ExchangeRules::crypto_updown(CRYPTO_FEES_V2_MS, q(5.0));
        let mut req = OrderRequest {
            client_order_id: crate::model::ClientOrderId::new("a"),
            asset_id: crate::model::AssetId::new("1"),
            side: crate::model::Side::Buy,
            price: p(0.53),
            size: q(5.0),
            order_type: OrderType::Gtc,
            post_only: false,
            expire_at_ms: None,
            meta: None,
            reason: None,
        };
        assert!(validate_against_rules(&r, &req).is_ok());
        req.price = p(0.535);
        assert!(validate_against_rules(&r, &req)
            .unwrap_err()
            .starts_with("invalid_tick_size"));
        req.price = p(0.995);
        assert!(validate_against_rules(&r, &req).is_err());
        req.price = p(0.99);
        req.size = q(4.99);
        assert!(validate_against_rules(&r, &req)
            .unwrap_err()
            .starts_with("size_below_min"));
        req.order_type = OrderType::Fak;
        assert!(validate_against_rules(&r, &req).is_ok());
    }
}
