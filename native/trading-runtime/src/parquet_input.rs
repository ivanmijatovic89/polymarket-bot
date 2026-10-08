//! Streaming local Parquet inputs with the pinned replay heap ordering.
//! Admission deliberately separates pop from refill: the caller must finish
//! the current frame/callback before the next row in that file is read.
use crate::market_json::{self, JsValue};
use num_bigint::BigInt;
use num_traits::{FromPrimitive, ToPrimitive};
use parquet::basic::ConvertedType;
use parquet::file::reader::{FileReader, SerializedFileReader};
use parquet::record::reader::RowIter;
use parquet::record::{Field, Row};
use parquet::thrift::TSerializable;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, VecDeque};
use std::fmt;
use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use thrift::protocol::TCompactInputProtocol;

#[derive(Clone, Copy, Debug, Default)]
pub enum ReplayOrder {
    #[default]
    Recorded,
    ExchangeTime,
}

#[derive(Debug)]
pub struct InputError(pub String);
impl fmt::Display for InputError {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(&self.0)
    }
}
impl std::error::Error for InputError {}

fn js_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' |
        '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' |
        '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
fn string_integer(value: &str) -> Option<BigInt> {
    let text = value.trim_matches(js_whitespace);
    if text.is_empty() {
        return None;
    }
    let (radix, digits) =
        if let Some(v) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
            (16, v)
        } else if let Some(v) = text.strip_prefix("0o").or_else(|| text.strip_prefix("0O")) {
            (8, v)
        } else if let Some(v) = text.strip_prefix("0b").or_else(|| text.strip_prefix("0B")) {
            (2, v)
        } else {
            (10, text)
        };
    let magnitude = if radix == 10 {
        digits
            .strip_prefix('+')
            .or_else(|| digits.strip_prefix('-'))
            .unwrap_or(digits)
    } else {
        digits
    };
    if magnitude.is_empty()
        || !magnitude.bytes().all(|b| match radix {
            2 => matches!(b, b'0' | b'1'),
            8 => matches!(b, b'0'..=b'7'),
            10 => b.is_ascii_digit(),
            _ => b.is_ascii_hexdigit(),
        })
    {
        return None;
    }
    BigInt::parse_bytes(digits.as_bytes(), radix)
}

/// Matches toBigInt for production replay primitive columns. BigInt keys never
/// pass through binary64; numeric columns intentionally truncate like JS.
pub fn integer_key(value: Option<ColumnValue<'_>>, fallback: &BigInt) -> BigInt {
    if let Some(ColumnValue::Json(value)) = value {
        let parsed = match value {
            JsValue::Number(value) => BigInt::from_f64(value.trunc()),
            JsValue::String(value) => value.as_str().and_then(string_integer),
            _ => None,
        };
        return parsed.unwrap_or_else(|| fallback.clone());
    }
    let physical = match value {
        Some(ColumnValue::Physical(value)) => Some(value),
        _ => None,
    };
    let parsed = match physical {
        Some(Field::Long(v) | Field::TimeMicros(v)) => Some(BigInt::from(*v)),
        // parquetjs decodes the physical INT64/INT32 signed value even when
        // the logical unsigned annotation has no fromPrimitive conversion.
        Some(Field::ULong(v)) => Some(BigInt::from(*v as i64)),
        Some(Field::Int(v) | Field::TimeMillis(v)) => Some(BigInt::from(*v)),
        Some(Field::UInt(v)) => Some(BigInt::from(*v as i32)),
        Some(Field::Byte(v)) => Some(BigInt::from(*v)),
        Some(Field::Short(v)) => Some(BigInt::from(*v)),
        Some(Field::UByte(v)) => Some(BigInt::from(*v)),
        Some(Field::UShort(v)) => Some(BigInt::from(*v)),
        Some(Field::Float(v)) => BigInt::from_f64(f64::from(*v).trunc()),
        Some(Field::Double(v)) => BigInt::from_f64(v.trunc()),
        Some(Field::Str(v)) => string_integer(v),
        _ => None,
    };
    parsed.unwrap_or_else(|| fallback.clone())
}

#[derive(Clone, Copy)]
pub enum ColumnValue<'a> {
    Physical(&'a Field),
    Json(&'a JsValue),
}
#[derive(Debug)]
pub struct ParquetInputData {
    pub physical: Row,
    pub logical_json: Vec<(String, JsValue)>,
}
pub fn column<'a>(row: &'a ParquetInputData, name: &str) -> Option<ColumnValue<'a>> {
    if let Some((_, value)) = row.logical_json.iter().find(|(key, _)| key == name) {
        return Some(ColumnValue::Json(value));
    }
    row.physical
        .get_column_iter()
        .find(|(key, _)| key.as_str() == name)
        .map(|(_, value)| ColumnValue::Physical(value))
}
fn decode_json(field: &Field) -> Result<JsValue, InputError> {
    match field {
        Field::Null => Ok(JsValue::Null),
        Field::Str(value) => market_json::parse(value)
            .map_err(|e| InputError(format!("Invalid logical JSON at byte {}", e.offset))),
        Field::Bytes(value) => market_json::parse(&String::from_utf8_lossy(value.data()))
            .map_err(|e| InputError(format!("Invalid logical JSON at byte {}", e.offset))),
        Field::ListInternal(values) => Ok(JsValue::array(
            values
                .elements()
                .iter()
                .map(decode_json)
                .collect::<Result<Vec<_>, _>>()?,
        )),
        _ => Err(InputError("Invalid logical JSON Parquet value".into())),
    }
}

// Normalized Parquet statistics discard deprecated min/max when modern bounds
// exist. The pinned reader decodes all four raw fields, so preserve them here.
fn raw_footer(file: &mut File) -> Result<parquet::format::FileMetaData, InputError> {
    let size = file
        .metadata()
        .map_err(|e| InputError(e.to_string()))?
        .len();
    if size < 12 {
        return Err(InputError("Invalid Parquet footer length".into()));
    }
    file.seek(SeekFrom::End(-8))
        .map_err(|e| InputError(e.to_string()))?;
    let mut tail = [0_u8; 8];
    file.read_exact(&mut tail)
        .map_err(|e| InputError(e.to_string()))?;
    if &tail[4..] != b"PAR1" {
        return Err(InputError("Invalid Parquet footer magic".into()));
    }
    let length = u32::from_le_bytes(tail[..4].try_into().unwrap()) as usize;
    if length as u64 > size - 12 {
        return Err(InputError("Invalid Parquet metadata length".into()));
    }
    file.seek(SeekFrom::Start(size - 8 - length as u64))
        .map_err(|e| InputError(e.to_string()))?;
    let mut bytes = vec![0; length];
    file.read_exact(&mut bytes)
        .map_err(|e| InputError(e.to_string()))?;
    file.seek(SeekFrom::Start(0))
        .map_err(|e| InputError(e.to_string()))?;
    let mut protocol = TCompactInputProtocol::new(Cursor::new(bytes));
    parquet::format::FileMetaData::read_from_in_protocol(&mut protocol)
        .map_err(|e| InputError(e.to_string()))
}
fn validate_json_statistics(
    path: &Path,
    raw: &parquet::format::FileMetaData,
    descriptors: &parquet::schema::types::SchemaDescriptor,
) -> Result<(), InputError> {
    for group in &raw.row_groups {
        for (index, column) in group.columns.iter().enumerate() {
            if descriptors.column(index).converted_type() != ConvertedType::JSON {
                continue;
            }
            if let Some(statistics) = column
                .meta_data
                .as_ref()
                .and_then(|meta| meta.statistics.as_ref())
            {
                // Match reader constructor evaluation order; empty bounds are
                // absent values and do not enter JSON.parse in parquetjs.
                for bytes in [
                    statistics.max_value.as_deref(),
                    statistics.min_value.as_deref(),
                    statistics.min.as_deref(),
                    statistics.max.as_deref(),
                ]
                .into_iter()
                .flatten()
                .filter(|bytes| !bytes.is_empty())
                {
                    market_json::parse(&String::from_utf8_lossy(bytes)).map_err(|error| {
                        InputError(format!(
                            "{}: Invalid logical JSON statistics at byte {}",
                            path.display(),
                            error.offset
                        ))
                    })?;
                }
            }
        }
    }
    Ok(())
}

// Page statistics are decoded lazily during rowgroup materialization by the
// pinned reader. Keep raw fields here too: crate-level Page statistics have
// already normalized deprecated bounds and cannot prove this error boundary.
fn validate_json_page_statistics(
    path: &Path,
    file: &mut File,
    group: &parquet::format::RowGroup,
    json_indices: &[usize],
) -> Result<(), InputError> {
    for &index in json_indices {
        let column = group.columns[index]
            .meta_data
            .as_ref()
            .ok_or_else(|| InputError("Missing column metadata".into()))?;
        let start = column
            .dictionary_page_offset
            .unwrap_or(column.data_page_offset)
            .min(column.data_page_offset);
        let start = u64::try_from(start).map_err(|_| InputError("Invalid column offset".into()))?;
        let length = usize::try_from(column.total_compressed_size)
            .map_err(|_| InputError("Invalid column size".into()))?;
        let file_size = file
            .metadata()
            .map_err(|e| InputError(e.to_string()))?
            .len();
        if start
            .checked_add(length as u64)
            .is_none_or(|end| end > file_size)
        {
            return Err(InputError("Truncated column chunk".into()));
        }
        file.seek(SeekFrom::Start(start))
            .map_err(|e| InputError(e.to_string()))?;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes)
            .map_err(|e| InputError(e.to_string()))?;
        let mut cursor = Cursor::new(bytes.as_slice());
        let mut values = 0_i64;
        while cursor.position() < bytes.len() as u64 && values < column.num_values {
            let header = {
                let mut protocol = TCompactInputProtocol::new(&mut cursor);
                parquet::format::PageHeader::read_from_in_protocol(&mut protocol)
                    .map_err(|e| InputError(e.to_string()))?
            };
            let (count, statistics) = if let Some(page) = &header.data_page_header {
                (page.num_values, page.statistics.as_ref())
            } else if let Some(page) = &header.data_page_header_v2 {
                (page.num_values, page.statistics.as_ref())
            } else {
                (0, None)
            };
            if let Some(statistics) = statistics {
                // decodeStatistics uses modern min/max followed by old min/max.
                for bytes in [
                    statistics.min_value.as_deref(),
                    statistics.max_value.as_deref(),
                    statistics.min.as_deref(),
                    statistics.max.as_deref(),
                ]
                .into_iter()
                .flatten()
                .filter(|bytes| !bytes.is_empty())
                {
                    market_json::parse(&String::from_utf8_lossy(bytes)).map_err(|error| {
                        InputError(format!(
                            "{}: Invalid page JSON statistics at byte {}",
                            path.display(),
                            error.offset
                        ))
                    })?;
                }
            }
            let count = i64::from(count);
            if count < 0 {
                return Err(InputError("Invalid page value count".into()));
            }
            values = values
                .checked_add(count)
                .ok_or_else(|| InputError("Page count overflow".into()))?;
            let size = u64::try_from(header.compressed_page_size)
                .map_err(|_| InputError("Invalid page size".into()))?;
            let next = cursor
                .position()
                .checked_add(size)
                .filter(|end| *end <= bytes.len() as u64)
                .ok_or_else(|| InputError("Truncated page".into()))?;
            cursor.set_position(next);
        }
    }
    Ok(())
}

/// Owns a file and one decoded row group at a time. No complete input load.
pub struct ParquetRows {
    path: PathBuf,
    rows: RowIter<'static>,
    json_columns: Vec<String>,
    json_indices: Vec<usize>,
    statistics_file: File,
    raw_groups: VecDeque<parquet::format::RowGroup>,
    group_sizes: VecDeque<usize>,
    pending_rows: VecDeque<ParquetInputData>,
}
impl ParquetRows {
    pub fn open(path: PathBuf) -> Result<Self, InputError> {
        let mut file =
            File::open(&path).map_err(|e| InputError(format!("{}: {e}", path.display())))?;
        let raw =
            raw_footer(&mut file).map_err(|e| InputError(format!("{}: {e}", path.display())))?;
        let statistics_file = file.try_clone().map_err(|e| InputError(e.to_string()))?;
        let reader = SerializedFileReader::new(file)
            .map_err(|e| InputError(format!("{}: {e}", path.display())))?;
        let descriptors = reader.metadata().file_metadata().schema_descr();
        let json_columns = descriptors
            .columns()
            .iter()
            .filter(|column| {
                column.converted_type() == ConvertedType::JSON && column.path().parts().len() == 1
            })
            .filter_map(|column| column.path().parts().first().cloned())
            .collect();
        let json_indices = descriptors
            .columns()
            .iter()
            .enumerate()
            .filter_map(|(index, column)| {
                (column.converted_type() == ConvertedType::JSON).then_some(index)
            })
            .collect();
        // Validation occurs before any file cursor is primed.
        validate_json_statistics(&path, &raw, descriptors)?;
        let group_sizes = reader
            .metadata()
            .row_groups()
            .iter()
            .map(|group| {
                usize::try_from(group.num_rows())
                    .map_err(|_| InputError("Invalid row group size".into()))
            })
            .collect::<Result<VecDeque<_>, _>>()?;
        Ok(Self {
            path,
            json_columns,
            json_indices,
            statistics_file,
            raw_groups: raw.row_groups.into(),
            rows: RowIter::from_file_into(Box::new(reader)),
            group_sizes,
            pending_rows: VecDeque::new(),
        })
    }
    fn decode_row(&self, physical: Row) -> Result<ParquetInputData, InputError> {
        let mut logical_json = Vec::new();
        for name in &self.json_columns {
            if let Some((_, field)) = physical.get_column_iter().find(|(key, _)| *key == name) {
                // A missing optional column remains missing. JSON text "null"
                // is instead a present logical JSON null value.
                if !matches!(field, Field::Null) {
                    logical_json.push((
                        name.clone(),
                        decode_json(field).map_err(|e| {
                            InputError(format!("{} column {name}: {e}", self.path.display()))
                        })?,
                    ));
                }
            }
        }
        Ok(ParquetInputData {
            physical,
            logical_json,
        })
    }
    pub fn next_row(&mut self) -> Result<Option<ParquetInputData>, InputError> {
        if let Some(row) = self.pending_rows.pop_front() {
            return Ok(Some(row));
        }
        while let Some(count) = self.group_sizes.pop_front() {
            let raw_group = self
                .raw_groups
                .pop_front()
                .ok_or_else(|| InputError("Missing raw rowgroup metadata".into()))?;
            validate_json_page_statistics(
                &self.path,
                &mut self.statistics_file,
                &raw_group,
                &self.json_indices,
            )?;
            // parquetjs materializes and converts the whole group before its
            // first row can reach an awaited callback. Discard this entire
            // group's prefix on a read/conversion error, preserving only rows
            // previously admitted from earlier groups.
            let mut group = VecDeque::new();
            for _ in 0..count {
                let physical = self
                    .rows
                    .next()
                    .transpose()
                    .map_err(|e| InputError(format!("{}: {e}", self.path.display())))?
                    .ok_or_else(|| {
                        InputError(format!("{}: Truncated row group", self.path.display()))
                    })?;
                group.push_back(self.decode_row(physical)?);
            }
            self.pending_rows = group;
            if let Some(row) = self.pending_rows.pop_front() {
                return Ok(Some(row));
            }
        }
        Ok(None)
    }
}

#[derive(Debug)]
pub struct ReplayInputRow {
    pub file_index: usize,
    pub row_index: usize,
    pub file_path: PathBuf,
    pub ingest_sequence: BigInt,
    pub ordering_timestamp: BigInt,
    pub row: ParquetInputData,
}
impl ReplayInputRow {
    pub fn local_time_ms(&self) -> Option<f64> {
        let value = integer_key(column(&self.row, "ts_local_ms"), &BigInt::from(0));
        let number = value.to_f64().unwrap_or_else(|| {
            if value < BigInt::from(0) {
                f64::NEG_INFINITY
            } else {
                f64::INFINITY
            }
        });
        (number > 0.0).then_some(number)
    }
}
impl PartialEq for ReplayInputRow {
    fn eq(&self, other: &Self) -> bool {
        self.ingest_sequence == other.ingest_sequence
            && self.ordering_timestamp == other.ordering_timestamp
            && self.file_index == other.file_index
    }
}
impl Eq for ReplayInputRow {}
impl Ord for ReplayInputRow {
    fn cmp(&self, other: &Self) -> Ordering {
        // TS MinHeap always prioritizes ingest_seq. exchange_time changes
        // ONLY the secondary key; do not silently replace this with time sort.
        other
            .ingest_sequence
            .cmp(&self.ingest_sequence)
            .then_with(|| other.ordering_timestamp.cmp(&self.ordering_timestamp))
            .then_with(|| other.file_index.cmp(&self.file_index))
    }
}
impl PartialOrd for ReplayInputRow {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub struct MergedParquetInput {
    readers: Vec<ParquetRows>,
    row_counts: Vec<usize>,
    heap: BinaryHeap<ReplayInputRow>,
    order: ReplayOrder,
    pending_file: Option<usize>,
    failed: bool,
}
impl MergedParquetInput {
    pub fn open(paths: Vec<PathBuf>, order: ReplayOrder) -> Result<Self, InputError> {
        if paths.is_empty() {
            return Err(InputError("replay input filePaths is required".into()));
        }
        // Open every file before priming any cursor, matching the TS reader.
        let readers = paths
            .into_iter()
            .map(ParquetRows::open)
            .collect::<Result<Vec<_>, _>>()?;
        let mut input = Self {
            row_counts: vec![0; readers.len()],
            readers,
            heap: BinaryHeap::new(),
            order,
            pending_file: None,
            failed: false,
        };
        for index in 0..input.readers.len() {
            input.refill(index)?;
        }
        Ok(input)
    }
    fn refill(&mut self, file_index: usize) -> Result<(), InputError> {
        if let Some(row) = self.readers[file_index].next_row()? {
            let zero = BigInt::from(0);
            let local = integer_key(column(&row, "ts_local_ms"), &zero);
            let timestamp = match self.order {
                ReplayOrder::Recorded => local,
                ReplayOrder::ExchangeTime => integer_key(column(&row, "ts_exchange_ms"), &local),
            };
            let sequence = integer_key(column(&row, "ingest_seq"), &zero);
            let row_index = self.row_counts[file_index];
            self.row_counts[file_index] += 1;
            self.heap.push(ReplayInputRow {
                file_index,
                row_index,
                file_path: self.readers[file_index].path.clone(),
                ingest_sequence: sequence,
                ordering_timestamp: timestamp,
                row,
            });
        }
        Ok(())
    }
    pub fn pop(&mut self) -> Result<Option<ReplayInputRow>, InputError> {
        if self.failed {
            return Err(InputError("replay input already failed".into()));
        }
        if self.pending_file.is_some() {
            return Err(InputError(
                "finish the admitted frame before another pop".into(),
            ));
        }
        let next = self.heap.pop();
        self.pending_file = next.as_ref().map(|row| row.file_index);
        Ok(next)
    }
    /// Call after the current frame and its awaited callbacks finish, including
    /// filtered/skipped rows. A refill failure terminates this input session.
    pub fn advance(&mut self) -> Result<(), InputError> {
        let index = self
            .pending_file
            .take()
            .ok_or_else(|| InputError("advance requires an admitted row".into()))?;
        if let Err(error) = self.refill(index) {
            self.failed = true;
            self.heap.clear();
            self.readers.clear();
            return Err(error);
        }
        Ok(())
    }
}
