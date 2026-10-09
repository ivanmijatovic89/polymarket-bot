//! Deterministic collections (30 §11): the replacement for
//! `std::collections::{HashMap, HashSet}` with `RandomState`, whose
//! iteration order changes from run to run.
//!
//! - [`Map`], [`Set`]: ordered (`BTreeMap`, `BTreeSet`); iteration is
//!   sorted by key. Use them whenever iteration order can reach a decision.
//! - [`DetHashMap`], [`DetHashSet`]: hash tables with a fixed hasher
//!   (10 D-1); identical insert sequences iterate in identical order in
//!   every run of a binary, on every machine of the canonical target
//!   (aarch64-apple-darwin, pinned toolchain, 31 §4; golden-tested). The
//!   order is arbitrary, not sorted, and can differ on another target or
//!   toolchain: prefer them for lookups, and use [`Map`]/[`Set`] wherever
//!   iteration order reaches a decision or an output.

pub use std::collections::{BTreeMap as Map, BTreeSet as Set};

/// `HashMap` with the engine's fixed hasher. Build with
/// `DetHashMap::default()`.
pub type DetHashMap<K, V> = std::collections::HashMap<K, V, pmb_core::ids::FixedState>;

/// `HashSet` with the engine's fixed hasher. Build with
/// `DetHashSet::default()`.
pub type DetHashSet<T> = std::collections::HashSet<T, pmb_core::ids::FixedState>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::hash::BuildHasher;

    fn build() -> Vec<String> {
        let mut m: DetHashMap<String, u32> = DetHashMap::default();
        for i in 0..64u32 {
            m.insert(format!("cid-{i}"), i);
        }
        m.remove("cid-7");
        m.keys().cloned().collect()
    }

    // spec: 30 §11 (deterministic iteration for identical insert sequences)
    #[test]
    fn fixed_hasher_iteration_is_reproducible() {
        assert_eq!(build(), build());
        let mut s: DetHashSet<u64> = DetHashSet::default();
        s.extend([3, 1, 2]);
        assert_eq!(s.len(), 3);
        let m: Map<&str, i32> = [("b", 2), ("a", 1)].into_iter().collect();
        assert_eq!(m.keys().copied().collect::<Vec<_>>(), ["a", "b"]);
        let set: Set<i32> = [3, 1, 2].into_iter().collect();
        assert_eq!(set.into_iter().collect::<Vec<_>>(), [1, 2, 3]);
    }

    // spec: 30 §11, 10 D-1: the fixed hash of a key is a golden on every
    // target, so a change of the hasher or of how keys are fed to it fails
    // here before it can change lookups or iteration between builds.
    #[test]
    fn fixed_hash_golden() {
        let state = pmb_core::ids::FixedState::default();
        let h = state.hash_one("cid-1");
        assert_eq!(h, 0x7c9a_ce33_acae_cc76, "{h:#x}");
    }

    // spec: 30 §11, 31 §4: the iteration order is a golden for the
    // canonical target (aarch64-apple-darwin, pinned toolchain). The table
    // layout depends on the target's probe group width, so another target
    // may iterate in another (equally reproducible) order.
    #[cfg(target_arch = "aarch64")]
    #[test]
    fn iteration_order_golden() {
        let keys = build();
        let first: Vec<&str> = keys.iter().take(8).map(String::as_str).collect();
        assert_eq!(
            first,
            ["cid-23", "cid-32", "cid-6", "cid-41", "cid-2", "cid-16", "cid-35", "cid-20"],
            "{first:?}"
        );
        let mut small: DetHashSet<u32> = DetHashSet::default();
        small.extend([5, 1, 9, 3, 7]);
        let order: Vec<u32> = small.iter().copied().collect();
        assert_eq!(order, [5, 7, 1, 9, 3], "{order:?}");
    }
}
