//! Outcomes and outcome-indexed storage (10-domain-model.md §5 M1).

use std::ops::{Index, IndexMut};

/// Binary market outcome. Gamma index 0 is UP (10 M2).
#[repr(u8)]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Outcome {
    Up = 0,
    Down = 1,
}

impl Outcome {
    pub const ALL: [Outcome; 2] = [Outcome::Up, Outcome::Down];

    #[inline]
    pub const fn index(self) -> usize {
        self as usize
    }

    #[inline]
    pub const fn other(self) -> Outcome {
        match self {
            Outcome::Up => Outcome::Down,
            Outcome::Down => Outcome::Up,
        }
    }

    #[inline]
    pub const fn from_index(i: usize) -> Option<Outcome> {
        match i {
            0 => Some(Outcome::Up),
            1 => Some(Outcome::Down),
            _ => None,
        }
    }

    /// TS-shape label used at I/O boundaries (`UP` / `DOWN`).
    #[inline]
    pub const fn label(self) -> &'static str {
        match self {
            Outcome::Up => "UP",
            Outcome::Down => "DOWN",
        }
    }
}

/// Per-outcome storage `[T; 2]` indexed by [`Outcome`] (10 M1).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Default)]
pub struct PerOutcome<T>(pub [T; 2]);

impl<T> PerOutcome<T> {
    #[inline]
    pub const fn new(up: T, down: T) -> Self {
        PerOutcome([up, down])
    }

    #[inline]
    pub fn iter(&self) -> impl Iterator<Item = (Outcome, &T)> {
        Outcome::ALL.into_iter().zip(self.0.iter())
    }
}

impl<T> Index<Outcome> for PerOutcome<T> {
    type Output = T;
    #[inline]
    fn index(&self, o: Outcome) -> &T {
        &self.0[o.index()]
    }
}

impl<T> IndexMut<Outcome> for PerOutcome<T> {
    #[inline]
    fn index_mut(&mut self, o: Outcome) -> &mut T {
        &mut self.0[o.index()]
    }
}
