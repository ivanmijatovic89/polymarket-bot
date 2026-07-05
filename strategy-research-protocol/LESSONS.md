# Cross-family lessons

Append-only, protocol-level memory: lessons that generalize BEYOND the family
where they were learned. This is the compounding asset of the whole protocol —
per-family lessons live in each family's Research log; only the transferable
distillations get promoted here.

Rules:

- **Writers:** the Researcher, whenever a Research-log lesson generalizes
  (mandatory check at every kill and every validation); the user, anytime.
- **Readers (required):** ProposeFamily before proposing; the Researcher
  before speccing a new experiment.
- **Append-only.** Entries are never edited or deleted. If a lesson is later
  overturned, append a new entry that supersedes it and links back.
- **Format:** one `### <kebab-title> — YYYY-MM-DD` per lesson. Body: the
  lesson with its numbers, then `From:` linking the originating family. Keep
  entries dense — several sentences with the numbers that prove them, not
  one-liners.
- **Ban promotion:** while writing an entry, ask "is this a permanent
  constraint on future proposals?" If yes, also add one line to
  [`strategy-research-protocol/CONSTRAINTS.md`](./CONSTRAINTS.md).

## Lessons

### verify-a-new-filter-actually-binds — 2026-07-05

A new selection filter only carries information if its threshold actually
removes markets on the data; a threshold that never binds produces a screen
byte-identical to the unfiltered variant and silently re-runs a known result.
In `maker-favorite` `010-tight-spread`, adding `maxFavSpread` and sweeping it
(0.04/0.06/0.08) tied all three cells exactly at +0.22 net EV/mkt, 627 trades,
68.26% win — the tightest 0.04 bar removed zero markets because favorite touch
books in that mid-window are always tighter than 4 cents. The "passing" gate-1 cell
was thus a duplicate of an earlier screen (`006-cancel-weakening`) already
known to fail confirm at 3000 markets (-0.18), so no stage-2 extension was
warranted. Before trusting a filter's screen, confirm markets-played /
trade-count dropped versus the unfiltered baseline; if participation is
unchanged, the filter is inert regardless of its EV.
From: maker-favorite.
