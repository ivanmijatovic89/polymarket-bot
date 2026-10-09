//! The per-market `market.rules` record (21 §7; shape owned by 11 §13.4).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::num::{Decimal, SafeI64, SafeU64};
use crate::support::{ensure, ContractError};
use crate::vocab::{MarketVersion, RulesOrigin, RulesPhase};

/// `market.rules`: captured values only (11 JC1).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketRules {
    /// Positive; `null` iff `captured` is empty.
    #[serde(deserialize_with = "crate::support::nullable")]
    #[schemars(range(min = 1))]
    pub snapshot_parser_version: Option<u32>,
    pub captured: CapturedRules,
    /// RS3 Gamma-vs-CLOB disagreements.
    pub disagreements: u32,
}

impl MarketRules {
    /// The empty form every job carries before M3a (21 §7.2).
    pub fn empty() -> Self {
        MarketRules {
            snapshot_parser_version: None,
            captured: CapturedRules::default(),
            disagreements: 0,
        }
    }
}

/// One captured value with its provenance (21 §7.1).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(rename = "Captured_{T}")]
pub struct Captured<T> {
    pub value: T,
    pub origin: RulesOrigin,
    pub phase: RulesPhase,
    /// `exchange_rules_snapshots.id`, positive.
    #[schemars(range(min = 1))]
    pub snapshot_id: SafeU64,
}

/// `captured`: any subset of the 11 keys of 11 §13.4.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturedRules {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<Decimal>")]
    pub tick: Option<Captured<Decimal>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<Decimal>")]
    pub min_size_resting: Option<Captured<Decimal>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<bool>")]
    pub fees_enabled: Option<Captured<bool>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<FeeType>")]
    pub fee_type: Option<Captured<FeeType>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<FeeSchedule>")]
    pub fee_schedule: Option<Captured<FeeSchedule>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<bool>")]
    pub taker_delay_enabled: Option<Captured<bool>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<bool>")]
    pub neg_risk: Option<Captured<bool>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<MarketVersion>")]
    pub version: Option<Captured<MarketVersion>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<u32>")]
    pub seconds_delay: Option<Captured<u32>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<u32>")]
    pub min_order_age_s: Option<Captured<u32>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::support::present"
    )]
    #[schemars(with = "Captured<SafeI64>")]
    pub accepting_orders_timestamp_ms: Option<Captured<SafeI64>>,
}

/// Gamma `feeType`, `^[a-z0-9_]{1,64}$`; unknown types are accepted here and
/// handled by 11 FE3.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct FeeType(#[schemars(regex(pattern = r"^[a-z0-9_]{1,64}$"))] pub String);

/// `feeSchedule {rate, exponent, takerOnly}` (11 §13.4).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeeSchedule {
    pub rate: Decimal,
    /// 0..=4 (11 FE3).
    #[schemars(range(max = 4))]
    pub exponent: u8,
    pub taker_only: bool,
}

/// Valid ticks in micros (11 §7.1).
pub const VALID_TICKS_MICROS: [i64; 6] = [100_000, 10_000, 5_000, 2_500, 1_000, 100];

impl CapturedRules {
    pub fn is_empty(&self) -> bool {
        self == &CapturedRules::default()
    }

    fn snapshot_ids(&self) -> Vec<SafeU64> {
        let mut ids = Vec::new();
        macro_rules! push {
            ($($f:ident),*) => { $( if let Some(c) = &self.$f { ids.push(c.snapshot_id); } )* };
        }
        push!(
            tick,
            min_size_resting,
            fees_enabled,
            fee_type,
            fee_schedule,
            taker_delay_enabled,
            neg_risk,
            version,
            seconds_delay,
            min_order_age_s,
            accepting_orders_timestamp_ms
        );
        ids
    }
}

impl MarketRules {
    /// 11 JC2 checks that need no rule table; `invalid_input: rules`.
    pub fn validate(&self) -> Result<(), ContractError> {
        let c = "rules";
        let cap = &self.captured;
        ensure(
            cap.is_empty() == self.snapshot_parser_version.is_none(),
            c,
            || "snapshotParserVersion must be null iff captured is empty".into(),
        )?;
        ensure(self.snapshot_parser_version != Some(0), c, || {
            "snapshotParserVersion must be positive".into()
        })?;
        ensure(cap.snapshot_ids().iter().all(|id| id.get() > 0), c, || {
            "snapshotId must be positive".into()
        })?;
        if let Some(t) = &cap.tick {
            ensure(VALID_TICKS_MICROS.contains(&t.value.micros()), c, || {
                format!("tick {} is not a valid tick (11 §7.1)", t.value)
            })?;
            ensure(t.phase == RulesPhase::PreStart, c, || {
                "tick is captured only pre_start (11 RS2)".into()
            })?;
        }
        if let Some(m) = &cap.min_size_resting {
            ensure(m.value.micros() > 0, c, || {
                "minSizeResting must be > 0".into()
            })?;
        }
        if let Some(t) = &cap.fee_type {
            let s = &t.value.0;
            ensure(
                !s.is_empty()
                    && s.len() <= 64
                    && s.bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'),
                c,
                || format!("feeType {s:?} does not match ^[a-z0-9_]{{1,64}}$"),
            )?;
        }
        if let Some(f) = &cap.fee_schedule {
            ensure(f.value.exponent <= 4, c, || {
                "feeSchedule.exponent must be <= 4 (11 FE3)".into()
            })?;
            ensure(!f.value.rate.is_negative(), c, || {
                "feeSchedule.rate must be >= 0".into()
            })?;
        }
        if let Some(n) = &cap.neg_risk {
            ensure(!n.value, c, || {
                "negRisk markets are out of scope (11 V4)".into()
            })?;
        }
        Ok(())
    }
}
