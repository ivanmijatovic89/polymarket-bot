//! In-repo native strategies (31 §2.3, 01 §4.1): the deterministic test
//! strategies with TypeScript twins in `src/strategies/testing/`.
//!
//! - [`exerciser`]: `engine-exerciser.rs` (60 §5.1–§5.7, 30 §18, D20), the
//!   parity strategy that drives every intent and order type.
//! - [`feed_exerciser`]: `feed-exerciser.rs` (60 §5.8, 14 §13 V-3), the
//!   parity strategy for feeds, plugins and synthetic ticks.
//!
//! The `Strategy` impls live here rather than in `src/bin/` so that the
//! testkit tests under `tests/` can name the strategy types; each bin only
//! calls `strategy_main!` (31 §2.2: one call per bin, ids unique per
//! package).
//!
//! This package depends on `pmb-sdk` only (30 §1 P1, D16) and is not a
//! member of the engine workspace (31 §2.1).

pub mod exerciser;
pub mod feed_exerciser;
