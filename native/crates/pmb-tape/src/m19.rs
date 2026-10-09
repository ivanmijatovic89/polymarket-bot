//! M-19 measured alternative (16 NT-3, §15.2): the same typed rows as a
//! flat Parquet file of INT64/INT32 columns with ZSTD, one row group per
//! 65,536 rows. Repeated columns hold the lists (DuckDB reads them as
//! lists), the id dictionary and the v1 identity sit in the footer's
//! key-value metadata, and the inexact flags are per-row lists of value
//! positions. Bench-only: `pmb-tape m19-convert` writes these files under
//! the tape root and `pmb-tape bench --m19` times them; executors never
//! read them.

use crate::codec::V1Identity;
use crate::store::{hex, parse_hex32};
use crate::typed::{dec, int, row_flags, TypedRows, NULL_ID};
use crate::v1::Column;
use bytes::Bytes;
use parquet::basic::{Compression, ZstdLevel};
use parquet::column::writer::ColumnWriter;
use parquet::data_type::{Int32Type, Int64Type};
use parquet::file::metadata::KeyValue;
use parquet::file::properties::WriterProperties;
use parquet::file::reader::{FileReader, SerializedFileReader};
use parquet::file::writer::SerializedFileWriter;
use parquet::schema::parser::parse_message_type;
use std::sync::Arc;

/// Footer key naming this layout.
pub const FORMAT_KEY: &str = "pmb_m19_format";
pub const FORMAT_VALUE: &str = "typed-rows-int64-zstd-v1";
/// Rows per row group (the tape's block size).
pub const ROW_GROUP_ROWS: usize = 65_536;

const MESSAGE: &str = "message pmb_typed_rows {
  required int64 ingest_seq;
  required int64 ts_local_ms;
  optional int64 ts_exchange_ms;
  required int32 event_type;
  required int32 market;
  optional int32 asset0;
  optional int32 asset1;
  optional int32 asset_index;
  repeated int64 bid_prices;
  repeated int64 bid_sizes;
  repeated int64 ask_prices;
  repeated int64 ask_sizes;
  repeated int64 change_prices;
  repeated int64 change_sizes;
  repeated int32 change_asset_indexes;
  repeated int32 change_side_codes;
  repeated int32 bid_prices_inexact;
  repeated int32 bid_sizes_inexact;
  repeated int32 ask_prices_inexact;
  repeated int32 ask_sizes_inexact;
  repeated int32 change_prices_inexact;
  repeated int32 change_sizes_inexact;
}";

/// Column indices of the schema.
const C_SEQ: usize = 0;
const C_TS_LOCAL: usize = 1;
const C_TS_EXCHANGE: usize = 2;
const C_EVENT: usize = 3;
const C_MARKET: usize = 4;
const C_ASSET0: usize = 5;
const C_ASSET1: usize = 6;
const C_ASSET_INDEX: usize = 7;
const C_DEC: usize = 8;
const C_INT: usize = C_DEC + dec::COUNT;
const C_INEXACT: usize = C_INT + int::COUNT;
const N_COLS: usize = C_INEXACT + dec::COUNT;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Definition and repetition levels of a list column over rows `r0..r1`.
fn list_levels(offsets: &[u32], r0: usize, r1: usize) -> (Vec<i16>, Vec<i16>) {
    let (mut def, mut rep) = (Vec::new(), Vec::new());
    for r in r0..r1 {
        let n = offsets[r + 1] - offsets[r];
        if n == 0 {
            def.push(0);
            rep.push(0);
        }
        for j in 0..n {
            def.push(1);
            rep.push(i16::from(j > 0));
        }
    }
    (def, rep)
}

/// Encodes typed rows as an M-19 Parquet file.
pub fn encode(t: &TypedRows, v1: &V1Identity, zstd_level: i32) -> Result<Vec<u8>, String> {
    t.validate()?;
    let schema = Arc::new(parse_message_type(MESSAGE).map_err(err)?);
    let dict = t.dict.iter().map(|e| hex(e)).collect::<Vec<_>>().join(",");
    let kv = vec![
        KeyValue::new(FORMAT_KEY.into(), FORMAT_VALUE.to_string()),
        KeyValue::new("pmb_v1_bytes".into(), v1.bytes.to_string()),
        KeyValue::new("pmb_v1_mtime_ns".into(), v1.mtime_ns.to_string()),
        KeyValue::new("pmb_v1_sha256".into(), hex(&v1.sha256)),
        KeyValue::new("pmb_dict".into(), dict),
    ];
    let props = Arc::new(
        WriterProperties::builder()
            .set_compression(Compression::ZSTD(
                ZstdLevel::try_new(zstd_level).map_err(err)?,
            ))
            .set_max_row_group_size(ROW_GROUP_ROWS)
            .set_key_value_metadata(Some(kv))
            .build(),
    );
    let mut out = Vec::new();
    let mut w = SerializedFileWriter::new(&mut out, schema, props).map_err(err)?;
    let n = t.len();
    let mut r0 = 0;
    while r0 < n {
        let r1 = (r0 + ROW_GROUP_ROWS).min(n);
        let mut rg = w.next_row_group().map_err(err)?;
        let mut idx = 0;
        while let Some(mut c) = rg.next_column().map_err(err)? {
            match (idx, c.untyped()) {
                (C_SEQ | C_TS_LOCAL, ColumnWriter::Int64ColumnWriter(cw)) => {
                    let v = if idx == C_SEQ {
                        &t.ingest_seq
                    } else {
                        &t.ts_local_ms
                    };
                    cw.write_batch(&v[r0..r1], None, None).map_err(err)?;
                }
                (C_TS_EXCHANGE, ColumnWriter::Int64ColumnWriter(cw)) => {
                    let (mut v, mut d) = (Vec::new(), Vec::new());
                    for r in r0..r1 {
                        if t.flags[r] & row_flags::TS_EXCHANGE_NULL != 0 {
                            d.push(0);
                        } else {
                            d.push(1);
                            v.push(t.ts_exchange_ms[r]);
                        }
                    }
                    cw.write_batch(&v, Some(&d), None).map_err(err)?;
                }
                (C_EVENT | C_MARKET, ColumnWriter::Int32ColumnWriter(cw)) => {
                    let src = if idx == C_EVENT {
                        &t.event_type
                    } else {
                        &t.market
                    };
                    let v: Vec<i32> = src[r0..r1].iter().map(|&x| i32::from(x)).collect();
                    cw.write_batch(&v, None, None).map_err(err)?;
                }
                (C_ASSET0 | C_ASSET1 | C_ASSET_INDEX, ColumnWriter::Int32ColumnWriter(cw)) => {
                    let (mut v, mut d) = (Vec::new(), Vec::new());
                    for r in r0..r1 {
                        let value = match idx {
                            C_ASSET0 => (t.asset0[r] != NULL_ID).then_some(i32::from(t.asset0[r])),
                            C_ASSET1 => (t.asset1[r] != NULL_ID).then_some(i32::from(t.asset1[r])),
                            _ => (t.flags[r] & row_flags::ASSET_INDEX_NULL == 0)
                                .then_some(t.asset_index[r]),
                        };
                        match value {
                            Some(x) => {
                                d.push(1);
                                v.push(x);
                            }
                            None => d.push(0),
                        }
                    }
                    cw.write_batch(&v, Some(&d), None).map_err(err)?;
                }
                (i, ColumnWriter::Int64ColumnWriter(cw)) if (C_DEC..C_INT).contains(&i) => {
                    let l = &t.decimals[i - C_DEC];
                    let (def, rep) = list_levels(&l.offsets, r0, r1);
                    let span = l.offsets[r0] as usize..l.offsets[r1] as usize;
                    cw.write_batch(&l.values[span], Some(&def), Some(&rep))
                        .map_err(err)?;
                }
                (i, ColumnWriter::Int32ColumnWriter(cw)) if (C_INT..C_INEXACT).contains(&i) => {
                    let l = &t.ints[i - C_INT];
                    let (def, rep) = list_levels(&l.offsets, r0, r1);
                    let span = l.offsets[r0] as usize..l.offsets[r1] as usize;
                    cw.write_batch(&l.values[span], Some(&def), Some(&rep))
                        .map_err(err)?;
                }
                (i, ColumnWriter::Int32ColumnWriter(cw)) if (C_INEXACT..N_COLS).contains(&i) => {
                    // Per row: positions of the rounded values within the row.
                    let l = &t.decimals[i - C_INEXACT];
                    let mut offsets = vec![0u32];
                    let mut v = Vec::new();
                    let mut k = l.inexact.partition_point(|&x| x < l.offsets[r0]);
                    for r in r0..r1 {
                        while k < l.inexact.len() && l.inexact[k] < l.offsets[r + 1] {
                            v.push((l.inexact[k] - l.offsets[r]) as i32);
                            k += 1;
                        }
                        offsets.push(v.len() as u32);
                    }
                    let (def, rep) = list_levels(&offsets, 0, r1 - r0);
                    cw.write_batch(&v, Some(&def), Some(&rep)).map_err(err)?;
                }
                (i, _) => return Err(format!("column {i}: unexpected writer type")),
            }
            c.close().map_err(err)?;
            idx += 1;
        }
        rg.close().map_err(err)?;
        r0 = r1;
    }
    w.close().map_err(err)?;
    Ok(out)
}

/// Footer data of an M-19 file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Meta {
    pub v1_bytes: u64,
    pub v1_sha256: [u8; 32],
}

/// Reusable column buffers of the decoder.
pub struct Reader {
    i64s: [Column<i64>; 3],
    i32s: [Column<i32>; 5],
    decs: [Column<i64>; dec::COUNT],
    ints: [Column<i32>; int::COUNT],
    inexact: [Column<i32>; dec::COUNT],
}

impl Default for Reader {
    fn default() -> Self {
        Reader {
            i64s: std::array::from_fn(|_| Column::new()),
            i32s: std::array::from_fn(|_| Column::new()),
            decs: std::array::from_fn(|_| Column::new()),
            ints: std::array::from_fn(|_| Column::new()),
            inexact: std::array::from_fn(|_| Column::new()),
        }
    }
}

fn extend_list<T: Copy + Default>(offsets: &mut Vec<u32>, values: &mut Vec<T>, c: &Column<T>) {
    let base = values.len() as u32;
    values.extend_from_slice(&c.values);
    offsets.extend(c.starts()[1..].iter().map(|&s| base + s));
}

impl Reader {
    /// Footer identity of an M-19 file (no rows decoded).
    pub fn meta(data: Bytes) -> Result<Meta, String> {
        let reader = SerializedFileReader::new(data).map_err(err)?;
        Ok(footer(&reader)?.0)
    }

    /// Decodes a whole M-19 file into typed rows.
    pub fn read(&mut self, data: Bytes) -> Result<(Meta, TypedRows), String> {
        let reader = SerializedFileReader::new(data).map_err(err)?;
        let (meta, dict) = footer(&reader)?;
        let total: usize = reader
            .metadata()
            .row_groups()
            .iter()
            .map(|g| g.num_rows() as usize)
            .sum();
        let mut t = TypedRows {
            dict,
            ..TypedRows::default()
        };
        t.ingest_seq.reserve(total);
        t.ts_local_ms.reserve(total);
        t.ts_exchange_ms.reserve(total);
        t.flags.reserve(total);
        t.event_type.reserve(total);
        t.market.reserve(total);
        t.asset0.reserve(total);
        t.asset1.reserve(total);
        t.asset_index.reserve(total);
        for g in 0..reader.num_row_groups() {
            let rg = reader.get_row_group(g).map_err(err)?;
            let rows = rg.metadata().num_rows() as usize;
            let rg = rg.as_ref();
            let pq = |e: crate::typed::Unconvertible| e.to_string();
            for (k, c) in self.i64s.iter_mut().enumerate() {
                c.read::<Int64Type>(rg, C_SEQ + k, rows).map_err(pq)?;
            }
            for (k, c) in self.i32s.iter_mut().enumerate() {
                c.read::<Int32Type>(rg, C_EVENT + k, rows).map_err(pq)?;
            }
            for (k, c) in self.decs.iter_mut().enumerate() {
                c.read::<Int64Type>(rg, C_DEC + k, rows).map_err(pq)?;
            }
            for (k, c) in self.ints.iter_mut().enumerate() {
                c.read::<Int32Type>(rg, C_INT + k, rows).map_err(pq)?;
            }
            for (k, c) in self.inexact.iter_mut().enumerate() {
                c.read::<Int32Type>(rg, C_INEXACT + k, rows).map_err(pq)?;
            }
            let [seq, local, exch] = &self.i64s;
            let [event, market, a0, a1, ai] = &self.i32s;
            t.ingest_seq.extend_from_slice(&seq.values);
            t.ts_local_ms.extend_from_slice(&local.values);
            t.event_type.extend(event.values.iter().map(|&v| v as u8));
            t.market.extend(market.values.iter().map(|&v| v as u8));
            for r in 0..rows {
                let mut flags = 0;
                match exch.get(r) {
                    Some(&v) => t.ts_exchange_ms.push(v),
                    None => {
                        flags |= row_flags::TS_EXCHANGE_NULL;
                        t.ts_exchange_ms.push(0);
                    }
                }
                match ai.get(r) {
                    Some(&v) => t.asset_index.push(v),
                    None => {
                        flags |= row_flags::ASSET_INDEX_NULL;
                        t.asset_index.push(0);
                    }
                }
                t.flags.push(flags);
                t.asset0.push(a0.get(r).map_or(NULL_ID, |&v| v as u8));
                t.asset1.push(a1.get(r).map_or(NULL_ID, |&v| v as u8));
            }
            for (d, c) in self.decs.iter().enumerate() {
                let l = &mut t.decimals[d];
                let v0 = l.values.len() as u32;
                // validate() rejects positions outside their row.
                for (r, &start) in c.starts()[..rows].iter().enumerate() {
                    for &pos in self.inexact[d].row(r) {
                        l.inexact.push(v0 + start + pos as u32);
                    }
                }
                extend_list(&mut l.offsets, &mut l.values, c);
            }
            for (i, c) in self.ints.iter().enumerate() {
                let l = &mut t.ints[i];
                extend_list(&mut l.offsets, &mut l.values, c);
            }
        }
        t.validate()?;
        Ok((meta, t))
    }
}

fn footer(reader: &SerializedFileReader<Bytes>) -> Result<(Meta, Vec<Vec<u8>>), String> {
    let kv = reader
        .metadata()
        .file_metadata()
        .key_value_metadata()
        .ok_or("no footer metadata")?;
    let get = |k: &str| {
        kv.iter()
            .find(|e| e.key == k)
            .and_then(|e| e.value.clone())
            .ok_or_else(|| format!("footer key {k} missing"))
    };
    if get(FORMAT_KEY)? != FORMAT_VALUE {
        return Err("not an M-19 typed-rows file".into());
    }
    let meta = Meta {
        v1_bytes: get("pmb_v1_bytes")?.parse().map_err(err)?,
        v1_sha256: parse_hex32(&get("pmb_v1_sha256")?).ok_or("bad pmb_v1_sha256")?,
    };
    let dict_text = get("pmb_dict")?;
    let dict = if dict_text.is_empty() {
        Vec::new()
    } else {
        dict_text
            .split(',')
            .map(|h| {
                (0..h.len())
                    .step_by(2)
                    .map(|i| u8::from_str_radix(h.get(i..i + 2).unwrap_or("x"), 16))
                    .collect::<Result<Vec<u8>, _>>()
                    .map_err(err)
            })
            .collect::<Result<_, _>>()?
    };
    Ok((meta, dict))
}
