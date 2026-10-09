//! Exchange rules (11-exchange-rules.md §3–§12, §13.3 RS4, §13.5, §14).
//!
//! `ExchangeRules` is the `Copy`, heap-free set of rules in force at one
//! exchange time; `RulesTimeline` holds the initial rules plus dated changes
//! and is read through a forward-only [`RulesCursor`] (X1). Everything here
//! is a pure function or constant data; the dated tables exist only in the
//! engine (X2) and are versioned by [`RulesTableVersion`].

use crate::fixed::{
    div_round_i128, format_micros, DurMs, Overflow, Price, Qty, Rate, Rounding, TsMs, Usdc, SCALE,
};
use crate::market::MarketVersion;
use crate::order::{OrderRequest, OrderSize, OrderType, Side};
use crate::outcome::{Outcome, PerOutcome};
use std::fmt;

// ---------------------------------------------------------------------------
// Versions, provenance, verification (§13.3, §13.5, §14)
// ---------------------------------------------------------------------------

/// Version of everything compiled from 11: dated tables, fallback values,
/// constants, the FE3 mapping and the RS4 required-field set (§13.5).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum RulesTableVersion {
    V1,
}

impl RulesTableVersion {
    /// Every version this binary compiles (VR4), oldest first.
    pub const ALL: [RulesTableVersion; 1] = [RulesTableVersion::V1];

    pub const fn as_str(self) -> &'static str {
        match self {
            RulesTableVersion::V1 => "rules-table-v1",
        }
    }

    /// Unknown versions are refused (`invalid_input`).
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "rules-table-v1" => Some(RulesTableVersion::V1),
            _ => None,
        }
    }
}

/// Per-market provenance class (RS4): `snapshot | partial | fallback`.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum RulesSource {
    Snapshot,
    Partial,
    Fallback,
}

impl RulesSource {
    pub const fn as_str(self) -> &'static str {
        match self {
            RulesSource::Snapshot => "snapshot",
            RulesSource::Partial => "partial",
            RulesSource::Fallback => "fallback",
        }
    }
    /// D21's `rulesSource=fallback` flag: anything but `Snapshot`.
    pub const fn is_flagged(self) -> bool {
        !matches!(self, RulesSource::Snapshot)
    }
}

/// Snapshot origin (§13.1).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Origin {
    Gamma,
    Clob,
    V4Bootstrap,
    LiveGamma,
    LiveClob,
}

impl Origin {
    pub const fn as_str(self) -> &'static str {
        match self {
            Origin::Gamma => "gamma",
            Origin::Clob => "clob",
            Origin::V4Bootstrap => "v4_bootstrap",
            Origin::LiveGamma => "live_gamma",
            Origin::LiveClob => "live_clob",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "gamma" => Origin::Gamma,
            "clob" => Origin::Clob,
            "v4_bootstrap" => Origin::V4Bootstrap,
            "live_gamma" => Origin::LiveGamma,
            "live_clob" => Origin::LiveClob,
            _ => return None,
        })
    }
}

/// Snapshot phase relative to the market start (§13.1).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Phase {
    PreStart,
    PostStart,
}

impl Phase {
    pub const fn as_str(self) -> &'static str {
        match self {
            Phase::PreStart => "pre_start",
            Phase::PostStart => "post_start",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pre_start" => Some(Phase::PreStart),
            "post_start" => Some(Phase::PostStart),
            _ => None,
        }
    }
}

/// Where one rules field came from (RS4).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum FieldSource {
    Captured { origin: Origin, phase: Phase },
    Fallback { table: RulesTableVersion },
}

/// The RS4 required fields of §13.4, in table order.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum RequiredField {
    Tick,
    MinSizeResting,
    Fee,
    TakerDelayEnabled,
    NegRisk,
    Version,
}

impl RequiredField {
    pub const ALL: [RequiredField; 6] = [
        RequiredField::Tick,
        RequiredField::MinSizeResting,
        RequiredField::Fee,
        RequiredField::TakerDelayEnabled,
        RequiredField::NegRisk,
        RequiredField::Version,
    ];
}

/// Per-field provenance of one market's rules (§13.3).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct RulesProvenance {
    /// Indexed by [`RequiredField`] as `usize`.
    pub fields: [FieldSource; 6],
    /// Whether any non-required field (`secondsDelay`, `minOrderAgeS`,
    /// `acceptingOrdersTimestampMs`) was captured.
    pub optional_captured: bool,
}

impl RulesProvenance {
    #[inline]
    pub fn field(&self, f: RequiredField) -> FieldSource {
        self.fields[f as usize]
    }

    /// RS4 classification: `Snapshot` iff every required field is captured
    /// `pre_start`; `Fallback` iff no field is captured; else `Partial`.
    pub fn source(&self) -> RulesSource {
        let mut all_pre = true;
        let mut any = self.optional_captured;
        for f in self.fields {
            match f {
                FieldSource::Captured { phase, .. } => {
                    any = true;
                    all_pre &= phase == Phase::PreStart;
                }
                FieldSource::Fallback { .. } => all_pre = false,
            }
        }
        if all_pre {
            RulesSource::Snapshot
        } else if any {
            RulesSource::Partial
        } else {
            RulesSource::Fallback
        }
    }

    /// Every field from the dated fallback of `table`.
    pub const fn all_fallback(table: RulesTableVersion) -> Self {
        RulesProvenance {
            fields: [FieldSource::Fallback { table }; 6],
            optional_captured: false,
        }
    }
}

/// Verification status of a rule value (§14).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Verification {
    Charged,
    Observed,
    Changelog,
    Docs,
    ThirdParty,
    Assumed,
}

/// Rule ids of the verification registry (§14).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum RuleId {
    FeeF0,
    FeeF1,
    FeeF2,
    FeeF3,
    FeeRounding,
    FeeGranularity,
    FillAmounts,
    DelayD0,
    DelayD1,
    DelayD2,
    DelayD3,
    DelayD4,
    DelayD5,
    DelayResponse,
    GtdLead,
    GtdEarly,
    TickBounds,
    TickChange,
    MinResting,
    MinMarket,
    MarketBuyCollateral,
    PostOnlyCross,
    BatchCap,
    CancelCap,
    MarketClosed,
    SelfTrade,
}

impl RuleId {
    pub const fn as_str(self) -> &'static str {
        match self {
            RuleId::FeeF0 => "fee.f0",
            RuleId::FeeF1 => "fee.f1",
            RuleId::FeeF2 => "fee.f2",
            RuleId::FeeF3 => "fee.f3",
            RuleId::FeeRounding => "fee.rounding",
            RuleId::FeeGranularity => "fee.granularity",
            RuleId::FillAmounts => "fill.amounts",
            RuleId::DelayD0 => "delay.d0",
            RuleId::DelayD1 => "delay.d1",
            RuleId::DelayD2 => "delay.d2",
            RuleId::DelayD3 => "delay.d3",
            RuleId::DelayD4 => "delay.d4",
            RuleId::DelayD5 => "delay.d5",
            RuleId::DelayResponse => "delay.response",
            RuleId::GtdLead => "gtd.lead",
            RuleId::GtdEarly => "gtd.early",
            RuleId::TickBounds => "tick.bounds",
            RuleId::TickChange => "tick.change",
            RuleId::MinResting => "min.resting",
            RuleId::MinMarket => "min.market",
            RuleId::MarketBuyCollateral => "market_buy.collateral",
            RuleId::PostOnlyCross => "post_only.cross",
            RuleId::BatchCap => "batch.cap",
            RuleId::CancelCap => "cancel.cap",
            RuleId::MarketClosed => "market.closed",
            RuleId::SelfTrade => "self_trade",
        }
    }

    /// Status today (rules-table-v1). Where §14 lists two sources the
    /// weaker one is returned.
    pub const fn verification(self) -> Verification {
        use Verification::*;
        match self {
            RuleId::FeeF0 | RuleId::FeeF1 | RuleId::FeeF2 => Changelog,
            RuleId::FeeF3 => Docs,
            RuleId::FeeRounding | RuleId::FeeGranularity | RuleId::FillAmounts => Assumed,
            RuleId::DelayD0 | RuleId::DelayD1 | RuleId::DelayD2 | RuleId::DelayD3 => ThirdParty,
            RuleId::DelayD4 | RuleId::DelayD5 => Changelog,
            RuleId::DelayResponse => Assumed,
            RuleId::GtdLead | RuleId::GtdEarly => Docs,
            RuleId::TickBounds => Assumed,
            RuleId::TickChange => Observed,
            RuleId::MinResting => Docs,
            RuleId::MinMarket => Assumed,
            RuleId::MarketBuyCollateral | RuleId::PostOnlyCross => Docs,
            RuleId::BatchCap | RuleId::CancelCap => Changelog,
            RuleId::MarketClosed => Assumed,
            RuleId::SelfTrade => Docs,
        }
    }

    /// Listed in `unverifiedRules` when touched (§13.8, §14): `ThirdParty`,
    /// `Assumed`, or flagged `unverified` (every fee row until FS, §5.3).
    pub const fn is_unverified(self) -> bool {
        matches!(
            self,
            RuleId::FeeF0 | RuleId::FeeF1 | RuleId::FeeF2 | RuleId::FeeF3
        ) || matches!(
            self.verification(),
            Verification::ThirdParty | Verification::Assumed
        )
    }
}

// ---------------------------------------------------------------------------
// Fees (§5)
// ---------------------------------------------------------------------------

/// Fee curve family (§5.1). `rate` in 1e-6 units, `exponent` ≤ 4, `dp` ≤ 6.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum FeeCurve {
    None,
    /// Era 1: `fee = C × p × rate × (p(1−p))^exponent`.
    PriceWeighted {
        rate: Rate,
        exponent: u8,
        dp: u8,
    },
    /// Current (`crypto_fees_v2`): `fee = C × rate × (p(1−p))^exponent`.
    Symmetric {
        rate: Rate,
        exponent: u8,
        dp: u8,
    },
}

/// Maximum fee exponent accepted from a snapshot (FE3).
pub const MAX_FEE_EXPONENT: u8 = 4;

const E12: i128 = 1_000_000_000_000;

impl FeeCurve {
    /// The ts-compat fee of §4: 700 bps, exponent 1, 4 dp, every date.
    pub const TS_COMPAT: FeeCurve = FeeCurve::Symmetric {
        rate: Rate::from_micros(70_000),
        exponent: 1,
        dp: 4,
    };

    /// Taker fee of one fill of `qty` shares at `price` (FC1–FC3): exact
    /// products on `i128` in 1e-12 USDC with staged division (intermediates
    /// truncated below 1e-12 USDC), then one `HalfAwayFromZero` rounding to
    /// `dp` (10 R8). Zero for `price ∉ (0, 1)` or `qty ≤ 0`. Makers pay 0:
    /// the caller charges this only on taker fills (FC2).
    pub fn taker_fee(&self, price: Price, qty: Qty) -> Result<Usdc, Overflow> {
        let (rate, exponent, dp, weighted) = match *self {
            FeeCurve::None => return Ok(Usdc::ZERO),
            FeeCurve::PriceWeighted { rate, exponent, dp } => (rate, exponent, dp, true),
            FeeCurve::Symmetric { rate, exponent, dp } => (rate, exponent, dp, false),
        };
        let p = price.micros() as i128;
        let s = SCALE as i128;
        if rate.micros() <= 0 || qty.micros() <= 0 || p <= 0 || p >= s {
            return Ok(Usdc::ZERO);
        }
        let dp = (dp as u32).min(6);
        // rate (1e-6) × C (1e-6 shares) = 1e-12 USDC.
        let mut acc = (rate.micros() as i128)
            .checked_mul(qty.micros() as i128)
            .ok_or(Overflow::Range)?;
        let base = p * (s - p); // p(1−p) in 1e-12
        for _ in 0..exponent {
            acc = acc.checked_mul(base).ok_or(Overflow::Range)? / E12;
        }
        if weighted {
            acc = acc.checked_mul(p).ok_or(Overflow::Range)? / s;
        }
        let unit = 10i128.pow(12 - dp);
        let q = div_round_i128(acc, unit, Rounding::HalfAwayFromZero)?;
        let micros = q.checked_mul(10i128.pow(6 - dp)).ok_or(Overflow::Range)?;
        i64::try_from(micros)
            .map(Usdc::from_micros)
            .map_err(|_| Overflow::Range)
    }

    /// Upper bound of the fee a collateral-sized BUY of `amount` can pay at
    /// any fill price in `[lo, limit]` (10 §9.4 C1). The per-collateral fee
    /// `g(p)` is unimodal, with its maximum at `p* = (e−1)/(2e−1)`
    /// (`Symmetric`, `e ≥ 1`), `p* = 1/2` (`PriceWeighted`, `e ≥ 1`) or `lo`
    /// (`e = 0`); the bound evaluates the fee at the clamped `p*` (both
    /// neighbouring micros) on `Ceil(amount / p)` shares. For the exponent-1
    /// curve this is `amount × rate × (1 − lo)`.
    pub fn max_fee_collateral_buy(
        &self,
        amount: Usdc,
        lo: Price,
        limit: Price,
    ) -> Result<Usdc, Overflow> {
        let (exponent, weighted) = match *self {
            FeeCurve::None => return Ok(Usdc::ZERO),
            FeeCurve::PriceWeighted { exponent, .. } => (exponent as i64, true),
            FeeCurve::Symmetric { exponent, .. } => (exponent as i64, false),
        };
        if amount.micros() <= 0 || lo.micros() <= 0 || limit < lo {
            return Ok(Usdc::ZERO);
        }
        let (num, den) = match (weighted, exponent) {
            (_, 0) => (0, 1),
            (true, _) => (1, 2),
            (false, e) => (e - 1, 2 * e - 1),
        };
        let star_floor = SCALE * num / den;
        let mut best = Usdc::ZERO;
        for cand in [star_floor, star_floor + 1] {
            let p = Price::from_micros(cand.clamp(lo.micros(), limit.micros()));
            let shares = Qty::for_collateral(amount, p, Rounding::Ceil)?;
            best = best.max(self.taker_fee(p, shares)?);
        }
        Ok(best)
    }

    /// Canonical text (FT1): `none`, `price_weighted:0.25:2:5`,
    /// `symmetric:0.07:1:5`.
    pub fn canonical(&self) -> String {
        self.to_string()
    }
}

impl fmt::Display for FeeCurve {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match *self {
            FeeCurve::None => f.write_str("none"),
            FeeCurve::PriceWeighted { rate, exponent, dp } => write!(
                f,
                "price_weighted:{}:{exponent}:{dp}",
                format_micros(rate.micros())
            ),
            FeeCurve::Symmetric { rate, exponent, dp } => write!(
                f,
                "symmetric:{}:{exponent}:{dp}",
                format_micros(rate.micros())
            ),
        }
    }
}

/// Result of the FE3 snapshot mapping.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum SnapshotFee {
    Curve(FeeCurve),
    /// Missing or unknown `feeType` with a schedule present: use the fallback
    /// row for the market start, provenance `fallback`, diagnostic
    /// `unknown_fee_type`.
    FallbackUnknownFeeType,
}

/// Captured fee schedule values (§13.4 `feeSchedule {rate, exponent}`).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct CapturedFeeSchedule {
    pub rate: Rate,
    /// Must be an integer in `0..=4`; the JSON reader rejects non-integers.
    pub exponent: i64,
}

/// FE3 exponent outside `0..=4`: invalid input.
#[derive(Copy, Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("fee exponent {0} outside 0..=4")]
pub struct InvalidFeeExponent(pub i64);

/// FE3: maps captured fee fields to a curve. Realistic `dp` is 5 (FC3).
pub fn fee_curve_from_snapshot(
    fees_enabled: Option<bool>,
    fee_type: Option<&str>,
    schedule: Option<CapturedFeeSchedule>,
) -> Result<SnapshotFee, InvalidFeeExponent> {
    let Some(s) = schedule else {
        return Ok(SnapshotFee::Curve(FeeCurve::None));
    };
    if !(0..=MAX_FEE_EXPONENT as i64).contains(&s.exponent) {
        return Err(InvalidFeeExponent(s.exponent));
    }
    if fees_enabled == Some(false) || s.rate.is_zero() {
        return Ok(SnapshotFee::Curve(FeeCurve::None));
    }
    match fee_type {
        Some("crypto_fees_v2") => Ok(SnapshotFee::Curve(FeeCurve::Symmetric {
            rate: s.rate,
            exponent: s.exponent as u8,
            dp: REALISTIC_FEE_DP,
        })),
        _ => Ok(SnapshotFee::FallbackUnknownFeeType),
    }
}

/// Realistic fee decimal places (P: "rounded to 5 decimal places").
pub const REALISTIC_FEE_DP: u8 = 5;

/// Fee era rows of §5.3.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FeeEraId {
    F0,
    F1,
    F2,
    F3,
}

impl FeeEraId {
    pub const fn as_str(self) -> &'static str {
        match self {
            FeeEraId::F0 => "F0",
            FeeEraId::F1 => "F1",
            FeeEraId::F2 => "F2",
            FeeEraId::F3 => "F3",
        }
    }
    pub const fn rule(self) -> RuleId {
        match self {
            FeeEraId::F0 => RuleId::FeeF0,
            FeeEraId::F1 => RuleId::FeeF1,
            FeeEraId::F2 => RuleId::FeeF2,
            FeeEraId::F3 => RuleId::FeeF3,
        }
    }
}

/// One row of the dated fallback fee table, keyed by market start.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct FeeEraRow {
    pub id: FeeEraId,
    /// Inclusive market-start lower bound (`None`: open).
    pub from_ms: Option<TsMs>,
    /// Exclusive market-start upper bound (`None`: open).
    pub to_ms: Option<TsMs>,
    pub curve: FeeCurve,
}

/// 2026-01-05T00:00Z.
pub const FEE_F1_FROM_MS: TsMs = TsMs(1_767_571_200_000);
/// 2026-03-30T00:00Z.
pub const FEE_F2_FROM_MS: TsMs = TsMs(1_774_828_800_000);
/// ~2026-05-08T00:00Z (approximate, §5.3).
pub const FEE_F3_FROM_MS: TsMs = TsMs(1_778_198_400_000);

/// §5.3 (rules-table-v1). Every row is `unverified` until FS (§14.1).
pub const FEE_ERAS_V1: [FeeEraRow; 4] = [
    FeeEraRow {
        id: FeeEraId::F0,
        from_ms: None,
        to_ms: Some(FEE_F1_FROM_MS),
        curve: FeeCurve::None,
    },
    FeeEraRow {
        id: FeeEraId::F1,
        from_ms: Some(FEE_F1_FROM_MS),
        to_ms: Some(FEE_F2_FROM_MS),
        curve: FeeCurve::PriceWeighted {
            rate: Rate::from_micros(250_000),
            exponent: 2,
            dp: 5,
        },
    },
    FeeEraRow {
        id: FeeEraId::F2,
        from_ms: Some(FEE_F2_FROM_MS),
        to_ms: Some(FEE_F3_FROM_MS),
        curve: FeeCurve::Symmetric {
            rate: Rate::from_micros(70_000),
            exponent: 1,
            dp: 5,
        },
    },
    FeeEraRow {
        id: FeeEraId::F3,
        from_ms: Some(FEE_F3_FROM_MS),
        to_ms: None,
        curve: FeeCurve::Symmetric {
            rate: Rate::from_micros(70_000),
            exponent: 1,
            dp: 5,
        },
    },
];

/// The fee era row whose window contains `market_start` (§5.3, FT1).
pub fn fee_era(table: RulesTableVersion, market_start: TsMs) -> &'static FeeEraRow {
    let rows: &'static [FeeEraRow; 4] = match table {
        RulesTableVersion::V1 => &FEE_ERAS_V1,
    };
    rows.iter()
        .rev()
        .find(|r| r.from_ms.is_none_or(|f| market_start >= f))
        .unwrap_or(&rows[0])
}

// ---------------------------------------------------------------------------
// Taker delay (§6)
// ---------------------------------------------------------------------------

/// Delay rows of §6.2.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DelayRowId {
    D0,
    D1,
    D2,
    D3,
    D4,
    D5,
}

impl DelayRowId {
    pub const fn as_str(self) -> &'static str {
        match self {
            DelayRowId::D0 => "D0",
            DelayRowId::D1 => "D1",
            DelayRowId::D2 => "D2",
            DelayRowId::D3 => "D3",
            DelayRowId::D4 => "D4",
            DelayRowId::D5 => "D5",
        }
    }
    pub const fn rule(self) -> RuleId {
        match self {
            DelayRowId::D0 => RuleId::DelayD0,
            DelayRowId::D1 => RuleId::DelayD1,
            DelayRowId::D2 => RuleId::DelayD2,
            DelayRowId::D3 => RuleId::DelayD3,
            DelayRowId::D4 => RuleId::DelayD4,
            DelayRowId::D5 => RuleId::DelayD5,
        }
    }
    /// TD6/D52: D0–D3 are third-party rows; markets that hit them are
    /// flagged in `unverifiedRules` and are not gate-3 evidence.
    pub const fn is_third_party(self) -> bool {
        matches!(
            self,
            DelayRowId::D0 | DelayRowId::D1 | DelayRowId::D2 | DelayRowId::D3
        )
    }
}

/// The taker delay in force (§6.1, §6.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct TakerDelay {
    pub delay: DurMs,
    /// Whether a cancel during the window succeeds (TD4).
    pub cancelable: bool,
    pub row: DelayRowId,
}

/// One row of the dated delay table, keyed by exchange arrival time.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct DelayRow {
    /// Inclusive lower bound (`None`: from the first market).
    pub from_ms: Option<TsMs>,
    pub delay: TakerDelay,
}

/// ~2026-02-15 (approximate).
pub const DELAY_D1_FROM_MS: TsMs = TsMs(1_771_113_600_000);
/// 2026-02-25 (time of day unknown).
pub const DELAY_D2_FROM_MS: TsMs = TsMs(1_771_977_600_000);
/// 2026-06-05.
pub const DELAY_D3_FROM_MS: TsMs = TsMs(1_780_617_600_000);
/// 2026-08-17T11:00Z: first changelog row; also the D52 gate-3 boundary.
pub const DELAY_D4_FROM_MS: TsMs = TsMs(1_786_964_400_000);
/// 2026-09-04T14:00Z.
pub const DELAY_D5_FROM_MS: TsMs = TsMs(1_788_530_400_000);

const fn delay_row(from: Option<TsMs>, ms: i64, cancelable: bool, row: DelayRowId) -> DelayRow {
    DelayRow {
        from_ms: from,
        delay: TakerDelay {
            delay: DurMs(ms),
            cancelable,
            row,
        },
    }
}

/// §6.2 (rules-table-v1). D0's cancellability is unknown in the source; it
/// is modeled cancellable, like D2, because irrevocability arrived as a
/// change on 2026-06-05 (D3) (assumption, flagged through D0's
/// `ThirdParty` status).
pub const DELAY_TABLE_V1: [DelayRow; 6] = [
    delay_row(None, 500, true, DelayRowId::D0),
    delay_row(Some(DELAY_D1_FROM_MS), 0, true, DelayRowId::D1),
    delay_row(Some(DELAY_D2_FROM_MS), 250, true, DelayRowId::D2),
    delay_row(Some(DELAY_D3_FROM_MS), 250, false, DelayRowId::D3),
    delay_row(Some(DELAY_D4_FROM_MS), 50, false, DelayRowId::D4),
    delay_row(Some(DELAY_D5_FROM_MS), 150, false, DelayRowId::D5),
];

fn delay_table(table: RulesTableVersion) -> &'static [DelayRow; 6] {
    match table {
        RulesTableVersion::V1 => &DELAY_TABLE_V1,
    }
}

/// The delay row in force at exchange arrival time `at` (TD5, §6.2; keyed by
/// exchange time, never by market start, TD7).
pub fn taker_delay_at(table: RulesTableVersion, at: TsMs) -> TakerDelay {
    let rows = delay_table(table);
    rows.iter()
        .rev()
        .find(|r| r.from_ms.is_none_or(|f| at >= f))
        .unwrap_or(&rows[0])
        .delay
}

/// D52: only markets starting at or after 2026-08-17T11:00Z count as gate-3
/// evidence.
#[inline]
pub fn is_gate3_evidence_market(market_start: TsMs) -> bool {
    market_start >= DELAY_D4_FROM_MS
}

/// §6.3: Gamma `secondsDelay > 0` on a BTC market replaces the dated value
/// (`secondsDelay × 1000`) and is flagged `unexpected_seconds_delay`
/// (second element `true`).
pub fn apply_seconds_delay(dated: TakerDelay, seconds_delay: Option<u32>) -> (TakerDelay, bool) {
    match seconds_delay {
        Some(s) if s > 0 => (
            TakerDelay {
                delay: DurMs(s as i64 * 1000),
                ..dated
            },
            true,
        ),
        _ => (dated, false),
    }
}

// ---------------------------------------------------------------------------
// Tick, bounds, precision, minimums (§7)
// ---------------------------------------------------------------------------

/// Decimals implied by a valid tick (§7.1).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct TickDecimals {
    pub price_dp: u8,
    pub size_dp: u8,
    pub amount_dp: u8,
}

/// The six valid ticks of §7.1, coarse to fine, with their decimals.
pub const VALID_TICKS: [(Price, TickDecimals); 6] = [
    (Price::from_micros(100_000), td(1, 2, 3)),
    (Price::from_micros(10_000), td(2, 2, 4)),
    (Price::from_micros(5_000), td(3, 2, 5)),
    (Price::from_micros(2_500), td(4, 2, 6)),
    (Price::from_micros(1_000), td(3, 2, 5)),
    (Price::from_micros(100), td(4, 2, 6)),
];

const fn td(price_dp: u8, size_dp: u8, amount_dp: u8) -> TickDecimals {
    TickDecimals {
        price_dp,
        size_dp,
        amount_dp,
    }
}

/// Fallback initial tick, 0.01 (TT1).
pub const FALLBACK_TICK: Price = Price::from_micros(10_000);

/// Decimals of a valid tick; `None` for a tick outside §7.1 (invalid input).
pub fn tick_decimals(tick: Price) -> Option<TickDecimals> {
    VALID_TICKS
        .iter()
        .find(|(t, _)| *t == tick)
        .map(|&(_, d)| d)
}

/// TT3 inference: when `price` is not on `current`, the coarsest valid tick
/// that refines `current` (divides it) and contains `price`. `None` when the
/// price is on the current tick or no valid tick contains it. The 0.0025
/// tick (World Cup only, P) is never inferred: it does not refine 0.005 or
/// 0.001, so inference stays a pure refinement chain.
pub fn infer_tick(current: Price, price: Price) -> Option<Price> {
    if price.is_on_tick(current) {
        return None;
    }
    VALID_TICKS
        .iter()
        .map(|&(t, _)| t)
        .filter(|t| t.micros() != 2_500)
        .find(|&t| current.micros() % t.micros() == 0 && price.is_on_tick(t))
}

/// Exchange-side rule violation (11 §7–§9); the engine maps it one-to-one
/// to the exchange-origin `RejectReason` variant of the same name
/// (10 §10.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum RuleViolation {
    InvalidTick { price: Price, tick: Price },
    PriceOutOfBounds { min: Price, max: Price },
    SizeBelowMinimum { min: Qty },
    NotionalBelowMinimum { min: Usdc },
    SizePrecision,
    AmountPrecision,
    PostOnlyWouldCross,
    GtdLeadTooShort { min_lead_ms: DurMs },
    MarketClosed,
    BatchTooLarge { max: u8 },
}

/// Share size decimals of every valid tick (§7.1).
pub const SIZE_DP: u32 = 2;

#[inline]
fn on_dp(micros: i64, dp: u32) -> bool {
    dp >= 6 || micros % 10i64.pow(6 - dp) == 0
}

/// Whether `side @ price` is marketable against the opposite best (TD1):
/// BUY `price ≥ best ask`, SELL `price ≤ best bid`; an empty side never is.
#[inline]
pub fn is_marketable(side: Side, price: Price, best_opposite: Option<Price>) -> bool {
    match (side, best_opposite) {
        (_, None) => false,
        (Side::Buy, Some(ask)) => price >= ask,
        (Side::Sell, Some(bid)) => price <= bid,
    }
}

/// Post-only check (§11, §4): a marketable post-only order is rejected
/// whole; equality crosses, an empty opposite side accepts.
#[inline]
pub fn post_only_would_cross(side: Side, price: Price, best_opposite: Option<Price>) -> bool {
    is_marketable(side, price, best_opposite)
}

// ---------------------------------------------------------------------------
// GTD (§8)
// ---------------------------------------------------------------------------

/// GTD rules (§3 `gtd`, §8; ts-compat §4).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct GtdRules {
    /// Realistic: 180 s, checked at exchange arrival on whole seconds (GT2).
    /// ts-compat: 60 s, checked at decision time on ms.
    pub min_lead: DurMs,
    /// Realistic 60 s (GT3), ts-compat 0.
    pub early_expiry: DurMs,
    /// Whether the exchange sees whole seconds `floor(ms / 1000)` (R13).
    pub whole_seconds: bool,
}

impl GtdRules {
    pub const REALISTIC: GtdRules = GtdRules {
        min_lead: DurMs(180_000),
        early_expiry: DurMs(60_000),
        whole_seconds: true,
    };
    pub const TS_COMPAT: GtdRules = GtdRules {
        min_lead: DurMs(60_000),
        early_expiry: DurMs(0),
        whole_seconds: false,
    };

    /// The stated expiration as the exchange sees it, in ms (GT1, R13:
    /// `floor(expire_at_ms / 1000) × 1000`).
    #[inline]
    pub fn stated_ms(&self, expire_at: TsMs) -> TsMs {
        if self.whole_seconds {
            TsMs(gtd_stated_seconds(expire_at) * 1000)
        } else {
            expire_at
        }
    }

    /// Lead check at `at` (exchange arrival in realistic, decision time in
    /// ts-compat): `stated ≥ at + min_lead` (GT2).
    #[inline]
    pub fn lead_ok(&self, expire_at: TsMs, at: TsMs) -> bool {
        self.stated_ms(expire_at).0 as i128 >= at.0 as i128 + self.min_lead.0 as i128
    }

    /// Effective expiry in exchange time: `stated − early_expiry` (GD2, GT3).
    #[inline]
    pub fn effective_expiry(&self, expire_at: TsMs) -> TsMs {
        TsMs(
            self.stated_ms(expire_at)
                .0
                .saturating_sub(self.early_expiry.0),
        )
    }
}

/// Seconds sent to the exchange: `floor(expire_at_ms / 1000)` (R13, GT1).
#[inline]
pub fn gtd_stated_seconds(expire_at: TsMs) -> i64 {
    expire_at.0.div_euclid(1000)
}

// ---------------------------------------------------------------------------
// ExchangeRules (§3) and constructors (§4, fallback)
// ---------------------------------------------------------------------------

/// Rules in force for one market at one exchange time (§3). `Copy`, no heap.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct ExchangeRules {
    /// Per outcome, in force (§7.5).
    pub tick: PerOutcome<Price>,
    /// GTC/GTD minimum, shares (§7.4).
    pub min_size_resting: Qty,
    /// FOK/FAK minimum notional (§7.4).
    pub min_notional_market: Usdc,
    pub fee: FeeCurve,
    pub taker_delay_enabled: bool,
    /// The dated delay in force (§6.2); applies only when
    /// `taker_delay_enabled`. Not listed in the §3 struct; added because
    /// `RulesChange::TakerDelay` must change a field.
    pub taker_delay: TakerDelay,
    pub gtd: GtdRules,
    /// `None`: unbounded (ts-compat, §4).
    pub max_place_batch: Option<u8>,
    pub max_cancel_ids: u16,
    pub neg_risk: bool,
    pub version: MarketVersion,
    /// Recorded, not modeled (§11).
    pub min_order_age_s: Option<u32>,
    /// `false` in ts-compat: no tick/bounds/precision/minimum checks (PF3).
    pub validate: bool,
}

/// Realistic batch cap (§9).
pub const MAX_PLACE_BATCH: u8 = 15;
/// Realistic cancel-id cap (§9, K7).
pub const MAX_CANCEL_IDS: u16 = 1_000;
/// ts-compat cancel-id cap (`src/trading/cancellation.ts:69`).
pub const TS_COMPAT_MAX_CANCEL_IDS: u16 = 3_000;
/// Fallback resting minimum: 5 shares (§7.4).
pub const FALLBACK_MIN_SIZE_RESTING: Qty = Qty::from_micros(5_000_000);
/// Fallback market-order minimum: $1 (§7.4, assumed).
pub const FALLBACK_MIN_NOTIONAL_MARKET: Usdc = Usdc::from_micros(1_000_000);

impl ExchangeRules {
    /// The fixed ts-compat rules of §4 (every date): 700 bps / 4 dp fee, tick
    /// 0.01 never validated, GTD 60 s at decision with exact expiry, no taker
    /// delay, no batch cap, cancel-id cap 3,000, `validate = false`.
    pub const fn ts_compat() -> ExchangeRules {
        ExchangeRules {
            tick: PerOutcome::new(FALLBACK_TICK, FALLBACK_TICK),
            min_size_resting: Qty::ZERO,
            min_notional_market: Usdc::ZERO,
            fee: FeeCurve::TS_COMPAT,
            taker_delay_enabled: false,
            taker_delay: TakerDelay {
                delay: DurMs(0),
                cancelable: true,
                row: DelayRowId::D1,
            },
            gtd: GtdRules::TS_COMPAT,
            max_place_batch: None,
            max_cancel_ids: TS_COMPAT_MAX_CANCEL_IDS,
            neg_risk: false,
            version: MarketVersion::V1,
            min_order_age_s: None,
            validate: false,
        }
    }

    /// Realistic rules from the dated fallback only (nothing captured):
    /// tick 0.01, 5 shares, $1, the fee era of `market_start`, taker delay
    /// enabled with the row in force at `at`, GTD 180 s / 60 s, caps 15 and
    /// 1,000, `v1`, not negRisk.
    pub fn realistic_fallback(table: RulesTableVersion, market_start: TsMs, at: TsMs) -> Self {
        ExchangeRules {
            tick: PerOutcome::new(FALLBACK_TICK, FALLBACK_TICK),
            min_size_resting: FALLBACK_MIN_SIZE_RESTING,
            min_notional_market: FALLBACK_MIN_NOTIONAL_MARKET,
            fee: fee_era(table, market_start).curve,
            taker_delay_enabled: true,
            taker_delay: taker_delay_at(table, at),
            gtd: GtdRules::REALISTIC,
            max_place_batch: Some(MAX_PLACE_BATCH),
            max_cancel_ids: MAX_CANCEL_IDS,
            neg_risk: false,
            version: MarketVersion::V1,
            min_order_age_s: None,
            validate: true,
        }
    }

    /// The delay a marketable order arriving now is held for (TD1–TD2):
    /// `None` when the market has no taker delay or the row's delay is 0.
    #[inline]
    pub fn effective_taker_delay(&self) -> Option<TakerDelay> {
        if self.taker_delay_enabled && self.taker_delay.delay.0 > 0 {
            Some(self.taker_delay)
        } else {
            None
        }
    }

    /// Price bounds `[tick, 1 − tick]` of an outcome (TK2).
    #[inline]
    pub fn price_bounds(&self, o: Outcome) -> (Price, Price) {
        let t = self.tick[o];
        (t, t.complement())
    }

    /// TK1, TK2, TK3 and MS1 for one order against the rules in force
    /// (the same checks run at decision and at arrival, 12 §7.4, 13 §6.2).
    /// Order: tick, bounds, precision, minimum. Always `Ok` when
    /// `validate` is false (ts-compat).
    pub fn check_order(&self, r: &OrderRequest) -> Result<(), RuleViolation> {
        if !self.validate {
            return Ok(());
        }
        let tick = self.tick[r.outcome];
        if !r.price.is_on_tick(tick) {
            return Err(RuleViolation::InvalidTick {
                price: r.price,
                tick,
            });
        }
        let (min, max) = self.price_bounds(r.outcome);
        if r.price < min || r.price > max {
            return Err(RuleViolation::PriceOutOfBounds { min, max });
        }
        let amount_dp = tick_decimals(tick).map_or(6, |d| d.amount_dp as u32);
        match r.size {
            OrderSize::Shares(q) if !on_dp(q.micros(), SIZE_DP) => {
                return Err(RuleViolation::SizePrecision)
            }
            OrderSize::Collateral(a) if !on_dp(a.micros(), amount_dp) => {
                return Err(RuleViolation::AmountPrecision)
            }
            _ => {}
        }
        if r.order_type.is_resting() {
            if let OrderSize::Shares(q) = r.size {
                if q < self.min_size_resting {
                    return Err(RuleViolation::SizeBelowMinimum {
                        min: self.min_size_resting,
                    });
                }
            }
        } else {
            // MS1: BUY compares its collateral; SELL (and a share-sized BUY)
            // compares shares × price, exactly.
            let below = match r.size {
                OrderSize::Collateral(a) => a < self.min_notional_market,
                OrderSize::Shares(q) => {
                    (r.price.micros() as i128) * (q.micros() as i128)
                        < (self.min_notional_market.micros() as i128) * SCALE as i128
                }
            };
            if below {
                return Err(RuleViolation::NotionalBelowMinimum {
                    min: self.min_notional_market,
                });
            }
        }
        Ok(())
    }

    /// Batch cap (§9): above the cap the whole intent is rejected.
    #[inline]
    pub fn check_batch_len(&self, n: usize) -> Result<(), RuleViolation> {
        match self.max_place_batch {
            Some(max) if n > max as usize => Err(RuleViolation::BatchTooLarge { max }),
            _ => Ok(()),
        }
    }

    /// Cancel-id cap (§9): `false` → `CancelFailed(TooManyIds)` for the
    /// whole intent.
    #[inline]
    pub fn cancel_ids_ok(&self, n: usize) -> bool {
        n <= self.max_cancel_ids as usize
    }

    /// GT2 at arrival (realistic) or decision (ts-compat); `Ok` for non-GTD.
    #[inline]
    pub fn check_gtd_lead(&self, r: &OrderRequest, at: TsMs) -> Result<(), RuleViolation> {
        match r.gtd_expiry() {
            Some(e) if !self.gtd.lead_ok(e, at) => Err(RuleViolation::GtdLeadTooShort {
                min_lead_ms: self.gtd.min_lead,
            }),
            _ => Ok(()),
        }
    }
}

/// BUY reservation (10 §9.4 C1, §3.3 R9).
///
/// - Share-sized: `limit × q` rounded with `notional` (realistic `Ceil`,
///   ts-compat `HalfAwayFromZero`) plus the fee at the limit, unless
///   post-only (notional only).
/// - Collateral-sized: `amount` + [`FeeCurve::max_fee_collateral_buy`] over
///   `[lo, limit]`, `lo` = the tick in force.
pub fn buy_reservation(
    fee: &FeeCurve,
    order_type: OrderType,
    limit: Price,
    size: OrderSize,
    post_only: bool,
    lo: Price,
    notional: Rounding,
) -> Result<Usdc, Overflow> {
    match size {
        OrderSize::Shares(q) => {
            if q.micros() <= 0 {
                return Ok(Usdc::ZERO);
            }
            let n = limit.notional(q, notional)?;
            if post_only && order_type.allows_post_only() {
                Ok(n)
            } else {
                n.checked_add(fee.taker_fee(limit, q)?)
            }
        }
        OrderSize::Collateral(a) => {
            if a.micros() <= 0 {
                return Ok(Usdc::ZERO);
            }
            a.checked_add(fee.max_fee_collateral_buy(a, lo, limit)?)
        }
    }
}

// ---------------------------------------------------------------------------
// Signing domain (§10)
// ---------------------------------------------------------------------------

/// EIP-712 domain version and verifying contract (§10 V2).
pub const fn signing_domain(
    version: MarketVersion,
    neg_risk: bool,
) -> (&'static str, &'static str) {
    match (version, neg_risk) {
        (MarketVersion::V2, _) => ("3", "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa"),
        (MarketVersion::V1, false) => ("2", "0xE111180000d2663C0091e4f400237545B87B996B"),
        (MarketVersion::V1, true) => ("2", "0xe2222d279d744050d28e00520010520000310F59"),
    }
}

// ---------------------------------------------------------------------------
// Timeline (§3, X1, X2)
// ---------------------------------------------------------------------------

/// How a tick change was learned (§7.5).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum TickOrigin {
    /// `tick_size_change` event (TT2).
    Event,
    /// Inferred from an off-tick level (TT3).
    Inferred,
}

/// One dated change of the rules (§3).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum RulesChange {
    Tick {
        outcome: Outcome,
        tick: Price,
        origin: TickOrigin,
    },
    TakerDelay(TakerDelay),
}

impl RulesChange {
    fn apply(&self, r: &mut ExchangeRules) {
        match *self {
            RulesChange::Tick { outcome, tick, .. } => r.tick[outcome] = tick,
            RulesChange::TakerDelay(d) => r.taker_delay = d,
        }
    }
}

/// Immutable per-market rules, shared read-only across candidates (`Arc`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RulesTimeline {
    pub initial: ExchangeRules,
    /// Sorted by exchange time; equal times keep insertion order.
    pub changes: Vec<(TsMs, RulesChange)>,
    pub provenance: RulesProvenance,
    pub table_version: RulesTableVersion,
    /// §5.3 row containing the market start.
    pub fee_era: FeeEraId,
}

impl RulesTimeline {
    /// Builds a timeline; `changes` are stably sorted by time.
    pub fn new(
        initial: ExchangeRules,
        mut changes: Vec<(TsMs, RulesChange)>,
        provenance: RulesProvenance,
        table_version: RulesTableVersion,
        fee_era: FeeEraId,
    ) -> Self {
        changes.sort_by_key(|&(t, _)| t);
        RulesTimeline {
            initial,
            changes,
            provenance,
            table_version,
            fee_era,
        }
    }

    /// The `TakerDelay` changes of the dated table strictly after `from` and
    /// at or before `until` (exchange time), for building a timeline whose
    /// initial delay is [`taker_delay_at`]`(from)`.
    pub fn delay_changes(
        table: RulesTableVersion,
        from: TsMs,
        until: TsMs,
    ) -> impl Iterator<Item = (TsMs, RulesChange)> {
        delay_table(table)
            .iter()
            .filter_map(move |r| match r.from_ms {
                Some(t) if t > from && t <= until => Some((t, RulesChange::TakerDelay(r.delay))),
                _ => None,
            })
    }

    /// Realistic timeline with nothing captured: provenance `Fallback`,
    /// delay rows over `[from, until]`, plus the given tick changes.
    pub fn realistic_fallback(
        table: RulesTableVersion,
        market_start: TsMs,
        from: TsMs,
        until: TsMs,
        tick_changes: impl IntoIterator<Item = (TsMs, RulesChange)>,
    ) -> Self {
        let initial = ExchangeRules::realistic_fallback(table, market_start, from);
        let mut changes: Vec<_> = Self::delay_changes(table, from, until).collect();
        changes.extend(tick_changes);
        Self::new(
            initial,
            changes,
            RulesProvenance::all_fallback(table),
            table,
            fee_era(table, market_start).id,
        )
    }

    /// A forward-only cursor at the initial rules.
    pub fn cursor(&self) -> RulesCursor<'_> {
        RulesCursor {
            timeline: self,
            next: 0,
            current: self.initial,
        }
    }
}

/// Forward-only lookup of the rules in force (X1), O(1) amortized.
#[derive(Clone, Debug)]
pub struct RulesCursor<'a> {
    timeline: &'a RulesTimeline,
    next: usize,
    current: ExchangeRules,
}

impl RulesCursor<'_> {
    /// Rules in force at exchange time `t`: every change at or before `t` is
    /// applied. Times must not decrease; an earlier `t` returns the rules
    /// already reached.
    #[inline]
    pub fn at(&mut self, t: TsMs) -> &ExchangeRules {
        let changes = &self.timeline.changes;
        while let Some((ct, c)) = changes.get(self.next) {
            if *ct > t {
                break;
            }
            c.apply(&mut self.current);
            self.next += 1;
        }
        &self.current
    }

    /// The rules last reached.
    #[inline]
    pub fn current(&self) -> &ExchangeRules {
        &self.current
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(units_micros: i64) -> Qty {
        Qty::from_micros(units_micros)
    }
    fn p(m: i64) -> Price {
        Price::from_micros(m)
    }
    fn u(m: i64) -> Usdc {
        Usdc::from_micros(m)
    }

    const ERA1: FeeCurve = FeeCurve::PriceWeighted {
        rate: Rate::from_micros(250_000),
        exponent: 2,
        dp: 5,
    };
    const ERA3: FeeCurve = FeeCurve::Symmetric {
        rate: Rate::from_micros(70_000),
        exponent: 1,
        dp: 5,
    };
    const WIP_ERA1: FeeCurve = FeeCurve::Symmetric {
        rate: Rate::from_micros(250_000),
        exponent: 2,
        dp: 5,
    };

    // spec: 11 §5.2 test vectors, verbatim (C, p, era 1, era 3, ts-compat, WIP era 1).
    #[test]
    fn fee_vectors_5_2() {
        let rows: [(i64, i64, i64, i64, i64, i64); 7] = [
            (
                100_000_000,
                500_000,
                781_250,
                1_750_000,
                1_750_000,
                1_562_500,
            ),
            (10_000_000, 530_000, 82_220, 174_370, 174_400, 155_130),
            (
                800_000_000,
                600_000,
                6_912_000,
                13_440_000,
                13_440_000,
                11_520_000,
            ),
            (6_000_000, 640_000, 50_960, 96_770, 96_800, 79_630),
            (5_000_000, 10_000, 0, 3_470, 3_500, 120),
            (5_000_000, 990_000, 120, 3_470, 3_500, 120),
            (50_000, 10_000, 0, 30, 0, 0),
        ];
        for (c, price, e1, e3, tc, wip) in rows {
            assert_eq!(
                ERA1.taker_fee(p(price), q(c)).unwrap(),
                u(e1),
                "era1 {c} {price}"
            );
            assert_eq!(
                ERA3.taker_fee(p(price), q(c)).unwrap(),
                u(e3),
                "era3 {c} {price}"
            );
            assert_eq!(
                FeeCurve::TS_COMPAT.taker_fee(p(price), q(c)).unwrap(),
                u(tc),
                "ts {c} {price}"
            );
            assert_eq!(
                WIP_ERA1.taker_fee(p(price), q(c)).unwrap(),
                u(wip),
                "wip {c} {price}"
            );
        }
    }

    #[test]
    fn fee_edges() {
        assert_eq!(
            FeeCurve::None.taker_fee(p(500_000), q(1_000_000)).unwrap(),
            Usdc::ZERO
        );
        assert_eq!(ERA3.taker_fee(p(0), q(1_000_000)).unwrap(), Usdc::ZERO);
        assert_eq!(
            ERA3.taker_fee(Price::ONE, q(1_000_000)).unwrap(),
            Usdc::ZERO
        );
        assert_eq!(ERA3.taker_fee(p(500_000), q(0)).unwrap(), Usdc::ZERO);
        // Symmetric in p.
        assert_eq!(
            ERA3.taker_fee(p(300_000), q(7_000_000)).unwrap(),
            ERA3.taker_fee(p(700_000), q(7_000_000)).unwrap()
        );
        // ts-compat: 0.07×0.01×0.99×0.1 = 0.0000693 → 0.0001.
        assert_eq!(
            FeeCurve::TS_COMPAT
                .taker_fee(p(10_000), q(100_000))
                .unwrap(),
            u(100)
        );
        // Realistic minimum: exact < 0.000005 → 0; 0.000005 → 0.00001.
        let r = FeeCurve::Symmetric {
            rate: Rate::from_micros(1_000_000),
            exponent: 0,
            dp: 5,
        };
        assert_eq!(r.taker_fee(p(500_000), q(4)).unwrap(), Usdc::ZERO);
        assert_eq!(r.taker_fee(p(500_000), q(5)).unwrap(), u(10));
    }

    #[test]
    fn fee_canonical_text_and_fe3() {
        assert_eq!(FeeCurve::None.canonical(), "none");
        assert_eq!(ERA1.canonical(), "price_weighted:0.25:2:5");
        assert_eq!(ERA3.canonical(), "symmetric:0.07:1:5");
        let sched = |r: i64, e: i64| {
            Some(CapturedFeeSchedule {
                rate: Rate::from_micros(r),
                exponent: e,
            })
        };
        assert_eq!(
            fee_curve_from_snapshot(Some(true), Some("crypto_fees_v2"), sched(70_000, 1)),
            Ok(SnapshotFee::Curve(ERA3))
        );
        assert_eq!(
            fee_curve_from_snapshot(Some(false), Some("crypto_fees_v2"), sched(70_000, 1)),
            Ok(SnapshotFee::Curve(FeeCurve::None))
        );
        assert_eq!(
            fee_curve_from_snapshot(Some(true), Some("crypto_fees_v2"), sched(0, 1)),
            Ok(SnapshotFee::Curve(FeeCurve::None))
        );
        assert_eq!(
            fee_curve_from_snapshot(Some(true), None, None),
            Ok(SnapshotFee::Curve(FeeCurve::None))
        );
        assert_eq!(
            fee_curve_from_snapshot(Some(true), Some("other"), sched(70_000, 1)),
            Ok(SnapshotFee::FallbackUnknownFeeType)
        );
        assert_eq!(
            fee_curve_from_snapshot(Some(true), None, sched(70_000, 1)),
            Ok(SnapshotFee::FallbackUnknownFeeType)
        );
        assert_eq!(
            fee_curve_from_snapshot(Some(true), Some("crypto_fees_v2"), sched(70_000, 5)),
            Err(InvalidFeeExponent(5))
        );
        assert_eq!(
            fee_curve_from_snapshot(Some(true), Some("crypto_fees_v2"), sched(70_000, -1)),
            Err(InvalidFeeExponent(-1))
        );
    }

    // spec: 11 §5.3 rows and boundaries.
    #[test]
    fn fee_era_table() {
        let v = RulesTableVersion::V1;
        let cases = [
            (0, FeeEraId::F0, FeeCurve::None),
            (1_767_571_199_999, FeeEraId::F0, FeeCurve::None),
            (1_767_571_200_000, FeeEraId::F1, ERA1),
            (1_774_828_799_999, FeeEraId::F1, ERA1),
            (1_774_828_800_000, FeeEraId::F2, ERA3),
            (1_778_198_399_999, FeeEraId::F2, ERA3),
            (1_778_198_400_000, FeeEraId::F3, ERA3),
            (1_790_000_000_000, FeeEraId::F3, ERA3),
        ];
        for (t, id, curve) in cases {
            let row = fee_era(v, TsMs(t));
            assert_eq!((row.id, row.curve), (id, curve), "{t}");
        }
        assert!(FeeEraId::F3.rule().is_unverified());
    }

    // spec: 11 §6.2 rows and boundaries (keyed by exchange arrival time).
    #[test]
    fn taker_delay_table() {
        let v = RulesTableVersion::V1;
        let cases = [
            (0, DelayRowId::D0, 500, true),
            (1_771_113_599_999, DelayRowId::D0, 500, true),
            (1_771_113_600_000, DelayRowId::D1, 0, true),
            (1_771_977_600_000, DelayRowId::D2, 250, true),
            (1_780_617_599_999, DelayRowId::D2, 250, true),
            (1_780_617_600_000, DelayRowId::D3, 250, false),
            (1_786_964_399_999, DelayRowId::D3, 250, false),
            (1_786_964_400_000, DelayRowId::D4, 50, false),
            (1_788_530_399_999, DelayRowId::D4, 50, false),
            (1_788_530_400_000, DelayRowId::D5, 150, false),
            (1_800_000_000_000, DelayRowId::D5, 150, false),
        ];
        for (t, row, ms, cancel) in cases {
            let d = taker_delay_at(v, TsMs(t));
            assert_eq!(
                (d.row, d.delay, d.cancelable),
                (row, DurMs(ms), cancel),
                "{t}"
            );
        }
        assert!(DelayRowId::D3.is_third_party() && !DelayRowId::D4.is_third_party());
        assert!(DelayRowId::D0.rule().is_unverified());
        assert!(!DelayRowId::D5.rule().is_unverified());
        assert!(!is_gate3_evidence_market(TsMs(1_786_964_399_999)));
        assert!(is_gate3_evidence_market(TsMs(1_786_964_400_000)));
        let d5 = taker_delay_at(v, TsMs(1_790_000_000_000));
        assert_eq!(apply_seconds_delay(d5, Some(0)), (d5, false));
        assert_eq!(apply_seconds_delay(d5, None), (d5, false));
        let (d, flagged) = apply_seconds_delay(d5, Some(2));
        assert!(flagged);
        assert_eq!(d.delay, DurMs(2_000));
    }

    // spec: 11 §7.1 table.
    #[test]
    fn tick_table_and_inference() {
        assert_eq!(tick_decimals(p(100_000)), Some(td(1, 2, 3)));
        assert_eq!(tick_decimals(p(10_000)), Some(td(2, 2, 4)));
        assert_eq!(tick_decimals(p(5_000)), Some(td(3, 2, 5)));
        assert_eq!(tick_decimals(p(2_500)), Some(td(4, 2, 6)));
        assert_eq!(tick_decimals(p(1_000)), Some(td(3, 2, 5)));
        assert_eq!(tick_decimals(p(100)), Some(td(4, 2, 6)));
        assert_eq!(tick_decimals(p(20_000)), None);
        assert_eq!(infer_tick(p(10_000), p(530_000)), None);
        assert_eq!(infer_tick(p(10_000), p(535_000)), Some(p(5_000)));
        assert_eq!(infer_tick(p(10_000), p(991_000)), Some(p(1_000)));
        assert_eq!(infer_tick(p(5_000), p(991_000)), Some(p(1_000)));
        assert_eq!(infer_tick(p(10_000), p(997_500)), Some(p(100)));
        assert_eq!(infer_tick(p(10_000), p(997_510)), None);
    }

    fn order(price: i64, size: OrderSize, ot: OrderType) -> OrderRequest {
        OrderRequest {
            size,
            order_type: ot,
            ..OrderRequest::gtc(
                crate::ids::CidKey(0),
                Outcome::Up,
                Side::Buy,
                p(price),
                Qty::ZERO,
            )
        }
    }

    #[test]
    fn order_validation() {
        let r = ExchangeRules::realistic_fallback(
            RulesTableVersion::V1,
            TsMs(1_790_000_000_000),
            TsMs(1_790_000_000_000),
        );
        let sh = |m| OrderSize::Shares(q(m));
        let co = |m| OrderSize::Collateral(u(m));
        use OrderType::*;
        assert_eq!(r.check_order(&order(530_000, sh(5_000_000), Gtc)), Ok(()));
        assert_eq!(
            r.check_order(&order(535_000, sh(5_000_000), Gtc)),
            Err(RuleViolation::InvalidTick {
                price: p(535_000),
                tick: p(10_000)
            })
        );
        assert_eq!(
            r.check_order(&order(1_000_000, sh(5_000_000), Gtc)),
            Err(RuleViolation::PriceOutOfBounds {
                min: p(10_000),
                max: p(990_000)
            })
        );
        assert_eq!(
            r.check_order(&order(0, sh(5_000_000), Gtc)),
            Err(RuleViolation::PriceOutOfBounds {
                min: p(10_000),
                max: p(990_000)
            })
        );
        assert_eq!(
            r.check_order(&order(530_000, sh(5_001_000), Gtc)),
            Err(RuleViolation::SizePrecision)
        );
        assert_eq!(
            r.check_order(&order(530_000, sh(4_990_000), Gtd)),
            Err(RuleViolation::SizeBelowMinimum { min: q(5_000_000) })
        );
        // Market BUY in collateral: 4 amount decimals at tick 0.01.
        assert_eq!(r.check_order(&order(530_000, co(1_000_000), Fok)), Ok(()));
        assert_eq!(
            r.check_order(&order(530_000, co(1_000_010), Fok)),
            Err(RuleViolation::AmountPrecision)
        );
        assert_eq!(
            r.check_order(&order(530_000, co(999_900), Fak)),
            Err(RuleViolation::NotionalBelowMinimum { min: u(1_000_000) })
        );
        // Market SELL: shares × price vs $1 (MS1).
        let mut s = order(500_000, sh(2_000_000), Fok);
        s.side = Side::Sell;
        assert_eq!(r.check_order(&s), Ok(()));
        s.size = sh(1_990_000);
        assert!(matches!(
            r.check_order(&s),
            Err(RuleViolation::NotionalBelowMinimum { .. })
        ));
        // ts-compat validates nothing.
        let tc = ExchangeRules::ts_compat();
        assert_eq!(tc.check_order(&order(535_000, sh(1), Gtc)), Ok(()));
    }

    // spec: 11 §8 GTD arithmetic, §4 ts-compat GTD.
    #[test]
    fn gtd_arithmetic() {
        let g = GtdRules::REALISTIC;
        assert_eq!(gtd_stated_seconds(TsMs(1_780_272_180_999)), 1_780_272_180);
        assert_eq!(gtd_stated_seconds(TsMs(-1)), -1);
        // Lead: stated_s × 1000 ≥ arrival + 180 000.
        assert!(g.lead_ok(TsMs(1_180_999), TsMs(1_000_000)));
        assert!(g.lead_ok(TsMs(1_180_000), TsMs(1_000_000)));
        assert!(!g.lead_ok(TsMs(1_180_999), TsMs(1_000_001)));
        assert!(!g.lead_ok(TsMs(1_179_999), TsMs(1_000_000)));
        // Effective expiry: stated − 60 s.
        assert_eq!(g.effective_expiry(TsMs(1_180_999)), TsMs(1_120_000));
        let t = GtdRules::TS_COMPAT;
        assert!(t.lead_ok(TsMs(1_060_000), TsMs(1_000_000)));
        assert!(!t.lead_ok(TsMs(1_059_999), TsMs(1_000_000)));
        assert_eq!(t.effective_expiry(TsMs(1_180_999)), TsMs(1_180_999));
        // GD4: exerciser x3 (tick ts + 120 000) passes ts-compat, fails realistic.
        let x3 = TsMs(5_000_000 + 120_000);
        assert!(t.lead_ok(x3, TsMs(5_000_000)));
        assert!(!g.lead_ok(x3, TsMs(5_000_000)));
        let r = ExchangeRules::realistic_fallback(RulesTableVersion::V1, TsMs(0), TsMs(0));
        let mut o = order(500_000, OrderSize::Shares(q(5_000_000)), OrderType::Gtd);
        o.expire_at_ms = Some(x3);
        assert_eq!(
            r.check_gtd_lead(&o, TsMs(5_000_000)),
            Err(RuleViolation::GtdLeadTooShort {
                min_lead_ms: DurMs(180_000)
            })
        );
        o.order_type = OrderType::Gtc;
        assert_eq!(r.check_gtd_lead(&o, TsMs(5_000_000)), Ok(()));
    }

    // spec: 11 §9 batch and cancel caps, §4 ts-compat caps.
    #[test]
    fn caps() {
        let r = ExchangeRules::realistic_fallback(RulesTableVersion::V1, TsMs(0), TsMs(0));
        assert_eq!(r.check_batch_len(15), Ok(()));
        assert_eq!(
            r.check_batch_len(16),
            Err(RuleViolation::BatchTooLarge { max: 15 })
        );
        assert!(r.cancel_ids_ok(1_000) && !r.cancel_ids_ok(1_001));
        let t = ExchangeRules::ts_compat();
        assert_eq!(t.check_batch_len(10_000), Ok(()));
        assert!(t.cancel_ids_ok(3_000) && !t.cancel_ids_ok(3_001));
    }

    // spec: 11 §4 table.
    #[test]
    fn ts_compat_constants() {
        let t = ExchangeRules::ts_compat();
        assert_eq!(t.fee, FeeCurve::TS_COMPAT);
        assert_eq!(t.fee.canonical(), "symmetric:0.07:1:4");
        assert!(!t.validate && !t.taker_delay_enabled);
        assert_eq!(t.effective_taker_delay(), None);
        assert_eq!(t.gtd.min_lead, DurMs(60_000));
        assert_eq!(t.gtd.early_expiry, DurMs(0));
        assert_eq!(t.max_place_batch, None);
        assert_eq!(t.max_cancel_ids, 3_000);
        // Post-only: equality crosses, empty side accepts.
        assert!(post_only_would_cross(
            Side::Buy,
            p(500_000),
            Some(p(500_000))
        ));
        assert!(!post_only_would_cross(
            Side::Buy,
            p(490_000),
            Some(p(500_000))
        ));
        assert!(post_only_would_cross(
            Side::Sell,
            p(500_000),
            Some(p(500_000))
        ));
        assert!(!post_only_would_cross(
            Side::Sell,
            p(510_000),
            Some(p(500_000))
        ));
        assert!(!post_only_would_cross(Side::Buy, p(990_000), None));
    }

    #[test]
    fn reservations() {
        // ts-compat: 0.6 × 800 + 13.44 = 493.44 (`capital.test.ts`).
        let r = buy_reservation(
            &FeeCurve::TS_COMPAT,
            OrderType::Gtc,
            p(600_000),
            OrderSize::Shares(q(800_000_000)),
            false,
            p(10_000),
            Rounding::HalfAwayFromZero,
        )
        .unwrap();
        assert_eq!(r, u(493_440_000));
        let po = buy_reservation(
            &FeeCurve::TS_COMPAT,
            OrderType::Gtc,
            p(600_000),
            OrderSize::Shares(q(800_000_000)),
            true,
            p(10_000),
            Rounding::HalfAwayFromZero,
        )
        .unwrap();
        assert_eq!(po, u(480_000_000));
        // Realistic collateral BUY, exponent 1: amount × rate × (1 − tick).
        let c = buy_reservation(
            &ERA3,
            OrderType::Fok,
            p(600_000),
            OrderSize::Collateral(u(10_000_000)),
            false,
            p(10_000),
            Rounding::Ceil,
        )
        .unwrap();
        // 10 × 0.07 × 0.99 = 0.693
        assert_eq!(c, u(10_693_000));
        // The bound dominates the fee at every tick price in [tick, limit].
        for curve in [ERA1, ERA3, WIP_ERA1] {
            let a = u(7_000_000);
            let bound = curve
                .max_fee_collateral_buy(a, p(10_000), p(900_000))
                .unwrap();
            for px in (10_000..=900_000).step_by(10_000) {
                let sh = Qty::for_collateral(a, p(px), Rounding::Floor).unwrap();
                assert!(curve.taker_fee(p(px), sh).unwrap() <= bound, "{curve} {px}");
            }
        }
    }

    #[test]
    fn timeline_cursor_and_provenance() {
        let v = RulesTableVersion::V1;
        let start = TsMs(1_786_964_000_000);
        let tl = RulesTimeline::realistic_fallback(
            v,
            start,
            start,
            TsMs(start.0 + 900_000),
            [(
                TsMs(start.0 + 500_000),
                RulesChange::Tick {
                    outcome: Outcome::Down,
                    tick: p(1_000),
                    origin: TickOrigin::Inferred,
                },
            )],
        );
        assert_eq!(tl.fee_era, FeeEraId::F3);
        assert_eq!(tl.provenance.source(), RulesSource::Fallback);
        let mut c = tl.cursor();
        assert_eq!(c.at(start).taker_delay.row, DelayRowId::D3);
        assert_eq!(
            c.at(TsMs(1_786_964_400_000)).taker_delay.row,
            DelayRowId::D4
        );
        assert_eq!(c.current().tick[Outcome::Down], p(10_000));
        let r = *c.at(TsMs(start.0 + 500_000));
        assert_eq!(r.tick[Outcome::Down], p(1_000));
        assert_eq!(r.tick[Outcome::Up], p(10_000));
        assert_eq!(r.effective_taker_delay().unwrap().delay, DurMs(50));

        let pre = FieldSource::Captured {
            origin: Origin::V4Bootstrap,
            phase: Phase::PreStart,
        };
        let fb = FieldSource::Fallback { table: v };
        let mut prov = RulesProvenance {
            fields: [pre; 6],
            optional_captured: false,
        };
        assert_eq!(prov.source(), RulesSource::Snapshot);
        prov.fields[RequiredField::TakerDelayEnabled as usize] = fb;
        assert_eq!(prov.source(), RulesSource::Partial);
        assert!(prov.source().is_flagged());
        prov.fields[RequiredField::TakerDelayEnabled as usize] = FieldSource::Captured {
            origin: Origin::Clob,
            phase: Phase::PostStart,
        };
        assert_eq!(prov.source(), RulesSource::Partial);
        assert_eq!(RulesTableVersion::parse("rules-table-v1"), Some(v));
        assert_eq!(RulesTableVersion::parse("rules-table-v2"), None);
        assert_eq!(signing_domain(MarketVersion::V2, false).0, "3");
    }

    #[test]
    fn rules_are_small_and_copy() {
        assert!(std::mem::size_of::<ExchangeRules>() <= 160);
    }
}
