//! Author order builders (30 §7) on top of the engine-owned intent buffer
//! (`pmb_engine::strategy::Intents`, 10 §11 P3, 12 §6.1).
//!
//! Builders enforce structural invariants only (30 §1 P6, §7.1): GTD takes
//! its expiry as an argument, `post_only()` exists only on [`LimitOrder`]
//! (GTC/GTD), FOK/FAK never rest ([`MarketableOrder`] has no `post_only`),
//! and collateral sizing exists only on market BUYs ([`SpendOrder`]). Every
//! value check (positivity, tick, minimum size, bounds, GTD lead, funding,
//! risk) is the engine's and surfaces as a typed `OrderRejected`.
//!
//! ```
//! use pmb_sdk::prelude::*;
//!
//! let mut out = Intents::new();
//! out.place(Order::buy(Outcome::Up, price!(0.48), qty!(10)).post_only().cid(cid!("x1")));
//! out.place(Order::sell(Outcome::Down, price!(0.55), qty!(4)).gtd(TsMs(1_760_140_930_000)).cid(cid!("x2")));
//! out.place(Order::buy(Outcome::Down, price!(0.53), qty!(5)).fok().cid(cid!("x3")));
//! out.place(Order::buy_spend(Outcome::Up, price!(0.60), usdc!(2.5)).fak().cid(cid!("x4")));
//! assert_eq!(out.len(), 4);
//! ```

use pmb_core::order::{OrderRequest, OrderSize, OrderType, Side};
use pmb_core::{CidKey, ClientOrderId, Outcome, Price, Qty, TsMs, Usdc};
use pmb_engine::strategy::Intents;

use crate::meta::{Meta, MetaValue};

/// Namespace of the order constructors (30 §7): [`Order::buy`],
/// [`Order::sell`] and [`Order::buy_spend`].
#[derive(Debug)]
pub enum Order {}

impl Order {
    /// A share-sized BUY limit order, GTC by default (30 §7).
    #[inline]
    pub fn buy(outcome: Outcome, price: Price, qty: Qty) -> LimitOrder {
        LimitOrder::new(outcome, Side::Buy, price, qty)
    }

    /// A share-sized SELL limit order, GTC by default (30 §7).
    #[inline]
    pub fn sell(outcome: Outcome, price: Price, qty: Qty) -> LimitOrder {
        LimitOrder::new(outcome, Side::Sell, price, qty)
    }

    /// A collateral-sized market BUY: spend at most `usdc` (pre-fee) at
    /// prices up to `max_price` (30 §7, 10 §7.2 O2). Finish it with
    /// [`SpendOrder::fok`] or [`SpendOrder::fak`]; collateral sizing exists
    /// only on market BUYs (10 §7.2 O1).
    #[inline]
    pub fn buy_spend(outcome: Outcome, max_price: Price, usdc: Usdc) -> SpendOrder {
        SpendOrder {
            outcome,
            max_price,
            usdc,
        }
    }
}

/// Options every order carries (30 §7: `.cid`, `.meta`, `.note`).
#[derive(Clone, Debug, Default, PartialEq)]
struct Common {
    cid: Option<ClientOrderId>,
    meta: Option<Meta>,
    note: Option<&'static str>,
}

/// A resting order: GTC (default) or GTD, optionally post-only (30 §7).
#[derive(Clone, Debug, PartialEq)]
#[must_use = "an order does nothing until it is placed with `out.place(..)`"]
pub struct LimitOrder {
    outcome: Outcome,
    side: Side,
    price: Price,
    qty: Qty,
    expire_at: Option<TsMs>,
    post_only: bool,
    common: Common,
}

impl LimitOrder {
    fn new(outcome: Outcome, side: Side, price: Price, qty: Qty) -> LimitOrder {
        LimitOrder {
            outcome,
            side,
            price,
            qty,
            expire_at: None,
            post_only: false,
            common: Common::default(),
        }
    }

    /// GTD with the stated exchange expiration `expire_at` (30 §7, 10 §7.4).
    /// `ctx.gtd_expiration(lifetime)` builds the docs' "now + 60 + N" value.
    #[inline]
    pub fn gtd(mut self, expire_at: TsMs) -> LimitOrder {
        self.expire_at = Some(expire_at);
        self
    }

    /// Post-only: the order is rejected instead of taking liquidity (30 §7).
    #[inline]
    pub fn post_only(mut self) -> LimitOrder {
        self.post_only = true;
        self
    }

    /// Fill-or-kill: fill the whole size at once or cancel (30 §7).
    ///
    /// In the realistic profile, paper and live a share-sized market BUY is
    /// converted to collateral at the limit price and can **receive more
    /// shares than requested** when it fills below the limit (10 §7.2 O2,
    /// D42). ts-compat sizes it in shares, as TS does (10 §7.2 O3). Use
    /// [`Order::buy_spend`] for an exact spend.
    #[inline]
    pub fn fok(self) -> MarketableOrder {
        self.marketable(OrderType::Fok)
    }

    /// Fill-and-kill: fill what is available at once, cancel the rest
    /// (30 §7; no TS counterpart).
    ///
    /// In the realistic profile, paper and live a share-sized market BUY is
    /// converted to collateral at the limit price and can **receive more
    /// shares than requested** when it fills below the limit (10 §7.2 O2,
    /// D42). ts-compat sizes it in shares (10 §7.2 O3).
    #[inline]
    pub fn fak(self) -> MarketableOrder {
        self.marketable(OrderType::Fak)
    }

    fn marketable(self, order_type: OrderType) -> MarketableOrder {
        MarketableOrder {
            outcome: self.outcome,
            side: self.side,
            price: self.price,
            size: OrderSize::Shares(self.qty),
            order_type,
            common: self.common,
        }
    }

    /// The client order id (30 §6: unique per active order).
    #[inline]
    pub fn cid(mut self, cid: ClientOrderId) -> LimitOrder {
        self.common.cid = Some(cid);
        self
    }

    /// Order meta (30 §7.2), serialized once at placement.
    #[inline]
    pub fn meta(mut self, meta: Meta) -> LimitOrder {
        self.common.meta = Some(meta);
        self
    }

    /// A log and trace note; never affects behavior (10 §7.2).
    #[inline]
    pub fn note(mut self, note: &'static str) -> LimitOrder {
        self.common.note = Some(note);
        self
    }

    fn request(&self) -> OrderRequest {
        let order_type = if self.expire_at.is_some() {
            OrderType::Gtd
        } else {
            OrderType::Gtc
        };
        OrderRequest {
            cid: CidKey::new(0),
            outcome: self.outcome,
            side: self.side,
            price: self.price,
            size: OrderSize::Shares(self.qty),
            order_type,
            post_only: self.post_only,
            expire_at_ms: self.expire_at,
            meta: None,
            note: self.common.note,
        }
    }
}

/// A FOK or FAK order: never rests, never post-only (30 §7.1).
#[derive(Clone, Debug, PartialEq)]
#[must_use = "an order does nothing until it is placed with `out.place(..)`"]
pub struct MarketableOrder {
    outcome: Outcome,
    side: Side,
    price: Price,
    size: OrderSize,
    order_type: OrderType,
    common: Common,
}

impl MarketableOrder {
    /// The client order id (30 §6: unique per active order).
    #[inline]
    pub fn cid(mut self, cid: ClientOrderId) -> MarketableOrder {
        self.common.cid = Some(cid);
        self
    }

    /// Order meta (30 §7.2), serialized once at placement.
    #[inline]
    pub fn meta(mut self, meta: Meta) -> MarketableOrder {
        self.common.meta = Some(meta);
        self
    }

    /// A log and trace note; never affects behavior (10 §7.2).
    #[inline]
    pub fn note(mut self, note: &'static str) -> MarketableOrder {
        self.common.note = Some(note);
        self
    }

    fn request(&self) -> OrderRequest {
        OrderRequest {
            cid: CidKey::new(0),
            outcome: self.outcome,
            side: self.side,
            price: self.price,
            size: self.size,
            order_type: self.order_type,
            post_only: false,
            expire_at_ms: None,
            meta: None,
            note: self.common.note,
        }
    }
}

/// A collateral-sized market BUY before its time in force (30 §7
/// `Order::buy_spend(o, max_price, usdc).fok()` / `.fak()`).
// D-PENDING: 30 §7 names no type for the value between `buy_spend` and
// `.fok()`/`.fak()`; chose `SpendOrder` (pmb_sdk::SpendOrder, not in the
// prelude: authors never name it).
#[derive(Clone, Debug, PartialEq)]
#[must_use = "finish a spend order with `.fok()` or `.fak()`"]
pub struct SpendOrder {
    outcome: Outcome,
    max_price: Price,
    usdc: Usdc,
}

impl SpendOrder {
    /// Fill-or-kill spend of the whole amount (10 §7.2 O2).
    #[inline]
    pub fn fok(self) -> MarketableOrder {
        self.finish(OrderType::Fok)
    }

    /// Fill-and-kill spend of what is available (10 §7.2 O2).
    #[inline]
    pub fn fak(self) -> MarketableOrder {
        self.finish(OrderType::Fak)
    }

    fn finish(self, order_type: OrderType) -> MarketableOrder {
        MarketableOrder {
            outcome: self.outcome,
            side: Side::Buy,
            price: self.max_price,
            size: OrderSize::Collateral(self.usdc),
            order_type,
            common: Common::default(),
        }
    }
}

mod sealed {
    pub trait Sealed {}
    impl Sealed for super::LimitOrder {}
    impl Sealed for super::MarketableOrder {}
    impl Sealed for pmb_engine::strategy::Intents {}
}

/// An order [`IntentsExt::place`] accepts: [`LimitOrder`] or
/// [`MarketableOrder`]. Sealed.
pub trait PlaceableOrder: sealed::Sealed {
    #[doc(hidden)]
    fn __parts(&self) -> (Option<&ClientOrderId>, OrderRequest, Option<&Meta>);
}

impl PlaceableOrder for LimitOrder {
    fn __parts(&self) -> (Option<&ClientOrderId>, OrderRequest, Option<&Meta>) {
        (
            self.common.cid.as_ref(),
            self.request(),
            self.common.meta.as_ref(),
        )
    }
}

impl PlaceableOrder for MarketableOrder {
    fn __parts(&self) -> (Option<&ClientOrderId>, OrderRequest, Option<&Meta>) {
        (
            self.common.cid.as_ref(),
            self.request(),
            self.common.meta.as_ref(),
        )
    }
}

/// The cid of an order being placed. 10 §7.2 makes the cid a required
/// field of every placement; a builder without `.cid(..)` is a programming
/// error, reported as a strategy panic (`strategy_fault: panic`, 30 §12)
/// that names the fix (30 §17).
// D-PENDING: 30 §7 lists `.cid` as an option on every order while 10 §7.2
// requires a cid on every placement; chose to fail loud at `place` (no
// engine-generated cid, which would be a new behavior), pending a 02 entry.
#[track_caller]
fn required_cid(cid: Option<&ClientOrderId>) -> &ClientOrderId {
    match cid {
        Some(c) => c,
        None => panic!(
            "Intents::place: the order has no client order id; every placement needs one \
             (10 §7.2): add `.cid(cid!(\"..\"))` or `.cid(ClientOrderId::indexed(\"r\", n))`"
        ),
    }
}

/// SDK meta as the engine's scalar meta (10 §7.5).
// D-PENDING: the engine's placement meta (`pmb_engine::strategy::Meta`) is
// scalar-only (its own D-PENDING); chose: exact decimals become the nearest
// f64, `null` becomes a non-finite f64 (serialized as `null`, 21 §16), and
// nested JSON (`Meta::json`) fails loud until the engine stores the SDK's
// serialized meta (crossStreamNeeds).
#[track_caller]
fn engine_meta(m: &Meta) -> pmb_engine::strategy::Meta {
    use pmb_engine::strategy::MetaValue as E;
    let mut out = pmb_engine::strategy::Meta::new();
    for (k, v) in m.entries() {
        let v = match v {
            MetaValue::Null => E::F64(f64::NAN),
            MetaValue::Bool(b) => E::Bool(*b),
            MetaValue::Int(i) => E::I64(*i),
            MetaValue::Float(f) => E::F64(*f),
            MetaValue::Decimal(micros) => {
                E::F64(pmb_core::Usdc::from_micros(*micros).to_f64_lossy())
            }
            MetaValue::Str(s) => E::Str(s.as_ref().into()),
            MetaValue::Json(_) => panic!(
                "order meta key {k:?}: nested JSON meta (Meta::json) is not supported by this \
                 engine build yet; use scalar values"
            ),
        };
        out.push(k, v);
    }
    out
}

/// The author intent methods of 30 §7 on the engine buffer `Intents`
/// (in scope through the prelude; the trait name is not part of the SDK
/// surface). The other 30 §7 methods (`cancel`, `cancel_exchange_id`,
/// `cancel_market`, `cancel_all`, `split`, `merge`, `place_batch`,
/// `cancel_batch`) are the buffer's own.
pub trait IntentsExt: sealed::Sealed {
    /// Places one order (`PlaceLimit`, 30 §7).
    ///
    /// # Panics
    ///
    /// When the order has no client order id (10 §7.2).
    fn place<O: PlaceableOrder>(&mut self, order: O);
}

impl IntentsExt for Intents {
    #[track_caller]
    fn place<O: PlaceableOrder>(&mut self, order: O) {
        let (cid, req, meta) = order.__parts();
        let cid = required_cid(cid);
        self.place_request(cid, req, meta.map(engine_meta));
    }
}

/// One `place_batch` item (30 §7 `out.place_batch([o1, o2, ..])`): the
/// engine buffer's `place_batch` takes `(cid, request, meta)` items.
///
/// ```
/// use pmb_sdk::prelude::*;
///
/// let mut out = Intents::new();
/// let orders = [
///     Order::sell(Outcome::Up, price!(0.55), qty!(4)).cid(cid!("x4a")),
///     Order::sell(Outcome::Down, price!(0.56), qty!(4)).cid(cid!("x4b")),
/// ];
/// out.place_batch(orders.iter().map(LimitOrder::batch_item));
/// assert_eq!(out.len(), 1);
/// ```
// D-PENDING: 30 §7 spells `out.place_batch([o1, o2])` and
// `out.cancel_batch([&cid, ..])`; the engine buffer's inherent methods of
// those names take request-level items and shadow any SDK method of the
// same name. Chose `LimitOrder::batch_item` (and `CancelRef::Cid` for
// cancels) until the engine renames its request-level entry points
// (crossStreamNeeds); then the 30 §7 signatures land here.
impl LimitOrder {
    /// `(cid, request, meta)` of this order for `Intents::place_batch`.
    ///
    /// # Panics
    ///
    /// When the order has no client order id (10 §7.2).
    #[track_caller]
    pub fn batch_item(
        &self,
    ) -> (
        &ClientOrderId,
        OrderRequest,
        Option<pmb_engine::strategy::Meta>,
    ) {
        let (cid, req, meta) = self.__parts();
        (required_cid(cid), req, meta.map(engine_meta))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prelude::*;
    use pmb_core::order::{Intent, OrderRef};

    fn place_of(out: &Intents, i: usize) -> OrderRequest {
        match out.get(i) {
            Some(Intent::PlaceLimit(r)) => *r,
            other => panic!("intent {i}: {other:?}"),
        }
    }

    #[test]
    fn builders_set_type_size_and_options() {
        // spec: 30 §7 builder table, §7.1 structural invariants
        let mut out = Intents::new();
        out.place(Order::buy(Outcome::Up, price!(0.48), qty!(10)).cid(cid!("a")));
        out.place(
            Order::sell(Outcome::Down, price!(0.55), qty!(4))
                .gtd(TsMs(9_000))
                .post_only()
                .note("exit")
                .cid(cid!("b")),
        );
        out.place(
            Order::buy(Outcome::Down, price!(0.53), qty!(5))
                .fok()
                .cid(cid!("c")),
        );
        out.place(
            Order::sell(Outcome::Up, price!(0.40), qty!(2))
                .fak()
                .cid(cid!("d")),
        );
        out.place(
            Order::buy_spend(Outcome::Up, price!(0.6), usdc!(2.5))
                .fok()
                .cid(cid!("e")),
        );
        let a = place_of(&out, 0);
        assert_eq!(
            (a.order_type, a.post_only, a.expire_at_ms),
            (OrderType::Gtc, false, None)
        );
        assert_eq!(a.size, OrderSize::Shares(qty!(10)));
        assert_eq!(out.local_cid_text(a.cid), "a");
        let b = place_of(&out, 1);
        assert_eq!(
            (b.order_type, b.post_only, b.expire_at_ms, b.side, b.note),
            (
                OrderType::Gtd,
                true,
                Some(TsMs(9_000)),
                Side::Sell,
                Some("exit")
            )
        );
        let c = place_of(&out, 2);
        assert_eq!((c.order_type, c.post_only), (OrderType::Fok, false));
        assert_eq!(c.size, OrderSize::Shares(qty!(5)));
        assert_eq!(place_of(&out, 3).order_type, OrderType::Fak);
        let e = place_of(&out, 4);
        assert_eq!(
            (e.order_type, e.side, e.price),
            (OrderType::Fok, Side::Buy, price!(0.6))
        );
        assert_eq!(e.size, OrderSize::Collateral(usdc!(2.5)));
        assert_eq!(out.local_cid_text(e.cid), "e");
    }

    #[test]
    fn batch_and_cancel_batch_keep_order() {
        // spec: 30 §7 (place_batch, cancel_batch; buffer order is submission order)
        let mut out = Intents::new();
        let orders = [
            Order::sell(Outcome::Up, price!(0.55), qty!(4)).cid(cid!("x4a")),
            Order::sell(Outcome::Down, price!(0.56), qty!(4)).cid(cid!("x4b")),
        ];
        out.place_batch(orders.iter().map(LimitOrder::batch_item));
        out.cancel_batch([&cid!("x4a"), &cid!("x9")].map(CancelRef::Cid));
        let Some(Intent::PlaceBatch(b)) = out.get(0) else {
            panic!("batch first")
        };
        let cids: Vec<&str> = b.iter().map(|r| out.local_cid_text(r.cid)).collect();
        assert_eq!(cids, ["x4a", "x4b"]);
        let Some(Intent::CancelBatch(refs)) = out.get(1) else {
            panic!("cancel batch second")
        };
        let cids: Vec<&str> = refs
            .iter()
            .map(|r| match r {
                OrderRef::Cid(k) => out.local_cid_text(*k),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(cids, ["x4a", "x9"]);
    }

    #[test]
    fn a_placement_without_cid_fails_loud() {
        // spec: 10 §7.2 (cid required), 30 §17 (message names the fix), R14
        let r = std::panic::catch_unwind(|| {
            let mut out = Intents::new();
            out.place(Order::buy(Outcome::Up, price!(0.5), qty!(1)));
        });
        let msg = *r.unwrap_err().downcast::<&str>().unwrap();
        assert!(msg.contains(".cid(cid!"), "{msg}");
    }

    #[test]
    fn meta_reaches_the_engine_buffer() {
        // spec: 30 §7.2 (scalar meta values), 21 §16 (non-finite → null)
        let m = meta! { "edge" => 0.031, "leg" => "entry", "n" => 3, "px" => price!(0.53), "none" => Option::<i64>::None };
        assert_eq!(
            engine_meta(&m).to_json(),
            r#"{"edge":0.031,"leg":"entry","n":3,"px":0.53,"none":null}"#
        );
        let mut out = Intents::new();
        out.place(
            Order::buy(Outcome::Up, price!(0.5), qty!(1))
                .meta(m)
                .cid(cid!("m")),
        );
        assert!(place_of(&out, 0).meta.is_some());
        let mut nested = Meta::new();
        nested.json("levels", crate::json::Value::from(vec![1, 2]));
        assert!(std::panic::catch_unwind(|| engine_meta(&nested)).is_err());
    }
}
