//! Flat DECIMAL columns preserve the original page/dictionary cursor contexts.
//! Logical values are materialized before rowgroup admission; scalar rows are
//! insufficient when parquetjs selects a different physical integer width.
use crate::parquet_decimal::{self, DecimalValue, PlainLimits, RawDecimalDescriptor};
use parquet::basic::{Compression, Encoding};
use parquet::column::page::Page;
use parquet::file::reader::RowGroupReader;
use parquet::format::{PageHeader, PageType};
use parquet::thrift::TSerializable;
use std::io::Cursor;
use thrift::protocol::TCompactInputProtocol;

fn limits(bytes: usize, count: usize) -> PlainLimits {
    PlainLimits {
        max_values: count,
        // Each Buffer is a subarray of the actual cursor buffer. This bound
        // follows supplied bytes/count, rather than silently capping valid jobs.
        max_buffer_bytes: bytes.saturating_mul(count),
    }
}
fn varint(bytes: &[u8], offset: &mut usize) -> Result<u64, String> {
    let mut value = 0_u64;
    for shift in (0..64).step_by(7) {
        let byte = *bytes.get(*offset).ok_or("Truncated RLE varint")?;
        *offset += 1;
        if shift == 63 && byte > 1 {
            return Err("RLE varint overflow".into());
        }
        value |= u64::from(byte & 127) << shift;
        if byte & 128 == 0 {
            return Ok(value);
        }
    }
    Err("RLE varint overflow".into())
}
/// Legal RLE/bitpacked streams consume padded runs before truncating to count.
/// Missing packed bytes become zero like JS indexed Buffer reads; subsequent
/// varint/numeric reads still fail at their actual attempted cursor position.
fn rle(
    bytes: &[u8],
    offset: &mut usize,
    count: usize,
    width: u32,
    envelope: bool,
) -> Result<Vec<u32>, String> {
    if width > 32 {
        return Err("Unsupported RLE bit width".into());
    }
    if envelope {
        *offset = offset.checked_add(4).ok_or("RLE offset overflow")?;
    }
    let mut values = Vec::new();
    while values.len() < count {
        let header = varint(bytes, offset)?;
        let remaining = count - values.len();
        if header & 1 == 0 {
            let run = usize::try_from(header >> 1).map_err(|_| "RLE run overflow")?;
            if run == 0 {
                return Err("Empty RLE run".into());
            }
            let mut value = 0_u32;
            for index in 0..width.div_ceil(8) {
                let byte = bytes.get(*offset).copied().unwrap_or(0);
                *offset = offset.checked_add(1).ok_or("RLE offset overflow")?;
                value |= u32::from(byte) << (index * 8);
            }
            values.extend(std::iter::repeat_n(value, run.min(remaining)));
        } else {
            let run = usize::try_from(header >> 1)
                .ok()
                .and_then(|v| v.checked_mul(8))
                .ok_or("Packed run overflow")?;
            if run == 0 {
                return Err("Empty packed run".into());
            }
            for index in 0..run.min(remaining) {
                let mut value = 0_u32;
                for bit in 0..width {
                    let position = index
                        .checked_mul(width as usize)
                        .and_then(|v| v.checked_add(bit as usize))
                        .ok_or("Packed bit overflow")?;
                    let byte = offset
                        .checked_add(position / 8)
                        .and_then(|index| bytes.get(index))
                        .copied()
                        .unwrap_or(0);
                    if byte & (1 << (position % 8)) != 0 {
                        value |= 1 << bit;
                    }
                }
                values.push(value);
            }
            *offset = offset
                .checked_add(
                    run.checked_mul(width as usize)
                        .ok_or("Packed size overflow")?
                        / 8,
                )
                .ok_or("Packed offset overflow")?;
        }
    }
    Ok(values)
}
fn definitions(
    bytes: &[u8],
    offset: &mut usize,
    count: usize,
    maximum: i16,
    envelope: bool,
) -> Result<Vec<u32>, String> {
    if maximum == 0 {
        return Ok(vec![0; count]);
    }
    let max = u32::try_from(maximum).map_err(|_| "Invalid definition maximum")?;
    rle(bytes, offset, count, 32 - max.leading_zeros(), envelope)
}
fn page_values(
    bytes: &[u8],
    offset: usize,
    count: usize,
    descriptor: &RawDecimalDescriptor,
    encoding: Encoding,
    dictionary: &[DecimalValue],
) -> Result<(Vec<Option<DecimalValue>>, usize), String> {
    if encoding == Encoding::PLAIN {
        let decoded = parquet_decimal::decode_raw_plain(
            bytes,
            count,
            descriptor,
            offset,
            Some(bytes.len()),
            limits(bytes.len(), count),
        )
        .map_err(|error| error.message)?;
        return Ok((
            decoded.values.into_iter().map(Some).collect(),
            decoded.offset,
        ));
    }
    if matches!(
        encoding,
        Encoding::PLAIN_DICTIONARY | Encoding::RLE_DICTIONARY
    ) {
        let width = *bytes.get(offset).ok_or("Missing dictionary bit width")?;
        let mut offset = offset + 1;
        let indices = rle(bytes, &mut offset, count, u32::from(width), false)?;
        return Ok((
            indices
                .into_iter()
                .map(|index| dictionary.get(index as usize).cloned())
                .collect(),
            offset,
        ));
    }
    Err("Unsupported DECIMAL value encoding".into())
}

pub fn read_flat_column(
    group: &dyn RowGroupReader,
    index: usize,
    raw: &[u8],
    raw_descriptor: &RawDecimalDescriptor,
) -> Result<Vec<Option<DecimalValue>>, String> {
    let descriptor = group.metadata().schema_descr().column(index);
    if descriptor.max_rep_level() != 0 || descriptor.path().parts().len() != 1 {
        return Err("Expected flat scalar DECIMAL column".into());
    }
    let metadata = group.metadata().column(index);
    let mut pages = group
        .get_column_page_reader(index)
        .map_err(|e| e.to_string())?;
    let mut cursor = Cursor::new(raw);
    let mut dictionary = Vec::new();
    let mut all_levels = Vec::new();
    let mut all_values = Vec::new();
    let mut admitted_values = 0_i64;
    while cursor.position() < raw.len() as u64 && admitted_values < metadata.num_values() {
        let header = {
            let mut protocol = TCompactInputProtocol::new(&mut cursor);
            PageHeader::read_from_in_protocol(&mut protocol).map_err(|e| e.to_string())?
        };
        if !matches!(
            header.type_,
            PageType::DATA_PAGE | PageType::DATA_PAGE_V2 | PageType::DICTIONARY_PAGE
        ) {
            return Err("Unsupported Parquet page type".into());
        }
        let body_start = usize::try_from(cursor.position()).map_err(|_| "Page offset overflow")?;
        let length =
            usize::try_from(header.compressed_page_size).map_err(|_| "Invalid page size")?;
        let body_end = body_start
            .checked_add(length)
            .filter(|v| *v <= raw.len())
            .ok_or("Truncated page payload")?;
        let page = pages
            .get_next_page()
            .map_err(|e| e.to_string())?
            .ok_or("Missing physical page")?;
        cursor.set_position(body_end as u64);
        match page {
            Page::DictionaryPage {
                buf, num_values, ..
            } => {
                dictionary = parquet_decimal::decode_raw_dictionary_plain(
                    &buf,
                    num_values as usize,
                    raw_descriptor,
                    0,
                    Some(buf.len()),
                    limits(buf.len(), num_values as usize),
                )
                .map_err(|error| error.message)?
                .values;
            }
            Page::DataPage {
                buf,
                num_values,
                encoding,
                def_level_encoding,
                ..
            } => {
                if descriptor.max_def_level() > 0 && def_level_encoding != Encoding::RLE {
                    return Err("Unsupported definition encoding".into());
                }
                let (bytes, mut offset) = if metadata.compression() == Compression::UNCOMPRESSED {
                    (raw, body_start)
                } else {
                    (buf.as_ref(), 0)
                };
                let levels = definitions(
                    bytes,
                    &mut offset,
                    num_values as usize,
                    descriptor.max_def_level(),
                    true,
                )?;
                let nonnull = levels
                    .iter()
                    .filter(|value| **value == descriptor.max_def_level() as u32)
                    .count();
                let (values, _) = page_values(
                    bytes,
                    offset,
                    nonnull,
                    raw_descriptor,
                    encoding,
                    &dictionary,
                )?;
                all_levels.extend(levels);
                all_values.extend(values.into_iter().flatten());
                admitted_values += i64::from(num_values);
            }
            Page::DataPageV2 {
                buf,
                num_values,
                num_nulls,
                encoding,
                rep_levels_byte_len,
                def_levels_byte_len,
                ..
            } => {
                let original = header
                    .data_page_header_v2
                    .as_ref()
                    .ok_or("Missing V2 header")?;
                let mut offset = body_start;
                let levels = definitions(
                    raw,
                    &mut offset,
                    num_values as usize,
                    descriptor.max_def_level(),
                    false,
                )?;
                // Native pages preserve the uncompressed level prefix. The JS
                // compressed V2 value cursor starts on the inflated values only.
                let (bytes, offset) = if original.is_compressed == Some(true) {
                    let prefix = (rep_levels_byte_len as usize)
                        .checked_add(def_levels_byte_len as usize)
                        .ok_or("Level prefix overflow")?;
                    (buf.get(prefix..).ok_or("Invalid level prefix")?, 0)
                } else {
                    (raw, offset)
                };
                let count = num_values
                    .checked_sub(num_nulls)
                    .ok_or("Invalid null count")? as usize;
                let (values, value_end) =
                    page_values(bytes, offset, count, raw_descriptor, encoding, &dictionary)?;
                if original.is_compressed != Some(true) {
                    cursor.set_position(value_end as u64);
                }
                all_levels.extend(levels);
                all_values.extend(values.into_iter().flatten());
                admitted_values += i64::from(num_values);
            }
        }
    }
    // decodePages compacts undefined dictionary/codec results across the
    // entire column before shred.materializeRecords consumes definition levels.
    let mut output = Vec::with_capacity(all_levels.len());
    materialize(
        &mut output,
        all_levels,
        all_values,
        descriptor.max_def_level(),
    );
    Ok(output)
}
fn materialize(
    output: &mut Vec<Option<DecimalValue>>,
    levels: Vec<u32>,
    values: Vec<DecimalValue>,
    maximum: i16,
) {
    let mut values = values.into_iter();
    for level in levels {
        // Short codec arrays/dictionary misses are undefined, not read failures.
        output.push(if level == maximum as u32 {
            values.next()
        } else {
            None
        });
    }
}
