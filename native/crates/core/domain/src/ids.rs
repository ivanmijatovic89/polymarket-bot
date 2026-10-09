//! Identifiers (10-domain-model.md §6, §5 M4).
//!
//! Every engine key is a dense `u32` newtype assigned by the engine or an
//! adapter. Strings (client order ids, token ids, condition ids, exchange
//! order ids) are parsed or interned once and formatted only at I/O
//! boundaries (I2, P4).

use std::collections::HashMap;
use std::fmt;
use std::hash::{BuildHasherDefault, Hasher};

macro_rules! dense_key {
    ($(#[$m:meta])* $name:ident) => {
        $(#[$m])*
        #[repr(transparent)]
        #[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(pub u32);

        impl $name {
            #[inline]
            pub const fn new(v: u32) -> Self {
                Self(v)
            }
            #[inline]
            pub const fn get(self) -> u32 {
                self.0
            }
            /// Slab index (P2).
            #[inline]
            pub const fn index(self) -> usize {
                self.0 as usize
            }
            /// The next dense key; `None` on `u32` exhaustion.
            #[inline]
            pub const fn next(self) -> Option<Self> {
                match self.0.checked_add(1) {
                    Some(v) => Some(Self(v)),
                    None => None,
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }
    };
}

dense_key!(
    /// Interned client order id: index into the session's [`CidInterner`].
    CidKey
);
dense_key!(
    /// One per submission, dense from 0 in intent-processing order; the
    /// generation id of a cid (a reused cid gets a new key).
    OrderKey
);
dense_key!(
    /// One per exchange trade, dense from 0 in first-observation order.
    TradeSeq
);
dense_key!(
    /// One per cancel intent processed by the engine, dense from 0.
    CancelSeq
);
dense_key!(
    /// Split and merge operations.
    OpKey
);
dense_key!(
    /// Index into the session meta store (10 §7.5).
    MetaId
);

/// Fill identity: `seq` starts at 1 per order and strictly increases in
/// delivery order.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FillKey {
    pub order: OrderKey,
    pub seq: u32,
}

/// Which cancel intent produced a [`CancelOp`].
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CancelKind {
    Order,
    Batch,
    Market,
    All,
}

impl CancelKind {
    /// TS `cancel_failed.operation` string.
    #[inline]
    pub const fn as_str(self) -> &'static str {
        match self {
            CancelKind::Order => "cancel_order",
            CancelKind::Batch => "cancel_batch",
            CancelKind::Market => "cancel_market",
            CancelKind::All => "cancel_all",
        }
    }
}

/// One cancel operation (10 §6): keys `CancelAcked`, `CancelFailed`,
/// `CancelCause::Strategy` and the cancel-latency draws.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CancelOp {
    pub seq: CancelSeq,
    pub kind: CancelKind,
}

// ---------------------------------------------------------------------------
// Client order ids and interning
// ---------------------------------------------------------------------------

/// Maximum client order id length in bytes (10 §6).
pub const CID_MAX_LEN: usize = 256;

/// Invalid client order id text.
#[derive(Copy, Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CidError {
    #[error("client order id is empty")]
    Empty,
    #[error("client order id longer than 256 bytes")]
    TooLong,
    #[error("client order id contains a non-printable or non-ASCII byte")]
    NotPrintableAscii,
}

/// Validates cid text: 1–256 bytes of printable ASCII (`0x20..=0x7e`).
#[inline]
pub fn validate_cid(s: &str) -> Result<(), CidError> {
    if s.is_empty() {
        return Err(CidError::Empty);
    }
    if s.len() > CID_MAX_LEN {
        return Err(CidError::TooLong);
    }
    if !s.bytes().all(|b| (0x20..=0x7e).contains(&b)) {
        return Err(CidError::NotPrintableAscii);
    }
    Ok(())
}

/// A validated client order id string (I/O form; the core uses [`CidKey`]).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ClientOrderId(Box<str>);

impl ClientOrderId {
    pub fn new(s: &str) -> Result<Self, CidError> {
        validate_cid(s)?;
        Ok(Self(s.into()))
    }
    #[inline]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ClientOrderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// FxHash-style hasher with a fixed seed: deterministic lookups (10 D-1).
/// Maps using it must never be iterated for output.
#[derive(Default, Clone, Copy)]
pub struct FixedHasher(u64);

impl Hasher for FixedHasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        const K: u64 = 0x51_7c_c1_b7_27_22_0a_95;
        for chunk in bytes.chunks(8) {
            let mut buf = [0u8; 8];
            buf[..chunk.len()].copy_from_slice(chunk);
            self.0 = (self.0.rotate_left(5) ^ u64::from_le_bytes(buf)).wrapping_mul(K);
        }
    }
    #[inline]
    fn write_u8(&mut self, i: u8) {
        self.write(&[i]);
    }
    #[inline]
    fn write_usize(&mut self, i: usize) {
        self.write(&(i as u64).to_le_bytes());
    }
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
}

/// `BuildHasher` for [`FixedHasher`].
pub type FixedState = BuildHasherDefault<FixedHasher>;

/// Deterministic, insertion-ordered cid interner (10 §6, P4). Keys are dense
/// from 0 in first-use order; the map is used only for lookup and never
/// iterated.
#[derive(Default, Clone, Debug)]
pub struct CidInterner {
    strings: Vec<Box<str>>,
    lookup: HashMap<Box<str>, CidKey, FixedState>,
}

/// The interner ran out of `u32` keys.
#[derive(Copy, Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("cid interner is full")]
pub struct InternerFull;

impl CidInterner {
    pub fn new() -> Self {
        Self::default()
    }

    /// Key of `cid`, interning it on first use.
    pub fn intern(&mut self, cid: &ClientOrderId) -> Result<CidKey, InternerFull> {
        if let Some(&k) = self.lookup.get(cid.as_str()) {
            return Ok(k);
        }
        let k = CidKey(u32::try_from(self.strings.len()).map_err(|_| InternerFull)?);
        self.strings.push(cid.0.clone());
        self.lookup.insert(cid.0.clone(), k);
        Ok(k)
    }

    /// Validates and interns raw text.
    pub fn intern_str(&mut self, s: &str) -> Result<CidKey, CidError> {
        if let Some(&k) = self.lookup.get(s) {
            return Ok(k);
        }
        let cid = ClientOrderId::new(s)?;
        // u32 exhaustion is unreachable in a session (far beyond any limit).
        Ok(self.intern(&cid).expect("cid interner exhausted"))
    }

    #[inline]
    pub fn get(&self, s: &str) -> Option<CidKey> {
        self.lookup.get(s).copied()
    }

    /// The text of an interned key (I/O only).
    #[inline]
    pub fn resolve(&self, k: CidKey) -> &str {
        &self.strings[k.index()]
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.strings.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.strings.is_empty()
    }

    /// Interned strings in key order.
    pub fn iter(&self) -> impl Iterator<Item = (CidKey, &str)> {
        self.strings
            .iter()
            .enumerate()
            .map(|(i, s)| (CidKey(i as u32), &**s))
    }
}

// ---------------------------------------------------------------------------
// Exchange order ids
// ---------------------------------------------------------------------------

/// Exchange order id (10 §6). Live: the 32-byte order hash, rendered
/// `0x`-hex. Simulator: never stored by the exchange, rendered `sim-{key}`.
/// The core never keys anything by it.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ExchangeOrderId {
    Sim(OrderKey),
    Clob(Hash32),
}

/// Unparseable id text.
#[derive(Copy, Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum IdParseError {
    #[error("empty id")]
    Empty,
    #[error("invalid character in id")]
    Syntax,
    #[error("wrong length")]
    Length,
    #[error("value out of range")]
    Range,
    #[error("leading zero in decimal id")]
    LeadingZero,
}

impl ExchangeOrderId {
    /// Parses `sim-{u32}` or `0x` + 64 hex digits.
    pub fn parse(s: &str) -> Result<Self, IdParseError> {
        if let Some(rest) = s.strip_prefix("sim-") {
            let v = parse_u32_canonical(rest)?;
            return Ok(ExchangeOrderId::Sim(OrderKey(v)));
        }
        Hash32::parse_hex(s).map(ExchangeOrderId::Clob)
    }
}

impl fmt::Display for ExchangeOrderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExchangeOrderId::Sim(k) => write!(f, "sim-{}", k.0),
            ExchangeOrderId::Clob(h) => fmt::Display::fmt(h, f),
        }
    }
}

fn parse_u32_canonical(s: &str) -> Result<u32, IdParseError> {
    if s.is_empty() {
        return Err(IdParseError::Empty);
    }
    if !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(IdParseError::Syntax);
    }
    if s.len() > 1 && s.starts_with('0') {
        return Err(IdParseError::LeadingZero);
    }
    s.parse::<u32>().map_err(|_| IdParseError::Range)
}

/// 32 bytes rendered as lowercase `0x`-hex (condition ids, order hashes).
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Hash32(pub [u8; 32]);

impl Hash32 {
    /// Parses `0x` + exactly 64 hex digits (either case; formatted lowercase).
    pub fn parse_hex(s: &str) -> Result<Self, IdParseError> {
        let hex = s
            .strip_prefix("0x")
            .or_else(|| s.strip_prefix("0X"))
            .ok_or(if s.is_empty() {
                IdParseError::Empty
            } else {
                IdParseError::Syntax
            })?;
        let b = hex.as_bytes();
        if b.len() != 64 {
            return Err(IdParseError::Length);
        }
        let mut out = [0u8; 32];
        for (i, pair) in b.chunks(2).enumerate() {
            out[i] = (hex_val(pair[0])? << 4) | hex_val(pair[1])?;
        }
        Ok(Hash32(out))
    }
}

#[inline]
fn hex_val(c: u8) -> Result<u8, IdParseError> {
    match c {
        b'0'..=b'9' => Ok(c - b'0'),
        b'a'..=b'f' => Ok(c - b'a' + 10),
        b'A'..=b'F' => Ok(c - b'A' + 10),
        _ => Err(IdParseError::Syntax),
    }
}

impl fmt::Display for Hash32 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("0x")?;
        for b in self.0 {
            write!(f, "{b:02x}")?;
        }
        Ok(())
    }
}

impl fmt::Debug for Hash32 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

/// Market condition id: 32 bytes parsed from `0x`-hex (10 M4).
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ConditionId(pub Hash32);

impl ConditionId {
    pub fn parse(s: &str) -> Result<Self, IdParseError> {
        Hash32::parse_hex(s).map(ConditionId)
    }
}

impl fmt::Display for ConditionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, f)
    }
}

// ---------------------------------------------------------------------------
// Token ids (decimal U256)
// ---------------------------------------------------------------------------

/// Outcome token id: a decimal U256 (up to 78 digits) parsed once into 32
/// big-endian bytes (10 M4). Parsing rejects leading zeros so formatting
/// round-trips the input text exactly.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TokenId(pub [u8; 32]);

impl TokenId {
    pub fn parse(s: &str) -> Result<Self, IdParseError> {
        let b = s.as_bytes();
        if b.is_empty() {
            return Err(IdParseError::Empty);
        }
        if !b.iter().all(u8::is_ascii_digit) {
            return Err(IdParseError::Syntax);
        }
        if b.len() > 1 && b[0] == b'0' {
            return Err(IdParseError::LeadingZero);
        }
        if b.len() > 78 {
            return Err(IdParseError::Range);
        }
        // Little-endian u64 limbs; value = value × 10 + digit with overflow check.
        let mut limbs = [0u64; 4];
        for &c in b {
            let mut carry = (c - b'0') as u128;
            for l in limbs.iter_mut() {
                let v = (*l as u128) * 10 + carry;
                *l = v as u64;
                carry = v >> 64;
            }
            if carry != 0 {
                return Err(IdParseError::Range);
            }
        }
        let mut out = [0u8; 32];
        for (i, l) in limbs.iter().enumerate() {
            out[(3 - i) * 8..(4 - i) * 8].copy_from_slice(&l.to_be_bytes());
        }
        Ok(TokenId(out))
    }

    fn limbs(&self) -> [u64; 4] {
        let mut limbs = [0u64; 4];
        for (i, l) in limbs.iter_mut().enumerate() {
            let mut w = [0u8; 8];
            w.copy_from_slice(&self.0[(3 - i) * 8..(4 - i) * 8]);
            *l = u64::from_be_bytes(w);
        }
        limbs
    }
}

impl fmt::Display for TokenId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const CHUNK: u64 = 10_000_000_000_000_000_000; // 10^19
        let mut limbs = self.limbs();
        let mut parts: [u64; 5] = [0; 5];
        let mut n = 0;
        loop {
            // limbs /= 10^19, collecting the remainder.
            let mut rem: u128 = 0;
            for l in limbs.iter_mut().rev() {
                let cur = (rem << 64) | *l as u128;
                *l = (cur / CHUNK as u128) as u64;
                rem = cur % CHUNK as u128;
            }
            parts[n] = rem as u64;
            n += 1;
            if limbs.iter().all(|&l| l == 0) {
                break;
            }
        }
        write!(f, "{}", parts[n - 1])?;
        for p in parts[..n - 1].iter().rev() {
            write!(f, "{p:019}")?;
        }
        Ok(())
    }
}

impl fmt::Debug for TokenId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "TokenId({self})")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cid_validation() {
        assert_eq!(validate_cid(""), Err(CidError::Empty));
        assert_eq!(validate_cid(&"a".repeat(257)), Err(CidError::TooLong));
        assert!(validate_cid(&"a".repeat(256)).is_ok());
        assert_eq!(validate_cid("a\tb"), Err(CidError::NotPrintableAscii));
        assert_eq!(validate_cid("é"), Err(CidError::NotPrintableAscii));
        assert!(validate_cid("lag:btc-updown-15m-1:123:buy ~").is_ok());
    }

    #[test]
    fn interner_is_dense_and_insertion_ordered() {
        let mut i = CidInterner::new();
        let a = i.intern_str("b").unwrap();
        let b = i.intern_str("a").unwrap();
        assert_eq!((a, b), (CidKey(0), CidKey(1)));
        assert_eq!(i.intern_str("b").unwrap(), CidKey(0));
        assert_eq!(i.get("a"), Some(CidKey(1)));
        assert_eq!(i.get("c"), None);
        assert_eq!(i.resolve(CidKey(1)), "a");
        let v: Vec<_> = i.iter().map(|(_, s)| s).collect();
        assert_eq!(v, ["b", "a"]);
        assert_eq!(i.intern_str(""), Err(CidError::Empty));
    }

    #[test]
    fn token_id_round_trip() {
        for s in [
            "0",
            "1",
            "10000000000000000000",
            "9999999999999999999",
            "21742633143463906290569050155826241533067272736897614950488156847949938836455",
            // 2^256 - 1
            "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        ] {
            assert_eq!(TokenId::parse(s).unwrap().to_string(), s);
        }
        assert_eq!(
            TokenId::parse(
                "115792089237316195423570985008687907853269984665640564039457584007913129639936"
            ),
            Err(IdParseError::Range)
        );
        assert_eq!(TokenId::parse("01"), Err(IdParseError::LeadingZero));
        assert_eq!(TokenId::parse("1a"), Err(IdParseError::Syntax));
        assert_eq!(TokenId::parse(""), Err(IdParseError::Empty));
        assert_eq!(TokenId::parse("256").unwrap().0[30..], [1, 0]);
    }

    #[test]
    fn hex_ids() {
        let s = "0x5f65177b394277fd294cd75650044e32ba009a95022d88a0c1d565897d72f8f1";
        let c = ConditionId::parse(s).unwrap();
        assert_eq!(c.to_string(), s);
        assert_eq!(
            ConditionId::parse(&s.to_uppercase().replacen("0X", "0x", 1))
                .unwrap()
                .to_string(),
            s
        );
        assert_eq!(ConditionId::parse("0x12"), Err(IdParseError::Length));
        assert_eq!(ConditionId::parse(&s[2..]), Err(IdParseError::Syntax));
        let e = ExchangeOrderId::parse("sim-17").unwrap();
        assert_eq!(e, ExchangeOrderId::Sim(OrderKey(17)));
        assert_eq!(e.to_string(), "sim-17");
        assert_eq!(ExchangeOrderId::parse(s).unwrap().to_string(), s);
        assert!(ExchangeOrderId::parse("sim-017").is_err());
    }
}
