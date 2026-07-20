# The Matrix Playbook

Alternative games this market allows, beyond "find patterns in the orderbook
and bet on direction". Structural edges beat statistical ones: fatter, more
durable, less validation needed. Each play lists the first measurable step —
no play is real until it has a number.

Companion to [MISSION.md](./MISSION.md) — every play still enters live money
through the same frozen gates.

## Game A — Collect structural mispricings (zero prediction)

UP + DOWN always settles at exactly $1. Law of the market, not a pattern.

- `ask(UP) + ask(DOWN) < $1` → buy both → guaranteed profit at settlement.
- `bid(UP) + bid(DOWN) > $1` → split $1 into UP+DOWN (`split_positions`
  already exists) → sell both → guaranteed profit inside the window.

Young thin retail market = these appear every time a gambler slams one side.
Safest possible thing to run with real money.

**First step:** one scanner script over the 19k-market Telonex dataset —
frequency, depth, duration of both conditions. Output: "the pond pays
$X/month risk-free." An afternoon on the fleet.

## Game B — Price the derivative (the lag edge)

The true probability of UP is nearly determined by two visible numbers:
distance between Binance spot and the price-to-beat, and time remaining.
A simple volatility model turns them into fair value per tick. Game: when
Polymarket quotes deviate from fair value, take the wrong quote.

Binance moves in milliseconds; Polymarket retail books adjust in seconds.
That lag is the most reliable edge class in existence. The feeds are already
built (`binanceWsSpotPrice`, `polymarketPriceToBeat`) — but live-only, so
the idea can't be backtested yet.

**First step:** start recording Binance spot alongside WS recording TONIGHT.
Every unrecorded day is backtest data lost forever. ~3 weeks of recording =
a replayable dataset for the strongest strategy class this market offers.
Bonus: the fair-value model upgrades every existing directional family as an
entry filter ("entry price vs model fair value").

## Game C — Model the players, not the price (the moat)

Polymarket is on-chain: every trade ever made is public, with wallet
addresses. Pull the full trade tape and profile the pool: which wallets
consistently lose in 15m markets, what they do before losing (chase candles,
panic-dump 97¢ winners), when the winning wallets enter. Poker logic — don't
predict the cards, profile the fish. Nobody does this in 15m markets; the
pond is too small for firms to bother.

**First step:** data-pull pipeline for the 15m-market trade tape + basic
wallet clustering. Schedule: after first live income exists.

## Game D — Sibling-market relative value

BTC/ETH/SOL/XRP 15m markets run simultaneously and the underlyings are
heavily correlated. When spot moves, the four Polymarket books do not
reprice at the same speed — trade the laggard against the leader. Same idea
across timeframes: the hourly market's probability must be consistent with
its four 15m windows; inconsistency = relative-value trade. This is arb
_between_ Polymarket markets, invisible to anyone staring at one book.

**First step:** record/sync sibling symbols in parallel, then measure
repricing lag correlations across the four books after spot moves.

## Game E — Get paid to quote (liquidity rewards)

Polymarket runs liquidity/maker reward programs: quoting two-sided within
the spread earns rewards regardless of trade outcome. That is subsidy
income — edge-independent, paid by the venue for doing what a market maker
does anyway. Combined with a merge exit (both sides fill → merge → $1, no
settlement risk), quoting can be profitable even at zero prediction skill.

**First step:** read the current rewards terms for 15m crypto markets;
compute rewards/day for a minimal two-sided quoting bot at minimum size.

## Game F — Own the open

At each 15m window open the book is freshly seeded: widest spreads, dumbest
quotes, earliest retail flow — and your own data shows early-window books
are uninformative (families gate on `startSec` for a reason). Flip that:
be the FIRST maker to quote the open with model-priced quotes (Game B fair
value at t=0 is nearly pure spot-distance math) and capture the first
minutes of flow before other bots arrive.

**First step:** measure from Telonex data who currently quotes the first
60 seconds, at what spreads, and what the first-minute flow pays.

## Game G — The endgame compounding machine

In the final seconds, near-certain winners trade at 97–99¢. Buying them
recycles capital every 15 minutes — even tiny per-cycle returns compound
absurdly at 96 cycles/day. The risk is the late reversal, and unlike most
tail risks this one is exactly measurable: spot distance vs seconds left
gives the true reversal probability per entry. The maker variant already
exists (`endgame-panic-bid`); this is the taker/compounding variant with
spot as referee.

**First step:** from data, the reversal-rate table — P(flip) by (spot
distance, seconds remaining) — then EV per cycle after fees vs that table.

## Game H — Buy speed (the indie latency play)

Game B and D edges are lag edges — they grow with your speed advantage.
A VPS colocated in the right region (near Polymarket's CLOB endpoints and
Binance's) can cut hundreds of ms vs a home connection, for a few dollars a
month. Firms pay millions for microseconds; here nobody has bothered yet,
so milliseconds are still for sale cheap.

**First step:** measure current WS round-trip from home vs a test VPS in
candidate regions; if the gap is >100ms, the play pays.

## Reserve plays (I–L)

- **Game I — Delta-hedged mispricing capture.** Buy the cheap Polymarket
  side vs fair value, short a small BTC perp against it → direction risk
  cancelled, pure mispricing kept. The professional version of Game B.
  Needs a small futures account + hedge logic.
- **Game J — Resolution mechanics.** Learn exactly which price source,
  timestamp, and precision resolves the market. If the crowd watches a
  different number than the one that resolves, the boundary is mispriced
  systematically. First step: one evening reading resolution rules.
- **Game K — Event calendar.** Tag every historical market with scheduled
  macro events (CPI, FOMC, etc.); re-split every family's results by tag.
  Every strategy has different EV inside vs outside violent windows.
- **Game L — Hunt the other bots.** Fingerprint competing bots from the
  trade tape (latency, size, habits); trade their predictable triggers.
  Bot-vs-bot is the endgame of every young market.

Beyond these: fee-tier games, cross-venue prediction-market arb, product
plays — marginal. The edge-source table is essentially complete at ~12;
everything further is combinations. **The bottleneck is validation
throughput, not ideas — permanently.**

## Priority order

1. **A** — scan today; if real, it's live strategy #1 (near-riskless).
2. **B** — start recording tonight; strategies in ~3 weeks.
3. **E + F** — cheap to check, both feed the same quoting bot.
4. **G** — one measurement script; pairs naturally with B's model.
5. **D + H** — after first live income; both multiply B.
6. **C** — the moat; build when the portfolio pays.
