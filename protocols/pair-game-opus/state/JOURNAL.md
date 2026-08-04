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

---

## 2026-08-03 — Session 19: five levels in one sitting, and an honest stop at the sixth

The plan I inherited was a speed limit. Last session had noticed that in the two
windows the player needed to win, it bought the neglected side gradually over
half a minute, and in the window it broke, it bought seven hundred and fifty
shares in five seconds. So: cap how fast it may buy, and the good case survives
while the bad one is starved.

I built it and it does not work. A speed limit slows the spending without
stopping it — the money still goes out, one clip a second instead of four at
once, and in both bad windows the cheap moment lasts long enough that the cap
never binds. What it does reliably is ruin the windows where speed is the whole
point. Across sixty markets the count fell as I tightened it: fifty-eight with
no cap, fifty-seven, fifty-four, and fifty-one at the tightest setting. Monotone
harm. It is now recorded in the code as a dead end with those numbers beside it.

The reason the reading was wrong is worth keeping. Those five-second bursts
looked instantaneous only because the purchase finished. Once a side is bought
out it stops being contested, so the record shows the market going quiet, and I
had read that quiet as the burst being over in an instant. When I put four
windows side by side at one-second resolution and measured the thing that
actually precedes the buying rather than the buying itself, the picture inverted
and became clean.

Here is what separates them. Before the player commits its remaining budget to
the side it is behind on, ask how long the market has been saying that side is
the one to buy. In the two windows where the chase is right, the book has been
saying it for twelve to fifteen seconds, in stretches, before the chase is even
half done. In the windows where the chase is a mistake, it has been saying it for
one second, sometimes two. A regime change is something a market keeps saying;
one tick of a side being dearer is a flicker, and emptying the ceiling into a
flicker is how a window ends with one side finished, the other two hundred short
and seventy dollars sitting in hand. That is a twelve-second waiting period
before the exemption may fire, and it is the discriminator three sessions of
price tests could not find.

Two smaller gates came with it. One window armed the exemption when the two
sides were seven hundred and nineteen against seven hundred and eighty-one —
sixty-two apart, the imbalance essentially gone — and spent the ceiling closing
that gap. So the exemption now also has to find an imbalance actually worth
having when it fires. And the third gate is a test from last session that I had
written off: the side the player is committed to must be marked down against both
its latest price and its own half-minute average. Alone it was too jumpy to
trust. With the waiting period carrying the timing, it earns its place — it is
the only one of the three that catches a particular window forty-odd markets in.

With all three on, level forty-seven passes, and it passed three times running
before I believed it. Then it kept going: forty-eight, forty-nine, fifty and
fifty-one, each verified three times, none of them needing a single change. The
player now ships with these settings turned on by default, so a plain run is the
run that passed.

Level fifty-two is where I stopped, and I want to be clear that I stopped rather
than claimed it. Two runs of it pass completely; a third fails the newly added
market by a hundred shares, ending a hair over the cost ceiling instead of
comfortably under it. Two passing runs would technically be evidence. It would
also be a level that fails one time in three forever afterwards, poisoning every
regression check above it, so I am leaving it as the current level rather than
banking it.

One last thing I learned that will save the next session an afternoon. That
marginal market, run on its own, passes six times out of six with identical
numbers — it only fails inside the full fifty-two-market batch. The random
latency the game simulates is drawn from one stream shared across the whole run,
so a market's luck depends on how many orders the markets before it placed.
Diagnosing this one in isolation would show a perfectly healthy window and
explain nothing. It has to be caught inside the batch.

---

## 2026-08-03 — Session 20: the coin was never loaded, and four levels came off the back of that

The level I inherited had one market that failed roughly one run in three, and
the note I was left said something strange about it: run the market on its own
and it passes every single time, six times out of six with identical numbers, so
whatever goes wrong only goes wrong inside the full batch. The suggested
explanation was that the simulated network delay is drawn from one stream shared
across the whole run, so a market's luck depends on how much trading happened
before it.

That explanation is wrong, and finding out why is the whole session. The
simulator draws its random delay from the ordinary unseeded generator, which
means every run is an independent sample and a market's position in the batch
buys it nothing. Six identical probes did not prove the market was deterministic;
they were six draws that happened to land on the same side of a coin that comes
up badly about one time in seven. It is an easy mistake and an expensive one — it
sent the previous session looking for a batch-level effect that does not exist.

So the first thing I built was a way to repeat a draw. Thirty lines that replace
the random generator with a repeatable one, keyed off an environment variable.
The delays are still random and still within the same bounds; they are simply the
same random delays every time you ask for that key. With that in hand I ran the
troublesome market thirty-six times under thirty-six different keys, and five of
them failed. The diagnosis loop went from twenty-five minutes to thirty seconds,
and I could put a failing run and a passing run side by side and difference them.

They agree exactly for the first two minutes and eleven seconds. Then they part,
and here is what is actually happening. The player has bought most of one side
and is a hundred shares short on the other. It has ninety-two dollars left, and
that ninety-two dollars has to cover both those last hundred shares and three
hundred and forty more of the other side, so the plan says it may pay
fifty-six and a half cents. The offer on the screen is fifty-six cents, plus a
fee of one and seven tenths of a cent to reach out and take it. Fifty-seven and
seven tenths against fifty-six and a half. The player declines, by one and a
fifth cents — one dollar twenty-five on a thousand-share position. The offer never
comes back. The side ends a hundred shares short, everything already bought is
unmatchable, and the market loses forty-four dollars.

The fix is a second, higher spending limit that only a nearly-finished side can
reach, and only by taking an offer rather than resting a bid. The player's own
budget stops at ninety-seven cents a pair while the game scores against
ninety-eight, and that gap has always been insurance: a window that ends one side
short is scored against the pairs it actually completed, so spending right up to
the line and then falling short is the worst of both. The insurance is worth
holding while you are still building. It is worth nothing at all in the one
moment it costs you the market. So a side that is already nine tenths built may
now spend into it — never to grow a position, only to finish one, and never
through a resting quote.

All five failing draws now finish complete, at the same price the lucky draws
already reached. I then ran twenty-eight fresh draws of that market and every one
passed. And then the ladder simply opened up: fifty-two, fifty-three, fifty-four,
fifty-five, fifty-six, fifty-seven, fifty-eight and fifty-nine, three clean runs
each, with nothing changed between them. Eight levels in one sitting, seven of
which needed no work at all — which says the player was already good enough for
them and had been held up by a coin-flip nobody had noticed was a coin-flip.

The lasting thing here is not the spending rule, it is the seeding. Any future
"this market only fails sometimes" is now a thirty-second sweep instead of a
theory, and a single passing probe should never again be read as a verdict.

## Session 21 — eight more levels, then a wall worth describing

Levels sixty through sixty-six needed nothing. I ran them two at a time, three
runs each, and every one passed with the player exactly as the last session left
it. That is seven levels in about an hour of machine time and no thinking at all,
which is the pattern from last time repeating: the player is better than the
ladder for stretches, and then one market stops it dead.

Level sixty-seven was that market. It is a window that changes its mind. For the
first minute the two sides trade either side of fifty cents; then the DOWN side
leads for twenty seconds and the player buys four hundred and sixty-nine of it at
fifty-seven cents; then the UP side leads and the player buys the same amount of
that at fifty-five. Both halves of the pair bought expensive, which is the one
thing a pair buyer must never do — the whole game is buying the winner at fifty
cents and the loser at two. From there the UP side ran to ninety-nine cents and
never came back, and the player was left five hundred shares short with no money.

What was actually blocking it was subtler than the overspend, and this is the
part I would want a reader to take away. The player holds money back for the side
it is not currently buying, priced at the cheapest that side has so far traded.
Here it was holding about twenty cents a share for a DOWN side that would end the
window at two cents — roughly a hundred dollars set aside for shares that would
cost ten — while the side it was withholding that money from needed four cents
more to complete. The reserve is a sensible guess right up until the outcome is
no longer in doubt, and then it is money reserved against a price that will never
be seen again.

So: once the underlying bitcoin price has run clear of the level the market
settles on, far enough and in the direction of the side the player is buying, the
reserve stands down. "Far enough" turned out to matter. Releasing it the moment
the signal first fires is too eager and costs an earlier market that finishes
with a one-cent margin; requiring half again as much clears both, and both
windows finish on all eighteen seeded draws I threw at them. Level sixty-seven
then passed three times cleanly.

Level sixty-eight I did not get. It is worth describing because it is the same
mistake in mirror image and it beat me. The window opens as a coin flip, leans
one way for twenty seconds around a minute and a half in, and the player buys its
entire thousand-share leg inside that lean, at prices from fifty-six to
sixty-four cents. Eight tenths of everything it has, gone in twenty seconds, on a
side that then spends ten more minutes at even money and finally loses. There was
no reading available at the time that named the reversal.

I found four different ways to make that one market pass and every one of them
destroyed between twelve and thirty of the sixty-seven markets behind it. That is
the real lesson of the session and it cost me most of the afternoon: a change
tested on the market that is failing will always look like a fix, because I only
kept the ones that looked like fixes. The single-market probe is a way of
generating candidates, not of judging them, and I should have gone to the full
ladder two hours earlier than I did.

The deepest of those attempts is the one I would warn the next attempt off
hardest. The obvious diagnosis — "it owned too much of one side too early" —
leads straight to a cap on how much of a side may be owned, and a cap is the
third time this player has been offered that idea and the third time it has
answered the same way. Capped, the specimen passes beautifully at every setting I
tried. Capped, two dozen other markets end with a leg stopped exactly on the cap
and never resumed, because a side refused while it was cheap is unaffordable by
the time the cap lets go. The failures are always share counts and never prices,
and that signature is now written into the code three times over.

What I have not tried, and what I have left as the next step, is the same test
aimed at the right target: not how much you may own and not how much you may pay,
but whether this particular purchase, at this price, leaves the other side of the
pair buyable at what it is asking right now. I built that test during the session
and wired it to the wrong place — it turned out to guard a door the player was
not walking through. Moving it onto the ordinary buying decision is the untried
idea, and it will need care, because for most of any window the two sides sum to
slightly more than the pair budget, so a naive version refuses everything.

Nothing is broken, nothing is half-finished, and the player on disk is the one
that passed sixty-seven three times.

## Session 22 — five ways to lose the same argument

No new level this session. What I have instead is a much sharper picture of why
the market that blocks me is hard, and five measured dead ends that the next
attempt does not have to pay for again.

A reminder of the window. It opens as a coin flip. Ninety seconds in it leans one
way for about twenty seconds, and inside that lean the player buys its entire
thousand-share position on that side, at prices climbing from fifty-six to
sixty-four cents. Eight tenths of everything it has, gone in sixteen seconds. The
window then spends ten minutes back at even money and finally settles the other
way. The player is left holding a complete side it cannot match and a third of
the side it needed, with twenty-eight cents a share to buy shares that never go
below thirty-five.

Last session I established that capping how much of a side may be owned destroys
two dozen other markets. The note I left myself was to try the other question
instead: not "how much may I own" but "does this purchase leave the other side
still buyable". I built that this session, four different ways, and all four are
worse than doing nothing.

The first version simply refused the purchase. It stopped the runaway side at
nine hundred instead of a thousand and saved about sixty dollars, which was not
enough to buy anything, because the side the player was short of was capped at ten
cents by a separate rule and would not have bought at thirty-five anyway. So
refusing on its own is inert: the money is saved and then not spent.

The second version handed the initiative over instead of refusing — stop chasing
this side, start buying the other one. That fixed the market beautifully, at 0.962
a pair with a small profit, and cost twenty-four of the sixty-seven markets behind
it. The reason is arithmetic I should have seen sooner: the two sides of one of
these markets always sum to about a dollar, so "I cannot afford to finish both at
today's prices" is true in essentially every market from the first minute. It is
not a signal, it is the weather.

The third version tried to make it a signal by measuring it as a price. Finish the
side you are chasing at today's price, fund the other at the cheapest it has ever
been quoted, and ask what the chased side would have had to cost for the two
together to fit the budget. The difference is the discount your plan is quietly
counting on. In this market it is twenty-two cents — the plan only closes if the
side being chased becomes twenty-two cents cheaper than the screen. In the opening
minute of a normal market it is two or three. I thought that was a clean
separation. It is not, and the flaw is embarrassing in hindsight: the number is
divided by how many shares of the chased side are still to buy, so a side with
fifty left to go produces an enormous discount for arithmetic reasons alone. The
rule fires hardest on a side that is one clip from finished, which is the worst
possible moment to interrupt it. Nineteen failures.

The fourth version guessed that the harm came from a freeze rather than from the
handover — when the initiative changes hands, the demoted side drops to a
ten-cent limit and simply stops. Lifting that limit for a side that had just been
demoted changed the results by nothing at all. So the freeze is a symptom. By the
time any of these rules fire, the money is already spent, and giving a side its
allowance back buys nothing because there is nothing left.

The fifth was different in kind and I still think it was the best idea of the
session: a speed limit. Not a limit on how much you may own or what you may pay,
but on how much of the budget one side may absorb in any thirty seconds. It never
refuses anything permanently — whatever it withholds, the clock hands back a few
seconds later. This market is a burst in the literal sense and an ordinary market
never comes near the limit. It repaired the market and cost nine others, which is
by a wide margin the least destructive thing I have tried, and still nine times
too expensive. What it taught me is that in a market moving this fast, delaying a
purchase by twenty seconds is the same as refusing it, because the twenty seconds
you waited were the twenty seconds the price existed for.

So that is five families now — three kinds of cap on how much you may own, caps on
what you may pay, caps on total spending, reassigning which side you chase, and a
speed limit — and every one of them costs between nine and forty-three of the
markets that already work. They fail for one reason, and it is worth stating
plainly because it is the shape of the whole problem: the behaviour that loses this
market is the same behaviour that wins the other sixty-seven. Buying a side hard
while it is running is correct, and this is the market where it is not, and nothing
visible at the time distinguishes them.

I have stopped looking for a brake. The thing I noticed while reading the
timelines, and what I have left as the next thread, is at the other end of the
trade entirely. In the first second of this market the player pays fifty-nine and
a half cents for two hundred shares of one side while the other side is on the
same screen at forty-four. That single clip is a third of what makes the pair
unaffordable eleven minutes later, and it happens before any information exists —
the market is a coin flip at that moment and the player is simply buying the
dearer of two equally uninformative sides, because the rule that picks a side
reads "dearer" as "leading". Refusing that clip costs nothing, because nothing has
been bought yet. It is the only moment in this window where a refusal is free.

Everything on disk is the player that passed sixty-seven, re-verified this session
at sixty-seven out of sixty-seven. The five failed ideas are in the code with
their measurements written next to them and switched off.

## Session 23 — closing the opening, and one market that finally passed

No new level, but the session ended somewhere better than it started: for the
first time the market that has blocked me for three sessions passed on its own,
under a setting I can describe in one sentence, and I now know exactly which
nine other markets that setting costs me.

I began with the plan the last session left behind. The thought was that this
market's first purchase is a mistake made for free — in the opening second the
player pays fifty-nine and a half cents for two hundred shares of one side while
the other side is quoted at forty-four on the same screen, and refusing that
cannot strand anything because nothing has been bought yet. I built the refusal
two ways.

The first way asked the opening lean to survive before acting on it: wait a
second or two and see whether the book still leans the same way. It does change
the first tick — the player leads with the cheap side — and then the market ends
in exactly the same place, to the cent, at every delay I tried. The reason is
worth remembering. The rule that decides which side to buy keeps a running
average of each side's price, and that average is seeded on the very first tick,
so on the second tick a one-cent uptick on either side reads as "that side is
running away". Blocking the opening lean just hands the same decision to the
other rule one tick later, and it buys the same two hundred shares at the same
price.

So the second way replaced the direction rule outright: for the first few
seconds, lead with whichever side is cheaper, full stop. That does what it says.
The clip moves to the cheap side and the market's total cost falls by twelve
dollars. It still ends in the identical place, because twelve dollars is nothing
against the hundred and eighty-five it is short. And it is not free after all —
across the sixty-eight markets it costs eight that currently pass, all of them
in the familiar way, with one side left at half its target. Leading with the
cheap side means opening on whichever side is about to collapse. That thread is
now closed at both ends and the next attempt should not reopen it.

The better half of the session came from reading the timeline instead of the
plan. Late in the window the player finishes the side it has been chasing at
sixty-two cents, and it is allowed to do that because of a reserve: before
spending, it sets aside money for the other side, and it sets aside only sixty
per cent of the cheapest price that side has ever actually traded at. The other
forty per cent is a bet that the side will be cheaper than it has ever been by
the time the player gets to it. In this market the bet is wrong by about a
hundred dollars, and a hundred dollars is exactly what pays for the purchase
that loses it.

Reserving honestly instead — eighty per cent rather than sixty — wins the
market outright. A thousand shares of each side, a pair cost just under
ninety-seven cents, and a small profit. That is the first time anything has done
that without also handing the initiative to the other side. It costs nine other
markets, which is not a fix, but it is a foothold with a name and a mechanism
rather than another dead family.

Two things I checked while I was there. The first is that the parameter is
knife-edge: seventy per cent does not win this market, eighty does, ninety and a
hundred both lose it again in different ways. So I am not going to tune around
the number; I want to understand why eighty lands where it does. The second is
the most useful measurement of the session, and it reframes everything the last
three sessions concluded. Across all sixty-seven markets that pass, the realized
cost of a pair sits between ninety-five and ninety-seven cents against a budget
of ninety-seven. The player spends its entire allowance in nearly every market
it wins. There is no slack anywhere on this ladder. That is why every restraint
I have tried costs between nine and forty-three markets: withholding money does
not make this player careful, it makes some market end short. I also confirmed
there is about a cent of unused headroom against the rule's own limit and that
taking it is safe — and that taking it changes nothing, because the extra
budget just goes straight back into the purchase the restraint was meant to
refuse.

What is next is narrow and concrete for once. The nine casualties are a named
list, they all pass comfortably today, and I know the exact moment in the
blocking market when the honest reserve matters. The job is to find what
separates those nine from this one at that moment. Everything I built this
session is in the code, switched off, with its measurements written beside it,
and the player on disk is still the one that passes sixty-seven — re-verified
this session, sixty-seven out of sixty-seven.

---

## 2026-08-03 — Session 24: the signal I built a rule against turns out to be right

I went into this session with one lead from last time: eighty per cent honest
reserving wins the blocking market and loses nine others, and the job was to find
what separates them. So I read two timelines side by side — the blocking market,
and the market that most needs the player's aggressive instinct, one where the
favourite climbs from fifty-two cents to ninety-nine and never comes back.

They are nearly identical at the moment that matters. Both have the book leaning
hard, both have Bitcoin well clear of the price it has to beat, both have the
player spending most of its money in about twenty seconds. Everything the last
five sessions gated on reads the same in the two windows. One reading does not:
the player keeps its own estimate of who will win alongside the market's, and in
the market that really is trending the two agree, while in the blocking market
the player's estimate sits five to eleven cents above the market's for the whole
approach and keeps drifting further ahead. The story wrote itself — Bitcoin has
made a move the market does not believe, and over fifteen minutes the market is
the better judge.

So I built that: stop the leg that is ahead once the estimate runs too far ahead
of the market on it, hand the buying to the other leg while it is stopped, and
release once that other leg is finished. It took three attempts to make it work
mechanically, and the middle attempt found a real bug — a cap I set each tick was
left standing after one leg completed, so it went on refusing the only leg still
being bought, which looked exactly like the rule doing nothing. Fixed, it repairs
the blocking market properly: a thousand of each side, ninety-six and a half to
ninety-seven cents a pair, and it does that at every threshold from a half to
seventy-two per cent rather than at one lucky point. That is the first thing all
year to survive a whole band instead of a knife edge.

Then I ran it over all sixty-eight and it costs seven to nine markets, and the
reason is the interesting part. Every casualty is the stopped leg frozen exactly
on its cap — and in every single one of them, that leg is the one that goes on to
win. Eight windows settle on the side my estimate was running ahead of the market
on. The disagreement is not a warning at all; it is a good directional read,
right eight times out of nine, and the blocking market is its only miss. I had
built a rule to distrust the best signal in the player. It is now in the code
switched off, with that written next to it.

The other thing I did was work out the arithmetic properly, and it is worth more
than the rule. Counting the fee honestly, a pair bought while the market is still
a coin flip costs about a dollar three, and a pair completed after the market has
decided — winner at ninety-five cents, loser at three — costs about ninety-eight
and a half. Both are above the ninety-eight the rules allow. That means there is
no safe way to play this game: no amount of hedging early and no amount of
waiting produces an affordable pair on its own. The player has to bet on a
direction before the market has decided, and be right. Everything it earns, it
earns in the gap between catching the winner at eighty-five cents and catching it
at ninety-five.

That reframing produced one shape whose numbers work in both of the colliding
windows, and it is the first time that has happened. Hold both sides at about a
third of target, buy nothing more until Bitcoin has run clear of its target by a
high multiple of the day's own volatility, then buy the named side out at once and
finish the other in the closing minutes. In the blocking market the reading never
reaches that height for the wrong side, and reaches it for the right side twelve
minutes in, at eighty-two cents — the pair comes to ninety-seven. In the trending
market it reaches it a minute in at eighty-five cents, and the pair comes to
ninety-four. On paper both fit. Whether they fit in practice depends on how many
of the other sixty-six ever produce a reading that strong and how late, which is
one measurement run and is where the next session should start — measure the
table first, build the rule second.

The player on disk is unchanged in behaviour: sixty-seven of sixty-seven,
re-verified this session, and the sixty-eighth still fails the same way.

## 2026-08-03 — Session 25: the plan I was told to build, measured before building it

I came in with a clear instruction from the last session: build the thing where
the player holds both sides at about a third of what it needs, waits for Bitcoin
to run clear of its target by a large multiple of the day's swing, then buys the
named side out and finishes the other one late. On paper it was the first idea
whose numbers worked in both of the two markets that keep colliding. The last
session also said, sensibly, to measure it before building it.

Measuring it turned out to need something I did not have: a record of what each
market was doing for its whole fifteen minutes. The player's debug output stops
the moment it has finished buying, so half the markets simply go quiet halfway
through and I would have been reading a truncated picture. So I added a second
channel that reports once a second from the first tick to the last regardless of
what the player is doing, and ran it over all sixty-eight markets. That recording
is now the most useful thing in the workspace — three of this session's four
results came out of it without running the player at all.

The verdict on the plan is that it does not work, and it does not work for a
reason that is worth writing down. The signal it waits for is right about which
side wins in only about four windows out of five, and the more I raise the bar to
make it right more often, the later it speaks and the more the winning side
already costs by then. At the setting the last session proposed, fourteen of the
sixty-eight windows get pointed at the losing side, and twelve of them can no
longer be completed inside the budget — and that is with me giving the plan
perfect execution, no delay, and the losing side bought at the single cheapest
price it ever reaches. Against a player that currently misses one market out of
sixty-eight. Lowering the early holding to nothing at all still leaves seven
unaffordable. The plan was right about the two windows it was designed on and
wrong about the rest of the book.

The good news came from asking why that signal is so mediocre. It measures how
far Bitcoin has run from its target in DOLLARS — a fixed sixty of them, scaled by
the time left — so the same sixty dollars means the same thing on a quiet
afternoon and in a storm. Divide by how much Bitcoin has actually been moving in
the last few minutes instead, and the same reading goes from naming the winning
side in fifty-four of sixty-eight windows to sixty-five, and at a slightly higher
setting, sixty-six. That is a genuinely better instrument than anything the
player has had.

It is also much slower. It typically speaks nine or ten minutes into a fifteen
minute window, by which time the side it names already costs eighty-five cents.
So it cannot be used to decide what to buy — a player that waited for it would
buy every winner at the top, which is precisely the plan that just died. What it
can do is let something go. Last session ended with a cap that stops a leg when
the player's own estimate runs ahead of the market, which fixes the blocking
market and strands nine others — and in eight of those nine the leg it stopped
was the one that went on to win. That cap needs to be a delay rather than a
refusal, and this is the first thing I have that is reliable enough to end the
delay. Building that release, and testing it over all sixty-eight, is what the
rest of this session went into.

The release works exactly as designed and it rescues nothing, and understanding
why was the most useful hour of the session. I checked first that the witness
actually arrives: in all nine of the stranded markets it names the winning side
between two and twelve minutes in, and in the blocking market it never names the
side the cap stops, so there was no risk of undoing the repair. Then I ran it
over all sixty-eight and the failures did not move — nine before, nine after; the
stranded legs are still sitting on exactly the number of shares the cap allows.

The money is the reason. Stopping one side does not put anything aside; it hands
the buying to the other side, which then gets bought out completely. By the time
the release fires, one of those markets has spent seven hundred and eighty-nine
dollars of its nine hundred and seventy and still owes two hundred and sixty-three
for the shares it is missing. The permission arrives and there is nothing to
spend. For a stopped leg to be freed later, the money would have to be held back
as well as the shares — and holding the money back IS the plan that died at the
start of the session. So that whole family is closed, from both ends, which is
worth more than another inconclusive tuning run.

I also finally checked the assumption underneath four sessions of failed rules:
that the blocking market is doing something excessive. It is not. Ranked against
the other sixty-seven it is fourth in how much it pays for shares the outside
price has not confirmed — and twenty-six markets are at the ceiling of that
measure — and twelfth in how far it commits past its own remaining money, with
eleven markets that pass going further. Buying dear, and buying past your budget
on the bet that the other side gets cheap, is simply how this player works
everywhere. That is why every rule that scores the player's own behaviour fires
in forty markets or in none.

Which points where to look next, and I have left that written down. Nothing about
the player's own state distinguishes the market that blocks the level. What might
is the behaviour of the market around it: in the blocking window the favourite's
price runs from forty-six cents to sixty-four and back to forty-five inside a
hundred seconds, then sits at a coin flip for ten minutes; in the window that
most needs the aggressive buying, the favourite goes to eighty-five cents and
never comes back. Nobody has measured how the two look while it is happening. The
recording to do it with now exists, and the session that tries should measure
before it builds — which, on this evidence, is worth about four experiments to
one.

The player on disk is unchanged: everything added this session is switched off by
default, sixty-seven of sixty-seven still pass, and the sixty-eighth still fails
the same way.

---

## Session 26 — the level breaks, and then eleven more

The last session left a note saying: stop looking at what the player does and
look at what the market around it does. That turned out to be right, though not
in the way it guessed, and the level that had held for five sessions fell in the
first half of this one. The player is now eleven levels further on.

I started by following the note literally. The recording from last session was
still on disk, so I could ask the question offline, without running the player at
all: at the moment each of the sixty-eight markets makes its big commitment, how
does that market look? I built a scan that finds the commitment on its own — the
largest burst of spending on a side the market has already made expensive — and
then ranks that moment against all sixty-eight on everything I could think of.
How dear the price is. How wide the gap between the two sides. How fast the price
had moved to get there. How choppy the market had been. How long the favourite
had been the favourite.

The blocking market is thoroughly ordinary on every one of them. Twenty-sixth of
sixty-eight in the price it pays, twenty-sixth in the gap, middling in the rest.
That is the fifth independent confirmation of the same thing, and it explains why
five sessions of rules all died: there is nothing in the *price* that tells this
market apart from the ones where the same aggressive buying is exactly right.

So I looked at something the player had never recorded: not the price, but the
size sitting behind it. Every quote has a queue of orders behind it on each side,
and the recording had simply never captured how big those queues were. I added
that to the observation channel — a logging change only, nothing the player acts
on — and re-ran the sixty-eight markets to get four minutes of new data.

It separates them cleanly, and the reason is intuitive once you see it. At the
instant the player commits in the blocking market, eighty-five per cent of the
size near the top of that side's book is people wanting to buy and only fifteen
per cent is people willing to sell. It is third-highest of the sixty-eight, and
higher than every one of the eighteen markets already known to break if you hold
the player back. The market it collides with most — the one where the aggressive
buying is essential — never comes close to that reading. The price had gone up
because nobody was left selling, not because anyone had bought size. It was a
rally nobody funded, and the player was paying for it as though it were news.

The rule follows directly: when the leading side's own offer has been emptied
out like that, stop buying it and put the money into the other side, which is
cheap for precisely the same reason. That is what makes this different from the
seven families that failed before it — none of them saved money, they only
redirected it, and here redirecting it is the entire point.

The first version worked on the blocking market and cost six others. Both times I
looked at why, the answer was in the data rather than in tuning. The casualties
that survived a tighter threshold were all triggering in the first half-minute of
their window, when a market has just opened and there is barely anything resting
on either side, so the ratio is meaningless — a single order empties a queue that
shallow. Standing the rule down for the first forty-five seconds left exactly one
casualty. And that last one differed from the blocking market on a reading I had
already measured and not used: its favourite had been the favourite for a full
minute, while the blocking market's had crossed over eleven seconds earlier. A
side that has been expensive for a minute has had its sellers bought through; a
side that jumped eleven seconds ago has an empty offer because nobody has posted
one yet. Only the second is evidence of nothing. Requiring the move to be fresh
took it to zero.

Sixty-eight of sixty-eight. And unlike everything before it, this is not balanced
on a knife edge — the blocking market is repaired across a wide range of both
settings, and the full set comes in clean at several of them.

Then the levels came quickly. Sixty-nine passed first try. Rather than climb one
at a time, I probed the next forty markets individually — each market is an
independent fifteen minutes, so a level passes exactly when all its markets do —
and found the next real obstacle at market eighty. Everything between is clean,
so I took the formal evidence for levels seventy through seventy-nine. Worth
noting: all seven of the failures further out fail identically with the new rule
switched off, so the rule costs nothing out there either.

The market that blocks level eighty is almost a mirror of the one that just
fell — it opens even, one side runs to sixty-four cents inside fifty seconds, the
player buys that entire side, and the market drifts back to even and settles the
other way. The encouraging part is that the new reading *does* see it: the
emptied-offer signal crosses its threshold at forty-five seconds. The rule
doesn't fire because I told it to stand down for the first forty-five seconds,
and by fifty the buying is already finished. The protection that saved three
markets is what lets this one through.

That gives the next session a concrete first move rather than a search. The
forty-five-second delay is a proxy for something better stated directly: don't
trust the ratio until there is enough size in the book for the ratio to mean
anything. Replacing the clock with an actual size requirement is the same idea
said honestly, and it would let the rule arm earlier in markets whose books fill
up quickly. That is a measurement to make first, on data that already exists.

## Session 27 — the suspect was innocent, and four levels fell

I came in with a confident theory handed over from last session, and the first
useful thing I did was disprove it.

The market blocking level eighty opens even, one side runs to sixty-four cents
inside fifty seconds, the player buys that entire side, and the market drifts
back and settles the other way. Last session found that the new "the offer has
been emptied out" rule *does* see this — its reading crosses the threshold at
forty-five seconds — and concluded that the forty-five-second stand-down I had
added to protect three other markets was what let this one through. It read like
a clean tragic irony: the protection that saved three markets is what loses this
one.

It was wrong. I turned the stand-down off entirely and re-ran all eighty markets,
and the blocking market failed in exactly the same way. So I went back to the
player's own second-by-second record and looked at what the rule was actually
doing. The reading peaks at 0.71 against a threshold of 0.70 — it grazes it — and
it falls back under the threshold in precisely the seconds when the side being
bought crosses the level where the rule is supposed to lock in. The rule
recomputes itself every tick but only *latches* once the leg it is capping has
actually reached the cap; if the reading blinks off in that window, the leg walks
straight past and the rule never engages again. A tiny structural gap, invisible
in the failing market's summary, and it had nothing to do with the clock.

That reframes the fix as a threshold question, so I measured the threshold rather
than guessing. Over all eighty markets, 0.70 loses the blocking market, 0.62 and
0.64 each cost a different market that has to be chased hard, and 0.65, 0.66 and
0.68 are all clean. So there is a real band, not a knife edge, and 0.66 sits in
the middle of it. At that setting the blocking market plays out the way it
should: the rule stops the expensive side at eight hundred shares, hands the
buying to the other side, which is cheap for exactly the same reason, and the
market finishes complete and profitable instead of two-thirds empty.

Then I went back to the idea the handover note had actually asked for, which was
worth doing on its own merits. The forty-five-second clock was always a proxy —
the honest statement is "don't read the ratio until there is enough size in the
book for a ratio to mean anything". I added that reading to the player, measured
it, and the separation is clear: at the instant the rule arms, the markets the
clock was protecting are carrying twelve hundred to seventeen hundred shares near
the top of the book, while the market blocking level eighty is carrying
thirty-one hundred. Requiring twenty-five hundred replaces the clock exactly, and
it turns out to be better than the clock on both things I could measure — it
tolerates a wider range of thresholds, and probed out to a hundred and ten
markets it leaves fewer failures ahead. I want to be honest about the size of
that second claim: it is five failures against six, and when I repeated the run
the difference moved, so it is inside the noise of the simulator's own random
latency. The part that repeats is the market at level eighty-one, which the size
requirement holds and the bare clock-off configuration does not.

With that in, level eighty passed, and so did eighty-one, eighty-two and
eighty-three. I re-ran eighty a second time to be sure it was not a fluke of the
randomised timing; it passed again.

The market that blocks eighty-four is a different animal, and I think a more
interesting one. It opens at a coin flip and then walks steadily to near-certainty
on one side over fifteen minutes — no spike, no reversal, nothing tricky. The
player is simply on the wrong side and cannot get back. Within the first *fifteen
seconds*, before the book has said anything at all, it has already committed
nearly five hundred shares to one side against two hundred on the other. It then
sits still for two minutes while the price runs away from it, completes the losing
side cheaply, and finds it has four hundred dollars left against a bill of five
hundred and fifty for the shares it still needs. Every step after the first
fifteen seconds is forced. So the thread to pull next is the opening: what buys
that much, that fast, on a book that is dead even, and whether it should be
allowed to. That is a part of the player I have not touched in this game.

Worth noting the general lesson, because it cost the last session: a single
failing market does not name its own cause. The way to test a stated cause is to
switch the suspected rule off and see whether the market changes. That takes one
sweep and about two minutes.

## Session 28 — levels 84, 85 and 86

Three levels this time, and they came from one idea applied twice — the second
time correctly.

I started where the last session pointed: the opening. The player had bought
nearly five hundred shares of one side in the first eight seconds of a window
that then went the other way. Reading its own minute-by-minute log, the reason
turned out to be sharper than "the opening is unguarded". The player has a rule
that says it may only hold as many shares as the price gap between the two sides
justifies — a wide gap is the market telling it something, so a wide gap buys a
bigger position. In this window the gap opened eight cents in seven seconds, the
rule granted an allowance of about four hundred and seventy shares, and the
player put every one of them on the side that then reverted. The allowance was
not wrong; the evidence it was reading was.

Because what actually happened in those seven seconds is that a price moved a
long way on almost nothing. There were about a thousand shares resting near the
top of the book. For the rest of that same window there were three to five
thousand. A price that moves eight cents when a thousand shares are available is
not the market forming an opinion — it is a thin book being pushed around. And
this is exactly the lesson the previous session learned about a different rule:
a share of nothing is not a reading. It had been applied to one place in the
player and not to the other.

So I gave the sizing rule the same requirement: below a floor of resting size,
the price gap does not count as evidence. Over the first eighty-four markets
that passed everything — level eighty-four included, on the first try. I
committed it and moved on.

And then it broke the very next market, which is worth recording as its own
lesson. That window opens already leaning, trends one way for twenty-five
seconds, and only turns after the player has finished buying both sides. It is a
window the player has to buy into — and the whole of that twenty-five seconds
happens on six hundred to fifteen hundred shares. My floor refused it outright,
so the player waited, and finished the same purchase twenty seconds later five
cents a share worse, which left it short on the other side. A market it used to
win, it now lost.

The fix was to stop treating the floor as a yes/no question. A book with half the
required size now counts for half. The thin seven-second spike gets held to a
third of its allowance instead of all of it; the genuine twenty-five-second trend
still gets to buy, just less at first. That version passes eighty-four, eighty-
five and eighty-six, and it does so at every floor value I tried between twelve
hundred and two thousand shares, which is a much wider tolerance than the
yes/no version had. All three levels are recorded with their own scored runs.

The market blocking eighty-seven is a harder one and none of my new tools see
it. It opens at a coin flip on a thick book and grinds one direction for three
full minutes — no spike, no thin book, and the independent price feed agrees with
the market the whole way up. The player follows it and completes that side at the
very top of the move, paying its dearest price of the window for the last three
hundred shares, and then the market comes all the way back and settles the other
way. There is no recovery from that. The one thing that looks wrong on its own
terms is that final purchase: the player has a rule that exempts a nearly-
finished side from its own pacing, on the reasoning that shares it already owns
are worthless unmatched — and that exemption is what pays top price here. That is
where I would look first.

One process note for whoever picks this up. I nearly shipped a change that
passed the level I was working on and broke the next market along. It cost
nothing because sweeping five markets past the current level takes two extra
minutes, and I now do that before believing any level.

## Session 29 — eighteen levels, and one that passed on luck

This was the best session the loop has had, and it ends with a caveat worth
reading before the number.

The player went from level eighty-six to level one hundred and four. Two
changes did it, and both came out of the same habit: read the player's own
minute-by-minute log of the market that blocks it, find the exact instant the
money went wrong, and then check whether the rule you suspect is actually the
one that fired.

The first market opens at a coin flip, grinds one way for three minutes, and
the player follows it and buys that side out at the top. Then the market comes
all the way back and settles the other way. The previous session's note said to
look at the rule that lets a nearly-finished side ignore the player's pacing. I
turned that rule off and the market did not change by a single share, so the
note was wrong — worth saying plainly, because acting on it would have cost the
session.

What was actually happening was much smaller and much later. Six minutes after
the mistake, the market offered the side the player still needed at twenty-eight
cents. Buying six hundred of them would have closed the position at ninety-seven
cents a pair and turned a four-hundred-dollar loss into a small profit. The
player refused, because its own safety margin said it could afford twenty-nine
point nine seven cents. It missed by a cent, and there was no second offer.

The obvious fix — give the player a slightly bigger budget — repairs this market
and breaks one from level thirty-nine, which spends the extra cent early and
strands itself. So instead I gave the extra budget a much narrower door: it
opens only when one side is already complete, and then only for the side still
being bought. At that point the player is holding a thousand shares whose entire
value depends on finishing the other side, so every dollar the ceiling holds
back is a dollar that buys nothing at all. Over a hundred and ten markets it
repairs the one and moves nothing else. Levels eighty-seven through ninety-four
followed immediately.

The second market is a different animal. The player had already done the hard
part: it held seven hundred of the side that eventually won, and was two hundred
dollars from finishing both. Then the side it had committed to spiked twenty
cents against it over fifteen seconds. The player has a rule that reads a
committed side trading below what it paid as the market disagreeing with the
commitment, and switches to buying the other side hard. That rule fired, four
hundred and sixty-nine shares went out in four seconds at thirteen cents above
where that side had traded half a minute earlier, and the spike was completely
gone fifteen seconds later. What remained could not finish either side.

The rule already had two guards against noise, and both of them are prices read
at the same instant — a last quote and a thirty-second average. A twenty-cent
move in fifteen seconds drags a thirty-second average a long way, so both guards
agreed. The thing that separates a real turn from an excursion is not visible in
any price at the moment it starts; it is only visible afterwards, in whether the
move is still there. So I gave the rule a clock: the verdict now has to stand
for twelve continuous seconds before the player is allowed to act on it. Eight
seconds is too short, twenty breaks a market whose turn is genuine and starts
inside that window, and ten through fifteen all behave identically. Levels
ninety-five through one hundred and four followed.

Now the caveat. Level one hundred and five failed, and it failed on a market
that levels one hundred and three and one hundred and four had already passed.
I ran that market four times and it passed once. So two of the eighteen levels
this session claims were caught on a good roll of the simulator's latency dice,
and the honest floor without a real fix is one hundred and two.

The good news is that I know exactly why, and it is a bug rather than a mystery.
Two runs of that market are identical to the second for two and a half minutes.
Then the book spikes, and in the winning run a safety cap notices that almost
all the resting size has piled onto one side, stops that side at eight hundred
shares, and sends the money to the other side — which is being offered at a
third of a dollar and turns out to be the winner. In the losing runs that cap
never switches on at all, the favoured side runs from seven hundred to a
thousand inside the spike, and the other side never moves. The cap does the
entire job when it engages; whether it engages is decided by twenty milliseconds
of simulated network delay, because it only arms if it happens to observe the
side sitting at exactly the right share count while the reading is elevated, and
a burst that jumps straight past that number never gives it the chance. This is
a trap already written down in this workspace from an earlier session, in almost
those words. It should arm on the reading, not on the holdings.

That is the next session's first job, and fixing it repairs three levels at once
rather than one.

## Session 30 — the coin flip is gone, levels 105 to 107

Last session ended with a warning: two of the levels it claimed had been caught
on a lucky roll of the simulator's network delay, and the honest floor was one
hundred and two. This session's job was to make that market pass every time, and
it does now — four runs out of four, where before it was one in four.

The diagnosis handed over was nearly right and the prescription was wrong, which
cost me most of the session to find out.

The player has a safety cap that stops it buying more of the side the whole
market is piling onto, and hands the money to the other side instead. The cap
itself was working fine. What was broken was the switch that makes the cap
permanent and triggers the handover: it waited to actually SEE the side sitting
at eight hundred shares. In one run a fill lands exactly on eight hundred and
everything works; in another the same fill lands on seven hundred and seventy
nine, the reading fades a couple of seconds later, and eight seconds after that
the side runs to a thousand while the other one sits at four hundred. Two
hundred milliseconds of difference in when an order arrives decided between a
seventy-five dollar profit and a four hundred and twenty seven dollar loss.

The obvious repair — flip the switch as soon as the cap would clamp the next
order — works perfectly on that market and destroys another one twenty markets
earlier, where it stops the side that eventually wins and spends everything on
the loser. I also tried simply keeping the cap alive longer once it has armed,
which fixes the target market but strands two much earlier ones with eight
hundred shares of a side they can never finish. And I tried an old unused knob
that reserves the honest cost of the second side before letting the first one
buy: seventeen failures out of a hundred and ten, which is the same lesson this
workspace keeps relearning — money withheld from a side does not make the player
careful, it makes some market end short.

What actually separates the two markets is speed. In the one that needed the
cap, the side took a hundred and fifty shares in the three seconds before it was
stopped. In the one the cap ruined, the side took thirty-one shares in the
previous half minute. So the switch now flips when the side is buying faster
than the room the cap has left it — not when it happens to be observed at a
particular number. Both markets are now solid, and so is a third that was
sitting on the same edge.

There was one hour of that lost to a plain oversight: the counter I was reading
the buying rate off was only being maintained when a different, disabled feature
was switched on, so my rule was reading zero and doing nothing. Worth
remembering — the sweeps looked like the idea was failing when the code simply
was not running.

Levels one hundred and five, one hundred and six and one hundred and seven all
pass, and the honest floor is now the recorded one rather than two levels below
it.

Next is level one hundred and eight, and the two markets that block it are
consecutive and identical in shape. In both, the market wobbles either side of a
coin flip for three minutes, the player buys out the side that is drifting down,
and then the market turns and runs the other way for the rest of the window. It
ends holding a thousand shares of the loser and two or three hundred of the
winner, which by then costs more than the money left. Unlike everything I have
fixed so far these are not accidents of timing — they are the player backing the
wrong horse, twice in a row, and no amount of care about caps and latches will
help. That is a harder problem and it is where the next session starts.

## Session 31 — level 108, and the difference between a lag you have and a lag you just made

Last session left a firm prediction: the two markets blocking level 108 were the
player backing the wrong horse, and fixing them would need a different kind of
change from all the caps and timers that came before. That turned out to be half
right in a way that is worth reporting carefully, because the half that was
wrong is the more useful half.

I started by watching the first of the two markets tick by tick instead of
reasoning about it. The picture the last session described was accurate — the
player buys a little of each side in the opening seconds, sits still for two
minutes while both sides are quoted at a hundred cents the pair, and then
commits everything to the side that loses. But the reason it commits that way is
not a judgement about direction at all. It is a rule with a loophole.

The player carries a tiebreaker for those quiet, evenly-priced windows: when its
own estimate of who is winning disagrees with what the order book is charging,
it follows its own estimate. That disagreement has to be large before it counts
— unless the side it points to is already far behind on shares, in which case a
much smaller disagreement is enough. The reasoning is sound: when you are
lopsided, following the disagreement and evening yourself up are the same
action, so a wrong call costs you nothing you did not already need.

Two things had gone wrong with that. The first is that once the small threshold
had ever been used, it stayed in force for the rest of the window even in
situations it was never meant to cover. In this market a disagreement large
enough to count appeared for eight seconds, three quarters of a minute in, and
from then on a disagreement a third that size was enough to keep the player
pointed at the losing side for the next three minutes while the book walked
steadily the other way. Making the small threshold answer only to the situation
that licensed it took the market from two hundred shares of the winner to six
hundred and fifty, and cost nothing anywhere else.

The second is more interesting and it is the part last session could not have
seen. With the first fix in, the player chases the correct side for three
minutes — and then, in a single second, buys two hundred and seventeen more
shares of it as the price jumps. That purchase is what puts it far enough ahead
to unlock the small threshold, which fires on the very same tick and sends it to
the other side, where it spends two hundred and sixty of its remaining three
hundred and ninety dollars. It was not lopsided and therefore following the
disagreement cheaply. It made itself lopsided a third of a second earlier, by
deliberate choice, and the rule read the result as a condition it had been
living with. Requiring the imbalance to have stood for ten seconds before it
counts closes that. The window now passes, comfortably, on every draw I tried.

So the prediction was wrong about the diagnosis and right about nothing being
easy. This was not the player failing to judge direction. It was two rules, both
defensible on their own, conspiring so that the act of backing the right horse
immediately triggered the machinery for backing the other one.

Level one hundred and eight passes, on two independent scored runs.

I have to report one thing plainly. A third run of the same level, at the same
settings, failed — on a much older market, not either of the two I was working
on. I chased that down rather than re-running until it passed. That market is a
genuine coin flip: it fails about two draws in twenty-four, and it fails
identically on the previous version of the player, so it is not something I
introduced. It has been sitting under levels one hundred and one through one
hundred and seven the whole time, and those were all recorded over it without
anyone noticing. Twelve single-market probes in a row passed before the level
run caught it, which says something uncomfortable about the four-probe check the
workspace has been relying on.

The good news is that it is no longer a rumour. Fixing the random number
generator to a known value makes it reproducible, and two specific values fail
while twenty-two others pass. Comparing a failing run against a passing one at
quarter-second resolution shows the whole thing turns on one resting order: both
draws are identical up to a quarter past the twenty-fifth second, both have the
same bid sitting at the same price, and one of them gets fifty-three shares off
it before its own re-quote pulls it while the other gets four hundred and
seventy-seven and finishes the side outright. Everything after that is
consequence.

What is genuinely encouraging is that the losing draw of that market, the
remaining blocker at market one hundred and nine, and market one hundred and
eight before I fixed it all end the same way: the player takes one side from
half-built to complete in a single burst, in the middle of the window, at a
price near a local peak, and the money that burst spends is exactly the money
the other side needed. Three different routes into one shape. That looks like
the next real thing to solve.

I tried the obvious version of solving it — forbidding a chase that starts from
behind to overtake the side that is ahead — and it was much worse, twelve
failures against one. The reason is instructive and I have written it into the
notes: the two sides then cap each other and the player deadlocks, unable to buy
anything at all, which is a failure mode this workspace has now discovered from
three separate directions.

Next session starts on market one hundred and nine, which is fully diagnosed and
waiting: the fatal act there is not the decision to chase, it is the last three
hundred and twenty-nine shares of that chase, bought at the top of a jump that
completely reverses two minutes later.

## Session 32 — the purchase that loses market 109 looks exactly like the ones that win

I came in with a clear target. The market blocking level one hundred and nine
spends five hundred dollars buying one side of the bet in twenty seconds, at the
top of a move that then completely reverses, and the money it spends is exactly
the money the other side needed. Last session had traced the fatal act down to
the final three hundred and twenty-nine shares. My plan was to find something the
player could see at that moment that would tell it to stop.

There isn't one, and proving that is the main thing I have to show for the day.

I wrote a small tool that replays every market in the regression set and reports
what the order book looked like at the exact tick where the player first finished
one side. Then I put the losing market's row next to the hundred and nine others.
At the moment it commits, the other side is quoted at thirty-six cents, it
already holds a third of that side, it has spent about eighty per cent of its
budget, the underlying is pointing the right way but only weakly, and the resting
size is leaning its way. Every single one of those numbers sits comfortably inside
the range of markets that go on to pass. Around twenty windows finish a side on
worse readings than that — one of them commits with the underlying pointing
firmly the wrong way — and they all come out fine. The difference between them
and the failure is not visible at the time. It is just which way the price went
afterwards.

That closes off a whole family of ideas at once, and it closes them with a
measurement instead of an argument, which is worth more than another failed
experiment. Nobody needs to try a price cap on the finishing order, or a "wait
until the other side is cheap enough to sweep" test, or a confidence check on the
last purchase. I also built the two most promising versions properly rather than
assuming, and measured them: a rule that stops any side eating more than a third
of the budget in half a minute and hands the buying over to its partner costs
twenty-eight markets to save one, and a version of the ceiling check applied only
to the finishing order costs forty-nine. Both are now in the code, switched off,
with their numbers written next to them.

The interesting part came from looking in the opposite direction. Everything this
player has been taught for thirty sessions is about restraint. But the losing
market has a two-minute hole in the middle of it where the player does nothing at
all: it holds a third of one side, its own accounting says it is already carrying
more than the evidence justifies, and its bid sits one cent under an ask it is
not allowed to take. Then the market turns and the money goes to the wrong side.
Had it simply finished the side it was already holding during that stall, at
fifty-four cents, it would have won the market by the largest margin of any
scenario I have looked at.

The reason it can't is a one-way ratchet. The allowance the player grants itself
grows when the two prices separate and shrinks when they come back together, but
the shares it bought under the wider allowance stay bought. So a quiet market
leaves it holding a position it is not permitted to add to and not permitted to
sell, and it simply freezes.

I built a release for that: a side that has been stuck over its allowance for
twenty seconds is treated as a commitment to be finished rather than a position
to be rationed. It repairs the blocking market outright, comfortably, and costs
six others. Six is far too many to ship. But every one of those six fails in the
same recognisable way — one side complete, the other left stranded — which says
the release itself is right and the open question is which side is allowed to
take it. I tried the obvious narrowing, requiring the whole window to have gone
silent rather than just one side being over its ration, and it does cut the
casualties, but it delays the release in the blocking market past the moment the
book turns, so the repair evaporates. That is where the next session should
start.

One more thing worth saying plainly, because it affects how much anyone should
trust a passing run. I ran the unchanged player over the same hundred and ten
markets three separate times today and got one failure, one failure, and three.
The two extra markets then passed four probes each on their own. So the flaky
market this workspace found last session is not alone — there is a tail of
markets that pass or fail on the roughly twenty milliseconds of simulated network
jitter, and a level run can fail on one the sweep has never shown you. I have
written that into the notes rather than quietly re-running until it looked clean.

Level one hundred and nine is not passed. What I have instead is a much smaller
search space and one live lead.

## Session 33 — the promising release turns out to be a coin flip, and the money was never the price

Level one hundred and nine is still not passed. But the lead I inherited is now
closed with numbers rather than left hanging, and two more ways out of that
market are closed with it, so the ground under the next attempt is a lot firmer
than it was this morning.

The inherited idea was this. In the market that blocks the level, the player
freezes for two minutes in the middle of a quiet window: it is holding a third
of one side, its own bookkeeping says that is already more than the evidence
justifies, and so it may neither buy more of that side nor sell any of it. Then
the market turns and the money goes to the other side, which loses. The proposed
fix was to treat a side that has been stuck like that for twenty seconds as a
commitment to be finished rather than a position to be rationed. It repairs the
blocking market outright and costs six others, and the previous session's read
was that the release itself is right and the only open question is which side
should be allowed to take it.

I built the instrument to answer that question — a single line printed at the
exact instant the release fires, carrying everything the player can see at that
moment — and the answer was not the one I expected. The market that must be
repaired and the first market that must not be look the same to the cent. Both
release a side holding three hundred and forty-four shares against a two-hundred
share ration; both have that side quoted at about fifty-three cents and its
partner at about forty-eight; both have the same money left, and in both the cost
of finishing one side and sweeping the other comes to about one and a seven
hundredth of what remains. Share held, past ration, idle time, the underlying,
the depth of the book — I checked all of them and none of them puts the one
market on a different side of any line from the other. The only thing that
differs is the clock: one fires at fifty-four seconds into the window and the
other at a hundred and ten.

So I tried the clock, with the story that a side over its ration in the first
minute is one that outran an allowance which had not yet been granted, while a
side still stuck two minutes in is one the market has walked away from. It halves
the damage and it is still wrong, and the reason it is wrong is worth writing
down: a clock does not refuse a release, it postpones one. The side is still over
its ration at ninety seconds, so it simply fires then instead — and one market
passes when the release comes early and fails when it comes late, which no
version of "early releases are premature" can survive. Adding a second condition,
that the release belongs only to the side the market currently prices as the
favourite, is the best gate I found and it still leaves two markets broken
against a baseline of one. The thresholds straddle: the number that has to be
above the line in the market I want is below the line in two markets I would
break.

The blunt summary is that six of the seven releases hand the window to the side
that goes on to lose. That is not a sound mechanism waiting for the right gate.
It is a directional bet placed while the market is at a coin flip, and it is
wrong most of the time — which is exactly what the budget arithmetic in this game
has been saying for thirty sessions.

The second half of the session was more useful, because it corrected something I
was about to build on. The blocking market's winning alternative is to finish the
side the player already holds, at around forty cents, while the other side is
being chased. I was sure I knew why the player cannot do that: there is a rule
that holds whichever side is not being chased to a ceiling of ten cents, on the
theory that a losing side can always be swept for pennies at the end, and this
side never trades below thirty-four cents again. So I built a release for that
ceiling — a side already a third built is not a side you sweep, because every
share in it is worthless unless it is finished — and measured it at four
settings. The market did not move by a single share at any of them. Same result,
same cost to the cent.

The ceiling was innocent. What actually refuses that side is the money: the
player's cap on the side it is not chasing is the smaller of a price rule and a
budget rule, and with eight hundred shares of the chased side still to buy near
sixty cents, the budget rule works out to about thirty-two cents against an ask
of thirty-nine. Lifting a price ceiling cannot fund a side whose money has
already been reserved for the other one. There is one pot, and after the player
switches which side it is backing, the side left behind is not overpriced — it is
unfunded. That reframes the whole market and it is now written into the notes as
a fact rather than an assumption.

Two more doors closed on the way past. Slowing the chase down so it stops paying
up into the jump leaves the losing side at a full thousand shares in every
setting I tried, because the market then spends four minutes at those prices and
the orders fill anyway, a little more cheaply and just as fatally. And forbidding
the player to ever switch which side it backs — an idea from thirty levels ago
that keeps suggesting itself — costs twelve markets when re-measured against
today's player, four of them ending with one side complete and the other at zero.

So the market comes down to one sentence: the player has to commit to the side
that eventually wins, at the moment the order book, its own model of the
underlying, and the following four minutes of price action all point the other
way. I do not have a way to do that yet, and I would rather hand over an honest
map of the dead ends than a lead I have already measured out. Everything built
this session ships switched off, with its numbers in the code next to it, and the
unchanged player still runs exactly as it did.

## Session 34 — three more ways out of the blocking market, all of them closed, and one number that explains why

Level one hundred and nine is still not passed, and I want to be straight about
that up front. What this session produced is not a step forward on the ladder but
a much smaller room to search in, and one measurement that I think is the most
useful thing anyone has learned about this player in a while.

I started from the one route the previous session left open. The blocking market
goes like this: for the first two minutes it is quiet and the player builds a
third of one side and a fifth of the other. Then the order book turns hard, the
player switches which side it is backing, and spends five hundred dollars taking
the new side from a fifth to complete — at prices that rise the whole way, with
the biggest purchase at the very top. The move then reverts completely and the
side it abandoned is available cheaply for four minutes, but the money is gone.
The side it abandoned is the one that wins.

So the obvious rule is: don't change horses. Let a side that starts a chase from
behind draw level with the one you already hold and no further, then go back to
finishing what you already paid for. That was tried once before and cost twelve
markets, and the previous session's notes diagnosed nine of those twelve as a
deadlock between this rule and an existing one — two caps pointing at each other,
with nothing left buyable. I rebuilt it with that deadlock released, which is a
clean and principled fix, and measured it at four different strictness settings.
The deadlock diagnosis was right and it did not matter: sixteen, nineteen,
seventeen and ten failures. The new damage has a different shape. When the player
pins one side, that side falls under a rule that only lets it be bought at a
loser's price, and a side the market still thinks is live is never offered at a
loser's price — so it buys nothing at all, and the player calmly buys the losing
side out to a full thousand while the winner sits at zero. That is worse than
what it was trying to fix.

That gave me the sentence I now think is the honest summary of the whole game:
the order book names the right side a hundred and nine times out of a hundred and
ten, and every rule anyone here has built that overrides that choice permanently
has cost between six and twenty-nine markets. The blocking market is the single
window where the book is wrong, and it is wrong in a way nothing the player can
observe distinguishes from the times it is right.

So I stopped trying to change which side and tried to change how fast. Not a
price limit — those have all been measured out, because a price limit only
delays a purchase and the market then sits at those prices long enough for the
order to fill anyway. A hard limit on how much money one side may commit in
thirty seconds, with the chase handed to the other side while the limit bites, so
the money is redirected rather than withheld. That is the one shape of cap that
has ever survived in this workspace. It repairs the blocking market outright and
comfortably. It also breaks between thirty-six and forty-eight of the other
markets, and narrowing it to apply only to a side already two-thirds built barely
moved that. I split it in half to find out which part did the damage: the cap on
its own, applied only to the last three hundred shares of a side, at a fifth of
the budget per thirty seconds, still cost nine markets, each of them ending with
a side stranded somewhere between six hundred and nine hundred and fifty shares
and several hundred dollars unspent.

That is what sent me to the last idea, and to the measurement that made the whole
session worthwhile. If a purchase made two and a half minutes into a fifteen
minute market is premature, then simply forbid any side from being completed in
the first four or five minutes. I built that and it cost about half the field —
fifty markets at one setting, forty-six at another. So I went and measured, over
all hundred and ten markets, when the player actually finishes a side.

Every single one of the hundred and ten finishes a side in the middle of the
window. Eighty-four of them do it in the first two minutes. Some do it in the
first ten seconds — one market has the player holding a thousand shares of one
side eight seconds after the window opens. And the market that blocks the level
finishes its side at two and a half minutes, which puts it later than three
quarters of the field.

So the story I had been telling myself — that this purchase is hasty and the same
shares would still be there to buy later — is simply false about this player.
Finishing a side fast is not a symptom, it is the mechanism; those shares are
offered in bursts of a few seconds and they are not offered again. That single
distribution retires every rule that delays, rations or slows the completing
purchase, whether by clock, by spending rate or by share of the target, and it
explains all three of this session's failures at once rather than leaving them as
three separate disappointments.

Everything I built ships switched off with its numbers written next to it in the
code, and I confirmed twice that the unchanged player still runs exactly as it
did — the same single failure over the same hundred and ten markets. What the
next session inherits is a genuinely smaller problem: the blocking market needs
the player to back the side that wins at a moment when the order book, the model
of the underlying, and the next four minutes of price action all point the other
way, and it now has firm evidence that it cannot get there by restraining the
chase, by refusing the switch, or by slowing anything down.
