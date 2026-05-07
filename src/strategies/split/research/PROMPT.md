You are my quantitative research assistant.

I have a CSV file where:
- Each row is ONE executed trade
- There is exactly ONE trade per market
- pnl = final realized profit/loss (numeric)
- isWin = boolean
- Win size is approximately constant across trades
- Loss size is approximately constant across trades

====================
INPUTS
====================


INDICATOR_COLUMN: hlRangePct

====================
HARD CONSTRAINTS
====================
- You may analyze ONLY: INDICATOR_COLUMN + pnl + isWin (+ OPTIONAL_TIME_COLUMN only for splitting)
- Do NOT fit models
- Do NOT run regression
- Do NOT do threshold optimization / parameter search
- Do NOT assume linear or monotonic relationships
- Do NOT invent complex regimes (keep it simple)

====================
YOUR GOAL
====================
Find whether the indicator reveals ANY robust, non-obvious structural weakness:
a region where trades are consistently worse (EV flips negative or becomes unstable),
such that skipping trades in that region is justified.

If such a weakness exists:
- Propose ONE simple gate using NUMBERS (thresholds)
- Compute baseline vs gate performance and show tables

If no robust weakness exists:
- Conclude NO (and still show baseline + best “near-miss” candidate but clearly label it as not robust)

====================
METHODOLOGY (MUST FOLLOW)
====================

A) Load & validate
1) Load CSV_PATH.
2) Confirm columns exist: INDICATOR_COLUMN, pnl, isWin.
   - If INDICATOR_COLUMN is missing, list the 5 closest column-name matches and STOP.
3) Convert to numeric/bool; drop rows with NaN in required columns.
4) Report N after cleaning.

B) Baseline metrics (ALL trades)
Compute:
- n
- winRate
- pnlMean
- pnlTotal
- pnlStd
- avgWin (mean pnl on wins)
- avgLoss (mean pnl on losses; negative)
- breakevenWR = (-avgLoss) / (avgWin + (-avgLoss))
- WR_minus_BE_pp = (winRate - breakevenWR) * 100

C) Understand indicator shape (NO assumptions)
Compute:
- min / max
- percentiles: 1%, 2%, 5%, 10%, 15%, 20%, 25%, 50%, 75%, 80%, 85%, 90%, 95%, 98%, 99%
- missing rate
- note if distribution is heavy-tailed / skewed (only descriptive)

D) Candidate gate set (FIXED; NO tuning beyond this set)
You must evaluate ONLY these candidate gates:

1) Low-tail skip (skip when indicator <= low_quantile_threshold)
Quantiles to try: q in [0.01, 0.02, 0.05, 0.08, 0.10, 0.15, 0.20]

2) High-tail skip (skip when indicator >= high_quantile_threshold)
Use symmetric quantiles: q in [0.01, 0.02, 0.05, 0.08, 0.10, 0.15, 0.20]
Threshold = percentile(1 - q)

3) Two-tail skip (skip extremes; keep middle)
Try only these:
- skip if indicator <= p05 OR >= p95
- skip if indicator <= p10 OR >= p90

Important:
- Require skipN >= 20 trades AND skipPct <= 25% (avoid tiny/noisy or overly aggressive gates)

E) For EACH candidate gate, compute TWO tables of metrics:
1) “Skipped subset (bad regime itself)” metrics:
   - n, share%, winRate, pnlMean, pnlTotal, avgWin, avgLoss, breakevenWR, WR_minus_BE_pp
2) “Kept trades (strategy after applying gate)” metrics:
   - kept_n, skipped_n, skipped%, winRate_kept, pnlMean_kept, pnlTotal_kept, pnlStd_kept,
     avgWin_kept, avgLoss_kept, breakevenWR_kept, WR_minus_BE_pp_kept
Also compute deltas vs baseline for kept trades:
- ΔpnlMean_kept, ΔpnlTotal_kept, ΔwinRate_pp_kept

F) Robustness checks (must do both)
1) Chronological split (if OPTIONAL_TIME_COLUMN exists and has > 0 unique values):
   - Sort by OPTIONAL_TIME_COLUMN
   - First 70% = train, last 30% = test
   - For the FINAL chosen gate: report kept pnlMean on train and test, and skipped pnlMean on train and test.
2) Random split sanity:
   - Run 200 random 70/30 splits (stratify not required)
   - For the FINAL chosen gate: report % of splits where kept pnlMean > baseline pnlMean (on that split).

G) Gate selection rule (simple, anti-overfit)
Choose ONE final gate that satisfies ALL:
- kept pnlMean improves vs baseline on FULL data
- AND improves on TEST split (if time-split possible; else skip this requirement)
- skipped subset pnlMean is negative OR clearly worse than baseline (directionally consistent)
- skipN >= 20 and skipPct <= 25%
If multiple gates qualify:
- Prefer the one with the best TEST kept pnlMean,
- tie-break: smaller skipPct.

If none qualify:
- Conclude NO robust pattern. Show baseline + top 3 candidates by TEST kept pnlMean but label them “not robust”.

====================
OUTPUT FORMAT (STRICT)
====================
1) Brief: what perspectives you checked (1–3 bullets)
2) Clear conclusion: YES or NO
3) If YES:
   - Describe the “bad regime” in plain language
   - Provide the FINAL gate with NUMBERS (exact threshold(s))
4) Tables:
   A) Baseline summary (single row)
   B) Candidate summary table (rows: baseline + ALL candidates you evaluated; keep it readable)
   C) Final “Skipped subset” vs “Kept after gate” tables side-by-side or one after another
5) Robustness section:
   - Train/Test results (if time column present)
   - Random split sanity results (% wins)

Keep it concise. No giant dumps.

Start now.