//! Order state machine (10 §8).

use crate::event::{CancelCause, DoneReason, RejectReason};

/// Lifecycle state of one order (10 §8.1).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum OrderState {
    InFlight,
    Delayed,
    Live,
    Unknown,
    Filled,
    Canceled(CancelCause),
    Expired,
    Killed,
    Rejected(RejectReason),
}

/// Cancel state, orthogonal to [`OrderState`] (10 §8.1).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub enum CancelState {
    #[default]
    None,
    Deferred,
    InFlight,
    Acked,
    Failed,
    Unknown,
}

impl OrderState {
    #[inline]
    pub const fn is_terminal(self) -> bool {
        matches!(
            self,
            OrderState::Filled
                | OrderState::Canceled(_)
                | OrderState::Expired
                | OrderState::Killed
                | OrderState::Rejected(_)
        )
    }

    /// TS `OrderLifecycleState` string (10 §8.4).
    pub const fn ts_state(self, filled_positive: bool) -> &'static str {
        match self {
            OrderState::InFlight | OrderState::Delayed | OrderState::Unknown => "requested",
            OrderState::Live => {
                if filled_positive {
                    "partially_filled"
                } else {
                    "open"
                }
            }
            OrderState::Filled => "filled",
            OrderState::Canceled(_) => "canceled",
            OrderState::Expired => "expired",
            OrderState::Killed => "killed",
            OrderState::Rejected(_) => "rejected",
        }
    }
}

/// A delivered lifecycle input that can change an order's state (10 §8.2).
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum StateInput {
    Accepted,
    Delayed,
    Open,
    /// A fill; `completes` when it brings the filled size to the order size.
    Fill,
    Done(DoneReason),
    Rejected(RejectReason),
    /// Live only: ambiguous REST outcome.
    Ambiguous,
}

/// An input that the state machine does not allow from the current state.
#[derive(Copy, Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("illegal order transition from {from:?} on {input:?}")]
pub struct IllegalTransition {
    pub from: OrderState,
    pub input: StateInput,
}

/// Applies one delivered input (10 §8.2). Terminal states are absorbing
/// (S1); a fill on a terminal order is a late fill and keeps the state.
pub fn transition(from: OrderState, input: StateInput) -> Result<OrderState, IllegalTransition> {
    use OrderState as S;
    use StateInput as I;
    let err = Err(IllegalTransition { from, input });
    if from.is_terminal() {
        return if input == I::Fill { Ok(from) } else { err };
    }
    match (from, input) {
        (S::InFlight | S::Unknown, I::Accepted) => Ok(from),
        (S::InFlight, I::Delayed) => Ok(S::Delayed),
        (S::InFlight | S::Delayed | S::Unknown, I::Open) => Ok(S::Live),
        (S::InFlight | S::Delayed | S::Live | S::Unknown, I::Fill) => Ok(from),
        (_, I::Done(DoneReason::Filled)) => Ok(S::Filled),
        (_, I::Done(DoneReason::Canceled(c))) => Ok(S::Canceled(c)),
        (_, I::Done(DoneReason::Expired)) => Ok(S::Expired),
        (_, I::Done(DoneReason::Killed)) => Ok(S::Killed),
        (S::InFlight | S::Delayed | S::Unknown, I::Rejected(r)) => Ok(S::Rejected(r)),
        (S::InFlight, I::Ambiguous) => Ok(S::Unknown),
        _ => err,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use OrderState as S;
    use StateInput as I;

    // spec: 10 §8.2, one assertion per table row
    #[test]
    fn transition_table() {
        let rej = RejectReason::PostOnlyWouldCross;
        let cases: &[(S, &[I], S)] = &[
            (S::InFlight, &[I::Rejected(rej)], S::Rejected(rej)),
            (S::InFlight, &[I::Accepted, I::Open], S::Live),
            (S::InFlight, &[I::Accepted, I::Fill, I::Open], S::Live),
            (
                S::InFlight,
                &[I::Accepted, I::Fill, I::Done(DoneReason::Filled)],
                S::Filled,
            ),
            (S::InFlight, &[I::Accepted, I::Delayed], S::Delayed),
            (S::Delayed, &[I::Rejected(rej)], S::Rejected(rej)),
            (
                S::Delayed,
                &[I::Fill, I::Done(DoneReason::Filled)],
                S::Filled,
            ),
            (S::Delayed, &[I::Open], S::Live),
            (S::Delayed, &[I::Done(DoneReason::Killed)], S::Killed),
            (S::Live, &[I::Fill], S::Live),
            (S::Live, &[I::Fill, I::Done(DoneReason::Filled)], S::Filled),
            (
                S::Live,
                &[I::Done(DoneReason::Canceled(CancelCause::WindowEnd))],
                S::Canceled(CancelCause::WindowEnd),
            ),
            (S::Live, &[I::Done(DoneReason::Expired)], S::Expired),
            (
                S::InFlight,
                &[I::Accepted, I::Done(DoneReason::Killed)],
                S::Killed,
            ),
            (S::InFlight, &[I::Ambiguous, I::Open], S::Live),
            (S::Filled, &[I::Fill], S::Filled),
        ];
        for (from, inputs, want) in cases {
            let mut s = *from;
            for i in *inputs {
                s = transition(s, *i).unwrap();
            }
            assert_eq!(s, *want, "{from:?} {inputs:?}");
        }
    }

    #[test]
    fn terminal_is_absorbing() {
        for t in [
            S::Filled,
            S::Expired,
            S::Killed,
            S::Rejected(RejectReason::InvalidSize),
        ] {
            for i in [
                I::Accepted,
                I::Open,
                I::Delayed,
                I::Done(DoneReason::Filled),
                I::Rejected(RejectReason::InvalidSize),
            ] {
                assert!(transition(t, i).is_err());
            }
            assert_eq!(transition(t, I::Fill), Ok(t));
        }
        assert!(transition(S::Live, I::Rejected(RejectReason::InvalidSize)).is_err());
        assert!(transition(S::Live, I::Delayed).is_err());
    }

    #[test]
    fn ts_strings() {
        assert_eq!(S::InFlight.ts_state(false), "requested");
        assert_eq!(S::Live.ts_state(false), "open");
        assert_eq!(S::Live.ts_state(true), "partially_filled");
        assert_eq!(
            S::Canceled(CancelCause::Operator).ts_state(true),
            "canceled"
        );
    }
}
