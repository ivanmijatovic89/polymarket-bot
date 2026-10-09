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
}
