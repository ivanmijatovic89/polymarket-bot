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
