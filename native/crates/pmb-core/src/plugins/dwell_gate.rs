//! Dwell gate (port of `DwellGatePlugin`): opens per outcome once its best
//! bid (or ask) has stayed inside `[from, to]` for `required_ms`. A pure
//! function of tick time, so it also runs on synthetic feed ticks.

use crate::market::{Book, MarketBooks};
use crate::model::TsMs;
use serde::{Deserialize, Serialize};

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BidOrAsk {
    Bid,
    Ask,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DwellGateConfig {
    /// Band bounds; order does not matter.
    pub from: f64,
    pub to: f64,
    pub required_ms: i64,
    pub track_price: BidOrAsk,
}

#[derive(Copy, Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DwellSideState {
    pub in_range: bool,
    pub elapsed_in_range_ms: Option<i64>,
    pub remaining_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DwellGateSnapshot {
    pub from: f64,
    pub to: f64,
    pub required_ms: i64,
    pub track_price: BidOrAsk,
    pub dwell_up_ok: bool,
    pub dwell_down_ok: bool,
    pub up: DwellSideState,
    pub down: DwellSideState,
}

#[derive(Clone, Debug, Default)]
struct Tracker {
    in_range_since_ms: Option<TsMs>,
}

impl Tracker {
    /// Returns (ok, state).
    fn update(&mut self, now_ms: TsMs, price: Option<f64>, lo: f64, hi: f64, required_ms: i64) -> (bool, DwellSideState) {
        let in_range = price.is_some_and(|p| p.is_finite() && p >= lo && p <= hi);
        if !in_range {
            self.in_range_since_ms = None;
            return (false, DwellSideState::default());
        }
        let since = *self.in_range_since_ms.get_or_insert(now_ms);
        let elapsed = now_ms - since;
        let remaining = (required_ms - elapsed).max(0);
        (
            remaining == 0,
            DwellSideState {
                in_range: true,
                elapsed_in_range_ms: Some(elapsed),
                remaining_ms: Some(remaining),
            },
        )
    }
}

#[derive(Clone, Debug)]
pub(crate) struct DwellGate {
    cfg: DwellGateConfig,
    up: Tracker,
    down: Tracker,
}

impl DwellGate {
    pub(crate) fn new(cfg: DwellGateConfig) -> Self {
        Self {
            cfg,
            up: Tracker::default(),
            down: Tracker::default(),
        }
    }

    pub(crate) fn initial_snapshot(&self) -> DwellGateSnapshot {
        DwellGateSnapshot {
            from: self.cfg.from,
            to: self.cfg.to,
            required_ms: self.cfg.required_ms,
            track_price: self.cfg.track_price,
            dwell_up_ok: false,
            dwell_down_ok: false,
            up: DwellSideState::default(),
            down: DwellSideState::default(),
        }
    }

    pub(crate) fn reset(&mut self) {
        self.up = Tracker::default();
        self.down = Tracker::default();
    }

    fn price(&self, book: &Book) -> Option<f64> {
        match self.cfg.track_price {
            BidOrAsk::Bid => book.best_bid().map(|l| l.price.to_f64()),
            BidOrAsk::Ask => book.best_ask().map(|l| l.price.to_f64()),
        }
    }

    pub(crate) fn on_tick(&mut self, books: &MarketBooks, now_ms: TsMs) -> DwellGateSnapshot {
        let lo = self.cfg.from.min(self.cfg.to);
        let hi = self.cfg.from.max(self.cfg.to);
        let up_price = self.price(&books.books[0]);
        let down_price = self.price(&books.books[1]);
        let req = self.cfg.required_ms;
        let (up_ok, up) = self.up.update(now_ms, up_price, lo, hi, req);
        let (down_ok, down) = self.down.update(now_ms, down_price, lo, hi, req);
        DwellGateSnapshot {
            dwell_up_ok: up_ok,
            dwell_down_ok: down_ok,
            up,
            down,
            ..self.initial_snapshot()
        }
    }
}
