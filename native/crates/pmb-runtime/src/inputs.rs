//! Input resolution inside the binary (21 §5.1, §9; 15 I-8): integrity of
//! the market file, decode through `pmb-replay`, market identity, rules
//! provenance (11 RS4). [`build_inputs`] is the seam between a job and the
//! decoded, immutable market data every candidate shares.
//!
//! Feeds and plugins are not wired here before integration: a strategy
//! that requests any is refused at job planning (`crate::job`).

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;
use std::sync::Arc;

use pmb_contract::job::{EngineJob, InputRef};
use pmb_contract::num::SafeU64;
use pmb_contract::result::{AnomalyValue, ErrorDetail};
use pmb_contract::rules::{Captured, CapturedRules};
use pmb_contract::vocab::{self, ErrorClass, InputPath, RulesOrigin, RulesPhase};
use pmb_core::ids::{ConditionId, Hash32, TokenId};
use pmb_core::rules::{
    fee_era, ExchangeRules, FieldSource, Origin, Phase, RulesProvenance, RulesSource,
    RulesTableVersion, RulesTimeline,
};
use pmb_core::{
    FinalOutcome, LevelUpdate, MarketEvent, MarketInfo, Outcome, PerOutcome, PriceSize,
    TimedMarketEvent, TsMs,
};
use pmb_replay::telonex::{FORMAT_NAME, FORMAT_VERSION};
use pmb_replay::{
    read_telonex_delta, InputFile, InputFormat, TelonexDiagnostics, TelonexInput, TelonexTape,
};
use sha2::{Digest, Sha256};

use crate::error::EngineError;

/// One in-memory market event (selftest fixtures; 20 §5.3).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StaticEvent {
    /// A `book` snapshot of one outcome.
    Book {
        /// Outcome.
        outcome: Outcome,
        /// Bids, best first.
        bids: Vec<PriceSize>,
        /// Asks, best first.
        asks: Vec<PriceSize>,
    },
    /// A `price_change`.
    PriceChange(Vec<LevelUpdate>),
}

/// An in-memory tape with the shape of a decoded telonex-delta file.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StaticTape {
    rows: Vec<(TsMs, StaticEvent)>,
}

impl StaticTape {
    /// An empty tape.
    pub fn new() -> StaticTape {
        StaticTape::default()
    }

    /// Appends one event at exchange time `ts`.
    pub fn push(&mut self, ts: TsMs, ev: StaticEvent) {
        self.rows.push((ts, ev));
    }
}

/// The decoded market events of one market, in replay order (15 I-15).
pub enum MarketTape {
    /// A decoded telonex-delta file (boxed: the tape carries its file meta).
    Telonex(Box<TelonexTape>),
    /// An in-memory tape (selftest).
    Static(StaticTape),
}

impl MarketTape {
    /// Number of events (= real ticks, 15 I-19).
    pub fn len(&self) -> usize {
        match self {
            MarketTape::Telonex(t) => t.len(),
            MarketTape::Static(t) => t.rows.len(),
        }
    }

    /// Whether there is no event.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Event `i`, borrowing the tape.
    pub fn event(&self, i: usize) -> TimedMarketEvent<'_> {
        match self {
            MarketTape::Telonex(t) => t.event(i),
            MarketTape::Static(t) => {
                let (ts, ev) = &t.rows[i];
                let event = match ev {
                    StaticEvent::Book {
                        outcome,
                        bids,
                        asks,
                    } => MarketEvent::Book {
                        outcome: *outcome,
                        bids,
                        asks,
                    },
                    StaticEvent::PriceChange(changes) => MarketEvent::PriceChange { changes },
                };
                TimedMarketEvent {
                    row: i as u32,
                    exchange_ts: *ts,
                    local_ts: None,
                    event,
                }
            }
        }
    }
}

/// Decoded, immutable inputs of one market, shared by every candidate
/// (20 §5.5, 16 §6).
pub struct DecodedInputs {
    /// Market identity and window (10 §5).
    pub info: Arc<MarketInfo>,
    /// Market events.
    pub tape: MarketTape,
    /// The market id as written on the input's book events (21 §11
    /// `marketId`); `None` when the input has none.
    pub market_text: Option<String>,
    /// Rules timeline (11 §13; ts-compat: the fixed rules of 11 §4).
    pub rules_timeline: Arc<RulesTimeline>,
    /// RS4 classification (11 §13.3).
    pub rules_source: RulesSource,
    /// The resolution, for settlement only (10 M6).
    pub outcome: FinalOutcome,
    /// Data-anomaly counters (15 §8), non-zero only.
    pub anomalies: BTreeMap<String, AnomalyValue>,
    /// Input path taken (16 §7.5 NT-5).
    pub input_path: InputPath,
}

impl DecodedInputs {
    /// The market id of the first counted tick (21 §11 `marketId`).
    /// Every event of a decoded tape is a real tick (`book` or
    /// `price_change`, 15 I-19), counted before the window gate (21 §15).
    pub fn first_counted_market_id(&self) -> Option<&str> {
        let counted = (0..self.tape.len()).any(|i| self.tape.event(i).event.produces_tick());
        if counted {
            self.market_text.as_deref()
        } else {
            None
        }
    }
}

/// Contract RS4 value of a core classification.
pub fn rules_source_vocab(s: RulesSource) -> vocab::RulesSource {
    match s {
        RulesSource::Snapshot => vocab::RulesSource::Snapshot,
        RulesSource::Partial => vocab::RulesSource::Partial,
        RulesSource::Fallback => vocab::RulesSource::Fallback,
    }
}

fn origin(o: RulesOrigin) -> Origin {
    match o {
        RulesOrigin::Gamma => Origin::Gamma,
        RulesOrigin::Clob => Origin::Clob,
        RulesOrigin::V4Bootstrap => Origin::V4Bootstrap,
        RulesOrigin::LiveGamma => Origin::LiveGamma,
        RulesOrigin::LiveClob => Origin::LiveClob,
    }
}

fn phase(p: RulesPhase) -> Phase {
    match p {
        RulesPhase::PreStart => Phase::PreStart,
        RulesPhase::PostStart => Phase::PostStart,
    }
}

fn field<T>(c: &Option<Captured<T>>, table: RulesTableVersion) -> FieldSource {
    match c {
        Some(c) => FieldSource::Captured {
            origin: origin(c.origin),
            phase: phase(c.phase),
        },
        None => FieldSource::Fallback { table },
    }
}

/// Per-field provenance of the captured rules (11 §13.3 RS4, §13.4).
///
/// The fee field is captured when `feesEnabled`, `feeType` and
/// `feeSchedule` all are (`pre_start` only when all three are); a partial
/// fee capture counts as "some field captured".
// D-PENDING: 11 §13.4 lists the three fee keys as one required row without
// saying how a partial capture classifies; chose the conservative reading
// (partial fee capture ⇒ fee from fallback, market `partial`). The core's
// rules timeline builder (11 X2, realistic, M3b) replaces this.
pub fn provenance(c: &CapturedRules, table: RulesTableVersion) -> RulesProvenance {
    let fee_parts = [
        c.fees_enabled.as_ref().map(|x| (x.origin, x.phase)),
        c.fee_type.as_ref().map(|x| (x.origin, x.phase)),
        c.fee_schedule.as_ref().map(|x| (x.origin, x.phase)),
    ];
    let fee_any = fee_parts.iter().any(Option::is_some);
    let fee = if fee_parts.iter().all(Option::is_some) {
        let all_pre = fee_parts
            .iter()
            .all(|p| p.is_some_and(|(_, ph)| ph == RulesPhase::PreStart));
        let (o, _) = fee_parts[2].expect("all fee parts present");
        FieldSource::Captured {
            origin: origin(o),
            phase: if all_pre {
                Phase::PreStart
            } else {
                Phase::PostStart
            },
        }
    } else {
        FieldSource::Fallback { table }
    };
    let fields = [
        field(&c.tick, table),
        field(&c.min_size_resting, table),
        fee,
        field(&c.taker_delay_enabled, table),
        field(&c.neg_risk, table),
        field(&c.version, table),
    ];
    let optional_captured = c.seconds_delay.is_some()
        || c.min_order_age_s.is_some()
        || c.accepting_orders_timestamp_ms.is_some()
        || (fee_any && matches!(fee, FieldSource::Fallback { .. }));
    RulesProvenance {
        fields,
        optional_captured,
    }
}

/// The fix command named by a missing converted input (20 §4 data_missing).
pub const INPUT_FIX_COMMAND: &str =
    "npm run telonex:download-converted-r2-to-local -- --converter delta-typed --slug <slug>";

/// Verifies the market file before replay (15 I-8, 21 §5.1): present
/// (`data_missing: input_missing`), `bytes` always and `sha256` when given
/// (`data_defect: integrity_mismatch`). Returns whether the sha256 was
/// verified.
pub fn verify_input(input: &InputRef, slug: &str) -> Result<bool, EngineError> {
    let path = Path::new(&input.path);
    let fix = INPUT_FIX_COMMAND.replace("<slug>", slug);
    // 20 §4 data_missing: the message names the fix command.
    let missing = |what: &str| {
        EngineError::data_missing(
            "input_missing",
            format!("{} {what} on this host; run {fix}", input.path),
        )
        .with_detail(ErrorDetail {
            path: Some(input.path.clone()),
            fix_command: Some(fix.clone()),
            ..ErrorDetail::default()
        })
    };
    let meta = std::fs::metadata(path).map_err(|e| match e.kind() {
        io::ErrorKind::NotFound => missing("is absent"),
        _ => EngineError::runtime("io", format!("{}: {e}", input.path)),
    })?;
    if !meta.is_file() {
        return Err(missing("is not a regular file"));
    }
    if meta.len() != input.bytes.get() {
        return Err(EngineError::data_defect(
            "integrity_mismatch",
            format!(
                "{} has {} bytes, the job says {} (15 I-8)",
                input.path,
                meta.len(),
                input.bytes.get()
            ),
        ));
    }
    let Some(want) = &input.sha256 else {
        return Ok(false);
    };
    let mut f =
        File::open(path).map_err(|e| EngineError::runtime("io", format!("{}: {e}", input.path)))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f
            .read(&mut buf)
            .map_err(|e| EngineError::runtime("io", format!("{}: {e}", input.path)))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    let got = pmb_contract::num::Sha256Hex::from_digest(&h.finalize().into());
    if &got != want {
        return Err(EngineError::data_defect(
            "integrity_mismatch",
            format!(
                "{} has sha256 {got}, the job says {want} (15 I-8)",
                input.path
            ),
        ));
    }
    Ok(true)
}

fn count(out: &mut BTreeMap<String, AnomalyValue>, key: &str, v: u64) {
    if v > 0 {
        if let Some(s) = SafeU64::new(v) {
            out.insert(key.to_string(), AnomalyValue::Count(s));
        }
    }
}

/// Reader counters under their 15 §8 names (zero counters omitted).
///
/// D-PENDING: `droppedChanges` (changes dropped inside a kept
/// `price_change` row, I-16) has no 15 §8 name; it is kept under this name
/// rather than dropped silently (R14) until 15 §8 names it (spec question).
/// The telonex counters `deltaBeforeBook`, `crossedBookTicks` and
/// `duplicateRows` of 15 §8 are not produced by the pmb-replay reader or the
/// engine's book driver yet (crossStreamNeeds); they are absent, not zero.
pub fn anomalies_of(d: &TelonexDiagnostics) -> BTreeMap<String, AnomalyValue> {
    let mut out = BTreeMap::new();
    count(&mut out, "localBehindExchange", d.local_behind_exchange);
    count(&mut out, "localClockBackwards", d.local_clock_backwards);
    count(
        &mut out,
        "exchangeClockBackwards",
        d.exchange_clock_backwards,
    );
    count(&mut out, "ingestSeqBackwards", d.ingest_seq_backwards);
    count(&mut out, "inexact_decimal", d.inexact_decimal);
    count(&mut out, "droppedChanges", d.dropped_changes);
    let s = &d.skipped;
    let mut by = BTreeMap::new();
    for (k, v) in [
        ("blank_market", s.blank_market),
        ("no_exchange_ts", s.no_exchange_ts),
        ("other_event_type", s.other_event_type),
        ("unresolved_book_asset", s.unresolved_book_asset),
        ("empty_price_change", s.empty_price_change),
    ] {
        if v > 0 {
            if let Some(n) = SafeU64::new(v) {
                by.insert(k.to_string(), n);
            }
        }
    }
    if !by.is_empty() {
        out.insert("skippedRows".to_string(), AnomalyValue::ByReason(by));
    }
    out
}

fn tokens_of(job: &EngineJob) -> Result<PerOutcome<TokenId>, EngineError> {
    let t = &job.market.token_ids;
    let parse = |name: &str, s: &str| {
        TokenId::parse(s)
            .map_err(|e| EngineError::invalid_input("market", format!("tokenIds.{name}: {e:?}")))
    };
    Ok(PerOutcome::new(
        parse("UP", &t.up)?,
        parse("DOWN", &t.down)?,
    ))
}

fn final_outcome(job: &EngineJob) -> FinalOutcome {
    FinalOutcome::new(match job.market.outcome {
        vocab::Outcome::Up => Outcome::Up,
        vocab::Outcome::Down => Outcome::Down,
    })
}

/// Builds the shared inputs around a decoded tape. The condition id is
/// the job's, else the file's `market` column.
fn assemble(
    job: &EngineJob,
    table: RulesTableVersion,
    tape: MarketTape,
    market_text: Option<String>,
    anomalies: BTreeMap<String, AnomalyValue>,
) -> Result<DecodedInputs, EngineError> {
    let m = &job.market;
    let cid_text = m.condition_id.as_deref().or(market_text.as_deref());
    let condition_id = match cid_text {
        Some(t) => ConditionId::parse(t).map_err(|e| {
            EngineError::data_defect(
                "corrupt",
                format!("market id {t:?} is not a condition id: {e:?}"),
            )
        })?,
        // D-PENDING: neither the job nor the file names the market (an input
        // without a single kept row); MarketInfo needs a condition id, so
        // the zero id is used. The market has no counted tick and emits no
        // MarketStats (21 §13), so no output carries it.
        None => ConditionId(Hash32([0; 32])),
    };
    let ts_compat = ExchangeRules::ts_compat();
    let info = MarketInfo::new(
        &m.slug,
        condition_id,
        tokens_of(job)?,
        ts_compat.version,
        ts_compat.neg_risk,
    )
    .map_err(|e| EngineError::invalid_input("market", format!("slug {:?}: {e:?}", m.slug)))?;
    let prov = provenance(&m.rules.captured, table);
    let source = prov.source();
    // ts-compat validates the record and ignores its values (11 §4, 21 §7.2).
    let timeline = RulesTimeline::new(
        ts_compat,
        Vec::new(),
        prov,
        table,
        fee_era(table, info.window.start_ms).id,
    );
    Ok(DecodedInputs {
        info: Arc::new(info),
        tape,
        market_text,
        rules_timeline: Arc::new(timeline),
        rules_source: source,
        outcome: final_outcome(job),
        anomalies,
        input_path: InputPath::V1,
    })
}

/// The telonex-delta seam (21 §9 steps the binary repeats, 15 §4): verify
/// the file, decode it with `pmb-replay`, assemble the market.
pub fn build_inputs(
    job: &EngineJob,
    table: RulesTableVersion,
) -> Result<DecodedInputs, EngineError> {
    let m = &job.market;
    let input = &m.input;
    if input.format.name != FORMAT_NAME {
        return Err(EngineError::data_defect(
            "format_version",
            format!(
                "input format {:?} is not {FORMAT_NAME:?} (version {FORMAT_VERSION})",
                input.format.name
            ),
        ));
    }
    let verified = verify_input(input, &m.slug)?;
    let tin = TelonexInput {
        tokens: [m.token_ids.up.as_str(), m.token_ids.down.as_str()],
        condition_id: m.condition_id.as_deref(),
    };
    // `verify_input` above already checked bytes and sha256; the sha256 is
    // not passed again so the file is hashed once, and
    // `classify_decode_error` classes decode failures by `verified`.
    let file = InputFile {
        path: Path::new(&input.path),
        bytes: input.bytes.get(),
        sha256: None,
        format: InputFormat {
            name: &input.format.name,
            version: input.format.version,
        },
    };
    let classify =
        |e: EngineError| classify_decode_error(e, verified, || reread_input(input, &m.slug));
    let tape = read_telonex_delta(&file, tin).map_err(|e| classify(EngineError::from(e)))?;
    let market_text = (!tape.meta.market.is_empty()).then(|| tape.meta.market.clone());
    let anomalies = anomalies_of(tape.diagnostics());
    assemble(
        job,
        table,
        MarketTape::Telonex(Box::new(tape)),
        market_text,
        anomalies,
    )
    .map_err(classify)
}

/// The class of a decode-stage error by what is known about the input's
/// bytes (20 §4): a decode failure of a file whose sha256 was verified is
/// deterministic (`data_defect: corrupt`, 15 I-8); of an unverified file it
/// is `runtime: decode_unverified` (another host may hold a good copy).
///
/// The reader reports I/O failures (open, row-group reads) under the same
/// cause as decode failures. `recheck` reads the input again: when that
/// fails, its error (`runtime: io`, or what the file now is) is the class,
/// because the bytes could not be read, not decoded.
// D-PENDING: the reader should report I/O as `runtime: io` itself
// (crossStreamNeeds); the recheck then becomes unnecessary.
pub fn classify_decode_error(
    e: EngineError,
    verified: bool,
    recheck: impl FnOnce() -> Result<(), EngineError>,
) -> EngineError {
    match (e.class, e.cause) {
        (ErrorClass::DataDefect, "corrupt") if !verified => {
            EngineError::runtime("decode_unverified", e.message)
        }
        (ErrorClass::Runtime, "decode_unverified") => match recheck() {
            Err(io) => io,
            Ok(()) if verified => EngineError::data_defect("corrupt", e.message),
            Ok(()) => e,
        },
        _ => e,
    }
}

/// Reads the whole input again (after a reader failure): the 15 I-8 checks,
/// then, without a sha256, every byte. Any read error is `runtime: io`.
pub fn reread_input(input: &InputRef, slug: &str) -> Result<(), EngineError> {
    if !verify_input(input, slug)? {
        let io = |e: io::Error| EngineError::runtime("io", format!("{}: {e}", input.path));
        let mut f = File::open(&input.path).map_err(io)?;
        io::copy(&mut f, &mut io::sink()).map_err(io)?;
    }
    Ok(())
}

/// Inputs from an in-memory tape (selftest; no file I/O).
pub fn build_static_inputs(
    job: &EngineJob,
    table: RulesTableVersion,
    tape: StaticTape,
    market_text: Option<String>,
) -> Result<DecodedInputs, EngineError> {
    assemble(
        job,
        table,
        MarketTape::Static(tape),
        market_text,
        BTreeMap::new(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_contract::rules::{FeeSchedule, FeeType};
    use pmb_contract::Decimal;

    fn cap<T>(value: T, ph: RulesPhase) -> Option<Captured<T>> {
        Some(Captured {
            value,
            origin: RulesOrigin::Clob,
            phase: ph,
            snapshot_id: SafeU64::new(1).unwrap(),
        })
    }

    #[test]
    fn rs4_classification() {
        // spec: 11 §13.3 RS4 (snapshot / partial / fallback)
        let t = RulesTableVersion::V1;
        assert_eq!(
            provenance(&CapturedRules::default(), t).source(),
            RulesSource::Fallback
        );
        let pre = RulesPhase::PreStart;
        let mut full = CapturedRules {
            tick: cap(Decimal::from_micros(10_000), pre),
            min_size_resting: cap(Decimal::from_micros(5_000_000), pre),
            fees_enabled: cap(true, pre),
            fee_type: cap(FeeType("crypto_fees_v2".into()), pre),
            fee_schedule: cap(
                FeeSchedule {
                    rate: Decimal::from_micros(70_000),
                    exponent: 1,
                    taker_only: true,
                },
                pre,
            ),
            taker_delay_enabled: cap(true, pre),
            neg_risk: cap(false, pre),
            version: cap(vocab::MarketVersion::V2, pre),
            ..CapturedRules::default()
        };
        assert_eq!(provenance(&full, t).source(), RulesSource::Snapshot);
        full.fee_type = None;
        assert_eq!(provenance(&full, t).source(), RulesSource::Partial);
        let only_optional = CapturedRules {
            seconds_delay: cap(0, RulesPhase::PostStart),
            ..CapturedRules::default()
        };
        assert_eq!(provenance(&only_optional, t).source(), RulesSource::Partial);
        let only_fee_part = CapturedRules {
            fees_enabled: cap(true, pre),
            ..CapturedRules::default()
        };
        assert_eq!(provenance(&only_fee_part, t).source(), RulesSource::Partial);
    }

    #[test]
    fn anomaly_names_follow_15_8() {
        // spec: 15 §8 counter names; zero counters omitted (21 §10)
        let mut d = TelonexDiagnostics::default();
        assert!(anomalies_of(&d).is_empty());
        d.inexact_decimal = 2;
        d.skipped.blank_market = 1;
        let a = anomalies_of(&d);
        assert_eq!(
            serde_json::to_value(&a).unwrap(),
            serde_json::json!({
                "inexact_decimal": 2, "skippedRows": {"blank_market": 1}
            })
        );
    }

    #[test]
    fn decode_errors_are_classed_by_what_is_known_of_the_bytes() {
        // spec: 20 §4 (runtime: decode failure of an unverified file;
        // data_defect: decode failure of a verified file), 15 I-8
        let decode = || EngineError::runtime("decode_unverified", "bad page");
        let corrupt = || EngineError::data_defect("corrupt", "asset id is not UTF-8");
        let readable = || Ok(());
        let unread = || -> Result<(), EngineError> { panic!("no recheck for a decoded value") };
        let c = |e: EngineError| (e.class, e.cause);
        assert_eq!(
            c(classify_decode_error(decode(), true, readable)),
            (ErrorClass::DataDefect, "corrupt")
        );
        assert_eq!(
            c(classify_decode_error(decode(), false, readable)),
            (ErrorClass::Runtime, "decode_unverified")
        );
        // The file cannot be read again: I/O, transient, retried.
        let io = || Err(EngineError::runtime("io", "EMFILE"));
        assert_eq!(
            c(classify_decode_error(decode(), true, io)),
            (ErrorClass::Runtime, "io")
        );
        assert_eq!(
            c(classify_decode_error(corrupt(), false, unread)),
            (ErrorClass::Runtime, "decode_unverified")
        );
        assert_eq!(
            c(classify_decode_error(corrupt(), true, unread)),
            (ErrorClass::DataDefect, "corrupt")
        );
        let foreign = EngineError::data_defect("foreign_file", "asset 9");
        assert_eq!(
            c(classify_decode_error(foreign, false, unread)),
            (ErrorClass::DataDefect, "foreign_file")
        );
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let d =
            std::env::temp_dir().join(format!("pmb-runtime-inputs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn job_for(path: &Path, sha256: Option<String>) -> EngineJob {
        let mut v: serde_json::Value = serde_json::from_str(crate::selftest::SELFTEST_JOB).unwrap();
        let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(1);
        v["market"]["input"]["path"] = serde_json::Value::from(path.to_str().unwrap());
        v["market"]["input"]["bytes"] = serde_json::Value::from(bytes);
        v["market"]["input"]["sha256"] = sha256.map_or(serde_json::Value::Null, Into::into);
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn an_undecodable_file_is_a_defect_only_when_verified() {
        // spec: 20 §4, 15 I-8 (end to end through the reader)
        let d = scratch("garbage");
        let f = d.join("btc-updown-15m-1780272000.parquet");
        std::fs::write(&f, b"this is not a parquet file").unwrap();
        let sha = {
            let digest: [u8; 32] = Sha256::digest(std::fs::read(&f).unwrap()).into();
            pmb_contract::num::Sha256Hex::from_digest(&digest).to_string()
        };
        let e = build_inputs(&job_for(&f, Some(sha)), RulesTableVersion::V1)
            .err()
            .unwrap();
        assert_eq!(
            (e.class, e.cause),
            (ErrorClass::DataDefect, "corrupt"),
            "{e}"
        );
        let e = build_inputs(&job_for(&f, None), RulesTableVersion::V1)
            .err()
            .unwrap();
        assert_eq!(
            (e.class, e.cause),
            (ErrorClass::Runtime, "decode_unverified"),
            "{e}"
        );
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_directory_input_names_the_fix_command() {
        // spec: 20 §4 data_missing ("the message names the fix command")
        let d = scratch("dir");
        let job = job_for(&d, None);
        let e = verify_input(&job.market.input, &job.market.slug).unwrap_err();
        assert_eq!(
            (e.class, e.cause),
            (ErrorClass::DataMissing, "input_missing")
        );
        assert!(e.message.contains("is not a regular file"), "{}", e.message);
        assert!(
            e.message.contains("download-converted-r2-to-local"),
            "{}",
            e.message
        );
        let detail = e.detail.unwrap();
        assert_eq!(detail.path.as_deref(), d.to_str());
        assert!(detail
            .fix_command
            .unwrap()
            .contains("--slug btc-updown-15m-1780272000"));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn static_tape_borrows_events() {
        let mut t = StaticTape::new();
        t.push(
            TsMs(5),
            StaticEvent::Book {
                outcome: Outcome::Up,
                bids: vec![],
                asks: vec![],
            },
        );
        let tape = MarketTape::Static(t);
        assert_eq!(tape.len(), 1);
        let e = tape.event(0);
        assert_eq!(e.exchange_ts, TsMs(5));
        assert!(e.event.produces_tick());
    }
}
