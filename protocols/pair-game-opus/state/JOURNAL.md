# Journal — Pair Game Opus

Append concise experiment records here. Each record must identify the level,
strategy revision, persisted run, result, diagnosis and next change.

---

## 2026-08-03 — Session 1: four levels cleared, then the engine says no

The game asks for one strategy that ends a 15-minute Bitcoin up/down market
holding matched shares on both sides, having paid at most 98 cents for the pair.
That ceiling is the whole difficulty. At any single instant the market prices the
two sides to sum to a little over a dollar, so the pair is never affordable in
one go. The only way under 98 cents is to buy the two sides at different moments
— catch the up side while it is dipping, catch the down side while *it* is
dipping — and to do it with resting orders, because crossing the spread costs a
fee of about 1.75 cents per share at even money, which on its own eats the entire
margin.

So the player I built rests one buy order on each side and never crosses. What
makes it work is the budget: it tracks how much of the 97-cent allowance it has
already spent and hands the rest to whichever leg is still missing. Buy the down
side cheap and the up side's allowance automatically grows, which is exactly when
you want to be bidding higher there. Nothing in it looks at the calendar, the
market's name, or the result.

It worked on the first try. The very first market of the universe filled both
legs at maker prices for a combined 97 cents, and that carried levels 1 through
4 — the same market at 10, 50, 200 and finally 1,000 shares a side — with no
change other than the size. Every fill was passive, so the fee bill was zero
throughout.

Level 5 asks for 3,000 shares a side and the run came back completely empty: no
trades at all. The cause is not the strategy. The shared trading engine has a
risk gate with two hard numbers baked in — no single order above 2,000 shares,
and no position above 2,000 shares of one outcome — and nothing anywhere can
change them; the order manager never passes an override. I checked that chunking
the order into legal pieces does not help, because the piece that would carry the
position past 2,000 gets refused by the second limit. I also confirmed the
boundary end-to-end on the real market: 2,000 shares a side trades fine and earns
$60, 2,001 trades nothing.

That matters more than one level. Every fifth level sits on the 3,000 rung, so 60
of the 300 levels are behind the same wall, and the rules forbid skipping. The
engine lives in shared code this protocol is not allowed to touch, so the honest
move is to stop and hand it over. I wrote up the blocker with a reproduction that
runs in a second and needs no database, and spelled out the two ways to fix it:
raise the two constants to at least 3,000, or give the order manager a limits
option the backtest can set. Worth saying out loud to whoever decides — a
3,000-share pair is about $2,900 of working capital per market, so this is a risk
call, not just a constant.

While I was there I also closed a loophole in my own scoring: minting pairs
directly from collateral would sail past the share requirement but costs exactly
a dollar a pair, above the ceiling, and is not one of the moves the rules allow.
The evaluator now refuses any run that does it.

What is waiting on the other side of this: the player has only ever seen one
market. From level 6 the levels start adding markets, and a market that trends
in one direction all window instead of oscillating will not hand over both legs
so obligingly. That is the real game, and I have not played it yet.
