# Mission

## Goal

**Live off automated trading on Polymarket.**

Concretely: a portfolio of small, validated strategies running live 24/7,
netting **$3,000/month**, then **$5,000/month**. Not one perfect strategy —
many small edges stacked.

## Mission

Build and operate a machine that **discovers, validates, and deploys** small
edges in Polymarket 15-minute markets — where every strategy that passes the
frozen validation bar **goes live automatically at small size**, and live
results feed back into research.

The machine (engine, protocol, agents) is the means. Dollars extracted from
the market are the measure. I enjoy the research — and I earn the right to
unlimited research by getting the portfolio to pay for it.

## The ladder

Each milestone unlocks the next. Work on the current one only.

1. **Finish protocol v2** — a frozen, finite list of missing validations
   (out-of-sample holdout, blocking advisories, latency stress). When the
   list is done, the protocol is _finished_ — no new items may be added.
   Holdout needs no calendar waiting: every family searches only on data
   older than a cutoff; the newest weeks already on disk are the untouchable
   test set (search on old, confirm on new).
2. **First strategy live with real money** — whatever passes v2 goes live at
   small size, automatically, no extra approval invented at the door.
3. **First $1,000 month** — scale size and add validated strategies until a
   calendar month nets ≥ $1,000.
4. **$3,000/month portfolio.**
5. **$5,000/month** — research is now the job, and it pays for itself.

Scope sequencing: research stays **BTC 15m only** until strategies are
profitable there. But running an _already-validated_ strategy on ETH/SOL/XRP
is not research — it's the same code on ~4× more markets, and it is the
cheapest capacity multiplier on the board ($5k needs ~$1.74/market on BTC
alone vs ~$0.43/market across four symbols). It goes next in the queue the
moment strategy #1 is live and stable — not "someday".

## Alignment rules

These exist because 9 months passed without a live trade. Each rule blocks a
specific failure pattern.

1. **The bar is written and frozen.** What "ready for live" means lives in
   STAGE-GATES.md, nowhere else. If a strategy passes and I still don't want
   to launch it, the gates are wrong — fix the gates, then obey them. Never
   judge a passing strategy by feel.
2. **Money path first.** Before starting any task, ask: _does this move a
   strategy toward live income?_ If not, it waits until milestone 3.
   New infrastructure is built only when it blocks the money path — never
   because it would be nice, elegant, or interesting.
3. **Research is the reward, not the escape.** Until milestone 3, deep new
   research (new families, new datasets, new tooling) runs only through the
   autonomous night-shift sessions. My own hours go to the ladder.
4. **Short-term, judge behavior; long-term, judge profit.** Per-market edge
   is cents; per-market noise is dollars. A red month proves nothing, a green
   month proves nothing. Live gates check execution correctness and a
   pre-declared loss floor — statistical proof accumulates over months while
   size grows.
5. **The weekly question.** Every week, answer in one sentence:
   _"What did the live portfolio earn this week, and what is the single next
   step on the ladder?"_ If the answer is "$0 and the next step is more
   engineering" two weeks in a row, rule 2 is being violated.
6. **Speed comes from compute, never from skipping evidence.** Backtests,
   sweeps, holdouts, new families — parallelize without limit, the fleet and
   the agents make that side fast. Live execution truth and live P&L proof
   cannot be fast-forwarded; they are bought with small real size and days,
   not with impatience and big size. Oversizing an unproven edge because
   money is needed now is the one move that can end the project.
