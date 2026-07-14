# Gabagool-Style Bot Investigation — Summary & Conclusions

_Investigation spanning ~6 sessions (Jul 13–14, 2026). Target: the gabagool-style
Polymarket "buy both sides" bot and what it implies for building our own profitable
strategy on top of this repo._

---

## TL;DR

- The opportunity is **real but smaller than it looks**: the flagship wallet made
  ~$644k all-time, but nets **~$3k/day realized recently** (down from ~$7k — the edge
  is compressing as clones arrive). The "$10–11k/day" headline is a mark-to-market
  snapshot, not bankable daily income.
- The strategy is **mechanically trivial** (buy UP+DOWN for a combined price < $1, hold
  to resolution, redeem the winner). All the money is in **execution + a fair-value model**.
- It is a **model edge, not a latency edge** — good news, because we compete on modeling
  (winnable) rather than co-location (an arms race).
- **For us specifically: ~4/10 to build, ~7/10 to make reliably profitable.** We already
  own ~70% of the hard infrastructure in this repo.
- We can measure whether an edge exists **before risking a dollar**, by backtesting a
  fair-value model in this repo's parity rig.

---

## The target and what's verified

- **@gabagool22** is a real Polymarket trader (28,620 predictions, ~745k profile views).
  Account is now empty ($0) — consistent with "he stopped" OR wallet rotation. Unknown publicly.
- **He never published anything himself.** No official repo, no verified X account. All
  public writeups are reverse-engineering of his on-chain fills.
- **Arbigab / gabagool22.com is NOT him** — an anonymous third party riding his name
  (this corrects an earlier claim that "he sells the bot"). Retracted.
- **All GitHub "gabagool bot" repos are third-party clones** (TradeSEB, Lampdevs,
  strongca22). Every one demands your `PRIVATE_KEY` in an env var → treat as
  wallet-drainer pattern. We need **nothing** from them — this repo already has every
  primitive gabagool used (WS ticks, batch orders, `split_positions`/`merge_positions`,
  fee modeling) plus ~19k markets of data.
- **Active wallet still running the game:** `0xb55f…64d4`
  - All-time profit **~$644,736** (volume ~$64.3M)
  - Last 30 days **~$83,786** (volume ~$8.9M)
  - "Yesterday" **~$5,488** (volume ~$930k)
  - Margin ≈ **0.9% of volume** — the signature of arb/market-making.
  - In our 30d 5m scan it ranks **#12, +$52,526** across 3,938 markets.

---

## How the strategy actually works (reconstructed from fills)

Verified stable across **337 markets / ~$272k turnover**:

1. **Both-sides maker.** Buys UP and DOWN whenever each side gets temporarily cheap so the
   pair costs < $1.00. Pair settles at exactly $1.00 → profit locked at purchase,
   direction-agnostic.
2. **Never merges.** 0 merges across all 337 markets analyzed. It only **redeems the
   winning leg** after resolution. (This contradicts the original "buy YES+NO then merge"
   premise — the live bot recycles via redemption, not merge.)
3. **The entire edge is one rule — sum-of-averages:**
   - Combined avg UP+DOWN entry **< $1.00** → prints (wins ~80%+ of markets).
   - Combined avg **≥ $1.00** (overpaid) → bleeds, loses ~90% of the time.
   - Every net-negative batch we saw was caused purely by overpaying more often.
4. **Per-market edge is thin and often negative.** Across 337 markets the net was
   **~breakeven (+0.07% of turnover)**. The money is thousands of repetitions across
   ~16 books (4 coins × 4 timeframes), not being right on any single market.

---

## Key corrections we made (the reconciliation)

- **The "$11k/day" is a red herring.** The leaderboard's 1d and 7d values are _identical_
  → it's a **mark-to-market snapshot of the open book**, not earnings-per-day. The real
  realized rate is the 30-day figure (**~$2,985/day**). Our independent bottom-up 16-book
  sweep reproduced **+$3,267/day** — matched within ~10%, validating the method.
- **The per-leg display trap.** A market shown in the UI as "Won +$147.93" was actually a
  **−$54 loss** once the losing leg is counted. Polymarket lists each leg separately, so a
  both-sides bettor's every market _looks_ like a fat green win. True both-legs net is thin
  and sometimes negative.
- **Monthly numbers disagree because they measure different things:** UI "Past Month"
  ~$193k (mark-to-market, includes unrealized) vs lb-api 30d ~$89.5k (realized). All-time
  (~$649k) converges across every source because unrealized washes out over time.
- **It is NOT a latency game (I was wrong; the data backed the user).**
  - Median gap between fills = **11 seconds** (mean 114s, p90 ~5 min). HFT lives in
    milliseconds. This is deliberate accumulation over ~2h per market.
  - The edge is **biggest on 1h/4h** (least latency-sensitive) and ~0 on 5m/15m — the
    exact reverse of a latency signature.
  - Conclusion: the moat is a **fair-value model + patient entry**, not speed.

---

## Where the edge lives (by timeframe / coin)

Reconstructed daily sweeps (per-market, both legs netted):

| Timeframe | Edge (% of turnover) | Notes                                                   |
| --------- | -------------------- | ------------------------------------------------------- |
| 5m        | ~0% (breakeven)      | HFT playground; ~12,000+ unique wallets/day; toxic flow |
| 15m       | ~0% / slightly neg   | 4,050 wallets/day                                       |
| **1h**    | **+1.7–3.7%**        | 1,585 wallets/day; less toxic; real edge                |
| **4h**    | **+2.4%+**           | 555 wallets/day; highest per-$ edge                     |

- The **leading book rotates day to day** (07-11 was carried by 15m; 07-13 by 1h). No
  single book is "the edge" — it's a diversified portfolio of ~16 tiny edges.
- **Alts (SOL/XRP)** showed the highest %-edge in sweeps (fewer competing bots), though
  smaller absolute size.
- Structural realities: **thin edge, capacity-limited (small markets), decaying** (we
  watched the wallet's realized rate fall ~$7k → ~$3k/day as competition arrived).

---

## Complexity rating

| Task                             | Difficulty    | Why                                              |
| -------------------------------- | ------------- | ------------------------------------------------ |
| Understand _what_ he does        | 1–2/10 (done) | Textbook binary market-making                    |
| Build a naive working bot        | 3/10          | Clones exist on GitHub                           |
| Competitive version at his scale | 7/10          | All execution engineering: leg risk, sizing, ops |
| **For us, given this repo**      | **~4/10**     | We already built the hard 80%                    |

The hard 20% that remains: the **fair-value model**, the **leg-risk policy** (one leg
fills, the other doesn't → naked directional position, the source of the −$500 markets),
and market/sizing selection.

---

## Data access (what's possible)

Full pipeline (pull all fills for all 15m markets over 90d → rank top-50 traders →
reverse-engineer each) is feasible with just two public endpoints. History goes back
6+ months (verified empirically).

| Source                            | Returns                                | Notes                                       |
| --------------------------------- | -------------------------------------- | ------------------------------------------- |
| `data-api /trades`                | fills, market-wide                     | price rounded (~1% noise), offset cap 4,000 |
| `data-api /activity`              | fills + REDEEM/SPLIT/MERGE, per-wallet | exact `usdcSize`, needs `user=`             |
| `CLOB /trades`                    | fills, maker/taker role                | auth'd, **only your own** trades            |
| on-chain `OrderFilled` / subgraph | fills, ground truth                    | exact amounts, no cap, both addresses       |

- **No source exposes placed-then-cancelled orders** — off-chain CLOB never records them.
  Only live WS recording captures order-book dynamics (aggregate per price level, not
  per wallet), from now forward only.
- **Recommended hybrid:** `/trades` for the wide scan/ranking; `/activity` for deep
  per-wallet analysis; on-chain/subgraph for exact amounts and markets over the 4,000 cap.

### Market sizing (unique wallets/day, 07-13 UTC)

| Timeframe | Markets/day | Distinct wallets/day  | Volume (shares)/day |
| --------- | ----------- | --------------------- | ------------------- |
| 5m        | 288         | ≥12,018 (cap-limited) | 23.8M               |
| 15m       | 96          | 4,050                 | 3.48M               |
| 1h        | 24          | 1,585                 | 1.08M               |
| 4h        | 6           | 555                   | 118k                |

30d 5m scan: **8,633 markets, 94,147 distinct wallets.** Two winner archetypes — HFT
makers (thousands of markets) and directional whales (1–300 markets, large size).

---

## Final estimate & de-risked path

- **To a backtest-validated strategy:** ~5/10, realistically **2–6 weeks**.
- **To live and net-positive after real frictions:** ~7/10, add **1–3 months** of
  iteration; genuine chance of failure. Budget the first live month to be
  break-even-to-negative while calibrating.
- **The whole thing hinges on one binary question:** does our fair-value estimate beat the
  market's implied probability by _more than_ spread + adverse selection + fees? If yes,
  everything else is plumbing we already own. If no, no engineering saves it.

We start at ~70% because the infra exists in this repo:

- Live + backtest run the **exact same** strategy code over the **same** tick stream
  (the #1 thing that kills most people — backtest lies — doesn't happen here).
- CLOB client, live WS feeds, OrderManager with intents, dry-run gate.
- Latency simulator + conservative worst-queue maker-fill model (underestimates fills, so
  a backtest edge is more likely real).
- Recorded Parquet + Telonex dataset pipeline = training/validation data.
- PnL reporting, dashboard, full ops loop.

### The path

1. Build a **minimal fair-value model** for 1h/4h crypto up/down (vol-scaled P(up)).
2. **Backtest it in this repo** (latency sim on, conservative fills) — measure edge vs the
   market's implied prob _after_ modeled costs. **This step is free and answers ~80%.**
3. If the backtest edge is real and robust across coins/days → dry-run → tiny real size →
   compare live fills to backtest. Scale only when live ≈ backtest.
4. Kill fast if live doesn't match; scale slowly if it does.

### The main risks that remain

- **Thin edge** (a few % of turnover), **capacity-limited** (small markets), **decaying**.
- **Backtest→live gap:** fills you modeled but don't get, adverse selection, redemption
  timing, fee reality.
- **Trend risk:** buy-both-sides quietly assumes mean reversion within the window. In a
  strong directional move you accumulate the losing side all the way down (the −$500
  markets). The model must know when _not_ to fade.

---

## Bottom line

Reverse-engineering the _idea_ is done. Building a working bot is very doable with this
repo. Making it _reliably profitable_ is a real research bet gated entirely on whether our
fair-value model beats the market's implied probability after costs — which we can measure
cheaply before risking anything. Compete on **modeling and market selection (1h/4h + alts)**,
not on speed and not on the ~breakeven 5m/15m grind.

**Next step:** prototype the fair-value model + maker strategy and run it through the
backtester to get a real edge number.
