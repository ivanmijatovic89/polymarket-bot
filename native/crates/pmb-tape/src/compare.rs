//! NT-6 (b): equality of the engine event stream on both input paths.
//!
//! The stream is what the engine consumes from the reader: every kept row's
//! kind, outcome, levels and both timestamps (plus its file row index), the
//! file's market id, and the skip and anomaly counters.

use crate::MarketStream;
use pmb_core::{MarketEvent, QuoteSide, TimedMarketEvent};
use pmb_replay::telonex::{RowKind, TelonexDiagnostics};
use sha2::{Digest, Sha256};

/// The first difference between two streams, or `None` when identical.
pub fn first_difference(a: &MarketStream, b: &MarketStream) -> Option<String> {
    if a.market() != b.market() {
        return Some(format!("market {:?} vs {:?}", a.market(), b.market()));
    }
    if a.diagnostics() != b.diagnostics() {
        return Some(format!(
            "diagnostics {:?} vs {:?}",
            a.diagnostics(),
            b.diagnostics()
        ));
    }
    if a.len() != b.len() {
        return Some(format!("{} vs {} events", a.len(), b.len()));
    }
    for i in 0..a.len() {
        let (x, y) = (a.event(i), b.event(i));
        if x != y {
            return Some(format!("event {i}: {x:?} vs {y:?}"));
        }
    }
    None
}

fn put_event(h: &mut Sha256, e: &TimedMarketEvent<'_>) {
    h.update(e.row.to_le_bytes());
    h.update(e.exchange_ts.0.to_le_bytes());
    match e.local_ts {
        Some(t) => {
            h.update([1]);
            h.update(t.0.to_le_bytes());
        }
        None => h.update([0]),
    }
    match e.event {
        MarketEvent::Book {
            outcome,
            bids,
            asks,
        } => {
            h.update([0, outcome as u8]);
            for side in [bids, asks] {
                h.update((side.len() as u32).to_le_bytes());
                for l in side {
                    h.update(l.price.micros().to_le_bytes());
                    h.update(l.size.micros().to_le_bytes());
                }
            }
        }
        MarketEvent::PriceChange { changes } => {
            h.update([1]);
            h.update((changes.len() as u32).to_le_bytes());
            for c in changes {
                let side = match c.side {
                    QuoteSide::Bid => 0u8,
                    QuoteSide::Ask => 1,
                };
                h.update([c.outcome as u8, side]);
                h.update(c.price.micros().to_le_bytes());
                h.update(c.size.micros().to_le_bytes());
            }
        }
        // telonex-delta yields only book and price_change.
        MarketEvent::LastTrade { .. } | MarketEvent::TickSizeChange { .. } => h.update([0xFF]),
    }
}

fn put_diagnostics(h: &mut Sha256, d: &TelonexDiagnostics) {
    let s = &d.skipped;
    for v in [
        d.rows_read,
        s.blank_market,
        s.no_exchange_ts,
        s.other_event_type,
        s.unresolved_book_asset,
        s.empty_price_change,
        d.dropped_changes,
        d.inexact_decimal,
        d.exchange_clock_backwards,
        d.local_clock_backwards,
        d.local_behind_exchange,
        d.ingest_seq_backwards,
    ] {
        h.update(v.to_le_bytes());
    }
}

/// sha256 of the canonical byte form of a stream (equal streams, equal digests).
pub fn digest(s: &MarketStream) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update((s.market().len() as u32).to_le_bytes());
    h.update(s.market().as_bytes());
    put_diagnostics(&mut h, s.diagnostics());
    h.update((s.len() as u64).to_le_bytes());
    for e in s.events() {
        put_event(&mut h, &e);
    }
    h.finalize().into()
}

/// Number of book levels plus price changes in a stream.
pub fn level_count(s: &MarketStream) -> u64 {
    s.events()
        .map(|e| match e.event {
            MarketEvent::Book { bids, asks, .. } => (bids.len() + asks.len()) as u64,
            MarketEvent::PriceChange { changes } => changes.len() as u64,
            _ => 0,
        })
        .sum()
}

/// Kind label of a kept row, for reports.
pub fn kind_label(k: RowKind) -> &'static str {
    match k {
        RowKind::Book { .. } => "book",
        RowKind::PriceChange => "price_change",
    }
}
