//! Domain types shared by every engine crate (10-domain-model.md): fixed-point
//! scalars and rounding, outcomes, identifiers, seeds and draws, orders,
//! order states, fills and account events.

pub mod fixed;
pub mod outcome;

pub use fixed::{DurMs, Overflow, Price, Qty, Rate, Rounding, TsMs, Usdc, SCALE};
pub use outcome::{Outcome, PerOutcome};
