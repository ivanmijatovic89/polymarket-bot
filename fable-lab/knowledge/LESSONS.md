# LESSONS — transferable knowledge

Rules: one lesson per entry, mechanism-level (never parameter-level), each
citing the experiment ids (and run/batch uids) that ground it. A lesson
without an experiment citation is an opinion and gets deleted. Update an
existing lesson rather than adding a near-duplicate; delete lessons that
later evidence overturns (note the overturn in the entry that replaces them).

_No experiments have run yet. This file starts empty by design — the charter
forbids importing the old system's research conclusions._

## Engine lessons (from the Phase 0 study, not from runs)

- **E1 — The books are the only market signal.** No price-to-beat, no trade
  stream, no external prices exist in telonex-delta replay; strategies
  condition on order-book state and the episode clock alone
  (engine/CAPABILITIES.md §1). Ideas requiring the strike are dead on
  arrival unless reformulated in market-implied terms.
- **E2 — Maker PnL is the simulator's soft spot.** Full-remaining-size fills
  on touch-through, no market impact (CAPABILITIES §4). Taker-only
  strategies sit on the pessimistic side of the sim's biases and therefore
  produce the most trustworthy backtest evidence.
- **E4 — Never emit `merge_positions` in a backtest strategy.** Merging
  mid-episode erases both legs without booking the $1/pair credit; only
  pairs still held at episode end are valued (CAPABILITIES §4). Buy-both /
  split-based ideas must hold pairs to settlement or sell legs explicitly.
- **E5 — Gate on `fill` events, not order status.** Resting maker fills
  emit no `ws_order_update` in the simulator, and MINED never appears;
  status-gated logic silently misses maker fills (CAPABILITIES §4).
- **E3 — Fee shape favors extreme prices.** Taker fee = bps·min(p,1−p)·size,
  so trading near p=0.5 pays ~4-9× more fee per share than near p=0.95
  (CAPABILITIES §4). Mechanisms at extreme prices clear a lower cost bar.
