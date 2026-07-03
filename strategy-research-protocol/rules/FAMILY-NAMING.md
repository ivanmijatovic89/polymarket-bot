# Family Naming

A family is named after its **primary decision driver** — the core reason its
strategies enter, skip, or exit. One family = one driver.

## Slug format

Lowercase kebab-case, short, driver-first:

```text
good:  book-imbalance  spread-compression  liquidity-wall  late-market-snipe
bad:   orderbook  plugins  research-lab  experiment-1  BookImbalance  book_imbalance
```

## Name the decision, not the data source

`orderbook` is where the data comes from, not why the strategy acts. Data
sources, mechanisms, and themes belong in `tags`:

```json
{
  "family": "book-imbalance",
  "tags": ["orderbook", "imbalance", "entry-signal"]
}
```

## New family or new experiment?

Ask: what is the primary decision driver?

- Same driver as an existing family (new params, filters, gates, exits) → an
  **experiment** inside that family
  (see [`strategy-research-protocol/rules/EXPERIMENT-NAMING.md`](./EXPERIMENT-NAMING.md)).
- A genuinely different driver → a **new family**.

## Duplicates

Renaming an idea does not make it new — same driver = same family:

```text
late-entry ≈ wait-longer ≈ enter-near-end
book-pressure ≈ orderbook-imbalance ≈ bid-ask-skew
```

A near-duplicate is valid only if it adds a new **independent** driver
(`late-entry` alone = duplicate; `late-entry + spread-stability` = new).

When creating a family, write its normalized synonyms into `duplicateKeys` in
`src/strategies/research/<family>/FAMILY.json` so future proposals can catch
the overlap through the generated index.
