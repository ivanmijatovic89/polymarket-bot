//! The ts-compat composition (13 §5): `CompatTaker` (TC-E3, TC-E4),
//! `WorstQueueCompat` maker (TC-E5), compat cancels (TC-C5, TC-C10) and
//! synchronous split/merge (TC-E9), with the rule values of 11 §4.
//!
//! These are model implementations configured by `ModelConfig`, not a copy
//! of the TS adapter's structure (R4): one placement path for single orders
//! and batches (10 N2), orders addressed by `OrderKey` only (13 X3), and the
//! TS oracle (`src/trading/execution/BacktestExecution.ts`) reproduced only
//! in the events it emits. The free remainder fill of 13 §5.3 (TC-E6) is
//! not coded: it emerges from the walk without depletion plus the
//! worst-queue maker rule.

use pmb_book::MarketBooks;
use pmb_core::event::{AccountEvent, AccountEventKind, CancelCause, DoneReason, RejectReason};
use pmb_core::fill::{Fill, Liquidity};
use pmb_core::ids::{OpKey, OrderKey};
use pmb_core::market_event::QuoteSide;
use pmb_core::order::{OrderSize, OrderType, Side};
use pmb_core::rules::post_only_would_cross;
use pmb_core::{Outcome, Price, Qty, TsMs, Usdc};

use super::book_overlay::{Deficits, RestingOrder};
use super::fee::FeeModel;
use super::fill::{fillable, make_fill, walk, FillModel, FillSpec, TakerSide};
use super::report::ReportModel;
use super::simulator::{ExchangeTruth, Models};
use crate::exec::{CancelScope, EventQueue, ExecCtx};
use crate::trace::{ExecTraceRecord, FillDetail, LifecycleTransition, OrderLifecycle};

/// `depletion: none` with the `CompatTaker` walk and the `WorstQueueCompat`
/// maker rule (13 §5.1; `models.depletion = none`, `models.maker =
/// worst_queue`).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct CompatFill;

impl FillModel for CompatFill {
    /// The recorded size: the recorded book is never depleted, so later
    /// orders in the same batch, tick or latency window see the same
    /// liquidity (TC-E3).
    #[inline]
    fn effective_size(
        &self,
        _deficits: &Deficits,
        _outcome: Outcome,
        _side: QuoteSide,
        _price: Price,
        recorded: Qty,
    ) -> Qty {
        recorded
    }

    #[inline]
    fn consume(&self, _deficits: &mut Deficits, _o: Outcome, _s: QuoteSide, _p: Price, _q: Qty) {}

    /// `WorstQueueCompat` (TC-E5): BUY with best ask strictly below the
    /// limit, or SELL with best bid strictly above it, fills the **whole**
    /// remainder at the limit; no volume cap, no partial fills
    /// (`BacktestExecution.ts:73-137`).
    #[inline]
    fn maker_fill(&self, order: &RestingOrder, books: &MarketBooks) -> Qty {
        let through = match order.side {
            Side::Buy => books
                .best_ask(order.outcome)
                .is_some_and(|a| a.price < order.price),
            Side::Sell => books
                .best_bid(order.outcome)
                .is_some_and(|b| b.price > order.price),
        };
        if through && order.remaining.is_positive() {
            order.remaining
        } else {
            Qty::ZERO
        }
    }
}

/// Delivery and exchange-side times of one execution (13 §4.3, §2.3 TS3):
/// `at` stamps delivered events (ts-compat: the decision stamp inside
/// `submit`, the tick's ts for queued actions); `due` stamps trace records.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Stamp {
    /// Delivery time of emitted account events.
    pub at: TsMs,
    /// Exchange-side due time of the action (trace only).
    pub due: TsMs,
}

#[inline]
fn push(out: &mut EventQueue, at: TsMs, kind: AccountEventKind) {
    out.push(AccountEvent { at, kind });
}

/// Records an `OrderLifecycle` when the sink wants it (13 §4.3, §10).
#[inline]
pub(crate) fn lifecycle(
    out: &mut EventQueue,
    order: OrderKey,
    transition: LifecycleTransition,
    due: TsMs,
) {
    if out.wants_trace() {
        out.record(ExecTraceRecord::Lifecycle(OrderLifecycle {
            order,
            transition,
            at: due,
        }));
    }
}

/// Emits one fill (13 §4.5), its `FillDetail` when wanted, and the report
/// model's follow-up (TC-E8: none in compat).
#[inline]
fn emit_fill(m: &Models, fill: Fill, out: &mut EventQueue) {
    push(out, fill.at, AccountEventKind::Fill(fill));
    if out.wants_trace() {
        out.record(ExecTraceRecord::FillDetail(FillDetail {
            fill,
            queue_ahead: None,
            place_latency_ms: None,
            report_latency_ms: None,
        }));
    }
    m.reports.filled(&fill, out);
}

/// The share size of a ts-compat order (10 O3: ts-compat sizes every order,
/// FOK BUYs included, in shares).
#[inline]
fn shares(size: OrderSize) -> Qty {
    match size {
        OrderSize::Shares(q) => q,
        // The ts-compat OM never builds collateral sizes (10 O3); reaching
        // this is an engine bug, never input data (R14: fail loud).
        OrderSize::Collateral(_) => panic!("ts-compat orders are share-sized (10 O3)"),
    }
}

/// Executes the orders of one `Place` in batch order (13 §5.1 `CompatTaker`
/// steps 1–5) against the recorded book of `cx.market`.
pub(crate) fn place(
    m: &Models,
    ex: &mut ExchangeTruth,
    keys: &[OrderKey],
    cx: &ExecCtx<'_>,
    s: Stamp,
    out: &mut EventQueue,
) {
    for &k in keys {
        place_one(m, ex, k, cx, s, out);
    }
}

fn place_one(
    m: &Models,
    ex: &mut ExchangeTruth,
    k: OrderKey,
    cx: &ExecCtx<'_>,
    s: Stamp,
    out: &mut EventQueue,
) {
    let rec = cx.order(k);
    let req = *rec.request();
    let books = &cx.market.books;
    let (outcome, side, limit) = (req.outcome, req.side, req.price);
    // D-PENDING: 13 §4.3 stamps OrderLifecycle with the action's due time,
    // but under NextRealTick a queued action takes effect at the releasing
    // tick's ts (later than its `execute_at`); chose the due time
    // (`execute_at`) for Scheduled/ExchangeVisible/Resting/CancelEffective
    // and the tick ts for scan-driven transitions (Expired), whose due time
    // is the tick itself.
    lifecycle(out, k, LifecycleTransition::ExchangeVisible, s.due);

    // Step 1: post-only crossing the best opposite price is rejected whole;
    // equality crosses, an empty side never crosses (11 §4).
    if req.post_only {
        let best = match side {
            Side::Buy => books.best_ask(outcome),
            Side::Sell => books.best_bid(outcome),
        };
        if post_only_would_cross(side, limit, best.map(|l| l.price)) {
            push(
                out,
                s.at,
                AccountEventKind::OrderRejected {
                    order: Some(k),
                    cid: req.cid,
                    reason: RejectReason::PostOnlyWouldCross,
                },
            );
            return;
        }
    }

    // Step 2: OrderAccepted, then the compat Matched status (10 V1).
    push(out, s.at, AccountEventKind::OrderAccepted { order: k });
    m.reports.accepted(k, s.at, out);

    let size = shares(req.size);
    let taker = TakerSide {
        outcome,
        side,
        limit,
    };
    let avail = fillable(&m.fill, &ex.deficits, books, taker);
    let order = TakerOrder {
        key: k,
        taker,
        size,
    };
    let mut fill_seq = 0u32;

    match req.order_type {
        // Step 3: FOK, sized in shares (TC-E4).
        OrderType::Fok => {
            if avail < size {
                done(out, s.at, k, DoneReason::Killed, Qty::ZERO);
                return;
            }
            let rem = taker_walk(m, ex, cx, order, &mut fill_seq, s, out);
            debug_assert!(rem.is_zero(), "FOK walk fills the checked size");
            done(out, s.at, k, DoneReason::Filled, size);
            m.reports.fok_filled(k, size, s.at, out);
        }
        // Step 4: GTC/GTD take what is available, then rest the remainder.
        OrderType::Gtc | OrderType::Gtd => {
            let rem = if avail.is_positive() {
                taker_walk(m, ex, cx, order, &mut fill_seq, s, out)
            } else {
                size
            };
            if !rem.is_positive() {
                done(out, s.at, k, DoneReason::Filled, size);
                return;
            }
            ex.resting.push(RestingOrder {
                key: k,
                outcome,
                side,
                price: limit,
                size,
                remaining: rem,
                // TC-E5: expires exactly at the stated `expire_at` (11 §4).
                expire_at: req.gtd_expiry(),
                fill_seq,
            });
            lifecycle(out, k, LifecycleTransition::Resting, s.due);
            push(out, s.at, AccountEventKind::OrderOpen { order: k });
        }
        // Step 5: FAK (no TS oracle, 10 §7.1): walk, kill any remainder,
        // never rest.
        // D-PENDING: 13 §5.1 step 5 names no status event after a FAK fill;
        // chose none (only the acceptance Matched of step 2), like GTC.
        OrderType::Fak => {
            let rem = taker_walk(m, ex, cx, order, &mut fill_seq, s, out);
            if rem.is_positive() {
                done(out, s.at, k, DoneReason::Killed, size - rem);
            } else {
                done(out, s.at, k, DoneReason::Filled, size);
            }
        }
    }
}

/// The order of one taker walk.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
struct TakerOrder {
    key: OrderKey,
    taker: TakerSide,
    size: Qty,
}

/// One taker walk: one trade (10 §6 `TradeSeq`, F-U2), one TAKER fill per
/// effective level at the level price, each charged once by the fee model
/// (TC-E7, 12 §9.5). Returns the remainder.
fn taker_walk(
    m: &Models,
    ex: &mut ExchangeTruth,
    cx: &ExecCtx<'_>,
    o: TakerOrder,
    fill_seq: &mut u32,
    s: Stamp,
    out: &mut EventQueue,
) -> Qty {
    let ExchangeTruth {
        deficits, trades, ..
    } = ex;
    let rules = &cx.market.rules;
    let mut trade = None;
    walk(
        &m.fill,
        deficits,
        &cx.market.books,
        o.taker,
        o.size,
        |price, qty| {
            let t = *trade.get_or_insert_with(|| trades.next_trade());
            let fee = m.fee.fill_fee(rules, Liquidity::Taker, price, qty);
            let f = make_fill(
                o.key,
                fill_seq,
                o.taker.outcome,
                o.taker.side,
                FillSpec {
                    trade: t,
                    price,
                    qty,
                    fee,
                    liquidity: Liquidity::Taker,
                    at: s.at,
                    exchange_ts: s.at,
                },
            );
            emit_fill(m, f, out);
        },
    )
}

fn done(out: &mut EventQueue, at: TsMs, order: OrderKey, reason: DoneReason, filled: Qty) {
    push(
        out,
        at,
        AccountEventKind::OrderDone {
            order,
            reason,
            filled: Some(filled),
        },
    );
}

/// Compat cancel of bound keys (TC-C5, TC-C10; `CancelOrder` bound to the
/// decision-time key, `CancelBatch` with OM-resolved keys): a resting key
/// ends `OrderDone(Canceled(cause), filled = size − remaining)`; a key that
/// is not resting at execution emits nothing (`BacktestExecution.ts:647-673`).
pub(crate) fn cancel_keys(
    ex: &mut ExchangeTruth,
    keys: &[OrderKey],
    cause: CancelCause,
    s: Stamp,
    out: &mut EventQueue,
) {
    for &k in keys {
        if let Some(i) = ex.resting.position(k) {
            let o = ex.resting.remove(i);
            canceled(out, &o, cause, s);
        }
    }
}

/// Compat `CancelMarket` / `CancelAll` (13 §5.1): the scope is resolved at
/// execution over resting orders, in rest order, so it includes orders that
/// started resting during the latency (`BacktestExecution.ts:690-709,
/// 744-751`). `None` = every resting order (`CancelAll`).
pub(crate) fn cancel_scope(
    ex: &mut ExchangeTruth,
    scope: Option<CancelScope>,
    cause: CancelCause,
    s: Stamp,
    out: &mut EventQueue,
) {
    let mut i = 0;
    while i < ex.resting.len() {
        let hit = match scope {
            None | Some(CancelScope::Market) => true,
            Some(CancelScope::Outcome(o)) => ex.resting.get(i).outcome == o,
        };
        if hit {
            let o = ex.resting.remove(i);
            canceled(out, &o, cause, s);
        } else {
            i += 1;
        }
    }
}

fn canceled(out: &mut EventQueue, o: &RestingOrder, cause: CancelCause, s: Stamp) {
    lifecycle(out, o.key, LifecycleTransition::CancelEffective, s.due);
    done(out, s.at, o.key, DoneReason::Canceled(cause), o.filled());
}

/// Synchronous split (TC-E9): `PositionsSplit{op, size, cost = size}`, never
/// failing (`BacktestExecution.ts:244-299`; cost per 10 R12, exact). The OM
/// already rejected sizes ≤ 0 (12 §7.3).
pub(crate) fn split(op: OpKey, size: Qty, at: TsMs, out: &mut EventQueue) {
    debug_assert!(size.is_positive(), "the OM rejects splits of size <= 0");
    push(
        out,
        at,
        AccountEventKind::PositionsSplit {
            op,
            size,
            cost: Usdc::from_micros(size.micros()),
        },
    );
}

/// Synchronous merge (TC-E9): `actual = min(requested, delivered Up,
/// delivered Down)` → `PositionsMerged{actual}`, nothing when `actual ≤ 0`
/// (`BacktestExecution.ts:301-328`). Positions are the ledger's delivered
/// quantities (client knowledge, which in ts-compat equals exchange truth,
/// 13 §4.1).
pub(crate) fn merge(op: OpKey, size: Qty, cx: &ExecCtx<'_>, at: TsMs, out: &mut EventQueue) {
    let up = cx.ledger.position(Outcome::Up).qty;
    let down = cx.ledger.position(Outcome::Down).qty;
    let actual = size.min(up).min(down);
    if actual.is_positive() {
        push(
            out,
            at,
            AccountEventKind::PositionsMerged { op, size: actual },
        );
    }
}

/// Whether no resting order can expire or fill on this tick (13 §5.1 early
/// exit): `now` precedes every GTD expiry and no own limit is strictly
/// through the opposite best of its outcome. Exact: the scan would emit
/// nothing.
fn scan_is_noop(ex: &mut ExchangeTruth, books: &MarketBooks, now: TsMs) -> bool {
    let b = ex.resting.bounds();
    if b.min_expiry.is_some_and(|e| now >= e) {
        return false;
    }
    for o in Outcome::ALL {
        // Book lookups only for sides with own orders.
        if let Some(lim) = b.max_buy[o] {
            if books.best_ask(o).is_some_and(|a| a.price < lim) {
                return false;
            }
        }
        if let Some(lim) = b.min_sell[o] {
            if books.best_bid(o).is_some_and(|x| x.price > lim) {
                return false;
            }
        }
    }
    true
}

/// The `WorstQueueCompat` maker scan of one real in-window tick (13 §5.1,
/// TC-E5), after queued actions ran: for each resting order in rest order,
/// GTD expiry first (it wins over a fill on the same tick, exactly at
/// `expire_at`), then the maker rule of the fill model; one MAKER fill per
/// match at the order's limit, fee from the fee model (0), its own trade,
/// then `OrderDone(Filled)` when nothing remains
/// (`BacktestExecution.ts:803-834`).
pub(crate) fn maker_scan(
    m: &Models,
    ex: &mut ExchangeTruth,
    cx: &ExecCtx<'_>,
    now: TsMs,
    out: &mut EventQueue,
) {
    if ex.resting.is_empty() || scan_is_noop(ex, &cx.market.books, now) {
        return;
    }
    maker_scan_full(m, ex, cx, now, out);
}

/// The maker scan without the early exit: the reference the early exit must
/// match event for event (13 §5.1, §10).
pub(crate) fn maker_scan_full(
    m: &Models,
    ex: &mut ExchangeTruth,
    cx: &ExecCtx<'_>,
    now: TsMs,
    out: &mut EventQueue,
) {
    let books = &cx.market.books;
    let mut i = 0;
    while i < ex.resting.len() {
        let o = *ex.resting.get(i);
        if o.expire_at.is_some_and(|e| now >= e) {
            ex.resting.remove(i);
            lifecycle(out, o.key, LifecycleTransition::Expired, now);
            done(out, now, o.key, DoneReason::Expired, o.filled());
            continue;
        }
        let qty = m.fill.maker_fill(&o, books);
        if !qty.is_positive() {
            i += 1;
            continue;
        }
        let trade = ex.trades.next_trade();
        let fee = m
            .fee
            .fill_fee(&cx.market.rules, Liquidity::Maker, o.price, qty);
        let r = ex.resting.get_mut(i);
        r.remaining -= qty;
        let f = make_fill(
            o.key,
            &mut r.fill_seq,
            o.outcome,
            o.side,
            FillSpec {
                trade,
                price: o.price,
                qty,
                fee,
                liquidity: Liquidity::Maker,
                at: now,
                exchange_ts: now,
            },
        );
        let left = r.remaining;
        emit_fill(m, f, out);
        if left.is_positive() {
            i += 1;
        } else {
            ex.resting.remove(i);
            done(out, now, o.key, DoneReason::Filled, o.size);
        }
    }
}
