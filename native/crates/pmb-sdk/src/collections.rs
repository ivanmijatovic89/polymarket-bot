//! Deterministic collections (30 §11): the replacement for
//! `std::collections::{HashMap, HashSet}` with `RandomState`, whose
//! iteration order changes from run to run.
//!
//! - [`Map`], [`Set`]: ordered (`BTreeMap`, `BTreeSet`); iteration is
//!   sorted by key. Use them whenever iteration order can reach a decision.
//! - [`DetHashMap`], [`DetHashSet`]: hash tables with a fixed hasher
//!   (10 D-1); identical insert sequences iterate in identical order on
//!   every machine. Prefer them for lookups only.

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

    // spec: 30 §11 (deterministic iteration for identical insert sequences)
    #[test]
    fn fixed_hasher_iteration_is_reproducible() {
        let build = || {
            let mut m: DetHashMap<String, u32> = DetHashMap::default();
            for i in 0..64u32 {
                m.insert(format!("cid-{i}"), i);
            }
            m.remove("cid-7");
            m.keys().cloned().collect::<Vec<_>>()
        };
        let a = build();
        assert_eq!(a, build());
        let mut s: DetHashSet<u64> = DetHashSet::default();
        s.extend([3, 1, 2]);
        assert_eq!(s.len(), 3);
        let m: Map<&str, i32> = [("b", 2), ("a", 1)].into_iter().collect();
        assert_eq!(m.keys().copied().collect::<Vec<_>>(), ["a", "b"]);
        let set: Set<i32> = [3, 1, 2].into_iter().collect();
        assert_eq!(set.into_iter().collect::<Vec<_>>(), [1, 2, 3]);
    }
}
