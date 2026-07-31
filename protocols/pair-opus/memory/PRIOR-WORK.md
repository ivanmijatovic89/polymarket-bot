# What a sibling lab already tried

A parallel protocol (`pair-fable`) spent about 30 sessions on this strategy in
July 2026. This is a summary so you do not spend runs rediscovering the same
ground.

**Read this as information, not as verdicts.** Every result below was measured
under one particular design. If you have a genuinely different mechanism, test
it — several of those "dead" findings were later traced to the scaffolding they
were measured on rather than to the market.

## Measured facts about the market and the engine

These are properties of the data, not of any strategy:

- **Cheap sides are overpriced.** Every ask band below $0.80 is overpriced by
  roughly 1.5–3 cents a share; favourites are priced about fair. Buying at the
  ask pays a measured toll almost everywhere, which is the background against
  which any pairing mechanism has to work.
- **Sub-$1 pair moments exist but are not reachable.** Instants where both asks
  together are below $1 after fees are worth roughly $1.90 per market to
  someone with zero latency, but they last under a millisecond; at 140 ms about
  1 in 2,000 was catchable.
- **Fill counts are limited by the market, not by your speed.** Requoting
  faster changes fills by under 1%. Order flow at the top of book is dominated
  by cancellations — about 99 of every 100 changes are orders being pulled, not
  trades.
- **Latency costs real money.** Several mechanisms that lose at 140 ms would
  make money at zero latency; the gap is the cushion latency eats.
- **The full universe is the only sharp instrument.** Two identical full runs
  land within ~$0.21 per market; 800-market screens swing by ~$1.40.

## Mechanisms that were tried and did not pay

Each of these was implemented and measured; all lost money in the design they
were tested in, mostly around $5–8 lost per $100 invested:

- Alternating one-order-at-a-time accumulation with a pair-price gate.
- Quoting both sides at once while balanced.
- Requoting faster or keeping an order alive continuously.
- An absolute ceiling on the price paid per share (swept 0.08–0.45).
- Buying more of a side after its price fell (averaging down).
- Completing a doomed position early, on a sliding price limit, or above $1.
- Choosing markets by early order-book features, or by the spot price versus
  the strike.
- Changing tactics by minute of the window.
- Larger order sizes and more capital, up to $2,000 per market.
- Leaning toward the side the book favours, or the side the spot price favours.

## The shape of the loss, in the best variant reached

Across 800 markets: about two thirds of markets made money, together earning
about $13,500, while a fifth of markets ended badly, together losing about
$20,000. The typical market was slightly profitable; a fat tail of markets
where the price ran one way and the second leg never filled ate everything.

Everything above points at the same place: **the money is lost on shares that
never got paired.** That is the problem to solve.
