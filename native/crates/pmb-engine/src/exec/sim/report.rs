//! Report models (13 §4.4 `ReportModel`): `CompatStatus` (13 §5.1, TC-E8)
//! and the seam for realistic settlement reports with latencies (13 §6.7,
//! M3b).

use pmb_core::event::{AccountEvent, AccountEventKind};
use pmb_core::fill::{Fill, SettlementStatus};
use pmb_core::ids::OrderKey;
use pmb_core::{Qty, TsMs};

use crate::exec::EventQueue;

/// Which status events are produced and when (13 §4.4). Hooks are called by
/// the fill path right after the event they follow, so the emitted order is
/// fixed by the composition (13 X4).
pub trait ReportModel {
    /// After `OrderAccepted` of an order (13 §5.1 taker step 2).
    fn accepted(&self, order: OrderKey, at: TsMs, out: &mut EventQueue);
    /// After the `OrderDone(Filled)` of a FOK filled at execution (13 §5.1
    /// taker step 3).
    fn fok_filled(&self, order: OrderKey, size: Qty, at: TsMs, out: &mut EventQueue);
    /// After any other fill (GTC/GTD/FAK taker fills, maker fills).
    fn filled(&self, fill: &Fill, out: &mut EventQueue);
}

/// `models.reports = compat` (13 §5.1, TC-E8): the TS synthetic statuses.
/// `SettlementUpdate{fill: None, Matched, 0}` at acceptance (10 V1),
/// `SettlementUpdate{fill: None, Confirmed, size}` after a FOK fill, nothing
/// for GTC/GTD fills, never `Mined`. The TS `CANCELED` update after a FOK
/// kill has no counterpart (13 §5.4).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct CompatStatus;

impl ReportModel for CompatStatus {
    #[inline]
    fn accepted(&self, order: OrderKey, at: TsMs, out: &mut EventQueue) {
        out.push(AccountEvent {
            at,
            kind: AccountEventKind::SettlementUpdate {
                order,
                fill: None,
                status: SettlementStatus::Matched,
                size_matched: Qty::ZERO,
            },
        });
    }

    #[inline]
    fn fok_filled(&self, order: OrderKey, size: Qty, at: TsMs, out: &mut EventQueue) {
        out.push(AccountEvent {
            at,
            kind: AccountEventKind::SettlementUpdate {
                order,
                fill: None,
                status: SettlementStatus::Confirmed,
                size_matched: size,
            },
        });
    }

    #[inline]
    fn filled(&self, _fill: &Fill, _out: &mut EventQueue) {}
}

/// The reports axis (13 §7.3 `models.reports`), enum-dispatched (13 §4.4).
/// `settlement` (13 §6.7) is added with the realistic profile in M3b.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Reports {
    /// `compat`.
    Compat(CompatStatus),
}

impl ReportModel for Reports {
    #[inline]
    fn accepted(&self, order: OrderKey, at: TsMs, out: &mut EventQueue) {
        match self {
            Reports::Compat(m) => m.accepted(order, at, out),
        }
    }
    #[inline]
    fn fok_filled(&self, order: OrderKey, size: Qty, at: TsMs, out: &mut EventQueue) {
        match self {
            Reports::Compat(m) => m.fok_filled(order, size, at, out),
        }
    }
    #[inline]
    fn filled(&self, fill: &Fill, out: &mut EventQueue) {
        match self {
            Reports::Compat(m) => m.filled(fill, out),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compat_status_events() {
        // spec: 13 §5.1 TC-E8, 10 V1 (fill: None; Matched 0 at acceptance; Confirmed after FOK)
        let mut q = EventQueue::new(false);
        let k = OrderKey::new(3);
        CompatStatus.accepted(k, TsMs(7), &mut q);
        CompatStatus.fok_filled(k, Qty::from_micros(10_000_000), TsMs(7), &mut q);
        let a = q.pop().expect("matched");
        assert_eq!(
            a.kind,
            AccountEventKind::SettlementUpdate {
                order: k,
                fill: None,
                status: SettlementStatus::Matched,
                size_matched: Qty::ZERO
            }
        );
        assert_eq!(a.at, TsMs(7));
        let b = q.pop().expect("confirmed");
        assert_eq!(
            b.kind,
            AccountEventKind::SettlementUpdate {
                order: k,
                fill: None,
                status: SettlementStatus::Confirmed,
                size_matched: Qty::from_micros(10_000_000)
            }
        );
        assert!(q.is_empty());
    }
}
