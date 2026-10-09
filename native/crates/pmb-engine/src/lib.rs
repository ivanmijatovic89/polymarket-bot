//! Deterministic engine core shared by backtest, paper and live (12, 13).
//!
//! One market session (12 §2.1) is a [`session::Session`] generic over the
//! strategy, the execution adapter and the trace sink (12 §14 P6). The
//! driver applies each input envelope to the market's [`shared::SharedMarket`]
//! and then steps every session of that market (12 §2.1, §5.1).
//!
//! Module map and ownership: `ARCHITECTURE.md` next to this crate's
//! `Cargo.toml`.

pub mod backtest;
pub mod cascade;
pub mod clock;
pub mod config;
pub mod core_rules;
pub mod envelope;
pub mod exec;
pub mod feeds_view;
pub mod ledger;
pub mod om;
pub mod output;
pub mod plugins_view;
pub mod session;
pub mod shared;
pub mod stats;
pub mod strategy;
pub mod trace;
pub mod window;

pub use backtest::BacktestMarket;
pub use config::EngineConfig;
pub use core_rules::CoreRules;
pub use envelope::{Envelope, Payload};
pub use exec::sim::Simulator;
pub use exec::{EventQueue, ExecCommand, ExecCtx, Execution};
pub use output::{market_output, OutputContext, OutputError};
pub use session::{Session, SessionFault, SessionOutput};
pub use shared::SharedMarket;
pub use strategy::{
    Ctx, Intents, Interests, Strategy, StrategyError, StrategyResult, TickInterest,
};
pub use trace::{NoTrace, TraceSink};
