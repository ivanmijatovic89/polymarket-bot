//! telonex-delta reader, format version 1 (15 §4).
//!
//! Decodes a converted Telonex file column-wise into an immutable
//! [`TelonexTape`]: kept rows in file order plus one arena of levels, so the
//! loop borrows payloads and allocates nothing per row (12 E4, 16 §7).

use crate::error::{ErrorClass, InputError};
use crate::pq::{open, whole_file, Column};
use parquet::basic::{ConvertedType, LogicalType, Repetition, Type as PhysicalType};
use parquet::data_type::{ByteArray, ByteArrayType, Int32Type, Int64Type};
use parquet::file::metadata::FileMetaData;
use parquet::file::reader::{FileReader, SerializedFileReader};
use pmb_core::fixed::parse_decimal;
use pmb_core::{
    LevelUpdate, MarketEvent, Outcome, Price, PriceSize, Qty, QuoteSide, TimedMarketEvent, TsMs,
};
use std::fs::File;
use std::path::Path;

/// Format name carried by jobs and footers (15 I-12, I-13).
pub const FORMAT_NAME: &str = "telonex-delta-typed";
/// The only supported format version.
pub const FORMAT_VERSION: u32 = 1;
/// Footer key naming the format (15 I-12).
pub const FOOTER_FORMAT_KEY: &str = "pmb_format";
/// Footer key carrying the format version (15 I-12).
pub const FOOTER_VERSION_KEY: &str = "pmb_format_version";

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

/// Integrity facts the binary checks before replay (15 I-8).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct InputCheck {
    /// The job's `input.bytes`; a different file size is
    /// `data_defect: integrity_mismatch`.
    pub bytes: Option<u64>,
    /// The file's sha256 was verified against the job: decode failures are
    /// then `data_defect: corrupt` instead of `runtime: decode_unverified`.
    pub sha256_verified: bool,
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
    /// `duplicateRows`: a kept row identical to the previous kept row
    /// (both timestamps, kind, outcome and every level; `ingest_seq` is
    /// not compared). Replayed as-is (15 §8).
    pub duplicate_rows: u64,
}

/// Decoded, immutable telonex-delta market (15 I-4 tape form).
#[derive(Clone, Debug, Default)]
pub struct TelonexTape {
    pub rows: Vec<TapeRow>,
    book_levels: Vec<PriceSize>,
    changes: Vec<LevelUpdate>,
    /// The constant `market` column (condition id) of the file, as stored.
    pub market: String,
    pub diagnostics: TelonexDiagnostics,
    /// Size of the file read, in bytes.
    pub file_bytes: u64,
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

/// Checks the job's format version, the footer keys and the version-1
/// schema fingerprint (I-11–I-13). Every failure is
/// `data_defect: format_version`.
///
/// - The job MUST state version 1 (the only version this engine reads).
/// - Footer keys: both absent (today's converter), or both present with
///   `pmb_format = telonex-delta-typed` and `pmb_format_version = 1`.
///   D-PENDING: a footer with only one of the two keys identifies no
///   version and is refused.
/// - The schema MUST be the v1 fingerprint in every case: 16 top-level
///   primitive columns with the v1 names, order, physical types, repetition
///   and annotations (`UTF8` on byte arrays, none on integers).
fn check_format(
    meta: &FileMetaData,
    job_version: u32,
    path: &Path,
) -> Result<[usize; 16], InputError> {
    let fail = |detail: String| defect("format_version", format!("{}: {detail}", path.display()));
    if job_version != FORMAT_VERSION {
        return Err(fail(format!(
            "job format version {job_version} is not supported (this engine reads {FORMAT_NAME} version {FORMAT_VERSION})"
        )));
    }
    let get = |k: &str| {
        meta.key_value_metadata()
            .and_then(|kv| kv.iter().find(|e| e.key == k))
            .map(|e| e.value.as_deref().unwrap_or(""))
    };
    match (get(FOOTER_FORMAT_KEY), get(FOOTER_VERSION_KEY)) {
        (None, None) => {}
        (Some(name), Some(version)) if name == FORMAT_NAME && version == "1" => {}
        (name, version) => {
            return Err(fail(format!(
                "footer declares format {name:?} version {version:?}; this engine reads {FORMAT_NAME} version {FORMAT_VERSION}"
            )))
        }
    }
    let schema = meta.schema_descr();
    let fields = schema.root_schema().get_fields();
    if fields.len() != V1_COLUMNS.len() || schema.num_columns() != V1_COLUMNS.len() {
        return Err(fail(format!(
            "{} fields / {} columns, the v1 fingerprint has 16",
            fields.len(),
            schema.num_columns()
        )));
    }
    let mut idx = [0usize; 16];
    for (i, (name, ty, rep)) in V1_COLUMNS.iter().enumerate() {
        let c = schema.column(i);
        let field = &fields[i];
        let info = field.get_basic_info();
        let annotation_ok = if *ty == PhysicalType::BYTE_ARRAY {
            c.converted_type() == ConvertedType::UTF8
                && matches!(c.logical_type(), None | Some(LogicalType::String))
        } else {
            c.converted_type() == ConvertedType::NONE && c.logical_type().is_none()
        };
        let ok = field.is_primitive()
            && c.path().parts().len() == 1
            && c.path().string() == *name
            && c.physical_type() == *ty
            && info.has_repetition()
            && info.repetition() == *rep
            && annotation_ok;
        if !ok {
            return Err(fail(format!(
                "column {i} is `{}` {:?} {:?} {:?}, v1 expects `{name}` {ty:?} {rep:?}{}",
                c.path().string(),
                c.physical_type(),
                if info.has_repetition() {
                    Some(info.repetition())
                } else {
                    None
                },
                c.converted_type(),
                if *ty == PhysicalType::BYTE_ARRAY {
                    " UTF8"
                } else {
                    ""
                },
            )));
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

/// Class of a decode failure (15 I-8, 20 §4): `runtime: decode_unverified`
/// while the file's sha256 is unknown, `data_defect: corrupt` once verified.
#[derive(Copy, Clone)]
struct DecodeErr {
    verified: bool,
}

impl DecodeErr {
    fn err(self, detail: impl Into<String>) -> InputError {
        if self.verified {
            InputError::new(ErrorClass::DataDefect, "corrupt", detail)
        } else {
            InputError::new(ErrorClass::Runtime, "decode_unverified", detail)
        }
    }
}

/// Maps the row's own asset columns to outcomes (I-17, I-18), caching the
/// last value per column so the common case is one byte compare per column
/// and row. A blank (or whitespace-only) or null column does not resolve;
/// any other value MUST equal one of the job's tokens exactly (TS keys
/// books by the untrimmed id), else the file is foreign.
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
        de: DecodeErr,
    ) -> Result<Option<Outcome>, InputError> {
        let Some(raw) = raw else { return Ok(None) };
        let bytes = raw.data();
        if self.cache[slot].0 == bytes {
            return Ok(self.cache[slot].1);
        }
        let s = std::str::from_utf8(bytes).map_err(|_| de.err("asset id is not UTF-8"))?;
        let outcome = if s.trim().is_empty() {
            None
        } else if s == self.tokens[0] {
            Some(Outcome::Up)
        } else if s == self.tokens[1] {
            Some(Outcome::Down)
        } else {
            return Err(defect(
                "foreign_file",
                format!("asset id {s:?} is not one of the job's tokens"),
            ));
        };
        self.cache[slot] = (bytes.to_vec(), outcome);
        Ok(outcome)
    }
}

fn decimal(
    b: &ByteArray,
    diag: &mut TelonexDiagnostics,
    what: &str,
    de: DecodeErr,
) -> Result<i64, InputError> {
    let s = utf8(b).ok_or_else(|| de.err(format!("{what}: not UTF-8")))?;
    let d = parse_decimal(s).map_err(|e| de.err(format!("{what} {s:?}: {e}")))?;
    if d.inexact {
        diag.inexact_decimal += 1;
    }
    Ok(d.micros)
}

/// Reads a whole telonex-delta file into a tape (15 §4) without integrity
/// facts (no size check; decode failures are `runtime: decode_unverified`).
pub fn read_telonex_delta(
    path: &Path,
    input: &TelonexInput<'_>,
) -> Result<TelonexTape, InputError> {
    read_telonex_delta_with(path, input, &InputCheck::default())
}

/// Previous kept row, for `duplicateRows`.
#[derive(Copy, Clone)]
struct Prev {
    ex: i64,
    local: Option<i64>,
    kind: RowKind,
    start: usize,
    end: usize,
}

/// Reads a whole telonex-delta file into a tape (15 §4), checking the
/// job's integrity facts first (I-8): the file is read with one whole-file
/// read (16 DC-1) and its size compared with `check.bytes`.
pub fn read_telonex_delta_with(
    path: &Path,
    input: &TelonexInput<'_>,
    check: &InputCheck,
) -> Result<TelonexTape, InputError> {
    if !path.is_absolute() {
        return Err(InputError::new(
            ErrorClass::InvalidInput,
            "path",
            format!("{} is not absolute", path.display()),
        ));
    }
    let io = |e: std::io::Error| {
        InputError::new(
            ErrorClass::Runtime,
            "io",
            format!("{}: {e}", path.display()),
        )
    };
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(InputError::new(
                ErrorClass::DataMissing,
                "input_missing",
                path.display().to_string(),
            ))
        }
        Err(e) => return Err(io(e)),
    };
    let file_bytes = file.metadata().map_err(io)?.len();
    if let Some(want) = check.bytes {
        if want != file_bytes {
            return Err(defect(
                "integrity_mismatch",
                format!(
                    "{}: {file_bytes} bytes, the job says {want}",
                    path.display()
                ),
            ));
        }
    }
    let de = DecodeErr {
        verified: check.sha256_verified,
    };
    let buf = whole_file(&file, file_bytes).map_err(|e| {
        InputError::new(
            ErrorClass::Runtime,
            "io",
            format!("{}: {e}", path.display()),
        )
    })?;
    let reader = SerializedFileReader::new(buf)
        .map_err(|e| de.err(format!("{}: parquet footer: {e}", path.display())))?;
    let cols = check_format(
        reader.metadata().file_metadata(),
        input.format_version,
        path,
    )?;
    let mut tape = TelonexTape {
        file_bytes,
        ..TelonexTape::default()
    };
    let mut assets = AssetMap::new(input.tokens);
    let mut b = Batch::new();
    let mut row_index: u32 = 0;
    let mut last_ex: Option<i64> = None;
    let mut last_local: Option<i64> = None;
    let mut last_seq: Option<i64> = None;
    let mut prev: Option<Prev> = None;
    let mut market_raw: Option<Vec<u8>> = None;
    let decode_err = |e: anyhow::Error| de.err(format!("{}: {e:#}", path.display()));

    for g in 0..reader.num_row_groups() {
        let rg = reader.get_row_group(g).map_err(|e| decode_err(e.into()))?;
        let rows = rg.metadata().num_rows() as usize;
        b.read(rg.as_ref(), &cols, rows).map_err(decode_err)?;
        for r in 0..rows {
            let this_row = row_index;
            row_index += 1;
            tape.diagnostics.rows_read += 1;

            if let Some(&seq) = b.ingest_seq.get(r) {
                if last_seq.is_some_and(|l| seq <= l) {
                    tape.diagnostics.ingest_seq_backwards += 1;
                }
                last_seq = Some(seq);
            }
            // I-18: every asset id of the file is one of the job's tokens,
            // also on rows that I-16 skips.
            let a0 = assets.resolve(0, b.asset0.get(r), de)?;
            let a1 = assets.resolve(1, b.asset1.get(r), de)?;
            let diag = &mut tape.diagnostics;

            let market = b.market.get(r).map(ByteArray::data).unwrap_or(b"");
            if market.trim_ascii().is_empty() {
                diag.skipped.blank_market += 1;
                continue;
            }
            match &market_raw {
                Some(m) if m.as_slice() == market => {}
                Some(m) => {
                    return Err(defect(
                        "foreign_file",
                        format!(
                            "market column changes: {:?} then {:?}",
                            String::from_utf8_lossy(m),
                            String::from_utf8_lossy(market)
                        ),
                    ))
                }
                None => {
                    let text =
                        std::str::from_utf8(market).map_err(|_| de.err("market is not UTF-8"))?;
                    if let Some(cid) = input.condition_id {
                        if !cid.eq_ignore_ascii_case(text) {
                            return Err(defect(
                                "foreign_file",
                                format!("file market {text:?} != job condition id {cid}"),
                            ));
                        }
                    }
                    tape.market = text.to_string();
                    market_raw = Some(market.to_vec());
                }
            }
            let ex = match b.ts_exchange.get(r) {
                Some(&t) if t >= 0 => t,
                _ => {
                    diag.skipped.no_exchange_ts += 1;
                    continue;
                }
            };
            let local = b.ts_local.get(r).copied().filter(|&t| t > 0);
            let by_index = |i: i32| -> Option<Outcome> {
                match i {
                    0 => a0,
                    1 => a1,
                    _ => None,
                }
            };
            let (kind, start, end) = match b.event_type.get(r).map(ByteArray::data) {
                Some(b"book") => {
                    // D-PENDING: a null `asset_index` on a book row reads as
                    // index 0, as the TS oracle does (`Number(null)`; I-V1
                    // golden `skip_rows`); the converter never writes one.
                    let index = b.asset_index.get(r).copied().unwrap_or(0);
                    let Some(outcome) = by_index(index) else {
                        diag.skipped.unresolved_book_asset += 1;
                        continue;
                    };
                    let start = tape.book_levels.len();
                    let mut bids = 0u32;
                    for (k, (prices, sizes)) in
                        [(&b.bid_prices, &b.bid_sizes), (&b.ask_prices, &b.ask_sizes)]
                            .into_iter()
                            .enumerate()
                    {
                        let (ps, ss) = (prices.row(r), sizes.row(r));
                        let n = ps.len().min(ss.len());
                        for i in 0..n {
                            let price = Price::from_micros(decimal(&ps[i], diag, "price", de)?);
                            let size = Qty::from_micros(decimal(&ss[i], diag, "size", de)?);
                            tape.book_levels.push(PriceSize { price, size });
                        }
                        if k == 0 {
                            bids = n as u32;
                        }
                    }
                    let end = tape.book_levels.len();
                    (RowKind::Book { outcome, bids }, start, end)
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
                        let price = Price::from_micros(decimal(&pr[i], diag, "price", de)?);
                        let size = Qty::from_micros(decimal(&sz[i], diag, "size", de)?);
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
            // D-PENDING: "identical consecutive rows" (15 §8) compares
            // consecutive kept rows, not file rows, and ignores ingest_seq.
            let this = Prev {
                ex,
                local,
                kind,
                start,
                end,
            };
            if prev.is_some_and(|p| tape.same_payload(&p, &this)) {
                tape.diagnostics.duplicate_rows += 1;
            }
            prev = Some(this);
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

impl TelonexTape {
    fn same_payload(&self, a: &Prev, b: &Prev) -> bool {
        a.ex == b.ex
            && a.local == b.local
            && a.kind == b.kind
            && match a.kind {
                RowKind::Book { .. } => {
                    self.book_levels[a.start..a.end] == self.book_levels[b.start..b.end]
                }
                RowKind::PriceChange => {
                    self.changes[a.start..a.end] == self.changes[b.start..b.end]
                }
            }
    }
}

/// Asset ids of a file in first-appearance order, as stored (test and
/// tooling helper; blank ids are skipped).
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
                if let Some(s) = col.get(r).and_then(utf8) {
                    if !s.trim().is_empty() && !out.iter().any(|o| o == s) {
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
