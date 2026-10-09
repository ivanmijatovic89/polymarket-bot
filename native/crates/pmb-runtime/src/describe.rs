//! `describe` and `schema` (20 §5.1, §5.2): identity, capabilities, rule
//! tables, engine constants, params validation and the compiled schemas.
//!
//! `describe` is pure: no file reads except the named `--params-file`, no
//! network, no clock.

use pmb_contract::{JOB_SCHEMA_VERSION, MODEL_CONFIG_VERSION, OUTPUT_SCHEMA_VERSION};
use pmb_core::fixed::format_micros;
use pmb_core::rules::{
    DelayRowId, FeeCurve, FeeEraId, GtdRules, RequiredField, RuleId, RulesTableVersion,
    Verification, DELAY_TABLE_V1, FALLBACK_MIN_NOTIONAL_MARKET, FALLBACK_MIN_SIZE_RESTING,
    FALLBACK_TICK, FEE_ERAS_V1, MAX_CANCEL_IDS, MAX_FEE_EXPONENT, MAX_PLACE_BATCH,
    REALISTIC_FEE_DP, TS_COMPAT_MAX_CANCEL_IDS, VALID_TICKS,
};
use pmb_engine::strategy::{Interests, Requirements};
use pmb_engine::Strategy;
use serde_json::{json, Map, Value};

use crate::identity::{
    contract_sha256, engine_identity, JOURNAL_FORMAT, LEDGER_FORMAT, PROTOCOL_VERSION, TRACE_FORMAT,
};
use crate::panic::catch;
use crate::params::{params_equal, ParamError, StrategyParams};

/// Subcommands this binary implements (M1; 20 §1). `run-group` (M4),
/// `serve` (M5a) and `paper` (M8) are refused and not listed.
pub const SUBCOMMANDS: [&str; 4] = ["describe", "schema", "selftest", "run"];
/// Input modes (M1: telonex-delta only; recorder-v4 M7, journal M8).
pub const INPUT_MODES: [&str; 1] = ["telonex-delta"];
/// Profiles (M1: ts-compat only; realistic M3b).
pub const PROFILES: [&str; 1] = ["ts-compat"];
/// Optional engine features (20 §3) this binary implements: none yet.
/// `parity_trace` and `parity_trace_feeds` are listed once the sink renders
/// `intent` and `event` records (22 §3.2, §3.3), which needs pmb-engine's
/// intent and account-event read accessors (crossStreamNeeds). Until then a
/// trace request is refused at job planning (`crate::job`), so the result
/// never depends on whether an output was requested (20 G5, 22 §2).
pub const FEATURES: &[&str] = &[];

/// Whether this binary implements the optional feature `name` (20 §3).
pub fn has_feature(name: &str) -> bool {
    FEATURES.contains(&name)
}
/// Candidates per job: `run` takes exactly one; groups are M4.
pub const MAX_CANDIDATES: u32 = 1;

/// The `binary` object of `describe` (20 §5.1).
pub fn binary_json(sdk_version: &str) -> Value {
    let id = engine_identity();
    json!({
        "engineVersion": id.engine_version,
        "engineCommit": id.engine_commit,
        "engineDirty": id.engine_dirty,
        "engineSourceHash": id.engine_source_hash,
        "sdkVersion": sdk_version,
        "rustc": id.rustc,
        "target": id.target,
        "buildProfile": id.build_profile,
        "contractSha256": contract_sha256().as_str(),
    })
}

/// The `capabilities` object (20 §3), honest for M1.
pub fn capabilities_json() -> Value {
    json!({
        "subcommands": SUBCOMMANDS,
        "inputModes": INPUT_MODES,
        "profiles": PROFILES,
        "jobSchemaVersions": [JOB_SCHEMA_VERSION],
        "outputSchemaVersions": [OUTPUT_SCHEMA_VERSION],
        "modelConfigVersions": [MODEL_CONFIG_VERSION],
        "rulesTables": RulesTableVersion::ALL.iter().map(|v| rules_table_json(*v)).collect::<Vec<_>>(),
        "features": FEATURES,
        "traceFormat": TRACE_FORMAT,
        "ledgerFormat": LEDGER_FORMAT,
        "journalFormat": JOURNAL_FORMAT,
        "maxCandidates": MAX_CANDIDATES,
        "realOrders": false,
    })
}

/// Engine constants of 14 F-47, exported and not configurable.
// D-PENDING: the owners are pmb-feeds and pmb-plugins (not on this branch);
// the values are the spec's (14 F-12/F-13 lookback and tail, F-19 floor,
// F-21 tail, P-12 TA lookback) until those crates export them.
pub fn engine_constants_json() -> Value {
    json!({
        "feedLookbackMs": 300_000,
        "binanceTailMs": 2_000,
        "chainlinkTailMs": 5_000,
        "chainlinkCoverageFloorMs": 1_775_088_000_000_i64,
        "technicalIndicatorsLookbackMs": 160_i64 * 3_600_000,
    })
}

/// Every rule id of 11 §14 (rules-table-v1).
const ALL_RULES: [RuleId; 26] = [
    RuleId::FeeF0,
    RuleId::FeeF1,
    RuleId::FeeF2,
    RuleId::FeeF3,
    RuleId::FeeRounding,
    RuleId::FeeGranularity,
    RuleId::FillAmounts,
    RuleId::DelayD0,
    RuleId::DelayD1,
    RuleId::DelayD2,
    RuleId::DelayD3,
    RuleId::DelayD4,
    RuleId::DelayD5,
    RuleId::DelayResponse,
    RuleId::GtdLead,
    RuleId::GtdEarly,
    RuleId::TickBounds,
    RuleId::TickChange,
    RuleId::MinResting,
    RuleId::MinMarket,
    RuleId::MarketBuyCollateral,
    RuleId::PostOnlyCross,
    RuleId::BatchCap,
    RuleId::CancelCap,
    RuleId::MarketClosed,
    RuleId::SelfTrade,
];

/// Compile-time guard: a new `RuleId` variant fails here until it is added
/// to [`ALL_RULES`].
const fn rule_index(r: RuleId) -> usize {
    match r {
        RuleId::FeeF0 => 0,
        RuleId::FeeF1 => 1,
        RuleId::FeeF2 => 2,
        RuleId::FeeF3 => 3,
        RuleId::FeeRounding => 4,
        RuleId::FeeGranularity => 5,
        RuleId::FillAmounts => 6,
        RuleId::DelayD0 => 7,
        RuleId::DelayD1 => 8,
        RuleId::DelayD2 => 9,
        RuleId::DelayD3 => 10,
        RuleId::DelayD4 => 11,
        RuleId::DelayD5 => 12,
        RuleId::DelayResponse => 13,
        RuleId::GtdLead => 14,
        RuleId::GtdEarly => 15,
        RuleId::TickBounds => 16,
        RuleId::TickChange => 17,
        RuleId::MinResting => 18,
        RuleId::MinMarket => 19,
        RuleId::MarketBuyCollateral => 20,
        RuleId::PostOnlyCross => 21,
        RuleId::BatchCap => 22,
        RuleId::CancelCap => 23,
        RuleId::MarketClosed => 24,
        RuleId::SelfTrade => 25,
    }
}

fn verification_str(v: Verification) -> &'static str {
    match v {
        Verification::Charged => "charged",
        Verification::Observed => "observed",
        Verification::Changelog => "changelog",
        Verification::Docs => "docs",
        Verification::ThirdParty => "third_party",
        Verification::Assumed => "assumed",
    }
}

fn required_field_str(f: RequiredField) -> &'static str {
    match f {
        RequiredField::Tick => "tick",
        RequiredField::MinSizeResting => "minSizeResting",
        RequiredField::Fee => "fee",
        RequiredField::TakerDelayEnabled => "takerDelayEnabled",
        RequiredField::NegRisk => "negRisk",
        RequiredField::Version => "version",
    }
}

fn gtd_json(g: GtdRules) -> Value {
    json!({
        "minLeadMs": g.min_lead.0,
        "earlyExpiryMs": g.early_expiry.0,
        "wholeSeconds": g.whole_seconds,
    })
}

fn fee_era_id_rule(id: FeeEraId) -> &'static str {
    id.rule().as_str()
}

fn delay_rule(id: DelayRowId) -> &'static str {
    id.rule().as_str()
}

/// One rule table as constant data (11 §13.5 VR2): dated fee and delay
/// rows, fallback constants, the RS4 required-field set and the
/// verification status of each rule id.
pub fn rules_table_json(v: RulesTableVersion) -> Value {
    let (fees, delays) = match v {
        RulesTableVersion::V1 => (&FEE_ERAS_V1, &DELAY_TABLE_V1),
    };
    let fee_rows: Vec<Value> = fees
        .iter()
        .map(|r| {
            json!({
                "id": r.id.as_str(),
                "fromMs": r.from_ms.map(|t| t.0),
                "toMs": r.to_ms.map(|t| t.0),
                "feeCurve": r.curve.canonical(),
                "rule": fee_era_id_rule(r.id),
            })
        })
        .collect();
    let delay_rows: Vec<Value> = delays
        .iter()
        .map(|r| {
            json!({
                "id": r.delay.row.as_str(),
                "fromMs": r.from_ms.map(|t| t.0),
                "delayMs": r.delay.delay.0,
                "cancelable": r.delay.cancelable,
                "thirdParty": r.delay.row.is_third_party(),
                "rule": delay_rule(r.delay.row),
            })
        })
        .collect();
    let rules: Vec<Value> = ALL_RULES
        .iter()
        .map(|r| {
            debug_assert_eq!(ALL_RULES[rule_index(*r)], *r);
            json!({
                "id": r.as_str(),
                "verification": verification_str(r.verification()),
                "unverified": r.is_unverified(),
            })
        })
        .collect();
    let ticks: Vec<String> = VALID_TICKS
        .iter()
        .map(|(t, _)| format_micros(t.micros()))
        .collect();
    json!({
        "version": v.as_str(),
        "feeEras": fee_rows,
        "takerDelays": delay_rows,
        "fallback": {
            "tick": format_micros(FALLBACK_TICK.micros()),
            "validTicks": ticks,
            "minSizeResting": format_micros(FALLBACK_MIN_SIZE_RESTING.micros()),
            "minNotionalMarket": format_micros(FALLBACK_MIN_NOTIONAL_MARKET.micros()),
            "maxPlaceBatch": MAX_PLACE_BATCH,
            "maxCancelIds": MAX_CANCEL_IDS,
            "gtd": gtd_json(GtdRules::REALISTIC),
            "feeDp": REALISTIC_FEE_DP,
            "maxFeeExponent": MAX_FEE_EXPONENT,
        },
        "tsCompat": {
            "feeCurve": FeeCurve::TS_COMPAT.canonical(),
            "maxCancelIds": TS_COMPAT_MAX_CANCEL_IDS,
            "gtd": gtd_json(GtdRules::TS_COMPAT),
        },
        "requiredFields": RequiredField::ALL.iter().map(|f| required_field_str(*f)).collect::<Vec<_>>(),
        "rules": rules,
    })
}

/// Params evaluated against the strategy (20 §5.1, 30 §4 rule 3).
pub struct Evaluated<T: Strategy> {
    /// Typed params.
    pub params: T::Params,
    /// Normalized object.
    pub normalized: Map<String, Value>,
    /// Feed and plugin requirements.
    pub requirements: Requirements,
    /// Callback interests.
    pub interests: Interests,
}

/// Parses, validates and normalizes `obj`, then evaluates `requirements`
/// and `interests`. Every call into strategy code is inside a catch
/// boundary (30 §12); a panic there is reported like invalid params.
/// Normalization must be idempotent (20 §5.1).
pub fn evaluate<T>(obj: &Map<String, Value>) -> Result<Evaluated<T>, Vec<ParamError>>
where
    T: Strategy,
    T::Params: StrategyParams,
{
    let panic_err = |what: &str, p: crate::panic::CaughtPanic| {
        vec![ParamError::new(
            "",
            format!("panic in {what}: {}", p.message),
        )]
    };
    let params =
        catch(|| T::Params::from_json(obj)).map_err(|p| panic_err("params parsing", p))??;
    let normalized =
        catch(|| params.to_normalized()).map_err(|p| panic_err("params normalization", p))?;
    // Idempotence (20 §5.1, 30 §9 rule 6).
    let again = catch(|| T::Params::from_json(&normalized).map(|p2| p2.to_normalized()))
        .map_err(|p| panic_err("params normalization", p))?
        .map_err(|errs| {
            let mut v = vec![ParamError::new(
                "",
                "normalized params do not parse again (normalization is not idempotent)",
            )];
            v.extend(errs);
            v
        })?;
    if !params_equal(&Value::Object(again), &Value::Object(normalized.clone())) {
        return Err(vec![ParamError::new(
            "",
            "normalization is not idempotent (30 §9 rule 6)",
        )]);
    }
    let requirements =
        catch(|| T::requirements(&params)).map_err(|p| panic_err("requirements", p))?;
    let interests = catch(|| T::interests(&params)).map_err(|p| panic_err("interests", p))?;
    Ok(Evaluated {
        params,
        normalized,
        requirements,
        interests,
    })
}

/// `requiredFeeds` in the TS `ExternalFeedsRequestConfig` shape, or `null`
/// (20 §5.1, 30 §10).
// D-PENDING: `Requirements` is a stand-in without builders until pmb-feeds
// lands, so it can only be "nothing requested" (`null`); integration maps
// the real builders (30 §10 table).
pub fn required_feeds_json(r: &Requirements) -> Value {
    debug_assert!(
        requests_nothing(r),
        "the stand-in Requirements has no builders"
    );
    Value::Null
}

/// Whether the requirements request no feed and no plugin.
pub fn requests_nothing(r: &Requirements) -> bool {
    *r == Requirements::new()
}

/// One `results[]` entry of `describe` (20 §5.1).
pub fn result_entry<T>(obj: &Map<String, Value>) -> (bool, Value)
where
    T: Strategy,
    T::Params: StrategyParams,
{
    match evaluate::<T>(obj) {
        Ok(ev) => (
            true,
            json!({
                "ok": true,
                "params": Value::Object(ev.normalized),
                "requiredFeeds": required_feeds_json(&ev.requirements),
            }),
        ),
        Err(errs) => (
            false,
            json!({
                "ok": false,
                "errors": errs.iter().map(ParamError::to_json).collect::<Vec<_>>(),
            }),
        ),
    }
}

/// The `describe` document (20 §5.1). `results` lists one entry per
/// evaluated param object (empty without `--params`/`--params-file`).
pub fn describe_doc<T>(sdk_version: &str, results: Vec<Value>) -> Value
where
    T: Strategy,
    T::Params: StrategyParams,
{
    json!({
        "type": "describe",
        "protocolVersion": PROTOCOL_VERSION,
        "binary": binary_json(sdk_version),
        "capabilities": capabilities_json(),
        "engineConstants": engine_constants_json(),
        "strategy": {
            "id": T::ID,
            "paramsSchema": T::Params::json_schema(),
            "results": results,
        },
    })
}

/// The `schema` document (20 §5.2): the bundle compiled into the binary
/// plus the strategy's params schema.
// D-PENDING: `liveConfig`, `traceRecord`, `ledgerRecord`, `serveIn` and
// `serveOut` are not in the pmb-contract bundle yet; only the schemas that
// exist are printed (and hashed).
pub fn schema_doc<T>() -> Value
where
    T: Strategy,
    T::Params: StrategyParams,
{
    let mut schemas = Map::new();
    for (stem, schema) in pmb_contract::schema::bundle() {
        schemas.insert(stem.to_string(), schema);
    }
    schemas.insert("params".to_string(), T::Params::json_schema());
    json!({
        "type": "schema",
        "contractSha256": contract_sha256().as_str(),
        "schemas": Value::Object(schemas),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_are_honest_for_m1() {
        // spec: 20 §3, §5.1 (capabilities; M1 subset), 20 §1 (realOrders false in standard)
        let c = capabilities_json();
        assert_eq!(
            c["subcommands"],
            json!(["describe", "schema", "selftest", "run"])
        );
        assert_eq!(c["inputModes"], json!(["telonex-delta"]));
        assert_eq!(c["profiles"], json!(["ts-compat"]));
        // No parity_trace before intent and event records render (22 §3.2).
        assert_eq!(c["features"], json!([]));
        assert!(!has_feature("parity_trace") && !has_feature("parity_trace_feeds"));
        assert_eq!(c["realOrders"], json!(false));
        assert_eq!(c["jobSchemaVersions"], json!([1]));
        assert_eq!(c["traceFormat"], "pmb-parity-trace/2");
        let t = &c["rulesTables"][0];
        assert_eq!(t["version"], "rules-table-v1");
        assert_eq!(t["feeEras"].as_array().unwrap().len(), 4);
        assert_eq!(t["takerDelays"].as_array().unwrap().len(), 6);
        assert_eq!(t["rules"].as_array().unwrap().len(), 26);
        assert_eq!(t["tsCompat"]["feeCurve"], "symmetric:0.07:1:4");
        assert_eq!(t["fallback"]["tick"], "0.01");
        assert_eq!(t["requiredFields"].as_array().unwrap().len(), 6);
    }

    #[test]
    fn rule_list_is_exhaustive() {
        for (i, r) in ALL_RULES.iter().enumerate() {
            assert_eq!(rule_index(*r), i);
        }
    }
}
