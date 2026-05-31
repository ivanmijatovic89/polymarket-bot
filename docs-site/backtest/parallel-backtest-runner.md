# Parallel Backtest Runner

This project uses **GNU parallel** to run multiple backtests in parallel with different parameters,
while showing live progress and logging execution details for later analysis.

::: tip Each backtest already parallelizes internally
Since PR2, every `npm run backtest` invocation enqueues its markets into a
shared BullMQ worker pool and uses all available cores on its own — see
[Backtest Parallelization](./parallelization.md).

The GNU parallel pattern on this page is now mostly useful for queueing
`--sequential` batches (which intentionally bypass BullMQ) or for very small
single-market jobs that don't benefit from the worker pool. For typical
grid searches over many parameter combinations, prefer **submitting jobs to
the folder-watched queue runner** (`queue/run-queue.sh` in the repo) and let
the BullMQ pool saturate the machine one batch at a time.
:::

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

- Recommended concurrency is **1 job** when each backtest uses the BullMQ
  worker pool — anything higher just oversubscribes CPU. Higher values
  (`-j 4-6`) only make sense when every queued command uses `--sequential`.
- Each backtest should write results using a unique `--batchUid` (or
  `run_id`) to allow clean result analysis later.
