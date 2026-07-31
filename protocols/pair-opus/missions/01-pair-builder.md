# Mission: build a profitable pair builder

## The goal

Find a way to buy both sides of a BTC 15-minute market so that the pair costs
less than $1.00 after fees, reliably enough to be profitable across the whole
universe of markets. Then keep improving it.

That is the whole mission. `RULES.md` is the constitution.

## The one fact everything follows from

A completed pair settles at exactly $1.00 whichever side wins. So **every pair
you complete under $1 is profit, in every market, guaranteed** — no prediction
required. The only way this strategy loses money is shares that end up
unpaired.

So the research question is not "which markets will be good" and not "which
side will win". It is: **how do you buy both sides cheaply and end up with the
inventory you intended?**

## What to work on

Invent mechanisms, implement them, test them, keep what works, discard what
does not. A mechanism is any concrete answer to: when to bid, at what price,
on which side, in what size, how to react to what the other side is doing, and
what to do when time runs short.

You are expected to try many. If an idea can be described in a sentence and
implemented in an hour, that is a good candidate — build it and measure it
rather than reasoning about whether it would work.

Directional is allowed and encouraged where it helps (RULES rubric 6): the
strategy may deliberately hold more of one side. Treat that as a designed
position with a bounded size, not as leftover from a pair that failed. A
strategy that is 90% paired plus a small intended lean is a legitimate answer.

## How to know something worked

Three numbers decide everything:

1. **Profit per market** across the whole universe, counting markets you sat
   out as zero.
2. **Profit per $100 invested** — a strategy that earns by risking ten times
   more capital has not improved.
3. **Unpaired shares** at the end of each market, and what they cost you.

Measure on the full universe (`--full`). It is roughly half an hour of fleet
time and it is the only instrument sharp enough to trust: repeated identical
full runs land within about $0.21 per market of each other, while 800-market
screens swing by $1.40 and will happily show you improvements that are not
real. Use small screens only to check that a mechanism does something at all
before spending a full run on it.

Before believing any comparison, know your noise: run the same configuration
twice and see how far apart the answers land. Never believe a difference
smaller than that.

## Working rhythm

Keep the fleet busy. When you have several independent mechanisms to test,
submit them all at once rather than one at a time — the fleet has ~22 slots
and analysis of finished runs fits comfortably in the waiting time. Never end
a session waiting for runs: record what is in flight in `state/STATUS.md` and
return `continue`; the next session reads the results.

Write down what you tried and what happened in `memory/`, in whatever
structure serves you. Keep `state/STATUS.md` current enough that a fresh
session can pick up without you. Commit and push each unit of work.

Prior attempts by a sibling lab are summarised in `memory/PRIOR-WORK.md`. Read
it once so you do not repeat work — but it is information, not a verdict. If
you have a genuinely different mechanism, test it even if something adjacent
failed there.

## Ending states

- `continue` — the default, whenever useful work remains.
- `wait` — only when you need a human decision, or when you have a variant
  that is profitable across the full universe and you want it reviewed for
  live trading. Write `state/LIVE-CANDIDATE.md` first: what it does, the three
  numbers above, the risks, and the configuration you would run live.

There is no `complete`. The session limit is a budget, not a plan.
