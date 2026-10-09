//! Domain types shared by every engine crate (10-domain-model.md): fixed-point
//! scalars and rounding, outcomes, identifiers, seeds and draws, orders,
//! order states, fills and account events, exchange rules (11), market
//! events (15 §2) and feed values (14).

pub mod event;
pub mod feed_value;
pub mod fill;
pub mod fixed;
pub mod ids;
pub mod market;
pub mod market_event;
pub mod order;
pub mod outcome;
pub mod rules;
pub mod seed;
pub mod state;

pub use fixed::{DurMs, Overflow, Price, Qty, Rate, Rounding, TsMs, Usdc, SCALE};
pub use market_event::{LevelUpdate, MarketEvent, PriceSize, QuoteSide, TimedMarketEvent};
pub use outcome::{Outcome, PerOutcome};
