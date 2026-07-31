# Family: pair-v10 (taker-completion module on v1) — E-020

Axes 2+3 of the human ruling (inbox 8758567d): opportunistic cheap-side
completion decoupled from the entry gate, and loss-mitigating completion
above $1. Both attack the SAME identity term the v1 family leaves on the
table — the stranded side (L_s ≈ $0.44/share measured in v1) — and they
share machinery, so one family tests both.

**Why the v1 base and not v9/X=0.15**: the module's value is proportional
to what stranding costs. v9 at X=0.15 already bounds L_s at $0.146 and its
residue loses $1.46/market; v1-a loses ≈ $4.4 per doomed market — the
target the ruling was analyzing. (v9's own openings — low X, duty cycle —
are E-021, pre-registered in pair-v9.md.)

## The unified rule

Both axes are the same FOK taker rule at different thresholds. Let h =
avg cost/share of the surplus ("held") side, ask = bestAsk of the deficit
side, fee = 0.07·ask·(1−ask) (taker, 700 bps engine model):

- **Axis 2 — profit lock (`completeCapTotal` C, 0=off)**: when
  imbalanced and `h + ask + fee ≤ C` (C < 1), FOK BUY the deficit side at
  `ask`, size = the full imbalance. Locks margin ≥ 1 − C per pair. Fires
  structurally only after the held side has RISEN (at entry the book sums
  to ≈ 1.02, so h + ask starts above 1) — exactly the hover paths where
  v1's worst-queue maker rest never fills and the market can re-collapse.
- **Axis 3 — doom salvage (`doomBid` D, 0=off)**: when imbalanced and
  `bestBid(held) ≤ D` and `ask + fee ≤ 0.99`, FOK BUY the deficit side at
  `ask`. Derivation: completing at total τ = h + ask + fee loses τ − 1;
  holding a truly doomed side loses h; completion strictly beats certain
  doom iff ask + fee < 1 (the save is 1 − ask − fee per share, ≥ 1¢
  enforced). It loses EV when the held side would have recovered — E-012
  showed doom is unpredictable from START-time state, but heldBid ≤ D is
  a LATE-state signal; different claim, untested. The v9 result's 0/272
  residue wins is survivorship and is NOT usable as a prior here
  (pair-v9.md §Result).

## Design (delta from pair.v1)

`pair-fable-v10` = pair.v1 verbatim plus the module:

1. Params (guard-2 budget, 5 of 6 slots): `incrementSize` (10),
   `capPerMarket` (50), `maxPairCost` (0.98), `completeCapTotal` (C,
   0=off), `doomBid` (D, 0=off). Demoted to design constants (never swept
   in-family; v1 defaults): ttlSec=90, cooldownTicks=25, maxImbalance=20.
2. Completion FOK: limit price = current bestAsk (arrival 140 ms later:
   book moved against ⇒ FOK killed, natural latency protection; fills
   at-or-better otherwise), size = current imbalance, `capPerMarket`
   still enforced, GTD/maker machinery untouched.
3. One-open-order state machine kept: when the trigger fires while a
   maker rest is open, emit cancel + FOK in the same tick. Known bounded
   confounder: the canceled rest can still fill during cancel latency ⇒
   a transient over-complete bounded by maxImbalance; and a killed FOK
   re-enters the 25-tick cooldown before retry (accepted for simplicity —
   note if it shows up in fills).

## Pre-registered experiment (written BEFORE strategy code)

- **Grid** (7 configs, all at maxPairCost=0.98 = v1-a base, everything
  else family defaults):
  1. C=0, D=0 — code-path regression control vs run 872
  2. C=0.90  3. C=0.95  4. C=0.99 (near-any-profit completion)
  5. D=0.05  6. D=0.10
  7. C=0.95, D=0.10 (joint)
- **Universe**: pinned 800-market screen window `--from-ms 1784043000000
  --to-ms 1784762100000` (runs 872/873/879/889–895). **Latency**: 140/20
  flag-pinned. Whole grid up front (inbox c841c329).
- **Readouts**: results.ts headline; compare.ts vs 872 (and control);
  anatomy.ts identity terms (pairs vs residue, completions, dooms,
  realized L_s) per config; per-day breakdown; FOK kill counts if
  visible in fills.

## Pre-registered priors (honest)

Axis 2: each C-completion converts an unpaired hover into a locked
margin ≥ 1−C, but also CANNIBALIZES some maker completions that would
have locked more (v1 repair at bestBid fills on continued moves) and
each completion re-opens starts (re-exposure). Net sign genuinely
unknown; frequency of `h + ask + fee ≤ C` passages unknown — that is the
measurement. Axis 3: pays spread+fee to cap the tail; +EV only if the
held-side bid at trigger time overstates recovery probability;
E-012's inverted-selection result warns against assuming that.

## Pre-registered verdicts

- **Regression gate first**: config 1 must reproduce run 872 within
  noise (|Δev| ≤ 0.05 on the common 800, played count ±2). FAIL ⇒ stop,
  fix, resubmit; other configs uninterpretable.
- **PROMOTE to S2**: any config evPerMarketTotal ≥ +$0.25 (800 denom)
  AND positive on ≥6/9 days.
- **ITERATE**: any config 2×SE(800) < ev < $0.25 → explore neighborhood
  (finer C/D, interaction with gate level).
- **WEAK**: best config in (0, 2×SE].
- **KILL module on v1 base** (time-scoped 2026-07, this universe): every
  C/D config within +0.05 of control (no add) or below it. Scope: kills
  the module ON THIS BASE; axes 2+3 at other bases (e.g. v9 low-X after
  E-021) need their own test or an identity argument (§Kill standards).
- Confounders pre-committed: (a) per-config completion counts + margins
  reported (a module that never fires is UNTESTED, not killed — check
  trigger frequency before reading the ev delta); (b) per-day breakdown;
  (c) cancel-race double-fills counted if present; (d) worst-queue
  understates maker fills ⇒ the C-module's cannibalization is overstated
  in backtest (guard 6 — safe for a kill of the module, noted for
  promotion reads).

design-ts: (this commit, 2026-07-31 session 9 — BEFORE pair.v10.ts exists)
