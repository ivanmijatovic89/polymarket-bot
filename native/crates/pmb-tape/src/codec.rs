//! On-disk tape format, version 2 (16 §7.5 NT-1, NT-3).
//!
//! ```text
//! prefix   magic "PMBTAPE\0" | format_version u32 | meta_comp_len u32 | meta_raw_len u32
//! meta     one zstd frame (checksum on): v1 identity (bytes, mtime_ns, sha256),
//!          tool binary sha256, zstd level, block rows, row count, value count
//!          per list, inexact count per decimal list, id dictionary, and per
//!          block: rows, delta bases, and per column (offset, comp_len,
//!          raw_len, width, scale)
//! data     one zstd frame (checksum on) per column per block, offsets
//!          relative to the end of the meta frame; nothing after the last frame
//! ```
//!
//! All integers are little-endian. Integer columns are stored at the smallest
//! signed width (1, 2, 4 or 8 bytes) that holds every value of the frame;
//! fixed-point decimal frames are first divided by the largest power of ten
//! that divides all their values (prices on a 0.001 grid fit in 2 bytes);
//! `ingest_seq` and both timestamps are delta-coded against the block's base
//! (a null `ts_exchange_ms` repeats the previous value, delta 0). A block
//! holds `block_rows` rows (65,536 by default) and every list value of them.

use crate::typed::{dec, int, row_flags, TypedRows};
use std::fmt;
use zstd::bulk::{Compressor, Decompressor};
use zstd::zstd_safe::CParameter;

/// File magic.
pub const MAGIC: [u8; 8] = *b"PMBTAPE\0";
/// Tape format version; bumped only when the typed-row layer or this
/// encoding changes (NT-2), never for reader semantics. Version 2: the
/// layout of version 1, but the typed-row layer admits only files the
/// reviewed v1 reader accepts by schema (annotations, footer keys) and that
/// hold no value it refuses with a text the tape does not keep (ids that
/// are not UTF-8, decimals outside its ranges, lists beyond `u16`), so a
/// version-1 tape may describe a file the reader now refuses.
pub const FORMAT_VERSION: u32 = 2;
/// Rows per block (~64 k, NT-3).
pub const DEFAULT_BLOCK_ROWS: u32 = 65_536;
/// zstd level of the published tool (decode speed does not depend on it).
pub const DEFAULT_ZSTD_LEVEL: i32 = 3;

const PREFIX_LEN: usize = 8 + 4 + 4 + 4;
/// Largest meta frame a reader accepts (a 64 k-block tape needs ~53 MB).
const MAX_META_RAW: usize = 64 << 20;
const MAX_SCALE: u8 = 18;
const POW10: [i64; 19] = {
    let mut t = [1i64; 19];
    let mut i = 1;
    while i < 19 {
        t[i] = t[i - 1] * 10;
        i += 1;
    }
    t
};
/// zstd frame magic and the Content_Checksum_flag of its header descriptor.
const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];
const ZSTD_CHECKSUM_FLAG: u8 = 0x04;

/// Number of list columns: the decimal lists, then the integer lists.
pub const N_LISTS: usize = dec::COUNT + int::COUNT;

/// Column ids inside a block.
pub mod col {
    use super::N_LISTS;
    use crate::typed::dec;
    pub const INGEST_SEQ: usize = 0;
    pub const TS_LOCAL: usize = 1;
    pub const TS_EXCHANGE: usize = 2;
    pub const FLAGS: usize = 3;
    pub const EVENT_TYPE: usize = 4;
    pub const MARKET: usize = 5;
    pub const ASSET0: usize = 6;
    pub const ASSET1: usize = 7;
    pub const ASSET_INDEX: usize = 8;
    /// Per-row length of list `l` (decimal lists first, then integer lists).
    pub const LIST_LEN: usize = 9;
    /// Values of decimal list `d`.
    pub const DEC_VALUES: usize = LIST_LEN + N_LISTS;
    /// Values of integer list `i`.
    pub const INT_VALUES: usize = DEC_VALUES + dec::COUNT;
    /// Block-relative indices of the inexact values of decimal list `d`.
    pub const INEXACT: usize = INT_VALUES + crate::typed::int::COUNT;
    pub const COUNT: usize = INEXACT + dec::COUNT;
}

/// Identity of the v1 file a tape was built from (NT-1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct V1Identity {
    pub bytes: u64,
    pub mtime_ns: i64,
    pub sha256: [u8; 32],
}

/// One column frame of one block.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ColMeta {
    /// Offset of the frame from the start of the data section.
    pub offset: u64,
    pub comp_len: u32,
    pub raw_len: u32,
    /// Bytes per value (1 for byte columns).
    pub width: u8,
    /// Decimal value columns only: stored values are `value / 10^scale`
    /// (the largest power of ten dividing every value of the frame).
    pub scale: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockMeta {
    pub rows: u32,
    /// Delta bases of `ingest_seq`, `ts_local_ms`, `ts_exchange_ms`.
    pub bases: [i64; 3],
    pub cols: Vec<ColMeta>,
}

/// Parsed tape header (prefix and meta frame).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TapeHeader {
    pub format_version: u32,
    pub v1: V1Identity,
    pub tool_sha256: [u8; 32],
    pub zstd_level: i32,
    pub block_rows: u32,
    pub rows: u64,
    /// Values per list column (decimal lists, then integer lists).
    pub list_values: [u64; N_LISTS],
    /// Inexact decimals per decimal list.
    pub inexact: [u64; dec::COUNT],
    pub dict: Vec<Vec<u8>>,
    pub blocks: Vec<BlockMeta>,
    /// File offset of the data section.
    pub data_offset: u64,
}

impl TapeHeader {
    /// Book levels plus price changes.
    pub fn levels(&self) -> u64 {
        self.list_values[dec::BID_PRICES]
            + self.list_values[dec::ASK_PRICES]
            + self.list_values[dec::CHANGE_PRICES]
    }
}

/// Why a tape could not be read. Never surfaced as a job error: the caller
/// falls back to v1 (NT-5).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TapeError {
    Truncated,
    BadMagic,
    /// A format version this engine does not support.
    Version(u32),
    /// A zstd frame failed (checksum, corrupt data, missing checksum flag).
    Frame(String),
    /// Inconsistent layout (lengths, offsets, codes).
    Layout(String),
}

impl fmt::Display for TapeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TapeError::Truncated => write!(f, "truncated"),
            TapeError::BadMagic => write!(f, "bad magic"),
            TapeError::Version(v) => write!(f, "unsupported tape format version {v}"),
            TapeError::Frame(d) => write!(f, "frame: {d}"),
            TapeError::Layout(d) => write!(f, "layout: {d}"),
        }
    }
}

impl std::error::Error for TapeError {}

fn layout(d: impl Into<String>) -> TapeError {
    TapeError::Layout(d.into())
}

/// Encoder settings.
#[derive(Clone, Copy, Debug)]
pub struct EncodeOptions {
    pub block_rows: u32,
    pub zstd_level: i32,
}

impl Default for EncodeOptions {
    fn default() -> Self {
        EncodeOptions {
            block_rows: DEFAULT_BLOCK_ROWS,
            zstd_level: DEFAULT_ZSTD_LEVEL,
        }
    }
}

// ---------------------------------------------------------------- encoding

fn width_of(min: i64, max: i64) -> u8 {
    if min >= i8::MIN as i64 && max <= i8::MAX as i64 {
        1
    } else if min >= i16::MIN as i64 && max <= i16::MAX as i64 {
        2
    } else if min >= i32::MIN as i64 && max <= i32::MAX as i64 {
        4
    } else {
        8
    }
}

/// Largest power-of-ten exponent dividing every value (≤ 18; 0 when all are 0).
fn common_scale(values: &[i64]) -> u8 {
    let mut e = MAX_SCALE;
    for &v in values {
        while e > 0 && v % POW10[e as usize] != 0 {
            e -= 1;
        }
        if e == 0 {
            break;
        }
    }
    if values.iter().all(|&v| v == 0) {
        0
    } else {
        e
    }
}

/// Writes `values` at their smallest width; returns the width.
fn put_ints(values: &[i64], out: &mut Vec<u8>) -> u8 {
    let (mut lo, mut hi) = (0i64, 0i64);
    for &v in values {
        lo = lo.min(v);
        hi = hi.max(v);
    }
    let w = width_of(lo, hi);
    out.reserve(values.len() * w as usize);
    match w {
        1 => out.extend(values.iter().map(|&v| v as i8 as u8)),
        2 => values
            .iter()
            .for_each(|&v| out.extend_from_slice(&(v as i16).to_le_bytes())),
        4 => values
            .iter()
            .for_each(|&v| out.extend_from_slice(&(v as i32).to_le_bytes())),
        _ => values
            .iter()
            .for_each(|&v| out.extend_from_slice(&v.to_le_bytes())),
    }
    w
}

struct FrameWriter {
    cctx: Compressor<'static>,
    data: Vec<u8>,
    raw: Vec<u8>,
    ints: Vec<i64>,
}

impl FrameWriter {
    /// Compresses `self.raw` as one checksummed frame and appends it.
    fn flush(&mut self, width: u8, scale: u8) -> std::io::Result<ColMeta> {
        let frame = self.cctx.compress(&self.raw)?;
        let meta = ColMeta {
            offset: self.data.len() as u64,
            comp_len: u32::try_from(frame.len()).map_err(std::io::Error::other)?,
            raw_len: u32::try_from(self.raw.len()).map_err(std::io::Error::other)?,
            width,
            scale,
        };
        self.data.extend_from_slice(&frame);
        self.raw.clear();
        Ok(meta)
    }

    fn bytes(&mut self, values: &[u8]) -> std::io::Result<ColMeta> {
        self.raw.extend_from_slice(values);
        self.flush(1, 0)
    }

    fn ints(&mut self) -> std::io::Result<ColMeta> {
        let w = put_ints(&self.ints, &mut self.raw);
        self.ints.clear();
        self.flush(w, 0)
    }

    /// Fixed-point values, divided by their common power of ten.
    fn decimals(&mut self) -> std::io::Result<ColMeta> {
        let scale = common_scale(&self.ints);
        if scale > 0 {
            let m = POW10[scale as usize];
            self.ints.iter_mut().for_each(|v| *v /= m);
        }
        let w = put_ints(&self.ints, &mut self.raw);
        self.ints.clear();
        self.flush(w, scale)
    }
}

/// Delta-codes `values[r0..r1]` against the first value (returned as base).
fn deltas(values: &[i64], out: &mut Vec<i64>) -> i64 {
    let base = values.first().copied().unwrap_or(0);
    let mut prev = base;
    for &v in values {
        out.push(v.wrapping_sub(prev));
        prev = v;
    }
    base
}

/// Encodes typed rows into a complete tape file.
pub fn encode(
    rows: &TypedRows,
    v1: V1Identity,
    tool_sha256: [u8; 32],
    opts: &EncodeOptions,
) -> std::io::Result<Vec<u8>> {
    if opts.block_rows == 0 {
        return Err(std::io::Error::other("block_rows must be positive"));
    }
    rows.validate().map_err(std::io::Error::other)?;
    let mut cctx = Compressor::new(opts.zstd_level)?;
    cctx.set_parameter(CParameter::ChecksumFlag(true))?;
    let mut w = FrameWriter {
        cctx,
        data: Vec::new(),
        raw: Vec::new(),
        ints: Vec::new(),
    };
    let n = rows.len();
    let bs = opts.block_rows as usize;
    let mut blocks = Vec::with_capacity(n.div_ceil(bs));
    let mut r0 = 0;
    while r0 < n {
        let r1 = (r0 + bs).min(n);
        let mut cols = vec![ColMeta::default(); col::COUNT];
        let mut bases = [0i64; 3];

        bases[0] = deltas(&rows.ingest_seq[r0..r1], &mut w.ints);
        cols[col::INGEST_SEQ] = w.ints()?;
        bases[1] = deltas(&rows.ts_local_ms[r0..r1], &mut w.ints);
        cols[col::TS_LOCAL] = w.ints()?;
        // Null exchange times repeat the previous value (delta 0).
        let is_null = |r: usize| rows.flags[r] & row_flags::TS_EXCHANGE_NULL != 0;
        let mut prev = (r0..r1)
            .find(|&r| !is_null(r))
            .map_or(0, |r| rows.ts_exchange_ms[r]);
        bases[2] = prev;
        for r in r0..r1 {
            if is_null(r) {
                w.ints.push(0);
            } else {
                let v = rows.ts_exchange_ms[r];
                w.ints.push(v.wrapping_sub(prev));
                prev = v;
            }
        }
        cols[col::TS_EXCHANGE] = w.ints()?;

        cols[col::FLAGS] = w.bytes(&rows.flags[r0..r1])?;
        cols[col::EVENT_TYPE] = w.bytes(&rows.event_type[r0..r1])?;
        cols[col::MARKET] = w.bytes(&rows.market[r0..r1])?;
        cols[col::ASSET0] = w.bytes(&rows.asset0[r0..r1])?;
        cols[col::ASSET1] = w.bytes(&rows.asset1[r0..r1])?;
        w.ints
            .extend(rows.asset_index[r0..r1].iter().map(|&v| v as i64));
        cols[col::ASSET_INDEX] = w.ints()?;

        let offsets: [&[u32]; N_LISTS] = std::array::from_fn(|l| {
            if l < dec::COUNT {
                rows.decimals[l].offsets.as_slice()
            } else {
                rows.ints[l - dec::COUNT].offsets.as_slice()
            }
        });
        for (l, off) in offsets.iter().enumerate() {
            w.ints
                .extend(off[r0..=r1].windows(2).map(|p| (p[1] - p[0]) as i64));
            cols[col::LIST_LEN + l] = w.ints()?;
        }
        // Frames are written in column-id order (the decoder checks it).
        let span = |offsets: &[u32]| (offsets[r0] as usize, offsets[r1] as usize);
        for (d, list) in rows.decimals.iter().enumerate() {
            let (v0, v1) = span(&list.offsets);
            w.ints.extend_from_slice(&list.values[v0..v1]);
            cols[col::DEC_VALUES + d] = w.decimals()?;
        }
        for (i, list) in rows.ints.iter().enumerate() {
            let (v0, v1) = span(&list.offsets);
            w.ints.extend(list.values[v0..v1].iter().map(|&v| v as i64));
            cols[col::INT_VALUES + i] = w.ints()?;
        }
        for (d, list) in rows.decimals.iter().enumerate() {
            let (v0, v1) = span(&list.offsets);
            let lo = list.inexact.partition_point(|&i| (i as usize) < v0);
            let hi = list.inexact.partition_point(|&i| (i as usize) < v1);
            w.ints.extend(
                list.inexact[lo..hi]
                    .iter()
                    .map(|&i| (i as usize - v0) as i64),
            );
            cols[col::INEXACT + d] = w.ints()?;
        }
        blocks.push(BlockMeta {
            rows: (r1 - r0) as u32,
            bases,
            cols,
        });
        r0 = r1;
    }

    let list_values: [u64; N_LISTS] = std::array::from_fn(|l| {
        if l < dec::COUNT {
            rows.decimals[l].values.len() as u64
        } else {
            rows.ints[l - dec::COUNT].values.len() as u64
        }
    });
    let header = TapeHeader {
        format_version: FORMAT_VERSION,
        v1,
        tool_sha256,
        zstd_level: opts.zstd_level,
        block_rows: opts.block_rows,
        rows: n as u64,
        list_values,
        inexact: std::array::from_fn(|d| rows.decimals[d].inexact.len() as u64),
        dict: rows.dict.clone(),
        blocks,
        data_offset: 0,
    };
    let meta_raw = write_meta(&header);
    let meta = w.cctx.compress(&meta_raw)?;
    let mut out = Vec::with_capacity(PREFIX_LEN + meta.len() + w.data.len());
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(&(meta.len() as u32).to_le_bytes());
    out.extend_from_slice(&(meta_raw.len() as u32).to_le_bytes());
    out.extend_from_slice(&meta);
    out.extend_from_slice(&w.data);
    Ok(out)
}

fn write_meta(h: &TapeHeader) -> Vec<u8> {
    let mut m = Vec::new();
    m.extend_from_slice(&h.v1.bytes.to_le_bytes());
    m.extend_from_slice(&h.v1.mtime_ns.to_le_bytes());
    m.extend_from_slice(&h.v1.sha256);
    m.extend_from_slice(&h.tool_sha256);
    m.extend_from_slice(&h.zstd_level.to_le_bytes());
    m.extend_from_slice(&h.block_rows.to_le_bytes());
    m.extend_from_slice(&h.rows.to_le_bytes());
    for v in h.list_values {
        m.extend_from_slice(&v.to_le_bytes());
    }
    for v in h.inexact {
        m.extend_from_slice(&v.to_le_bytes());
    }
    m.extend_from_slice(&(h.dict.len() as u32).to_le_bytes());
    for e in &h.dict {
        m.extend_from_slice(&(e.len() as u32).to_le_bytes());
        m.extend_from_slice(e);
    }
    m.extend_from_slice(&(h.blocks.len() as u32).to_le_bytes());
    m.extend_from_slice(&(col::COUNT as u32).to_le_bytes());
    for b in &h.blocks {
        m.extend_from_slice(&b.rows.to_le_bytes());
        for v in b.bases {
            m.extend_from_slice(&v.to_le_bytes());
        }
        for c in &b.cols {
            m.extend_from_slice(&c.offset.to_le_bytes());
            m.extend_from_slice(&c.comp_len.to_le_bytes());
            m.extend_from_slice(&c.raw_len.to_le_bytes());
            m.push(c.width);
            m.push(c.scale);
        }
    }
    m
}

// ---------------------------------------------------------------- decoding

struct Cursor<'a> {
    b: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], TapeError> {
        let end = self.at.checked_add(n).ok_or(TapeError::Truncated)?;
        let s = self.b.get(self.at..end).ok_or(TapeError::Truncated)?;
        self.at = end;
        Ok(s)
    }
    fn arr<const N: usize>(&mut self) -> Result<[u8; N], TapeError> {
        Ok(self.take(N)?.try_into().expect("length checked"))
    }
    fn u8(&mut self) -> Result<u8, TapeError> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32, TapeError> {
        Ok(u32::from_le_bytes(self.arr()?))
    }
    fn u64(&mut self) -> Result<u64, TapeError> {
        Ok(u64::from_le_bytes(self.arr()?))
    }
    fn i64(&mut self) -> Result<i64, TapeError> {
        Ok(i64::from_le_bytes(self.arr()?))
    }
    fn i32(&mut self) -> Result<i32, TapeError> {
        Ok(i32::from_le_bytes(self.arr()?))
    }
}

fn check_frame(frame: &[u8]) -> Result<(), TapeError> {
    if frame.len() < 5 || frame[..4] != ZSTD_MAGIC {
        return Err(TapeError::Frame("not a zstd frame".into()));
    }
    if frame[4] & ZSTD_CHECKSUM_FLAG == 0 {
        return Err(TapeError::Frame("frame without checksum".into()));
    }
    Ok(())
}

/// Reusable decoder (zstd context and scratch buffer).
pub struct Decoder {
    dctx: Decompressor<'static>,
    scratch: Vec<u8>,
    /// Reused per-block typed rows of [`Decoder::stream`].
    block: TypedRows,
    /// Reused file buffer of the store's tape reads.
    pub(crate) file: Vec<u8>,
}

impl Decoder {
    pub fn new() -> Result<Self, TapeError> {
        Ok(Decoder {
            dctx: Decompressor::new().map_err(|e| TapeError::Frame(e.to_string()))?,
            scratch: Vec::new(),
            block: TypedRows::default(),
            file: Vec::new(),
        })
    }

    /// Decompresses one frame into the scratch buffer.
    fn frame(&mut self, frame: &[u8], raw_len: usize) -> Result<&[u8], TapeError> {
        check_frame(frame)?;
        // The frame header's content size must agree before anything is
        // allocated for it (our encoder always writes it).
        match zstd::zstd_safe::get_frame_content_size(frame) {
            Ok(Some(n)) if n == raw_len as u64 => {}
            Ok(None) => {}
            Ok(Some(n)) => {
                return Err(TapeError::Frame(format!(
                    "frame content size {n}, expected {raw_len}"
                )))
            }
            Err(_) => return Err(TapeError::Frame("unreadable frame header".into())),
        }
        self.scratch.clear();
        reserve(&mut self.scratch, raw_len as u64)?;
        let n = self
            .dctx
            .decompress_to_buffer(frame, &mut self.scratch)
            .map_err(|e| TapeError::Frame(e.to_string()))?;
        if n != raw_len || self.scratch.len() != raw_len {
            return Err(TapeError::Frame(format!(
                "decompressed {n} bytes, expected {raw_len}"
            )));
        }
        Ok(&self.scratch)
    }

    /// Parses the prefix and the meta frame.
    pub fn header(&mut self, buf: &[u8]) -> Result<TapeHeader, TapeError> {
        let mut c = Cursor { b: buf, at: 0 };
        if c.take(8).map_err(|_| TapeError::BadMagic)? != MAGIC {
            return Err(TapeError::BadMagic);
        }
        let version = c.u32()?;
        if version != FORMAT_VERSION {
            return Err(TapeError::Version(version));
        }
        let comp_len = c.u32()? as usize;
        let raw_len = c.u32()? as usize;
        if raw_len > MAX_META_RAW {
            return Err(layout(format!("meta frame of {raw_len} bytes")));
        }
        let frame = c.take(comp_len)?;
        let data_offset = c.at as u64;
        let meta = self.frame(frame, raw_len)?.to_vec();
        let h = parse_meta(&meta, version, data_offset)?;
        data_section(buf, &h)?;
        Ok(h)
    }

    /// Decodes a whole tape, verifying every frame checksum and the layout.
    pub fn decode(&mut self, buf: &[u8]) -> Result<(TapeHeader, TypedRows), TapeError> {
        let h = self.header(buf)?;
        let rows = self.decode_body(buf, &h)?;
        Ok((h, rows))
    }

    /// Decodes the rows of a tape whose header was already parsed from `buf`.
    pub fn decode_rows(&mut self, buf: &[u8], h: &TapeHeader) -> Result<TypedRows, TapeError> {
        self.decode_body(buf, h)
    }

    fn decode_body(&mut self, buf: &[u8], h: &TapeHeader) -> Result<TypedRows, TapeError> {
        let n = usize::try_from(h.rows).map_err(|_| layout("row count"))?;
        let data = data_section(buf, h)?;
        let mut t = TypedRows {
            dict: h.dict.clone(),
            ..TypedRows::default()
        };
        // The header counts were checked against the block layout by
        // `parse_meta`; reservations still fail softly (NT-5: a bad tape is
        // a fallback, never a panic or an abort).
        let rows = h.rows;
        reserve(&mut t.ingest_seq, rows)?;
        reserve(&mut t.ts_local_ms, rows)?;
        reserve(&mut t.ts_exchange_ms, rows)?;
        reserve(&mut t.flags, rows)?;
        reserve(&mut t.event_type, rows)?;
        reserve(&mut t.market, rows)?;
        reserve(&mut t.asset0, rows)?;
        reserve(&mut t.asset1, rows)?;
        reserve(&mut t.asset_index, rows)?;
        for (d, list) in t.decimals.iter_mut().enumerate() {
            reserve(&mut list.offsets, rows)?;
            reserve(&mut list.values, h.list_values[d])?;
            reserve(&mut list.inexact, h.inexact[d])?;
        }
        for (i, list) in t.ints.iter_mut().enumerate() {
            reserve(&mut list.offsets, rows)?;
            reserve(&mut list.values, h.list_values[dec::COUNT + i])?;
        }
        for b in &h.blocks {
            self.decode_block(data, b, &mut t)?;
        }
        check_totals(h, n, |l| list_len(&t, l), |d| t.decimals[d].inexact.len())?;
        t.validate().map_err(TapeError::Layout)?;
        Ok(t)
    }

    /// Streams the rows of a tape block by block through `f` (block rows and
    /// the index of their first row), reusing one buffer. Every block is
    /// validated before `f` sees it and the totals are checked at the end.
    /// The outer error is the tape's (fall back to v1), the inner `f`'s.
    pub fn stream<E>(
        &mut self,
        buf: &[u8],
        h: &TapeHeader,
        mut f: impl FnMut(&TypedRows, usize) -> Result<(), E>,
    ) -> Result<Result<(), E>, TapeError> {
        let data = data_section(buf, h)?;
        let mut block = std::mem::take(&mut self.block);
        let result = (|| {
            let mut row0 = 0usize;
            let mut values = [0usize; N_LISTS];
            let mut inexact = [0usize; dec::COUNT];
            for b in &h.blocks {
                block.reset(&h.dict);
                self.decode_block(data, b, &mut block)?;
                block.validate().map_err(TapeError::Layout)?;
                for (l, v) in values.iter_mut().enumerate() {
                    *v += list_len(&block, l);
                }
                for (d, v) in inexact.iter_mut().enumerate() {
                    *v += block.decimals[d].inexact.len();
                }
                if let Err(e) = f(&block, row0) {
                    return Ok(Err(e));
                }
                row0 += block.len();
            }
            check_totals(h, row0, |l| values[l], |d| inexact[d])?;
            Ok(Ok(()))
        })();
        self.block = block;
        result
    }

    /// Appends the rows of one block to `t`.
    fn decode_block(
        &mut self,
        data: &[u8],
        b: &BlockMeta,
        t: &mut TypedRows,
    ) -> Result<(), TapeError> {
        {
            let rows = b.rows as usize;
            let frame = |c: &ColMeta| -> Result<&[u8], TapeError> {
                let s = c.offset as usize;
                data.get(s..s + c.comp_len as usize)
                    .ok_or(TapeError::Truncated)
            };

            // Byte columns first: the exchange-time decode needs the flags.
            let flags_start = t.flags.len();
            for (id, out) in [
                (col::FLAGS, &mut t.flags),
                (col::EVENT_TYPE, &mut t.event_type),
                (col::MARKET, &mut t.market),
                (col::ASSET0, &mut t.asset0),
                (col::ASSET1, &mut t.asset1),
            ] {
                let c = &b.cols[id];
                if c.width != 1 || c.raw_len as usize != rows {
                    return Err(layout(format!("byte column {id}: bad shape")));
                }
                out.extend_from_slice(self.frame(frame(c)?, rows)?);
            }

            for (id, base, out) in [
                (col::INGEST_SEQ, b.bases[0], &mut t.ingest_seq),
                (col::TS_LOCAL, b.bases[1], &mut t.ts_local_ms),
                (col::TS_EXCHANGE, b.bases[2], &mut t.ts_exchange_ms),
            ] {
                let c = &b.cols[id];
                let raw = self.frame(frame(c)?, c.raw_len as usize)?;
                let mut acc = base;
                let count = extend_ints(raw, c.width, out, |d| {
                    acc = acc.wrapping_add(d);
                    acc
                })?;
                if count != rows {
                    return Err(layout(format!("column {id}: {count} of {rows} rows")));
                }
            }
            // Null exchange times carry the previous value (delta 0); their slot is 0.
            let flags = &t.flags[flags_start..];
            let ts = &mut t.ts_exchange_ms[flags_start..];
            for (v, &f) in ts.iter_mut().zip(flags) {
                if f & row_flags::TS_EXCHANGE_NULL != 0 {
                    *v = 0;
                }
            }
            {
                let c = &b.cols[col::ASSET_INDEX];
                let raw = self.frame(frame(c)?, c.raw_len as usize)?;
                if c.width > 4 {
                    return Err(layout("asset_index wider than i32"));
                }
                let count = extend_ints(raw, c.width, &mut t.asset_index, |v| v as i32)?;
                if count != rows {
                    return Err(layout("asset_index: row count"));
                }
            }

            let mut block_values = [0usize; N_LISTS];
            for (l, slot) in block_values.iter_mut().enumerate() {
                let c = &b.cols[col::LIST_LEN + l];
                let raw = self.frame(frame(c)?, c.raw_len as usize)?;
                let offsets = if l < dec::COUNT {
                    &mut t.decimals[l].offsets
                } else {
                    &mut t.ints[l - dec::COUNT].offsets
                };
                let start = *offsets.last().expect("offsets start with 0") as i64;
                // Negative lengths make offsets decrease, which validate() rejects.
                let mut acc = start;
                let count = extend_ints(raw, c.width, offsets, |len| {
                    acc = acc.wrapping_add(len);
                    acc as u32
                })?;
                if count != rows || acc < start || acc > u32::MAX as i64 {
                    return Err(layout(format!("list {l}: bad lengths")));
                }
                *slot = (acc - start) as usize;
            }
            for (d, &expected) in block_values[..dec::COUNT].iter().enumerate() {
                let c = &b.cols[col::DEC_VALUES + d];
                let raw = self.frame(frame(c)?, c.raw_len as usize)?;
                let list = &mut t.decimals[d];
                let v0 = list.values.len();
                if c.scale > MAX_SCALE {
                    return Err(layout(format!("{}: scale {}", dec::NAMES[d], c.scale)));
                }
                let count = if c.scale == 0 {
                    extend_ints(raw, c.width, &mut list.values, |v| v)?
                } else {
                    let m = POW10[c.scale as usize];
                    extend_ints(raw, c.width, &mut list.values, |v| v.wrapping_mul(m))?
                };
                if count != expected {
                    return Err(layout(format!("{}: value count", dec::NAMES[d])));
                }
                let c = &b.cols[col::INEXACT + d];
                let raw = self.frame(frame(c)?, c.raw_len as usize)?;
                let i0 = list.inexact.len();
                extend_ints(raw, c.width, &mut list.inexact, |i| {
                    (v0 as i64).wrapping_add(i) as u32
                })?;
                let (lo, hi) = (v0 as u64, (v0 + count) as u64);
                if list.inexact[i0..]
                    .iter()
                    .any(|&x| (x as u64) < lo || (x as u64) >= hi)
                {
                    return Err(layout(format!("{}: inexact index", dec::NAMES[d])));
                }
            }
            for i in 0..int::COUNT {
                let c = &b.cols[col::INT_VALUES + i];
                if c.width > 4 {
                    return Err(layout("int list wider than i32"));
                }
                let raw = self.frame(frame(c)?, c.raw_len as usize)?;
                let count = extend_ints(raw, c.width, &mut t.ints[i].values, |v| v as i32)?;
                if count != block_values[dec::COUNT + i] {
                    return Err(layout(format!("{}: value count", int::NAMES[i])));
                }
            }
        }
        Ok(())
    }
}

/// Reserves room for `n` more values without panicking or aborting.
pub(crate) fn reserve<T>(v: &mut Vec<T>, n: u64) -> Result<(), TapeError> {
    let n = usize::try_from(n).map_err(|_| layout(format!("{n} values")))?;
    v.try_reserve(n)
        .map_err(|e| layout(format!("cannot reserve {n} values: {e}")))
}

fn list_len(t: &TypedRows, l: usize) -> usize {
    if l < dec::COUNT {
        t.decimals[l].values.len()
    } else {
        t.ints[l - dec::COUNT].values.len()
    }
}

/// Rows, list values and inexact counts against the header.
fn check_totals(
    h: &TapeHeader,
    rows: usize,
    values: impl Fn(usize) -> usize,
    inexact: impl Fn(usize) -> usize,
) -> Result<(), TapeError> {
    if rows as u64 != h.rows {
        return Err(layout("row count"));
    }
    for l in 0..N_LISTS {
        if values(l) as u64 != h.list_values[l] {
            return Err(layout(format!("list {l}: value count")));
        }
    }
    for d in 0..dec::COUNT {
        if inexact(d) as u64 != h.inexact[d] {
            return Err(layout(format!("{}: inexact count", dec::NAMES[d])));
        }
    }
    Ok(())
}

/// The data section, after checking that the frames are contiguous in
/// (block, column) order and fill it exactly, so every byte after the
/// prefix is under a checksum.
fn data_section<'b>(buf: &'b [u8], h: &TapeHeader) -> Result<&'b [u8], TapeError> {
    let data = buf
        .get(h.data_offset as usize..)
        .ok_or(TapeError::Truncated)?;
    let mut pos = 0u64;
    for (i, c) in h.blocks.iter().flat_map(|b| &b.cols).enumerate() {
        if c.offset != pos {
            return Err(layout(format!(
                "frame {i} at {} (expected {pos})",
                c.offset
            )));
        }
        pos += c.comp_len as u64;
    }
    if pos != data.len() as u64 {
        return Err(layout(format!(
            "data section is {} bytes, frames end at {pos}",
            data.len()
        )));
    }
    Ok(data)
}

/// Appends `f(value)` for every value of a width-coded frame; returns the count.
#[inline]
fn extend_ints<T>(
    raw: &[u8],
    width: u8,
    out: &mut Vec<T>,
    mut f: impl FnMut(i64) -> T,
) -> Result<usize, TapeError> {
    let w = width as usize;
    if !matches!(w, 1 | 2 | 4 | 8) || raw.len() % w != 0 {
        return Err(layout(format!("width {w} for {} bytes", raw.len())));
    }
    match w {
        1 => out.extend(raw.iter().map(|&b| f(b as i8 as i64))),
        2 => out.extend(
            raw.chunks_exact(2)
                .map(|c| f(i16::from_le_bytes([c[0], c[1]]) as i64)),
        ),
        4 => out.extend(
            raw.chunks_exact(4)
                .map(|c| f(i32::from_le_bytes([c[0], c[1], c[2], c[3]]) as i64)),
        ),
        _ => out.extend(raw.chunks_exact(8).map(|c| {
            f(i64::from_le_bytes([
                c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7],
            ]))
        })),
    }
    Ok(raw.len() / w)
}

/// Values in one frame: its raw length over a valid width.
fn frame_values(c: &ColMeta, id: usize) -> Result<u64, TapeError> {
    let w = u32::from(c.width);
    if !matches!(w, 1 | 2 | 4 | 8) || c.raw_len % w != 0 {
        return Err(layout(format!(
            "column {id}: width {w} for {} bytes",
            c.raw_len
        )));
    }
    Ok(u64::from(c.raw_len / w))
}

/// Checks one block's column shapes and adds its list and inexact value
/// counts to the running totals (checked arithmetic).
fn check_block(
    cols: &[ColMeta],
    rows: u32,
    block_rows: u32,
    values: &mut [u64; N_LISTS],
    inexact: &mut [u64; dec::COUNT],
) -> Result<(), TapeError> {
    if rows == 0 || rows > block_rows {
        return Err(layout(format!(
            "block of {rows} rows (block size {block_rows})"
        )));
    }
    let mut n = [0u64; col::COUNT];
    for (id, c) in cols.iter().enumerate() {
        n[id] = frame_values(c, id)?;
    }
    let byte_cols = [
        col::FLAGS,
        col::EVENT_TYPE,
        col::MARKET,
        col::ASSET0,
        col::ASSET1,
    ];
    if let Some(&id) = byte_cols.iter().find(|&&id| cols[id].width != 1) {
        return Err(layout(format!(
            "byte column {id}: width {}",
            cols[id].width
        )));
    }
    let row_cols = [
        col::INGEST_SEQ,
        col::TS_LOCAL,
        col::TS_EXCHANGE,
        col::ASSET_INDEX,
    ]
    .into_iter()
    .chain(byte_cols)
    .chain(col::LIST_LEN..col::LIST_LEN + N_LISTS);
    for id in row_cols {
        if n[id] != u64::from(rows) {
            return Err(layout(format!(
                "column {id}: {} values for {rows} rows",
                n[id]
            )));
        }
    }
    let narrow =
        std::iter::once(col::ASSET_INDEX).chain(col::INT_VALUES..col::INT_VALUES + int::COUNT);
    for id in narrow {
        if cols[id].width > 4 {
            return Err(layout(format!("column {id}: wider than i32")));
        }
    }
    for (l, total) in values.iter_mut().enumerate() {
        let id = if l < dec::COUNT {
            col::DEC_VALUES + l
        } else {
            col::INT_VALUES + l - dec::COUNT
        };
        *total = total
            .checked_add(n[id])
            .ok_or_else(|| layout(format!("list {l}: value count overflows")))?;
    }
    for (d, total) in inexact.iter_mut().enumerate() {
        let k = n[col::INEXACT + d];
        if k > n[col::DEC_VALUES + d] {
            return Err(layout(format!(
                "{}: more inexact than values",
                dec::NAMES[d]
            )));
        }
        *total += k;
    }
    Ok(())
}

fn parse_meta(m: &[u8], version: u32, data_offset: u64) -> Result<TapeHeader, TapeError> {
    let mut c = Cursor { b: m, at: 0 };
    let v1 = V1Identity {
        bytes: c.u64()?,
        mtime_ns: c.i64()?,
        sha256: c.arr()?,
    };
    let tool_sha256 = c.arr()?;
    let zstd_level = c.i32()?;
    let block_rows = c.u32()?;
    let rows = c.u64()?;
    let mut list_values = [0u64; N_LISTS];
    for v in &mut list_values {
        *v = c.u64()?;
    }
    let mut inexact = [0u64; dec::COUNT];
    for v in &mut inexact {
        *v = c.u64()?;
    }
    let n_dict = c.u32()? as usize;
    if n_dict > crate::typed::DICT_CAP {
        return Err(layout("dictionary too large"));
    }
    let mut dict = Vec::with_capacity(n_dict);
    for _ in 0..n_dict {
        let len = c.u32()? as usize;
        dict.push(c.take(len)?.to_vec());
    }
    let n_blocks = c.u32()? as usize;
    let n_cols = c.u32()? as usize;
    if n_cols != col::COUNT {
        return Err(layout(format!("{n_cols} columns per block")));
    }
    let mut blocks = Vec::with_capacity(n_blocks.min(1 << 16));
    let mut block_total = 0u64;
    let mut values = [0u64; N_LISTS];
    let mut inexact_values = [0u64; dec::COUNT];
    for _ in 0..n_blocks {
        let rows = c.u32()?;
        let bases = [c.i64()?, c.i64()?, c.i64()?];
        let mut cols = Vec::with_capacity(col::COUNT);
        for _ in 0..col::COUNT {
            cols.push(ColMeta {
                offset: c.u64()?,
                comp_len: c.u32()?,
                raw_len: c.u32()?,
                width: c.u8()?,
                scale: c.u8()?,
            });
        }
        let decimal_cols = col::DEC_VALUES..col::DEC_VALUES + dec::COUNT;
        if let Some((i, _)) = cols
            .iter()
            .enumerate()
            .find(|(i, c)| c.scale != 0 && !decimal_cols.contains(i))
        {
            return Err(layout(format!("column {i}: scale on a non-decimal column")));
        }
        check_block(&cols, rows, block_rows, &mut values, &mut inexact_values)?;
        block_total = block_total
            .checked_add(rows as u64)
            .ok_or_else(|| layout("row count overflows"))?;
        blocks.push(BlockMeta { rows, bases, cols });
    }
    if c.at != m.len() {
        return Err(layout("trailing meta bytes"));
    }
    if block_total != rows {
        return Err(layout("block rows do not add up"));
    }
    // Every count a reader sizes buffers from equals what the blocks declare.
    if values != list_values {
        return Err(layout("list value counts do not match the blocks"));
    }
    if inexact_values != inexact {
        return Err(layout("inexact counts do not match the blocks"));
    }
    Ok(TapeHeader {
        format_version: version,
        v1,
        tool_sha256,
        zstd_level,
        block_rows,
        rows,
        list_values,
        inexact,
        dict,
        blocks,
        data_offset,
    })
}
