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
    /// Backtest or paper (12 §6.3, §11): selects the fault semantics. Chosen
    /// by the runtime, never by `ModelConfig` (D28: paper runs the realistic
    /// rules).
    pub run_mode: RunMode,
    // D-PENDING: realistic sections (`execution.latency`, `makerQueue`,
    // `sellGate`, `cancelBeforeAck`, `failureRates`, `clock`) are M3b (D57);
    // chose to add their resolved forms here when M3b starts.
}

/// How a session treats strategy faults (12 §6.3, §11).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub enum RunMode {
    /// The candidate stops at its first strategy fault (`strategy_fault`,
    /// no `MarketStats`).
    #[default]
    Backtest,
    /// Live paper mode (M8, D28, D32): a strategy fault issues
    /// `CancelMarket{Market}` with cause `StrategyPanic`, the strategy is
    /// halted until rotation, and every event is still applied to the
    /// ledger without callbacks (10 S5).
    Paper,
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
        mc: &ModelConfig,
        input_mode: InputMode,
        market_seed: MarketSeed,
    ) -> Result<EngineConfig, ConfigError> {
        let err = |field: &str, why: &str| ConfigError {
            message: format!("{field}: {why}"),
        };
        let starting = mc.capital.starting_capital_usdc.micros();
        if starting < 0 {
            return Err(err("capital.startingCapitalUsdc", "negative"));
        }
        let positive = |field: &str, micros: i64| {
            if micros > 0 {
                Ok(micros)
            } else {
                Err(err(field, "must be positive"))
            }
        };
        let max_order_size = positive("risk.maxOrderSize", mc.risk.max_order_size.micros())?;
        let max_abs_position = positive("risk.maxAbsPosition", mc.risk.max_abs_position.micros())?;
        let max_loss = mc.risk.max_loss_stop_usdc.micros();
        if max_loss < 0 {
            return Err(err("risk.maxLossStopUsdc", "negative"));
        }
        if mc.runner.max_events_per_drain == 0 {
            return Err(err("runner.maxEventsPerDrain", "must be positive"));
        }
        // D-PENDING: realistic sections (`execution.latency`, `makerQueue`,
        // `sellGate`, `cancelBeforeAck`, `failureRates`, `clock`) are resolved
        // in M3b (D57); chose to accept and ignore them until then.
        Ok(EngineConfig {
            core_rules: CoreRules::from_profile(mc.profile),
            input_mode,
            models: mc.execution.models,
            compat_latency: mc.execution.compat_latency,
            market_seed,
            starting_capital: Usdc::from_micros(starting),
            max_events_per_drain: mc.runner.max_events_per_drain,
            risk: RiskLimits {
                max_open_orders: mc.risk.max_open_orders,
                max_order_size: Qty::from_micros(max_order_size),
                max_abs_position: Qty::from_micros(max_abs_position),
                max_loss_stop: Usdc::from_micros(max_loss),
            },
            run_mode: RunMode::Backtest,
        })
    }

    /// Sets the run mode (12 §11). Paper runs only under the realistic
    /// rules (D28: ts-compat is backtest-only); anything else is an error
    /// (R14).
    pub fn with_run_mode(mut self, mode: RunMode) -> Result<EngineConfig, ConfigError> {
        if mode == RunMode::Paper && self.core_rules != CoreRules::Realistic {
            return Err(ConfigError {
                message: "runMode: paper requires the realistic profile (D28)".into(),
            });
        }
        self.run_mode = mode;
        Ok(self)
    }
}

impl RiskLimits {
    /// The TS defaults (`src/trading/riskLimits.ts:24-29`; 12 §8): 100 open
    /// orders, 2000 shares per order and per position, 500 USDC loss stop.
    pub const TS_DEFAULTS: RiskLimits = RiskLimits {
        max_open_orders: 100,
        max_order_size: Qty::from_micros(2_000_000_000),
        max_abs_position: Qty::from_micros(2_000_000_000),
        max_loss_stop: Usdc::from_micros(500_000_000),
    };
}
