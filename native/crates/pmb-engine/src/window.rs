//! Window gate and session lifecycle (12 §5.4, §10).

use pmb_contract::vocab::InputMode;
use pmb_core::market::Window;
use pmb_core::TsMs;

use crate::core_rules::CoreRules;

/// Window rule of a session (12 §5.4).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum WindowRule {
    /// ts-compat telonex-delta: strategy ticks with `tick.ts ∈ [start, end]`,
    /// inclusive; out-of-window events are books only (TC-C9,
    /// `src/backtest/runSingleMarket.ts:306-315`).
    TsCompatInclusive,
    /// ts-compat recorder-v4: no strategy gate; the V4 replay already drops
    /// envelopes outside `[start, end)` on receipt time (15 §1).
    TsCompatUngated,
    /// Realistic, paper, live: `now ∈ [start, end)` on the receive clock
    /// (D23).
    Realistic,
}

impl WindowRule {
    /// The rule for a rule set and input mode (12 §5.4).
    pub const fn select(rules: CoreRules, input: InputMode) -> WindowRule {
        match (rules, input) {
            (CoreRules::TsCompat, InputMode::RecorderV4) => WindowRule::TsCompatUngated,
            (CoreRules::TsCompat, _) => WindowRule::TsCompatInclusive,
            (CoreRules::Realistic, _) => WindowRule::Realistic,
        }
    }
}

/// The strategy window gate (12 §5.4).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct WindowGate {
    /// Rule in force.
    pub rule: WindowRule,
    /// `[start, end)` from the slug (10 §5).
    pub window: Window,
}

impl WindowGate {
    /// Whether a tick passes the gate (12 §5.4). ts-compat gates on the TS
    /// tick time, realistic on the loop clock.
    #[inline]
    pub fn in_window(&self, tick_ts: TsMs, now: TsMs) -> bool {
        let (s, e) = (self.window.start_ms.0, self.window.end_ms.0);
        match self.rule {
            WindowRule::TsCompatInclusive => tick_ts.0 >= s && tick_ts.0 <= e,
            WindowRule::TsCompatUngated => true,
            WindowRule::Realistic => now.0 >= s && now.0 < e,
        }
    }
}

/// Session lifecycle state (12 §10).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum SessionState {
    /// Strategy not called; plugins observe ticks (D23). Ends at `now ≥ start`.
    Warming,
    /// Strategy called inside the window. Ends at `Control(WindowEnd)`.
    Active,
    /// Strategy not called; window-end cancel in flight, late events applied.
    Closing,
    /// The per-market result was emitted (21, D11).
    Done,
}

impl SessionState {
    /// Whether strategy callbacks may run (12 §5.4 "Account callbacks", §10).
    #[inline]
    pub const fn callbacks_enabled(self) -> bool {
        matches!(self, SessionState::Active)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gate(rule: WindowRule) -> WindowGate {
        WindowGate {
            rule,
            window: Window {
                start_ms: TsMs(1_000),
                end_ms: TsMs(2_000),
            },
        }
    }

    #[test]
    fn ts_compat_telonex_gate_is_inclusive_on_tick_ts() {
        // spec: 12 §5.4, 13 TC-C9
        let g = gate(WindowRule::TsCompatInclusive);
        assert!(!g.in_window(TsMs(999), TsMs(5_000)));
        assert!(g.in_window(TsMs(1_000), TsMs(0)));
        assert!(g.in_window(TsMs(2_000), TsMs(0)));
        assert!(!g.in_window(TsMs(2_001), TsMs(1_500)));
    }

    #[test]
    fn realistic_gate_is_half_open_on_now() {
        // spec: 12 §5.4 (D23)
        let g = gate(WindowRule::Realistic);
        assert!(!g.in_window(TsMs(1_500), TsMs(999)));
        assert!(g.in_window(TsMs(0), TsMs(1_000)));
        assert!(g.in_window(TsMs(0), TsMs(1_999)));
        assert!(!g.in_window(TsMs(1_500), TsMs(2_000)));
    }

    #[test]
    fn rule_selection() {
        // spec: 12 §5.4
        assert_eq!(
            WindowRule::select(CoreRules::TsCompat, InputMode::TelonexDelta),
            WindowRule::TsCompatInclusive
        );
        assert_eq!(
            WindowRule::select(CoreRules::TsCompat, InputMode::RecorderV4),
            WindowRule::TsCompatUngated
        );
        assert_eq!(
            WindowRule::select(CoreRules::Realistic, InputMode::RecorderV4),
            WindowRule::Realistic
        );
        assert!(gate(WindowRule::TsCompatUngated).in_window(TsMs(0), TsMs(0)));
        assert!(SessionState::Active.callbacks_enabled());
        assert!(!SessionState::Warming.callbacks_enabled());
        assert!(!SessionState::Closing.callbacks_enabled());
    }
}
