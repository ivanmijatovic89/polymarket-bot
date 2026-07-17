# JOURNAL — gabagool knowledge shift (append-only)

## 2026-07-17T00:30Z — session 1 begins

First session of the relay. No STATE.md existed; created STATE.md with the
full work queue seeded from the charter, plus this journal. Starting Phase 0
(required reading → PRIORS.md).

Early surprise: the charter points to a "binance aggTrades feed doc under
docs/datasets/" — that doc does not exist anywhere in this repo (repo-wide
grep for "aggTrades" only hits the charter itself). Binance-spot replayability
in backtests is claimed as NEW; I need to find where it actually lives
(possibly strategy-research-protocol/ or the engine code) or ledger it as an
unverified claim.

## 2026-07-17T01:05Z — Phase 0 complete, PRIORS.md written

Read everything the charter required (~3,400 lines + the Binance branch
docs). PRIORS.md now holds 51 tagged claims. The surprises:

1. The "missing" Binance aggTrades doc exists — on unmerged branch
   `binance-aggtrades-r2-sync`. The feed is implemented AND verified against
   the live WS stream (0 mismatches on 48k trades, measured p50 latency
   110ms baked in as the default). So "Binance spot is replayable" is true,
   with the caveat that strategies still only wake on Polymarket book ticks.
2. The mirror-book fact (fable-lab E9/CAL-001: bid_DOWN = 1 − ask_UP,
   16,352/16,353 samples) quietly kills the *instantaneous* version of the
   pair-cost story: top-of-book ask_UP + ask_DOWN = 1 + spread ≥ 1 always.
   Gabagool's sub-$1 pair cost is a TIME-SEPARATED phenomenon. Charter
   measurement D1 needs re-scoping accordingly (noted in PRIORS §11).
3. The two prior campaigns and the live wallets flatly contradict each
   other (T2): every sim-visible passive-maker variant on BTC 15m measured
   negative-to-zero at BOTH fill-model bounds, yet the flagship wallet
   banked ~$644k doing this live. Five candidate reconciliations ledgered;
   the passive-fill reality gap (D2) is the measurement that arbitrates.

Next: wallet forensics scaffolding + @gabagool22 handle→address resolution.

## 2026-07-17T01:55Z — wallet forensics unit 1: handles resolved, ecosystem alive

Resolved all 9 target handles to addresses (profile-page dominant-address
method + lb-api name echo). Findings that move priors:

- gabagool22 = 0x6031…f96d, all-time $868,863 (bigger than the incumbent).
  Active window pinned by data: 2025-10-29 12:34Z → 2026-02-20 09:06Z.
  Ran the full multi-book operation from literally the first minute.
- He DID merge (697 MERGEs in the 2.6-day tail) — "never merges" (P10) is
  a successor-wallet fact, not an archetype fact. Contested.
- MAKER_REBATE rows exist: $1,693 paid 2026-02-18. Venue rebate income is
  real — T2 reconciliation (iv) is live, workstream B must find the terms.
- His volume was mostly 5m/15m BTC/ETH (~35k fills/day) — contests the
  INV claim that the edge lives on 1h/4h (P18/T1 needs re-measurement).
- The ecosystem TODAY: 7 confirmed-active wallets collectively printing
  ~$18.5k/day over 30d; the incumbent's 30d rate GREW since the INV
  (83.8k → 110.6k). "Edge decaying" is contested.
- Cluster lead: incumbent + @0xce25 profiles created 121s apart with the
  same name pattern — likely one operator, two wallets.

Full-history pull for gabagool22 is infeasible (~3-4M rows via a 500/page
API); kept the 75k-row tail (Feb 17-20 + post-stop) and will sample
mid-life windows instead.

## 2026-07-17T02:50Z — puller bug found+fixed; tail forensics done; venue fee timeline pinned

A dedupe bug in puller v1 (identical same-second rows are LEGITIMATE — no
unique ids in /activity) was silently dropping ~22% of trades and showed
+$45k tail profit. Fixed puller, re-pulled, validated MERGE semantics
(= pairs × $1). Corrected picture of his final 2.6 days:

- Trading net −$1,767 (−0.50% of turnover); rebates +$1,819 → he quit at
  breakeven on 2026-02-20. Win% 39–65% by family, NOT 99%.
- Fingerprint: buys only, both sides, near-zero delta (0.13% leg imbalance
  across 845 fills), pair cost ≈ $1.00–1.02 (paying over $1, financed by
  the 20% maker rebate), $4 median clips, burst ladders (p50 gap 0s),
  exits via batched cross-market merges.
- Venue timeline (workstream B): 15m crypto fee-free until 2026-01-06;
  dynamic taker fees (~1.56c/share at p=0.5 — exactly the repo's 156bps
  era) + daily 20%-share maker rebates introduced Jan 6-7; current (Jul
  2026) crypto feeRate 0.07 (1.75c at p=0.5). VENUE-MECHANICS.md started.
- Big narrative shift: end-state gabagool = REBATE FARMER (trading PnL ≈
  −rebates; the live E29 equilibrium). His $869k must be mostly from the
  zero-fee era → mid-life sample (Dec 2025) is the next measurement.

Also: briefly created (and immediately removed) a stray dir at repo-root
measurements/ — write-scope discipline note to self.

## 2026-07-17T03:15Z — ENGINE-GAPS.md written

Eight gaps documented from code reading, ranked. New beyond the charter's
known list: (G3) the sim's taker-fee model is wrong in SHAPE (linear
min(p,1−p) vs the venue's quadratic p(1−p)) and undercharges takers 2–4×
across the price range; (G4) rebates — now known to be the end-state edge
— are absent and their pool-share arithmetic needs trade prints; (G5)
mid-episode merge in sim DESTROYS value (fable E4) while live merge is the
capital-recycling engine of the real strategy — capital velocity is
inexpressible; (G8) the live meta is a 7-bot equilibrium no replay can
express. Fee-shape check also sharpened a fable-lab premise: their "156
bps" era matched January's venue curve only at 45% of its mid-price value.

## 2026-07-17T04:10Z — era comparison: the edge lived and died with the fee regime

Pulled Dec 8-10 2025 (277k rows) and compared to the Feb tail with fixed
boundary handling. Zero-fee December: +1.90% of turnover (~$10k/day), BTC
15m his best book at +$63.85/market and 98.7% win over 229 markets, pair
cost 0.98, worst market −$121. Fee-era February: −0.50%, win rates
collapsed, pair cost ≥ $1, rebates ≈ −trading. The operator claim "99%
win, $30-120/market" is now VERIFIED for December and REFUTED for
February — both were true, at different times.

Venue archaeology (archive.org): Feb-era crypto fee = C·p·0.25·(p(1−p))²
(peak $0.78/100sh = the repo's 156bps calibration, exactly); current =
C·0.07·p(1−p) (peak $1.75). Fees extended to ALL crypto markets
2026-03-06. The maker-rebates docs page first appears in the archive on
2026-02-20 — the day gabagool quit. January's true rate is contested
(press says 2× the Feb snapshot); resolving it matters because a
mid-February fee/rebate halving would be a clean exit trigger.

PRIORS amended (A1–A8). Era-comparison measurement file written.

## 2026-07-17T04:55Z — incumbent decomposition: the current meta is subsidy-heavy but edge-positive

Pulled 2 complete days (Jul 14-16) for 0xb55f. Three income streams:
trading +$2,674/day, MAKER_REBATE $915/day, and a previously-unknown
TAKER_REBATE program paying $3,050/day — venue subsidies now EXCEED the
trading edge. The incumbent is a different animal from the archetype:
never merges (2,220 redeems — INV's "never merges" was about him, A2
confirmed), 47% win rate with tail-harvest payoffs (worst −$770, best
+$2,202), clips to $1,260, buys deep longshots (p25 price $0.09), all 4
coins. Wrote wallets/b55f-incumbent.md with the side-by-side fingerprint
table. The concept now has two verified profitable EXPRESSIONS: parity
grinder (archetype, zero-fee era) and loss-tolerant tail harvester
(incumbent, current era).

## 2026-07-17T05:25Z — synthesis checkpoint: HYPOTHESES, OPEN-QUESTIONS, STATE rewrite

Identified the taker-rebate program (launched 2026-05-28, 7 tiers, 3-50%
refund by 30d weighted volume, crypto 2.3x weight) — incumbents pay ~half
the posted taker fee; a volume moat against new entrants. Wrote
HYPOTHESES.md (H1 parity-grinder rebate-adjusted, H2 tail-completer, H3
subsidy-dominance test, H4 Binance-gated quoting (blocked on branch
merge), H5 15m-vs-5m book allocation) and OPEN-QUESTIONS.md (12 ranked).
STATE.md rewritten as a 60-second onboarding for successors. All
deliverable files now exist with substance. Next big rock: D2.

## 2026-07-17T06:20Z — D2 measured + powerwinner decomposed + literature A1

D2 (the charter's priority measurement): worst_queue admits 44-49% of the
archetype's real fills, touch 64-68% (3s window; 43k fills, both eras,
40+40 markets). The sim sees half the volume — the adverse half. Also
discovered he taker-completed 29-45% of fills (not purely passive), with
a 1-4c-deep bid ladder + touch joins for the passive rest.

powerwinner (hottest wallet, +$122.8k/30d) decomposed: pure TAKER-rebate
farmer — btc-5m only, $84 clips, trading −$13.90/market, taker rebates
+$6.1k/day. The current "ecosystem" mixes real edge (b55f), taker-rebate
farming (powerwinner), and everything between; every wallet needs
decomposition before its P&L means anything.

Wrote literature/A1 (Avellaneda-Stoikov, Glosten-Milgrom, queue models →
BTC-15m implications; the fee introduction as a G-M flow-composition
shift explains the measured margin collapse mechanism cleanly).

## 2026-07-17T07:10Z — all seven actives decomposed: the meta is stratified

Pulled + decomposed the remaining five wallets (same Jul 14-16 window).
The verdict on H3: STRATIFIED. Three wallets carry real trading alpha
(0xce25 +2.31% of turnover — the b55f sibling and the best measured;
badfallen +1.68% on btc-5m alone; b55f ~+0.7%). Three are deliberate
taker-rebate farmers (powerwinner, doggystyie, 0xaaaaa) whose trading
loss is the manufacturing cost of weighted volume. bonereaper printed
negative this window (its $1.19M all-time says sample luck — flagged).

Standouts: doggystyie runs the archetype's EXACT end-state (perfect
0.0% parity, pair cost ≥ $1) profitably TODAY because taker rebates now
pay for it. The edge wallets share the archetype's fingerprint (small
$6-11 clips, multi-book); the farmers trade $35-84 clips at p≈0.5 on
btc-5m only. And the single largest income stream of the whole ecosystem
is the venue's taker-rebate pool (~$20k/day for these 7) — program risk
is now the systemic risk of the meta.

The lab's takeaway sharpened: real alpha exists in the current era, its
carriers look like gabagool, and BTC-5m/15m are where both the alpha
wallets and the subsidy flow concentrate.

## 2026-07-17T01:30Z — session 3 start: state sync (clock note + last session's uncommitted narration)

Clock note: earlier journal timestamps ("05:20Z"–"07:10Z") were mislabeled
— git commit times show all prior work happened 00:26–01:23 UTC. From
here on, timestamps are real UTC from `date -u`.

Session 2 ended after five commits that never made it into STATE/JOURNAL.
What they did (recovered from diffs):

- **Per-book nets (b6bfedc)**: btc-15m is a live EDGE book today — T1
  (does the archetype's best book still pay?) resolved YES; PRIORS A11.
- **_META v2 (e8b44e7)**: cross-wallet synthesis rewritten around the
  stratified meta (3 edge / 3 farmers / 1 negative).
- **Fee-formula bracketing (57b8b85)**: the crypto fee curve's shape
  change + peak doubling is now bracketed to 2026-03-05 → 2026-04-01 via
  /trading/fees archive snapshots; ~10 March snapshots exist for exact
  bisection if it ever matters. January's true rate remains contested.
- **Literature A2 (5d46efe)**: queue-position value + subsidized-MM
  economics; the YIELD program is dust for this concept.
- **Leg-risk policy rewrite (7a6d21b)**: parity is a zero-fee-era
  artifact, not a concept invariant. Current edge wallets run LOOSE
  parity (p50 leg imbalance 20–40%); the one perfect-parity wallet today
  is trading-negative and lives on rebates. BRIEF now says: sweep parity
  tolerance as a first-class knob (0.1% → 40%).

Also recovered two interrupted pulls and resumed them (puller state files
worked as designed): gabagool22 Jan 10–13 transition sample (was at Jan
11 04:40Z walking back; ~1.2 days remain) and bonereaper Jul 7–12 second
window (was at Jul 10 10:33Z; ~3.4 days remain). Both running in
background now. Next: analyze the Jan transition when the pull lands —
it's the decay-speed prior (Dec 0.98/98.7% → Feb 1.00/38.6%; where was
mid-January?).

## 2026-07-17T01:55Z — bonereaper verdict: hybrid farmer-with-an-edge-sleeve, and a $62.6k bulk payout

Both resumed pulls landed within minutes (they were nearly done when the
last session died). Bonereaper Jul 7–12 (5 days, 137,913 rows, complete):
trading −$35,673 on $3.16M buys (−1.13%) — the earlier 2-day negative was
NOT sample luck. But the per-book split tells three stories at once:
btc-5m is rebate manufacturing (−0.90% on $2.6M, 82% of turnover, the
powerwinner signature), the 15m books are REAL edge (btc-15m +1.12% —
third independent wallet confirming A11; eth-15m +0.77%, which was
negative for b55f/0xce25 — so coin asymmetry is wallet-specific), and
−$15.2k of the loss is discretionary sports punting (one Ronaldo bet
−$18.7k).

The surprise: one TAKER_REBATE payout of **$62,612.93** at Jul 8 23:34Z —
off the daily 00:10Z cadence and 20–45× the normal $1.4–2.9k/day.
Excluding it, bonereaper runs ≈ −$4.5k/day steady-state; including it the
window is +$40k. Its $1.19M all-time is not trading alpha. New open
question: what ARE these bulk payouts (true-up? backpay?) — every
short-window income decomposition is hostage to them.

Wrote wallets/bonereaper.md, updated _META, PRIORS A12, refreshed
OPEN-QUESTIONS (D2/H3/dossier items moved to resolved). Next: the
January transition analysis — the pull completed too.

## 2026-07-17T02:35Z — January analyzed; fee mechanics decoded on-chain; a systematic accounting bias found in ALL fee-era numbers

The January transition unit turned into the most consequential unit of
the shift so far. Three results:

1. **The decay was not a decay.** btc-15m by day: Jan 10 win 49.4% /
   +$0.69/mkt → Jan 12 win 94.0% / +$45.93/mkt, pair cost 0.9945 →
   0.9815. The fee-free btc-1h control book held 87–96% win with flat
   pair costs the same days. He absorbed the Jan-6 fee shock, re-tuned
   his ladder ~130bp deeper in under a week, and was nearly back to
   December performance by Jan 12. The Feb collapse is a separate,
   slower phenomenon (competitive compression). Decay prior for the
   lab: structural shocks are adapted to in days; competition kills in
   weeks.

2. **Fee mechanics decoded from receipts** (his /activity rows carry
   tx hashes; POLYGON_RPC_URL read-only). On-chain, EVERY fill is
   charged 10%×min(p,1−p)×size in the output asset — both sides — and
   the operator module refunds in the same tx: makers 100% (net $0),
   takers down to the published curve. His Jan 11–12 net taker fee
   matches 0.25·p·(p(1−p))² to 4 decimals → **January's rate = the Feb
   formula; the contested 2× press figure is dead; the "mid-Feb fee
   halving" exit-trigger hypothesis is eliminated.** December receipts
   show fee=0 — the zero-fee era verified on-chain.

3. **The bias**: /activity reports GROSS size/usdcSize (verified exact
   on 325k rows) — net taker fees, docked in shares, are invisible.
   Every fee-era cash-flow net we have measured is gross-of-fee, and
   the July decompositions counted rebates (fee REFUNDS) as income
   without the fees. Jan btc-15m: +$24.52/mkt gross → +$10–15/mkt
   corrected at D2's 29–45% taker share. New question #1: does the
   July edge survive fee-inclusive accounting? b55f's $3.05k/day taker
   rebate implies ≥$6.1k/day fees paid vs +$2.7k/day gross trading net
   — the sign of the true trading edge is now genuinely uncertain.

Wrote measurements/jan-transition-gabagool22.md, PRIORS A13–A15,
VENUE-MECHANICS fee-implementation section, caveats added to
era-comparison + actives-decomposition, OPEN-QUESTIONS refreshed.

## 2026-07-17T03:05Z — fee-inclusive audit: the edge survives, and the meta is majority-taker

Wrote scripts/measure-onchain-fees.ts (samples a wallet's fill txs,
decodes receipts for per-fill maker/taker role + net fee). First find:
July fills settle on a NEW exchange contract (0xe1111800…996b, event
0xd543adfd…) with NATIVE fees — maker 0, taker = published curve in
USDC, and mint-matching (complementary buys combine at $1/pair). The
v1 charge-and-refund dance is history; /activity is still gross.

The audit (Jul 14–16, 120–150 receipts/cell, 100% decoded):

- b55f btc-15m: +3.20% gross → **+2.31% fee-inclusive. The edge is
  real.** (37.8% maker by notional, taker fills pay 1.43%.)
- 0xce25 btc-15m: +1.97% → **+0.31%** — barely alive; it's much more
  taker-aggressive (fee 2.64%). The "best edge wallet" ranking FLIPS
  after fees (b55f > 0xce25 on btc-15m).
- b55f btc-5m: −0.14% → −1.98%; doggystyie btc-5m: −0.32% → −2.93%,
  and doggystyie is 100% TAKER (its "perfect parity maker" fingerprint
  is a taker loop — no resting orders at all in 120 txs).
- Edge wallets are ~62% taker by NOTIONAL on their edge book. The
  winning meta is maker-accumulate + taker-complete, weighted toward
  completion. A pure-passive lab family models a minority of winner
  flow.

PRIORS A16, _META fee-correction header, VENUE-MECHANICS new-exchange
section, OPEN-QUESTIONS: fee re-audit + maker/taker split resolved.
Next: fold A13–A16 into STRATEGY-BRIEF/HYPOTHESES (they change H1's
premises materially), then the edge-source hunt.

## 2026-07-17T03:25Z — synthesis fold: A13-A16 into BRIEF/HYPOTHESES/METRICS

BRIEF: fee mechanics now "exactly known per era" in §2; §1 economics
updated with fee-inclusive July numbers; §4 gains the completion-policy
knob (the b55f-vs-0xce25 2%-gap observation); §9 marks income
decomposition + January transition answered. HYPOTHESES: H1 parameters
now sweep parity 0.1→40% AND completion policy; H3 carries the
fee-inclusive correction; H5 RESOLVED SUPPORTED (btc-15m is the right
book; 5m is a subsidy game); new H6 "completion aggressiveness is the
margin knob" — testable in sim because fees are exactly modelable and
relative ranking survives a pessimistic maker model. METRICS: added
taker-fee drag, fee-inclusive margin, taker-share-of-notional rows and
the gross-accounting discipline note.

Next: edge-source hunt (now question #1) — level/timing analysis of
b55f vs 0xce25 btc-15m fills against Telonex books.

## 2026-07-17T05:05Z — session 4: recovered and committed the edge-source unit

Predecessor died after finishing the edge-source hunt but before
committing. Everything of substance was on disk: A17 (the execution
fingerprint of the current btc-15m edge — deep patient ladders p10 −12c
below touch, cheap-side touch rests, ~43% of notional taker-completed
mid-band, back-loaded into minutes 10–13, no open concentration, and the
better wallet waits longer + crosses further from the fee peak), A18
(venue facts: Chainlink BTC/USD data stream resolution with ties→UP,
negRisk false, tick 0.01, min 5 shares), G9 (Telonex coverage ends
2026-06-14 — July era not replayable), OPEN-QUESTIONS refreshed with
three items resolved. This session verified the files against the diffs,
added the missing journal/feed/state bookkeeping, and committed.

Notable: the July books not existing forced the analysis onto Jun 12–14,
which is fine (era-consistent) but means the lab's newest replayable
slice lags the live meta by a month — flagged as G9.

Next: fold A17/A18 into STRATEGY-BRIEF/HYPOTHESES (ladder priors for H1,
H6 sharpening, endgame bounds from ties→UP), then D3/D4/D5 measurements.

## 2026-07-17T05:25Z — synthesis fold: A17/A18 into BRIEF/HYPOTHESES/METRICS

BRIEF §4 gains the current-era ladder shape (deep rungs to −13c,
cheap-side touch rests, mid-band completion) and the timing profile
(back-load minutes 8–13, cut minute 14, ignore the open); §3 and H4
gain the Chainlink-vs-Binance oracle basis caveat; §7 gains the
resolution bounds (ties→UP, tick 0.01, min 5 shares); §9 marks
edge-source + level-offsets answered. H1's parameter block now
carries the measured ladder-depth and time-weighting priors. H6 gains
the June fills×books cross-check (the completion-price ranking
reproduces independently of the receipt decode). METRICS adds the
minute-of-window fill-share row.

Synthesis is now current through A18. Next: D3/D4/D5 measurements —
first check what fable E24/E25 already cover, then build on June
Telonex books (the newest replayable slice, G9).

## 2026-07-17T05:55Z — venue leftovers closed (A19) while the D3/D5 replay runs

Primary-sourced the remaining order/market mechanics from the docs
site (the old CLOB doc URLs 404 — the index lives at
docs.polymarket.com/llms.txt now): sub-cent tick switches exactly at
>0.96 / <0.04 (tick_size_change, orderbook page); rate limits are
generous and non-binding for this concept (POST /order 5,000/10s
burst, 120k/10min sustained; data-api 1,000/10s — relevant to our own
pullers); Chainlink Data Streams publish ~200ms signed reports with
18-decimal prices, so the ties→UP resolution clause is measure-zero,
not a tradable asymmetry. One [reported] residue: marketable orders
≥ $1 notional (secondary source only).

Meanwhile scripts/window-lifecycle.ts (D3 flip table + D5 lifecycle,
one replay pass, 288 June markets sampled from 1,286 on disk) runs in
the background; smoke test on 8 markets validated plumbing, including
two gotchas: the book WIPES after resolution (outcome must be read
from the last decisive post-window quote, walking backwards), and
minute-14 lifecycle rows condition on the book still being two-sided.

## 2026-07-17T06:20Z — D3+D5 done (A20): tight books, front-loaded churn, calibrated-to-slightly-cheap favorites

The 288-market June run finished. Three takeaways: (1) btc-15m books
are 1c-tight the entire window — there is no wide-spread regime; the
"cheap side" is 1–2c plus depth sweeps. (2) Mid oscillation (the
mechanical pair-harvest fuel) is front-loaded into minutes 0–5 and dies
to zero by minute 14, while the edge wallets' fills (A17) are
back-loaded — combined with fable E24 (open churn = adverse selection
from the first seconds), the winners' revealed preference makes sense:
skip the open, position late. (3) The flip table says the leading side
is slightly UNDERpriced at mid in every band ≥0.6 (0.85-band flips
10.5–13.8% vs 15% implied) — the mirror of fable's cheap-side trap,
~1–5c gross, below fee+spread. Endgame bounds for the lab: ≥0.9 with
<5min flips 0–6%; ≤0.6 is a coin toss at every horizon. D4 resolved by
priors, no measurement needed. One honest bias: the 27 outcome-
ambiguous markets are the closest finishes, so tail flip rates are
slightly understated.

Also this unit (data already pulled, writeup next): the bulk-payout
question cracked open — the Jul 8 lump is ecosystem-wide, same-second.

## 2026-07-17T06:45Z — bulk payout resolved (A21): program-wide backpay, and direct evidence of program discretion

The /activity type filter (news to us — makes rebate pulls nearly
free) gave full payout histories for all 7 actives. The $62.6k lump is
one same-second batch (2026-07-08T23:34:35Z) hitting 6/7 wallets,
$174k in this cohort alone; daily taker payouts start exactly Jun 20
everywhere while the program launched May 28 → it's the launch-window
accrual true-up. June income paid in July — bonereaper was never
"rescued", it was owed. Bonus findings: manual round-number grants
($7,500.00, $1,500.00), same-second whole-day payout slips, doggystyie
and powerwinner near-zero maker-rebate streams (pure-taker confirmed),
and the taker stream out-earning the maker stream 5–10×/day for every
wallet. H3's program-risk framing now has direct evidence: the venue
pays discretionary amounts to individual wallets.

The queue is nearly empty. Next: saturation assessment against the
charter's E criterion.

## 2026-07-17T07:15Z — G4 resolved (A22): the rebate estimator is exact, and H1 is now fully sim-judgeable

The best unit of the shift. The official maker-rebates formula is
per-market pro-rata by fee-equivalent — the SAME curve the taker pays —
with the pool set to 20% of the same measure. So the pool share
cancels algebraically: a maker's daily rebate = 20% × the fee-curve
value of their OWN maker fills. No pool-share assumption, no trade
prints needed (the thing G4 thought was blocking). One-line post-hoc
stats addition for the lab. Nuance: $1/day/market minimum payout —
min-size configs literally earn $0, so "rebates rescue thin margins"
only operates at scale.

Also measured the magnitudes (scripts/rebate-pool.ts, Jul 15, 24/96
windows, Σsize==gamma volumeNum validates single-counting): btc-15m
does ~$1.9M/day matched notional, ~$36.4k/day taker fees, ~$7.3k/day
maker-rebate pool; per-market fees p50 $332. Charter question "how
much per day at min size" answered: dust or zero.

With G4 closed, H1's kill criterion is decidable in sim: fee-inclusive
pair margin + exact rebates. This upgrades the whole handoff.

## 2026-07-17T07:50Z — leaderboard sweep (A23): the maker king nobody knew about

Chasing P19's "$8M/day wallet" through the top-50 volume leaderboard
closed that claim (nothing close; nearest is a mixed sports+crypto
whale at $6.3M/day) but found something better: FOUR untracked
crypto-updown wallets ≥$0.7M/day. The headline is 0xb27bc932 — the
archetype fingerprint (btc-15m only, 100% BUY, $3.2 clips), all-time
profit +$762,732, quietly collecting ~40% of the entire btc-15m
maker-rebate pool since March, with trading profit now ≈ +$95/day:
~97% of its income is venue subsidy. The maker side of the lab's
exact book has a dominant, entrenched incumbent. Counterpoint datum:
0x95f5 lost −$542k in 30 days doing $1.48M/day of the same-shaped
flow — competition in this family kills at scale. _META, H3, and the
BRIEF's failure-modes section updated; the "~7 actives" framing was
an undercount born of never doing a leaderboard sweep (hygiene lesson
ledgered).

Honesty note: these are quick-scan numbers (one /activity page +
lb-api per wallet), labeled as such everywhere; the full-history
b27bc932 dossier is optional residue.

## 2026-07-17T08:25Z — b27bc932 full dossier (A24) — and eating my own correction

CONTRADICTION LEDGER: A23's quick scan called b27bc932 "btc-15m only,
~40% of the book's maker pool". Both wrong. The last-500 /activity rows
spanned just 30 minutes; the June full pull (249k rows/2.4d) shows a
multi-book grinder (btc-5m $785k > btc-15m $241k > eth-5m $234k) whose
rebates span ≥3 pools — its btc-15m share is ~3–4%. No wallet owns the
book; the pool is fragmented. All five files carrying the wrong claim
are corrected in place, and the method lesson (never infer book mix
from one /activity page) is ledgered in A24.

The corrected dossier is still the most lab-relevant wallet found:
104k fills/day at $3.2 clips, 100% BUY, pair cost p50 0.993 on btc-15m,
1.6% parity, ZERO merges (holds to redemption), 50.1% taker by
notional, near-uniform timing, gross trading +0.28% of turnover ≈
breakeven after fees, income ≈ 97% subsidy. It is a live existence
proof of H1's mechanism surviving the fee era — as a volume/subsidy
machine, not an alpha machine. H1, H3, BRIEF §8, _META updated.
