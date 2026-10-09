//! `Ctx` (30 §5, 12 §6.5): a stack value of borrows into session and shared
//! state, built once per callback. Every accessor is infallible and O(1)
//! unless stated; reading never allocates or copies (12 §6.1).

use pmb_core::{DurMs, MarketInfo, Outcome, PerOutcome, TsMs};

use super::views::{BookView, PortfolioView, RulesView, TickInfo};
use crate::feeds_view::FeedsView;
use crate::plugins_view::PluginsView;

/// The callback context (30 §5).
#[derive(Copy, Clone, Debug)]
pub struct Ctx<'a> {
    pub(crate) now: TsMs,
    pub(crate) tick: &'a TickInfo,
    pub(crate) event_clock: TsMs,
    pub(crate) market: &'a MarketInfo,
    pub(crate) books: PerOutcome<BookView<'a>>,
    pub(crate) portfolio: PortfolioView<'a>,
    pub(crate) feeds: &'a FeedsView,
    pub(crate) plugins: &'a PluginsView,
    pub(crate) rules: &'a RulesView,
}

impl<'a> Ctx<'a> {
    /// Builds a context (engine only; `pmb-sdk` does not re-export it).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        now: TsMs,
        tick: &'a TickInfo,
        event_clock: TsMs,
        market: &'a MarketInfo,
        books: PerOutcome<BookView<'a>>,
        portfolio: PortfolioView<'a>,
        feeds: &'a FeedsView,
        plugins: &'a PluginsView,
        rules: &'a RulesView,
    ) -> Ctx<'a> {
        Ctx {
            now,
            tick,
            event_clock,
            market,
            books,
            portfolio,
            feeds,
            plugins,
            rules,
        }
    }

    /// `tick.ts` of 12 §4.2; inside `on_event` the decision stamp (30 §5,
    /// §5.0: monotone in realistic, may step back in ts-compat).
    #[inline]
    pub fn now(&self) -> TsMs {
        self.now
    }

    /// The current tick; inside `on_event` the last dispatched strategy tick
    /// (30 §5, 12 §6.5).
    #[inline]
    pub fn tick(&self) -> &'a TickInfo {
        self.tick
    }

    /// TS `PortfolioSnapshot.nowMs` semantics, for ports only (30 §5,
    /// 12 §4.2).
    #[inline]
    pub fn event_clock(&self) -> TsMs {
        self.event_clock
    }

    /// Market identity and window (30 §5, 10 §5).
    #[inline]
    pub fn market(&self) -> &'a MarketInfo {
        self.market
    }

    /// Book of one outcome per input and profile (30 §5.1, 12 §6.5).
    #[inline]
    pub fn book(&self, o: Outcome) -> &BookView<'a> {
        &self.books[o]
    }

    /// This candidate's positions, capital and orders (30 §5.2).
    #[inline]
    pub fn portfolio(&self) -> &PortfolioView<'a> {
        &self.portfolio
    }

    /// Latest visible value of each requested feed (30 §5, 14).
    #[inline]
    pub fn feeds(&self) -> &'a FeedsView {
        self.feeds
    }

    /// Tick-scoped plugin snapshot (30 §5, 12 §6.4).
    #[inline]
    pub fn plugins(&self) -> &'a PluginsView {
        self.plugins
    }

    /// Exchange rules in force (30 §5, 11).
    #[inline]
    pub fn rules(&self) -> &'a RulesView {
        self.rules
    }

    /// `now() + gtd_early_expiry + lifetime` (30 §5, 10 §7.4 GD3).
    pub fn gtd_expiration(&self, lifetime: DurMs) -> TsMs {
        self.now + self.rules.gtd_early_expiry() + lifetime
    }

    /// Always `true` (30 §5, 12 §6.5).
    #[inline]
    pub fn warmed(&self) -> bool {
        true
    }
}
