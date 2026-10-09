//! The two core rule sets (12 §2.3).
//!
//! The core never branches on the execution adapter; it branches only on
//! [`CoreRules`]. Every ts-compat deviation is one small, named branch keyed
//! by a `TC-C…` row of 13 §5.2.

use pmb_contract::vocab::Profile;

/// Core rule set selected by `ModelConfig.profile`, never mixed at runtime
/// (12 §2.3).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum CoreRules {
    /// Reproduces TS where TS is the oracle (00 R3); each deviation is a
    /// `TC-C…` row of 13 §5.2. Backtest only (D28).
    TsCompat,
    /// First principles and the current Polymarket rules (11). Realistic
    /// backtest, paper and live.
    Realistic,
}

impl CoreRules {
    /// The rule set of a profile (12 §2.3).
    pub const fn from_profile(p: Profile) -> CoreRules {
        match p {
            Profile::TsCompat => CoreRules::TsCompat,
            Profile::Realistic => CoreRules::Realistic,
        }
    }

    /// `true` for [`CoreRules::TsCompat`].
    #[inline]
    pub const fn is_ts_compat(self) -> bool {
        matches!(self, CoreRules::TsCompat)
    }

    /// Cancel-id cap of a `CancelBatch` (12 §7.3; TC-C12): 3000 in ts-compat,
    /// 1000 in realistic (11 §9).
    pub const fn max_cancel_ids(self) -> u16 {
        match self {
            CoreRules::TsCompat => pmb_core::rules::TS_COMPAT_MAX_CANCEL_IDS,
            CoreRules::Realistic => pmb_core::rules::MAX_CANCEL_IDS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_selects_rule_set() {
        // spec: 12 §2.3
        assert_eq!(
            CoreRules::from_profile(Profile::TsCompat),
            CoreRules::TsCompat
        );
        assert_eq!(
            CoreRules::from_profile(Profile::Realistic),
            CoreRules::Realistic
        );
        assert!(CoreRules::TsCompat.is_ts_compat());
        assert!(!CoreRules::Realistic.is_ts_compat());
    }

    #[test]
    fn cancel_id_caps() {
        // spec: 12 §7.3, 13 TC-C12
        assert_eq!(CoreRules::TsCompat.max_cancel_ids(), 3_000);
        assert_eq!(CoreRules::Realistic.max_cancel_ids(), 1_000);
    }
}
