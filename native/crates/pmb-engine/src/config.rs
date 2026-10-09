//! Engine-side resolved configuration (21 §6, 12 §6.3, §8, §9.4, 13 §7.3).
//!
//! `ModelConfig` (pmb-contract) is the wire form: decimal strings and closed
//! vocabularies. [`EngineConfig`] is the same content resolved once per
//! session into fixed-point values and enums, so nothing on the hot path
//! parses or branches on strings (12 §14 P2). It is the `ModelConfig` that
//! [`crate::exec::ExecCtx`] borrows (13 §2.2).

use pmb_contract::model_config::{CompatLatency, ExecutionModels};
use pmb_contract::vocab::InputMode;
use pmb_contract::ModelConfig;
use pmb_core::seed::MarketSeed;
use pmb_core::{Qty, Usdc};

use crate::core_rules::CoreRules;

/// Risk limits of `ModelConfig.risk` in fixed point (12 §8). Defaults equal
/// TS (`src/trading/riskLimits.ts:24-29`), applied by the producer (21 §6.3).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct RiskLimits {
    /// `maxOpenOrders` (12 §8.1).
    pub max_open_orders: u32,
    /// `maxOrderSize`, shares (12 §8.1).
    pub max_order_size: Qty,
    /// `maxAbsPosition`, shares (12 §8.1).
    pub max_abs_position: Qty,
    /// `maxLossStopUsdc` (12 §8.1).
    pub max_loss_stop: Usdc,
}

/// Resolved, per-session engine configuration (21 §6, 12, 13 §7.3).
///
/// Run-level parts (`clock`, `feeds`) never vary between candidates of a
/// group (21 §8); `execution`, `risk`, `capital` and `runner` may.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineConfig {
    /// Core rule set from `profile` (12 §2.3).
    pub core_rules: CoreRules,
    /// Input mode of the job (12 §4.1, §5.4): selects the clock model and,
    /// in ts-compat, the window gate (TC-C9, TC-C11).
    pub input_mode: InputMode,
    /// The six model axes (13 §7.3); pinned to their compat values in
    /// ts-compat.
    pub models: ExecutionModels,
    /// `execution.compatLatency` (13 §5.1 `NextRealTick`).
    pub compat_latency: CompatLatency,
    /// Market seed derived from (run seed, slug) (10 RNG-2); the root of every
    /// counter-based stream of this session (12 §13 item 3).
    pub market_seed: MarketSeed,
    /// `capital.startingCapitalUsdc` (12 §9.4).
    pub starting_capital: Usdc,
    /// `runner.maxEventsPerDrain` (12 §6.3).
    pub max_events_per_drain: u32,
    /// `risk` (12 §8).
    pub risk: RiskLimits,
    // D-PENDING: realistic sections (`execution.latency`, `makerQueue`,
    // `sellGate`, `cancelBeforeAck`, `failureRates`, `clock`) are M3b (D57);
    // chose to add their resolved forms here when M3b starts.
}

/// A `ModelConfig` that cannot be resolved into an [`EngineConfig`]
/// (R14: fail loud; the binary maps it to `invalid_input: model_config`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigError {
    /// One line naming the offending field.
    pub message: String,
}

impl EngineConfig {
    /// Resolves the effective `ModelConfig` of one candidate (21 §1.1) for one
    /// market. The caller has already run `ModelConfig::validate`. Decimal
    /// values are converted exactly (10 §2 T6); a value that does not fit is
    /// an error, never clamped (R14).
    pub fn from_model_config(
        _mc: &ModelConfig,
        _input_mode: InputMode,
        _market_seed: MarketSeed,
    ) -> Result<EngineConfig, ConfigError> {
        todo!("core agent: resolve ModelConfig into fixed point (21 §6)")
    }
}
