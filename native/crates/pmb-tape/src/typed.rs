//! Typed rows: everything the telonex-delta reader (15 §4.2) consumes from
//! each version-1 row, decoded once (16 §7.5 NT-2).
//!
//! The layer sits between the Parquet file and the reader's skip, anomaly and
//! book rules: decimals are already fixed point (1e6) with their
//! `inexact_decimal` flag, ids are indices into a per-file dictionary of the
//! raw id bytes, and every list keeps its own length. A value the reader could
//! not see the same way (unparseable decimal, unknown event type, a full
//! dictionary) makes the whole file [`Unconvertible`]: it stays on the v1 path.

use std::fmt;

/// Dictionary index meaning "null" (an absent optional id column).
pub const NULL_ID: u8 = u8::MAX;
/// Maximum distinct id strings per file; one more is [`Unconvertible::DictionaryOverflow`].
pub const DICT_CAP: usize = NULL_ID as usize;

/// Per-row flag bits.
pub mod row_flags {
    /// `ts_exchange_ms` is null (its value slot is 0).
    pub const TS_EXCHANGE_NULL: u8 = 1;
    /// `asset_index` is null (its value slot is 0).
    pub const ASSET_INDEX_NULL: u8 = 2;
    /// Every defined bit.
    pub const ALL: u8 = TS_EXCHANGE_NULL | ASSET_INDEX_NULL;
}

/// Event type codes; any other `event_type` string is [`Unconvertible::EventType`].
pub mod event_type {
    pub const BOOK: u8 = 0;
    pub const PRICE_CHANGE: u8 = 1;
}

/// Decimal list columns, in schema order (indices into [`TypedRows::decimals`]).
pub mod dec {
    pub const BID_PRICES: usize = 0;
    pub const BID_SIZES: usize = 1;
    pub const ASK_PRICES: usize = 2;
    pub const ASK_SIZES: usize = 3;
    pub const CHANGE_PRICES: usize = 4;
    pub const CHANGE_SIZES: usize = 5;
    pub const COUNT: usize = 6;
    pub const NAMES: [&str; COUNT] = [
        "bid_prices",
        "bid_sizes",
        "ask_prices",
        "ask_sizes",
        "change_prices",
        "change_sizes",
    ];
}

/// Integer list columns (indices into [`TypedRows::ints`]).
pub mod int {
    pub const CHANGE_ASSETS: usize = 0;
    pub const CHANGE_SIDES: usize = 1;
    pub const COUNT: usize = 2;
    pub const NAMES: [&str; COUNT] = ["change_asset_indexes", "change_side_codes"];
}

/// One repeated decimal column: fixed-point values (1e6) per row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecimalList {
    /// `values[offsets[r]..offsets[r + 1]]` belong to row `r`; `offsets[0] == 0`.
    pub offsets: Vec<u32>,
    pub values: Vec<i64>,
    /// Ascending indices into `values` of the decimals that had more than six
    /// fractional digits and were rounded (`inexact_decimal`, 15 §8).
    pub inexact: Vec<u32>,
}

impl Default for DecimalList {
    fn default() -> Self {
        DecimalList {
            offsets: vec![0],
            values: Vec::new(),
            inexact: Vec::new(),
        }
    }
}

impl DecimalList {
    /// Value range of row `r`.
    #[inline]
    pub fn range(&self, r: usize) -> (usize, usize) {
        (self.offsets[r] as usize, self.offsets[r + 1] as usize)
    }

    /// Whether value `i` was rounded.
    #[inline]
    pub fn is_inexact(&self, i: usize) -> bool {
        !self.inexact.is_empty() && self.inexact.binary_search(&(i as u32)).is_ok()
    }
}

/// One repeated INT32 column.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntList {
    pub offsets: Vec<u32>,
    pub values: Vec<i32>,
}

impl Default for IntList {
    fn default() -> Self {
        IntList {
            offsets: vec![0],
            values: Vec::new(),
        }
    }
}

impl IntList {
    #[inline]
    pub fn range(&self, r: usize) -> (usize, usize) {
        (self.offsets[r] as usize, self.offsets[r + 1] as usize)
    }
}

/// Typed rows of one telonex-delta file, in file order (struct of arrays).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TypedRows {
    /// Raw bytes of the distinct `market`, `asset0_id` and `asset1_id` values,
    /// in first-appearance order.
    pub dict: Vec<Vec<u8>>,
    pub ingest_seq: Vec<i64>,
    pub ts_local_ms: Vec<i64>,
    /// 0 where [`row_flags::TS_EXCHANGE_NULL`] is set.
    pub ts_exchange_ms: Vec<i64>,
    pub flags: Vec<u8>,
    pub event_type: Vec<u8>,
    /// Dictionary index of `market`.
    pub market: Vec<u8>,
    /// Dictionary index of `asset0_id` / `asset1_id`, or [`NULL_ID`].
    pub asset0: Vec<u8>,
    pub asset1: Vec<u8>,
    /// 0 where [`row_flags::ASSET_INDEX_NULL`] is set.
    pub asset_index: Vec<i32>,
    pub decimals: [DecimalList; dec::COUNT],
    pub ints: [IntList; int::COUNT],
}

impl TypedRows {
    /// Number of rows (every v1 row, skipped ones included).
    #[inline]
    pub fn len(&self) -> usize {
        self.ingest_seq.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.ingest_seq.is_empty()
    }

    /// Empties every column (keeping capacity) and sets the dictionary, for
    /// block-wise reuse.
    pub fn reset(&mut self, dict: &[Vec<u8>]) {
        if self.dict != dict {
            self.dict = dict.to_vec();
        }
        self.ingest_seq.clear();
        self.ts_local_ms.clear();
        self.ts_exchange_ms.clear();
        self.flags.clear();
        self.event_type.clear();
        self.market.clear();
        self.asset0.clear();
        self.asset1.clear();
        self.asset_index.clear();
        for d in &mut self.decimals {
            d.offsets.clear();
            d.offsets.push(0);
            d.values.clear();
            d.inexact.clear();
        }
        for l in &mut self.ints {
            l.offsets.clear();
            l.offsets.push(0);
            l.values.clear();
        }
    }

    /// Book levels plus price changes (the tape header's level count).
    pub fn level_count(&self) -> u64 {
        let d = |i: usize| self.decimals[i].values.len() as u64;
        d(dec::BID_PRICES) + d(dec::ASK_PRICES) + d(dec::CHANGE_PRICES)
    }

    /// Checks the internal invariants every consumer relies on (lengths,
    /// offsets, codes, dictionary indices). Decoded tapes pass through it, so
    /// a corrupt tape that slipped past its checksums still cannot panic the
    /// reader.
    pub fn validate(&self) -> Result<(), String> {
        let n = self.len();
        let cols = [
            ("ts_local_ms", self.ts_local_ms.len()),
            ("ts_exchange_ms", self.ts_exchange_ms.len()),
            ("flags", self.flags.len()),
            ("event_type", self.event_type.len()),
            ("market", self.market.len()),
            ("asset0", self.asset0.len()),
            ("asset1", self.asset1.len()),
            ("asset_index", self.asset_index.len()),
        ];
        for (name, len) in cols {
            if len != n {
                return Err(format!("column {name} has {len} rows, expected {n}"));
            }
        }
        if self.dict.len() > DICT_CAP {
            return Err(format!("dictionary has {} entries", self.dict.len()));
        }
        let dict_len = self.dict.len();
        // Column-wise scans (they vectorize); the first offending row is reported.
        let bad = |what: &str, r: Option<usize>| match r {
            Some(r) => Err(format!("row {r}: bad {what}")),
            None => Ok(()),
        };
        bad(
            "flags",
            self.flags.iter().position(|&f| f & !row_flags::ALL != 0),
        )?;
        bad(
            "event type",
            self.event_type
                .iter()
                .position(|&e| e > event_type::PRICE_CHANGE),
        )?;
        bad(
            "market id",
            self.market.iter().position(|&m| m as usize >= dict_len),
        )?;
        for ids in [&self.asset0, &self.asset1] {
            bad(
                "asset id",
                ids.iter()
                    .position(|&a| a != NULL_ID && a as usize >= dict_len),
            )?;
        }
        let check_offsets = |name: &str, offsets: &[u32], values: usize| {
            if offsets.len() != n + 1 || offsets[0] != 0 {
                return Err(format!("{name}: {} offsets for {n} rows", offsets.len()));
            }
            if offsets.windows(2).any(|w| w[0] > w[1]) {
                return Err(format!("{name}: offsets decrease"));
            }
            if offsets[n] as usize != values {
                return Err(format!("{name}: offsets end at {} of {values}", offsets[n]));
            }
            Ok(())
        };
        for (i, d) in self.decimals.iter().enumerate() {
            check_offsets(dec::NAMES[i], &d.offsets, d.values.len())?;
            if d.inexact.windows(2).any(|w| w[0] >= w[1])
                || d.inexact
                    .last()
                    .is_some_and(|&x| x as usize >= d.values.len())
            {
                return Err(format!("{}: bad inexact index list", dec::NAMES[i]));
            }
        }
        for (i, l) in self.ints.iter().enumerate() {
            check_offsets(int::NAMES[i], &l.offsets, l.values.len())?;
        }
        Ok(())
    }
}

/// Builds the per-file dictionary while rows are appended.
#[derive(Default)]
pub struct DictBuilder {
    entries: Vec<Vec<u8>>,
    last: Option<u8>,
}

impl DictBuilder {
    /// Index of `bytes`, adding it on first sight.
    #[inline]
    pub fn intern(&mut self, bytes: &[u8]) -> Result<u8, Unconvertible> {
        if let Some(i) = self.last {
            if self.entries[i as usize] == bytes {
                return Ok(i);
            }
        }
        let i = match self.entries.iter().position(|e| e == bytes) {
            Some(i) => i as u8,
            None => {
                if self.entries.len() >= DICT_CAP {
                    return Err(Unconvertible::DictionaryOverflow);
                }
                self.entries.push(bytes.to_vec());
                (self.entries.len() - 1) as u8
            }
        };
        self.last = Some(i);
        Ok(i)
    }

    pub fn finish(self) -> Vec<Vec<u8>> {
        self.entries
    }
}

/// Why a v1 file is not converted to a tape (it stays on the v1 path, NT-2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Unconvertible {
    /// Not a version-1 file by footer keys or schema fingerprint (15 I-12).
    Format(String),
    /// The Parquet file could not be decoded.
    Parquet(String),
    /// A decimal string that is not UTF-8, not a number, or out of range.
    Decimal {
        column: &'static str,
        detail: String,
    },
    /// An `event_type` other than `book` and `price_change`.
    EventType(String),
    /// More than [`DICT_CAP`] distinct id strings.
    DictionaryOverflow,
    /// More list values than a `u32` offset can address.
    TooManyValues(&'static str),
}

impl Unconvertible {
    /// Short stable label for reports.
    pub fn label(&self) -> &'static str {
        match self {
            Unconvertible::Format(_) => "format",
            Unconvertible::Parquet(_) => "parquet",
            Unconvertible::Decimal { .. } => "decimal",
            Unconvertible::EventType(_) => "event_type",
            Unconvertible::DictionaryOverflow => "dictionary_overflow",
            Unconvertible::TooManyValues(_) => "too_many_values",
        }
    }
}

impl fmt::Display for Unconvertible {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Unconvertible::Format(d) => write!(f, "not telonex-delta v1: {d}"),
            Unconvertible::Parquet(d) => write!(f, "parquet decode: {d}"),
            Unconvertible::Decimal { column, detail } => write!(f, "{column}: {detail}"),
            Unconvertible::EventType(t) => write!(f, "unknown event type {t:?}"),
            Unconvertible::DictionaryOverflow => {
                write!(f, "more than {DICT_CAP} distinct id strings")
            }
            Unconvertible::TooManyValues(c) => write!(f, "{c}: more than u32::MAX values"),
        }
    }
}

impl std::error::Error for Unconvertible {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dictionary_overflow_is_unconvertible() {
        let mut d = DictBuilder::default();
        for i in 0..DICT_CAP {
            assert_eq!(d.intern(format!("id-{i}").as_bytes()).unwrap() as usize, i);
        }
        // Known entries still resolve once the dictionary is full.
        assert_eq!(d.intern(b"id-7").unwrap(), 7);
        assert_eq!(
            d.intern(b"one-too-many"),
            Err(Unconvertible::DictionaryOverflow)
        );
    }

    #[test]
    fn inexact_lookup() {
        let d = DecimalList {
            offsets: vec![0, 3],
            values: vec![1, 2, 3],
            inexact: vec![1],
        };
        assert!(!d.is_inexact(0));
        assert!(d.is_inexact(1));
        assert!(!d.is_inexact(2));
    }
}
