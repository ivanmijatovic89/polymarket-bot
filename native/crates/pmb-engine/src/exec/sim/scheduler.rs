//! Discrete-event scheduler (13 §4.3): actions ordered by (time, class,
//! seq), class 0 exchange-side before class 1 `Deliver`; binary heap with
//! reused capacity; `SelfTimed` and `Journaled` modes (13 §2.3).
