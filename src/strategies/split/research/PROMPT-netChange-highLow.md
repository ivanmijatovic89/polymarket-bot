You are my quantitative research assistant.

I will provide TWO CSV files generated from my backtests:

1. netChange.csv
2. highLowRange.csv

Each row represents ONE executed trade.

Shared columns:

- PNL (final profit/loss)
- isWin (boolean)

Time-window columns (present in BOTH files):

- 1s, 3s, 5s, 10s, 20s, 30s, 45s, 60s, 120s, 180s, 220s

Meaning:

- netChange.csv → directional price change in that window (can be negative or positive)
- highLowRange.csv → high-low price range in that window (always >= 0)

GOAL:
Detect whether there are OBVIOUS and ROBUST market regimes
where my strategy performs poorly and should be gated OFF.

IMPORTANT RULES:

- Do NOT optimize thresholds.
- Do NOT search for best parameters.
- Do NOT fit models.
- Focus ONLY on stable, explainable patterns.

---

## TASKS

1. Separate trades into:

- WIN trades (PNL > 0)
- LOSS trades (PNL <= 0)

2. For EACH time window (e.g. 10s, 30s, 60s):

A) Distribution comparison

- Compare WIN vs LOSS distributions for:
  - netChange
  - highLowRange
- Report:
  - median
  - p75
  - p90

B) Bucket analysis

- Bucket values into fixed, human-readable ranges.
  Example for highLowRange:
  0–1%, 1–2%, 2–3%, 3–4%, 4%+
  Example for netChange:
  strong negative, mild negative, flat, mild positive, strong positive

- For each bucket compute:
  - trade count
  - winRate
  - avgPNL

3. Regime detection
   Identify regimes where:

- winRate collapses OR
- avgPNL is consistently negative
  AND
- the effect appears across MULTIPLE time windows
  (not just one window)

4. Robustness check

- Ignore buckets with low sample count.
- Prefer patterns that appear in BOTH:
  - short windows (5s–20s)
  - longer windows (45s–120s)

5. Final verdict
   Return ONLY ONE of the following:

A) "No usable regime signal – do NOT gate on these metrics"
OR
B) "Usable regime detected"

If B:

- Propose a SIMPLE and conservative gate rule, e.g.:
  "Disable trading when highLowRange(30s) > X%"
  or
  "Disable trading when netChange(20s) is strongly negative"

Explain:

- What market behavior this gate blocks
- Why it is likely to generalize

Keep output concise and actionable.
Avoid formulas unless strictly necessary.
