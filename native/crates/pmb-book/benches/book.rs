//! L0 micro benchmarks of the dense-ladder book (16 §8, §13.2 L0): level
//! apply with the top-change bit (BK-7), snapshot replace (BK-2), best
//! bid/ask, and the per-event "apply + read both tops" step of the replay.
//!
//! The stream is synthetic and deterministic (SplitMix64, no RNG crate): a
//! random-walk mid on the 0.01 grid, kept within [0.22, 0.78] so every level
//! update (within 20 ticks of it, 20% deletes) lies on the dense ladder in
//! (0, 1) and none takes the overflow path; and a `book` snapshot of 30 + 30
//! levels every 100 events (clipped to (0, 1)). `stream()` asserts this.
//! Recorded streams are benched in `pmb-replay` (`--bench decode`).
//! Run: `cargo bench -p pmb-book --bench book`.

use criterion::{criterion_group, criterion_main, BatchSize, Criterion, Throughput};
use pmb_book::{BookSide, Level, MarketBooks, Side};
use pmb_core::{Outcome, Price, Qty};
use std::hint::black_box;

const EVENTS: usize = 100_000;
const SNAPSHOT_EVERY: usize = 100;
const SNAPSHOT_DEPTH: i64 = 30;
const TICK: i64 = 10_000; // 0.01 in micros
/// Level offsets reach 19 ticks beyond the touch (bids one tick lower), so a
/// mid in [MID_MIN, MID_MAX] keeps every level price in (0, 1) for both
/// outcomes (the DOWN mid is 1 - mid).
const MAX_OFFSET_TICKS: i64 = 19;
const MID_MIN: i64 = 220_000;
const MID_MAX: i64 = 1_000_000 - MID_MIN;

fn splitmix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

enum Ev {
    Snapshot {
        outcome: Outcome,
        bids: Vec<Level>,
        asks: Vec<Level>,
    },
    Level {
        outcome: Outcome,
        side: Side,
        price: Price,
        size: Qty,
    },
}

fn snapshot(outcome: Outcome, mid: i64, s: &mut u64) -> Ev {
    let lv = |p: i64, s: &mut u64| Level {
        price: Price::from_micros(p),
        size: Qty::from_micros(1_000_000 + (splitmix(s) % 5_000_000_000) as i64),
    };
    let bids = (1..=SNAPSHOT_DEPTH)
        .map(|k| mid - k * TICK)
        .filter(|&p| p > 0)
        .map(|p| lv(p, s))
        .collect();
    let asks = (0..SNAPSHOT_DEPTH)
        .map(|k| mid + k * TICK)
        .filter(|&p| p < 1_000_000)
        .map(|p| lv(p, s))
        .collect();
    Ev::Snapshot {
        outcome,
        bids,
        asks,
    }
}

fn stream() -> Vec<Ev> {
    let mut s = 0xb00c_u64;
    let mut mid = 500_000i64;
    let mut out = Vec::with_capacity(EVENTS);
    for i in 0..EVENTS {
        let outcome = if splitmix(&mut s) % 2 == 0 {
            Outcome::Up
        } else {
            Outcome::Down
        };
        let m = if outcome == Outcome::Up {
            mid
        } else {
            1_000_000 - mid
        };
        if i % SNAPSHOT_EVERY == 0 {
            out.push(snapshot(outcome, m, &mut s));
            continue;
        }
        if splitmix(&mut s) % 16 == 0 {
            let step = (splitmix(&mut s) % 3) as i64 - 1;
            mid = (mid + step * TICK).clamp(MID_MIN, MID_MAX);
        }
        let side = if splitmix(&mut s) % 2 == 0 {
            Side::Bid
        } else {
            Side::Ask
        };
        let off = (splitmix(&mut s) % (MAX_OFFSET_TICKS as u64 + 1)) as i64 * TICK;
        let price = match side {
            Side::Bid => m - TICK - off,
            Side::Ask => m + off,
        };
        assert!(
            price > 0 && price < 1_000_000,
            "synthetic level {price} is off the dense ladder"
        );
        let size = if splitmix(&mut s) % 5 == 0 {
            0
        } else {
            1_000_000 + (splitmix(&mut s) % 5_000_000_000) as i64
        };
        out.push(Ev::Level {
            outcome,
            side,
            price: Price::from_micros(price),
            size: Qty::from_micros(size),
        });
    }
    out
}

#[inline]
fn apply(books: &mut MarketBooks, ev: &Ev) -> bool {
    match ev {
        Ev::Snapshot {
            outcome,
            bids,
            asks,
        } => books
            .apply_snapshot(*outcome, bids.iter().copied(), asks.iter().copied())
            .any(),
        Ev::Level {
            outcome,
            side,
            price,
            size,
        } => books.apply_level(*outcome, *side, *price, *size).any(),
    }
}

fn warm_books(events: &[Ev]) -> MarketBooks {
    let mut books = MarketBooks::new();
    for ev in events.iter().take(2 * SNAPSHOT_EVERY) {
        apply(&mut books, ev);
    }
    books
}

fn bench_book(c: &mut Criterion) {
    let events = stream();
    let levels: Vec<&Ev> = events
        .iter()
        .filter(|e| matches!(e, Ev::Level { .. }))
        .collect();
    let snapshots: Vec<&Ev> = events
        .iter()
        .filter(|e| matches!(e, Ev::Snapshot { .. }))
        .collect();

    let mut g = c.benchmark_group("book");

    // Level apply with the top-change bit (BK-7), on a populated book.
    g.throughput(Throughput::Elements(levels.len() as u64));
    g.bench_function("apply_level_top_change", |b| {
        b.iter_batched_ref(
            || warm_books(&events),
            |books| {
                let mut changed = 0u32;
                for ev in &levels {
                    changed += u32::from(apply(books, ev));
                }
                black_box(changed)
            },
            BatchSize::LargeInput,
        )
    });

    // Snapshot replace: clears only occupied slots (BK-2), then 30 + 30 sets.
    g.throughput(Throughput::Elements(snapshots.len() as u64));
    g.bench_function("apply_snapshot_30x30", |b| {
        b.iter_batched_ref(
            || warm_books(&events),
            |books| {
                let mut changed = 0u32;
                for ev in &snapshots {
                    changed += u32::from(apply(books, ev));
                }
                black_box(changed)
            },
            BatchSize::LargeInput,
        )
    });

    // The replay step: apply, then read best bid and ask of both outcomes.
    g.throughput(Throughput::Elements(events.len() as u64));
    g.bench_function("event_apply_and_tops", |b| {
        b.iter_batched_ref(
            MarketBooks::new,
            |books| {
                let mut acc = 0i64;
                for ev in &events {
                    acc += i64::from(apply(books, ev));
                    for o in Outcome::ALL {
                        if let Some(l) = books.best_bid(o) {
                            acc = acc.wrapping_add(l.price.micros());
                        }
                        if let Some(l) = books.best_ask(o) {
                            acc = acc.wrapping_add(l.size.micros());
                        }
                    }
                }
                black_box(acc)
            },
            BatchSize::LargeInput,
        )
    });

    // Best bid/ask alone on a populated book (4 lookups per element).
    let books = warm_books(&events);
    g.throughput(Throughput::Elements(1));
    g.bench_function("best_bid_ask_both_outcomes", |b| {
        b.iter(|| {
            let books = black_box(&books);
            let mut acc = 0i64;
            for o in Outcome::ALL {
                acc += books.best_bid(o).map_or(0, |l| l.price.micros());
                acc += books.best_ask(o).map_or(0, |l| l.price.micros());
            }
            black_box(acc)
        })
    });

    // One side's raw ladder set (no top-change bookkeeping).
    let sets: Vec<(Price, Qty)> = levels
        .iter()
        .filter_map(|e| match e {
            Ev::Level {
                side: Side::Bid,
                price,
                size,
                ..
            } => Some((*price, *size)),
            _ => None,
        })
        .collect();
    g.throughput(Throughput::Elements(sets.len() as u64));
    g.bench_function("ladder_side_set", |b| {
        b.iter_batched_ref(
            || BookSide::new(Side::Bid),
            |side| {
                for &(p, q) in &sets {
                    side.set(p, q);
                }
                black_box(side.len())
            },
            BatchSize::LargeInput,
        )
    });

    g.finish();
}

criterion_group!(benches, bench_book);
criterion_main!(benches);
