//! telonex-delta reader, format version 1 (15 §4).
//!
//! Decodes a converted Telonex file column-wise into an immutable
//! [`TelonexTape`]: kept rows in file order plus one arena of levels, so the
//! loop borrows payloads and allocates nothing per row (12 E4, 16 §7).

use crate::error::{ErrorClass, InputError};
use crate::pq::{open, Column};
use parquet::basic::{Repetition, Type as PhysicalType};
use parquet::data_type::{ByteArray, ByteArrayType, Int32Type, Int64Type};
use parquet::file::reader::FileReader;
use pmb_core::fixed::parse_decimal;
use pmb_core::{
    LevelUpdate, MarketEvent, Outcome, Price, PriceSize, Qty, QuoteSide, TimedMarketEvent, TsMs,
};
use std::path::Path;

/// Format name carried by jobs and footers (15 I-12, I-13).
pub const FORMAT_NAME: &str = "telonex-delta-typed";
/// The only supported format version.
pub const FORMAT_VERSION: u32 = 1;

/// Version-1 schema fingerprint: column name, physical type, repetition
/// (`src/parquet/io/eventSchema.ts:53-70`; 15 I-11).
const V1_COLUMNS: [(&str, PhysicalType, Repetition); 16] = [
    ("ingest_seq", PhysicalType::INT64, Repetition::REQUIRED),
    ("ts_local_ms", PhysicalType::INT64, Repetition::REQUIRED),
    ("ts_exchange_ms", PhysicalType::INT64, Repetition::OPTIONAL),
    ("event_type", PhysicalType::BYTE_ARRAY, Repetition::REQUIRED),
    ("market", PhysicalType::BYTE_ARRAY, Repetition::REQUIRED),
    ("asset0_id", PhysicalType::BYTE_ARRAY, Repetition::OPTIONAL),
    ("asset1_id", PhysicalType::BYTE_ARRAY, Repetition::OPTIONAL),
    ("asset_index", PhysicalType::INT32, Repetition::OPTIONAL),
    ("bid_prices", PhysicalType::BYTE_ARRAY, Repetition::REPEATED),
    ("bid_sizes", PhysicalType::BYTE_ARRAY, Repetition::REPEATED),
    ("ask_prices", PhysicalType::BYTE_ARRAY, Repetition::REPEATED),
    ("ask_sizes", PhysicalType::BYTE_ARRAY, Repetition::REPEATED),
    (
        "change_asset_indexes",
        PhysicalType::INT32,
        Repetition::REPEATED,
    ),
    (
        "change_side_codes",
        PhysicalType::INT32,
        Repetition::REPEATED,
    ),
    (
        "change_prices",
        PhysicalType::BYTE_ARRAY,
        Repetition::REPEATED,
    ),
    (
        "change_sizes",
        PhysicalType::BYTE_ARRAY,
        Repetition::REPEATED,
    ),
];

/// Reader inputs taken from the job (21 §5, 15 §9).
#[derive(Clone, Debug)]
pub struct TelonexInput<'a> {
    /// Format version stated by the job (I-13).
    pub format_version: u32,
    /// Token ids of UP and DOWN (`marketResolution.tokenMap`, 10 M2).
    pub tokens: [&'a str; 2],
    /// Condition id when the job carries one (I-18).
    pub condition_id: Option<&'a str>,
}

/// Kind of a kept row.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum RowKind {
    /// `book` of one outcome; arena `[start, start+bids)` are bids, the rest asks.
    Book { outcome: Outcome, bids: u32 },
    /// `price_change`; arena range holds the resolved changes.
    PriceChange,
}

/// One kept row (I-19: exactly one real tick).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct TapeRow {
    /// Row index in the file, counting every row (also skipped ones).
    pub row: u32,
    pub exchange_ts: TsMs,
    /// `ts_local_ms`, `None` when `<= 0` (I-21).
    pub local_ts: Option<TsMs>,
    pub kind: RowKind,
    start: u32,
    end: u32,
}

/// Row-skip reasons (I-16), counted as `skippedRows` by reason (15 §8).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct SkippedRows {
    pub blank_market: u64,
    pub no_exchange_ts: u64,
    pub other_event_type: u64,
    pub unresolved_book_asset: u64,
    pub empty_price_change: u64,
}

impl SkippedRows {
    pub fn total(&self) -> u64 {
        self.blank_market
            + self.no_exchange_ts
            + self.other_event_type
            + self.unresolved_book_asset
            + self.empty_price_change
    }
}

/// Data-anomaly counters of the reader (15 §8).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct TelonexDiagnostics {
    pub rows_read: u64,
    pub skipped: SkippedRows,
    /// Changes dropped inside kept `price_change` rows (bad side code or asset index).
    pub dropped_changes: u64,
    pub inexact_decimal: u64,
    pub exchange_clock_backwards: u64,
    pub local_clock_backwards: u64,
    pub local_behind_exchange: u64,
    pub ingest_seq_backwards: u64,
}

/// Decoded, immutable telonex-delta market (15 I-4 tape form).
#[derive(Clone, Debug, Default)]
pub struct TelonexTape {
    pub rows: Vec<TapeRow>,
    book_levels: Vec<PriceSize>,
    changes: Vec<LevelUpdate>,
    /// The constant `market` column (condition id) of the file.
    pub market: String,
    pub diagnostics: TelonexDiagnostics,
}

impl TelonexTape {
    /// Kept rows (= real ticks).
    #[inline]
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// The event of kept row `i`, borrowing the arena.
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

    /// All events in replay order (I-15).
    pub fn events(&self) -> impl Iterator<Item = TimedMarketEvent<'_>> + '_ {
        (0..self.rows.len()).map(move |i| self.event(i))
    }
}

fn defect(cause: &'static str, detail: impl Into<String>) -> InputError {
    InputError::new(ErrorClass::DataDefect, cause, detail)
}

fn utf8(b: &ByteArray) -> Option<&str> {
    std::str::from_utf8(b.data()).ok()
}

/// Checks the footer keys and the version-1 fingerprint (I-12, I-13).
fn check_format(
    reader: &impl FileReader,
    job_version: u32,
    path: &Path,
) -> Result<[usize; 16], InputError> {
    if job_version != FORMAT_VERSION {
        return Err(defect(
            "format_version",
            format!("job format version {job_version} is not supported"),
        ));
    }
    let meta = reader.metadata().file_metadata();
    if let Some(kv) = meta.key_value_metadata() {
        let get = |k: &str| kv.iter().find(|e| e.key == k).and_then(|e| e.value.clone());
        if let Some(name) = get("pmb_format") {
            let version = get("pmb_format_version");
            if name != FORMAT_NAME || version.as_deref() != Some("1") {
                return Err(defect(
                    "format_version",
                    format!(
                        "{}: footer format {name} version {version:?}",
                        path.display()
                    ),
                ));
            }
        }
    }
    let schema = meta.schema_descr();
    let cols = schema.columns();
    if cols.len() != V1_COLUMNS.len() {
        return Err(defect(
            "format_version",
            format!("{}: {} columns (v1 has 16)", path.display(), cols.len()),
        ));
    }
    let mut idx = [0usize; 16];
    for (i, (name, ty, rep)) in V1_COLUMNS.iter().enumerate() {
        let c = &cols[i];
        let actual_rep = schema.get_column_root(i).get_basic_info().repetition();
        if c.path().string() != *name || c.physical_type() != *ty || actual_rep != *rep {
            return Err(defect(
                "format_version",
                format!(
                    "{}: column {i} is `{}` {:?} {:?}, v1 expects `{name}` {ty:?} {rep:?}",
                    path.display(),
                    c.path().string(),
                    c.physical_type(),
                    actual_rep
                ),
            ));
        }
        idx[i] = i;
    }
    Ok(idx)
}

/// Decoded columns of one row group, reused across groups.
struct Batch {
    ingest_seq: Column<i64>,
    ts_local: Column<i64>,
    ts_exchange: Column<i64>,
    event_type: Column<ByteArray>,
    market: Column<ByteArray>,
    asset0: Column<ByteArray>,
    asset1: Column<ByteArray>,
    asset_index: Column<i32>,
    bid_prices: Column<ByteArray>,
    bid_sizes: Column<ByteArray>,
    ask_prices: Column<ByteArray>,
    ask_sizes: Column<ByteArray>,
    change_assets: Column<i32>,
    change_sides: Column<i32>,
    change_prices: Column<ByteArray>,
    change_sizes: Column<ByteArray>,
}

impl Batch {
    fn new() -> Self {
        Batch {
            ingest_seq: Column::new(),
            ts_local: Column::new(),
            ts_exchange: Column::new(),
            event_type: Column::new(),
            market: Column::new(),
            asset0: Column::new(),
            asset1: Column::new(),
            asset_index: Column::new(),
            bid_prices: Column::new(),
            bid_sizes: Column::new(),
            ask_prices: Column::new(),
            ask_sizes: Column::new(),
            change_assets: Column::new(),
            change_sides: Column::new(),
            change_prices: Column::new(),
            change_sizes: Column::new(),
        }
    }

    fn read(
        &mut self,
        rg: &dyn parquet::file::reader::RowGroupReader,
        c: &[usize; 16],
        rows: usize,
    ) -> anyhow::Result<()> {
        self.ingest_seq.read::<Int64Type>(rg, c[0], rows)?;
        self.ts_local.read::<Int64Type>(rg, c[1], rows)?;
        self.ts_exchange.read::<Int64Type>(rg, c[2], rows)?;
        self.event_type.read::<ByteArrayType>(rg, c[3], rows)?;
        self.market.read::<ByteArrayType>(rg, c[4], rows)?;
        self.asset0.read::<ByteArrayType>(rg, c[5], rows)?;
        self.asset1.read::<ByteArrayType>(rg, c[6], rows)?;
        self.asset_index.read::<Int32Type>(rg, c[7], rows)?;
        self.bid_prices.read::<ByteArrayType>(rg, c[8], rows)?;
        self.bid_sizes.read::<ByteArrayType>(rg, c[9], rows)?;
        self.ask_prices.read::<ByteArrayType>(rg, c[10], rows)?;
        self.ask_sizes.read::<ByteArrayType>(rg, c[11], rows)?;
        self.change_assets.read::<Int32Type>(rg, c[12], rows)?;
        self.change_sides.read::<Int32Type>(rg, c[13], rows)?;
        self.change_prices.read::<ByteArrayType>(rg, c[14], rows)?;
        self.change_sizes.read::<ByteArrayType>(rg, c[15], rows)?;
        Ok(())
    }
}

/// Maps the row's own asset columns to outcomes (I-17, I-18), caching the
/// last strings so the common case is two byte compares per row.
struct AssetMap<'a> {
    tokens: [&'a str; 2],
    cache: [(Vec<u8>, Option<Outcome>); 2],
}

impl<'a> AssetMap<'a> {
    fn new(tokens: [&'a str; 2]) -> Self {
        AssetMap {
            tokens,
            cache: [(Vec::new(), None), (Vec::new(), None)],
        }
    }

    /// Outcome of asset column `slot` (0 or 1); `Ok(None)` for a blank column.
    fn resolve(
        &mut self,
        slot: usize,
        raw: Option<&ByteArray>,
    ) -> Result<Option<Outcome>, InputError> {
        let Some(raw) = raw else { return Ok(None) };
        let bytes = raw.data();
        if self.cache[slot].0 == bytes {
            return Ok(self.cache[slot].1);
        }
        let s =
            std::str::from_utf8(bytes).map_err(|_| defect("corrupt", "asset id is not UTF-8"))?;
        let t = s.trim();
        let outcome = if t.is_empty() {
            None
        } else if t == self.tokens[0] {
            Some(Outcome::Up)
        } else if t == self.tokens[1] {
            Some(Outcome::Down)
        } else {
            return Err(defect(
                "foreign_file",
                format!("asset id {t} is not one of the job's tokens"),
            ));
        };
        self.cache[slot] = (bytes.to_vec(), outcome);
        Ok(outcome)
    }
}

fn decimal(b: &ByteArray, diag: &mut TelonexDiagnostics, what: &str) -> Result<i64, InputError> {
    let s = utf8(b).ok_or_else(|| {
        InputError::new(
            ErrorClass::Runtime,
            "decode_unverified",
            format!("{what}: not UTF-8"),
        )
    })?;
    let d = parse_decimal(s).map_err(|e| {
        InputError::new(
            ErrorClass::Runtime,
            "decode_unverified",
            format!("{what} {s:?}: {e}"),
        )
    })?;
    if d.inexact {
        diag.inexact_decimal += 1;
    }
    Ok(d.micros)
}

/// Reads a whole telonex-delta file into a tape (15 §4).
pub fn read_telonex_delta(
    path: &Path,
    input: &TelonexInput<'_>,
) -> Result<TelonexTape, InputError> {
    if !path.is_absolute() {
        return Err(InputError::new(
            ErrorClass::InvalidInput,
            "path",
            format!("{} is not absolute", path.display()),
        ));
    }
    if !path.exists() {
        return Err(InputError::new(
            ErrorClass::DataMissing,
            "input_missing",
            path.display().to_string(),
        ));
    }
    let reader = open(path)
        .map_err(|e| InputError::new(ErrorClass::Runtime, "decode_unverified", format!("{e:#}")))?;
    let cols = check_format(&reader, input.format_version, path)?;
    let mut tape = TelonexTape::default();
    let mut assets = AssetMap::new(input.tokens);
    let mut b = Batch::new();
    let mut row_index: u32 = 0;
    let mut last_ex: Option<i64> = None;
    let mut last_local: Option<i64> = None;
    let mut last_seq: Option<i64> = None;
    let decode_err = |e: anyhow::Error| {
        InputError::new(ErrorClass::Runtime, "decode_unverified", format!("{e:#}"))
    };

    for g in 0..reader.num_row_groups() {
        let rg = reader.get_row_group(g).map_err(|e| decode_err(e.into()))?;
        let rows = rg.metadata().num_rows() as usize;
        b.read(rg.as_ref(), &cols, rows).map_err(decode_err)?;
        for r in 0..rows {
            let this_row = row_index;
            row_index += 1;
            tape.diagnostics.rows_read += 1;
            let diag = &mut tape.diagnostics;

            if let Some(&seq) = b.ingest_seq.get(r) {
                if last_seq.is_some_and(|l| seq <= l) {
                    diag.ingest_seq_backwards += 1;
                }
                last_seq = Some(seq);
            }
            let market = b.market.get(r).and_then(utf8).map(str::trim).unwrap_or("");
            if market.is_empty() {
                diag.skipped.blank_market += 1;
                continue;
            }
            if tape.market.is_empty() {
                if let Some(cid) = input.condition_id {
                    if !cid.eq_ignore_ascii_case(market) {
                        return Err(defect(
                            "foreign_file",
                            format!("file market {market} != job condition id {cid}"),
                        ));
                    }
                }
                tape.market = market.to_string();
            } else if tape.market != market {
                return Err(defect(
                    "foreign_file",
                    format!("market column changes: {} then {market}", tape.market),
                ));
            }
            let ex = match b.ts_exchange.get(r) {
                Some(&t) if t >= 0 => t,
                _ => {
                    diag.skipped.no_exchange_ts += 1;
                    continue;
                }
            };
            let local = b.ts_local.get(r).copied().filter(|&t| t > 0);

            let a0 = assets.resolve(0, b.asset0.get(r))?;
            let a1 = assets.resolve(1, b.asset1.get(r))?;
            let by_index = |i: i32| -> Option<Outcome> {
                match i {
                    0 => a0,
                    1 => a1,
                    _ => None,
                }
            };
            let diag = &mut tape.diagnostics;
            let kind = match b.event_type.get(r).map(|v| v.data()) {
                Some(b"book") => {
                    let Some(outcome) = b.asset_index.get(r).and_then(|&i| by_index(i)) else {
                        diag.skipped.unresolved_book_asset += 1;
                        continue;
                    };
                    let start = tape.book_levels.len();
                    for (prices, sizes) in
                        [(&b.bid_prices, &b.bid_sizes), (&b.ask_prices, &b.ask_sizes)]
                    {
                        let (ps, ss) = (prices.row(r), sizes.row(r));
                        for i in 0..ps.len().min(ss.len()) {
                            let price = Price::from_micros(decimal(&ps[i], diag, "price")?);
                            let size = Qty::from_micros(decimal(&ss[i], diag, "size")?);
                            tape.book_levels.push(PriceSize { price, size });
                        }
                    }
                    let nb = b.bid_prices.row(r).len().min(b.bid_sizes.row(r).len());
                    let end = tape.book_levels.len();
                    (
                        RowKind::Book {
                            outcome,
                            bids: nb as u32,
                        },
                        start,
                        end,
                    )
                }
                Some(b"price_change") => {
                    let start = tape.changes.len();
                    let (ai, sc, pr, sz) = (
                        b.change_assets.row(r),
                        b.change_sides.row(r),
                        b.change_prices.row(r),
                        b.change_sizes.row(r),
                    );
                    let n = ai.len().min(sc.len()).min(pr.len()).min(sz.len());
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
                        let price = Price::from_micros(decimal(&pr[i], diag, "price")?);
                        let size = Qty::from_micros(decimal(&sz[i], diag, "size")?);
                        tape.changes.push(LevelUpdate {
                            outcome,
                            side,
                            price,
                            size,
                        });
                    }
                    let end = tape.changes.len();
                    if end == start {
                        diag.skipped.empty_price_change += 1;
                        continue;
                    }
                    (RowKind::PriceChange, start, end)
                }
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
            let (kind, start, end) = kind;
            tape.rows.push(TapeRow {
                row: this_row,
                exchange_ts: TsMs(ex),
                local_ts: local.map(TsMs),
                kind,
                start: start as u32,
                end: end as u32,
            });
        }
    }
    Ok(tape)
}

/// Asset ids of a file in first-appearance order (test and tooling helper).
pub fn file_asset_ids(path: &Path) -> anyhow::Result<Vec<String>> {
    let reader = open(path)?;
    let mut b = Batch::new();
    let cols: [usize; 16] = std::array::from_fn(|i| i);
    let mut out: Vec<String> = Vec::new();
    for g in 0..reader.num_row_groups() {
        let rg = reader.get_row_group(g)?;
        let rows = rg.metadata().num_rows() as usize;
        b.read(rg.as_ref(), &cols, rows)?;
        for r in 0..rows {
            for col in [&b.asset0, &b.asset1] {
                if let Some(s) = col.get(r).and_then(utf8).map(str::trim) {
                    if !s.is_empty() && !out.iter().any(|o| o == s) {
                        out.push(s.to_string());
                    }
                }
            }
        }
        if out.len() >= 2 {
            break;
        }
    }
    Ok(out)
}
