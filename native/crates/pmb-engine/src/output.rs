//! Per-market output: the mapping of a finished session to
//! `EngineMarketOutput` (21 §11), the null-vs-zero-row and skip taxonomy
//! (21 §13), `eventsProcessed`/`eventsByType` (21 §15), `intentMeta`
//! materialization and caps (21 §16), the closed vocabularies (21 §17), the
//! number rules (21 §18) and output quantization (10 §4).
//!
//! Every value is computed from exact fixed-point state and rounded exactly
//! once here (10 §3.1 R-3, D08). This is the only place where engine values
//! become `pmb_contract::result` types; it runs once per candidate at the end
//! of a market, never on the hot path.

use std::collections::BTreeMap;

use pmb_contract::num::{Decimal, OutDec2, OutDec4, SafeU64};
use pmb_contract::result::{
    check_intent_meta_caps, CandidateCounters, EngineMarketOutput, EngineMarketStats, ErrorDetail,
    ErrorInfo, EventsByType, MarketStatsRules,
};
use pmb_contract::vocab::{ErrorClass, Outcome as ContractOutcome, SkipReason, StatsSkipReason};
use pmb_core::fixed::div_round_i128;
use pmb_core::{FinalOutcome, MarketInfo, Outcome, Rounding};
use serde_json::{Map, Value};

use crate::core_rules::CoreRules;
use crate::session::{SessionFault, SessionOutput, StrategyFaultCause};
use crate::stats::MarketStatsAcc;

/// Why a finished session produced no `EngineMarketOutput`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OutputError {
    /// `intentMeta` over its per-market caps: `strategy_fault:
    /// intent_meta_limit` for this candidate only (21 §13, §16).
    IntentMetaLimit {
        /// Entries of the would-be `intentMeta`.
        entries: usize,
        /// Serialized bytes of the would-be `intentMeta` array.
        bytes: usize,
    },
    /// The egress self-check failed: `invalid_output: self_check`, an engine
    /// bug (21 §19).
    SelfCheck(String),
}

impl OutputError {
    /// The `ErrorInfo` of this failure (21 §10, 20 §4.1).
    pub fn error_info(&self) -> ErrorInfo {
        match self {
            OutputError::IntentMetaLimit { entries, bytes } => ErrorInfo {
                class: ErrorClass::StrategyFault,
                cause: "intent_meta_limit".into(),
                message: format!(
                    "intentMeta has {entries} entries and {bytes} bytes; the per-market caps \
                     are 10000 entries and 1048576 bytes"
                ),
                detail: None,
            },
            OutputError::SelfCheck(m) => ErrorInfo {
                class: ErrorClass::InvalidOutput,
                cause: "self_check".into(),
                message: one_line(m),
                detail: None,
            },
        }
    }
}

/// One line of at most 1,000 characters (21 §10 `ErrorInfo.message`).
fn one_line(s: &str) -> String {
    s.chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .take(1_000)
        .collect()
}

/// The `ErrorInfo` of a session fault (21 §10, §13; 20 §4.1; 12 §11).
pub fn fault_error_info(fault: &SessionFault) -> ErrorInfo {
    match fault {
        SessionFault::Strategy {
            cause,
            callback,
            tick_seq,
            at,
        } => {
            let (cause, message) = match cause {
                StrategyFaultCause::Panic { message } => ("panic", message.clone()),
                StrategyFaultCause::Error { message } => ("error", message.clone()),
                StrategyFaultCause::CascadeLimit {
                    seq,
                    tick,
                    deliveries,
                } => (
                    "cascade_limit",
                    format!(
                        "cascade budget exceeded: {deliveries} deliveries in one drain \
                         (envelope {seq}, tick {tick})"
                    ),
                ),
                StrategyFaultCause::IntentMetaLimit => (
                    "intent_meta_limit",
                    "intentMeta exceeds the per-market caps (10000 entries, 1048576 bytes)".into(),
                ),
            };
            ErrorInfo {
                class: ErrorClass::StrategyFault,
                cause: cause.into(),
                message: one_line(&message),
                detail: Some(ErrorDetail {
                    callback: Some((*callback).into()),
                    seq: SafeU64::new(*tick_seq),
                    ts_ms: u64::try_from(at.0).ok().and_then(SafeU64::new),
                    ..ErrorDetail::default()
                }),
            }
        }
        SessionFault::Engine { message } => ErrorInfo {
            class: ErrorClass::EngineFault,
            cause: "invariant".into(),
            message: one_line(message),
            detail: None,
        },
    }
}

/// 2 dp `HalfAwayFromZero` from exact micros (10 §3.3 R15, §4).
#[inline]
fn dp2(micros: i64) -> OutDec2 {
    OutDec2::from_micros_half_away(micros)
}

/// Average entry price at 4 dp in one `HalfAwayFromZero` step from the exact
/// rational Σ(p×q) / Σq (10 §3.3 R14, R-3); `None` without BUY fills.
fn avg_entry(vwap: (i128, i128)) -> Result<Option<OutDec4>, OutputError> {
    let (num, den) = vwap;
    if den == 0 {
        return Ok(None);
    }
    // num is micros², den micros: price micros = num / den; 4 dp units =
    // num / (den × 100).
    let units = den
        .checked_mul(100)
        .and_then(|d| div_round_i128(num, d, Rounding::HalfAwayFromZero).ok())
        .and_then(|u| i64::try_from(u).ok())
        .ok_or_else(|| OutputError::SelfCheck("avgEntryPrice overflow".into()))?;
    Ok(Some(OutDec4::from_units(units)))
}

fn contract_outcome(o: Outcome) -> ContractOutcome {
    match o {
        Outcome::Up => ContractOutcome::Up,
        Outcome::Down => ContractOutcome::Down,
    }
}

fn count_u32(name: &str, v: u64) -> Result<u32, OutputError> {
    u32::try_from(v)
        .ok()
        .filter(|&x| x <= i32::MAX as u32)
        .ok_or_else(|| OutputError::SelfCheck(format!("{name}: {v} above 2^31-1")))
}

/// Materializes `intentMeta` from the session meta store (21 §16, 10 §7.5
/// E2) and enforces the per-market caps.
fn intent_meta(out: &SessionOutput) -> Result<Vec<Map<String, Value>>, OutputError> {
    let mut v = Vec::with_capacity(out.stats.intent_meta.len());
    for &id in &out.stats.intent_meta {
        let text = out.metas.get(id);
        let m: Map<String, Value> = serde_json::from_str(text).map_err(|e| {
            OutputError::SelfCheck(format!("intentMeta entry is not a JSON object: {e}"))
        })?;
        v.push(m);
    }
    if check_intent_meta_caps(&v).is_err() {
        let bytes = serde_json::to_vec(&v).map_or(usize::MAX, |b| b.len());
        return Err(OutputError::IntentMetaLimit {
            entries: v.len(),
            bytes,
        });
    }
    Ok(v)
}

/// What the output stage needs besides the session result.
#[derive(Clone, Copy, Debug)]
pub struct OutputContext<'a> {
    /// The market (slug, condition id).
    pub info: &'a MarketInfo,
    /// `market.outcome` of the job (21 §5.1).
    pub outcome: FinalOutcome,
    /// The session's rule set (12 §2.3).
    pub core_rules: CoreRules,
    /// Per-market rules provenance (11 §13.8): required in realistic, MUST
    /// be `None` in ts-compat, where `MarketStats.rules` is `null`.
    pub rules: Option<&'a MarketStatsRules>,
}

/// Maps a finished session to its `EngineMarketOutput` (21 §11) and runs
/// the egress self-check (21 §19).
///
/// Taxonomy (21 §13): no counted tick ⇒ `marketStats: null` with
/// `skipReason: no_activity`; counted ticks but no fill and no UP/DOWN
/// quantity > 0 at the end ⇒ the zero row tagged `no_in_window_activity`
/// with top-level `no_activity`; otherwise the full row. Zero-row money
/// fields come from the same formulas, so split/merge-only activity shows
/// in them.
pub fn market_output(
    cx: &OutputContext<'_>,
    out: &SessionOutput,
) -> Result<EngineMarketOutput, OutputError> {
    let ticks = &out.acc.ticks;
    let events_processed = SafeU64::new(ticks.events_processed())
        .ok_or_else(|| OutputError::SelfCheck("eventsProcessed above 2^53-1".into()))?;
    let events_by_type = EventsByType::from_counts(ticks.by_cause)
        .ok_or_else(|| OutputError::SelfCheck("eventsByType above 2^53-1".into()))?;
    let slug: &str = &cx.info.slug;
    let rules = match (cx.core_rules, cx.rules) {
        // 21 §11: `rules` is null in ts-compat.
        (CoreRules::TsCompat, None) => Some(None),
        (CoreRules::Realistic, Some(r)) => Some(Some(r.clone())),
        (CoreRules::TsCompat, Some(_)) => {
            return Err(OutputError::SelfCheck(
                "MarketStats.rules given for a ts-compat session (21 §11)".into(),
            ))
        }
        (CoreRules::Realistic, None) => {
            return Err(OutputError::SelfCheck(
                "MarketStats.rules missing for a realistic session (11 §13.8)".into(),
            ))
        }
    };

    if events_processed.get() == 0 {
        // 21 §13 row 3: no counted tick at all.
        let o = EngineMarketOutput {
            slug: slug.to_owned(),
            market_stats: None,
            events_processed,
            events_by_type,
            skip_reason: Some(SkipReason::NoActivity),
            coverage_reasons: None,
        };
        o.self_check()
            .map_err(|e| OutputError::SelfCheck(e.to_string()))?;
        return Ok(o);
    }

    let s = &out.stats;
    let active = s.trade_count > 0 || Outcome::ALL.iter().any(|&o| s.shares[o] > 0);
    let up = s.shares[Outcome::Up];
    let down = s.shares[Outcome::Down];
    let stats = EngineMarketStats {
        // D-PENDING: 21 §11 takes `marketId` from the first counted tick's
        // book event, but engine market events carry no market id (the
        // telonex tape has one `market` column per file, checked against the
        // job by 15 I-18); chose the job's condition id, which is that value
        // whenever a counted tick exists.
        market_id: cx.info.condition_id.to_string(),
        slug: slug.to_owned(),
        final_outcome: contract_outcome(cx.outcome.winner()),
        pnl: dp2(s.pnl.micros()),
        trade_count: count_u32("tradeCount", s.trade_count)?,
        trade_as_maker: count_u32("tradeAsMaker", s.trade_as_maker)?,
        trade_as_taker: count_u32("tradeAsTaker", s.trade_as_taker)?,
        fees_paid: dp2(s.fees_paid.micros()),
        avg_entry_price_up: avg_entry(s.buy_vwap[Outcome::Up])?,
        avg_entry_price_down: avg_entry(s.buy_vwap[Outcome::Down])?,
        up_shares: dp2(up),
        down_shares: dp2(down),
        // 21 §11: min(up, down) on micros before rounding.
        mergable_shares: dp2(up.min(down)),
        cost: dp2(s.cost.micros()),
        split_cost: dp2(s.split_cost.micros()),
        intent_meta: intent_meta(out)?,
        skip_reason: (!active).then_some(StatsSkipReason::NoInWindowActivity),
        rules,
    };
    let o = EngineMarketOutput {
        slug: slug.to_owned(),
        market_stats: Some(stats),
        events_processed,
        events_by_type,
        skip_reason: (!active).then_some(SkipReason::NoActivity),
        coverage_reasons: None,
    };
    o.self_check()
        .map_err(|e| OutputError::SelfCheck(e.to_string()))?;
    Ok(o)
}

/// The capital-aware counters of one candidate (21 §10 `counters`,
/// diagnostics only): rejections keyed by reason code (21 §17), notional
/// and peak reservation as exact decimals, `strategyTicksSkipped`
/// (16 TF-6).
pub fn candidate_counters(
    key: &str,
    acc: &MarketStatsAcc,
) -> Result<CandidateCounters, OutputError> {
    let safe = |name: &str, v: u64| {
        SafeU64::new(v).ok_or_else(|| OutputError::SelfCheck(format!("{name} above 2^53-1")))
    };
    let c = &acc.counters;
    let mut rejected = BTreeMap::new();
    for &(code, n) in &c.orders_rejected {
        rejected.insert(code.to_owned(), safe("ordersRejected", n)?);
    }
    Ok(CandidateCounters {
        key: key.to_owned(),
        orders_placed: safe("ordersPlaced", c.orders_placed)?,
        orders_rejected: rejected,
        orders_canceled: safe("ordersCanceled", c.orders_canceled)?,
        buy_notional_usdc: Decimal::from_micros(c.buy_notional.micros()),
        sell_notional_usdc: Decimal::from_micros(c.sell_notional.micros()),
        peak_reserved_usdc: Decimal::from_micros(c.peak_reserved.micros()),
        strategy_ticks_skipped: safe("strategyTicksSkipped", acc.ticks.strategy_ticks_skipped)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_dp_is_half_away_from_zero_once() {
        // spec: 10 §4 Q3 table (Rust column), §3.1 R-1
        for (micros, units) in [
            (-1_005_000, -101),
            (-125_000, -13),
            (1_005_000, 101),
            (1_015_000, 102),
            (285_000, 29),
            (-2_675_000, -268),
            (4_999, 0),
            (-4_999, 0),
            (5_000, 1),
            (-5_000, -1),
        ] {
            assert_eq!(dp2(micros).units(), units, "{micros}");
        }
        // Q2: no `-0`.
        assert_eq!(dp2(-4_999).to_string(), "0");
    }

    #[test]
    fn avg_entry_rounds_the_exact_rational_once() {
        // spec: 10 §3.3 R14, R-3 — 0.53×10 + 0.55×7.5 over 17.5 = 0.538571…
        let num = 530_000i128 * 10_000_000 + 550_000i128 * 7_500_000;
        let den = 17_500_000i128;
        assert_eq!(
            avg_entry((num, den)).unwrap(),
            Some(OutDec4::from_units(5_386))
        );
        // An exact 4-dp tie in the rational rounds away from zero: 0.12345.
        let num = 123_450i128 * 1_000_000;
        assert_eq!(
            avg_entry((num, 1_000_000)).unwrap(),
            Some(OutDec4::from_units(1_235))
        );
        // Double rounding would differ: 0.1234499… → micros 0.123450 → 0.1235;
        // one step gives 0.1234.
        let num = 123_449_999_999i128; // price micros² for qty 1e6 → 0.123449999999
        assert_eq!(
            avg_entry((num, 1_000_000)).unwrap(),
            Some(OutDec4::from_units(1_234))
        );
        assert_eq!(avg_entry((0, 0)).unwrap(), None);
    }

    #[test]
    fn fault_mapping_uses_the_closed_classes_and_causes() {
        // spec: 21 §13 (strategy_fault causes), 20 §4.1
        let f = SessionFault::Strategy {
            cause: StrategyFaultCause::CascadeLimit {
                seq: 7,
                tick: 3,
                deliveries: 4_201,
            },
            callback: "onAccountEvent",
            tick_seq: 3,
            at: pmb_core::TsMs(1_780_272_001_000),
        };
        let e = fault_error_info(&f);
        assert_eq!(e.class, ErrorClass::StrategyFault);
        assert_eq!(e.cause, "cascade_limit");
        e.validate().unwrap();
        let d = e.detail.unwrap();
        assert_eq!(d.callback.as_deref(), Some("onAccountEvent"));
        assert_eq!(d.seq.map(SafeU64::get), Some(3));
        let e = fault_error_info(&SessionFault::Engine {
            message: "PnL identity\nviolated".into(),
        });
        assert_eq!(
            (e.class, e.cause.as_str()),
            (ErrorClass::EngineFault, "invariant")
        );
        e.validate().unwrap();
        let e = OutputError::IntentMetaLimit {
            entries: 10_001,
            bytes: 9,
        }
        .error_info();
        assert_eq!(
            (e.class, e.cause.as_str()),
            (ErrorClass::StrategyFault, "intent_meta_limit")
        );
        e.validate().unwrap();
    }

    use std::sync::Arc;

    use pmb_core::ids::{ConditionId, Hash32, TokenId};
    use pmb_core::market::MarketVersion;
    use pmb_core::order::MetaStore;
    use pmb_core::{PerOutcome, Usdc};

    use crate::stats::FinalStats;
    use crate::strategy::TickCause;

    fn info() -> Arc<MarketInfo> {
        Arc::new(
            MarketInfo::new(
                "btc-updown-15m-1780272000",
                ConditionId(Hash32([0xab; 32])),
                PerOutcome::new(TokenId([1; 32]), TokenId([2; 32])),
                MarketVersion::V2,
                false,
            )
            .expect("slug"),
        )
    }

    fn session_output(ticks: &[TickCause]) -> SessionOutput {
        let mut acc = MarketStatsAcc::default();
        for &c in ticks {
            acc.ticks.record(c);
        }
        SessionOutput {
            stats: FinalStats {
                pnl: Usdc::ZERO,
                trade_count: 0,
                trade_as_maker: 0,
                trade_as_taker: 0,
                fees_paid: Usdc::ZERO,
                buy_vwap: PerOutcome::default(),
                shares: PerOutcome::default(),
                cost: Usdc::ZERO,
                split_cost: Usdc::ZERO,
                cash_end: Usdc::from_micros(500_000_000),
                cash_start: Usdc::from_micros(500_000_000),
                intent_meta: Vec::new(),
            },
            acc,
            metas: MetaStore::new(),
        }
    }

    fn cx(info: &MarketInfo) -> OutputContext<'_> {
        OutputContext {
            info,
            outcome: FinalOutcome::new(Outcome::Up),
            core_rules: CoreRules::TsCompat,
            rules: None,
        }
    }

    #[test]
    fn no_counted_tick_is_the_null_row() {
        // spec: 21 §13 row 3 (marketStats null, skipReason no_activity), §15
        let info = info();
        let o = market_output(&cx(&info), &session_output(&[])).unwrap();
        assert_eq!(o.market_stats, None);
        assert_eq!(o.skip_reason, Some(SkipReason::NoActivity));
        assert_eq!(o.events_processed.get(), 0);
        assert_eq!(serde_json::to_string(&o.events_by_type).unwrap(), "{}");
    }

    #[test]
    fn split_merge_only_activity_is_a_zero_row_with_its_money() {
        // spec: 21 §13 row 2 and "zero-row money fields come from the same
        // formulas"; §15 (eventsByType omits unseen causes)
        let info = info();
        let mut s = session_output(&[TickCause::Book, TickCause::PriceChange, TickCause::Book]);
        s.stats.split_cost = Usdc::from_micros(5_000_000);
        s.stats.pnl = Usdc::from_micros(-1_005_000);
        let o = market_output(&cx(&info), &s).unwrap();
        let st = o.market_stats.as_ref().expect("zero row");
        assert_eq!(o.skip_reason, Some(SkipReason::NoActivity));
        assert_eq!(st.skip_reason, Some(StatsSkipReason::NoInWindowActivity));
        assert_eq!(st.split_cost.to_string(), "5");
        // 10 §4 Q3: -1.005 → -1.01 (half away from zero, not JS Math.round).
        assert_eq!(st.pnl.to_string(), "-1.01");
        assert_eq!(st.market_id, format!("0x{}", "ab".repeat(32)));
        assert_eq!(st.rules, Some(None));
        assert_eq!(
            serde_json::to_string(&o.events_by_type).unwrap(),
            r#"{"book":2,"price_change":1}"#
        );
    }

    #[test]
    fn a_position_without_fills_is_activity() {
        // spec: 21 §13 row 1 ("fills or open positions"): split shares held
        let info = info();
        let mut s = session_output(&[TickCause::Book]);
        s.stats.shares = PerOutcome::new(3_000_000, 3_000_000);
        s.stats.split_cost = Usdc::from_micros(3_000_000);
        let o = market_output(&cx(&info), &s).unwrap();
        assert_eq!(o.skip_reason, None);
        let st = o.market_stats.unwrap();
        assert_eq!(st.skip_reason, None);
        assert_eq!(st.mergable_shares.to_string(), "3");
    }

    #[test]
    fn intent_meta_is_materialized_and_capped() {
        // spec: 21 §16 (first fill per cid already chosen by the ledger walk;
        // per-market cap 10,000 entries → strategy_fault intent_meta_limit)
        let info = info();
        let mut s = session_output(&[TickCause::Book]);
        s.stats.trade_count = 1;
        s.stats.trade_as_taker = 1;
        let m = s.metas.insert(r#"{"k":1,"x":0.0412,"n":null}"#).unwrap();
        s.stats.intent_meta.push(m);
        let o = market_output(&cx(&info), &s).unwrap();
        assert_eq!(
            serde_json::to_string(&o.market_stats.unwrap().intent_meta).unwrap(),
            r#"[{"k":1,"n":null,"x":0.0412}]"#
        );
        for _ in 0..10_000 {
            s.stats.intent_meta.push(m);
        }
        let e = market_output(&cx(&info), &s).unwrap_err();
        assert!(
            matches!(
                e,
                OutputError::IntentMetaLimit {
                    entries: 10_001,
                    ..
                }
            ),
            "{e:?}"
        );
    }

    #[test]
    fn counters_map_to_the_contract_shape() {
        // spec: 21 §10 `counters` (rejections by reason code, §17), 16 TF-6
        let mut acc = MarketStatsAcc::default();
        acc.counters.orders_placed = 4;
        acc.counters.orders_rejected =
            vec![("risk_max_open_orders", 2), ("insufficient_capital", 1)];
        acc.counters.orders_canceled = 2;
        acc.counters.buy_notional = Usdc::from_micros(12_400_000);
        acc.counters.peak_reserved = Usdc::from_micros(6_200_000);
        acc.ticks.strategy_ticks_skipped = 3;
        let c = candidate_counters("c0", &acc).unwrap();
        assert_eq!(
            serde_json::to_string(&c).unwrap(),
            r#"{"key":"c0","ordersPlaced":4,"ordersRejected":{"insufficient_capital":1,"risk_max_open_orders":2},"ordersCanceled":2,"buyNotionalUsdc":"12.4","sellNotionalUsdc":"0","peakReservedUsdc":"6.2","strategyTicksSkipped":3}"#
        );
    }

    #[test]
    fn rules_follow_the_profile_or_fail_loud() {
        // spec: 21 §11 `rules` (null in ts-compat, object in realistic), R14
        let info = info();
        let s = session_output(&[TickCause::Book]);
        let r = MarketStatsRules {
            source: pmb_contract::vocab::RulesSource::Fallback,
            rules_table_version: "rules-table-v1".into(),
            snapshot_parser_version: None,
            fee_era: "f0".into(),
            fee_curve: "c".into(),
            fee_source: "s".into(),
            unverified_rules: Vec::new(),
        };
        let mut c = cx(&info);
        c.rules = Some(&r);
        assert!(matches!(
            market_output(&c, &s),
            Err(OutputError::SelfCheck(_))
        ));
        c.core_rules = CoreRules::Realistic;
        let o = market_output(&c, &s).unwrap();
        assert_eq!(o.market_stats.unwrap().rules, Some(Some(r.clone())));
        c.rules = None;
        assert!(matches!(
            market_output(&c, &s),
            Err(OutputError::SelfCheck(_))
        ));
    }
}
