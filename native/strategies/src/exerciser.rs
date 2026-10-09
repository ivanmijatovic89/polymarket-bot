//! Engine exerciser `engine-exerciser.rs` (60 §5.1–§5.7, 30 §18, D20): a
//! deterministic parity-test strategy, not a trading strategy. It drives the
//! engine's intent kinds and order types on real markets so the TS twin
//! (`src/strategies/testing/engine-exerciser.ts`, id `engine-exerciser`) and
//! this strategy can be diffed trace by trace.
//!
//! This revision implements schedule v1 (60 §5.2) and the account callback
//! A0 (60 §5.4). Schedule v2 (60 §5.3, A1–A3 and the per-order meta of
//! 60 §5.1) lands in M2 (01 §4.1) by adding rows to `SCHEDULE` and
//! `TRIGGERS`, attaching the meta in `Writer` and bumping
//! [`EXERCISER_SCHEDULE_VERSION`] in both twins (60 §5.7). Two v2 rows
//! cannot be built with the SDK builders, which enforce them structurally
//! (30 §7.1): `x17` (GTD without `expireAtMs`) and `x18` (post-only FOK).
//! M2 decides how the Rust twin covers them.
//!
//! Rules (60 §5.1):
//! - `n` counts the real `book`/`price_change` ticks delivered to the
//!   strategy inside the strategy window, from 0; synthetic feed ticks never
//!   count.
//! - An action whose best bid or ask is missing stays pending and is retried
//!   on every following tick, in schedule order, until it fires. A skip
//!   condition completes the action without an intent.
//! - Prices are snapped down (BUY) or up (SELL) to the fixed 0.01 tick, then
//!   clamped to [0.01, 0.99]. Fixed-point prices are always on the 1e-6 grid
//!   (00 R2), so the TS first step (snap to 1e-6) has no counterpart.
//! - Periodic slots from `n = 600` every 100 ticks: a new slot supersedes a
//!   still-pending older slot; the "no open orders" check reads the decision
//!   portfolio of that tick; the cancel fires at slot `n + 40` only if the
//!   slot's order was placed.

use pmb_sdk::prelude::*;

/// Schedule version implemented by both twins (60 §5.7); the parity manifest
/// records it and `run-parity` refuses a mismatch.
// D-PENDING: 60 §5.7 says `EXERCISER_SCHEDULE_VERSION = 2`; v2 (§5.3) is M2
// (01 §4.1), so this revision implements v1 and says 1, as the TS twin does.
pub const EXERCISER_SCHEDULE_VERSION: u32 = 1;

/// The exerciser's fixed price tick (60 §5.1), independent of the market's
/// rules tick.
pub const TICK: Price = price!(0.01);
/// Lowest price the exerciser sends (60 §5.1).
pub const MIN_PRICE: Price = price!(0.01);
/// Highest price the exerciser sends (60 §5.1).
pub const MAX_PRICE: Price = price!(0.99);

/// First periodic slot (60 §5.2 row `600 + 100k`).
const PERIODIC_FROM: u64 = 600;
/// Distance between periodic slots.
const PERIODIC_EVERY: u64 = 100;
/// A placed slot is canceled at slot `n + 40`.
const PERIODIC_CANCEL_AFTER: u64 = 40;

/// `x3` lifetime: `expireAtMs = tick ts + 120000` (60 §5.2).
const X3_LIFETIME: DurMs = DurMs(120_000);

/// A BUY price: snapped down to [`TICK`], clamped to
/// [[`MIN_PRICE`], [`MAX_PRICE`]] (60 §5.1).
pub fn buy_price(raw: Price) -> Price {
    raw.snap(TICK, Rounding::Floor).clamp(MIN_PRICE, MAX_PRICE)
}

/// A SELL price: snapped up to [`TICK`], clamped to
/// [[`MIN_PRICE`], [`MAX_PRICE`]] (60 §5.1).
pub fn sell_price(raw: Price) -> Price {
    raw.snap(TICK, Rounding::Ceil).clamp(MIN_PRICE, MAX_PRICE)
}

/// Engine exerciser params: none (60 §5.1, params `{}`).
#[derive(Params, Clone, Debug, Default)]
pub struct ExerciserParams;

/// Result of one scheduled action on one tick (60 §5.1).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Step {
    /// A needed best price is missing: the action stays pending.
    Retry,
    /// A skip condition held: the action completes without an intent.
    Skip,
    /// The action completed and wrote its intents.
    Fired,
}

/// A scheduled action: writes its intents, or says why it did not.
type Run = fn(&Ctx, &mut Writer<'_>) -> Step;

/// One row of the schedule (60 §5.2).
struct Action {
    /// First `n` at which the action may fire.
    at: u64,
    run: Run,
}

const fn row(at: u64, run: Run) -> Action {
    Action { at, run }
}

/// Schedule v1 (60 §5.2), ordered by `at`. Ties fire in table order.
const SCHEDULE: &[Action] = &[
    row(50, x1),
    row(60, x2),
    row(70, split),
    row(90, x3),
    row(100, x4),
    row(120, cancel_x1),
    row(150, x5),
    row(180, x6),
    row(200, x7),
    row(220, cancel_batch),
    row(260, merge),
    row(300, cancel_market_up),
    row(400, x8),
    row(500, cancel_all),
];

// The tick loop stops at the first row with `at > n`, and the done set is a
// `u64` bitmask over row indices.
const _: () = {
    assert!(SCHEDULE.len() <= 64, "the done set is a u64 bitmask");
    let mut i = 1;
    while i < SCHEDULE.len() {
        assert!(
            SCHEDULE[i - 1].at <= SCHEDULE[i].at,
            "SCHEDULE must be ordered by `at`"
        );
        i += 1;
    }
};

/// Account callbacks (60 §5.4), each fired on its first matching event
/// only. A trigger returns whether it matched (and then wrote its intents).
type Trigger = fn(&Ctx, &AccountEvent, &mut Writer<'_>) -> bool;

/// v1: A0. v2 appends A1–A3.
const TRIGGERS: &[Trigger] = &[a0_x2_exit];

const _: () = assert!(TRIGGERS.len() <= 32, "the fired set is a u32 bitmask");

/// Intent writer of one callback. Every placement goes through it, so
/// schedule v2 attaches `meta {"case": <cid>, "n": <n>}` (60 §5.1) here, in
/// one place.
struct Writer<'o> {
    out: &'o mut Intents,
}

impl Writer<'_> {
    /// Places a resting order with its client id.
    fn limit(&mut self, cid: ClientOrderId, order: LimitOrder) {
        self.out.place(order.cid(cid));
    }

    /// Places a FOK order with its client id.
    fn marketable(&mut self, cid: ClientOrderId, order: MarketableOrder) {
        self.out.place(order.cid(cid));
    }

    /// Places one `place_batch` of resting orders, in the given order.
    fn batch<const N: usize>(&mut self, orders: [(ClientOrderId, LimitOrder); N]) {
        self.out
            .place_batch(orders.map(|(cid, order)| order.cid(cid)));
    }
}

fn best_bid(ctx: &Ctx, o: Outcome) -> Option<Price> {
    ctx.book(o).best_bid().map(|l| l.price)
}

fn best_ask(ctx: &Ctx, o: Outcome) -> Option<Price> {
    ctx.book(o).best_ask().map(|l| l.price)
}

fn pos(ctx: &Ctx, o: Outcome) -> Qty {
    ctx.portfolio().position(o).qty
}

/// 50: GTC BUY UP @ bid(UP), size 10, postOnly, cid `x1`.
fn x1(ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    let Some(bid) = best_bid(ctx, Outcome::Up) else {
        return Step::Retry;
    };
    w.limit(
        cid!("x1"),
        Order::buy(Outcome::Up, buy_price(bid), qty!(10)).post_only(),
    );
    Step::Fired
}

/// 60: FOK BUY DOWN @ ask(DOWN), size 5, cid `x2`.
fn x2(ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    let Some(ask) = best_ask(ctx, Outcome::Down) else {
        return Step::Retry;
    };
    w.marketable(
        cid!("x2"),
        Order::buy(Outcome::Down, buy_price(ask), qty!(5)).fok(),
    );
    Step::Fired
}

/// 70: `split_positions` size 10.
fn split(_ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    w.out.split(qty!(10));
    Step::Fired
}

/// 90: GTD BUY UP @ bid(UP) − 0.02, size 6, expiry tick ts + 120 s, cid `x3`.
fn x3(ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    let Some(bid) = best_bid(ctx, Outcome::Up) else {
        return Step::Retry;
    };
    w.limit(
        cid!("x3"),
        Order::buy(Outcome::Up, buy_price(bid - price!(0.02)), qty!(6))
            .gtd(ctx.now() + X3_LIFETIME),
    );
    Step::Fired
}

/// 100: `place_batch` [GTC SELL UP @ ask(UP) + 0.03 size 4 `x4a`,
/// GTC SELL DOWN @ ask(DOWN) + 0.03 size 4 `x4b`].
fn x4(ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    let (Some(up), Some(down)) = (best_ask(ctx, Outcome::Up), best_ask(ctx, Outcome::Down)) else {
        return Step::Retry;
    };
    w.batch([
        (
            cid!("x4a"),
            Order::sell(Outcome::Up, sell_price(up + price!(0.03)), qty!(4)),
        ),
        (
            cid!("x4b"),
            Order::sell(Outcome::Down, sell_price(down + price!(0.03)), qty!(4)),
        ),
    ]);
    Step::Fired
}

/// 120: `cancel_order` `x1`.
fn cancel_x1(_ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    w.out.cancel(&cid!("x1"));
    Step::Fired
}

/// 150: GTC BUY UP @ ask(UP) + 0.02, size 200, cid `x5` (crossing, larger
/// than depth).
fn x5(ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    let Some(ask) = best_ask(ctx, Outcome::Up) else {
        return Step::Retry;
    };
    w.limit(
        cid!("x5"),
        Order::buy(Outcome::Up, buy_price(ask + price!(0.02)), qty!(200)),
    );
    Step::Fired
}

/// 180: FOK BUY UP @ bid(UP) − 0.05, size 5, cid `x6` (killed).
fn x6(ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    let Some(bid) = best_bid(ctx, Outcome::Up) else {
        return Step::Retry;
    };
    w.marketable(
        cid!("x6"),
        Order::buy(Outcome::Up, buy_price(bid - price!(0.05)), qty!(5)).fok(),
    );
    Step::Fired
}

/// 200: GTC BUY DOWN @ ask(DOWN), size 3, postOnly, cid `x7` (post-only
/// cross).
fn x7(ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    let Some(ask) = best_ask(ctx, Outcome::Down) else {
        return Step::Retry;
    };
    w.limit(
        cid!("x7"),
        Order::buy(Outcome::Down, buy_price(ask), qty!(3)).post_only(),
    );
    Step::Fired
}

/// 220: `cancel_batch` [`x4a`, `x4b`, `x9-missing`].
fn cancel_batch(_ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    w.out
        .cancel_batch([&cid!("x4a"), &cid!("x4b"), &cid!("x9-missing")]);
    Step::Fired
}

/// 260: `merge_positions` size min(pos(UP), pos(DOWN), 5); skip if 0.
fn merge(ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    let size = pos(ctx, Outcome::Up)
        .min(pos(ctx, Outcome::Down))
        .min(qty!(5));
    if size <= qty!(0) {
        return Step::Skip;
    }
    w.out.merge(size);
    Step::Fired
}

/// 300: `cancel_market` asset UP.
fn cancel_market_up(_ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    w.out.cancel_market(Some(Outcome::Up));
    Step::Fired
}

/// 400: GTC SELL UP @ bid(UP), size min(pos(UP), 5), skip if < 1, cid `x8`
/// (crossing sell). The bid is checked first: a missing bid retries even
/// when the size would skip.
fn x8(ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    let Some(bid) = best_bid(ctx, Outcome::Up) else {
        return Step::Retry;
    };
    let size = pos(ctx, Outcome::Up).min(qty!(5));
    if size < qty!(1) {
        return Step::Skip;
    }
    w.limit(cid!("x8"), Order::sell(Outcome::Up, sell_price(bid), size));
    Step::Fired
}

/// 500: `cancel_all`.
fn cancel_all(_ctx: &Ctx, w: &mut Writer<'_>) -> Step {
    w.out.cancel_all();
    Step::Fired
}

/// A0 (60 §5.4): on the first `fill` of `x2`, GTC SELL of the filled outcome
/// @ fill price + 0.05 (snapped up), size = fill size, cid `x2-exit`.
fn a0_x2_exit(_ctx: &Ctx, event: &AccountEvent, w: &mut Writer<'_>) -> bool {
    let AccountEvent::Fill { fill, .. } = event else {
        return false;
    };
    if fill.order.cid().as_str() != "x2" {
        return false;
    }
    w.limit(
        cid!("x2-exit"),
        Order::sell(
            fill.outcome,
            sell_price(fill.price + price!(0.05)),
            fill.qty,
        ),
    );
    true
}

/// The cancel of a placed periodic slot.
#[derive(Copy, Clone, Debug)]
struct PeriodicCancel {
    /// Slot `n`; the order's cid is `r{slot}`.
    slot: u64,
    /// `n` at which the cancel fires.
    at: u64,
}

/// The engine exerciser (60 §5). One instance per market (30 §4 rule 4).
#[derive(Debug, Default)]
pub struct EngineExerciser {
    /// Real ticks seen so far; the current tick's `n` before the increment.
    ticks: u64,
    /// Completed [`SCHEDULE`] rows, bit `i` = row `i`.
    done: u64,
    /// Index of the first row not completed; rows before it are all done.
    first_open: usize,
    /// Fired [`TRIGGERS`], bit `i` = trigger `i`.
    fired: u32,
    /// Periodic slot waiting for a best bid.
    periodic_pending: Option<u64>,
    /// Cancel of the placed periodic slot. At most one exists: a slot's
    /// cancel is due at `slot + 40`, before the next slot (`slot + 100`).
    periodic_cancel: Option<PeriodicCancel>,
}

impl EngineExerciser {
    /// Runs every due, not yet completed schedule row in schedule order.
    fn run_schedule(&mut self, ctx: &Ctx, n: u64, w: &mut Writer<'_>) {
        for (i, action) in SCHEDULE.iter().enumerate().skip(self.first_open) {
            if action.at > n {
                break;
            }
            let bit = 1u64 << i;
            if self.done & bit == 0 && (action.run)(ctx, w) != Step::Retry {
                self.done |= bit;
            }
        }
        while self.first_open < SCHEDULE.len() && self.done & (1u64 << self.first_open) != 0 {
            self.first_open += 1;
        }
    }

    /// The periodic phase (60 §5.2 row `600 + 100k`), after the schedule.
    fn run_periodic(&mut self, ctx: &Ctx, n: u64, w: &mut Writer<'_>) {
        if let Some(c) = self.periodic_cancel {
            if c.at <= n {
                self.periodic_cancel = None;
                w.out.cancel(&ClientOrderId::indexed("r", c.slot));
            }
        }
        if n >= PERIODIC_FROM && (n - PERIODIC_FROM) % PERIODIC_EVERY == 0 {
            // Supersedes a still-pending older slot.
            self.periodic_pending = Some(n);
        }
        let Some(slot) = self.periodic_pending else {
            return;
        };
        if ctx.portfolio().open_orders().next().is_some() {
            // Skip: the decision portfolio of this tick has open orders.
            self.periodic_pending = None;
            return;
        }
        let Some(bid) = best_bid(ctx, Outcome::Up) else {
            // Retry on the next tick.
            return;
        };
        self.periodic_pending = None;
        w.limit(
            ClientOrderId::indexed("r", slot),
            Order::buy(Outcome::Up, buy_price(bid - price!(0.01)), qty!(5)),
        );
        // An older slot's cancel was due at most at `slot - 60 <= n` and
        // fired above.
        assert!(
            self.periodic_cancel.is_none(),
            "engine-exerciser: periodic cancel of an older slot still pending at slot {slot}"
        );
        self.periodic_cancel = Some(PeriodicCancel {
            slot,
            at: slot + PERIODIC_CANCEL_AFTER,
        });
    }
}

impl Strategy for EngineExerciser {
    type Params = ExerciserParams;
    const ID: &'static str = "engine-exerciser.rs";

    /// No feeds and no plugins (60 §5.1).
    fn requirements(_p: &ExerciserParams) -> Requirements {
        Requirements::new()
    }

    // `interests` keeps its default (all events, every tick): a ts-compat
    // port MUST NOT declare a tick interest (30 §4.1).

    fn new(_p: &ExerciserParams, _market: &MarketInfo) -> Self {
        EngineExerciser::default()
    }

    fn on_tick(&mut self, ctx: &Ctx, out: &mut Intents) -> StrategyResult {
        // 60 §5.1: synthetic feed ticks never count (none are requested here;
        // the feed exerciser reuses this strategy with feeds in M2).
        if ctx.tick().synthetic {
            return Ok(());
        }
        let n = self.ticks;
        self.ticks += 1;
        let mut w = Writer { out };
        self.run_schedule(ctx, n, &mut w);
        self.run_periodic(ctx, n, &mut w);
        Ok(())
    }

    fn on_event(&mut self, ctx: &Ctx, event: &AccountEvent, out: &mut Intents) -> StrategyResult {
        let mut w = Writer { out };
        for (i, trigger) in TRIGGERS.iter().enumerate() {
            let bit = 1u32 << i;
            if self.fired & bit == 0 && trigger(ctx, event, &mut w) {
                self.fired |= bit;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buy_prices_snap_down_and_clamp() {
        // spec: 60 §5.1 (snap down for BUY, clamp to [0.01, 0.99])
        assert_eq!(buy_price(price!(0.48)), price!(0.48));
        assert_eq!(buy_price(price!(0.489999)), price!(0.48));
        assert_eq!(buy_price(price!(0.005)), MIN_PRICE);
        assert_eq!(buy_price(price!(0.01) - price!(0.05)), MIN_PRICE);
        assert_eq!(buy_price(price!(1)), MAX_PRICE);
    }

    #[test]
    fn sell_prices_snap_up_and_clamp() {
        // spec: 60 §5.1 (snap up for SELL, clamp to [0.01, 0.99])
        assert_eq!(sell_price(price!(0.55)), price!(0.55));
        assert_eq!(sell_price(price!(0.550001)), price!(0.56));
        assert_eq!(sell_price(price!(0)), MIN_PRICE);
        assert_eq!(sell_price(price!(0.98) + price!(0.05)), MAX_PRICE);
    }

    #[test]
    fn schedule_v1_rows() {
        // spec: 60 §5.2 (the n column of schedule v1)
        let at: Vec<u64> = SCHEDULE.iter().map(|a| a.at).collect();
        assert_eq!(
            at,
            [50, 60, 70, 90, 100, 120, 150, 180, 200, 220, 260, 300, 400, 500]
        );
        assert_eq!(EXERCISER_SCHEDULE_VERSION, 1);
        assert_eq!(TRIGGERS.len(), 1);
    }
}
