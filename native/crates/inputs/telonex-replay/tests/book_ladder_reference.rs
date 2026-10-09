//! spec: 16 BK-4 — the dense-ladder `MarketBooks` and an ordered-map
//! reference of 15 I-6a–I-6c give identical views (listed books, best
//! levels, level counts, depth to N, best-first levels) after every event of
//! real markets: the committed fixture markets always, and, on hosts with
//! the dataset, a stand-in for `smoke-50` (every 600th BTC 15m file, about
//! 52 markets) until the bench-set manifest of 16 §13.1 exists.

use domain::{MarketEvent, Outcome};
use orderbook::{MarketBooks, Side};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use telonex_replay::telonex::file_asset_ids;
use telonex_replay::{read_telonex_delta, InputFile, InputFormat, TelonexInput};

/// Ordered-map reference: per outcome, `None` until listed (I-6e).
#[derive(Default)]
struct Reference {
    books: [Option<[BTreeMap<i64, i64>; 2]>; 2],
}

impl Reference {
    fn apply(&mut self, ev: &MarketEvent<'_>) {
        match *ev {
            MarketEvent::Book {
                outcome,
                bids,
                asks,
            } => {
                let mut sides = [BTreeMap::new(), BTreeMap::new()];
                for (k, ls) in [bids, asks].into_iter().enumerate() {
                    for l in ls.iter().filter(|l| l.size.micros() > 0) {
                        sides[k].insert(l.price.micros(), l.size.micros());
                    }
                }
                self.books[outcome.index()] = Some(sides);
            }
            MarketEvent::PriceChange { changes } => {
                for c in changes {
                    let book = self.books[c.outcome.index()].get_or_insert_with(Default::default);
                    let side = &mut book[usize::from(c.side == Side::Ask)];
                    if c.size.micros() > 0 {
                        side.insert(c.price.micros(), c.size.micros());
                    } else {
                        side.remove(&c.price.micros());
                    }
                }
            }
            _ => unreachable!("telonex rows are book or price_change"),
        }
    }

    /// Best-first levels of one side.
    fn levels(&self, o: Outcome, side: Side) -> Option<Vec<(i64, i64)>> {
        let m = &self.books[o.index()].as_ref()?[usize::from(side == Side::Ask)];
        let it = m.iter().map(|(&p, &s)| (p, s));
        Some(match side {
            Side::Bid => it.rev().collect(),
            Side::Ask => it.collect(),
        })
    }
}

fn compare(books: &MarketBooks, r: &Reference, full: bool, at: &str) {
    for o in Outcome::ALL {
        for side in [Side::Bid, Side::Ask] {
            let want = r.levels(o, side);
            let got = books.get(o).map(|b| b.side(side));
            assert_eq!(got.is_some(), want.is_some(), "{at} {o:?}: listed");
            let (Some(got), Some(want)) = (got, want) else {
                continue;
            };
            let lv = |l: orderbook::Level| (l.price.micros(), l.size.micros());
            assert_eq!(got.len(), want.len(), "{at} {o:?} {side:?}: len");
            assert_eq!(got.best().map(lv), want.first().copied(), "{at}: best");
            let n = if full { usize::MAX } else { 10 };
            let top: Vec<_> = got.levels().take(n).map(lv).collect();
            let want_top: Vec<_> = want.iter().take(n).copied().collect();
            assert_eq!(top, want_top, "{at} {o:?} {side:?}: levels");
            let depth: i64 = want.iter().take(5).map(|x| x.1).sum();
            assert_eq!(got.depth_levels(5).micros(), depth, "{at}: depth 5");
        }
    }
}

/// Replays one market through both books; returns the number of events.
fn check(path: &Path) -> usize {
    let ids = file_asset_ids(path).unwrap();
    assert_eq!(ids.len(), 2, "{}", path.display());
    let file = InputFile {
        path,
        bytes: std::fs::metadata(path).unwrap().len(),
        sha256: None,
        format: InputFormat {
            name: "telonex-delta-typed",
            version: 1,
        },
    };
    let tape = read_telonex_delta(
        &file,
        TelonexInput {
            tokens: [&ids[0], &ids[1]],
            condition_id: None,
        },
    )
    .unwrap();
    let mut books = MarketBooks::new();
    let mut r = Reference::default();
    for (i, ev) in tape.events().enumerate() {
        books.apply(Some(ev.exchange_ts), &ev.event);
        r.apply(&ev.event);
        let at = format!("{} event {i}", path.display());
        compare(&books, &r, i % 997 == 0, &at);
    }
    compare(&books, &r, true, &format!("{} end", path.display()));
    tape.len()
}

#[test]
fn fixture_markets_ladder_equals_reference() {
    let dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/golden/telonex/markets");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    files.sort();
    assert!(files.len() >= 3);
    let events: usize = files.iter().map(|f| check(f)).sum();
    assert!(events > 90_000, "{events} events");
}

#[test]
#[ignore = "needs the dataset under <repo>/data; run with --ignored on a host that has it"]
fn dataset_sample_ladder_equals_reference() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../data/events/telonex/delta-typed/btc/15m");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .map(|e| e.unwrap().path())
        .collect();
    files.sort();
    let sample: Vec<_> = files.iter().step_by(600).collect();
    assert!(sample.len() >= 50, "{} files", sample.len());
    for f in sample {
        check(f);
    }
}
