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

---

## 2026-08-03 — Session 2: four levels, and the reason the naive version was doomed

The game as it now stands asks for one strategy that ends a fifteen-minute
Bitcoin up/down market holding a thousand shares of *both* outcomes, having paid
at most 98 cents for the pair, and buying in pieces of no more than 200 shares at
a time. I started from a player that could only place one thousand-share order,
so the first job was mechanical: buy in clips and re-arm after each fill. That
alone carried the first two markets, and I thought the rest would be arithmetic.

It was not. The third market broke it completely, and the way it broke turned
out to be the whole lesson. Bitcoin rose steadily through that window: the "up"
side went from 47 cents to 99, the "down" side fell to almost nothing. A patient
buy order only ever gets filled when its own side is getting *cheaper* — that is
what being filled means. So the player spent the entire window happily buying the
side that was collapsing, ended up with a thousand shares of the outcome that
expired worthless, two hundred of the one that paid, and a loss. Every variation
I tried on "keep the two legs balanced" made it worse, because balance does not
help when one side simply never comes back to you.

The fix was to stop treating the two sides as interchangeable and give priority
each moment to the side that is *running away* — the one getting more expensive.
That side is the one that will be unaffordable later; its partner keeps getting
cheaper and can be picked up cheaply near the close. Alongside that, I split the
98-cent ceiling unevenly, letting the priority side spend most of it and holding
the rest back, which stops the opening minutes — when both sides sit either side
of fifty cents and nothing is affordable — from quietly consuming the budget.

Two more things were needed. First, patience is not enough on its own: a side
that runs away never returns to a resting order, so the player now reaches out
and pays the asking price when it can afford the fee. Second, and this was a real
bug rather than a tuning question, I had been checking the budget against the
wrong thing. Spending in total less than the ceiling only keeps the *pair* under
98 cents if both legs actually finish. Windows that ended short were passing the
budget check while holding pairs that had cost 1.11. The player now checks the
exact number the scoring reads — the average paid for one side plus the average
paid for the other — before every order, so a run is legal at every instant
rather than only in hindsight.

With those in place, levels one through four pass: four markets, each ending at
exactly a thousand shares a side, pairs costing between 93 and 96 cents, all four
profitable. Worth saying plainly that this is thin. The simulation adds a little
random jitter to how long orders take to reach the exchange, and before the final
settings the third market passed only about two runs in three. It is stable now,
but "passed once" and "passes reliably" are different claims and I have been
careful to record which is which.

Level five adds a market I could not win, and I understand why. It is a violent
collapse: within the first minute the up side falls from 41 cents to 13 and the
down side climbs from 60 to 88, ending at 99. The pair was affordable for perhaps
forty seconds at the very start. The player instead buys a thousand shares of the
collapsing side at an average of 27 cents — cheap, correct-looking, and fatal,
because by the time it turns to the other side that side costs more than the
ceiling allows. Four separate runs fail it identically, so this is a mechanism,
not bad luck. The winning line exists and is a good one — take the rising side
immediately at 60 to 80 cents, collect the other for a penny or two at the close,
for a pair around 65 cents — but the player rations its aggressive buying by the
clock, which is exactly wrong when the opportunity lasts forty seconds. I tried
making it wait out the first fifteen seconds so the trend signal would be
meaningful before committing; it cost more on the markets that already work than
it saved here, so it ships switched off and recorded as measured.

Next session picks up there: let the buying respond to the opportunity rather
than to a stopwatch, and stop the collapsing side from quietly filling its whole
target and spending the ceiling on the way down.

---

## 2026-08-03 — Session 3: level five falls, and the culprit was a speed limit

The market that blocked the last session is a violent one-way collapse, and the
first thing I did was stop guessing about it and measure it. Within the first
minute the "up" side falls from 41 cents to 13 and the "down" side climbs from
60 to 88. The question that mattered was whether there was any patient way to
win it — buy the collapsing side for pennies, then pick up the other one on a
dip. The answer is no, and now I can say exactly why: after the first
forty-eight seconds the down side never trades below 87 cents again, so the
patient line would have required buying a thousand shares of the up side at an
average under ten cents *and* finishing inside twenty seconds. That is not a
thin chance, it is arithmetic. The pair in that market can only be started in
its first three-quarters of a minute, by paying up for the side the market has
already decided is winning.

So the player needed something it did not have: a reason to commit in the
opening seconds, before any trend is measurable. I gave it one. The width of the
gap between the two prices at the open is the market telling you how strongly it
believes. Two of the five markets open with a nineteen-cent gap and three with
seven. When the gap is wide the player now backs the favourite immediately;
when it is narrow it goes back to the patient dip-buying that already worked.
Nothing in this looks at the market's name or its result — only at the prices on
screen at that instant.

That got level five passing, but only about half the time, and half is not a
strategy, it is a coin toss with extra steps. I spent a long stretch chasing the
wrong thing: I tried spreading the buying out over the window, forcing the two
sides to stay level with each other, committing to one side and refusing to
switch, and several ways of making the cheaper side hold out for a better price.
Some of those looked brilliant on two runs and fell apart on eight. The honest
lesson there is about method rather than trading — at this level of run-to-run
noise, a two-run test tells you nothing, and I was briefly fooled by it more
than once.

The actual culprit turned out to be a speed limit I had inherited and never
questioned. The player rations how fast it is allowed to reach across the spread
and buy, spreading that over a quarter of the fifteen-minute window. But the
side worth buying is the side that is running away, and it is only affordable
for a minute or two. The third market's rising side was buyable for about ninety
seconds; in that time the speed limit let the player acquire barely a quarter of
what it needed, so it finished the window badly lopsided and the pair was ruined
— not because it picked the wrong side, but because it was too slow to finish
buying the right one. Letting it complete a side in about forty-five seconds
instead fixed it outright. Level five then passed eight times out of eight, and
levels one through four came along with it on exactly the same settings, every
market ending with a thousand shares of each side and pairs costing between 94
and 96 cents.

Worth saying plainly: nearly everything I invented this session is switched off
in the shipped player. The pacing, the balancing, the commitment latch — all
measured, all rejected, all left in the file with the numbers that killed them
so the next session does not spend an afternoon rediscovering them. What
survived is two changes: read the opening conviction, and stop rationing the one
purchase that has a deadline.

Level six adds a sixth market. I have not looked at it yet, deliberately — the
right first move is to run the gate and let it tell me whether it is already
solved, and if not, to measure its price series the way I measured this one
before touching any logic.
