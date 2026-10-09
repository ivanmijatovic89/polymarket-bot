//! Placeholder for the tick-scoped plugin snapshot (14 §12.1, 30 §5
//! `plugins()`).
//!
//! STAND-IN: the four v1 plugins and their snapshot types are being written
//! in crate `pmb-plugins` (plugins stream). Integration replaces these types;
//! the session contract stays: plugins update once per dispatched tick after
//! the tick's execution step and cascade, before the tick callback, and the
//! snapshot is fixed for every account callback until the next dispatched
//! tick (12 §6.4, 14 P-4). Each plugin carries a change generation (14 P-13).

use crate::shared::SharedMarket;
use crate::strategy::TickInfo;

/// Tick-scoped plugin snapshot (30 §5 `plugins()`). Stand-in with no
/// plugins; unrequested plugins are `None` (30 §5).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PluginsView {
    /// Change generation over all requested plugins (14 P-13).
    pub generation: u64,
}

impl PluginsView {
    /// A snapshot with no plugin values.
    pub const EMPTY: PluginsView = PluginsView { generation: 0 };
}

/// The plugin set of one session (14 P-3). Stand-in with no plugins.
#[derive(Clone, Debug, Default)]
pub struct PluginSet {
    /// The snapshot of the last dispatched tick (12 §6.4).
    pub view: PluginsView,
}

impl PluginSet {
    /// Observe a tick: real in-window ticks, synthetic ticks only for plugins
    /// that declare it (14 F-37), and pre-window ticks while Warming in
    /// realistic (14 P-5, D23).
    pub fn on_tick(&mut self, _tick: &TickInfo, _market: &SharedMarket) {}

    /// The snapshot for the current dispatched tick (12 §6.4); built once per
    /// dispatched tick and borrowed by every callback until the next one.
    pub fn snapshot(&self) -> &PluginsView {
        &self.view
    }
}
