//! telonex-delta reader, format version 1 (15 §4).
//!
//! A converted Telonex file is decoded column-wise, one row group at a time
//! ([`TelonexReader::decode_next`], the decode unit of 15 I-3 and 16 DC-4).
//! Both consumption forms of 15 I-4 are built on that one step:
//!
//! - streaming: the caller clears one [`EventBatch`] per row group, so memory
//!   stays bounded by the whole-file buffer (16 DC-1) plus one row group;
//! - tape: [`read_telonex_delta`] appends every row group to one batch and
//!   returns an immutable [`TelonexTape`] (shared through `Arc` by candidate
//!   groups, 41).
//!
//! Kept rows are packed [`TapeRow`]s (32 B, 16 §7.3) over one arena of book
//! levels and one of price changes, so the loop borrows payloads and
//! allocates nothing per row (12 E4, 16 §7).

use crate::error::{ErrorClass, InputError};
use crate::integrity::{self, InputFile};
use crate::pq::{open, Column};
use parquet::basic::{ConvertedType, LogicalType, Repetition, Type as PhysicalType};
use parquet::data_type::{ByteArray, ByteArrayType, Int32Type, Int64Type};
use parquet::file::metadata::{FileMetaData, ParquetMetaData};
use parquet::file::reader::{ChunkReader, FileReader, SerializedFileReader};
use pmb_core::fixed::parse_decimal;
use pmb_core::{
    LevelUpdate, MarketEvent, Outcome, Price, PriceSize, Qty, QuoteSide, TimedMarketEvent, TsMs,
};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

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

/// Largest price (1.0 USDC in micros, 10 §2 `Price` valid range).
pub const PRICE_MAX_MICROS: i64 = 1_000_000;
/// Largest level size magnitude accepted from a file: 1e9 shares in micros.
/// D-PENDING: 15 I-20 makes values outside the fixed-point range decode
/// failures and 10 T3 rejects input values at parsing so book arithmetic
/// cannot overflow, but no clause gives a size bound. 1e9 shares is about
/// 800 times the largest level seen in a 1/60 sample of the BTC 15m set
/// (1.26e6 shares, 2026-10-09) and keeps any sum of up to 9,223 levels in
/// `i64`.
pub const MAX_LEVEL_SIZE_MICROS: i64 = 1_000_000_000_000_000;
/// Ladder unit of the book (0.0001, 16 BK-1); other prices are off-grid.
const GRID_MICROS: i64 = pmb_book::LADDER_STEP;

/// Reader inputs taken from the job besides the file itself (21 §5).
#[derive(Copy, Clone, Debug)]
pub struct TelonexInput<'a> {
    /// Token ids of UP and DOWN (`marketResolution.tokenMap`, 10 M2).
    pub tokens: [&'a str; 2],
    /// Condition id when the job carries one (I-18).
    pub condition_id: Option<&'a str>,
}

/// Kind of a kept row.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Kind {
    Book,
    PriceChange,
}

/// One kept row (I-19: exactly one real tick), packed to the 32-byte event
/// record of 16 §7.3: both clocks, the file row, the arena range and the
/// per-side counts (`u16`, as in the 16 §7.3 layout).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct TapeRow {
    exchange_ts: TsMs,
    /// `ts_local_ms`, `0` when the row has none (`<= 0`, I-21).
    local_ts: i64,
    /// Row index in the file, counting every row (also skipped ones).
    row: u32,
    /// First arena entry of the row.
    first: u32,
    kind: Kind,
    /// Outcome of a `book` row (unused for `price_change`).
    outcome: Outcome,
    /// `book`: bids; `price_change`: changes.
    n0: u16,
    /// `book`: asks; `price_change`: 0.
    n1: u16,
}

const _: () = assert!(std::mem::size_of::<TapeRow>() == 32);

impl TapeRow {
    #[inline]
    pub fn row(&self) -> u32 {
        self.row
    }

    #[inline]
    pub fn exchange_ts(&self) -> TsMs {
        self.exchange_ts
    }

    #[inline]
    pub fn local_ts(&self) -> Option<TsMs> {
        (self.local_ts > 0).then_some(TsMs(self.local_ts))
    }

    #[inline]
    fn range(&self) -> std::ops::Range<usize> {
        let s = self.first as usize;
        s..s + self.n0 as usize + self.n1 as usize
    }
}

/// Kept rows of one or more row groups plus their payload arenas: one row
/// group in the streaming form, the whole file in the tape form (15 I-4).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EventBatch {
    rows: Vec<TapeRow>,
    book_levels: Vec<PriceSize>,
    changes: Vec<LevelUpdate>,
}

impl EventBatch {
    /// Kept rows (= real ticks).
    #[inline]
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// Empties the batch, keeping its capacity (streaming form).
    pub fn clear(&mut self) {
        self.rows.clear();
        self.book_levels.clear();
        self.changes.clear();
    }

    #[inline]
    pub fn rows(&self) -> &[TapeRow] {
        &self.rows
    }

    /// The event of kept row `i`, borrowing the arena.
    #[inline]
    pub fn event(&self, i: usize) -> TimedMarketEvent<'_> {
        let r = &self.rows[i];
        TimedMarketEvent {
            row: r.row,
            exchange_ts: r.exchange_ts,
            local_ts: r.local_ts(),
            event: self.payload(r),
        }
    }

    #[inline]
    fn payload(&self, r: &TapeRow) -> MarketEvent<'_> {
        let range = r.range();
        match r.kind {
            Kind::Book => {
                let mid = range.start + r.n0 as usize;
                MarketEvent::Book {
                    outcome: r.outcome,
                    bids: &self.book_levels[range.start..mid],
                    asks: &self.book_levels[mid..range.end],
                }
            }
            Kind::PriceChange => MarketEvent::PriceChange {
                changes: &self.changes[range],
            },
        }
    }

    /// All events in replay order (I-15).
    pub fn events(&self) -> impl Iterator<Item = TimedMarketEvent<'_>> + '_ {
        (0..self.rows.len()).map(move |i| self.event(i))
    }
}

/// Row-skip reasons (I-16), counted as `skippedRows` by reason (15 §8).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct SkippedRows {
    pub blank_market: u64,
    pub no_exchange_ts: u64,
    pub other_event_type: u64,
    /// `book` rows whose `asset_index` is null or does not resolve.
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
    /// `raggedRows`: kept rows whose parallel lists (book prices and sizes
    /// of a side, or the four change lists) differ in length. The levels
    /// beyond the shortest list are not replayed, as in TS
    /// (`replayTelonexDeltaParquetForMarket.ts:79-81,118`).
    /// D-PENDING: 15 §8 has no row for this anomaly.
    pub ragged_rows: u64,
    /// `offGridPrices`: replayed prices that are not a multiple of the
    /// 0.0001 ladder unit (16 §7.3; kept in the book's overflow table).
    /// D-PENDING: 15 §8 has no row for this anomaly.
    pub off_grid_prices: u64,
}

/// What the reader knows about the file besides its events (16 §7.3 meta).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TelonexMeta {
    pub diagnostics: TelonexDiagnostics,
    /// The constant `market` column (condition id) of the file, as stored.
    pub market: String,
    /// Size of the file read, in bytes (= the job's `input.bytes`, I-8).
    pub file_bytes: u64,
    /// The job carried a sha256 and the file matched it (I-8).
    pub sha256_verified: bool,
    /// Token ids of UP and DOWN, as the job maps them (I-2).
    pub outcome_map: [String; 2],
    pub row_groups: usize,
}

/// Decoded, immutable telonex-delta market (15 I-4 tape form).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TelonexTape {
    pub events: EventBatch,
    pub meta: TelonexMeta,
}

impl TelonexTape {
    #[inline]
    pub fn len(&self) -> usize {
        self.events.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    #[inline]
    pub fn event(&self, i: usize) -> TimedMarketEvent<'_> {
        self.events.event(i)
    }

    /// All events in replay order (I-15).
    pub fn events(&self) -> impl Iterator<Item = TimedMarketEvent<'_>> + '_ {
        self.events.events()
    }

    #[inline]
    pub fn diagnostics(&self) -> &TelonexDiagnostics {
        &self.meta.diagnostics
    }
}

fn defect(cause: &'static str, detail: impl Into<String>) -> InputError {
    InputError::new(ErrorClass::DataDefect, cause, detail)
}

/// Blank as the TS oracle's `trim() === ''` sees it (15 I-16, I-17; R3
/// names Telonex row decode an oracle area): every code point is ECMAScript
/// WhiteSpace or LineTerminator, i.e. Unicode `White_Space` except U+0085,
/// plus U+FEFF.
fn is_blank(s: &str) -> bool {
    s.chars()
        .all(|c| c == '\u{FEFF}' || (c.is_whitespace() && c != '\u{0085}'))
}

/// Checks the job's format, the footer keys and the version-1 schema
/// fingerprint (I-11–I-13). Every failure is `data_defect: format_version`.
///
/// - The job MUST state `telonex-delta-typed` version 1 (the only format
///   this reader reads, I-13).
/// - Footer keys: both absent (today's converter), or both present with
///   `pmb_format = telonex-delta-typed` and `pmb_format_version = 1`.
///   D-PENDING: a footer with only one of the two keys identifies no
///   version and is refused.
/// - The schema MUST be the v1 fingerprint in every case: 16 top-level
///   primitive columns with the v1 names, order, physical types, repetition
///   and annotations (`UTF8` on byte arrays, none on integers).
fn check_format(
    meta: &FileMetaData,
    job: integrity::InputFormat<'_>,
    path: &Path,
) -> Result<[usize; 16], InputError> {
    let fail = |detail: String| defect("format_version", format!("{}: {detail}", path.display()));
    if job.name != FORMAT_NAME || job.version != FORMAT_VERSION {
        return Err(fail(format!(
            "job format {:?} version {} is not supported by this reader ({FORMAT_NAME} version {FORMAT_VERSION})",
            job.name, job.version
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

/// Text of a panic payload raised inside the Parquet decoder.
fn panic_text(p: &(dyn std::any::Any + Send)) -> String {
    p.downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| p.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "non-text panic payload".into())
}

/// Maps the row's own asset columns to outcomes (I-17, I-18). The last value
/// of each column is cached, so a distinct id is resolved (UTF-8, blank and
/// token checks) once per run of equal values and the common row costs one
/// byte compare per column. A blank or null column does not resolve; any
/// other value MUST equal one of the job's tokens exactly (TS keys books by
/// the untrimmed id), else the file is foreign.
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
        // D-PENDING (PARITY): parquetjs decodes invalid UTF-8 with U+FFFD
        // replacement; this reader refuses it as a decode failure.
        let s = std::str::from_utf8(bytes).map_err(|_| de.err("asset id is not UTF-8"))?;
        let outcome = if is_blank(s) {
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

/// Parses one decimal string into micros (I-20), counting `inexact_decimal`.
#[inline]
fn decimal(
    b: &ByteArray,
    diag: &mut TelonexDiagnostics,
    what: &str,
    de: DecodeErr,
) -> Result<i64, InputError> {
    let s = std::str::from_utf8(b.data()).map_err(|_| de.err(format!("{what}: not UTF-8")))?;
    let d = parse_decimal(s).map_err(|e| de.err(format!("{what} {s:?}: {e}")))?;
    if d.inexact {
        diag.inexact_decimal += 1;
    }
    Ok(d.micros)
}

/// A level price: inside `0..=1` (10 §2; outside is a decode failure, I-20),
/// counted as `offGridPrices` when not on the 0.0001 grid.
#[inline]
fn parse_price(
    b: &ByteArray,
    diag: &mut TelonexDiagnostics,
    de: DecodeErr,
) -> Result<Price, InputError> {
    let m = decimal(b, diag, "price", de)?;
    if !(0..=PRICE_MAX_MICROS).contains(&m) {
        return Err(de.err(format!(
            "price {:?} is outside 0..=1",
            String::from_utf8_lossy(b.data())
        )));
    }
    if m % GRID_MICROS != 0 {
        diag.off_grid_prices += 1;
    }
    Ok(Price::from_micros(m))
}

/// A level size: magnitude at most [`MAX_LEVEL_SIZE_MICROS`] (I-20, 10 T3).
#[inline]
fn parse_size(
    b: &ByteArray,
    diag: &mut TelonexDiagnostics,
    de: DecodeErr,
) -> Result<Qty, InputError> {
    let m = decimal(b, diag, "size", de)?;
    if m.unsigned_abs() > MAX_LEVEL_SIZE_MICROS as u64 {
        return Err(de.err(format!(
            "size {:?} is beyond the 1e9-share level bound",
            String::from_utf8_lossy(b.data())
        )));
    }
    Ok(Qty::from_micros(m))
}

/// Payload of the last kept row of the previous row group, for
/// `duplicateRows` across row-group boundaries.
#[derive(Clone, Debug, Default)]
struct SavedRow {
    row: Option<TapeRow>,
    book_levels: Vec<PriceSize>,
    changes: Vec<LevelUpdate>,
}

/// Reader state carried from one row group to the next.
#[derive(Default)]
struct Carry {
    row_index: u32,
    last_ex: Option<i64>,
    last_local: Option<i64>,
    last_seq: Option<i64>,
    market_raw: Option<Vec<u8>>,
    prev: SavedRow,
}

/// telonex-delta v1 reader over one verified file (15 §4). Decodes one row
/// group per [`decode_next`](Self::decode_next) call. `Send`, so a
/// scheduler may run it on another thread and decode ahead (15 I-3).
pub struct TelonexReader<'a> {
    path: PathBuf,
    reader: Box<dyn FileReader>,
    cols: [usize; 16],
    next_group: usize,
    batch: Batch,
    assets: AssetMap<'a>,
    condition_id: Option<&'a str>,
    de: DecodeErr,
    carry: Carry,
    meta: TelonexMeta,
    /// A failed reader returns the same error from every later call.
    failed: Option<InputError>,
}

const _: fn() = || {
    fn send<T: Send>() {}
    send::<TelonexReader<'static>>();
};

/// Validates every column chunk's byte range against the file length before
/// any page is read, so a corrupt footer is a decode failure instead of a
/// slice panic inside the Parquet crate (15 I-V3).
fn check_chunk_ranges(meta: &ParquetMetaData, len: u64) -> Result<u64, String> {
    let mut rows: u64 = 0;
    for (g, rg) in meta.row_groups().iter().enumerate() {
        let n = u64::try_from(rg.num_rows())
            .map_err(|_| format!("row group {g}: negative row count"))?;
        rows = rows
            .checked_add(n)
            .ok_or_else(|| format!("row group {g}: row count overflow"))?;
        for (c, col) in rg.columns().iter().enumerate() {
            let start = match col.dictionary_page_offset() {
                Some(d) => d.min(col.data_page_offset()),
                None => col.data_page_offset(),
            };
            let size = col.compressed_size();
            let ok = start >= 0
                && size >= 0
                && (start as u64)
                    .checked_add(size as u64)
                    .is_some_and(|end| end <= len);
            if !ok {
                return Err(format!(
                    "row group {g} column {c}: byte range {start}+{size} outside the {len}-byte file"
                ));
            }
        }
    }
    Ok(rows)
}

impl<'a> TelonexReader<'a> {
    /// Verifies the job's file (I-3, I-8, I-9), parses the footer and checks
    /// the format (I-11–I-13). No row is decoded yet.
    pub fn open(file: &InputFile<'_>, input: TelonexInput<'a>) -> Result<Self, InputError> {
        let path = file.path;
        let opened = integrity::open(file)?;
        let buf = opened
            .file
            .get_bytes(0, opened.len)
            .map_err(|e| integrity::io_error(path, &e))?;
        let verified = opened.verify_sha256(path, &buf)?;
        let de = DecodeErr { verified };
        let len = buf.len() as u64;
        let reader = match catch_unwind(AssertUnwindSafe(|| SerializedFileReader::new(buf))) {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => return Err(de.err(format!("{}: parquet footer: {e}", path.display()))),
            Err(p) => {
                return Err(de.err(format!(
                    "{}: parquet footer: decoder panic: {}",
                    path.display(),
                    panic_text(p.as_ref())
                )))
            }
        };
        let rows = check_chunk_ranges(reader.metadata(), len)
            .map_err(|e| de.err(format!("{}: {e}", path.display())))?;
        if rows > u64::from(u32::MAX) {
            return Err(de.err(format!(
                "{}: {rows} rows exceed the u32 row index",
                path.display()
            )));
        }
        let cols = check_format(reader.metadata().file_metadata(), file.format, path)?;
        let meta = TelonexMeta {
            file_bytes: file.bytes,
            sha256_verified: verified,
            outcome_map: input.tokens.map(str::to_string),
            row_groups: reader.num_row_groups(),
            ..TelonexMeta::default()
        };
        Ok(TelonexReader {
            path: path.to_path_buf(),
            reader: Box::new(reader),
            cols,
            next_group: 0,
            batch: Batch::new(),
            assets: AssetMap::new(input.tokens),
            condition_id: input.condition_id,
            de,
            carry: Carry::default(),
            meta,
            failed: None,
        })
    }

    /// Number of row groups (decode units) of the file.
    pub fn num_row_groups(&self) -> usize {
        self.meta.row_groups
    }

    /// File facts and the counters of the row groups decoded so far.
    pub fn meta(&self) -> &TelonexMeta {
        &self.meta
    }

    pub fn into_meta(self) -> TelonexMeta {
        self.meta
    }

    /// Decodes the next row group and appends its kept rows to `out`
    /// (15 I-3 decode unit). Returns `Ok(false)` once every row group was
    /// decoded. A failure is final: later calls return the same error.
    pub fn decode_next(&mut self, out: &mut EventBatch) -> Result<bool, InputError> {
        if let Some(e) = &self.failed {
            return Err(e.clone());
        }
        if self.next_group >= self.meta.row_groups {
            return Ok(false);
        }
        let g = self.next_group;
        self.next_group += 1;
        let res = match catch_unwind(AssertUnwindSafe(|| self.decode_group(g, out))) {
            Ok(r) => r,
            Err(p) => Err(self.de.err(format!(
                "{}: row group {g}: decoder panic: {}",
                self.path.display(),
                panic_text(p.as_ref())
            ))),
        };
        match res {
            Ok(()) => Ok(true),
            Err(e) => {
                self.failed = Some(e.clone());
                Err(e)
            }
        }
    }

    fn decode_group(&mut self, g: usize, out: &mut EventBatch) -> Result<(), InputError> {
        let path = &self.path;
        let de = self.de;
        let decode_err = |e: anyhow::Error| de.err(format!("{}: {e:#}", path.display()));
        let rg = self
            .reader
            .get_row_group(g)
            .map_err(|e| decode_err(e.into()))?;
        let rows = rg.metadata().num_rows() as usize;
        self.batch
            .read(rg.as_ref(), &self.cols, rows)
            .map_err(decode_err)?;
        let b = &self.batch;
        let c = &mut self.carry;
        let diag = &mut self.meta.diagnostics;
        let group_first = out.rows.len();
        for r in 0..rows {
            let this_row = c.row_index;
            c.row_index += 1;
            diag.rows_read += 1;

            if let Some(&seq) = b.ingest_seq.get(r) {
                if c.last_seq.is_some_and(|l| seq <= l) {
                    diag.ingest_seq_backwards += 1;
                }
                c.last_seq = Some(seq);
            }
            // I-18: every asset id of the file is one of the job's tokens,
            // also on rows that I-16 skips.
            let a0 = self.assets.resolve(0, b.asset0.get(r), de)?;
            let a1 = self.assets.resolve(1, b.asset1.get(r), de)?;

            // I-18: the market column is constant on every non-blank row,
            // also on rows that I-16 skips for other reasons (TS checks only
            // kept rows; classified with the foreign-asset case, PARITY).
            let market = b.market.get(r).map(ByteArray::data).unwrap_or(b"");
            match &c.market_raw {
                Some(m) if m.as_slice() == market => {}
                known => {
                    // D-PENDING (PARITY): invalid UTF-8 is refused here;
                    // parquetjs decodes it with U+FFFD replacement.
                    let text = std::str::from_utf8(market)
                        .map_err(|_| de.err(format!("{}: market is not UTF-8", path.display())))?;
                    if is_blank(text) {
                        diag.skipped.blank_market += 1;
                        continue;
                    }
                    if let Some(m) = known {
                        return Err(defect(
                            "foreign_file",
                            format!(
                                "{}: market column changes: {:?} then {text:?}",
                                path.display(),
                                String::from_utf8_lossy(m),
                            ),
                        ));
                    }
                    if let Some(cid) = self.condition_id {
                        if !cid.eq_ignore_ascii_case(text) {
                            return Err(defect(
                                "foreign_file",
                                format!(
                                    "{}: file market {text:?} != job condition id {cid}",
                                    path.display()
                                ),
                            ));
                        }
                    }
                    self.meta.market = text.to_string();
                    c.market_raw = Some(market.to_vec());
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
            let too_deep = |n: usize| {
                de.err(format!(
                    "{}: row {this_row}: {n} levels in one list exceed the u16 count of the tape layout (16 §7.3)",
                    path.display()
                ))
            };
            let row = match b.event_type.get(r).map(ByteArray::data) {
                Some(b"book") => {
                    // A null `asset_index` does not resolve (I-16). TS reads
                    // it as index 0 (`Number(null)`); PARITY, golden
                    // `skip_rows`.
                    let Some(outcome) = b.asset_index.get(r).and_then(|&i| by_index(i)) else {
                        diag.skipped.unresolved_book_asset += 1;
                        continue;
                    };
                    let first = out.book_levels.len();
                    let mut counts = [0u16; 2];
                    let mut ragged = false;
                    for (k, (prices, sizes)) in
                        [(&b.bid_prices, &b.bid_sizes), (&b.ask_prices, &b.ask_sizes)]
                            .into_iter()
                            .enumerate()
                    {
                        let (ps, ss) = (prices.row(r), sizes.row(r));
                        ragged |= ps.len() != ss.len();
                        let n = ps.len().min(ss.len());
                        counts[k] = u16::try_from(n).map_err(|_| too_deep(n))?;
                        for (p, s) in ps.iter().zip(ss) {
                            let price = parse_price(p, diag, de)?;
                            let size = parse_size(s, diag, de)?;
                            out.book_levels.push(PriceSize { price, size });
                        }
                    }
                    if ragged {
                        diag.ragged_rows += 1;
                    }
                    TapeRow {
                        exchange_ts: TsMs(ex),
                        local_ts: local.unwrap_or(0),
                        row: this_row,
                        first: first as u32,
                        kind: Kind::Book,
                        outcome,
                        n0: counts[0],
                        n1: counts[1],
                    }
                }
                Some(b"price_change") => {
                    let first = out.changes.len();
                    let (ai, sc, pr, sz) = (
                        b.change_assets.row(r),
                        b.change_sides.row(r),
                        b.change_prices.row(r),
                        b.change_sizes.row(r),
                    );
                    let n = ai.len().min(sc.len()).min(pr.len()).min(sz.len());
                    let ragged = [sc.len(), pr.len(), sz.len()]
                        .iter()
                        .any(|&l| l != ai.len());
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
                        let price = parse_price(&pr[i], diag, de)?;
                        let size = parse_size(&sz[i], diag, de)?;
                        out.changes.push(LevelUpdate {
                            outcome,
                            side,
                            price,
                            size,
                        });
                    }
                    let kept = out.changes.len() - first;
                    if kept == 0 {
                        diag.skipped.empty_price_change += 1;
                        continue;
                    }
                    if ragged {
                        diag.ragged_rows += 1;
                    }
                    TapeRow {
                        exchange_ts: TsMs(ex),
                        local_ts: local.unwrap_or(0),
                        row: this_row,
                        first: first as u32,
                        kind: Kind::PriceChange,
                        outcome: Outcome::Up,
                        n0: u16::try_from(kept).map_err(|_| too_deep(kept))?,
                        n1: 0,
                    }
                }
                _ => {
                    diag.skipped.other_event_type += 1;
                    continue;
                }
            };
            if c.last_ex.is_some_and(|l| ex < l) {
                diag.exchange_clock_backwards += 1;
            }
            c.last_ex = Some(ex);
            if let Some(l) = local {
                if l < ex {
                    diag.local_behind_exchange += 1;
                }
                if c.last_local.is_some_and(|p| l < p) {
                    diag.local_clock_backwards += 1;
                }
                c.last_local = Some(l);
            }
            // D-PENDING: "identical consecutive rows" (15 §8) compares
            // consecutive kept rows, not file rows, and ignores ingest_seq.
            let duplicate = match out.rows.last() {
                Some(p) if out.rows.len() > group_first => same_row(out, p, out, &row),
                _ => c
                    .prev
                    .row
                    .is_some_and(|p| same_saved(&c.prev, &p, out, &row)),
            };
            if duplicate {
                diag.duplicate_rows += 1;
            }
            out.rows.push(row);
        }
        // Keep the last kept row of this group for the next group's
        // duplicate check (the caller may clear `out`).
        if out.rows.len() > group_first {
            let last = *out.rows.last().expect("non-empty");
            let prev = &mut c.prev;
            prev.book_levels.clear();
            prev.changes.clear();
            let range = last.range();
            let saved = match last.kind {
                Kind::Book => {
                    prev.book_levels.extend_from_slice(&out.book_levels[range]);
                    TapeRow { first: 0, ..last }
                }
                Kind::PriceChange => {
                    prev.changes.extend_from_slice(&out.changes[range]);
                    TapeRow { first: 0, ..last }
                }
            };
            prev.row = Some(saved);
        }
        Ok(())
    }
}

/// Same clocks, kind, outcome and payload (`duplicateRows`, 15 §8).
fn same_header(a: &TapeRow, b: &TapeRow) -> bool {
    a.exchange_ts == b.exchange_ts
        && a.local_ts == b.local_ts
        && a.kind == b.kind
        && (a.kind == Kind::PriceChange || a.outcome == b.outcome)
        && a.n0 == b.n0
        && a.n1 == b.n1
}

fn same_row(xa: &EventBatch, a: &TapeRow, xb: &EventBatch, b: &TapeRow) -> bool {
    same_header(a, b)
        && match a.kind {
            Kind::Book => xa.book_levels[a.range()] == xb.book_levels[b.range()],
            Kind::PriceChange => xa.changes[a.range()] == xb.changes[b.range()],
        }
}

fn same_saved(s: &SavedRow, a: &TapeRow, xb: &EventBatch, b: &TapeRow) -> bool {
    same_header(a, b)
        && match a.kind {
            Kind::Book => s.book_levels[..] == xb.book_levels[b.range()],
            Kind::PriceChange => s.changes[..] == xb.changes[b.range()],
        }
}

/// Reads a whole telonex-delta file into an immutable tape (15 I-4 tape
/// form): every row group of [`TelonexReader`] appended to one batch.
pub fn read_telonex_delta(
    file: &InputFile<'_>,
    input: TelonexInput<'_>,
) -> Result<TelonexTape, InputError> {
    let mut reader = TelonexReader::open(file, input)?;
    let mut events = EventBatch::default();
    while reader.decode_next(&mut events)? {}
    Ok(TelonexTape {
        events,
        meta: reader.into_meta(),
    })
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
                if let Some(s) = col.get(r).and_then(|v| std::str::from_utf8(v.data()).ok()) {
                    if !is_blank(s) && !out.iter().any(|o| o == s) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_matches_ecmascript_trim() {
        // JS: ["\u000B","﻿","\u0085"," "," ","　",""]
        //       .map(s => s.trim() === '') → [true,true,false,true,true,true,true]
        let cases = [
            ("\u{000B}", true),
            ("\u{FEFF}", true),
            ("\u{0085}", false),
            (" ", true),
            ("\u{00A0}", true),
            ("\u{3000}", true),
            ("\u{2028}\t\r\n", true),
            ("", true),
            (" x ", false),
        ];
        for (s, blank) in cases {
            assert_eq!(is_blank(s), blank, "{s:?}");
        }
    }
}
