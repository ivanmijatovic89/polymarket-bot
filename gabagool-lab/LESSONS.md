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
- **LS-6 (E003):** A relative knob whose floor binds across the whole
  tested scale is a constant in disguise: parityTolPct 0.1 and 2 both
  floored to 12 shares and produced bit-identical runs (and tol 10
  barely escaped the floor late-window). Two arms of five bought no
  information. Before freezing an axis grid, compute each arm's
  EFFECTIVE value under the experiment's sizing and drop arms that
  collapse onto each other; state the effective grid in the spec.
- **LS-7 (E004):** In an adverse-selection-dominated book, the value
  of completing a pair is what completion REMOVES, not what the pair
  costs. Free completion won both halves DISTINCT (+1.10/+0.87 $/mkt)
  while its completed pairs averaged ABOVE $1.00 (S 1.0207/1.0188 —
  each pair locks ~2c loss plus fees): the win came from cutting
  maker fills −26.6%/−23.6%, latency conversions −39%/−38%, and
  imbalance p90 from 1.000 to 0.335. Cost-capped completion
  (≤0.97/≤0.99) is the same knob pointed backwards — it crosses when
  the projected pair is already cheap (situations that were fine) and
  holds exactly the bleeding inventory; both caps were
  indistinguishable from control. Corollary: never-overpay guards on
  COMPLETION select against the trades that matter (distinct from
  rung-placement caps, untested here). Quantified in §E004's
  decomposition (e004-decomp.ts).
- **LS-8 (E004, rule design):** An advance rule that tests
  full-ranking stability (top-2 SET match) among arms that are
  statistically TIED tests coin flips: E004's rule failed on the
  none/c970 middle (all pairwise |ΔEL| < 2·se_diff) while the winner
  was distinct and direction-stable in both halves. Design advance
  rules on the decision-relevant partition — "is the winner the same
  and distinguishable from the rest?" — not on rank order within
  noise. (E004's frozen consequence was still applied verbatim;
  the fix applies to FUTURE rule freezes.)
- **LS-9 (E005):** The two "pair-cost caps" sit on opposite sides of
  the pair lifecycle and have OPPOSITE value on an
  adverse-selection-dominated book. Capping the pair you BUILD
  (placement-side never-overpay, pairCostCap 0.99→0.96) filtered bad
  assembly and improved EL monotonically through the whole grid
  (−2.71→−2.29 h1, −2.36→−2.02 h2, direction stable both halves)
  while cutting outlay and tails. Capping the pair you RESCUE
  (completion-side, E004) blocked exactly the completions that
  mattered and was useless-to-harmful. Guard placement, free the
  rescue. Corollary (grid design): when a monotone curve is still
  improving at the grid edge, say so in the judgment and bracket the
  optimum in a follow-up — do not silently extend the grid mid-axis
  (14-way-selection creep).
- **LS-10 (ops, s12 u41):** `--extend <runId>` WITHOUT a window means
  "add every eligible market the run doesn't have" — the whole
  dataset — not "retry failures". Retrying a failed slug in a
  windowed run REQUIRES `--from-ms/--to-ms` bounds (the parent's
  window is a property of the original submission command, not of
  the run row). A bare --extend on battery run 714 enqueued 9,024
  foreign-window markets; caught before the merge transaction ran, so
  zero rows were corrupted (extension market rows persist only AT
  merge — verified 2,879 in-window rows throughout). Recovery arc
  that worked: kill producer → pause markets queue → drain the ~12
  locked actives → remove flow PARENT-first (LS-4) → resume → clear
  `extending_at` (documented recovery) → re-extend WITH the window.
  Second lesson: completion-waiters keyed on status=='completed' sit
  forever on 'partial' runs — poll for terminal-state, then branch.
