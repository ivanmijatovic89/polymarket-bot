//! The telonex-delta reader rules (15 §4.2, §8) applied to [`TypedRows`].
//!
//! This mirrors `pmb_replay::read_telonex_delta` row for row: the same skip
//! reasons, anomaly counters, asset resolution, error classes and texts. It
//! lives here only because pmb-replay does not yet expose its typed-row layer;
//! NT-6 (b) (`pmb-tape verify`, the fixture tests) proves the two streams
//! identical. Once pmb-replay reads typed rows, this module collapses into a
//! call to it.

use crate::typed::{dec, event_type, int, row_flags, TypedRows, NULL_ID};
use pmb_core::{
    LevelUpdate, MarketEvent, Outcome, Price, PriceSize, Qty, QuoteSide, TimedMarketEvent, TsMs,
};
use pmb_replay::telonex::{RowKind, TelonexDiagnostics, FORMAT_VERSION};
use pmb_replay::{ErrorClass, InputError, TelonexInput};

/// One kept row (exactly one real tick, I-19).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct StreamRow {
    pub row: u32,
    pub exchange_ts: TsMs,
    pub local_ts: Option<TsMs>,
    pub kind: RowKind,
    start: u32,
    end: u32,
}

/// The decoded market stream (same shape as `pmb_replay::TelonexTape`).
#[derive(Clone, Debug, Default)]
pub struct ReplayStream {
    pub rows: Vec<StreamRow>,
    book_levels: Vec<PriceSize>,
    changes: Vec<LevelUpdate>,
    pub market: String,
    pub diagnostics: TelonexDiagnostics,
}

impl ReplayStream {
    #[inline]
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    #[inline]
    pub fn event(&self, i: usize) -> TimedMarketEvent<'_> {
        let r = &self.rows[i];
        let (s, e) = (r.start as usize, r.end as usize);
        let event = match r.kind {
            RowKind::Book { outcome, bids } => {
                let mid = s + bids as usize;
                MarketEvent::Book {
                    outcome,
                    bids: &self.book_levels[s..mid],
                    asks: &self.book_levels[mid..e],
                }
            }
            RowKind::PriceChange => MarketEvent::PriceChange {
                changes: &self.changes[s..e],
            },
        };
        TimedMarketEvent {
            row: r.row,
            exchange_ts: r.exchange_ts,
            local_ts: r.local_ts,
            event,
        }
    }

    pub fn events(&self) -> impl Iterator<Item = TimedMarketEvent<'_>> + '_ {
        (0..self.rows.len()).map(move |i| self.event(i))
    }
}

fn defect(cause: &'static str, detail: impl Into<String>) -> InputError {
    InputError::new(ErrorClass::DataDefect, cause, detail)
}

/// Asset resolution of one dictionary entry (I-17, I-18).
fn resolve(bytes: &[u8], tokens: [&str; 2]) -> Result<Option<Outcome>, InputError> {
    let s = std::str::from_utf8(bytes).map_err(|_| defect("corrupt", "asset id is not UTF-8"))?;
    let t = s.trim();
    if t.is_empty() {
        Ok(None)
    } else if t == tokens[0] {
        Ok(Some(Outcome::Up))
    } else if t == tokens[1] {
        Ok(Some(Outcome::Down))
    } else {
        Err(defect(
            "foreign_file",
            format!("asset id {t} is not one of the job's tokens"),
        ))
    }
}

/// Replays typed rows with the reader's rules into a market stream.
pub fn replay(t: &TypedRows, input: &TelonexInput<'_>) -> Result<ReplayStream, InputError> {
    if input.format_version != FORMAT_VERSION {
        return Err(defect(
            "format_version",
            format!(
                "job format version {} is not supported",
                input.format_version
            ),
        ));
    }
    // Per-dictionary-entry views, computed once per file.
    let market_of: Vec<&str> = t
        .dict
        .iter()
        .map(|e| std::str::from_utf8(e).map(str::trim).unwrap_or(""))
        .collect();
    let asset_of: Vec<Result<Option<Outcome>, InputError>> =
        t.dict.iter().map(|e| resolve(e, input.tokens)).collect();
    let asset = |id: u8| -> Result<Option<Outcome>, InputError> {
        if id == NULL_ID {
            Ok(None)
        } else {
            asset_of[id as usize].clone()
        }
    };

    let mut s = ReplayStream::default();
    s.rows.reserve(t.len());
    s.book_levels.reserve(
        t.decimals[dec::BID_PRICES].values.len() + t.decimals[dec::ASK_PRICES].values.len(),
    );
    s.changes
        .reserve(t.decimals[dec::CHANGE_PRICES].values.len());
    let mut last_ex: Option<i64> = None;
    let mut last_local: Option<i64> = None;
    let mut last_seq: Option<i64> = None;
    let d = &t.decimals;
    let inexact = |list: usize, i: usize| d[list].is_inexact(i) as u64;

    for r in 0..t.len() {
        let diag = &mut s.diagnostics;
        diag.rows_read += 1;
        let seq = t.ingest_seq[r];
        if last_seq.is_some_and(|l| seq <= l) {
            diag.ingest_seq_backwards += 1;
        }
        last_seq = Some(seq);

        let market = market_of[t.market[r] as usize];
        if market.is_empty() {
            diag.skipped.blank_market += 1;
            continue;
        }
        if s.market.is_empty() {
            if let Some(cid) = input.condition_id {
                if !cid.eq_ignore_ascii_case(market) {
                    return Err(defect(
                        "foreign_file",
                        format!("file market {market} != job condition id {cid}"),
                    ));
                }
            }
            s.market = market.to_string();
        } else if s.market != market {
            return Err(defect(
                "foreign_file",
                format!("market column changes: {} then {market}", s.market),
            ));
        }
        let flags = t.flags[r];
        let ex = t.ts_exchange_ms[r];
        if flags & row_flags::TS_EXCHANGE_NULL != 0 || ex < 0 {
            diag.skipped.no_exchange_ts += 1;
            continue;
        }
        let local = Some(t.ts_local_ms[r]).filter(|&l| l > 0);

        let a0 = asset(t.asset0[r])?;
        let a1 = asset(t.asset1[r])?;
        let by_index = |i: i32| -> Option<Outcome> {
            match i {
                0 => a0,
                1 => a1,
                _ => None,
            }
        };
        let diag = &mut s.diagnostics;
        let (kind, start, end) = match t.event_type[r] {
            event_type::BOOK => {
                let outcome = if flags & row_flags::ASSET_INDEX_NULL != 0 {
                    None
                } else {
                    by_index(t.asset_index[r])
                };
                let Some(outcome) = outcome else {
                    diag.skipped.unresolved_book_asset += 1;
                    continue;
                };
                let start = s.book_levels.len();
                let mut bids = 0usize;
                for (pl, sl) in [
                    (dec::BID_PRICES, dec::BID_SIZES),
                    (dec::ASK_PRICES, dec::ASK_SIZES),
                ] {
                    let (p0, p1) = d[pl].range(r);
                    let (s0, s1) = d[sl].range(r);
                    let n = (p1 - p0).min(s1 - s0);
                    for i in 0..n {
                        diag.inexact_decimal += inexact(pl, p0 + i) + inexact(sl, s0 + i);
                        s.book_levels.push(PriceSize {
                            price: Price::from_micros(d[pl].values[p0 + i]),
                            size: Qty::from_micros(d[sl].values[s0 + i]),
                        });
                    }
                    if pl == dec::BID_PRICES {
                        bids = n;
                    }
                }
                let end = s.book_levels.len();
                (
                    RowKind::Book {
                        outcome,
                        bids: bids as u32,
                    },
                    start,
                    end,
                )
            }
            event_type::PRICE_CHANGE => {
                let start = s.changes.len();
                let (a0r, a1r) = t.ints[int::CHANGE_ASSETS].range(r);
                let (c0, c1) = t.ints[int::CHANGE_SIDES].range(r);
                let (p0, p1) = d[dec::CHANGE_PRICES].range(r);
                let (z0, z1) = d[dec::CHANGE_SIZES].range(r);
                let n = (a1r - a0r).min(c1 - c0).min(p1 - p0).min(z1 - z0);
                let ai = &t.ints[int::CHANGE_ASSETS].values[a0r..a1r];
                let sc = &t.ints[int::CHANGE_SIDES].values[c0..c1];
                for i in 0..n {
                    let side = match sc[i] {
                        0 => QuoteSide::Bid,
                        1 => QuoteSide::Ask,
                        _ => {
                            diag.dropped_changes += 1;
                            continue;
                        }
                    };
                    let Some(outcome) = by_index(ai[i]) else {
                        diag.dropped_changes += 1;
                        continue;
                    };
                    diag.inexact_decimal +=
                        inexact(dec::CHANGE_PRICES, p0 + i) + inexact(dec::CHANGE_SIZES, z0 + i);
                    s.changes.push(LevelUpdate {
                        outcome,
                        side,
                        price: Price::from_micros(d[dec::CHANGE_PRICES].values[p0 + i]),
                        size: Qty::from_micros(d[dec::CHANGE_SIZES].values[z0 + i]),
                    });
                }
                let end = s.changes.len();
                if end == start {
                    diag.skipped.empty_price_change += 1;
                    continue;
                }
                (RowKind::PriceChange, start, end)
            }
            // Unreachable for validated rows: other event types are unconvertible.
            _ => {
                diag.skipped.other_event_type += 1;
                continue;
            }
        };
        if last_ex.is_some_and(|l| ex < l) {
            diag.exchange_clock_backwards += 1;
        }
        last_ex = Some(ex);
        if let Some(l) = local {
            if l < ex {
                diag.local_behind_exchange += 1;
            }
            if last_local.is_some_and(|p| l < p) {
                diag.local_clock_backwards += 1;
            }
            last_local = Some(l);
        }
        s.rows.push(StreamRow {
            row: r as u32,
            exchange_ts: TsMs(ex),
            local_ts: local.map(TsMs),
            kind,
            start: start as u32,
            end: end as u32,
        });
    }
    Ok(s)
}
