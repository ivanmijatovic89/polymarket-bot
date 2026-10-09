//! Market event payloads (12 §3.2 `Market`, 15 §2 I-1): outcome-indexed,
//! fixed-point, borrowing level lists from the reader's decoded tape so the
//! loop never copies payloads (12 E4).

use crate::{Outcome, Price, Qty, TsMs};

/// Side of a book level.
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum QuoteSide {
    /// Bids (`BUY` in Polymarket messages, side code 0).
    Bid = 0,
    /// Asks (`SELL` in Polymarket messages, side code 1).
    Ask = 1,
}

/// One level of a `book` snapshot.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct PriceSize {
    pub price: Price,
    pub size: Qty,
}

/// One `price_change` entry: the new aggregate size at a level (15 I-6b).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct LevelUpdate {
    pub outcome: Outcome,
    pub side: QuoteSide,
    pub price: Price,
    pub size: Qty,
}

/// A recorded market event.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum MarketEvent<'a> {
    /// Full book of one outcome (15 I-6a).
    Book {
        outcome: Outcome,
        bids: &'a [PriceSize],
        asks: &'a [PriceSize],
    },
    /// Level updates, grouped by outcome and applied in message order (I-6b).
    PriceChange { changes: &'a [LevelUpdate] },
    /// Trade print; never a strategy tick (12 §5.2).
    LastTrade {
        outcome: Outcome,
        price: Price,
        size: Qty,
        side: Option<QuoteSide>,
    },
    /// Tick size in force changes (11 §7.5); never a tick.
    TickSizeChange { outcome: Outcome, tick: Price },
}

impl MarketEvent<'_> {
    /// `book` and `price_change` produce ticks (12 §5.2).
    #[inline]
    pub fn produces_tick(&self) -> bool {
        matches!(
            self,
            MarketEvent::Book { .. } | MarketEvent::PriceChange { .. }
        )
    }

    /// Tick cause label (the `eventsByType` key, 12 §5.3), for tick events.
    #[inline]
    pub fn cause_label(&self) -> Option<&'static str> {
        match self {
            MarketEvent::Book { .. } => Some("book"),
            MarketEvent::PriceChange { .. } => Some("price_change"),
            _ => None,
        }
    }
}

/// A market event with its clocks, as yielded by readers (15 I-1).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct TimedMarketEvent<'a> {
    /// Input row index in the file (entity kind 6 of 10 RNG-4).
    pub row: u32,
    /// Exchange timestamp.
    pub exchange_ts: TsMs,
    /// Source local receive time, when the source has one.
    pub local_ts: Option<TsMs>,
    pub event: MarketEvent<'a>,
}
