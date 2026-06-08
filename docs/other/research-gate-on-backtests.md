# Research Gate on Backtests

CLI tool to sum `pnl` across backtest feature files and compare totals with and without feature-gate filters.

## Files Required

The target folder must contain:

- `ALL_trades_features.json`
- `SEARCH_trades_features.json`
- `TEST_trades_features.json`

If any file is missing, the script prints which files are missing and exits with a non‑zero code.

## Usage

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts <folder> [filter]
```

Examples:

```bash
npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/240
npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/240 "netChange_20s>0.05"
npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/240 "netChange_45s>0.05&highLowRange_20s<20"
npx tsx src/cli/research/research-gate-on-backtests.ts data/research-backtest/240 --filter "netChange_45s>0.05&highLowRange_20s<20"
```

## Filters

Filter syntax:

```
field>number
field<number
field>=number
field<=number
field==number
field!=number
```

Multiple filters are combined with `&`:

```
netChange_45s>0.05&highLowRange_20s<20
```

Important: If you use `>` or `<`, wrap the filter string in quotes to avoid shell redirection.

## Output

The script prints a `console.table` with:

- `count (no gate)` / `pnl (no gate)` — totals without any filtering
- `count (gate skipped)` / `pnl (gate skipped)` — rows that pass the filter(s)
- `count (with gate)` / `pnl (with gate)` — rows excluded by the filter(s)
