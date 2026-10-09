//! Day cache behavior (14 PF-1, 16 §6.1) and the day-file error rows of
//! 14 §10 (V-9), on the committed fixture slices.

use pmb_feeds::{CacheStats, DayCache, ErrorClass, FeedCause, UtcDay};
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn fixture(rel: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/feeds")
        .join(rel)
}

fn binance_path(day: &str) -> PathBuf {
    fixture(&format!(
        "binance/aggTrades/BTCUSDT/BTCUSDT-aggTrades-{day}.parquet"
    ))
}

fn len(p: &Path) -> u64 {
    std::fs::metadata(p).unwrap().len()
}

fn day(s: &str) -> UtcDay {
    UtcDay::parse(s).unwrap()
}

// spec: 14 PF-1 (loaded once, shared), PF-7 (hits, misses, bytes decoded)
#[test]
fn hits_misses_and_sharing() {
    let cache = DayCache::new(1 << 30);
    let p = binance_path("2026-09-16");
    let mut st = CacheStats::default();
    let a = cache
        .binance_day("BTCUSDT", day("2026-09-16"), &p, len(&p), &mut st)
        .unwrap();
    let b = cache
        .binance_day("BTCUSDT", day("2026-09-16"), &p, len(&p), &mut st)
        .unwrap();
    assert!(Arc::ptr_eq(&a, &b));
    assert_eq!((st.misses, st.hits), (1, 1));
    assert_eq!(st.bytes_decoded, a.bytes() as u64);
    assert!(
        a.ts_monotone(),
        "real BTCUSDT slice is id/ts monotone (PF-2)"
    );
    let c = fixture("telonex/crypto_prices/btcusd/btcusd-crypto-prices-2026-09-16.parquet");
    let d = cache
        .chainlink_day("btcusd", day("2026-09-16"), &c, len(&c), &mut st)
        .unwrap();
    assert!(!d.is_empty());
    assert_eq!(cache.len(), 2);
}

// spec: 14 PF-1 (single flight under concurrent requests)
#[test]
fn single_flight() {
    let cache = DayCache::new(1 << 30);
    let p = binance_path("2026-07-26");
    let n = len(&p);
    let stats: Vec<CacheStats> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..8)
            .map(|_| {
                s.spawn(|| {
                    let mut st = CacheStats::default();
                    cache
                        .binance_day("BTCUSDT", day("2026-07-26"), &p, n, &mut st)
                        .unwrap();
                    st
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    assert_eq!(stats.iter().map(|s| s.misses).sum::<u32>(), 1);
    assert_eq!(stats.iter().map(|s| s.hits).sum::<u32>(), 7);
}

// spec: 14 PF-1 (byte-capped LRU never drops an entry in use)
#[test]
fn eviction_spares_entries_in_use() {
    let cache = DayCache::new(0);
    let mut st = CacheStats::default();
    let p1 = binance_path("2026-03-09");
    let p2 = binance_path("2026-03-10");
    let d1 = cache
        .binance_day("BTCUSDT", day("2026-03-09"), &p1, len(&p1), &mut st)
        .unwrap();
    assert_eq!(cache.len(), 1, "in use: kept despite the zero cap");
    drop(d1);
    let _d2 = cache
        .binance_day("BTCUSDT", day("2026-03-10"), &p2, len(&p2), &mut st)
        .unwrap();
    assert_eq!(cache.len(), 1, "the unused day was evicted");
    let _d1 = cache
        .binance_day("BTCUSDT", day("2026-03-09"), &p1, len(&p1), &mut st)
        .unwrap();
    assert_eq!(st.misses, 3);
}

// spec: 14 §4.1 and §10 rows: size differs from feedFiles (data_missing
// integrity_mismatch), listed file absent (data_missing input_missing, 21
// §5.1), decode
// failure (runtime decode_unverified, not cached)
#[test]
fn day_file_errors() {
    let cache = DayCache::new(1 << 30);
    let mut st = CacheStats::default();
    let p = binance_path("2026-09-16");
    let e = cache
        .binance_day("BTCUSDT", day("2026-09-16"), &p, len(&p) + 1, &mut st)
        .unwrap_err();
    assert_eq!(
        (e.class(), e.cause),
        (ErrorClass::DataMissing, FeedCause::IntegrityMismatch)
    );
    assert!(e.message.contains("BTCUSDT-aggTrades-2026-09-16.parquet"));
    let missing = binance_path("2026-09-17");
    let e = cache
        .binance_day("BTCUSDT", day("2026-09-17"), &missing, 1, &mut st)
        .unwrap_err();
    assert_eq!(
        (e.class(), e.cause),
        (ErrorClass::DataMissing, FeedCause::InputMissing)
    );
    let not_parquet = fixture("README.md");
    let e = cache
        .binance_day(
            "BTCUSDT",
            day("2026-09-16"),
            &not_parquet,
            len(&not_parquet),
            &mut st,
        )
        .unwrap_err();
    assert_eq!(
        (e.class(), e.cause),
        (ErrorClass::Runtime, FeedCause::DecodeUnverified)
    );
    assert!(e.message.contains("README.md"));
    assert!(cache.is_empty(), "failed loads are not cached");
    let e = cache
        .chainlink_day("btcusd", day("2026-09-16"), &p, len(&p), &mut st)
        .unwrap_err();
    assert_eq!(
        e.cause,
        FeedCause::DecodeUnverified,
        "binance file is not a crypto_prices file"
    );
}
