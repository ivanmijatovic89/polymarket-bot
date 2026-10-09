//! The simulator adapter (13 §3, §4): exchange truth vs client knowledge,
//! the simulated book overlay, the discrete-event scheduler, the model traits
//! and the ts-compat composition (13 §5).
//!
//! Owned by the SIMULATOR agent (see `ARCHITECTURE.md`). Every submodule is
//! an empty placeholder in the skeleton.

pub mod book_overlay;
pub mod compat;
pub mod fee;
pub mod fill;
pub mod latency;
pub mod report;
pub mod scheduler;
pub mod simulator;

#[cfg(test)]
mod tests;
