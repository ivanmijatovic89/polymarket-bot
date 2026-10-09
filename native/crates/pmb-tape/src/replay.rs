//! The telonex-delta reader rules (15 §4.2, §8) applied to [`TypedRows`].
//!
//! This mirrors `pmb_replay::read_telonex_delta` row for row: the same skip
//! reasons, anomaly counters, asset resolution, error classes and texts. It
//! lives here only because pmb-replay does not yet expose its typed-row
//! layer, so 16 NT-2 ("the reader's logic runs on typed rows") holds only
//! as long as the two copies agree. Until pmb-replay owns the typed rows
//! and this replayer (then `read_telonex_delta` = typed rows + replayer and
//! this module collapses into a call to it), three guards keep the copies
//! in lockstep:
//!
//! - `tests::mirrored_reader_source_is_pinned` fails when pmb-replay's reader
//!   source changes, until this mirror (and `v1.rs`) has been reviewed and
//!   the pin updated;
//! - [`mirrored_counters`] stops compiling when pmb-replay's diagnostics gain
//!   or lose a counter;
//! - `tests::generated_corpus_streams_are_identical_on_every_path` runs both
//!   readers over a generated corpus that drives every counter, every skip
//!   reason and every input error, and requires identical results.

use crate::typed::{dec, event_type, int, row_flags, TypedRows, NULL_ID};
use pmb_core::{
    LevelUpdate, MarketEvent, Outcome, Price, PriceSize, Qty, QuoteSide, TimedMarketEvent, TsMs,
};
use pmb_replay::telonex::{SkippedRows, TelonexDiagnostics};
use pmb_replay::{ErrorClass, InputError, TelonexInput};
use std::collections::TryReserveError;
use std::path::{Path, PathBuf};

/// Ladder unit of the book (0.0001); other prices count as `offGridPrices`.
const GRID_MICROS: i64 = pmb_book::LADDER_STEP;

/// Kind of a kept row.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum RowKind {
    /// A `book` snapshot of `outcome` with `bids` bid levels (the rest asks).
    Book {
        outcome: Outcome,
        bids: u32,
    },
    PriceChange,
}

/// Blank as the reader sees it (ECMAScript `trim() === ''`): every code
/// point is Unicode `White_Space` except U+0085, or U+FEFF.
fn is_blank(s: &str) -> bool {
    s.chars()
        .all(|c| c == '\u{FEFF}' || (c.is_whitespace() && c != '\u{0085}'))
}

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

    /// Whether two rows of the same kind carry equal levels.
    fn payload_eq(&self, a: &StreamRow, b: &StreamRow) -> bool {
        let (ra, rb) = (
            a.start as usize..a.end as usize,
            b.start as usize..b.end as usize,
        );
        match a.kind {
            RowKind::Book { .. } => self.book_levels[ra] == self.book_levels[rb],
            RowKind::PriceChange => self.changes[ra] == self.changes[rb],
        }
    }
}

/// The counters this mirror maintains, destructured without `..`: a counter
/// added to (or removed from) pmb-replay's reader diagnostics fails to
/// compile here until the replayer below counts it the same way.
pub fn mirrored_counters(d: &TelonexDiagnostics) -> [(&'static str, u64); 15] {
    let TelonexDiagnostics {
        rows_read,
        skipped:
            SkippedRows {
                blank_market,
                no_exchange_ts,
                other_event_type,
                unresolved_book_asset,
                empty_price_change,
            },
        dropped_changes,
        inexact_decimal,
        exchange_clock_backwards,
        local_clock_backwards,
        local_behind_exchange,
        ingest_seq_backwards,
        duplicate_rows,
        ragged_rows,
        off_grid_prices,
    } = *d;
    [
        ("rows_read", rows_read),
        ("skipped.blank_market", blank_market),
        ("skipped.no_exchange_ts", no_exchange_ts),
        ("skipped.other_event_type", other_event_type),
        ("skipped.unresolved_book_asset", unresolved_book_asset),
        ("skipped.empty_price_change", empty_price_change),
        ("dropped_changes", dropped_changes),
        ("inexact_decimal", inexact_decimal),
        ("exchange_clock_backwards", exchange_clock_backwards),
        ("local_clock_backwards", local_clock_backwards),
        ("local_behind_exchange", local_behind_exchange),
        ("ingest_seq_backwards", ingest_seq_backwards),
        ("duplicate_rows", duplicate_rows),
        ("ragged_rows", ragged_rows),
        ("off_grid_prices", off_grid_prices),
    ]
}

fn defect(cause: &'static str, detail: impl Into<String>) -> InputError {
    InputError::new(ErrorClass::DataDefect, cause, detail)
}

/// Asset resolution of one dictionary entry (I-17, I-18): a blank id does
/// not resolve; any other id MUST equal one of the job's tokens exactly.
/// The converter refuses ids that are not UTF-8 ([`crate::typed::Unconvertible::Value`]).
fn resolve(bytes: &[u8], tokens: [&str; 2]) -> Result<Option<Outcome>, InputError> {
    let s = std::str::from_utf8(bytes).map_err(|_| defect("corrupt", "asset id is not UTF-8"))?;
    if is_blank(s) {
        Ok(None)
    } else if s == tokens[0] {
        Ok(Some(Outcome::Up))
    } else if s == tokens[1] {
        Ok(Some(Outcome::Down))
    } else {
        Err(defect(
            "foreign_file",
            format!("asset id {s:?} is not one of the job's tokens"),
        ))
    }
}

/// Replays typed rows of the v1 file `v1` with the reader's rules into a
/// market stream (`v1` names the file in error texts, as the reader does).
pub fn replay(
    t: &TypedRows,
    input: &TelonexInput<'_>,
    v1: &Path,
) -> Result<ReplayStream, InputError> {
    let mut r = Replayer::new(&t.dict, input, v1);
    r.reserve(t);
    r.feed(t, 0)?;
    Ok(r.finish())
}

/// The reader state across the blocks of one file.
pub struct Replayer<'a> {
    condition_id: Option<&'a str>,
    /// The v1 file, for error texts.
    path: PathBuf,
    /// The dictionary every fed block must carry (its ids index it).
    dict: Vec<Vec<u8>>,
    /// UTF-8 view of each dictionary entry, as stored ("" when not UTF-8).
    market_of: Vec<Box<str>>,
    /// Asset resolution of each dictionary entry.
    asset_of: Vec<Result<Option<Outcome>, InputError>>,
    /// Dictionary id of the market once set (ids are unique by bytes).
    market_id: Option<u8>,
    last_ex: Option<i64>,
    last_local: Option<i64>,
    last_seq: Option<i64>,
    s: ReplayStream,
}

impl<'a> Replayer<'a> {
    /// Resolves the dictionary once. The job's input format (I-13) is
    /// checked by the caller before a tape is used ([`crate::read_market`]).
    pub fn new(dict: &[Vec<u8>], input: &TelonexInput<'a>, v1: &Path) -> Self {
        Replayer {
            condition_id: input.condition_id,
            path: v1.to_path_buf(),
            dict: dict.to_vec(),
            market_of: dict
                .iter()
                .map(|e| std::str::from_utf8(e).unwrap_or("").into())
                .collect(),
            asset_of: dict.iter().map(|e| resolve(e, input.tokens)).collect(),
            market_id: None,
            last_ex: None,
            last_local: None,
            last_seq: None,
            s: ReplayStream::default(),
        }
    }

    /// Reserves output for `t` (or, block-wise, for the whole file). Fails
    /// softly instead of panicking on counts no allocation can hold.
    pub fn reserve_counts(
        &mut self,
        rows: usize,
        book_levels: usize,
        changes: usize,
    ) -> Result<(), TryReserveError> {
        self.s.rows.try_reserve(rows)?;
        self.s.book_levels.try_reserve(book_levels)?;
        self.s.changes.try_reserve(changes)
    }

    fn reserve(&mut self, t: &TypedRows) {
        // Typed rows in memory bound these counts; a failure only means no
        // pre-reservation (the vectors still grow on demand).
        let _ = self.reserve_counts(
            t.len(),
            t.decimals[dec::BID_PRICES].values.len() + t.decimals[dec::ASK_PRICES].values.len(),
            t.decimals[dec::CHANGE_PRICES].values.len(),
        );
    }

    /// Applies the rows of `t`, whose first row is file row `row0`.
    ///
    /// # Panics
    ///
    /// When `t` does not carry exactly the dictionary given to
    /// [`Replayer::new`] (its ids index it): a caller bug, never data.
    pub fn feed(&mut self, t: &TypedRows, row0: usize) -> Result<(), InputError> {
        // At most 255 short entries, compared once per block.
        assert!(
            t.dict == self.dict,
            "typed rows carry another dictionary than the replayer's"
        );
        let market_of = &self.market_of;
        let asset_of = &self.asset_of;
        let s = &mut self.s;
        let mut market_id = self.market_id;
        let mut last_ex = self.last_ex;
        let mut last_local = self.last_local;
        let mut last_seq = self.last_seq;
        let asset = |id: u8| -> Result<Option<Outcome>, InputError> {
            if id == NULL_ID {
                return Ok(None);
            }
            match &asset_of[id as usize] {
                Ok(o) => Ok(*o),
                Err(e) => Err(e.clone()),
            }
        };
        let d = &t.decimals;
        let any_inexact: [bool; dec::COUNT] = std::array::from_fn(|k| !d[k].inexact.is_empty());
        let inexact = |list: usize, i: usize| (any_inexact[list] && d[list].is_inexact(i)) as u64;
        let path = &self.path;
        let result = (|| {
            for r in 0..t.len() {
                let diag = &mut s.diagnostics;
                diag.rows_read += 1;
                let seq = t.ingest_seq[r];
                if last_seq.is_some_and(|l| seq <= l) {
                    diag.ingest_seq_backwards += 1;
                }
                last_seq = Some(seq);

                // I-18: every asset id is one of the job's tokens, also on
                // rows that I-16 skips (resolved before the market check).
                let a0 = asset(t.asset0[r])?;
                let a1 = asset(t.asset1[r])?;

                let mid = t.market[r];
                if market_id != Some(mid) {
                    let market: &str = &market_of[mid as usize];
                    if is_blank(market) {
                        diag.skipped.blank_market += 1;
                        continue;
                    }
                    if market_id.is_some() {
                        return Err(defect(
                            "foreign_file",
                            format!(
                                "{}: market column changes: {:?} then {market:?}",
                                path.display(),
                                s.market,
                            ),
                        ));
                    }
                    if let Some(cid) = self.condition_id {
                        if !cid.eq_ignore_ascii_case(market) {
                            return Err(defect(
                                "foreign_file",
                                format!(
                                    "{}: file market {market:?} != job condition id {cid}",
                                    path.display()
                                ),
                            ));
                        }
                    }
                    s.market = market.to_string();
                    market_id = Some(mid);
                }
                let flags = t.flags[r];
                let ex = t.ts_exchange_ms[r];
                if flags & row_flags::TS_EXCHANGE_NULL != 0 || ex < 0 {
                    diag.skipped.no_exchange_ts += 1;
                    continue;
                }
                let local = Some(t.ts_local_ms[r]).filter(|&l| l > 0);

                let by_index = |i: i32| -> Option<Outcome> {
                    match i {
                        0 => a0,
                        1 => a1,
                        _ => None,
                    }
                };
                let off_grid = |m: i64| (m % GRID_MICROS != 0) as u64;
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
                        let mut ragged = false;
                        for (pl, sl) in [
                            (dec::BID_PRICES, dec::BID_SIZES),
                            (dec::ASK_PRICES, dec::ASK_SIZES),
                        ] {
                            let (p0, p1) = d[pl].range(r);
                            let (s0, s1) = d[sl].range(r);
                            ragged |= p1 - p0 != s1 - s0;
                            let n = (p1 - p0).min(s1 - s0);
                            for i in 0..n {
                                let price = d[pl].values[p0 + i];
                                diag.inexact_decimal += inexact(pl, p0 + i) + inexact(sl, s0 + i);
                                diag.off_grid_prices += off_grid(price);
                                s.book_levels.push(PriceSize {
                                    price: Price::from_micros(price),
                                    size: Qty::from_micros(d[sl].values[s0 + i]),
                                });
                            }
                            if pl == dec::BID_PRICES {
                                bids = n;
                            }
                        }
                        if ragged {
                            diag.ragged_rows += 1;
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
                        let ragged = [c1 - c0, p1 - p0, z1 - z0].iter().any(|&l| l != a1r - a0r);
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
                            let price = d[dec::CHANGE_PRICES].values[p0 + i];
                            diag.inexact_decimal += inexact(dec::CHANGE_PRICES, p0 + i)
                                + inexact(dec::CHANGE_SIZES, z0 + i);
                            diag.off_grid_prices += off_grid(price);
                            s.changes.push(LevelUpdate {
                                outcome,
                                side,
                                price: Price::from_micros(price),
                                size: Qty::from_micros(d[dec::CHANGE_SIZES].values[z0 + i]),
                            });
                        }
                        let end = s.changes.len();
                        if end == start {
                            diag.skipped.empty_price_change += 1;
                            continue;
                        }
                        if ragged {
                            diag.ragged_rows += 1;
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
                let row = StreamRow {
                    row: (row0 + r) as u32,
                    exchange_ts: TsMs(ex),
                    local_ts: local.map(TsMs),
                    kind,
                    start: start as u32,
                    end: end as u32,
                };
                // `duplicateRows` (15 §8): identical to the previous kept
                // row in clocks, kind, outcome and every level (the file
                // row index and `ingest_seq` are not compared).
                if let Some(prev) = s.rows.last() {
                    if prev.exchange_ts == row.exchange_ts
                        && prev.local_ts == row.local_ts
                        && prev.kind == row.kind
                        && s.payload_eq(prev, &row)
                    {
                        s.diagnostics.duplicate_rows += 1;
                    }
                }
                s.rows.push(row);
            }
            Ok(())
        })();
        self.market_id = market_id;
        self.last_ex = last_ex;
        self.last_local = last_local;
        self.last_seq = last_seq;
        result
    }

    pub fn finish(self) -> ReplayStream {
        self.s
    }
}
