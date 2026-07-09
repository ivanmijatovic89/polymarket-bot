# Cross-family lessons

Append-only, protocol-level memory: lessons that generalize BEYOND the family
where they were learned. This is the compounding asset of the whole protocol —
per-family lessons live in each family's Research log; only the transferable
distillations get promoted here.

Rules:

- **Writers:** the Researcher, whenever a Research-log lesson generalizes
  (mandatory check at every kill and every validation); the user, anytime.
- **Readers (required):** ProposeFamily before proposing; the Researcher
  before speccing a new experiment.
- **Append-only.** Entries are never edited or deleted. If a lesson is later
  overturned, append a new entry that supersedes it and links back.
- **Format:** one `### <kebab-title> — YYYY-MM-DD` per lesson. Body: the
  lesson with its numbers, then `From:` linking the originating family. Keep
  entries dense — several sentences with the numbers that prove them, not
  one-liners.
- **Ban promotion:** while writing an entry, ask "is this a permanent
  constraint on future proposals?" If yes, also add one line to
  [`strategy-research-protocol/CONSTRAINTS.md`](./CONSTRAINTS.md).

## Lessons

### verify-a-new-filter-actually-binds — 2026-07-05

A new selection filter only carries information if its threshold actually
removes markets on the data; a threshold that never binds produces a screen
byte-identical to the unfiltered variant and silently re-runs a known result.
In `maker-favorite` `010-tight-spread`, adding `maxFavSpread` and sweeping it
(0.04/0.06/0.08) tied all three cells exactly at +0.22 net EV/mkt, 627 trades,
68.26% win — the tightest 0.04 bar removed zero markets because favorite touch
books in that mid-window are always tighter than 4 cents. The "passing" gate-1 cell
was thus a duplicate of an earlier screen (`006-cancel-weakening`) already
known to fail confirm at 3000 markets (-0.18), so no stage-2 extension was
warranted. Before trusting a filter's screen, confirm markets-played /
trade-count dropped versus the unfiltered baseline; if participation is
unchanged, the filter is inert regardless of its EV.
From: maker-favorite.

### one-shot-take-profit-can-add-churn-without-removing-tail-loss — 2026-07-05

A maker take-profit exit does not automatically reduce directional inventory
risk; if it only realizes many small wins while leaving occasional unresolved
positions to settle badly, it can worsen market-level EV despite a high win
rate. In `maker-favorite` `012-cancel-take-profit`, adding a one-shot maker sell
above entry to the best cancel-weakening favorite entry failed every stage-1
cell: takeProfit 0.06 was least bad at -1.08 net EV/mkt over 1000 markets, 627
markets played, 1162 trades, 1157 maker fills, 5 taker fills, and 85.65% win
rate; 0.02/0.08/0.04 were -1.15/-1.16/-1.20. The lifecycle roughly doubled
trade count versus hold/cancel variants and converted frequent small realized
wins into occasional large residual losses. Treat high win rate on flattening
sells as a payoff-shape warning, not as edge, unless market-level net EV improves.
From: maker-favorite.

### persistent-book-pressure-selects-longshots-not-informed-flow — 2026-07-09

Requiring a book-shape signal to hold continuously before acting does not
purify it — it inverts the selection: pressure that persists is pressure
nobody arbitrages, and on BTC 15m up/down books that is the structural
geometry of a cheap losing leg, not an informed footprint. In
`imbalance-hold` `001-persistence-filter`, requiring the top-level
bid-depth differential (|imb| >= 0.1) to hold 5/15/30/60 seconds bound hard
(878 → 493 → 163 → 35 of 1000 markets played) and killed the edge in a
diagnostic way: net EV/mkt -0.07/-0.09/-0.02/+0.00 while win rate collapsed
to ≈ the entry price (49.66% → 21.7% → 10.43% → 11.43%) and average loss
shrank toward -$1 (avgLose -8.60 → -2.75 → -1.22 → -1.05, i.e. ~5-14¢
entries) — the surviving trades were fairly-priced longshots, EV ≈ 0 before
fees. Two transferable reads: (a) when a binding filter's survivors show
win% tracking entry price with shrinking losses, the filter selects a PRICE
REGIME, not signal quality — check the payoff shape before crediting any
binding filter; (b) for microstructure signals, persistence duration is an
arbitrage-speed probe: competitive legs reprice in seconds, so requiring
long persistence deterministically routes entries into the uncompetitive
(longshot) corner of the book.
From: imbalance-hold.

### an-isolated-entry-timing-spike-is-a-regime-artifact-not-a-signal — 2026-07-09

A stage-1 screen can be carried entirely by WHEN the strategy enters rather
than by its stated signal, and the tell is visible before spending a stage-2
extension: sweep the entry-time knob and read the response shape. In
`imbalance-hold` `000-baseline`, the signal threshold barely bound
(879→858/1000 markets played across the whole `minImbalance` 0.1→0.4 sweep),
so the strategy degenerated to "at T seconds, taker-buy the bid-supported
leg" — and the `startSec` response was an isolated spike, not a plateau:
0 → -0.63, 30 → +0.52, 45 → -0.11, 60 → +0.51 (the screen's best cell,
55.24% win on 878 markets), 90 → +0.17, 120 → -0.13, 180 → -0.17,
420 → -0.65. The stage-2 extension of the +0.51 cell to 3000 markets
collapsed to -0.22 net and -0.10 GROSS, with every pre-June week negative
(W20-W23: -0.41/-0.65/-0.10/-0.29) and the whole stage-1 edge confined to
one week (W24 +0.33). Two transferable checks: (a) a barely-binding signal
threshold (participation flat across its sweep) means the experiment is no
longer testing its stated driver — whatever EV appears belongs to timing and
regime; (b) an entry-time response that oscillates between adjacent values
under refinement (+0.52 / -0.11 / +0.51 fifteen seconds apart) is
sampling-window noise, and extend-to-confirm will erase it. Treat
time-stability of the entry trigger as a mandatory screen check alongside
parameter-plateau stability.
From: imbalance-hold.

### the-newest-market-files-can-be-recorder-dead-tail — 2026-07-09

The ~39 newest markets in the BTC 15m telonex dataset (everything after
`btc-updown-15m-1781394300`, June 13-14 2026) contain only pre-window book
snapshots — recording stopped before their episode windows — so no strategy
ever receives an in-window tick there: they replay as
`no_in_window_activity`, add 0 to PnL and +39 to every latest-N denominator
(pure EV dilution, identical for all families, never a sign flip). Two
practical consequences: (a) a smoke test using `--latest --limit 10` lands
ENTIRELY on dead markets and reports 0 trades, which looks exactly like
broken strategy code — smoke on a window known to have activity (e.g.
`--to-ms 1781394300000`) before debugging the strategy; (b) eligibility
checks (`telonexEligibility.ts`) gate on conversion status and resolution,
not on in-window event presence, so dead-tail markets are "eligible" and
will silently ride along in any latest-N selection until newer data is
recorded.
From: imbalance-hold.

### a-binding-filter-that-peaks-at-its-loosest-setting-is-not-the-driver — 2026-07-05

A new gate genuinely removing markets is necessary but not sufficient evidence
that the gate earns the edge. Read the shape of the screen response across the
sweep: if EV is non-monotonic and peaks at the loosest, barely-binding setting,
the edge is inherited from the base config and tightening the gate only sheds
participation -- the gate is not the driver. In `maker-favorite`
`011-book-imbalance`, a favorite-book depth-imbalance gate (`minFavBidRatio`
over the top 3 cumulative levels, motivated by the cross-family finding that
ask-heavy favorite books are ~2.5 cents overpriced) DID bind -- trades fell
410->348->290->229 as the gate tightened -- yet net EV/mkt ran 0.18/0.05/0.03/0.09,
best at the loosest 0.45 gate and non-monotonic. A well-motivated,
correctly-binding filter that is wrong-signed or off-target looks exactly like
this. Distinguish "filter did nothing" (inert, ties the unfiltered screen; see
`verify-a-new-filter-actually-binds`) from "filter did something but not the
intended thing" (binds, but EV peaks where it barely binds) -- the second still
means attribute the EV to the base config and expect confirm to track the base
variant.
From: maker-favorite.
