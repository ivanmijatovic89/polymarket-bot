//! The simulator adapter (13 §3, §4): exchange truth vs client knowledge,
//! the simulated book overlay, the discrete-event scheduler, the model traits
//! and the ts-compat composition (13 §5).
//!
//! | Module | Contents |
//! |---|---|
//! | `simulator` | [`Simulator`] (`Execution`), `ExchangeTruth`, `Models`, `Composition` |
//! | `scheduler` | (time, class, seq) heap, `ActionClass`, `SchedulerMode` (13 §2.3, §4.3) |
//! | `book_overlay` | `RestingSet` (own resting orders in rest order), `Deficits` (13 §4.2) |
//! | `fill` | `FillModel`, taker `walk`/`fillable`, the fill unit, `TradeCounter` (13 §4.5) |
//! | `latency` | `LatencyModel`, `NextRealTick` with seeded `compat_jitter` (13 §5.1, §6.8) |
//! | `fee` | `FeeModel`, `Fee700Bps4dp` (13 §5.1 TC-E7) |
//! | `report` | `ReportModel`, `CompatStatus` (13 §5.1 TC-E8) |
//! | `compat` | `CompatTaker`, `WorstQueueCompat`, compat cancels, split/merge (13 §5) |
//!
//! Owned by the SIMULATOR agent (see `ARCHITECTURE.md`). Realistic models
//! (13 §6) are M3b; only their trait seams exist here (D57).

pub mod book_overlay;
pub mod compat;
pub mod fee;
pub mod fill;
pub mod latency;
pub mod report;
pub mod scheduler;
pub mod simulator;

pub use simulator::{Composition, Simulator};

#[cfg(test)]
mod tests;
