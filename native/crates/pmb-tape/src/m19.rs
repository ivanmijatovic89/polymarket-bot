//! M-19 measured alternative (16 NT-3, §15.2): the same typed rows as a
//! flat Parquet file of INT64/INT32 columns with ZSTD, one row group per
//! 65,536 rows. Repeated columns hold the lists (DuckDB reads them as
//! lists); the id dictionary, the v1 identity and the (rare) inexact value
//! indices sit in the footer's key-value metadata, so no mostly-empty list
//! columns cost level decoding. Bench-only: `pmb-tape m19-convert` writes
//! these files under the tape root and `pmb-tape bench --configs
//! ...,pq-full,pq-rows` times them; executors never read them.

use crate::codec::V1Identity;
use crate::store::{hex, parse_hex32};
use crate::typed::{dec, int, row_flags, TypedRows, NULL_ID};
use crate::v1::Column;
use bytes::Bytes;
use parquet::basic::{Compression, Encoding, ZstdLevel};
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
const N_COLS: usize = C_INT + int::COUNT;

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

/// Parquet column encoding of an M-19 file (both ZSTD-compressed).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Variant {
    /// parquet-rs writer defaults: dictionary pages, PLAIN fallback.
    PlainDict,
    /// No dictionary; DELTA_BINARY_PACKED for every integer column (the
    /// Parquet counterpart of the tape's delta and width coding).
    Delta,
}

impl Variant {
    pub fn name(self) -> &'static str {
        match self {
            Variant::PlainDict => "plain-dict",
            Variant::Delta => "delta",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        [Variant::PlainDict, Variant::Delta]
            .into_iter()
            .find(|v| v.name() == s)
    }
}

/// Encodes typed rows as an M-19 Parquet file.
pub fn encode(
    t: &TypedRows,
    v1: &V1Identity,
    zstd_level: i32,
    variant: Variant,
) -> Result<Vec<u8>, String> {
    t.validate()?;
    let schema = Arc::new(parse_message_type(MESSAGE).map_err(err)?);
    let dict = t.dict.iter().map(|e| hex(e)).collect::<Vec<_>>().join(",");
    let kv = vec![
        KeyValue::new(FORMAT_KEY.into(), FORMAT_VALUE.to_string()),
        KeyValue::new("pmb_v1_bytes".into(), v1.bytes.to_string()),
        KeyValue::new("pmb_v1_mtime_ns".into(), v1.mtime_ns.to_string()),
        KeyValue::new("pmb_v1_sha256".into(), hex(&v1.sha256)),
        KeyValue::new("pmb_dict".into(), dict),
        KeyValue::new("pmb_inexact".into(), inexact_text(t)),
        KeyValue::new("pmb_m19_variant".into(), variant.name().to_string()),
    ];
    let mut props = WriterProperties::builder()
        .set_compression(Compression::ZSTD(
            ZstdLevel::try_new(zstd_level).map_err(err)?,
        ))
        .set_max_row_group_size(ROW_GROUP_ROWS)
        .set_key_value_metadata(Some(kv));
    if variant == Variant::Delta {
        props = props
            .set_dictionary_enabled(false)
            .set_encoding(Encoding::DELTA_BINARY_PACKED);
    }
    let props = Arc::new(props.build());
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
                (i, ColumnWriter::Int32ColumnWriter(cw)) if (C_INT..N_COLS).contains(&i) => {
                    let l = &t.ints[i - C_INT];
                    let (def, rep) = list_levels(&l.offsets, r0, r1);
                    let span = l.offsets[r0] as usize..l.offsets[r1] as usize;
                    cw.write_batch(&l.values[span], Some(&def), Some(&rep))
                        .map_err(err)?;
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

/// Inexact value indices per decimal list: lists separated by `;`, indices
/// by `,` (real markets have none).
fn inexact_text(t: &TypedRows) -> String {
    t.decimals
        .iter()
        .map(|l| {
            l.inexact
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn parse_inexact(text: &str) -> Result<[Vec<u32>; dec::COUNT], String> {
    let lists: Vec<&str> = text.split(';').collect();
    if lists.len() != dec::COUNT {
        return Err(format!("pmb_inexact has {} lists", lists.len()));
    }
    let mut out: [Vec<u32>; dec::COUNT] = Default::default();
    for (d, l) in lists.iter().enumerate() {
        if !l.is_empty() {
            out[d] = l
                .split(',')
                .map(|x| x.parse::<u32>().map_err(err))
                .collect::<Result<_, _>>()?;
        }
    }
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
}

impl Default for Reader {
    fn default() -> Self {
        Reader {
            i64s: std::array::from_fn(|_| Column::new()),
            i32s: std::array::from_fn(|_| Column::new()),
            decs: std::array::from_fn(|_| Column::new()),
            ints: std::array::from_fn(|_| Column::new()),
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
        let (meta, dict, inexact) = footer(&reader)?;
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
            let [seq, local, exch] = &self.i64s;
            let [event, market, a0, a1, ai] = &self.i32s;
            t.ingest_seq.extend_from_slice(&seq.values);
            t.ts_local_ms.extend_from_slice(&local.values);
            // Codes and ids were written from u8; anything else is corrupt.
            let byte = |v: i32| u8::try_from(v).map_err(|_| format!("code or id {v} out of range"));
            for &v in &event.values {
                t.event_type.push(byte(v)?);
            }
            for &v in &market.values {
                t.market.push(byte(v)?);
            }
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
                t.asset0.push(a0.get(r).map_or(Ok(NULL_ID), |&v| byte(v))?);
                t.asset1.push(a1.get(r).map_or(Ok(NULL_ID), |&v| byte(v))?);
            }
            for (d, c) in self.decs.iter().enumerate() {
                let l = &mut t.decimals[d];
                extend_list(&mut l.offsets, &mut l.values, c);
            }
            for (i, c) in self.ints.iter().enumerate() {
                let l = &mut t.ints[i];
                extend_list(&mut l.offsets, &mut l.values, c);
            }
        }
        for (l, idx) in t.decimals.iter_mut().zip(inexact) {
            l.inexact = idx; // validate() rejects bad indices
        }
        t.validate()?;
        Ok((meta, t))
    }
}

type Footer = (Meta, Vec<Vec<u8>>, [Vec<u32>; dec::COUNT]);

fn footer(reader: &SerializedFileReader<Bytes>) -> Result<Footer, String> {
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
    Ok((meta, dict, parse_inexact(&get("pmb_inexact")?)?))
}
