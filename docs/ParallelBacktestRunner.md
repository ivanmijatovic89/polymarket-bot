# Parallel Backtest Runner

This project uses **GNU parallel** to run multiple backtests in parallel with different parameters,
while showing live progress and logging execution details for later analysis.

## Installation (macOS)

Install GNU `parallel` using Homebrew:

```bash
brew install parallel
```

Verify the installation:

```bash
parallel --version
```

## Preparing Backtest Jobs

All backtest commands are listed in a file called a “jobs file” (one command per line).

- One line = one backtest run
- Each line must contain the full `npm run backtest` command with all parameters

In this repo we commonly use: `src/strategies/split/backtest-jobs.txt`

Example jobs file:

```bash
npm run backtest -- --strategy SplitSellRedeem.v1 --param splitShares=100 --param triggerBidBelow=0.20 --param sellPrice=0.21 --param sellSize=10 --symbol btc --limit 2
npm run backtest -- --strategy SplitSellRedeem.v1 --param splitShares=100 --param triggerBidBelow=0.22 --param sellPrice=0.23 --param sellSize=10 --symbol btc --limit 2
```

## Running Backtests in Parallel

Standard command used in this project:

```bash
parallel -j 6 --bar --eta --joblog logs/parallel.log > /dev/null < src/strategies/split/backtest-jobs.txt
```

What this command does:
- `-j 6` → runs up to 6 backtests in parallel
- `--bar --eta` → shows a progress bar and ETA
- `--joblog logs/parallel.log` → writes execution details for each backtest
- `> /dev/null` → suppresses all `console.log` output from backtests
- `src/strategies/split/backtest-jobs.txt` → input file containing all backtest commands

## Job Log

After execution, `logs/parallel.log` contains:
- start time of each backtest
- runtime duration
- exit code
- exact command that was executed

View the log in a readable table:

```bash
column -t logs/parallel.log | less
```

## Total Execution Time

To measure total wall-clock execution time:

```bash
time parallel -j 6 --bar --eta --joblog logs/parallel.log > /dev/null < src/strategies/split/backtest-jobs.txt
```

## Notes

- Recommended concurrency is **4–6 jobs**, depending on database and system resources
- Each backtest should write results using a unique `run_id` to allow clean result analysis later
