# VARIANT-ATLAS — every sub-$1 pair-accumulation variant, era by era

W0 deliverable (session 7, 2026-07-17). Method: on-chain OrderFilled
scans of 9 sample days (the 15th of each month, 2025-11 → 2026-07), 12
of 96 fifteen-minute windows per day (×8 to estimate day totals), all 3
exchange contracts, both fill directions (A25: /trades is taker-only so
this HAD to be on-chain; A29: the 2026 exchange changed the event
layout — days ≥Apr re-scanned after the fix). Classifier:
scripts/atlas-classify.ts; raw per-wallet tables:
data/variant-scan/scan-<day>.json + atlas-summary.json (gitignored).

Clusters (per wallet-day, crypto up/down books only, ≥50 fills & ≥$1k):

- **parity-edge** — BUY-only, pairRate ≥0.7, pair cost <$1.00 (the
  gabagool recipe proper)
- **parity-farmer** — same shape, pair cost ≥$1.00 (subsidy loop)
- **cheap-side** — BUY-only, pairRate 0.15–0.7, pair cost <$1.00
  (b55f-style tail harvesting)
- **two-way-mm** — sells intra-window (classic MM / sell-exit; adjacent
  competitors, not the class)
- buy-directional / other-buyer — not the class (punters, hedgers, misc)

## 1. The population history (the headline table)

Sampled-day totals; ×8 ≈ full-day notional. "n" = wallets.

| day | era | parity-edge | parity-farmer | cheap-side | two-way-mm |
|---|---|---|---|---|---|
| 2025-11-15 | zero-fee, early | 7 n / $78k | 1 / $1k | 9 / $124k | 39 / $276k |
| 2025-12-15 | zero-fee, golden | 22 / $307k | 9 / $36k | 22 / $463k | 121 / $966k |
| 2026-01-15 | 15m-crypto fees (Jan 6) + rebates | 26 / $327k | **27 / $156k** | 32 / $392k | 160 / $1.21M |
| 2026-02-15 | clone wave peak | **94 / $1.01M** | 24 / $132k | 66 / $282k | **319 / $2.05M** |
| 2026-03-15 | all-crypto fees (Mar 6) | 83 / $1.45M | 40 / $471k | 72 / $415k | 222 / $1.25M |
| 2026-04-15 | fee-curve reshape era | 66 / $687k | 33 / $429k | 83 / $545k | 166 / $965k |
| 2026-05-15 | pre-tier lull | 69 / $568k | 42 / $343k | 95 / $557k | 120 / $550k |
| 2026-06-15 | taker-rebate tiers (May 28) | 64 / $621k | 25 / $222k | 72 / $290k | 105 / $516k |
| 2026-07-15 | current | 46 / $607k | 19 / $249k | 82 / $423k | 94 / $516k |

What the table says:

1. **The class never died.** Parity-edge went 7 → 94 (Feb peak) → ~50–70
   today; its notional is HIGHER today ($607k sampled) than in the
   golden era ($307k). Fees compressed margins, not participation.
2. **Farmers are a fee-era species.** Parity-farmer jumps 9 → 27
   exactly when fees+rebates arrive (Dec→Jan) and tracks the rebate
   program's generosity thereafter. Nobody quoted above $1 pair cost
   at scale when there was no subsidy to farm.
3. **Classic two-way MM is in secular decline** (319 → 94 since Feb):
   selling intra-window loses to BUY-only + merge/redeem exits in this
   fee regime (taker-sell pays the curve; merge is free). The class is
   EATING the traditional MM population on these books.
4. **Cheap-side is the most stable cluster** (~9 → ~82–95 wallets,
   notional steady $0.3–0.6M) — the venue's fee curve favors it
   (A28: ~2× rebate per dollar) and its deep entries dodge the
   adverse-selection tax.
5. Wallet counts overstate crowding: every era's notional is
   concentrated in the top 3–8 wallets per cluster (power law
   throughout).

## 2. Era narrative — which variant won when, and what killed whom

- **Oct 2025 (prehistory):** livebreathevolatility (A31) starts
  2025-10-12 — BUY-only merge-mix accumulation BEFORE gabagool22's
  first fill (Oct 29). The class has no single inventor we can name.
- **Nov–Dec 2025 (zero-fee golden era):** a small club prints real
  trading money. Two btc-15m depth niches coexist: gabagool22 at
  0.98 pairs / high completion, livebreathevolatility at 0.96 pairs /
  0.90 completion. Cheap-side wallets (0x52483137, 0x589222a5) run
  $75–132k sampled days at 0.84–0.85 pair costs.
- **Jan 6 2026 — 15m-crypto taker fees + 20% maker rebates:** pair
  costs compress ~1c within a week (A15); the farmer cluster is BORN
  (27 wallets by Jan 15). The archetype adapts for 6 weeks then quits
  (Feb 20, end-state = rebate farming, A5/A15).
- **Feb 2026 — the clone wave:** parity-edge peaks at 94 wallets /
  $1M sampled. Everyone read the same blog posts. gabagool22 still
  #1 ($177k sampled day, now btc-5m-first).
- **Mar 6 2026 — all-crypto fees + curve reshape:** the wave thins
  (94→66 by Apr). livebreathevolatility scales to $734k/day THROUGH
  this, then quits at peak Apr 11 — the professionals' pattern is
  "walk away at scale, don't bleed" (n=2). The two strongest CURRENT
  wallets (b27bc932, 0x04b6d7e9) are both born 2026-03-25, i.e. the
  fee-native era produced its own natives.
- **May 28 2026 — taker-rebate tiers:** incumbents get up to 50% of
  taker fees back; cold-starters get 3%. Taker-heavy completion
  becomes an incumbent moat (A16); maker-pure variants (0x04b6d7e9)
  and cheap-side (b55f) are tier-insensitive.
- **Jul 2026 (now):** three PROFITABLE postures coexist (see §3);
  farmers churn below them; two-way MM keeps shrinking. The 7-bot
  "equilibrium" Phase 1 described is really ~46 parity wallets + 82
  cheap-side wallets, with income concentrated in <10.

## 3. The design-axes map (who occupies which corner today)

Axes: entry depth (touch / deep) × completion (maker-patient /
taker-aggressive) × pair-cost target × exit (merge / redeem) × subsidy
posture.

| variant (exemplar) | pair target | completion | maker share | exit | income mix | status |
|---|---|---|---|---|---|---|
| **deep-pair patient** (0x04b6d7e9, A30) | 0.96–0.98, pairRate ~0.78 | maker-patient | 0.9–1.0 | redeem only | ~36% trading / 64% rebates, +$2.75k/day | **strongest living** |
| **cheap-side tail** (b55f, A16) | ~0.99 completed, entries 0.02–0.15 | taker-aggressive (62%) | ~0.38 | redeem | mostly trading (+2.31%T) + tier rebates | strong, tier-moated |
| **parity grinder at scale** (b27bc932, A24/A27) | 0.993–0.999, pairRate 0.95 | 50% taker | ~0.5–0.9 | redeem + merge module (toggled) | ~breakeven trading + $3.2k/day rebates | prints on subsidy |
| **big-clip farmer** (powerwinner, 0xaaaaa) | 1.03–1.15 | taker-heavy | ~0 | redeem | fee-negative trading, lives on 50% taker tier | incumbent-only |
| **golden-era archetype** (gabagool22) | 0.98, pairRate 0.97 | maker-biased + taker completion | ~0.7 | merge era → redeem era | trading (zero-fee) | DEAD (fees) |
| **golden-era deep** (livebreathevolatility, A31) | 0.96, pairRate 0.90 | maker 0.8+ | 0.8–0.96 | merge era → redeem era | trading | DEAD (quit at peak) |
| classic two-way MM | n/a (sells) | both | ~0.4 | sell | spread | shrinking 3× since Feb |

Cross-cutting facts:
- **Exit style is a hot-swappable module** (n=3 wallets toggled it:
  A27, A31, gabagool22's Dec→Feb shift). Not identity, a parameter.
- **Clip sizes are universal**: p50 $2–8 for every serious variant in
  every era (only farmers and punters run $20+ clips). L1-depth-sized
  clips are a class constant.
- **btc-5m is where the volume is; btc-15m is where the margins are**
  (A16 fee audit: b55f +2.31% on 15m vs −1.98% on 5m; every current
  top wallet is 5m-first by notional but the 15m sleeves are the
  profitable ones). The lab's btc-15m scope attacks the RIGHT book.

## 4. Candidates not yet dossiered (ranked residue for future units)

| wallet | seen | profile | why interesting |
|---|---|---|---|
| `0x76d4d470…` | Apr→Jul, top-5 edge/farmer | pure maker 1.00, 264 mkts/day, pair 0.75–0.81 @ 0.98–1.01 | maker-pure at breadth; straddles edge/farmer line |
| `0x13e0d447…` | Jul 15 #3 edge | maker 1.00, 0.89@0.984, $43k sampled | new entrant printing NOW, cold-start era |
| `0xe114e5ca…` | Jul 15 edge | maker 0.98, 0.95@0.968 | deep-pair second specimen |
| `0x2d8b401d…` | Dec cheap → Feb/Mar edge ($134k) → Apr farmer | drifted every era | one wallet crossing three variants — regime-adaptation case study |
| `0xa45fe11d…` | Mar 15 #1 edge ($146k) | 0.97@0.990, 120 mkts | Feb-wave survivor at scale; still alive? |
| `0x961afce6` / `0x93c22116` | Jan cheap-side $153k/$134k | 0.57–0.58 @ 0.96–0.99 | fee-transition cheap-side winners |
| `0x589222a5` / `0x52483137` | Nov–Dec cheap-side $75–132k | 0.42 @ 0.84–0.85 | golden-era deep-discount originals |

## 5. What the atlas changes for the lab (fold-downs done)

1. **Deep-pair cell added to seed 1** (A30/A31; BRIEF §4, LAB-HANDOFF
   addendum): pair-cost target ≤0.98, patient/maker completion, ~20%
   unpaired tolerated — TWO existence proofs (one historical at
   +$386k, one live at +$473k).
2. **H6 upgraded to a U-shape prediction**: winners sit at both ends
   of completion aggressiveness; the middle is breakeven-plus-subsidy.
3. **No large-loss casualty exists in the class** (A26) — entry risk
   is slow bleed or margin compression, not blow-up.
4. **The class is eating classic MM** on these books — competitive
   dynamics favor BUY-only accumulation structurally (fee curve +
   free merges + redemption).
5. Farmer variants are not seedable cold-start (A28); subsidy-aware
   REPORTING (separate rebate line) is mandatory in every sweep.

## Sampling caveats

One day per month, 12/96 windows: day-of-month and window-of-day
effects unmeasured; wallet counts are lower bounds (a wallet quiet in
sampled windows is missed); ×8 notional extrapolation assumes uniform
window intensity (crypto flow is lumpy — treat totals as ±30%).
Cluster thresholds are sharp lines over continuous behavior; wallets
near boundaries (b27bc932 at 0.999 pairs) flip clusters between days —
read trajectories, not single-day labels.
