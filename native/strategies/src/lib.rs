//! In-repo native strategies (31 §2.3, 01 §4.1): the deterministic test
//! strategies with TypeScript twins in `src/strategies/testing/`.
//!
//! Each strategy is one bin holding its `impl Strategy`, its single
//! `strategy_main!` call and its testkit tests (31 §2.2):
//!
//! - `src/bin/engine-exerciser.rs`: `engine-exerciser.rs` (60 §5.1–§5.7,
//!   30 §18, D20), the parity strategy that drives every intent and order
//!   type.
//! - `src/bin/feed-exerciser.rs`: `feed-exerciser.rs` (60 §5.8, 14 §13 V-3),
//!   the parity strategy for feeds, plugins and synthetic ticks.
//!
//! The library holds only code both bins run (31 §2.2 "code shared across
//! versions"): the engine exerciser schedule [`exerciser::Exerciser`], which
//! the feed exerciser runs on real ticks when `trade: true` (60 §5.8). A
//! change to one strategy's bin therefore leaves the other bin's source hash
//! unchanged (31 §5.2, §5.6).
//!
//! This package depends on `pmb-sdk` only (30 §1 P1, D16) and is not a
//! member of the engine workspace (31 §2.1).

pub mod exerciser;
