# Literature note A2 — queue-position value & subsidized market making

Session 1. Companion to A1; anchored to this shift's measurements.

## Queue position value (Moallemi–Yuan and practice)

- On price-time-priority books, the value of a resting order is largely
  its QUEUE POSITION: front-of-queue fills capture uninformed arrivals;
  back-of-queue fills concentrate in sweeps (informed). The engine's
  worst_queue = "infinitely back of queue" (only sweeps fill you);
  touch_or_better = "always front". D2 measured the archetype living in
  between: ~44–49% of his fills were sweep-visible, the rest were
  queue-position fills the sim cannot see.
- Practical consequence measured elsewhere on cent-tick books: at 1c
  ticks and small clips, queue TIME (how early you post at a level)
  dominates price improvement — consistent with the archetype's standing
  1–4c ladders (post early, wait) over chase-the-mid repricing, and with
  his burst-refill cadence after sweeps (re-post immediately to regain
  queue).
- Implication for BTC-15m: the buildable lever the sim CAN honestly
  rank is ladder depth/refresh discipline under worst_queue (a lower
  bound); queue-time effects need the Telonex `trades` channel (G2) or
  live paper.

## Maker/taker subsidy economics (exchange rebate literature & crypto practice)

- Maker-taker pricing theory (Colliard–Foucault; Malinova–Park): rebates
  shift the QUOTED spread but, absent frictions, the CUM-FEE spread is
  invariant — subsidies mostly transfer to whoever is fastest/most
  disciplined at capturing the rebate. Empirically (equities, crypto):
  rebate programs spawn rebate-specialist participants whose gross
  trading PnL is ≈ 0 or negative and whose net income is the subsidy —
  exactly what this shift measured live (powerwinner/doggystyie/0xaaaaa:
  trading −0.07% to −0.76% of turnover, taker rebates flipping them
  positive; measurements/actives-decomposition.md).
- Two regularities from that literature that transfer:
  1. **Subsidy income concentrates where weighted volume per dollar is
     maximized** — here: p≈0.5 entries on the highest-weight (crypto
     2.3×), highest-frequency (5m) books. Measured: all three farmers
     trade btc-5m only, clips $35–84 at p≈0.5.
  2. **Program-parameter risk dominates strategy risk**: rebate metas
     die by fee-schedule edits, not by competition. The venue already
     re-shaped its fee curve twice in 5 months (VENUE-MECHANICS). Any
     rebate-dependent design needs a same-day kill switch on program
     changes.
- Prediction-market specific twist: because UP+DOWN is one mirrored
  book (P38), a "both-sides taker at 0.5" farmer is buying and selling
  the SAME book against itself economically — pair cost ≈ 1 + spread —
  so the farmer's trading loss per pair ≈ spread + fee(1−rebate−tier
  refund). The whole farm is an arb of the tier table against the
  spread. When tier refunds are 50% and crypto weight 2.3×, the venue
  is (knowingly or not) selling weighted volume below its spread cost
  to top tiers.

## Implications for BTC-15m implementation

1. Sim-rankable design choices: ladder depth, refresh-after-sweep,
   parity sizing. Sim-invisible: queue time, rebate income — treat both
   as live-measured add-ons with pre-declared estimators.
2. Any family whose EV story leans on rebates must carry a
   program-version stamp (like gatesVersion) and a "program changed →
   halt" rule; VENUE-MECHANICS is the watch file.
3. The rebate-farmer niche is real but is NOT the lab's target (charter:
   durable edge): it is capital-cheap, skill-cheap, and dies by a config
   push at Polymarket. Document it, don't build it. The edge-wallet
   profile (small clips, multi-book, btc-15m positive) is the target.
