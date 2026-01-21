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
├── approve/
├── pending/
├── running/
├── done/
├── failed/
└── logs/
    └── results/
        ├── parallel.log
        └── <batch-name>/
            ├── out.log
            └── err.log
```

---

## Workflow

1. Generator creates batch files in `approve/`
2. Approved batches are moved to `pending/`
3. `run-queue.sh` watches `pending/` and executes batches
4. Logs are written per batch
5. Batch file is moved to `done/` or `failed/`

---

## Batch File Format

- One full shell command per line
- Blank lines are ignored
- Lines starting with `#` are comments

---

## Running the Queue

```bash
chmod +x queue/run-queue.sh
./queue/run-queue.sh
```

---

## Logs

For a batch `v5-grid.txt`:

```
queue/logs/results/v5-grid/
├── out.log
└── err.log
```

Job-level metadata is stored in:

```
queue/logs/results/parallel.log
```

---

## Pause / Resume

- Pause: `Ctrl + Z`
- Resume: `fg`

---

## Recovery

If a batch is interrupted, it remains in `running/`.
Move it back to `pending/` to retry.
