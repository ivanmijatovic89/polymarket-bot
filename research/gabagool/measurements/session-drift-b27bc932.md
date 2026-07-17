# Session-level ladder + drift decomposition: b27bc932 on btc-15m (A58)

Session 11, unit 1 (2026-07-17). Closes the A34/A35 residue by the route
the 04b6d7e9 dossier prescribed: the overnight-vs-session comparison must
use b27bc932 (the only 24/7 wallet). Question: WHY does the deep-ladder
grinder bleed the US session (A36/A46/A49) — does it quote differently,
or do the same quotes get adversely selected? Book-level answer via
`scripts/edge-source.ts` (A17 method: /activity BUY fills × Telonex
delta-typed replay; level class at fill, offset vs touch, post-fill mid
drift @10s/@60s), run per session window.

Data: b27bc932 fills on btc-updown-15m ×
- Jun-10 (Wed): full day, 48 cached books at 30-min stride
  (`data/telonex-r2-w4/2026-06-10`), 13.7k fills matched, $81k.
- Jun-12 (Fri): US 11:45–19:15Z from cached `2026-06-12-extra` (30
  books, 6.0k fills); overnight 00–06Z + evening 20–24Z freshly pulled
  (`data/telonex-r2-jun12sess`, 40 books, 5.9k fills).
- Jun-13 (Sat): evening 20–24Z pulled (16 books, 3.5k fills). Overnight
  books are STUBS (see §4) — cell unusable.
- Mar-16 cross-era replication attempted and impossible: the wallet had
  ZERO btc-15m fills that day (26,985 rows, 100% btc-5m) — see §5.

## 1. The ladder is session-invariant

Offset vs touch (price − bestBid) percentiles, every valid weekday cell:

| cell | p10 | p25 | p50 | p75 | p90 |
|---|---|---|---|---|---|
| Jun-10 overnight | −2c | −1c | 0 | +1c | +2c |
| Jun-10 eu | −3c | −1c | 0 | +1c | +3c |
| Jun-10 us | −3c | −1c | 0 | +1c | +3c |
| Jun-10 evening | −3c | −1c | 0 | +1c | +2c |
| Jun-12 overnight | −2c | 0 | 0 | +1c | +3c |
| Jun-12 us | −2c | 0 | 0 | +1c | +3c |
| Jun-12 evening | −1c | 0 | 0 | +1c | +2c |
| Jun-13 evening | −3c | −1c | 0 | +1c | +3c |

Class mix is also roughly stable (taker 37–46% of fills, deeper 17–32%;
evening/overnight tilt a few points from taker toward touch). **The
machine does not adapt its quoting to the session.** Session PnL
differences are therefore about what HAPPENS to the same quotes, not
about policy switching.

## 2. Post-fill drift by session: the deep-fill edge lives off-US-hours

Mean mid drift after BUY fills, deeper class (rest of ladder below
touch), in cents:

| day | overnight @10s/@60s | eu | us | evening |
|---|---|---|---|---|
| Jun-10 (Wed) | +0.22 / +0.66 | +0.20 / +0.41 | +0.38 / **−0.31** | +0.53 / **+1.50** |
| Jun-12 (Fri) | +0.85 / +1.14 | — | −0.24 / **−0.39** | +1.02 / **+1.44** |
| Jun-13 (Sat) | (stubs) | — | — | −0.48 / **−1.38** |

Touch-class drift60 is ≈0 to mildly negative in every cell (−0.01c to
−0.76c); taker-class mostly mildly negative. The favorable drift that
defines this variant's edge (A39) is CONCENTRATED in the deeper class
and only outside US hours:

- **Weekday overnight + evening: deep fills mean-revert in the buyer's
  favor** (+0.4 to +1.5c @60s) — dips get bought and come back.
- **US session (2/2 weekdays): deep fills are adversely selected**
  (−0.3 to −0.4c @60s after a positive 10s blip on Jun-10) — the sweeps
  that reach deep levels keep going. Same quotes, opposite flow regime.
- This is the book-level mechanism under A36/A46/A49 (grinder
  gross-negative in US 12–19Z; evening the only robust positive
  session): not wider quoting, not fee differences (fee % of notional
  is flat 2.0–2.7% across cells) — flow toxicity by clock.

## 3. Weekend caveat

Jun-13 (Saturday) evening FLIPS the deep-fill sign (−1.38c @60s,
adverse). One weekend day is n=1, but it means the "evening favorable"
rule is only established for weekdays; A49's month-scale session
economics did not stratify weekday/weekend. Residue logged in
OPEN-QUESTIONS: weekday-vs-weekend split of the session rule (cheap:
session-split-vol.ts already has the data; add a dow filter).

## 4. Data notes (successors beware)

- **Stub parquets are NOT a January-only problem (G10 extension):**
  all 24 Jun-13 00–06Z btc-15m conversions are ~16KB stubs — replay
  yields a near-empty book series, drift computes as exactly 0.0000 and
  offsets blow out to ±35c. Screen ANY telonex pull by file size
  (<100KB suspect) or event count before joining; do not trust cells
  whose drift is exactly zero.
- **zsh word-split trap:** `for s in "a b c"; do set -- $s` does NOT
  split in zsh — the first run of this unit fed `--from --to` garbage
  and silently produced four identical unfiltered tables (Date.parse →
  NaN → filter passes everything). Invoke runs explicitly.
- Jun-10/12/13 books cached under `data/telonex-r2-w4/2026-06-10`,
  `…/2026-06-12-extra`, `data/telonex-r2-jun12sess`,
  `data/telonex-r2-jun13`. Logs: `data/edge-source-session-*.log`,
  `data/edge-source-us-jun12.log`.

## 5. Bycatch: 15m sleeve start is later than Mar-16

`activity-b27bc932-mar16.jsonl` (fresh pull, 26,985 rows, full day
Mar-16): 22,219 TRADE rows, 100% btc-updown-5m, ZERO 15m. With A50's
Mar-25 read (75% 5m / 25% 15m), the 15m sleeve's FIRST era is now
bracketed to a start in Mar-17→Mar-25 (previously only "by Mar-25").
Minor dossier timeline precision; no interpretation change.

## Producing commands

- `npx tsx research/gabagool/scripts/pull-activity.ts --address 0xb27bc932… --label b27bc932-mar16 --start 1773619200 --end 1773705600`
- `npx tsx research/gabagool/scripts/pull-telonex-r2.ts --symbol btc --timeframe 15m --from 2026-06-12T00:00:00Z --to 2026-06-12T06:00:00Z --limit 24 --out research/gabagool/data/telonex-r2-jun12sess` (and evening / Jun-13 variants)
- `npx tsx research/gabagool/scripts/edge-source.ts --activity data/activity-b27bc932-jun10.jsonl --dir data/telonex-r2-w4/2026-06-10 --from 2026-06-10T00:00:00Z --to 2026-06-10T06:00:00Z` (× each session window; paths relative to research/gabagool/)

## §6 Weekend cells addendum (session 11, unit 8)

After A59's dow revision, the weekend book-level cells that CAN be
measured (b27bc932 fills × fresh book pulls):

| weekend cell | deeper drift @10s/@60s | verdict |
|---|---|---|
| Jun-13 (Sat) US 12–20Z (32 books, 6.6k fills) | +0.13c / +0.43c | mildly favorable — NO weekday-US toxicity |
| Jun-13 (Sat) evening 20–24Z (§2) | −0.48c / −1.38c | adverse — no weekday-evening premium |
| Jun-13/14 overnights | — | UNMEASURABLE: all 48 conversions are ~16KB stubs |

The weekday drift structure (US-adverse / evening-favorable) is
ABSENT on the measured weekend day — the two cells point the
opposite way from their weekday counterparts, and with A59's n=10
economics (weekends flat everywhere) the right read is: weekend
drift is day-noise around flat, not a structure. Ladder offsets
remain identical (p10 −2c / p50 0 / p90 +3c) — session-invariance
of the policy holds on weekends too.

Data note (G10 refinement): the stub outage covers BOTH weekend
overnights (Jun-13 00–06Z and Jun-14 00–06Z, 48/48 stubs) while
Jun-13 US/evening and Jun-14 daytime pulls are healthy — the
recording gap looks like a weekend-overnight ops window, not random
dropout. Books: data/telonex-r2-jun13us/, telonex-r2-jun14on/
(stubs, kept as evidence); log data/edge-source-us-jun13.log.

## §7 Control: is the US deep-fill toxicity universal? (unit 12 — inconclusive)

Same method, same day (Jun-12), same books, different wallet: b55f
(the deep tail-harvester, offsets p10 −4c, deeper-class px p50
0.50–0.61 — a materially deeper ladder than b27bc932's −2c rungs).
Deeper-class drift @60s: overnight +0.36c / US +0.26c / evening
−0.80c — its US deep fills were NOT adverse where b27bc932's were
(−0.39c same day). BUT: b55f runs 632–1,068 fills per cell (vs
2.4–5.5k), and its non-deep cells swing ±4–9c — cell-level drift
means at n≈500 carry ~±0.5c noise, the size of the effect itself.
Verdict: the US toxicity is NOT yet shown to be a venue-wide
property; it may be specific to near-touch-plus-shallow-deep
ladders (b27bc932) while genuinely deep cheap-side rungs (b55f)
dodge it — or this is noise. Deciding needs pooled multi-day joins
per wallet (books exist only Jun-10–14, G9; b55f pulls exist for
Jun-12–14). Flagged to the lab: test the toxicity per ladder-depth
cell, not as a blanket session rule. Log:
data/edge-source-b55f-sessions.log.

## §8 Depth-bucket resolution (unit 13): toxicity is not depth-localized; the evening depth GRADIENT is the find

edge-source.ts now buckets deeper-class fills by offset (−1c / −2c /
−3..−5c / ≤−6c). Deeper-class drift60 by bucket:

| cell | −1c | −2c | −3..−5c | ≤−6c |
|---|---|---|---|---|
| b27bc932 US Jun-10 (n=670/354/490/190) | +0.32c | −0.59c | −0.57c | **−1.46c** |
| b27bc932 US Jun-12 (n=615/298/318/73) | −0.47c | −1.18c | −0.26c | +3.18c (n=73) |
| b55f US Jun-12 (n=170/119/147/57) | +0.43c | +2.45c | −0.09c | −3.66c (n=57) |
| b27bc932 EVENING Jun-10 (n=227/120/168/78) | +0.69c | +0.71c | **+2.69c** | **+3.10c** |

1. **"Depth dodges US toxicity" is NOT supported.** b27bc932's US
   toxicity spans all depths (deepest bucket its WORST on Jun-10);
   b55f's unit-12 apparent immunity traces to one noisy +2.45c
   bucket (n=119) while its own deepest bucket was −3.66c. The
   [contested] tag on cross-wallet universality stands, but the
   depth-escape hypothesis is dead.
2. **The evening depth gradient is monotone and strong**: deeper
   rungs earn progressively MORE favorable drift in the weekday
   evening (+0.69 → +3.10c @60s). The deep-rung honey is an
   EVENING phenomenon — combined with A59 (evening +1.27% the only
   robust cell), the H1 allocation rule sharpens to: deep rungs
   (−3c and beyond) in weekday evenings; shallow-only or off in
   the US session; depth buys nothing extra overnight (A58 §2
   overnight deep ≈ +0.7–1.1c, flat-ish across depth).
Log: data/edge-source-depth-buckets.log (script gained the
depth-bucket table permanently).

### §8 replication (unit 14): the gradient's sweet band is −3..−5c

Jun-12 (Fri) evening buckets: +0.68c / +2.37c / **+3.10c** / −1.35c
(≤−6c n=35, $119 — dust). Jun-13 (Sat) evening: ALL buckets
−0.6→−1.7c (weekend, as A59 predicts). So the weekday-evening depth
gradient replicates 2/2 through the **−3..−5c band** (+2.7c and
+3.1c @60s on the two weekdays); the ≤−6c tail flips by day at tiny
n — unproven, don't build on it. Final allocation rule: weekday
evening deep rungs at −3..−5c; US shallow-or-off; weekends flat.

Unit-15 completion: overnight buckets measured on both weekdays —
favorable-to-flat at every depth with NO consistent ordering
(Jun-10: −0.96/+2.77/+0.88/+5.2c; Jun-12: +1.81/+0.49/+1.15/0.0c
@60s) — "overnight depth-indifferent" is now measured, not assumed.
The depth×session matrix is complete.
