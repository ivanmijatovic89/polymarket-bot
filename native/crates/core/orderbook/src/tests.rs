use super::*;
use domain::QuoteSide;
use proptest::prelude::*;

fn p(m: i64) -> Price {
    Price::from_micros(m)
}
fn q(m: i64) -> Qty {
    Qty::from_micros(m)
}
fn l(price: i64, size: i64) -> Level {
    level(price, size)
}
fn lu(outcome: Outcome, side: Side, price: i64, size: i64) -> LevelUpdate {
    LevelUpdate {
        outcome,
        side,
        price: p(price),
        size: q(size),
    }
}
fn prices(s: &BookSide) -> Vec<(i64, i64)> {
    s.levels()
        .map(|l| (l.price.micros(), l.size.micros()))
        .collect()
}

#[test]
fn snapshot_and_deltas() {
    // spec: 15 I-6a, I-6b, I-6c; 16 BK-7
    let mut m = MarketBooks::new();
    assert!(m.get(Outcome::Up).is_none());
    let ch = m.apply_snapshot(
        Outcome::Up,
        [l(480_000, 10_000_000), l(470_000, 0)],
        [l(520_000, 5_000_000), l(530_000, 7_000_000)],
    );
    assert!(ch.price);
    assert_eq!(m.best_bid(Outcome::Up).unwrap().price, p(480_000));
    assert_eq!(
        m.get(Outcome::Up).unwrap().bids.len(),
        1,
        "size 0 dropped (I-6a)"
    );
    assert_eq!(m.best_ask(Outcome::Up).unwrap().price, p(520_000));
    // size change at the best ask
    let ch = m.apply_level(Outcome::Up, Side::Ask, p(520_000), q(1_000_000));
    assert_eq!(
        ch,
        TopChange {
            price: false,
            size: true
        }
    );
    // same size again: no change
    let ch = m.apply_level(Outcome::Up, Side::Ask, p(520_000), q(1_000_000));
    assert!(!ch.any());
    // remove the best ask
    let ch = m.apply_level(Outcome::Up, Side::Ask, p(520_000), q(0));
    assert!(ch.price);
    assert_eq!(m.best_ask(Outcome::Up).unwrap().price, p(530_000));
    // deep change: no top change
    let ch = m.apply_level(Outcome::Up, Side::Bid, p(100_000), q(1));
    assert!(!ch.any());
    // delta before book (I-6c)
    let ch = m.apply_level(Outcome::Down, Side::Bid, p(500_000), q(1));
    assert!(ch.price, "a side appearing is a price change");
    assert_eq!(m.counters.delta_before_book, 1);
    assert_eq!(
        prices(&m.get(Outcome::Up).unwrap().asks),
        vec![(530_000, 7_000_000)]
    );
    assert_eq!(
        prices(&m.get(Outcome::Up).unwrap().bids),
        vec![(480_000, 10_000_000), (100_000, 1)]
    );
}

#[test]
fn snapshot_drops_nonpositive_before_replace() {
    // spec: 15 I-6a — TS filters size <= 0 levels before building the side
    // map, so a later non-positive duplicate never deletes a positive level;
    // among positive duplicates the last wins.
    let mut m = MarketBooks::new();
    m.apply_snapshot(
        Outcome::Up,
        [
            l(400_000, 5),
            l(400_000, 0),
            l(300_000, 1),
            l(300_000, 2),
            l(200_000, -3),
        ],
        [l(600_000, 4), l(600_000, -1)],
    );
    let b = m.get(Outcome::Up).unwrap();
    assert_eq!(prices(&b.bids), vec![(400_000, 5), (300_000, 2)]);
    assert_eq!(prices(&b.asks), vec![(600_000, 4)]);
}

#[test]
fn snapshot_time_and_outcome_times() {
    // spec: 15 I-6d — every applied message with a timestamp sets the
    // snapshot time, including prints and tick-size changes; it can move
    // backwards across outcomes.
    let mut m = MarketBooks::new();
    assert_eq!(m.snapshot_ts(), None);
    let book = MarketEvent::Book {
        outcome: Outcome::Up,
        bids: &[l(400_000, 1)],
        asks: &[],
    };
    m.apply(Some(TsMs(100)), &book);
    assert_eq!(m.snapshot_ts(), Some(TsMs(100)));
    assert_eq!(m.outcome_ts(Outcome::Up), Some(TsMs(100)));
    let print = MarketEvent::LastTrade {
        outcome: Outcome::Down,
        price: p(500_000),
        size: q(1),
        side: None,
    };
    m.apply(Some(TsMs(90)), &print);
    assert_eq!(m.snapshot_ts(), Some(TsMs(90)), "moves backwards");
    assert_eq!(m.outcome_ts(Outcome::Down), Some(TsMs(90)));
    assert_eq!(m.outcome_ts(Outcome::Up), Some(TsMs(100)));
    assert!(
        m.get(Outcome::Down).unwrap().bids.is_empty(),
        "print creates an empty book"
    );
    assert_eq!(m.counters.delta_before_book, 1);
    let tick = MarketEvent::TickSizeChange {
        outcome: Outcome::Up,
        tick: p(1_000),
    };
    m.apply(Some(TsMs(95)), &tick);
    assert_eq!(m.snapshot_ts(), Some(TsMs(95)));
    assert_eq!(m.counters.delta_before_book, 1, "Up has a book");
    // a message without a timestamp leaves the times unchanged
    m.apply(None, &tick);
    assert_eq!(m.snapshot_ts(), Some(TsMs(95)));
}

#[test]
fn delta_before_book_counts_per_message_and_outcome() {
    // spec: 15 I-6c, §8 `deltaBeforeBook` (TS warning per message and asset
    // until the asset's first `book`).
    let mut m = MarketBooks::new();
    let changes = [
        lu(Outcome::Up, QuoteSide::Bid, 400_000, 1),
        lu(Outcome::Up, QuoteSide::Ask, 600_000, 1),
        lu(Outcome::Down, QuoteSide::Bid, 300_000, 1),
    ];
    let ev = MarketEvent::PriceChange { changes: &changes };
    m.apply(Some(TsMs(1)), &ev);
    assert_eq!(m.counters.delta_before_book, 2);
    m.apply(Some(TsMs(2)), &ev);
    assert_eq!(
        m.counters.delta_before_book, 4,
        "still no book: counted again"
    );
    m.apply(
        Some(TsMs(3)),
        &MarketEvent::Book {
            outcome: Outcome::Up,
            bids: &[],
            asks: &[],
        },
    );
    m.apply(Some(TsMs(4)), &ev);
    assert_eq!(m.counters.delta_before_book, 5, "only Down counted");
    assert!(m.saw_book(Outcome::Up) && !m.saw_book(Outcome::Down));
}

#[test]
fn reset_unlists_books_and_rebuilds() {
    // spec: 15 I-6f — a reset clears the books in scope; later messages
    // rebuild them with I-6a–I-6c (TS: fresh MarketOrderBookEngine).
    let mut m = MarketBooks::new();
    for o in Outcome::ALL {
        m.apply(
            Some(TsMs(10)),
            &MarketEvent::Book {
                outcome: o,
                bids: &[l(400_000, 1)],
                asks: &[l(600_000, 1)],
            },
        );
    }
    m.reset(Some(Outcome::Down));
    assert!(m.get(Outcome::Down).is_none());
    assert!(m.get(Outcome::Up).is_some());
    assert_eq!(m.snapshot_ts(), Some(TsMs(10)));
    m.reset(None);
    assert!(m.get(Outcome::Up).is_none());
    assert_eq!(m.snapshot_ts(), None);
    assert_eq!(m.outcome_ts(Outcome::Up), None);
    let changes = [lu(Outcome::Up, QuoteSide::Bid, 450_000, 2)];
    m.apply(
        Some(TsMs(11)),
        &MarketEvent::PriceChange { changes: &changes },
    );
    assert_eq!(m.counters.delta_before_book, 1, "counted again after reset");
    let up = m.get(Outcome::Up).unwrap();
    assert_eq!(prices(&up.bids), vec![(450_000, 2)]);
    assert!(up.asks.is_empty(), "old levels are gone");
    assert!(m.get(Outcome::Down).is_none());
}

#[test]
fn reset_marks_books_stale_until_next_book() {
    // spec: 15 I-6f, §8 `staleBookEvents` — a reset book is stale until its
    // next `book`; events applied meanwhile are counted once per message;
    // an outcome that never had a book is not stale.
    let mut m = MarketBooks::new();
    assert!(!m.is_stale(Outcome::Up) && !m.is_stale(Outcome::Down));
    let book = |o| MarketEvent::Book {
        outcome: o,
        bids: &[],
        asks: &[],
    };
    m.apply(Some(TsMs(1)), &book(Outcome::Up));
    m.reset(Some(Outcome::Up));
    assert!(m.is_stale(Outcome::Up) && !m.is_stale(Outcome::Down));
    let changes = [
        lu(Outcome::Up, QuoteSide::Bid, 400_000, 1),
        lu(Outcome::Up, QuoteSide::Ask, 600_000, 1),
        lu(Outcome::Down, QuoteSide::Bid, 400_000, 1),
    ];
    m.apply(
        Some(TsMs(2)),
        &MarketEvent::PriceChange { changes: &changes },
    );
    assert_eq!(m.counters.stale_book_events, 1, "once per message");
    assert!(
        m.is_stale(Outcome::Up),
        "a price_change does not end staleness"
    );
    m.apply(
        Some(TsMs(3)),
        &MarketEvent::PriceChange {
            changes: &changes[2..],
        },
    );
    assert_eq!(m.counters.stale_book_events, 1, "Down is not stale");
    m.touch(Outcome::Up);
    assert_eq!(m.counters.stale_book_events, 2);
    m.apply(Some(TsMs(4)), &book(Outcome::Up));
    assert_eq!(
        m.counters.stale_book_events, 2,
        "the re-booking message is not"
    );
    assert!(!m.is_stale(Outcome::Up), "the next book ends staleness");
    m.reset(None);
    assert!(m.is_stale(Outcome::Up) && m.is_stale(Outcome::Down));
}

#[test]
fn crossed_book_ticks() {
    // spec: 15 §8 `crossedBookTicks` — counted per book/price_change message
    // after which some book is crossed or locked; replay unchanged.
    let mut m = MarketBooks::new();
    m.apply_snapshot(Outcome::Up, [l(500_000, 1)], [l(500_000, 1)]);
    assert_eq!(m.counters.crossed_book_ticks, 1, "locked");
    m.apply_level(Outcome::Up, Side::Ask, p(500_000), q(0));
    assert_eq!(m.counters.crossed_book_ticks, 1);
    m.apply_level(Outcome::Down, Side::Bid, p(700_000), q(1));
    m.apply_level(Outcome::Down, Side::Ask, p(600_000), q(1));
    assert_eq!(m.counters.crossed_book_ticks, 2, "crossed");
    assert_eq!(m.best_bid(Outcome::Down).unwrap().price, p(700_000));
    m.touch(Outcome::Up);
    assert_eq!(m.counters.crossed_book_ticks, 2, "prints are not ticks");
}

#[test]
fn top_change_is_per_message() {
    // spec: 16 BK-7 — the bit compares the tops before and after the whole
    // event; a change undone inside one message is no change.
    let mut m = MarketBooks::new();
    m.apply_snapshot(Outcome::Up, [l(400_000, 1)], [l(600_000, 1)]);
    let undo = [
        lu(Outcome::Up, QuoteSide::Bid, 450_000, 3),
        lu(Outcome::Up, QuoteSide::Bid, 450_000, 0),
    ];
    let ch = m.apply(None, &MarketEvent::PriceChange { changes: &undo });
    assert!(!ch.any());
    let other = [lu(Outcome::Down, QuoteSide::Ask, 550_000, 1)];
    let ch = m.apply(None, &MarketEvent::PriceChange { changes: &other });
    assert!(ch.price, "the other outcome's top counts");
    let same = MarketEvent::Book {
        outcome: Outcome::Up,
        bids: &[l(400_000, 1), l(300_000, 9)],
        asks: &[l(600_000, 1)],
    };
    assert!(!m.apply(None, &same).any(), "same tops after a replace");
}

#[test]
fn off_grid_prices_use_overflow() {
    let mut s = BookSide::new(Side::Ask);
    s.set(p(500_050), q(1)); // off the 0.0001 grid
    s.set(p(500_100), q(2));
    s.set(p(500_000), q(3));
    assert_eq!(prices(&s), vec![(500_000, 3), (500_050, 1), (500_100, 2)]);
    assert_eq!(s.depth_through(p(500_050)), q(4));
    s.set(p(500_000), q(0));
    assert_eq!(
        s.best(),
        Some(l(500_050, 1)),
        "best moves into the overflow"
    );
    s.clear();
    assert!(s.is_empty());
    assert!(s.best().is_none());
    let mut b = BookSide::new(Side::Bid);
    b.set(p(1_000_001), q(1)); // above 1: overflow
    b.set(p(-5), q(2)); // negative: overflow
    b.set(p(999_900), q(3));
    assert_eq!(prices(&b), vec![(1_000_001, 1), (999_900, 3), (-5, 2)]);
}

/// Best (price, size) of bids and asks.
type RefTops = (Option<(i64, i64)>, Option<(i64, i64)>);

/// Reference book for the property tests: `BTreeMap` per side.
#[derive(Default, Clone)]
struct RefBook {
    bids: BTreeMap<i64, i64>,
    asks: BTreeMap<i64, i64>,
}

impl RefBook {
    fn side(&mut self, s: Side) -> &mut BTreeMap<i64, i64> {
        match s {
            Side::Bid => &mut self.bids,
            Side::Ask => &mut self.asks,
        }
    }
    fn tops(&self) -> RefTops {
        (
            self.bids.iter().next_back().map(|(&a, &b)| (a, b)),
            self.asks.iter().next().map(|(&a, &b)| (a, b)),
        )
    }
}

fn price_strategy() -> impl Strategy<Value = i64> {
    prop_oneof![
        (0i64..=100).prop_map(|t| t * 10_000),
        (0i64..=10_000).prop_map(|t| t * 100),
        -1_000i64..=1_001_000,
    ]
}

proptest! {
    // spec: 16 BK-4 (ladder == BTreeMap reference on random streams)
    #[test]
    fn ladder_equals_btreemap(ops in prop::collection::vec((price_strategy(), 0i64..5, any::<bool>()), 0..400)) {
        for side in [Side::Bid, Side::Ask] {
            let mut s = BookSide::new(side);
            let mut r: BTreeMap<i64, i64> = BTreeMap::new();
            for &(price, size, clear) in &ops {
                if clear && size == 0 && price % 7 == 0 {
                    s.clear();
                    r.clear();
                    continue;
                }
                s.set(p(price), q(size));
                if size > 0 { r.insert(price, size); } else { r.remove(&price); }
                let got = prices(&s);
                let mut want: Vec<(i64, i64)> = r.iter().map(|(&a, &b)| (a, b)).collect();
                if side == Side::Bid { want.reverse(); }
                prop_assert_eq!(&got, &want);
                prop_assert_eq!(s.len(), want.len());
                prop_assert_eq!(s.best().map(|l| (l.price.micros(), l.size.micros())), want.first().copied());
                prop_assert_eq!(s.size_at(p(price)).micros(), r.get(&price).copied().unwrap_or(0));
                for n in [0usize, 1, 3, 50] {
                    let d: i64 = want.iter().take(n).map(|x| x.1).sum();
                    prop_assert_eq!(s.depth_levels(n).micros(), d);
                }
            }
        }
    }

    // spec: 15 I-6a–I-6c, 16 BK-7 — message-level apply against a reference
    // model: levels, top-change bit and the crossed counter.
    #[test]
    fn market_apply_matches_reference(
        msgs in prop::collection::vec(
            (any::<bool>(), any::<bool>(),
             prop::collection::vec((any::<bool>(), any::<bool>(), price_strategy(), -1i64..4), 0..6)),
            0..120)
    ) {
        let mut m = MarketBooks::new();
        let mut r: [Option<RefBook>; 2] = [None, None];
        let mut crossed = 0u64;
        for (is_book, up, levels) in &msgs {
            let before: Vec<_> = r.iter().map(|b| b.as_ref().map(RefBook::tops).unwrap_or((None, None))).collect();
            let got = if *is_book {
                let o = if *up { Outcome::Up } else { Outcome::Down };
                let mut bids = Vec::new();
                let mut asks = Vec::new();
                let mut rb = RefBook::default();
                for &(_, bid, price, size) in levels {
                    let side = if bid { Side::Bid } else { Side::Ask };
                    if bid { bids.push(l(price, size)) } else { asks.push(l(price, size)) }
                    if size > 0 { rb.side(side).insert(price, size); }
                }
                r[o.index()] = Some(rb);
                m.apply(Some(TsMs(1)), &MarketEvent::Book { outcome: o, bids: &bids, asks: &asks })
            } else {
                let changes: Vec<LevelUpdate> = levels.iter().map(|&(cup, bid, price, size)| {
                    let o = if cup { Outcome::Up } else { Outcome::Down };
                    let side = if bid { Side::Bid } else { Side::Ask };
                    let rb = r[o.index()].get_or_insert_with(RefBook::default).side(side);
                    if size > 0 { rb.insert(price, size); } else { rb.remove(&price); }
                    lu(o, side, price, size)
                }).collect();
                m.apply(Some(TsMs(1)), &MarketEvent::PriceChange { changes: &changes })
            };
            let after: Vec<_> = r.iter().map(|b| b.as_ref().map(RefBook::tops).unwrap_or((None, None))).collect();
            if after.iter().any(|t| matches!(t, (Some((b, _)), Some((a, _))) if b >= a)) {
                crossed += 1;
            }
            for o in Outcome::ALL {
                match &r[o.index()] {
                    None => prop_assert!(m.get(o).is_none()),
                    Some(rb) => {
                        let b = m.get(o).unwrap();
                        let want_b: Vec<_> = rb.bids.iter().rev().map(|(&a, &b)| (a, b)).collect();
                        let want_a: Vec<_> = rb.asks.iter().map(|(&a, &b)| (a, b)).collect();
                        prop_assert_eq!(prices(&b.bids), want_b);
                        prop_assert_eq!(prices(&b.asks), want_a);
                    }
                }
            }
            let price_of_top = |t: &RefTops| (t.0.map(|x| x.0), t.1.map(|x| x.0));
            let want_price = before.iter().zip(&after).any(|(b, a)| price_of_top(b) != price_of_top(a));
            let want = TopChange { price: want_price, size: !want_price && before != after };
            prop_assert_eq!(got, want);
            prop_assert_eq!(m.counters.crossed_book_ticks, crossed);
        }
    }
}
