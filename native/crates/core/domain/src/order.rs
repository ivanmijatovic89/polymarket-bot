//! Orders and intents (10-domain-model.md §7).
//!
//! Intents are written into [`Intents`], an engine-owned buffer whose vectors
//! keep their capacity across callbacks (P3): steady state allocates nothing.
//! Consumers read them back as borrowed [`Intent`] views; `PlaceLimit` and
//! `PlaceBatch` both resolve to slices of one order store, so there is one
//! placement path (N2).

use crate::fixed::{DurMs, Overflow, Price, Qty, TsMs, Usdc};
use crate::ids::{CidKey, ExchangeOrderId, MetaId};
use crate::outcome::Outcome;

/// Order side, from our point of view.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Side {
    Buy,
    Sell,
}

impl Side {
    /// TS `OrderSide` string.
    #[inline]
    pub const fn as_str(self) -> &'static str {
        match self {
            Side::Buy => "BUY",
            Side::Sell => "SELL",
        }
    }
    #[inline]
    pub const fn opposite(self) -> Side {
        match self {
            Side::Buy => Side::Sell,
            Side::Sell => Side::Buy,
        }
    }
}

/// Polymarket order type (10 §7.1).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum OrderType {
    Gtc,
    Gtd,
    Fok,
    Fak,
}

impl OrderType {
    /// TS `OrderType` string (`FAK` has no TS counterpart).
    #[inline]
    pub const fn as_str(self) -> &'static str {
        match self {
            OrderType::Gtc => "GTC",
            OrderType::Gtd => "GTD",
            OrderType::Fok => "FOK",
            OrderType::Fak => "FAK",
        }
    }
    /// GTC/GTD: the remainder rests.
    #[inline]
    pub const fn is_resting(self) -> bool {
        matches!(self, OrderType::Gtc | OrderType::Gtd)
    }
    /// FOK/FAK: never rests.
    #[inline]
    pub const fn is_market(self) -> bool {
        !self.is_resting()
    }
    /// Post-only is allowed on resting types only.
    #[inline]
    pub const fn allows_post_only(self) -> bool {
        self.is_resting()
    }
}

/// Order size unit (10 §7.2 O1–O3).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum OrderSize {
    /// Shares: resting orders, market SELLs, ts-compat market BUYs.
    Shares(Qty),
    /// Pre-fee collateral to spend: realistic/paper/live FOK/FAK BUYs.
    Collateral(Usdc),
}

impl OrderSize {
    /// The raw micros, positive for a valid size.
    #[inline]
    pub const fn micros(self) -> i64 {
        match self {
            OrderSize::Shares(q) => q.micros(),
            OrderSize::Collateral(u) => u.micros(),
        }
    }
    #[inline]
    pub const fn is_positive(self) -> bool {
        self.micros() > 0
    }
    #[inline]
    pub const fn shares(self) -> Option<Qty> {
        match self {
            OrderSize::Shares(q) => Some(q),
            OrderSize::Collateral(_) => None,
        }
    }
}

/// One order as the strategy requested it (10 §7.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct OrderRequest {
    pub cid: CidKey,
    pub outcome: Outcome,
    pub side: Side,
    /// Resting: the limit. Market: the worst acceptable price.
    pub price: Price,
    pub size: OrderSize,
    pub order_type: OrderType,
    /// Resting types only (validated by the engine).
    pub post_only: bool,
    /// Stated exchange expiration; required for GTD, ignored otherwise (§7.4).
    pub expire_at_ms: Option<TsMs>,
    pub meta: Option<MetaId>,
    /// Log and trace only; never affects behavior.
    pub note: Option<&'static str>,
}

impl OrderRequest {
    /// A share-sized GTC order with no options.
    pub const fn gtc(cid: CidKey, outcome: Outcome, side: Side, price: Price, size: Qty) -> Self {
        OrderRequest {
            cid,
            outcome,
            side,
            price,
            size: OrderSize::Shares(size),
            order_type: OrderType::Gtc,
            post_only: false,
            expire_at_ms: None,
            meta: None,
            note: None,
        }
    }

    /// The expiry that matters: `Some` only on GTD orders.
    #[inline]
    pub fn gtd_expiry(&self) -> Option<TsMs> {
        if self.order_type == OrderType::Gtd {
            self.expire_at_ms
        } else {
            None
        }
    }

    /// O2: a share-sized market BUY becomes `Collateral(price × q, Floor)`,
    /// floored to `amount_dp` decimals (the amount decimals of the tick,
    /// 11 §7.1). Other orders are returned unchanged. Realistic, paper and
    /// live only; ts-compat keeps shares (O3).
    pub fn to_collateral_sized(self, amount_dp: u32) -> Result<OrderRequest, Overflow> {
        match (self.side, self.order_type.is_market(), self.size) {
            (Side::Buy, true, OrderSize::Shares(q)) => {
                let amount = self
                    .price
                    .notional(q, crate::Rounding::Floor)?
                    .round_dp(amount_dp, crate::Rounding::Floor)?;
                Ok(OrderRequest {
                    size: OrderSize::Collateral(amount),
                    ..self
                })
            }
            _ => Ok(self),
        }
    }
}

/// Reference to an own order in a cancel (N1). `Both` must agree, otherwise
/// the cancel fails with `ConflictingRefs`.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum OrderRef {
    Cid(CidKey),
    Exchange(ExchangeOrderId),
    Both(CidKey, ExchangeOrderId),
}

impl OrderRef {
    #[inline]
    pub const fn cid(&self) -> Option<CidKey> {
        match *self {
            OrderRef::Cid(c) | OrderRef::Both(c, _) => Some(c),
            OrderRef::Exchange(_) => None,
        }
    }
    #[inline]
    pub const fn exchange_id(&self) -> Option<ExchangeOrderId> {
        match *self {
            OrderRef::Exchange(e) | OrderRef::Both(_, e) => Some(e),
            OrderRef::Cid(_) => None,
        }
    }
}

/// TS intent kind strings (trace `intent.kind`).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum IntentKind {
    PlaceLimit,
    PlaceBatch,
    CancelOrder,
    CancelBatch,
    CancelMarket,
    CancelAll,
    SplitPositions,
    MergePositions,
}

impl IntentKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            IntentKind::PlaceLimit => "place_limit",
            IntentKind::PlaceBatch => "place_batch",
            IntentKind::CancelOrder => "cancel_order",
            IntentKind::CancelBatch => "cancel_batch",
            IntentKind::CancelMarket => "cancel_market",
            IntentKind::CancelAll => "cancel_all",
            IntentKind::SplitPositions => "split_positions",
            IntentKind::MergePositions => "merge_positions",
        }
    }
}

/// A strategy or engine intent (10 §7.3), borrowed from [`Intents`].
/// `Copy`, 24 bytes; batch storage lives in the buffer (P1).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Intent<'a> {
    PlaceLimit(&'a OrderRequest),
    /// 1..=N orders; the batch cap is enforced by the engine (11 §9).
    PlaceBatch(&'a [OrderRequest]),
    CancelOrder(OrderRef),
    /// The cancel-id cap is enforced by the engine (11 §9).
    CancelBatch(&'a [OrderRef]),
    /// `None`: the whole market (the session's condition id).
    CancelMarket(Option<Outcome>),
    CancelAll,
    /// Full sets; costs `size` USDC. The pair is always (UP, DOWN) (N3).
    SplitPositions {
        size: Qty,
    },
    MergePositions {
        size: Qty,
    },
}

impl Intent<'_> {
    pub const fn kind(&self) -> IntentKind {
        match self {
            Intent::PlaceLimit(_) => IntentKind::PlaceLimit,
            Intent::PlaceBatch(_) => IntentKind::PlaceBatch,
            Intent::CancelOrder(_) => IntentKind::CancelOrder,
            Intent::CancelBatch(_) => IntentKind::CancelBatch,
            Intent::CancelMarket(_) => IntentKind::CancelMarket,
            Intent::CancelAll => IntentKind::CancelAll,
            Intent::SplitPositions { .. } => IntentKind::SplitPositions,
            Intent::MergePositions { .. } => IntentKind::MergePositions,
        }
    }

    /// The orders of a placement (one for `PlaceLimit`), else empty (N2).
    pub fn orders(&self) -> &[OrderRequest] {
        match self {
            Intent::PlaceLimit(o) => std::slice::from_ref(*o),
            Intent::PlaceBatch(os) => os,
            _ => &[],
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Slot {
    Place { start: u32, len: u32, batch: bool },
    CancelOrder(OrderRef),
    CancelBatch { start: u32, len: u32 },
    CancelMarket(Option<Outcome>),
    CancelAll,
    Split(Qty),
    Merge(Qty),
}

/// Engine-owned, reusable intent buffer (10 P3, 30 §7). Buffer order is
/// submission order. `clear` keeps capacity.
#[derive(Default, Clone, Debug)]
pub struct Intents {
    slots: Vec<Slot>,
    orders: Vec<OrderRequest>,
    refs: Vec<OrderRef>,
}

impl Intents {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_capacity(intents: usize, orders: usize) -> Self {
        Intents {
            slots: Vec::with_capacity(intents),
            orders: Vec::with_capacity(orders),
            refs: Vec::new(),
        }
    }

    /// Empties the buffer and keeps its capacity.
    #[inline]
    pub fn clear(&mut self) {
        self.slots.clear();
        self.orders.clear();
        self.refs.clear();
    }

    /// Number of intents (a batch counts once).
    #[inline]
    pub fn len(&self) -> usize {
        self.slots.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// Number of orders over all placements.
    #[inline]
    pub fn order_count(&self) -> usize {
        self.orders.len()
    }

    pub fn place(&mut self, order: OrderRequest) {
        let start = self.orders.len() as u32;
        self.orders.push(order);
        self.slots.push(Slot::Place {
            start,
            len: 1,
            batch: false,
        });
    }

    /// Appends a `PlaceBatch` with the given orders (stored as written; the
    /// engine validates the count).
    pub fn place_batch<I: IntoIterator<Item = OrderRequest>>(&mut self, orders: I) {
        let start = self.orders.len();
        self.orders.extend(orders);
        self.slots.push(Slot::Place {
            start: start as u32,
            len: (self.orders.len() - start) as u32,
            batch: true,
        });
    }

    pub fn cancel(&mut self, r: OrderRef) {
        self.slots.push(Slot::CancelOrder(r));
    }

    pub fn cancel_batch<I: IntoIterator<Item = OrderRef>>(&mut self, refs: I) {
        let start = self.refs.len();
        self.refs.extend(refs);
        self.slots.push(Slot::CancelBatch {
            start: start as u32,
            len: (self.refs.len() - start) as u32,
        });
    }

    pub fn cancel_market(&mut self, outcome: Option<Outcome>) {
        self.slots.push(Slot::CancelMarket(outcome));
    }

    pub fn cancel_all(&mut self) {
        self.slots.push(Slot::CancelAll);
    }

    pub fn split(&mut self, size: Qty) {
        self.slots.push(Slot::Split(size));
    }

    pub fn merge(&mut self, size: Qty) {
        self.slots.push(Slot::Merge(size));
    }

    /// The `i`-th intent.
    pub fn get(&self, i: usize) -> Option<Intent<'_>> {
        self.slots.get(i).map(|s| self.view(s))
    }

    /// Intents in submission order.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = Intent<'_>> + '_ {
        self.slots.iter().map(|s| self.view(s))
    }

    fn view(&self, s: &Slot) -> Intent<'_> {
        match *s {
            Slot::Place { start, len, batch } => {
                let os = &self.orders[start as usize..(start + len) as usize];
                if batch {
                    Intent::PlaceBatch(os)
                } else {
                    Intent::PlaceLimit(&os[0])
                }
            }
            Slot::CancelOrder(r) => Intent::CancelOrder(r),
            Slot::CancelBatch { start, len } => {
                Intent::CancelBatch(&self.refs[start as usize..(start + len) as usize])
            }
            Slot::CancelMarket(o) => Intent::CancelMarket(o),
            Slot::CancelAll => Intent::CancelAll,
            Slot::Split(size) => Intent::SplitPositions { size },
            Slot::Merge(size) => Intent::MergePositions { size },
        }
    }
}

/// GD3: `now + early_expiry + lifetime`, the docs' recipe "now + 60 + N".
#[inline]
pub fn gtd_expiration_for_lifetime(
    now: TsMs,
    early_expiry: DurMs,
    lifetime: DurMs,
) -> Result<TsMs, Overflow> {
    now.checked_add(early_expiry)?.checked_add(lifetime)
}

/// N6 (D54): whether a new order (outcome `o`, side, price `p`) could match an
/// own order (outcome, side, price `q`) at the exchange. Market orders pass
/// their worst acceptable price. Directly: BUY vs own SELL on `o` with
/// `p ≥ q`, SELL vs own BUY with `p ≤ q`; through complementary matching:
/// BUY vs own BUY on the other outcome with `p + q ≥ 1` (mint), SELL vs own
/// SELL on the other outcome with `p + q ≤ 1` (merge).
#[inline]
pub fn could_self_cross(new: (Outcome, Side, Price), own: (Outcome, Side, Price)) -> bool {
    let ((o, s, p), (oo, os, q)) = (new, own);
    let sum = p.micros() as i128 + q.micros() as i128;
    let one = crate::SCALE as i128;
    match (o == oo, s, os) {
        (true, Side::Buy, Side::Sell) => p >= q,
        (true, Side::Sell, Side::Buy) => p <= q,
        (false, Side::Buy, Side::Buy) => sum >= one,
        (false, Side::Sell, Side::Sell) => sum <= one,
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Intent meta (10 §7.5)
// ---------------------------------------------------------------------------

/// Per-order serialized meta cap: 16 KiB (21 §16); larger → `MetaTooLarge`.
pub const META_MAX_BYTES: usize = 16 * 1024;

/// Meta text exceeds [`META_MAX_BYTES`].
#[derive(Copy, Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("order meta larger than 16 KiB")]
pub struct MetaTooLarge;

/// Session meta store (E1): pre-serialized JSON objects addressed by
/// [`MetaId`], stored once and never parsed or cloned by the engine. The
/// caller (SDK) serializes; the store only enforces the size cap.
#[derive(Default, Clone, Debug)]
pub struct MetaStore {
    items: Vec<Box<str>>,
}

impl MetaStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Stores serialized JSON text and returns its id.
    pub fn insert(&mut self, json: &str) -> Result<MetaId, MetaTooLarge> {
        if json.len() > META_MAX_BYTES {
            return Err(MetaTooLarge);
        }
        let id = MetaId(self.items.len() as u32);
        self.items.push(json.into());
        Ok(id)
    }

    #[inline]
    pub fn get(&self, id: MetaId) -> &str {
        &self.items[id.index()]
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(cid: u32) -> OrderRequest {
        OrderRequest::gtc(
            CidKey(cid),
            Outcome::Up,
            Side::Buy,
            Price::from_micros(530_000),
            Qty::from_micros(10_000_000),
        )
    }

    #[test]
    fn intents_buffer_round_trip() {
        let mut b = Intents::new();
        b.place(req(0));
        b.place_batch([req(1), req(2)]);
        b.cancel(OrderRef::Cid(CidKey(0)));
        b.cancel_batch([OrderRef::Cid(CidKey(1)), OrderRef::Cid(CidKey(2))]);
        b.cancel_market(Some(Outcome::Down));
        b.cancel_all();
        b.split(Qty::from_micros(1));
        b.merge(Qty::from_micros(2));
        assert_eq!(b.len(), 8);
        assert_eq!(b.order_count(), 3);
        let v: Vec<_> = b.iter().collect();
        assert_eq!(v[0], Intent::PlaceLimit(&req(0)));
        assert_eq!(v[0].orders(), &[req(0)]);
        assert_eq!(v[1].orders(), &[req(1), req(2)]);
        assert_eq!(v[1].kind().as_str(), "place_batch");
        assert!(matches!(v[3], Intent::CancelBatch(r) if r.len() == 2));
        assert_eq!(v[4], Intent::CancelMarket(Some(Outcome::Down)));
        assert_eq!(
            v[7],
            Intent::MergePositions {
                size: Qty::from_micros(2)
            }
        );
        let cap = b.slots.capacity();
        b.clear();
        assert!(b.is_empty());
        assert_eq!(b.slots.capacity(), cap);
    }

    #[test]
    fn sizes() {
        assert!(std::mem::size_of::<Intent<'_>>() <= 64);
        assert!(std::mem::size_of::<OrderRequest>() <= 80);
    }

    #[test]
    fn market_buy_converts_to_collateral() {
        let mut r = req(0);
        r.order_type = OrderType::Fok;
        r.price = Price::from_micros(530_000);
        r.size = OrderSize::Shares(Qty::from_micros(3_333_333));
        // 0.53 × 3.333333 = 1.76666649 → floor micros 1.766666 → 4 dp 1.7666
        let c = r.to_collateral_sized(4).unwrap();
        assert_eq!(c.size, OrderSize::Collateral(Usdc::from_micros(1_766_600)));
        let mut s = r;
        s.side = Side::Sell;
        assert_eq!(s.to_collateral_sized(4).unwrap(), s);
        assert_eq!(req(1).to_collateral_sized(4).unwrap(), req(1));
    }

    #[test]
    fn self_cross_rules() {
        use Outcome::*;
        use Side::*;
        let p = Price::from_micros;
        assert!(could_self_cross(
            (Up, Buy, p(500_000)),
            (Up, Sell, p(500_000))
        ));
        assert!(!could_self_cross(
            (Up, Buy, p(490_000)),
            (Up, Sell, p(500_000))
        ));
        assert!(could_self_cross(
            (Up, Sell, p(500_000)),
            (Up, Buy, p(510_000))
        ));
        assert!(!could_self_cross(
            (Up, Sell, p(520_000)),
            (Up, Buy, p(510_000))
        ));
        assert!(could_self_cross(
            (Up, Buy, p(600_000)),
            (Down, Buy, p(400_000))
        ));
        assert!(!could_self_cross(
            (Up, Buy, p(590_000)),
            (Down, Buy, p(400_000))
        ));
        assert!(could_self_cross(
            (Up, Sell, p(600_000)),
            (Down, Sell, p(400_000))
        ));
        assert!(!could_self_cross(
            (Up, Sell, p(610_000)),
            (Down, Sell, p(400_000))
        ));
        assert!(!could_self_cross(
            (Up, Buy, p(990_000)),
            (Up, Buy, p(990_000))
        ));
        assert!(!could_self_cross(
            (Up, Buy, p(990_000)),
            (Down, Sell, p(10_000))
        ));
    }

    #[test]
    fn gtd_lifetime_and_meta() {
        assert_eq!(
            gtd_expiration_for_lifetime(TsMs(1_000), DurMs(60_000), DurMs(180_000)).unwrap(),
            TsMs(241_000)
        );
        let mut m = MetaStore::new();
        let id = m.insert("{\"a\":1}").unwrap();
        assert_eq!(m.get(id), "{\"a\":1}");
        assert_eq!(m.insert(&"x".repeat(META_MAX_BYTES + 1)), Err(MetaTooLarge));
        assert!(OrderType::Gtd.allows_post_only() && !OrderType::Fak.allows_post_only());
    }
}
