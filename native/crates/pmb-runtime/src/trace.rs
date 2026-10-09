//! Canonical parity trace `pmb-parity-trace/2` (22 §3): the record writer
//! and the `ParityTraceSink` that feeds it from the engine event stream
//! (22 §2).
//!
//! - One JSONL file per (market, candidate); first line `header`, last line
//!   `final` (22 §3.1). Written on the job's thread through a 64 KiB buffer,
//!   gzip level 6 when the path ends in `.gz` (22 §3.6), atomically: a temp
//!   file in the same directory, renamed by [`ParityTraceWriter::finish`].
//! - Numbers: prices, sizes and USDC values are rendered exactly from fixed
//!   point (22 §3.3), as the shortest exact decimal of the micros value
//!   (`0.53`, `5`, `-1.005`): no exponent, no `-0`, never through `f64`.
//! - Assets are outcome indexes `0` (UP) and `1` (DOWN) (22 §3.3).
//!
//! D-PENDING: 22 §3.1 says "gzip JSONL"; the TS writer gzips only `.gz`
//! paths (`trace.ts` `writeTrace`). Chose the TS rule so `--trace
//! <out.jsonl>` (30 §15) stays plain and `<key>.jsonl.gz` (20 §5.5) is gzip.
//!
//! D-PENDING: 22 §3.3 "exact 6 dp decimals" is read as exact at 1e-6 with
//! trailing zeros trimmed (the diff parses numbers to micros, 22 §3.4).

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use flate2::write::GzEncoder;
use flate2::Compression;
use pmb_contract::result::{EngineMarketStats, EventsByType};
use pmb_contract::vocab::{Profile, SkipReason, TraceLevel};
use pmb_core::fill::Liquidity;
use pmb_core::fixed::format_micros;
use pmb_core::order::{OrderSize, OrderType, Side};
use pmb_core::{Outcome, Price, Qty, TsMs, Usdc};
use pmb_engine::clock::DecisionOrigin;
use pmb_engine::stats::FinalStats;
use pmb_engine::trace::{TraceEvent, TraceSink};
use serde_json::{Map, Value};

use crate::error::EngineError;
use crate::io::AtomicFile;

/// Trace buffer size (22 §3.6).
pub const TRACE_BUFFER_BYTES: usize = 64 * 1024;
/// gzip level (22 §3.6, the same as `trace.ts`).
pub const TRACE_GZIP_LEVEL: u32 = 6;

/// The `header` record (22 §3.2).
#[derive(Clone, Copy, Debug)]
pub struct TraceHeader<'a> {
    /// Engine crate version.
    pub engine_version: &'a str,
    /// Profile of the run.
    pub profile: Profile,
    /// Market slug.
    pub slug: &'a str,
    /// Candidate key.
    pub candidate_key: &'a str,
    /// `decisions` or `feeds`.
    pub level: TraceLevel,
}

/// Source of an `intent` record (22 §3.2 `src`).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum IntentSource {
    /// Market tick callback.
    Tick,
    /// Account event callback.
    Account,
}

impl IntentSource {
    fn as_str(self) -> &'static str {
        match self {
            IntentSource::Tick => "tick",
            IntentSource::Account => "account",
        }
    }
}

/// Order fields of `place_limit`, `place_batch` orders and
/// `order_submitted` (22 §3.2).
#[derive(Clone, Copy, Debug)]
pub struct TraceOrder<'a> {
    /// Client order id.
    pub cid: &'a str,
    /// Outcome (written as 0/1).
    pub asset: Outcome,
    /// Side.
    pub side: Side,
    /// Limit price.
    pub price: Price,
    /// Shares, or collateral for `buy_spend` orders (`amountUsdc`).
    pub size: OrderSize,
    /// Order type.
    pub order_type: OrderType,
    /// Post-only flag.
    pub post_only: bool,
    /// GTD expiry, `null` otherwise.
    pub expire_at_ms: Option<TsMs>,
}

/// One intent as returned by a callback (22 §3.2 `intent`).
#[derive(Clone, Copy, Debug)]
pub enum TraceIntent<'a> {
    /// `place_limit`.
    PlaceLimit(TraceOrder<'a>),
    /// `place_batch`.
    PlaceBatch(&'a [TraceOrder<'a>]),
    /// `cancel_order`; `None` when the id does not resolve to a cid.
    CancelOrder(Option<&'a str>),
    /// `cancel_batch`.
    CancelBatch(&'a [Option<&'a str>]),
    /// `cancel_market`: one outcome, or the whole market with its id.
    CancelMarket {
        /// Outcome, `null` for the whole market.
        asset: Option<Outcome>,
        /// Market (condition) id when the whole market is canceled.
        market: Option<&'a str>,
    },
    /// `cancel_all`.
    CancelAll,
    /// `split_positions`.
    Split(Qty),
    /// `merge_positions`.
    Merge(Qty),
}

/// One delivered account event (22 §3.2 `event`).
#[derive(Clone, Copy, Debug)]
pub enum TraceAccountEvent<'a> {
    /// `order_submitted` with the order fields.
    OrderSubmitted(TraceOrder<'a>),
    /// `order_accepted`.
    OrderAccepted {
        /// Client order id.
        cid: &'a str,
    },
    /// `order_open`.
    OrderOpen {
        /// Client order id.
        cid: &'a str,
    },
    /// `order_rejected`.
    OrderRejected {
        /// Client order id.
        cid: &'a str,
        /// TS reason string (`insufficient_capital(required=..)`, ...).
        reason: &'a str,
    },
    /// `order_done`.
    OrderDone {
        /// Client order id.
        cid: &'a str,
        /// TS reason string.
        reason: &'a str,
        /// Filled size, `null` when not reported.
        filled_size: Option<Qty>,
    },
    /// `fill`.
    Fill {
        /// Client order id.
        cid: &'a str,
        /// Outcome.
        asset: Outcome,
        /// Side.
        side: Side,
        /// Price.
        price: Price,
        /// Size.
        size: Qty,
        /// Charged fee (11).
        fee: Usdc,
        /// Liquidity.
        liquidity: Liquidity,
    },
    /// `cancel_failed`.
    CancelFailed {
        /// Cancel operation kind.
        op: &'a str,
        /// Client order id, when known.
        cid: Option<&'a str>,
        /// Outcome, when known.
        asset: Option<Outcome>,
        /// Reason code.
        reason: &'a str,
    },
    /// `positions_split`.
    PositionsSplit {
        /// Full sets.
        size: Qty,
        /// Collateral.
        cost: Usdc,
    },
    /// `positions_merged`.
    PositionsMerged {
        /// Full sets.
        size: Qty,
    },
    /// `split_failed`.
    SplitFailed {
        /// Requested full sets.
        size: Qty,
        /// Reason code.
        reason: &'a str,
    },
    /// `merge_failed`.
    MergeFailed {
        /// Requested full sets.
        size: Qty,
        /// Reason code.
        reason: &'a str,
    },
    /// `settlement_update`.
    SettlementUpdate {
        /// Client order id.
        cid: &'a str,
        /// TS trade-status string (`MATCHED`, ...).
        status: &'a str,
        /// Matched size.
        size_matched: Qty,
    },
    /// `order_delayed` (realistic and live only).
    OrderDelayed {
        /// Client order id.
        cid: &'a str,
        /// Exchange release time.
        release_at_ms: TsMs,
    },
    /// `cancel_acked` (realistic and live only).
    CancelAcked {
        /// Cancel operation kind.
        op: &'a str,
        /// Client order id.
        cid: &'a str,
    },
}

impl TraceAccountEvent<'_> {
    fn kind(&self) -> &'static str {
        match self {
            TraceAccountEvent::OrderSubmitted(_) => "order_submitted",
            TraceAccountEvent::OrderAccepted { .. } => "order_accepted",
            TraceAccountEvent::OrderOpen { .. } => "order_open",
            TraceAccountEvent::OrderRejected { .. } => "order_rejected",
            TraceAccountEvent::OrderDone { .. } => "order_done",
            TraceAccountEvent::Fill { .. } => "fill",
            TraceAccountEvent::CancelFailed { .. } => "cancel_failed",
            TraceAccountEvent::PositionsSplit { .. } => "positions_split",
            TraceAccountEvent::PositionsMerged { .. } => "positions_merged",
            TraceAccountEvent::SplitFailed { .. } => "split_failed",
            TraceAccountEvent::MergeFailed { .. } => "merge_failed",
            TraceAccountEvent::SettlementUpdate { .. } => "settlement_update",
            TraceAccountEvent::OrderDelayed { .. } => "order_delayed",
            TraceAccountEvent::CancelAcked { .. } => "cancel_acked",
        }
    }
}

/// A visible feed value of the `feeds` record (22 §3.2).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TraceFeedValue {
    /// Source timestamp (`None` for price to beat).
    pub ts_ms: Option<TsMs>,
    /// Value (an external feed value, `f64`, R2).
    pub value: f64,
    /// Emitted visibility time (14 F-16, F-24, F-28).
    pub received_at_ms: TsMs,
}

/// The `feeds` record (level `feeds` only, 22 §3.2).
#[derive(Clone, Debug, Default)]
pub struct TraceFeeds<'a> {
    /// Binance last price.
    pub binance: Option<TraceFeedValue>,
    /// Chainlink round.
    pub chainlink: Option<TraceFeedValue>,
    /// Price to beat.
    pub price_to_beat: Option<TraceFeedValue>,
    /// TS-shape snapshot of every requested plugin (14 P-7).
    pub plugins: Option<&'a Map<String, Value>>,
}

/// Unrounded final values at 6 dp (22 §3.2 `final.unrounded`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Unrounded {
    /// PnL, micros.
    pub pnl: i64,
    /// Cost basis, micros.
    pub cost: i64,
    /// Fees paid, micros.
    pub fees_paid: i64,
    /// Split cost, micros.
    pub split_cost: i64,
    /// UP shares, micros.
    pub up_shares: i64,
    /// DOWN shares, micros.
    pub down_shares: i64,
}

impl Unrounded {
    /// From the engine's unrounded final values.
    pub fn from_stats(s: &FinalStats) -> Unrounded {
        Unrounded {
            pnl: s.pnl.micros(),
            cost: s.cost.micros(),
            fees_paid: s.fees_paid.micros(),
            split_cost: s.split_cost.micros(),
            up_shares: s.shares[Outcome::Up],
            down_shares: s.shares[Outcome::Down],
        }
    }
}

/// The `final` record (22 §3.2).
#[derive(Clone, Copy, Debug)]
pub struct TraceFinal<'a> {
    /// `MarketStats` without `execution` and `recorderV4Capture`.
    pub stats: Option<&'a EngineMarketStats>,
    /// Top-level skip reason.
    pub skip_reason: Option<SkipReason>,
    /// Counted ticks.
    pub events_processed: u64,
    /// Counted ticks by cause.
    pub events_by_type: &'a EventsByType,
    /// Unrounded values.
    pub unrounded: Unrounded,
}

enum Out {
    Plain(BufWriter<File>),
    Gzip(BufWriter<GzEncoder<File>>),
}

/// Writer of one `pmb-parity-trace/2` file (22 §3).
pub struct ParityTraceWriter {
    out: Option<Out>,
    file: Option<AtomicFile>,
    error: Option<String>,
    line: String,
    profile: Profile,
    level: TraceLevel,
}

fn io_error(path: &Path, e: impl std::fmt::Display) -> EngineError {
    EngineError::runtime("io", format!("trace {}: {e}", path.display()))
}

// ---- JSON fragments (fixed key order, exact numbers) ----------------------

fn push_str(s: &mut String, v: &str) {
    s.push_str(&serde_json::to_string(v).expect("string serializes"));
}

fn push_micros(s: &mut String, micros: i64) {
    s.push_str(&format_micros(micros));
}

fn push_int(s: &mut String, v: i64) {
    s.push_str(&v.to_string());
}

fn push_opt_ts(s: &mut String, v: Option<TsMs>) {
    match v {
        Some(t) => push_int(s, t.0),
        None => s.push_str("null"),
    }
}

fn push_opt_str(s: &mut String, v: Option<&str>) {
    match v {
        Some(t) => push_str(s, t),
        None => s.push_str("null"),
    }
}

fn push_asset(s: &mut String, o: Option<Outcome>) {
    match o {
        Some(o) => push_int(s, o.index() as i64),
        None => s.push_str("null"),
    }
}

fn push_f64(s: &mut String, v: f64) {
    if v.is_finite() {
        s.push_str(&serde_json::to_string(&v).expect("finite f64 serializes"));
    } else {
        s.push_str("null");
    }
}

fn push_order_fields(s: &mut String, o: &TraceOrder<'_>) {
    s.push_str(",\"cid\":");
    push_str(s, o.cid);
    s.push_str(",\"asset\":");
    push_asset(s, Some(o.asset));
    s.push_str(",\"side\":\"");
    s.push_str(o.side.as_str());
    match o.size {
        OrderSize::Shares(q) => {
            s.push_str("\",\"price\":");
            push_micros(s, o.price.micros());
            s.push_str(",\"size\":");
            push_micros(s, q.micros());
        }
        OrderSize::Collateral(a) => {
            s.push_str("\",\"price\":");
            push_micros(s, o.price.micros());
            s.push_str(",\"amountUsdc\":");
            push_micros(s, a.micros());
        }
    }
    s.push_str(",\"orderType\":\"");
    s.push_str(o.order_type.as_str());
    s.push_str("\",\"postOnly\":");
    s.push_str(if o.post_only { "true" } else { "false" });
    s.push_str(",\"expireAtMs\":");
    push_opt_ts(s, o.expire_at_ms);
}

fn push_feed(s: &mut String, v: Option<TraceFeedValue>, with_ts: bool) {
    match v {
        None => s.push_str("null"),
        Some(v) => {
            s.push('{');
            if with_ts {
                s.push_str("\"tsMs\":");
                push_opt_ts(s, v.ts_ms);
                s.push(',');
            }
            s.push_str("\"value\":");
            push_f64(s, v.value);
            s.push_str(",\"receivedAtMs\":");
            push_int(s, v.received_at_ms.0);
            s.push('}');
        }
    }
}

impl ParityTraceWriter {
    /// Creates the temp file next to `path` and writes the `header`.
    pub fn create(path: &Path, header: &TraceHeader<'_>) -> Result<ParityTraceWriter, EngineError> {
        let mut file = AtomicFile::create(path).map_err(|e| io_error(path, e))?;
        let handle = file.take_file().expect("fresh atomic file has a handle");
        let gzip = path.extension().is_some_and(|e| e == "gz");
        let out = if gzip {
            Out::Gzip(BufWriter::with_capacity(
                TRACE_BUFFER_BYTES,
                GzEncoder::new(handle, Compression::new(TRACE_GZIP_LEVEL)),
            ))
        } else {
            Out::Plain(BufWriter::with_capacity(TRACE_BUFFER_BYTES, handle))
        };
        let mut w = ParityTraceWriter {
            out: Some(out),
            file: Some(file),
            error: None,
            line: String::with_capacity(512),
            profile: header.profile,
            level: header.level,
        };
        let s = &mut w.line;
        s.clear();
        s.push_str("{\"t\":\"header\",\"format\":\"pmb-parity-trace\",\"version\":2,\"engine\":\"native\",\"engineVersion\":");
        push_str(s, header.engine_version);
        s.push_str(",\"profile\":\"");
        s.push_str(header.profile.as_str());
        s.push_str("\",\"slug\":");
        push_str(s, header.slug);
        s.push_str(",\"candidateKey\":");
        push_str(s, header.candidate_key);
        s.push_str(",\"level\":\"");
        s.push_str(header.level.as_str());
        s.push_str("\"}");
        w.emit();
        Ok(w)
    }

    /// The trace level.
    pub fn level(&self) -> TraceLevel {
        self.level
    }

    /// Records an error that fails [`ParityTraceWriter::finish`]; writing
    /// stops at the first one.
    pub fn fail(&mut self, message: impl Into<String>) {
        if self.error.is_none() {
            self.error = Some(message.into());
        }
    }

    fn emit(&mut self) {
        if self.error.is_some() {
            return;
        }
        self.line.push('\n');
        let r = match self.out.as_mut() {
            Some(Out::Plain(w)) => w.write_all(self.line.as_bytes()),
            Some(Out::Gzip(w)) => w.write_all(self.line.as_bytes()),
            None => Ok(()),
        };
        if let Err(e) = r {
            self.error = Some(format!("write: {e}"));
        }
    }

    /// `tick` (22 §3.2): `seq`, `ts`, `cause`, optional `xts` and `vts`.
    pub fn tick(&mut self, seq: u64, ts: TsMs, cause: &str, xts: Option<TsMs>, vts: Option<TsMs>) {
        let s = &mut self.line;
        s.clear();
        s.push_str("{\"t\":\"tick\",\"seq\":");
        push_int(s, seq as i64);
        s.push_str(",\"ts\":");
        push_int(s, ts.0);
        s.push_str(",\"cause\":");
        push_str(s, cause);
        if let Some(x) = xts {
            s.push_str(",\"xts\":");
            push_int(s, x.0);
        }
        if let Some(v) = vts {
            s.push_str(",\"vts\":");
            push_int(s, v.0);
        }
        s.push('}');
        self.emit();
    }

    /// `intent` (22 §3.2), in returned order.
    pub fn intent(&mut self, seq: u64, src: IntentSource, intent: &TraceIntent<'_>) {
        let s = &mut self.line;
        s.clear();
        s.push_str("{\"t\":\"intent\",\"seq\":");
        push_int(s, seq as i64);
        s.push_str(",\"src\":\"");
        s.push_str(src.as_str());
        s.push_str("\",\"kind\":\"");
        match intent {
            TraceIntent::PlaceLimit(o) => {
                s.push_str("place_limit\"");
                push_order_fields(s, o);
            }
            TraceIntent::PlaceBatch(orders) => {
                s.push_str("place_batch\",\"orders\":[");
                for (i, o) in orders.iter().enumerate() {
                    if i > 0 {
                        s.push(',');
                    }
                    // Same fields as place_limit, without the leading comma.
                    let mut one = String::new();
                    push_order_fields(&mut one, o);
                    s.push('{');
                    s.push_str(&one[1..]);
                    s.push('}');
                }
                s.push(']');
            }
            TraceIntent::CancelOrder(cid) => {
                s.push_str("cancel_order\",\"cid\":");
                push_opt_str(s, *cid);
            }
            TraceIntent::CancelBatch(cids) => {
                s.push_str("cancel_batch\",\"cids\":[");
                for (i, c) in cids.iter().enumerate() {
                    if i > 0 {
                        s.push(',');
                    }
                    push_opt_str(s, *c);
                }
                s.push(']');
            }
            TraceIntent::CancelMarket { asset, market } => {
                s.push_str("cancel_market\",\"asset\":");
                push_asset(s, *asset);
                if let Some(m) = market {
                    s.push_str(",\"market\":");
                    push_str(s, m);
                }
            }
            TraceIntent::CancelAll => s.push_str("cancel_all\""),
            TraceIntent::Split(q) => {
                s.push_str("split_positions\",\"size\":");
                push_micros(s, q.micros());
            }
            TraceIntent::Merge(q) => {
                s.push_str("merge_positions\",\"size\":");
                push_micros(s, q.micros());
            }
        }
        s.push('}');
        self.emit();
    }

    /// `event` (22 §3.2), written just before the strategy's callback.
    pub fn event(&mut self, seq: u64, ts: TsMs, ev: &TraceAccountEvent<'_>) {
        if self.profile == Profile::TsCompat
            && matches!(
                ev,
                TraceAccountEvent::OrderDelayed { .. } | TraceAccountEvent::CancelAcked { .. }
            )
        {
            // 22 §3.2: these kinds MUST NOT appear in a ts-compat trace.
            self.fail(format!("{} in a ts-compat trace (22 §3.2)", ev.kind()));
            return;
        }
        let s = &mut self.line;
        s.clear();
        s.push_str("{\"t\":\"event\",\"seq\":");
        push_int(s, seq as i64);
        s.push_str(",\"kind\":\"");
        s.push_str(ev.kind());
        s.push_str("\",\"ts\":");
        push_int(s, ts.0);
        match ev {
            TraceAccountEvent::OrderSubmitted(o) => push_order_fields(s, o),
            TraceAccountEvent::OrderAccepted { cid } | TraceAccountEvent::OrderOpen { cid } => {
                s.push_str(",\"cid\":");
                push_str(s, cid);
            }
            TraceAccountEvent::OrderRejected { cid, reason } => {
                s.push_str(",\"cid\":");
                push_str(s, cid);
                s.push_str(",\"reason\":");
                push_str(s, reason);
            }
            TraceAccountEvent::OrderDone {
                cid,
                reason,
                filled_size,
            } => {
                s.push_str(",\"cid\":");
                push_str(s, cid);
                s.push_str(",\"reason\":");
                push_str(s, reason);
                s.push_str(",\"filledSize\":");
                match filled_size {
                    Some(q) => push_micros(s, q.micros()),
                    None => s.push_str("null"),
                }
            }
            TraceAccountEvent::Fill {
                cid,
                asset,
                side,
                price,
                size,
                fee,
                liquidity,
            } => {
                s.push_str(",\"cid\":");
                push_str(s, cid);
                s.push_str(",\"asset\":");
                push_asset(s, Some(*asset));
                s.push_str(",\"side\":\"");
                s.push_str(side.as_str());
                s.push_str("\",\"price\":");
                push_micros(s, price.micros());
                s.push_str(",\"size\":");
                push_micros(s, size.micros());
                s.push_str(",\"fee\":");
                push_micros(s, fee.micros());
                s.push_str(",\"liquidity\":\"");
                s.push_str(liquidity.as_str());
                s.push('"');
            }
            TraceAccountEvent::CancelFailed {
                op,
                cid,
                asset,
                reason,
            } => {
                s.push_str(",\"op\":");
                push_str(s, op);
                s.push_str(",\"cid\":");
                push_opt_str(s, *cid);
                s.push_str(",\"asset\":");
                push_asset(s, *asset);
                s.push_str(",\"reason\":");
                push_str(s, reason);
            }
            TraceAccountEvent::PositionsSplit { size, cost } => {
                s.push_str(",\"size\":");
                push_micros(s, size.micros());
                s.push_str(",\"cost\":");
                push_micros(s, cost.micros());
            }
            TraceAccountEvent::PositionsMerged { size } => {
                s.push_str(",\"size\":");
                push_micros(s, size.micros());
            }
            TraceAccountEvent::SplitFailed { size, reason }
            | TraceAccountEvent::MergeFailed { size, reason } => {
                s.push_str(",\"size\":");
                push_micros(s, size.micros());
                s.push_str(",\"reason\":");
                push_str(s, reason);
            }
            TraceAccountEvent::SettlementUpdate {
                cid,
                status,
                size_matched,
            } => {
                s.push_str(",\"cid\":");
                push_str(s, cid);
                s.push_str(",\"status\":");
                push_str(s, status);
                s.push_str(",\"sizeMatched\":");
                push_micros(s, size_matched.micros());
            }
            TraceAccountEvent::OrderDelayed { cid, release_at_ms } => {
                s.push_str(",\"cid\":");
                push_str(s, cid);
                s.push_str(",\"releaseAtMs\":");
                push_int(s, release_at_ms.0);
            }
            TraceAccountEvent::CancelAcked { op, cid } => {
                s.push_str(",\"op\":");
                push_str(s, op);
                s.push_str(",\"cid\":");
                push_str(s, cid);
            }
        }
        s.push('}');
        self.emit();
    }

    /// `feeds` (level `feeds` only, 22 §3.2). Ignored at level `decisions`.
    pub fn feeds(&mut self, seq: u64, f: &TraceFeeds<'_>) {
        if self.level != TraceLevel::Feeds {
            return;
        }
        let s = &mut self.line;
        s.clear();
        s.push_str("{\"t\":\"feeds\",\"seq\":");
        push_int(s, seq as i64);
        s.push_str(",\"binance\":");
        push_feed(s, f.binance, true);
        s.push_str(",\"chainlink\":");
        push_feed(s, f.chainlink, true);
        s.push_str(",\"priceToBeat\":");
        push_feed(s, f.price_to_beat, false);
        s.push_str(",\"plugins\":");
        match f.plugins {
            Some(p) => s.push_str(&serde_json::to_string(p).expect("plugin snapshot serializes")),
            None => s.push_str("{}"),
        }
        s.push('}');
        self.emit();
    }

    /// Writes `final`, flushes, closes and renames the file into place.
    pub fn finish(mut self, fin: &TraceFinal<'_>) -> Result<(), EngineError> {
        let path = self
            .file
            .as_ref()
            .map(|f| f.target().to_path_buf())
            .unwrap_or_default();
        let stats = match fin.stats {
            Some(st) => serde_json::to_string(st).map_err(|e| {
                EngineError::invalid_output("self_check", format!("trace stats: {e}"))
            })?,
            None => "null".to_string(),
        };
        let by_type = serde_json::to_string(fin.events_by_type).map_err(|e| {
            EngineError::invalid_output("self_check", format!("trace eventsByType: {e}"))
        })?;
        let s = &mut self.line;
        s.clear();
        s.push_str("{\"t\":\"final\",\"stats\":");
        s.push_str(&stats);
        s.push_str(",\"skipReason\":");
        push_opt_str(s, fin.skip_reason.map(SkipReason::as_str));
        s.push_str(",\"eventsProcessed\":");
        push_int(s, fin.events_processed as i64);
        s.push_str(",\"eventsByType\":");
        s.push_str(&by_type);
        let u = fin.unrounded;
        s.push_str(",\"unrounded\":{\"pnl\":");
        push_micros(s, u.pnl);
        s.push_str(",\"cost\":");
        push_micros(s, u.cost);
        s.push_str(",\"feesPaid\":");
        push_micros(s, u.fees_paid);
        s.push_str(",\"splitCost\":");
        push_micros(s, u.split_cost);
        s.push_str(",\"upShares\":");
        push_micros(s, u.up_shares);
        s.push_str(",\"downShares\":");
        push_micros(s, u.down_shares);
        s.push_str("}}");
        self.emit();
        if let Some(e) = self.error.take() {
            return Err(match e.strip_prefix("write: ") {
                Some(io) => io_error(&path, io),
                None => EngineError::engine_fault("invariant", format!("parity trace: {e}")),
            });
        }
        let file = match self.out.take() {
            Some(Out::Plain(w)) => w.into_inner().map_err(|e| io_error(&path, e.error()))?,
            Some(Out::Gzip(w)) => w
                .into_inner()
                .map_err(|e| io_error(&path, e.error()))?
                .finish()
                .map_err(|e| io_error(&path, e))?,
            None => return Err(io_error(&path, "trace already closed")),
        };
        file.sync_data().map_err(|e| io_error(&path, e))?;
        drop(file);
        self.file
            .take()
            .expect("open trace has its file")
            .commit()
            .map_err(|e| io_error(&path, e))
    }

    /// Drops the trace without writing `final`; the temp file is removed.
    pub fn abort(mut self) {
        self.out.take();
        self.file.take();
    }
}

/// The `TraceSink` of 22 §3: translates engine events into parity trace
/// records. Pass `&mut ParityTraceSink` to the session (the sink outlives
/// it and is finished by the runtime with the result's `final` values).
pub struct ParityTraceSink {
    writer: ParityTraceWriter,
}

impl ParityTraceSink {
    /// Creates the trace file and writes its header.
    pub fn create(path: &Path, header: &TraceHeader<'_>) -> Result<ParityTraceSink, EngineError> {
        Ok(ParityTraceSink {
            writer: ParityTraceWriter::create(path, header)?,
        })
    }

    /// The record writer (for engine integration and tests).
    pub fn writer(&mut self) -> &mut ParityTraceWriter {
        &mut self.writer
    }

    /// Writes `final` and renames the file into place.
    pub fn finish(self, fin: &TraceFinal<'_>) -> Result<(), EngineError> {
        self.writer.finish(fin)
    }

    /// Discards the trace (candidate fault: no `final` exists).
    pub fn abort(self) {
        self.writer.abort();
    }
}

impl TraceSink for &mut ParityTraceSink {
    fn wants_feed_view(&self) -> bool {
        self.writer.level == TraceLevel::Feeds
    }

    fn record(&mut self, ev: &TraceEvent<'_>) {
        match *ev {
            TraceEvent::TickStart {
                seq,
                cause,
                decision_ts,
                exchange_ts,
                visibility_ts,
            } => self.writer.tick(
                seq,
                decision_ts,
                cause.as_str(),
                exchange_ts,
                Some(visibility_ts),
            ),
            TraceEvent::FeedView { seq, view: _ } => {
                // The pmb-engine FeedsView is a stand-in without values until
                // pmb-feeds lands; strategies that request feeds or plugins
                // are refused before the run (crate::run), so every value is
                // `null` and `plugins` is empty here, which is exact.
                self.writer.feeds(seq, &TraceFeeds::default());
            }
            TraceEvent::Decision {
                seq: _,
                origin,
                intents,
            } => {
                if origin == DecisionOrigin::Engine || intents.is_empty() {
                    // Engine-originated intents are not strategy decisions.
                    return;
                }
                // D-PENDING: `Intents` exposes no read accessors outside
                // pmb-engine (`core()`/`cid_text()` are crate-private), so
                // intent records cannot be rendered yet (crossStreamNeeds).
                self.writer
                    .fail("intent records need pmb-engine Intents read accessors");
            }
            TraceEvent::AccountEvent { .. } => {
                // D-PENDING: the core event carries keys only; rendering
                // needs the resolved view and the session's cid interner
                // (crossStreamNeeds).
                self.writer
                    .fail("event records need the resolved account-event view");
            }
            TraceEvent::Exec(_) | TraceEvent::Final(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn scratch(name: &str) -> std::path::PathBuf {
        let d =
            std::env::temp_dir().join(format!("pmb-runtime-trace-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn header(level: TraceLevel) -> TraceHeader<'static> {
        TraceHeader {
            engine_version: "0.1.0",
            profile: Profile::TsCompat,
            slug: "btc-updown-15m-1780272000",
            candidate_key: "cand-a",
            level,
        }
    }

    fn read_lines(path: &Path) -> Vec<String> {
        let raw = std::fs::read(path).unwrap();
        let text = if path.extension().is_some_and(|e| e == "gz") {
            let mut s = String::new();
            flate2::read::GzDecoder::new(&raw[..])
                .read_to_string(&mut s)
                .unwrap();
            s
        } else {
            String::from_utf8(raw).unwrap()
        };
        text.lines().map(str::to_string).collect()
    }

    fn p(m: i64) -> Price {
        Price::from_micros(m)
    }

    fn q(m: i64) -> Qty {
        Qty::from_micros(m)
    }

    #[test]
    fn records_have_the_v2_shapes_and_exact_numbers() {
        // spec: 22 §3.1 (header first, final last, gzip, atomic), §3.2 records, §3.3 numbers and assets
        let d = scratch("shapes");
        let path = d.join("t.jsonl.gz");
        let mut w = ParityTraceWriter::create(&path, &header(TraceLevel::Feeds)).unwrap();
        w.tick(
            0,
            TsMs(1_780_272_000_123),
            "book",
            Some(TsMs(1_780_272_000_100)),
            None,
        );
        let order = TraceOrder {
            cid: "entry-1",
            asset: Outcome::Down,
            side: Side::Buy,
            price: p(530_000),
            size: OrderSize::Shares(q(5_000_000)),
            order_type: OrderType::Gtc,
            post_only: false,
            expire_at_ms: None,
        };
        w.intent(0, IntentSource::Tick, &TraceIntent::PlaceLimit(order));
        let spend = TraceOrder {
            size: OrderSize::Collateral(Usdc::from_micros(2_500_001)),
            order_type: OrderType::Fok,
            expire_at_ms: None,
            ..order
        };
        w.intent(
            0,
            IntentSource::Account,
            &TraceIntent::PlaceBatch(&[spend, order]),
        );
        w.intent(
            0,
            IntentSource::Tick,
            &TraceIntent::CancelBatch(&[Some("a"), None]),
        );
        w.intent(
            0,
            IntentSource::Tick,
            &TraceIntent::CancelMarket {
                asset: None,
                market: Some("0xabc"),
            },
        );
        w.intent(0, IntentSource::Tick, &TraceIntent::Split(q(-1_005_000)));
        w.event(0, TsMs(5), &TraceAccountEvent::OrderSubmitted(order));
        w.event(
            0,
            TsMs(5),
            &TraceAccountEvent::Fill {
                cid: "entry-1",
                asset: Outcome::Down,
                side: Side::Buy,
                price: p(530_000),
                size: q(5_000_000),
                fee: Usdc::from_micros(174_400),
                liquidity: Liquidity::Taker,
            },
        );
        w.event(
            0,
            TsMs(6),
            &TraceAccountEvent::OrderDone {
                cid: "entry-1",
                reason: "filled",
                filled_size: Some(q(5_000_000)),
            },
        );
        w.feeds(
            0,
            &TraceFeeds {
                binance: Some(TraceFeedValue {
                    ts_ms: Some(TsMs(10)),
                    value: 117_234.51,
                    received_at_ms: TsMs(120),
                }),
                ..TraceFeeds::default()
            },
        );
        let ebt = EventsByType::from_counts([1, 2, 0, 0]).unwrap();
        w.finish(&TraceFinal {
            stats: None,
            skip_reason: Some(SkipReason::NoActivity),
            events_processed: 3,
            events_by_type: &ebt,
            unrounded: Unrounded {
                pnl: -1_005_000,
                cost: 0,
                fees_paid: 174_400,
                split_cost: 0,
                up_shares: 0,
                down_shares: 5_000_000,
            },
        })
        .unwrap();

        let lines = read_lines(&path);
        assert_eq!(
            lines[0],
            r#"{"t":"header","format":"pmb-parity-trace","version":2,"engine":"native","engineVersion":"0.1.0","profile":"ts-compat","slug":"btc-updown-15m-1780272000","candidateKey":"cand-a","level":"feeds"}"#
        );
        assert_eq!(
            lines[1],
            r#"{"t":"tick","seq":0,"ts":1780272000123,"cause":"book","xts":1780272000100}"#
        );
        assert_eq!(
            lines[2],
            r#"{"t":"intent","seq":0,"src":"tick","kind":"place_limit","cid":"entry-1","asset":1,"side":"BUY","price":0.53,"size":5,"orderType":"GTC","postOnly":false,"expireAtMs":null}"#
        );
        assert_eq!(
            lines[3],
            r#"{"t":"intent","seq":0,"src":"account","kind":"place_batch","orders":[{"cid":"entry-1","asset":1,"side":"BUY","price":0.53,"amountUsdc":2.500001,"orderType":"FOK","postOnly":false,"expireAtMs":null},{"cid":"entry-1","asset":1,"side":"BUY","price":0.53,"size":5,"orderType":"GTC","postOnly":false,"expireAtMs":null}]}"#
        );
        assert_eq!(
            lines[4],
            r#"{"t":"intent","seq":0,"src":"tick","kind":"cancel_batch","cids":["a",null]}"#
        );
        assert_eq!(
            lines[5],
            r#"{"t":"intent","seq":0,"src":"tick","kind":"cancel_market","asset":null,"market":"0xabc"}"#
        );
        assert_eq!(
            lines[6],
            r#"{"t":"intent","seq":0,"src":"tick","kind":"split_positions","size":-1.005}"#
        );
        assert!(lines[7].starts_with(
            r#"{"t":"event","seq":0,"kind":"order_submitted","ts":5,"cid":"entry-1""#
        ));
        assert_eq!(
            lines[8],
            r#"{"t":"event","seq":0,"kind":"fill","ts":5,"cid":"entry-1","asset":1,"side":"BUY","price":0.53,"size":5,"fee":0.1744,"liquidity":"TAKER"}"#
        );
        assert_eq!(
            lines[9],
            r#"{"t":"event","seq":0,"kind":"order_done","ts":6,"cid":"entry-1","reason":"filled","filledSize":5}"#
        );
        assert_eq!(
            lines[10],
            r#"{"t":"feeds","seq":0,"binance":{"tsMs":10,"value":117234.51,"receivedAtMs":120},"chainlink":null,"priceToBeat":null,"plugins":{}}"#
        );
        assert_eq!(
            lines[11],
            r#"{"t":"final","stats":null,"skipReason":"no_activity","eventsProcessed":3,"eventsByType":{"book":1,"price_change":2},"unrounded":{"pnl":-1.005,"cost":0,"feesPaid":0.1744,"splitCost":0,"upShares":0,"downShares":5}}"#
        );
        assert_eq!(lines.len(), 12);
        for l in &lines {
            serde_json::from_str::<Value>(l).unwrap();
        }
        // Atomic: only the final file remains.
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn plain_path_is_uncompressed_and_decisions_level_drops_feeds() {
        // spec: 22 §3.2 (`feeds` at level feeds only)
        let d = scratch("plain");
        let path = d.join("t.jsonl");
        let mut w = ParityTraceWriter::create(&path, &header(TraceLevel::Decisions)).unwrap();
        w.feeds(0, &TraceFeeds::default());
        let ebt = EventsByType::default();
        w.finish(&TraceFinal {
            stats: None,
            skip_reason: Some(SkipReason::NoActivity),
            events_processed: 0,
            events_by_type: &ebt,
            unrounded: Unrounded::default(),
        })
        .unwrap();
        let lines = read_lines(&path);
        assert_eq!(lines.len(), 2);
        assert!(lines[1].starts_with(r#"{"t":"final","stats":null"#));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn ts_compat_refuses_realistic_only_events_and_abort_leaves_nothing() {
        // spec: 22 §3.2 (order_delayed and cancel_acked MUST NOT appear in ts-compat)
        let d = scratch("refuse");
        let path = d.join("t.jsonl.gz");
        let mut w = ParityTraceWriter::create(&path, &header(TraceLevel::Decisions)).unwrap();
        w.event(
            0,
            TsMs(1),
            &TraceAccountEvent::OrderDelayed {
                cid: "c",
                release_at_ms: TsMs(2),
            },
        );
        let ebt = EventsByType::default();
        let e = w
            .finish(&TraceFinal {
                stats: None,
                skip_reason: None,
                events_processed: 0,
                events_by_type: &ebt,
                unrounded: Unrounded::default(),
            })
            .unwrap_err();
        assert_eq!(e.exit_code(), 8);
        assert!(!path.exists());
        let w = ParityTraceWriter::create(&path, &header(TraceLevel::Decisions)).unwrap();
        w.abort();
        assert!(!path.exists());
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 0);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn gzip_output_is_deterministic() {
        // spec: 20 G5 (traces are outputs; same records give the same bytes)
        let d = scratch("det");
        let ebt = EventsByType::from_counts([1, 0, 0, 0]).unwrap();
        let mut bytes = Vec::new();
        for name in ["a.jsonl.gz", "b.jsonl.gz"] {
            let path = d.join(name);
            let mut w = ParityTraceWriter::create(&path, &header(TraceLevel::Decisions)).unwrap();
            w.tick(0, TsMs(1), "book", None, None);
            w.finish(&TraceFinal {
                stats: None,
                skip_reason: None,
                events_processed: 1,
                events_by_type: &ebt,
                unrounded: Unrounded::default(),
            })
            .unwrap();
            bytes.push(std::fs::read(&path).unwrap());
        }
        assert_eq!(bytes[0], bytes[1]);
        std::fs::remove_dir_all(&d).unwrap();
    }
}
