//! Time-window gate (port of `TimeWindowGatePlugin`): true while
//! `allow_after_ms <= now - market_start <= disable_after_ms`. A pure function
//! of tick time, so it also runs on synthetic feed ticks.

use crate::model::TsMs;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimeWindowGateConfig {
    pub allow_after_ms: i64,
    pub disable_after_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeWindowGateSnapshot {
    pub allow_after_ms: i64,
    pub disable_after_ms: i64,
    pub within_window: bool,
    /// Market window start (Gamma `eventStartTime`); None when unknown.
    pub start_ms: Option<TsMs>,
    pub now_ms: Option<TsMs>,
    pub elapsed_ms: Option<i64>,
}

#[derive(Clone, Debug)]
pub(crate) struct TimeWindowGate {
    cfg: TimeWindowGateConfig,
    start_ms: Option<TsMs>,
}

impl TimeWindowGate {
    pub(crate) fn new(cfg: TimeWindowGateConfig, start_ms: Option<TsMs>) -> Self {
        Self { cfg, start_ms }
    }

    pub(crate) fn initial_snapshot(&self) -> TimeWindowGateSnapshot {
        TimeWindowGateSnapshot {
            allow_after_ms: self.cfg.allow_after_ms,
            disable_after_ms: self.cfg.disable_after_ms,
            within_window: false,
            start_ms: None,
            now_ms: None,
            elapsed_ms: None,
        }
    }

    pub(crate) fn on_tick(&self, now_ms: TsMs) -> TimeWindowGateSnapshot {
        let elapsed_ms = self.start_ms.map(|s| now_ms - s);
        let within_window = elapsed_ms
            .is_some_and(|e| e >= self.cfg.allow_after_ms && e <= self.cfg.disable_after_ms);
        TimeWindowGateSnapshot {
            within_window,
            start_ms: self.start_ms,
            now_ms: Some(now_ms),
            elapsed_ms,
            ..self.initial_snapshot()
        }
    }
}
