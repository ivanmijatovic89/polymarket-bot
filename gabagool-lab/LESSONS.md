# LESSONS — transferable beyond the experiment that taught them

Pre-declared in EPISTEMOLOGY §6; started at the first transferable
lesson (E002). Append-only; cite the source experiment/unit.

- **LS-1 (E002):** Requote churn × latency converts a passive maker
  into an involuntary taker — with cancel latency every requote cycle
  leaves the old rung exposed in flight AND the replacement can cross
  at arrival. At 140 ms this multiplied fills 8.3× and turned 34% of
  them into fee-paying takers. Quote-stability (standing ladders, wide
  requote deltas, requote bans) is a DESIGN AXIS, not an execution
  detail; any variant that requotes on small book moves will fail the
  latency battery regardless of its lat0 economics.
- **LS-2 (E002):** Shallow blind rungs do not pair: at lat0 the
  [−1c,−3c] ladder ended the median played market FULLY one-sided
  (imbalance p50 = 1.00, pairRate 0.29). Apparent pairing under
  latency (0.64–0.69) was churn buying both sides at bad prices. The
  pair discount must be engineered by placement depth and completion
  policy, not harvested from quote noise. (Deep-pair region: three
  independent live wallets, INHERITANCE A-3/A-4.)
- **LS-3 (ops, s3 u15):** Side-effectful scripts must be
  idempotent-or-refuse, and verification must NEVER share a code path
  with submission. A "verify" one-liner that re-invoked the launch
  script double-submitted 10 flows (~29k jobs). Guards now: submit.ts
  rejects unknown flags; launchers refuse when their flows already
  exist. Verify with read-only tools (queue.ts, agg-inspect.ts,
  runs.ts) ONLY.
- **LS-4 (ops, s3 u15):** BullMQ flow removal is PARENT-first
  (`remove({removeChildren: true})`). Children-first empties the
  dependency set, promotes the parent to `waiting`, and any listening
  worker locks it within seconds and aggregates a partial/empty run
  (tombstone run 679).
- **LS-5 (ops, s4 u19):** Never ESTIMATE a timestamp — every session
  that estimated drifted ahead (s1/s2 +2h, s3 +35–60 min, and s4's own
  unit-18 stamps ran +9 min while WRITING the no-estimates rule).
  Mechanical fix: capture $(date -u) in the same command that writes
  the entry; cross-check against git commit times. Time discipline is
  epistemic discipline: drifted stamps corrupted drain-ETA math twice.
