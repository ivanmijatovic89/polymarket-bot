//! Version-1 telonex-delta Parquet → [`TypedRows`] (15 §4.1, 16 NT-2).
//!
//! This is the adapter pmb-tape needs until pmb-replay exposes its typed-row
//! layer: the column reading mirrors `pmb_replay`'s `pq.rs` and the schema
//! check mirrors its `check_format` (I-12). Only the converter calls it; the
//! engine's v1 path stays `pmb_replay::read_telonex_delta`.

use crate::typed::{
    dec, event_type, int, row_flags, DictBuilder, TypedRows, Unconvertible, NULL_ID,
};
use bytes::Bytes;
use parquet::basic::{Repetition, Type as PhysicalType};
use parquet::data_type::{ByteArray, ByteArrayType, DataType, Int32Type, Int64Type};
use parquet::file::reader::{FileReader, RowGroupReader, SerializedFileReader};
use pmb_core::fixed::parse_decimal;
use pmb_replay::telonex::{FORMAT_NAME, FORMAT_VERSION};

/// Version-1 schema fingerprint (`src/parquet/io/eventSchema.ts:53-70`).
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

fn pq_err(e: impl std::fmt::Display) -> Unconvertible {
    Unconvertible::Parquet(e.to_string())
}

/// One decoded column of one row group (values plus per-row ranges).
pub(crate) struct Column<T> {
    pub values: Vec<T>,
    def: Vec<i16>,
    rep: Vec<i16>,
    starts: Vec<u32>,
}

impl<T: Clone + Default> Column<T> {
    pub fn new() -> Self {
        Column {
            values: Vec::new(),
            def: Vec::new(),
            rep: Vec::new(),
            starts: Vec::new(),
        }
    }

    #[inline]
    pub fn row(&self, r: usize) -> &[T] {
        &self.values[self.starts[r] as usize..self.starts[r + 1] as usize]
    }

    #[inline]
    pub fn get(&self, r: usize) -> Option<&T> {
        self.row(r).first()
    }

    pub fn read<D: DataType<T = T>>(
        &mut self,
        rg: &dyn RowGroupReader,
        col: usize,
        rows: usize,
    ) -> Result<(), Unconvertible> {
        let descr = rg.metadata().column(col).column_descr_ptr();
        let name = descr.path().string();
        if descr.physical_type() != D::get_physical_type() {
            return Err(pq_err(format!("column `{name}`: physical type mismatch")));
        }
        let (max_def, max_rep) = (descr.max_def_level(), descr.max_rep_level());
        if max_rep > 1 {
            return Err(pq_err(format!("column `{name}`: nested list")));
        }
        self.values.clear();
        self.def.clear();
        self.rep.clear();
        self.starts.clear();
        let Some(mut reader) = D::get_column_reader(rg.get_column_reader(col).map_err(pq_err)?)
        else {
            return Err(pq_err(format!("column `{name}`: typed reader mismatch")));
        };
        let mut records = 0;
        while records < rows {
            let (n, _, _) = reader
                .read_records(
                    rows - records,
                    (max_def > 0).then_some(&mut self.def),
                    (max_rep > 0).then_some(&mut self.rep),
                    &mut self.values,
                )
                .map_err(pq_err)?;
            if n == 0 {
                return Err(pq_err(format!(
                    "column `{name}`: ended after {records} of {rows} rows"
                )));
            }
            records += n;
        }
        if max_def == 0 && max_rep == 0 {
            self.starts.extend(0..=rows as u32);
        } else {
            let levels = if max_rep > 0 {
                self.rep.len()
            } else {
                self.def.len()
            };
            let mut count = 0u32;
            for i in 0..levels {
                if max_rep == 0 || self.rep[i] == 0 {
                    self.starts.push(count);
                }
                if max_def == 0 || self.def[i] == max_def {
                    count += 1;
                }
            }
            self.starts.push(count);
        }
        if self.starts.len() != rows + 1
            || *self.starts.last().unwrap_or(&0) as usize != self.values.len()
        {
            return Err(pq_err(format!("column `{name}`: level/value mismatch")));
        }
        Ok(())
    }
}

/// The 16 columns of one row group, reused across groups.
pub(crate) struct Batch {
    pub ingest_seq: Column<i64>,
    pub ts_local: Column<i64>,
    pub ts_exchange: Column<i64>,
    pub event_type: Column<ByteArray>,
    pub market: Column<ByteArray>,
    pub asset0: Column<ByteArray>,
    pub asset1: Column<ByteArray>,
    pub asset_index: Column<i32>,
    /// In [`dec`] order.
    pub decimals: [Column<ByteArray>; dec::COUNT],
    /// In [`int`] order.
    pub ints: [Column<i32>; int::COUNT],
}

/// Schema column of each decimal list, in [`dec`] order.
const DEC_COLS: [usize; dec::COUNT] = [8, 9, 10, 11, 14, 15];
/// Schema column of each integer list, in [`int`] order.
const INT_COLS: [usize; int::COUNT] = [12, 13];

impl Batch {
    pub fn new() -> Self {
        Batch {
            ingest_seq: Column::new(),
            ts_local: Column::new(),
            ts_exchange: Column::new(),
            event_type: Column::new(),
            market: Column::new(),
            asset0: Column::new(),
            asset1: Column::new(),
            asset_index: Column::new(),
            decimals: std::array::from_fn(|_| Column::new()),
            ints: std::array::from_fn(|_| Column::new()),
        }
    }

    pub fn read(&mut self, rg: &dyn RowGroupReader, rows: usize) -> Result<(), Unconvertible> {
        self.ingest_seq.read::<Int64Type>(rg, 0, rows)?;
        self.ts_local.read::<Int64Type>(rg, 1, rows)?;
        self.ts_exchange.read::<Int64Type>(rg, 2, rows)?;
        self.event_type.read::<ByteArrayType>(rg, 3, rows)?;
        self.market.read::<ByteArrayType>(rg, 4, rows)?;
        self.asset0.read::<ByteArrayType>(rg, 5, rows)?;
        self.asset1.read::<ByteArrayType>(rg, 6, rows)?;
        self.asset_index.read::<Int32Type>(rg, 7, rows)?;
        for (c, &col) in self.decimals.iter_mut().zip(&DEC_COLS) {
            c.read::<ByteArrayType>(rg, col, rows)?;
        }
        for (c, &col) in self.ints.iter_mut().zip(&INT_COLS) {
            c.read::<Int32Type>(rg, col, rows)?;
        }
        Ok(())
    }
}

/// Footer keys and the version-1 fingerprint (15 I-12).
pub(crate) fn check_v1_format(reader: &impl FileReader) -> Result<(), Unconvertible> {
    let meta = reader.metadata().file_metadata();
    if let Some(kv) = meta.key_value_metadata() {
        let get = |k: &str| kv.iter().find(|e| e.key == k).and_then(|e| e.value.clone());
        if let Some(name) = get("pmb_format") {
            let version = get("pmb_format_version");
            if name != FORMAT_NAME || version.as_deref() != Some(&FORMAT_VERSION.to_string()) {
                return Err(Unconvertible::Format(format!(
                    "footer format {name} version {version:?}"
                )));
            }
        }
    }
    let schema = meta.schema_descr();
    let cols = schema.columns();
    if cols.len() != V1_COLUMNS.len() {
        return Err(Unconvertible::Format(format!("{} columns", cols.len())));
    }
    for (i, (name, ty, rep)) in V1_COLUMNS.iter().enumerate() {
        let c = &cols[i];
        let actual_rep = schema.get_column_root(i).get_basic_info().repetition();
        if c.path().string() != *name || c.physical_type() != *ty || actual_rep != *rep {
            return Err(Unconvertible::Format(format!(
                "column {i} is `{}` {:?} {:?}, v1 expects `{name}` {ty:?} {rep:?}",
                c.path().string(),
                c.physical_type(),
                actual_rep
            )));
        }
    }
    Ok(())
}

fn push_offset(
    offsets: &mut Vec<u32>,
    len: usize,
    column: &'static str,
) -> Result<(), Unconvertible> {
    let end = u32::try_from(len).map_err(|_| Unconvertible::TooManyValues(column))?;
    offsets.push(end);
    Ok(())
}

/// Decodes a whole version-1 file (already in memory) into typed rows.
pub fn read_v1(data: Bytes) -> Result<TypedRows, Unconvertible> {
    let reader = SerializedFileReader::new(data).map_err(pq_err)?;
    check_v1_format(&reader)?;
    let total: usize = reader
        .metadata()
        .row_groups()
        .iter()
        .map(|g| g.num_rows() as usize)
        .sum();
    if u32::try_from(total).is_err() {
        return Err(Unconvertible::TooManyValues("rows"));
    }
    let mut t = TypedRows::default();
    t.ingest_seq.reserve(total);
    t.ts_local_ms.reserve(total);
    t.ts_exchange_ms.reserve(total);
    t.flags.reserve(total);
    t.event_type.reserve(total);
    t.market.reserve(total);
    t.asset0.reserve(total);
    t.asset1.reserve(total);
    t.asset_index.reserve(total);
    let mut dict = DictBuilder::default();
    let mut b = Batch::new();
    let missing = |c: &str| pq_err(format!("required column `{c}` has a null"));
    for g in 0..reader.num_row_groups() {
        let rg = reader.get_row_group(g).map_err(pq_err)?;
        let rows = rg.metadata().num_rows() as usize;
        b.read(rg.as_ref(), rows)?;
        for r in 0..rows {
            t.ingest_seq
                .push(*b.ingest_seq.get(r).ok_or_else(|| missing("ingest_seq"))?);
            t.ts_local_ms
                .push(*b.ts_local.get(r).ok_or_else(|| missing("ts_local_ms"))?);
            let mut flags = 0u8;
            match b.ts_exchange.get(r) {
                Some(&v) => t.ts_exchange_ms.push(v),
                None => {
                    flags |= row_flags::TS_EXCHANGE_NULL;
                    t.ts_exchange_ms.push(0);
                }
            }
            match b.asset_index.get(r) {
                Some(&v) => t.asset_index.push(v),
                None => {
                    flags |= row_flags::ASSET_INDEX_NULL;
                    t.asset_index.push(0);
                }
            }
            t.flags.push(flags);
            let et = b.event_type.get(r).ok_or_else(|| missing("event_type"))?;
            t.event_type.push(match et.data() {
                b"book" => event_type::BOOK,
                b"price_change" => event_type::PRICE_CHANGE,
                other => {
                    return Err(Unconvertible::EventType(
                        String::from_utf8_lossy(other).into_owned(),
                    ))
                }
            });
            let m = b.market.get(r).ok_or_else(|| missing("market"))?;
            t.market.push(dict.intern(m.data())?);
            for (col, out) in [(&b.asset0, &mut t.asset0), (&b.asset1, &mut t.asset1)] {
                out.push(match col.get(r) {
                    Some(v) => dict.intern(v.data())?,
                    None => NULL_ID,
                });
            }
            for (k, col) in b.decimals.iter().enumerate() {
                let out = &mut t.decimals[k];
                for v in col.row(r) {
                    let s = std::str::from_utf8(v.data()).map_err(|_| Unconvertible::Decimal {
                        column: dec::NAMES[k],
                        detail: "not UTF-8".into(),
                    })?;
                    let d = parse_decimal(s).map_err(|e| Unconvertible::Decimal {
                        column: dec::NAMES[k],
                        detail: format!("{s:?}: {e}"),
                    })?;
                    if d.inexact {
                        let i = u32::try_from(out.values.len())
                            .map_err(|_| Unconvertible::TooManyValues(dec::NAMES[k]))?;
                        out.inexact.push(i);
                    }
                    out.values.push(d.micros);
                }
                push_offset(&mut out.offsets, out.values.len(), dec::NAMES[k])?;
            }
            for (k, col) in b.ints.iter().enumerate() {
                let out = &mut t.ints[k];
                out.values.extend_from_slice(col.row(r));
                push_offset(&mut out.offsets, out.values.len(), int::NAMES[k])?;
            }
        }
    }
    t.dict = dict.finish();
    Ok(t)
}
