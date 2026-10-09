//! Per-process cache of decoded feed day files (14 PF-1, 16 §6.1).
//!
//! Entries are immutable, `Arc`-shared across markets, candidates and
//! threads, keyed by `(dataset, symbol or asset, UTC day)` and validated by
//! the file identity `(path, size, mtime)`. A key is loaded once even under
//! concurrent requests (single flight through `OnceLock`). A byte-capped LRU
//! evicts entries no market still uses. Feed code creates no threads
//! (14 PF-6); the cache only reads files.
//!
//! The cache never affects results: lookups are by key and eviction only
//! changes which loads hit (R7). The map is a `BTreeMap` anyway.

use crate::binance::BinanceDay;
use crate::chainlink::ChainlinkDay;
use crate::error::{FeedCause, FeedError};
use crate::time::UtcDay;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// Cache key (14 PF-1).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DayKey {
    Binance { pair: String, day: UtcDay },
    Chainlink { asset: String, day: UtcDay },
}

/// File identity of 16 §6.1: a rewritten file is never served stale.
#[derive(Clone, Debug, PartialEq, Eq)]
struct FileIdent {
    path: PathBuf,
    len: u64,
    mtime_ns: i128,
}

#[derive(Clone, Debug)]
enum Loaded {
    Binance(Arc<BinanceDay>),
    Chainlink(Arc<ChainlinkDay>),
}

impl Loaded {
    fn bytes(&self) -> usize {
        match self {
            Loaded::Binance(d) => d.bytes(),
            Loaded::Chainlink(d) => d.bytes(),
        }
    }
    fn in_use(&self) -> bool {
        match self {
            Loaded::Binance(d) => Arc::strong_count(d) > 1 || d.in_use(),
            Loaded::Chainlink(d) => Arc::strong_count(d) > 1,
        }
    }
}

#[derive(Debug)]
struct Slot {
    ident: FileIdent,
    cell: OnceLock<Result<Loaded, FeedError>>,
    last_use: AtomicU64,
}

#[derive(Debug, Default)]
struct Inner {
    slots: BTreeMap<DayKey, Arc<Slot>>,
    tick: u64,
}

/// Counters of one market's loads (14 PF-7).
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub hits: u32,
    pub misses: u32,
    pub bytes_decoded: u64,
}

/// The day cache of one executor process.
#[derive(Debug)]
pub struct DayCache {
    cap_bytes: usize,
    inner: Mutex<Inner>,
}

fn identity(path: &Path, expected_bytes: u64, what: &str) -> Result<FileIdent, FeedError> {
    let meta = std::fs::metadata(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            FeedError::new(
                FeedCause::InputMissing,
                format!(
                    "{what} day file {} listed in feedFiles is not on this host",
                    path.display()
                ),
            )
        } else {
            FeedError::new(
                FeedCause::Io,
                format!("stat {what} day file {}: {e}", path.display()),
            )
        }
    })?;
    if meta.len() != expected_bytes {
        return Err(FeedError::new(
            FeedCause::IntegrityMismatch,
            format!(
                "{what} day file {} has {} bytes, feedFiles says {expected_bytes} (changed after \
                 the shim's check)",
                path.display(),
                meta.len()
            ),
        ));
    }
    let mtime_ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos() as i128);
    Ok(FileIdent {
        path: path.to_path_buf(),
        len: meta.len(),
        mtime_ns,
    })
}

impl DayCache {
    /// A cache holding at most `cap_bytes` of decoded days not in use
    /// (`--cache-mb`, 20 §6.1).
    pub fn new(cap_bytes: usize) -> DayCache {
        DayCache {
            cap_bytes,
            inner: Mutex::new(Inner::default()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A panic while holding the lock leaves the map consistent (every
        // mutation is a single insert/remove), so poisoning is ignored.
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn get(
        &self,
        key: DayKey,
        ident: FileIdent,
        stats: &mut CacheStats,
        load: impl FnOnce() -> Result<Loaded, FeedError>,
    ) -> Result<Loaded, FeedError> {
        let slot = {
            let mut inner = self.lock();
            inner.tick += 1;
            let tick = inner.tick;
            let slot = match inner.slots.get(&key) {
                Some(s) if s.ident == ident => s.clone(),
                _ => {
                    let s = Arc::new(Slot {
                        ident,
                        cell: OnceLock::new(),
                        last_use: AtomicU64::new(tick),
                    });
                    inner.slots.insert(key.clone(), s.clone());
                    s
                }
            };
            slot.last_use.store(tick, Ordering::Relaxed);
            slot
        };
        let mut loaded_here = false;
        let result = slot
            .cell
            .get_or_init(|| {
                loaded_here = true;
                load()
            })
            .clone();
        match &result {
            Err(_) => {
                let mut inner = self.lock();
                if inner.slots.get(&key).is_some_and(|s| Arc::ptr_eq(s, &slot)) {
                    inner.slots.remove(&key);
                }
            }
            Ok(l) => {
                if loaded_here {
                    stats.misses += 1;
                    stats.bytes_decoded += l.bytes() as u64;
                    drop(slot);
                    self.evict();
                } else {
                    stats.hits += 1;
                }
            }
        }
        result
    }

    /// Evicts least-recently-used entries nobody uses until the decoded
    /// bytes fit the cap; an entry in use is never dropped (14 PF-1).
    fn evict(&self) {
        let mut inner = self.lock();
        loop {
            let total: usize = inner
                .slots
                .values()
                .filter_map(|s| s.cell.get().and_then(|r| r.as_ref().ok()))
                .map(Loaded::bytes)
                .sum();
            if total <= self.cap_bytes {
                return;
            }
            let victim = inner
                .slots
                .iter()
                .filter(|(_, s)| {
                    Arc::strong_count(s) == 1
                        && s.cell
                            .get()
                            .is_some_and(|r| r.as_ref().is_ok_and(|l| !l.in_use()))
                })
                .min_by_key(|(_, s)| s.last_use.load(Ordering::Relaxed))
                .map(|(k, _)| k.clone());
            match victim {
                Some(k) => {
                    inner.slots.remove(&k);
                }
                None => return,
            }
        }
    }

    /// The decoded Binance day `(pair, day)` from `path` (14 §4.1).
    pub fn binance_day(
        &self,
        pair: &str,
        day: UtcDay,
        path: &Path,
        expected_bytes: u64,
        stats: &mut CacheStats,
    ) -> Result<Arc<BinanceDay>, FeedError> {
        let ident = identity(path, expected_bytes, "Binance aggTrades")?;
        let key = DayKey::Binance {
            pair: pair.to_owned(),
            day,
        };
        match self.get(key, ident, stats, || {
            BinanceDay::decode(path, day).map(|d| Loaded::Binance(Arc::new(d)))
        })? {
            Loaded::Binance(d) => Ok(d),
            Loaded::Chainlink(_) => unreachable!("key kind fixes the value kind"),
        }
    }

    /// The decoded Chainlink day `(asset, day)` from `path` (14 §5.1).
    pub fn chainlink_day(
        &self,
        asset: &str,
        day: UtcDay,
        path: &Path,
        expected_bytes: u64,
        stats: &mut CacheStats,
    ) -> Result<Arc<ChainlinkDay>, FeedError> {
        let ident = identity(path, expected_bytes, "Telonex crypto_prices")?;
        let key = DayKey::Chainlink {
            asset: asset.to_owned(),
            day,
        };
        match self.get(key, ident, stats, || {
            ChainlinkDay::decode(path, day, asset).map(|d| Loaded::Chainlink(Arc::new(d)))
        })? {
            Loaded::Chainlink(d) => Ok(d),
            Loaded::Binance(_) => unreachable!("key kind fixes the value kind"),
        }
    }

    /// Number of cached entries (tests, diagnostics).
    pub fn len(&self) -> usize {
        self.lock().slots.len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
