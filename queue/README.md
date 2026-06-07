# Queue-based Batch Runner

This folder contains a simple, durable, and human-friendly batch execution system
built on top of **GNU parallel**.

The goal of this system is to:

- run large grid-search / backtest batches
- control execution via folders (approve → pending → running → done)
- allow safe pause / resume
- keep logs clean and readable
- avoid complex schedulers or external services

---

## Folder Structure

```
queue/
├── run-queue.sh
├── approve/            # Generated batches (not executed)
├── pending/            # Approved batches waiting to run
├── running/            # Currently executing batch
├── done/               # Successfully completed batches
├── failed/             # Failed batches
└── logs/
    ├── parallel.log            # Per-command metadata (always written)
    └── results/                # OPTIONAL batch stdout/stderr (only when enabled)
        └── <batch-name>/
            ├── out.log
            └── err.log
```

> Note: `logs/results/` is **disabled by default** and is only created when explicitly enabled.

---

## Workflow

1. Generator creates batch files in `approve/`
2. Approved batches are moved to `pending/`
3. `run-queue.sh` watches `pending/` and executes batches
4. (Optional) Batch logs are written to `logs/results/`
5. Batch file is moved to `done/` or `failed/`

---

## Batch File Format

- One full shell command per line
- Blank lines are ignored
- Lines starting with `#` are comments

Example:

```txt
# v5 grid search
npm run backtest -- --strategy A --param x=1
npm run backtest -- --strategy A --param x=2
```

---

## Running the Queue

From the project root:

```bash
chmod +x queue/run-queue.sh
./queue/run-queue.sh
```

### Set parallelism

Default is **1** parallel job. Each `npm run backtest` now uses its own
in-batch BullMQ worker pool (see [Backtest Parallelization](../docs/backtest/parallelization.md))
and saturates all available cores by itself — running multiple batches
side-by-side here would just oversubscribe the CPU.

Override with `--jobs N` if you're queueing `--sequential` batches or
single-market jobs that don't benefit from BullMQ:

```bash
./queue/run-queue.sh --jobs 4
# or:
./queue/run-queue.sh -j 4
```

### Enable batch stdout/stderr logs (optional)

By default, batch stdout/stderr is **not saved** to avoid disk usage.

To enable it:

```bash
./queue/run-queue.sh --save-results
```

You can combine both:

```bash
./queue/run-queue.sh --save-results --jobs 8
```

This creates per-batch logs under:

```
queue/logs/results/<batch-name>/
```

---

## Logs & Debugging

### Job metadata (always on)

```
queue/logs/parallel.log
```

Contains one row per command:

- command string
- runtime
- exit code
- signal (if any)

This is the primary source for identifying failed commands.

### Batch stdout/stderr (optional)

For a batch `v5-grid.txt`:

```
queue/logs/results/v5-grid/
├── out.log   # Combined stdout of all commands
└── err.log   # Combined stderr of all commands
```

> Output may be interleaved because commands run in parallel.

---

## Pause / Resume

- Pause execution: `Ctrl + Z`
- Resume execution: `fg`

State is preserved while paused.

---

## Stopping the Runner

To stop completely:

```
Ctrl + C
```

This exits cleanly and removes the runner lock.

---

## Recovery

If a batch is interrupted (crash / reboot), it remains in `running/`.

To retry it:

```bash
mv queue/running/*.txt queue/pending/
```

No automatic retries are performed by design.
