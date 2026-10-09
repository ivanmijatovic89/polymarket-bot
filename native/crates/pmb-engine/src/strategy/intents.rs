//! The engine-owned, reused intent buffer of a session (10 §11 P3, 12 §6.1,
//! 30 §7) and order meta (30 §7.2).
//!
//! Strategies write intents into `&mut Intents` without allocating in steady
//! state. Client order ids are copied into a buffer-local arena and carried
//! as *local* `CidKey`s; the OM interns them into the session interner when
//! it handles the list (30 §6: "the engine interns cids on submission"), so
//! `Ctx` can borrow the session interner while the strategy holds the buffer.

use pmb_core::ids::{CidKey, ClientOrderId, ExchangeOrderId, MetaId};
use pmb_core::order::{Intents as CoreIntents, OrderRef, OrderRequest};
use pmb_core::{Outcome, Qty};

/// One scalar meta value (30 §7.2).
#[derive(Clone, Debug, PartialEq)]
pub enum MetaValue {
    /// Boolean.
    Bool(bool),
    /// Integer.
    I64(i64),
    /// Float; non-finite values serialize as `null` (21 §16).
    F64(f64),
    /// String.
    Str(Box<str>),
}

/// Order meta of scalar values (30 §7.2), serialized once at placement into
/// the session meta store (10 §7.5).
// D-PENDING: 30 §7.2 `Meta::json` (nested values) needs serde_json in the SDK;
// chose scalar-only here, the JSON escape hatch is added with pmb-sdk.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Meta {
    entries: Vec<(Box<str>, MetaValue)>,
}

impl Meta {
    /// Empty meta.
    pub fn new() -> Meta {
        Meta::default()
    }

    /// Adds one entry; key order is not significant (30 §7.2).
    pub fn push(&mut self, key: &str, value: MetaValue) {
        self.entries.push((key.into(), value));
    }

    /// Entries in insertion order.
    pub fn entries(&self) -> &[(Box<str>, MetaValue)] {
        &self.entries
    }

    /// Whether there is no entry.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Serializes the meta as one JSON object (10 §7.5 E1), once at
    /// placement. Non-finite floats serialize as `null` (21 §16); floats use
    /// Rust's shortest round-trip form.
    pub fn to_json(&self) -> String {
        let mut out = String::with_capacity(2 + 16 * self.entries.len());
        self.write_json(&mut out);
        out
    }

    /// Appends the JSON object of [`Meta::to_json`] to `out`, so the OM can
    /// serialize into a reused buffer (12 §14 P1). The output obeys 21 §18:
    /// `-0.0` is written as `0.0` (N1), and an integer beyond ±(2^53 − 1) is
    /// written as a decimal string (N2).
    // D-PENDING: 21 §18 N2 forbids integers beyond ±(2^53 − 1) in the output
    // but 30 §7.2 does not say what an `I64` meta value beyond it becomes;
    // chose an exact decimal string over a rejection or a lossy float.
    pub fn write_json(&self, out: &mut String) {
        use std::fmt::Write as _;
        const MAX_SAFE: i64 = (1 << 53) - 1;
        out.push('{');
        for (i, (k, v)) in self.entries.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            json_string(out, k);
            out.push(':');
            let _ = match v {
                MetaValue::Bool(b) => {
                    out.push_str(if *b { "true" } else { "false" });
                    Ok(())
                }
                MetaValue::I64(n) if (-MAX_SAFE..=MAX_SAFE).contains(n) => write!(out, "{n}"),
                MetaValue::I64(n) => write!(out, "\"{n}\""),
                // 21 §18 N1: no `-0`.
                MetaValue::F64(x) if *x == 0.0 => {
                    out.push_str("0.0");
                    Ok(())
                }
                MetaValue::F64(x) if x.is_finite() => write!(out, "{x:?}"),
                MetaValue::F64(_) => {
                    out.push_str("null");
                    Ok(())
                }
                MetaValue::Str(t) => {
                    json_string(out, t);
                    Ok(())
                }
            };
        }
        out.push('}');
    }
}

/// Appends `s` as a JSON string literal (RFC 8259 escaping).
fn json_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// One reference of a `CancelBatch` (30 §7, 10 §7.3 N1).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum CancelRef<'c> {
    /// By client order id.
    Cid(&'c ClientOrderId),
    /// By exchange order id.
    Exchange(ExchangeOrderId),
    /// Both; they must agree, otherwise the cancel fails `ConflictingRefs`.
    Both(&'c ClientOrderId, ExchangeOrderId),
}

/// The intent buffer (30 §7). Buffer order is submission order; `clear`
/// keeps capacity.
#[derive(Clone, Debug, Default)]
pub struct Intents {
    /// Core intents; their cids are local keys into `cid_spans`, their meta
    /// ids local indices into `metas`.
    core: CoreIntents,
    cid_bytes: Vec<u8>,
    cid_spans: Vec<(u32, u32)>,
    metas: Vec<Meta>,
    /// Reused scratch for batch construction (12 §14 P1).
    scratch_orders: Vec<OrderRequest>,
    scratch_refs: Vec<OrderRef>,
}

impl Intents {
    /// An empty buffer.
    pub fn new() -> Intents {
        Intents::default()
    }

    /// Clears every intent, keeping capacity (12 §14 P1).
    pub fn clear(&mut self) {
        self.core.clear();
        self.cid_bytes.clear();
        self.cid_spans.clear();
        self.metas.clear();
    }

    /// The `i`-th intent with buffer-local cids (trace rendering).
    pub fn get(&self, i: usize) -> Option<pmb_core::order::Intent<'_>> {
        self.core.get(i)
    }

    /// Text of a buffer-local cid key of this buffer (trace rendering).
    pub fn local_cid_text(&self, k: CidKey) -> &str {
        self.cid_text(k)
    }

    /// Number of intents.
    #[inline]
    pub fn len(&self) -> usize {
        self.core.len()
    }

    /// Whether no intent was written.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.core.is_empty()
    }

    fn local_cid(&mut self, cid: &ClientOrderId) -> CidKey {
        let s = cid.as_str().as_bytes();
        let start = self.cid_bytes.len() as u32;
        self.cid_bytes.extend_from_slice(s);
        self.cid_spans.push((start, s.len() as u32));
        CidKey::new((self.cid_spans.len() - 1) as u32)
    }

    fn local_meta(&mut self, meta: Meta) -> MetaId {
        self.metas.push(meta);
        MetaId::new((self.metas.len() - 1) as u32)
    }

    /// Places one order (`PlaceLimit`, 30 §7). `req.cid` and `req.meta` are
    /// replaced by the buffer-local keys of `cid` and `meta`.
    // D-PENDING: the author builders of 30 §7 (`Order::buy(..).gtd(..)`,
    // `.fok()`, `buy_spend`) are pmb-sdk's; chose this request-level entry
    // point for them to build on.
    pub fn place_request(
        &mut self,
        cid: &ClientOrderId,
        mut req: OrderRequest,
        meta: Option<Meta>,
    ) {
        req.cid = self.local_cid(cid);
        req.meta = meta.map(|m| self.local_meta(m));
        self.core.place(req);
    }

    /// Places several orders as one `PlaceBatch` (30 §7, 10 §7.3); each
    /// order carries its own cid and meta.
    pub fn place_batch<'c, I>(&mut self, orders: I)
    where
        I: IntoIterator<Item = (&'c ClientOrderId, OrderRequest, Option<Meta>)>,
    {
        let mut scratch = std::mem::take(&mut self.scratch_orders);
        scratch.clear();
        for (cid, mut req, meta) in orders {
            req.cid = self.local_cid(cid);
            req.meta = meta.map(|m| self.local_meta(m));
            scratch.push(req);
        }
        // D60: an empty batch writes no intent (no event, no trace record,
        // no dispatch).
        if !scratch.is_empty() {
            self.core.place_batch(scratch.iter().copied());
        }
        self.scratch_orders = scratch;
    }

    /// Cancels several orders as one `CancelBatch` (30 §7).
    pub fn cancel_batch<'c, I>(&mut self, refs: I)
    where
        I: IntoIterator<Item = CancelRef<'c>>,
    {
        let mut scratch = std::mem::take(&mut self.scratch_refs);
        scratch.clear();
        for r in refs {
            scratch.push(match r {
                CancelRef::Cid(c) => OrderRef::Cid(self.local_cid(c)),
                CancelRef::Exchange(e) => OrderRef::Exchange(e),
                CancelRef::Both(c, e) => OrderRef::Both(self.local_cid(c), e),
            });
        }
        self.core.cancel_batch(scratch.iter().copied());
        self.scratch_refs = scratch;
    }

    /// Cancels the order of a client order id (`CancelOrder`, 30 §7).
    pub fn cancel(&mut self, cid: &ClientOrderId) {
        let k = self.local_cid(cid);
        self.core.cancel(OrderRef::Cid(k));
    }

    /// Cancels by exchange order id (`CancelOrder`, 30 §7).
    pub fn cancel_exchange_id(&mut self, id: ExchangeOrderId) {
        self.core.cancel(OrderRef::Exchange(id));
    }

    /// `CancelMarket` for one outcome or the whole market (30 §7).
    pub fn cancel_market(&mut self, outcome: Option<Outcome>) {
        self.core.cancel_market(outcome);
    }

    /// `CancelAll` (30 §7).
    pub fn cancel_all(&mut self) {
        self.core.cancel_all();
    }

    /// `SplitPositions` of `size` full sets (30 §7, 10 §7.3 N3).
    pub fn split(&mut self, size: Qty) {
        self.core.split(size);
    }

    /// `MergePositions` of `size` full sets (30 §7).
    pub fn merge(&mut self, size: Qty) {
        self.core.merge(size);
    }

    /// The core intents in submission order; cids are buffer-local keys
    /// (resolve with [`Intents::cid_text`]).
    #[inline]
    pub(crate) fn core(&self) -> &CoreIntents {
        &self.core
    }

    /// Text of a buffer-local cid key.
    pub(crate) fn cid_text(&self, k: CidKey) -> &str {
        let (s, n) = self.cid_spans[k.index()];
        let bytes = &self.cid_bytes[s as usize..(s + n) as usize];
        // Copied from a validated `ClientOrderId` (printable ASCII, 10 §6).
        std::str::from_utf8(bytes).expect("cid bytes are ASCII")
    }

    /// A buffer-local meta.
    pub(crate) fn meta(&self, id: MetaId) -> &Meta {
        &self.metas[id.index()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pmb_core::order::Intent;
    use pmb_core::{Price, Qty};

    #[test]
    fn buffer_keeps_order_local_cids_and_capacity() {
        // spec: 30 §7 (buffer order is submission order), 12 §6.1 (reused buffer)
        let mut b = Intents::new();
        let a = ClientOrderId::new("a1").unwrap();
        let x = ClientOrderId::new("x22").unwrap();
        let req = OrderRequest::gtc(
            CidKey::new(99),
            Outcome::Up,
            pmb_core::order::Side::Buy,
            Price::from_micros(400_000),
            Qty::from_micros(5_000_000),
        );
        let mut m = Meta::new();
        m.push("leg", MetaValue::Str("entry".into()));
        b.place_request(&a, req, Some(m));
        b.cancel(&x);
        b.split(Qty::from_micros(1_000_000));
        assert_eq!(b.len(), 3);
        let core = b.core();
        let Some(Intent::PlaceLimit(o)) = core.get(0) else {
            panic!("place first")
        };
        assert_eq!(b.cid_text(o.cid), "a1");
        assert_eq!(b.meta(o.meta.unwrap()).entries().len(), 1);
        let Some(Intent::CancelOrder(OrderRef::Cid(c))) = core.get(1) else {
            panic!("cancel second")
        };
        assert_eq!(b.cid_text(c), "x22");
        b.clear();
        assert!(b.is_empty());
    }

    #[test]
    fn meta_serializes_to_one_json_object() {
        // spec: 10 §7.5 E1, 21 §16 (non-finite numbers serialize as null)
        let mut m = Meta::new();
        m.push("edge", MetaValue::F64(0.031));
        m.push("leg", MetaValue::Str("en\"try".into()));
        m.push("n", MetaValue::I64(3));
        m.push("ok", MetaValue::Bool(true));
        m.push("bad", MetaValue::F64(f64::NAN));
        assert_eq!(
            m.to_json(),
            r#"{"edge":0.031,"leg":"en\"try","n":3,"ok":true,"bad":null}"#
        );
        assert_eq!(Meta::new().to_json(), "{}");
    }

    #[test]
    fn meta_numbers_obey_the_output_number_rules() {
        // spec: 21 §18 N1 (no -0), N2 (no integer beyond ±(2^53 − 1))
        let mut m = Meta::new();
        m.push("z", MetaValue::F64(-0.0));
        m.push("safe", MetaValue::I64((1 << 53) - 1));
        m.push("big", MetaValue::I64(1 << 53));
        m.push("neg", MetaValue::I64(i64::MIN));
        assert_eq!(
            m.to_json(),
            r#"{"z":0.0,"safe":9007199254740991,"big":"9007199254740992","neg":"-9223372036854775808"}"#
        );
        // `write_json` appends to a reused buffer.
        let mut buf = String::from("x");
        Meta::new().write_json(&mut buf);
        assert_eq!(buf, "x{}");
    }

    #[test]
    fn an_empty_place_batch_writes_no_intent() {
        // spec: D60 (`out.place_batch(&[])` writes no intent), 10 §7.3
        let mut b = Intents::new();
        b.place_batch(std::iter::empty());
        assert!(b.is_empty());
        assert_eq!(b.len(), 0);
    }
}
