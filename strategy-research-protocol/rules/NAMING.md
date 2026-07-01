# Naming

## Family = primary decision driver

A family groups strategies that enter/skip/sell for the **same core reason**.
Name it after that reason — never after a data source or mechanism.

```
good:  book-imbalance  spread-compression  liquidity-wall  late-market-snipe
bad:   orderbook  plugins  technical-indicators  research-lab  experiment-1
```

`orderbook` is a data source, not a decision — it's a **tag**, not a family.

```yaml
family: book-imbalance # the driver
tags: [orderbook, imbalance, entry-signal] # data source / theme
```

## Format

- Family slug: lowercase kebab-case — `book-imbalance` (not `BookImbalance`,
  `book_imbalance`, `bookImbalance`).
- Experiment id: `<family>.<NNN>-<short-kebab-name>` — the `NNN` orders it, the
  name says what it is. Never a bare number.

  ```
  book-imbalance.001-baseline-sweep
  book-imbalance.002-persistence-filter
  book-imbalance.003-spread-gate
  ```

  Like family names, the short name describes the **idea**, not a number or a
  mechanism: `002-persistence-filter`, not `002-experiment` or `002-v2`.

## Is it a new family or an experiment?

Ask: **what is the primary decision driver?** If an existing family already uses
that driver, it's an **experiment** inside that family — not a new family.
A new family must introduce a genuinely different driver.

## Duplicate detection

Renaming an idea does not make it new. Same driver = duplicate.

```
late-entry ≈ wait-longer ≈ enter-near-end
book-pressure ≈ orderbook-imbalance ≈ bid-ask-skew
```

A near-duplicate becomes valid only if it adds a new **independent** driver
(e.g. `late-entry` alone = dup; `late-entry + spread-stability` = new).
This is what `duplicateKeys` in INDEX.json are for — list the normalized
synonyms so future proposals catch the overlap.
