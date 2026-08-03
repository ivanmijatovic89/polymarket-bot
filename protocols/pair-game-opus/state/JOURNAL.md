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

With time left over I scouted level six rather than stopping. Its new market is
the same animal as the one I just beat: the side that ends up winning is at its
cheapest in the opening seconds and climbs all window, while the other collapses
to almost nothing. It is very winnable — the two cheapest moments add up to
about 49 cents against a 98-cent budget — but again only if the player commits
in the first half-minute.

The reason it currently loses is worth writing down, because it is the same
mechanism in a new disguise. At the open both sides sit either side of fifty
cents, and the allowance the player grants its second leg is, at that moment,
also about fifty cents. So it happily buys the second leg at 48 — which quietly
commits it to a pair whose other half must never get more expensive, decided at
the one instant when the market has told it nothing whatsoever. Here the trigger
I added last does not save it, because this window opens almost evenly priced
and only reveals itself half a minute in, by which point the money is gone.

I tried the obvious remedy — forbid the second leg from spending anything until
the window has declared itself — and it does help the new market, but it breaks
the third one, where the leg that must be bought in the first minute happens to
be the second leg. So a blanket early ban is too crude, and I have left it in
the file switched off with that result recorded. What is actually wanted is
narrower: hold the second leg back only while the two prices are still close
together, and let it go once they have genuinely separated. That is where the
next session should start, and it starts from five levels standing rather than
four.

---

## 2026-08-03 — Session 4: level six falls, and most of the difficulty was not the trading

The market blocking last session opens almost evenly priced — one side at 53
cents, the other at 49 — and then moves one way for the rest of the quarter
hour, ending with the cheap side at a tenth of a cent and the other at
ninety-nine. The player lost it the same way every time: in the opening seconds
it bought a thousand shares of the side that was about to become worthless, at
around fifty cents each, and having spent its allowance it could never afford
the side that mattered.

The fix that worked is embarrassingly blunt, and I only saw it after measuring
all six markets' prices minute by minute instead of reasoning about them. Every
single window in this universe ends with one side under twelve cents. So the
side the player is *not* chasing will always be cheap later, and it has no
business paying a coin-flip price for it before the market has revealed
anything. The second leg now simply may not bid above twenty-five cents. That
one rule turns the level from unwinnable to winnable, and it is not delicate:
anywhere between eight and fifty cents works equally well, and I picked the
middle. Above about sixty it stops working, for the obvious reason — the losing
side of that market opens at fifty-three, so a cap above that lets it fill
immediately.

Alongside it I removed a speed limit on how fast the player may reach across the
spread. I had already loosened this last session; this session I took it off
entirely. The reasoning is that the budget rule already caps what can be spent,
so rationing the same purchases by the clock as well only guarantees that the
one leg with a deadline misses it.

The third change is the one worth telling you about, because it was not a
trading idea at all. Runs with identical settings kept producing wildly
different results — sometimes a clean win, sometimes a leg that stopped buying
a few seconds in and never resumed. Chasing that down, I found that when the
player cancels an order to move its price, the cancellation and the original
order both travel to the exchange with a small random delay, and the cancel can
overtake the order it refers to. It then arrives before there is anything to
cancel, and the simulator quietly discards it without telling anyone. The player
sits waiting for an acknowledgement that will never come, holding the single
order slot the rules allow it per side, and that side simply stops trading for
the rest of the market. In the persisted results this looks exactly like a
strategy that gave up. The cure is one line of discipline: never cancel an order
until the exchange has confirmed it exists. This was the largest single source
of noise in everything I had measured, which means some of my earlier
comparisons — and probably some from previous sessions — were partly measuring
this rather than the trading.

With all three in place, level six passes fifty runs out of fifty, and levels
one through five come along unchanged. Every market ends with exactly a thousand
shares of each side, pairs costing between ninety-four and ninety-seven cents,
all profitable. I should say plainly that ninety-four to ninety-seven against a
ninety-eight ceiling is thin, and it does not need to be: in these six markets
the two cheapest moments add up to somewhere between eighteen and sixty cents.
The player leaves that on the table because once it finishes one leg it buys the
other immediately instead of waiting for the close. Widening that gap is the
best insurance I can think of for the levels ahead, and I have not done it.

I spent what was left scouting level seven, and it fails every time, on the new
market, in a way I can name exactly. That market opens with one side at
fifty-eight and the other at forty-four, and the cheaper one goes on to win. The
player has a rule that says when the book opens leaning hard, back the
favourite immediately — a rule I added two sessions ago because one market could
only be won that way. Here the lean is just wide enough to trigger it, so the
player backs the fifty-eight-cent side, which promptly collapses. Worse, being
the favoured leg exempts it from the new twenty-five-cent cap, so it gets bought
freely and the money is gone before the trend reveals itself half a minute
later.

So the rule is right in one market and wrong in three, and the width of the
opening lean does not tell them apart — the market where it works opens at a
nineteen-cent gap, and two where it fails open at nineteen and fourteen. What
does look like it tells them apart is direction: where the rule works, the
favourite starts climbing from the first seconds; where it fails, the favourite
starts falling immediately. Making the player wait a few seconds for that, or
requiring the favourite to actually be rising before backing it, is where the
next session starts — from six levels standing rather than five.

---

## Session 5 — from six levels to eighteen

I came into this session stuck on level seven, with a diagnosis already written
down: the player had a rule saying "when the book opens leaning hard, back the
favourite immediately", and in that market the favourite promptly collapsed. The
plan on the page was to make the player wait a few seconds and check that the
favourite was actually rising before backing it.

That plan turned out to be aiming at the wrong thing, and understanding why is
the most useful thing I learned today.

I spent the first stretch just reading the seven markets tick by tick — the
opening prices, how fast they moved, and where each side was cheapest. Two facts
fell out. The first is that it does not matter at all which side wins. A matched
pair of one UP share and one DOWN share pays exactly one dollar whatever
happens, so the only question is whether each side can be bought cheaply at some
moment. The second is that the two prices always add up to a shade over a
dollar, at every instant. Put those together and the whole game collapses to a
single sentence: your profit is exactly how far the price of the side you bought
first rises between the moment you buy it and the moment you buy the other one.
So you want to buy the side that is about to go up, and collect the other after
it has fallen. Everything else is detail.

Which brought the real problem into focus. In the losing market the player did
not merely guess wrong at the opening — it bought eight hundred of its thousand
shares within three seconds, at sixty cents, on a guess. And it had a second
rule, a safety guard, which then read those eight hundred shares as proof that
the whole leg was a sixty-cent leg, and refused to let the other side buy
anything at all. The guard was meant to protect the price ceiling. It was
actually preventing the only recovery available.

So I made two changes. The first is a speed limit on the opening: for the first
five seconds, neither side may hold more than a fifth of its target. The player
is still free to guess; it just may not size the guess like a conclusion. The
second is removing that safety guard entirely, on the grounds that it protects
nothing — the running budget already guarantees the ceiling, because both sides
finish at exactly the same number of shares, so the pair cost is simply the
money spent divided by the target. Either change on its own still loses the
level. Together the level passes twenty-five times out of twenty-five.

Levels eight through eleven then fell without any further work, which told me
the changes were not a patch on one market.

Level twelve stopped it, and did so in a way I found genuinely instructive. Its
new market opens at almost exactly the same prices as the level-seven market —
one side at fifty-seven cents, the other at forty-five — and resolves the
opposite way. Level seven punished buying the dearer side; level twelve punishes
buying the cheaper one. Two identical opening books, opposite correct answers.
There is no cleverer reading of the opening book that gets both right.

The answer therefore could not be a better guess, only a smaller one. The
five-second cap was already a crude version of that idea, so I made it
continuous: a side may hold only as much of its target as the gap between the
two prices has already revealed. While the book is a coin flip, a fifth. Once
the market has clearly picked a direction, all of it. That single rule carried
level twelve and held every earlier level, and it has a comfortable margin — it
works anywhere from a quarter to two-fifths of the way along its scale, and I
shipped the middle.

Levels thirteen passed. Fourteen introduced a new failure shape I had not seen:
a market whose two prices cross each other five times in seven minutes. The
player kept switching which side it was chasing, and by taking turns it managed
to buy both sides at around fifty cents, which is the one combination that can
never work. I tried the obvious defences — committing to one side for the whole
window, requiring a bigger swing before switching — and both made things worse,
because committing early is exactly the coin-flip I had just spent the session
removing. What did work was tightening the rule that says how much the side
being ignored may pay: from twenty-five cents down to ten. The less the
temporarily-ignored side can spend before the market changes its mind, the less
a whipsaw costs. That held everything and carried fourteen through eighteen.

Level nineteen is where I ran out. It is the same whipsaw shape, worse: six
minutes of directionless oscillation between forty-six and sixty-five cents,
during which the player chases one side the whole way, finishes it at sixty
cents having spent almost its entire budget, and only then does the other side
run away. It needed the missing shares at four cents; they never traded below
thirty-six. I tried six different existing dials on it and a new one I built for
the purpose; none of them worked, and several broke earlier markets. All of that
is written down so the next session does not repeat it.

The idea I have not built yet, and would start with: the player has no memory of
where a price has been. Every rule it owns looks only at this instant. In that
market it repeatedly paid sixty cents for something it had watched trade at
forty-six a minute earlier. A rule that refuses to chase a side too far above
its own recent low would decline exactly those purchases, and would cost nothing
in a steadily trending market, where the recent low simply is the current price.

Eighteen levels standing, all on one unchanged configuration, every market
finishing with exactly a thousand shares of each side.

---

## Session 6 — the market I could not win, and why

I came into this session with one idea written down: the player has no memory of
where a price has been, and the market that has blocked it for two sessions is
one where it repeatedly paid sixty cents for something it had watched trade at
forty-six a minute earlier. So I gave each side a memory of its own cheapest
price so far, and refused to let the player chase a side more than a few cents
above that.

On the blocking market it worked immediately and completely. Where the old
player finishes holding a thousand of one side and six hundred of the other at a
combined price of a dollar and seven cents — a loss — the new rule finishes with
a full thousand of each at seventy-nine cents. That is a comfortable win on the
market that has been the wall.

Then I ran the other eighteen and it fell apart. Half of them stopped
completing. The pattern was the same everywhere and it took me a while to see
what it was really saying: the markets that now failed were failing on share
count, not on price. They were finishing at seventy or eighty cents a pair —
well inside what the game asks for — on a side that had only reached two hundred
shares out of a thousand. The player was saving money and then not spending it.

I spent most of the session trying to let it through the right door. I tried
switching the refusal on only once the other side had already been bought
expensively; only after the first minute; only before the sixth; measured
against a rolling recent low instead of the whole market's low; and released
late so a blocked side could still finish. Roughly thirty full runs. The best
combination wins the blocking market and loses three others. Nothing won all
nineteen.

What that search bought was an explanation, and I think it is worth more than
the rule would have been. A refusal rule always refuses the side whose price is
rising. In a market that genuinely trends, the side whose price is rising is the
one that wins — and it is only ever cheap in its first minute. So the rule
systematically pushes the money into the side that is falling, which is the side
that ends up worthless. The player finishes owning all of the wrong outcome at a
very good price. And from inside the moment the two cases are indistinguishable:
a price that has come back up above its own recent low looks exactly the same
whether the market is trending or thrashing.

So I stopped tuning that family and tried two other things. One was to stop the
two sides drawing on separate spending allowances — the old rule let each side
buy a quarter of its target on the same weak evidence, so a market that changes
its mind in the first ten seconds buys a quarter of both at fifty cents, which
is the one combination that can never work. Making them share a single allowance
does stop that, and it costs nothing: all eighteen markets still pass. It just
doesn't win the nineteenth, because once the allowance runs out the player goes
and buys the same side at the same bad price anyway. I have left it available
and switched off, since it is free.

The other was a contradiction I noticed in the player's own rules. The budget
carefully reserves real money for the second side — thirty or forty cents a
share — and a separate rule then forbids that side from ever paying more than
ten. In a normal market you never notice, because the second side really does
collapse to a few cents. In this market it doesn't: the reserved money sits
there unspent while the market fails for want of shares. I built the fix — hand
the allowance back as the first side fills — and it changed nothing, because by
the time the first side is nearly full the money is already gone. The
contradiction is real; my fix was aimed at the wrong end of it.

Nothing shipped. The player is exactly the eighteen-level configuration it was,
which I re-verified rather than assumed: eighteen markets pass, the nineteenth
fails identically to before, and the two levels I sampled still pass. Every new
dial is off by default and carries its own measurements next to it, so the next
session doesn't repeat any of this.

Where I would go next is somewhere I have not looked at all. The game allows the
player to see the Bitcoin price, the Chainlink price and the level the market
settles against, and the player currently reads none of them — every decision it
makes comes from the order book alone. The market that beats it is precisely one
where the order book spent six minutes saying nothing. How far Bitcoin actually
is from the level it has to beat, with four minutes left, is a genuinely
different piece of information, and it is a reason to prefer a side rather than
another reason to refuse a purchase — which, after this session, is the
distinction I would build on.

## Session 7 — eighteen levels in one step, by letting the player look outside the order book

Last session ended with a market I could not win and a suspicion about why.
Every decision the player made came from the order book alone, and the market
that beat it was one where the book said nothing for six minutes: the two prices
crossed back and forth around fifty cents, the player chased whichever side had
just ticked up, and it finished owning a thousand shares of the outcome that
expired nearly worthless. The game does allow the player to see the Bitcoin
price and the level the market settles against. It had never looked.

So the first thing I did was let it look, and simply print what it saw. That was
worth the twenty minutes on its own. In the market I could not win, Bitcoin
spent those six minutes within twenty dollars of the level it had to beat —
genuinely undecided — while the order book was confidently quoting a
sixty-percent chance for the side that lost. The book and the world disagreed,
and the disagreement was persistent rather than momentary.

My first two attempts used the raw distance: hold back while Bitcoin is close to
the line, and prefer whichever side it is on when it is far. Neither works, and
the reason is instructive. Preferring the far side tells the player nothing new,
because by the time the distance is obvious the book has already priced it. And
holding back has exactly one dial to turn, which has to be set above sixty
dollars to restrain the market that thrashes and below fifty-five to let two
genuinely trending markets through. There is no number that does both; I
measured the boundary from either side.

What works is the disagreement itself. The distance from the settlement level,
divided by how much time is left for the price to travel, gives a probability.
The order book quotes its own. Where the book is confidently pricing an outcome
that Bitcoin's own position does not support, the player now buys the other side
— which is both cheaper at that moment and, on this reading, likelier to win. It
is a reason to prefer a side, not a reason to refuse a purchase, which was the
distinction I said last time I would build on.

Getting it safe took three more attempts, and two of them were wrong in an
interesting way. A disagreement can arise because Bitcoin moved or because the
book leaned, and only the first is news. I tried twice to encode that — once by
ignoring the rule when the book is confident, once by requiring Bitcoin itself
to have moved — and both fixed the trending markets and broke the thrashing one,
because in the thrashing market the whole point is that Bitcoin has NOT moved
while the book insists it has. What separates the two cases is not the size of
either reading but the clock. A book that leans in the first forty-five seconds
is carrying what the market learned before the window even opened, and Bitcoin,
which starts every window exactly on its own settlement level, cannot possibly
contradict it yet. Leave that opening lean alone and the rule is safe: at no
stand-down the level scores seventeen of nineteen, at twenty seconds eighteen,
at forty-five seconds all nineteen.

Then it kept going. I re-ran every earlier level to make sure nothing had been
traded away — all eighteen still pass — and then walked the ladder up market by
market without changing anything else. Level nineteen through level thirty-six
all fall to the same unchanged player, every market ending with a full thousand
shares of each side and a pair costing between eighty-nine and ninety-seven
cents against a ceiling of ninety-eight. That is eighteen levels in one session,
where the previous six sessions had produced eighteen in total.

Two smaller things worth recording. The comparison uses the Binance price
shifted by its current gap to the Chainlink price, because Chainlink is what the
market actually settles on but only updates about once a minute; dropping that
correction and using Binance raw costs one market out of twenty-two, so the
correction is load-bearing rather than decorative. And every new dial that did
not ship is switched off with its measurements written next to it in the code,
so none of this has to be rediscovered.

Level thirty-seven is the next wall and I already know its shape. That window
opens leaning hard, the player's conviction rule buys the entire first side
inside forty-five seconds at sixty-five cents, and the market then reverses for
good — leaving nothing to buy the winning side with, even though it was
available at twenty-eight cents in the first half-minute. The forty-five second
stand-down that makes the new rule safe is precisely the window in which that
damage is done. Shortening it regresses two other markets, so the thing to try
is the other end: limit how much the player may commit before the outside price
is allowed to speak. The settlement level arrives about three seconds into the
window, so there is real information available long before the override is
permitted to use it.

---

## Session 9 — one level, and a scare about what "passing" means

Level thirty-seven was blocked by a single window, and I knew its shape before I
started: it opens leaning one way, the player buys the whole of that side inside
the first forty-five seconds at sixty-five cents, and the market then turns round
and stays turned. The side it needed was available at twenty-eight cents while
that was happening, and it never came back.

The first thing I did was make the experiment loop fast. Replaying all forty of
the markets I care about takes about ninety seconds, and four or five of those
can run side by side, so a whole idea can be tested in two minutes instead of the
several-minute cycle earlier sessions were working with. Two small scripts do
this now; they are the reason this session got through about twenty distinct
configurations.

Three families of cure. The first was to refuse any purchase that would push the
two average prices, together, over the ceiling. It fixes all four of the markets
I was stuck on and breaks five earlier ones — precisely the failure the code
already warns about, where refusing the expensive winner leaves the player owning
a full position in the cheap loser. The second was subtler and I thought it was
the answer for a while: reserve money for the second side based on the cheapest
price that side has actually traded at, rather than on the assumption that it
will end up nearly worthless. That reads well and measures well, and it is
nonetheless a mirage. Capping what the player may PAY only turns an aggressive
purchase into a patient one a few cents lower, and in a window that reverses the
price falls straight through the patient order. The same thousand shares of the
same losing outcome get bought anyway, very slightly cheaper. I have written that
down next to the knob, which ships switched off, because it is the third time
this project has rediscovered it.

What works is a cap on SIZE, not price. Before the outside price is allowed to
overrule the book — a stand-down that exists for a good reason and that I did not
want to touch — no side may be more than half built. On its own that is too blunt
and costs three markets that genuinely had to finish a position early, so it
carries two conditions. It only applies once the player has already been made to
buy BOTH sides, which only happens when the book has contradicted itself; and it
only applies while the outside price argues against the side being bought. A
window that trends and is confirmed by Bitcoin's own price is left completely
alone. That is the whole change, and it wins the level.

Then the useful scare. My first version of it passed level thirty-seven and, on
the same configuration, failed eight of the levels below it. The culprit was the
fourth market of the whole universe, which had become bistable: identical inputs,
finishing either with a full position or two thirds of one, depending on nothing
but the random few milliseconds of simulated order latency. Runs here are not
reproducible, and I had not appreciated how sharp that can get — a threshold
sitting right at the edge of a decision turns a coin-flip into a market outcome.
Moving the gate from a quarter of the target to just over a third puts that
market outside the mechanism entirely, and it is deterministic again. The lesson
is worth more than the level: a level that passes three runs in four is not
passed, and I have written the instruction to repeat every probe into the status
file.

So: level thirty-seven, with all thirty-seven levels re-run from scratch on the
final code, every market ending with a full thousand shares of each side and the
worst pair costing ninety-seven cents against a ceiling of ninety-eight.

Level thirty-eight is a different animal and I have diagnosed it. There the
player correctly identifies the winning side and builds three quarters of it
cheaply — and then a pacing rule, which limits how large a position may be
relative to how much the market has revealed, freezes it. The gap between the two
prices narrows, the allowance falls below what is already held, and the position
simply stops growing. The budget then goes to the other side, and the last
quarter of the winner is never affordable again. The fix I want to try is the
obvious one and does not refuse anything: a side that is three quarters built
should be finished, because shares that never get matched are a total loss and
that is worth more than the pace being violated.

## Session 10 — seven levels, and the argument I had been using against myself

Last session left me a plan for level thirty-eight and it worked on the first
try. The player had been correctly picking the winning side of that market and
building three quarters of it cheaply, and then a pacing rule froze it there. The
rule limits how large a position may be relative to how much the two prices have
separated — sensible while a position is being built, and quietly wrong once most
of it exists, because that separation SHRINKS when the market gets indecisive
again. A position built under a wide gap is retroactively over its limit when the
gap narrows, and simply stops growing. So the rule had stopped being a limit on
new commitment and become a freeze on an existing one, which is a completely
different thing: not growing a position costs you an opportunity, but not
finishing one costs you everything already spent on it, since a share with no
partner can never be paired. Now anything past three quarters built gets
finished. That market went from three quarters to a full position, and level
thirty-eight was done in about twenty minutes.

Thirty-nine came free. Forty did not, and getting it meant reversing a decision I
had made twice before and written up at length both times.

The idea is that when the player commits to one side, it must set money aside for
the other — and the question is how much. It had been assuming the second side
would end up nearly worthless, which is true in a market that keeps running and
false in one that turns around. The obvious alternative is to set aside enough to
buy the second side at the cheapest price that side has actually been quoted at,
which is a fact rather than a hope. I measured that twice in earlier sessions and
rejected it twice, with a good reason: putting a ceiling on what a side may pay
doesn't stop you buying it, it just leaves your order sitting a few cents lower,
and if that side then collapses your order fills on the way down anyway. Same
shares of the same loser, marginally cheaper.

What I had missed is that the argument only holds when the side goes on to fall.
The market blocking level forty does the opposite: the player chases one side
from fifty cents up to sixty-eight and finishes it there, against a reserve that
assumed the other side would be available at ten cents when it had never been
quoted below forty-three. An order left behind at fifty-three doesn't get run
over by a price going the other way — it just never fills. Against a rising
price, a limit on what you'll pay IS a limit on how much you'll buy. And the
market my old objection was really about is now handled by a different mechanism
anyway, so the reserve no longer has to cover it. It ships, and levels forty
through forty-four all fell to it in one go. Seven levels this session.

Then I spent the rest of the session losing to level forty-five, and I think the
losing was worth more than another level would have been.

Five markets block the way ahead and they are all the same animal: the market
leans one way for a minute, the player completes that side, and the market then
reverses permanently, leaving it holding a full position in the loser and about a
third of the winner. The specimen is stark. The winning side was never quoted
above sixty-three cents and the losing side ended up essentially free, so a
forty-cent pair was sitting there for anyone who bought the winner early and
picked up the loser at the close. The player bought precisely backwards.

I tried three things and all three failed, which is the useful part. Setting
aside more money for the second side is monotonically worse and doesn't even fix
the market in question — and it fails by exactly the mechanism my old objection
described, which was satisfying to watch happen for real. Requiring Bitcoin's own
price to confirm the market's lean before the player may build a large position
is much worse than doing nothing, at every strength I tried. And the size limit
that won level thirty-seven cannot reach these markets at all: it only engages
once the player has been made to buy BOTH sides, and here the second side is
barely a third built, so lengthening it, loosening it or adding a new condition
to it changes literally not one share of the outcome. I added that new condition
anyway, measured it, found it costs a market I already had, and left it switched
off with the numbers written down.

So I know three families of answer that don't work here, and I have a fairly
precise statement of what does need to happen: the player completes a position at
around sixty-three cents while the other side has never once been quoted below
thirty-seven, which is a pair the evidence already says is impossible. The
untried move is to refuse the purchase outright rather than to bid lower for it —
place no order at all instead of a cheaper one. That distinction is exactly what
every price limit in this player has got wrong, and it is where I would start
next.

Standing at forty-four levels, with all forty-four re-verified from scratch on
the final code, every market ending with a full thousand shares of each side and
the worst pair costing ninety-seven cents against a ceiling of ninety-eight.

---

The previous session was cut off mid-flight and left an unfinished idea sitting
in the working tree, so the first job was to decide whether it was any good. It
was the idea I'd flagged as the one to try next: before committing more money to
the side the market is favouring, add up what finishing that side would cost plus
what the other side would cost at the cheapest price it has actually been quoted
at, and if the total can't come in under the ceiling, hand the chase to the other
side instead. I measured it across sixty markets at seven different strengths.
It's worse than doing nothing at every strength where it does anything at all,
and where it stops doing anything it is identical to doing nothing. There is no
setting in between.

The reason is worth writing down because it kills a whole way of thinking, not
just one rule. The two sides of one of these markets always cost about a dollar
together. So "finishing this side and funding the other one" always overruns a
ninety-eight cent ceiling, in nearly every market, from the first minute. The
overrun isn't a warning sign, it's the normal state of the world. What's left to
decide anything is the difference between the two versions of that sum, and that
difference is a couple of cents wide — small enough that any filter big enough to
ignore noise also ignores the entire signal, and anything smaller just tells the
player to buy whichever side is currently cheapest, which is a rule I already
know loses. I recorded all of that next to the code and switched it off.

Then I went and actually watched the problem market tick by tick instead of
reasoning about it, which I should have done sooner. It is bleaker than I
realised. The player spends four fifths of its entire budget in the first
seventy-five seconds of a fifteen-minute window, finishing one side at
sixty-four cents. Thirty seconds later that side starts sliding and ends
essentially worthless. It then sits motionless for thirteen more minutes,
priced out of everything.

That suggested an obvious cure — simply don't let the player own that much of one
side that early, and if it hits the limit, point it at the other side so it isn't
just frozen. Deliberately a limit on how much, not on what price, because every
price limit in this player has failed the same way: it leaves a cheap bid resting
under the market, and the side that reverses falls straight through it, so you
pay the lower price and gain nothing. The size limit avoids that trap and is
still much worse — roughly three to five times the failures, at four different
strengths, and worse the more it restrains. It doesn't even fix the market it was
built for. What it exposes is that slowing the buying doesn't help when the harm
is the price you paid, not the speed you paid it at; by the time the clock lets
go, the side you throttled has still been bought at fifty-five cents and the
other one has already run away.

The good news came from the same debug timeline. The player carries two opinions
about which side should win: the order book's, and one computed from where
Bitcoin actually is relative to the level the market settles against. Most of the
time it only acts on a disagreement between them when the disagreement is large.
In this market the disagreement is there and it is small — the book wants
sixty-four cents for a side the Bitcoin reading says is worth fifty-seven. Lower
the threshold so that a small disagreement counts, and the market is repaired.
Five separate runs, all clean, which given how noisy this harness is counts as
proof.

It isn't free. The same lowered threshold breaks three markets further down the
ladder that currently pass. I spent the rest of the session trying to buy the fix
without the bill: letting the sensitive reading act only early in the window
(doesn't help — those three lose their way in the first two minutes, not at the
end), requiring Bitcoin's own move to confirm before acting (removes the fix
without saving anything), and tightening a guard on how far the book has already
leaned (saves one of the three, costs another). All measured, all written down.

So I end where I'd rather end: with one live lead instead of a list of dead ones.
The next question is narrow and answerable — line up the four markets' opening two
minutes and find what distinguishes the one where the sensitive reading is right
from the three where it isn't. Everything else about the player is untouched, and
all forty-four levels were re-verified from scratch on the committed code, twice.

## Session 13 — level 45 passes, and level 46 is a different animal

Last session ended with one live lead and a question: line up the four markets
side by side and find what tells the one repair apart from its three casualties.
That worked, and the answer was simpler than I expected.

I printed all four windows' opening two minutes next to each other. At the moment
the player's two opinions are allowed to disagree — forty-five seconds in — the
four markets are almost indistinguishable on everything the player already
measures. The disagreement is a couple of percentage points in all four. The book
sits anywhere between a third and three quarters. Bitcoin's own reading points
whichever way it likes. Nothing separates them.

They differ on one thing. In the market that gets repaired, the player is holding
594 shares of one side and 136 of the other, and the side the disagreement names
is the one 458 shares behind. In all three casualties the player is holding 500
and 375, and the side named is behind by exactly 125. Same reading, same
threshold, wildly different amount of catching up to do.

That turns out to be the whole argument. Following a small disagreement is cheap
when you're already badly lopsided, because following it and rebalancing are then
the same action — if the reading is wrong you have at least bought the side you
were short of. When your two sides are close together the same reading has no such
cover: it spends what's left of the budget putting you lopsided the other way,
which is exactly the shape all three casualties come to rest in.

Getting from that observation to a working rule took two wrong turns worth
recording. The first was to make the imbalance a requirement — no acting on a
disagreement unless you're badly behind. That is worse than doing nothing at all,
eight to ten failures against five, because the disagreement rule isn't a rescue
mechanism that only matters in trouble; it earns its keep in ordinary balanced
windows too, and silencing it there costs more than the casualties it saves. The
second was subtler: acting on the imbalance closes the imbalance, so a rule that
re-checks it every instant switches itself off halfway through its own repair. The
market landed on 1000/606 that way — better than the 1000/344 it fails at, still a
failure.

What works is neither a requirement nor a re-check. It's a second threshold. A
side that's already far behind is read against a sensitive threshold; two sides
close together are read against the strict one; and whichever threshold opens the
decision keeps it until the disagreement itself dies. Four failures over the first
sixty markets instead of five, the blocker repaired, no casualty anywhere. Three
independent runs at each of two settings, identical results every time. Then the
whole ladder from scratch: forty-five levels, every market ending exactly
1000/1000, worst pair cost 0.970 against a ceiling of 0.98.

So level 45 is passed and I moved on to 46, which I had assumed was more of the
same. It isn't. This market opens ordinarily, and then Bitcoin falls ninety-one
dollars in ten seconds. The player reads that correctly — one side really is
winning — and buys that side all the way to its target, six hundred shares at
sixty-five cents apiece, eating almost the entire budget. Ten seconds later
Bitcoin reverses. The other side is now unbuyable and the market ends 469/1000.

The uncomfortable part is that the trade was doomed before the reversal. The
player was already holding 469 of the other side at fifty-eight cents, which
leaves room for at most thirty-nine cents on this one. Nothing that happened next
mattered; sixty-five cent shares could never have come in under the ceiling. The
only thing standing between the player and those fills is a budget check that
looks at the total and permits eighty-three cents a share.

I spent the rest of the session on the obvious fix and it failed badly. The idea
was to check the exact arithmetic whenever an order would *finish* a side, since
at that moment the average you've realized is the average you'll end with. Twenty-
three to forty-one failures depending on how much of a leg it governs, against
four without it, and it doesn't even fix the market it was built for. The reason
is worth keeping: refusing the last shares of a side doesn't undo the expensive
ones you already bought. It just turns one kind of failure into another, and it
does it in every ordinary window too.

Which points somewhere specific for next time. The ceiling can't be defended at
the end of a leg; it has to be defended while the expensive fills are happening.
The test I want is affordability priced at what things cost *right now* — at the
moment of that ninety-one dollar drop, buying the winning side at sixty-five cents
while still needing five hundred of the loser at its own thirty-one cent ask needs
more money than remains, and the fills stop there. That is a different thing from
a mechanism I rejected two sessions ago, which priced the other side at the
cheapest it had ever been and swapped which side to chase rather than refusing the
order.

Everything is committed, pushed and verified. Three more markets in the first
sixty still fail; I'll read their timelines before building anything, in case one
mechanism takes all four.

---

## Session 14 — the four markets turn out to be two problems

I did what I said I would: read the timelines of all four failing markets side by
side before building anything. They look identical in the results table and they
are not the same failure, and finding that out is the whole value of the session.

The shared anatomy is real. In every one of the four, the player spends between a
half and three fifths of its budget buying about six hundred shares of a single
side at an average near fifty-nine cents. Then the window turns, and the side it
still owes six or seven hundred shares of is quoted well above anything the money
left can pay. It never catches up. That is one story and it fits all four.

But the fills that do the damage arrive in two quite different ways. In two of the
markets the price *jumps* — half a dollar to sixty-four cents in five seconds in
one, forty-five to seventy in ten seconds in the other — and the player buys
straight into the jump, which then unwinds within the minute. In the other two the
price *climbs*, about eight cents over a full minute, with every signal the player
has agreeing the whole way, and the reversal only arrives minutes later. A jump and
a climb need opposite treatment, and lumping them together is why nothing has
worked.

I tested the idea I'd left myself last time — refuse an order when finishing the
side you're chasing would leave the other side unaffordable at what it costs right
now — in the cheapest form available, by simply reserving more money for the other
side. It fails the way this family always fails: the money set aside starves a
side that genuinely had to be bought, and six other markets break. Then I tried a
cleaner version of the same instinct, capping what the chased side may pay at a
multiple of what the remaining budget affords per share still owed. That was a
rout: seventeen to nineteen failures against four, and it didn't fix a single one
of the four it was built for. The reasoning behind it was sound and the world
disagreed — ordinary winning markets routinely pay two or three times that average
late in the window, precisely when the last side has to be finished.

The one that worked, partly, came from taking the jump-versus-climb distinction
seriously. Every price cap this player has ever tried is pinned to something the
price can't get back to — its own cheapest level, the other side's cheapest level,
a budget average that only shrinks. A pinned cap can't tell a jump from a climb,
so it refuses both, and refusing a climb is how you end up holding two hundred
shares of the side that won. So I gave it a cap that *follows*: the side's own
moving average of its price, plus a pad. A climb drags the average along and the
cap climbs behind it; a five-second jump outruns it and the cap bites exactly
there.

It works on the two jump markets. That's the first time anything has moved them at
all — six sessions of price caps and they hadn't shifted by a single share. It
does nothing for the two climb markets, at any setting, because a climb is what it
is designed to forgive. And it costs two other markets, for a reason I hadn't
anticipated: holding a side back through a climb means finishing it later and
dearer, and one market that used to complete its second side at sixty-one cents
now completes it at seventy-two and strands the other side at four tenths.

So nothing shipped, and the player is byte-for-byte the same as it was. I've
re-verified the whole ladder from level one to forty-five at the new commit and it
is clean, worst pair cost 0.970 against a ceiling of 0.98.

Two things for next time, and they're separate now, which is progress. The
following cap is close enough to worth saving: its entire cost is the delay it
imposes, and there are two untried ways to remove the delay without losing the
refusal — let the refused side keep resting a passive bid instead of pushing it out
of the book, or release the cap once the side is nearly finished, which is exactly
where the market it broke went wrong. The two climb markets need a different
question entirely. Everything I've tried reads the price; their price says nothing
useful. What no rule yet reads is the player's own position — six hundred of one
side, three hundred of the other, well over half the money gone, and only a couple
of hundred pairs actually formed to show for it. That imbalance is survivable if
the trend holds and fatal if it doesn't, and it is the one reading still on the
table.

## Session 15 — level 46 falls to a rule about speed rather than price

Level 46 is passed. The whole ladder from level one to forty-six was re-run at
the new player and every market in it finishes with a full thousand shares on
both sides, at a worst pair cost of 0.970 against a ceiling of 0.98.

I started where the last session left off, with two ways to make the "following
cap" pay for itself. That cap was the near-miss: it repaired the two markets
where the player buys into a price that spikes and reverts, and its whole cost
was the delay it imposed on legs that were climbing legitimately. The first idea
was to let a refused leg keep resting a passive bid instead of being pushed out
of the book; the second was to release the cap once the leg was nearly finished.
Both were built and measured over sixty markets. The first is actively worse — it
loses the very market it was meant to save, because a bid one tick under a
spiking price fills inside the spike just as happily as a crossing order does.
The second is exactly neutral: identical results to the cap alone, which still
costs the two markets that were the whole problem. So that line is closed, and
the shelf it sat on can be cleared.

What actually worked came from looking at the two situations side by side and
asking what separates them, rather than trying to tune a cap until it happened to
straddle both. The market that must be chased and the market that must not look
identical in the order book: a lurch to a new level, with the outside price
agreeing. They do not look identical in the underlying. The one that must be
chased sees BTC move twenty-five dollars in five seconds and then keep going. The
one that must not sees ninety-one dollars in five seconds and two thirds of it
handed back in the next five. Speed is the difference, and speed is something a
price cap structurally cannot read, because a book that has re-priced has
re-priced regardless of how fast it got there.

So the new rule reads the underlying's own velocity and nothing else. It names no
leg and caps no price. It asks one question — is BTC in a violent excursion right
now? — and while the answer is yes the player buys nothing, on either side, and
pulls whatever it has resting so that a bid cannot be run through by the very
move being refused. I measured the deviation on the three markets that mattered
before building anything: eighty-six dollars in the one that had to be stopped,
twenty-six and twenty-seven in the two that every previous restraint destroyed.
That is a wide gap, and it is why this works where six sessions of price caps did
not.

The first version failed, and for an honest reason worth recording. The outside
price is a Binance tape shifted by a Chainlink basis, and tick to tick it jitters
by tens of dollars, so the deviation crosses any threshold in bursts rather than
staying above it. The gate flickered, and the player did its buying in the gaps —
it completed the leg inside the excursion exactly as before, one second at a
time. The fix is to treat a spike as an event rather than an instant: once the
underlying has printed that far from its own average, sit out the ten seconds
that follow, which are precisely the seconds when the book is mispriced and the
reversion has not arrived yet.

That is the first restraint this player has ever had that repairs markets without
costing any. Over the first sixty markets it takes the failures from four to two.
The two it removes are the pair of spike markets that no price cap had moved by a
single share in six sessions. Nothing else changes: the market that every
restraint starves and the market the previous best attempt broke are both
untouched, because neither of them ever sees the underlying travel more than
twenty-seven dollars from its own average. I mapped both edges of both settings
before shipping — the threshold works between thirty and forty dollars and fails
at forty-five; the hold works between eight and twelve seconds and fails at five
and at fifteen — and shipped the middle of each. Because these runs are not
reproducible I repeated the chosen setting four times over sixty markets, and it
came back clean every time.

Two markets remain, and I read them again under the new player so the diagnosis
is current rather than inherited. They are slow, quiet windows — the largest move
either of them makes is twelve dollars, so the new gate will never engage there
and never should. Their shape is a single handover: the player spends the first
minute chasing one side, then changes its mind and chases the other, and pays
more for the second than it paid for the first. By the time the handover is done
it holds six hundred-odd of one side and three hundred of the other, has spent
over half its money, and the arithmetic is already lost — finishing the second
side would need it at twenty-eight cents when it is quoted at forty and never
goes below thirty again. Nothing in the player currently notices that a handover
has happened at all, which is where I would look next.


## Session 16 — three ways to hold the player back, all of them worse

Nothing passed this session. Level 47 still has the same two markets in front of
it, and I want to be straightforward about that before anything else. What I do
have is a much better picture of why they are hard, and three plausible fixes
that are now measured rather than merely suspected — one of which was the plan
the last session left behind, and one of which turned out to rest on a fact that
simply is not true.

I started by re-running the idea the previous session had queued up: a reserve
rule that refuses to chase one side past what the other side's own cheapest
price still needs. It had been rejected before, but that measurement predated
the speed gate that carried level 46, and two of the four markets it was
fighting no longer exist. It is worse than ever — at three escalating strengths
it turns two failures into three, seven and seven. That line is closed for good.

Then I read both blocking markets tick by tick, which paid for itself. The most
useful thing I learned is that neither of them is unwinnable, and not even
narrowly. In the first, the cheapest the winning side ever traded was forty
cents, and the cheapest the losing side ever traded was a fifth of a cent. Buy
each side in its own trough and the pair costs forty cents against a ceiling of
ninety-eight. The catch is that the two troughs are fourteen minutes apart, and
at any single instant the two sides together cost about a dollar and one cent.
So there is no moment in the window where the player can simply buy the pair; it
has to buy each half separately and be right about the order.

It is not right about the order. It spends more than half its money in the first
minute on the side quoted between fifty-three and sixty-one cents, while the
book is still a coin flip, and that side is the one that ends up worthless. What
gives it permission to do that turned out to be one specific rule: the player is
allowed to own a fraction of a side proportional to how far apart the two prices
currently are. That gap is read at a single instant, and once shares are bought
they stay bought. So one flicker of a wide gap inside an otherwise undecided
minute licenses six hundred shares permanently.

That is the same shape as the problem the speed gate solved last session — a
signal read at an instant when it should be read over a stretch of time — so I
built the same remedy: judge the gap by how wide it has been for the last twenty
or thirty seconds rather than how wide it is right now. It works. Both blocking
markets finish complete, at a pair cost around ninety-six cents, repeatedly. It
also destroys between nine and fifteen other markets, and I tried four different
ways of narrowing when it applies. Every casualty looks the same: one side
stranded somewhere between two and seven hundred shares, at a pair cost well
over a dollar. The reason is not subtle. A market whose favourite genuinely runs
away has to have it bought in the first minute, and a rule that waits to be sure
delays exactly that purchase. Roughly four markets lost for every one saved, and
narrowing the trigger does not improve the trade — by the time the trigger is
late enough to spare the trending markets, it is too late to save the coin-flip
ones.

One of the four narrowings deserves its own note, because it was the previous
session's headline plan and it is built on sand. The idea was to key a rule to
the moment the player changes its mind about which side to chase — a handover,
which the fifteen-second debug log makes look like a single dramatic event
mid-window. It is not. The role flickers on essentially every tick, so a counter
over it saturates within seconds of the first purchase, and gating anything on
"at least one handover has happened" reproduced the ungated result market for
market. I have written that into the notes as plainly as I can, because it is
exactly the kind of thing a future session would otherwise rediscover from the
same misleading log.

The third attempt came from asking what the scarce resource actually is. Shares
are not: refusing five hundred shares at a nickel costs a window its cheap half
and saves nothing, while one clip at sixty cents does the real damage. Money is,
and money is what the ceiling is denominated in. So I rationed the budget by the
clock instead of rationing shares. The reasoning survives contact with the data
better than anything else I tried — the first blocking market is repaired
outright, the second climbs from three hundred and forty shares to eight
hundred and twenty-five, and what the player does buy it buys at the cheapest
pair costs it has ever managed, well under ninety cents. And it fails
twenty-two markets out of sixty. Every failure is a share count, never a price.
That is the lesson in one line: this player wins by finishing legs, a budget it
may not spend is a leg it may not finish, and a share with no partner is worth
nothing however cheaply it was bought.

So three families of restraint, and all three fail for the same reason. At the
moment the player commits, the commitment that will turn out to be wrong and the
one that will turn out to be right are indistinguishable — in the book, on the
clock, and in the budget. Every rule that stops one stops the other.

That points somewhere different for next time, and I have left the note pinned
to a piece of arithmetic rather than an intuition. Stop trying to prevent the
bad read and change what happens after it. When these markets reverse, the side
that wins is quoted between forty-four and fifty-six cents for two full minutes
afterwards, the player has enough money to buy it — its own budget line would
allow forty-nine cents — and it does not, because a separate rule holds the
non-favoured side to a loser's price of ten cents and it rests there instead of
paying up. That ten-cent ceiling is the only constraint in the whole chain that
has never once been moved in sixteen sessions. It is where I would go next.

Everything is committed, the two new knobs ship switched off with their negative
results written into the code beside them, and I re-ran level 46 at the new
commit to confirm the player still behaves identically: forty-six of forty-six.

---

## 2026-08-03 — Session 17: the plan I inherited was wrong, and the reason is useful

Last session left a very specific next move, pinned to arithmetic rather than
intuition: in the two windows still blocking level 47, the side that ends up
winning is quoted around half a dollar for two full minutes after the market
turns, the player clearly has the money to buy it, and it does not, because a
separate rule holds the side it is not chasing to a loser's price of ten cents.
Move that ten-cent ceiling, said the note, and the windows should open.

I moved it — to fifteen cents, twenty, twenty-five, forty. Nothing changed. Not
approximately nothing: the two markets finished on identical share counts to the
decimal place at every setting. That is the signature of a rule that is not
running at all, and when I went and read the code path it is exactly that. The
ten-cent ceiling only applies while both sides are still being built. By the time
these windows reverse, the player has already finished one side, and it has left
that part of the code entirely. The constraint everyone has been staring at for
two sessions was never in the picture.

So I went back to the tick-by-tick record and read what actually stops the
purchase. At the moment market forty-seven turns, the player wants to buy the
winning side, the side is offered at fifty-six cents, and the player's own bid
sits at fifty-two. It rests there while the price walks away from it to ninety-
nine. Four cents. The arithmetic behind those four cents is a reserve: before
deciding what it may pay for the side it is chasing, the player sets aside money
for the side it is abandoning, and it sizes that reserve from the cheapest price
the abandoned side has traded at so far. That number is stale by construction —
a side that is collapsing is making a new low every few seconds — and in this
window it withholds about a hundred dollars for shares that end up costing two
cents each. Meanwhile the winning side goes unbought for want of four cents a
share. **The constraint on these windows is the bid, not the money.** That is the
single most useful thing I learned today, and everything below is a consequence
of testing it.

I tried three things against it. The first was the obvious one — stop the player
changing its mind. In both blocking windows it opens by picking the cheaper side,
which turns out to be the eventual winner, and then abandons it within a minute
because Bitcoin has moved three to fifteen dollars, which is noise. So I made
changing its mind cost something, in proportion to what it has already bought:
with nothing committed, switch freely; with most of a side bought, the market has
to shout. This works beautifully on the two blockers. Both finish complete, at
the best pair prices this player has ever produced. It also breaks three markets
that currently pass, and there is no gentler setting — below the level that fixes
the two, the fix simply vanishes.

The three casualties taught me something I would not have guessed. The
mind-changing I suppressed was doing a second job nobody designed. A side only
gets bought on the ticks where it holds priority, so priority flickering back and
forth every tick was acting as a brake on how fast the player could load up. Take
the flicker away and it buys its chosen side out in seventy-five seconds instead
of minutes — and if that side is the loser, there is no money left for anything.
All three casualties end holding a thousand shares of the worthless outcome and
two hundred of the good one, which is the same shape as the two markets I was
trying to fix. I have written that into the notes, because any future rule that
makes the player stick to its choice has to put the brake back deliberately.

The second attempt went at the stale reserve directly: stop reserving against a
price the abandoned side is still falling through. The reasoning is sound and the
distinction turned out to be empty — it reproduced simply switching the reserve
off, to the cent, in every configuration. At the moments the reserve binds, the
abandoned side is always falling. That is what being abandoned means.

The third was a cap on how far one side may run ahead of the other, which the
arithmetic said should work: if the player never finishes the losing side, it
keeps the money, and the money is what it needs at the reversal. It does keep the
money — the losing side stops at five hundred and eighty shares and the spend at
under half the budget — and the winning side still does not move a single share.
Which is the whole lesson again, from a third direction: the bid, not the money.

Nothing shipped. Both new knobs default to off, with their numbers written beside
them in the code, and the player is bit-for-bit the one that passed level 46 — I
re-ran that level at the new commit to prove it, forty-six of forty-six.

Four sessions of this now share a pattern worth saying plainly: every change I
have found either does nothing or trades one set of winnable markets for another.
The player wins fifty-eight of sixty, and the changes reshuffle which fifty-eight.
That is what parameter search looks like when it has run out of road, and it is
why next session goes at the measured constraint instead. The reserve should be
sized by what the abandoned side will actually cost — pennies, once the market has
made up its mind — not by any price it has already traded at. The first probe is
cheap and decisive: force the reserve to nothing from ninety seconds in and see
whether market forty-seven finishes. If it does, the work is finding the honest
rule that says when.

### Session 17, postscript: the best number of the day came at the very end

Having established that the bid rather than the money is what strands the winning
side, I ran the obvious combination — release the reserve AND refuse to finish the
losing side — and it is much the closest either blocking window has come. The
winning side goes from under three hundred shares to between six and eight
hundred, in both markets, repeatably.

It still does not finish, and the reason is clean enough to aim at. Forcing the
two sides to take turns means buying both of them at around fifty cents, and a
pair assembled that way costs more than a dollar however many shares it has. So
the player now fails on price where it used to fail on count. Both windows do
offer a cheap side — one of them is available for under a nickel for the last four
minutes — and what the turn-taking version does wrong is spend those minutes
topping up whichever side is behind at whatever it costs, rather than waiting for
the cheap one. That is an endgame rule, it is aimed at a number I measured rather
than a hunch, and it is where the next session starts.

---

## 2026-08-03 — Session 18: the two windows finally open, and one door closes behind me

The note I inherited said the way in was an endgame rule about buying only the
cheap side in the closing minutes. I did not test it, and I want to be clear
about why: before touching anything I pulled the second-by-second record of both
markets that block this level, and it disagrees with the story that plan was
built on. So I followed the record instead.

Here is what those two windows actually do. Fifty seconds in, the player has
already committed six hundred and fifty shares to one side at an average of
fifty-nine cents, and holds under three hundred of the other. Then the market
turns, and the side it neglected — the one that goes on to win — is offered
between forty-four and fifty-six cents for the next full minute. The player has
four hundred and thirty-nine dollars of its budget untouched. Buying that side
out right there, and topping the abandoned one up later when it is nearly free,
comes to about ninety-five cents a pair against a ceiling of ninety-eight. It is
sitting there in plain sight and the player buys none of it.

Three sessions have now found one reason or another for that, and each fix moved
the count a little and then stopped. The record explains why: there are two
rules, not one, and they cut the same side off within fifty shares of each other.
The first is the money — the player sets aside a reserve for the side it is
walking away from, sized off the cheapest that side has traded at, and the
reserve holds its bid four cents under the asking price. The second is a rule
about evidence: a side may only be held in proportion to how far apart the two
prices have moved, and in a near-even market that allows three hundred and forty
shares out of a thousand. Release the money and you get four hundred. Release the
evidence rule and you get five hundred. Release both and the window finishes,
complete, at ninety-six cents a pair — and it does it every time I run it, which
is not something this project has been able to say about a repair before.

The idea behind the second release is the one I would keep if I could keep only
one sentence from today. Rationing a side by how much the market has revealed is
right when buying it is a decision — you are choosing which outcome to own, and
early on you know nothing. It is wrong for the second side, because that is not a
second decision. The money is already spent; the second side is the only thing
that makes the first side's shares worth anything. A window that ends with a
thousand shares of one outcome and three hundred of the other is worth less than
one that never traded at all.

So both blocking windows now pass. The trouble is what came with them. Turning
that rationing off costs four markets elsewhere in the first sixty, and I got
three of them back with a test that reads well: chase the other side only when
the market has moved against the side you committed to — when your own holding is
trading below what you paid for it, the market is telling you your bet was wrong,
and that is exactly when you need the other side. It is a good rule. It is not a
reliable one. The fourth market and the two I repaired are separated by three or
four cents of a jumpy number, and when I ran the same six markets three times,
one run passed all six and the other two each dropped one. That is the honest
result and I am recording it as such rather than as a near miss.

Where that leaves the level: sixty markets, fifty-eight passing — the same count
as before, a different fifty-eight. The player still fails one market I need, and
it is no longer the one I started with.

I spent a while trying to find any instantaneous reading that tells the repaired
market apart from the one it breaks, and I could not, which is worth writing down
so nobody spends another session on it. Put them side by side and they are mirror
images: same share counts, same committed average to within a cent, same prices,
same budget, and the model built from the Bitcoin price contradicts the chase in
both. In one the side the player committed to expires worthless and in the other
it wins. Nothing visible at the time separates them.

That points somewhere quite different for next session, and it comes with a
measurement rather than a hunch. The two cases differ in speed. In the market
this repairs, the chase takes seven hundred shares over half a minute, in four
separate stretches. In the market it breaks, it takes seven hundred and fifty in
five seconds, one burst, and the burst is what leaves the other side two hundred
shares short with seventy dollars in hand. So the next thing to try is not
another price test but a speed limit: while the player is completing a side, cap
how fast it may buy. A side that is genuinely running away stays away and gives
you thirty seconds; a side that is briefly cheap gives you an instant, and
emptying the budget into that instant is the mistake.

Everything is committed. All four new switches ship turned off with their
measurements written beside them in the code, so the player is the one that
passed level forty-six, and I re-ran that level at the final commit to prove it:
forty-six of forty-six.
